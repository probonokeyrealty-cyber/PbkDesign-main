import { randomBytes } from 'node:crypto';
import {
  closureBinding, createClosureIntent, projectClosureApproval, signClosureReceipt,
} from '../dead-letter-closure-protocol.mjs';

// Synthetic protocol values only: this fixture does not confer database authority.
export function makeClosureFixture({ action = 'close_internal', memory = 'completed' } = {}) {
  const secret = randomBytes(32).toString('base64');
  const revision = 'b'.repeat(40);
  const now = Date.parse('2026-11-17T12:00:01.000Z');
  const approvalId = 'approval_fixture';
  const bind = (domain, value) => closureBinding(secret, domain, value);
  const recordRef = bind('record-ref', 'synthetic-record');
  const originalBinding = bind('original', { id: 'synthetic-record', dead: true });
  const selectionBinding = bind('selection', { canonical: null, event: 'synthetic-event' });
  const manifest = {
    schemaVersion: 'pbk-dead-letter-handler-manifest-v1', recordRef, originalBinding,
    selectionBinding, policyVersion: 'dead-letter-handler-v1',
    steps: [
      { id: 'qa', outcome: 'completed', artifactRef: bind('artifact', 'qa'),
        binding: bind('qa', 'synthetic-proof'), executedAt: '2026-11-17T11:59:40.000Z' },
      { id: 'memory', outcome: memory, artifactRef: bind('artifact', 'memory'),
        binding: bind('memory', 'synthetic-proof'), executedAt: '2026-11-17T11:59:41.000Z' },
      { id: 'scriptOutcome', outcome: 'not_applicable', artifactRef: null,
        binding: bind('script-outcome-applicability', {
          recordRef, originalBinding, selectionBinding, policyVersion: 'dead-letter-handler-v1',
          stepId: 'scriptOutcome', outcome: 'not_applicable',
        }), executedAt: null },
    ],
  };
  const predecessor = action === 'revoke_internal'
    ? { id: 'receipt_prior', hash: bind('prior-receipt', 'synthetic-prior') } : null;
  const intent = createClosureIntent({ approvalId, action, recordRef, manifest, predecessor, revision,
    createdAt: '2026-11-17T11:59:50.000Z', secret });
  const approval = {
    id: approvalId, workspace_id: 'pbk', type: 'admin', status: 'approved',
    lead_id: null, contract_id: null, decided_at: '2026-11-17T11:59:55.000Z',
    created_at: '2026-11-17T11:59:50.000Z', updated_at: '2026-11-17T11:59:55.000Z',
    payload: { id: approvalId, type: 'admin', status: 'approved',
      approvalAction: 'dead_letter_internal_closure', actedAt: '2026-11-17T11:59:55.000Z',
      actor: 'synthetic-operator', metadata: { deadLetterClosureIntent: intent } },
  };
  const report = {
    schemaVersion: 'pbk-dead-letter-closure-v1', tenantId: 'pbk', receiptId: 'receipt_fixture',
    ordinal: '1', admittedAt: '2026-11-17T12:00:00.100123Z', insertXid: '12',
    recordRef, originalBinding, manifestBinding: bind('manifest', manifest),
    policyVersion: 'dead-letter-handler-v1', approvalRef: bind('approval-ref', approvalId),
    intentBinding: bind('intent', intent), decisionBinding: bind('approval-decision', projectClosureApproval(approval)),
    action, predecessor, revision, observedAt: '2026-11-17T12:00:00.000Z',
    completedAt: '2026-11-17T12:00:00.500Z', approvalExpiresAt: intent.expiresAt,
    manifest, intent,
    guard: { counts: null, noContact: true, providerWritesBlocked: true, deliveryRetries: false,
      providerDeliveryVerified: false, launchQualified: false },
  };
  report.attestation = { version: report.schemaVersion, signature: signClosureReceipt({ report, secret }) };
  const row = {
    id: report.receiptId, tenant_id: 'pbk', ordinal: report.ordinal, admitted_at: report.admittedAt,
    insert_xid: report.insertXid, record_ref: recordRef, approval_ref: report.approvalRef,
    intent_binding: report.intentBinding, action, previous_id: predecessor?.id ?? null, report,
  };
  return { secret, revision, now, approvalId, manifest, intent, approval, report, row };
}
