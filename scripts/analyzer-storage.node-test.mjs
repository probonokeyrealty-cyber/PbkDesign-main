import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/utils/analyzerStorage.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
function runtime(pathname = '/analyzer', search = '') {
  const shared = new Map(), privateDraft = new Map();
  const store = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  });
  const context = vm.createContext({
    exports: {}, window: { location: { hostname: 'pbkcenter.netlify.app', pathname, search } },
    localStorage: store(shared), sessionStorage: store(privateDraft),
    btoa, atob, encodeURIComponent, decodeURIComponent, escape, unescape, URLSearchParams,
    console: { warn() {} },
  });
  vm.runInContext(outputText, context);
  return { api: context.exports, shared, privateDraft, context };
}
const decode = value => JSON.parse(decodeURIComponent(escape(atob(value))));
const sample = { leadId: 'fixture', address: '11 Fixture Avenue', arv: 500000,
  notes: 'Unsent sample notes', repairs: { condition: 'C3', mid: 15000 }, repairsMid: 15000 };

const freshToken = 'c94d11e1-6aa5-46b8-9a9b-119481e34888';
test('Fresh Analyzer ignores shared and legacy drafts, including the same lead', () => {
  const { api, shared, privateDraft } = runtime('/deal/fixture', `?fresh=${freshToken}`);
  shared.set(api.ANALYZER_CURRENT_DEAL_KEY, JSON.stringify(sample));
  shared.set('pbk-deal-data', JSON.stringify(sample));
  privateDraft.set(`${api.ANALYZER_CURRENT_DEAL_KEY}:session`, JSON.stringify(sample));
  assert.equal(api.readAnalyzerDeal({}).notes, undefined);
  assert.equal(api.readSharedAnalyzerDraft(), null);
  assert.equal(api.readAnalyzerDraftManualFields(), null);
});

test('Fresh edits, force publication and clear stay tab-only without shared coordination', async () => {
  const { api, shared, context } = runtime('/deal/fixture', `?fresh=${freshToken}`);
  shared.set(api.ANALYZER_CURRENT_DEAL_KEY, 'original-shared-draft');
  shared.set('pbk-deal-data', 'legacy-draft');
  api.writeAnalyzerDeal(sample, ['notes', 'repairs']);
  assert.equal(api.readAnalyzerDeal({}).repairs.mid, 15000);
  assert.deepEqual([...api.readAnalyzerDraftManualFields()], ['notes', 'repairs']);
  assert.equal(await api.commitAnalyzerDraft({ ...sample, beds: 6 }, ['beds'], null, true, () => true), 'published');
  assert.equal(api.readAnalyzerDeal({}).beds, 6);
  assert.equal(api.readAnalyzerDraftBaseline(), null);
  context.window.location.search = '?fresh=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(api.readAnalyzerDeal({}).beds, undefined, 'Another fresh action has its own draft');
  context.window.location.search = `?fresh=${freshToken}`;
  assert.equal(api.readAnalyzerDeal({}).beds, 6, 'Returning to this fresh draft restores it');
  assert.equal(await api.commitAnalyzerDraft(null, [], null, true, () => false), 'superseded');
  assert.equal(api.readAnalyzerDeal({}).beds, 6);
  api.clearAnalyzerDeal();
  assert.equal(api.readAnalyzerDeal({}).notes, undefined);
  assert.equal(shared.get(api.ANALYZER_CURRENT_DEAL_KEY), 'original-shared-draft');
  assert.equal(shared.get('pbk-deal-data'), 'legacy-draft');
});

test('Fresh storage fails visibly when the private store is blocked', async () => {
  const { api, context } = runtime('/deal/fixture', `?fresh=${freshToken}`);
  context.sessionStorage.setItem = () => { throw new Error('blocked'); };
  await assert.rejects(api.commitAnalyzerDraft(sample, [], null, true, () => true), /blocked/);
});

test('A truthy fallback does not hide a shared draft when this tab has no session copy', () => {
  const { api, privateDraft } = runtime();
  api.writeAnalyzerDeal(sample, ['arv']);
  privateDraft.clear();
  assert.equal(api.readAnalyzerStorage(api.ANALYZER_CURRENT_DEAL_KEY, {}).arv, 500000);
});

test('Expired session values fall back to shared storage, including valid zero values', () => {
  const { api, privateDraft } = runtime();
  api.writeAnalyzerStorage('fixture-value', 0);
  privateDraft.set('fixture-value:session', JSON.stringify({ expiresAt: '2000-01-01T00:00:00Z', payload: 99 }));
  assert.equal(api.readAnalyzerStorage('fixture-value', 42), 0);
});

