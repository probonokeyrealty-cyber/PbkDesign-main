import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { classifyAvaLiveObjectionV2 } from './ava-live-turn-contract.mjs';
import { summarizePhoneTurnTiming } from './ava-phone-latency.mjs';

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

const streamTimingAssignment = source.match(
  /^\s*if \(.*\) requestPayload\.stream_establish_before_call_originate = true;$/m,
)?.[0];
assert.ok(streamTimingAssignment, 'The outbound dial command configures stream timing');
for (const [defaultTiming, perCallTiming, expected] of [
  [true, undefined, true],
  [false, undefined, undefined],
  [true, false, undefined],
  [false, true, true],
  [true, 'false', true],
]) {
  const requestPayload = {};
  vm.runInNewContext(streamTimingAssignment, {
    TELNYX_STREAM_ESTABLISH_BEFORE_ORIGINATE: defaultTiming,
    params: { streamEstablishBeforeCallOriginate: perCallTiming },
    requestPayload,
  });
  assert.equal(requestPayload.stream_establish_before_call_originate, expected);
}

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
const mediaStart = sourceBetween("    if (event.event === 'start')", "    if (event.event === 'media' && event.media?.payload)", 'async function handleTelnyxDeepgramMediaSocket(');
assert.match(mediaStart, /session\.telnyxMediaCodec = normalizeTelnyxMediaCodec\([\s\S]*?\);\s*void openTelnyxDeepgram\(\)/,
  'Deepgram must wait for the codec announced by the Telnyx start frame');
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
  DEEPGRAM_STREAM_CODEC: 'PCMU',
  ELEVENLABS_TELNYX_TTS_STALE_MS: 12000, telnyxAvaTurnLocksByCallId: locks,
  isoNow: () => new Date(clock + 20).toISOString(),
  isCurrentTelnyxMediaSession: () => true,
  getTelnyxAvaTurnLockKey: (item) => item.callId,
  getActiveTelnyxAvaTurnLock: (item) => locks.get(item.callId),
  recordCallTrace: noop, rememberTelnyxMediaFrame: noop,
  sendOrBufferTelnyxMediaFrame: (frame) => forwarded.push(frame), scheduleNoTranscriptFallback: noop,
});
vm.runInContext(sourceBetween('function decodeMulawByteToLinear16(', 'function getTelnyxDeepgramLiveModel('), runtime);
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

const fallbackTimers = [];
Object.assign(runtime, {
  console: { log: noop }, state: {}, addActivity: noop, makeActivity: noop,
  persistStateInBackground: noop, syncTelnyxSessionToRedis: async () => {},
  DEEPGRAM_STREAM_CODEC: 'PCMU', TELNYX_DEEPGRAM_NO_TRANSCRIPT_FALLBACK_MS: 4500,
  setTimeout: (callback, delay) => fallbackTimers.push({ callback, delay }),
  rotateTelnyxDeepgramToLinear16Fallback: noop,
});
vm.runInContext('let noTranscriptFallbackTimer = null;\n' +
  sourceBetween('  const scheduleNoTranscriptFallback =', '  liveTelnyxMessageHandler = (raw) =>', 'async function handleTelnyxDeepgramMediaSocket(') +
  '\nglobalThis.scheduleNoTranscriptFallback = scheduleNoTranscriptFallback;', runtime);
session.deepgramSignalFrames = 0;
const receiveMulaw = (byte) => runtime.receiveMedia({
  event: 'media', media: { payload: Buffer.alloc(160, byte).toString('base64') },
});
for (let frame = 0; frame < 300; frame++) receiveMulaw(frame % 2 ? 0xff : 0x7f);
assert.equal(fallbackTimers.length, 0, 'Silent G.711 media must not start the Deepgram fallback timer');
for (let frame = 0; frame < 5; frame++) receiveMulaw(0xa5);
assert.equal(fallbackTimers.length, 1, 'Sustained audio signal must start the Deepgram fallback timer');
assert.equal(fallbackTimers[0].delay, 4500);

