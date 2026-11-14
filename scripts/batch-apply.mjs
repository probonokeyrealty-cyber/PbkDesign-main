import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { applyReviewedBatch, MAX_BATCH_BYTES, parseBatchFile } from '../src/app/utils/batchReview.ts';
import { loadBatchReviewRoster } from './batch-review-roster.mjs';
import { registerBatchPhonePlanInTransaction, withBatchPhoneTransaction } from './batch-phone-dispatch.mjs';

const workspace = 'pbk';
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const idOf = (lead) => lead.leadId || lead.lead_id || lead.id;
const string = (...values) => String(values.find((value) => value != null && String(value).trim()) ?? '').trim();
const numberKey = (value) => String(value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status, error) => ({ status, body: { ok: false, error } });

export function planBatchApply(rows, roster, reviewedRows, { batchId, dncPhones = [] }) {
  const allDnc = [...dncPhones];
  for (const lead of roster) {
    if (lead.dnc === true || [lead.dncStatus, lead.compliance?.dncStatus].some((value) => String(value).toLowerCase() === 'dnc')) {
      const primary = string(lead.phone, lead.seller?.phone);
      if (primary) allDnc.push(primary);
    }
  }
  const plan = applyReviewedBatch(rows, roster, reviewedRows, (row) => `pbk-batch-${batchId}-${row}`, allDnc);
  const entries = plan.contactPlan.filter(({ rows: refs }) => refs.some((row) => plan.appliedLeadIds.has(row)));
  const phoneSummary = {
    numbers: entries.length,
    candidates: entries.filter(({ status }) => status === 'candidate').length,
    dnc: entries.filter(({ status }) => status === 'dnc').length,
    held: entries.filter(({ status }) => status !== 'candidate' && status !== 'dnc').length,
    shared: entries.filter(({ rows: refs }) => refs.length > 1).length,
  };
  return { ...plan, entries, phoneSummary };
}

async function readSnapshot(client, getBridgeLeads) {
  const { rows: [stateRow] } = await client.query(
    "SELECT data FROM public.bridge_state WHERE id = 'singleton'", []
  );
  const leads = new Map((stateRow?.data?.leadImports ?? []).map((lead) => [idOf(lead), lead]));
  for (const lead of getBridgeLeads()) if (!leads.has(idOf(lead))) leads.set(idOf(lead), lead);
  const profiles = new Map();
  const roster = await loadBatchReviewRoster({
    bridgeLeads: [...leads.values()], includeRaw: true,
    query: async (sql, params) => {
      const result = await client.query(sql, params);
      for (const row of result.rows) profiles.set(row.id, row);
      return { ok: true, rows: result.rows };
    },
  });
  if (!roster.complete) throw new Error(roster.error);
  const { rows: phoneRows } = await client.query(`
    SELECT phone, workspace_dnc, disposition, batch_id
    FROM public.pbk_batch_phone_contacts WHERE workspace_id = $1
      AND (workspace_dnc OR batch_id IS NOT NULL) ORDER BY phone LIMIT 50001
  `, [workspace]);
  if (phoneRows.length > 50000) throw new Error('Batch phone safety roster exceeds its limit.');
  const dncPhones = [
    ...(stateRow?.data?.dncEntries ?? []).map(({ phone }) => phone).filter(Boolean),
    ...phoneRows.filter((item) => item.workspace_dnc || item.disposition === 'dnc').map(({ phone }) => phone),
  ];
  return { roster: roster.leads, profiles, phoneRows, dncPhones };
}

