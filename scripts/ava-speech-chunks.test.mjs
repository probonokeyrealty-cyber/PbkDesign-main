import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { joinAvaSpeechResponses, splitAvaSpeechText } from './ava-speech-chunks.mjs';

test('speech chunks retain every character, including long words and Unicode pairs', () => {
  for (const text of ['explain '.repeat(700), 'x'.repeat(6000), `${'a'.repeat(1599)}\ud83d\ude00 final detail`]) {
    const chunks = splitAvaSpeechText(text);
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every((chunk) => chunk.length <= 1600));
    assert.ok(chunks.every((chunk) => !/[\ud800-\udbff]$/.test(chunk)));
  }
});

test('sequential audio includes all chunks in order and removes stale length headers', async () => {
  const requested = [];
  const response = joinAvaSpeechResponses(new Response('first ', { headers: { 'content-length': '6', 'content-type': 'audio/mpeg' } }), ['second ', 'last'], async (chunk) => {
    requested.push(chunk);
    return new Response(chunk);
  });
  assert.equal(await response.text(), 'first second last');
  assert.deepEqual(requested, ['second ', 'last']);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
});

test('stopping playback cancels the source and does not request more speech', async () => {
  let cancelled = false;
  let extraCalls = 0;
  const first = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array([1])); },
    cancel() { cancelled = true; },
  }));
  const response = joinAvaSpeechResponses(first, ['remaining'], async () => { extraCalls++; return new Response('extra'); });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(cancelled, true);
  assert.equal(extraCalls, 0);
});

test('a failed later chunk surfaces an audio failure instead of successful truncated speech', async () => {
  const response = joinAvaSpeechResponses(new Response('first'), ['last'], async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(response.arrayBuffer(), /Speech chunk failed/);
});

test('stopping while the next chunk is pending aborts that provider operation', async () => {
  let started;
  const pendingStarted = new Promise((resolve) => { started = resolve; });
  let release;
  let aborted = false;
  const response = joinAvaSpeechResponses(new Response('first'), ['pending'], async (_, signal) => new Promise((resolve, reject) => {
    release = () => resolve(new Response('last'));
    signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
    started();
  }));
  const reader = response.body.getReader();
  await reader.read();
  await pendingStarted;
  try {
    await reader.cancel();
    assert.equal(aborted, true);
  } finally {
    release();
  }
});

function ttsFixture(fetch) {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const context = vm.createContext({
    joinAvaSpeechResponses, splitAvaSpeechText, Response, AbortSignal, AbortController,
    sanitizeAvaSpokenOutput: (text) => text,
    buildElevenLabsTtsRequest: (body, text) => ({ voiceId: body.voiceId || 'fixture', url: 'https://voice.invalid', payload: { text }, sanitizedText: text }),
    executeProviderCircuitGuard: (_, operation) => operation(),
    fetch,
    ELEVENLABS_API_KEY: 'fixture', ELEVENLABS_FALLBACK_VOICE_ID: '',
    recordAvaSpokenOutputDiagnostics: () => {}, recordProsodyDecisionFromTtsRequest: async () => {},
  });
  const start = source.indexOf('async function fetchElevenLabsTts(');
  vm.runInContext(source.slice(start, source.indexOf('\nfunction sendTelnyxMediaClearCommand', start)), context);
  return context;
}

test('the actual TTS path delivers the end of a long answer through bounded provider requests', async () => {
  const supplied = [];
  const context = ttsFixture(async (_, init) => {
    const text = JSON.parse(init.body).text;
    supplied.push(text);
    return new Response(text, { status: text.length <= 1600 ? 200 : 400 });
  });
  const text = `${'A useful explanation. '.repeat(200)}Final detail.`;
  const result = await context.fetchElevenLabsTts({}, text);
  assert.equal(result.response.ok, true);
  assert.equal(await result.response.text(), text);
  assert.ok(supplied.length > 1);
  assert.equal(supplied.join(''), text);
});

test('the actual speech provider request is aborted when playback stops between chunks', async () => {
  let calls = 0;
  let aborted = false;
  let started;
  const pendingStarted = new Promise((resolve) => { started = resolve; });
  const context = ttsFixture(async (_, init) => {
    if (++calls === 1) return new Response('first audio');
    return new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Stopped', 'AbortError'));
      }, { once: true });
      started();
    });
  });
  const result = await context.fetchElevenLabsTts({}, 'A detailed explanation. '.repeat(150));
  const reader = result.response.body.getReader();
  await reader.read();
  await pendingStarted;
  await reader.cancel();
  assert.equal(aborted, true);
});
