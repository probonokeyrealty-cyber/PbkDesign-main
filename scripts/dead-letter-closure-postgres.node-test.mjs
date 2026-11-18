import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {
  validateClosureMigrationConfig, applyDeadLetterClosureMigration, verifyDeadLetterClosureInstallation,
} from './dead-letter-closure-migration.mjs';
import { executeDeadLetterClosure, readDeadLetterClosures, verifyDeadLetterClosureReference } from './dead-letter-closure-store.mjs';
import { CLOSURE_SOURCE_FIXTURE_SQL, seedClosureSources, seedClosureApproval,
  closureTestAuthority, closureHead } from './fixtures/dead-letter-closure-store-fixture.mjs';

// No provisioning, remote branch, ambient URL or service startup. The controller
// must supply a pre-created, generated empty loopback DB for an explicit local run.
export function validateLocalClosurePostgresTestConfig(env = {}) {
  if (env.PBK_CLOSURE_PG_TEST_ENABLE !== '1') throw new Error('Explicit closure local Postgres test opt-in required');
  const config = validateClosureMigrationConfig(env);
  if (!['127.0.0.1', '[::1]'].includes(config.host)
    || !/^pbk_closure_test_[a-f0-9]{32}$/.test(config.expectedDatabase)) {
    throw new Error('Closure Postgres tests require loopback IP and generated disposable database');
  }
  return config;
}

const CLOSURE_EMPTY_DATABASE_SQL = `SELECT (
  (SELECT count(*) FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_namespace n
    ON d.refclassid='pg_catalog.pg_namespace'::pg_catalog.regclass AND d.refobjid=n.oid
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
  (SELECT count(*) FROM pg_catalog.pg_namespace n
    WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema','public')) +
  (SELECT count(*) FROM pg_catalog.pg_extension WHERE extname<>'plpgsql')
)::text AS objects`;

const testEnv = {
  PBK_CLOSURE_PG_TEST_ENABLE: '1', PBK_CLOSURE_MIGRATION_TARGET: 'local',
  PBK_CLOSURE_MIGRATION_EXPECT_HOST: '127.0.0.1',
  PBK_CLOSURE_MIGRATION_EXPECT_DATABASE: `pbk_closure_test_${'a'.repeat(32)}`,
  PBK_CLOSURE_MIGRATION_EXPECT_ROLE: 'closure_test_owner',
  PBK_CLOSURE_MIGRATION_DATABASE_URL: `postgres://closure_test_owner:fixture-only@127.0.0.1/pbk_closure_test_${'a'.repeat(32)}`,
};

test('real-PG guard requires dedicated explicit opt-in and ignores ambient database URLs', () => {
  assert.throws(() => validateLocalClosurePostgresTestConfig({}), /opt-in/);
  assert.throws(() => validateLocalClosurePostgresTestConfig({ PBK_CLOSURE_PG_TEST_ENABLE: '1', DATABASE_URL: testEnv.PBK_CLOSURE_MIGRATION_DATABASE_URL }), /PBK_CLOSURE_MIGRATION/);
  assert.equal(validateLocalClosurePostgresTestConfig(testEnv).expectedRole, 'closure_test_owner');
});

test('real-PG guard rejects remote hosts, named databases, overrides and mismatched identities', () => {
  for (const changes of [
    { PBK_CLOSURE_MIGRATION_TARGET: 'production' },
    { PBK_CLOSURE_MIGRATION_EXPECT_HOST: 'remote.invalid', PBK_CLOSURE_MIGRATION_DATABASE_URL: testEnv.PBK_CLOSURE_MIGRATION_DATABASE_URL.replace('127.0.0.1', 'remote.invalid') },
    { PBK_CLOSURE_MIGRATION_EXPECT_HOST: 'localhost', PBK_CLOSURE_MIGRATION_DATABASE_URL: testEnv.PBK_CLOSURE_MIGRATION_DATABASE_URL.replace('127.0.0.1', 'localhost') },
    { PBK_CLOSURE_MIGRATION_EXPECT_DATABASE: 'postgres', PBK_CLOSURE_MIGRATION_DATABASE_URL: 'postgres://closure_test_owner:fixture-only@127.0.0.1/postgres' },
    { PBK_CLOSURE_MIGRATION_DATABASE_URL: `${testEnv.PBK_CLOSURE_MIGRATION_DATABASE_URL}?host=remote.invalid` },
    { PBK_CLOSURE_MIGRATION_EXPECT_ROLE: 'wrong' },
  ]) assert.throws(() => validateLocalClosurePostgresTestConfig({ ...testEnv, ...changes }));
});

