import { performance } from 'node:perf_hooks';
import { buildAgentTimingProof } from './agent-timing-proof.mjs';
import { getRuntimeEvidenceContext } from './runtime-evidence-context.mjs';

const turns = new WeakMap();
const measurements = new WeakMap();

export function agentTimingResultSucceeded(result) {
  if (!result || typeof result !== 'object' || result.ok === false || result.success === false || result.error) return false;
  if (['partial', 'cancelled', 'canceled', 'skipped', 'dryRun', 'preview', 'diagnostic', 'controlled']
    .some(flag => result[flag] === true)) return false;
  return ![result.status, result.result].some(value => typeof value === 'string'
    && /(?:^|[_\s-])(?:failed|error|cancelled|canceled|partial|timeout|timed_out|skipped|pending|queued|running|blocked|approval_required)(?:$|[_\s-])/i.test(value));
}

// Internal server dependency API. No request object or public metadata is consulted.
export function createAgentTimingTurn({ secret, revision, policy, channel, agentId, runId,
  now = Date.now, monotonicNow = () => performance.now() } = {}) {
  const handle = Object.freeze({});
  turns.set(handle, { secret, revision, policy, channel, agentId, runId, now, monotonicNow,
    startedAt: now(), startedMono: monotonicNow(), context: getRuntimeEvidenceContext(), timings: {} });
  return handle;
}

export function markAgentTimingFirstContent(handle, content) {
  const turn = turns.get(handle);
  if (!turn || turn.context !== getRuntimeEvidenceContext() || typeof content !== 'string' || !content.trim()) return;
  if (turn.timings.firstTokenMs === undefined && turn.channel !== 'provider') {
    turn.timings.firstTokenMs = Math.floor(turn.monotonicNow() - turn.startedMono);
  }
}

export function bindAgentTimingToParams(params, handle, { answer, successful, signal } = {}) {
  const turn = turns.get(handle);
  turns.delete(handle);
  if (!turn || turn.context !== getRuntimeEvidenceContext() || turn.context.classification !== 'operational'
    || successful !== true || signal?.aborted) return params;
  try {
    const proof = buildAgentTimingProof({ secret: turn.secret, revision: turn.revision, policy: turn.policy,
      agentId: turn.agentId, runId: turn.runId, channel: turn.channel, startedAt: turn.startedAt,
      completedAt: turn.now(), timings: { ...turn.timings, completionMs: Math.floor(turn.monotonicNow() - turn.startedMono) },
      answer, successful: true, provenance: 'organic', origin: 'accepted_turn' });
    if (proof.signature) measurements.set(params, { proof, context: turn.context });
  } catch { /* Optional measurement cannot fail a completed business result. */ }
  return params;
}

export function getTrustedAgentTimingProof(params) {
  const measurement = measurements.get(params);
  return measurement?.context === getRuntimeEvidenceContext() ? JSON.parse(JSON.stringify(measurement.proof)) : null;
}

export function registeredAgentTimingChannel(agent, localHandlers) {
  if (!agent || /^https?:\/\//i.test(agent.endpoint || '') || typeof localHandlers?.[agent.id] !== 'function') return 'unknown';
  if (['rex', 'max', 'hermes', 'script-rotator'].includes(agent.id)) return 'research';
  if (['bant-enforcer', 'qa-agent', 'call-analyzer', 'prosody-tuner'].includes(agent.id)) return 'provider';
  return 'unknown';
}
