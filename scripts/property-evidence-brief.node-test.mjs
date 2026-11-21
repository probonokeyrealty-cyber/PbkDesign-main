import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const file = new URL('../src/app/components/leads/PropertyEvidenceBrief.tsx', import.meta.url);
const source = existsSync(file) ? readFileSync(file, 'utf8') : '';
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exported = {};
new Function('require', 'exports', code)(name => name.includes('leadComps.mjs') ? require('../src/app/utils/leadComps.mjs') : require(name), exported);
function view(props = {}) {
  assert.equal(typeof exported.PropertyEvidenceBrief, 'function', 'Saved evidence brief exists');
  return exported.PropertyEvidenceBrief({ records: null, listing: null, sales: null, onOpen() {}, ...props });
}
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
const text = node => [node?.props?.children].flat(Infinity).map(value => typeof value === 'object' ? text(value) : typeof value === 'boolean' ? '' : value ?? '').join(' ').replace(/\s+/g, ' ');
const captured = '2026-11-17T12:00:00Z';
test('empty evidence names the missing review work without a readiness or underwriting claim', () => {
  const content = text(view());
  assert.match(content, /No saved property record/);
  assert.match(content, /No saved photos/);
  assert.match(content, /No saved recorded sales/);
  assert.match(content, /Refresh property intelligence/);
  assert.doesNotMatch(content, /ready to offer|complete|approved|no foreclosure/i);
});
test('retained source sections keep capture dates separate from unavailable coverage', () => {
  const tree = view({ records: { retrievedAt: captured, facts: { beds: 0, ownerOccupied: false }, sections: [
    { status: 'ok', retrievedAt: '2026-11-15T12:00:00Z', facts: { ownerOccupied: false }, rows: [], refreshStatus: { status: 'timed_out', checkedAt: '2026-11-18T12:00:00Z' } },
    { status: 'not_entitled', facts: {}, rows: [] },
  ] }, listing: { retrievedAt: captured, photoUrls: ['one', 'two'] } });
  assert.match(text(tree), /1 populated dataset/);
  assert.match(text(tree), /1 retained after a later refresh/);
  assert.match(text(tree), /1 dataset unavailable/);
  assert.match(text(tree), /2 saved photos/);
  const times = flatten(tree).filter(node => node.type === 'time');
  assert.equal(times.length, 3);
  assert.equal(times.filter(node => node.props.dateTime === captured).length, 2);
  assert.equal(times.filter(node => node.props.dateTime === '2026-11-15T12:00:00Z').length, 1);
  assert.match(text(tree), /Snapshot captured/);
  assert.match(text(tree), /Oldest retained dataset captured/);
});
test('retained datasets without usable original timestamps never inherit the snapshot date', () => {
  for (const retrievedAt of [undefined, 'invalid-capture-date']) {
    const tree = view({ records: { retrievedAt: captured, facts: { beds: 2 }, sections: [
      { status: 'ok', retrievedAt, facts: { beds: 2 }, rows: [], refreshStatus: { status: 'timed_out', checkedAt: '2026-11-18T12:00:00Z' } },
    ] } });
    const content = text(tree);
    assert.match(content, /1 retained after a later refresh/);
    assert.match(content, /Retained dataset capture time unavailable\./);
    assert.doesNotMatch(content, /Oldest retained dataset captured/);
    const timestamps = flatten(tree).filter(node => node.type === 'time');
    assert.deepEqual(timestamps.map(node => node.props.dateTime), [captured]);
    const snapshot = flatten(tree).find(node => node.type === 'p' && text(node).includes('Snapshot captured'));
    assert.equal(flatten(snapshot).filter(node => node.type === 'time').length, 1);
  }
});
test('pure rerender for another lead with empty evidence carries no saved counts or selections', () => {
  const populated = view({
    records: { retrievedAt: captured, facts: { beds: 2 }, sections: [
      { status: 'ok', retrievedAt: captured, facts: { beds: 2 }, rows: [] },
    ] },
    listing: { retrievedAt: captured, photoUrls: ['first-lead-photo-one', 'first-lead-photo-two'] },
    sales: { status: 'matched', source: 'ATTOM', review: 'operator-selected', retrievedAt: captured, selectedIds: ['first-lead-sale'], sales: [
      { id: 'first-lead-sale', address: 'First Lead Sample Lane', price: 100000, soldDate: '2026-11-01' },
    ] },
  });
  assert.match(text(populated), /1 populated dataset/);
  assert.match(text(populated), /2 saved photos/);
  assert.match(text(populated), /1 reviewed selection/);
  assert.match(text(populated), /1 saved sale candidate/);

  const empty = view({ records: null, listing: null, sales: null });
  const content = text(empty);
  assert.match(content, /No saved property record/);
  assert.match(content, /No saved photos/);
  assert.match(content, /No saved recorded sales/);
  assert.match(content, /0 reviewed selections/);
  assert.doesNotMatch(content, /populated dataset|saved photo\b|saved sale candidate|1 reviewed selection|Verify condition/);
  assert.equal(flatten(empty).filter(node => node.type === 'time').length, 0);
  assert.match(content, /Next review.*There’s no saved property record/);
  assert.match(text(populated), /Verify condition, source dates, and comp fit/);
  assert.doesNotMatch(text(populated), /Next review/);
});
test('suggestions and duplicate or stale selected IDs do not become reviewed comps', () => {
  const sales = { status: 'matched', source: 'ATTOM', review: 'suggested', sales: ['a', 'b'].map(id => ({ id, address: `${id} Sample Lane`, price: 100000, soldDate: '2026-11-01' })), selectedIds: ['a'], retrievedAt: captured };
  assert.match(text(view({ sales })), /0 reviewed selections/);
  const selected = view({ sales: { ...sales, review: 'operator-selected', selectedIds: ['a', 'a', 'gone'] } });
  assert.match(text(selected), /1 reviewed selection/);
  assert.match(text(selected), /2 saved sale candidates/);
  assert.match(text(view({ sales: { ...sales, review: 'operator-selected', selectedIds: [] } })), /0 reviewed selections/);
});
test('malformed or incomplete saved sales cannot count as candidates or reviewed selections', () => {
  const sales = { status: 'matched', source: 'ATTOM', review: 'operator-selected', selectedIds: ['a', 'b', 'c'], sales: [null, { id: 'a' }, { id: 'b', address: 'Sample Lane', price: -1, soldDate: '2026-11-01' }, { id: 'c', address: 'Sample Lane', price: 1, soldDate: '2026-02-30' }] };
  assert.match(text(view({ sales })), /0 reviewed selections/);
  assert.match(text(view({ sales })), /No saved recorded sales/);
});
test('each review button only opens its existing local tab', () => {
  const opened = [];
  const buttons = flatten(view({ onOpen: tab => opened.push(tab) })).filter(node => node.type === 'button');
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(opened, ['record', 'record', 'photos', 'comps']);
});
test('next review starts with usable unreviewed comps, then points to the remaining record gap', () => {
  const opened = [];
  const props = {
    records: { retrievedAt: captured, sections: [{ status: 'not_entitled', facts: {}, rows: [] }] },
    listing: { retrievedAt: captured, photoUrls: ['one'] },
    sales: {
      status: 'matched', review: 'suggested', retrievedAt: captured, selectedIds: ['a'],
      sales: [{ id: 'a', address: 'Sample Lane', price: 100000, soldDate: '2026-11-01' }],
    },
    onOpen: tab => opened.push(tab),
  };
  const next = (tree, label) => {
    const button = flatten(tree).find(node => node.type === 'button' && text(node).trim() === label);
    assert.ok(button, label);
    button.props.onClick();
  };
  next(view(props), 'Compare saved comps');
  next(view({ ...props, sales: { ...props.sales, review: 'operator-selected' } }), 'Check record coverage');
  assert.deepEqual(opened, ['comps', 'record']);
});
