import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import ts from 'typescript';
import { analyzerPublicationTrace } from './fixtures/analyzer-publication-trace.mjs';
import * as publicationDiagnostics from './fixtures/analyzer-publication-trace.mjs';
import { verifyAnalyzerPublicationGuards } from './fixtures/analyzer-publication-timing.mjs';
import { createServer } from 'vite';
import { warmAnalyzerBrowserFixture, analyzerBrowserFixtureOptions } from './fixtures/analyzer-browser-warmup.mjs';
import { parseOptions, requestDisposition, observeLoadedAssets, observeContextAssets, forwardLiveRequest, sharedAnalyzerMatches, sampleResponse, runOperatorSessionProof } from './operator-session-browseros-live.mjs';
import { connectReadOnlyPage } from './qa-readonly-page-cdp.mjs';

const base = 'https://pbkcenter.netlify.app';
const revision = 'a'.repeat(40);
const args = ['--run-live', '--cdp-url', 'http://127.0.0.1:9100', '--expected-build', revision];
const pins = new Map([
  ['/assets/shell-pinned.js', Buffer.from('sample shell')],
  ['/assets/Inbox-pinned.js', Buffer.from('sample inbox')],
  ['/fonts/pbk-core/Geist.woff2', Buffer.from('sample font')],
]);
const paths = new Set(pins.keys());

test('release qualification requires controlled publication coverage on pull requests', () => {
  const workflow = parseYaml(readFileSync(new URL('../.github/workflows/release-qualification.yml', import.meta.url), 'utf8'));
  assert.ok(workflow.on.pull_request.branches.includes('main'));
  assert.equal(workflow.permissions.contents, 'read');
  const job = workflow.jobs['release-qualification'];
  assert.equal(job['continue-on-error'] ?? false, false);
  const command = 'node scripts/analyzer-draft-recovery-browser-smoke.mjs --controlled-publication';
  const index = job.steps.findIndex(step => step.run?.trim() === command);
  assert.ok(index >= 0, 'CI must exercise the controlled publication regression, not only the uninjected matrix');
  const step = job.steps[index];
  assert.equal(step.if, undefined, 'Controlled coverage must not be gated off');
  assert.equal(step['continue-on-error'] ?? false, false);
  const browsers = job.steps.findIndex(step => step.run?.includes('playwright install') && step.run.includes('chromium webkit'));
  assert.ok(browsers >= 0 && browsers < index, 'Install both proof browsers before controlled coverage');
});

test('controlled publication guards reject production and non-fixture pages before evaluation', async () => {
  let evaluated = false;
  for (const url of ['https://pbkcenter.netlify.app/analyzer', 'https://pbk-analyzer-qa.netlify.app/analyzer']) {
    await assert.rejects(verifyAnalyzerPublicationGuards({ url: () => url, evaluate() { evaluated = true; } },
      'pbk:prod:analyzer:current-deal', 'sample'), /isolated fixture/);
  }
  assert.equal(evaluated, false);
});

test('fixture startup diagnostics retain bounded static paths, not queries or foreign traffic', () => {
  assert.equal(typeof publicationDiagnostics.observeAnalyzerFixtureStartup, 'function');
  const page = new EventEmitter();
  const origin = 'https://pbk-analyzer-qa.netlify.app';
  const trace = publicationDiagnostics.observeAnalyzerFixtureStartup(page, origin);
  const request = path => ({ url: () => origin + path, resourceType: () => 'script' });
  const pending = request('/src/app/App.tsx?sample=private-query');
  page.emit('request', pending);
  page.emit('request', { url: () => 'https://outside.invalid/private', resourceType: () => 'script' });
  page.emit('domcontentloaded');
  assert.deepEqual(trace.snapshot(), { domReady: true, loaded: false, pendingCount: 1, pendingPaths: ['/src/app/App.tsx'] });
  page.emit('requestfinished', pending);
  for (let i = 0; i < 30; i++) page.emit('request', request(`/src/sample-${i}.js`));
  assert.equal(trace.snapshot().pendingPaths.length, 20);
  page.emit('load');
  assert.equal(trace.snapshot().loaded, true);
  trace.dispose();
  assert.equal(page.listenerCount('request'), 0);
  assert.equal(page.listenerCount('requestfinished'), 0);
  assert.equal(page.listenerCount('requestfailed'), 0);
  assert.equal(page.listenerCount('domcontentloaded'), 0);
  assert.equal(page.listenerCount('load'), 0);
});

