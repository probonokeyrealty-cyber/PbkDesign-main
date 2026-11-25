import { createHash } from 'node:crypto';

export function getRexLeadImportHour(input) {
  const reported = input.nowLocalHour ?? input.now_local_hour;
  if (reported != null) return reported;
  const timeZone = input.timeZone ?? input.timezone ?? input.leadTimezone;
  if (typeof timeZone !== 'string' || !timeZone.trim()) return undefined;
  try {
    const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date());
    return Number(hour);
  } catch {
    return undefined;
  }
}

export function buildRexLeadImportEvent(lead, { phone = '', score, nowLocalHour, dnc = false, source }) {
  const leadId = lead.leadId || lead.id;
  if (typeof leadId !== 'string' || !leadId.trim() || /^(undefined|null)$/i.test(leadId.trim())) return null;
  const id = 'rex-lead-import-' + createHash('sha256').update(leadId).digest('hex');
  return { id, leadId, phone, score, nowLocalHour, dnc, source };
}

export async function ensureRexLeadImportEventSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.pbk_rex_lead_import_events (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      result JSONB
    );
    ALTER TABLE public.pbk_rex_lead_import_events ENABLE ROW LEVEL SECURITY;
    CREATE INDEX IF NOT EXISTS pbk_rex_lead_import_events_pending_idx
      ON public.pbk_rex_lead_import_events (available_at, id) WHERE processed_at IS NULL;
  `);
}

export function rexLeadImportEventInsert(parameter, condition = '') {
  return `INSERT INTO public.pbk_rex_lead_import_events (id, payload)
    SELECT item->>'id', item FROM jsonb_array_elements(${parameter}::jsonb) AS item
    ${condition} ON CONFLICT (id) DO NOTHING`;
}

export async function drainRexLeadImportEvent(pool, deliver) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query(`
      SELECT id, payload FROM public.pbk_rex_lead_import_events
      WHERE processed_at IS NULL AND available_at <= NOW()
      ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    if (!row) {
      await client.query('COMMIT');
      return false;
    }
    let result;
    try {
      result = await deliver(row.payload);
    } catch (error) {
      await client.query(`UPDATE public.pbk_rex_lead_import_events
        SET available_at = NOW() + INTERVAL '15 seconds' WHERE id = $1`, [row.id]);
      await client.query('COMMIT');
      throw error;
    }
    await client.query(`UPDATE public.pbk_rex_lead_import_events
      SET processed_at = NOW(), result = $2::jsonb, payload = '{}'::jsonb WHERE id = $1`,
    [row.id, JSON.stringify(result)]);
    await client.query('COMMIT');
    return { eventId: row.id, ...result };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
