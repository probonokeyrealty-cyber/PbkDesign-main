import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, beforeEach, afterEach, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';

const sqlUrl = new URL('./migrations/20261117-bounded-census.sql', import.meta.url);
let db, migration;
const query = (sql, params) => db.query(sql, params);
const first = async (sql, params) => (await query(sql, params)).rows[0];
const head = () => first('SELECT * FROM public.pbk_runtime_census_head WHERE id=true');
const fixture = `
 CREATE TABLE activity_log(id text PRIMARY KEY, workspace_id text DEFAULT 'pbk',
 source text DEFAULT 'runtime-event:pbk', status text DEFAULT 'success', category text,
 text text, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 unprojected_private text);
 CREATE TABLE conversation_events(id uuid PRIMARY KEY, workspace_id text DEFAULT 'pbk',
 source_table text, source_id text, event_type text, channel text, direction text, status text,
 body text, payload jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 occurred_at timestamptz DEFAULT now());
 CREATE TABLE pbk_qa_audit(id text PRIMARY KEY, tenant_id text DEFAULT 'pbk', tool_name text,
 passed boolean, skipped boolean, reason text, validator text, retry_count int, params jsonb DEFAULT '{}',
 result jsonb DEFAULT '{}', qa jsonb DEFAULT '{}', source text, created_at timestamptz DEFAULT now());
 CREATE TABLE pbk_safety_audit(id text PRIMARY KEY, tenant_id text DEFAULT 'pbk', tool_name text,
 blocked boolean, approval_required boolean, params jsonb DEFAULT '{}', validation jsonb DEFAULT '{}',
 source text, created_at timestamptz DEFAULT now());`;

const sources = [
  ['activity_log', 'workspace_id', 'runtime_archive', 'writer-id', 'writer-new-id'],
  ['conversation_events', 'workspace_id', 'conversation_projection',
    '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012'],
  ['pbk_qa_audit', 'tenant_id', 'qa', 'writer-id', 'writer-new-id'],
  ['pbk_safety_audit', 'tenant_id', 'safety', 'writer-id', 'writer-new-id'],
];
const internalTables = ['head','journal','state','entries','proofs'];

async function sourceWrites(client, [table, scope, , id, newId]) {
  await client.query(`INSERT INTO ${table}(id) VALUES ($1)`, [id]);
  await client.query(`UPDATE ${table} SET id=id WHERE id=$1`, [id]);
  await client.query(`UPDATE ${table} SET id=$1 WHERE id=$2`, [newId, id]);
  await client.query(`UPDATE ${table} SET ${scope}='outside' WHERE id=$1`, [newId]);
  await client.query(`UPDATE ${table} SET ${scope}='pbk' WHERE id=$1`, [newId]);
  await client.query(`DELETE FROM ${table} WHERE id=$1`, [newId]);
  assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
}

async function assertCaptured(client, kind) {
  const rows = (await client.query('SELECT * FROM pbk_runtime_census_journal ORDER BY sequence')).rows;
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map(r => r.operation), ['INSERT','UPDATE','UPDATE','UPDATE','UPDATE','UPDATE','DELETE']);
  assert.deepEqual(rows.map(r => r.presence), ['present','present','deleted','present','deleted','present','deleted']);
  let previous = '0'.repeat(64);
  for (const [i, row] of rows.entries()) {
    assert.equal(row.source_kind, kind);
    assert.equal(Number(row.sequence), i + 1);
    assert.equal(row.previous_hash, previous);
    previous = row.chain_hash;
  }
  assert.equal(rows[2].source_ref, rows[1].source_ref);
  assert.notEqual(rows[2].source_ref, rows[3].source_ref);
  assert.equal(rows[6].source_ref, rows[3].source_ref);
  const h = (await client.query('SELECT sequence,chain_hash FROM pbk_runtime_census_head')).rows[0];
  assert.equal(Number(h.sequence), 7);
  assert.equal(h.chain_hash, previous);
}

