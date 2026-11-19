import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const componentUrl = new URL('../src/app/components/skills/SkillReviewNotice.tsx', import.meta.url);
const require = createRequire(componentUrl);
const source = readFileSync(componentUrl, 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const exported = {};
new Function('require', 'exports', code)(require, exported);

function renderNotice(change) {
  assert.equal(typeof exported.SkillReviewNotice, 'function');
  return renderToStaticMarkup(createElement(exported.SkillReviewNotice, { change }));
}

test('renders one polite atomic status paragraph for every notice state', () => {
  for (const change of [
    null,
    { previousId: 'SYN-A', replacementId: 'SYN-B' },
    { previousId: 'SYN-A', replacementId: null },
  ]) {
    const html = renderNotice(change);
    assert.match(html, /^<p\b[^>]*>.*<\/p>$/);
    assert.equal((html.match(/<p\b/g) || []).length, 1);
    assert.equal((html.match(/role="status"/g) || []).length, 1);
    assert.match(html, /class="pbk-skill-review-notice"/);
    assert.match(html, /data-pbk-skill-review-notice=""/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-atomic="true"/);
    assert.doesNotMatch(html, /<(?:button|a|input|select|textarea)\b/);
    if (change) assert.doesNotMatch(html, /\bhidden=/);
  }
});

test('renders exact replacement IDs without an action', () => {
  const html = renderNotice({ previousId: 'SYN-A', replacementId: 'SYN-B' });
  assert.equal((html.match(/role="status"/g) || []).length, 1);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-atomic="true"/);
  assert.match(
    html,
    /Version <code>SYN-A<\/code> is not in the current results\. Showing <code>SYN-B<\/code>\./
  );
  assert.equal((html.match(/<code>/g) || []).length, 2);
  assert.doesNotMatch(html, /<(?:button|a|input)\b/);
  assert.match(renderNotice(null), /^<p\b[^>]*><\/p>$/);
  assert.match(
    renderNotice({ previousId: 'SYN-<script>&', replacementId: null }),
    /<code>SYN-&lt;script&gt;&amp;<\/code>/
  );
});

test('null change keeps an empty paragraph without visible spacing', () => {
  const html = renderNotice(null);
  assert.match(html, /^<p\b[^>]*><\/p>$/);
  assert.match(html, /\bhidden=""/);
});

test('empty results name only the previous ID without inventing a replacement', () => {
  const html = renderNotice({ previousId: 'SYN-A', replacementId: null });
  assert.match(html, /^<p\b[^>]*>Version <code>SYN-A<\/code> is not in the current results\.<\/p>$/);
  assert.equal((html.match(/<code>/g) || []).length, 1);
  assert.doesNotMatch(html, /Showing|SYN-B|<(?:button|a|input)\b/);
});

test('markup-shaped IDs are escaped literal text in both positions', () => {
  const html = renderNotice({ previousId: 'SYN-<script>&', replacementId: 'SYN-<a>&' });
  assert.match(
    html,
    /Version <code>SYN-&lt;script&gt;&amp;<\/code> is not in the current results\. Showing <code>SYN-&lt;a&gt;&amp;<\/code>\./
  );
  assert.doesNotMatch(html, /<(?:script|a|button|input)\b/);
  assert.match(
    renderNotice({ previousId: 'SYN-<script>&', replacementId: null }),
    /<code>SYN-&lt;script&gt;&amp;<\/code>/
  );
});

test('long IDs and ID 0 are preserved without truncation or normalization', () => {
  const previousId = ` SYN-${'long-id-'.repeat(100)} `;
  const html = renderNotice({ previousId, replacementId: '0' });
  assert.ok(
    html.endsWith(
      `>Version <code>${previousId}</code> is not in the current results. Showing <code>0</code>.</p>`
    )
  );
});
