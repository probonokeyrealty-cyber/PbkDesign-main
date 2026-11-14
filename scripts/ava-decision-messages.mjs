const DECISION_JSON_CONTRACT = [
  'Return only one valid JSON object with all fields shown below. No markdown or text outside JSON.',
  'Use the actual request and available evidence for values; the example shows structure only and must not be copied as an answer.',
  'decision must be answer, ask, act, approval_required, delegate, log_only, or block; confidence must be between 0 and 1.',
  'needsApproval must reflect PBK approval policy. A suggested toolIntent never authorizes execution or bypasses the controller.',
  'Keep reply warm, specific, and operational. Never expose hidden reasoning. missionTimeline contains short visible checks, not chain-of-thought.',
  'EXAMPLE JSON:',
  JSON.stringify({
    reply: '<natural operator-facing reply>', decision: 'answer', confidence: 0.8,
    nextAction: '<useful next step>', needsApproval: false, missionTimeline: [],
    toolIntent: { name: '', providerWrite: false, summary: '', paramsJson: '' },
  }),
].join('\n');

export function buildAvaDecisionMessages(prompt, text) {
  return [
    { role: 'system', content: prompt },
    { role: 'system', content: DECISION_JSON_CONTRACT },
    { role: 'user', content: String(text || '').trim() },
  ].filter((message) => message.content);
}
