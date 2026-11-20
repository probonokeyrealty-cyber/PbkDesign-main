export const QA_LEAD_ID = 'qa-investor-portal-20261120';
export const QA_WORKSPACE_ID = 'pbk-investor-qa';
const stagingService = 'srv-dbvk7tv40ujc73e0d8gg';
const database = 'pbk_composio_staging';
const role = 'pbk_composio_staging_user';
const leadName = 'FICTIONAL QA - Investor Portal Test';
const address = '1 Fictional QA Example Way';
const city = 'Example City';
const state = 'CA';
const zip = '00123';
const raw = JSON.stringify({
  fictional: true,
  investorQa: { fictional: true, fixture: QA_LEAD_ID },
  property: { address, city, state, zip, type: 'Single-family' },
});

function targetIsStaging(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname === 'dpg-dc010uei0phs73bd3ohg-a' &&
      url.pathname === `/${database}` && decodeURIComponent(url.username) === role;
  } catch {
    return false;
  }
}

export async function seedInvestorQaLead({ env = process.env, getPool, now = Date.now }) {
  const until = Number(env.PBK_INVESTOR_QA_SEED_UNTIL);
  if (env.RENDER_SERVICE_ID !== stagingService ||
      !Number.isSafeInteger(until) || until <= now() || until > now() + 3_600_000) return null;
  if (!targetIsStaging(env.PBK_DATABASE_URL)) return { saved: false, reason: 'staging_target_mismatch' };

  let client, finished = false, discard, reason = 'staging_seed_unavailable';
  try {
    client = await getPool()?.connect();
    if (!client) return { saved: false, reason };
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '3s'");
    const { rows: [target] } = await client.query('SELECT current_database() AS database, current_user AS "role"');
    if (target?.database !== database || target.role !== role) {
      reason = 'staging_target_mismatch';
      throw new Error(reason);
    }
    if (until <= now()) {
      reason = 'seed_window_expired';
      throw new Error(reason);
    }

    // No lead intake, events, or provider adapters run for this staging fixture.
    const values = [QA_LEAD_ID, QA_WORKSPACE_ID, leadName, address, city, state, zip, raw];
    const inserted = await client.query(`
      INSERT INTO public.lead_profiles (
        id, workspace_id, source, status, stage, lead_name, dnc, dnc_reason,
        address, city, state, postal_code, phone, email, raw
      ) VALUES (
        $1, $2, 'investor-qa-fixture', 'qa_fixture', 'qa', $3, TRUE, 'Fictional QA; no outreach',
        $4, $5, $6, $7, '', '', $8::jsonb
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `, values);
    const created = inserted.rows.length === 1;
    if (!created) {
      const existing = await client.query(`
        SELECT id FROM public.lead_profiles
        WHERE id = $1 AND workspace_id = $2 AND source = 'investor-qa-fixture'
          AND lead_name = $3 AND address = $4 AND city = $5 AND state = $6 AND postal_code = $7
          AND raw = $8::jsonb AND dnc IS TRUE AND phone = '' AND email = ''
      `, values);
      if (existing.rows.length !== 1) {
        reason = 'fixture_id_conflict';
        throw new Error(reason);
      }
    }
    await client.query('COMMIT');
    finished = true;
    return { saved: true, created, leadId: QA_LEAD_ID, accountId: QA_WORKSPACE_ID };
  } catch {
    return { saved: false, reason };
  } finally {
    if (client && !finished) {
      try { await client.query('ROLLBACK'); } catch (error) { discard = error; }
    }
    client?.release(discard);
  }
}
