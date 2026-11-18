import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, beforeEach, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import {
  validateClosureMigrationConfig, applyDeadLetterClosureMigration,
  verifyDeadLetterClosureInstallation, DEAD_LETTER_CLOSURE_SQL, DEAD_LETTER_CLOSURE_SHA256,
} from './dead-letter-closure-migration.mjs';
import { makeClosureFixture } from './fixtures/dead-letter-closure-fixture.mjs';
import { closureBinding, createClosureIntent, projectClosureApproval, signClosureReceipt, verifyClosureReceipt } from './dead-letter-closure-protocol.mjs';

const table = 'public.pbk_dead_letter_closure_ledger';
const sequence = 'public.pbk_dead_letter_closure_ledger_ordinal_seq';
const fn = 'public.pbk_closure_reject_mutation()';
const identity = { expectedDatabase: 'postgres', expectedRole: 'closure_owner' };
const env = {
  PBK_CLOSURE_MIGRATION_TARGET: 'local', PBK_CLOSURE_MIGRATION_EXPECT_HOST: '127.0.0.1',
  PBK_CLOSURE_MIGRATION_EXPECT_DATABASE: 'closure_fixture', PBK_CLOSURE_MIGRATION_EXPECT_ROLE: 'closure_owner',
  PBK_CLOSURE_MIGRATION_DATABASE_URL: 'postgres://closure_owner:fixture-only@127.0.0.1/closure_fixture',
};
let db;
const query = (sql, values) => db.query(sql, values);
const client = { query: async (sql, values) => values ? query(sql, values) : (await db.exec(sql)).at(-1) };
const verify = () => verifyDeadLetterClosureInstallation(query);
const sourceSnapshot = () => query(`SELECT c.relname,c.relacl::text,
  (SELECT jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.attnotnull)) FROM pg_attribute a
    WHERE a.attrelid=c.oid AND a.attnum>0) AS columns,
  (SELECT jsonb_agg(pg_get_constraintdef(k.oid)) FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
  (SELECT jsonb_agg(pg_get_triggerdef(t.oid)) FROM pg_trigger t WHERE t.tgrelid=c.oid) AS triggers
  FROM pg_class c WHERE c.oid='public.closure_source_fixture'::regclass`);

async function insertFixture(changes = {}, reportChanges = {}) {
  const f = makeClosureFixture();
  await db.exec('BEGIN');
  try {
    const allocation = (await query(`SELECT nextval($1::regclass)::text AS ordinal,
      pg_current_xact_id()::text AS xid,
      to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted`, [sequence])).rows[0];
    const observedAt = `${allocation.admitted.slice(0, 23)}Z`;
    const observedMs = Date.parse(observedAt);
    f.manifest.steps.slice(0, 2).forEach((step, i) => { step.executedAt = new Date(observedMs - 20000 + i).toISOString(); });
    const intent = createClosureIntent({ approvalId: f.approvalId, action: f.intent.action, recordRef: f.report.recordRef,
      manifest: f.manifest, predecessor: f.report.predecessor, revision: f.revision, createdAt: observedAt, secret: f.secret });
    f.approval.payload.metadata.deadLetterClosureIntent = intent;
    const report = { ...f.report, ordinal: allocation.ordinal, insertXid: allocation.xid,
      admittedAt: allocation.admitted, observedAt, completedAt: new Date(observedMs + 1000).toISOString(),
      approvalExpiresAt: intent.expiresAt, intent, manifest: f.manifest, manifestBinding: intent.manifestBinding,
      intentBinding: closureBinding(f.secret, 'intent', intent),
      decisionBinding: closureBinding(f.secret, 'approval-decision', projectClosureApproval(f.approval)), ...reportChanges };
    report.attestation = { version: report.schemaVersion, signature: signClosureReceipt({ report, secret: f.secret }) };
    const row = { ...f.row, ordinal: allocation.ordinal, admitted_at: allocation.admitted,
      insert_xid: allocation.xid, intent_binding: report.intentBinding, report, ...changes };
    await query(`INSERT INTO ${table} (id,tenant_id,ordinal,admitted_at,insert_xid,record_ref,
      approval_ref,intent_binding,action,previous_id,report) OVERRIDING SYSTEM VALUE
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, Object.values(row));
    await db.exec('COMMIT');
    return { ...f, row, report, now: Date.parse(report.completedAt) };
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE closure_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE unrelated NOLOGIN NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE,CREATE ON SCHEMA public TO closure_owner;
    SET ROLE closure_owner;
    CREATE TABLE public.closure_source_fixture(id text PRIMARY KEY,payload jsonb);
    INSERT INTO public.closure_source_fixture VALUES ('original','{"locked":true}');`);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`RESET ROLE;
    DROP TABLE IF EXISTS ${table} CASCADE;
    DROP FUNCTION IF EXISTS ${fn} CASCADE;
    SET ROLE closure_owner;`);
});

