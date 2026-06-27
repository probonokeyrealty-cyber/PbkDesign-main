import assert from 'node:assert/strict';

import { buildComplianceAuditEvent } from './compliance-audit-trail.mjs';

const event = buildComplianceAuditEvent({
  leadId: 'lead-1',
  approvalId: 'approval-docusign-1',
  actionType: 'docusign.send',
  decision: 'approval_required',
  requiredApproval: true,
  approvalStatus: 'pending',
  provider: 'docusign',
  providerResult: 'not_attempted',
  evidence: {
    policy: 'proof_policy_autonomy',
    reason: 'DocuSign send requires founder approval before dispatch',
  },
});

assert.equal(event.workspaceId, 'pbk', 'workspace defaults to pbk');
assert.equal(event.actorType, 'system', 'actor type defaults to system');
assert.equal(event.actionType, 'docusign.send', 'action type is preserved');
assert.equal(event.decision, 'approval_required', 'decision is preserved');
assert.equal(event.requiredApproval, true, 'required approval is true');
assert.equal(event.provider, 'docusign', 'provider is preserved');
assert.equal(event.providerResult, 'not_attempted', 'provider result is preserved');
assert.equal(
  event.evidence.policy,
  'proof_policy_autonomy',
  'evidence object is preserved'
);
assert.match(event.createdAt, /^\d{4}-\d{2}-\d{2}T/, 'createdAt is ISO-like');

const stringFalseEvent = buildComplianceAuditEvent({
  requiredApproval: 'false',
  createdAt: 'not-a-date',
});

assert.equal(
  stringFalseEvent.requiredApproval,
  false,
  'string false should not become requiredApproval=true'
);
assert.match(
  stringFalseEvent.createdAt,
  /^\d{4}-\d{2}-\d{2}T/,
  'invalid createdAt should fall back to an ISO timestamp'
);

console.log('[compliance-audit-trail-smoke] ok');
