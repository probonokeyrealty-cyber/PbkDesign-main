import test from 'node:test';
import assert from 'node:assert/strict';
const release = await import('../supabase/functions/pbk-investor-staging/releaseProfile.mjs').catch(
  () => ({})
);
import {
  isAllowedOrigin,
  assertEntryMember,
  assertEntryCommand,
} from '../supabase/functions/pbk-investor-staging/entryPolicy.mjs';
import { authRedirectUrl } from '../supabase/functions/pbk-investor-staging/authSession.mjs';

test('live uses separate private records, bucket, function and exact origins', () => {
  assert.equal(typeof release.portalProfile, 'function');
  const live = release.portalProfile('live'),
    stage = release.portalProfile('staging');
  for (const key of [
    'table',
    'bucket',
    'functionName',
    'stateId',
    'commitRpc',
    'publicOrigin',
    'staffOrigin',
  ])
    assert.notEqual(live[key], stage[key], key);
  assert.equal(live.publicOrigin, 'https://pbk-investors.netlify.app');
  assert.equal(live.staffOrigin, 'https://pbkcenter.netlify.app');
  assert.equal(isAllowedOrigin(live.publicOrigin, live), true);
  assert.equal(isAllowedOrigin(stage.publicOrigin, live), false);
  assert.equal(isAllowedOrigin(live.publicOrigin, stage), false);
  assert.equal(isAllowedOrigin(live.publicOrigin + '.evil.example', live), false);
  assert.equal(isAllowedOrigin('http://localhost:5179', live), false);
  assert.equal(authRedirectUrl(live.publicOrigin, live), live.publicOrigin + '/');
  assert.equal(authRedirectUrl(live.staffOrigin, live), live.staffOrigin + '/property-log');
  assert.throws(() => authRedirectUrl(stage.staffOrigin, live));
  assert.throws(() => release.portalProfile('typo'));
});
test('live origin preserves investor/staff separation', () => {
  assert.equal(typeof release.portalProfile, 'function');
  const live = release.portalProfile('live');
  assert.throws(() =>
    assertEntryMember(live.publicOrigin, { role: 'reviewer', approved: true }, live)
  );
  assert.throws(() => assertEntryCommand(live.publicOrigin, 'release', live));
  assert.doesNotThrow(() =>
    assertEntryMember(live.publicOrigin, { role: 'investor', approved: true }, live)
  );
  assert.doesNotThrow(() => assertEntryCommand(live.publicOrigin, 'authCallback', live));
});
test('live bootstrap copies approved real roles only, excluding QA and all private staging content', () => {
  assert.equal(typeof release.seedLiveState, 'function');
  const stage = {
    members: {
      owner: { email: 'owner@business.com', role: 'reviewer', approved: true },
      buyer: {
        email: 'buyer@business.com',
        role: 'investor',
        approved: true,
        highLevelContactId: 'existing-reference',
      },
      qa: { email: 'pbk.qa.test@example.com', role: 'reviewer', approved: true },
      qa2: { email: 'pbk.qa.test@business.com', role: 'investor', approved: true },
      pending: { email: 'pending@business.com', role: 'investor', approved: false },
    },
    sessions: { secret: {} },
    properties: { private: {} },
    inquiries: { private: {} },
    invitations: { 'new@business.com': { approved: true } },
    audit: [{ private: true }],
  };
  const live = release.seedLiveState(stage);
  assert.deepEqual(Object.keys(live.members).sort(), ['buyer', 'owner']);
  assert.deepEqual(live.members.buyer, stage.members.buyer);
  for (const k of ['properties', 'sessions', 'inquiries', 'saved', 'invitations'])
    assert.deepEqual(live[k], {});
  assert.deepEqual(live.audit, []);
  live.members.owner.role = 'editor';
  assert.equal(stage.members.owner.role, 'reviewer');
});
