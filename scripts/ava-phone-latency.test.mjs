import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readPhoneTtsAudio, summarizePhoneTurnTiming } from './ava-phone-latency.mjs';

test('phone timing never promotes enqueue or provider acceptance to audible proof', () => {
  const timing = summarizePhoneTurnTiming({
    sttFinalReceivedAt: 1000, replyBuildStartedAt: 1020, replyBuildCompletedAt: 1200,
    ttsRequestedAt: 1250, ttsFirstAudioByteAt: 1400, ttsAudioReadyAt: 1600,
    mediaEnqueuedAt: 1610, fallbackAcceptedAt: 1700,
    transcript: 'must not escape', phone: 'must not escape',
  });
  assert.equal(timing.sttFinalToFirstAudioByteMs, 400);
  assert.equal(timing.replyBuildMs, 180);
  assert.equal(timing.ttsTimeToFirstAudioByteMs, 150);
  assert.equal(timing.sttFinalToMediaEnqueueMs, 610);
  assert.equal(timing.sellerSpeechEndAt, null);
  assert.equal(timing.telnyxPlaybackStartedAt, null);
  assert.equal(timing.endToEndAudibleLatencyMs, null);
  assert.equal(timing.livePhoneLatencyProven, false);
  assert.equal(JSON.stringify(timing).includes('must not escape'), false);
});

test('missing or reversed clocks remain unknown, never zero latency', () => {
  for (const start of [null, undefined, '', NaN, Infinity, -1, 0]) {
    assert.equal(summarizePhoneTurnTiming({ sttFinalReceivedAt: start, mediaEnqueuedAt: 20 }).sttFinalToMediaEnqueueMs, null);
  }
  assert.equal(summarizePhoneTurnTiming({ sttFinalReceivedAt: 30, mediaEnqueuedAt: 20 }).sttFinalToMediaEnqueueMs, null);
});

test('first nonempty TTS body bytes are observed before full buffer completion', async () => {
  const observations = [];
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array());
      controller.enqueue(Uint8Array.of(1, 2));
      controller.enqueue(Uint8Array.of(3));
      controller.close();
    },
  }));
  const audio = await readPhoneTtsAudio(response, () => observations.push('first'));
  observations.push('complete');
  assert.deepEqual([...audio], [1, 2, 3]);
  assert.deepEqual(observations, ['first', 'complete']);
});

test('empty audio and nonstream responses do not fabricate first-byte evidence', async () => {
  let first = 0;
  assert.equal((await readPhoneTtsAudio(new Response(null), () => first++)).length, 0);
  assert.deepEqual([...await readPhoneTtsAudio({ arrayBuffer: async () => Uint8Array.of(7).buffer }, () => first++)], [7]);
  assert.equal(first, 0);
});

test('TTS body failure is propagated rather than recorded as completed audio', async () => {
  await assert.rejects(readPhoneTtsAudio(new Response(new ReadableStream({
    start(controller) { controller.error(new Error('fixture failure')); },
  }))), /fixture failure/);
});

test('actual phone media function records first bytes and enqueue without claiming playback', async () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function sendElevenLabsTtsToTelnyxMediaStream(');
  const end = source.indexOf('\nasync function sendAvaPhoneReplyAudio(', start);
  assert.ok(start > 0 && end > start);
  const sent = [];
  let stale = false;
  const runtime = vm.createContext({
    Buffer, Date, readPhoneTtsAudio, process: { env: {} }, WebSocket: { OPEN: 1 },
    PBK_TELNYX_ELEVENLABS_MEDIA_REPLY_ENABLED: true, TELNYX_BIDIRECTIONAL_MEDIA_MODE: 'mp3',
    ELEVENLABS_TTS_ENABLED: true, ELEVENLABS_API_KEY: 'synthetic',
    TELNYX_ELEVENLABS_MEDIA_REPLY_MIN_MS: 0, TELNYX_ELEVENLABS_OUTPUT_FORMAT: 'mp3_44100_128',
    ELEVENLABS_TELNYX_TTS_TIMEOUT_MS: 1000,
    sanitizeAvaSpokenOutput: (text) => text, toNumber: Number,
    sleep: async () => {}, recordCallTrace: () => {}, recordElevenLabsValidation: () => {},
    isTelnyxTtsReplyStale: () => ({ stale, result: 'fixture_stale' }),
    fetchElevenLabsTts: async () => ({
      response: new Response(Uint8Array.of(1, 2, 3)), voiceId: 'fixture',
    }),
  });
  vm.runInContext(source.slice(start, end), runtime);
  const session = { streamId: 'fixture', telnyxMediaSocket: {
    readyState: 1, send: (message) => sent.push(JSON.parse(message)),
  } };
  const timing = {};
  const result = await runtime.sendElevenLabsTtsToTelnyxMediaStream(session, 'Synthetic test', { phoneTurnTiming: timing });
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.deepEqual([...Buffer.from(sent[0].media.payload, 'base64')], [1, 2, 3]);
  assert.ok(timing.ttsFirstAudioByteAt >= timing.ttsRequestedAt);
  assert.ok(timing.ttsAudioReadyAt >= timing.ttsFirstAudioByteAt);
  assert.ok(timing.mediaEnqueuedAt >= timing.ttsAudioReadyAt);
  assert.equal(summarizePhoneTurnTiming(timing).livePhoneLatencyProven, false);
  stale = true;
  const staleTiming = {};
  assert.equal((await runtime.sendElevenLabsTtsToTelnyxMediaStream(session, 'Synthetic test', { phoneTurnTiming: staleTiming })).ok, false);
  assert.equal(sent.length, 1, 'Stale audio must still not be sent');
  assert.equal(staleTiming.mediaEnqueuedAt, undefined);
});

test('actual latency trace survives the existing phone-redaction sanitizer', () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  let captured;
  const runtime = vm.createContext({
    summarizePhoneTurnTiming,
    maskPhoneForDiagnostics: () => '[masked]',
    phoneTurnTiming: { sttFinalReceivedAt: 1000, mediaEnqueuedAt: 1200 },
    session: { callId: 'fixture', streamId: 'fixture' }, replyTurnVersion: 1,
    speakResult: { ok: true, result: 'fixture' },
  });
  const sanitizerStart = source.indexOf('function sanitizeCallTraceDetails(');
  const sanitizerEnd = source.indexOf('\nasync function persistCallTraceToRedis(', sanitizerStart);
  vm.runInContext(source.slice(sanitizerStart, sanitizerEnd), runtime);
  runtime.recordCallTrace = (_event, details) => { captured = runtime.sanitizeCallTraceDetails(details); };
  const start = source.indexOf('    const phoneLatency = summarizePhoneTurnTiming(phoneTurnTiming);');
  const end = source.indexOf('    const turnCompletionMs', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), runtime);
  assert.equal(captured.turnTiming.sttFinalToMediaEnqueueMs, 200);
  assert.equal(captured.turnTiming.livePhoneLatencyProven, false);
  assert.equal(captured.turnTiming.telnyxPlaybackStartedAt, null);
});
