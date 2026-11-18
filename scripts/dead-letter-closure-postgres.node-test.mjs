import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {
  validateClosureMigrationConfig, applyDeadLetterClosureMigration, verifyDeadLetterClosureInstallation,
} from './dead-letter-closure-migration.mjs';

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

test('guarded real Postgres schema installation (not PGlite; replica/concurrency proof belongs to Task 7)', {
  skip: Object.hasOwn(process.env, 'PBK_CLOSURE_PG_TEST_ENABLE') ? false
    : 'Real PostgreSQL unavailable/not opted in; no replica or concurrent-transaction proof claimed',
  timeout: 60000,
}, async () => {
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
