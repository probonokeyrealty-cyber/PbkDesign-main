import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import Pool from 'pg-pool';
import { withPgTransaction } from './skill-governance-store.mjs';

// Run with node --test. Extract only database helpers; no bridge startup, .env, or sockets.
const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name.text, node.getText(ast)]));
const pgConstants = ast.statements.filter((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.every((declaration) => declaration.name.getText(ast).startsWith('PG_')))
  .map((node) => node.getText(ast)).join('\n');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const connectionError = () => Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });

function load(context, names) {
  for (const name of names) {
    assert.ok(functions.has(name), `Missing bridge function: ${name}`);
    vm.runInContext(functions.get(name), context);
  }
}

function runtime(t, {
  connectDelay = 0, queryDelay = 0, connectError = () => null,
  execute = () => ({ rows: [{ ok: 1 }], rowCount: 1 }),
  emitQueryError = false, env = {},
} = {}) {
  const acquired = new Set();
  const timers = new Set();
  const counters = { connections: 0, queries: 0, completions: 0, releases: 0, discarded: 0 };
  function later(callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  }
  class IsolatedClient extends EventEmitter {
    constructor() {
      super();
      this._queryable = true;
      this._ending = false;
    }
    connect(callback) {
      const error = connectError(++counters.connections);
      later(() => callback(error), connectDelay);
    }
    query(sql, values, callback) {
      if (typeof values === 'function') { callback = values; values = undefined; }
      if (!callback) {
        return new Promise((resolve, reject) => {
          this.query(sql, values, (error, result) => error ? reject(error) : resolve(result));
        });
      }
      counters.queries += 1;
      later(() => {
        counters.completions += 1;
        let result;
        let error;
        try { result = execute(sql, values); }
        catch (caught) { error = caught; }
        if (error && emitQueryError) this.emit('error', error);
        callback(error, result);
      }, queryDelay);
    }
    end(callback) { this.emit('end'); callback?.(); }
    isConnected() { return true; }
  }
  class IsolatedPool extends Pool {
    constructor(options) {
      super({ ...options, Client: IsolatedClient });
      this.on('acquire', (client) => acquired.add(client));
      this.on('release', (error, client) => {
        acquired.delete(client);
        counters.releases += 1;
        if (error) counters.discarded += 1;
      });
    }
  }
  const context = vm.createContext({
    console: { warn() {}, error() {}, log() {} }, setTimeout, clearTimeout, Buffer, URL,
    process: { env: { PBK_PG_POOL_MAX: '1', PBK_PG_OPERATION_TIMEOUT_MS: '1000',
      PBK_PG_QUERY_RETRY_BASE_DELAY_MS: '50', PBK_STATE_PERSIST_RETRY_BASE_MS: '50', ...env } },
    IS_HOSTED: true, DATABASE_URL: 'postgres://isolated@localhost/never-connected',
    PgPool: IsolatedPool, __pgPool: null, postgresHealth: {},
    isoNow: () => new Date().toISOString(), sleep: pause,
    stateDbPersistWarned: false, activityLogPersistenceWarned: false,
    runtimeStateProvenance: {}, lastStateDbPersist: {},
    postgresJsonStringify: JSON.stringify, ensureActivityLogSchema: async () => {},
  });
  vm.runInContext(pgConstants, context);
  load(context, ['markPostgresHealth', 'isBoundedPostgresOperationTimeout', 'isPostgresPoolPressureError',
    'isTransientPostgresConnectionError', 'getPostgresOperationTimeoutMs', 'createPostgresDeadlineError',
    'withPostgresOperationDeadline', 'withPostgresConnectionRetry', 'getPgPool',
    'isTransientPostgresStatePersistError', 'getStatePersistRetryAttempts',
    'getStatePersistRetryDelayMs', 'queryPgRows']);
  context.getPostgresHealthMeta = () => context.postgresHealth;
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    for (const client of acquired) client.release(true);
    if (context.__pgPool) await context.__pgPool.end();
  });
  return { context, counters, pool: context.getPgPool() };
}

test('promise query preserves result and releases its client', async (t) => {
  const { pool, counters } = runtime(t);
  const result = await pool.query('SELECT 1');
  assert.equal(result.rows[0].ok, 1);
  assert.equal(pool.idleCount, 1);
  assert.equal(counters.releases, 1);
});

