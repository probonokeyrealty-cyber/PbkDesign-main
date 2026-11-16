import { expect, test } from '@jest/globals';
import { createProviderActionBinding, hashProviderActionContext, validateProviderActionAuthorization, validateNegotiationApproval } from './provider-action-authorization.mjs';

const now = Date.parse('2026-11-15T12:00:00Z');
const params = { leadId: 'lead-a', phone: '+15555550123', body: 'Exact approved words', amount: 100000 };
function approved() {
  const approval = {
    id: 'approval-a', type: 'provider-action', status: 'approved', approvalAction: 'telnyx_sms',
    createdAt: new Date(now).toISOString(), metadata: { executionParams: { ...params } },
  };
  approval.metadata.actionBinding = createProviderActionBinding({
    approvalId: approval.id, toolName: approval.approvalAction, params, createdAt: approval.createdAt,
  });
  return approval;
}
const validate = (approval, input = params, toolName = 'telnyx_sms', at = now) =>
  validateProviderActionAuthorization({ approval, params: input, toolName, now: at });

test('JSONB object key order does not change context authority', () => {
  expect(hashProviderActionContext({ lead: { phone: 'fixture', details: { a: 1, b: 2 } }, contracts: [] }))
    .toBe(hashProviderActionContext({ contracts: [], lead: { details: { b: 2, a: 1 }, phone: 'fixture' } }));
});

test('matches exact approved action despite key order and transport approval ID', () => {
  expect(validate(approved(), { amount: 100000, body: params.body, phone: params.phone, leadId: 'lead-a', approvalId: 'approval-a', actor: 'Operator' }).ok).toBe(true);
});
test.each([
  { phone: '+15555550124' }, { body: 'Changed words' }, { amount: 100001 },
  { leadId: 'lead-b' }, { workspaceId: 'other' }, { manual: true },
])('rejects changed approved payload %j', (patch) => {
  expect(validate(approved(), { ...params, ...patch })).toMatchObject({ ok: false, result: 'approval_binding_mismatch', providerAttempted: false });
});
test('rejects wrong tool, legacy binding, altered stored payload, changed ID and pending status', () => {
  expect(validate(approved(), params, 'sendColdEmail').ok).toBe(false);
  const legacy = approved(); delete legacy.metadata.actionBinding;
  expect(validate(legacy).result).toBe('approval_binding_required');
  const altered = approved(); altered.metadata.executionParams.body = 'Changed';
  expect(validate(altered).result).toBe('approval_binding_mismatch');
  const otherId = approved(); otherId.id = 'another-approval';
  expect(validate(otherId).ok).toBe(false);
  const pending = approved(); pending.status = 'pending';
  expect(validate(pending).result).toBe('approval_required');
});
test('rejects expired/future/invalid dates and extended expiry', () => {
  expect(validate(approved(), params, 'telnyx_sms', now + 86400000).result).toBe('approval_expired');
  expect(validate(approved(), params, 'telnyx_sms', now - 1).result).toBe('approval_expired');
  const invalid = approved(); invalid.metadata.actionBinding.expiresAt = 'not-a-date';
  expect(validate(invalid).ok).toBe(false);
  const extended = approved(); extended.metadata.actionBinding.expiresAt = new Date(now + 172800000).toISOString();
  expect(validate(extended).ok).toBe(false);
});
test('resolved business context is part of approval authority', () => {
  const approval = approved();
  approval.metadata.actionBinding = createProviderActionBinding({
    approvalId: approval.id, toolName: approval.approvalAction, params, createdAt: approval.createdAt, contextHash: 'lead-and-sender-v1',
  });
  const input = { approval, toolName: 'telnyx_sms', params, now };
  expect(validateProviderActionAuthorization({ ...input, contextHash: 'lead-and-sender-v1' }).ok).toBe(true);
  expect(validateProviderActionAuthorization({ ...input, contextHash: 'changed-lead' }).result).toBe('approval_binding_mismatch');
});
test('negotiation authority is scoped to the approved lead, amount, workspace and script', () => {
  const approval = { type: 'negotiation', status: 'approved', approvalAction: 'approve_negotiation_counter',
    createdAt: new Date(now).toISOString(), leadId: 'lead-a', offerPrice: 100000, metadata: { avaFinalScript: 'Approved script' } };
  const input = { approval, leadId: 'lead-a', finalOffer: 100000, now };
  expect(validateNegotiationApproval(input)).toBe(true);
  for (const patch of [{ leadId: 'lead-b' }, { finalOffer: 100001 }, { tenantId: 'other' }, { avaScript: 'Different authority' }, { now: now + 86400000 }]) {
    expect(validateNegotiationApproval({ ...input, ...patch })).toBe(false);
  }
});