test('sample publication tracing is opt-in and retains the original CAS baseline', () => {
  const app = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
  assert.equal(analyzerPublicationTrace(false).transform(app, '/src/app/App.tsx'), undefined);
  const traced = analyzerPublicationTrace(true).transform(app, '/src/app/App.tsx');
  assert.ok(traced.includes('const __sampleExpected = draftBaseline.current'));
  assert.ok(traced.includes("'end', { traceId: __sampleTraceId"));
  assert.ok(traced.includes("'exception', { traceId: __sampleTraceId"));
  assert.ok(traced.includes('expected: __sampleExpected'));
  const ast = ts.createSourceFile('App.tsx', traced, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let publication;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'commitAnalyzerDraft'
      && node.arguments[0]?.getText(ast) === 'next') publication = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(publication);
  assert.equal(publication.arguments[1].getText(ast), 'fields');
  assert.equal(publication.arguments[2].getText(ast), 'draftBaseline.current');
  assert.ok(traced.includes('draftBaseline.current = readAnalyzerDraftBaseline({ requirePrivateBaseline: true });'));
  assert.equal((traced.match(/readSharedAnalyzerDraft\(\)/g) || []).length,
    (app.match(/readSharedAnalyzerDraft\(\)/g) || []).length, 'Tracing must not add storage reads that can change cache timing');
  const output = ts.transpileModule(traced, { fileName: 'App.tsx', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(output.diagnostics, []);
});

test('sample tracing rejects changed anchors and never transforms unrelated modules', () => {
  const plugin = analyzerPublicationTrace(true);
  assert.equal(plugin.transform('sample', '/src/unrelated.ts'), undefined);
  assert.throws(() => plugin.transform('sample', '/src/app/App.tsx'), /trace anchor changed/);
  const storage = readFileSync(new URL('../src/app/utils/analyzerStorage.ts', import.meta.url), 'utf8');
  const traced = plugin.transform(storage, '/src/app/utils/analyzerStorage.ts');
  assert.ok(traced.includes("'conflict', { beds: deal?.beds, expected, shared: local, canonical, force }"));
  assert.ok(traced.includes("'compare', { beds: deal?.beds, expected, shared: local, canonical, force }"));
  assert.equal((traced.match(/readSharedAnalyzerDraft\(\)/g) || []).length,
    (storage.match(/readSharedAnalyzerDraft\(\)/g) || []).length);
  assert.ok(traced.includes('canonical !== expected || local !== expected'));
});

test('each fixture process has a separate dependency cache and a single scan entry', () => {
  const a = analyzerBrowserFixtureOptions('101'), b = analyzerBrowserFixtureOptions('202');
  assert.notEqual(a.cacheDir, b.cacheDir);
  assert.match(a.cacheDir, /^\.pbk-local\//);
  assert.deepEqual(a.optimizeDeps.entries, ['./scripts/fixtures/analyzer-draft-recovery.html']);
  assert.throws(() => analyzerBrowserFixtureOptions('../shared'), /Fixture run/);
});

test('fixture warmup awaits bounded local module transforms before browser startup', async () => {
  const paths = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let complete = false;
  let idleChecked = false;
  const warming = warmAnalyzerBrowserFixture({ environments: { client: { waitForRequestsIdle: async () => { idleChecked = true; } } }, transformRequest: async path => {
    paths.push(path);
    if (paths.length === 1) await held;
    return { code: 'sample module' };
  } }).then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(complete, false);
  assert.equal(paths.length, 1, 'Warm serially to bound cold compiler pressure');
  release();
  await warming;
  assert.ok(complete);
  assert.ok(idleChecked, 'Await the environment dependency graph, not only entry transforms');
  assert.ok(paths.length >= 3 && paths.length <= 8);
  assert.ok(paths.every(path => /^\/(?:src\/|scripts\/fixtures\/)/.test(path)));
  assert.ok(!paths.some(path => /api\/|invoke|https?:/.test(path)));
});

test('fixture warmup waits for dependency bundle processing after the transform graph is idle', async () => {
  let releaseScan, releaseBundle;
  const scanning = new Promise(resolve => { releaseScan = resolve; });
  const bundling = new Promise(resolve => { releaseBundle = resolve; });
  let complete = false;
  const warming = warmAnalyzerBrowserFixture({
    transformRequest: async () => ({ code: 'sample' }),
    environments: { client: { waitForRequestsIdle: async () => {},
      depsOptimizer: { scanProcessing: scanning, metadata: { depInfoList: [{ processing: bundling }] } },
    } },
  }).then(() => { complete = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(complete, false, 'An idle transform graph does not imply optimized dependencies are ready');
  releaseScan();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(complete, false, 'Scanning finishes before dependency bundles are committed');
  releaseBundle();
  await warming;
  assert.equal(complete, true);
});

test('real Vite transitive transforms finish before fixture preparation resolves', async () => {
  let release, entered, entriesReady;
  const held = new Promise(resolve => { release = resolve; });
  const dependencyEntered = new Promise(resolve => { entered = resolve; });
  const entriesTransformed = new Promise(resolve => { entriesReady = resolve; });
  const server = await createServer({ configFile: false,
    cacheDir: `.pbk-local/analyzer-warmup-contract-${process.pid}`,
    server: { host: '127.0.0.1', middlewareMode: true, hmr: { port: 0 }, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{ name: 'synthetic-warmup-graph', enforce: 'pre',
      resolveId(id) {
        if (id === 'virtual:held-warmup-dependency') return '\0sample-held-dependency';
      },
      async load(id) {
        const path = id.replaceAll('\\', '/');
        if (path.endsWith('/scripts/fixtures/analyzer-draft-recovery.tsx') || path.includes('/src/app/')) {
          return 'import "virtual:held-warmup-dependency"; export const sample = true;';
        }
        if (path.endsWith('/src/styles/index.css')) return '';
        if (id === '\0sample-held-dependency') { entered(); await held; return 'export const ready = true;'; }
      },
    }],
  });
  let warming, deadline;
  try {
    const transform = server.transformRequest.bind(server);
    let entries = 0;
    server.transformRequest = async (...args) => {
      const result = await transform(...args);
      if (++entries === 5) entriesReady();
      return result;
    };
    let complete = false;
    warming = warmAnalyzerBrowserFixture(server).then(() => { complete = true; });
    await Promise.race([Promise.all([dependencyEntered, entriesTransformed]), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(Error('Synthetic dependency did not start')), 10000);
    })]);
    clearTimeout(deadline);
    // Entry work is finished; only the transitive dependency remains held.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(complete, false, 'A transitive compiler task is still held');
    release();
    await warming;
    assert.equal(complete, true);
  } finally {
    clearTimeout(deadline);
    release();
    if (warming) await warming.catch(() => {});
    await server.close();
  }
});

test('missing or failed fixture transforms stop preparation instead of launching a browser', async () => {
  await assert.rejects(warmAnalyzerBrowserFixture({ transformRequest: async () => null }), /Fixture transform/);
  await assert.rejects(warmAnalyzerBrowserFixture({ transformRequest: async () => { throw Error('sample transform error'); } }), /sample transform error/);
});

test('Analyzer browser filters reject incompatible stress options before browser launch', () => {
  const bootstrap = `import {chromium,webkit} from ${JSON.stringify(import.meta.resolve('@playwright/test'))};
    for(const engine of [chromium,webkit]) engine.launch=async()=>{throw Error('Unexpected browser launch')};`;
  for (const flags of [['--chromium-only', '--webkit-only'], ['--chromium-only', '--stress-contention'],
    ['--chromium-only', '--webkit-only', '--stress-contention'],
    ['--chromium-only', '--stress-publication'], ['--stress-contention', '--stress-publication'],
    ['--controlled-publication', '--stress-publication'], ['--controlled-publication', '--stress-contention']]) {
    const child = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(bootstrap),
      fileURLToPath(new URL('./analyzer-draft-recovery-browser-smoke.mjs', import.meta.url)), ...flags],
    { encoding: 'utf8', timeout: 20000 });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Choose only one browser filter|Stress contention uses WebKit|Choose only one stress scenario|Choose controlled timing/);
    assert.ok(!child.stderr.includes('Unexpected browser launch'));
  }
});

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

