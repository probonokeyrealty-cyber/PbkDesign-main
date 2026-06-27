import assert from 'node:assert/strict';

import { decideAvaAction } from './ava-action-decision-policy.mjs';

assert.equal(
  decideAvaAction({ actionType: 'crm.update', confidence: 0.92, evidenceCount: 2 }).decision,
  'autonomous',
  'high-confidence CRM enrichment can be autonomous'
);

assert.equal(
  decideAvaAction({ actionType: 'sms.send', source: 'ava', confidence: 0.99 }).decision,
  'approval_required',
  'Ava SMS sends require approval'
);

for (const actionType of [
  'sms.send',
  'email.send',
  'call.start',
  'docusign.send',
  'campaign.launch',
  'offer.send',
]) {
  assert.equal(
    decideAvaAction({ actionType, source: 'ava', confidence: 0.99 }).decision,
    'approval_required',
    `${actionType} requires approval when proposed by Ava`
  );
}

assert.equal(
  decideAvaAction({ actionType: 'email.send', source: 'manual', safetyPassed: true }).decision,
  'autonomous',
  'manual operator email can execute without approval after safety passes'
);

for (const actionType of ['sms.send', 'email.send']) {
  const decision = decideAvaAction({ actionType, source: 'manual', safetyPassed: true });
  assert.equal(
    decision.decision,
    'autonomous',
    `${actionType} manual one-to-one message can execute after safety passes`
  );
  assert.equal(
    decision.providerWriteAllowed,
    true,
    `${actionType} manual one-to-one message allows provider write after safety passes`
  );
}

for (const actionType of ['docusign.send', 'campaign.launch', 'offer.send', 'call.start']) {
  const decision = decideAvaAction({ actionType, source: 'manual', safetyPassed: true });
  assert.equal(
    decision.decision,
    'approval_required',
    `${actionType} manual action still requires approval after safety passes`
  );
  assert.equal(
    decision.providerWriteAllowed,
    false,
    `${actionType} manual action cannot write provider without approval`
  );
}

assert.equal(
  decideAvaAction({
    actionType: 'docusign.send',
    source: 'ava',
    approvalState: 'approved',
    safetyPassed: true,
  }).decision,
  'autonomous',
  'approved DocuSign can execute after safety passes'
);

for (const safetyInput of [{}, { safetyPassed: false }]) {
  const decision = decideAvaAction({
    actionType: 'docusign.send',
    source: 'ava',
    approvalState: 'approved',
    ...safetyInput,
  });
  assert.equal(
    decision.decision,
    'approval_required',
    'approved DocuSign without safety validation requires approval routing'
  );
  assert.equal(
    decision.providerWriteAllowed,
    false,
    'approved DocuSign without safety validation cannot write provider'
  );
  assert.equal(
    decision.reason,
    'provider_write_requires_safety_validation',
    'approved DocuSign without safety validation returns safety validation reason'
  );
}

{
  const decision = decideAvaAction({
    actionType: 'docusign.send',
    source: 'ava',
    approvalState: 'approved',
    safetyPassed: true,
  });
  assert.equal(decision.decision, 'autonomous');
  assert.equal(decision.providerWriteAllowed, true);
  assert.equal(decision.approvalRequired, false);
}

assert.equal(
  decideAvaAction({ actionType: 'docusign.send', source: 'ava', approvalState: 'approved' }).decision,
  'approval_required',
  'approved DocuSign still requires safety validation'
);

assert.equal(
  decideAvaAction({ actionType: 'sms.send', stopLanguageDetected: true }).decision,
  'blocked',
  'STOP/DNC language blocks outreach'
);

for (const flag of [
  'stopLanguageDetected',
  'dncMatched',
  'quietHours',
  'consentMissing',
  'legalAdviceRequested',
  'taxAdviceRequested',
  'threatDetected',
]) {
  assert.equal(
    decideAvaAction({ actionType: 'sms.send', [flag]: true }).decision,
    'blocked',
    `${flag} blocks the action`
  );
}

assert.equal(
  decideAvaAction({ actionType: 'crm.update', disputeDetected: true }).decision,
  'handoff',
  'disputes hand off to an operator'
);

assert.equal(
  decideAvaAction({ actionType: 'lead.note', confidence: 0.7, evidenceCount: 0 }).decision,
  'log_only',
  'sufficient-confidence lead note is log-only'
);

assert.equal(
  decideAvaAction({ actionType: 'lead.note', confidence: 0.3, evidenceCount: 0 }).decision,
  'ask',
  'low confidence asks before writing'
);

assert.equal(
  decideAvaAction({ actionType: 'unknown.workflow', confidence: 0.95, evidenceCount: 10 }).decision,
  'ask',
  'unknown actions ask instead of guessing'
);

assert.equal(
  decideAvaAction({ actionType: 'sms.send', humanRequested: true }).decision,
  'handoff',
  'human request hands off before approval routing'
);

console.log('[ava-action-decision-policy-smoke] ok');
