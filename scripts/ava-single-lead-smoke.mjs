import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const bridge = await startIsolatedBridge({
  entry: fileURLToPath(new URL('./fixtures/empty-lead-bridge.mjs', import.meta.url)),
  startupMs: 30_000,
});
const staffHeaders = {
  Authorization: 'Bearer ' + bridge.apiKey,
  'Content-Type': 'application/json',
};

async function request(path, body, expectedStatus = 200) {
  const response = await bridge.fetch(bridge.origin + path, {
    headers: staffHeaders,
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, expectedStatus, path + ' returned ' + String(data.code || data.error || response.status));
  return data;
}

try {
  const health = await request('/health');
  assert.equal(health.runtime.security.providerWritesApprovalGated, true);
  assert.equal(health.components.telnyx.configured, false, 'The isolated runtime must have no Telnyx configuration');
  const emptyRoster = await request('/api/leads');
  assert.equal(emptyRoster.leads.length, 0, 'Start each run with an empty roster');
  const emptyQueue = await request('/api/founder/work-queue');
  assert.equal(emptyQueue.items.length, 0, 'Start each run with an empty Today queue');

  const fixturePhone = '+12135550146';
  const created = await request('/api/leads', {
    name: 'PBK Fictional Test Lead',
    address: '100 Example Vista Blvd, Los Angeles, CA',
    source: 'manual',
    email: 'pbk-one-lead@example.invalid',
    phone: fixturePhone,
  });
  assert.equal(created.ok, true);
  const { leadId } = created;
  assert.ok(leadId, 'The fixture should have a saved lead ID');
  const leadPath = '/api/leads/' + encodeURIComponent(leadId) + '/full?review=ava';
  const roster = await request('/api/leads');
  assert.deepEqual(roster.leads.map((lead) => lead.leadId || lead.id), [leadId]);

  const queue = await request('/api/founder/work-queue');
  assert.equal(queue.items.length, 0, 'A fresh lead without a priority score should not be labeled hot');
  const avaQueue = await request('/api/assistant/chat', {
    message: 'What should I work on today?',
  });
  assert.equal(avaQueue.toolResult.result, 'today_work_queue_summary');
  assert.equal(avaQueue.toolResult.itemCount, queue.items.length);
  assert.equal(avaQueue.toolResult.openCommand, 'Open Leads');
  assert.equal(avaQueue.toolPlan.providerWrite, false);

  const anonymous = await bridge.fetch(bridge.origin + leadPath);
  assert.equal(anonymous.status, 401, 'Saved lead evidence requires staff authentication');
  const anonymousBody = await anonymous.json();
  assert.equal(anonymousBody.review, undefined);
  assert.doesNotMatch(JSON.stringify(anonymousBody), /Example Vista Blvd/);

  const missingSelection = await request('/api/assistant/chat', {
    message: 'Review this lead',
  });
  assert.equal(missingSelection.assistantAction, 'saved_lead_review_requires_selection');
  assert.equal(missingSelection.toolPlan, null);

  const staleSelection = await request('/api/assistant/chat', {
    message: 'Review this lead',
    leadId: 'removed-fictional-lead',
  });
  assert.equal(staleSelection.toolResult.result, 'ava_lead_review_not_found');
  assert.equal(staleSelection.toolResult.evidence, undefined);
  assert.doesNotMatch(staleSelection.answer, /Example Vista Blvd/);

  const { review } = await request(leadPath);
  const avaReview = await request('/api/assistant/chat', {
    message: 'Review this lead',
    leadId,
  });
  assert.equal(avaReview.toolResult.result, 'ava_lead_review_summary');
  assert.equal(avaReview.toolResult.leadId, leadId);
  assert.equal(avaReview.toolPlan.providerWrite, false);
  assert.deepEqual(avaReview.toolResult.nextStep, review.nextStep);
  assert.equal(avaReview.toolResult.evidence.property.recorded, true);
  assert.equal(avaReview.toolResult.evidence.underwriting.recorded, false);
  assert.ok(avaReview.toolResult.evidence.qualification.missing.length > 0);
  const afterReview = await request(leadPath);
  assert.deepEqual(afterReview.review.evidence, review.evidence);
  assert.deepEqual(afterReview.review.nextStep, review.nextStep);

  const { approval } = await request('/api/approvals', {
    type: 'offer',
    leadId,
    offerPrice: 250000,
  });
  assert.ok(approval?.id, 'The fixture offer should create an approval record');
  const prioritized = await request('/api/assistant/chat', {
    message: 'What should I work on today?',
  });
  assert.equal(prioritized.toolResult.pendingApprovals, 1);
  assert.equal(prioritized.toolResult.openCommand, 'Open Approvals');
  assert.equal(prioritized.toolPlan.providerWrite, false);
  const pending = await request('/api/approvals?status=pending');
  assert.ok(pending.approvals.some((item) => item.id === approval.id),
    'Reading the queue must leave the fixture approval pending');

  const email = await request('/api/lead/send-message', {
    leadId,
    channel: 'email',
    email: 'pbk-one-lead@example.invalid',
    subject: 'Offline approval test',
    message: 'Fictional follow-up for the isolated test.',
    manual: true,
    manualSend: true,
    source: 'lead_portal_manual',
  }, 202);
  assert.equal(email.result, 'queued_for_approval');
  assert.equal(email.approval.status, 'pending');
  assert.equal(email.approval.approvalAction, 'sendColdEmail');
  assert.equal(email.providerAttempted, false);
  assert.equal(email.outbox.status, 'queued');

  const finalQueue = await request('/api/founder/work-queue');
  assert.equal(finalQueue.summary.approvals, 2);
  assert.equal(finalQueue.summary.activeCalls, 0);
  const finalRoster = await request('/api/leads');
  assert.deepEqual(finalRoster.leads.map((lead) => lead.leadId || lead.id), [leadId]);

  const denied = await request('/api/approvals/' + encodeURIComponent(email.approval.id) + '/deny', {
    actor: 'Fictional test operator',
  });
  assert.equal(denied.ok, true);
  assert.equal(denied.approval.status, 'rejected');
  const remaining = await request('/api/approvals?status=pending');
  assert.deepEqual(remaining.approvals.map((item) => item.id), [approval.id],
    'Denial must remove only the email from the pending queue');

  const afterDenial = await request('/api/assistant/chat', {
    message: 'What should I work on today?',
  });
  assert.equal(afterDenial.toolResult.pendingApprovals, 1);
  assert.equal(afterDenial.toolResult.openCommand, 'Open Approvals');
  assert.equal(afterDenial.toolPlan.providerWrite, false);

  async function queueFixtureSms(message) {
    const sms = await request('/api/lead/send-message', {
      leadId,
      channel: 'sms',
      phone: fixturePhone,
      message,
      manual: true,
      manualSend: true,
      nowLocalHour: 12,
      source: 'lead_portal_manual',
    }, 202);
    assert.equal(sms.result, 'queued_for_approval');
    assert.equal(sms.approval.status, 'pending');
    assert.equal(sms.approval.approvalAction, 'telnyx_sms');
    assert.ok(sms.approval.metadata.actionBinding?.hash);
    assert.equal(sms.providerAttempted, false);
    assert.equal(sms.outbox.status, 'queued');
    return sms.approval.id;
  }

  const smsToDeny = await queueFixtureSms('Fictional SMS for the denial case.');
  const smsToApprove = await queueFixtureSms('Fictional SMS for the offline approval case.');
  assert.notEqual(smsToDeny, smsToApprove);

  const smsDenial = await request('/api/approvals/' + encodeURIComponent(smsToDeny) + '/deny', {
    actor: 'Fictional test operator',
  });
  assert.equal(smsDenial.approval.status, 'rejected');
  assert.equal(smsDenial.providerActionResult, null);

  const smsApproval = await request('/api/approvals/' + encodeURIComponent(smsToApprove) + '/approve', {
    actor: 'Fictional test operator',
  });
  assert.equal(smsApproval.approval.status, 'approved');
  const dispatch = smsApproval.providerActionResult;
  assert.equal(dispatch.telnyx.configured, false);
  assert.equal(dispatch.telnyx.live, false);
  assert.equal(dispatch.telnyx.simulated, true);
  assert.equal(dispatch.message.leadId, leadId);
  assert.equal(dispatch.message.provider, 'Simulated');
  assert.equal(dispatch.message.status, 'simulated', 'Offline approval must report simulated SMS status');
  assert.equal(dispatch.message.providerMessageId, '');
  assert.equal(dispatch.message.providerAttemptId, '');
  assert.equal(dispatch.providerAttempted, false);
  const smsProof = smsApproval.approval.metadata.providerProof;
  assert.equal(smsProof.proofStatus, 'simulated');
  assert.equal(smsProof.attempt, undefined);
  assert.deepEqual(smsProof.receipts, []);

  const pendingAfterSms = await request('/api/approvals?status=pending');
  assert.deepEqual(pendingAfterSms.approvals.map((item) => item.id), [approval.id]);
  const inbox = await request('/api/messages');
  const smsMessages = inbox.messages.filter((item) => item.channel === 'sms');
  assert.deepEqual(smsMessages.map((item) => item.id), [dispatch.message.id],
    'The approved simulation may appear locally and denial must create no message');
  assert.equal(smsMessages[0].status, 'simulated');
  assert.ok(inbox.messages.every((item) => !['sent', 'delivered'].includes(item.status)));
  const calls = await request('/api/calls');
  assert.equal(calls.count, 0, 'The fixture must have no call records');

  console.log('One-lead smoke passed: private review, Today queue, email and SMS decisions, and no calls.');
} finally {
  await bridge.stop();
}
