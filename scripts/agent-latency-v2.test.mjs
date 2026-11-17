import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import * as latency from './agent-latency-policy.mjs';
import { collectAgentFleetEvidence } from './agent-fleet-measurement.mjs';
import { buildDefaultAgentRegistry, buildStableAgentFleetMeasurement } from './agent-registry.mjs';

const timing = await import('./agent-timing-proof.mjs').catch(() => ({}));
const secret = 'task-one-explicit-fixture-secret';
const revision = '1'.repeat(40);
const now = Date.parse('2026-11-17T12:00:00.000Z');
const policyFor = (value = latency.AGENT_LATENCY_PILOT_V2) => latency.getAgentLatencyPolicy({
  PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(value),
});
const clone = (value) => JSON.parse(JSON.stringify(value));

test('frozen pilot has exact approved values', () => {
  assert.deepEqual(latency.AGENT_LATENCY_PILOT_V2, { schemaVersion: 2, channels: {
    chat: { first_token: { kind: 'fixed', ms: 1800 }, completion: { kind: 'text', baseMs: 3000, msPerCodePoint: 20 } },
    phone: { first_token: { kind: 'fixed', ms: 1800 }, completion: { kind: 'text', baseMs: 3000, msPerCodePoint: 20 },
      speech_start: { kind: 'fixed', ms: 2500 }, speech_completion: { kind: 'media', startMs: 2500, durationMultiplier: 1.10, drainMs: 2000 } },
    research: { completion: { kind: 'text', baseMs: 120000, msPerCodePoint: 20 } },
    provider: { completion: { kind: 'fixed', ms: 30000 } },
  } });
  assert(Object.isFrozen(latency.AGENT_LATENCY_PILOT_V2.channels.phone.speech_completion));
});

for (const [channel, kind, outputCodePoints, mediaDurationMs, expected] of [
  ['chat', 'first_token', undefined, undefined, 1800], ['phone', 'first_token', undefined, undefined, 1800],
  ['chat', 'completion', 3, undefined, 3060], ['phone', 'completion', 1000, undefined, 23000],
  ['phone', 'speech_start', undefined, undefined, 2500], ['phone', 'speech_completion', undefined, 10000, 15500],
  ['research', 'completion', 1000, undefined, 140000], ['provider', 'completion', undefined, undefined, 30000],
]) test(`pilot resolves ${channel}:${kind}`, () => {
  assert.deepEqual(latency.resolveAgentLatencyBudget(policyFor(), { channel, kind, outputCodePoints, mediaDurationMs }),
    { verified: true, budgetMs: expected, reason: 'verified' });
});

for (const args of [
  { channel: 'unknown', kind: 'completion' }, { channel: 'chat', kind: 'unknown' },
  ...[undefined, null, NaN, Infinity, -1, 1.5, '3', Number.MAX_SAFE_INTEGER].map(outputCodePoints => ({ channel: 'chat', kind: 'completion', outputCodePoints })),
  ...[undefined, null, NaN, Infinity, -1, Number.MAX_VALUE].map(mediaDurationMs => ({ channel: 'phone', kind: 'speech_completion', mediaDurationMs })),
]) test(`ambiguous or overflowing budget rejected ${JSON.stringify(args)}`, () => {
  assert.equal(latency.resolveAgentLatencyBudget(policyFor(), args).verified, false);
});

test('canonical policy hash is order independent and changes with rules', () => {
  const pilot = clone(latency.AGENT_LATENCY_PILOT_V2);
  const first = policyFor(pilot);
  assert.equal(first.ready, true);
  assert.equal(first.version, 2);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.hash, policyFor({ channels: pilot.channels, schemaVersion: 2 }).hash);
  pilot.channels.chat.completion.baseMs++;
  assert.notEqual(first.hash, policyFor(pilot).hash);
});

for (const invalid of [null, {}, { schemaVersion: 1 }, { schemaVersion: 2, channels: {} },
  { ...latency.AGENT_LATENCY_PILOT_V2, units: 'seconds' }]) test(`invalid v2 cannot fall back ${JSON.stringify(invalid)}`, () => {
  const policy = latency.getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(invalid),
    PBK_AGENT_LATENCY_BUDGETS_MS: JSON.stringify({ chat: { completion: 100 }, phone: { completion: 100, speech_start: 100, speech_completion: 100 }, research: { completion: 100 }, provider: { completion: 100 } }),
  });
  assert.equal(policy.ready, false);
  assert.deepEqual(policy.rules, {});
  assert.deepEqual(policy.budgets, {});
  assert.equal(policy.hash, null);
});

