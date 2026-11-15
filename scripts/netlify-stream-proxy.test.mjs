import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from '@jest/globals';
import { createFetchProxyFixture, createProxyFixture } from './fixtures/netlify-proxy-qa.mjs';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const encoder = new TextEncoder();
const first = 'event: answer\ndata: {"text":"Checking"}\n\n';
const tail = 'event: answer\ndata: {"text":"Checking the lead."}\n\nevent: done\ndata: {"ok":true,"answer":"Checking the lead.","approvalRequired":true}\n\n';

function request({ path = '/api/assistant/chat', headers = {}, body, signal, direct = false } = {}) {
  return new Request(direct ? `https://pbkcommandcenter.netlify.app${path}`
    : `https://pbkcommandcenter.netlify.app/.netlify/functions/pbk-bridge-proxy?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'text/event-stream',
      'x-pbk-team-token': 'fixture-team-session', 'x-request-id': 'stream-request',
      origin: 'https://pbkcommandcenter.netlify.app', ...headers,
    },
    body: body ?? JSON.stringify({ message: 'Check the lead.', stream: true }),
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    signal,
  });
}

function clock() {
  const active = new Map();
  const created = [];
  return {
    active, created,
    setTimeout(callback, ms) { const id = created.length + 1; created.push(ms); active.set(id, { callback, ms }); return id; },
    clearTimeout(id) { active.delete(id); },
    expire(ms) {
      const timer = [...active.values()].find(timer => timer.ms === ms);
      assert.ok(timer, `Expected an active ${ms}ms deadline`);
      timer.callback();
    },
  };
}

function streamingFixture({ verification = { ok: true, permissions: {} }, status = 200, targetResponse } = {}) {
  const timers = clock();
  const calls = [];
  const cancellations = [];
  let upstream;
  const body = new ReadableStream({
    start(controller) { upstream = controller; controller.enqueue(encoder.encode(first)); },
    cancel(reason) { cancellations.push(reason); },
  }, { highWaterMark: 0 });
  const response = targetResponse ?? new Response(body, { headers: {
    'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
    'x-request-id': 'bridge-request', 'x-pbk-bridge': 'fixture',
    'set-cookie': 'must-not-leak=yes', 'x-private-provider': 'must-not-leak',
  } });
  // Any whole-body reader on the streaming branch is a regression.
  if (!targetResponse) for (const method of ['text', 'json', 'arrayBuffer', 'blob']) {
    response[method] = () => { throw new Error(`Buffered through ${method}`); };
  }
  const handler = createFetchProxyFixture(async (url, init) => {
    calls.push({ path: new URL(url).pathname, url, init });
    return calls.at(-1).path === '/api/auth/team/verify'
      ? Response.json(verification, { status }) : response;
  }, timers);
  return { handler, timers, calls, cancellations, upstream };
}

function modern(fixture) {
  assert.equal(typeof fixture.handler, 'function', 'Production must export a default Fetch-style handler');
  return fixture.handler;
}

async function promptly(promise) {
  let timeout;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Proxy buffered the deferred tail')), 1000);
    })]);
  } finally { clearTimeout(timeout); }
}

for (const direct of [false, true]) test(`SSE first bytes arrive before deferred tail on ${direct ? 'canonical' : 'rewritten'} path`, async () => {
  const f = streamingFixture();
  const response = await promptly(modern(f)(request({ direct })));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(response.headers.get('x-request-id'), 'bridge-request');
  assert.equal(response.headers.get('x-pbk-bridge-proxy'), 'netlify');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://pbkcommandcenter.netlify.app');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-private-provider'), null);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await promptly(reader.read())).value), first);
  assert.equal(f.timers.active.size, 1, 'The 40s deadline must survive response headers and first bytes');
  assert.deepEqual([...f.timers.active.values()].map(t => t.ms), [40_000]);
  f.upstream.enqueue(encoder.encode(tail));
  f.upstream.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value), tail);
  assert.equal((await reader.read()).done, true);
  assert.equal(f.timers.active.size, 0);
  assert.deepEqual(f.calls.map(c => c.path), ['/api/auth/team/verify', '/api/assistant/chat']);
  const sent = new Headers(f.calls[1].init.headers);
  assert.equal(sent.get('accept'), 'text/event-stream');
  assert.equal(sent.get('x-request-id'), 'stream-request');
  assert.equal(sent.get('x-pbk-team-token'), 'fixture-team-session');
  assert.equal(JSON.parse(Buffer.from(f.calls[1].init.body).toString()).stream, true);
});

for (const [status, verification, expected] of [
  [401, { ok: false, code: 'expired_team_session' }, 'expired_team_session'],
  [503, { ok: false }, 'team_auth_verification_unavailable'],
  [200, {}, 'team_auth_verification_unavailable'],
]) test(`Fetch SSE verifier ${status} fails closed with zero target calls`, async () => {
  const f = streamingFixture({ status, verification });
  const response = await modern(f)(request());
  assert.equal(response.status, status === 200 ? 502 : status);
  assert.equal((await response.json()).code, expected);
  assert.deepEqual(f.calls.map(c => c.path), ['/api/auth/team/verify']);
  assert.equal(f.timers.active.size, 0);
});

test('Fetch SSE missing team token makes zero upstream calls', async () => {
  const f = streamingFixture();
  const response = await modern(f)(request({ headers: { 'x-pbk-team-token': '' } }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'team_auth_required');
  assert.equal(f.calls.length, 0);
});

test('SSE uses the existing body-based provider authorization before target fetch', async () => {
  const f = streamingFixture();
  const response = await modern(f)(request({ body: JSON.stringify({ message: 'Send SMS to seller', stream: true }) }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).permission, 'canSendSms');
  assert.deepEqual(f.calls.map(c => c.path), ['/api/auth/team/verify']);
  assert.equal(f.timers.active.size, 0);
});

for (const readFirst of [false, true]) test(`downstream cancellation ${readFirst ? 'after first bytes' : 'before reading'} cancels upstream and deadline`, async () => {
  const f = streamingFixture();
  const response = await modern(f)(request());
  const reader = response.body.getReader();
  if (readFirst) await reader.read();
  await promptly(reader.cancel('operator stopped'));
  assert.equal(f.calls[1].init.signal.aborted, true);
  assert.equal(f.cancellations.length, 1);
  assert.equal(f.timers.active.size, 0);
  assert.equal(f.calls.length, 2, 'Never retry or replay a cancelled chat');
});

for (const timeout of [false, true]) test(`${timeout ? '40s deadline' : 'request disconnect'} interrupts pending body read visibly`, async () => {
  const f = streamingFixture();
  const abort = new AbortController();
  const response = await modern(f)(request({ signal: abort.signal }));
  const reader = response.body.getReader();
  await reader.read();
  const pending = reader.read();
  const failure = assert.rejects(pending, /timed out|disconnect/i);
  if (timeout) f.timers.expire(40_000);
  else abort.abort(new Error('client disconnected'));
  await promptly(failure);
  assert.equal(f.calls[1].init.signal.aborted, true);
  assert.equal(f.cancellations.length, 1);
  assert.equal(f.timers.active.size, 0);
  assert.equal(f.calls.length, 2);
});

test('an upstream error after first bytes fails the body instead of fabricating done', async () => {
  const f = streamingFixture();
  const response = await modern(f)(request());
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), first);
  const failure = assert.rejects(reader.read(), /upstream stream broke/);
  f.upstream.error(new Error('upstream stream broke'));
  await promptly(failure);
  assert.equal(f.timers.active.size, 0);
  assert.equal(f.calls[1].init.signal.aborted, true);
  assert.equal(f.calls.length, 2);
});

test('stream completion removes the request disconnect listener', async () => {
  const f = streamingFixture();
  const req = request();
  const before = getEventListeners(req.signal, 'abort').length;
  const response = await modern(f)(req);
  assert.equal(getEventListeners(req.signal, 'abort').length, before + 1);
  f.upstream.close();
  assert.equal(await response.text(), first);
  assert.equal(getEventListeners(req.signal, 'abort').length, before);
});

test('disconnect while verifying aborts verification and never calls the target', async () => {
  const timers = clock();
  const abort = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const calls = [];
  const handler = createFetchProxyFixture((url, init) => {
    calls.push(new URL(url).pathname);
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      started();
    });
  }, timers);
  assert.equal(typeof handler, 'function');
  const pending = handler(request({ signal: abort.signal }));
  await ready;
  abort.abort(new Error('disconnected during verification'));
  const response = await promptly(pending);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'team_auth_verification_unavailable');
  assert.deepEqual(calls, ['/api/auth/team/verify']);
  assert.equal(timers.active.size, 0);
});

test('deadline before response headers preserves the 504 JSON shape without replay', async () => {
  const timers = clock();
  const calls = [];
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const handler = createFetchProxyFixture(async (url, init) => {
    calls.push(new URL(url).pathname);
    if (calls.length === 1) return Response.json({ ok: true, permissions: {} });
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      started();
    });
  }, timers);
  assert.equal(typeof handler, 'function');
  const pending = handler(request());
  await ready;
  timers.expire(40_000);
  const response = await promptly(pending);
  assert.equal(response.status, 504);
  const payload = await response.json();
  assert.equal(payload.error, 'PBK bridge proxy timed out.');
  assert.equal(payload.message, 'Bridge did not respond within 40000ms.');
  assert.equal(payload.target, '/api/assistant/chat');
  assert.equal(payload.requestId, 'stream-request');
  assert.equal(timers.active.size, 0);
  assert.deepEqual(calls, ['/api/auth/team/verify', '/api/assistant/chat']);
});

test('a nonstream JSON body retains its deadline until the deferred body is consumed', async () => {
  let upstream;
  const body = new ReadableStream({ start(controller) { upstream = controller; controller.enqueue(encoder.encode('{"ok":true,')); } });
  const f = streamingFixture({ targetResponse: new Response(body, { headers: { 'content-type': 'application/json' } }) });
  let settled = false;
  const pending = modern(f)(request({ headers: { accept: 'application/json' } })).then(response => { settled = true; return response; });
  for (let i = 0; i < 30 && f.calls.length < 2; i++) await Promise.resolve();
  assert.equal(f.calls.length, 2);
  assert.equal(settled, false);
  assert.deepEqual([...f.timers.active.values()].map(t => t.ms), [40_000]);
  upstream.enqueue(encoder.encode('"answer":"all details"}')); upstream.close();
  assert.equal((await (await pending).json()).answer, 'all details');
  assert.equal(f.timers.active.size, 0);
});

test('SSE negotiation still preserves nonstream JSON and upstream error responses', async () => {
  for (const status of [200, 429]) {
    const payload = { ok: status === 200, answer: 'Complete answer', code: 'fixture' };
    const f = streamingFixture({ targetResponse: Response.json(payload, { status, headers: { 'retry-after': '7' } }) });
    const response = await modern(f)(request());
    assert.equal(response.status, status);
    assert.deepEqual(JSON.parse(await response.text()), payload);
    assert.equal(response.headers.get('retry-after'), '7');
    assert.equal(f.timers.active.size, 0);
  }
});

test('nonstream Fetch JSON matches the legacy handler and forwards repeated query values', async () => {
  const payload = { ok: true, answer: 'Full answer. '.repeat(900), approvals: [{ id: 'fixture' }] };
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return Response.json(new URL(url).pathname === '/api/auth/team/verify' ? { ok: true, permissions: {} } : payload);
  };
  const timers = clock();
  const handler = createFetchProxyFixture(fetch, timers);
  assert.equal(typeof handler, 'function');
  const req = request({ headers: { accept: 'application/json', authorization: 'caller-authority', 'x-forwarded-for': '192.0.2.5, 192.0.2.6' }, body: JSON.stringify({ message: 'Explain your role' }) });
  const url = new URL(req.url); url.searchParams.append('tag', 'one'); url.searchParams.append('tag', 'two');
  const response = await handler(new Request(url, req));
  const legacy = await createProxyFixture(fetch, timers)({ httpMethod: 'POST', path: '/api/assistant/chat', headers: { 'x-pbk-team-token': 'fixture-team-session' }, body: JSON.stringify({ message: 'Explain your role' }) });
  assert.equal(response.status, legacy.statusCode);
  assert.deepEqual(JSON.parse(await response.text()), JSON.parse(legacy.body));
  assert.deepEqual(Array.from(calls[1].url.searchParams.getAll('tag')), ['one', 'two']);
  const sent = new Headers(calls[1].init.headers);
  assert.equal(sent.get('authorization'), 'Bearer fixture-only-authority');
  assert.equal(sent.get('x-pbk-client-ip'), '192.0.2.5');
  assert.equal(timers.active.size, 0);
});

for (const declared of [false, true]) test(`Fetch rejects >5MB ${declared ? 'from Content-Length before reading' : 'while reading'} with legacy error shape`, async () => {
  const f = streamingFixture();
  let pulls = 0; let cancelled = 0;
  const body = new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(declared ? 1 : MAX_BODY_BYTES + 1)); },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  const response = await modern(f)(request({ body, headers: declared ? { 'content-length': String(MAX_BODY_BYTES + 1) } : {} }));
  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse(await response.text()), { ok: false, error: 'Request body too large', maxBytes: MAX_BODY_BYTES, requestId: 'stream-request' });
  assert.equal(response.headers.get('x-request-id'), 'stream-request');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://pbkcommandcenter.netlify.app');
  assert.equal(pulls, declared ? 0 : 1);
  assert.equal(cancelled, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.active.size, 0);
});

test('an already-aborted request cancels its upload before any upstream call', async () => {
  const f = streamingFixture();
  const abort = new AbortController();
  abort.abort(new Error('already disconnected'));
  let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled++; } }, { highWaterMark: 0 });
  const response = await modern(f)(request({ body, signal: abort.signal }));
  assert.equal(response.status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal(cancelled, 1);
});

test('query parameter names do not inherit object prototype properties', async () => {
  const f = streamingFixture({ targetResponse: Response.json({ ok: true }) });
  const req = request();
  const url = new URL(req.url);
  url.searchParams.append('constructor', 'one');
  url.searchParams.append('__proto__', 'two');
  const response = await modern(f)(new Request(url, req));
  assert.equal(response.status, 200);
  const forwarded = new URL(f.calls[1].url).searchParams;
  assert.equal(forwarded.get('constructor'), 'one');
  assert.equal(forwarded.get('__proto__'), 'two');
});

test('the Fetch adapter accepts exactly 5MB and enforces bytes rather than character count', async () => {
  const f = streamingFixture({ targetResponse: Response.json({ ok: true }) });
  const response = await modern(f)(request({ body: ' '.repeat(MAX_BODY_BYTES) }));
  assert.equal(response.status, 200);
  assert.equal(f.calls[1].init.body.byteLength, MAX_BODY_BYTES);
  const oversized = await modern(f)(request({ body: '\u00e9'.repeat(Math.floor(MAX_BODY_BYTES / 2) + 1) }));
  assert.equal(oversized.status, 413);
  assert.equal(f.calls.length, 2);
});

for (const [path, payload] of [
  ['/health', { ok: true, status: 'healthy', checkedAt: 'fixture', components: { db: { status: 'ready' } } }],
  ['/api/state', { ok: true, messages: Array.from({ length: 300 }, (_, id) => ({ id, text: 'x'.repeat(2000), embedding: [1, 2] })) }],
  ['/api/campaigns', { ok: true, campaigns: [{ id: 'fixture' }], state: { private: true } }],
  ['/api/leads', { ok: true, leads: [{ id: 'fixture', notes: 'Full seller notes' }] }],
]) test(`Fetch read compatibility retains existing compaction for ${path}`, async () => {
  const fetch = async url => Response.json(new URL(url).pathname === '/api/auth/team/verify' ? { ok: true, permissions: {} } : payload);
  const handler = createFetchProxyFixture(fetch);
  assert.equal(typeof handler, 'function');
  const headers = { 'x-pbk-team-token': 'fixture-team-session' };
  const response = await handler(new Request(`https://pbkcommandcenter.netlify.app${path}`, { headers }));
  const legacy = await createProxyFixture(fetch)({ httpMethod: 'GET', path, headers });
  assert.equal(response.status, legacy.statusCode);
  assert.deepEqual(JSON.parse(await response.text()), JSON.parse(legacy.body));
});

