import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPrivateSession } from '../src/app/investor/clientState.mjs';
import { createSessionLifetime } from '../src/app/investor/sessionLifetime.mjs';
import { readLimitedBody } from '../supabase/functions/pbk-investor-staging/bodyLimit.mjs';
test('session reset erases previous editor, attachment and confirmation', () => {
  const state = {
    draft: { internalNotes: 'PRIVATE' },
    editing: true,
    dirty: true,
    file: { name: 'private' },
    confirmation: { command: 'release' },
    member: { role: 'reviewer' },
  };
  const setters = Object.fromEntries(Object.keys(state).map((k) => [k, (v) => (state[k] = v)]));
  clearPrivateSession(setters, { title: '', checks: {} }, true);
  assert.deepEqual(state, {
    draft: { title: '', checks: {} },
    editing: false,
    dirty: false,
    file: null,
    confirmation: null,
    member: null,
  });
});
test('known session expiry expires without a network action', async () => {
  let expired = 0;
  const clock = createSessionLifetime(() => expired++);
  clock.arm(0.01);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(expired, 1);
  assert.equal(clock.expired(), true);
});
test('chunked bodies stop at byte ceiling without Content-Length', async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(6));
      c.enqueue(new Uint8Array(6));
      c.close();
    },
  });
  await assert.rejects(
    () =>
      readLimitedBody(
        new Request('https://qa.example', { method: 'POST', body: stream, duplex: 'half' }),
        10
      ),
    /large/
  );
  const bytes = await readLimitedBody(
    new Request('https://qa.example', { method: 'POST', body: 'okay' }),
    10
  );
  assert.equal(new TextDecoder().decode(bytes), 'okay');
});

const facts = await import('../src/app/investor/displayFact.mjs').catch(() => ({}));
test('missing property facts are Unknown and numeric zero is preserved', () => {
  assert.equal(typeof facts.displayFact, 'function');
  for (const value of ['', '  ', null, undefined])
    assert.equal(facts.displayFact(value), 'Unknown');
  assert.equal(facts.displayFact(0), 0);
  assert.equal(facts.displayFact('Vacant'), 'Vacant');
});
