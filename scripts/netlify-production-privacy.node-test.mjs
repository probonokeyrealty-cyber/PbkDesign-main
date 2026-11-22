import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkProductionPrivacy } from './netlify-production-privacy.mjs';

test('accepts only anonymous 401 responses from every protected production route', async () => {
  const calls = [];
  const report = await checkProductionPrivacy(async (url, options) => {
    calls.push({ url, options });
    return new Response('Private site', { status: 401 });
  });
  assert.equal(report.ok, true);
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      'https://pbkcenter.netlify.app/',
      'https://pbkcenter.netlify.app/leads',
      'https://pbkcenter.netlify.app/settings',
    ]
  );
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    assert.equal(new Headers(options.headers).has('authorization'), false);
    assert.equal(new Headers(options.headers).has('cookie'), false);
    assert.equal(new Headers(options.headers).get('connection'), 'close');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

for (const status of [200, 302, 403, 404, 500, 503]) {
  test(`fails closed when production returns ${status}, even if the other routes are private`, async () => {
    const report = await checkProductionPrivacy(
      async (url) => new Response(null, { status: url.endsWith('/leads') ? status : 401 })
    );
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.path === '/leads').status, status);
    assert.equal(report.checks.length, 3);
  });
}

test('reports network failures without leaking exception details or skipping remaining routes', async () => {
  const report = await checkProductionPrivacy(async (url) => {
    if (url.endsWith('/leads')) throw new Error('sensitive fixture detail must not appear');
    return new Response(null, { status: 401 });
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.length, 3);
  assert.equal(report.checks[1].error, 'network_error');
  assert.doesNotMatch(JSON.stringify(report), /sensitive fixture detail/);
});

test('distinguishes a timed-out check from a successful protection check', async () => {
  const report = await checkProductionPrivacy(async () => {
    throw new DOMException('fixture timeout', 'TimeoutError');
  });
  assert.equal(report.ok, false);
  assert.ok(report.checks.every((check) => check.error === 'timeout'));
});

for (const status of [200, 401]) {
  test(`CLI exits ${status === 401 ? 'successfully for a private' : 'with failure for a public'} site`, () => {
    const fixture = `globalThis.fetch = async (_url, options) => {
      if (options.method !== 'GET' || options.credentials !== 'omit') throw Error('Unsafe check');
      return new Response(null, { status: ${status} });
    };`;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(fixture)}`,
        fileURLToPath(new URL('./netlify-production-privacy.mjs', import.meta.url)),
      ],
      { encoding: 'utf8', timeout: 10_000 }
    );
    assert.ifError(result.error);
    assert.equal(result.status, status === 401 ? 0 : 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, status === 401);
    assert.equal(report.checks.length, 3);
  });
}