test('verified helper assets are finalized before controlled page teardown', async () => {
  const context = new EventEmitter(), helper = new EventEmitter();
  let drained = false;
  const [path, body] = pins.entries().next().value;
  helper.waitForLoadState = async state => {
    assert.equal(state, 'networkidle');
    drained = true;
    helper.emit('response', response(path, body));
  };
  const tracker = observeContextAssets(context, pins, base);
  context.emit('page', helper);
  helper.emit('response', response(path, body));
  try {
    await tracker.verifyPage(helper);
    helper.emit('response', { ...response(path, body), body: async () => { throw Error('page closed'); } });
    assert.equal((await tracker.verifyAll()).pages, 1);
    assert.equal(drained, true);
    assert.equal(helper.listenerCount('response'), 0);
  } finally { tracker.stop(); }
});

test('a helper asset mismatch during network drain still fails closed', async () => {
  const context = new EventEmitter(), helper = new EventEmitter();
  const [path, body] = pins.entries().next().value;
  helper.waitForLoadState = async () => helper.emit('response', response(path, Buffer.from('stale')));
  const tracker = observeContextAssets(context, pins, base);
  context.emit('page', helper);
  helper.emit('response', response(path, body));
  try { await assert.rejects(tracker.verifyPage(helper), /body mismatch/); }
  finally { tracker.stop(); }
});

