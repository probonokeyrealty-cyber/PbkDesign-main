// Cookie-free HTTP checks for the separate investor and protected staff staging entries.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const investor = 'https://pbk-investors-staging.netlify.app';
const staff = 'https://pbk-investor-staging--pbkcenter.netlify.app';
const checks = [];
for (const pathname of ['/', '/investor-portal.html']) {
  const r = await fetch(investor + pathname, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(r.status, 200, pathname);
  assert.equal(r.headers.get('location'), null);
  assert.match(r.headers.get('x-robots-tag') || '', /noindex/);
  assert.match(r.headers.get('cache-control') || '', /no-store/);
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(await r.text(), /PBK Private Investor Workspace/);
  checks.push({ path: pathname, status: r.status, anonymousShell: true });
}
for (const pathname of ['/property-log', '/index.shell.html', '/api/health', '/state']) {
  const r = await fetch(investor + pathname, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(r.status, 404, pathname);
  checks.push({ path: pathname, status: r.status });
}
const protectedStaff = await fetch(staff + '/property-log', {
  redirect: 'manual',
  signal: AbortSignal.timeout(15000),
});
assert.ok(
  [401, 302, 303].includes(protectedStaff.status),
  `Staff entry must remain protected, got ${protectedStaff.status}.`
);
checks.push({ staffPropertyLog: true, status: protectedStaff.status });
const report = {
  checkedAt: new Date().toISOString(),
  investor,
  staff,
  checks,
  cookiesOrAuthorizationSent: false,
};
await fs.mkdir('.pbk-local', { recursive: true });
await fs.writeFile('.pbk-local/investor-entry-hosted-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