const scheduled = [];
Object.assign(runtime, {
  console: { log: noop }, state: {}, addActivity: noop, makeActivity: noop,
  persistStateInBackground: noop, clearNoTranscriptFallbackTimer: noop,
  clearPendingTelnyxFinalOnlyReply: noop,
  markTelnyxSellerTranscriptVersion: () => ++session.sellerTranscriptVersion,
  normalizeDeepgramLiveSentiment: () => ({ pbkScore: null }),
  isWeakTelnyxSellerUtterance: () => false,
  extractLikelyCallerNameOnlyUtterance: noop, isAvaLiveAuthorityQuestion: noop,
  isAffirmativeAvaAuthorityAnswer: noop, shouldSkipTelnyxLiveAckOnlyReply: noop,
  isTelnyxLiveAudioCheckUtterance: noop, isTelnyxLiveGreetingOnlyUtterance: noop,
  expandAvaLiveOptionLetterAnswer: noop,
  syncTelnyxSessionToRedis: async () => {}, getCallById: () => null,
  scheduleTelnyxAvaReplyForTranscript: (item) => scheduled.push(item),
});
vm.runInContext(sourceBetween('function normalizeDeepgramLiveTranscript(', 'const browserVoiceSessions'), runtime);
vm.runInContext(sourceBetween('function normalizeTelnyxRepairTranscript(', 'function isTelnyxLiveAudioCheckUtterance('), runtime);
runtime.clearPendingTelnyxFinalOnlyReply = noop;
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

const committedVersion = session.sellerTranscriptVersion;
const scheduledBeforeFragments = scheduled.length;
runtime.isWeakTelnyxSellerUtterance = (text) => /^yeah\.?$/i.test(text);
runtime.receiveSpeech({ type: 'Results', transcript: 'an incomplete guess', is_final: false });
runtime.receiveSpeech({ type: 'Results', transcript: 'Yeah.', is_final: true, speech_final: true });
assert.equal(session.sellerTranscriptVersion, committedVersion, 'Interim and weak final fragments must preserve the committed reply version');
assert.equal(scheduled.length, scheduledBeforeFragments, 'Fragments must not replace the pending reply');
runtime.receiveSpeech({ type: 'Results', transcript: 'Stop contacting me.', is_final: true, speech_final: true });
assert.equal(session.sellerTranscriptVersion, committedVersion + 1, 'A committed stop-contact turn must supersede speech in progress');
assert.equal(scheduled.at(-1).transcript, 'Stop contacting me.');

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

Object.assign(runtime, {
  normalizeBantInfo: () => ({}), deriveLiveBantFactsFromSession: noop, extractBantFromTranscript: noop,
  inferAvaDealPathDecision: () => ({}), applyAvaPathDecisionToSession: noop, getMissingBantFields: () => [],
  upsertCall: noop, recordBantSessionForLiveCall: async () => {}, scheduleRuntimeStateBroadcast: noop,
  classifyAvaLiveObjectionV2,
});
const outboundGreeting = sourceBetween('    if (shouldPlayOutboundGreeting) {', '      call.outboundAvaGreetingSpoken');
let greetingSpoken;
await vm.runInNewContext(
  '(async () => { let outboundGreetingResult; ' + outboundGreeting + ' } })()',
  {
    shouldPlayOutboundGreeting: true,
    payload: { greeting: 'What repairs does it need?' },
    call: { telnyxCallControlId: 'fictional-call' },
    speakAvaPhoneReplyByCallId: (_id, text) => { greetingSpoken = text; return { ok: true }; },
  }
);
assert.equal(greetingSpoken, 'Hi, this is Ava with Probono Key Realty. I am calling about the property.',
  'The carrier answer event cannot verify a human picked up, so use an introduction without questions');

