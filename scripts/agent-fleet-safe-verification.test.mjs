import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { buildSafeFleetPlan, createVerifierRequest, requireLocalRegistry,
  validateDeploymentCommit, validateDiagnosticResult, validatePersistedDiagnostics } from './agent-fleet-safe-verification.mjs';

test('all eleven diagnostic recipes are explicit and cannot certify freshness', () => {
  const plan = buildSafeFleetPlan('unit-test');
  assert.equal(plan.length, 11);
  assert.equal(new Set(plan.map((entry) => entry.agentId)).size, 11);
  for (const entry of plan) {
    assert(entry.invoke);
    assert(entry.limitation);
    assert.equal(entry.invoke.payload.source, 'synthetic-fleet-verification');
    assert.equal(entry.invoke.payload.allowImplicitContext, false);
    assert.equal(entry.invoke.payload.noProviderWrites, true);
    assert.equal(entry.invoke.payload.smoke, true);
    assert.equal(entry.invoke.payload.sourceUpdatedAt, undefined);
    assert.match(entry.invoke.payload.leadId, /^diagnostic-fleet-unit-test-/);
  }
  assert.throws(() => buildSafeFleetPlan('../unsafe'));
});

test('isolated privilege cannot be used with a hosted or nonliteral loopback URL', () => {
  for (const url of ['https://example.com', 'https://127.0.0.1', 'http://localhost:1234']) {
    assert.throws(() => createVerifierRequest(url, 'synthetic-key', { isolated: true }));
  }
  assert.doesNotThrow(() => createVerifierRequest('http://127.0.0.1:1234', 'synthetic-key', { isolated: true }));
});

test('hosted invocation and mutation paths fail before network access', async () => {
  const request = createVerifierRequest('https://example.com', 'synthetic-key');
  for (const path of ['/api/agents/invoke', '/state', '/api/agents/registry/health', '/health']) {
    await assert.rejects(request(path, {}), /Hosted invocation is disabled/);
  }
});

test('registry preflight rejects duplicate, remote and inactive routes', () => {
  const good = { id: 'ava', status: 'active', endpoint: '/invoke', metadata: { local: true } };
  assert.equal(requireLocalRegistry({ agents: [good] }, 'ava'), good);
  for (const agents of [[], [good, good], [{ ...good, status: 'degraded' }],
    [{ ...good, endpoint: 'https://example.com' }], [{ ...good, metadata: { local: false } }]]) {
    assert.throws(() => requireLocalRegistry({ agents }, 'ava'));
  }
});

function persistedFixture() {
  const diagnostics = buildSafeFleetPlan('persist-test').map(({ agentId }, index) => ({
    agentId, workOrderId: `work-${index}`, contextId: `context-${index}`,
    routedTo: `invokeRegisteredAgent:${agentId}`,
  }));
  const state = { agentTasks: diagnostics.map((entry) => ({
    id: entry.workOrderId, status: 'complete', metadata: {
      workOrder: { agentId: entry.agentId, source: 'synthetic-fleet-verification' },
      routedTo: entry.routedTo, pbkIntelligenceContext: { contextId: entry.contextId },
      executionEvidence: { operational: false },
    },
  })) };
  return { diagnostics, state };
}

test('durable diagnostic links do not certify production storage or cross-agent workflows', () => {
  const { diagnostics, state } = persistedFixture();
  const result = validatePersistedDiagnostics(diagnostics, state);
  assert.equal(result.taskCount, 11);
  assert.equal(result.productionStorageVerified, false);
  assert.equal(result.sourceFreshnessVerified, false);
  assert.equal(result.crossAgentWorkflowVerified, false);
});

