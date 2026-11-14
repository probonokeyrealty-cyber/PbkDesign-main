import test from 'node:test';
import assert from 'node:assert/strict';
const policy = await import('../supabase/functions/pbk-investor-staging/entryPolicy.mjs').catch(
  () => ({})
);
const investorOrigin = 'https://pbk-investors-staging.netlify.app';
const staffOrigin = 'https://pbk-investor-staging--pbkcenter.netlify.app';

test('public investor entry rejects staff identities and unapproved investors', () => {
  assert.equal(typeof policy.assertEntryMember, 'function');
  for (const member of [
    { role: 'reviewer', approved: true },
    { role: 'editor', approved: true },
    { role: 'investor', approved: false },
  ])
    assert.throws(
      () => policy.assertEntryMember(investorOrigin, member),
      (e) => e.status === 403
    );
  assert.doesNotThrow(() =>
    policy.assertEntryMember(investorOrigin, { role: 'investor', approved: true })
  );
  assert.doesNotThrow(() =>
    policy.assertEntryMember(staffOrigin, { role: 'reviewer', approved: true })
  );
});

test('investor entry blocks staff commands while retaining investor actions', () => {
  assert.equal(typeof policy.assertEntryCommand, 'function');
  for (const command of [
    'save',
    'preview',
    'release',
    'withdraw',
    'asset',
    'history',
    'members',
    'approveInvestor',
    'revokeInvestor',
  ])
    assert.throws(
      () => policy.assertEntryCommand(investorOrigin, command),
      (e) => e.status === 403
    );
  for (const command of [
    'authStart',
    'authVerify',
    'session',
    'list',
    'property',
    'file',
    'saved',
    'toggleSaved',
    'inquiries',
    'inquire',
    'logout',
  ])
    assert.doesNotThrow(() => policy.assertEntryCommand(investorOrigin, command));
  assert.doesNotThrow(() => policy.assertEntryCommand(staffOrigin, 'save'));
});

test('origin policy allows the exact staging hosts and excludes production and lookalikes', () => {
  assert.equal(typeof policy.isAllowedOrigin, 'function');
  for (const origin of [investorOrigin, staffOrigin, 'https://probono-key-realty.webflow.io'])
    assert.equal(policy.isAllowedOrigin(origin), true);
  for (const origin of [
    'https://www.probonokeyrealty.com',
    'https://probonokeyrealty.com',
    investorOrigin + '.evil.example',
    'null',
    'https://other.netlify.app',
  ])
    assert.equal(policy.isAllowedOrigin(origin), false);
});
