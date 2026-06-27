function getTranscriptText(row) {
  const transcript = String(row?.transcript ?? '').trim();
  if (transcript.length > 0) {
    return transcript;
  }

  return String(row?.body ?? '').trim();
}

function getCallId(row) {
  return row?.callId ?? row?.call_id ?? '';
}

export function planCallLearningBackfill({ transcripts = [], minCharacters = 40 } = {}) {
  const rows = Array.isArray(transcripts) ? transcripts : [];
  const callIds = [];
  let skipped = 0;

  for (const row of rows) {
    const callId = getCallId(row);
    const text = getTranscriptText(row);

    if (callId && text.length >= minCharacters) {
      callIds.push(String(callId));
    } else {
      skipped += 1;
    }
  }

  return {
    total: rows.length,
    eligible: callIds.length,
    skipped,
    callIds,
  };
}
