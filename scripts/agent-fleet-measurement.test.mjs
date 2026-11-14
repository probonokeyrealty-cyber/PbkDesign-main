import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { buildAgentExecutionEvidence, collectAgentFleetEvidence } from './agent-fleet-measurement.mjs';
import { buildDefaultAgentRegistry, buildStableAgentFleetMeasurement } from './agent-registry.mjs';

const at = '2026-11-14T12:00:00.000Z';
const now = Date.parse(at);
const record = (overrides = {}) => ({ id: 'ops-1', agentId: 'ava', status: 'complete', completedAt: at, latencyMs: 6544, metadata: { source: 'agent_ops', success: true }, ...overrides });
const collect = (records) => collectAgentFleetEvidence({ agentTasks: records }, { now });

test('real ops evidence retains slow sample and source link', () => {
  const result = collect([record()]);
  assert.deepEqual(result.latencySamples.ava, [6544]);
  assert.equal(result.lastActions.ava.status, 'success');
  assert.equal(result.lastActions.ava.recordId, 'ops-1');
});

for (const duration of [null, undefined, '', false, -1, NaN]) {
  test(`missing or invalid duration ${duration} does not become zero`, () => {
    const result = collect([record({ latencyMs: duration })]);
    assert.equal(result.latencySamples.ava, undefined);
    assert.equal(result.diagnostics.ava.state, 'instrumentation_gap');
  });
}

test('legacy duration remains visible but legacy success is unproven', () => {
  const result = collect([record({ metadata: {} })]);
  assert.equal(result.latencySamples.ava, undefined);
  assert.deepEqual(result.unverifiedLatencySamples.ava, [6544]);
  assert.equal(result.lastActions.ava.status, 'unverified');
  assert.equal(result.diagnostics.ava.state, 'provenance_missing');
});

for (const metadata of [{ source: 'agent_ops' }, { source: 'agent_ops', success: false }, { source: 'caller', success: true }]) {
  test(`source and explicit success required: ${JSON.stringify(metadata)}`, () => {
    assert.notEqual(collect([record({ metadata })]).lastActions.ava.status, 'success');
  });
}

test('future and invalid timestamps cannot establish success', () => {
  for (const completedAt of ['bad', '2027-01-01T00:00:00Z']) assert.notEqual(collect([record({ completedAt })]).lastActions.ava.status, 'success');
});

for (const flag of ['smoke', 'synthetic', 'preview', 'dryRun', 'diagnostic']) {
  test(`${flag} evidence is excluded, never proof`, () => {
    const result = collect([record({ [flag]: true })]);
    assert.equal(result.lastActions.ava, undefined);
    assert.equal(result.latencySamples.ava, undefined);
    assert.equal(result.diagnostics.ava.state, 'no_operational_use_observed');
  });
}

test('duplicate persisted rows do not inflate sample counts', () => {
  assert.equal(collectAgentFleetEvidence({ agentTasks: [record()], agentDecisions: [record()] }, { now }).latencySamples.ava.length, 1);
});

test('handler ready and preview returns do not become completed work', () => {
  for (const output of [{ ok: true, result: 'nurture_agent_handler_ready' }, { ok: true, status: 'completed', preview: true }, { ok: true, result: 'status' }, { ok: true }]) {
    assert.equal(buildAgentExecutionEvidence({ output, completedAt: at, durationMs: 5, workOrderId: 'work-1' }).success, false);
  }
});

test('strict fleet measurement ignores health timing and ages source evidence', () => {
  const registry = buildDefaultAgentRegistry({ env: {} });
  const options = { now, requireSourceProvenance: true, healthProbes: [{ id: 'ava', ready: true, present: true, latencyMs: 5 }], intelligenceContext: { identity: { leadId: 'lead-1' }, memoryReady: true, skillsReady: true, dataFreshness: { ready: true, lastSyncAt: at, source: { kind: 'runtime_lead_record', recordId: 'lead-1', at } }, readiness: { ready: true } } };
  const fresh = buildStableAgentFleetMeasurement(registry, options).agents[0];
  assert(fresh.blockers.includes('latency_not_sampled'));
  assert(!fresh.blockers.includes('dataFreshness_not_ready'));
  const stale = buildStableAgentFleetMeasurement(registry, { ...options, now: now + 60_001 }).agents[0];
  assert(stale.blockers.includes('dataFreshness_not_ready'));
  assert(stale.blockers.includes('fleetReadiness_not_ready'));
});
