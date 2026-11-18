import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as runner from './analyzer-browseros-mobile-live.mjs';
const { observeAnalyzerBuild, parseOptions, requestDisposition } = runner;

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

test('desktop proof is explicit and does not replace the mobile default', () => {
  assert.equal(parseOptions(args).desktop, false);
  assert.equal(parseOptions([...args, '--desktop']).desktop, true);
  assert.throws(() => parseOptions(['--desktop']), /run-live/);
  assert.throws(() => parseOptions([...args, '--desktop', '--desktop']), /duplicate/);
});

function contextFixture(sourceId = 'source', qaId = 'qa') {
  const detached = [];
  const context = id => ({ newCDPSession: async () => ({
    send: async method => { assert.equal(method, 'Target.getTargetInfo'); return { targetInfo: { browserContextId: id } }; },
    detach: async () => { detached.push(id); },
  }) });
  const source = context(sourceId), qa = context(qaId);
  return { source: { context: () => source }, page: { context: () => qa }, detached };
}

test('native isolation rejects the same Playwright context before any CDP reads', async () => {
  const context = { newCDPSession: () => assert.fail('Same-context proof must stop immediately') };
  await assert.rejects(() => runner.verifyContextIsolation({ context: () => context }, { context: () => context }), /isolated/);
});

test('native isolation rejects distinct wrappers for the same native context', async () => {
  for (const id of ['shared', '']) {
    const fixture = contextFixture(id, id);
    await assert.rejects(() => runner.verifyContextIsolation(fixture.source, fixture.page), /Native/);
    assert.equal(fixture.detached.length, 2);
  }
});

test('native isolation permits a distinct native QA context and detaches both readers', async () => {
  const fixture = contextFixture();
  await runner.verifyContextIsolation(fixture.source, fixture.page);
  assert.deepEqual(fixture.detached, ['source', 'qa']);
});

test('QA setup fails before seeding storage and cannot close a colliding source context', async () => {
  const fixture = contextFixture('shared', 'shared');
  let closedPage = 0;
  const page = { ...fixture.page, close: async () => { closedPage++; } };
  const context = page.context();
  context.newPage = async () => page;
  context.addCookies = () => assert.fail('Do not seed an unverified context');
  context.close = () => assert.fail('Do not close an unverified native context');
  await assert.rejects(() => runner.openIsolatedQaContext({ newContext: async () => context }, fixture.source, {}), /Native/);
  assert.equal(closedPage, 1);
});

test('QA setup returns a verified blank page before authentication is seeded', async () => {
  const fixture = contextFixture();
  const context = fixture.page.context();
  context.newPage = async () => fixture.page;
  const options = { viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true };
  const result = await runner.openIsolatedQaContext({ newContext: async actual => {
    assert.equal(actual, options);
    return context;
  } }, fixture.source, options);
  assert.equal(result.context, context);
  assert.equal(result.page, fixture.page);
});

function cookieFixture(contextId, error = false) {
  const calls = [], detached = [];
  return { calls, detached,
    source: { url: () => base + '/analyzer', context: () => ({ newCDPSession: async () => ({
      send: async method => { calls.push([method]); return { targetInfo: { browserContextId: contextId } }; },
      detach: async () => detached.push('page'),
    }) }) },
    browser: { newBrowserCDPSession: async () => ({
      send: async (method, params) => {
        calls.push([method, params]);
        if (error) throw Error('Read failed');
        return { cookies: [{ domain: 'pbkcenter.netlify.app', name: 'site', value: 'sample' },
          { domain: '.netlify.app', name: 'parent', value: 'sample' },
          { domain: 'netlify.app', name: 'host-only-parent', value: 'sample' },
          { domain: 'notpbkcenter.netlify.app', name: 'foreign', value: 'sample' },
          { domain: 'example.com', name: 'foreign', value: 'sample' }] };
      }, detach: async () => detached.push('browser'),
    }) },
  };
}

test('cookie reads use the actual native source context and only matching domains', async () => {
  const fixture = cookieFixture('actual-incognito');
  const cookies = await runner.readSourceCookies(fixture.browser, fixture.source, base);
  assert.deepEqual(fixture.calls, [['Target.getTargetInfo'], ['Storage.getCookies', { browserContextId: 'actual-incognito' }]]);
  assert.deepEqual(cookies.map(cookie => cookie.name), ['site', 'parent']);
  assert.deepEqual(fixture.detached, ['page', 'browser']);
});

