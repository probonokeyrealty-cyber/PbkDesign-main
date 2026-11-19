import test from 'node:test';
import assert from 'node:assert/strict';
import { getWorklistFocusIndex, focusWorklistRow } from '../src/app/utils/worklistFocus.mjs';

for (const [key, index, count, expected] of [
  ['ArrowDown', 0, 3, 1], ['ArrowDown', 2, 3, 2],
  ['ArrowUp', 2, 3, 1], ['ArrowUp', 0, 3, 0],
  ['Home', 1, 3, 0], ['Home', 0, 3, 0],
  ['End', 0, 3, 2], ['End', 2, 3, 2],
  ['ArrowDown', 0, 1, 0], ['ArrowUp', 0, 1, 0],
  ['Home', 0, 1, 0], ['End', 0, 1, 0],
]) {
  test(`${key} at ${index}/${count} clamps to ${expected} on the current page`, () => {
    assert.equal(getWorklistFocusIndex(key, index, count), expected);
  });
}

test('zero, negative, noninteger and nonfinite counts or indices are ignored', () => {
  for (const count of [0, -1, 1.5, NaN, Infinity, '3', null, undefined]) {
    assert.equal(getWorklistFocusIndex('End', 0, count), null);
  }
  for (const index of [-1, 3, 1.5, NaN, Infinity, '0', null, undefined]) {
    assert.equal(getWorklistFocusIndex('Home', index, 3), null);
  }
});

test('unhandled, modified and composing keys pass through index calculation', () => {
  for (const key of ['Enter', ' ', 'Spacebar', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'a']) {
    assert.equal(getWorklistFocusIndex(key, 0, 3), null);
  }
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.equal(getWorklistFocusIndex(key, 1, 3, { modified: true }), null);
    assert.equal(getWorklistFocusIndex(key, 1, 3, { composing: true }), null);
  }
  assert.equal(getWorklistFocusIndex('ArrowDown', 0, 3, { modified: false, composing: false }), 1);
});

// Only the DOM methods used by the focus boundary are modeled; geometry is browser-tested later.
function node(parent = null, attributes = {}, tagName = 'DIV') {
  const element = {
    parentElement: parent, attributes, tagName, isConnected: true, disabled: false,
    hidden: false, inert: false, visibility: 'visible', display: 'block', rendered: true,
    children: [],
    ownerDocument: { defaultView: { getComputedStyle: row => ({ visibility: row.visibility }) } },
    getAttribute(name) { return this.attributes[name] ?? null; },
    matches(selector) {
      return selector.split(',').some(part => {
        switch (part.trim()) {
          case '[data-pbk-worklist]': return this.getAttribute('data-pbk-worklist') !== null;
          case 'button[data-pbk-worklist-row]':
            return this.tagName === 'BUTTON' && this.getAttribute('data-pbk-worklist-row') !== null;
          case ':disabled': return this.disabled;
          case '[aria-disabled="true"]': return this.getAttribute('aria-disabled') === 'true';
          case '[hidden]': return this.hidden;
          case '[inert]': return this.inert;
          default: throw new Error(`Unsupported fixture selector: ${part}`);
        }
      });
    },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    },
    getClientRects() {
      for (let current = this; current; current = current.parentElement) {
        if (current.hidden || current.display === 'none' || !current.rendered) return [];
      }
      return [{}];
    },
    focus() { effects.push(['focus', this]); },
    click() { assert.fail('Focus navigation must never activate a row'); },
    dispatchEvent() { assert.fail('Focus navigation must never dispatch an action'); },
  };
  parent?.children.push(element);
  return element;
}

let effects;
function worklist(kind = 'leads', parent = null) {
  effects = [];
  const root = node(parent, { 'data-pbk-worklist': kind });
  const rows = Array.from({ length: 3 }, () => node(root, { 'data-pbk-worklist-row': '' }, 'BUTTON'));
  return { root, rows };
}

function keyEvent(currentTarget, key = 'ArrowDown', overrides = {}) {
  return {
    key, currentTarget, target: currentTarget, nativeEvent: { isComposing: false },
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; effects.push(['preventDefault']); },
    ...overrides,
  };
}

for (const kind of ['leads', 'skills']) {
  test(`${kind} navigation prevents default and focuses only the next selection button`, () => {
    const { rows } = worklist(kind);
    const event = keyEvent(rows[0]);
    assert.equal(focusWorklistRow(event), true);
    assert.deepEqual(effects, [['preventDefault'], ['focus', rows[1]]]);
    assert.equal(event.defaultPrevented, true);
  });
}

for (const [key, from, to] of [
  ['ArrowDown', 2, 2], ['ArrowUp', 0, 0], ['ArrowUp', 2, 1],
  ['Home', 2, 0], ['End', 0, 2],
]) {
  test(`${key} focuses row ${to} from row ${from} without paging or wrapping`, () => {
    const { rows } = worklist();
    assert.equal(focusWorklistRow(keyEvent(rows[from], key)), true);
    assert.deepEqual(effects, [['preventDefault'], ['focus', rows[to]]]);
  });
}

