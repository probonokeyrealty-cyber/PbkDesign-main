import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOptions, requestDisposition } from './analyzer-browseros-mobile-live.mjs';

const base = 'https://pbkcenter.netlify.app';
const build = 'a'.repeat(40);
const args = ['--run-live', '--cdp-url', 'http://127.0.0.1:9100', '--expected-build', build];

test('live execution requires explicit opt-in and a pinned build', () => {
  assert.throws(() => parseOptions([]), /run-live/);
  assert.throws(() => parseOptions(['--run-live', '--cdp-url', args[2]]), /expected-build/);
  const options = parseOptions(args);
  assert.equal(options.base, base);
  assert.equal(options.revision, build);
  assert.equal(options.cdpUrl, 'http://127.0.0.1:9100');
});

test('help does not require a connection or live opt-in', () => {
  assert.equal(parseOptions(['--help']).help, true);
});

test('reject remote, credential-bearing, or non-HTTP CDP endpoints', () => {
  for (const url of ['http://remote.example:9100', 'http://user:secret@localhost:9100', 'file:///tmp/browser', 'http://localhost:9100/private?token=x']) {
    assert.throws(() => parseOptions([...args, '--cdp-url', url]), /duplicate|loopback|CDP/);
    assert.throws(() => parseOptions(['--run-live', '--cdp-url', url, '--expected-build', build]), /loopback|CDP/);
  }
});

test('accept loopback CDP endpoints without hardcoded machine paths', () => {
  for (const url of ['http://localhost:9100', 'http://[::1]:9100']) {
    assert.equal(parseOptions(['--run-live', '--cdp-url', url, '--expected-build', build]).cdpUrl, url);
  }
});

test('reject an unpinned build, unapproved site, duplicate flags, and unknown options', () => {
  assert.throws(() => parseOptions(['--run-live', '--cdp-url', args[2], '--expected-build', 'main']), /expected-build/);
  assert.throws(() => parseOptions([...args, '--base-url', 'https://example.com']), /PBK/);
  assert.throws(() => parseOptions([...args, '--base-url', base + '/leads']), /origin/);
  assert.throws(() => parseOptions([...args, '--run-live']), /duplicate/);
  assert.throws(() => parseOptions([...args, '--unsafe']), /Unknown/);
});

test('only real team status and verification can reach the hosted API', () => {
  assert.equal(requestDisposition('GET', base + '/api/auth/team/status', base), 'live');
  assert.equal(requestDisposition('POST', base + '/api/auth/team/verify', base), 'verify');
  assert.equal(requestDisposition('POST', base + '/api/auth/team', base), 'deny-write');
  assert.equal(requestDisposition('GET', base + '/assets/App-test.js', base), 'live');
});

test('stub CRM, provider, property, event, and stream-session reads', () => {
  for (const path of ['/api/leads', '/api/approvals', '/api/state', '/api/property-data/lookup', '/state', '/health', '/events', '/invoke', '/.netlify/functions/pbk-bridge-proxy']) {
    assert.equal(requestDisposition('GET', base + path, base), 'fixture');
  }
  assert.equal(requestDisposition('GET', base + '/api/property-data/address-suggestions', base), 'suggestions');
  assert.equal(requestDisposition('POST', base + '/api/state/stream/session', base), 'stream');
});

test('deny every business mutation, including alternate methods and direct providers', () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    for (const path of ['/api/leads/fixture', '/api/invoke', '/api/approvals/x', '/api/calls', '/api/sms', '/api/messages', '/anything']) {
      assert.equal(requestDisposition(method, base + path, base), 'deny-write');
    }
  }
  assert.equal(requestDisposition('GET', 'https://pbk-openclaw-bridge.onrender.com/invoke', base), 'deny-external');
  assert.equal(requestDisposition('POST', 'https://provider.example/send', base), 'deny-external');
  assert.equal(requestDisposition('POST', 'https://provider.example/api/auth/team/verify', base), 'deny-external');
});

test('allow only read-only external font assets', () => {
  assert.equal(requestDisposition('GET', 'https://fonts.gstatic.com/font.woff2', base), 'live');
  assert.equal(requestDisposition('POST', 'https://fonts.gstatic.com/font.woff2', base), 'deny-external');
  assert.equal(requestDisposition('GET', 'https://fonts.gstatic.com.evil.example/font.woff2', base), 'deny-external');
});
