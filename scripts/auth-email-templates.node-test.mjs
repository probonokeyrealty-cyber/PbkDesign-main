import test from 'node:test';
import assert from 'node:assert/strict';
import { authEmailCopy, authEmailTemplate } from './auth-email-templates.mjs';
for (const kind of Object.keys(authEmailCopy))
  test(`branded ${kind} retains only its required auth action`, () => {
    const { subject, html } = authEmailTemplate(kind);
    assert.match(subject, /^PBK \| /);
    assert.match(html, /Probono Key Realty/);
    assert.match(html, /role="presentation"/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    if (kind === 'magic-link-or-otp') assert.match(html, /\{\{ \.Token \}\}/);
    assert.doesNotMatch(html, /<script|<img|https?:\/\//);
    if (authEmailCopy[kind][4] === 'code') {
      assert.match(html, /\{\{ \.Token \}\}/);
      assert.doesNotMatch(html, /href=|ConfirmationURL/);
    } else if (authEmailCopy[kind][4] !== 'notice')
      assert.match(html, /\{\{ \.ConfirmationURL \}\}/);
  });
