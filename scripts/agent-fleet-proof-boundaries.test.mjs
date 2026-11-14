import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { collectAgentFleetEvidence, isNonOperationalAgentEvidence } from './agent-fleet-measurement.mjs';
import { buildDefaultAgentRegistry, buildStableAgentFleetMeasurement, requiredAgentRegistryIds } from './agent-registry.mjs';
import { buildPBKIntelligenceContext } from './pbk-intelligence-context.mjs';
import { clearPBKIntelligenceContextSessions, loadPBKIntelligenceContextFromSession,
  savePBKIntelligenceContextToSession } from './pbk-intelligence-context-runtime.mjs';

const at = '2026-11-14T12:00:00.000Z';
const now = Date.parse(at);

test('unverified latency cannot dilute operational percentiles', () => {
  const result = collectAgentFleetEvidence({ agentTasks: [
    { id: 'legacy', agentId: 'ava', status: 'complete', completedAt: at, latencyMs: 1 },
    { id: 'verified', agentId: 'ava', status: 'complete', completedAt: at,
      metadata: { workOrder: { id: 'verified' }, executionEvidence: { source: 'registry_execution', workOrderId: 'verified',
        operational: true, success: true, durationMs: 3500, completedAt: at } } },
  ] }, { now });
  assert.deepEqual(result.latencySamples.ava, [3500]);
  assert.deepEqual(result.unverifiedLatencySamples.ava, [1]);
});

test('registry execution proof must belong to the persisted work order', () => {
  const result = collectAgentFleetEvidence({ agentTasks: [{
    id: 'actual', agentId: 'ava', status: 'complete', completedAt: at,
    metadata: { executionEvidence: { source: 'registry_execution', workOrderId: 'different',
      operational: true, success: true, durationMs: 5, completedAt: at } },
  }] }, { now });
  assert.notEqual(result.lastActions.ava?.status, 'success');
  assert.deepEqual(result.latencySamples.ava || [], []);
});

function strictFixture() {
  const registry = buildDefaultAgentRegistry({ env: {} }).map((agent) => ({
    ...agent, status: 'active', healthCheckedAt: at, health_checked_at: at,
  }));
  const options = {
    now, requireSourceProvenance: true,
    toolCatalog: Object.fromEntries(registry.flatMap((agent) => agent.metadata.requiredTools.map((tool) => [tool, true]))),
    healthProbes: registry.map(({ id }) => ({ id, ready: true, present: true, lastSeen: at })),
    latencySamples: Object.fromEntries(registry.map(({ id }) => [id, [100, 150, 200]])),
    lastActions: Object.fromEntries(registry.map(({ id }) => [id, { status: 'success', at }])),
    intelligenceContext: {
      identity: { leadId: 'lead-a', callId: 'call-a' },
      memory: { ready: true }, skills: { ready: true }, fleetReadiness: { ready: true },
      dataFreshness: { ready: true, lastSyncAt: at, maxAgeMs: 60000,
        source: { kind: 'runtime_call_record', recordId: 'call-a', at } },
    },
  };
  return { registry, options };
}

test('strict measurement accepts matching fresh authoritative origin', () => {
  const { registry, options } = strictFixture();
  assert.equal(buildStableAgentFleetMeasurement(registry, options).ready, true);
});

for (const defect of ['other-record', 'unrecognized-kind', 'expired', 'future']) {
  test(`strict freshness rejects ${defect}`, () => {
    const { registry, options } = strictFixture();
    const freshness = options.intelligenceContext.dataFreshness;
    if (defect === 'other-record') freshness.source.recordId = 'call-b';
    if (defect === 'unrecognized-kind') freshness.source.kind = 'caller_claim';
    if (defect === 'expired') options.now += 60001;
    if (defect === 'future') options.now -= 1;
    assert.equal(buildStableAgentFleetMeasurement(registry, options).ready, false);
  });
}