test('Private repair estimates stay redacted in persistent storage', () => {
  const { api, shared, privateDraft } = runtime();
  api.writeAnalyzerDeal(sample, ['arv', 'repairs']);
  const persistent = decode(shared.get(api.ANALYZER_CURRENT_DEAL_KEY));
  const session = decode(privateDraft.get(`${api.ANALYZER_CURRENT_DEAL_KEY}:session`));
  assert.deepEqual(persistent.payload.repairs, { condition: 'C3', redacted: true });
  assert.equal(persistent.payload.repairsMid, undefined);
  assert.equal(session.payload.repairs.mid, 15000);
  assert.deepEqual([...api.readAnalyzerDraftManualFields()], ['arv', 'repairs']);
});

test('Matching redacted and private copies establish a safe shared baseline', () => {
  const { api, shared } = runtime();
  api.writeAnalyzerDeal(sample, []);
  assert.equal(api.readAnalyzerDraftBaseline(), shared.get(api.ANALYZER_CURRENT_DEAL_KEY));
});

test('A changed shared draft does not become the base of a stale private draft', () => {
  const { api, shared } = runtime();
  api.writeAnalyzerDeal(sample, ['arv']);
  const newer = decode(shared.get(api.ANALYZER_CURRENT_DEAL_KEY));
  newer.payload.arv = 600000;
  shared.set(api.ANALYZER_CURRENT_DEAL_KEY, btoa(JSON.stringify(newer)));
  assert.equal(api.readAnalyzerDraftBaseline(), undefined);
  assert.equal(api.readAnalyzerDeal({}).arv, 500000);
});

test('A retained private draft does not resurrect a shared draft cleared in another tab', () => {
  const { api, shared } = runtime();
  api.writeAnalyzerDeal(sample, ['notes']);
  shared.delete(api.ANALYZER_CURRENT_DEAL_KEY);
  assert.equal(api.readAnalyzerDraftBaseline(), undefined);
  assert.equal(api.readAnalyzerDeal({}).notes, sample.notes);
});

test('Conflict recovery writes only the tab-private copy and retains explicit clears', () => {
  const { api, shared } = runtime();
  api.writeAnalyzerDeal(sample, []);
  const original = shared.get(api.ANALYZER_CURRENT_DEAL_KEY);
  api.writeAnalyzerSessionDeal({ ...sample, notes: '', arv: 0 }, ['notes', 'arv']);
  assert.equal(shared.get(api.ANALYZER_CURRENT_DEAL_KEY), original);
  assert.equal(api.readAnalyzerDeal({}).notes, '');
  assert.equal(api.readAnalyzerDeal({}).arv, 0);
  assert.deepEqual([...api.readAnalyzerDraftManualFields()], ['notes', 'arv']);
  assert.equal(api.readAnalyzerDraftBaseline(), undefined);
});

test('Passive canonical enrichment remembers its shared baseline without publishing', () => {
  const { api, shared } = runtime();
  api.writeAnalyzerDeal(sample, ['notes']);
  const baseline = shared.get(api.ANALYZER_CURRENT_DEAL_KEY);
  api.writeAnalyzerSessionDeal({ ...sample, sellerName: 'Sample seller' }, ['notes'], baseline);
  assert.equal(shared.get(api.ANALYZER_CURRENT_DEAL_KEY), baseline);
  assert.equal(api.readAnalyzerDraftBaseline(), baseline);
  shared.delete(api.ANALYZER_CURRENT_DEAL_KEY);
  assert.equal(api.readAnalyzerDraftBaseline(), undefined, 'A later shared clear invalidates that baseline');
});

test('Unpublished edits remain private after remount even when their shared baseline is unchanged', () => {
  const { api, shared } = runtime();
  api.writeAnalyzerDeal(sample, []);
  const baseline = shared.get(api.ANALYZER_CURRENT_DEAL_KEY);
  api.writeAnalyzerSessionDeal({ ...sample, arv: 0 }, ['arv'], baseline, true);
  assert.equal(api.readAnalyzerDraftBaseline(), undefined);
  assert.equal(api.readAnalyzerDeal({}).arv, 0);
  assert.equal(shared.get(api.ANALYZER_CURRENT_DEAL_KEY), baseline);
  api.writeAnalyzerDeal({ ...sample, arv: 0 }, ['arv']);
  assert.equal(api.readAnalyzerDraftBaseline(), shared.get(api.ANALYZER_CURRENT_DEAL_KEY));
});

test('Passive legacy reads never publish; an intentional publication completes migration', () => {
  const { api, shared } = runtime();
  shared.set('pbk-deal-data', JSON.stringify(sample));
  assert.equal(api.readAnalyzerDeal({}).arv, sample.arv);
  assert.equal(shared.has(api.ANALYZER_CURRENT_DEAL_KEY), false);
  assert.equal(shared.has('pbk-deal-data'), true);
  api.writeAnalyzerDeal(sample, []);
  assert.equal(shared.has('pbk-deal-data'), false);
});

