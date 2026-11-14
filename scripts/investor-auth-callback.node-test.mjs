import test from 'node:test';
import assert from 'node:assert/strict';
const client = await import('../src/app/investor/emailCallback.mjs').catch(() => ({}));
const server = await import('../supabase/functions/pbk-investor-staging/authSession.mjs').catch(
  () => ({})
);
const buyer = 'https://pbk-investors-staging.netlify.app';
const staff = 'https://pbk-investor-staging--pbkcenter.netlify.app';

test('email callbacks remove all credentials before returning a token and never retain refresh tokens', () => {
  assert.equal(typeof client.consumeEmailCallback, 'function');
  const replaced = [];
  const result = client.consumeEmailCallback(
    {
      pathname: '/',
      search: '?view=inventory',
      hash: '#access_token=qa-token&refresh_token=qa-refresh&expires_in=3600',
    },
    { replaceState: (...args) => replaced.push(args) }
  );
  assert.deepEqual(replaced, [[null, '', '/?view=inventory']]);
  assert.deepEqual(result, { token: 'qa-token' });
  assert.equal(JSON.stringify(result).includes('qa-refresh'), false);
});
test('used, expired and malformed email links display a safe retry message without provider details', () => {
  for (const hash of [
    '#error=access_denied&error_description=private-provider-detail',
    '#refresh_token=qa-refresh',
    '#access_token=',
  ]) {
    let cleared = false;
    const result = client.consumeEmailCallback(
      { pathname: '/property-log', search: '', hash },
      {
        replaceState: () => {
          cleared = true;
        },
      }
    );
    assert.equal(cleared, true);
    assert.match(result.error, /fresh sign-in link/i);
    assert.equal(JSON.stringify(result).includes('private-provider-detail'), false);
  }
  assert.equal(client.consumeEmailCallback({ hash: '#inventory' }, {}), null);
});
test('sign-in redirects use exact staging entries and reject unrecognized origins', () => {
  assert.equal(typeof server.authRedirectUrl, 'function');
  assert.equal(server.authRedirectUrl(buyer), buyer + '/');
  assert.equal(server.authRedirectUrl(staff), staff + '/property-log');
  assert.equal(server.authRedirectUrl('https://probono-key-realty.webflow.io'), buyer + '/');
  for (const origin of ['https://www.probonokeyrealty.com', buyer + '.evil.example', ''])
    assert.throws(() => server.authRedirectUrl(origin));
});
test('verified email sessions retain approval, revocation, entry isolation and the one-hour ceiling', () => {
  assert.equal(typeof server.registerVerifiedSession, 'function');
  const now = Date.now();
  const user = { id: 'qa', email: 'qa@example.com', email_confirmed_at: '2026-11-13' };
  const state = () => ({
    members: { qa: { email: user.email, approved: true, role: 'investor' } },
    audit: [],
    sessions: {},
  });
  let data = state();
  assert.equal(server.registerVerifiedSession(data, user, 'hash', now + 7200000, buyer, now), 3600);
  assert.deepEqual(data.sessions.hash, {
    uid: 'qa',
    expiresAt: now + 3600000,
    providerExpiresAt: now + 7200000,
  });
  data.endedSessions = { ended: now + 60000 };
  assert.throws(() => server.registerVerifiedSession(data, user, 'ended', now + 60000, buyer, now));
  data = state();
  data.sessions.hash = { uid: 'qa', expiresAt: now - 1, providerExpiresAt: now + 60000 };
  assert.throws(() => server.registerVerifiedSession(data, user, 'hash', now + 60000, buyer, now));
  for (const change of [{ approved: false }, { role: 'reviewer' }]) {
    data = state();
    Object.assign(data.members.qa, change);
    assert.throws(() =>
      server.registerVerifiedSession(data, user, 'hash', now + 60000, buyer, now)
    );
    assert.equal(data.sessions.hash, undefined);
  }
  for (const expiresAt of [NaN, now - 1])
    assert.throws(() =>
      server.registerVerifiedSession(state(), user, 'hash', expiresAt, buyer, now)
    );
  assert.throws(() =>
    server.registerVerifiedSession(
      state(),
      { ...user, email_confirmed_at: null },
      'hash',
      now + 60000,
      buyer,
      now
    )
  );
  data = state();
  data.members = {};
  data.invitations = { [user.email]: { approved: true, approvedBy: 'reviewer' } };
  server.registerVerifiedSession(data, user, 'hash', now + 60000, buyer, now);
  assert.equal(data.members.qa.role, 'investor');
  assert.equal(data.audit.length, 1);
  server.registerVerifiedSession(data, user, 'hash', now + 60000, buyer, now);
  assert.equal(data.audit.length, 1);
});
