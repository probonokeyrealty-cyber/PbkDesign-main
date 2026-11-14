import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { createBackgroundPersistence } from './background-persistence.mjs';
import { createPoolSchemaInitializer } from './pool-schema-initializer.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('actual background integration keeps controlled writes immediate and out of organic queue', async () => {
  const storage = new AsyncLocalStorage();
  const writes = [];
  const state = new Proxy({}, { get: (_, key) => key === 'id' ? storage.getStore()?.id || 'organic' : undefined });
  const context = vm.createContext({
    createBackgroundPersistence, controlledExecution: storage, state, console,
    persistState: async (value) => writes.push({ state: value.id, scope: storage.getStore()?.id || 'organic' }),
  });
  const start = source.indexOf('const backgroundStatePersistence =');
  const end = source.indexOf('\nasync function persistCampaignRecord', start);
  vm.runInContext(source.slice(start, end), context);
  context.persistStateInBackground('organic');
  storage.run({ id: 'controlled' }, () => {
    context.persistStateInBackground('test-one');
    context.persistStateInBackground('test-two');
  });
  await vm.runInContext('backgroundStatePersistence.drain()', context);
  assert.equal(writes.filter((item) => item.scope === 'controlled').length, 2);
  assert.equal(writes.filter((item) => item.scope === 'organic').length, 1);
  assert(writes.every((item) => item.scope === item.state));
});

test('actual accounting caches schema per pool, awaits inserts and preserves billed usage', async () => {
  const statements = [];
  const pool = {};
  let release;
  let insertStarted;
  const started = new Promise((resolve) => { insertStarted = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const context = vm.createContext({
    createPoolSchemaInitializer, getPgPool: () => pool,
    toNumber: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    queryPgRows: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes('INSERT INTO')) { insertStarted(); await gate; }
      return { ok: true };
    },
  });
  const start = source.indexOf('const ensureTokenUsageSchema =');
  const end = source.indexOf('\nconst openAiEmbeddingCache', start);
  vm.runInContext(source.slice(start, end), context);
  let settled = false;
  const first = context.recordTokenUsage('deepseek', 'fixture-model', { prompt_tokens: 120, completion_tokens: 33, total_tokens: 153 }, { estimatedCost: 0.07 }).then(() => { settled = true; });
  await started;
  assert.equal(settled, false);
  release();
  await first;
  await context.recordTokenUsage('deepseek', 'fixture-model', { total_tokens: 99 });
  assert.equal(statements.filter((item) => item.sql.includes('CREATE TABLE')).length, 1);
  const inserts = statements.filter((item) => item.sql.includes('INSERT INTO'));
  assert.equal(inserts.length, 2);
  assert.deepEqual(Array.from(inserts[0].params.slice(4, 8)), [120, 33, 153, 0.07]);
});
