import assert from 'node:assert/strict';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge({ startupMs: 60000 });
const root = `/api/admin/reconciliation/dead-letters/${'a'.repeat(64)}`;
const founder = { authorization: `Bearer ${child.apiKey}`, 'content-type': 'application/json' };
async function request(path, body, headers = founder, method = body === undefined ? 'GET' : 'POST') {
  const response = await child.fetch(child.origin + path, { method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
try {
  const before = (await request('/state')).data;
  assert.equal((await request(root + '/propose', {}, {})).status, 401);
  for (const action of ['preview', 'propose', 'propose-revocation']) {
    const body = action === 'preview' ? undefined : {};
    for (const header of ['x-pbk-team-token', 'x-pbk-netlify-proxy', 'x-forwarded-authorization']) {
      assert.equal((await request(root + '/' + action, body, { ...founder, [header]: '' })).status, 403);
    }
    const missing = await request(root + '/' + action, body);
    assert.equal(missing.status, 503); assert.equal(missing.data.ok, false);
    assert.equal(missing.data.providerWritesBlocked, true);
  }
  for (const action of ['apply', 'execute']) assert.equal((await request(root + '/' + action, {})).status, 404);
  for (const body of [{ status: 'approved' }, { approvalId: 'chosen' }, { manifest: {} },
    { action: 'revoke_internal' }, { now: 0 }, { secret: 'forged' }, []]) {
    assert.equal((await request(root + '/propose', body)).status, 400);
  }
  assert.equal((await request(root + '/propose?status=approved', {})).status, 400);
  assert.equal((await request(root + '/preview?report=forged')).status, 400);
  for (const path of [root + '/propose/', root + '/%70ropose', root.replace('/dead-letters/', '/dead-letters/bad/') + '/propose',
    root + '/propose/execute', root + '/propose%252Fexecute']) {
    assert((await request(path, {})).status >= 400, path);
  }
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await request(root + '/propose', {}, founder, method)).status, 400);
  assert.equal((await request(root + '/propose')).status, 400);
  const invoke = await request('/invoke', { toolName: 'executeDeadLetterClosure', params: { approvalId: 'forged' } });
  assert(invoke.status >= 400 || invoke.data.ok === false);
  const maturity = (await request('/api/production/maturity')).data;
  assert.equal(maturity.deadLetterClosures.verified, false); assert.equal(maturity.deadLetterClosures.counts, null);
  assert.equal(maturity.deadLetterClosures.launchQualified, false); assert.equal(maturity.deadLetterClosures.providerDeliveryVerified, false);
  assert.equal(maturity.backlogReconciliation.verified, false); assert.equal(maturity.backlogReconciliation.memoryPolicyOutcomes.verified, false);
  assert.equal(maturity.operationalAudit.ready, false); assert.equal(maturity.executionEvidence.silentErrorReport.launchReady, false);
  assert.equal(maturity.canaryPromotionGate.ready, false); assert.equal(maturity.ready, false);
  const after = (await request('/state')).data;
  for (const lane of ['approvals', 'calls', 'messages', 'contracts', 'leadImports']) assert.deepEqual(after[lane], before[lane], lane);
  console.log('dead-letter-closure-bridge-smoke: ok (isolated; network/provider senders denied; no live records, leases or retries)');
} finally { await child.stop(); }
