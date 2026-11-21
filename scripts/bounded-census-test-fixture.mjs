import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

export const CENSUS_SOURCE_SCHEMA_SQL = `
  CREATE TABLE activity_log(id text PRIMARY KEY,workspace_id text DEFAULT 'pbk',source text DEFAULT 'runtime-event:fixture',
    status text DEFAULT 'success',category text DEFAULT 'EVENT',text text DEFAULT '',metadata jsonb DEFAULT '{}',
    created_at timestamptz,updated_at timestamptz);
  CREATE TABLE conversation_events(id uuid PRIMARY KEY,workspace_id text DEFAULT 'pbk',source_table text,source_id text,
    event_type text,channel text,direction text,status text,body text,payload jsonb,created_at timestamptz,
    updated_at timestamptz,occurred_at timestamptz);
  CREATE TABLE pbk_qa_audit(id text PRIMARY KEY,tenant_id text DEFAULT 'pbk',tool_name text,passed boolean,skipped boolean,
    reason text,validator text,retry_count int,params jsonb,result jsonb,qa jsonb,source text,created_at timestamptz);
  CREATE TABLE pbk_safety_audit(id text PRIMARY KEY,tenant_id text DEFAULT 'pbk',tool_name text,blocked boolean,
    approval_required boolean,params jsonb,validation jsonb,source text,created_at timestamptz);
  CREATE TABLE pbk_eval_runs(id text PRIMARY KEY,tenant_id text,suite_name text,ok boolean,total int,passed int,
    failed int,report jsonb,source text,created_at timestamptz);
  CREATE TABLE approvals(id text PRIMARY KEY,status text,payload jsonb);
  CREATE TABLE provider_action_dispatches(approval_id text PRIMARY KEY,status text,binding_hash text);
  CREATE TABLE event_dead_letters(id text PRIMARY KEY,tenant_id text,payload jsonb);
  CREATE TABLE calls(id text PRIMARY KEY,status text);
  CREATE TABLE messages(id text PRIMARY KEY,body text);
  CREATE TABLE contracts(id text PRIMARY KEY,status text);
  INSERT INTO approvals VALUES ('guard-approval','pending','{"requiresApproval":true}');
  INSERT INTO provider_action_dispatches VALUES ('guard-approval','reconciliation_required',NULL);
  INSERT INTO event_dead_letters VALUES ('guard-dead-letter','pbk','{"fixture":true}');
  INSERT INTO calls VALUES ('guard-call','completed');
  INSERT INTO messages VALUES ('guard-message','fixture only');
  INSERT INTO contracts VALUES ('guard-contract','draft');
`;

export async function protectedCensusFingerprints(query) {
  const result = {};
  for (const table of ['approvals', 'provider_action_dispatches', 'event_dead_letters', 'calls', 'messages', 'contracts']) {
    result[table] = (await query(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM public.${table} t`)).rows[0];
  }
  return result;
}

export async function createBoundedCensusFixture({ count = 0, textBytes = 1024 } = {}) {
  const db = new PGlite();
  let wall = Date.parse('2026-11-17T12:00:00.000Z'), mono = 100, queries = [], operationStarted = 0;
  const stats = { peakRows: 0, peakBytes: 0, peakQueryMs: 0, peakOperationMs: 0,
    slowestQuery: null, operations: 0 };
  try {
    await db.exec(CENSUS_SOURCE_SCHEMA_SQL);
    if (count) await db.query(`INSERT INTO activity_log(id,text,created_at,updated_at)
      SELECT 'retained-' || lpad(n::text,9,'0'),repeat('x',$2),$3::timestamptz,$3::timestamptz
      FROM generate_series(1,$1) n`, [count, textBytes, new Date(wall - 86400000).toISOString()]);
    await db.exec(readFileSync(new URL('./migrations/20261117-bounded-census.sql', import.meta.url), 'utf8'));
  } catch (error) { await db.close(); throw error; }
  const query = async (config, values) => {
    const started = performance.now();
    const text = typeof config === 'string' ? config : config.text;
    values = typeof config === 'string' ? values : config.values;
    let result;
    try {
      result = text.includes('clock_timestamp() AS coverage_now')
        ? { rows: [{ coverage_now: new Date(wall) }] } : await db.query(text, values);
    } catch (error) {
      queries.push({ text, rows: 0, bytes: 0, elapsedMs: performance.now() - started,
        sqlState: typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : null });
      throw error;
    }
    const elapsedMs = performance.now() - started;
    if (elapsedMs > 2000) console.info(JSON.stringify({ fixtureSlowQueryMs: elapsedMs,
      statement: text.slice(0, 160) }));
    const sourcePage = text.includes('pbk_census_page(') || text.includes('pbk_census_journal_page(');
    const projectedBytes = sourcePage ? result.rows.reduce((sum, row) => sum + Number(row.projection_bytes || 0), 0) : 0;
    const dependencyRows = text.includes('WITH RECURSIVE walk')
      ? Number(result.rows[0]?.visited || 0) + Number(result.rows[0]?.journal_count || 0) : 0;
    const dependencyBytes = text.includes('WITH RECURSIVE walk')
      ? Number(result.rows[0]?.bytes || 0) + Number(result.rows[0]?.journal_bytes || 0) : 0;
    queries.push({ text, rows: result.rows.length + dependencyRows,
      bytes: Buffer.byteLength(JSON.stringify(result.rows)) + projectedBytes + dependencyBytes, elapsedMs });
    return result;
  };
  const pool = { query, connect: async () => ({ query, release: destroy => {
    if (destroy) void db.exec('ROLLBACK').catch(() => {});
  } }) };
  return { db, pool, stats, now: () => wall, monotonicNow: () => mono,
    advance(ms = 60000) { wall += ms; mono += ms; },
    beginOperation() { queries = []; operationStarted = performance.now(); stats.operations++; },
    endOperation() {
      const rows = queries.reduce((sum, q) => sum + q.rows, 0);
      const bytes = queries.reduce((sum, q) => sum + q.bytes, 0);
      const elapsedMs = performance.now() - operationStarted;
      stats.peakRows = Math.max(stats.peakRows, rows); stats.peakBytes = Math.max(stats.peakBytes, bytes);
      for (const query of queries) if (query.elapsedMs > stats.peakQueryMs) {
        stats.peakQueryMs = query.elapsedMs; stats.slowestQuery = query.text.slice(0, 160);
      }
      stats.peakOperationMs = Math.max(stats.peakOperationMs, elapsedMs);
      return { rows, bytes, queries, elapsedMs };
    },
    close: () => db.close() };
}