runtime.finalized = false;
const scheduledBeforeVoicemail = scheduled.length;
let canceledFinalOnlyRetries = 0;
let heldVoicemailPrefix;
runtime.clearPendingTelnyxFinalOnlyReply = () => {
  canceledFinalOnlyRetries += 1;
  heldVoicemailPrefix = undefined;
};
runtime.scheduleTelnyxAvaReplyForTranscript = (item) => {
  if (item.possibleVoicemailPrefix) {
    assert.equal(item.speechFinal, false);
    heldVoicemailPrefix = item;
  } else {
    scheduled.push(item);
  }
};
const voicemailCases = [
  ['Has been forwarded to voice mail.', 'The person you are trying to reach is unavailable.', 'Please record your message.'],
  ['At the tone,', 'please leave your message.'],
  ['Your call is being forwarded to an automated voice messaging system.'],
  ['Your call has been forwarded to an automatic voice message system.'],
  ['The mailbox is full and cannot accept any messages at this time.'],
  ["Hi, you've reached the Rivera household.", 'Please leave a message after the beep.'],
  ["Hi, you've reached the Rivera household. Please leave a message."],
  ['The person you’re trying to reach', 'is not available.'],
];
const committedSpeech = (transcript) =>
  runtime.receiveSpeech({ type: 'Results', transcript, is_final: true, speech_final: true });
for (const fragments of voicemailCases) {
  const voicemailSession = { callId: 'fictional-voicemail', transcript: [], sellerTranscriptVersion: 1 };
  runtime.session = voicemailSession;
  let savedCall = { id: voicemailSession.callId, direction: 'Outbound' };
  runtime.getCallById = () => savedCall;
  runtime.upsertCall = (_state, call) => { savedCall = call; };
  let sellerFacts = 0;
  runtime.applyAvaLiveTurnFacts = () => { sellerFacts += 1; };
  for (const fragment of fragments) committedSpeech(fragment);
  assert.equal(voicemailSession.outboundVoicemailDetected, true, fragments.join(' '));
  assert.equal(heldVoicemailPrefix, undefined, 'The completed voicemail greeting cancels the held turn');
  assert.equal(savedCall.outboundVoicemailDetected, true, 'The call must retain voicemail detection');
  assert.equal(sellerFacts, 0, 'Carrier speech must stay out of seller facts');
  committedSpeech('Thank you for calling.');
  assert.equal(sellerFacts, 0, 'Later voicemail fragments must stay out of seller facts');
  assert.equal(runtime.isTelnyxTtsReplyStale(voicemailSession, { replyTurnVersion: 1 }).result,
    'voicemail_detected', 'A reply already in flight must be dropped');
  assert.equal(voicemailSession.transcript.at(-1).speaker, 'Voicemail');
  runtime.session = { callId: savedCall.id, transcript: [] };
  committedSpeech('Thank you for calling.');
  assert.equal(runtime.session.outboundVoicemailDetected, true, 'A replacement stream restores detection from the saved call');
}
assert.equal(scheduled.length, scheduledBeforeVoicemail, 'Voicemail must never schedule a seller question');
assert.ok(canceledFinalOnlyRetries >= voicemailCases.length, 'Voicemail cancels pending final-only replies');

