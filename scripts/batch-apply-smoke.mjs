import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { ensureBatchPhoneSchema, dispatchTelnyxWithBatchPhoneGuard } from './batch-phone-dispatch.mjs';
import { loadAppliedBatchLeads, runBatchApply } from './batch-apply.mjs';

test('real batch contract keeps preview read-only and commits the exact confirmed lead and phone plan together', async () => {
  const db = await PGlite.create();
  const query = (sql, params) => params ? db.query(sql, params) : db.exec(sql);
  const pool = { query, connect: async () => ({ query, release() {} }) };
  try {
    await ensureBatchPhoneSchema(pool);
    await query(`CREATE TABLE public.bridge_state(id text PRIMARY KEY, data jsonb);
      CREATE TABLE public.lead_profiles (
        id text PRIMARY KEY, workspace_id text, source text, address text, city text, state text,
        postal_code text, lead_name text, first_name text, last_name text, email text, phone text,
        dnc boolean DEFAULT false, raw jsonb DEFAULT '{}', updated_at timestamptz DEFAULT NOW(),
        status text DEFAULT 'new', stage text DEFAULT 'cold'
      );`);
    const contents = [
      ['Lead ID', 'Address', 'City', 'Owner Name', 'Phone 1', 'Phone 1 DNC', 'Phone 2', 'Phone 2 DNC'],
      ['existing', '10 Sample St', 'Austin', 'Manual Owner', '', '', '', ''],
      ['', '20 Sample St', 'Austin', '', '2025550101', 'No', '2025550102', 'No'],
      ['', '30 Sample St', 'Austin', '', '+1 202-555-0101', 'No', '', ''],
      ['', '', '', '', '2025550102', 'Yes', '', ''],
    ].map((line) => line.join(',')).join('\n');
    await query(`INSERT INTO public.lead_profiles
      (id, workspace_id, source, address, lead_name, raw)
      VALUES ('existing', 'pbk', 'manual', '10 Sample St', 'Manual Owner', '{"note":"keep this"}')`);
    const base = { name: 'sample.csv', contents, reviewedRows: [1, 2, 3] };
    const execute = (body, enabled = true) => runBatchApply({ pool, body, enabled, secret: 'test-operator-key', getBridgeLeads: () => [] });
    const count = async table => (await query(`SELECT count(*)::int AS count FROM public.${table}`, [])).rows[0].count;
    const published = (id) => loadAppliedBatchLeads(async (sql, params) => ({
      ok: true, ...(await query(sql, params)),
    }), id);
    const preview = await execute({ ...base, mode: 'preview' });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.phoneSummary, { numbers: 2, candidates: 1, dnc: 1, held: 0, shared: 2 });
    assert.equal(await count('lead_profiles'), 1);
    assert.equal(await count('pbk_batch_phone_contacts'), 0);
    assert.deepEqual(await published(), []);
    const confirm = { ...base, mode: 'apply', confirmed: true, reviewToken: preview.body.reviewToken };
    assert.equal((await execute(confirm, false)).status, 403);
    assert.equal((await execute({ ...confirm, reviewedRows: [1, 3] })).status, 409);
    await query(`UPDATE public.lead_profiles SET raw = '{"note":"changed after preview"}' WHERE id = 'existing'`);
    assert.equal((await execute(confirm)).status, 409);
    const renewed = await execute({ ...base, mode: 'preview' });
    const fresh = { ...confirm, reviewToken: renewed.body.reviewToken };
    await query(`ALTER TABLE public.lead_profiles ADD CONSTRAINT sample_failure CHECK (id = 'existing')`);
    assert.equal((await execute(fresh)).status, 503);
    assert.equal(await count('lead_profiles'), 1);
    assert.equal(await count('pbk_batch_phone_contacts'), 0);
    assert.deepEqual(await published(), []);
    await query(`ALTER TABLE public.lead_profiles DROP CONSTRAINT sample_failure`);
    const applied = await execute(fresh);
    assert.equal(applied.status, 200);
    assert.equal(applied.body.registeredPhoneCount, 2);
    assert.equal(await count('lead_profiles'), 3);
    assert.equal((await execute(fresh)).status, 409);
    const { rows } = await query(`SELECT id, city, lead_name, raw, phone FROM public.lead_profiles ORDER BY address`, []);
    assert.equal(rows[0].lead_name, 'Manual Owner');
    assert.equal(rows[0].city, 'Austin');
    assert.equal(rows[0].raw.note, 'changed after preview');
    assert.equal((await published(rows[1].id))[0].phone, '+12025550101');
    assert.equal((await published(rows[2].id))[0].phone, '');
    let attempted = 0;
    const dispatch = async (endpoint, to, leadId) => {
      const response = await dispatchTelnyxWithBatchPhoneGuard({
        pool, method: 'POST', endpoint, payload: { to }, leadId, isLocallyDnc: () => false,
        dispatch: () => { attempted++; return Response.json({ stub: true }); },
      });
      return (await response.json()).batchPhoneGuard;
    };
    assert.equal(await dispatch('/messages', '+12025550102', rows[1].id), 'dnc');
    assert.equal(await dispatch('/calls', '+12025550101', rows[2].id), 'wrong-lead');
    assert.equal(await dispatch('/calls', '+12025550103', rows[1].id), 'not-eligible');
    assert.equal(await dispatch('/calls', '+12025550101', rows[1].id), undefined);
    assert.equal(await dispatch('/messages', '202-555-0101', rows[1].id), 'already-reserved');
    assert.equal(attempted, 1);
  } finally {
    await db.close();
  }
});
