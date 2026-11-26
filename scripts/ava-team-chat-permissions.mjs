function readCurrentUserTurn(messages, completedHistoryOnly) {
  if (!Array.isArray(messages)) return '';
  let recentTurns = 0;
  for (let index = messages.length - 1; index >= 0 && recentTurns < 18; index -= 1) {
    const message = messages[index];
    const content = String(message?.content || '').trim();
    if (!content) continue;
    recentTurns += 1;
    const role = String(message?.role || '').toLowerCase();
    if (role === 'assistant' && completedHistoryOnly) return '';
    if (role !== 'assistant' && role !== 'system') return content.slice(0, 4000);
  }
  return '';
}

export function readAvaChatCurrentRequest(body = {}) {
  const fallback = String(body.message || body.query || body.text || body.prompt || '').trim();
  // Completed turns can accompany a separate current message without a trailing user turn.
  return readCurrentUserTurn(body.messages, body.historyMode === 'completed-only' && Boolean(fallback)) || fallback;
}

export function getAvaChatRequiredPermissions(path = '', body = {}) {
  const required = new Set();
  if (!['/api/assistant/chat', '/api/v1/assistant/chat'].includes(String(path).toLowerCase())) return required;
  const commands = [readAvaChatCurrentRequest(body), body.action, body.assistantAction, body.usedIntent];
  for (const command of commands) {
    if (typeof command !== 'string' || !command.trim()) continue;
    const text = command.replace(/\s+/g, ' ').trim().toLowerCase();
    if (/\b(?:(?:send|draft|compose|write|prepare|queue).{0,48}(?:sms|text|message)|(?:sms|text)\s+(?:seller|owner|lead|to))\b/i.test(text)) {
      required.add('canSendSms');
    }
    if (/\b(?:(?:send|draft|compose|write|prepare|queue).{0,48}(?:email|mail)|email\s+(?:seller|owner|lead|to))\b/i.test(text)) {
      required.add('canSendEmail');
    }
    if (/\b(?:(?:place|make|start|launch|initiate|dial|ring|connect|prepare|queue|set up).{0,48}call)\b/i.test(text) ||
        (!/\b(?:review|summarize|score|transcribe|transcript|recording|qa|quality).{0,32}call\b/i.test(text) &&
          /\bcall.{0,48}(?:seller|owner|lead|prospect|now|for approval|request|before dialing|dial)\b/i.test(text))) {
      required.add('canPlaceCalls');
    }
    if (/\b(?:nurture|sequence|provider|approval|approve|approved|launch campaign|start campaign)\b/i.test(text)) {
      required.add('canApproveProviderActions');
    }
  }
  return required;
}
