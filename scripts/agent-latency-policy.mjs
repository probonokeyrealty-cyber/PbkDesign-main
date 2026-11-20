import { createHash } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';

const POLICY_ENV = 'PBK_AGENT_LATENCY_BUDGETS_MS';
const V2_ENV = 'PBK_AGENT_LATENCY_POLICY_V2';
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

const freeze = (value) => {
  for (const child of Object.values(value)) if (isRecord(child)) freeze(child);
  return Object.freeze(value);
};
export const AGENT_LATENCY_PILOT_V2 = freeze({ schemaVersion: 2, channels: {
  chat: { first_token: { kind: 'fixed', ms: 1800 }, completion: { kind: 'text', baseMs: 3000, msPerCodePoint: 20 } },
  phone: { first_token: { kind: 'fixed', ms: 1800 }, completion: { kind: 'text', baseMs: 3000, msPerCodePoint: 20 },
    speech_start: { kind: 'fixed', ms: 2500 }, speech_completion: { kind: 'media', startMs: 2500, durationMultiplier: 1.10, drainMs: 2000 } },
  research: { completion: { kind: 'text', baseMs: 120000, msPerCodePoint: 20 } },
  provider: { completion: { kind: 'fixed', ms: 30000 } },
} });

// Check descriptors before reading values or canonicalizing untrusted objects.
function exactRecord(value, keys) {
  return isRecord(value) && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable;
    });
}
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
function validRules(rules) {
  if (!exactRecord(rules, Object.keys(REQUIRED_AGENT_LATENCY_MILESTONES))) return false;
  for (const [channel, kinds] of Object.entries(REQUIRED_AGENT_LATENCY_MILESTONES)) {
    if (!exactRecord(rules[channel], kinds)) return false;
    for (const kind of kinds) {
      const rule = rules[channel][kind];
      const expectedKind = AGENT_LATENCY_PILOT_V2.channels[channel][kind].kind;
      const keys = expectedKind === 'fixed' ? ['kind', 'ms'] : expectedKind === 'text'
        ? ['kind', 'baseMs', 'msPerCodePoint'] : ['kind', 'startMs', 'durationMultiplier', 'drainMs'];
      if (!exactRecord(rule, keys) || rule.kind !== expectedKind || !keys.slice(1).every(key => positive(rule[key]))) return false;
    }
  }
  return true;
}
const policyHash = rules => createHash('sha256').update(canonicalJson({ schemaVersion: 2, channels: rules })).digest('hex');
function readV2(raw) {
  const blocked = () => ({ version: 2, ready: false, hash: null, rules: {}, budgets: {}, issues: ['policy_v2_invalid'], source: V2_ENV });
  if (typeof raw !== 'string' || !raw.trim()) return blocked();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return blocked(); }
  if (!exactRecord(parsed, ['schemaVersion', 'channels']) || parsed.schemaVersion !== 2 || !validRules(parsed.channels)) return blocked();
  const rules = parsed.channels;
  const budgets = Object.fromEntries(Object.entries(rules).map(([channel, kinds]) => [channel,
    Object.fromEntries(Object.entries(kinds).filter(([, rule]) => rule.kind === 'fixed').map(([kind, rule]) => [kind, rule.ms])),
  ]));
  return { version: 2, ready: true, hash: policyHash(rules), rules, budgets, issues: [], source: V2_ENV };
}

export function resolveAgentLatencyBudget(policy, { channel, kind, outputCodePoints, mediaDurationMs } = {}) {
  const reject = reason => ({ verified: false, budgetMs: null, reason });
  if (!exactRecord(policy, ['version', 'ready', 'hash', 'rules', 'budgets', 'issues', 'source'])
    || policy.version !== 2 || policy.ready !== true || !validRules(policy.rules)
    || policy.hash !== policyHash(policy.rules)) return reject('policy_unverified');
  if (typeof channel !== 'string' || typeof kind !== 'string' || !Object.hasOwn(REQUIRED_AGENT_LATENCY_MILESTONES, channel)
    || !REQUIRED_AGENT_LATENCY_MILESTONES[channel].includes(kind)) return reject('milestone_unknown');
  const rule = policy.rules[channel][kind];
  let budgetMs;
  if (rule.kind === 'fixed') budgetMs = rule.ms;
  else if (rule.kind === 'text') {
    if (!Number.isSafeInteger(outputCodePoints) || outputCodePoints < 0) return reject('output_length_unverified');
    budgetMs = rule.baseMs + rule.msPerCodePoint * outputCodePoints;
  } else {
    if (typeof mediaDurationMs !== 'number' || !Number.isFinite(mediaDurationMs) || mediaDurationMs < 0) return reject('media_duration_unverified');
    budgetMs = rule.startMs + rule.durationMultiplier * mediaDurationMs + rule.drainMs;
  }
  return positive(budgetMs) ? { verified: true, budgetMs, reason: 'verified' } : reject('budget_overflow');
}

/**
 * Server-side measurement policy, not execution deadlines. Completion budgets on
 * all four channels and both phone speech milestones require explicit config.
 * Any invalid or incomplete policy returns no usable budgets, even if a caller
 * forgets to propagate the separate readiness diagnostic to measurement.
 */
export function getAgentLatencyPolicy(env = process.env, { requireVersion2 = false } = {}) {
  if (Object.hasOwn(env || {}, V2_ENV) || requireVersion2) return readV2(env?.[V2_ENV]);
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