test('Unavailable shared coordination never invokes the write callback', async () => {
  const { api } = runtime();
  let called = false;
  await assert.rejects(api.commitAnalyzerDraft(sample, [], null, false, () => { called = true; return true; }), /coordination is unavailable/);
  assert.equal(called, false);
});

test('Legacy drafts without edit provenance are distinguishable from a clean canonical draft', () => {
  const { api } = runtime();
  api.writeAnalyzerDeal(sample);
  assert.equal(api.readAnalyzerDraftManualFields(), null);
  api.writeAnalyzerDeal(sample, []);
  assert.deepEqual([...api.readAnalyzerDraftManualFields()], []);
});

test('Storage failures do not throw or delete an existing draft', () => {
  const { api, shared, context } = runtime();
  api.writeAnalyzerDeal(sample, ['notes']);
  const before = shared.get(api.ANALYZER_CURRENT_DEAL_KEY);
  context.localStorage.setItem = () => { throw Error('Fixture storage is full'); };
  assert.doesNotThrow(() => api.writeAnalyzerDeal({ ...sample, notes: 'Changed sample' }, ['notes']));
  assert.equal(shared.get(api.ANALYZER_CURRENT_DEAL_KEY), before);
  assert.equal(api.readAnalyzerDeal({}).notes, 'Changed sample');
});

// Execute the real handlers with a held in-memory lock, never the bridge or a browser profile.
function actions() {
  const app = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const wanted = new Set(['persistDraft', 'clearDraft', 'handleLoadSavedDeal', 'handleCreateLeadFromAnalyzer', 'handleSaveDeal', 'handleAnalyzeDeal']);
  const snippets = [];
  let persistenceEffect;
  function visit(node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => wanted.has(d.name.getText(ast)))) snippets.push(node.getText(ast));
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect' && node.getText(ast).includes('if (publishDraft.current) void persistDraft(activeDeal)')) persistenceEffect = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(snippets.length, wanted.size);
  assert.ok(persistenceEffect);
  const callbacks = [], published = [], navigations = [], patches = [], analyses = [];
  const ref = current => ({ current });
  const context = vm.createContext({
    useCallback: action => action, useEffect: action => action(),
    draftWriteVersion: ref(0), manualDraftFields: ref(new Set(['notes'])),
    draftBaseline: ref('stale'), mounted: ref(true), publishDraft: ref(false), cacheIncomingDraft: ref(false),
    forceDraftPublication: ref(false), initialDealData: {}, activeDeal: sample,
    draftScope: ref('sample-scope'), getAnalyzerDraftIdentity: () => 'sample-scope',
    analysisRequestVersion: ref(0), isFreshAnalyzerDraft: () => false, deal: sample,
    getAnalyzeReadiness: () => ({ ready: true, successMessage: 'Ready' }),
    syncDealAnalysis: deal => new Promise((resolve, reject) => analyses.push({ deal, resolve, reject })),
    calculateVerdict: () => 'green', buildAgentDealContext: () => ({}),
    currentDeal: ref(sample), activeSelectedPath: 'cash',
    writeAnalyzerSessionDeal() {}, readSharedAnalyzerDraft: () => 'newer-peer-draft',
    commitAnalyzerDraft: (deal, fields, expected, force, isCurrent) => new Promise((resolve, reject) => callbacks.push({
      run: () => {
        if (!isCurrent()) return resolve('superseded');
        if (!force && expected !== 'newer-peer-draft') return resolve('conflict');
        if (deal) published.push(deal);
        resolve(deal ? 'published' : 'cleared');
      }, reject,
    })),
    setDeal: next => { const deal = typeof next === 'function' ? next(context.activeDeal) : next;
      context.activeDeal = deal; context.currentDeal.current = deal; },
    setAnalyzeStatus() {}, setActiveTab() {}, getPathLabel: () => 'Cash',
    buildMergedDealState: (base, deal) => ({ ...base, ...deal }),
    upsertSavedDeal: deal => deal, appendSavedDealActivity() {},
    buildAnalyzerLeadPatch: deal => deal,
    patchLeadRequest: async (...args) => { patches.push(args); return { ok: true }; },
    window: { dispatchEvent: event => navigations.push(event.type), location: { assign: url => navigations.push(url) } },
    CustomEvent: class { constructor(type) { this.type = type; } },
  });
  const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(transpile(snippets.join('\n') + '\nObject.assign(globalThis, { handleCreateLeadFromAnalyzer, handleLoadSavedDeal, handleSaveDeal, handleAnalyzeDeal, clearDraft });'), context);
  return { context, published, navigations, patches, analyses,
    effect: () => vm.runInContext(transpile(persistenceEffect), context),
    flush: async () => { while (callbacks.length) { callbacks.shift().run(); await new Promise(resolve => setImmediate(resolve)); } },
    reject: async () => { while (callbacks.length) { callbacks.shift().reject(new Error('Fixture lock timed out')); await new Promise(resolve => setImmediate(resolve)); } },
  };
}