runtime.upsertCall = noop;
runtime.session = { callId: 'fictional-seller', transcript: [], sellerTranscriptVersion: 0 };
runtime.getCallById = () => ({ direction: 'outbound' });
runtime.receiveSpeech({ type: 'Results', transcript: 'Your call has been forwarded to voicemail.' });
assert.equal(runtime.session.outboundVoicemailDetected, undefined, 'An interim ASR guess cannot latch voicemail');
committedSpeech('I heard your voicemail. I own the house.');
assert.equal(scheduled.at(-1).transcript, 'I heard your voicemail. I own the house.');
committedSpeech('Please stop calling. Do not leave me a voicemail.');
assert.equal(scheduled.at(-1).transcript, 'Please stop calling. Do not leave me a voicemail.');
committedSpeech('Do not call me again. Please leave a message after the beep.');
assert.equal(scheduled.at(-1).transcript, 'Do not call me again. Please leave a message after the beep.');
committedSpeech("I'm the owner, but please leave a message.");
assert.equal(scheduled.at(-1).transcript, "I'm the owner, but please leave a message.");
assert.notEqual(runtime.session.outboundVoicemailDetected, true);
committedSpeech("Hi, you've reached Maria.");
assert.equal(heldVoicemailPrefix?.transcript, "Hi, you've reached Maria.", 'An ambiguous personal greeting has a bounded fallback');
committedSpeech("The person you're trying to reach");
committedSpeech('is my sister. I can help with the property.');
assert.equal(scheduled.at(-1).transcript, 'is my sister. I can help with the property.');
assert.notEqual(runtime.session.outboundVoicemailDetected, true, 'An ambiguous prefix must resolve as live when the next fragment differs');
runtime.session.lastAvaReplySpoken = 'What is the property address?';
committedSpeech('Please leave a message.');
assert.notEqual(runtime.session.outboundVoicemailDetected, true, 'A request to leave a message during a live dialogue is ambiguous');
committedSpeech('Please stop calling.');
assert.equal(scheduled.at(-1).transcript, 'Please stop calling.');
runtime.getCallById = () => ({ direction: 'inbound' });
committedSpeech('Please leave a message.');
assert.equal(scheduled.at(-1).transcript, 'Please leave a message.');
assert.notEqual(runtime.session.outboundVoicemailDetected, true, 'Inbound calls retain their existing behavior');
runtime.session = session;

let prefixTimer;
const releasedTurns = [];
const replyScheduler = vm.createContext({
  session: { sellerTranscriptVersion: 3 }, finalized: false, telnyxPendingFinalReplyItem: null,
  telnyxFinalOnlyReplyTimer: null, TELNYX_BRIDGE_AVA_FINAL_ONLY_REPLY_DELAY_MS: 950,
  setTimeout: (callback, delay) => { prefixTimer = { callback, delay }; return 1; },
  clearTimeout: () => { prefixTimer = undefined; },
  maybeSpeakTelnyxAvaReply: (item) => releasedTurns.push(item),
});
vm.runInContext(sourceBetween('  const clearPendingTelnyxFinalOnlyReply =', '  const queueTelnyxAvaReplyRetry =') +
  '\nglobalThis.scheduleReply = scheduleTelnyxAvaReplyForTranscript;', replyScheduler);
replyScheduler.scheduleReply({
  transcript: "Hello, you've reached Morgan.", turnVersion: 3,
  isFinal: true, speechFinal: false, possibleVoicemailPrefix: true,
});
assert.ok(prefixTimer.delay > 950 && prefixTimer.delay < 5000, 'Allow time for a split greeting while keeping live callers moving');
assert.equal(releasedTurns.length, 0, 'Withhold the reply while a split greeting could still be completed');
prefixTimer.callback();
assert.equal(releasedTurns.at(-1)?.finalOnlyFallback, true, 'Release an ambiguous turn if no further evidence arrives');

const voicemailAudio = vm.createContext({});
vm.runInContext(sourceBetween('async function sendAvaPhoneReplyAudio(', 'async function speakAvaPhoneReplyByCallId('), voicemailAudio);
const skippedVoicemailAudio = await voicemailAudio.sendAvaPhoneReplyAudio(
  { outboundVoicemailDetected: true },
  'What is the property address?'
);
assert.equal(skippedVoicemailAudio.result, 'voicemail_detected', 'Detected voicemail must exit before any TTS or phone fallback');

let audioOptions;
runtime.sendAvaPhoneReplyAudio = async (_session, _text, options) => { audioOptions = options; return { ok: true }; };
runtime.summarizePhoneTurnTiming = summarizePhoneTurnTiming;
await vm.runInContext(`(async () => {
  const replyTurnVersion = 1, replyStartAt = ${clock}, spoken = 'Test reply';
  const phoneTurnTiming = { sttFinalReceivedAt: ${clock} };
  const item = { transcript: 'Test seller' }, transcriptForReply = '';
${sourceBetween('    const speakResult = await sendAvaPhoneReplyAudio(session, spoken, {', '    const turnCompletionMs')}
})()`, runtime);
assert.equal(audioOptions.replyStartedAt, clock, 'TTS must receive the defined reply-start timestamp');

