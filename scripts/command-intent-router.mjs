export const COMMAND_INTENT_ROUTER_VERSION = '2026-06-08-v1';

const STATUS_CUE =
  /\b(status|health|healthy|readiness|ready|online|offline|connected|connection|working|available|availability|live|check|inspect|verify)\b/i;
const MUTATION_CUE =
  /\b(restart|reboot|deploy|publish|change|update|set|write|delete|remove|create|send|dial|text|sms|email|approve|reject|execute|install|upgrade|backfill|migrate)\b/i;
const SELLER_WORK_CUE =
  /\b(lead|seller|property|deal|contract|offer|appointment|campaign|conversation|thread|message|call transcript|phone call)\b/i;

const RULES = [
  {
    intent: 'status.desktop_sidecar',
    route: 'desktop_sidecar_status',
    ttlSeconds: 5,
    subject: /\b(sidecar|desktop copilot|clickui|click ui)\b/i,
    reason: 'explicit_desktop_sidecar_status',
  },
  {
    intent: 'status.vector_memory',
    route: 'vector_capacity_status',
    ttlSeconds: 20,
    subject: /\b(pgvector|vector memory|vector status|embedding(?:s)?|semantic memory|rex memory)\b/i,
    reason: 'explicit_vector_memory_status',
  },
  {
    intent: 'status.tooling',
    route: 'tooling_status',
    ttlSeconds: 20,
    subject: /\b(tooling|tool status|tools status|all tools|mcp status|mcp tools)\b/i,
    reason: 'explicit_tooling_status',
  },
  {
    intent: 'status.provider_quotas',
    route: 'provider_quota_status',
    ttlSeconds: 15,
    subject: /\b(provider quotas?|quota status|providers ready|provider readiness|provider health)\b/i,
    reason: 'explicit_provider_quota_status',
  },
  {
    intent: 'status.openclaw_gateway',
    route: 'openclaw_gateway_status',
    ttlSeconds: 5,
    subject: /\b(openclaw|open claw|gateway)\b/i,
    reason: 'explicit_openclaw_gateway_status',
  },
  {
    intent: 'status.bridge',
    route: 'bridge_health_status',
    ttlSeconds: 5,
    subject: /\b(pbk bridge|bridge|pbk runtime|runtime health|system health|command center health)\b/i,
    reason: 'explicit_bridge_health_status',
  },
];

export function normalizeCommandForIntent(command = '') {
  return String(command || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s:+._/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function classifyCommandIntent(command = '') {
  const normalized = normalizeCommandForIntent(command);
  if (!normalized) {
    return {
      matched: false,
      category: 'COMPLEX_TASK',
      intent: 'complex_task',
      confidence: 0,
      cacheable: false,
      reason: 'empty_command',
      version: COMMAND_INTENT_ROUTER_VERSION,
    };
  }

  if (MUTATION_CUE.test(normalized)) {
    return {
      matched: false,
      category: 'COMPLEX_TASK',
      intent: 'complex_task',
      confidence: 0,
      cacheable: false,
      reason: 'mutation_language_present',
      version: COMMAND_INTENT_ROUTER_VERSION,
    };
  }

  if (!STATUS_CUE.test(normalized)) {
    return {
      matched: false,
      category: 'COMPLEX_TASK',
      intent: 'complex_task',
      confidence: 0,
      cacheable: false,
      reason: 'no_explicit_status_cue',
      version: COMMAND_INTENT_ROUTER_VERSION,
    };
  }

  for (const rule of RULES) {
    if (!rule.subject.test(normalized)) continue;
    if (SELLER_WORK_CUE.test(normalized)) {
      return {
        matched: false,
        category: 'COMPLEX_TASK',
        intent: 'complex_task',
        confidence: 0,
        cacheable: false,
        reason: 'seller_work_context_present',
        version: COMMAND_INTENT_ROUTER_VERSION,
      };
    }
    return {
      matched: true,
      category: 'STATUS_CHECK',
      intent: rule.intent,
      route: rule.route,
      confidence: 1,
      cacheable: true,
      ttlSeconds: rule.ttlSeconds,
      cacheKey: rule.intent.replace(/[^a-z0-9_-]+/gi, '-'),
      reason: rule.reason,
      version: COMMAND_INTENT_ROUTER_VERSION,
    };
  }

  return {
    matched: false,
    category: 'COMPLEX_TASK',
    intent: 'complex_task',
    confidence: 0,
    cacheable: false,
    reason: 'no_high_confidence_rule',
    version: COMMAND_INTENT_ROUTER_VERSION,
  };
}

export function listCommandIntentRouterRules() {
  return RULES.map(({ intent, route, ttlSeconds, reason }) => ({
    intent,
    route,
    ttlSeconds,
    reason,
  }));
}
