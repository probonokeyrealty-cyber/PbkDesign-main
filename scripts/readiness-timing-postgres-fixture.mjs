import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createAuditFixture } from './operational-audit-test-fixture.mjs';

// Test-only SQL remapping. Every query still executes on the real disposable Postgres.
export function mapReadinessFixtureSql(text, schema) {
  assert.match(schema, /^pbk_proof_[a-f0-9]{32}$/);
  return text.replace(/\bpublic\./g, `${schema}.`).replaceAll("'public'", `'${schema}'`);
}

export function createReadinessFixtureQuery(query, schema) {
  mapReadinessFixtureSql('', schema);
  return function (config, ...args) {
    const mapped = typeof config === 'string' ? mapReadinessFixtureSql(config, schema)
      : { ...config, text: mapReadinessFixtureSql(config.text, schema) };
    return query.call(this, mapped, ...args);
  };
}

export async function readProtectedFixtureFingerprints(pool) {
  const result = {};
  for (const table of ['approvals', 'provider_action_dispatches', 'event_dead_letters', 'calls']) {
    const exists = (await pool.query('SELECT to_regclass($1) AS table', [`public.${table}`])).rows[0].table;
    result[table] = exists ? (await pool.query(`SELECT count(*)::text AS n,
      md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text),'')) AS fingerprint
      FROM public.${table} t`)).rows[0] : null;
  }
  return result;
}

// Test setup can cost real time; walk the virtual fixture through genuine bounded samples.
export async function advanceAuditFixtureClock(fixture, target) {
  const started = fixture.now();
  assert(Number.isSafeInteger(target) && target >= started && target - started <= 180000,
    'fixture clock catch-up must be forward and within its test harness bound');
  while (fixture.now() < target) {
    fixture.advance(Math.min(60000, target - fixture.now()));
    const result = await fixture.sampler.sample({ cutoff: fixture.now() });
    assert.equal(result.verified, true, result.result);
  }
}

