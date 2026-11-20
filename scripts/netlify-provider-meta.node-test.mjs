import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = bridge.indexOf('function getNetlifyProviderMeta() {');
const end = bridge.indexOf('\nasync function fireSlackWebhook', start);
assert.ok(start >= 0 && end > start, 'Netlify provider metadata function must be available.');
const source = bridge.slice(start, end);
const getMeta = (env) => runInNewContext(`${source}\ngetNetlifyProviderMeta()`, { process: { env }, URL });

test('default dashboard link targets the protected staff project', () => {
  const meta = getMeta({});
  assert.equal(meta.url, 'https://pbkcenter.netlify.app');
  assert.equal(meta.ready, true);
});

test('an explicit frontend URL is configured without Netlify build variables', () => {
  const meta = getMeta({ PBK_FRONTEND_URL: 'https://staff.example.com' });
  assert.equal(meta.url, 'https://staff.example.com');
  assert.equal(meta.configured, true);
  assert.equal(meta.ready, true);
});

test('PBK Netlify URL takes precedence over a generic host URL', () => {
  const meta = getMeta({ PBK_NETLIFY_URL: 'https://pbkcenter.netlify.app', URL: 'https://bridge.example.com' });
  assert.equal(meta.url, 'https://pbkcenter.netlify.app');
});

test('malformed or unsafe frontend links do not report ready', () => {
  for (const url of ['invalid', 'javascript:alert(1)', 'https://user:password@example.com']) {
    const meta = getMeta({ NETLIFY_SITE_ID: 'test-site', PBK_FRONTEND_URL: url });
    assert.equal(meta.ready, false, url);
    assert.equal(meta.url, '', 'Invalid or credential-bearing URLs must not be exposed.');
  }
});
