import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { applyTargetedReadinessMigration } from './targeted-readiness-migration.mjs';
import { recordCallMemorySkip, readCallMemorySkipSummary } from './call-memory-outcome-store.mjs';
import { validateTargetedEvalTarget } from './targeted-readiness-eval-guard.mjs';
import { createTimingPostgresFixture, seedTimingPostgresDay, assertCoverageOnlyAudit } from './readiness-timing-postgres-fixture.mjs';
import { withRuntimeEvidenceContext } from './runtime-evidence-context.mjs';
import { captureRuntimeSourceWriteBinding, runtimeSourceWriteReturning, recordRuntimeSourceEvidence,
  prepareRuntimeSourceObservation, collectRuntimeSourceSnapshotInTransaction,
  collectRuntimeSourceSnapshot } from './runtime-source-evidence.mjs';
import { createRuntimeCoverageSampler } from './runtime-coverage-sampler.mjs';
import { appendRuntimeCoverageCheckpoint, readRuntimeCoverage, verifyRuntimeCoverageReference } from './runtime-coverage-store.mjs';
import { executeOperationalAudit, readOperationalAudit } from './operational-audit-store.mjs';
import { collectOperationalAudit } from './operational-audit-collector.mjs';

test('disposable Postgres validates targeted DDL and signed skip readback without source recovery', async () => {
  const url = process.env.PBK_TEST_DATABASE_URL;
  assert(url && url === process.env.PBK_EVAL_DATABASE_URL, 'Use the dedicated disposable evaluation harness');
  assert(new URL(url).hostname.endsWith('.neon.tech'), 'Never run this fixture against Render');
  assert.match(process.env.PBK_NEON_EVAL_BRANCH_ID || '', /^br-[a-z0-9-]+$/);
  assert.match(process.env.PBK_NEON_EVAL_BRANCH_NAME || '', /^pbk-eval-targeted-readiness-/);
  assert(!process.env.PBK_DATABASE_URL && !process.env.DATABASE_URL, 'Runtime targets must be scrubbed');
  const { connectionConfig } = await validateTargetedEvalTarget();
  const pool = new pg.Pool({ ...connectionConfig, max: 1,
    connectionTimeoutMillis: 10000, query_timeout: 15000 });
  const client = await pool.connect();
  let released = false;
  const sql = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  try {
    // This named throwaway branch is discarded by the harness, never a shared/live schema.
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await client.query(sql('20260430001000_pbk_operational_schema.sql'));
    await client.query(sql('20260430000000_pbk_bridge_state.sql'));
    await client.query(sql('20260503010000_pbk_activity_log.sql'));
    await client.query(sql('20260506000000_pbk_hyper_intelligence.sql').split('DELETE FROM public.pbk_knowledge')[0]);
    await client.query(sql('20260529014000_pbk_eval_safety.sql'));
    await client.query(`ALTER TABLE public.calls
      ADD COLUMN IF NOT EXISTS telnyx_call_control_id text DEFAULT '',
      ADD COLUMN IF NOT EXISTS telnyx_call_leg_id text DEFAULT '',
      ADD COLUMN IF NOT EXISTS telnyx_call_session_id text DEFAULT '';
      CREATE TABLE public.event_dead_letters (id text PRIMARY KEY,tenant_id text NOT NULL DEFAULT 'pbk',
        event_id text NOT NULL,event_type text NOT NULL,source text NOT NULL,payload jsonb NOT NULL,
        error text NOT NULL DEFAULT '',stack text NOT NULL DEFAULT '',created_at timestamptz NOT NULL);
      CREATE TABLE public.provider_action_dispatches (approval_id text PRIMARY KEY,
        workspace_id text NOT NULL DEFAULT 'pbk',status text NOT NULL);
      INSERT INTO public.approvals (id,status,payload) VALUES
        ('fixture-approval','pending','{"requiresApproval":true}');
      INSERT INTO public.provider_action_dispatches VALUES ('fixture-approval','pbk','reconciliation_required');
      INSERT INTO public.bridge_state (id,data) VALUES ('pbk','{"mode":"approval","locked":true}');
      DROP TABLE public.unified_messages;`);
    const identity = (await client.query('SELECT current_database() AS database,current_user AS role')).rows[0];
    const guards = async () => ({
      approvals: (await client.query('SELECT to_jsonb(a) AS row FROM public.approvals a')).rows,
      dispatches: (await client.query('SELECT to_jsonb(d) AS row FROM public.provider_action_dispatches d')).rows,
      state: (await client.query('SELECT to_jsonb(s) AS row FROM public.bridge_state s')).rows,
      deadLetters: (await client.query('SELECT to_jsonb(d) AS row FROM public.event_dead_letters d ORDER BY id')).rows,
      calls: (await client.query('SELECT to_jsonb(c) AS row FROM public.calls c ORDER BY id')).rows,
    });
    const before = await guards();
    const options = { expectedDatabase: identity.database, expectedRole: identity.role };
    await applyTargetedReadinessMigration(client, options);
    await applyTargetedReadinessMigration(client, options);
    assert.deepEqual(await guards(), before);
    assert.equal((await client.query(`SELECT relrowsecurity FROM pg_class
      WHERE oid='public.unified_messages'::regclass`)).rows[0].relrowsecurity, true);
    await client.query(`INSERT INTO public.unified_messages
      (id,workspace_id,channel,direction,storage_path,processed_for_learning,learning_metadata)
      VALUES ('fixture-message','pbk','call','recording','fixture/audio',true,'{"fixture":true}')`);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.unified_messages')).rows[0].n, 1);
    const revision = 'a'.repeat(40);
    const secret = randomBytes(32).toString('hex');
    const eventId = `fixture-event-${randomUUID()}`;
    const callId = `fixture-call-${randomUUID()}`;
    const text = 'Please call after lunch.';
    await client.query(`INSERT INTO public.event_dead_letters
      (id,tenant_id,event_id,event_type,source,payload,created_at)
      VALUES ($1,'pbk',$2,'call.completed','telnyx-deepgram-finalize',$3,$4)`,
    [randomUUID(), eventId, JSON.stringify({ workspaceId: 'pbk', callId, transcript: text }),
      new Date(Date.now() - 2000).toISOString()]);
    const beforeProof = await guards();
    client.release();
    released = true;
    const receipt = await recordCallMemorySkip({ pool, revision, secret, eventId, callId, sourceText: text });
    assert.equal(receipt.verified, true, receipt.result);
    const readback = await readCallMemorySkipSummary({ pool, revision, secret });
    assert.equal(readback.verified, true, JSON.stringify(readback.issues));
    assert.equal(readback.embeddingVerified, false);
    assert.equal(readback.fullRecovery, false);
    assert.equal(readback.launchQualified, false);
    assert.equal(readback.counts.verifiedSkips, 1);
    const afterProof = {};
    for (const [key, table] of Object.entries({ approvals: 'approvals', dispatches: 'provider_action_dispatches',
      state: 'bridge_state', deadLetters: 'event_dead_letters', calls: 'calls' })) {
      afterProof[key] = (await pool.query(`SELECT to_jsonb(t) AS row FROM public.${table} t${['deadLetters', 'calls'].includes(key) ? ' ORDER BY id' : ''}`)).rows;
    }
    assert.deepEqual(afterProof, beforeProof);
    assert.equal((await pool.query('SELECT status FROM public.provider_action_dispatches')).rows[0].status,
      'reconciliation_required');
    assert.equal((await pool.query('SELECT status FROM public.approvals')).rows[0].status, 'pending');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.event_dead_letters')).rows[0].n, 1);
    await pool.query(`UPDATE public.pbk_eval_runs SET report=jsonb_set(report,'{outcome}','"delivered"')
      WHERE suite_name='call_memory_skip_v1'`);
    assert.equal((await readCallMemorySkipSummary({ pool, revision, secret })).verified, false);
  } finally {
    if (!released) client.release(true);
    await pool.end();
  }
});

