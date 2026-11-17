import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createHmac } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import * as latency from './agent-latency-policy.mjs';

// Missing implementation is an expected RED, not a test-loader failure.
const timing = await import('./agent-timing-proof.mjs').catch(() => ({}));
const secret = 'task-one-explicit-fixture-secret';
const revision = '1'.repeat(40);
const now = Date.parse('2026-11-17T12:00:00.000Z');
const policy = () => latency.getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(latency.AGENT_LATENCY_PILOT_V2) });
const input = (changes = {}) => ({ secret, revision, policy: policy(), agentId: 'ava', runId: 'fixture-run',
  channel: 'chat', startedAt: now - 3000, completedAt: now, timings: { firstTokenMs: 800, completionMs: 3000 },
  answer: 'A\u{1f600}B', provenance: 'organic', successful: true, origin: 'accepted_turn', ...changes });
const verify = (proof, changes = {}) => timing.verifyAgentTimingProof(proof, {
  secret, revision, policy: policy(), agentId: 'ava', runId: 'fixture-run', now, ...changes,
});

test('timing core exports its two explicit APIs', () => {
  assert.equal(typeof timing.buildAgentTimingProof, 'function');
  assert.equal(typeof timing.verifyAgentTimingProof, 'function');
});

test('signed proof counts actual Unicode code points and retains no content', () => {
  const proof = timing.buildAgentTimingProof(input());
  const checked = verify(proof);
  assert.equal(checked.verified, true);
  assert.equal(checked.data.outputCodePoints, 3);
  assert.equal(proof.schema, 'pbk-agent-timing-v2');
  assert.equal(proof.tenant, 'pbk');
  assert(!JSON.stringify(proof).includes('A\u{1f600}B'));
  assert(!JSON.stringify(proof).includes(secret));
  assert.equal(verify(JSON.parse(JSON.stringify(proof))).verified, true);
});

for (const [field, value] of [
  ['tenant', 'other'], ['agentId', 'rex'], ['runId', 'other'], ['revision', '2'.repeat(40)],
  ['policyHash', '0'.repeat(64)], ['outputCodePoints', 99999], ['origin', 'caller'],
  ['successful', false], ['provenance', 'controlled'], ['completedAt', '2026-11-17T12:00:01.000Z'],
  ['timings', { firstTokenMs: 1, completionMs: 1 }], ['mediaDurationMs', 9999], ['extra', 'not-allowed'],
]) {
  test(`edited ${field} cannot reuse a signature`, () => {
    const proof = timing.buildAgentTimingProof(input());
    assert.equal(verify({ ...proof, [field]: value }).verified, false);
  });
}

for (const changes of [
  { secret: 'other-fixture-secret' }, { revision: '2'.repeat(40) }, { agentId: 'rex' }, { runId: 'another-run' },
  { now: now + 86_400_001 }, { now: now - 1 }, { now: NaN },
]) test(`verification context fails closed ${JSON.stringify(changes)}`, () => {
  assert.equal(verify(timing.buildAgentTimingProof(input()), changes).verified, false);
});

for (const changes of [
  { successful: false }, { successful: 'true' }, { answer: '' }, { answer: '   ' }, { answer: undefined },
  { provenance: 'controlled' }, { provenance: 'diagnostic' }, { provenance: 'unknown' }, { origin: 'caller' },
  { timings: { completionMs: Infinity } }, { timings: { completionMs: -1 } },
  { timings: { firstTokenMs: 3001, completionMs: 3000 } }, { timings: { completionMs: 3001 } },
  { timings: { cancelled: true } }, { startedAt: now + 1 }, { completedAt: NaN },
  { channel: 'unknown' }, { secret: '' }, { revision: '' },
  { channel: 'phone', timings: { speechCompletionMs: 3000 } },
  { channel: 'phone', media: { codec: 'PCMU', sampleRate: 8000, byteCount: 8000, durationMs: 1 } },
  { channel: 'phone', media: { codec: 'PCM', sampleRate: 8000, byteCount: 8000 } },
  { channel: 'phone', media: { codec: 'PCMU', sampleRate: 16000, byteCount: 8000 } },
  { channel: 'phone', media: { codec: 'PCMU', sampleRate: 8000, byteCount: 0 } },
]) test(`builder cannot attest invalid or non-completed work ${JSON.stringify(changes)}`, () => {
  assert.equal(timing.buildAgentTimingProof(input(changes)).verified, false);
});

