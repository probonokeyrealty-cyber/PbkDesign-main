import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { attomExtraRecordFields } from '../src/app/utils/attomRecordFields.mjs';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/app/components/leads/AttomPropertyPreview.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const address = { street: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210' };

function mount(props, fetchPreview) {
  const exported = {};
  const fakeRequire = (name) => name === 'react' ? { useState: value => [value, () => {}] }
    : name === 'lucide-react' ? new Proxy({}, { get: (_, key) => String(key) })
      : name.includes('attomRecordFields') ? { attomExtraRecordFields }
      : name.includes('AttomRecordDatasets') ? { AttomRecordDatasets: () => null }
      : name.includes('runtimeBridge') ? { fetchAttomPropertyPreview: fetchPreview } : require(name);
  new Function('require', 'exports', code)(fakeRequire, exported);
  const shell = exported.AttomPropertyPreview({ address, saved: {}, mode: 'workspace', ...props });
  const tree = shell.type(shell.props);
  function findButton(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button') return node;
    return [node.props?.children].flat(Infinity).map(findButton).find(Boolean);
  }
  return findButton(tree);
}

test('workspace refresh delegates once to persisted coordinator and never starts an independent ATTOM lookup', async () => {
  let refreshes = 0, lookups = 0;
  const button = mount({ onRefresh: async () => { refreshes += 1; } }, async () => { lookups += 1; });
  assert.equal(lookups, 0); assert.equal(refreshes, 0);
  button.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1); assert.equal(lookups, 0);
});

test('standalone draft lookup stays explicit and coordinator loading blocks duplicate requests', async () => {
  let lookups = 0;
  const fetchPreview = async () => { lookups += 1; return { status: 'not_found' }; };
  const button = mount({ mode: 'draft' }, fetchPreview);
  assert.equal(lookups, 0);
  button.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lookups, 1);
  const refreshing = mount({ refreshing: true, onRefresh: () => assert.fail('Already refreshing') }, fetchPreview);
  assert.equal(refreshing.props.disabled, true);
  refreshing.props.onClick();
  assert.equal(lookups, 1);
});