function mockSourceSocket(t, { autoOpen = true, respond = true, sendThrows = false, replyFor } = {}) {
  const sockets = [], requests = [];
  class SampleSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
      if (autoOpen) queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(raw) {
      if (sendThrows) throw Error('private-sample-cookie');
      const request = JSON.parse(raw);
      requests.push(request);
      if (!respond) return;
      const result = replyFor?.(request) ?? (request.method === 'Network.getCookies'
        ? { cookies: [{ name: 'sample', value: 'fictional-cookie', domain: 'pbkcenter.netlify.app', path: '/', expires: -1, httpOnly: true, secure: true }] }
        : { result: { value: { sample: true } } });
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: request.id, result }) })));
    }
    close() { this.closed = true; this.dispatchEvent(new Event('close')); }
  }
  t.mock.method(globalThis, 'WebSocket', function (url) { return new SampleSocket(url); });
  return { sockets, requests };
}

test('source attachment rejects non-loopback or non-page debugger targets before connecting', async t => {
  const { sockets } = mockSourceSocket(t);
  for (const [origin, target] of [
    ['http://remote.invalid:9100', 'ws://remote.invalid:9100/devtools/page/sample'],
    ['http://127.0.0.1:9100/private', 'ws://127.0.0.1:9100/devtools/page/sample'],
    ['http://user:private@127.0.0.1:9100', 'ws://127.0.0.1:9100/devtools/page/sample'],
    ['http://127.0.0.1:9100', 'ws://127.0.0.1:9101/devtools/page/sample'],
    ['http://127.0.0.1:9100', 'ws://127.0.0.1:9100/devtools/browser/sample'],
    ['http://127.0.0.1:9100', 'ws://127.0.0.1:9100/devtools/page/'],
    ['http://127.0.0.1:9100', 'ws://127.0.0.1:9100/devtools/page/sample?private=value'],
    ['http://127.0.0.1:9100', 'ws://user:private@127.0.0.1:9100/devtools/page/sample'],
  ]) {
    await assert.rejects(connectReadOnlyPage({ webSocketDebuggerUrl: target }, origin), error => {
      assert.ok(!error.message.includes('private'));
      return true;
    });
  }
  assert.equal(sockets.length, 0);
});

