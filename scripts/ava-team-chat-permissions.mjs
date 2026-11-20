export function getAvaChatRequiredPermissions(path = '', body = {}) {
  const required = new Set();
  if (!['/api/assistant/chat', '/api/v1/assistant/chat'].includes(String(path).toLowerCase())) return required;
  const text = ['message', 'prompt', 'command', 'request', 'input', 'text', 'action', 'assistantAction', 'usedIntent']
    .map(key => body[key]).filter(value => typeof value === 'string' && value.trim()).join(' ').trim().toLowerCase();
  if (!text) return required;
  if (/\b(?:(?:send|draft|compose|write|prepare|queue).{0,48}(?:sms|text|message)|(?:sms|text)\s+(?:seller|owner|lead|to))\b/i.test(text)) {
    required.add('canSendSms');
  }
  if (/\b(?:(?:send|draft|compose|write|prepare|queue).{0,48}(?:email|mail)|email\s+(?:seller|owner|lead|to))\b/i.test(text)) {
    required.add('canSendEmail');
  }
  if (!/\b(?:review|summarize|score|transcribe|transcript|recording|qa|quality).{0,32}call\b/i.test(text)
    && /\b(?:(?:place|make|start|launch|initiate|dial|ring|connect|prepare|queue|set up).{0,48}call|call.{0,48}(?:seller|owner|lead|prospect|now|for approval|request|before dialing|dial))\b/i.test(text)) {
    required.add('canPlaceCalls');
  }
  if (/\b(?:nurture|sequence|provider|approval|approve|approved|launch campaign|start campaign)\b/i.test(text)) {
    required.add('canApproveProviderActions');
  }
  return required;
}
