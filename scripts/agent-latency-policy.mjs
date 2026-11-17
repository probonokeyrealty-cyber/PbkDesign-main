const POLICY_ENV = 'PBK_AGENT_LATENCY_BUDGETS_MS';
const KINDS = ['first_token', 'completion', 'speech_start', 'speech_completion'];
export const REQUIRED_AGENT_LATENCY_MILESTONES = Object.freeze({
  chat: Object.freeze(['first_token', 'completion']),
  phone: Object.freeze(['first_token', 'completion', 'speech_start', 'speech_completion']),
  research: Object.freeze(['completion']),
  provider: Object.freeze(['completion']),
});
// Ava's existing 1800ms live-response SLO (production-readiness-command-layer.mjs)
// applies to first token only, never elapsed completion or a generation timeout.
const FIRST_TOKEN_SLO_MS = 1800;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Server-side measurement policy, not execution deadlines. Completion budgets on
 * all four channels and both phone speech milestones require explicit config.
 * Any invalid or incomplete policy returns no usable budgets, even if a caller
 * forgets to propagate the separate readiness diagnostic to measurement.
 */
export function getAgentLatencyPolicy(env = process.env) {
  const blocked = (issues) => ({ ready: false, budgets: {}, issues, source: POLICY_ENV });
  const raw = env?.[POLICY_ENV];
  if (raw === undefined || (typeof raw === 'string' && !raw.trim())) {
    return blocked([`policy_missing:${POLICY_ENV}`]);
  }
  if (typeof raw !== 'string') return blocked([`policy_type_invalid:${POLICY_ENV}`]);

  let configured;
  try {
    configured = JSON.parse(raw);
  } catch {
    return blocked([`policy_json_invalid:${POLICY_ENV}`]);
  }
  if (!isRecord(configured)) return blocked([`policy_matrix_invalid:${POLICY_ENV}`]);

  const budgets = {
    chat: { first_token: FIRST_TOKEN_SLO_MS },
    phone: { first_token: FIRST_TOKEN_SLO_MS },
    research: {},
    provider: {},
  };
  const issues = [];
  for (const [channel, milestones] of Object.entries(configured)) {
    // Unknown input keys/values must not leak into operator diagnostics.
    if (!Object.hasOwn(REQUIRED_AGENT_LATENCY_MILESTONES, channel)) {
      issues.push('channel_unknown');
      continue;
    }
    if (!isRecord(milestones)) {
      issues.push(`channel_invalid:${channel}`);
      continue;
    }
    for (const [kind, value] of Object.entries(milestones)) {
      if (!KINDS.includes(kind)) {
        issues.push(`milestone_unknown:${channel}`);
      } else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        issues.push(`budget_invalid:${channel}:${kind}`);
      } else {
        budgets[channel][kind] = value;
      }
    }
  }
  for (const [channel, kinds] of Object.entries(REQUIRED_AGENT_LATENCY_MILESTONES)) {
    for (const kind of kinds) {
      if (!Object.hasOwn(budgets[channel], kind)) issues.push(`budget_missing:${channel}:${kind}`);
    }
  }
  if (issues.length) return blocked([...new Set(issues)]);
  return { ready: true, budgets, issues: [], source: POLICY_ENV };
}
