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
