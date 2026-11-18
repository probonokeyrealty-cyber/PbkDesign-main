import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { attomExtraRecordFields } from '../src/app/utils/attomRecordFields.mjs';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(
  readFileSync(
    new URL('../src/app/components/leads/AttomPropertyPreview.tsx', import.meta.url),
    'utf8'
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }
).outputText;

function mount(invalidTime = false) {
  const state = [];
  let cursor = 0,
    calls = 0;
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
        : name.includes('attomRecordFields')
          ? { attomExtraRecordFields }
          : name.includes('runtimeBridge')
            ? {
                fetchAttomPropertyPreview: () => {
                  calls++;
                },
              }
            : require(name);
  new Function('require', 'exports', code)(fakeRequire, exported);
  const props = {
    address: { street: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210' },
    saved: {},
    mode: 'workspace',
    snapshot: {
      retrievedAt: invalidTime ? 'invalid-time' : '2026-11-18T16:00:00Z',
      facts: {
        address: '24 Sample Oak Lane',
        apn: 'TEST-PARCEL',
        ownerName: 'Sample Owner',
        beds: 0,
        baths: 2,
        taxPerSizeUnit: 2.5,
        livingSqft: 1200,
        propertyType: 'House',
        yearBuilt: 1980,
        lotSqft: null,
        lotAcres: null,
      },
      fieldRetrievedAt: { ownerName: '2026-11-17T16:00:00Z' },
    },
  };
  function flatten(node) {
    if (!node || typeof node !== 'object') return [];
    if (typeof node.type === 'function') return flatten(node.type(node.props));
    return [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  }
  return {
    render() {
      cursor = 0;
      return flatten(exported.AttomPropertyPreview(props));
    },
    calls: () => calls,
  };
}
const text = (node) =>
  [node?.props?.children]
    .flat(Infinity)
    .map((value) => (typeof value === 'object' ? text(value) : (value ?? '')))
    .join(' ');

test('record search reveals missing labels locally while captured-only default preserves zero values', () => {
  const view = mount();
  let nodes = view.render();
  const zero = nodes.find((node) => node.type === 'dt' && text(node) === 'Bedrooms');
  assert.ok(zero, 'a captured zero bedroom value remains visible');
  const search = nodes.find((node) => node.type === 'input' && node.props.type === 'search');
  assert.ok(search, 'local record search is available');
  assert.ok(!nodes.some((node) => node.type === 'dt' && text(node) === 'County FIPS'));
  search.props.onChange({ target: { value: 'County FIPS' } });
  nodes = view.render();
  assert.ok(nodes.some((node) => node.type === 'dt' && text(node) === 'County FIPS'));
  assert.ok(nodes.some((node) => node.type === 'strong' && text(node) === 'Not provided'));
  assert.equal(view.calls(), 0);
});

test('missing-fields toggle is local and invalid capture dates never render as timestamps', () => {
  const view = mount(true);
  let nodes = view.render();
  const toggle = nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox');
  assert.ok(toggle, 'missing-fields toggle is available');
  toggle.props.onChange({ target: { checked: true } });
  nodes = view.render();
  assert.ok(nodes.some((node) => node.type === 'dt' && text(node) === 'County FIPS'));
  assert.ok(
    nodes.some((node) => node.type === 'time' && node.props.dateTime === '2026-11-17T16:00:00Z')
  );
  assert.ok(
    nodes.every((node) => node.type !== 'time' || Number.isFinite(Date.parse(node.props.dateTime)))
  );
  assert.equal(view.calls(), 0);
});

test('tax per square foot preserves decimal precision and its unit', () => {
  const nodes = mount().render();
  assert.ok(nodes.some((node) => node.type === 'strong' && text(node) === '$2.50 / sq ft'));
  assert.ok(nodes.some((node) => node.type === 'dt' && text(node) === 'Tax per sq ft'));
});
