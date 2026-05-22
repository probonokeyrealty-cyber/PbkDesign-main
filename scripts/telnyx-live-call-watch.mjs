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

async function main() {
  console.log(JSON.stringify({
    ok: true,
    result: 'telnyx_live_call_watch_started',
    bridgeUrl,
    startedAt,
    minutes,
    intervalMs,
    instruction: 'Place one inbound call now, speak a full sentence, then watch for fresh transcript/fallback rows.',
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

  while (Date.now() < stopAtMs) {
    const [messagesResult, callsResult] = await Promise.allSettled([
      fetchJson('/api/messages?limit=25', { timeoutMs: 30000 }),
      fetchJson('/api/calls?limit=25', { timeoutMs: 30000 }),
    ]);

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

  console.log(JSON.stringify({
    ok: sawTranscript,
    result: sawTranscript ? 'telnyx_deepgram_transcript_observed' : 'telnyx_deepgram_transcript_not_observed',
    startedAt,
    endedAt: new Date().toISOString(),
    sawFreshCall,
    sawFreshMessage,
    sawTranscript,
    nextStep: sawTranscript
      ? 'Ava heard the caller. Check call replay and agent decisions for response quality.'
      : 'If you placed a call, inspect Render activity for Telnyx media frame diagnostics; if no fresh call appeared, verify Telnyx webhook points to this bridge.',
  }, null, 2));

  process.exit(sawTranscript ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    result: 'telnyx_live_call_watch_failed',
    error: error?.message || String(error),
  }, null, 2));
  process.exit(1);
});