test('v2 is required explicitly and malformed or empty v2 is authoritative failure', () => {
  assert.equal(latency.getAgentLatencyPolicy({}, { requireVersion2: true }).version, 2);
  for (const raw of ['', '{', 2]) assert.equal(latency.getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: raw }).ready, false);
  for (const mutate of [p => { p.channels.chat.completion.kind = 'fixed'; }, p => { p.channels.phone.speech_completion.durationMultiplier = -1; },
    p => { p.channels.chat.completion.baseMs = Number.MAX_VALUE; }, p => { p.channels.chat.completion.msPerCodePoint = null; },
    p => { p.channels.other = {}; }, p => { p.channels.chat.first_token.extra = 1; }, p => { delete p.channels.research; }]) {
    const value = clone(latency.AGENT_LATENCY_PILOT_V2); mutate(value);
    assert.equal(policyFor(value).ready, false);
  }
});

function record(id, count = 10, duration = 3000, changes = {}) {
  const proof = timing.buildAgentTimingProof({ secret, revision, policy: policyFor(), agentId: 'ava', runId: id,
    channel: 'chat', startedAt: now - duration, completedAt: now, timings: { firstTokenMs: 800, completionMs: duration },
    answer: 'x'.repeat(count), provenance: 'organic', successful: true, origin: 'accepted_turn' });
  return { id, agentId: 'ava', status: 'complete', completedAt: new Date(now).toISOString(),
    metadata: { timingProof: proof }, ...changes };
}
function setup(records) {
  const policy = policyFor();
  const registry = buildDefaultAgentRegistry({ env: {}, now });
  const agent = registry.find(a => a.id === 'ava');
  const evidence = collectAgentFleetEvidence({ agentTasks: records }, { now, policy, secret, revision, requireTimingV2: true });
  return { evidence, registry, options: { now, requiredIds: ['ava'], ...evidence, latencyPolicy: policy,
    timingEvidenceSecret: secret, revision, requireTimingV2: true,
    toolCatalog: Object.fromEntries(agent.metadata.requiredTools.map(tool => [tool, true])),
    healthProbes: [{ id: 'ava', present: true, ready: true }],
    intelligenceContext: { memoryReady: true, skillsReady: true, dataFreshnessReady: true, readiness: { ready: true } },
  } };
}
const measure = (s) => buildStableAgentFleetMeasurement(s.registry, s.options);

test('v2 collector attaches proofs and scorer verifies them again', () => {
  const s = setup([record('run-1')]);
  assert.equal(measure(s).ready, true);
  const row = s.evidence.latencyObservations.ava[0];
  assert(row.proof);
  assert.deepEqual(row.binding, { agentId: 'ava', runId: 'run-1' });
  s.options.timingEvidenceSecret = 'wrong-fixture-secret';
  assert.equal(measure(s).ready, false);
});

test('long and short runs are paired before p95, never p95 elapsed versus p95 budget', () => {
  const s = setup([record('short', 1, 6000), record('long', 1000, 20000)]);
  const result = measure(s);
  assert.equal(result.ready, false);
  const group = result.agents[0].metrics.latencyByKind.chat.completion;
  assert.equal(group.p95Ms, 20000);
  assert.equal(group.minBudgetMs, 3020);
  assert.equal(group.maxBudgetMs, 23000);
  assert.equal(group.p95Ratio, 6000 / 3020);
});

test('duplicate runs do not count twice; conflicting proof bindings fail closed', () => {
  const same = record('run-1');
  const s = setup([same, clone(same)]);
  s.options.minLatencySamples = 2;
  assert.equal(measure(s).ready, false);
  assert.equal(measure(s).agents[0].metrics.latencyByKind.chat.completion.samples, 1);
  const conflict = setup([same, record('run-1', 1000)]);
  assert.equal(measure(conflict).ready, false);
});

test('legacy and expired diagnostics do not poison fresh v2 samples', () => {
  const legacy = { id: 'legacy', agentId: 'ava', completedAt: new Date(now - 1).toISOString(), status: 'complete', latencyMs: 999999, metadata: { source: 'caller' } };
  const expired = record('old');
  expired.completedAt = new Date(now - 86_400_001).toISOString();
  expired.metadata.timingProof = timing.buildAgentTimingProof({ secret, revision, policy: policyFor(), agentId: 'ava', runId: 'old',
    channel: 'chat', startedAt: now - 86_405_000, completedAt: now - 86_400_001, timings: { completionMs: 4999 },
    answer: 'Old answer', provenance: 'organic', successful: true, origin: 'accepted_turn' });
  const s = setup([record('fresh'), legacy, expired]);
  assert.equal(measure(s).ready, true);
  assert(s.evidence.diagnostics.ava.unverifiedRecords >= 2);
});

test('invalid recent proof and invalid latest business action cannot fall back to an old success', () => {
  const broken = record('bad'); broken.metadata.timingProof.outputCodePoints++;
  assert.equal(measure(setup([record('good'), broken])).ready, false);
  const latest = record('latest', 10, 3000, { status: 'cancelled' });
  assert.equal(measure(setup([record('good'), latest])).ready, false);
});

