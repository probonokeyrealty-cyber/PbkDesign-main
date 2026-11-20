import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/app/utils/runtimeBridge.ts'], bundle: true, write: false,
  format: 'esm', platform: 'browser', define: { 'import.meta.env': '{}' },
});
const fixtureSource = `${bundled.outputFiles[0].text}\n//# sourceURL=ava-chat-stream-client-fixture.mjs`;
const bridge = await import(`data:text/javascript;base64,${Buffer.from(fixtureSource).toString('base64')}`);
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const encoder = new TextEncoder();
const final = { ok: true, answer: 'Final authoritative answer', sessionId: 'fixture-session',
  mission: { status: 'completed' }, trace: { intent: 'answer' },
  controlEnvelope: { status: 'safe' }, toolResult: { draftOnly: true } };
let calls;
let storage;

beforeEach(() => {
  calls = [];
  storage = new Map();
  storage.set('pbk:local:openclaw-config', JSON.stringify({ endpoint: 'http://localhost:4000', apiKey: 'fixture-only-authority' }));
  globalThis.window = { location: new URL('http://localhost:4000'),
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    dispatchEvent: () => {}, addEventListener: () => {} };
});
afterEach(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; });

function invoke(options = {}) {
  assert.equal(typeof bridge.streamAvaAssistantChatRequest, 'function', 'streamed chat client must exist');
  return bridge.streamAvaAssistantChatRequest({ message: 'Explain the seller note', leadId: 'fixture-lead' }, options);
}
function fixture() {
  let controller;
  let cancelled = false;
  const body = new ReadableStream({ start(c) { controller = c; }, cancel() { cancelled = true; } });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  };
  return { write: (s) => controller.enqueue(typeof s === 'string' ? encoder.encode(s) : s),
    close: () => controller.close(), fail: () => controller.error(new Error('connection lost')),
    get cancelled() { return cancelled; } };
}
function event(name, value) { return `event: ${name}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`; }
const tick = () => new Promise((resolve) => setImmediate(resolve));
function hostedSession(overrides = {}) {
  window.location = new URL('https://fixture.netlify.app');
  const session = { token: 'fixture-only-team', role: 'team', actor: 'Fixture operator',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), ...overrides };
  storage.set(bridge.RUNTIME_TEAM_SESSION_KEY, JSON.stringify(session));
  return session;
}

for (const origin of ['https://fixture.netlify.app', 'https://preview--fixture.netlify.app', 'https://pbkcommandcenter.example']) {
  test(`streams ${origin} directly to Render with only the existing team token`, async () => {
    hostedSession();
    window.location = new URL(origin);
    const upstream = fixture();
    const pending = invoke();
    upstream.write(event('done', final));
    assert.deepEqual(await pending, final);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://pbk-openclaw-bridge.onrender.com/api/assistant/chat');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['X-PBK-Team-Token'], 'fixture-only-team');
    assert.equal(calls[0].headers.Authorization, undefined, 'stale local authority must not reach Render');
    assert.equal(calls[0].headers.Accept, 'text/event-stream');
    assert.equal(JSON.parse(calls[0].body).stream, true);
  });
}

test('does not forward a same-origin host API key to the direct Render chat route', async () => {
  hostedSession();
  window.PBK = { openclaw: { getConfig: () => ({ endpoint: window.location.origin, apiKey: 'fixture-only-authority' }) } };
  const upstream = fixture();
  const pending = invoke();
  upstream.write(event('done', final));
  await pending;
  assert.equal(calls[0].url, 'https://pbk-openclaw-bridge.onrender.com/api/assistant/chat');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].headers['X-PBK-Team-Token'], 'fixture-only-team');
});

for (const state of ['missing', 'expired', 'invalid expiry', 'empty token', 'malformed']) {
  test(`fails closed before fetching hosted chat with a ${state} team session`, async () => {
    hostedSession();
    if (state === 'missing') storage.delete(bridge.RUNTIME_TEAM_SESSION_KEY);
    if (state === 'expired') hostedSession({ expiresAt: new Date(Date.now() - 1).toISOString() });
    if (state === 'invalid expiry') hostedSession({ expiresAt: 'invalid' });
    if (state === 'empty token') hostedSession({ token: '' });
    if (state === 'malformed') storage.set(bridge.RUNTIME_TEAM_SESSION_KEY, '{broken');
    globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return Response.json(final); };
    await assert.rejects(() => invoke(), (e) => e instanceof bridge.RuntimeBridgeError && e.status === 401 && e.code === 'missing_team_session');
    assert.equal(calls.length, 0);
    assert.equal(storage.has(bridge.RUNTIME_TEAM_SESSION_KEY), false);
  });
}

