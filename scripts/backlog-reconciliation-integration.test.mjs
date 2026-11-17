import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
import ts from 'typescript';
import { test } from '@jest/globals';
import { collectBacklogReconciliation } from './backlog-reconciliation-collector.mjs';
import { executeBacklogReconciliation, readBacklogReconciliation } from './backlog-reconciliation-store.mjs';
import { buildExecutedReadinessEvidence } from './production-maturity-loop.mjs';

function bridgeFunctions() {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const find = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const snapshot = find('buildProductionMaturitySnapshot');
  const scorer = find('buildCallQaScore');
  assert(snapshot && scorer, 'Exercise actual bridge functions without importing startup side effects');
  return { snapshotCode: snapshot.getText(ast), scorerCode: scorer.getText(ast) };
}
const { snapshotCode, scorerCode } = bridgeFunctions();
const script = new Script(`(${snapshotCode})()`);
function fixtureScore(transcript) {
  return new Script(`(${scorerCode})({ transcript })`).runInNewContext({
    transcript, classifyPbkIntent: () => ({}),
    buildHumanCommunicationProfile: () => ({ safety: { avoidJokes: false } }),
  });
}
const revision = 'a'.repeat(40);
const secret = randomBytes(32).toString('hex');

function maturityFixture() {
  const calls = [];
  const pool = {};
  const now = Date.now();
  const counts = { dispatchesLocked: 6, deadLettersOpen: 4, qaRecovered: 4,
    qaUnverified: 0, memoryVerified: 1, memoryUnverified: 3 };
  const report = { verified: true, runId: 'reconciliation-current', executedAt: new Date(now).toISOString(),
    source: 'postgres:pbk_eval_runs', result: 'backlog_reconciliation_verified',
    reconciliation: { counts },
    // A supplementary report must not be able to smuggle replacement launch evidence.
    evidence: { silentErrors: { passed: true } }, ready: true, launchQualified: true };
  const context = {
    process: { env: { RENDER_GIT_COMMIT: revision } }, BUILD_REVISION: revision,
    BRIDGE_API_KEY: 'fixture-authority', RELEASE_QUALIFICATION_CASES: [],
    AVA_REAL_CALL_EVAL_SCENARIOS: [], getRuntimeMeta: () => ({}), getPgPool: () => pool,
    getRuntimeEventArchiveStatus: () => ({ ready: true }),
    getProviderCircuitStatus: () => ({ ready: true, openProviders: [] }),
    buildAgentOrchestrationSnapshot: () => ({ measurement: { ready: true } }),
    productionReadinessMonitor: { getSloStatus: () => ({}) },
    readReleaseQualification: async () => ({ verified: true, qualification: { ready: false }, evidence: {} }),
    readOperationalAudit: async () => ({ verified: true, runId: 'audit-failed', audit: { ready: false },
      evidence: { silentErrors: { runId: 'audit-failed', revision, executedAt: new Date(now).toISOString(),
        executed: true, passed: false, provenance: 'operational', scope: 'durable_operational_audit' } } }),
    readBacklogReconciliation: async options => {
      assert.equal(options.pool, pool);
      assert.equal(options.revision, revision);
      await options.collect({ now });
      return report;
    },
    collectBacklogReconciliation: async options => { calls.push(options); return { ok: true }; },
    buildExecutedReadinessEvidence,
    isoNow: () => new Date(now).toISOString(),
  };
  return { context, report, calls, pool, now };
}

test('actual maturity snapshot displays recovery but never merges it into audit or launch proof', async () => {
  const f = maturityFixture();
  const result = await script.runInNewContext(f.context);
  assert.deepEqual(result.backlogReconciliation.counts, f.report.reconciliation.counts);
  assert.equal(result.backlogReconciliation.verified, true);
  assert.equal(result.backlogReconciliation.launchQualified, false);
  assert.equal(result.backlogReconciliation.noContact, true);
  assert.equal(result.backlogReconciliation.providerWritesBlocked, true);
  assert.equal(result.operationalAudit.ready, false);
  assert.equal(result.executionEvidence.silentErrorReport.launchReady, false);
  assert.equal(result.canaryPromotionGate.ready, false);
  assert.equal(result.ready, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].pool, f.pool);
  assert.equal(f.calls[0].now, f.now);
});