for (const obsolete of ['unmounted', 'scope', 'edited', 'newer-analysis']) {
  test(`An ${obsolete} analysis cannot replace notes/comps or issue a lead PATCH`, async () => {
    const { context, analyses, patches } = actions();
    const pending = context.handleAnalyzeDeal();
    if (obsolete === 'unmounted') context.mounted.current = false;
    if (obsolete === 'scope') context.getAnalyzerDraftIdentity = () => 'other-scope';
    if (obsolete === 'edited') context.currentDeal.current = { ...sample, notes: 'New notes', comps: { A: { price: 765432 } } };
    if (obsolete === 'newer-analysis') context.analysisRequestVersion.current++;
    const before = structuredClone(context.currentDeal.current);
    analyses[0].resolve({ result: { arv: 700000 } });
    await pending;
    assert.deepEqual(patches, []);
    assert.deepEqual(context.currentDeal.current, before);
  });
}

test('A stale analysis failure cannot reset a newer draft', async () => {
  const { context, analyses, patches } = actions();
  const pending = context.handleAnalyzeDeal();
  context.currentDeal.current = { ...sample, notes: 'New notes', isAnalyzed: true };
  context.analysisRequestVersion.current++;
  const before = context.currentDeal.current;
  analyses[0].reject(new Error('Sample failure'));
  await pending;
  assert.equal(context.currentDeal.current, before);
  assert.deepEqual(patches, []);
});

test('A current analysis still applies its result and retains manual notes', async () => {
  const { context, analyses, patches } = actions();
  const pending = context.handleAnalyzeDeal();
  analyses[0].resolve({ result: { arv: 700000, mao: 350000 } });
  await pending;
  assert.equal(patches.length, 1, 'Only the stubbed sample lead request is recorded');
  assert.equal(context.currentDeal.current.arv, 700000);
  assert.equal(context.currentDeal.current.notes, sample.notes);
  assert.equal(context.currentDeal.current.isAnalyzed, true);
});

test('Analysis reads the latest draft even when invoked through an older callback', async () => {
  const { context, analyses, patches } = actions();
  context.currentDeal.current = context.activeDeal = { ...sample, notes: 'Latest manual wording' };
  const pending = context.handleAnalyzeDeal();
  assert.equal(analyses[0].deal.notes, 'Latest manual wording');
  analyses[0].resolve({ result: { arv: 700000 } });
  await pending;
  assert.equal(patches[0][1].deal.notes, 'Latest manual wording');
});

test('A fresh CRM load refuses another lead instead of overwriting its scoped draft', () => {
  const { context } = actions();
  context.isFreshAnalyzerDraft = () => true;
  const before = context.currentDeal.current;
  context.handleLoadSavedDeal({ ...sample, leadId: 'different-id', notes: 'Other notes' });
  assert.equal(context.currentDeal.current, before);
});

test('Clear cancels a queued Create Lead before it can navigate', async () => {
  const { context, flush, navigations } = actions();
  const pending = context.handleCreateLeadFromAnalyzer();
  const cleared = context.clearDraft();
  await flush();
  await Promise.all([pending, cleared]);
  assert.deepEqual(navigations, []);
});

test('A changed route scope cancels a queued draft write and forbids obsolete clears', async () => {
  const { context, flush, published, effect } = actions();
  context.draftBaseline.current = 'newer-peer-draft';
  context.handleLoadSavedDeal(sample);
  effect();
  context.getAnalyzerDraftIdentity = () => 'different-route-scope';
  await flush();
  await context.clearDraft();
  assert.deepEqual(published, []);
});

test('Loading a saved draft retains its intentional publication through the render effect', async () => {
  const { context, flush, published, effect } = actions();
  const loaded = { ...sample, address: '22 Loaded Fixture Lane' };
  context.handleLoadSavedDeal(loaded);
  effect();
  await flush();
  assert.equal(published.length, 1);
  assert.equal(published[0].address, loaded.address);
});

for (const action of ['handleCreateLeadFromAnalyzer', 'handleSaveDeal']) {
  test(`A timed-out lock must not revive a canceled ${action}`, async () => {
    const { context, reject, navigations, patches } = actions();
    const pending = context[action]();
    const cleared = context.clearDraft();
    await reject();
    await Promise.all([pending, cleared]);
    assert.deepEqual(navigations, []);
    assert.deepEqual(patches, []);
  });
}
