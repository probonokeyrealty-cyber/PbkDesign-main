import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createBackgroundPersistence } from './background-persistence.mjs';

test('a burst has one active persistence and one latest pending snapshot', async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const writes = [];
  let active = 0;
  let maxActive = 0;
  const queue = createBackgroundPersistence({ persist: async (value) => {
    active++; maxActive = Math.max(maxActive, active); writes.push(value);
    if (writes.length === 1) { entered(); await gate; }
    active--;
  } });
  queue.schedule({ version: 1 });
  await started;
  for (let version = 2; version <= 100; version++) queue.schedule({ version });
  release();
  await queue.drain();
  assert.equal(maxActive, 1);
  assert.deepEqual(writes.map((value) => value.version), [1, 100]);
});

test('failed writes are surfaced and the latest pending state still persists', async () => {
  const failures = [];
  const writes = [];
  let queue;
  queue = createBackgroundPersistence({ persist: async (value) => {
    writes.push(value);
    if (value === 1) { queue.schedule(2); throw new Error('write failed'); }
  }, onError: (error) => failures.push(error.message) });
  await queue.schedule(1);
  assert.deepEqual(writes, [1, 2]);
  assert.deepEqual(failures, ['write failed']);
  await queue.schedule(3);
  assert.deepEqual(writes, [1, 2, 3]);
});

test('independent queues do not mix persistence scopes', async () => {
  const writes = [];
  const first = createBackgroundPersistence({ persist: async (value) => writes.push(['first', value]) });
  const second = createBackgroundPersistence({ persist: async (value) => writes.push(['second', value]) });
  await Promise.all([first.schedule(1), second.schedule(2)]);
  assert.deepEqual(writes, [['first', 1], ['second', 2]]);
});