export async function createTimingPostgresFixture(connectionConfig, { start = Date.now() - 86400000,
  initialMonotonic = 100, createPool = config => new pg.Pool(config) } = {}) {
  const schema = `pbk_proof_${randomUUID().replaceAll('-', '')}`;
  const raw = createPool({ ...connectionConfig, max: 4, connectionTimeoutMillis: 10000 });
  let wall = start, mono = initialMonotonic, intercept;
  const stats = { queries: 0, virtualClockQueries: 0 };
  const queryWith = target => async (config, values) => {
    const original = typeof config === 'string' ? config : config.text;
    values = typeof config === 'string' ? values : config.values;
    await intercept?.(original, values);
    let text = mapReadinessFixtureSql(original, schema);
    if (text.includes('clock_timestamp()')) {
      stats.virtualClockQueries++;
      text = text.replaceAll('pg_catalog.clock_timestamp()', `pg_catalog.to_timestamp(${wall / 1000})`)
        .replaceAll('clock_timestamp()', `pg_catalog.to_timestamp(${wall / 1000})`);
    }
    stats.queries++;
    return target.query(typeof config === 'string' ? { text, values } : { ...config, text, values });
  };
  const pool = { query: queryWith(raw), async connect() {
    const client = await raw.connect();
    let released = false;
    return { query: queryWith(client), release(destroy) {
      if (!released) { released = true; client.release(destroy); }
    } };
  } };
  let inheritedBefore, schemaCreated = false;
  try {
    inheritedBefore = await readProtectedFixtureFingerprints(raw);
    await raw.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await pool.query(`
      CREATE TABLE public.activity_log(id text PRIMARY KEY,workspace_id text DEFAULT 'pbk',source text DEFAULT 'runtime-event:pbk',
        status text DEFAULT 'success',category text DEFAULT 'EVENT',text text DEFAULT '',metadata jsonb DEFAULT '{}',
        created_at timestamptz,updated_at timestamptz);
      CREATE TABLE public.conversation_events(id uuid PRIMARY KEY,workspace_id text DEFAULT 'pbk',source_table text,source_id text,
        event_type text,channel text,direction text,status text,body text,payload jsonb,created_at timestamptz,
        updated_at timestamptz,occurred_at timestamptz);
      CREATE TABLE public.pbk_qa_audit(id text PRIMARY KEY,tenant_id text DEFAULT 'pbk',tool_name text,passed boolean,skipped boolean,
        reason text,validator text,retry_count int,params jsonb,result jsonb,qa jsonb,source text,created_at timestamptz);
      CREATE TABLE public.pbk_safety_audit(id text PRIMARY KEY,tenant_id text DEFAULT 'pbk',tool_name text,blocked boolean,
        approval_required boolean,params jsonb,validation jsonb,source text,created_at timestamptz);
      CREATE TABLE public.pbk_eval_runs(id text PRIMARY KEY,tenant_id text,suite_name text,ok boolean,total int,passed int,
        failed int,report jsonb,source text,created_at timestamptz);
      CREATE TABLE public.provider_action_dispatches(approval_id text PRIMARY KEY,workspace_id text DEFAULT 'pbk',status text,
        created_at timestamptz,updated_at timestamptz,dispatch_started_at timestamptz,completed_at timestamptz,
        reconciliation_required_at timestamptz);
      CREATE TABLE public.event_dead_letters(id text PRIMARY KEY,tenant_id text DEFAULT 'pbk',source text,created_at timestamptz);
      CREATE TABLE public.approvals(id text PRIMARY KEY,workspace_id text DEFAULT 'pbk',lead_id text,status text);
    `);
    const otherTables = ['bridge_state', 'lead_profiles', 'lead_imports', 'calls', 'contracts', 'unified_messages',
      'pbk_memories', 'pbk_knowledge', 'pbk_feedback', 'pbk_intent_events', 'pbk_local_commands',
      'conversation_threads', 'conversation_thread_identities', 'communication_sender_identities'];
    for (const table of otherTables) await pool.query(`CREATE TABLE public.${table}(id text PRIMARY KEY)`);
    const tables = (await raw.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema])).rows;
    for (const { tablename } of tables) await raw.query(`ALTER TABLE ${schema}.${tablename} ENABLE ROW LEVEL SECURITY`);
  } catch (error) {
    try {
      if (schemaCreated) await raw.query(`DROP SCHEMA ${schema} CASCADE`);
    } catch (cleanupError) { error.cleanupError = cleanupError; }
    finally {
      try { await raw.end(); }
      catch (poolEndError) { error.poolEndError = poolEndError; }
    }
    throw error;
  }
  return { pool, stats, now: () => wall, monotonicNow: () => mono,
    advance(ms = 60000) { wall += ms; mono += ms; },
    intercept(fn) { intercept = fn; },
    async close() {
      intercept = undefined;
      try {
        try { assert.deepEqual(await readProtectedFixtureFingerprints(raw), inheritedBefore,
          'inherited protected rows must remain unchanged'); }
        finally {
          await raw.query(`DROP SCHEMA ${schema} CASCADE`);
          assert.equal((await raw.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1', [schema])).rows[0].n, 0);
        }
      } finally { await raw.end(); }
    } };
}

// Seeded cross-engine algorithm proof only: no source data or operating history is copied.
export async function seedTimingPostgresDay({ pool, end, revision, secret }) {
  const producer = await createAuditFixture({ end, revision, secret });
  try {
    assert.equal(producer.coverage.verified, true);
    assert.equal(producer.coverage.proof.checkpointCount, 1441);
    for (const source of producer.coverage.sources) assert.equal(source.counts.census, 0);
    const rows = (await producer.db.query(`SELECT id,tenant_id,suite_name,ok,total,passed,failed,report,source,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM pbk_eval_runs ORDER BY created_at,id`)).rows;
    assert.equal(rows.length, 1443);
    const namespaces = new Set(['runtime_coverage_v1', 'runtime_coverage_control_v1', 'runtime_source_evidence_v1']);
    for (const row of rows) {
      assert(namespaces.has(row.suite_name));
      assert.equal(row.tenant_id, 'pbk');
      assert.equal(row.ok, false);
      assert.equal(row.total + row.passed + row.failed, 0);
      assert(Buffer.byteLength(JSON.stringify(row.report)) <= 8192);
    }
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    assert(bytes < 16 * 1024 * 1024);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      assert.equal((await client.query('SELECT count(*)::int AS n FROM public.pbk_eval_runs')).rows[0].n, 0,
        'seed only an empty isolated proof fixture');
      for (let offset = 0; offset < rows.length; offset += 100) {
        await client.query(`INSERT INTO public.pbk_eval_runs
          SELECT * FROM jsonb_populate_recordset(NULL::public.pbk_eval_runs,$1::jsonb)`,
        [JSON.stringify(rows.slice(offset, offset + 100))]);
      }
      const copied = (await client.query(`SELECT id,tenant_id,suite_name,ok,total,passed,failed,report,source,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
        FROM public.pbk_eval_runs ORDER BY created_at,id`)).rows;
      assert.deepEqual(copied, rows, 'exact SQL/JSONB proof survives cross-engine storage');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    const control = rows.find(row => row.suite_name === 'runtime_coverage_control_v1').report;
    return { checkpointCount: 1441, rowCount: rows.length, bytes,
      reference: producer.coverage.proof.reference,
      previous: rows.find(row => row.id === control.headId).report };
  } finally { await producer.close(); }
}
