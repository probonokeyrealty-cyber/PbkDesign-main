import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import ts from 'typescript';
import { analyzerPublicationTrace } from './fixtures/analyzer-publication-trace.mjs';
import * as publicationDiagnostics from './fixtures/analyzer-publication-trace.mjs';
import { verifyAnalyzerPublicationGuards } from './fixtures/analyzer-publication-timing.mjs';
import { createServer } from 'vite';
import { warmAnalyzerBrowserFixture, analyzerBrowserFixtureOptions } from './fixtures/analyzer-browser-warmup.mjs';
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