test('empty-database preflight detects standalone schema objects (local PGlite guard test only)', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const empty = async () => (await db.query(CLOSURE_EMPTY_DATABASE_SQL)).rows[0].objects === '0';
  try {
    assert.equal(await empty(), true);
    for (const ddl of ["CREATE TYPE public.fixture_type AS ENUM ('fixture')",
      'CREATE TABLE public.fixture_table(id text)', 'CREATE SCHEMA fixture_schema',
      'CREATE FUNCTION public.fixture_function() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$']) {
      await db.exec('BEGIN');
      try { await db.exec(ddl); assert.equal(await empty(), false, ddl); }
      finally { await db.exec('ROLLBACK'); }
    }
  } finally { await db.close(); }
});

test('guarded real Postgres schema and store (native max:1 and two-client races)', {
  skip: Object.hasOwn(process.env, 'PBK_CLOSURE_PG_TEST_ENABLE') ? false
    : 'Real PostgreSQL unavailable/not opted in; no replica or concurrent-transaction proof claimed',
  timeout: 120000,
}, async t => {
  const config = validateLocalClosurePostgresTestConfig(process.env);
  const url = new URL(config.databaseUrl);
  const client = new pg.Client({ host: config.host.replace(/^\[|\]$/g, ''), port: config.port,
    database: config.expectedDatabase, user: config.expectedRole, password: decodeURIComponent(url.password),
    ssl: false, connectionTimeoutMillis: 2000, query_timeout: 2000,
    options: '-c search_path=pg_catalog,pg_temp -c statement_timeout=2000',
    application_name: 'pbk-closure-local-schema-test' });
  let installed = false;
  const query = client.query.bind(client);
  try {
    await client.connect();
    const connected = (await query(`SELECT current_database() AS database,current_user AS role,
      (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user) AS privileged`)).rows[0];
    assert.equal(connected.database, config.expectedDatabase);
    assert.equal(connected.role, config.expectedRole);
    assert.equal(connected.privileged, false, 'existing trusted test owner must not be superuser/BYPASSRLS');
    const empty = (await query(CLOSURE_EMPTY_DATABASE_SQL)).rows[0];
    assert.equal(empty.objects, '0', 'refuse any nonempty test database before schema changes');
    assert.equal((await applyDeadLetterClosureMigration(client, config)).ok, true);
    installed = true;
    assert.equal((await applyDeadLetterClosureMigration(client, config)).ok, true);
    const installation = await verifyDeadLetterClosureInstallation(query);
    assert.equal(installation.verified, true);
    assert.equal(installation.ownerDdlTrusted, true);
    for (const sql of ['UPDATE public.pbk_dead_letter_closure_ledger SET id=id',
      'DELETE FROM public.pbk_dead_letter_closure_ledger', 'TRUNCATE public.pbk_dead_letter_closure_ledger']) {
      await assert.rejects(query(sql), /immutable/);
    }
    await query('BEGIN');
    try {
      await query('DROP TRIGGER pbk_closure_immutable ON public.pbk_dead_letter_closure_ledger');
      assert.equal((await verifyDeadLetterClosureInstallation(query)).ok, false);
    } finally { await query('ROLLBACK'); }
    assert.equal((await verifyDeadLetterClosureInstallation(query)).ok, true);
    await nativeStoreCoverage(t, config, query);
  } finally {
    try {
      if (installed) {
        const identity = (await query('SELECT current_database() AS database,current_user AS role')).rows[0];
        assert.equal(identity.database, config.expectedDatabase);
        assert.equal(identity.role, config.expectedRole);
        assert.match(identity.database, /^pbk_closure_test_[a-f0-9]{32}$/);
        await query('DROP TABLE public.pbk_dead_letter_closure_ledger');
        await query('DROP FUNCTION public.pbk_closure_reject_mutation()');
      }
    } finally { await client.end(); }
  }
});

