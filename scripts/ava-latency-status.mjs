function toLatencyNumber(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.round(numeric));
}

function percentile(values, ratio) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function recordAvaResponseLatencyStatus(status = {}, record = {}, options = {}) {
  const speechFinalToReplyStartMs = toLatencyNumber(
    record.speechFinalToReplyStartMs ?? record.speech_final_to_reply_start_ms ?? record.latencyMs ?? record.latency_ms,
  );
  if (speechFinalToReplyStartMs === null) return status;

  const turnCompletionMs = toLatencyNumber(record.turnCompletionMs ?? record.turn_completion_ms);
  const transcriptToTtsMs = toLatencyNumber(record.transcriptToTtsMs ?? record.transcript_to_tts_ms);
  const maxSamples = Math.max(1, Math.min(100, Number(options.maxSamples || 20)));
  const createdAt = String(record.createdAt || record.created_at || new Date().toISOString());
  const sample = {
    callId: String(record.callId || record.call_id || ''),
    leadId: String(record.leadId || record.lead_id || ''),
    speechFinalToReplyStartMs,
    turnCompletionMs,
    transcriptToTtsMs,
    replyMode: String(record.replyMode || record.reply_mode || ''),
    provider: String(record.provider || ''),
    ok: record.ok === undefined ? null : Boolean(record.ok),
    createdAt,
  };

  const previous = Array.isArray(status.avaResponseLatencySamples) ? status.avaResponseLatencySamples : [];
  const samples = [sample, ...previous].slice(0, maxSamples);
  const speechSamples = samples
    .map((item) => toLatencyNumber(item.speechFinalToReplyStartMs ?? item.speech_final_to_reply_start_ms))
    .filter((value) => value !== null);
  const completionSamples = samples
    .map((item) => toLatencyNumber(item.turnCompletionMs ?? item.turn_completion_ms))
    .filter((value) => value !== null);

  status.avaLatencyInstrumented = true;
  status.avaResponseLatencySamples = samples;
  status.lastAvaResponseLatencyMs = speechFinalToReplyStartMs;
  status.avaResponseLatencyMs = Math.round(speechSamples.reduce((sum, value) => sum + value, 0) / speechSamples.length);
  status.avaResponseLatencyP95Ms = percentile(speechSamples, 0.95);
  status.lastAvaLatencyAt = createdAt;
  status.lastAvaReplyMode = sample.replyMode;
  status.lastAvaTtsProvider = sample.provider;
  if (turnCompletionMs !== null) status.lastAvaTurnCompletionMs = turnCompletionMs;
  if (transcriptToTtsMs !== null) status.lastAvaTranscriptToTtsMs = transcriptToTtsMs;
  if (completionSamples.length) status.avaTurnCompletionP95Ms = percentile(completionSamples, 0.95);
  return status;
}
