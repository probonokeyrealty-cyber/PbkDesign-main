// Synthetic sign-in links only. Auth admin generation sends no email.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = process.env.PBK_SUPABASE_URL?.replace(/\/$/, '');
const service = process.env.PBK_SUPABASE_SERVICE_ROLE_KEY;
if (base !== 'https://asumndiooctluuecydhj.supabase.co' || !service)
  throw Error('Expected staging auth configuration unavailable.');
const buyer = 'https://pbk-investors-staging.netlify.app';
const staff = 'https://pbk-investor-staging--pbkcenter.netlify.app';
const users = JSON.parse(await fs.readFile('.pbk-local/portal-qa-identities.json', 'utf8'));
async function generated(key, redirect) {
  const r = await fetch(
    base + '/auth/v1/admin/generate_link?redirect_to=' + encodeURIComponent(redirect),
    {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'magiclink', email: users[key].email }),
    }
  );
  assert.equal(r.status, 200, 'QA link generation');
  const data = await r.json();
  return data.action_link || data.properties?.action_link;
}
async function call(command, token, origin) {
  const r = await fetch(base + '/functions/v1/pbk-investor-staging', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ command, payload: {} }),
  });
  return { status: r.status, data: await r.json() };
}
if (process.argv.includes('--browser-links')) {
  const links = {};
  for (const [key, redirect] of [
    ['investor', buyer + '/'],
    ['reviewer', staff + '/property-log'],
  ])
    links[key] = await generated(key, redirect);
  await fs.writeFile('.pbk-local/auth-callback-browser-links.json', JSON.stringify(links));
  console.log('Two no-outreach QA links prepared in ignored local storage; no email sent.');
  process.exit(0);
}
const checks = [];
for (const [key, origin, path] of [
  ['investor', buyer, '/'],
  ['reviewer', staff, '/property-log'],
]) {
  const link = await generated(key, origin + path);
  const verification = await fetch(link, { redirect: 'manual' });
  assert.equal(verification.status, 303);
  const callback = new URL(verification.headers.get('location'));
  assert.equal(
    callback.origin + callback.pathname,
    origin + path,
    'Must return to correct staging entry, never localhost'
  );
  const token = new URLSearchParams(callback.hash.slice(1)).get('access_token');
  assert.ok(token, 'Provider returned a callback session');
  const accepted = await call('authCallback', token, origin);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.ok(accepted.data.expiresIn > 0 && accepted.data.expiresIn <= 3600);
  assert.equal((await call('session', token, origin)).data.member.role, users[key].role);
  assert.equal((await call('list', token, origin)).status, 200);
  if (key === 'reviewer') assert.equal((await call('authCallback', token, buyer)).status, 403);
  assert.equal((await call('logout', token, origin)).status, 200);
  assert.equal(
    (await call('authCallback', token, origin)).status,
    401,
    'A signed-out callback cannot be replayed'
  );
  assert.equal((await call('list', token, origin)).status, 401);
  const reused = await fetch(link, { redirect: 'manual' });
  assert.match(
    new URL(reused.headers.get('location')).hash,
    /error=/,
    'Consumed email link cannot be used twice'
  );
  checks.push({
    role: users[key].role,
    returnUrl: origin + path,
    callback: 'pass',
    approvedAccess: 'pass',
    logoutReplayDenied: 'pass',
    consumedLinkDenied: 'pass',
  });
}
assert.equal((await call('authCallback', 'invalid-token', buyer)).status, 401);
assert.equal((await call('authCallback', undefined, buyer)).status, 401);
const report = {
  checkedAt: new Date().toISOString(),
  checks,
  invalidAndMissingTokenDenied: true,
  emailSent: false,
  crmWrites: false,
  productionWrites: false,
};
await fs.writeFile('.pbk-local/auth-callback-hosted-qa.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
