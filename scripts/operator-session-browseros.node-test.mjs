import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { parseOptions, requestDisposition, observeLoadedAssets, observeContextAssets, forwardLiveRequest, sharedAnalyzerMatches, sampleResponse } from './operator-session-browseros-live.mjs';

const base = 'https://pbkcenter.netlify.app';
const revision = 'a'.repeat(40);
const args = ['--run-live', '--cdp-url', 'http://127.0.0.1:9100', '--expected-build', revision];
const pins = new Map([
  ['/assets/shell-pinned.js', Buffer.from('sample shell')],
  ['/assets/Inbox-pinned.js', Buffer.from('sample inbox')],
  ['/fonts/pbk-core/Geist.woff2', Buffer.from('sample font')],
]);
const paths = new Set(pins.keys());

test('import/help are inert and live execution needs explicit opt-in and a pinned build', () => {
  assert.deepEqual(parseOptions(['--help']), { help: true });
  assert.throws(() => parseOptions([]), /run-live/);
  assert.throws(() => parseOptions(['--run-live', '--cdp-url', args[2]]), /expected-build/);
  assert.equal(parseOptions(args).revision, revision);
  assert.equal(parseOptions(args).base, base);
});

test('reject remote CDP, credentials, foreign sites and duplicate flags', () => {
  for (const url of ['https://localhost:9100', 'http://remote.example:9100', 'http://user:secret@localhost:9100', 'http://localhost:9100/private']) {
    assert.throws(() => parseOptions(['--run-live', '--cdp-url', url, '--expected-build', revision]), /loopback|CDP/);
  }
  assert.throws(() => parseOptions([...args, '--base-url', 'https://example.com']), /PBK/);
  assert.throws(() => parseOptions([...args, '--run-live']), /duplicate/);
});

test('only exact read-only team verification/status exceptions reach the live bridge', () => {
  assert.equal(requestDisposition('POST', base + '/api/auth/team/verify', base, paths), 'verify');
  assert.equal(requestDisposition('GET', base + '/api/auth/team/status', base, paths), 'live');
  for (const path of ['/api/auth/team', '/api/auth/team/verify?path=/invoke', '/api/auth/team/verify/']) {
    assert.equal(requestDisposition('POST', base + path, base, paths), 'deny-write');
  }
});

test('CRM, approval, provider and even side-effecting Brain GETs are fixtures', () => {
  for (const path of ['/state', '/status', '/metrics', '/api/leads', '/api/approvals', '/api/messages', '/api/calls', '/brain/query?q=sample', '/brain/blog', '/.netlify/functions/pbk-bridge-proxy?path=/invoke']) {
    assert.equal(requestDisposition('GET', base + path, base, paths), 'fixture', path);
  }
  assert.equal(requestDisposition('POST', base + '/api/state/stream/session', base, paths), 'stream');
});

test('all business mutations and direct-provider requests are blocked', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/invoke', '/api/leads/sample', '/api/approvals/sample/approve', '/api/messages', '/api/calls', '/inbox']) {
      assert.equal(requestDisposition(method, base + path, base, paths), 'deny-write', `${method} ${path}`);
    }
  }
  assert.equal(requestDisposition('GET', 'https://provider.invalid/state', base, paths), 'deny-external');
  assert.equal(requestDisposition('POST', 'https://provider.invalid/api/auth/team/verify', base, paths), 'deny-external');
});

test('shell/asset allowlist is exact and cannot carry query overrides or credentials', () => {
  for (const path of ['/command-center', '/inbox', '/analyzer', '/index.shell.html', '/pbk-build-manifest.json', ...paths]) {
    assert.equal(requestDisposition('GET', base + path, base, paths), 'live', path);
  }
  for (const path of ['/inbox?path=/invoke', '/command-center/', '/assets/unknown.js', '/unknown']) {
    assert.equal(requestDisposition('GET', base + path, base, paths), 'deny-read', path);
  }
  assert.notEqual(requestDisposition('GET', 'https://user:secret@pbkcenter.netlify.app/inbox', base, paths), 'live');
});

