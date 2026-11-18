import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import pg from 'pg';
import { readCanaryEvidence } from './canary-evidence-reader.mjs';
import { makeCanaryFixture } from './fixtures/canary-evidence-fixture.mjs';
import { observeCanaryPostgres } from './fixtures/canary-postgres-observer.mjs';

// Real pg-pool leases/events, with socket and SQL execution replaced offline.
// Empty selections only: no fabricated physical database envelopes or SQL proof.
function offlinePool({ failHandoff = false, failQuery = false } = {}) {
  const clients = [], active = new Set(), releases = [], queries = [], idleErrors = [];
  let handoffError;
  class OfflineClient extends pg.Client {
    connect(callback) {
      clients.push(this);
      process.nextTick(() => {
        callback(null);
        if (failHandoff) {
          try { this._handleErrorEvent(new Error('offline handoff failure')); }
          catch (error) { handoffError = error; }
        }
      });
    }
    query(config) {
      queries.push(config);
      const text = typeof config === 'string' ? config : config.text;
      if (failQuery && text.startsWith('WITH selected')) {
        this._handleErrorEvent(new Error('offline pending query failure'));
        return Promise.reject(new Error('offline query rejected'));
      }
      if (text.startsWith('SELECT current_setting')) return Promise.resolve({
        rows: [{ ro: 'on', isolation: 'repeatable read' }], fields: [],
      });
      return Promise.resolve({ rows: [], fields: text.startsWith('WITH selected')
        ? [114, 23, 23].map(dataTypeID => ({ dataTypeID })) : [] });
    }
  }
  const pool = new pg.Pool({ Client: OfflineClient, max: 1 });
  pool.on('acquire', client => active.add(client));
  pool.on('release', (destroy, client) => { active.delete(client); releases.push(destroy); });
  pool.on('error', error => idleErrors.push(error.message));
  return { pool, clients, releases, queries, idleErrors,
    get handoffError() { return handoffError; },
    async close() {
      // Also clean leaked leases on RED; never wait on an unreleased max:1 pool.
      for (const client of active) client.release(true);
      await pool.end();
    },
  };
}

function read(pool) {
  const f = makeCanaryFixture();
  return readCanaryEvidence({ pool, secret: f.secret, revision: f.revision,
    policy: { ready: true, version: 2, hash: f.policyHash }, now: () => f.now });
}

function denied(result, code) {
  assert.deepEqual(result, { ok: false, verified: false, readbackVerified: false,
    source: 'postgres:pbk_eval_runs', result: code, runId: null, evidence: {}, diagnostics: { codes: [code] } });
}

test('actual observer inspects snapshots, forwards original configs and reuses max:1 without listener or lease leaks', async () => {
  const raw = offlinePool();
  try {
    for (let i = 0; i < 2; i++) {
      let inspected = 0;
      const { pool, trace } = observeCanaryPostgres(raw.pool, () => { inspected++; });
      denied(await read(pool), 'canary_evidence_missing');
      assert.deepEqual(trace.transactions, [{ ro: 'on', isolation: 'repeatable read' }]);
      assert.equal(trace.snapshots, 1);
      assert.equal(inspected, 1);
      assert.deepEqual(trace.released, [false]);
      assert.equal(trace.envelopes.length, 1);
      assert.deepEqual(trace.envelopes[0].rows, []);
      assert(raw.queries.includes(trace.envelopes[0].config), 'native query receives the original config object');
      assert.equal(raw.pool.idleCount, 1);
      assert.equal(raw.pool.waitingCount, 0);
      assert.equal(raw.clients.length, 1);
      assert.equal(raw.clients[0].listenerCount('error'), 1, 'only the native idle listener remains');
    }
    assert.deepEqual(raw.releases, [false, false]);
    raw.clients[0]._handleErrorEvent(new Error('native idle failure'));
    assert.deepEqual(raw.idleErrors, ['native idle failure']);
    assert.equal(raw.pool.totalCount, 0);
  } finally { await raw.close(); }
});

