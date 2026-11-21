import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { withRetentionPostgres } from './fixtures/recording-retention-postgres.mjs';

const migration = '20261120016000_pbk_recording_retention_approvals.sql';
const roles = ['anon', 'authenticated', 'service_role'];
const tables = ['pbk_recording_retention_approvals', 'pbk_recording_retention_attempts', 'pbk_recording_storage_writes'];
const functions = ['protect_recording_retention_pointer', 'protect_recording_retention_truncate'];

async function assertRecorded(pool) {
  const sql = await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8');
  const { rows } = await pool.query(`SELECT checksum_sha256, migration_target
    FROM public.pbk_schema_migrations WHERE migration_name = $1`, [migration]);
  assert.deepEqual(rows, [{ checksum_sha256: createHash('sha256').update(sql).digest('hex'), migration_target: 'local' }]);
}

async function assertPrivileges(pool, role, expectedReads) {
  const { rows } = await pool.query(`SELECT name,
    has_table_privilege($1, 'public.' || name, 'SELECT') AS can_read,
    has_table_privilege($1, 'public.' || name, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN') AS can_other
    FROM unnest($2::text[]) AS t(name)`, [role, tables]);
  assert.deepEqual(rows, tables.map(name => ({ name, can_read: expectedReads.includes(name), can_other: false })), role);

  const { rows: execute } = await pool.query(`SELECT name,
    has_function_privilege($1, 'public.' || name || '()', 'EXECUTE') AS can_execute
    FROM unnest($2::text[]) AS f(name)`, [role, functions]);
  assert.deepEqual(execute, functions.map(name => ({ name, can_execute: false })), role);
}

test('the real runner applies recording retention with no Supabase roles and revokes PUBLIC', async () => {
  await withRetentionPostgres(async ({ pool, applyRecordingPrerequisites, applyRecordingMigration }) => {
    const { rows } = await pool.query('SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])', [roles]);
    assert.deepEqual(rows, []);
    await applyRecordingPrerequisites();
    await pool.query(`CREATE ROLE fixture_reader NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC;`);

    await applyRecordingMigration();
    await assertRecorded(pool);
    await assertPrivileges(pool, 'fixture_reader', []);
  }, { supabaseRoles: false });
});

test('the real runner rolls schema back on a bookkeeping failure and preserves Supabase privileges on retry', async () => {
  await withRetentionPostgres(async ({ pool, applyRecordingPrerequisites, applyRecordingMigration }) => {
    await applyRecordingPrerequisites();
    await pool.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
      ALTER TABLE public.pbk_schema_migrations ADD CONSTRAINT fixture_reject_retention_checksum
        CHECK (migration_name <> '${migration}');`);

    await assert.rejects(applyRecordingMigration, error => {
      assert.match(error.stderr, /failed 20261120016000_pbk_recording_retention_approvals\.sql:.*fixture_reject_retention_checksum/);
      return true;
    });
    const { rows } = await pool.query(`SELECT
      EXISTS (SELECT 1 FROM unnest($1::text[]) AS t(name) WHERE to_regclass('public.' || name) IS NOT NULL) AS retention_tables,
      EXISTS (SELECT 1 FROM unnest($2::text[]) AS f(name) WHERE to_regprocedure('public.' || name || '()') IS NOT NULL) AS retention_functions,
      EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.unified_messages'::regclass
        AND tgname = ANY($2::text[])) AS retention_triggers,
      EXISTS (SELECT 1 FROM public.pbk_schema_migrations WHERE migration_name = $3) AS migration_recorded`,
    [tables, functions, migration]);
    assert.deepEqual(rows, [{
      retention_tables: false, retention_functions: false, retention_triggers: false, migration_recorded: false,
    }]);

    await pool.query('ALTER TABLE public.pbk_schema_migrations DROP CONSTRAINT fixture_reject_retention_checksum');
    await applyRecordingMigration();
    await assertRecorded(pool);
    for (const role of roles) {
      await assertPrivileges(pool, role, role === 'service_role' ? tables.slice(1) : []);
    }
    const { stdout } = await applyRecordingMigration();
    assert.ok(stdout.includes(`skip ${migration}`));
  });
});