test('approval and lead fixtures are fictional and never claim delivery', () => {
  const state = sampleResponse('/state', new URLSearchParams());
  assert.equal(state.status.mode, 'approval');
  assert.equal(state.approvals[0].status, 'pending');
  assert.match(state.approvals[0].id, /^SYN-/);
  assert.ok(state.leadImports.every(lead => lead.id.startsWith('SYN-')));
  assert.deepEqual(sampleResponse('/api/approvals', new URLSearchParams()).approvals, state.approvals);
  assert.equal(state.documentDeliveries.length, 0);
});

function response(path, body, status = 200, origin = base) {
  return { url: () => origin + path, status: () => status, body: async () => body };
}

test('verify actual page response bytes including duplicate paths; detach observer', async () => {
  const page = new EventEmitter(), proof = observeLoadedAssets(page, pins, base);
  for (const [path, body] of pins) page.emit('response', response(path, body));
  assert.equal((await proof.verify()).length, pins.size);
  page.emit('response', response('/assets/Inbox-pinned.js', Buffer.from('stale body')));
  await assert.rejects(proof.verify(), /body mismatch/);
  proof.stop();
  assert.equal(page.listenerCount('response'), 0);
});

test('empty, stale, foreign, failed and unreadable bundle responses fail closed', async () => {
  for (const item of [null, response('/assets/stale.js', Buffer.from('old')), response('/assets/Inbox-pinned.js', pins.get('/assets/Inbox-pinned.js'), 200, 'https://foreign.invalid'), response('/assets/Inbox-pinned.js', Buffer.alloc(0), 503), { ...response('/assets/Inbox-pinned.js'), body: async () => { throw Error('unavailable'); } }]) {
    const page = new EventEmitter(), proof = observeLoadedAssets(page, pins, base);
    if (item) page.emit('response', item);
    await assert.rejects(proof.verify());
    proof.stop();
  }
});

test('authenticated forwarding failures are contained without retaining sensitive errors', async () => {
  const state = { authVerified: 0, forwardFailures: 0 };
  let aborted = 0;
  const route = { fetch: async () => { throw Error('Cookie: private-cookie; X-PBK-Team-Token: private-token'); },
    abort: async () => { aborted++; } };
  await forwardLiveRequest(route, state, 'verify');
  assert.deepEqual(state, { authVerified: 0, forwardFailures: 1 });
  assert.equal(aborted, 1);
  assert.ok(!JSON.stringify(state).includes('private-'));
});

test('forwarding handles redirects, closed routes and successful verification safely', async () => {
  const state = { authVerified: 0, forwardFailures: 0 };
  await forwardLiveRequest({ fetch: async () => ({ status: () => 302 }), abort: async () => {} }, state, 'verify');
  assert.equal(state.authVerified, 0);
  await forwardLiveRequest({ fetch: async () => { throw Error('private-cookie'); }, abort: async () => { throw Error('closed'); } }, state, 'verify');
  assert.equal(state.forwardFailures, 1);
  await forwardLiveRequest({ fetch: async () => ({ status: () => 200, ok: () => true }), fulfill: async () => {} }, state, 'verify');
  assert.equal(state.authVerified, 1);
});

test('helper-tab assets cannot reuse primary-tab proof', async () => {
  for (const stale of [false, true]) {
    const context = new EventEmitter(), first = new EventEmitter(), second = new EventEmitter();
    const tracker = observeContextAssets(context, pins, base);
    context.emit('page', first);
    context.emit('page', second);
    for (const [path, body] of pins) first.emit('response', response(path, body));
    if (stale) second.emit('response', response('/assets/Inbox-pinned.js', Buffer.from('stale helper')));
    await assert.rejects(tracker.verifyAll());
    tracker.stop();
    assert.equal(context.listenerCount('page'), 0);
    assert.equal(first.listenerCount('response'), 0);
    assert.equal(second.listenerCount('response'), 0);
  }
});

test('shared Analyzer completion requires the committed ARV and comp, not just a seed', () => {
  const encode = payload => Buffer.from(JSON.stringify({ payload })).toString('base64');
  assert.equal(sharedAnalyzerMatches(null), false);
  assert.equal(sharedAnalyzerMatches('broken'), false);
  assert.equal(sharedAnalyzerMatches(encode({ arv: 500000 })), false);
  assert.equal(sharedAnalyzerMatches(encode({ arv: 600000, comps: { A: { price: 500000 } } })), false);
  assert.equal(sharedAnalyzerMatches(encode({ arv: 600000, comps: { A: { price: 600000 } } })), true);
});