test('default native cookie reads omit the context override and detach on failure', async () => {
  const fixture = cookieFixture(undefined, true);
  await assert.rejects(() => runner.readSourceCookies(fixture.browser, fixture.source, base), /Read failed/);
  assert.deepEqual(fixture.calls[1], ['Storage.getCookies', {}]);
  assert.deepEqual(fixture.detached, ['page', 'browser']);
});

test('partitioned source cookies preserve their site and ancestor metadata in Playwright shape', async () => {
  for (const hasCrossSiteAncestor of [false, true]) {
    const fixture = cookieFixture('sample-partition');
    fixture.browser.newBrowserCDPSession = async () => ({
      send: async () => ({ cookies: [{ name: 'partitioned', value: 'sample', domain: 'pbkcenter.netlify.app',
        path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'None', priority: 'Medium',
        partitionKey: { topLevelSite: base, hasCrossSiteAncestor } }] }),
      detach: async () => {},
    });
    const [cookie] = await runner.readSourceCookies(fixture.browser, fixture.source, base);
    assert.equal(cookie.partitionKey, base, 'Playwright expects a string partition key');
    assert.equal(cookie._crHasCrossSiteAncestor, hasCrossSiteAncestor);
    assert.equal(cookie.priority, undefined, 'CDP-only fields should not leak into the Playwright cookie shape');
    assert.equal(cookie.sameSite, 'None');
    assert.equal(cookie.secure, true);
  }
});

test('cookie reads reject a foreign source before touching its context', async () => {
  const source = { url: () => 'https://example.com/analyzer', context: () => assert.fail('Foreign source must not be read') };
  await assert.rejects(() => runner.readSourceCookies({}, source, base), /origin/);
});

test('draft fingerprint captures all protected values before hashing and excludes authentication', async () => {
  const values = { 'pbk:prod:analyzer:current-deal': 'old', 'pbk:compose:draft:v1': 'note', 'pbk:team-session:v1': 'private-auth' };
  const localStorage = { ...values };
  const sessionStorage = { 'pbk:prod:analyzer:current-deal:session': 'private-note' };
  for (const storage of [localStorage, sessionStorage]) Object.defineProperty(storage, 'getItem', { value: key => storage[key] ?? null });
  let hashes = 0;
  const result = await runner.fingerprintDrafts({ evaluate: (fn, argument) => runInNewContext('(' + fn.toString() + ')(base)', {
    base: argument, location: { origin: base }, localStorage, sessionStorage, TextEncoder, Uint8Array,
    crypto: { subtle: { digest: async (_, bytes) => {
      if (++hashes === 1) localStorage['pbk:compose:draft:v1'] = 'peer-update';
      return Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
    } } },
  }) }, base);
  assert.equal(Object.keys(result).length, 3);
  assert.equal(result['local:pbk:compose:draft:v1'], createHash('sha256').update('note').digest('hex'));
  assert.equal(result['session:pbk:prod:analyzer:current-deal:session'], createHash('sha256').update('private-note').digest('hex'));
  assert.ok(!JSON.stringify(result).includes('private-auth'));
  assert.ok(!JSON.stringify(result).includes('private-note'));
});

test('legacy Analyzer draft modification and removal cannot pass preservation checks', async () => {
  const localStorage = { 'pbk-deal-data': 'original legacy sample' };
  Object.defineProperty(localStorage, 'getItem', { value: key => localStorage[key] ?? null });
  const page = { evaluate: (fn, argument) => runInNewContext('(' + fn.toString() + ')(base)', {
    base: argument, location: { origin: base }, localStorage, sessionStorage: {}, TextEncoder, Uint8Array,
    crypto: { subtle: { digest: async (_, bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer } },
  }) };
  const before = await runner.fingerprintDrafts(page, base);
  assert.ok(before['local:pbk-deal-data'], 'Legacy Analyzer data must be protected');
  localStorage['pbk-deal-data'] = 'changed legacy sample';
  assert.notEqual(JSON.stringify(await runner.fingerprintDrafts(page, base)), JSON.stringify(before));
  delete localStorage['pbk-deal-data'];
  assert.notEqual(JSON.stringify(await runner.fingerprintDrafts(page, base)), JSON.stringify(before));
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