// Only reached after the existing empty-disposable-DB/identity/owner guards.
async function nativeStoreCoverage(t, config, query) {
  const url = new URL(config.databaseUrl);
  const connection = { host: config.host.replace(/^\[|\]$/g, ''), port: config.port,
    database: config.expectedDatabase, user: config.expectedRole, password: decodeURIComponent(url.password),
    ssl: false, connectionTimeoutMillis: 2000, query_timeout: 2000,
    options: '-c search_path=pg_catalog,pg_temp -c statement_timeout=2000', application_name: 'pbk-closure-local-store-test' };
  const pool = new pg.Pool({ ...connection, max: 1 });
  const other = new pg.Pool({ ...connection, max: 1 });
  const authority = closureTestAuthority();
  const ledgerRows = async () => (await query(`SELECT id,tenant_id,ordinal::text,
    to_char(admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted_at,
    insert_xid::text,record_ref,approval_ref,intent_binding,action,previous_id,report
    FROM public.pbk_dead_letter_closure_ledger ORDER BY ordinal`)).rows;
  const wrappedPool = (base, intercept) => ({ connect: async () => {
    const c = await base.connect();
    return { on: c.on.bind(c), removeListener: c.removeListener.bind(c), release: c.release.bind(c),
      query: async command => { await intercept(command); return c.query(command); } };
  } });
  let sourcesCreated = false;
  try {
    await query(CLOSURE_SOURCE_FIXTURE_SQL); sourcesCreated = true;
    await seedClosureSources(query);
    let approval = await seedClosureApproval(query, authority);
    let closed;
    await t.test('native pg.Result write and independent readback do not deadlock max:1', async () => {
      const before = (await query('SELECT to_jsonb(d) AS row FROM public.event_dead_letters d')).rows;
      closed = await executeDeadLetterClosure({ pool, ...authority, approvalId: approval.approvalId });
      assert.equal(closed.verified, true, JSON.stringify(closed)); assert.equal(closed.counts.closedInternal, 1);
      assert.equal((await verifyDeadLetterClosureReference({ pool, ...authority, reference: closed.reference })).verified, true);
      assert.deepEqual((await query('SELECT to_jsonb(d) AS row FROM public.event_dead_letters d')).rows, before);
      assert.deepEqual((await query('SELECT payload FROM public.provider_action_dispatches')).rows, [{ payload: { state: 'unknown' } }]);
    });
    await t.test('two-client source change after snapshot aborts admission without retry', async () => {
      const before = await ledgerRows();
      const next = await seedClosureApproval(query, authority, { id: 'source-race', predecessor: closureHead(authority, before.at(-1)) });
      let changed = false;
      const racing = wrappedPool(pool, async command => {
        if (!changed && command.text.includes('FROM public.event_dead_letters d') && command.text.includes('FOR SHARE')) {
          changed = true;
          await other.query("UPDATE public.event_dead_letters SET error='concurrent source change'");
        }
      });
      const r = await executeDeadLetterClosure({ pool: racing, ...authority, approvalId: next.approvalId });
      assert.equal(changed, true); assert.equal(r.ok, false); assert.equal(r.counts, null);
      assert.deepEqual(await ledgerRows(), before);
      await query("UPDATE public.event_dead_letters SET error='original failure'");
    });
    await t.test('two-client canonical approval change before FOR UPDATE blocks admission', async () => {
      const before = await ledgerRows();
      const next = await seedClosureApproval(query, authority, { id: 'approval-race', predecessor: closureHead(authority, before.at(-1)) });
      let changed = false;
      const racing = wrappedPool(pool, async command => {
        if (!changed && command.text.includes('FROM public.approvals a') && command.text.includes('FOR UPDATE')) {
          changed = true; await other.query("UPDATE public.approvals SET status='denied' WHERE id=$1", [next.approvalId]);
        }
      });
      const r = await executeDeadLetterClosure({ pool: racing, ...authority, approvalId: next.approvalId });
      assert.equal(changed, true); assert.equal(r.ok, false); assert.deepEqual(await ledgerRows(), before);
    });
    await t.test('two-client same/different intent races cannot branch one predecessor or retry', async () => {
      for (const mode of ['same', 'different']) {
        const before = await ledgerRows();
        approval = await seedClosureApproval(query, authority,
          { id: `ledger-race-${mode}`, predecessor: closureHead(authority, before.at(-1)) });
        const competitor = mode === 'same' ? approval : await seedClosureApproval(query, authority,
          { id: 'ledger-race-competitor', predecessor: closureHead(authority, before.at(-1)) });
        let arrived; const atLock = new Promise(resolve => { arrived = resolve; });
        let startedSecond; const secondStarted = new Promise(resolve => { startedSecond = resolve; });
        let firstInsert = true; let secondLock = true;
        const firstPool = wrappedPool(pool, async command => {
          if (firstInsert && command.text.startsWith('INSERT INTO public.pbk_dead_letter_closure_ledger')) {
            firstInsert = false; arrived(); await secondStarted;
          }
        });
        const secondPool = wrappedPool(other, async command => {
          if (secondLock && command.text.includes('pg_advisory_xact_lock')) { secondLock = false; startedSecond(); }
        });
        const first = executeDeadLetterClosure({ pool: firstPool, ...authority, approvalId: approval.approvalId });
        await Promise.race([atLock, first.then(r => { throw new Error(`Native race did not reach insert: ${r.result}`); })]);
        const second = executeDeadLetterClosure({ pool: secondPool, ...authority, approvalId: competitor.approvalId });
        const results = await Promise.all([first, second]);
        assert.equal(results.filter(r => r.verified).length, 1, JSON.stringify(results));
        const after = await ledgerRows(); assert.equal(after.length, before.length + 1);
        assert.deepEqual(after.slice(0, before.length), before);
      }
    });
    await t.test('native revoke needs new approval, missing QA/memory does not prevent withdrawal', async () => {
      const before = await ledgerRows();
      approval = await seedClosureApproval(query, authority, { id: 'revoke-native', action: 'revoke_internal',
        predecessor: closureHead(authority, before.at(-1)), manifest: approval.manifest });
      await query('DELETE FROM public.call_embeddings'); await query('DELETE FROM public.pbk_call_qa_scores');
      const r = await executeDeadLetterClosure({ pool, ...authority, approvalId: approval.approvalId });
      assert.equal(r.verified, true, JSON.stringify(r)); assert.equal(r.counts.invalidated, 1);
      assert.equal((await readDeadLetterClosures({ pool, ...authority })).counts.closedInternal, 0);
      assert.equal((await verifyDeadLetterClosureReference({ pool, ...authority, reference: closed.reference })).ok, false);
      assert.deepEqual((await ledgerRows()).slice(0, before.length), before);
    });
    await t.test('native lost original denies usable summary and frozen reference', async () => {
      await query('DELETE FROM public.event_dead_letters');
      assert.equal((await readDeadLetterClosures({ pool, ...authority })).counts, null);
      assert.equal((await verifyDeadLetterClosureReference({ pool, ...authority, reference: closed.reference })).ok, false);
    });
  } finally {
    await pool.end(); await other.end();
    if (sourcesCreated) {
      await query(`DROP TABLE public.provider_action_dispatches,public.approvals,public.pbk_eval_runs,
        public.call_embeddings,public.pbk_call_qa_scores,public.calls,public.event_dead_letters`);
    }
  }
}
