#!/usr/bin/env node

const DEFAULT_BRIDGE_URL = 'https://pbk-openclaw-bridge.onrender.com';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (!item.startsWith('--')) continue;
  const [rawKey, inlineValue] = item.slice(2).split('=');
  const nextValue = inlineValue ?? (process.argv[index + 1]?.startsWith('--') ? undefined : process.argv[index + 1]);
  args.set(rawKey, nextValue ?? 'true');
  if (inlineValue === undefined && nextValue && !nextValue.startsWith('--')) index += 1;
}

const bridgeUrl = String(process.env.PBK_BRIDGE_URL || args.get('bridge') || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
const apiKey = String(process.env.PBK_BRIDGE_API_KEY || args.get('key') || '').trim();
const minutes = Math.max(1, Math.min(30, Number(args.get('minutes') || args.get('m') || 8)));
const intervalMs = Math.max(2500, Math.min(15000, Number(args.get('intervalMs') || 5000)));
const pollTimeoutMs = Math.max(5000, Math.min(30000, Number(args.get('timeoutMs') || 10000)));
const preflight = /^(1|true|yes|on)$/i.test(String(args.get('preflight') || process.env.PBK_TELNYX_WATCH_PREFLIGHT || '').trim());
const includeLegacy = !preflight || /^(1|true|yes|on)$/i.test(String(args.get('includeLegacy') || '').trim());
const startedAt = new Date().toISOString();
const stopAtMs = Date.now() + minutes * 60 * 1000;
const seen = new Set();

if (!apiKey) {
  console.error('Set PBK_BRIDGE_API_KEY before running the live Telnyx watcher.');
  process.exit(2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(pathname, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${bridgeUrl}${pathname}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

function recordTime(record = {}) {
  return String(record.updatedAt || record.createdAt || record.timestamp || '');
}

function isFresh(record = {}) {
  const time = recordTime(record);
  return time && time >= startedAt;
}

function summarizeMessage(message = {}) {
  const transcript = message.text
    || message.transcript
    || message.body
    || message.summary
    || message.payload?.transcript
    || message.deepgram?.transcript
    || '';
  const deepgram = message.deepgram || message.metadata?.deepgram || message.payload?.deepgram || {};
  return {
    id: message.id,
    time: recordTime(message),
    status: message.status || message.result || 'unknown',
    kind: message.kind || message.type || 'message',
    frames: deepgram.frameCount ?? deepgram.frames ?? message.frameCount ?? '',
    bytes: deepgram.audioBytes ?? deepgram.bytes ?? message.audioBytes ?? '',
    fallback: deepgram.fallbackActive ?? message.fallbackActive ?? '',
    fallbackReason: deepgram.fallbackReason ?? message.fallbackReason ?? '',
    replayedFrameCount: deepgram.replayedFrameCount ?? message.replayedFrameCount ?? '',
    transcript: String(transcript || '').slice(0, 160),
  };
}

function summarizeCall(call = {}) {
  const transcript = Array.isArray(call.transcript)
    ? call.transcript.map((item) => item.text || item.transcript || '').filter(Boolean).join(' ')
    : call.transcriptText || call.transcript || '';
  return {
    id: call.id,
    time: recordTime(call),
    status: call.status || 'unknown',
    direction: call.direction || '',
    provider: call.provider || '',
    leadName: call.leadName || call.name || '',
    transcriptCount: call.transcriptCount ?? (Array.isArray(call.transcript) ? call.transcript.length : ''),
    transcript: String(transcript || '').slice(0, 160),
  };
}

function hasWords(summary = {}) {
  return Boolean(String(summary.transcript || '').trim());
}

function summarizeLiveMediaSession(session = {}) {
  const bantStatus = session.bantStatus || {};
  const pathDecision = session.pathDecision || {};
  return {
    callId: session.callId || '',
    streamId: session.streamId || '',
    leadName: session.leadName || '',
    phone: session.phone || '',
    frameCount: session.frameCount || 0,
    audioBytes: session.audioBytes || 0,
    deepgramSocketOpen: Boolean(session.deepgramSocketOpen ?? session.deepgramReady),
    lastDeepgramEvent: session.lastDeepgramEvent || '',
    lastDeepgramError: session.lastDeepgramError || '',
    lastTranscript: String(session.lastTranscript || '').slice(0, 180),
    lastAvaPreview: String(session.lastAvaPreview || '').slice(0, 220),
    lastAvaSpoken: String(session.lastAvaSpoken || session.lastAvaResponse || '').slice(0, 220),
    selectedPath: session.selectedPath || pathDecision.selectedPath || '',
    identifiedPath: session.identifiedPath || '',
    pathLocked: Boolean(session.pathLocked || pathDecision.pathLocked),
    bantComplete: Boolean(bantStatus.complete),
    bantMissing: Array.isArray(bantStatus.missing) ? bantStatus.missing.join(',') : '',
    prosodyProfile: session.prosody?.profile || session.prosody?.mode || '',
    waitingForSeller: Boolean(session.waitingForSeller),
    responseRequired: Boolean(session.responseRequired),
    lastRedisSyncResult: session.lastRedisSyncResult || '',
  };
}

function liveStatusFingerprint(status = {}) {
  const sessions = Array.isArray(status.activeMediaSessions) ? status.activeMediaSessions : [];
  return JSON.stringify({
    mediaStreamsOpen: status.mediaStreamsOpen || 0,
    sharedMediaStreamsOpen: status.sharedMediaStreamsOpen || 0,
    sessions: sessions.map((session) => summarizeLiveMediaSession(session)),
  });
}

async function main() {
  console.log(JSON.stringify({
    ok: true,
    result: 'telnyx_live_call_watch_started',
    bridgeUrl,
    startedAt,
    minutes,
    intervalMs,
    pollTimeoutMs,
    preflight,
    instruction: preflight
      ? 'Preflight mode: verifying the hosted live-call diagnostics are reachable and idle. No call is required.'
      : 'Place one inbound call now, speak a full sentence, then watch mediaStreamsOpen, deepgramSocketOpen, lastTranscript, lastAvaPreview, lastAvaSpoken, BANT, and path lock.',
  }, null, 2));

  const health = await fetchJson('/api/deepgram/health', { timeoutMs: 30000 });
  console.log(JSON.stringify({
    result: 'deepgram_health',
    status: health.status,
    ok: health.ok,
    ready: health.data?.ready,
    telnyxLiveModel: health.data?.telnyxLiveModel,
    telnyxLiveOptions: health.data?.telnyxLiveOptions,
    telnyxLinear16FallbackMs: health.data?.telnyxLinear16FallbackMs,
    telnyxRecentFrameReplayLimit: health.data?.telnyxRecentFrameReplayLimit,
    telnyxBridgeAvaReplyEnabled: health.data?.telnyxBridgeAvaReplyEnabled,
    telnyxHostedAiAssistantAutoStart: health.data?.telnyxHostedAiAssistantAutoStart,
  }, null, 2));

  let sawFreshCall = false;
  let sawFreshMessage = false;
  let sawTranscript = false;
  let sawActiveMedia = false;
  let sawDeepgramOpen = false;
  let sawAvaReply = false;
  let lastLiveStatusFingerprint = '';

  while (Date.now() < stopAtMs) {
    const legacyMessageFetch = includeLegacy
      ? fetchJson('/api/messages?limit=25', { timeoutMs: pollTimeoutMs })
      : Promise.resolve({ ok: true, status: 200, data: { messages: [] }, skipped: true });
    const legacyCallFetch = includeLegacy
      ? fetchJson('/api/calls?limit=25', { timeoutMs: pollTimeoutMs })
      : Promise.resolve({ ok: true, status: 200, data: { calls: [] }, skipped: true });
    const [liveStatusResult, messagesResult, callsResult] = await Promise.allSettled([
      fetchJson('/api/debug/live-call-status', { timeoutMs: pollTimeoutMs }),
      legacyMessageFetch,
      legacyCallFetch,
    ]);

    if (liveStatusResult.status === 'fulfilled' && liveStatusResult.value.ok) {
      const status = liveStatusResult.value.data || {};
      const fingerprint = liveStatusFingerprint(status);
      const sessions = Array.isArray(status.activeMediaSessions) ? status.activeMediaSessions : [];
      if (Number(status.mediaStreamsOpen || 0) > 0 || Number(status.sharedMediaStreamsOpen || 0) > 0) sawActiveMedia = true;
      for (const session of sessions) {
        if (session.deepgramSocketOpen || session.deepgramReady) sawDeepgramOpen = true;
        if (String(session.lastTranscript || '').trim()) sawTranscript = true;
        if (String(session.lastAvaPreview || session.lastAvaSpoken || session.lastAvaResponse || '').trim()) sawAvaReply = true;
      }
      if (fingerprint !== lastLiveStatusFingerprint) {
        lastLiveStatusFingerprint = fingerprint;
        console.log(JSON.stringify({
          result: 'live_call_status',
          generatedAt: status.generatedAt || '',
          mediaStreamsOpen: status.mediaStreamsOpen || 0,
          sharedMediaStreamsOpen: status.sharedMediaStreamsOpen || 0,
          sharedStateReady: Boolean(status.sharedState?.ready),
          activeCallsNote: status.activeCallsNote || '',
          activeMediaSessions: sessions.map((session) => summarizeLiveMediaSession(session)),
        }, null, 2));
      }
    } else if (liveStatusResult.status === 'fulfilled') {
      console.warn(JSON.stringify({ result: 'live_status_fetch_failed', status: liveStatusResult.value.status, data: liveStatusResult.value.data }, null, 2));
    } else {
      console.warn(JSON.stringify({ result: 'live_status_fetch_error', error: liveStatusResult.reason?.message || String(liveStatusResult.reason) }, null, 2));
    }

    if (messagesResult.status === 'fulfilled' && messagesResult.value.ok) {
      const messages = Array.isArray(messagesResult.value.data?.messages) ? messagesResult.value.data.messages : [];
      for (const message of messages.filter(isFresh)) {
        const key = `message:${message.id || recordTime(message)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const summary = summarizeMessage(message);
        sawFreshMessage = true;
        if (hasWords(summary)) sawTranscript = true;
        console.log(JSON.stringify({ result: 'fresh_message', ...summary }, null, 2));
      }
    } else if (messagesResult.status === 'fulfilled') {
      console.warn(JSON.stringify({ result: 'messages_fetch_failed', status: messagesResult.value.status, data: messagesResult.value.data }, null, 2));
    } else {
      console.warn(JSON.stringify({ result: 'messages_fetch_error', error: messagesResult.reason?.message || String(messagesResult.reason) }, null, 2));
    }

    if (callsResult.status === 'fulfilled' && callsResult.value.ok) {
      const calls = Array.isArray(callsResult.value.data?.calls) ? callsResult.value.data.calls : [];
      for (const call of calls.filter(isFresh)) {
        const key = `call:${call.id || recordTime(call)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const summary = summarizeCall(call);
        sawFreshCall = true;
        if (hasWords(summary)) sawTranscript = true;
        console.log(JSON.stringify({ result: 'fresh_call', ...summary }, null, 2));
      }
    } else if (callsResult.status === 'fulfilled') {
      console.warn(JSON.stringify({ result: 'calls_fetch_failed', status: callsResult.value.status, data: callsResult.value.data }, null, 2));
    } else {
      console.warn(JSON.stringify({ result: 'calls_fetch_error', error: callsResult.reason?.message || String(callsResult.reason) }, null, 2));
    }

    if (sawTranscript) break;
    await sleep(intervalMs);
  }

  const idleReady = preflight && !sawActiveMedia && !sawFreshCall && !sawFreshMessage && !sawTranscript;
  const ok = sawTranscript || idleReady;
  console.log(JSON.stringify({
    ok,
    result: sawTranscript
      ? 'telnyx_deepgram_transcript_observed'
      : idleReady
        ? 'telnyx_live_watch_idle_ready'
        : 'telnyx_deepgram_transcript_not_observed',
    startedAt,
    endedAt: new Date().toISOString(),
    sawActiveMedia,
    sawDeepgramOpen,
    sawFreshCall,
    sawFreshMessage,
    sawTranscript,
    sawAvaReply,
    nextStep: sawTranscript
      ? 'Ava heard the caller. If lastAvaPreview/lastAvaSpoken are empty, debug the intelligence/TTS layer; if populated, evaluate the response quality.'
      : idleReady
        ? 'Preflight passed. Now run without --preflight while placing a real call.'
      : sawActiveMedia && !sawDeepgramOpen
        ? 'Telnyx media opened but Deepgram did not. Check Deepgram key/model/network and live socket errors.'
        : sawDeepgramOpen
          ? 'Deepgram socket opened but no transcript arrived. Check Telnyx audio bytes/format and PCMU-to-linear16 fallback events.'
          : 'If you placed a call, verify Telnyx webhook/stream configuration because no active media session appeared.',
  }, null, 2));

  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    result: 'telnyx_live_call_watch_failed',
    error: error?.message || String(error),
  }, null, 2));
  process.exit(1);
});