test('actual PCMU byte counts derive media duration without storing audio', () => {
  const proof = timing.buildAgentTimingProof(input({ channel: 'phone',
    media: { codec: 'PCMU', sampleRate: 8000, byteCount: 8001 },
    timings: { firstTokenMs: 800, completionMs: 2000, speechStartMs: 1000, speechCompletionMs: 3000 },
  }));
  assert.equal(verify(proof).verified, true);
  assert.equal(proof.mediaDurationMs, 1000.125);
  assert.equal(proof.media.byteCount, 8001);
});

test('missing milestones remain absent; provider work does not manufacture text', () => {
  const proof = timing.buildAgentTimingProof(input({ timings: { completionMs: 3000 } }));
  assert.equal(verify(proof).verified, true);
  assert.deepEqual(proof.timings, { completionMs: 3000 });
  const provider = timing.buildAgentTimingProof(input({ channel: 'provider', answer: undefined, timings: { completionMs: 3000 } }));
  assert.equal(verify(provider).verified, true);
  assert.equal(provider.outputCodePoints, null);
});

test('accessors, exotic prototypes, cycles and symbol keys fail without invoking getters', () => {
  let accessed = false;
  const accessor = Object.defineProperty({}, 'completionMs', { enumerable: true, get() { accessed = true; return 1; } });
  const cycle = {}; cycle.self = cycle;
  for (const timings of [accessor, Object.create({ completionMs: 1 }), cycle, { [Symbol('timing')]: 1 }]) {
    assert.equal(timing.buildAgentTimingProof(input({ timings })).verified, false);
  }
  const proof = timing.buildAgentTimingProof(input());
  for (const bad of [Object.create(proof), Object.defineProperty({ ...proof }, 'signature', {
    get() { accessed = true; return proof.signature; },
  })]) assert.equal(verify(bad).verified, false);
  assert.equal(accessed, false);
});

test('array timings are not a strict milestone record', () => {
  assert.equal(timing.buildAgentTimingProof(input({ timings: [] })).verified, false);
});

test('an active policy change invalidates a still-fresh signed proof', () => {
  const changed = JSON.parse(JSON.stringify(latency.AGENT_LATENCY_PILOT_V2));
  changed.channels.chat.completion.baseMs++;
  assert.equal(verify(timing.buildAgentTimingProof(input()), { policy: latency.getAgentLatencyPolicy({
    PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(changed),
  }) }).verified, false);
});

for (const agentId of ['__proto__', 'constructor', 'prototype']) test(`reserved identity ${agentId} is not attestable`, () => {
  assert.equal(timing.buildAgentTimingProof(input({ agentId })).verified, false);
});

test('malformed channel claims do not execute object coercion', () => {
  assert.equal(timing.buildAgentTimingProof(input({ channel: { toString: 'not-callable' } })).verified, false);
});

test('valid HMAC cannot authorize wrong schema, tenant, bounds, output or media semantics', () => {
  const original = timing.buildAgentTimingProof(input());
  const resign = (changes, domain = 'pbk.agent-timing.signing-key.v2') => {
    const { signature: _ignored, ...unsigned } = { ...original, ...changes };
    const key = createHmac('sha256', secret).update(domain).digest();
    return { ...unsigned, signature: createHmac('sha256', key).update(`pbk-agent-timing-v2\n${canonicalJson(unsigned)}`).digest('hex') };
  };
  for (const changes of [{ schema: 'other' }, { tenant: 'other' }, { successful: false }, { outputCodePoints: 0 },
    { origin: 'caller' }, { provenance: 'controlled' }, { timings: { completionMs: 3001 } },
    { channel: 'phone', media: { codec: 'PCMU', sampleRate: 8000, byteCount: 8000 }, mediaDurationMs: 2 }]) {
    assert.equal(verify(resign(changes)).verified, false);
  }
  assert.equal(verify(resign({}, 'another-domain')).verified, false);
});