for (const mode of ['failHandoff', 'failQuery']) test(`actual observer preserves error ownership at ${mode}`, async () => {
  const raw = offlinePool({ [mode]: true });
  try {
    const { pool, trace } = observeCanaryPostgres(raw.pool);
    denied(await read(pool), 'canary_evidence_unavailable');
    assert.equal(raw.handoffError, undefined, 'reader must own same-stack native checkout errors');
    assert.deepEqual(trace.released, [true]);
    assert.deepEqual(raw.releases, [true]);
    assert.equal(raw.pool.totalCount, 0);
    assert.equal(raw.pool.waitingCount, 0);
    assert(!trace.queries.includes('ROLLBACK'), 'poisoned client must not queue rollback');
    if (mode === 'failHandoff') assert.deepEqual(trace.queries, []);
    const count = raw.queries.length;
    raw.clients[0]._handleErrorEvent(new Error('late destroyed failure'));
    assert.equal(raw.queries.length, count);
    assert.deepEqual(raw.releases, [true], 'late events cannot release twice');
  } finally { await raw.close(); }
});

test('actual observer preserves callback release and promise checkout across repeated native leases', async () => {
  const raw = offlinePool();
  try {
    const { pool, trace } = observeCanaryPostgres(raw.pool);
    await new Promise((resolve, reject) => {
      const returned = pool.connect((error, client, release) => {
        if (error) { reject(error); return; }
        try {
          const events = [], onError = error => events.push(error.message);
          client.on('error', onError);
          raw.clients[0].emit('error', new Error('native channel'));
          assert.deepEqual(events, ['native channel']);
          client.removeListener('error', onError);
          assert.equal(raw.clients[0].listenerCount('error'), 0);
          assert.equal(release, client.release);
          release(false);
          assert.throws(() => release(false), /already been released/, 'native double-release guard is retained');
          resolve();
        } catch (caught) { reject(caught); }
      });
      assert.equal(returned, undefined, 'callback checkout must not also return a promise');
    });
    const client = await pool.connect();
    const result = await client.query('ROLLBACK');
    assert.deepEqual(result.rows, []);
    client.release(false);
    assert.equal(raw.clients.length, 1);
    assert.deepEqual(raw.releases, [false, false]);
    assert.deepEqual(trace.queries, ['ROLLBACK']);
    assert.equal(raw.pool.idleCount, 1);
    assert.equal(raw.clients[0].listenerCount('error'), 1);
  } finally { await raw.close(); }
});

test('actual observer stale callback release cannot release a reacquired native client', async () => {
  const raw = offlinePool();
  try {
    const { pool } = observeCanaryPostgres(raw.pool);
    const firstRelease = await new Promise((resolve, reject) => {
      pool.connect((error, client, release) => error ? reject(error) : resolve(release));
    });
    firstRelease(false);
    const second = await pool.connect();
    assert.equal(raw.clients.length, 1, 'max:1 must reuse the same native client');
    assert.equal(raw.pool.idleCount, 0);
    assert.deepEqual(raw.releases, [false]);
    assert.throws(() => firstRelease(false), /Release called on client which has already been released to the pool\./,
      'stale native callback release must throw without returning the current lease');
    assert.equal(raw.pool.idleCount, 0, 'second lease remains owned');
    assert.equal(raw.pool.totalCount, 1);
    assert.equal(raw.pool.waitingCount, 0);
    assert.deepEqual(raw.releases, [false], 'stale handle cannot release the new lease');
    second.release(false);
    assert.deepEqual(raw.releases, [false, false]);
    assert.equal(raw.pool.idleCount, 1);
  } finally { await raw.close(); }
});

test('actual observer forwards native checkout errors without creating leases', async () => {
  const raw = offlinePool();
  await raw.close();
  const { pool, trace } = observeCanaryPostgres(raw.pool);
  await assert.rejects(pool.connect(), /Cannot use a pool after calling end/);
  await new Promise((resolve, reject) => {
    pool.connect((error, client) => {
      try {
        assert.match(error.message, /Cannot use a pool after calling end/);
        assert.equal(client, undefined);
        resolve();
      } catch (caught) { reject(caught); }
    });
  });
  assert.deepEqual(trace.released, []);
  assert.equal(raw.pool.totalCount, 0);
});

test('actual observer inspection failure destroys the reader lease exactly once', async () => {
  const raw = offlinePool();
  try {
    const { pool, trace } = observeCanaryPostgres(raw.pool, () => { throw new Error('offline inspection failure'); });
    denied(await read(pool), 'canary_evidence_unavailable');
    assert.equal(trace.snapshots, 1);
    assert.deepEqual(trace.released, [true]);
    assert.deepEqual(raw.releases, [true]);
    assert.equal(raw.pool.totalCount, 0);
  } finally { await raw.close(); }
});