test('Fetch binary, HEAD, 304 and OPTIONS responses retain their HTTP semantics', async () => {
  const bytes = new Uint8Array([0, 127, 128, 255]);
  const calls = [];
  const handler = createFetchProxyFixture(async (url, init) => {
    calls.push(new URL(url).pathname);
    if (calls.at(-1) === '/api/auth/team/verify') return Response.json({ ok: true, permissions: {} });
    if (new URL(url).searchParams.has('unchanged')) return new Response(null, { status: 304, headers: { etag: 'fixture' } });
    return new Response(init.method === 'HEAD' ? null : bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename=fixture.pdf' } });
  });
  assert.equal(typeof handler, 'function');
  const url = 'https://pbkcommandcenter.netlify.app/api/document';
  const headers = { 'x-pbk-team-token': 'fixture-team-session' };
  const response = await handler(new Request(url, { headers }));
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(bytes));
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename=fixture.pdf');
  const head = await handler(new Request(url, { method: 'HEAD', headers }));
  assert.equal(head.body, null);
  const unchanged = await handler(new Request(`${url}?unchanged=1`, { headers }));
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body, null);
  const before = calls.length;
  const options = await handler(new Request(url, { method: 'OPTIONS', headers: { origin: 'https://untrusted.invalid' } }));
  assert.equal(options.status, 204);
  assert.equal(options.body, null);
  assert.equal(options.headers.get('access-control-allow-origin'), null);
  assert.equal(calls.length, before);
});