function buildWrites(plan, snapshot, batchId) {
  const original = new Map(snapshot.roster.map((lead) => [idOf(lead), lead]));
  const next = new Map(plan.leads.map((lead) => [idOf(lead), lead]));
  const allowedPhones = new Map();
  for (const entry of plan.entries) if (entry.status === 'candidate') {
    const id = plan.appliedLeadIds.get(entry.row);
    if (!allowedPhones.has(id)) allowedPhones.set(id, '+1' + entry.phone);
  }
  return [...new Set(plan.appliedLeadIds.values())].flatMap((id) => {
    const lead = next.get(id);
    const before = original.get(id);
    if (before && isDeepStrictEqual(lead, before)) return [];
    const profile = snapshot.profiles.get(id);
    const property = record(lead.property);
    const seller = record(lead.seller);
    const patch = Object.fromEntries(Object.entries(lead).filter(([key, value]) =>
      !before || !isDeepStrictEqual(value, before[key])
    ));
    const name = string(lead.owner, lead.leadName, seller.name);
    const phone = before ? string(lead.phone, seller.phone, allowedPhones.get(id)) : allowedPhones.get(id) || '';
    const address = string(lead.address, property.address);
    const city = string(lead.city, property.city);
    const state = string(lead.state, property.state);
    const postal = string(lead.zip, property.zip);
    const email = string(lead.email, seller.email);
    const raw = profile
      ? { ...patch, batchReviewId: batchId }
      : { ...lead, batchReviewId: batchId, address, phone, leadName: name, email,
        property: { ...property, address, city, state, zip: postal },
        seller: { ...seller, name, phone, email } };
    return [{
      id, is_existing: Boolean(profile), raw, name, phone, address, city, state, postal, email,
      first: string(lead.firstName, seller.firstName),
      last: string(lead.lastName, seller.lastName),
      dnc: lead.dnc === true,
    }];
  });
}

async function writeProfiles(client, writes) {
  const params = [workspace, JSON.stringify(writes)];
  const from = `jsonb_to_recordset($2::jsonb) AS item(
    id text, is_existing boolean, raw jsonb, name text, phone text, address text, city text,
    state text, postal text, email text, first text, last text, dnc boolean
  )`;
  const inserts = await client.query(`
    INSERT INTO public.lead_profiles (
      id, workspace_id, source, raw, lead_name, phone, address, city, state, postal_code, email, first_name, last_name, dnc
    )
    SELECT id, $1, 'batch-review', raw, name, phone, address, city, state, postal, email, first, last, dnc
    FROM ${from} WHERE NOT item.is_existing RETURNING id
  `, params);
  const updates = await client.query(`
    UPDATE public.lead_profiles AS target SET
      raw = COALESCE(target.raw, '{}'::jsonb) || item.raw,
      lead_name = CASE WHEN COALESCE(btrim(target.lead_name), '') = '' THEN item.name ELSE target.lead_name END,
      phone = CASE WHEN COALESCE(btrim(target.phone), '') = '' THEN item.phone ELSE target.phone END,
      address = CASE WHEN COALESCE(btrim(target.address), '') = '' THEN item.address ELSE target.address END,
      city = CASE WHEN COALESCE(btrim(target.city), '') = '' THEN item.city ELSE target.city END,
      state = CASE WHEN COALESCE(btrim(target.state), '') = '' THEN item.state ELSE target.state END,
      postal_code = CASE WHEN COALESCE(btrim(target.postal_code), '') = '' THEN item.postal ELSE target.postal_code END,
      email = CASE WHEN COALESCE(btrim(target.email), '') = '' THEN item.email ELSE target.email END,
      first_name = CASE WHEN COALESCE(btrim(target.first_name), '') = '' THEN item.first ELSE target.first_name END,
      last_name = CASE WHEN COALESCE(btrim(target.last_name), '') = '' THEN item.last ELSE target.last_name END,
      updated_at = NOW()
    FROM ${from} WHERE item.is_existing AND target.id = item.id
      AND COALESCE(target.workspace_id, 'pbk') = $1 RETURNING target.id
  `, params);
  if (inserts.rows.length + updates.rows.length !== writes.length) throw new Error('Lead projection incomplete.');
}

export async function loadAppliedBatchLeads(query, leadId = '') {
  const exact = Boolean(leadId);
  const result = await query(`
    SELECT id, raw, source, status, stage, updated_at, phone, address, lead_name
    FROM public.lead_profiles WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
      AND (source = 'batch-review' OR raw ? 'batchReviewId')
      ${exact ? 'AND id = $1' : ''}
    ORDER BY id LIMIT ${exact ? '1' : '10000'}
  `, exact ? [leadId] : []);
  if (!result.ok) return [];
  return result.rows.map((row) => ({
    ...record(row.raw), id: row.id, leadId: row.id, phone: row.phone,
    address: row.address, leadName: row.lead_name, stage: row.stage, status: row.status,
    updatedAt: row.updated_at, source: row.source,
  }));
}