test('source attachment reads only through controlled RPCs and closes its socket, not a tab', async t => {
  const { sockets, requests } = mockSourceSocket(t);
  const page = await connectReadOnlyPage({ url: base, webSocketDebuggerUrl: 'ws://127.0.0.1:9100/devtools/page/sample' }, 'http://127.0.0.1:9100');
  try {
    assert.equal(page.url(), base);
    assert.deepEqual(await page.evaluate(() => ({ sample: true })), { sample: true });
    const cookies = await page.cookies(base);
    assert.equal(cookies[0].sameSite, 'Lax');
    assert.deepEqual(requests.map(request => request.method), ['Runtime.evaluate', 'Network.getCookies']);
    assert.equal(requests[0].params.returnByValue, true);
    assert.deepEqual(requests[1].params.urls, [base]);
  } finally { page.close(); }
  assert.equal(sockets[0].closed, true);
  assert.ok(!requests.some(request => /closeTarget|Browser.close|Storage|navigate/.test(request.method)));
});

test('operator session CI runs only offline contracts without production credentials or live opt-in', () => {
  const raw = readFileSync(new URL('../.github/workflows/operator-session-verify.yml', import.meta.url), 'utf8');
  const workflow = parseYaml(raw);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.on.pull_request.branches, ['main']);
  const steps = workflow.jobs['isolated-runner-contracts'].steps;
  assert.ok(steps.some(step => step.run === 'npm run test:analyzer-draft-storage'));
  assert.ok(steps.some(step => step.with?.['persist-credentials'] === false));
  assert.ok(!/secrets\.|--run-live|netlify deploy|render deploy/.test(raw));
});

const sampleSourceTarget = { url: base, webSocketDebuggerUrl: 'ws://127.0.0.1:9100/devtools/page/sample' };
const sampleCdpOrigin = 'http://127.0.0.1:9100';

test('source handshake timeout closes only the client socket', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets } = mockSourceSocket(t, { autoOpen: false });
  const connecting = connectReadOnlyPage(sampleSourceTarget, sampleCdpOrigin);
  const failed = assert.rejects(connecting, /QA source connection timed out/);
  t.mock.timers.tick(20000);
  await failed;
  assert.equal(sockets[0].closed, true);
});

test('source error and closure reject an unopened handshake without waiting', async t => {
  for (const event of ['error', 'close']) await t.test(event, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { sockets } = mockSourceSocket(t, { autoOpen: false });
    let failure;
    const connecting = connectReadOnlyPage(sampleSourceTarget, sampleCdpOrigin).catch(error => { failure = error; });
    sockets[0].dispatchEvent(new Event(event));
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.match(failure?.message ?? '', /QA source connection (?:failed|closed)/);
      assert.equal(sockets[0].closed, true);
    } finally {
      t.mock.timers.tick(20000);
      await connecting;
    }
  });
});

test('source closure settles pending reads immediately instead of waiting for a timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, requests } = mockSourceSocket(t, { respond: false });
  const page = await connectReadOnlyPage(sampleSourceTarget, sampleCdpOrigin);
  let failure;
  const reading = page.evaluate(() => 'sample').catch(error => { failure = error; });
  assert.equal(requests.length, 1);
  sockets[0].close();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.match(failure?.message ?? '', /QA source connection closed/);
  } finally {
    t.mock.timers.tick(30000);
    await reading;
    page.close();
  }
});

test('source send failures never expose raw transport details', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mockSourceSocket(t, { sendThrows: true });
  const page = await connectReadOnlyPage(sampleSourceTarget, sampleCdpOrigin);
  try {
    await assert.rejects(page.evaluate(() => 'sample'), error => {
      assert.ok(!error.message.includes('private-sample-cookie'));
      return true;
    });
  } finally {
    page.close();
    t.mock.timers.tick(30000);
  }
});

