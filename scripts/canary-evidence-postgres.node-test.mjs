import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { parse } from 'yaml';
import { validateTargetedEvalTarget } from './targeted-readiness-eval-guard.mjs';
import { readProtectedFixtureFingerprints } from './readiness-timing-postgres-fixture.mjs';
import { readCanaryEvidence } from './canary-evidence-reader.mjs';
import { CANARY_EVIDENCE_LIMITS as limits, canaryRowDigest } from './canary-evidence-protocol.mjs';
import { makeCanaryFixture, rebuildCanaryFixture, resignCanaryRow } from './fixtures/canary-evidence-fixture.mjs';
import { observeCanaryPostgres } from './fixtures/canary-postgres-observer.mjs';

test('Release Qualification adds a separate guarded canary Postgres proof', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/release-qualification.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['release-qualification'];
  const matches = job.steps.filter(step => step.name === 'Run trusted canary Postgres proof');
  assert.equal(matches.length, 1, 'one additional guarded canary step is required');
  const step = matches[0];
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.match(step.run, /npm run neon:evaluation -- --ttl-hours 1\s/);
  assert.match(step.run, /--branch-name pbk-eval-targeted-readiness-canary-/);
  assert.match(step.run, /-- node --test scripts\/canary-evidence-postgres\.node-test\.mjs$/);
  assert(!/--(?:inject-runtime-db|dry-run|test-name-pattern)/.test(step.run));
  for (const key of ['NEON_API_KEY', 'PBK_NEON_API_KEY', 'NEON_PROJECT_ID']) assert(step.env[key]);
  for (const key of ['PBK_DATABASE_URL', 'DATABASE_URL', 'SUPABASE_DB_URL', 'PBK_MIGRATION_DATABASE_URL']) {
    assert.equal(job.env[key], '');
  }
  // The original six-suite gate is separately executed by release-qualification-ci.test.mjs.
  const original = job.steps.find(item => item.name === 'Run disposable Postgres tests');
  assert(!original.run.includes('canary-evidence-postgres'));
  const gate = job.steps.find(item => item.name === 'Assert zero skipped or failed Postgres tests');
  assert.match(gate.run, /assert\.equal\(report\.numTotalTestSuites, 6\)/);
});

