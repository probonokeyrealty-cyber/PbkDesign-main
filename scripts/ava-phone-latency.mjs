const stages = [
  'sttFinalReceivedAt', 'replyBuildStartedAt', 'replyBuildCompletedAt',
  'ttsRequestedAt', 'ttsFirstAudioByteAt', 'ttsAudioReadyAt',
  'mediaEnqueuedAt', 'fallbackAcceptedAt',
];

export function summarizePhoneTurnTiming(input = {}) {
  const result = {};
  for (const key of stages) {
    const value = input[key];
    result[key] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }
  const elapsed = (start, end) => result[start] !== null && result[end] !== null && result[end] >= result[start]
    ? result[end] - result[start] : null;
  return {
    ...result,
    replyBuildMs: elapsed('replyBuildStartedAt', 'replyBuildCompletedAt'),
    sttFinalToFirstAudioByteMs: elapsed('sttFinalReceivedAt', 'ttsFirstAudioByteAt'),
    ttsTimeToFirstAudioByteMs: elapsed('ttsRequestedAt', 'ttsFirstAudioByteAt'),
    sttFinalToMediaEnqueueMs: elapsed('sttFinalReceivedAt', 'mediaEnqueuedAt'),
    // Neither provider response bytes nor a socket send establishes far-end playout.
    sellerSpeechEndAt: null,
    telnyxPlaybackStartedAt: null,
    endToEndAudibleLatencyMs: null,
    livePhoneLatencyProven: false,
    measurementBoundary: 'bridge_observed_only',
  };
}

export async function readPhoneTtsAudio(response, onFirstAudio = () => {}) {
  if (!response.body?.getReader) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (!bytes) onFirstAudio();
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      bytes += chunk.length;
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    reader.releaseLock();
  }
}
