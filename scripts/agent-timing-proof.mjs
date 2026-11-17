import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import { REQUIRED_AGENT_LATENCY_MILESTONES, resolveAgentLatencyBudget } from './agent-latency-policy.mjs';

const SCHEMA = 'pbk-agent-timing-v2';
const DOMAIN = 'pbk.agent-timing.signing-key.v2';
const MAX_AGE_MS = 86_400_000;
const FIELDS = ['schema', 'tenant', 'revision', 'policyHash', 'agentId', 'runId', 'channel', 'startedAt', 'completedAt',
  'timings', 'outputCodePoints', 'media', 'mediaDurationMs', 'provenance', 'successful', 'origin', 'signature'];
const MILESTONES = { firstTokenMs: 'first_token', completionMs: 'completion', speechStartMs: 'speech_start', speechCompletionMs: 'speech_completion' };
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,120}$/.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const unverified = reason => ({ verified: false, reason });

// No getters, symbols, custom prototypes or cycles may reach canonicalJson.
export function isAgentTimingPlainData(value, seen = new Set(), depth = 0) {
  if (value === null || ['string', 'boolean', 'undefined'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || depth > 16 || seen.has(value)
    || Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) return false;
  seen.add(value);
  const valid = Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Array.isArray(value) && key === 'length') return true;
    return typeof key === 'string' && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
      && isAgentTimingPlainData(descriptor.value, seen, depth + 1);
  });
  seen.delete(value);
  return valid;
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && isAgentTimingPlainData(value);
const keysEqual = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const timeOf = value => typeof value === 'number' ? value : typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ? Date.parse(value) : NaN;
const validTime = value => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());

function sign(data, secret) {
  const key = createHmac('sha256', secret).update(DOMAIN).digest();
  return createHmac('sha256', key).update(`${SCHEMA}\n${canonicalJson(data)}`).digest('hex');
}
function mediaDuration(media) {
  if (!keysEqual(media, ['codec', 'sampleRate', 'byteCount']) || media.codec !== 'PCMU' || media.sampleRate !== 8000
    || !Number.isSafeInteger(media.byteCount) || media.byteCount <= 0) return null;
  // PCMU is one byte per sample; milliseconds are kept fractional, never clamped.
  const duration = media.byteCount / 8;
  return numeric(duration) ? duration : null;
}
function dataValid(data, policy) {
  if (data.schema !== SCHEMA || data.tenant !== 'pbk' || !validRevision(data.revision)
    || !safeId(data.agentId) || !safeId(data.runId) || data.origin !== 'accepted_turn'
    || data.provenance !== 'organic' || data.successful !== true || typeof data.channel !== 'string'
    || !Object.hasOwn(REQUIRED_AGENT_LATENCY_MILESTONES, data.channel)) return false;
  if (typeof data.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.policyHash)) return false;
  if (policy !== null && (!resolveAgentLatencyBudget(policy, { channel: 'provider', kind: 'completion' }).verified || data.policyHash !== policy.hash)) return false;
  const started = timeOf(data.startedAt), completed = timeOf(data.completedAt);
  if (!validTime(started) || !validTime(completed) || started > completed
    || new Date(started).toISOString() !== data.startedAt || new Date(completed).toISOString() !== data.completedAt) return false;
  if (data.channel === 'provider' ? data.outputCodePoints !== null
    : !Number.isSafeInteger(data.outputCodePoints) || data.outputCodePoints <= 0) return false;
  if (data.media === null ? data.mediaDurationMs !== null
    : data.channel !== 'phone' || mediaDuration(data.media) === null || data.mediaDurationMs !== mediaDuration(data.media)) return false;
  if (!record(data.timings)) return false;
  for (const [field, value] of Object.entries(data.timings)) {
    if (!Object.hasOwn(MILESTONES, field) || !REQUIRED_AGENT_LATENCY_MILESTONES[data.channel].includes(MILESTONES[field])
      || !numeric(value) || value > completed - started) return false;
    if (field === 'speechCompletionMs' && data.media === null) return false;
    if (policy !== null && !resolveAgentLatencyBudget(policy, { channel: data.channel, kind: MILESTONES[field],
      outputCodePoints: data.outputCodePoints, mediaDurationMs: data.mediaDurationMs }).verified) return false;
  }
  for (const [first, last] of [['firstTokenMs', 'completionMs'], ['speechStartMs', 'speechCompletionMs']]) {
    if (Object.hasOwn(data.timings, first) && Object.hasOwn(data.timings, last) && data.timings[first] > data.timings[last]) return false;
  }
  return true;
}

/** Internal trusted-meter API only. Public payload labels are not authority. */
export function buildAgentTimingProof(input = {}) {
  if (!record(input) || typeof input.secret !== 'string' || !input.secret) return unverified('input_invalid');
  const { secret, revision, policy, agentId, runId, channel, timings = {}, answer, provenance, successful, origin } = input;
  if (!record(timings) || policy === null) return unverified('input_invalid');
  const started = timeOf(input.startedAt), completed = timeOf(input.completedAt);
  if (!validTime(started) || !validTime(completed)) return unverified('time_invalid');
  if (channel !== 'provider' && (typeof answer !== 'string' || !answer.trim())) return unverified('output_unverified');
  let outputCodePoints = null;
  if (channel !== 'provider') {
    outputCodePoints = 0;
    for (const _point of answer) outputCodePoints++;
  }
  const media = input.media ?? null;
  const data = { schema: SCHEMA, tenant: 'pbk', revision, policyHash: policy?.hash, agentId, runId, channel,
    startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(), timings: { ...timings },
    outputCodePoints, media, mediaDurationMs: media === null ? null : mediaDuration(media), provenance, successful, origin };
  if (!dataValid(data, policy)) return unverified('measurement_unverified');
  const copy = JSON.parse(canonicalJson(data));
  return { ...copy, signature: sign(copy, secret) };
}

export function verifyAgentTimingProof(proof, { secret, revision, policy, agentId, runId, now = Date.now() } = {}) {
  if (!keysEqual(proof, FIELDS)) return unverified('proof_invalid');
  if (typeof secret !== 'string' || !secret || !validRevision(revision) || !safeId(agentId) || !safeId(runId)
    || !validTime(now)) return unverified('context_invalid');
  if (proof.agentId !== agentId || proof.runId !== runId) return unverified('binding_mismatch');
  const { signature, ...data } = proof;
  if (!dataValid(data, null)) return unverified('measurement_unverified');
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)
    || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(data, secret), 'hex'))) return unverified('signature_invalid');
  const completed = timeOf(data.completedAt);
  if (completed > now) return unverified('time_future');
  if (now - completed > MAX_AGE_MS) return unverified('time_expired');
  if (proof.revision !== revision) return unverified('binding_mismatch');
  if (policy === null || !dataValid(data, policy)) return unverified('measurement_unverified');
  return { verified: true, reason: 'verified', data: JSON.parse(canonicalJson(data)) };
}
