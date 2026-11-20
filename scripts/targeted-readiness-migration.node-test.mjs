import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const moduleUrl = new URL('./targeted-readiness-migration.mjs', import.meta.url);
const legacyTables = [
  'activity_log', 'approvals', 'bridge_state', 'calls', 'contracts', 'lead_imports',
  'lead_profiles', 'pbk_feedback', 'pbk_intent_events', 'pbk_knowledge', 'pbk_memories',
];
const allTables = [...legacyTables, 'unified_messages'];
const identity = { expectedDatabase: 'postgres', expectedRole: 'pbk_owner' };
const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

async function implementation() {
  assert.ok(existsSync(moduleUrl), 'explicit targeted migration module must exist');
  return import(moduleUrl.href);
}

async function fixture(t, { messages = false } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE pbk_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE unrelated NOLOGIN NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE, CREATE ON SCHEMA public TO pbk_owner;
    SET ROLE pbk_owner;
  `);
  // Use the real contracts, excluding optional extensions unsupported by PGlite.
  await db.exec(read('20260430001000_pbk_operational_schema.sql')
    .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  await db.exec(read('20260430000000_pbk_bridge_state.sql'));
  await db.exec(read('20260503010000_pbk_activity_log.sql'));
  await db.exec(read('20260506000000_pbk_hyper_intelligence.sql')
    .split('DELETE FROM public.pbk_knowledge')[0]
    .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '')
    .replace(/DO \$\$[\s\S]*?END \$\$;/, ''));
  if (!messages) await db.exec('DROP TABLE public.unified_messages');
  await db.exec(`
    INSERT INTO public.lead_profiles (id) VALUES ('fixture-lead');
    INSERT INTO public.approvals (id, status, payload)
      VALUES ('fixture-approval', 'pending', '{"requiresApproval":true}');
    INSERT INTO public.bridge_state (id, data) VALUES ('pbk',
      '{"approvals":[{"id":"original","status":"pending"}],"dispatches":[{"status":"delivery_unknown","locked":true}]}');
    INSERT INTO public.calls (id, status) VALUES ('fixture-call', 'delivery_unknown');
  `);
  return {
    db,
    client: { async query(sql, params) {
      if (params?.length) return db.query(sql, params);
      const results = await db.exec(sql);
      return results.at(-1);
    } },
  };
}

async function snapshot(db, tables = legacyTables) {
  const result = {};
  for (const table of tables) {
    result[table] = (await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows;
  }
  return result;
}

test('restores full/base bridge SQL, learning fields, indexes and timestamp behavior; repeats without data writes', async (t) => {
  const { applyTargetedReadinessMigration } = await implementation();
  const { db, client } = await fixture(t);
  const before = await snapshot(db);
  await applyTargetedReadinessMigration(client, identity);
  assert.deepEqual(await snapshot(db), before);

  // Execute the actual bridge SQL without importing/starting the bridge.
  const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const functionSource = bridge.slice(bridge.indexOf('async function persistUnifiedMessageRecord('));
  const base = ['fixture-message', 'fixture-lead', 'pbk', 'call', 'recording', 'recorded',
    'fixture', '', '', '', '', '', '', '', 0, '{}', '2026-01-01', '2026-01-01'];
  for (const name of ['fullSql', 'baseSql']) {
    const sql = functionSource.match(new RegExp(`const ${name} = \x60([\\s\\S]*?)\x60;`))?.[1];
    assert.ok(sql, `actual bridge ${name} found`);
    await db.query(sql, name === 'fullSql' ? [...base, 'fixture/audio', 'private', 'audio/wav', 12, ''] : base);
  }
  await db.exec(`UPDATE public.unified_messages SET processed_for_learning = true,
    learning_processed_at = NOW(), learning_session_id = 'fixture-session', learning_metadata = '{"fixture":true}',
    updated_at = '2000-01-01' WHERE id = 'fixture-message'`);
  const row = (await db.query('SELECT * FROM public.unified_messages')).rows[0];
  assert.equal(row.processed_for_learning, true);
  assert.equal(row.storage_path, 'fixture/audio');
  assert.equal(row.learning_metadata.fixture, true);
  assert.ok(new Date(row.updated_at).getUTCFullYear() >= 2026);
  const indexNames = (await db.query(`SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'unified_messages'`)).rows.map((r) => r.indexname);
  for (const name of ['unified_messages_pkey', 'unified_messages_lead_created_idx',
    'unified_messages_channel_status_idx', 'unified_messages_payload_gin_idx',
    'unified_messages_recordings_idx', 'unified_messages_learning_idx']) assert.ok(indexNames.includes(name), name);
  const completeBefore = await snapshot(db, allTables);
  await applyTargetedReadinessMigration(client, identity);
  assert.deepEqual(await snapshot(db, allTables), completeBefore);
  const flags = (await db.query(`SELECT relname, relrowsecurity, relforcerowsecurity,
    pg_get_userbyid(relowner) AS owner FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`, [allTables])).rows;
  assert.equal(flags.length, 12);
  for (const flag of flags) {
    assert.equal(flag.relrowsecurity, true, flag.relname);
    assert.equal(flag.relforcerowsecurity, false, flag.relname);
    assert.equal(flag.owner, 'pbk_owner');
  }
  assert.equal((await db.query('SELECT * FROM pg_policies WHERE schemaname = \'public\'')).rows.length, 0);
});

test('upgrades existing base messages without modifying original dispatch and approval snapshots', async (t) => {
  const { applyTargetedReadinessMigration } = await implementation();
  const { db, client } = await fixture(t, { messages: true });
  await db.exec(`INSERT INTO public.unified_messages (id, status, payload) VALUES
    ('unknown', 'delivery_unknown', '{"schedulerDispatchStartedAt":"2026-01-01","approvalId":"original"}'),
    ('pending', 'scheduled', '{"requiresApproval":true,"approvalStatus":"pending"}')`);
  const before = await snapshot(db);
  const originalMessages = (await db.query('SELECT id, status, payload, created_at, updated_at FROM public.unified_messages ORDER BY id')).rows;
  await applyTargetedReadinessMigration(client, identity);
  assert.deepEqual(await snapshot(db), before);
  assert.deepEqual((await db.query('SELECT id, status, payload, created_at, updated_at FROM public.unified_messages ORDER BY id')).rows, originalMessages);
  assert.deepEqual((await db.query('SELECT DISTINCT processed_for_learning FROM public.unified_messages')).rows, [{ processed_for_learning: false }]);
});

test('owner retains PBK and other-tenant access; unprivileged roles cannot read or write either tenant', async (t) => {
  const { applyTargetedReadinessMigration } = await implementation();
  const { db, client } = await fixture(t);
  await db.exec(`INSERT INTO public.lead_profiles (id, workspace_id) VALUES ('other-lead', 'other');
    INSERT INTO public.pbk_memories (id, tenant_id) VALUES ('pbk-memory', 'pbk'), ('other-memory', 'other')`);
  await applyTargetedReadinessMigration(client, identity);
  assert.equal((await db.query('SELECT * FROM public.lead_profiles')).rows.length, 2);
  for (const role of ['anon', 'authenticated', 'unrelated']) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    for (const table of allTables) {
      await assert.rejects(db.query(`SELECT * FROM public.${table}`), /permission denied/);
      await assert.rejects(db.query(`INSERT INTO public.${table} (id) VALUES ('denied')`), /permission denied/);
    }
    await db.exec('RESET ROLE; SET ROLE pbk_owner');
  }
  // Test-only grants exercise RLS itself, independent of the absence of ACLs.
  await db.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO unrelated; RESET ROLE; SET ROLE unrelated');
  for (const table of allTables) {
    assert.deepEqual((await db.query(`SELECT * FROM public.${table}`)).rows, []);
    assert.equal((await db.query(`UPDATE public.${table} SET id = id RETURNING id`)).rows.length, 0);
    assert.equal((await db.query(`DELETE FROM public.${table} RETURNING id`)).rows.length, 0);
  }
  for (const tenant of ['pbk', 'other']) {
    await assert.rejects(db.query('INSERT INTO public.unified_messages (id, workspace_id) VALUES ($1, $2)', [`denied-${tenant}`, tenant]), /row-level security/);
    await assert.rejects(db.query('INSERT INTO public.pbk_memories (id, tenant_id) VALUES ($1, $2)', [`denied-${tenant}`, tenant]), /row-level security/);
  }
  await db.exec('RESET ROLE; SET ROLE pbk_owner');
  assert.equal((await db.query('SELECT * FROM public.pbk_memories')).rows.length, 2);
});

for (const [name, damage, reason] of [
  ['missing legacy table', 'DROP TABLE public.pbk_feedback', /missing.*pbk_feedback/i],
  ['missing tenant column', 'ALTER TABLE public.pbk_memories DROP COLUMN tenant_id CASCADE', /tenant_id/i],
  ['wrong tenant type', 'ALTER TABLE public.lead_imports ALTER COLUMN workspace_id TYPE varchar', /workspace_id/i],
  ['nullable tenant', 'ALTER TABLE public.calls ALTER COLUMN workspace_id DROP NOT NULL', /workspace_id/i],
  ['unexpected policy', 'CREATE POLICY unsafe ON public.approvals USING (true)', /polic/i],
  ['browser grant', 'GRANT SELECT ON public.approvals TO anon', /grant|privilege/i],
  ['column grant', 'GRANT SELECT (payload) ON public.approvals TO authenticated', /grant|privilege/i],
  ['PUBLIC grant', 'GRANT SELECT ON public.bridge_state TO PUBLIC', /grant|privilege/i],
  ['other owner', 'RESET ROLE; ALTER TABLE public.calls OWNER TO unrelated; SET ROLE pbk_owner', /owner/i],
  ['forced RLS', 'ALTER TABLE public.calls FORCE ROW LEVEL SECURITY', /force/i],
  ['missing update helper', 'DROP FUNCTION public.pbk_set_updated_at() CASCADE', /pbk_set_updated_at/i],
  ['default browser grant on restored table', 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon', /grant|privilege/i],
  ['browser owner membership', 'RESET ROLE; GRANT pbk_owner TO anon; SET ROLE pbk_owner', /role|owner/i],
  ['owner missing required UPDATE', 'REVOKE UPDATE ON public.approvals FROM pbk_owner', /owner.*privilege|owner.*write/i],
  ['owner default missing required UPDATE', 'ALTER DEFAULT PRIVILEGES REVOKE UPDATE ON TABLES FROM pbk_owner', /owner.*privilege|owner.*write/i],
]) {
  test(`fails closed atomically on ${name}`, async (t) => {
    const { applyTargetedReadinessMigration } = await implementation();
    const { db, client } = await fixture(t);
    await db.exec(damage);
    await assert.rejects(applyTargetedReadinessMigration(client, identity), reason);
    assert.equal((await db.query("SELECT to_regclass('public.unified_messages') AS relation")).rows[0].relation, null);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.approvals'::regclass")).rows[0].relrowsecurity, false);
    assert.equal((await db.query('SELECT status FROM public.approvals')).rows[0].status, 'pending');
  });
}

for (const [name, damage] of [
  ['missing base column', 'ALTER TABLE public.unified_messages DROP COLUMN body'],
  ['wrong recording type', 'ALTER TABLE public.unified_messages ADD COLUMN duration_seconds text'],
  ['wrong learning nullability', 'ALTER TABLE public.unified_messages ADD COLUMN processed_for_learning boolean'],
  ['false learning default', 'ALTER TABLE public.unified_messages ADD COLUMN processed_for_learning boolean NOT NULL DEFAULT true'],
  ['wrong workspace default', "ALTER TABLE public.unified_messages ALTER COLUMN workspace_id SET DEFAULT 'other'"],
  ['wrong named index', 'DROP INDEX public.unified_messages_lead_created_idx; CREATE INDEX unified_messages_lead_created_idx ON public.unified_messages (body)'],
  ['disabled update trigger', 'ALTER TABLE public.unified_messages DISABLE TRIGGER unified_messages_set_updated_at'],
  ['missing lead foreign key', 'ALTER TABLE public.unified_messages DROP CONSTRAINT unified_messages_lead_id_fkey'],
  ['destructive lead foreign key', 'ALTER TABLE public.unified_messages DROP CONSTRAINT unified_messages_lead_id_fkey; ALTER TABLE public.unified_messages ADD FOREIGN KEY (lead_id) REFERENCES public.lead_profiles(id) ON DELETE CASCADE'],
]) {
  test(`rejects incompatible partial messages: ${name}`, async (t) => {
    const { applyTargetedReadinessMigration } = await implementation();
    const { db, client } = await fixture(t, { messages: true });
    await db.exec(damage);
    await assert.rejects(applyTargetedReadinessMigration(client, identity), /unified_messages/i);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.approvals'::regclass")).rows[0].relrowsecurity, false);
  });
}

test('raw SQL fails outside the explicit runner transaction context', async (t) => {
  await implementation();
  const { db } = await fixture(t);
  const sql = readFileSync(new URL('./migrations/20261116-targeted-readiness.sql', import.meta.url), 'utf8');
  await assert.rejects(db.exec(sql), /runner|context/i);
  assert.equal((await db.query("SELECT to_regclass('public.unified_messages') AS relation")).rows[0].relation, null);
});

test('refuses wrong connected database or role before any DDL', async (t) => {
  const { applyTargetedReadinessMigration } = await implementation();
  const { db, client } = await fixture(t);
  for (const expected of [{ ...identity, expectedDatabase: 'different' }, { ...identity, expectedRole: 'different' }, {}]) {
    await assert.rejects(applyTargetedReadinessMigration(client, expected), /identity|database|role/i);
  }
  assert.equal((await db.query("SELECT to_regclass('public.unified_messages') AS relation")).rows[0].relation, null);
});

const explicitEnv = {
  PBK_TARGETED_MIGRATION_DATABASE_URL: 'postgresql://pbk_owner@dpg-fixture.render.com/pbk_fixture',
  PBK_TARGETED_MIGRATION_TARGET: 'render',
  PBK_TARGETED_MIGRATION_EXPECT_HOST: 'dpg-fixture.render.com',
  PBK_TARGETED_MIGRATION_EXPECT_DATABASE: 'pbk_fixture',
  PBK_TARGETED_MIGRATION_EXPECT_ROLE: 'pbk_owner',
};

test('dedicated runner defaults to offline dry run and ignores ambient runtime URLs/apply flags', async () => {
  await implementation();
  const result = spawnSync(process.execPath, [fileURLToPath(moduleUrl)], {
    encoding: 'utf8', env: {
      PATH: process.env.PATH, ...explicitEnv,
      DATABASE_URL: 'not-a-url', PBK_DATABASE_URL: 'not-a-url', PBK_MIGRATION_APPLY: 'true',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.database, 'pbk_fixture');
  assert.equal(plan.migrations.length, 1);
  assert.match(plan.migrations[0].sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(result.stdout, /postgresql:|connected/);
});

test('runner rejects ambiguous targets, URL overrides, ambient-only config and unconfirmed apply offline', async () => {
  const { validateTargetedMigrationConfig } = await implementation();
  for (const env of [
    { DATABASE_URL: explicitEnv.PBK_TARGETED_MIGRATION_DATABASE_URL },
    { ...explicitEnv, PBK_TARGETED_MIGRATION_EXPECT_DATABASE: 'different' },
    { ...explicitEnv, PBK_TARGETED_MIGRATION_EXPECT_ROLE: 'different' },
    { ...explicitEnv, PBK_TARGETED_MIGRATION_EXPECT_HOST: 'different' },
    { ...explicitEnv, PBK_TARGETED_MIGRATION_TARGET: 'supabase' },
    { ...explicitEnv, PBK_TARGETED_MIGRATION_DATABASE_URL: `${explicitEnv.PBK_TARGETED_MIGRATION_DATABASE_URL}?host=elsewhere` },
    { ...explicitEnv, PBK_TARGETED_MIGRATION_DATABASE_URL: 'https://dpg-fixture.render.com/pbk_fixture' },
    { ...explicitEnv, PBK_TARGETED_MIGRATION_DATABASE_URL: 'postgresql://pbk_owner@dpg-fixture.evil/pbk_fixture', PBK_TARGETED_MIGRATION_EXPECT_HOST: 'dpg-fixture.evil' },
    { ...explicitEnv, PBK_TARGETED_MIGRATION_DATABASE_URL: 'postgresql://pbk_owner@dpg-fixture.render.com:0/pbk_fixture' },
  ]) assert.throws(() => validateTargetedMigrationConfig(env), /migration|target|host|database|role|URL/i);
  const result = spawnSync(process.execPath, [fileURLToPath(moduleUrl), '--apply'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...explicitEnv },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum|confirm/i);
});