test('query callback overloads return undefined and deliver exactly once', async (t) => {
  const fixture = runtime(t, { execute: (sql, values) => ({ rows: [{ sql, values }] }) });
  for (const args of [['SELECT 1'], ['SELECT $1', [42]], [{ text: 'SELECT $1', name: 'isolated-query' }, [42]]]) {
    let calls = 0;
    await new Promise((resolve, reject) => {
      const returned = fixture.pool.query(...args, (error, result) => {
        calls += 1;
        if (error) return reject(error);
        try {
          assert.equal(result.rows[0].sql, args[0]);
          assert.equal(result.rows[0].values, args[1]);
          resolve();
        } catch (caught) { reject(caught); }
      });
      assert.equal(returned, undefined);
      assert.equal(calls, 0);
    });
    assert.equal(calls, 1);
  }
  assert.equal(fixture.counters.releases, 3);
});

test('connect callback receives client and release; return value is undefined', async (t) => {
  const { pool, counters } = runtime(t);
  let calls = 0;
  await new Promise((resolve, reject) => {
    const returned = pool.connect((error, client, release) => {
      calls += 1;
      if (error) return reject(error);
      try {
        assert.equal(release, client.release);
        release();
        resolve();
      } catch (caught) { reject(caught); }
    });
    assert.equal(returned, undefined);
  });
  assert.equal(calls, 1);
  assert.equal(counters.releases, 1);
});

test('callback execution error updates health without replaying SQL', async (t) => {
  const fixture = runtime(t, { execute: () => { throw connectionError(); } });
  const error = await new Promise((resolve) => {
    assert.equal(fixture.pool.query('UPDATE isolated SET value = value + 1', resolve), undefined);
  });
  assert.equal(error.code, 'ECONNRESET');
  assert.equal(error.executionOutcome, 'unknown');
  assert.equal(fixture.context.postgresHealth.ready, false);
  assert.equal(fixture.counters.queries, 1);
  assert.equal(fixture.counters.releases, 1);
});

test('promise connect releases a late acquisition after its deadline', async (t) => {
  const { pool, counters } = runtime(t, { connectDelay: 1250, env: { PBK_PG_CONNECTION_TIMEOUT_MS: '3000' } });
  await assert.rejects(pool.connect(), { code: 'PBK_POSTGRES_OPERATION_TIMEOUT', executionOutcome: 'not_submitted' });
  await pause(350);
  assert.equal(pool.totalCount, 0);
  assert.equal(counters.releases, 1);
  assert.equal(counters.discarded, 1);
  assert.equal(counters.connections, 1);
});

test('callback connect times out once and releases its late client', async (t) => {
  const { pool, counters } = runtime(t, { connectDelay: 1250, env: { PBK_PG_CONNECTION_TIMEOUT_MS: '3000' } });
  let calls = 0;
  const error = await new Promise((resolve) => {
    assert.equal(pool.connect((error, client, release) => {
      calls += 1;
      assert.equal(client, undefined);
      assert.equal(typeof release, 'function');
      resolve(error);
    }), undefined);
  });
  assert.equal(error.code, 'PBK_POSTGRES_OPERATION_TIMEOUT');
  await pause(350);
  assert.equal(calls, 1);
  assert.equal(pool.totalCount, 0);
  assert.equal(counters.releases, 1);
});

test('execution deadline discards client and reports unknown, even if late work commits', async (t) => {
  let committed = 0;
  const fixture = runtime(t, {
    connectDelay: 600, queryDelay: 700,
    env: { PBK_PG_CONNECTION_TIMEOUT_MS: '1000', PBK_PG_QUERY_TIMEOUT_MS: '1000' },
    execute: () => { committed += 1; return { rows: [] }; },
  });
  await assert.rejects(fixture.pool.query('UPDATE isolated SET value = value + 1'), {
    code: 'PBK_POSTGRES_OPERATION_TIMEOUT', executionOutcome: 'unknown', postgresRetryHandled: true,
  });
  assert.equal(committed, 0);
  assert.equal(fixture.pool.totalCount, 0);
  await pause(400);
  assert.equal(committed, 1, 'Dropping a socket cannot establish whether a write committed');
  assert.equal(fixture.counters.queries, 1);
  assert.equal(fixture.counters.releases, 1);
});