test('real disposable Postgres source writes, leases and atomic checkpoints are not operating history', { timeout: 180000 }, async t => {
  const { connectionConfig } = await validateTargetedEvalTarget();
  const f = await createTimingPostgresFixture(connectionConfig);
  const { pool, now, monotonicNow } = f;
  const revision = 'a'.repeat(40), secret = randomBytes(32).toString('hex');
  const health = () => ({ authenticationConfigured: true, bootstrapReady: true, archiveReady: true,
    providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true, approvalMode: 'approval' });
  const sampler = createRuntimeCoverageSampler({ pool, secret, revision, now, monotonicNow,
    enabled: true, hosted: true, health, bootId: 'disposable-postgres-algorithm-only' });
  const read = () => readRuntimeCoverage({ pool, secret, revision, now });
  const sourceSnapshot = async () => {
    const client = await pool.connect();
    try { return await collectRuntimeSourceSnapshot({ client, secret, revision, now,
      windowStart: now() - 86400000, windowEnd: now() }); }
    finally { client.release(); }
  };
  const sentinels = async () => {
    const result = {};
    for (const table of ['approvals', 'provider_action_dispatches', 'event_dead_letters', 'calls']) {
      result[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return result;
  };
  let before;
  try {
    await pool.query(`INSERT INTO public.approvals(id,status) VALUES ('guard-approval','pending');
      INSERT INTO public.provider_action_dispatches(approval_id,status,created_at,updated_at,dispatch_started_at)
        VALUES ('guard-approval','reconciliation_required',to_timestamp(1),to_timestamp(1),to_timestamp(1));
      INSERT INTO public.event_dead_letters(id,source,created_at) VALUES ('guard-dead-letter','controlled',to_timestamp(1));
      INSERT INTO public.calls(id) VALUES ('guard-call');`);
    before = await sentinels();

    await t.test('source admission commits before observation; competing client cannot consume the lease', async () => {
      const a = await pool.connect(), b = await pool.connect();
      const fence = { deadlineAt: performance.now() + 15000, signal: new AbortController().signal, onAbort() {} };
      try {
        const prepared = await prepareRuntimeSourceObservation({ client: a, secret, revision, now, fence });
        assert.equal(prepared.verified, true, prepared.result);
        assert.equal((await prepareRuntimeSourceObservation({ client: b, secret, revision, now, fence })).result,
          'source_observation_busy');
        await a.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const snapshot = await collectRuntimeSourceSnapshotInTransaction({ client: a, secret, revision, now, fence,
          admission: prepared.admission, windowStart: now(), windowEnd: now() });
        assert.equal(snapshot.verified, true, snapshot.result);
        assert.equal(snapshot.transactionPending, true);
        await a.query('COMMIT');
        assert.equal((await sourceSnapshot()).verified, true);
      } finally { await a.query('ROLLBACK'); a.release(); b.release(); }
    });

    const sources = [
      ['runtime_archive', 'activity_log', 'archive-proof',
        "(id,text,created_at,updated_at) VALUES ($1,'private fixture',$2,$2)"],
      ['conversation_projection', 'conversation_events', randomUUID(),
        "(id,status,body,payload,created_at,updated_at,occurred_at) VALUES ($1,'completed','private fixture','{}',$2,$2,$2)"],
      ['qa', 'pbk_qa_audit', 'qa-proof',
        "(id,passed,skipped,created_at) VALUES ($1,true,false,$2)"],
      ['safety', 'pbk_safety_audit', 'safety-proof',
        "(id,blocked,approval_required,created_at) VALUES ($1,false,false,$2)"],
    ];
    await t.test('all four actual INSERT RETURNING projections mint one-use receipts and reread classifications', async () => {
      for (const [sourceKind, table, sourceId, insert] of sources) {
        await withRuntimeEvidenceContext('operator_chat', async () => {
          const row = (await pool.query(`INSERT INTO public.${table} ${insert}
            RETURNING ${runtimeSourceWriteReturning(sourceKind)}`, [sourceId, new Date(now()).toISOString()])).rows[0].runtime_source_row;
          assert.match(row.runtime_write_version, /^\d+$/);
          const writeBinding = captureRuntimeSourceWriteBinding({ secret, revision, sourceKind, row });
          const args = { pool, secret, revision, sourceKind, sourceId, writeBinding, now };
          const receipt = await recordRuntimeSourceEvidence(args);
          assert.equal(receipt.verified, true, `${sourceKind}: ${receipt.result}`);
          assert.equal(receipt.readbackVerified, true);
          assert.equal((await recordRuntimeSourceEvidence(args)).result, 'source_write_binding_unverified');
        });
      }
      const snapshot = await sourceSnapshot();
      assert.equal(snapshot.verified, true, snapshot.result);
      assert.equal(snapshot.sources.length, 4);
      for (const source of snapshot.sources) assert.equal(source.counts.operational, 1, source.sourceKind);
      assert.equal(JSON.stringify(snapshot).includes('private fixture'), false);
    });

    await t.test('actual Postgres anchor cannot claim a day; competing boot cannot append', async () => {
      assert.equal((await sampler.sample()).verified, true);
      const competitor = createRuntimeCoverageSampler({ pool, secret, revision, now, monotonicNow,
        enabled: true, hosted: true, health, bootId: 'competing-boot' });
      try { assert.equal((await competitor.sample()).result, 'coverage_lease_busy'); }
      finally { competitor.stop(); }
      assert.equal((await read()).result, 'coverage_window_incomplete');
      const envelope = (await pool.query(`SELECT count(*)::int AS n FROM public.pbk_eval_runs
        WHERE suite_name='runtime_coverage_v1' AND (ok OR total<>0 OR passed<>0 OR failed<>0)`)).rows[0];
      assert.equal(envelope.n, 0);
    });

    await t.test('source projection, receipt and identical-value tuple-version tamper cannot be blessed', async () => {
      const receipt = (await pool.query("SELECT * FROM public.pbk_eval_runs WHERE suite_name='runtime_source_evidence_v1' AND report->>'sourceKind'='runtime_archive'")).rows[0];
      await pool.query("UPDATE public.pbk_eval_runs SET report=report || '{\"classification\":\"controlled\"}'::jsonb WHERE id=$1", [receipt.id]);
      assert.equal((await sourceSnapshot()).verified, false);
      await pool.query('UPDATE public.pbk_eval_runs SET report=$2::jsonb WHERE id=$1', [receipt.id, JSON.stringify(receipt.report)]);
      f.advance(30001); // Expire the intentionally failed census's disposable admission before testing the writer.
      for (const mutation of ["text='changed projection'", 'id=id']) {
        await withRuntimeEvidenceContext('operator_chat', async () => {
          const sourceKind = 'runtime_archive', sourceId = 'archive-proof';
          const row = (await pool.query(`UPDATE public.activity_log SET id=id WHERE id=$1
            RETURNING ${runtimeSourceWriteReturning(sourceKind)}`, [sourceId])).rows[0].runtime_source_row;
          const writeBinding = captureRuntimeSourceWriteBinding({ secret, revision, sourceKind, row });
          const overwritten = (await pool.query(`UPDATE public.activity_log SET ${mutation} WHERE id=$1
            RETURNING ${runtimeSourceWriteReturning(sourceKind)}`, [sourceId])).rows[0].runtime_source_row;
          assert.notEqual(overwritten.runtime_write_version, row.runtime_write_version);
          const { runtime_write_version: _oldVersion, ...originalProjection } = row;
          const { runtime_write_version: _newVersion, ...newProjection } = overwritten;
          if (mutation === 'id=id') assert.deepEqual(newProjection, originalProjection);
          else assert.notDeepEqual(newProjection, originalProjection);
          let lockedReread = false;
          f.intercept(text => { if (text.includes('runtime_write_version') && text.includes('FOR SHARE')) lockedReread = true; });
          const denied = await recordRuntimeSourceEvidence({ pool, secret, revision, sourceKind, sourceId, writeBinding, now });
          f.intercept(undefined);
          assert.equal(lockedReread, true, 'must reach actual tuple/projection validation, not fail busy');
          assert.equal(denied.result, 'source_evidence_unverified');
          assert.equal(denied.verified, false);
          f.advance(30001); // Expire only the disposable abandoned observation lease, never retry business work.
        });
      }
    });

    await t.test('checkpoint failure rolls back source settlement and checkpoint together, retaining pending control denial', async () => {
      f.advance(120001);
      const beforeCount = (await pool.query("SELECT count(*)::int AS n FROM public.pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].n;
      let injected = false;
      f.intercept(text => {
        if (text.includes('/* coverage-checkpoint */')) { injected = true; throw new Error('isolated checkpoint write failure'); }
      });
      const failed = await sampler.sample();
      f.intercept(undefined);
      assert.equal(injected, true);
      assert.equal(failed.verified, false);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].n, beforeCount);
      assert.equal((await pool.query("SELECT report->>'phase' AS phase FROM public.pbk_eval_runs WHERE suite_name='runtime_coverage_control_v1'")).rows[0].phase, 'pending');
      const inventory = (await pool.query("SELECT report FROM public.pbk_eval_runs WHERE report ? 'admission'")).rows;
      assert.equal(inventory.length, 1);
      assert.notEqual(inventory[0].report.admission, null, 'source settlement rolled back with failed checkpoint');
      assert.equal((await read()).verified, false);
    });
  } finally {
    f.intercept(undefined);
    try { if (before) assert.deepEqual(await sentinels(), before); }
    finally { sampler.stop(); await f.close(); }
    console.log(`Postgres source/atomic proof: ${f.stats.queries} real SQL queries; schema removed; no operating-history claim`);
  }
});

test('seeded cross-engine algorithm and actual Postgres reference/audit proof is not operating history', { timeout: 300000 }, async t => {
  const { connectionConfig } = await validateTargetedEvalTarget();
  const end = Date.now(), revision = 'a'.repeat(40), secret = randomBytes(32).toString('hex');
  const f = await createTimingPostgresFixture(connectionConfig, { start: end, initialMonotonic: 86400100 });
  const { pool, now, monotonicNow } = f;
  const health = () => ({ authenticationConfigured: true, bootstrapReady: true, archiveReady: true,
    providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true, approvalMode: 'approval' });
  const protectedRows = async () => {
    const rows = [];
    for (const table of ['approvals', 'provider_action_dispatches', 'event_dead_letters', 'calls']) {
      rows.push((await pool.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows);
    }
    return rows;
  };
  const before = await protectedRows();
  const verify = reference => verifyRuntimeCoverageReference({ pool, secret, revision, now, reference });
  const auditRead = () => readOperationalAudit({ pool, secret, revision, now: now() });
  const assertAuditDenied = async () => {
    const result = await auditRead();
    assert.equal(result.verified, true, 'the unchanged signed audit envelope remains authenticated');
    assert.equal(result.audit.coverage.verified, false);
    assert.equal(result.audit.ready, false);
    assert.equal(result.audit.checks.find(check => check.id === 'monitoring_continuity').status, 'unverified');
    assert.equal(result.evidence.silentErrors.passed, false);
    assert.deepEqual(result.coverageDiagnostics, { verified: false, result: 'coverage_reference_unverified' });
    assert.equal(result.result, 'operational_audit_incomplete_or_failed');
  };
  let previous, reference;
  // Fixture-only continuation supplies the exact API-generated predecessor to the real writer.
  // It does not claim that a production sampler can resume across a restart.
  const sampler = { status: () => ({ cutoff: previous?.cutoff }), async sample({ cutoff } = {}) {
    const result = await appendRuntimeCoverageCheckpoint({ pool, secret, revision, now, monotonicNow,
      bootId: 'audit-fixture-boot', health: health(), previous, ...(cutoff === undefined ? {} : { cutoff }) });
    if (result.verified) previous = result.report;
    return result;
  } };
  try {
    await t.test('1441 existing-sampler PGlite checkpoints batch-copy exactly and verify on actual Postgres', async () => {
      const started = performance.now();
      const seeded = await seedTimingPostgresDay({ pool, end, secret, revision });
      previous = seeded.previous;
      reference = seeded.reference;
      assert.equal(seeded.checkpointCount, 1441);
      assert.equal(seeded.rowCount, 1443);
      const read = await readRuntimeCoverage({ pool, secret, revision, now });
      assert.equal(read.verified, true, read.result);
      assert.deepEqual(read.proof.reference, reference);
      assert.equal(read.diagnostics.organicCompletions, 0);
      assert.equal(read.diagnostics.fleetQualified, false);
      assert.equal((await verify(reference)).verified, true);
      console.log(`Seeded cross-engine algorithm proof: 1441 API-generated checkpoints, ${seeded.rowCount} exact proof rows, ${seeded.bytes} bytes, ${(performance.now() - started).toFixed(1)}ms; NOT 1441 Postgres appends or operating history`);
    });

    await t.test('real Postgres audit/reference readback survives actual head advancement and rejects durable tamper', async () => {
      assert(reference, 'seeded durable proof must complete');
      const result = await executeOperationalAudit({ pool, secret, revision, now,
        createId: () => 'postgres-durable-audit', collect: args => collectOperationalAudit({ ...args,
          secret, revision, sampler, runtime: health() }) });
      assertCoverageOnlyAudit(result);
      f.advance();
      const appended = await sampler.sample();
      assert.equal(appended.verified, true, appended.result);
      assert.deepEqual((await verify(reference)).proof.reference, reference);
      assertCoverageOnlyAudit(await auditRead());
      const control = (await pool.query("SELECT * FROM public.pbk_eval_runs WHERE suite_name='runtime_coverage_control_v1'")).rows[0];
      for (const id of [reference.first.id, control.report.headId, control.id]) {
        const row = (await pool.query('SELECT * FROM public.pbk_eval_runs WHERE id=$1', [id])).rows[0];
        await pool.query("UPDATE public.pbk_eval_runs SET report=report || '{\"signature\":\"tampered\"}'::jsonb WHERE id=$1", [id]);
        assert.equal((await verify(reference)).verified, false, 'historical/current/control tamper must reject saved reference');
        await assertAuditDenied();
        await pool.query('UPDATE public.pbk_eval_runs SET report=$2::jsonb WHERE id=$1', [id, JSON.stringify(row.report)]);
        const restored = await auditRead();
        assertCoverageOnlyAudit(restored);
      }
      assert.equal((await verify({ ...reference, orderedRoot: '0'.repeat(64) })).verified, false);
      const receipt = (await pool.query("SELECT * FROM public.pbk_eval_runs WHERE suite_name='runtime_source_evidence_v1'")).rows[0];
      await pool.query("UPDATE public.pbk_eval_runs SET report=report || '{\"signature\":\"tampered\"}'::jsonb WHERE id=$1", [receipt.id]);
      assert.equal((await verify(reference)).verified, false, 'tampered fresh source inventory blocks historical proof');
      await assertAuditDenied();
      await pool.query('UPDATE public.pbk_eval_runs SET report=$2::jsonb WHERE id=$1', [receipt.id, JSON.stringify(receipt.report)]);
    });

    await t.test('post-seed actual checkpoint failure retains atomic rollback and pending audit/reference denial', async () => {
      f.advance(120001);
      const count = (await pool.query("SELECT count(*)::int AS n FROM public.pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].n;
      let injected = false;
      f.intercept(text => {
        if (text.includes('/* coverage-checkpoint */')) { injected = true; throw Error('isolated post-seed checkpoint failure'); }
      });
      const failed = await sampler.sample();
      f.intercept(undefined);
      assert.equal(injected, true);
      assert.equal(failed.verified, false);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].n, count);
      assert.equal((await pool.query("SELECT report->>'phase' AS phase FROM public.pbk_eval_runs WHERE suite_name='runtime_coverage_control_v1'")).rows[0].phase, 'pending');
      const inventory = (await pool.query("SELECT report FROM public.pbk_eval_runs WHERE report ? 'admission'")).rows;
      assert.equal(inventory.length, 1);
      assert.notEqual(inventory[0].report.admission, null);
      assert.equal((await verify(reference)).verified, false);
      await assertAuditDenied();
    });
  } finally {
    f.intercept(undefined);
    try { assert.deepEqual(await protectedRows(), before); }
    finally { await f.close(); }
    console.log(`Seeded cross-engine Postgres readback proof: ${f.stats.queries} actual SQL queries; protected rows unchanged; schema removed`);
  }
});
