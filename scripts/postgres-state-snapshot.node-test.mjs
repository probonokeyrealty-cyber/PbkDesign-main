import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { writePostgresStateSnapshot } from './postgres-state-snapshot.mjs';

const snapshot = '{"next":true}';
const disconnect = Object.assign(new Error('Connection terminated unexpectedly'), {
  executionOutcome: 'unknown',
  postgresRetryHandled: true,
});
const restart = Object.assign(new Error('the database system is not yet accepting connections'), {
  code: '57P03',
  executionOutcome: 'not_submitted',
  postgresRetryHandled: true,
});

function fixture({ commitBeforeDisconnect = false, concurrentWrite = false } = {}) {
  let row = { version: '1', data: '{}' };
  let writes = 0;
  const pool = {
    async query(sql, params = []) {
      if (/^SELECT xmin/.test(sql)) return { rows: [{ version: row.version }] };
      if (/^SELECT data =/.test(sql)) return { rows: [{ matches: row.data === params[0] }] };
      assert.match(sql, /^UPDATE bridge_state/);
      writes += 1;
      if (writes === 1) {
        if (commitBeforeDisconnect) row = { version: '2', data: snapshot };
        if (concurrentWrite) row = { version: '3', data: '{"newer":true}' };
        throw disconnect;
      }
      if (writes === 2) throw restart;
      if (params[1] !== row.version) return { rowCount: 0 };
      row = { version: '4', data: params[0] };
      return { rowCount: 1 };
    },
  };
  return {
    pool,
    read: () => row,
    writes: () => writes,
  };
}

const options = {
  maxAttempts: 4,
  delay: async () => {},
};

test('recovers the same queued snapshot after a Postgres disconnect and restart', async () => {
  const db = fixture();
  assert.equal(await writePostgresStateSnapshot(db.pool, snapshot, options), 3);
  assert.deepEqual(db.read(), { version: '4', data: snapshot });
});

test('recognizes a snapshot that committed before the connection dropped', async () => {
  const db = fixture({ commitBeforeDisconnect: true });
  await writePostgresStateSnapshot(db.pool, snapshot, options);
  assert.deepEqual(db.read(), { version: '2', data: snapshot });
  assert.equal(db.writes(), 3);
});

test('never overwrites a newer snapshot during recovery', async () => {
  const db = fixture({ concurrentWrite: true });
  await assert.rejects(writePostgresStateSnapshot(db.pool, snapshot, options), {
    code: 'PBK_POSTGRES_SNAPSHOT_CONFLICT',
  });
  assert.deepEqual(db.read(), { version: '3', data: '{"newer":true}' });
});

test('does not retry a permanent database error', async () => {
  const error = Object.assign(new Error('permission denied'), { code: '42501' });
  let queries = 0;
  const pool = { async query() { queries += 1; throw error; } };
  await assert.rejects(writePostgresStateSnapshot(pool, snapshot, options), error);
  assert.equal(queries, 1);
});


test('Postgres recognizes committed snapshots and preserves concurrent replacement rows', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('CREATE TABLE bridge_state (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL)');
  const query = async (sql, params) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.affectedRows };
  };
  assert.equal(await writePostgresStateSnapshot({ query }, '{}', options), 1);

  let interrupt = true;
  const uncertainWrite = {
    async query(sql, params) {
      const result = await query(sql, params);
      if (interrupt && sql.startsWith('UPDATE bridge_state')) {
        interrupt = false;
        throw disconnect;
      }
      return result;
    },
  };
  assert.equal(await writePostgresStateSnapshot(uncertainWrite, snapshot, options), 2);
  const saved = await db.query('SELECT data, xmin::text AS version FROM bridge_state');
  assert.deepEqual(saved.rows[0].data, { next: true });

  interrupt = true;
  const overlappingWrite = {
    async query(sql, params) {
      if (interrupt && sql.startsWith('UPDATE bridge_state')) {
        interrupt = false;
        await db.exec("UPDATE bridge_state SET data = '{\"newer\":true}'");
        throw disconnect;
      }
      return query(sql, params);
    },
  };
  await assert.rejects(writePostgresStateSnapshot(overlappingWrite, '{}', options), {
    code: 'PBK_POSTGRES_SNAPSHOT_CONFLICT',
  });
  assert.deepEqual((await db.query('SELECT data FROM bridge_state')).rows[0].data, { newer: true });
});