for (const key of ['Enter', ' ', 'Spacebar', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'a']) {
  test(`${JSON.stringify(key)} leaves activation and other keyboard behavior untouched`, () => {
    const { rows } = worklist();
    assert.equal(focusWorklistRow(keyEvent(rows[0], key)), false);
    assert.deepEqual(effects, []);
  });
}

for (const overrides of [
  { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
  { nativeEvent: { isComposing: true } }, { defaultPrevented: true },
]) {
  test(`ignores keyboard events with ${JSON.stringify(overrides)}`, () => {
    const { rows } = worklist();
    assert.equal(focusWorklistRow(keyEvent(rows[0], 'Home', overrides)), false);
    assert.deepEqual(effects, []);
  });
}

test('foreign and descendant targets cannot move focus through a selection button', () => {
  const { root, rows } = worklist();
  for (const target of [rows[1], node(rows[0], {}, 'SPAN'), node(root, {}, 'INPUT'), null]) {
    assert.equal(focusWorklistRow(keyEvent(rows[0], 'ArrowDown', { target })), false);
  }
  assert.deepEqual(effects, []);
});

test('only marked buttons within an approved closest worklist root can navigate', () => {
  const { root } = worklist();
  const unsupported = worklist('other');
  const nested = node(root, { 'data-pbk-worklist': 'other' });
  for (const current of [
    node(root, {}, 'BUTTON'), node(root, { 'data-pbk-worklist-row': '' }),
    node(null, { 'data-pbk-worklist-row': '' }, 'BUTTON'), unsupported.rows[0],
    node(nested, { 'data-pbk-worklist-row': '' }, 'BUTTON'),
  ]) {
    assert.equal(focusWorklistRow(keyEvent(current)), false);
  }
  assert.deepEqual(effects, []);
});

for (const state of [
  { hidden: true }, { disabled: true }, { isConnected: false }, { inert: true },
  { rendered: false }, { display: 'none' }, { visibility: 'hidden' }, { visibility: 'collapse' },
  { attributes: { 'data-pbk-worklist-row': '', 'aria-disabled': 'true' } },
]) {
  test(`skips an unavailable destination row: ${JSON.stringify(state)}`, () => {
    const { rows } = worklist();
    Object.assign(rows[1], state);
    assert.equal(focusWorklistRow(keyEvent(rows[0])), true);
    assert.deepEqual(effects, [['preventDefault'], ['focus', rows[2]]]);
  });

  test(`ignores an unavailable current row: ${JSON.stringify(state)}`, () => {
    const { rows } = worklist();
    Object.assign(rows[0], state);
    assert.equal(focusWorklistRow(keyEvent(rows[0])), false);
    assert.deepEqual(effects, []);
  });
}

for (const state of [{ hidden: true }, { inert: true }, { display: 'none' }]) {
  test(`excludes rows inside an unavailable ancestor: ${JSON.stringify(state)}`, () => {
    const { root, rows } = worklist();
    const wrapper = Object.assign(node(root), state);
    const child = node(wrapper, { 'data-pbk-worklist-row': '' }, 'BUTTON');
    assert.equal(focusWorklistRow(keyEvent(rows[0], 'End')), true);
    assert.deepEqual(effects, [['preventDefault'], ['focus', rows[2]]]);
    effects = [];
    assert.equal(focusWorklistRow(keyEvent(child)), false);
    assert.deepEqual(effects, []);
  });
}

test('an empty eligible row set never prevents default or focuses a target', () => {
  const { rows } = worklist();
  rows.forEach(row => { row.disabled = true; });
  assert.equal(focusWorklistRow(keyEvent(rows[0], 'End')), false);
  assert.deepEqual(effects, []);
});

test('two independent worklist roots never exchange focus', () => {
  const leads = worklist('leads');
  const skills = worklist('skills');
  assert.equal(focusWorklistRow(keyEvent(leads.rows[0], 'End')), true);
  assert.equal(focusWorklistRow(keyEvent(skills.rows[2], 'Home')), true);
  assert.deepEqual(effects, [
    ['preventDefault'], ['focus', leads.rows[2]],
    ['preventDefault'], ['focus', skills.rows[0]],
  ]);
});

test('nested worklists are excluded from the parent but navigate within their own root', () => {
  const outer = worklist('leads');
  const inner = worklist('skills', outer.root);
  assert.equal(focusWorklistRow(keyEvent(outer.rows[0], 'End')), true);
  assert.equal(focusWorklistRow(keyEvent(inner.rows[0], 'End')), true);
  assert.deepEqual(effects, [
    ['preventDefault'], ['focus', outer.rows[2]],
    ['preventDefault'], ['focus', inner.rows[2]],
  ]);
});
