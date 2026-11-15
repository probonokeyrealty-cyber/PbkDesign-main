const DECISION_JSON_CONTRACT = [
  'Return only one valid compact JSON object with all fields shown below. No markdown or text outside JSON. Do not omit required fields.',
  'Use the actual request and available evidence for values; the example shows structure only and must not be copied as an answer.',
  'decision must be answer, ask, act, approval_required, delegate, log_only, or block; confidence must be between 0 and 1.',
  'needsApproval must reflect PBK approval policy. A suggested toolIntent never authorizes execution or bypasses the controller.',
  'Keep reply warm, specific, and operational. Never expose hidden reasoning. missionTimeline contains short visible checks, not chain-of-thought.',
  'Match the depth of the reply to the question. Be concise for simple exchanges, and give complete explanations, reasoning summaries, examples, and steps when useful. There is no fixed word or sentence limit. Do not cut off a necessary explanation to sound brief. Use paragraphs and lists for detailed text. nextAction="" when no action is needed; missionTimeline=[] when no checks were performed. In JSON text output, toolIntent=null only for answer/ask/log_only/block with no tool proposal and needsApproval=false. Otherwise provide the full toolIntent object with name, providerWrite, summary, paramsJson; providerWrite requires needsApproval=true. Never hide an action or approval proposal as null. Do not repeat the reply in metadata or invent checks.',
  'EXAMPLE JSON:',
  JSON.stringify({
    reply: '<natural operator-facing reply>', decision: 'answer', confidence: 0.8,
    nextAction: '', needsApproval: false, missionTimeline: [], toolIntent: null,
  }),
].join('\n');

export function isAvaCompactDecisionSafe(answer) {
  let value;
  try { value = JSON.parse(answer); } catch { return false; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const required = ['reply', 'decision', 'confidence', 'nextAction', 'needsApproval', 'missionTimeline', 'toolIntent'];
  if (!required.every((key) => Object.hasOwn(value, key))) return false;
  if (Object.hasOwn(value, 'needs_approval')) return false;
  if (typeof value.reply !== 'string' || !value.reply.trim() || typeof value.nextAction !== 'string'
    || typeof value.needsApproval !== 'boolean' || typeof value.confidence !== 'number'
    || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1
    || !Array.isArray(value.missionTimeline) || !value.missionTimeline.every((item) => typeof item === 'string')) return false;
  const noToolDecisions = ['answer', 'ask', 'log_only', 'block'];
  if (![...noToolDecisions, 'act', 'approval_required', 'delegate'].includes(value.decision)) return false;
  const tool = value.toolIntent;
  if (tool === null) return noToolDecisions.includes(value.decision) && !value.needsApproval;
  if (typeof tool !== 'object' || Array.isArray(tool)
    || !['name', 'summary', 'paramsJson'].every((key) => typeof tool[key] === 'string')
    || typeof tool.providerWrite !== 'boolean') return false;
  if (Object.hasOwn(tool, 'provider_write')) return false;
  if ((!noToolDecisions.includes(value.decision) || value.needsApproval || tool.providerWrite) && !tool.name.trim()) return false;
  if ((tool.providerWrite || value.decision === 'approval_required') && !value.needsApproval) return false;
  return true;
}

export function buildAvaDecisionMessages(prompt, text, { streaming = false } = {}) {
  const contract = streaming ? DECISION_JSON_CONTRACT.slice(0, DECISION_JSON_CONTRACT.indexOf('EXAMPLE JSON:'))
    + 'For streaming, output ALL decision metadata before the reply field. Put reply LAST, after decision, confidence, nextAction, needsApproval, missionTimeline, and toolIntent. Never change metadata after starting reply.\nEXAMPLE JSON:\n'
    + JSON.stringify({ decision: 'answer', confidence: 0.8, nextAction: '', needsApproval: false, missionTimeline: [], toolIntent: null, reply: '<natural operator-facing reply>' })
    : DECISION_JSON_CONTRACT;
  return [
    { role: 'system', content: prompt },
    { role: 'system', content: contract },
    { role: 'user', content: String(text || '').trim() },
  ].filter((message) => message.content);
}
