import test from 'node:test';
import assert from 'node:assert/strict';
const lifecycle =
  await import('../supabase/functions/pbk-investor-staging/uploadLifecycle.mjs').catch(() => ({}));
test('failed attachment is reconciled and original conflict retained', async () => {
  assert.equal(typeof lifecycle.storePrivateAsset, 'function');
  const calls = [];
  await assert.rejects(
    () =>
      lifecycle.storePrivateAsset({
        reserve: async () => calls.push('reserved'),
        upload: async () => calls.push('stored'),
        attach: async () => {
          throw Object.assign(Error('revision conflict'), { status: 409 });
        },
        reconcile: async () => {
          calls.push('removed');
          return null;
        },
      }),
    (e) => e.status === 409
  );
  assert.deepEqual(calls, ['reserved', 'stored', 'removed']);
});
test('ambiguous metadata response preserves committed file and returns durable result', async () => {
  assert.equal(typeof lifecycle.storePrivateAsset, 'function');
  const durable = { property: { id: 'qa', assets: [{ id: 'photo' }] } };
  const result = await lifecycle.storePrivateAsset({
    reserve: async () => {},
    upload: async () => {},
    attach: async () => {
      throw Error('lost response');
    },
    reconcile: async () => durable,
  });
  assert.equal(result, durable);
});
test('cleanup outage retains reservation and gives retryable explanation', async () => {
  assert.equal(typeof lifecycle.storePrivateAsset, 'function');
  let pending = true;
  await assert.rejects(
    () =>
      lifecycle.storePrivateAsset({
        reserve: async () => {
          pending = true;
        },
        upload: async () => {
          throw Error('upload failed');
        },
        attach: async () => {},
        reconcile: async () => {
          throw Error('storage unavailable');
        },
      }),
    /queued for cleanup/
  );
  assert.equal(pending, true);
});