test('public labels/lengths/provenance cannot create trusted v2 evidence', () => {
  const fake = record('fake'); delete fake.metadata.timingProof;
  fake.metadata = { source: 'agent_ops', success: true, channel: 'chat', latencyKind: 'completion',
    timings: { firstTokenMs: 1, completionMs: 1 }, outputCodePoints: 99999, provenance: 'organic' };
  assert.equal(measure(setup([fake])).ready, false);
  const s = setup([record('good')]);
  s.options.latencyObservations.ava[0].valueMs = 1;
  assert.equal(measure(s).ready, false);
});

test('nested proof accepted; missing milestones and context gates stay blocked', () => {
  const item = record('nested'); item.metadata = { executionEvidence: { timingProof: item.metadata.timingProof } };
  assert.equal(measure(setup([item])).ready, true);
  const s = setup([item]); delete s.options.intelligenceContext;
  assert.equal(measure(s).ready, false);
  const proof = item.metadata.executionEvidence.timingProof;
  item.metadata.executionEvidence.timingProof = timing.buildAgentTimingProof({ secret, revision, policy: policyFor(),
    agentId: 'ava', runId: 'nested', channel: 'chat', startedAt: proof.startedAt, completedAt: proof.completedAt,
    timings: { completionMs: 3000 }, answer: 'Answer', provenance: 'organic', successful: true, origin: 'accepted_turn' });
  assert.equal(measure(setup([item])).ready, false);
});

test('same signed run with cancelled latest status cannot be hidden as a duplicate', () => {
  const good = record('same-run');
  for (const records of [[good, { ...clone(good), status: 'cancelled' }], [{ ...clone(good), status: 'cancelled' }, good]]) {
    assert.equal(measure(setup(records)).ready, false);
  }
});

test('unknown-time latest invalid action blocks independently of collection ordering', () => {
  const bad = { id: 'unknown-time', agentId: 'ava', status: 'failed', metadata: {} };
  for (const records of [[bad, record('good')], [record('good'), bad]]) assert.equal(measure(setup(records)).ready, false);
});

test('a complete run cannot hide a different run missing a required milestone', () => {
  const partial = record('partial');
  partial.metadata.timingProof = timing.buildAgentTimingProof({ secret, revision, policy: policyFor(), agentId: 'ava',
    runId: 'partial', channel: 'chat', startedAt: now - 3000, completedAt: now, timings: { completionMs: 3000 },
    answer: 'Answer', provenance: 'organic', successful: true, origin: 'accepted_turn' });
  assert.equal(measure(setup([record('complete'), partial])).ready, false);
});

test('expired signed work from an older revision and policy stays diagnostic, including duplicate mirrors', () => {
  const value = clone(latency.AGENT_LATENCY_PILOT_V2); value.channels.chat.completion.baseMs++;
  const proof = timing.buildAgentTimingProof({ secret, revision: '2'.repeat(40), policy: policyFor(value),
    agentId: 'ava', runId: 'old', channel: 'chat', startedAt: now - 86_410_000, completedAt: now - 86_400_001,
    timings: { completionMs: 9999 }, answer: 'Old answer', provenance: 'organic', successful: true, origin: 'accepted_turn' });
  const old = { id: 'old', agentId: 'ava', status: 'complete', completedAt: proof.completedAt, metadata: { timingProof: proof } };
  assert.equal(measure(setup([old, clone(old), record('fresh')])).ready, true);
});

test('scoring independently rejects copied signatures and conflicting signed run lengths', () => {
  const first = setup([record('one')]);
  const other = setup([record('one', 1000)]);
  first.options.latencyObservations.ava.push(...other.options.latencyObservations.ava);
  assert.equal(measure(first).ready, false);
  const copied = setup([record('one')]);
  for (const row of copied.options.latencyObservations.ava) { row.recordId = 'two'; row.binding.runId = 'two'; }
  assert.equal(measure(copied).ready, false);
});

test('failed/cancelled runs never count as completed samples even before a newer success', () => {
  const bad = record('failed-run', 10, 3000, { status: 'failed' });
  const good = record('newer');
  bad.metadata.timingProof = timing.buildAgentTimingProof({ secret, revision, policy: policyFor(), agentId: 'ava', runId: 'failed-run',
    channel: 'chat', startedAt: now - 3001, completedAt: now - 1, timings: { firstTokenMs: 800, completionMs: 3000 },
    answer: 'Answer', provenance: 'organic', successful: true, origin: 'accepted_turn' });
  const s = setup([bad, good]);
  assert.equal(measure(s).ready, false);
  assert.equal(s.evidence.latencySamples.ava.length, 1);
});

