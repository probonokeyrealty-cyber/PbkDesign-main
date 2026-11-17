import assert from 'node:assert/strict';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge({ startupMs: 60_000 });
const path = '/api/admin/reconciliation/run';
const founder = { Authorization: `Bearer ${child.apiKey}`, 'Content-Type': 'application/json' };
async function request(url, body, headers = founder, method = body === undefined ? 'GET' : 'POST') {
  const response = await child.fetch(child.origin + url, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

try {
  const before = (await request('/state')).data;
  assert.equal((await request(path, {}, {})).status, 401);
  for (const delegated of [{ 'X-PBK-Team-Token': 'fixture' }, { 'X-PBK-Netlify-Proxy': 'fixture' },
    { 'X-PBK-Team-Token': '' }, { 'X-PBK-Netlify-Proxy': '' }]) {
    assert.equal((await request(path, {}, { ...founder, ...delegated })).status, 403);
  }
  for (const body of [{ passed: true }, { receipts: [] }, { approvalId: 'fixture' },
    { retry: true }, { resolve: true }, { unlock: true }, { dryRun: false }, []]) {
    assert.equal((await request(path, body)).status, 400);
  }
  assert.equal((await request(path + '?resolve=true', {})).status, 400);
  assert.equal((await request(path)).status, 400);
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal((await request(path, {}, founder, method)).status, 400);
  }
  const missing = await request(path, {});
  assert.equal(missing.status, 503);
  assert.equal(missing.data.verified, false);
  const maturity = (await request('/api/production/maturity')).data;
  assert.equal(maturity.backlogReconciliation.verified, false);
  assert.equal(maturity.backlogReconciliation.launchQualified, false);
  assert.equal(maturity.backlogReconciliation.providerWritesBlocked, true);
  assert.equal(maturity.backlogReconciliation.noContact, true);
  assert.equal(maturity.backlogReconciliation.memoryPolicyOutcomes.verified, false);
  assert.equal(maturity.backlogReconciliation.memoryPolicyOutcomes.launchQualified, false);
  assert.equal(maturity.backlogReconciliation.memoryPolicyOutcomes.counts, null);
  const orchestration = (await request('/api/agents/orchestration')).data.orchestration;
  assert.equal(orchestration.latencyPolicy.ready, false);
  assert.deepEqual(orchestration.latencyPolicy.budgets, {});
  assert(orchestration.measurement.blockers.includes('latency_policy_not_ready'));
  assert.equal(maturity.operationalAudit.ready, false);
  assert.equal(maturity.executionEvidence.silentErrorReport.launchReady, false);
  assert.equal(maturity.canaryPromotionGate.ready, false);
  assert.equal(maturity.ready, false);
  const after = (await request('/state')).data;
  assert.equal(after.status.mode, before.status.mode);
  assert.deepEqual(after.approvals, before.approvals);
  for (const lane of ['calls', 'messages', 'contracts', 'leadImports']) {
    assert.deepEqual(after[lane], before[lane], lane);
  }
  console.log('backlog-reconciliation-bridge-smoke: ok (isolated; no delivery tools or source mutations)');
} finally {
  await child.stop();
}
