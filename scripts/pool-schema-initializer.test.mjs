import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createPoolSchemaInitializer } from './pool-schema-initializer.mjs';

test('successful initialization is shared concurrently and cached per pool only', async () => {
  const ensure = createPoolSchemaInitializer();
  const organic = {};
  const controlled = {};
  let calls = 0;
  const initialize = async () => { calls++; return { ok: true }; };
  await Promise.all([ensure(organic, initialize), ensure(organic, initialize)]);
  await ensure(organic, initialize);
  assert.equal(calls, 1);
  await ensure(controlled, initialize);
  assert.equal(calls, 2);
});

test('returned failures and thrown failures never poison the readiness cache', async () => {
  const ensure = createPoolSchemaInitializer();
  const pool = {};
  assert.equal((await ensure(pool, async () => ({ ok: false }))).ok, false);
  await assert.rejects(ensure(pool, async () => { throw new Error('database unavailable'); }), /unavailable/);
  assert.equal((await ensure(pool, async () => ({ ok: true }))).ok, true);
});