test('same-origin host authority cannot bypass a missing hosted team session', async () => {
  hostedSession();
  storage.delete(bridge.RUNTIME_TEAM_SESSION_KEY);
  window.PBK = { openclaw: { getConfig: () => ({ endpoint: window.location.origin, apiKey: 'fixture-only-authority' }) } };
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return Response.json(final); };
  await assert.rejects(() => invoke(), /session|sign in/i);
  assert.equal(calls.length, 0);
});

for (const endpoint of ['https://custom-bridge.example/runtime', 'http://localhost:4000', 'http://127.0.0.1:4000']) {
  test(`preserves the explicit hosted-shell endpoint ${endpoint}`, async () => {
    hostedSession();
    window.PBK = { openclaw: { getConfig: () => ({ endpoint, apiKey: 'fixture-only-authority' }) } };
    const upstream = fixture();
    const pending = invoke();
    upstream.write(event('done', final));
    await pending;
    assert.equal(calls[0].url, `${endpoint}/api/assistant/chat`);
    assert.equal(calls[0].headers.Authorization, 'Bearer fixture-only-authority');
    assert.equal(calls[0].headers['X-PBK-Team-Token'], 'fixture-only-team');
    assert.equal(calls.length, 1);
  });
}

test('leaves non-streaming chat and other hosted calls on the same origin', async () => {
  hostedSession();
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return Response.json(final); };
  await bridge.sendAvaAssistantChatRequest({ message: 'Existing JSON chat' });
  await bridge.bridgeRequest({ method: 'POST', path: '/invoke', body: { toolName: 'fixture' } });
  assert.deepEqual(calls.map((call) => call.url), [
    'https://fixture.netlify.app/api/assistant/chat', 'https://fixture.netlify.app/invoke',
  ]);
});

test('publishes cumulative answers before the held tail and retains authoritative done metadata', async () => {
  const upstream = fixture();
  const answers = [];
  let settled = false;
  const pending = invoke({ onAnswer: (text) => answers.push(text) }).finally(() => { settled = true; });
  upstream.write(': keepalive\r\n\r\nevent: status\r\ndata: not JSON\r\n\r\n');
  upstream.write(event('answer', { text: 'First' }));
  await tick();
  assert.deepEqual(answers, ['First']);
  assert.equal(settled, false);
  upstream.write(event('answer', { text: 'First, more detail' }));
  upstream.write(event('done', final));
  assert.deepEqual(await pending, final);
  assert.deepEqual(answers, ['First', 'First, more detail']);
  assert.equal(upstream.cancelled, true, 'done need not wait for EOF');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Accept, 'text/event-stream');
  assert.equal(calls[0].headers.Authorization, 'Bearer fixture-only-authority');
  assert.equal(new URL(calls[0].url).pathname, '/api/assistant/chat');
  assert.equal(JSON.parse(calls[0].body).stream, true);
  assert.equal(JSON.parse(calls[0].body).leadId, 'fixture-lead');
});

test('parses fragmented UTF-8, CRLF and multiline event data with the SSE library', async () => {
  const upstream = fixture();
  const answers = [];
  const pending = invoke({ onAnswer: (s) => answers.push(s) });
  const bytes = encoder.encode(`event: answer\r\ndata: {\r\ndata: "text": "Caf\u00e9 \ud83c\udfe0"}\r\n\r\n${event('done', final)}`);
  for (const byte of bytes) upstream.write(new Uint8Array([byte]));
  assert.deepEqual(await pending, final);
  assert.deepEqual(answers, ['Caf\u00e9 \ud83c\udfe0']);
});

for (const failure of ['eof', 'error', 'transport', 'malformed', 'invalid answer', 'invalid done']) {
  test(`rejects ${failure} after partial text without replaying the POST`, async () => {
    const upstream = fixture();
    const answers = [];
    const pending = invoke({ onAnswer: (s) => answers.push(s) });
    const rejected = assert.rejects(pending, failure === 'error' ? /fixture interruption/ : /interrupt|invalid|connection|incomplete/i);
    upstream.write(event('answer', { text: 'Visible partial' }));
    await tick();
    if (failure === 'eof') upstream.close();
    if (failure === 'error') upstream.write(event('error', { message: 'fixture interruption', code: 'stream_failed' }));
    if (failure === 'transport') upstream.fail();
    if (failure === 'malformed') upstream.write('event: answer\ndata: {broken}\n\n');
    if (failure === 'invalid answer') upstream.write(event('answer', { text: { hidden: 'not display text' } }));
    if (failure === 'invalid done') upstream.write(event('done', { answer: 'Missing ok' }));
    await rejected;
    assert.deepEqual(answers, ['Visible partial']);
    assert.equal(calls.length, 1);
  });
}

