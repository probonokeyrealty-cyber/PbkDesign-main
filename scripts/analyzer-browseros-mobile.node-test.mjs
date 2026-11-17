import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { observeAnalyzerBuild, parseOptions, requestDisposition } from './analyzer-browseros-mobile-live.mjs';

const base = 'https://pbkcenter.netlify.app';
const build = 'a'.repeat(40);
const args = ['--run-live', '--cdp-url', 'http://127.0.0.1:9100', '--expected-build', build];
const staticPaths = new Set(['/assets/App-test.js', '/assets/shell-test.css', '/fonts/pbk-core/Geist.woff2']);

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
  assert.equal(requestDisposition('GET', base + '/assets/App-test.js', base, staticPaths), 'live');
});

test('fixture bridge aliases even when a GET can persist Brain activity or memory', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    for (const path of ['/brain/query?q=fixture', '/brain/blog', '/status', '/metrics']) {
      assert.equal(requestDisposition(method, base + path, base, staticPaths), 'fixture', `${method} ${path}`);
    }
  }
});

test('only exact static entries and the Analyzer shell may reach the site', () => {
  for (const path of ['/analyzer', '/index.shell.html', '/pbk-build-manifest.json', ...staticPaths]) {
    for (const method of ['GET', 'HEAD']) {
      assert.equal(requestDisposition(method, base + path, base, staticPaths), 'live', `${method} ${path}`);
    }
    assert.equal(requestDisposition('OPTIONS', base + path, base, staticPaths), 'deny-read');
    assert.equal(requestDisposition('POST', base + path, base, staticPaths), 'deny-write');
  }
  for (const path of ['/anything', '/unknown.js', '/assets/App-old.js', '/assets/App-test.js/extra',
    '/assets/App-test.js?path=/brain/query', '/analyzer?path=/api/leads', '/%61pi/leads']) {
    assert.equal(requestDisposition('GET', base + path, base, staticPaths), 'deny-read', path);
  }
  assert.equal(requestDisposition('GET', base + '/assets/App-test.js', base), 'deny-read');
});

test('real auth exceptions require their exact method and query-free URL', () => {
  assert.equal(requestDisposition('GET', base + '/api/auth/team/status', base), 'live');
  assert.equal(requestDisposition('POST', base + '/api/auth/team/verify', base), 'verify');
  for (const path of ['/api/auth/team/status?path=/brain/query', '/api/auth/team/status/']) {
    assert.equal(requestDisposition('GET', base + path, base), 'fixture');
  }
  for (const path of ['/api/auth/team/verify?path=/api/leads', '/api/auth/team/verify/']) {
    assert.equal(requestDisposition('POST', base + path, base), 'deny-write');
  }
  assert.equal(requestDisposition('HEAD', base + '/api/auth/team/status', base), 'fixture');
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

const pinnedAssets = new Map([
  ['/assets/App-pinned.js', Buffer.from('fixture app module')],
  ['/assets/DealView-pinned.js', Buffer.from('fixture deal view module')],
  ['/assets/analyzerStorage-pinned.js', Buffer.from('fixture storage module')],
]);

function assetResponse(path, body, { status = 200, origin = base } = {}) {
  return { url: () => origin + path, status: () => status, body: async () => body };
}

function emitPinnedAssets(page, assets = pinnedAssets) {
  for (const [path, body] of assets) page.emit('response', assetResponse(path, body));
}

function observe(page) {
  return observeAnalyzerBuild(page, pinnedAssets, base);
}

test('accept the exact paths and bytes loaded by the page and remove the observer', async () => {
  const page = new EventEmitter();
  const proof = observe(page);
  page.emit('response', assetResponse('/api/leads', Buffer.from('ignored fixture')));
  emitPinnedAssets(page);
  assert.deepEqual(await proof.verify(), [...pinnedAssets.keys()]);
  proof.stop();
  assert.equal(page.listenerCount('response'), 0);
});

test('reject a stale shell even when every pinned asset is available separately', async () => {
  const page = new EventEmitter();
  const proof = observe(page);
  // The server may still serve all pinned entries; only page responses are evidence.
  for (const [path, body] of pinnedAssets) {
    page.emit('response', assetResponse(path.replace('-pinned.js', '-old.js'), body));
  }
  await assert.rejects(proof.verify(), /Unexpected loaded Analyzer asset/);
  proof.stop();
});

test('reject missing page responses instead of substituting direct asset downloads', async () => {
  const page = new EventEmitter();
  const proof = observe(page);
  const [path, body] = [...pinnedAssets][0];
  page.emit('response', assetResponse(path, body));
  await assert.rejects(proof.verify(), /Missing loaded Analyzer asset/);
  proof.stop();
});

test('reject changed bytes at a pinned asset path', async () => {
  const page = new EventEmitter();
  const proof = observe(page);
  emitPinnedAssets(page, new Map([...pinnedAssets].map(([path, body]) => [path,
    path.includes('App-') ? Buffer.from('stale body under pinned filename') : body])));
  await assert.rejects(proof.verify(), /Loaded Analyzer asset body mismatch/);
  proof.stop();
});

test('reject non-success, foreign-origin, and unreadable Analyzer responses', async () => {
  for (const kind of ['status', 'origin', 'unreadable']) {
    const page = new EventEmitter();
    const proof = observe(page);
    emitPinnedAssets(page);
    const [path, body] = [...pinnedAssets][0];
    const response = assetResponse(path, body, kind === 'status' ? { status: 404 }
      : kind === 'origin' ? { origin: 'https://other.example' } : {});
    if (kind === 'unreadable') response.body = async () => { throw new Error('fixture read failure'); };
    page.emit('response', response);
    await assert.rejects(proof.verify(), /Loaded Analyzer asset (status|origin|body unavailable)/);
    proof.stop();
  }
});

test('a later navigation cannot reuse an earlier successful asset proof', async () => {
  const page = new EventEmitter();
  const first = observe(page);
  emitPinnedAssets(page);
  await first.verify();
  first.stop();
  const reload = observe(page);
  await assert.rejects(reload.verify(), /Missing loaded Analyzer asset/);
  reload.stop();
});