test('actual maturity snapshot drops stale source evidence instead of caching prior recovery counts', async () => {
  const f = maturityFixture();
  assert.equal((await script.runInNewContext(f.context)).backlogReconciliation.verified, true);
  f.report.verified = false;
  f.report.result = 'backlog_reconciliation_source_unverified';
  const result = await script.runInNewContext(f.context);
  assert.equal(result.backlogReconciliation.verified, false);
  assert.equal(result.backlogReconciliation.counts, null);
  assert.equal(result.backlogReconciliation.runId, null);
  assert.equal(result.backlogReconciliation.launchQualified, false);
  assert.equal(result.ready, false);
  assert.equal(f.calls.length, 2);
});

const postgresTest = process.env.PBK_TEST_DATABASE_URL ? test : test.skip;
postgresTest('disposable Postgres binds real source/QA/memory evidence without mutating source rows', async () => {
  const url = process.env.PBK_TEST_DATABASE_URL;
  assert.equal(url, process.env.PBK_EVAL_DATABASE_URL);
  assert(new URL(url).hostname.endsWith('.neon.tech'));
  assert.match(process.env.PBK_NEON_EVAL_BRANCH_ID || '', /^br-/);
  for (const name of ['PBK_DATABASE_URL', 'DATABASE_URL', 'PBK_MIGRATION_DATABASE_URL']) {
    assert(!process.env[name], 'Production runtime database configuration must be scrubbed');
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  const schema = `brc_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^brc_[a-f0-9]{32}$/);
  const ids = Array.from({ length: 3 }, () => `reconciliation-integration-${randomUUID()}`);
  const statements = [];
  // Fixed source SQL is schema-remapped only in this disposable test, never in production.
  const sources = { async connect() {
    const client = await pool.connect();
    return { query(config) {
      const text = typeof config === 'string' ? config : config.text;
      statements.push(text);
      const mapped = text.replaceAll('public.', `${schema}.`);
      return client.query(typeof config === 'string' ? mapped : { ...config, text: mapped });
    }, release(destroy) { client.release(destroy); } };
  } };
  const collect = ({ now }) => collectBacklogReconciliation({ pool: sources, secret, now });
  const read = () => readBacklogReconciliation({ pool, revision, secret, collect });
  const run = id => executeBacklogReconciliation({ pool, revision, secret, collect, createId: () => id });
  const tables = ['provider_action_dispatches', 'approvals', 'event_dead_letters', 'pbk_call_qa_scores', 'call_embeddings'];
  const sourceRows = async () => {
    const rows = [];
    for (const table of tables) rows.push((await pool.query(`SELECT to_jsonb(t) row FROM ${schema}.${table} t ORDER BY to_jsonb(t)::text`)).rows);
    return JSON.stringify(rows);
  };
  try {
    await pool.query(`CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.provider_action_dispatches(approval_id text PRIMARY KEY,workspace_id text,
        tool_name text,binding_hash text,status text,result jsonb,error text,created_at timestamptz,updated_at timestamptz);
      CREATE TABLE ${schema}.approvals(id text PRIMARY KEY,workspace_id text,status text,payload jsonb,
        created_at timestamptz,updated_at timestamptz);
      CREATE TABLE ${schema}.event_dead_letters(id text PRIMARY KEY,tenant_id text,event_id text,event_type text,
        source text,payload jsonb,error text,created_at timestamptz);
      CREATE TABLE ${schema}.pbk_call_qa_scores(id text PRIMARY KEY,tenant_id text,call_id text,
        transcript_snippet text,metadata jsonb,created_at timestamptz,score numeric,grade text,
        breakdown jsonb,weaknesses jsonb,next_actions jsonb);
      CREATE TABLE ${schema}.call_embeddings(id text PRIMARY KEY,workspace_id text,call_id text,source_text text,
        transcript_hash text,embedding_model text,embedding text,synthetic boolean,metadata jsonb,
        created_at timestamptz,updated_at timestamptz);
      CREATE TABLE IF NOT EXISTS public.pbk_eval_runs(id text PRIMARY KEY,tenant_id text NOT NULL DEFAULT 'pbk',
        suite_name text NOT NULL,ok boolean NOT NULL DEFAULT false,total int NOT NULL DEFAULT 0,
        passed int NOT NULL DEFAULT 0,failed int NOT NULL DEFAULT 0,report jsonb NOT NULL DEFAULT '{}',
        source text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
    const at = new Date(Date.now() - 60_000).toISOString();
    for (let i = 0; i < 6; i++) {
      await pool.query(`INSERT INTO ${schema}.provider_action_dispatches VALUES
        ($1,'pbk','fixture-tool','',$2,$3,'fixture failure',$4,$4)`,
      [`fixture-dispatch-${i}`, i ? 'dispatching' : 'reconciliation_required',
        JSON.stringify({ providerProof: { verified: true } }), at]);
    }
    for (let i = 0; i < 4; i++) {
      const text = i === 2 ? 'A fictional internal fixture describes a repair estimate and a request to review the numbers later. '.repeat(2).trim() : `Short internal fixture ${i}.`;
      await pool.query(`INSERT INTO ${schema}.event_dead_letters VALUES
        ($1,'pbk',$2,'call.completed','telnyx-deepgram-finalize',$3,'fixture failure',$4)`,
      [`fixture-dead-${i}`, `fixture-event-${i}`, JSON.stringify({ workspaceId: 'pbk', callId: `fixture-call-${i}`, transcript: text }), at]);
      const scored = fixtureScore(text);
      await pool.query(`INSERT INTO ${schema}.pbk_call_qa_scores VALUES ($1,'pbk',$2,$3,'{}',$4,$5,$6,$7,$8,$9)`,
        [`call-qa-event-fixture-event-${i}`, `fixture-call-${i}`, text, at, scored.total, scored.grade,
          JSON.stringify(scored.breakdown), JSON.stringify(scored.weaknesses), JSON.stringify(scored.nextActions)]);
      if (i === 2) await pool.query(`INSERT INTO ${schema}.call_embeddings VALUES
        ('fixture-memory','pbk',$1,$2,$3,'text-embedding-3-small',$4,false,'{}',$5,$5)`,
      [`fixture-call-${i}`, text, createHash('sha256').update(text).digest('hex'),
        JSON.stringify(Array.from({ length: 1536 }, (_, n) => n === 0 ? 0.5 : 0)), at]);
    }
    const before = await sourceRows();
    const first = await run(ids[0]);
    assert.equal(first.verified, true, first.result);
    assert.deepEqual(first.reconciliation.counts, { dispatchesLocked: 6, deadLettersOpen: 4,
      qaRecovered: 4, qaUnverified: 0, memoryVerified: 1, memoryUnverified: 3 });
    assert(first.reconciliation.dispatches.every(row => row.status === 'manual_review_locked'));
    assert(first.reconciliation.deadLetters.every(row => row.fullRecovery === 'unverified'));
    assert.equal(first.launchQualified, false);
    assert.equal((await read()).verified, true);
    assert.equal(await sourceRows(), before, 'Collector, store and readback cannot mutate any source lane');
    const persisted = (await pool.query('SELECT ok,passed,failed,total FROM public.pbk_eval_runs WHERE id=$1', [ids[0]])).rows[0];
    assert.deepEqual(persisted, { ok: false, passed: 0, failed: 10, total: 10 });
    assert(!/fixture-call|fixture-dead|fixture-dispatch|fictional internal|fixture failure/.test(JSON.stringify(first)));
    for (const text of statements) {
      assert.match(text.trim(), /^(SELECT|BEGIN|SET LOCAL|ROLLBACK)\b/i);
      assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
    }
    await pool.query(`UPDATE ${schema}.pbk_call_qa_scores SET transcript_snippet='changed fixture' WHERE id='call-qa-event-fixture-event-0'`);
    assert.equal((await read()).verified, false, 'Changed proof invalidates the previous signed snapshot');
    const second = await run(ids[1]);
    assert.equal(second.verified, true, second.result);
    assert.equal(second.reconciliation.counts.qaRecovered, 3);
    assert.notEqual(second.reconciliation.sourceFingerprint, first.reconciliation.sourceFingerprint);
    const failed = await executeBacklogReconciliation({ pool, revision, secret, createId: () => ids[2],
      collect: async () => { throw new Error('fixture source unavailable'); } });
    assert.equal(failed.verified, false);
    assert.equal((await read()).verified, false, 'Newer pending admission blocks older valid evidence');
  } finally {
    try {
      await pool.query('DELETE FROM public.pbk_eval_runs WHERE id=ANY($1::text[])', [ids]);
      assert.match(schema, /^brc_[a-f0-9]{32}$/);
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally { await pool.end(); }
  }
}, 60_000);