test('caller full context cannot bypass authoritative rebuilding or diagnostic marking', async () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function prepareAgentActionPBKIntelligenceContext(');
  const end = source.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start);
  let passedInput;
  const authoritative = { diagnostic: true, identity: { leadId: 'synthetic-lead' }, dataFreshness: { lastSyncAt: null } };
  const sandbox = vm.createContext({
    state: { agents: [] },
    getAgentActionContextIds: () => ({ leadId: 'synthetic-lead', callId: '' }),
    isFullAgentActionPBKIntelligenceContext: () => true,
    buildAgentActionPBKIntelligenceContextInput: () => authoritative,
    withPBKIntelligenceContext: async (options, handler) => { passedInput = options.input; return handler(options.input); },
    publishAgentActionPBKIntelligenceContext() {},
  });
  vm.runInContext(source.slice(start, end), sandbox);
  await sandbox.prepareAgentActionPBKIntelligenceContext({ smoke: true,
    pbkIntelligenceContext: { diagnostic: false, identity: { leadId: 'other' },
      dataFreshness: { ready: true, lastSyncAt: at }, memory: {}, skills: {}, turnContract: {} },
  });
  assert.equal(passedInput, authoritative);
});

for (const flags of [{ synthetic: true }, { source: 'synthetic-fleet-verification' }, { smoke: true }]) {
  test(`stored synthetic source cannot certify freshness: ${JSON.stringify(flags)}`, () => {
    const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
    const start = source.indexOf('function buildRuntimePBKIntelligenceContext(');
    const end = source.indexOf('\n}', start) + 2;
    assert(start >= 0 && end > start);
    const sandbox = vm.createContext({
      buildPBKIntelligenceContext, isNonOperationalAgentEvidence,
      ensureAgentFleetCollections() {}, sortNewest: (items) => items,
      state: { agents: requiredAgentRegistryIds.map((id) => ({ id })), skillOutcomes: [],
        calls: [{ id: 'fixture-call', leadId: 'fixture-lead', updatedAt: new Date().toISOString(), ...flags }] },
      isoNow: () => new Date().toISOString(),
    });
    vm.runInContext(source.slice(start, end), sandbox);
    const context = sandbox.buildRuntimePBKIntelligenceContext({
      contextCall: { id: 'fixture-call', leadId: 'fixture-lead' },
      scripts: { activeMemories: [{ id: 'lesson' }], selectedSkills: [{ id: 'skill' }] },
      turnContract: { ok: true, intent: 'qualification' },
    });
    assert.equal(context.dataFreshness.ready, false);
  });
}

test('diagnostic and operational contexts with identical identities remain isolated in cache', async () => {
  clearPBKIntelligenceContextSessions();
  try {
    const operational = buildPBKIntelligenceContext({
      leadId: 'same-lead', callId: 'same-call', diagnostic: false,
      memory: { coaching: [{ id: 'operational-memory' }] },
    });
    const diagnostic = buildPBKIntelligenceContext({
      leadId: 'same-lead', callId: 'same-call', diagnostic: true,
      memory: { coaching: [{ id: 'diagnostic-memory' }] },
    });
    const savedOperational = await savePBKIntelligenceContextToSession(operational);
    const savedDiagnostic = await savePBKIntelligenceContextToSession(diagnostic);
    const options = { leadId: 'same-lead', callId: 'same-call' };
    assert.equal(await loadPBKIntelligenceContextFromSession(options), savedOperational);
    assert.equal(await loadPBKIntelligenceContextFromSession({ ...options, input: { diagnostic: true } }), savedDiagnostic);
    const replacedOperational = await savePBKIntelligenceContextToSession({ ...operational, outcome: { actionTaken: 'new-operational-action' } });
    assert.equal(await loadPBKIntelligenceContextFromSession(options), replacedOperational);
    assert.equal(await loadPBKIntelligenceContextFromSession({ ...options, input: { diagnostic: true } }), savedDiagnostic);
  } finally {
    clearPBKIntelligenceContextSessions();
  }
});