test('callback query deadline delivers one error and suppresses late success', async (t) => {
  const { pool, counters } = runtime(t, { queryDelay: 1200 });
  let calls = 0;
  const error = await new Promise((resolve) => {
    assert.equal(pool.query('SELECT 1', (error) => { calls += 1; resolve(error); }), undefined);
  });
  assert.equal(error.code, 'PBK_POSTGRES_OPERATION_TIMEOUT');
  assert.equal(error.executionOutcome, 'unknown');
  await pause(300);
  assert.equal(calls, 1);
  assert.equal(counters.releases, 1);
  assert.equal(pool.totalCount, 0);
});

test('query checkout timeout never dispatches SQL when acquisition arrives late', async (t) => {
  const { pool, counters } = runtime(t, { connectDelay: 1250 });
  await assert.rejects(pool.query('UPDATE isolated SET value = value + 1'), {
    code: 'PBK_POSTGRES_OPERATION_TIMEOUT', executionOutcome: 'not_submitted',
  });
  await pause(350);
  assert.equal(counters.queries, 0);
  assert.equal(counters.releases, 1);
  assert.equal(pool.totalCount, 0);
});

test('timed-out queued acquisition is released when its holder returns the client', async (t) => {
  const { pool, counters } = runtime(t, { env: { PBK_PG_CONNECTION_TIMEOUT_MS: '3000' } });
  const holder = await pool.connect();
  await assert.rejects(pool.query('UPDATE isolated SET value = value + 1'), {
    code: 'PBK_POSTGRES_OPERATION_TIMEOUT', executionOutcome: 'not_submitted',
  });
  assert.equal(pool.waitingCount, 1);
  holder.release();
  await pause(50);
  assert.equal(pool.waitingCount, 0);
  assert.equal(pool.totalCount, 0);
  assert.equal(counters.queries, 0);
  assert.equal(counters.releases, 2);
});

test('retry backoff shares the operation deadline and cannot launch a late retry', async (t) => {
  const fixture = runtime(t, { connectError: connectionError, env: { PBK_PG_QUERY_RETRY_BASE_DELAY_MS: '1000' } });
  await assert.rejects(fixture.pool.query('SELECT 1'), {
    code: 'PBK_POSTGRES_OPERATION_TIMEOUT', executionOutcome: 'not_submitted',
  });
  await pause(50);
  assert.equal(fixture.counters.connections, 1);
  assert.equal(fixture.counters.queries, 0);
});

test('non-idempotent script exposure is not replayed after a lost acknowledgment', async (t) => {
  let usageCount = 0;
  const fixture = runtime(t, { execute(sql) {
    assert.match(sql, /usage_count = COALESCE\(usage_count, 0\) \+ 1/);
    usageCount += 1;
    throw connectionError();
  } });
  load(fixture.context, ['persistContextAwareScriptExposureToPg']);
  const result = await fixture.context.persistContextAwareScriptExposureToPg({ selectedScript: { id: 'isolated-script' } });
  assert.equal(result, false);
  assert.equal(usageCount, 1);
});

test('queryPgRows has no outer retry after dispatch', async (t) => {
  const fixture = runtime(t, { execute: () => { throw connectionError(); } });
  const result = await fixture.context.queryPgRows('SELECT 1');
  assert.equal(result.ok, false);
  assert.equal(result.retryAttempts, 1);
  assert.equal(result.retryable, false);
  assert.equal(result.executionOutcome, 'unknown');
  assert.equal(fixture.counters.queries, 1);
});

test('queryPgRows exhausts a single acquisition retry budget, not 3 x 5', async (t) => {
  const fixture = runtime(t, { connectError: connectionError });
  const result = await fixture.context.queryPgRows('SELECT 1');
  assert.equal(result.ok, false);
  assert.equal(result.executionOutcome, 'not_submitted');
  assert.equal(fixture.counters.connections, 3);
  assert.equal(fixture.counters.queries, 0);
});

test('recoverable acquisition failures retry before exactly one write', async (t) => {
  const fixture = runtime(t, { connectError: (attempt) => attempt < 3 ? connectionError() : null });
  await fixture.pool.query('UPDATE isolated SET value = value + 1');
  assert.equal(fixture.counters.connections, 3);
  assert.equal(fixture.counters.queries, 1);
  assert.equal(fixture.context.postgresHealth.ready, true);
});