export async function runBatchApply({ pool, body, enabled, secret, getBridgeLeads }) {
  if (!secret) return fail(403, 'Operator bridge authentication is required.');
  if (!pool) return fail(503, 'Batch apply requires Postgres.');
  const applying = body?.mode === 'apply';
  if (applying && !enabled) return fail(403, 'Real batch writes are disabled.');
  if (!applying && body?.mode !== 'preview') return fail(400, 'Choose preview or apply.');
  if (applying && (body.confirmed !== true || !/^[a-f0-9]{64}$/.test(body.reviewToken || ''))) {
    return fail(400, 'Preview and explicitly confirm before applying.');
  }
  if (typeof body.name !== 'string' || body.name.length > 255 || typeof body.contents !== 'string' ||
      Buffer.byteLength(body.contents) > MAX_BATCH_BYTES || !Array.isArray(body.reviewedRows) ||
      body.reviewedRows.length > 5000) return fail(400, 'Invalid batch file or reviewed row selection.');
  let rows;
  try { rows = parseBatchFile(body.name, body.contents); } catch { return fail(400, 'Batch file could not be parsed.'); }
  const validRows = new Set(rows.map(({ number }) => number));
  if (body.reviewedRows.some((row) => !validRows.has(row))) return fail(400, 'Invalid reviewed row selection.');
  const selection = [...new Set(body.reviewedRows)].sort((a, b) => a - b);
  if (!selection.length) return fail(400, 'Select reviewed rows before previewing.');

  try {
    return await withBatchPhoneTransaction(pool, async (client) => {
      if (!applying) await client.query('SET TRANSACTION READ ONLY');
      else {
        // Prevent stale matching and serialize this short atomic publish with profile writers.
        await client.query('LOCK TABLE public.lead_profiles IN SHARE ROW EXCLUSIVE MODE');
        await client.query("SELECT id FROM public.bridge_state WHERE id = 'singleton' FOR SHARE");
      }
      const snapshot = await readSnapshot(client, getBridgeLeads);
      const fingerprint = hash([body.name, body.contents, selection, snapshot.roster,
        [...snapshot.profiles.values()], snapshot.phoneRows, snapshot.dncPhones]);
      const reviewToken = createHmac('sha256', secret).update(fingerprint).digest('hex');
      if (applying && !timingSafeEqual(Buffer.from(reviewToken, 'hex'), Buffer.from(body.reviewToken, 'hex'))) {
        return fail(409, 'The batch, selection, or saved records changed. Preview again.');
      }
      const plan = planBatchApply(rows, snapshot.roster, selection, { batchId: fingerprint.slice(0, 32), dncPhones: snapshot.dncPhones });
      const enrolled = new Set(snapshot.phoneRows.filter(({ batch_id }) => batch_id).map(({ phone }) => numberKey(phone)));
      const overlappingPhones = plan.entries.filter(({ phone }) => enrolled.has(phone)).length;
      const result = { ok: true, summary: plan.summary, phoneSummary: plan.phoneSummary, overlappingPhones };
      if (!applying) return { status: 200, body: { ...result, reviewToken } };
      if (!plan.appliedLeadIds.size || overlappingPhones) return fail(409, 'No eligible reviewed rows, or a number belongs to a previous batch.');
      const registeredPhoneCount = await registerBatchPhonePlanInTransaction(client, {
        batchId: fingerprint.slice(0, 32), entries: plan.entries,
        leadIdForRow: (row) => plan.appliedLeadIds.get(row),
      });
      const { rows: [safety] } = await client.query(`
        SELECT count(*) FILTER (WHERE disposition = 'dnc')::int AS dnc,
          count(*) FILTER (WHERE disposition = 'candidate')::int AS candidates
        FROM public.pbk_batch_phone_contacts WHERE workspace_id = $1 AND batch_id = $2
      `, [workspace, fingerprint.slice(0, 32)]);
      if (safety.dnc !== plan.phoneSummary.dnc || safety.candidates !== plan.phoneSummary.candidates) {
        throw Object.assign(new Error('Batch phone safety changed during registration.'), { code: 'batch_safety_changed' });
      }
      await writeProfiles(client, buildWrites(plan, snapshot, fingerprint.slice(0, 32)));
      return { status: 200, body: { ...result, registeredPhoneCount } };
    });
  } catch (error) {
    if (error?.code === 'batch_safety_changed') return fail(409, 'Phone safety changed. Preview again.');
    return fail(503, 'Batch transaction could not be confirmed. Preview again before retrying.');
  }
}
