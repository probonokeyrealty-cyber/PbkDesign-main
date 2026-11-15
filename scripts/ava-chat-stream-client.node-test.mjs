import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/app/utils/runtimeBridge.ts'], bundle: true, write: false,
  format: 'esm', platform: 'browser', define: { 'import.meta.env': '{}' },
});
const bridge = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
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

test('45-second timeout covers a held response body after headers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const upstream = fixture();
  const pending = invoke();
  const rejected = assert.rejects(pending, /timed out after 45 seconds/);
  upstream.write(event('answer', { text: 'Before timeout' }));
  await tick();
  t.mock.timers.tick(45_000);
  await rejected;
  assert.equal(upstream.cancelled, true);
  assert.equal(calls.length, 1);
});

test('preserves auth rejection handling and never retries a POST through the hosted fallback', async () => {
  window.location = new URL('https://fixture.netlify.app');
  storage.set(bridge.RUNTIME_TEAM_SESSION_KEY, JSON.stringify({ token: 'fixture-only-team', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return Response.json({ code: 'expired_team_session', error: 'Sign in again' }, { status: 401 }); };
  await assert.rejects(() => invoke(), (e) => e instanceof bridge.RuntimeBridgeError && e.status === 401 && e.code === 'expired_team_session');
  assert.equal(storage.has(bridge.RUNTIME_TEAM_SESSION_KEY), false);
  assert.equal(calls[0].headers['X-PBK-Team-Token'], 'fixture-only-team');
  assert.equal(calls.length, 1);
});

test('does not retry exhausted proxy or non-JSON errors', async () => {
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return new Response('Usage exceeded', { status: 503 }); };
  await assert.rejects(() => invoke(), /Usage exceeded/);
  assert.equal(calls.length, 1);
});