test('guarded disposable Postgres proves trusted canary SQL and read-only readback', { timeout: 600000 }, async t => {
  const { connectionConfig } = await validateTargetedEvalTarget();
  const database = `pbk_canary_${randomUUID().replaceAll('-', '')}`;
  assert.match(database, /^pbk_canary_[a-f0-9]{32}$/);
  const base = new pg.Pool({ ...connectionConfig, max: 1, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  let pool, created = false, inherited;
  try {
    inherited = await readProtectedFixtureFingerprints(base);
    await base.query(`CREATE DATABASE "${database}"`);
    created = true;
    pool = new pg.Pool({ ...connectionConfig, database, max: 3, connectionTimeoutMillis: 10000, query_timeout: 15000 });
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, database);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
    // Only the existing receipt table shape, in this generated empty database. No migration or runtime startup.
    await pool.query(`CREATE TABLE public.pbk_eval_runs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id TEXT NOT NULL DEFAULT 'pbk',
      suite_name TEXT NOT NULL DEFAULT 'ava_canonical', ok BOOLEAN NOT NULL DEFAULT FALSE,
      total INT NOT NULL DEFAULT 0, passed INT NOT NULL DEFAULT 0, failed INT NOT NULL DEFAULT 0,
      report JSONB NOT NULL DEFAULT '{}'::jsonb, source TEXT NOT NULL DEFAULT 'pbk-bridge',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

    const fingerprint = async () => (await pool.query(`SELECT count(*)::int AS n,
      md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY id), '')) AS digest FROM public.pbk_eval_runs t`)).rows[0];
    const seed = async (f) => {
      await pool.query('TRUNCATE public.pbk_eval_runs');
      const rows = [f.comparison, ...f.runs, ...f.observations].map(({ created_at_exact, ...row }) => ({ ...row, created_at: created_at_exact }));
      await pool.query(`INSERT INTO public.pbk_eval_runs SELECT * FROM jsonb_populate_recordset(NULL::public.pbk_eval_runs,$1::jsonb)`, [JSON.stringify(rows)]);
    };
    const fresh = (options = {}) => makeCanaryFixture({ secret: randomBytes(32).toString('hex'), now: Date.now(), ...options });
    const insertComparison = async (row) => pool.query(`INSERT INTO public.pbk_eval_runs
      (id,tenant_id,suite_name,source,ok,total,passed,failed,created_at,report)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [row.id, row.tenant_id, row.suite_name, row.source, row.ok, row.total, row.passed, row.failed, row.created_at_exact, JSON.stringify(row.report)]);
    const denied = (result, code) => {
      assert.equal(result.result, code);
      assert.equal(result.ok, false);
      assert.equal(result.verified, false);
      assert.equal(result.readbackVerified, false);
      assert.equal(result.runId, null);
      assert.deepEqual(result.evidence, {});
      assert.deepEqual(result.diagnostics, { codes: [code] });
    };
    // Observe actual pg results; never substitute rows, rewrite SQL, or change reader budgets.
    async function read(f, afterFirstSnapshot) {
      const before = await fingerprint();
      const { pool: audited, trace } = observeCanaryPostgres(pool, afterFirstSnapshot);
      const result = await readCanaryEvidence({ pool: audited, secret: f.secret, revision: f.revision,
        policy: { ready: true, version: 2, hash: f.policyHash }, now: () => f.now });
      assert(trace.transactions.every(row => row.ro === 'on' && row.isolation === 'repeatable read'));
      if (!afterFirstSnapshot) assert.deepEqual(await fingerprint(), before, 'every ordinary reader call leaves all receipt rows unchanged');
      return { result, trace };
    }

    await t.test('authentic signed controlled chain survives JSONB, exact row digests and two independent snapshots without writes', async () => {
      const f = fresh(); await seed(f);
      const before = await fingerprint();
      const { result, trace } = await read(f);
      assert.equal(result.verified, true);
      assert.equal(result.readbackVerified, true);
      assert.equal(result.runId, f.comparison.id);
      assert.equal(result.evidence.canary.candidate.sampleCount, 20);
      assert.equal(result.evidence.canary.candidate.p95LatencyMs, 100);
      assert.equal(trace.snapshots, 2);
      assert.deepEqual(trace.released, [false, false]);
      assert.equal(trace.envelopes.length, 6);
      const expected = new Map([f.comparison, ...f.runs, ...f.observations].map(row => [row.id, canaryRowDigest(row)]));
      for (const batch of trace.envelopes) for (const row of batch.rows) assert.equal(canaryRowDigest(row.physical), expected.get(row.physical.id));
      assert.deepEqual(await fingerprint(), before);
    });

    await t.test('missing producer returns no proof and writes no receipts', async () => {
      const f = fresh(); await pool.query('TRUNCATE public.pbk_eval_runs');
      const before = await fingerprint();
      denied((await read(f)).result, 'canary_evidence_missing');
      assert.deepEqual(await fingerprint(), before);
    });

    await t.test('authentic nonzero microsecond admissions survive without Date truncation', async () => {
      const f = fresh();
      for (const row of [f.comparison, ...f.runs, ...f.observations]) {
        row.created_at_exact = row.report.admittedAt = row.created_at_exact.replace('000Z', '123Z');
      }
      rebuildCanaryFixture(f); await seed(f);
      const { result, trace } = await read(f);
      assert.equal(result.verified, true);
      assert(trace.envelopes.every(batch => batch.rows.every(row => row.physical.created_at_exact.endsWith('123Z'))));
    });

    await t.test('authentic errors and fallbacks stay verified and remain in recomputed denominators', async () => {
      const f = fresh();
      Object.assign(f.observations.at(-1).report, { outcome: 'error', fallback: true, behaviorPassed: false });
      rebuildCanaryFixture(f); await seed(f);
      const { result } = await read(f);
      assert.equal(result.verified, true);
      assert.equal(result.evidence.canary.candidate.sampleCount, 20);
      assert.equal(result.evidence.canary.candidate.behaviorPassRate, 19 / 20);
      assert.equal(result.evidence.canary.candidate.errorRate, 1 / 20);
      assert.equal(result.evidence.canary.candidate.fallbackRate, 1 / 20);
      assert.equal(result.evidence.canary.baseline.errorRate, 0);
    });

    for (const target of ['comparison', 'observation']) await t.test(`actual one-microsecond ${target} mismatch is not rounded into a match`, async () => {
      const f = fresh(); await seed(f);
      const id = target === 'comparison' ? f.comparison.id : f.observations[0].id;
      await pool.query("UPDATE public.pbk_eval_runs SET created_at=created_at+interval '1 microsecond' WHERE id=$1", [id]);
      const exact = (await pool.query(`SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp FROM public.pbk_eval_runs WHERE id=$1`, [id])).rows[0].stamp;
      assert(exact.endsWith('001Z'));
      denied((await read(f)).result, 'canary_evidence_invalid');
    });

    for (const mutation of ['other tenant', 'deleted', 'dependency tampered']) await t.test(`${mutation} observation cannot satisfy authenticated membership`, async () => {
      const f = fresh(); await seed(f);
      const statements = {
        'other tenant': "UPDATE public.pbk_eval_runs SET tenant_id='other' WHERE id=$1",
        deleted: 'DELETE FROM public.pbk_eval_runs WHERE id=$1',
        'dependency tampered': "UPDATE public.pbk_eval_runs SET report=jsonb_set(report,'{latencyMs}','999') WHERE id=$1",
      };
      await pool.query(statements[mutation], [f.observations[0].id]);
      denied((await read(f)).result, 'canary_evidence_invalid');
    });

    for (const variant of ['invalid signature', 'pending', 'different revision', 'wrong suite']) await t.test(`newest ${variant} admission hides an older passing chain`, async () => {
      const f = fresh(); await seed(f); assert.equal((await read(f)).result.verified, true);
      const row = structuredClone(f.comparison);
      row.id = `canary_comparison_${randomBytes(32).toString('hex')}`;
      row.report.id = row.id;
      row.created_at_exact = row.report.admittedAt = new Date(f.now - 59_000).toISOString().replace('Z', '000Z');
      if (variant === 'pending') Object.assign(row.report, { status: 'pending', executed: false, completedAt: null, baseline: null, candidate: null });
      if (variant === 'different revision') row.report.revision = 'c'.repeat(40);
      if (variant === 'wrong suite') row.suite_name = 'unreserved';
      resignCanaryRow(row, f.secret);
      if (variant === 'invalid signature') row.report.attestation.signature = '0'.repeat(64);
      await insertComparison(row);
      const { result, trace } = await read(f);
      denied(result, variant === 'pending' ? 'canary_evidence_pending' : 'canary_evidence_invalid');
      assert.equal(trace.envelopes.length, 1);
      assert.equal(trace.envelopes[0].rows[0].physical.id, row.id);
    });

    for (const variant of ['dependency change', 'new admission']) await t.test(`separate snapshots detect ${variant} after first rollback`, async () => {
      const f = fresh(); await seed(f);
      const { result, trace } = await read(f, async () => {
        if (variant === 'dependency change') await pool.query("UPDATE public.pbk_eval_runs SET source=source||'-changed' WHERE id=$1", [f.observations[0].id]);
        else {
          const row = structuredClone(f.comparison);
          row.id = row.report.id = `canary_comparison_${randomBytes(32).toString('hex')}`;
          row.created_at_exact = row.report.admittedAt = new Date(f.now - 59_000).toISOString().replace('Z', '000Z');
          resignCanaryRow(row, f.secret); await insertComparison(row);
        }
      });
      denied(result, 'canary_evidence_superseded');
      assert.equal(trace.snapshots, 2);
      assert.deepEqual(trace.released, [false, false]);
    });

    await t.test('I1 newest multi-MiB unindexed source is withheld by SQL, not loaded then rejected in JS', async () => {
      const f = fresh(); await seed(f); assert.equal((await read(f)).result.verified, true);
      const row = structuredClone(f.comparison);
      row.id = row.report.id = `canary_comparison_${randomBytes(32).toString('hex')}`;
      row.created_at_exact = row.report.admittedAt = new Date(f.now - 59_000).toISOString().replace('Z', '000Z');
      row.source = 'oversized-unindexed-source-'.repeat(130_000);
      resignCanaryRow(row, f.secret); await insertComparison(row);
      assert((await pool.query('SELECT octet_length(source) AS n FROM public.pbk_eval_runs WHERE id=$1', [row.id])).rows[0].n > limits.maxBytes);
      const { result, trace } = await read(f);
      denied(result, 'canary_evidence_limit_exceeded');
      assert.equal(trace.envelopes.length, 1);
      assert.deepEqual(trace.envelopes[0].rows, [{ physical: null, physical_bytes: limits.maxBytes + 1,
        report_bytes: trace.envelopes[0].rows[0].report_bytes }]);
      assert(Buffer.byteLength(JSON.stringify(trace.envelopes[0].rows)) < 128);
    });

    await t.test('I1 collectively oversized dependency batch with individually admissible fields is withheld as one capped denial', async () => {
      const f = fresh(); await seed(f);
      const initial = (await read(f)).trace.envelopes[1];
      const remainingBeforePadding = initial.config.values.at(-2);
      const initialBytes = initial.rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row))
        + row.physical_bytes - Buffer.byteLength(JSON.stringify(row.physical)), 0);
      // Below a fresh 2 MiB cap, above the actual remaining cumulative cap.
      const targetBytes = Math.floor((limits.maxBytes + remainingBeforePadding) / 2);
      const padding = Math.floor((targetBytes - initialBytes) / 2);
      assert(padding > 0);
      for (const run of f.runs) run.source += 'x'.repeat(padding);
      rebuildCanaryFixture(f); await seed(f);
      const { result, trace } = await read(f);
      denied(result, 'canary_evidence_limit_exceeded');
      assert.equal(trace.envelopes.length, 2);
      const batch = trace.envelopes[1];
      const remaining = batch.config.values.at(-2);
      assert(remaining < limits.maxBytes && remaining > 1_100_000);
      const sizes = (await pool.query('SELECT octet_length(to_jsonb(t)::text) AS n FROM public.pbk_eval_runs t WHERE id=ANY($1::text[])', [f.runs.map(row => row.id)])).rows;
      assert(sizes.every(row => row.n < remaining));
      assert(sizes.reduce((sum, row) => sum + row.n, 0) > remaining);
      assert(sizes.reduce((sum, row) => sum + row.n, 0) < limits.maxBytes);
      assert.equal(batch.rows.length, 1);
      assert.equal(batch.rows[0].physical, null);
      assert(batch.rows[0].physical_bytes > remaining && batch.rows[0].physical_bytes <= limits.maxBytes);
      assert(Buffer.byteLength(JSON.stringify(batch.rows)) < 128);
    });

    await t.test('I1 row_to_json escaping and JSONB whitespace are included in exact numeric envelope sizes', async () => {
      const f = fresh(); f.comparison.source += '"\\\n\t'; await seed(f);
      const { result, trace } = await read(f);
      denied(result, 'canary_evidence_invalid');
      const row = trace.envelopes[0].rows[0];
      assert.equal(row.physical.source, f.comparison.source);
      assert(row.report_bytes > Buffer.byteLength(JSON.stringify(row.physical.report)), 'JSONB textual spaces must be charged');
      assert(row.physical_bytes > Buffer.byteLength(JSON.stringify(row.physical)), 'spaces inside row_to_json must be charged');
      const measured = (await pool.query(`SELECT octet_length(row_to_json(p)::text) AS physical_bytes,
        octet_length(p.report::text) AS report_bytes FROM (SELECT id,tenant_id,suite_name,source,ok,total,passed,failed,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact,report
        FROM public.pbk_eval_runs WHERE id=$1) p`, [f.comparison.id])).rows[0];
      assert.equal(row.physical_bytes, measured.physical_bytes);
      assert.equal(row.report_bytes, measured.report_bytes);
      // Replay the actual shipped SQL at the exact transfer boundary: compact JSON is not its budget.
      const { text, values } = trace.envelopes[0].config;
      const bytes = Buffer.byteLength(JSON.stringify(row)) + row.physical_bytes - Buffer.byteLength(JSON.stringify(row.physical));
      const at = [...values]; at[at.length - 2] = bytes;
      assert.deepEqual((await pool.query({ text, values: at })).rows, [row]);
      at[at.length - 2] = bytes - 1;
      const withheld = (await pool.query({ text, values: at })).rows;
      assert.equal(withheld.length, 1); assert.equal(withheld[0].physical, null);
      assert(Number.isSafeInteger(withheld[0].physical_bytes));
    });
    assert.deepEqual(await readProtectedFixtureFingerprints(base), inherited);
    t.diagnostic('Inherited protected fingerprints unchanged; reader ran original SQL only in generated empty DB.');
  } finally {
    try {
      if (pool) await pool.end();
      if (created) {
        assert.match(database, /^pbk_canary_[a-f0-9]{32}$/);
        await base.query(`DROP DATABASE "${database}"`);
        assert.equal((await base.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1', [database])).rows[0].n, 0);
        t.diagnostic('Generated database dropped and independently catalog-verified absent.');
      }
      if (inherited) assert.deepEqual(await readProtectedFixtureFingerprints(base), inherited);
    } finally { await base.end(); }
  }
});