const persistenceWarnings = [];
runtime.console.warn = (...message) => persistenceWarnings.push(message);
runtime.persistState = async () => { throw new Error('postgres_state_persist_required'); };
const beforePhoneOps = source.lastIndexOf('    await persistState(state)', source.indexOf("    const phoneOps = bindAgentTimingToParams({ agentName: 'Ava', toolName: 'phone_reply'"));
const phoneOpsStart = source.indexOf('    const phoneOps =', beforePhoneOps);
assert.ok(beforePhoneOps >= 0 && phoneOpsStart > beforePhoneOps);
await assert.doesNotReject(vm.runInContext(`(async () => { ${source.slice(beforePhoneOps, phoneOpsStart)} })()`, runtime),
  'A database disconnect after Ava sends audio must not reject the detached reply task');
assert.equal(persistenceWarnings.length, 1, 'A failed post-reply write still produces a warning');

const latencyStatusSaves = [];
runtime.recordAvaResponseLatencyStatus = noop;
runtime.getPgPool = () => null;
runtime.persistStateInBackground = (context) => latencyStatusSaves.push(context);
vm.runInContext(sourceBetween('async function recordPbkTurnLatency(', 'async function publishPbkEvent('), runtime);
const unavailableLatency = await runtime.recordPbkTurnLatency();
assert.equal(unavailableLatency.reason, 'postgres_unavailable');
assert.deepEqual(latencyStatusSaves, ['PBK turn latency status']);

const snapshots = [];
const fastSocket = { readyState: 1, bufferedAmount: 0, send: (data) => snapshots.push(data) };
const slowSnapshots = [];
const slowSocket = { readyState: 1, bufferedAmount: 1024, send: (data) => slowSnapshots.push(data) };
let retrySnapshot;
let snapshotId = 'fixture';
const broadcastRuntime = vm.createContext({
  runtimeBrowserSockets: new Set([fastSocket, slowSocket]), isoNow: () => new Date(clock).toISOString(),
  pendingRuntimeSnapshotSockets: new Set(), runtimeBroadcastRetryTimer: null,
  buildStateSnapshot: () => ({ approvals: [{ id: snapshotId }] }),
  setTimeout: (callback) => { retrySnapshot = callback; return 1; },
});
vm.runInContext(sourceBetween('function sendRuntimeSocketMessage(', 'function pruneRuntimeBrowserSessions('), broadcastRuntime);
vm.runInContext(sourceBetween('function broadcastRuntimeState(', 'function scheduleRuntimeStateBroadcast('), broadcastRuntime);
broadcastRuntime.broadcastRuntimeState('test');
assert.equal(JSON.parse(snapshots[0]).snapshot.approvals[0].id, 'fixture');
assert.equal(snapshots.length, 1);
assert.equal(slowSnapshots.length, 0, 'A slow dashboard must not queue another snapshot');
slowSocket.bufferedAmount = 0;
snapshotId = 'latest';
retrySnapshot();
assert.equal(JSON.parse(slowSnapshots[0]).snapshot.approvals[0].id, 'latest');
assert.equal(snapshots.length, 1, 'Slow-client retries must not duplicate sends to ready dashboards');

const dbJsonRuntime = vm.createContext({});
vm.runInContext(sourceBetween('function sanitizeJsonForPostgres(', 'function sleep('), dbJsonRuntime);
const stateFixture = vm.runInContext('({calls:[{id:"fixture",transcript:"hello"}]})', dbJsonRuntime);
assert.equal(dbJsonRuntime.sanitizeJsonForPostgres(stateFixture), stateFixture, 'Clean snapshots must not be deep copied');
assert.equal(dbJsonRuntime.postgresJsonStringify({ 'n\u0000ote': 'a\u0000b', total: 2n }), '{"note":"ab","total":"2"}');

console.log(`Ava live-call resilience smoke passed (${checks.length} structural checks; silence, speech/final barge-in, session guards, fictional voicemail, and reply timing).`);
