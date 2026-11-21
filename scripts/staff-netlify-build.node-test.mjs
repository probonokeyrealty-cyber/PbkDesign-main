import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStaffNetlifyBuild, staffSiteId } from './staff-netlify-build.mjs';

test('the production build entry point exits before building with simulated public staff access', () => {
  const fixture = `globalThis.fetch = async () => new Response(null, { status: 200 });`;
  const result = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(fixture)}`,
    fileURLToPath(new URL('./staff-netlify-build.mjs', import.meta.url)),
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, SITE_ID: staffSiteId, npm_execpath: 'unexpected-build.cjs' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.phase, 'before build');
  assert.equal(report.ok, false);
  assert.ok(report.checks.every(({ status }) => status === 200));
  assert.match(result.stderr, /staff privacy check failed before build/i);
});

test('staff exposure during the build fails the publish gate', async () => {
  const calls = [];
  const reports = [{ ok: true }, { ok: false }];
  await assert.rejects(runStaffNetlifyBuild({
    siteId: staffSiteId,
    checkPrivacy: async () => { calls.push('check'); return reports.shift(); },
    build: async () => { calls.push('build'); },
  }), /staff privacy check failed after build/i);
  assert.deepEqual(calls, ['check', 'build', 'check']);
});

test('staff privacy is checked before and after a good build', async () => {
  const calls = [];
  await runStaffNetlifyBuild({
    siteId: staffSiteId,
    checkPrivacy: async () => { calls.push('check'); return { ok: true }; },
    build: async () => { calls.push('build'); },
  });
  assert.deepEqual(calls, ['check', 'build', 'check']);
});

test('unknown site metadata fails closed while separate projects use the existing build', async () => {
  let built = false;
  const build = async () => { built = true; };
  await assert.rejects(runStaffNetlifyBuild({ siteId: '', build }), /SITE_ID/);
  assert.equal(built, false);
  await runStaffNetlifyBuild({
    siteId: '98e22ea2-79b2-4dd3-ae7c-b3835bc5f0bb',
    checkPrivacy: async () => assert.fail('Separate project ran the staff gate.'),
    build,
  });
  assert.equal(built, true);
});
