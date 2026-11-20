import assert from 'node:assert/strict';
import test from 'node:test';
import { readOutlookDelivery } from '../src/app/utils/outlookDelivery.mjs';

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
