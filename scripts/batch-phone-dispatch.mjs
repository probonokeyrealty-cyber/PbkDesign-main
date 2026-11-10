import { randomUUID } from 'node:crypto';

const table = 'public.pbk_batch_phone_contacts';
const dispositions = new Set(['candidate', 'dnc', 'unknown', 'not-reviewed']);
const normalize = (value) => {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value)) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : '';
};

export async function ensureBatchPhoneSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      workspace_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      batch_id TEXT,
      lead_id TEXT,
      disposition TEXT NOT NULL DEFAULT 'held' CHECK (disposition IN ('held', 'candidate', 'dnc')),
      workspace_dnc BOOLEAN NOT NULL DEFAULT FALSE,
      reservation UUID,
      reserved_at TIMESTAMPTZ,
      channel TEXT CHECK (channel IN ('call', 'sms')),
      PRIMARY KEY (workspace_id, phone)
    );
    ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
  `);
}

export async function withBatchPhoneTransaction(pool, work) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '8s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

// Only a trusted apply workflow may register a plan and bind candidate rows to saved lead IDs.
export function registerBatchPhonePlan(pool, options) {
  return withBatchPhoneTransaction(pool, (client) => registerBatchPhonePlanInTransaction(client, options));
}

export async function registerBatchPhonePlanInTransaction(client, { workspace = 'pbk', batchId, entries, leadIdForRow }) {
  if (!workspace || !batchId || !Array.isArray(entries)) throw new Error('Invalid batch phone plan.');
  const plan = entries.map((entry) => {
    const phone = normalize(entry.phone);
    if (!/^\+1\d{10}$/.test(phone) || !dispositions.has(entry.status)) throw new Error('Invalid batch phone entry.');
    const lead = entry.status === 'candidate' ? leadIdForRow(entry.row) : null;
    if (entry.status === 'candidate' && (typeof lead !== 'string' || !lead.trim())) {
      throw new Error('Batch candidate has no saved lead.');
    }
    return { phone, lead_id: lead, disposition: entry.status === 'candidate' || entry.status === 'dnc' ? entry.status : 'held' };
  });
  if (new Set(plan.map(({ phone }) => phone)).size !== plan.length) throw new Error('Batch plan repeats a phone number.');
  const result = await client.query(`
      INSERT INTO ${table} AS existing (workspace_id, phone, batch_id, lead_id, disposition)
      SELECT $1, entry.phone, $2, entry.lead_id, entry.disposition
      FROM jsonb_to_recordset($3::jsonb) AS entry(phone TEXT, lead_id TEXT, disposition TEXT)
      ORDER BY entry.phone
      ON CONFLICT (workspace_id, phone) DO UPDATE SET
        batch_id = EXCLUDED.batch_id,
        lead_id = CASE WHEN existing.batch_id IS NULL THEN EXCLUDED.lead_id ELSE existing.lead_id END,
        disposition = CASE
          WHEN existing.workspace_dnc OR existing.disposition = 'dnc' OR EXCLUDED.disposition = 'dnc' THEN 'dnc'
          WHEN existing.batch_id IS NULL THEN EXCLUDED.disposition
          WHEN existing.disposition = 'candidate' AND EXCLUDED.disposition = 'candidate'
            AND existing.lead_id = EXCLUDED.lead_id THEN 'candidate'
          ELSE 'held'
        END
      WHERE existing.batch_id IS NULL OR existing.batch_id = EXCLUDED.batch_id
      RETURNING phone
  `, [workspace, batchId, JSON.stringify(plan)]);
  if (result.rows.length !== plan.length) throw new Error('A phone number is already enrolled in another batch.');
  return result.rows.length;
}

export async function setWorkspacePhoneDnc(pool, { workspace = 'pbk', phone, blocked }) {
  const key = normalize(phone);
  if (!key) return;
  await pool.query(`
    INSERT INTO ${table} AS existing (workspace_id, phone, workspace_dnc)
    VALUES ($1, $2, $3)
    ON CONFLICT (workspace_id, phone) DO UPDATE SET
      workspace_dnc = EXCLUDED.workspace_dnc,
      disposition = CASE WHEN EXCLUDED.workspace_dnc AND existing.batch_id IS NOT NULL
        THEN 'dnc' ELSE existing.disposition END
  `, [workspace, key, blocked]);
}

async function lockPhone(client, workspace, phone) {
  await client.query(`
    INSERT INTO ${table} (workspace_id, phone) VALUES ($1, $2)
    ON CONFLICT (workspace_id, phone) DO NOTHING
  `, [workspace, phone]);
  const { rows: [entry] } = await client.query(`
    SELECT batch_id, lead_id, disposition, workspace_dnc, reservation
    FROM ${table} WHERE workspace_id = $1 AND phone = $2 FOR UPDATE
  `, [workspace, phone]);
  if (!entry) throw new Error('Phone reservation row is unavailable.');
  return entry;
}

const explanations = {
  'invalid-recipient': 'Outbound phone actions require exactly one valid destination number.',
  unavailable: 'Shared phone safety storage is unavailable; no provider request was made.',
  dnc: 'This phone number is blocked by do-not-contact.',
  'not-eligible': 'This batch phone is not eligible for outreach.',
  'wrong-lead': 'This phone is reserved for a different reviewed lead.',
  'already-reserved': 'This batch phone already used its shared call or SMS slot.',
  'plan-changed': 'The batch phone plan changed before dispatch; the request was blocked.',
};
const denied = (reason) => Object.assign(
  Response.json({
    error: { message: explanations[reason] },
    batchPhoneGuard: reason,
  }, { status: reason === 'unavailable' ? 503 : reason === 'invalid-recipient' ? 400 : 409 }),
  { skipped: true, providerAttempted: false }
);

export async function dispatchTelnyxWithBatchPhoneGuard({
  pool, workspace = 'pbk', method, endpoint, payload, leadId,
  isLocallyDnc, isPersistedDnc = async () => false, dispatch,
}) {
  const channel = method.toUpperCase() === 'POST'
    ? endpoint === '/calls' ? 'call' : endpoint === '/messages' ? 'sms' : ''
    : '';
  if (!channel) return dispatch();
  const phone = normalize(payload?.to);
  if (!phone) return denied('invalid-recipient');
  if (!pool) return denied('unavailable');

  const isDnc = async (entry, client) => entry.workspace_dnc || entry.disposition === 'dnc' ||
    await isPersistedDnc(client, phone) || isLocallyDnc(phone);
  const reservation = randomUUID();
  let pending;
  try {
    const claim = await withBatchPhoneTransaction(pool, async (client) => {
      const entry = await lockPhone(client, workspace, phone);
      if (await isDnc(entry, client)) return 'dnc';
      if (!entry.batch_id) return String(leadId || '').startsWith('pbk-batch-') ? 'not-eligible' : 'untracked';
      if (entry.disposition !== 'candidate') return 'not-eligible';
      if (entry.reservation) return 'already-reserved';
      if (entry.lead_id !== leadId) return 'wrong-lead';
      await client.query(`
        UPDATE ${table} SET reservation = $3, channel = $4, reserved_at = NOW()
        WHERE workspace_id = $1 AND phone = $2
      `, [workspace, phone, reservation, channel]);
      return 'reserved';
    });
    if (claim !== 'reserved' && claim !== 'untracked') return denied(claim);

    // Commit the claim before touching the provider. Recheck DNC under the same
    // row lock as opt-outs, then start the request without waiting on network IO.
    const final = await withBatchPhoneTransaction(pool, async (client) => {
      const entry = await lockPhone(client, workspace, phone);
      if (await isDnc(entry, client)) return 'dnc';
      if (claim === 'reserved' ? entry.reservation !== reservation || entry.disposition !== 'candidate'
        : Boolean(entry.batch_id)) return 'plan-changed';
      if (isLocallyDnc(phone)) return 'dnc';
      try { pending = Promise.resolve(dispatch()); } catch (error) { pending = Promise.reject(error); }
      void pending.catch(() => {});
      return 'started';
    });
    if (final !== 'started') return denied(final);
  } catch {
    if (!pending) return denied('unavailable');
    // If commit or the provider response was ambiguous, never release or retry the claim.
  }
  return pending;
}