test('ratio arithmetic overflow cannot be filtered into a passing p95', () => {
  const value = clone(latency.AGENT_LATENCY_PILOT_V2); value.channels.chat.first_token.ms = 1e-320;
  const policy = policyFor(value);
  const proof = timing.buildAgentTimingProof({ secret, revision, policy, agentId: 'ava', runId: 'tiny-budget',
    channel: 'chat', startedAt: now - 3000, completedAt: now, timings: { firstTokenMs: 800, completionMs: 3000 },
    answer: 'Answer', provenance: 'organic', successful: true, origin: 'accepted_turn' });
  const s = setup([]);
  Object.assign(s.options, collectAgentFleetEvidence({ agentTasks: [{ id: 'tiny-budget', agentId: 'ava', status: 'complete',
    metadata: { timingProof: proof } }] }, { now, secret, revision, policy, requireTimingV2: true }), { latencyPolicy: policy });
  assert.equal(measure(s).ready, false);
});

test('structured channel/kind/status claims fail closed without object coercion', () => {
  const malformed = { toString: 'not-callable' };
  for (const args of [{ channel: malformed, kind: 'completion' }, { channel: 'chat', kind: malformed }]) {
    assert.equal(latency.resolveAgentLatencyBudget(policyFor(), args).verified, false);
  }
  assert.equal(measure(setup([record('bad-status', 10, 3000, { status: malformed })])).ready, false);
  const s = setup([record('bad-kind')]); s.options.latencyObservations.ava[0].kind = malformed;
  assert.equal(measure(s).ready, false);
});

test('round1: an empty signed timing run cannot disappear behind a complete run', () => {
  const empty = record('empty-timings');
  empty.metadata.timingProof = timing.buildAgentTimingProof({ secret, revision, policy: policyFor(), agentId: 'ava',
    runId: empty.id, channel: 'chat', startedAt: now - 3000, completedAt: now, timings: {},
    answer: 'Answer', provenance: 'organic', successful: true, origin: 'accepted_turn' });
  for (const records of [[record('complete'), empty], [empty, record('complete')]]) {
    const s = setup(records);
    assert.equal(measure(s).ready, false);
    assert(s.evidence.latencyObservations.ava.some(row => row.recordId === empty.id && row.timingV2 === true && !row.verified));
    assert.equal(s.evidence.latencySamples.ava.length, 1);
  }
});

test('round1: independent scoring cannot omit a slow signed milestone row', () => {
  const slow = record('slow-first-token');
  slow.metadata.timingProof = timing.buildAgentTimingProof({ secret, revision, policy: policyFor(), agentId: 'ava',
    runId: slow.id, channel: 'chat', startedAt: now - 3000, completedAt: now,
    timings: { firstTokenMs: 2000, completionMs: 3000 }, answer: 'Answer', provenance: 'organic', successful: true, origin: 'accepted_turn' });
  const s = setup([record('fast'), slow]);
  assert.equal(measure(s).ready, false);
  s.options.latencyObservations.ava = s.options.latencyObservations.ava.filter(row => row.recordId !== slow.id || row.kind !== 'first_token');
  const result = measure(s);
  assert.equal(result.ready, false);
  assert(result.agents[0].blockers.includes('latency_milestone_missing:chat:first_token'));
});

for (const [label, classify] of [
  ['record source', item => { item.source = 'diagnostic'; }],
  ['metadata source', item => { item.metadata.source = 'diagnostic'; }],
  ['payload preview', item => { item.metadata.workOrder = { payload: { preview: true } }; }],
  ['controlled provenance', item => { item.metadata.provenance = 'controlled'; }],
  ['execution operational flag', item => { item.metadata.executionEvidence = { operational: false }; }],
]) {
  for (const status of ['complete', 'cancelled']) test(`round1: unsigned ${label} cannot hide signed organic ${status} work`, () => {
    const contradictory = record('contradictory', 10, status === 'complete' ? 4000 : 3000, { status });
    classify(contradictory);
    for (const records of [[record('old-success'), contradictory], [contradictory, record('old-success')]]) {
      const s = setup(records);
      assert.equal(measure(s).ready, false);
      assert(s.evidence.latencyDiagnostics.ava.some(row => row.recordId === contradictory.id && row.reason === 'classification_conflict'));
      assert.equal(s.evidence.latencySamples.ava.length, 1);
    }
  });

  test(`round1: unsigned ${label} without an organic proof remains isolated`, () => {
    const controlled = record('isolated'); delete controlled.metadata.timingProof;
    classify(controlled);
    const s = setup([record('organic'), controlled]);
    assert.equal(measure(s).ready, true);
    assert.equal(s.evidence.diagnostics.ava.excludedRecords, 1);
    assert.equal(s.evidence.latencySamples.ava.length, 1);
    assert(!s.evidence.latencyObservations.ava.some(row => row.recordId === controlled.id));
  });
}
