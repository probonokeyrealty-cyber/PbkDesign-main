import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { applyTargetedReadinessMigration } from './targeted-readiness-migration.mjs';
import { recordCallMemorySkip, readCallMemorySkipSummary } from './call-memory-outcome-store.mjs';
import { validateTargetedEvalTarget } from './targeted-readiness-eval-guard.mjs';

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
