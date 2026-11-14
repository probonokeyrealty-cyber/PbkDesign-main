// Scoped, no-outreach staging access lifecycle test. Credentials stay in ignored local storage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { qaLive, qaProfile, qaStem, qaFile } from './investor-qa-profile.mjs';
const base = process.env.PBK_SUPABASE_URL?.replace(/\/$/, '');
const service = process.env.PBK_SUPABASE_SERVICE_ROLE_KEY;
assert.equal(base, 'https://asumndiooctluuecydhj.supabase.co');
assert.ok(service, 'Staging provider credentials unavailable.');
const api = base + '/functions/v1/' + qaProfile.functionName;
const publicOrigin = qaProfile.publicOrigin;
const staffOrigin = qaProfile.staffOrigin;
const stateFile = qaFile('approval-revocation-qa.json');
const reportFile = qaFile('approval-revocation-report.json');
const email = qaLive ? 'pbk.qa.live.approval.20261114@example.com' : 'pbk.qa.approval.20261113@example.com';
const phase = process.argv[2] || 'setup';
await fs.mkdir('.pbk-local', { recursive: true });
let state = { email, checks: [] };
try {
  state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
} catch {}
assert.equal(state.email, email);
async function provider(route, body) {
  const r = await fetch(base + route, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json();
  assert.ok(r.ok, `QA provider request failed (${r.status}).`);
  return data;
}
async function code(address) {
  const r = await provider('/auth/v1/admin/generate_link', { type: 'magiclink', email: address });
  const otp = r.email_otp || r.properties?.email_otp;
  assert.ok(otp, 'QA email code missing.');
  return otp;
}
async function call(command, payload = {}, token, origin = publicOrigin) {
  const r = await fetch(api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ command, payload }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, data: await r.json() };
}
async function verify(address, origin) {
  return call('authVerify', { email: address, code: await code(address) }, undefined, origin);
}
function check(name) {
  if (!state.checks.includes(name)) state.checks.push(name);
}
async function save() {
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
  const report = {
    checkedAt: new Date().toISOString(),
    phase,
    qaEmail: email,
    propertyId: state.propertyId,
    checks: state.checks,
    preRevocationLink: state.preRevocationLinkObservation,
    expiredPdfStatus: state.expiredPdfStatus,
    existingLinkExpiresAt: state.signedExpiresAt,
    finalInvestorStatus: state.finalInvestorStatus,
    outreach: false,
    environment: qaProfile.environment,
    scopedSyntheticLiveQa: qaLive,
    realMembershipsChanged: false,
  };
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (phase === 'setup') {
  state = { email, userId: state.userId, checks: [] };
  const identities = JSON.parse(await fs.readFile(qaFile('portal-qa-identities.json'), 'utf8'));
  assert.equal(identities.reviewer.email, `${qaStem}.reviewer@example.com`);
  state.reviewerEmail = identities.reviewer.email;
  const signedIn = await verify(state.reviewerEmail, staffOrigin);
  assert.equal(signedIn.status, 200);
  state.reviewerToken = signedIn.data.token;
  if (!state.userId) {
    const user = await provider('/auth/v1/admin/users', {
      email,
      email_confirm: true,
      app_metadata: { pbk_portal_staging: true, qa_no_outreach: true },
    });
    state.userId = user.id || user.user?.id;
    assert.ok(state.userId);
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
  }
  assert.equal(
    (await call('revokeInvestor', { email }, state.reviewerToken, staffOrigin)).status,
    200
  );
  assert.equal((await verify(email, publicOrigin)).status, 403);
  check('Unapproved verified QA identity cannot sign in');
  state.investorBrowserCode = await code(email);
  state.reviewerBrowserCode = await code(state.reviewerEmail);
  state.finalInvestorStatus = 'Not approved';
} else if (phase === 'browser-link') {
  const link = await provider(
    '/auth/v1/admin/generate_link?redirect_to=' + encodeURIComponent(publicOrigin + '/'),
    { type: 'magiclink', email }
  );
  state.investorBrowserLink = link.action_link || link.properties?.action_link;
  assert.ok(state.investorBrowserLink, 'QA browser link missing.');
} else if (phase === 'approve') {
  assert.ok(state.userId && state.reviewerToken, 'Run setup first.');
  assert.equal(
    (await call('approveInvestor', { email }, state.reviewerToken, staffOrigin)).status,
    200
  );
  check('Reviewer approval succeeds through the protected staff action');
  const signedIn = await verify(email, publicOrigin);
  assert.equal(signedIn.status, 200);
  state.investorToken = signedIn.data.token;
  check('Approved QA identity can sign in');
  const list = await call('list', {}, state.investorToken);
  assert.equal(list.status, 200);
  const property = list.data.properties.find(
    (p) =>
      p.fictional === true &&
      p.assets?.some((a) => a.kind === 'packet') &&
      (!process.env.PBK_QA_PROPERTY_ID || p.id === process.env.PBK_QA_PROPERTY_ID)
  );
  assert.ok(property, 'No released fictional packet is available for QA.');
  state.propertyId = property.id;
  state.pdfId = property.assets.find((a) => a.kind === 'packet').id;
  const record = await call('property', { id: state.propertyId }, state.investorToken);
  assert.equal(record.status, 200);
  assert.ok(!JSON.stringify(record.data).includes('internalNotes'));
  check('Approved investor sees the released house without internal notes');
  const file = await call(
    'file',
    { id: state.propertyId, assetId: state.pdfId },
    state.investorToken
  );
  assert.equal(file.status, 200);
  const response = await fetch(file.data.url);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const original = await fs.readFile('.pbk-local/upload-fixtures/PBK-QA-packet.pdf');
  assert.equal(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    crypto.createHash('sha256').update(original).digest('hex')
  );
  check('Approved investor PDF download matches the owned QA fixture');
  state.investorBrowserCode = await code(email);
  state.finalInvestorStatus = 'Approved';
} else if (phase === 'revoke') {
  assert.ok(state.investorToken && state.pdfId, 'Run approve first.');
  const issued = await call(
    'file',
    { id: state.propertyId, assetId: state.pdfId },
    state.investorToken
  );
  assert.equal(issued.status, 200);
  assert.equal(issued.data.expiresIn, 60);
  state.signedUrl = issued.data.url;
  const claims = JSON.parse(
    Buffer.from(
      new URL(state.signedUrl).searchParams.get('token').split('.')[1],
      'base64url'
    ).toString()
  );
  state.signedExpiresAt = new Date(claims.exp * 1000).toISOString();
  assert.equal(
    (await call('revokeInvestor', { email }, state.reviewerToken, staffOrigin)).status,
    200
  );
  check('Reviewer revocation succeeds');
  for (const [command, payload] of [
    ['session', {}],
    ['list', {}],
    ['property', { id: state.propertyId }],
    ['file', { id: state.propertyId, assetId: state.pdfId }],
    ['saved', {}],
    ['inquiries', {}],
  ]) {
    assert.equal((await call(command, payload, state.investorToken)).status, 403, command);
    check('Revoked existing session denied: ' + command);
  }
  assert.equal(
    (await call('property', { id: state.propertyId }, state.investorToken, '')).status,
    403
  );
  check('Omitting Origin does not bypass revoked membership');
  assert.equal((await verify(email, publicOrigin)).status, 403);
  check('Revoked verified identity cannot start a new portal session');
  state.preRevocationLinkObservation = (await fetch(state.signedUrl)).status;
  state.finalInvestorStatus = 'Revoked';
} else if (phase === 'verify-expiry') {
  assert.ok(state.signedUrl && state.signedExpiresAt, 'Run revoke first.');
  const remaining = Date.parse(state.signedExpiresAt) + 3000 - Date.now();
  assert.ok(
    remaining <= 0,
    `Check again in ${Math.ceil(remaining / 1000)} seconds after signed URL expiry.`
  );
  const expired = await fetch(state.signedUrl, { cache: 'no-store' });
  assert.ok(
    [400, 401, 403].includes(expired.status),
    'Expired PDF must be denied by storage auth.'
  );
  assert.match(await expired.text(), /expired|invalid.*token|jwt/i);
  state.expiredPdfStatus = expired.status;
  check('Previously issued PDF URL denied after its 60-second lifetime');
  const history = await call('history', {}, state.reviewerToken, staffOrigin);
  assert.equal(history.status, 200);
  const events = history.data.events.filter((e) => e.entityId === email);
  assert.ok(events.some((e) => e.action === 'investor_access_approved'));
  assert.ok(events.some((e) => e.action === 'investor_access_revoked'));
  check('Approval and revocation audit history retained');
  const members = await call('members', {}, state.reviewerToken, staffOrigin);
  assert.equal(members.status, 200);
  assert.ok(
    members.data.members.filter((m) => m.email === email).every((m) => m.approved === false)
  );
  check('QA investor remains revoked at end of test');
  await call('logout', {}, state.reviewerToken, staffOrigin);
  delete state.reviewerToken;
  delete state.investorToken;
  delete state.signedUrl;
  delete state.investorBrowserCode;
  delete state.reviewerBrowserCode;
  delete state.investorBrowserLink;
} else throw Error('Unknown QA phase.');
await save();
