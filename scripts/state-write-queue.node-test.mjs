import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoalescedPersistence } from './background-persistence.mjs';

test('burst snapshots coalesce without overlapping writes or early success', async () => {
  const gates = [Promise.withResolvers(), Promise.withResolvers()];
  const writes = []; let active = 0; let maximum = 0; let resolved = 0;
  const queue = createCoalescedPersistence({ persist: async value => {
    const index = writes.length; writes.push(value);
    maximum = Math.max(maximum, ++active);
    await gates[index].promise; active--; return value;
  } });
  const first = queue.schedule({ revision: 1 });
  const pending = Array.from({ length: 50 }, (_, i) => queue.schedule({ revision: i + 2 }).then(result => { resolved++; return result; }));
  assert.equal(writes.length, 1); assert.equal(resolved, 0);
  gates[0].resolve(); assert.deepEqual(await first, { revision: 1 });
  assert.equal(writes.length, 2); assert.equal(resolved, 0);
  assert.deepEqual(writes[1], { revision: 51 });
  gates[1].resolve();
  assert.ok((await Promise.all(pending)).every(result => result.revision === 51));
  assert.equal(maximum, 1); assert.equal(resolved, 50);
});

test('write failures reach all affected callers and a later save can recover', async () => {
  const gate = Promise.withResolvers(); let writes = 0;
  const queue = createCoalescedPersistence({ persist: async () => {
    if (++writes === 1) await gate.promise;
    return true;
  } });
  const failed = queue.schedule({ revision: 1 });
  const recovered = queue.schedule({ revision: 2 });
  const rejection = assert.rejects(failed, /database unavailable/);
  gate.reject(Error('database unavailable'));
  await rejection; assert.equal(await recovered, true);
  assert.equal(await queue.schedule({ revision: 3 }), true);
});
