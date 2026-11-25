import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import ts from 'typescript';
import { analyzerPublicationTrace } from './fixtures/analyzer-publication-trace.mjs';
import * as publicationDiagnostics from './fixtures/analyzer-publication-trace.mjs';
import { verifyAnalyzerPublicationGuards } from './fixtures/analyzer-publication-timing.mjs';
import { createServer } from 'vite';
import { warmAnalyzerBrowserFixture, analyzerBrowserFixtureOptions } from './fixtures/analyzer-browser-warmup.mjs';
import { parseOptions, requestDisposition, observeLoadedAssets, observeContextAssets, forwardLiveRequest, sharedAnalyzerMatches, sampleResponse, selectSourcePage, readSourceCookies, fingerprintSource } from './operator-session-browseros-live.mjs';

const base = 'https://pbkcenter.netlify.app';
const revision = 'a'.repeat(40);
const sourceTargetId = 'b'.repeat(32);
const args = ['--run-live', '--cdp-url', 'http://127.0.0.1:9100', '--expected-build', revision, '--source-target-id', sourceTargetId];
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
  assert.equal(parseOptions(args).sourceTargetId, sourceTargetId);
  assert.throws(() => parseOptions(args.slice(0, -2)), /source-target-id/);
  assert.throws(() => parseOptions([...args, '--source-target-id', sourceTargetId]), /duplicate/);
  for (const value of ['', '23', 'https://example.com', '--run-live']) {
    assert.throws(() => parseOptions([...args.slice(0, -1), value]), /source-target-id/);
  }
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
  assert.equal(requestDisposition('GET', 'https://fonts.googleapis.com/css2?family=Geist', base, paths), 'deny-external');
  assert.equal(requestDisposition('GET', 'https://fonts.gstatic.com/sample.woff2', base, paths), 'deny-external');
});

function sourcePage(id, calls, url = base + '/leads') {
  return { url: () => url, target: () => ({ createCDPSession: async () => ({
    send: async (method, params) => {
      calls.push([id, method, params]);
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: id } };
      assert.equal(method, 'Network.getCookies');
      return { cookies: [{ name: 'sample', value: 'sample-only', domain: 'pbkcenter.netlify.app',
        path: '/', expires: -1, httpOnly: true, secure: true }] };
    },
    detach: async () => { calls.push([id, 'detach']); },
  }) }) };
}

test('source selection is explicit even when multiple PBK tabs are open', async () => {
  const calls = [];
  const other = sourcePage('c'.repeat(32), calls), selected = sourcePage(sourceTargetId, calls);
  const foreign = sourcePage(sourceTargetId, calls, 'https://foreign.invalid/leads');
  const options = { base, sourceTargetId };
  assert.equal(await selectSourcePage({ pages: async () => [foreign, other, selected] }, options), selected);
  assert.equal(calls.filter(call => call[1] === 'detach').length, 2);
  assert.ok(calls.every(call => ['Target.getTargetInfo', 'detach'].includes(call[1])));
  await assert.rejects(selectSourcePage({ pages: async () => [foreign, other] }, options), /explicitly selected/);
});

test('cookie reuse is page-scoped, read-only and always detached', async () => {
  const calls = [];
  const cookies = await readSourceCookies(sourcePage(sourceTargetId, calls), base);
  assert.deepEqual(calls, [[sourceTargetId, 'Network.getCookies', { urls: [base + '/'] }], [sourceTargetId, 'detach']]);
  assert.equal(cookies[0].sameSite, 'Lax');
  let detached = false;
  const page = { target: () => ({ createCDPSession: async () => ({
    send: async () => { throw Error('unavailable'); }, detach: async () => { detached = true; },
  }) }) };
  await assert.rejects(readSourceCookies(page, base), /unavailable/);
  assert.equal(detached, true);
});

test('cookie reuse rejects partitioned cookies instead of silently unpartitioning them', async () => {
  for (const partition of [{ partitionKey: { topLevelSite: base, hasCrossSiteAncestor: false } },
    { partitionKeyOpaque: true }]) {
    let detached = false;
    const ordinary = { name: 'sample', value: 'ordinary-sample', domain: 'pbkcenter.netlify.app', path: '/' };
    const page = { target: () => ({ createCDPSession: async () => ({
      send: async () => ({ cookies: [ordinary, { ...ordinary, value: 'partitioned-sample', ...partition }] }),
      detach: async () => { detached = true; },
    }) }) };
    await assert.rejects(readSourceCookies(page, base), /Partitioned source cookies cannot be reused safely/);
    assert.equal(detached, true);
  }
});

test('draft fingerprints snapshot raw values before async hashing and ignore deployment bookkeeping', async () => {
  const data = {
    'pbk-deal-data': 'legacy sample', 'pbk:compose:draft': ' {"body":"sample"} ',
    'pbk:prod:analyzer:current-deal': 'sample analyzer', 'manual-notes': 'sample notes',
    'saved-comps': 'sample comp', 'pbk:deploy-refresh:/analyzer': 'bookkeeping',
    'pbk:team-session:v1': 'not a draft',
  };
  const storage = values => Object.defineProperty({ ...values }, 'getItem', { value(key) { return this[key] ?? null; } });
  const local = storage(data), session = storage({ 'session-draft': 'sample session draft' });
  let changed = false;
  const page = { evaluate: async (fn, origin) => runInNewContext(`(${fn.toString()})(origin)`, {
    origin, location: { origin: base }, localStorage: local, sessionStorage: session, TextEncoder,
    crypto: { subtle: { digest: async (...args) => {
      if (!changed) { changed = true; local['manual-notes'] = 'later sample'; session['session-draft'] = 'later session'; }
      return webcrypto.subtle.digest(...args);
    } } },
  }) };
  const hashes = await fingerprintSource(page, base);
  const expected = Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('pbk:deploy-refresh:') && !key.includes('team-session'))
    .map(([key, value]) => ['local:' + key, createHash('sha256').update(value).digest('hex')]));
  expected['session:session-draft'] = createHash('sha256').update('sample session draft').digest('hex');
  assert.deepEqual({ ...hashes }, expected);
  assert.ok(!JSON.stringify(hashes).includes('sample notes'));
  await assert.rejects(fingerprintSource(page, 'https://foreign.invalid'), /Source tab moved/);
});

test('CI runs offline recovery contracts, never the authenticated live runner', () => {
  const workflow = parseYaml(readFileSync(new URL('../.github/workflows/command-center-polish-verify.yml', import.meta.url), 'utf8'));
  for (const path of ['scripts/operator-session-browseros-live.mjs', 'scripts/operator-session-browseros.node-test.mjs',
    'scripts/analyzer-browseros-mobile-live.mjs', 'scripts/analyzer-draft-recovery-browser-smoke.mjs',
    'scripts/fixtures/analyzer-publication-trace.mjs', 'scripts/fixtures/analyzer-publication-timing.mjs',
    'scripts/fixtures/analyzer-browser-warmup.mjs', '.github/workflows/release-qualification.yml']) {
    assert.ok(workflow.on.pull_request.paths.includes(path), `Recovery contracts must run when ${path} changes`);
  }
  const commands = workflow.jobs['isolated-desktop-mobile'].steps.map(step => step.run || '').join('\n');
  assert.ok(commands.includes('node --test scripts/operator-session-browseros.node-test.mjs'));
  assert.ok(!commands.includes('--run-live'));
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