test('migration refuses wrong target and ambient URLs without revealing credentials', () => {
  assert.throws(() => validateClosureMigrationConfig({ DATABASE_URL: env.PBK_CLOSURE_MIGRATION_DATABASE_URL }), /PBK_CLOSURE_MIGRATION/);
  assert.equal(validateClosureMigrationConfig(env).expectedRole, 'closure_owner');
  for (const change of [
    { PBK_CLOSURE_MIGRATION_TARGET: 'production' }, { PBK_CLOSURE_MIGRATION_EXPECT_HOST: 'remote.invalid' },
    { PBK_CLOSURE_MIGRATION_EXPECT_DATABASE: 'wrong' }, { PBK_CLOSURE_MIGRATION_EXPECT_ROLE: 'wrong' },
    { PBK_CLOSURE_MIGRATION_DATABASE_URL: `${env.PBK_CLOSURE_MIGRATION_DATABASE_URL}?host=remote.invalid` },
    { PBK_CLOSURE_MIGRATION_DATABASE_URL: 'not-a-url' },
  ]) assert.throws(() => validateClosureMigrationConfig({ ...env, ...change }), /closure|Closure/);
});

test.each(['anon', 'authenticated'])('browser role %s cannot be selected as trusted owner', async role => {
  assert.throws(() => validateClosureMigrationConfig({ ...env, PBK_CLOSURE_MIGRATION_EXPECT_ROLE: role,
    PBK_CLOSURE_MIGRATION_DATABASE_URL: env.PBK_CLOSURE_MIGRATION_DATABASE_URL.replace('closure_owner:', `${role}:`) }), /role|owner/);
  await assert.rejects(applyDeadLetterClosureMigration(client, { ...identity, expectedRole: role }), /role|owner/);
});