test('malformed source frames reject pending reads with generic errors and prevent further sends', async t => {
  const { sockets, requests } = mockSourceSocket(t, { respond: false });
  const page = await connectReadOnlyPage(sampleSourceTarget, sampleCdpOrigin);
  const failed = assert.rejects(page.evaluate(() => 'sample'), /QA source response invalid/);
  sockets[0].dispatchEvent(new MessageEvent('message', { data: 'private-sample-malformed-frame' }));
  await failed;
  await assert.rejects(page.cookies(base), /QA source response invalid/);
  assert.equal(requests.length, 1);
  assert.equal(sockets[0].closed, true);
});

test('a source operation timeout settles all pending reads and closes the transport', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sockets, requests } = mockSourceSocket(t, { respond: false });
  const page = await connectReadOnlyPage(sampleSourceTarget, sampleCdpOrigin);
  const failed = [assert.rejects(page.evaluate(() => 'sample'), /Read-only browser operation timed out/),
    assert.rejects(page.cookies(base), /Read-only browser operation timed out/)];
  t.mock.timers.tick(30000);
  await Promise.all(failed);
  await assert.rejects(page.evaluate(() => 'sample'), /Read-only browser operation timed out/);
  assert.equal(requests.length, 2);
  assert.equal(sockets[0].closed, true);
});

test('QA browser cleanup failure cannot skip source draft audit or socket cleanup', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pbk-operator-cleanup-sample-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    assert.ok(directory.includes('pbk-operator-cleanup-sample-'));
    rmSync(directory, { recursive: true });
  });
  mkdirSync(join(directory, 'assets'));
  mkdirSync(join(directory, 'fonts'));
  writeFileSync(join(directory, 'assets/sample.js'), 'sample');
  writeFileSync(join(directory, 'pbk-build-manifest.json'), JSON.stringify({ buildId: revision }));
  const auth = JSON.stringify({ token: 'fictional-auth-only', expiresAt: '2099-01-01T00:00:00Z' });
  let fingerprints = 0;
  const { sockets } = mockSourceSocket(t, { replyFor(request) {
    if (request.method === 'Network.getCookies') return;
    const expression = request.params.expression;
    let value;
    if (expression.includes('crypto.subtle.digest')) { fingerprints++; value = { 'local:pbk-deal-data': 'sample-fingerprint' }; }
    else if (expression.includes('pbk-build-manifest.json')) value = { buildId: revision };
    else if (expression.includes('return raw;')) value = auth;
    else value = true;
    return { result: { value } };
  } });
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, sampleCdpOrigin + '/json/list');
    return { json: async () => [sampleSourceTarget, { ...sampleSourceTarget, webSocketDebuggerUrl: 'ws://127.0.0.1:9100/devtools/page/peer' }].map(target => ({ ...target, type: 'page' })) };
  });
  t.mock.method(chromium, 'launch', async () => ({
    newContext: async () => { throw Error('sample context setup failed'); },
    close: async () => { throw Error('private-sample-cleanup-detail'); },
  }));
  const report = await runOperatorSessionProof({ base, cdpUrl: sampleCdpOrigin, revision, dist: directory, output: join(directory, 'report') });
  assert.equal(report.ok, false);
  assert.deepEqual(report.cleanupErrors, ['QA browser cleanup failed']);
  assert.equal(report.originalDraftsUnchanged, true);
  assert.equal(report.originalTabsChecked, 2);
  assert.equal(fingerprints, 4);
  assert.ok(sockets.every(socket => socket.closed));
  assert.ok(!JSON.stringify(report).includes('private-sample-cleanup-detail'));
  assert.ok(!JSON.stringify(report).includes('fictional-auth-only'));
  assert.equal(JSON.parse(readFileSync(join(directory, 'report/report.json'), 'utf8')).ok, false);
});
