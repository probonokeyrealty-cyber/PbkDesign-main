const DEMO_CALL_PATTERN =
  /\b(call-diane-live|call-john-live|lead-diane-kowalski|lead-john-smith)\b/i;

export function normalizeEpisodicTranscript(transcript) {
  if (Array.isArray(transcript)) {
    return transcript
      .map((turn) => {
        if (typeof turn === 'string') return turn.trim();
        const speaker = String(turn?.speaker || turn?.role || turn?.from || '').trim();
        const text = String(
          turn?.text || turn?.transcript || turn?.message || turn?.content || ''
        ).trim();
        return text ? [speaker, text].filter(Boolean).join(': ') : '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (transcript && typeof transcript === 'object') {
    return normalizeEpisodicTranscript(Object.values(transcript));
  }
  return String(transcript || '').trim();
}

export function selectBestEpisodicTranscript(candidates = []) {
  return candidates
    .map((candidate) =>
      normalizeEpisodicTranscript(candidate)
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] || '';
}

export function isExcludedEpisodicCall(call = {}) {
  if (call.synthetic === true) return true;
  const source = String(call.source || call.provider || '').trim().toLowerCase();
  if (/\b(demo|fixture|sample|synthetic|seed)\b/.test(source)) return true;
  const identity = [
    call.id,
    call.callId,
    call.call_id,
    call.leadId,
    call.lead_id,
    call.leadName,
    call.lead_name,
    call.address,
  ]
    .filter(Boolean)
    .join(' ');
  return DEMO_CALL_PATTERN.test(identity);
}

export function buildVectorTableReadiness({
  exists = false,
  dimensions = 0,
  embeddedCount = 0,
  vectorIndexMethod = 'none',
} = {}) {
  const infrastructureReady =
    Boolean(exists) &&
    Number(dimensions) === 1536 &&
    String(vectorIndexMethod || 'none') !== 'none';
  const populated = Number(embeddedCount) > 0;
  return {
    infrastructureReady,
    populated,
    ready: infrastructureReady && populated,
    status: !infrastructureReady ? 'needs_setup' : populated ? 'ready' : 'awaiting_data',
  };
}