test('CLI defaults to dry-run without connecting; apply requires reviewed SQL SHA256', () => {
  const modulePath = fileURLToPath(new URL('./dead-letter-closure-migration.mjs', import.meta.url));
  const run = args => spawnSync(process.execPath, [modulePath, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const dry = run([]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).mode, 'dry-run');
  assert.equal(JSON.parse(dry.stdout).sha256, DEAD_LETTER_CLOSURE_SHA256);
  for (const args of [['--apply'], ['--apply', `--confirm-sha256=${'0'.repeat(64)}`], ['--unknown']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert(!result.stderr.includes('fixture-only'));
  }
});

test('wrong connected identity and missing xid/snapshot functions fail before any schema DDL', async () => {
  for (const change of [{ expectedDatabase: 'wrong' }, { expectedRole: 'wrong' }]) {
    await assert.rejects(applyDeadLetterClosureMigration(client, { ...identity, ...change }), /identity/);
    assert.equal((await query('SELECT to_regclass($1) AS object', [table])).rows[0].object, null);
  }
  for (const missing of ['pg_current_xact_id()', 'pg_current_snapshot()', 'pg_visible_in_snapshot(xid8,pg_snapshot)']) {
    const boundedQuery = async (sql, values) => {
      // Preserve real SQL evaluation; substitute one absent signature at a time.
      const name = missing.split('(')[0];
      return client.query(sql.includes('AS closure_capabilities') ? sql.replaceAll(`pg_catalog.${name}(`, 'pg_catalog.closure_missing_capability(') : sql, values);
    };
    await assert.rejects(applyDeadLetterClosureMigration({ query: boundedQuery }, identity), /capabilit/);
    assert.equal((await query('SELECT to_regclass($1) AS object', [table])).rows[0].object, null, missing);
  }
});

test('repeat apply preserves rows and source schema; read-only verifier returns verified sequence', async () => {
  const before = await sourceSnapshot();
  assert.equal((await applyDeadLetterClosureMigration(client, identity)).ok, true);
  const f = await insertFixture();
  const beforeRows = (await query(`SELECT to_jsonb(t) AS row FROM ${table} t`)).rows;
  assert.equal((await applyDeadLetterClosureMigration(client, identity)).ok, true);
  assert.deepEqual((await query(`SELECT to_jsonb(t) AS row FROM ${table} t`)).rows, beforeRows);
  assert.deepEqual(await sourceSnapshot(), before);
  assert.deepEqual((await query('SELECT payload FROM public.closure_source_fixture')).rows, [{ payload: { locked: true } }]);
  const statements = [];
  const result = await verifyDeadLetterClosureInstallation(async (sql, values) => {
    statements.push(sql); return query(sql, values);
  });
  assert.equal(result.ok, true);
  assert.equal(result.identitySequence, sequence);
  assert.equal(result.ownerDdlTrusted, true);
  assert(statements.every(sql => /^\s*SELECT\b/.test(sql)), 'verifier must not write or own a transaction');
  const row = (await query(`SELECT id,tenant_id,ordinal::text,
    to_char(admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted_at,
    insert_xid::text,record_ref,approval_ref,intent_binding,action,previous_id,report FROM ${table}`)).rows[0];
  assert.equal(verifyClosureReceipt({ row, secret: f.secret, revision: f.revision, now: f.now }).ok, true);
});

test.each(['origin', 'replica'])('immutable in %s mode rejects UPDATE DELETE TRUNCATE, even empty statements (PGlite only)', async mode => {
  await applyDeadLetterClosureMigration(client, identity);
  await insertFixture();
  await db.exec(`RESET ROLE; SET session_replication_role=${mode}; SET ROLE closure_owner`);
  try {
    for (const sql of [`UPDATE ${table} SET id=id`, `DELETE FROM ${table}`, `TRUNCATE ${table}`,
      `UPDATE ${table} SET id=id WHERE false`, `DELETE FROM ${table} WHERE false`]) {
      await assert.rejects(query(sql), /immutable/);
    }
    assert.equal((await query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 1);
  } finally { await db.exec('RESET ROLE; SET session_replication_role=origin; SET ROLE closure_owner'); }
});

test('browser roles denied actual table column sequence and function privileges; RLS denies accidental DML grants', async () => {
  await applyDeadLetterClosureMigration(client, identity);
  await insertFixture();
  for (const role of ['anon', 'authenticated', 'unrelated']) {
    const privileges = (await query(`SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS tab,
      has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') AS col,
      has_sequence_privilege($1,$3,'USAGE,SELECT,UPDATE') AS seq,
      has_function_privilege($1,$4,'EXECUTE') AS fn`, [role, table, sequence, fn])).rows[0];
    assert.deepEqual(privileges, { tab: false, col: false, seq: false, fn: false });
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    for (const sql of [`SELECT * FROM ${table}`, `SELECT id FROM ${table}`, `DELETE FROM ${table}`,
      `UPDATE ${table} SET id=id`, `TRUNCATE ${table}`, `SELECT nextval('${sequence}')`, `SELECT ${fn}`]) {
      await assert.rejects(query(sql), /permission denied/);
    }
    await db.exec('RESET ROLE; SET ROLE closure_owner');
  }
  await db.exec(`GRANT SELECT,INSERT ON ${table} TO unrelated; RESET ROLE; SET ROLE unrelated`);
  assert.deepEqual((await query(`SELECT * FROM ${table}`)).rows, []);
  await assert.rejects(query(`INSERT INTO ${table}(id) VALUES ('denied')`), /row-level security/);
  await db.exec('RESET ROLE; SET ROLE closure_owner');
  assert.equal((await verify()).ok, false, 'extra grants invalidate installation');
});

test.each([
  ['missing trigger', `DROP TRIGGER pbk_closure_immutable ON ${table}`],
  ['trigger origin only', `ALTER TABLE ${table} ENABLE TRIGGER pbk_closure_immutable`],
  ['RLS off', `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`],
  ['forced RLS', `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`],
  ['extra policy', `CREATE POLICY unsafe ON ${table} USING (true)`],
  ['table grant', `GRANT SELECT ON ${table} TO anon`],
  ['PUBLIC grant', `GRANT SELECT ON ${table} TO PUBLIC`],
  ['column grant', `GRANT SELECT(id) ON ${table} TO authenticated`],
  ['sequence grant', `GRANT USAGE ON SEQUENCE ${sequence} TO unrelated`],
  ['function grant', `GRANT EXECUTE ON FUNCTION ${fn} TO PUBLIC`],
  ['function body', `CREATE OR REPLACE FUNCTION ${fn} RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN RETURN NULL; END $$`],
  ['function security', `ALTER FUNCTION ${fn} SECURITY DEFINER`],
  ['function search path', `ALTER FUNCTION ${fn} RESET search_path`],
  ['sequence increment', `ALTER SEQUENCE ${sequence} INCREMENT BY 2`],
  ['identity mode', `ALTER TABLE ${table} ALTER COLUMN ordinal SET GENERATED BY DEFAULT`],
  ['column default', `ALTER TABLE ${table} ALTER COLUMN tenant_id SET DEFAULT 'pbk'`],
  ['extra column', `ALTER TABLE ${table} ADD COLUMN drift text`],
  ['missing check', `ALTER TABLE ${table} DROP CONSTRAINT pbk_closure_tenant_check`],
  ['extra index', `CREATE INDEX unsafe ON ${table}(action)`],
  ['missing index', 'DROP INDEX public.pbk_closure_record_ordinal_idx'],
  ['owner read privilege', `REVOKE SELECT ON ${table} FROM closure_owner`],
  ['owner insert privilege', `REVOKE INSERT ON ${table} FROM closure_owner`],
  ['owner sequence privilege', `REVOKE ALL ON SEQUENCE ${sequence} FROM closure_owner`],
  ['owner function privilege', `REVOKE EXECUTE ON FUNCTION ${fn} FROM closure_owner`],
  ['function volatility', `ALTER FUNCTION ${fn} IMMUTABLE`],
  ['function parallel', `ALTER FUNCTION ${fn} PARALLEL SAFE`],
  ['function strict', `ALTER FUNCTION ${fn} STRICT`],
  ['function cost', `ALTER FUNCTION ${fn} COST 1`],
  ['sequence cache', `ALTER SEQUENCE ${sequence} CACHE 2`],
  ['sequence cycle', `ALTER SEQUENCE ${sequence} CYCLE`],
  ['index definition', `DROP INDEX public.pbk_closure_record_ordinal_idx; CREATE INDEX pbk_closure_record_ordinal_idx ON ${table}(tenant_id,record_ref,ordinal ASC)`],
  ['table ownership', `RESET ROLE; ALTER TABLE ${table} OWNER TO unrelated; SET ROLE closure_owner`],
])('migration refuses drift: %s; verification does not repair it', async (_label, sql) => {
  await applyDeadLetterClosureMigration(client, identity);
  await db.exec(sql);
  assert.equal((await verify()).ok, false);
  const writes = [];
  await assert.rejects(applyDeadLetterClosureMigration({ query: async (text, values) => {
    if (/^\s*(CREATE|ALTER|DROP|REVOKE|GRANT)\b/i.test(text)) writes.push(text);
    return client.query(text, values);
  } }, identity), /drift|installation/);
  assert.deepEqual(writes, []);
});

test('verifier uses catalog-qualified metadata even with a hostile caller search_path', async () => {
  await applyDeadLetterClosureMigration(client, identity);
  await db.exec(`CREATE FUNCTION public.pg_get_constraintdef(oid) RETURNS text LANGUAGE sql AS $$ SELECT 'forged'::text $$;
    SET search_path=public,pg_catalog`);
  try { assert.equal((await verify()).ok, true); }
  finally { await db.exec('SET search_path=public; DROP FUNCTION public.pg_get_constraintdef(oid)'); }
});

test('same deparsed check using a noncatalog function is drift, not a valid installation', async () => {
  await applyDeadLetterClosureMigration(client, identity);
  await db.exec(`CREATE FUNCTION public.isfinite(timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
    ALTER TABLE ${table} DROP CONSTRAINT pbk_closure_admission_check;
    ALTER TABLE ${table} ADD CONSTRAINT pbk_closure_admission_check CHECK (public.isfinite(admitted_at));
    SET search_path=public,pg_catalog`);
  try { assert.equal((await verify()).ok, false); }
  finally { await db.exec('SET search_path=public; DROP FUNCTION public.isfinite(timestamptz) CASCADE'); }
});

test('bigint allocation stays exact beyond JS safe integers; identity requires explicit override; gaps prove nothing', async () => {
  await applyDeadLetterClosureMigration(client, identity);
  await query('SELECT setval($1::regclass,$2::bigint)', [sequence, '9007199254740992']);
  const f = await insertFixture();
  assert.equal(f.row.ordinal, '9007199254740993');
  assert.equal(verifyClosureReceipt({ row: f.row, secret: f.secret, revision: f.revision, now: f.now }).ok, true);
  await assert.rejects(query(`INSERT INTO ${table}(id,ordinal) VALUES ('bad',1)`), /non-DEFAULT value into column "ordinal"/);
  const next = (await query('SELECT nextval($1::regclass)::text AS ordinal', [sequence])).rows[0].ordinal;
  assert.equal(next, '9007199254740994');
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 1);
  assert.equal((await verify()).ok, true, 'sequence position is deliberately not evidence of closure');
});

test('report constraint rejects missing/null bindings, malformed attestation and oversized matching report', async () => {
  await applyDeadLetterClosureMigration(client, identity);
  const f = await insertFixture();
  await db.exec('BEGIN');
  try {
    // Reuse the real INSERT with test-only column overrides. No unsigned staging row.
    const insert = async mutate => {
      await db.exec('SAVEPOINT rejected_report');
      const a = (await query(`SELECT nextval($1::regclass)::text AS ordinal,pg_current_xact_id()::text AS xid`, [sequence])).rows[0];
      const binding = closureBinding(f.secret, 'fixture-candidate', a.ordinal);
      const report = { ...f.report, receiptId: 'receipt_other', ordinal: a.ordinal, insertXid: a.xid, intentBinding: binding };
      mutate(report);
      await assert.rejects(query(`INSERT INTO ${table}(id,tenant_id,ordinal,admitted_at,insert_xid,record_ref,
        approval_ref,intent_binding,action,previous_id,report) OVERRIDING SYSTEM VALUE
        VALUES ($1,'pbk',$2,$3,$4,$5,$6,$7,'close_internal',NULL,$8)`,
      ['receipt_other', a.ordinal, f.row.admitted_at, a.xid, f.row.record_ref, f.row.approval_ref, binding, report]), /pbk_closure_report_check/);
      await db.exec('ROLLBACK TO SAVEPOINT rejected_report');
    };
    for (const key of ['receiptId','tenantId','ordinal','admittedAt','insertXid','recordRef','approvalRef','intentBinding','action','predecessor','attestation']) {
      await insert(report => { delete report[key]; });
      if (key !== 'predecessor') await insert(report => { report[key] = null; });
    }
    await insert(report => { report.padding = 'x'.repeat(65536); });
    await insert(report => { report.attestation = { version: report.schemaVersion, signature: 'malformed' }; });
  } finally { await db.exec('ROLLBACK'); }
});

test('default browser grants are removed only on new objects; unrelated defaults fail closed', async () => {
  await db.exec(`ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon;
    ALTER DEFAULT PRIVILEGES GRANT USAGE ON SEQUENCES TO authenticated;
    ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO authenticated;`);
  try {
    await applyDeadLetterClosureMigration(client, identity);
    assert.equal((await verify()).ok, true);
  } finally {
    await db.exec(`ALTER DEFAULT PRIVILEGES REVOKE SELECT ON TABLES FROM anon;
      ALTER DEFAULT PRIVILEGES REVOKE USAGE ON SEQUENCES FROM authenticated;
      ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM authenticated;`);
  }
  await db.exec(`DROP TABLE ${table} CASCADE; DROP FUNCTION ${fn};
    ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO unrelated`);
  try {
    await assert.rejects(applyDeadLetterClosureMigration(client, identity), /readback/);
    assert.equal((await query('SELECT to_regclass($1) AS object', [table])).rows[0].object, null);
  } finally { await db.exec('ALTER DEFAULT PRIVILEGES REVOKE SELECT ON TABLES FROM unrelated'); }
});

test('inherited role privileges cannot silently expose the ledger to browser or unrelated roles', async () => {
  await applyDeadLetterClosureMigration(client, identity);
  for (const sql of ['GRANT closure_owner TO anon', 'GRANT pg_read_all_data TO authenticated', 'GRANT closure_owner TO unrelated']) {
    await db.exec(`RESET ROLE; ${sql}; SET ROLE closure_owner`);
    try { assert.equal((await verify()).ok, false, sql); }
    finally { await db.exec(`RESET ROLE; ${sql.replace('GRANT ', 'REVOKE ').replace(' TO ', ' FROM ')}; SET ROLE closure_owner`); }
  }
});

test('owner trust boundary explicit: owner DDL can disable guards, and verifier detects it', async () => {
  await applyDeadLetterClosureMigration(client, identity);
  assert.equal((await verify()).ownerDdlTrusted, true);
  await insertFixture();
  await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER pbk_closure_immutable; DELETE FROM ${table}`);
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
  assert.equal((await verify()).ok, false);
});

test.each([
  { id: 'other' }, { tenant_id: 'other' }, { ordinal: '2' }, { admitted_at: '2026-11-17T12:00:00.100124Z' },
  { insert_xid: '1' }, { record_ref: 'a'.repeat(64) }, { approval_ref: 'a'.repeat(64) },
  { intent_binding: 'a'.repeat(64) }, { action: 'revoke_internal' }, { previous_id: 'missing' },
  { report: {} }, { report: { padding: 'x'.repeat(65536) } },
].map(changes => [Object.keys(changes)[0], changes]))('constraint rejects unsigned or mismatched column %s', async (_name, changes) => {
  await applyDeadLetterClosureMigration(client, identity);
  await assert.rejects(insertFixture(changes), /constraint|invalid|range/);
});

test('partial installation is rejected; failed fresh installation rolls back every closure object', async () => {
  await db.exec(`CREATE TABLE ${table}(id text)`);
  await assert.rejects(applyDeadLetterClosureMigration(client, identity), /drift|installation/);
  await db.exec(`DROP TABLE ${table}`);
  await assert.rejects(applyDeadLetterClosureMigration({ query: async (sql, values) => {
    const result = await client.query(sql, values);
    if (sql === DEAD_LETTER_CLOSURE_SQL) throw new Error('injected readback failure');
    return result;
  } }, identity), /injected/);
  assert.equal((await query('SELECT to_regclass($1) AS object', [table])).rows[0].object, null);
  assert.equal((await query('SELECT to_regprocedure($1) AS object', [fn])).rows[0].object, null);
});
