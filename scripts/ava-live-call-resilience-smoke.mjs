import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const bridgePath = path.join(repoRoot, 'scripts', 'openclaw-local-server.mjs');
const source = readFileSync(bridgePath, 'utf8');

const checks = [
  {
    name: 'live spoken replies use guardAvaResponse before phone audio',
    pass:
      /import\s+\{\s*guardAvaResponse\s*\}\s+from\s+['"]\.\/ava-response-guard\.mjs['"]/.test(source) &&
      /function\s+guardTelnyxLiveSpokenReply\s*\(/.test(source) &&
      /guardTelnyxLiveSpokenReply\([^)]*\)/.test(source),
  },
  {
    name: 'ElevenLabs Telnyx TTS has timeout and stale-turn protection',
    pass:
      /ELEVENLABS_TELNYX_TTS_TIMEOUT_MS/.test(source) &&
      /AbortController/.test(source) &&
      /isTelnyxTtsReplyStale\s*\(/.test(source) &&
      /stale_seller_turn_before_media_send/.test(source),
  },
  {
    name: 'Telnyx media path can clear buffered playback for barge-in',
    pass:
      /function\s+sendTelnyxMediaClearCommand\s*\(/.test(source) &&
      /event:\s*['"]clear['"]/.test(source) &&
      /sendTelnyxMediaClearCommand\(session/.test(source),
  },
  {
    name: 'seller turns blocked by active locks or cooldown are queued, not dropped',
    pass:
      /queueTelnyxAvaReplyRetry\s*\(/.test(source) &&
      /ava_turn_lock_active_queued/.test(source) &&
      /reply_cooldown_queued/.test(source),
  },
  {
    name: 'Deepgram mid-call close attempts reconnect even after prior transcript',
    pass:
      /function\s+reconnectTelnyxDeepgramAfterClose\s*\(/.test(source) &&
      /deepgram_socket_reconnect_start/.test(source) &&
      !/if\s*\(\s*finalized\s*\|\|\s*session\.deepgramFallbackActive\s*\|\|\s*session\.transcript\.length\s*>\s*0\s*\|\|\s*!session\.audioBytes\s*\)\s*return\s+false\s*;/.test(source),
  },
  {
    name: 'episodic memory labels are outcome-aware, not first-row winning labels',
    pass:
      /formatEpisodicMemoryLabel\s*\(/.test(source) &&
      !/index\s*===\s*0\s*\?\s*['"]Similar past winning call['"]/.test(source),
  },
  {
    name: 'BANT authority extraction requires real authority evidence',
    pass:
      /authorityEvidencePattern/.test(source) &&
      !/wife\|husband\|spouse\|partner\|attorney\|lawyer\|executor\|co-\?owner\|decision\|my client\|seller/.test(source),
  },
];

const failed = checks.filter((check) => !check.pass);

if (failed.length) {
  console.error('Ava live-call resilience smoke failed:');
  for (const check of failed) console.error(`- ${check.name}`);
  process.exit(1);
}

function sourceBetween(startMarker, endMarker, afterMarker = '') {
  const after = afterMarker ? source.indexOf(afterMarker) : 0;
  assert.ok(after >= 0, `Missing source section: ${afterMarker}`);
  const start = source.indexOf(startMarker, after);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing source section: ${startMarker}`);
  return source.slice(start, end);
}

const clock = Date.now();
const sent = [];
const forwarded = [];
const locks = new Map();
const session = {
  callId: 'silence-regression', streamId: 'test-stream', frameCount: 2, audioBytes: 0,
  sellerTranscriptVersion: 1, transcript: [], deepgramEventCount: 0,
  telnyxMediaSocket: { readyState: 1, send: (message) => sent.push(JSON.parse(message)) },
};
const activeLock = { reason: 'ava_reply_sending', untilMs: clock + 10000, remainingMs: 10000 };
locks.set(session.callId, activeLock);
const noop = () => {};
const runtime = vm.createContext({
  session, Buffer, WebSocket: { OPEN: 1 }, finalized: false,
  ELEVENLABS_TELNYX_TTS_STALE_MS: 12000, telnyxAvaTurnLocksByCallId: locks,
  isoNow: () => new Date(clock + 20).toISOString(),
  isCurrentTelnyxMediaSession: () => true,
  getTelnyxAvaTurnLockKey: (item) => item.callId,
  getActiveTelnyxAvaTurnLock: (item) => locks.get(item.callId),
  recordCallTrace: noop, rememberTelnyxMediaFrame: noop,
  sendOrBufferTelnyxMediaFrame: (frame) => forwarded.push(frame), scheduleNoTranscriptFallback: noop,
});
vm.runInContext(sourceBetween('function sendTelnyxMediaClearCommand(', 'async function sendElevenLabsTtsToTelnyxMediaStream('), runtime);
vm.runInContext(`function receiveMedia(event) {
${sourceBetween("    if (event.event === 'media' && event.media?.payload) {", "    if (event.event === 'stop')", 'async function handleTelnyxDeepgramMediaSocket(')}
}`, runtime);

for (const reason of ['ava_reply_sending', 'ava_speaking', 'ava_reply_attempted']) {
  activeLock.reason = reason;
  for (const silenceByte of [0xff, 0x00]) {
    runtime.receiveMedia({ event: 'media', media: { payload: Buffer.alloc(160, silenceByte).toString('base64') } });
  }
  assert.equal(sent.length, 0, 'Silence media frames must not clear Ava playback');
  assert.equal(locks.get(session.callId), activeLock, 'Silence must preserve the playback lock');
  assert.equal(session.lastCallerAudioDuringAvaAt, undefined, 'Raw media is not speech evidence');
  assert.equal(runtime.isTelnyxTtsReplyStale(session, { replyTurnVersion: 1, replyStartedAt: clock }).stale, false);
}
assert.equal(session.audioBytes, 6 * 160, 'Silence must still flow through the audio path');
assert.equal(forwarded.length, 6, 'Silence frames must still be forwarded for transcription');

const scheduled = [];
Object.assign(runtime, {
  console: { log: noop }, state: {}, addActivity: noop, makeActivity: noop,
  persistStateInBackground: noop, clearNoTranscriptFallbackTimer: noop,
  clearPendingTelnyxFinalOnlyReply: noop,
  markTelnyxSellerTranscriptVersion: () => ++session.sellerTranscriptVersion,
  normalizeDeepgramLiveSentiment: () => ({ pbkScore: null }),
  isWeakTelnyxSellerUtterance: () => false,
  syncTelnyxSessionToRedis: async () => {}, getCallById: () => null,
  scheduleTelnyxAvaReplyForTranscript: (item) => scheduled.push(item),
});
vm.runInContext(sourceBetween('function normalizeDeepgramLiveTranscript(', 'const browserVoiceSessions'), runtime);
vm.runInContext(sourceBetween('  const noteTelnyxCallerSpeechDuringAva =', '  const flushPendingTelnyxMediaFrames =') +
  '\nglobalThis.receiveSpeech = handleTelnyxDeepgramMessage;', runtime);
runtime.receiveSpeech({ type: 'Metadata' });
runtime.receiveSpeech({ type: 'Results', transcript: '   ', is_final: true, speech_final: true });
assert.equal(sent.length, 0, 'Metadata and empty final transcripts are not speech evidence');

for (const type of ['SpeechStarted', 'speech_start', 'speech_started']) {
  locks.set(session.callId, activeLock);
  delete session.lastTelnyxMediaClearAt;
  const before = sent.length;
  runtime.receiveSpeech({ type });
  assert.equal(sent.length, before + 1, `${type} must interrupt active playback`);
  assert.equal(sent.at(-1).event, 'clear');
  assert.equal(sent.at(-1).stream_id, session.streamId);
  assert.equal(locks.has(session.callId), false);
  assert.equal(runtime.isTelnyxTtsReplyStale(session, { replyTurnVersion: 1, replyStartedAt: clock }).result,
    'caller_barge_in_before_media_send');
  runtime.receiveSpeech({ type });
  assert.equal(sent.length, before + 1, 'Repeated speech events without playback must not clear again');
}

locks.set(session.callId, activeLock);
delete session.lastTelnyxMediaClearAt;
const beforeFinal = sent.length;
runtime.receiveSpeech({ type: 'Results', transcript: 'Wait a moment', is_final: true, speech_final: true });
assert.equal(sent.length, beforeFinal + 1, 'A nonempty final transcript must interrupt without a speech-start event');
assert.equal(scheduled.at(-1).transcript, 'Wait a moment', 'Final transcript reply scheduling must remain intact');

locks.set(session.callId, activeLock);
delete session.lastTelnyxMediaClearAt;
const beforeSuppressed = sent.length;
session.avaReplySuppressed = true;
runtime.receiveSpeech({ type: 'SpeechStarted' });
session.avaReplySuppressed = false;
runtime.isCurrentTelnyxMediaSession = () => false;
runtime.receiveSpeech({ type: 'SpeechStarted' });
runtime.isCurrentTelnyxMediaSession = () => true;
runtime.finalized = true;
runtime.receiveSpeech({ type: 'SpeechStarted' });
assert.equal(sent.length, beforeSuppressed, 'Suppressed, replaced, or finalized sessions must not clear playback');

let audioOptions;
runtime.sendAvaPhoneReplyAudio = async (_session, _text, options) => { audioOptions = options; return { ok: true }; };
await vm.runInContext(`(async () => {
  const replyTurnVersion = 1, replyStartAt = ${clock}, spoken = 'Test reply';
  const item = { transcript: 'Test seller' }, transcriptForReply = '';
${sourceBetween('    const speakResult = await sendAvaPhoneReplyAudio(session, spoken, {', '    const turnCompletionMs')}
})()`, runtime);
assert.equal(audioOptions.replyStartedAt, clock, 'TTS must receive the defined reply-start timestamp');

console.log(`Ava live-call resilience smoke passed (${checks.length} structural checks; silence, speech/final barge-in, session guards, and reply timing).`);
