// Explicitly scoped synthetic staging setup and hosted API verification. Never prints secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const base = process.env.PBK_SUPABASE_URL?.replace(/\/$/, '');
const service = process.env.PBK_SUPABASE_SERVICE_ROLE_KEY;
if (base !== 'https://asumndiooctluuecydhj.supabase.co' || !service)
  throw Error('Expected PBK staging provider configuration is unavailable.');
const api = `${base}/functions/v1/pbk-investor-staging`;
const headers = {
  apikey: service,
  Authorization: `Bearer ${service}`,
  'Content-Type': 'application/json',
};
async function admin(path, body, method = 'POST') {
  const r = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      `Provider setup failed (${r.status}): ${data.msg || data.message || data.error || 'unknown'}`
    );
  return data;
}
const staffOrigin = 'https://pbk-investor-staging--pbkcenter.netlify.app';
const investorOrigin = 'https://pbk-investors-staging.netlify.app';
async function call(command, payload = {}, token, origin = staffOrigin) {
  const r = await fetch(api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ command, payload }),
  });
  return { status: r.status, data: await r.json() };
}
const root = '.pbk-local';
await fs.mkdir(root, { recursive: true });
const file = `${root}/portal-qa-identities.json`;
let users = {};
try {
  users = JSON.parse(await fs.readFile(file, 'utf8'));
} catch {}
for (const [key, role] of [
  ['editor', 'editor'],
  ['reviewer', 'reviewer'],
  ['investor', 'investor'],
  ['other', 'investor'],
  ['pending', 'investor'],
]) {
  const email = `pbk.qa.portal.20261113.${key}@example.com`;
  if (!users[key]) {
    const u = await admin('/auth/v1/admin/users', {
      email,
      email_confirm: true,
      app_metadata: { pbk_portal_staging: true },
    });
    users[key] = { id: u.id || u.user?.id, email, role };
    await fs.writeFile(file, JSON.stringify(users, null, 2));
  }
}
for (let n = 0; n < 5; n++) {
  const rows = await admin(
    '/rest/v1/pbk_investor_staging_state?id=eq.staging&select=revision,data',
    null,
    'GET'
  );
  const { revision, data } = rows[0];
  for (const [key, u] of Object.entries(users)) {
    if (key === 'owner') continue; // Retests must never rewrite the real staff membership.
    data.members[u.id] = { email: u.email, role: u.role, approved: key !== 'pending' };
  }
  if (
    await admin('/rest/v1/rpc/pbk_investor_staging_commit', {
      expected_revision: revision,
      next_data: data,
    })
  )
    break;
  if (n === 4) throw Error('Concurrent staging setup; retry.');
}
if (process.argv.includes('--codes')) {
  const codes = {};
  for (const [key, u] of Object.entries(users)) {
    if (key === 'owner') continue;
    const r = await admin('/auth/v1/admin/generate_link', { type: 'magiclink', email: u.email });
    codes[key] = { email: u.email, code: r.email_otp || r.properties?.email_otp };
  }
  await fs.writeFile(`${root}/portal-qa-codes.json`, JSON.stringify(codes, null, 2));
  console.log('No-outreach QA sign-in codes prepared in ignored local storage. No emails sent.');
  process.exit(0);
}
const tokens = {};
for (const key of ['editor', 'reviewer', 'investor', 'other', 'pending']) {
  const link = await admin('/auth/v1/admin/generate_link', {
    type: 'magiclink',
    email: users[key].email,
  });
  const r = await call(
    'authVerify',
    {
      email: users[key].email,
      code: link.email_otp || link.properties?.email_otp,
    },
    undefined,
    ['investor', 'other', 'pending'].includes(key) ? investorOrigin : staffOrigin
  );
  if (key === 'pending') {
    assert.equal(r.status, 403);
    continue;
  }
  assert.equal(r.status, 200, JSON.stringify(r.data));
  tokens[key] = r.data.token;
}
assert.equal((await call('list')).status, 401);
assert.equal((await call('list', {}, 'invalid-token')).status, 401);
assert.equal((await call('list', {}, undefined, investorOrigin)).status, 401);
assert.equal((await call('list', {}, tokens.investor, investorOrigin)).status, 200);
assert.equal((await call('list', {}, tokens.reviewer, investorOrigin)).status, 403);
assert.equal((await call('release', {}, tokens.investor, investorOrigin)).status, 403);
assert.equal(
  (await call('list', {}, tokens.investor, 'https://www.probonokeyrealty.com')).status,
  403
);
const publicPreflight = await fetch(api, {
  method: 'OPTIONS',
  headers: {
    Origin: investorOrigin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,authorization',
  },
});
assert.equal(publicPreflight.status, 204);
assert.equal(publicPreflight.headers.get('access-control-allow-origin'), investorOrigin);
const staffCodeOnInvestorEntry = await admin('/auth/v1/admin/generate_link', {
  type: 'magiclink',
  email: users.reviewer.email,
});
assert.equal(
  (
    await call(
      'authVerify',
      {
        email: users.reviewer.email,
        code: staffCodeOnInvestorEntry.email_otp || staffCodeOnInvestorEntry.properties?.email_otp,
      },
      undefined,
      investorOrigin
    )
  ).status,
  403
);
const draft = {
  title: 'Fictional API QA house',
  address: '100 Sample Street',
  city: 'Demo City',
  state: 'CA',
  zip: '00123',
  market: 'Staging QA',
  assetType: 'Single-family',
  owner: 'QA editor',
  source: 'Synthetic QA facts',
  checkedAt: '2026-11-13',
  askingCents: 25000000,
  rehabCents: 3500000,
  arvCents: 32000000,
  beds: 3,
  baths: 2,
  sqft: 1400,
  summary: 'Fictional staging-only API regression record.',
  internalNotes: 'NEVER RELEASE THIS INTERNAL NOTE',
  fictional: true,
  checks: { address: true, sources: true, estimates: true, rights: true, privacy: true },
};
let r = await call('save', { draft }, tokens.editor);
assert.equal(r.status, 200, JSON.stringify(r.data));
let p = r.data.property;
assert.equal((await call('property', { id: p.id }, tokens.investor)).status, 404);
assert.equal(
  (await call('release', { id: p.id, revision: p.revision }, tokens.editor)).status,
  403
);
assert.equal(
  (await call('release', { id: p.id, revision: p.revision }, tokens.reviewer)).status,
  400
);
// Real private photo upload; owned synthetic 1px PNG test fixture, not a listing photo.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNe8AAAAASUVORK5CYII=',
  'base64'
);
const form = new FormData();
form.set('id', p.id);
form.set('revision', String(p.revision));
form.set('file', new Blob([png], { type: 'image/png' }), 'synthetic-qa-pixel.png');
form.set('title', 'Synthetic QA image');
form.set('rights', 'PBK internal synthetic QA fixture');
form.set('alt', 'Synthetic single-pixel QA image, not a property photo');
form.set('buyerVisible', 'true');
const racingUploads = await Promise.all(
  Array.from({ length: 2 }, async () => {
    const body = new FormData();
    for (const [key, value] of form.entries()) body.set(key, value);
    const response = await fetch(api, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.editor}` },
      body,
    });
    return { status: response.status, data: await response.json() };
  })
);
assert.deepEqual(
  racingUploads.map((r) => r.status).sort(),
  [200, 409],
  JSON.stringify(racingUploads)
);
p = racingUploads.find((r) => r.status === 200).data.property;
const pdf = await fs.readFile('.pbk-local/upload-fixtures/PBK-QA-packet.pdf');
const pdfForm = new FormData();
pdfForm.set('id', p.id);
pdfForm.set('revision', String(p.revision));
pdfForm.set('file', new Blob([pdf], { type: 'application/pdf' }), 'PBK-QA-packet.pdf');
pdfForm.set('title', 'Fictional QA packet');
pdfForm.set('rights', 'PBK-owned synthetic QA packet');
pdfForm.set('buyerVisible', 'true');
const pdfUpload = await fetch(api, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tokens.editor}` },
  body: pdfForm,
});
const pdfData = await pdfUpload.json();
assert.equal(pdfUpload.status, 200, JSON.stringify(pdfData));
p = pdfData.property;
assert.equal((await call('preview', { id: p.id }, tokens.reviewer)).status, 200);
r = await call('release', { id: p.id, revision: p.revision }, tokens.reviewer);
assert.equal(r.status, 200, JSON.stringify(r.data));
p = r.data.property;
const visible = await call('property', { id: p.id }, tokens.investor, investorOrigin);
assert.equal(visible.status, 200);
assert.ok(!JSON.stringify(visible.data).includes('NEVER RELEASE'));
assert.ok(!JSON.stringify(visible.data).includes('internalNotes'));
const signed = await call(
  'file',
  { id: p.id, assetId: p.assets[0].id },
  tokens.investor,
  investorOrigin
);
assert.equal(signed.status, 200, JSON.stringify(signed.data));
assert.equal(signed.data.expiresIn, 60);
const downloaded = await fetch(signed.data.url);
assert.equal(downloaded.status, 200);
assert.equal(
  crypto
    .createHash('sha256')
    .update(Buffer.from(await downloaded.arrayBuffer()))
    .digest('hex'),
  crypto.createHash('sha256').update(png).digest('hex')
);
assert.notEqual(
  (await fetch(`${base}/storage/v1/object/public/pbk-investor-staging/${p.assets[0].path}`)).status,
  200
);
const pdfAsset = p.assets.find((a) => a.kind === 'packet');
const pdfSigned = await call('file', { id: p.id, assetId: pdfAsset.id }, tokens.investor);
assert.equal(pdfSigned.status, 200);
const pdfDownload = await fetch(pdfSigned.data.url);
assert.equal(pdfDownload.status, 200);
assert.equal(
  crypto
    .createHash('sha256')
    .update(Buffer.from(await pdfDownload.arrayBuffer()))
    .digest('hex'),
  crypto.createHash('sha256').update(pdf).digest('hex')
);
const inquiry = {
  id: p.id,
  version: p.releaseVersion,
  key: crypto.randomUUID(),
  message: 'NO OUTREACH — synthetic staging API inquiry',
  timing: 'QA only',
};
const concurrent = await Promise.all(
  Array.from({ length: 3 }, () => call('inquire', inquiry, tokens.investor, investorOrigin))
);
assert.ok(
  concurrent.every((x) => x.status === 200),
  JSON.stringify(concurrent.map((x) => ({ status: x.status, error: x.data.error })))
);
assert.equal(new Set(concurrent.map((x) => x.data.inquiry.id)).size, 1);
const receipt = concurrent[0].data.inquiry;
assert.ok(
  !(await call('inquiries', {}, tokens.other)).data.inquiries.some((i) => i.id === receipt.id)
);
assert.ok(
  (await call('inquiries', {}, tokens.reviewer)).data.inquiries.some((i) => i.id === receipt.id)
);
r = await call(
  'save',
  { id: p.id, revision: p.revision, draft: { ...draft, title: 'Unreleased API revision' } },
  tokens.editor
);
assert.equal(r.status, 200);
p = r.data.property;
assert.equal(
  (await call('property', { id: p.id }, tokens.investor)).data.property.title,
  draft.title
);
assert.equal(
  (await call('save', { id: p.id, revision: p.revision - 1, draft }, tokens.editor)).status,
  409
);
r = await call('withdraw', { id: p.id, revision: p.revision }, tokens.reviewer);
assert.equal(r.status, 200);
assert.equal((await call('property', { id: p.id }, tokens.investor)).status, 404);
assert.equal(
  (await call('file', { id: p.id, assetId: p.assets[0].id }, tokens.investor)).status,
  404
);
const history = (await call('history', { id: p.id }, tokens.reviewer)).data.events;
assert.ok(history.some((e) => e.action === 'property_released'));
assert.ok(history.some((e) => e.action === 'property_withdrawn'));
assert.ok(history.some((e) => e.action === 'inquiry_received'));
assert.equal(
  (await call('revokeInvestor', { email: users.other.email }, tokens.reviewer)).status,
  200
);
assert.equal((await call('list', {}, tokens.other)).status, 403);
assert.equal(
  (await call('approveInvestor', { email: users.other.email }, tokens.reviewer)).status,
  200
);
await call('logout', {}, tokens.investor);
assert.equal((await call('list', {}, tokens.investor)).status, 401);
const report = {
  checkedAt: new Date().toISOString(),
  propertyId: p.id,
  receiptId: receipt.id,
  checks: [
    'public staging origin preflight and approved investor sign-in pass',
    'anonymous and pending public entry denied',
    'public entry rejects staff sign-in and staff session reads',
    'public entry rejects staff commands and production origins',
    'unapproved/anonymous denied',
    'individual auth verified',
    'editor release denied',
    'preview required',
    'private PNG upload/download hash match',
    'same-revision upload race returns one success and one conflict',
    'private PDF upload/download hash match',
    'public asset denied',
    'buyer projection excludes notes',
    'three concurrent retries produce one inquiry',
    'cross-investor history isolated',
    'staff sees inquiry',
    'unreleased revision isolated',
    'stale save rejected',
    'withdraw denies record/new file URL',
    'audit preserved',
    'logged-out token denied',
    'revoked existing session denied',
  ],
  productionChanges: false,
  notificationsSent: false,
};
await fs.writeFile(`${root}/portal-api-qa.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
