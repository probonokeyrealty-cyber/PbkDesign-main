import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const path = new URL('../src/app/components/leads/AttomRecordDatasets.tsx', import.meta.url);
const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
function mount(sections) {
  const state = [];
  let cursor = 0;
  const exported = {};
  const fakeRequire = (name) =>
    name === 'react'
      ? {
          useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [
              state[index],
              (value) => {
                state[index] = value;
              },
            ];
          },
        }
      : name === 'lucide-react'
        ? new Proxy({}, { get: (_, key) => String(key) })
        : name.includes('attomMcpSections')
          ? require('../src/app/utils/attomMcpSections.mjs')
          : require(name);
  new Function('require', 'exports', code)(fakeRequire, exported);
  function flatten(node) {
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return flatten(node.type(node.props));
    return [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  }
  return {
    render() {
      cursor = 0;
      assert.equal(
        typeof exported.AttomRecordDatasets,
        'function',
        'saved dataset component exists'
      );
      return flatten(exported.AttomRecordDatasets({ sections }));
    },
  };
}
const text = (node) =>
  [node?.props?.children]
    .flat(Infinity)
    .map((value) => (typeof value === 'object' ? text(value) : (value ?? '')))
    .join(' ');

test('empty saved dataset coverage stays explicit', () => {
  const view = mount([]);
  const nodes = view.render();
  assert.ok(
    nodes.some(
      (node) => node.type === 'section' && node.props['aria-label'] === 'Saved property datasets'
    )
  );
});

const captured = '2026-10-01T12:00:00Z',
  checked = '2026-11-18T12:00:00Z';
const fixtures = [
  {
    id: 'equity',
    status: 'ok',
    checkedAt: captured,
    retrievedAt: captured,
    sourceGeneratedAt: '2026-09-30T12:00:00Z',
    facts: { estimatedValue: 0, availableEquity: 120000, secret: 'discard' },
    rows: [],
    caveats: [],
    refreshStatus: { status: 'timed_out', checkedAt: checked },
  },
  {
    id: 'mortgage-history',
    status: 'ok',
    checkedAt: captured,
    retrievedAt: captured,
    facts: {},
    rows: [
      {
        recordingDate: '2020-02-03',
        originalAmount: 200000,
        lender: 'Fictional Finance',
        documentNumber: 'javascript:alert(1)',
      },
    ],
    caveats: [],
  },
  { id: 'permits', status: 'not_entitled', checkedAt: checked, facts: {}, rows: [], caveats: [] },
];
test('dataset UI preserves retained source times, recorded financing caution and scalar formatting', () => {
  const nodes = mount(fixtures).render();
  const content = nodes.map(text).join(' ');
  assert.match(content, /Retained snapshot/);
  assert.match(content, /capture time unchanged/);
  assert.match(content, /Fictional Finance/);
  assert.match(content, /200,000/);
  assert.match(content, /not.*payoff|not.*balances/i);
  assert.match(content, /Not included in access/);
  assert.ok(nodes.some((node) => node.type === 'time' && node.props.dateTime === captured));
  assert.equal(
    nodes.some((node) => node.type === 'a'),
    false
  );
  assert.doesNotMatch(content, /discard/);
});
test('search and group filters work entirely on saved evidence', () => {
  const view = mount(fixtures);
  let nodes = view.render();
  const search = nodes.find(
    (node) => node.type === 'input' && node.props['aria-label'] === 'Search saved datasets'
  );
  search.props.onChange({ target: { value: 'Fictional Finance' } });
  nodes = view.render();
  assert.equal(nodes.filter((node) => node.type === 'details').length, 1);
  assert.ok(nodes.find((node) => node.type === 'details').props.open);
  assert.match(nodes.map(text).join(' '), /Fictional Finance/);
  search.props.onChange({ target: { value: '' } });
  nodes = view.render();
  const select = nodes.find((node) => node.type === 'select');
  select.props.onChange({ target: { value: 'missing group' } });
  assert.match(view.render().map(text).join(' '), /No saved datasets match/);
});

test('comparables disclosure points to existing comparison without inventing a candidate count', () => {
  const nodes = mount([
    {
      id: 'comparables',
      status: 'ok',
      checkedAt: captured,
      retrievedAt: captured,
      facts: { 'criteria.saleDateFrom': '2026-05-01', 'criteria.saleDateTo': '2026-10-01' },
      rows: [],
      caveats: [],
    },
  ]).render();
  assert.match(nodes.map(text).join(' '), /Comps tab/);
  assert.doesNotMatch(nodes.map(text).join(' '), /0\s+saved comparable candidates/);
  assert.equal(nodes.filter((node) => node.type === 'table').length, 0);
});

test('bounded history capture discloses 20 of 25 source records', () => {
  const section = {
    ...fixtures[1],
    sourceRowCount: 25,
    truncated: true,
    rows: Array.from({ length: 20 }, (_, index) => ({
      recordingDate: '2020-02-03',
      originalAmount: 200000 + index,
      documentNumber: `FICTION-${index}`,
    })),
  };
  const nodes = mount([section]).render();
  assert.match(
    nodes.map(text).join(' ').replace(/\s+/g, ' '),
    /Showing 20 of 25 source records; additional records are not included in this saved snapshot\./
  );
  assert.equal(nodes.filter((node) => node.type === 'tbody')[0].props.children.length, 20);
});
test('currency per square foot preserves cents and clear dollars', () => {
  const nodes = mount([
    {
      id: 'market-context',
      status: 'ok',
      checkedAt: captured,
      retrievedAt: captured,
      facts: { 'zipContext.medianPricePerSqFt': 245.75 },
      rows: [],
      caveats: [],
    },
  ]).render();
  assert.match(nodes.map(text).join(' '), /\$245\.75 \/ sq ft/);
});