for (const defect of ['missing', 'duplicate', 'running', 'wrong-agent', 'wrong-context', 'wrong-source', 'wrong-route', 'operational']) {
  test(`durable proof rejects ${defect}`, () => {
    const { diagnostics, state } = persistedFixture();
    const task = state.agentTasks[0];
    if (defect === 'missing') state.agentTasks.shift();
    if (defect === 'duplicate') state.agentTasks.push(task);
    if (defect === 'running') task.status = 'running';
    if (defect === 'wrong-agent') task.metadata.workOrder.agentId = 'other';
    if (defect === 'wrong-context') task.metadata.pbkIntelligenceContext.contextId = 'other';
    if (defect === 'wrong-source') task.metadata.workOrder.source = 'production';
    if (defect === 'wrong-route') task.metadata.routedTo = 'other';
    if (defect === 'operational') task.metadata.executionEvidence.operational = true;
    assert.throws(() => validatePersistedDiagnostics(diagnostics, state));
  });
}

test('missing or reused work orders cannot pass fleet coverage', () => {
  const { diagnostics, state } = persistedFixture();
  assert.throws(() => validatePersistedDiagnostics(diagnostics.slice(1), state));
  diagnostics[1].workOrderId = diagnostics[0].workOrderId;
  assert.throws(() => validatePersistedDiagnostics(diagnostics, state));
});

function diagnosticFixture() {
  const entry = buildSafeFleetPlan('validation').find((item) => item.agentId === 'hermes');
  const routedTo = 'invokeRegisteredAgent:hermes';
  const result = {
    ok: true, result: 'agent_invoked', routedTo,
    agent: { id: 'hermes', status: 'active', endpoint: '/invoke', metadata: { local: true } },
    output: { ok: true, result: 'hermes_registry_status', safety: { suggestOnly: true } },
    workOrder: { id: 'work', agentId: 'hermes', source: 'synthetic-fleet-verification',
      approvalPolicy: { providerWriteIntent: false, approvalRequired: false } },
    agentTask: { id: 'work', status: 'complete', metadata: { routedTo } },
    pbkIntelligenceContext: { contextId: 'context', identity: { leadId: entry.invoke.payload.leadId },
      readiness: { required: { agentCoverage: true }, ready: false }, dataFreshnessReady: false },
  };
  return { entry, result };
}

test('status handler success is explicitly synthetic, not readiness proof', () => {
  const { entry, result } = diagnosticFixture();
  const validated = validateDiagnosticResult(entry, result);
  assert.equal(validated.contextReady, false);
  assert.equal(validated.evidence, 'synthetic_local_handler_diagnostic');
  assert.match(validated.limitation, /not a strategist request/);
});

for (const field of ['freshness', 'readiness', 'nested-failure', 'task-identity']) {
  test(`diagnostic validation rejects fabricated ${field}`, () => {
    const { entry, result } = diagnosticFixture();
    if (field === 'freshness') result.pbkIntelligenceContext.dataFreshnessReady = true;
    if (field === 'readiness') result.pbkIntelligenceContext.readiness.ready = true;
    if (field === 'nested-failure') result.output.ok = false;
    if (field === 'task-identity') result.agentTask.id = 'other';
    assert.throws(() => validateDiagnosticResult(entry, result));
  });
}

test('release verification distinguishes reported commit prefix from full SHA proof', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const prefix = validateDeploymentCommit({ ok: true, release: { commit: sha.slice(0, 12) } }, sha);
  assert.equal(prefix.matchedCharacters, 12);
  assert.equal(prefix.fullShaVerified, false);
  assert.equal(prefix.deploymentHealthVerified, false);
  assert.equal(validateDeploymentCommit({ ok: true, release: { commit: sha } }, sha).fullShaVerified, true);
  for (const commit of ['', '0123456', '2026-bridge-version', 'a'.repeat(40)]) {
    assert.throws(() => validateDeploymentCommit({ ok: true, release: { commit } }, sha));
  }
  assert.throws(() => validateDeploymentCommit({ ok: true, release: { commit: sha } }, sha.slice(0, 7)));
  assert.throws(() => validateDeploymentCommit({ ok: false, release: { commit: sha } }, sha));
});
