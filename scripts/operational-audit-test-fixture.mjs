import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createRuntimeCoverageSampler } from './runtime-coverage-sampler.mjs';
import { readRuntimeCoverage } from './runtime-coverage-store.mjs';
import { createOperationalAuditPool } from './operational-audit-store.mjs';
import { DEAD_LETTER_CLOSURE_SQL, verifyDeadLetterClosureInstallation } from './dead-letter-closure-migration.mjs';

export const auditFixtureHealth = () => ({ authenticationConfigured: true, bootstrapReady: true,
  archiveReady: true, providerCircuitsReady: true, observabilityReady: true,
  eventBusConnected: true, approvalMode: 'approval' });

// Real isolated source/checkpoint SQL and HMAC validation; only the trusted DB clock is virtual.
export async function createAuditFixture({ end, revision, secret, duration = 86400000 }) {
  assert(Number.isSafeInteger(end) && Number.isSafeInteger(duration) && duration >= 0
    && duration <= 86400000 && duration % 60000 === 0, 'fixture clock/window must be bounded');
  const db = new PGlite();
  let wall = end - duration, mono = 100;
  const statements = [];
  let intercept;
  const query = async (config, values) => {
    const text = typeof config === 'string' ? config : config.text;
    values = typeof config === 'string' ? values : config.values;
    statements.push({ text, values });
    const result = await intercept?.(text, values);
    return result ?? db.query(text.replaceAll('clock_timestamp()', `to_timestamp(${wall / 1000})`), values);
  };
  const pool = createOperationalAuditPool({ query, connect: async () => ({ query, release(destroy) {
    if (destroy) void db.exec('ROLLBACK').catch(() => {});
  } }) });
  await db.exec(`
    CREATE TABLE activity_log(id text PRIMARY KEY,workspace_id text DEFAULT 'pbk',source text DEFAULT 'runtime-event:pbk',
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
    CREATE TABLE provider_action_dispatches(approval_id text PRIMARY KEY,workspace_id text DEFAULT 'pbk',status text,
      created_at timestamptz,updated_at timestamptz,dispatch_started_at timestamptz,completed_at timestamptz,
      reconciliation_required_at timestamptz);
    CREATE TABLE event_dead_letters(id text PRIMARY KEY,tenant_id text DEFAULT 'pbk',event_id text,event_type text,
      source text,payload jsonb,error text,created_at timestamptz);
    CREATE TABLE approvals(id text PRIMARY KEY,workspace_id text DEFAULT 'pbk',type text,status text,payload jsonb,
      decided_at timestamptz,created_at timestamptz,updated_at timestamptz,lead_id text);
    CREATE TABLE calls(id text PRIMARY KEY,workspace_id text,provider text,telnyx_call_control_id text,
      telnyx_call_leg_id text,telnyx_call_session_id text,transcript jsonb,notes text,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE pbk_call_qa_scores(id text PRIMARY KEY,tenant_id text,call_id text,score numeric,grade text,
      breakdown jsonb,transcript_snippet text,metadata jsonb,created_at timestamptz);
    CREATE TABLE call_embeddings(id text PRIMARY KEY,workspace_id text,call_id text,source_text text,transcript_hash text,
      synthetic boolean,embedding_model text,embedding text,metadata jsonb,created_at timestamptz,updated_at timestamptz);
  `);
  const otherTables = ['bridge_state', 'lead_profiles', 'lead_imports', 'contracts', 'unified_messages',
    'pbk_memories', 'pbk_knowledge', 'pbk_feedback', 'pbk_intent_events', 'pbk_local_commands',
    'conversation_threads', 'conversation_thread_identities', 'communication_sender_identities'];
  for (const table of otherTables) await db.exec(`CREATE TABLE ${table}(id text PRIMARY KEY)`);
  // The real targeted migration/verifier runs only in this disposable in-process database.
  await db.exec(DEAD_LETTER_CLOSURE_SQL);
  assert.equal((await verifyDeadLetterClosureInstallation((sql, values) => db.query(sql, values))).verified, true);
  const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  for (const { tablename } of tables.rows) await db.exec(`ALTER TABLE ${tablename} ENABLE ROW LEVEL SECURITY`);
  const sampler = createRuntimeCoverageSampler({ pool, secret, revision, enabled: true, hosted: true,
    health: auditFixtureHealth, now: () => wall, monotonicNow: () => mono, bootId: 'audit-fixture-boot' });
  assert.equal((await sampler.sample()).verified, true);
  for (let elapsed = 0; elapsed < duration; elapsed += 60000) {
    wall += 60000; mono += 60000;
    assert.equal((await sampler.sample()).verified, true);
  }
  const coverage = await readRuntimeCoverage({ pool, secret, revision, now: () => wall });
  assert.equal(coverage.verified, duration >= 86400000, JSON.stringify(coverage));
  return { db, pool, sampler, coverage, statements, now: () => wall,
    advance(ms) { wall += ms; mono += ms; }, intercept(fn) { intercept = fn; },
    async close() { sampler.stop(); await db.close(); } };
}
