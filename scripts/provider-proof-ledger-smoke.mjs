import assert from 'node:assert/strict';

import {
  buildProviderAttempt,
  normalizeProviderReceipt,
  summarizeProviderProof,
} from './provider-proof-ledger.mjs';

const attempt = buildProviderAttempt({
  approvalId: 'approval-sms-1',
  provider: 'telnyx',
  actionType: 'sms.send',
  actorType: 'ava',
  idempotencyKey: 'lead-1:sms:hello',
});

assert.equal(attempt.status, 'attempted');
assert.equal(attempt.approvalId, 'approval-sms-1');
assert.equal(attempt.idempotencyKey, 'lead-1:sms:hello');

const delivered = normalizeProviderReceipt({
  provider: 'telnyx',
  eventType: 'message.delivered',
  providerMessageId: 'msg-123',
  raw: { data: { event_type: 'message.delivered' } },
});

assert.equal(delivered.status, 'delivered');
assert.equal(delivered.providerMessageId, 'msg-123');

const summary = summarizeProviderProof({
  attempt,
  receipts: [delivered],
});

assert.equal(summary.proofStatus, 'confirmed');
assert.equal(summary.needsReconciliation, false);

console.log('provider proof ledger smoke passed');
