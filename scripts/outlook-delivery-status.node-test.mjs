import assert from 'node:assert/strict';
import test from 'node:test';
import { readOutlookDelivery, normalizeOutlookReceiptUrl } from '../src/app/utils/outlookDelivery.mjs';

const approval = {
  id: 'approval-1', leadId: 'lead-1', approvalAction: 'sendColdEmail', status: 'approved',
  metadata: { executionParams: { provider: 'outlook', subject: 'PBK Ava Outlook test' } },
};

test('the original Outlook result proves provider acceptance only', () => {
  const record = readOutlookDelivery({ ...approval, metadata: {
    ...approval.metadata, providerActionResult: { ok: true, result: 'live', callProvider: 'Outlook' },
    providerActionDispatch: { status: 'completed' },
  } });
  assert.equal(record.state, 'accepted');
  assert.equal(record.subject, 'PBK Ava Outlook test');
  assert.equal(record.receiptId, '');
});

test('an unresolved dispatch takes precedence over an earlier provider result', () => {
  assert.equal(readOutlookDelivery({ ...approval, metadata: {
    ...approval.metadata, providerActionResult: { ok: true, result: 'live' },
    providerActionDispatch: { status: 'reconciliation_required' },
  } }).state, 'recovery');
});

test('receipt IDs stay attached and non-Outlook actions are excluded', () => {
  const metadata = { ...approval.metadata, providerActionResult: {
    ok: true, deliveryStatus: 'accepted', providerRequestId: 'receipt-1',
  } };
  assert.equal(readOutlookDelivery({ ...approval, metadata }).receiptId, 'receipt-1');
  assert.equal(readOutlookDelivery({ ...approval, approvalAction: 'telnyx_sms', metadata }), null);
  assert.equal(readOutlookDelivery(approval).state, 'approved');
});

test('operator-confirmed receipt shows delivery while preserving the original dispatch status', () => {
  const receiptUrl = 'https://mail.google.com/mail/u/0/#inbox/1234567890abcdef';
  const saved = { receiptUrl, confirmedAt: '2026-11-20T22:55:00Z', confirmedBy: 'PBK operator' };
  const record = readOutlookDelivery({ ...approval, metadata: {
    ...approval.metadata, outlookDeliveryConfirmation: saved,
    providerActionDispatch: { status: 'reconciliation_required' },
  } });
  assert.equal(record.state, 'delivered');
  assert.deepEqual(record.confirmation, saved);
  assert.equal(record.canConfirm, false);
  assert.equal(normalizeOutlookReceiptUrl(receiptUrl), receiptUrl);
  assert.equal(normalizeOutlookReceiptUrl('https://mail.google.com.evil.test/mail/u/0/#inbox/1234567890abcdef'), '');
  assert.equal(normalizeOutlookReceiptUrl('https://mail.google.com/mail/u/0/#inbox'), '');
});

test('historical seller PDF approvals can reconcile a missing outcome and display delivery', () => {
  const legacy = { ...approval, approvalAction: 'sendSellerDocs', provider: 'system',
    metadata: { requestedTool: 'sendSellerDocs', executionParams: {
      source: 'seller_docs_manual', address: 'PBK QA Fixture', selectedDocuments: ['seller'],
    } },
  };
  const pending = readOutlookDelivery({ ...legacy, status: 'pending' });
  assert.equal(pending.canConfirm, false);
  const record = readOutlookDelivery(legacy);
  assert.equal(record.state, 'recovery');
  assert.equal(record.canConfirm, true);
  assert.equal(record.subject, 'Your property at PBK QA Fixture - document package');
  const updated = readOutlookDelivery({ ...legacy, metadata: { ...legacy.metadata,
    outlookDeliveryConfirmation: {
      receiptUrl: 'https://outlook.office365.com/mail/deeplink/read/AAMkAGI2TAAA_test==',
      confirmedAt: '2026-11-24T10:00:00Z', confirmedBy: 'PBK operator',
    },
  } });
  assert.equal(updated.state, 'delivered');
  assert.equal(updated.canConfirm, false);
});

test('an explicitly reconciled unsent PDF is terminal and distinct from provider failures', () => {
  const pdf = { ...approval, approvalAction: 'sendSellerDocs' };
  const metadata = {
    ...approval.metadata,
    providerActionDispatch: { status: 'completed' },
    providerActionResult: { ok: false, result: 'outlook_not_sent', deliveryStatus: 'not_sent' },
    outlookDeliveryReconciliation: { status: 'unsent' },
  };

  const closed = readOutlookDelivery({ ...pdf, metadata });
  assert.equal(closed.state, 'unsent');
  assert.equal(closed.canConfirm, false);

  const failed = readOutlookDelivery({ ...pdf, metadata: {
    ...metadata, providerActionResult: { ok: false, result: 'outlook_send_rejected' },
  } });
  assert.equal(failed.state, 'failed');

  const unresolved = readOutlookDelivery({ ...pdf, metadata: {
    ...metadata, providerActionDispatch: { status: 'reconciliation_required' },
  } });
  assert.equal(unresolved.state, 'recovery');

  const delivered = readOutlookDelivery({ ...pdf, metadata: {
    ...metadata, outlookDeliveryConfirmation: {
      receiptUrl: 'https://outlook.office365.com/mail/deeplink/read/AAMkAGI2TAAA_test==',
      confirmedAt: '2026-11-24T10:00:00Z', confirmedBy: 'PBK operator',
    },
  } });
  assert.equal(delivered.state, 'delivered');
});
