import assert from 'node:assert/strict';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge();
const headers = { Authorization: `Bearer ${child.apiKey}`, 'Content-Type': 'application/json' };
async function post(path, body) {
  const response = await child.fetch(child.origin + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return response.json();
}
try {
  await post('/api/leads', { id: 'fixture-lead', leadId: 'fixture-lead', seller: { name: '[PBK QA] Approval fixture', phone: '+15555550123' } });
  const created = await post('/api/approvals', { type: 'offer', leadId: 'fixture-lead', offerPrice: 90000 });
  const approvalId = created.approval?.id;
  assert.ok(approvalId);
  await post(`/api/approvals/${approvalId}/approve`, { actor: 'PBK QA' });
  const result = await post('/invoke', {
    toolName: 'telnyx_sms', params: { approvalId, leadId: 'fixture-lead', phone: '+15555550123', body: 'Fixture only', nowLocalHour: 12 },
  });
  assert.equal(result.result?.result, 'approval_binding_mismatch', 'An unrelated approved offer must not authorize SMS');
  assert.equal(result.result.providerAttempted, false);
  const override = await post('/invoke', {
    toolName: 'avaOverrideOffer', params: {
      approvalId, leadId: 'fixture-lead', finalOffer: 100000, mao: 120000,
      bant: { budget: '100000', authority: 'owner', need: 'sell', timeline: '30 days', urgency: 'soon' },
      ownerVerified: true, authorityConfirmed: true,
    },
  });
  assert.equal(override.result?.result, 'approval_binding_mismatch', 'An unrelated approval must not override an offer');
  const approvedParams = { leadId: 'fixture-lead', phone: '+15555550123', body: 'Bound fixture only', nowLocalHour: 12 };
  const bound = await post('/api/approvals', {
    type: 'provider-action', approvalAction: 'telnyx_sms', leadId: 'fixture-lead',
    metadata: { requestedTool: 'telnyx_sms', executionParams: approvedParams, actionBinding: { hash: 'caller-supplied' } },
  });
  assert.notEqual(bound.approval.metadata.actionBinding.hash, 'caller-supplied', 'Binding must be computed by the bridge');
  const decided = await post(`/api/approvals/${bound.approval.id}/approve`, { actor: 'PBK QA' });
  assert.equal(decided.approval.metadata.providerActionDispatch?.status, 'completed', JSON.stringify(decided.providerActionResult));
  for (const changed of [{ body: 'Changed' }, { phone: '+15555550124' }]) {
    const mismatch = await post('/invoke', {
      toolName: 'telnyx_sms', params: { ...approvedParams, ...changed, approvalId: bound.approval.id },
    });
    assert.equal(mismatch.result.result, 'approval_binding_mismatch');
    assert.equal(mismatch.result.providerAttempted, false);
  }
  const replay = await post('/invoke', {
    toolName: 'telnyx_sms', params: { ...approvedParams, approvalId: bound.approval.id },
  });
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.result.providerAttempted, false);
  assert.equal(replay.result.providerProof.attemptToken, decided.approval.metadata.providerProof.attemptToken);
  await post('/api/leads', { id: 'bound-contact', leadId: 'bound-contact', seller: { name: '[PBK QA] Bound contact', phone: '+15555550125' } });
  const resolved = await post('/api/approvals', {
    type: 'provider-action', approvalAction: 'telnyx_sms', leadId: 'bound-contact',
    metadata: { executionParams: { leadId: 'bound-contact', from: '+15555550120', body: 'Exact contact fixture' } },
  });
  assert.equal(resolved.approval.metadata.executionParams.phone, '+15555550125', 'Resolve contact before approval, not at dispatch');
  const patchResponse = await child.fetch(child.origin + '/api/leads/bound-contact', {
    method: 'PATCH', headers, body: JSON.stringify({ seller: { phone: '+15555550126' } }),
  });
  assert.equal(patchResponse.status, 200);
  const changedContext = await post(`/api/approvals/${resolved.approval.id}/approve`, { actor: 'PBK QA' });
  assert.equal(changedContext.providerActionResult.result, 'approval_binding_mismatch', 'Changed contact context requires new approval');
  const phoneOnly = await post('/api/approvals', {
    type: 'provider-action', approvalAction: 'telnyx_sms',
    metadata: { executionParams: { phone: '+15555550127', from: '+15555550120', body: 'Phone-only fixture' } },
  });
  const phoneOnlyDecision = await post(`/api/approvals/${phoneOnly.approval.id}/approve`, { actor: 'PBK QA' });
  assert.equal(phoneOnlyDecision.approval.metadata.providerActionDispatch?.status, 'completed', 'Creating the approval must not invalidate its own context');
  console.log('approval-action-safety-smoke: ok (isolated, no provider writes)');
} finally {
  await child.stop();
}
