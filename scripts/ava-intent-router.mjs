export const AVA_INTENT_ROUTER_VERSION = 'ava-conversational-intent-v1';

const INTENT_ROUTES = [
  {
    id: 'screenshot',
    action: 'screenshot',
    risk: 'medium',
    needsApproval: true,
    pattern: /\b(?:take|grab|capture|get|snap).{0,24}(?:screenshot|screen shot|screen capture|desktop)\b|\bwhat(?:'s| is).{0,24}(?:on|shown on).{0,12}(?:my )?screen\b/i,
    summary: 'Ava can capture the desktop after approval.',
  },
  {
    id: 'clickui_inspect',
    action: 'clickui',
    risk: 'high',
    needsApproval: true,
    pattern: /\b(?:clickui|click ui|inspect|observe|see|find).{0,32}(?:window|button|screen|desktop|app|ui)\b/i,
    summary: 'Ava can inspect the active UI after approval.',
  },
  {
    id: 'execute_safe_script',
    action: 'execute_safe_script',
    risk: 'high',
    needsApproval: true,
    pattern: /\b(?:run|execute|start|launch).{0,32}(?:script|command|powershell|terminal|shell|program|app)\b/i,
    summary: 'Ava can prepare a local execution request for approval.',
  },
  {
    id: 'send_email',
    action: 'send_email',
    risk: 'high',
    needsApproval: true,
    pattern: /\b(?:send|draft|write).{0,32}(?:email|mail)\b|\bemail\s+(?:to|the)\b/i,
    summary: 'Ava can prepare an email, then wait for approval before sending.',
  },
  {
    id: 'send_sms',
    action: 'send_sms',
    risk: 'high',
    needsApproval: true,
    pattern: /\b(?:send|draft|write).{0,32}(?:text|sms|message)\b|\b(?:text|sms)\s+(?:to|the)\b/i,
    summary: 'Ava can prepare an SMS, then wait for approval before sending.',
  },
  {
    id: 'check_status',
    action: 'status',
    risk: 'low',
    needsApproval: false,
    pattern: /\b(?:health|status|ready|online|offline|sidecar|bridge|openclaw|connection)\b/i,
    summary: 'Ava can check system health immediately.',
  },
  {
    id: 'search_leads',
    action: 'search_leads',
    risk: 'low',
    needsApproval: false,
    pattern: /\b(?:search|find|look up|lookup).{0,32}(?:lead|seller|contact|property|record)\b/i,
    summary: 'Ava can search command-center context without approval.',
  },
  {
    id: 'analyze_deal',
    action: 'analyze_deal',
    risk: 'low',
    needsApproval: false,
    pattern: /\b(?:analy[sz]e|evaluate|underwrite|calculate).{0,32}(?:deal|property|mao|arv|offer)\b|\b(?:mao|arv|repair estimate)\b/i,
    summary: 'Ava can prepare read-only deal analysis without approval.',
  },
];

export function listAvaIntentRoutes() {
  return INTENT_ROUTES.map(({ pattern, ...route }) => ({ ...route }));
}

export function classifyAvaConversationalIntent(input = '', params = {}) {
  const text = String(input || params.command || params.text || params.prompt || params.transcript || '')
    .trim();
  const explicitAction = String(params.action || params.commandAction || params.command_action || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const matched = INTENT_ROUTES.find((route) => route.pattern.test(text));
  const action = explicitAction || matched?.action || 'operator_command';
  const risk = matched?.risk || (explicitAction === 'status' || explicitAction === 'ping' ? 'low' : 'medium');
  return {
    ok: true,
    version: AVA_INTENT_ROUTER_VERSION,
    matched: Boolean(matched),
    intent: matched?.id || 'deepseek_fallback',
    action,
    risk,
    needsApproval: matched ? matched.needsApproval : risk !== 'low',
    summary: matched?.summary || 'Ava will route this through the existing OpenClaw intelligence path.',
    source: matched ? 'deterministic' : 'fallback',
  };
}