beforeAll(async () => {
  assert.equal(existsSync(sqlUrl), true, 'Task 1 migration must exist');
  migration = await import('./bounded-census-migration.mjs');
  db = new PGlite();
  await db.exec(fixture);
  await db.exec(readFileSync(sqlUrl, 'utf8'));
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { if (db) await db.exec('BEGIN'); });
afterEach(async () => { if (db) await db.exec('ROLLBACK'); });

test.each(sources)('review nonowner %s keeps original source DML without census access', async (...source) => {
  const local = new PGlite();
  try {
    await local.exec(fixture);
    await local.exec(`CREATE ROLE census_writer NOLOGIN; GRANT USAGE ON SCHEMA public TO census_writer;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ${source[0]} TO census_writer; SET ROLE census_writer`);
    await sourceWrites(local, source);
    await local.exec('RESET ROLE');
    const permissions = () => local.query(`SELECT relname,relacl FROM pg_class
      WHERE relnamespace='public'::regnamespace AND relname=$1`, [source[0]]);
    const before = (await permissions()).rows;
    await local.exec(migration.BOUNDED_CENSUS_SQL);
    assert.deepEqual((await permissions()).rows, before);
    await local.exec('SET ROLE census_writer');
    await sourceWrites(local, source);
    for (const table of internalTables) {
      assert.equal((await local.query('SELECT has_table_privilege(current_user,$1,\'SELECT\') AS allowed',
        [`public.pbk_runtime_census_${table}`])).rows[0].allowed, false);
      await assert.rejects(local.query(`SELECT * FROM pbk_runtime_census_${table}`), /permission denied/);
    }
    const accessible = await local.query(`SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname LIKE 'pbk_census_%' AND has_function_privilege(current_user,oid,'EXECUTE')`);
    assert.deepEqual(accessible.rows, []);
    await assert.rejects(local.query("SELECT public.pbk_census_identity('qa','writer-id')"), /permission denied/);
    await local.exec('RESET ROLE');
    assert.deepEqual((await permissions()).rows, before);
    await assertCaptured(local, source[2]);
    assert.equal(await migration.verifyBoundedCensusInstallation(local), true);
  } finally { await local.close(); }
}, 30000);

test.each(sources)('review replica %s captures INSERT UPDATE key scope DELETE', async (...source) => {
  await db.exec('SET LOCAL session_replication_role=replica');
  await sourceWrites(db, source);
  await db.exec('SET LOCAL session_replication_role=origin');
  await assertCaptured(db, source[2]);
  assert.equal(await migration.verifyBoundedCensusInstallation({ query }), true);
});

test.each(sources)('review replica %s rejects source TRUNCATE', async (...source) => {
  const [table, , , id] = source;
  await query(`INSERT INTO ${table}(id) VALUES ($1)`, [id]);
  const before = await head();
  await db.exec('SET LOCAL session_replication_role=replica; SAVEPOINT refused');
  await assert.rejects(db.exec(`TRUNCATE ${table}`), /TRUNCATE refused/);
  await db.exec('ROLLBACK TO SAVEPOINT refused; SET LOCAL session_replication_role=origin');
  assert.deepEqual(await head(), before);
  assert.equal((await first(`SELECT count(*)::int AS n FROM ${table}`)).n, 1);
});

test.each(['proofs','journal'].flatMap(table => ['UPDATE','DELETE','TRUNCATE'].map(op => [table,op])))
('review replica immutable %s rejects %s', async (table, op) => {
  await db.exec(`INSERT INTO activity_log(id) VALUES ('immutable');
    INSERT INTO pbk_runtime_census_proofs(id,report) VALUES ('immutable','{}')`);
  const name = `pbk_runtime_census_${table}`;
  const before = (await query(`SELECT * FROM ${name}`)).rows;
  const sql = op === 'UPDATE' ? `UPDATE ${name} SET ${table === 'proofs' ? "report='{}'" : "digest=repeat('a',64)"}`
    : op === 'DELETE' ? `DELETE FROM ${name}` : `TRUNCATE ${name}`;
  await db.exec('SET LOCAL session_replication_role=replica; SAVEPOINT refused');
  await assert.rejects(db.exec(sql), /immutable history/);
  await db.exec('ROLLBACK TO SAVEPOINT refused; SET LOCAL session_replication_role=origin');
  assert.deepEqual((await query(`SELECT * FROM ${name}`)).rows, before);
  assert.equal(await migration.verifyBoundedCensusInstallation({ query }), true);
});

test.each(['capture','no_truncate','immutable'])('review trusted verifier rejects origin-only %s with forged baseline', async suffix => {
  const table = suffix === 'immutable' ? 'pbk_runtime_census_proofs' : 'activity_log';
  await db.exec(`ALTER TABLE ${table} ENABLE TRIGGER pbk_census_${suffix};
    UPDATE pbk_runtime_census_head SET installation=public.pbk_census_installation()`);
  assert.equal(await migration.verifyBoundedCensusInstallation({ query }), false);
});

test.each(internalTables.flatMap(table => ['SELECT','INSERT','UPDATE'].flatMap(privilege =>
  ['ordinary','bypass'].map(role => [table,privilege,role]))))
('review column ACL %s %s %s rejected even with forged baseline', async (table, privilege, role) => {
  await db.exec(`CREATE ROLE census_column_reader NOLOGIN ${role === 'bypass' ? 'BYPASSRLS' : 'NOBYPASSRLS'};
    GRANT USAGE ON SCHEMA public TO census_column_reader;
    GRANT ${privilege} (${table === 'head' ? 'chain_hash' : table === 'journal' ? 'digest' : 'report'})
      ON pbk_runtime_census_${table} TO census_column_reader`);
  const baselineOk = (await first('SELECT public.pbk_census_verify_installation() AS ok')).ok;
  await db.exec('UPDATE pbk_runtime_census_head SET installation=public.pbk_census_installation()');
  assert.equal((await first('SELECT public.pbk_census_verify_installation() AS ok')).ok, true);
  assert.deepEqual([baselineOk, await migration.verifyBoundedCensusInstallation({ query })], [false,false]);
});

test.each(sources)('review identity %s matches immutable builtin index and page algorithm', async (table, scope, kind, id) => {
  for (const value of ['', id, 'colon:quote"backslash\\', 'caf\u00e9-\u96ea-\ud83d\ude00']) {
    const expected = createHash('sha256').update(`pbk.census.identity.v2:${kind}:${value}`, 'utf8').digest('hex');
    assert.equal((await first('SELECT public.pbk_census_identity($1,$2) AS ref', [kind,value])).ref, expected);
  }
  await query(`INSERT INTO ${table}(id) VALUES ($1)`, [id]);
  const expected = createHash('sha256').update(`pbk.census.identity.v2:${kind}:${id}`).digest('hex');
  assert.equal((await first('SELECT * FROM public.pbk_census_page($1)', [kind])).source_ref, expected);
  assert.equal((await first('SELECT source_ref FROM pbk_runtime_census_journal')).source_ref, expected);
  await db.exec('SET LOCAL enable_seqscan=off');
  // Explain the shipped branch, not a test-written approximation of its predicate/order.
  const pageDefinition = migration.BOUNDED_CENSUS_SQL.match(/CREATE OR REPLACE FUNCTION public\.pbk_census_page\([^]*?\$census\$;/)[0];
  const branch = pageDefinition.split(`WHEN '${kind}' THEN`)[1];
  const innerSql = branch.match(/WITH rows AS MATERIALIZED \(([^]*?)\)\s*SELECT p_kind/)[1]
    .replace(/\bafter_ref\b/g, '$1').replace(/\bpage_size\b/g, '1');
  const plan = (await query(`EXPLAIN (FORMAT JSON) ${innerSql}`, [''])).rows;
  assert.match(JSON.stringify(plan), /pbk_census_\w+_ref_idx/);
  assert.match(JSON.stringify(plan), /Index Cond/);
  assert.doesNotMatch(JSON.stringify(plan), /Seq Scan|Sort/);
});

test.each(['SELECT','INSERT','UPDATE'].flatMap(privilege => ['PUBLIC','census_column_reader'].map(role => [privilege,role])))
('review migration refuses preexisting %s column grant to %s transactionally', async (privilege, role) => {
  const local = new PGlite();
  try {
    await local.exec(fixture);
    // Stop before security/instrumentation so this is a preexisting column grant, not baseline drift.
    await local.exec(migration.BOUNDED_CENSUS_SQL.split('ALTER TABLE public.pbk_runtime_census_head ENABLE')[0]);
    await local.exec(`CREATE ROLE census_column_reader NOLOGIN BYPASSRLS;
      GRANT ${privilege}(report) ON pbk_runtime_census_proofs TO ${role}`);
    const acl = () => local.query(`SELECT attacl FROM pg_attribute
      WHERE attrelid='pbk_runtime_census_proofs'::regclass AND attname='report'`);
    const before = (await acl()).rows;
    const identity = (await local.query('SELECT current_database() AS database,current_user AS role')).rows[0];
    const client = { query: (sql, params) => sql === migration.BOUNDED_CENSUS_SQL ? local.exec(sql) : local.query(sql, params) };
    await assert.rejects(migration.applyBoundedCensusMigration(client, { expectedDatabase: identity.database,
      expectedRole: identity.role, expectedSha256: migration.BOUNDED_CENSUS_SHA256 }), /column grants|verification failed/);
    assert.deepEqual((await acl()).rows, before);
    assert.equal((await local.query(`SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgname='pbk_census_capture'`)).rows[0].n, 0);
  } finally { await local.close(); }
}, 30000);

test('migration exports exact reviewed SQL/checksum and refuses ambient targets', () => {
  assert.equal(migration.BOUNDED_CENSUS_SQL, readFileSync(sqlUrl, 'utf8'));
  assert.equal(migration.BOUNDED_CENSUS_SHA256,
    createHash('sha256').update(migration.BOUNDED_CENSUS_SQL).digest('hex'));
  const validate = migration.validateBoundedCensusMigrationConfig;
  assert.throws(() => validate({ DATABASE_URL: 'postgres://ignored:ignored@localhost/ignored' }), /PBK_CENSUS_MIGRATION/);
  const env = { PBK_CENSUS_MIGRATION_DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1:5433/census_fixture',
    PBK_CENSUS_MIGRATION_TARGET: 'local', PBK_CENSUS_MIGRATION_EXPECT_HOST: '127.0.0.1',
    PBK_CENSUS_MIGRATION_EXPECT_DATABASE: 'census_fixture', PBK_CENSUS_MIGRATION_EXPECT_ROLE: 'fixture' };
  assert.equal(validate(env).port, 5433);
  for (const change of [
    { PBK_CENSUS_MIGRATION_TARGET: 'production' },
    { PBK_CENSUS_MIGRATION_EXPECT_HOST: 'another-host' },
    { PBK_CENSUS_MIGRATION_EXPECT_DATABASE: 'another-db' },
    { PBK_CENSUS_MIGRATION_EXPECT_ROLE: 'another-role' },
    { PBK_CENSUS_MIGRATION_DATABASE_URL: `${env.PBK_CENSUS_MIGRATION_DATABASE_URL}?options=unsafe` },
    { PBK_CENSUS_MIGRATION_DATABASE_URL: 'postgres://fixture@127.0.0.1:5433/census_fixture' },
  ]) assert.throws(() => validate({ ...env, ...change }));
});

test('CLI dry-run stays offline and emits no URL, credentials or driver diagnostics', () => {
  const env = { SystemRoot: process.env.SystemRoot,
    PBK_CENSUS_MIGRATION_DATABASE_URL: 'postgres://localfixture:private-fixture-password@127.0.0.1:1/census_fixture',
    PBK_CENSUS_MIGRATION_TARGET: 'local', PBK_CENSUS_MIGRATION_EXPECT_HOST: '127.0.0.1',
    PBK_CENSUS_MIGRATION_EXPECT_DATABASE: 'census_fixture', PBK_CENSUS_MIGRATION_EXPECT_ROLE: 'localfixture' };
  const script = fileURLToPath(new URL('./bounded-census-migration.mjs',import.meta.url));
  const result = spawnSync(process.execPath,[script],{ env, encoding: 'utf8',timeout: 10000 });
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { mode: 'dry-run',target: 'local',
    migration: '20261117-bounded-census.sql',sha256: migration.BOUNDED_CENSUS_SHA256 });
  const refused = spawnSync(process.execPath,[script,'--apply',`--confirm-sha256=${'0'.repeat(64)}`],
    { env,encoding: 'utf8',timeout: 10000 });
  assert.equal(refused.status,1);
  assert.match(refused.stderr,/refused\/failed/);
  for (const privateValue of ['postgres://','private-fixture-password','localfixture','census_fixture','127.0.0.1']) {
    assert.equal((result.stdout+result.stderr+refused.stdout+refused.stderr).includes(privateValue),false);
  }
});

test('all new objects are owner-only with RLS, no extensions/roles or broad revokes', async () => {
  const tables = (await query(`SELECT relname, relrowsecurity, relacl FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname LIKE 'pbk_runtime_census_%' AND relkind='r'`)).rows;
  assert.equal(tables.length, 5);
  for (const t of tables) { assert.equal(t.relrowsecurity, true); assert.ok(!String(t.relacl).includes('=arwdDxt/')); }
  assert.equal((await query(`SELECT * FROM pg_policies WHERE tablename LIKE 'pbk_runtime_census_%'`)).rows.length, 0);
  const functions = (await query(`SELECT proname,proconfig,proacl,prosecdef FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname LIKE 'pbk_census_%'`)).rows;
  assert.ok(functions.length >= 8);
  for (const fn of functions) {
    assert.ok(fn.proconfig.includes('search_path=pg_catalog, pg_temp'));
    assert.equal(fn.prosecdef, fn.proname === 'pbk_census_source_trigger');
  }
  assert.equal((await first(`SELECT count(*)::int AS n FROM pg_proc p,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'pbk_census_%'
    AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).n, 0);
  assert.doesNotMatch(migration.BOUNDED_CENSUS_SQL, /CREATE\s+(?:EXTENSION|ROLE)|REVOKE[^;]+ALL\s+(?:TABLES|FUNCTIONS)\s+IN\s+SCHEMA/i);
  assert.equal((await first('SELECT public.pbk_census_verify_installation() AS ok')).ok, true);
});

test('idempotent installation preserves epoch, committed head and journal', async () => {
  await query(`INSERT INTO activity_log(id,text) VALUES ('private-id','private seller body')`);
  const before = await head();
  await db.exec(migration.BOUNDED_CENSUS_SQL);
  assert.deepEqual(await head(), before);
  assert.equal((await first('SELECT count(*)::int AS n FROM pbk_runtime_census_journal')).n, 1);
  assert.equal((await first('SELECT public.pbk_census_verify_installation() AS ok')).ok, true);
});

test('four fixed projections journal opaque postimages, unknown provenance and matching pages', async () => {
  await db.exec(`INSERT INTO activity_log(id,text,metadata,unprojected_private)
    VALUES ('private-id','private seller body','{"phone":"private-contact"}','private extra');
    INSERT INTO conversation_events(id,status,body,payload) VALUES
    ('00000000-0000-4000-8000-000000000001','delivered','private conversation','{"private":"payload"}');
    INSERT INTO pbk_qa_audit(id,passed,skipped,params) VALUES ('private-qa',true,false,'{"private":"qa"}');
    INSERT INTO pbk_safety_audit(id,blocked,approval_required) VALUES ('private-safety',true,true);`);
  const journal = (await query('SELECT * FROM pbk_runtime_census_journal ORDER BY sequence')).rows;
  assert.equal(journal.length, 4);
  const expected = { runtime_archive: 'success', conversation_projection: 'success', qa: 'success', safety: 'blocked' };
  let previous = '0'.repeat(64);
  for (let i = 0; i < journal.length; i++) {
    const row = journal[i];
    assert.equal(Number(row.sequence), i + 1);
    assert.equal(row.previous_hash, previous);
    assert.equal(row.old_ref, null);
    assert.equal(row.source_ref, row.new_ref);
    assert.match(row.source_ref, /^[a-f0-9]{64}$/);
    assert.match(row.digest, /^[a-f0-9]{64}$/);
    assert.equal(row.outcome, expected[row.source_kind]);
    assert.equal(row.clock_valid, true);
    assert.equal(row.presence, 'present');
    assert.equal(row.chain_hash, (await first(`SELECT public.pbk_census_digest(to_jsonb(j)-'chain_hash') AS d
      FROM pbk_runtime_census_journal j WHERE sequence=$1`, [row.sequence])).d);
    previous = row.chain_hash;
    const page = (await query('SELECT * FROM public.pbk_census_page($1)', [row.source_kind])).rows;
    assert.equal(page.length, 1);
    for (const field of ['source_ref', 'digest', 'projection_bytes', 'outcome', 'clock_valid']) {
      assert.equal(page[0][field], row[field]);
    }
    assert.deepEqual(Object.keys(page[0]).sort(), ['clock_valid','digest','outcome','projection_bytes','source_kind','source_ref']);
  }
  assert.equal((await head()).chain_hash, previous);
  for (const privateValue of ['private-id','private seller body','private-contact','private conversation','private-qa','private-safety','xmin']) {
    assert.equal(JSON.stringify(journal).includes(privateValue), false);
  }
  assert.equal((await first(`SELECT public.pbk_census_projection('runtime_archive',to_jsonb(a)) ? 'unprojected_private' AS present
    FROM activity_log a`)).present, false);
});

test.each([
  ['activity_log', 'workspace_id', 'runtime_archive', "'private-id'"],
  ['conversation_events', 'workspace_id', 'conversation_projection', "'00000000-0000-4000-8000-000000000001'"],
  ['pbk_qa_audit', 'tenant_id', 'qa', "'private-id'"],
  ['pbk_safety_audit', 'tenant_id', 'safety', "'private-id'"],
])('%s captures PBK scope arrival, departure, identity change and delete', async (table, scope, kind, id) => {
  await db.exec(`INSERT INTO ${table}(id,${scope}) VALUES (${id},'outside')`);
  assert.equal(Number((await head()).sequence), 0);
  await db.exec(`UPDATE ${table} SET ${scope}='pbk'`);
  await db.exec(`UPDATE ${table} SET ${scope}='outside'`);
  await db.exec(`UPDATE ${table} SET ${scope}='pbk'`);
  const newId = table === 'conversation_events' ? '00000000-0000-4000-8000-000000000002' : 'private-new-id';
  await query(`UPDATE ${table} SET id=$1`, [newId]);
  await db.exec(`DELETE FROM ${table}`);
  const rows = (await query('SELECT * FROM pbk_runtime_census_journal ORDER BY sequence')).rows;
  assert.deepEqual(rows.map(r => r.presence), ['present','deleted','present','deleted','present','deleted']);
  assert.equal(rows.every(r => r.source_kind === kind), true);
  assert.equal(rows[3].old_ref, rows[2].source_ref);
  assert.equal(rows[4].new_ref, rows[5].source_ref);
  assert.notEqual(rows[3].source_ref, rows[4].source_ref);
  for (const r of rows.filter(r => r.presence === 'deleted')) assert.equal(r.outcome, 'deleted');
});

test('archive source-prefix transition, rollback and no-op updates preserve contiguous transactional chain', async () => {
  await db.exec(`INSERT INTO activity_log(id,source) VALUES ('a','unrelated')`);
  assert.equal(Number((await head()).sequence), 0);
  await db.exec(`UPDATE activity_log SET source='runtime-event:local'; SAVEPOINT mutation;
    UPDATE activity_log SET status='error'; UPDATE activity_log SET id='b'; ROLLBACK TO SAVEPOINT mutation;`);
  assert.equal(Number((await head()).sequence), 1);
  await db.exec('UPDATE activity_log SET id=id');
  await db.exec(`UPDATE activity_log SET source='unrelated'`);
  assert.deepEqual((await query('SELECT sequence,presence FROM pbk_runtime_census_journal ORDER BY sequence')).rows
    .map(r => [Number(r.sequence), r.presence]), [[1,'present'],[2,'present'],[3,'deleted']]);
});

test('pages are fixed, bounded, deterministic, exclusive and return projection metadata only', async () => {
  await db.exec(`INSERT INTO activity_log(id,text) SELECT 'row-'||n,repeat('x',1000) FROM generate_series(1,7) n`);
  const firstPage = (await query(`SELECT * FROM public.pbk_census_page('runtime_archive','',3)`)).rows;
  const secondPage = (await query(`SELECT * FROM public.pbk_census_page('runtime_archive',$1,3)`, [firstPage[2].source_ref])).rows;
  assert.equal(firstPage.length, 3); assert.equal(secondPage.length, 3);
  assert.equal(new Set([...firstPage,...secondPage].map(r => r.source_ref)).size, 6);
  assert.ok(firstPage.every(r => Number(r.projection_bytes) > 1000));
  const journal = (await query('SELECT * FROM public.pbk_census_journal_page(1,4,2)')).rows;
  assert.deepEqual(journal.map(r => Number(r.sequence)), [2,3]);
  await db.exec('SAVEPOINT bad');
  await assert.rejects(query(`SELECT * FROM public.pbk_census_page('constructor')`), /kind/i);
  await db.exec('ROLLBACK TO SAVEPOINT bad');
  await assert.rejects(query(`SELECT * FROM public.pbk_census_page('qa','',513)`), /page/i);
});

test('projection digest normalizes timestamp timezone/microseconds and clocks fail closed', async () => {
  await db.exec(`INSERT INTO activity_log(id,created_at,updated_at) VALUES
    ('time','2026-11-17T01:02:03.123456Z','2026-11-17T01:02:04.123457Z')`);
  const before = await first(`SELECT * FROM public.pbk_census_page('runtime_archive')`);
  await db.exec(`SET LOCAL TIME ZONE 'America/Los_Angeles'; UPDATE activity_log SET id=id`);
  const after = await first(`SELECT * FROM public.pbk_census_page('runtime_archive')`);
  assert.equal(before.digest, after.digest);
  assert.equal((await first(`SELECT public.pbk_census_projection('runtime_archive',to_jsonb(a))->>'updated_at' AS stamp
    FROM activity_log a`)).stamp, '2026-11-17T01:02:04.123457Z');
  await db.exec(`UPDATE activity_log SET updated_at=created_at - interval '1 second'`);
  assert.equal((await first(`SELECT * FROM public.pbk_census_page('runtime_archive')`)).clock_valid, false);
  await db.exec(`UPDATE activity_log SET updated_at='infinity'`);
  assert.equal((await first(`SELECT * FROM public.pbk_census_page('runtime_archive')`)).clock_valid, false);
});

test('generic reports have stored generated digest/bytes, immutable proofs and bounded bodies', async () => {
  for (const table of ['state','entries','proofs']) {
    const name = `pbk_runtime_census_${table}`;
    await query(`INSERT INTO ${name}(id,report) VALUES ('local','{"anonymized":true}')`);
    const row = await first(`SELECT id,body_digest,report_bytes FROM ${name}`);
    assert.equal(row.body_digest, (await first(`SELECT public.pbk_census_digest(report) AS d FROM ${name}`)).d);
    assert.equal(Number(row.report_bytes), Buffer.byteLength('{"anonymized": true}'));
    const columns = (await query(`SELECT attname,attgenerated FROM pg_attribute
      WHERE attrelid=$1::regclass AND attname IN ('body_digest','report_bytes')`, [name])).rows;
    assert.equal(columns.every(c => c.attgenerated === 's'), true);
  }
  for (const sql of [
    `UPDATE pbk_runtime_census_proofs SET report='{}'`,
    `DELETE FROM pbk_runtime_census_proofs`, `TRUNCATE pbk_runtime_census_proofs`,
    `UPDATE pbk_runtime_census_journal SET digest=repeat('a',64)`,
    `TRUNCATE activity_log`,
    `INSERT INTO pbk_runtime_census_proofs(id,report) VALUES ('huge',jsonb_build_object('data',repeat('x',8192)))`,
    `INSERT INTO pbk_runtime_census_state(id,report,body_digest) VALUES ('fake','{}',repeat('a',64))`,
  ]) {
    await db.exec('SAVEPOINT denied');
    await assert.rejects(db.exec(sql));
    await db.exec('ROLLBACK TO SAVEPOINT denied');
  }
});

test.each(['trigger','function','index','rls','column','acl'])('installation verification rejects altered %s', async mode => {
  if (mode === 'trigger') await db.exec('ALTER TABLE activity_log DISABLE TRIGGER pbk_census_capture');
  if (mode === 'function') await db.exec(`CREATE OR REPLACE FUNCTION public.pbk_census_digest(body jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$SELECT repeat('0',64)$$`);
  if (mode === 'index') await db.exec('DROP INDEX public.pbk_census_activity_ref_idx');
  if (mode === 'rls') await db.exec('ALTER TABLE pbk_runtime_census_entries DISABLE ROW LEVEL SECURITY');
  if (mode === 'column') await db.exec('ALTER TABLE pbk_runtime_census_entries ADD COLUMN unexpected text');
  if (mode === 'acl') await db.exec('GRANT SELECT ON pbk_runtime_census_state TO PUBLIC');
  assert.equal((await first('SELECT public.pbk_census_verify_installation() AS ok')).ok, false);
});

test.each(['trigger','function','defaults','index','rls','column','acl','generated','constraint'])
('trusted shipped verifier rejects %s even with a forged mutable installation baseline', async mode => {
  if (mode === 'trigger') await db.exec('DROP TRIGGER pbk_census_capture ON activity_log');
  if (mode === 'function') await db.exec(`CREATE OR REPLACE FUNCTION public.pbk_census_digest(body jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog,pg_temp
    AS $$SELECT repeat('0',64)$$`);
  if (mode === 'defaults') {
    const definition = migration.BOUNDED_CENSUS_SQL.match(/CREATE OR REPLACE FUNCTION public\.pbk_census_page\([^]*?\$census\$;/)[0];
    await db.exec(definition.replace('page_size integer DEFAULT 128','page_size integer DEFAULT 127'));
  }
  if (mode === 'index') await db.exec('DROP INDEX public.pbk_census_activity_ref_idx');
  if (mode === 'rls') await db.exec('ALTER TABLE pbk_runtime_census_entries DISABLE ROW LEVEL SECURITY');
  if (mode === 'column') await db.exec('ALTER TABLE pbk_runtime_census_entries ADD COLUMN unexpected text');
  if (mode === 'acl') await db.exec('GRANT EXECUTE ON FUNCTION public.pbk_census_digest(jsonb) TO PUBLIC');
  if (mode === 'generated') await db.exec('ALTER TABLE pbk_runtime_census_proofs ALTER COLUMN body_digest DROP EXPRESSION');
  if (mode === 'constraint') await db.exec('ALTER TABLE pbk_runtime_census_proofs DROP CONSTRAINT pbk_runtime_census_proofs_report_check');
  await db.exec('UPDATE pbk_runtime_census_head SET installation=public.pbk_census_installation()');
  assert.equal(await migration.verifyBoundedCensusInstallation({ query }), false);
});

test('trusted verifier accepts the original shipped installation', async () => {
  assert.equal(await migration.verifyBoundedCensusInstallation({ query }), true);
});

test('apply API requires checksum before any query and validates connected identity transactionally', async () => {
  const identity = await first('SELECT current_database() AS database,current_user AS role');
  const options = { expectedDatabase: identity.database, expectedRole: identity.role,
    expectedSha256: migration.BOUNDED_CENSUS_SHA256 };
  let called = false;
  await assert.rejects(migration.applyBoundedCensusMigration({ query() { called = true; } }, { ...options, expectedSha256: 'bad' }), /checksum/i);
  assert.equal(called, false);
  // The runner owns BEGIN/COMMIT, so end this test fixture transaction first.
  await db.exec('ROLLBACK');
  const client = { query: (sql, params) => sql === migration.BOUNDED_CENSUS_SQL ? db.exec(sql) : query(sql, params) };
  await assert.rejects(migration.applyBoundedCensusMigration(client, { ...options, expectedDatabase: 'wrong' }), /identity/i);
  assert.equal((await migration.applyBoundedCensusMigration(client, options)).ok, true);
  await db.exec('BEGIN');
});
