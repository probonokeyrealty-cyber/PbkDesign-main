import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { requiredAgentRegistryIds } from './agent-registry.mjs';
import { qualificationCriteria, validateQualificationReport, validateQualificationAging, createQualificationRequest, runControlledQualification } from './agent-fleet-controlled-qualification.mjs';

const at = '2026-11-14T12:00:00.000Z';
function fixture() {
  return {
    schemaVersion: 'pbk-controlled-qualification-v1', runId: 'test-run', source: 'controlled-qualification',
    productionReadinessVerified: false, organicReadinessPromoted: false,
    guard: { atomic: true, noContact: true, externalWritesBlocked: true, fixtureOnly: true },
    storage: { backend: 'postgres', readbackVerified: true },
    fixture: { leadId: 'qualification-lead', callId: 'qualification-call', sourceUpdatedAt: at },
    agents: requiredAgentRegistryIds.map((agentId, index) => ({
      agentId, completed: true, outputResult: 'actual_handler_result', workOrderId: `task-${index}`,
      contextId: `context-${index}`, runId: 'test-run', leadId: 'qualification-lead', callId: 'qualification-call',
      sourceUpdatedAt: at, completedAt: at, durable: true, operational: false,
      criteria: Object.fromEntries(qualificationCriteria[agentId].map((key) => [key, true])),
      evidenceRecordIds: [`record-${index}`],
    })),
  };
}

test('controlled qualification validates eleven genuine correlated handlers without organic promotion', () => {
  const result = validateQualificationReport(fixture(), { now: Date.parse(at) });
  assert.equal(result.qualifiedAgentCount, 11);
  assert.equal(result.productionReadinessVerified, false);
});

for (const defect of ['missing-agent', 'duplicate-task', 'wrong-run', 'wrong-call', 'operational', 'criterion',
  'no-record', 'status-only', 'not-pg', 'not-durable', 'guard', 'organic', 'expired', 'future', 'restamped']) {
  test(`qualification fails closed for ${defect}`, () => {
    const report = fixture();
    const agent = report.agents[0];
    if (defect === 'missing-agent') report.agents.pop();
    if (defect === 'duplicate-task') agent.workOrderId = report.agents[1].workOrderId;
    if (defect === 'wrong-run') agent.runId = 'other';
    if (defect === 'wrong-call') agent.callId = 'other';
    if (defect === 'operational') agent.operational = true;
    if (defect === 'criterion') agent.criteria[qualificationCriteria.ava[0]] = false;
    if (defect === 'no-record') agent.evidenceRecordIds = [];
    if (defect === 'status-only') agent.outputResult = 'qa_agent_registered';
    if (defect === 'not-pg') report.storage.backend = 'file';
    if (defect === 'not-durable') agent.durable = false;
    if (defect === 'guard') report.guard.atomic = false;
    if (defect === 'organic') report.organicReadinessPromoted = true;
    if (defect === 'restamped') agent.sourceUpdatedAt = '2026-11-14T12:00:00.001Z';
    const now = Date.parse(at) + (defect === 'expired' ? 60001 : defect === 'future' ? -1 : 0);
    assert.throws(() => validateQualificationReport(report, { now }));
  });
}

test('freshness aging preserves source identity and rejects timestamp refresh on readback', () => {
  const before = fixture();
  const after = JSON.parse(JSON.stringify(before));
  assert.equal(validateQualificationAging(before, after, { now: Date.parse(at) + 60001 }).sourceExpired, true);
  after.fixture.sourceUpdatedAt = '2026-11-14T12:01:00.001Z';
  assert.throws(() => validateQualificationAging(before, after, { now: Date.parse(at) + 60001 }));
});

test('qualification transport rejects arbitrary handlers and client-supplied fixture data before network', async () => {
  const request = createQualificationRequest('https://example.com', 'unit-only-key');
  for (const [path, body] of [['/api/agents/invoke', {}], ['/state'], ['/api/agents/controlled-qualification', { dryRun: true }],
    ['/api/agents/controlled-qualification?runId=../customer'], ['/health', {}]]) {
    await assert.rejects(request(path, body));
  }
  assert.throws(() => createQualificationRequest('https://example.com/path', 'unit-only-key'));
  assert.throws(() => createQualificationRequest('https://example.com', ''));
});

test('controlled run refuses unreviewed guard before making any request', async () => {
  let called = false;
  await assert.rejects(runControlledQualification(async () => { called = true; }, { expectedRevision: 'a'.repeat(40) }));
  assert.equal(called, false);
});

test('controlled run verifies deployment and independent readback, not POST assertions alone', async () => {
  const report = fixture();
  const calls = [];
  const request = async (path, body) => {
    calls.push({ path, body });
    if (path === '/health') return { features: { authRequired: true, stateBackend: 'postgres' } };
    if (path === '/api/release/status') return { ok: true, release: { commit: 'a'.repeat(40) } };
    if (path === '/api/agents/controlled-qualification' && body) return report;
    if (path === '/api/agents/controlled-qualification?runId=test-run') return JSON.parse(JSON.stringify(report));
    throw new Error('Unexpected request');
  };
  const result = await runControlledQualification(request, { expectedRevision: 'a'.repeat(40), reviewedGuardRevision: 'a'.repeat(40), now: () => Date.parse(at) });
  assert.equal(result.qualifiedAgentCount, 11);
  assert.equal(calls.filter((item) => item.body).length, 1);
  assert.equal(calls.at(-1).path, '/api/agents/controlled-qualification?runId=test-run');
});

test('aging verification waits for original source expiry and independently reads stored evidence again', async () => {
  let now = Date.parse(at);
  const report = fixture();
  let reads = 0;
  const request = async (path) => {
    if (path === '/health') return { features: { authRequired: true, stateBackend: 'postgres' } };
    if (path === '/api/release/status') return { ok: true, release: { commit: 'a'.repeat(40) } };
    if (path.includes('?')) reads++;
    return JSON.parse(JSON.stringify(report));
  };
  const result = await runControlledQualification(request, { expectedRevision: 'a'.repeat(40), reviewedGuardRevision: 'a'.repeat(40), now: () => now,
    verifyAging: true, wait: async (ms) => { assert.equal(ms, 60001); now += ms; } });
  assert.equal(reads, 2);
  assert.equal(result.freshnessAgingVerified, true);
  assert.equal(result.agedSourceExpired, true);
});