test('state persistence does not multiply acquisition retries or replay ambiguous writes', async (t) => {
  for (const options of [{ connectError: connectionError }, { execute: () => { throw connectionError(); } }]) {
    const fixture = runtime(t, options);
    load(fixture.context, ['persistActivityLogRecords', 'buildStatePersistenceDiagnostics', 'persistStateToDb']);
    assert.equal(await fixture.context.persistStateToDb({ status: {}, activity: [] }), false);
    assert.equal(fixture.context.lastStateDbPersist.ok, false);
    assert.equal(fixture.context.lastStateDbPersist.retryable, false);
    assert.equal(fixture.counters.connections, options.connectError ? 3 : 1);
    assert.equal(fixture.counters.queries, options.connectError ? 0 : 1);
  }
});

test('invalid retry configuration cannot skip SQL and report persistence success', async (t) => {
  const fixture = runtime(t, { env: {
    PBK_STATE_PERSIST_RETRY_ATTEMPTS: 'invalid', PBK_STATE_PERSIST_RETRY_BASE_MS: 'invalid',
    PBK_PG_QUERY_RETRY_ATTEMPTS: 'invalid', PBK_PG_QUERY_RETRY_BASE_DELAY_MS: 'invalid',
  } });
  load(fixture.context, ['persistActivityLogRecords', 'buildStatePersistenceDiagnostics', 'persistStateToDb']);
  assert.equal(fixture.context.getStatePersistRetryAttempts(), 5);
  assert.equal(fixture.context.getStatePersistRetryDelayMs('invalid'), 250);
  assert.equal(await fixture.context.persistStateToDb({ status: {}, activity: [] }), true);
  assert.equal(fixture.counters.queries, 1);
  assert.equal(fixture.context.lastStateDbPersist.ok, true);
  const failed = runtime(t, { connectError: connectionError, env: { PBK_PG_QUERY_RETRY_ATTEMPTS: 'invalid' } });
  await assert.rejects(failed.pool.query('SELECT 1'), { code: 'ECONNRESET' });
  assert.equal(failed.counters.connections, 3);
  const failedPersist = runtime(t, {
    execute: () => { throw connectionError(); }, env: { PBK_STATE_PERSIST_RETRY_ATTEMPTS: 'invalid' },
  });
  load(failedPersist.context, ['persistActivityLogRecords', 'buildStatePersistenceDiagnostics', 'persistStateToDb']);
  assert.equal(await failedPersist.context.persistStateToDb({ status: {}, activity: [] }), false);
  assert.equal(failedPersist.context.lastStateDbPersist.ok, false);
  assert.equal(failedPersist.counters.queries, 1);
});

test('retry counts are finite integers for malformed and fractional settings', (t) => {
  const { context } = runtime(t);
  for (const [value, expected] of [['NaN', 5], ['Infinity', 5], ['2.9', 2], ['0', 1], ['-1', 1], ['99', 8]]) {
    context.process.env.PBK_STATE_PERSIST_RETRY_ATTEMPTS = value;
    assert.equal(context.getStatePersistRetryAttempts(), expected);
  }
});

test('client error event followed by callback releases only once', async (t) => {
  const fixture = runtime(t, { emitQueryError: true, execute: () => { throw connectionError(); } });
  await assert.rejects(fixture.pool.query('SELECT 1'), { code: 'ECONNRESET', executionOutcome: 'unknown' });
  assert.equal(fixture.counters.releases, 1);
  assert.equal(fixture.pool.totalCount, 0);
});

test('server statement timeout is not retried by pool or persistence layers', async (t) => {
  const fixture = runtime(t, { execute: () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }); } });
  const result = await fixture.context.queryPgRows('UPDATE isolated SET value = value + 1');
  assert.equal(result.ok, false);
  assert.equal(result.code, '57014');
  assert.equal(result.retryable, false);
  assert.equal(fixture.counters.queries, 1);
});

test('transaction clients preserve BEGIN/COMMIT/ROLLBACK and release semantics', async (t) => {
  const queries = [];
  const fixture = runtime(t, { execute(sql) { queries.push(sql); return { rows: [] }; } });
  await withPgTransaction(fixture.pool, (client) => client.query('SELECT 1'));
  assert.deepEqual(queries, ['BEGIN', 'SELECT 1', 'COMMIT']);
  queries.length = 0;
  await assert.rejects(withPgTransaction(fixture.pool, async () => { throw new Error('isolated failure'); }), /isolated failure/);
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK']);
  assert.equal(fixture.counters.releases, 2);
  assert.equal(fixture.pool.idleCount, 1);
});
