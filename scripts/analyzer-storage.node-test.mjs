import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/utils/analyzerStorage.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
function runtime() {
  const shared = new Map(), privateDraft = new Map();
  const store = values => ({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  });
  const context = vm.createContext({
    exports: {}, window: { location: { hostname: 'pbkcenter.netlify.app' } },
    localStorage: store(shared), sessionStorage: store(privateDraft),
    btoa, atob, encodeURIComponent, decodeURIComponent, escape, unescape,
    console: { warn() {} },
  });
  vm.runInContext(outputText, context);
  return { api: context.exports, shared, privateDraft, context };
}
const decode = value => JSON.parse(decodeURIComponent(escape(atob(value))));
const sample = { leadId: 'fixture', address: '11 Fixture Avenue', arv: 500000,
  notes: 'Unsent sample notes', repairs: { condition: 'C3', mid: 15000 }, repairsMid: 15000 };

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