test('requires done even for an empty or unterminated SSE body', async () => {
  const upstream = fixture();
  const pending = invoke();
  const rejected = assert.rejects(pending, /interrupt|incomplete/i);
  upstream.write('event: done\ndata: {"ok":true,"answer":"not dispatched"}');
  upstream.close();
  await rejected;
});

test('cancels a held body after partial text and never sends another POST', async () => {
  const upstream = fixture();
  const controller = new AbortController();
  const answers = [];
  const pending = invoke({ signal: controller.signal, onAnswer: (s) => answers.push(s) });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  upstream.write(event('answer', { text: 'Before stop' }));
  await tick();
  controller.abort();
  await rejected;
  assert.deepEqual(answers, ['Before stop']);
  assert.equal(upstream.cancelled, true);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls.length, 1);
});

test('does not POST with an already aborted signal', async () => {
  fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => invoke({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('Stop wins over done when cancellation occurs during the answer callback', async () => {
  const upstream = fixture();
  const controller = new AbortController();
  const answers = [];
  const pending = invoke({ signal: controller.signal, onAnswer: (text) => { answers.push(text); controller.abort(); } });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  upstream.write(event('answer', { text: 'Before stop' }) + event('answer', { text: 'After stop' }) + event('done', final));
  await rejected;
  assert.deepEqual(answers, ['Before stop']);
  assert.equal(calls.length, 1);
});

test('Stop cancels a held legacy JSON response body without retrying', async () => {
  let cancelled = false;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init });
    return new Response(new ReadableStream({
      start(c) { c.enqueue(encoder.encode('{"ok":true,"answer":"partial')); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'application/json' } });
  };
  const controller = new AbortController();
  const pending = invoke({ signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  controller.abort();
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
});

test('falls back to a complete detailed JSON response on the same request', async () => {
  const answer = 'Complete detailed reply. '.repeat(600);
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return Response.json({ ...final, answer }); };
  const answers = [];
  assert.equal((await invoke({ onAnswer: (s) => answers.push(s) })).answer, answer);
  assert.equal(calls.length, 1);
  assert.deepEqual(answers, []);
});

for (const phase of ['before headers', 'after headers']) {
  test(`hosted chat can complete beyond 60 seconds ${phase}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    hostedSession();
    const controller = new AbortController();
    t.after(() => controller.abort());
    let finish;
    if (phase === 'after headers') {
      const upstream = fixture();
      finish = () => upstream.write(event('done', final));
    } else {
      globalThis.fetch = (url, init) => {
        calls.push({ url, ...init });
        return new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          finish = () => resolve(new Response(event('done', final), { headers: { 'Content-Type': 'text/event-stream' } }));
        });
      };
    }
    const answers = [];
    let settled = false;
    const outcome = invoke({ signal: controller.signal, onAnswer: (s) => answers.push(s) })
      .then((value) => ({ value }), (error) => ({ error })).finally(() => { settled = true; });
    await tick();
    t.mock.timers.tick(120_000);
    await tick();
    assert.equal(settled, false, 'long generation must remain pending past the old deadline');
    assert.equal(calls[0].signal.aborted, false);
    finish();
    assert.deepEqual((await outcome).value, final);
    assert.deepEqual(answers, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://pbk-openclaw-bridge.onrender.com/api/assistant/chat');
  });
}

test('Stop cancels hosted chat at ten minutes without replay or a completed answer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  hostedSession();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const upstream = fixture();
  const answers = [];
  const outcome = invoke({ signal: controller.signal, onAnswer: (s) => answers.push(s) })
    .then((value) => ({ value }), (error) => ({ error }));
  upstream.write(event('answer', { text: 'Before late stop' }));
  await tick();
  t.mock.timers.tick(600_000);
  await tick();
  assert.equal(calls[0].signal.aborted, false);
  controller.abort();
  const result = await outcome;
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(result.value, undefined);
  assert.deepEqual(answers, ['Before late stop']);
  assert.equal(upstream.cancelled, true);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls.length, 1);
});

test('eleven-minute transport guard covers the held body and does not reset on answers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  hostedSession();
  const upstream = fixture();
  const controller = new AbortController();
  t.after(() => controller.abort());
  let settled = false;
  const outcome = invoke({ signal: controller.signal })
    .then((value) => ({ value }), (error) => ({ error })).finally(() => { settled = true; });
  upstream.write(event('answer', { text: 'Before timeout' }));
  await tick();
  t.mock.timers.tick(659_999);
  await tick();
  assert.equal(settled, false);
  assert.equal(calls[0].signal.aborted, false);
  upstream.write(event('answer', { text: 'Still working' }));
  await tick();
  t.mock.timers.tick(1);
  const result = await outcome;
  assert.match(result.error?.message || '', /timed out after 660 seconds/);
  assert.equal(result.value, undefined);
  assert.equal(upstream.cancelled, true);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls.length, 1);
});

test('preserves auth rejection handling and never retries a POST through the hosted fallback', async () => {
  hostedSession();
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return Response.json({ code: 'expired_team_session', error: 'Sign in again' }, { status: 401 }); };
  await assert.rejects(() => invoke(), (e) => e instanceof bridge.RuntimeBridgeError && e.status === 401 && e.code === 'expired_team_session');
  assert.equal(storage.has(bridge.RUNTIME_TEAM_SESSION_KEY), false);
  assert.equal(calls[0].headers['X-PBK-Team-Token'], 'fixture-only-team');
  assert.equal(calls[0].url, 'https://pbk-openclaw-bridge.onrender.com/api/assistant/chat');
  assert.equal(calls.length, 1);
});

test('a rejected captured token cannot invalidate a replacement team session', async () => {
  hostedSession();
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init });
    hostedSession({ token: 'fixture-replacement-team' });
    return Response.json({ code: 'expired_team_session', error: 'Sign in again' }, { status: 401 });
  };
  await assert.rejects(() => invoke(), (e) => e instanceof bridge.RuntimeBridgeError && e.code === 'expired_team_session');
  assert.equal(bridge.getRuntimeTeamSession()?.token, 'fixture-replacement-team');
  assert.equal(calls[0].headers['X-PBK-Team-Token'], 'fixture-only-team');
  assert.equal(calls.length, 1);
});

for (const [format, replaced] of [['JSON', false], ['JSON', true], ['plain text', false], ['plain text', true]]) {
  test(`generic ${format} direct Render 401 rejects the captured token${replaced ? ' without clearing a replacement' : ''}`, async () => {
    hostedSession();
    globalThis.fetch = async (url, init) => {
      calls.push({ url, ...init });
      if (replaced) hostedSession({ token: 'fixture-replacement-team' });
      return format === 'JSON'
        ? Response.json({ error: 'Unauthorized' }, { status: 401 })
        : new Response('Unauthorized', { status: 401 });
    };
    await assert.rejects(() => invoke(), (e) => e instanceof bridge.RuntimeBridgeError && e.status === 401 && e.code === 'invalid_team_session');
    assert.equal(bridge.getRuntimeTeamSession()?.token, replaced ? 'fixture-replacement-team' : undefined);
    assert.equal(calls[0].headers['X-PBK-Team-Token'], 'fixture-only-team');
    assert.equal(calls[0].url, 'https://pbk-openclaw-bridge.onrender.com/api/assistant/chat');
    assert.equal(calls.length, 1);
  });
}

test('a generic 401 at an explicit custom endpoint is not reclassified as a team rejection', async () => {
  hostedSession();
  window.PBK = { openclaw: { getConfig: () => ({ endpoint: 'https://custom-bridge.example', apiKey: 'fixture-only-authority' }) } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init });
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  };
  await assert.rejects(() => invoke(), (e) => e instanceof bridge.RuntimeBridgeError && e.status === 401 && e.code === '');
  assert.equal(bridge.getRuntimeTeamSession()?.token, 'fixture-only-team');
  assert.equal(calls[0].url, 'https://custom-bridge.example/api/assistant/chat');
  assert.equal(calls.length, 1);
});

for (const failure of ['proxy', 'explicit auth code', 'permission', 'transport']) {
  test(`hosted ${failure} failure is not retried and does not clear team auth`, async () => {
    hostedSession();
    globalThis.fetch = async (url, init) => {
      calls.push({ url, ...init });
      if (failure === 'transport') throw new TypeError('Failed to fetch');
      if (failure === 'permission') return Response.json({ code: 'team_permission_denied', error: 'Not allowed' }, { status: 403 });
      if (failure === 'explicit auth code') return Response.json({ code: 'private_site_auth_required', error: 'Private site' }, { status: 401 });
      return new Response('Usage exceeded', { status: 503 });
    };
    await assert.rejects(() => invoke(), /Usage exceeded|Private site|Not allowed|Failed to fetch/);
    assert.equal(bridge.getRuntimeTeamSession()?.token, 'fixture-only-team');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://pbk-openclaw-bridge.onrender.com/api/assistant/chat');
  });
}
