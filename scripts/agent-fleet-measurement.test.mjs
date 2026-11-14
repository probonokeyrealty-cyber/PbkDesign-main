import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { buildAgentExecutionEvidence, collectAgentFleetEvidence, isAgentHandlerCompletion } from './agent-fleet-measurement.mjs';
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

const completions = {
  ava: { ok: true, routedTo: 'agent_brain', response: { ok: true, answer: 'One useful answer.' } },
  rex: { answer: 'A sourced strategy answer.', citations: ['PBK fixture knowledge'] },
  hermes: { ok: true, result: 'strategist_response', strategy: 'Suggest an approval-safe next step.', provider: 'hermes' },
  max: { ok: true, result: 'max_contract_handoff_ready', closing: { ok: true, result: 'closing_intelligence', nextBestPhrase: 'An approval-safe offer recap.' }, safety: { approvalGate: true } },
  'script-rotator': { ok: true, result: 'closing_intelligence', nextBestPhrase: 'One appropriate closing phrase.', citations: ['PBK knowledge'] },
  'call-analyzer': { ok: true, result: 'call_analysis_complete', analyzed: 1, analyses: [{ id: 'analysis-1', callId: 'call-1', status: 'analyzed', score: 80 }] },
  'prosody-tuner': { ok: true, result: 'prosody_advice', prosody: { emotion: 'hesitant', speed: 0.9, stability: 0.6, similarityBoost: 0.8 } },
  'bant-enforcer': { ok: true, result: 'bant_enforcer_status', complete: true, missing: [], bant: { budget: 100000, authority: 'owner', need: 'sale', timeline: '30 days', urgency: 'relocation' } },
  'qa-agent': { ok: true, skipped: false, qa: { ok: true, skipped: false, validator: 'analyzeDeal' }, auditRecord: { id: 'qa-1' } },
  'nurture-agent': { ok: true, result: 'recommendation', lead: { id: 'lead-1' }, recommendation: { channel: 'sms', urgency: 'now', reason: 'Warm lead' } },
  'research-orchestrator': { ok: true, result: 'halt', flags: ['dnc_or_stop_request'], intervention: 'Stop outreach.', safety: { canOverrideAva: true, providerWrites: 'blocked_without_approval' } },
};

for (const [agentId, output] of Object.entries(completions)) {
  test(`${agentId} substantive completion has explicit semantic proof`, () => {
    assert.equal(isAgentHandlerCompletion(agentId, output), true);
    assert.equal(buildAgentExecutionEvidence({ agentId, output, completedAt: at, durationMs: 5, workOrderId: 'work-1' }).success, true);
    assert.equal(isAgentHandlerCompletion(agentId, { ok: true }), false);
    assert.equal(isAgentHandlerCompletion(agentId, { ok: true, status: 'completed' }), false);
    assert.equal(isAgentHandlerCompletion(agentId, { ...output, ok: false }), false);
  });
}

test('broken substantive proof fails rather than trusting returned handler names', () => {
  for (const [agentId, output] of Object.entries(completions)) {
    const broken = { ok: true, result: output.result, routedTo: output.routedTo };
    assert.equal(isAgentHandlerCompletion(agentId, broken), false, agentId);
  }
  assert.equal(isAgentHandlerCompletion('unknown', { ok: true, status: 'complete' }), false);
  assert.equal(isAgentHandlerCompletion('hermes', { ...completions.hermes, result: 'local_fallback' }), false);
  assert.equal(isAgentHandlerCompletion('qa-agent', { ...completions['qa-agent'], skipped: true }), false);
  assert.equal(isAgentHandlerCompletion('bant-enforcer', { ...completions['bant-enforcer'], missing: ['authority'] }), false);
  assert.equal(isAgentHandlerCompletion('bant-enforcer', { ...completions['bant-enforcer'], bant: { random: true } }), false);
  assert.equal(isAgentHandlerCompletion('call-analyzer', { ...completions['call-analyzer'], analyzed: 2 }), false);
});

test('semantic BANT proof survives persisted collection without admitting status-only tasks', () => {
  const output = completions['bant-enforcer'];
  const executionEvidence = buildAgentExecutionEvidence({ agentId: 'bant-enforcer', output, completedAt: at, durationMs: 8, workOrderId: 'bant-1' });
  const item = { id: 'bant-1', agentId: 'bant-enforcer', status: 'complete', completedAt: at,
    metadata: { workOrder: { id: 'bant-1' }, outputResult: output.result, executionEvidence } };
  assert.equal(collect([item]).lastActions['bant-enforcer']?.status, 'success');
  delete item.metadata.executionEvidence.handlerCompletionVerified;
  assert.equal(collect([item]).lastActions['bant-enforcer'], undefined);
});

test('Hermes local pattern work is explicit and suggest-only, never provider status', () => {
  const output = { ok: true, result: 'hermes_pattern_analysis', provider: 'pbk-local-pattern-analysis',
    pattern: { workflow: { trigger: 'Seller objection', steps: ['Acknowledge concern', 'Ask permission'] } },
    strategy: 'Acknowledge concern; Ask permission', safety: { suggestOnly: true, providerWrites: 'blocked' } };
  assert.equal(isAgentHandlerCompletion('hermes', output), true);
  for (const broken of [{ ...output, pattern: {} }, { ...output, safety: { suggestOnly: false, providerWrites: 'blocked' } },
    { ...output, strategy: '' }, { ...output, provider: 'hermes' }]) assert.equal(isAgentHandlerCompletion('hermes', broken), false);
});

for (const marker of [{ source: 'controlled-qualification' }, { qualification: true }, { controlledQualification: true }, { operational: false }]) {
  test(`controlled qualification cannot enter organic evidence: ${JSON.stringify(marker)}`, () => {
    const evidence = buildAgentExecutionEvidence({ agentId: 'ava', payload: marker, output: completions.ava, workOrderId: 'work-1' });
    assert.equal(evidence.operational, false);
    assert.equal(evidence.success, false);
    assert.equal(collect([record({ ...marker })]).lastActions.ava, undefined);
  });
}

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
