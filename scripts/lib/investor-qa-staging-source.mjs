import { createHash, timingSafeEqual } from 'node:crypto';

export const INVESTOR_QA_LEAD_PATH = '/api/staging/investor/qa-lead';
const stagingService = 'srv-dbvk7tv40ujc73e0d8gg';
const revisionSql = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const selectionSql = `workspace_id AS "accountId", id AS "leadId", ${revisionSql} AS revision`;
const fictionalSql = `
  id ~ '^(qa|sample|synthetic)[-_:]'
  AND COALESCE(phone, '') = '' AND COALESCE(email, '') = ''
  AND (raw->'fictional' = 'true'::jsonb OR raw#>'{investorQa,fictional}' = 'true'::jsonb)
`;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
const scopeKeys = ['staffUid', 'accountId', 'leadId', 'revision'];
const validScope = value => value && scopeKeys.every(key => id(value[key]));
const exact = (a, b, keys) => keys.every(key => a?.[key] === b[key]);
const sha256 = value => createHash('sha256').update(value).digest();
const response = (status, error) => ({ status, body: { error } });

function readGrant(input) {
  try {
    const value = JSON.parse(input || 'null');
    return validScope(value) && Number.isSafeInteger(value.expiresAt) ? value : null;
  } catch {
    return null;
  }
}

async function readRequest(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return null;
  let bytes = 0;
  const parts = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 2048) return null;
    parts.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    return null;
  }
}

function project(row) {
  if (
    !['address', 'city', 'state', 'zip', 'checkedAt'].every(key => typeof row[key] === 'string' && row[key].trim()) ||
    !/^[A-Z]{2}$/.test(row.state) || !/^\d{5}(?:-\d{4})?$/.test(row.zip)
  ) return null;
  const assetType = typeof row.assetType === 'string' && row.assetType.trim() ? row.assetType.trim() : 'Not recorded';
  const asking = typeof row.askingPrice === 'number' ? Math.round(row.askingPrice * 100) : null;
  return {
    accountId: row.accountId, leadId: row.leadId, revision: row.revision, fictional: true,
    address: row.address, city: row.city, state: row.state, zip: row.zip,
    market: `${row.city}, ${row.state}`, assetType, checkedAt: row.checkedAt,
    askingCents: Number.isSafeInteger(asking) && asking >= 0 && asking <= 1e12 ? asking : null,
  };
}

async function readExact(client, selection) {
  const { rows } = await client.query(`
    SELECT ${selectionSql}, address, city, state, postal_code AS zip,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "checkedAt",
      COALESCE(raw#>>'{property,type}', raw->>'propertyType') AS "assetType",
      raw#>'{property,askingPrice}' AS "askingPrice"
    FROM public.lead_profiles
    WHERE workspace_id = $1 AND id = $2 AND ${revisionSql} = $3 AND ${fictionalSql}
    LIMIT 1
  `, [selection.accountId, selection.leadId, selection.revision]);
  const row = rows[0];
  return row && exact(row, selection, ['accountId', 'leadId', 'revision']) ? project(row) : null;
}

export function createInvestorQaStagingSource({ env = process.env, getPool, now = Date.now }) {
  const staging = env.RENDER_SERVICE_ID === stagingService;
  const token = env.PBK_INVESTOR_QA_SOURCE_TOKEN;
  const expected = typeof token === 'string' && /^[A-Za-z0-9._~-]{32,128}$/.test(token)
    ? sha256(`Bearer ${token}`) : null;
  const grant = readGrant(env.PBK_INVESTOR_QA_SOURCE_GRANT);
  const discoveryUntil = Number(env.PBK_INVESTOR_QA_DISCOVERY_UNTIL);

  async function readOnly(action) {
    const client = await getPool()?.connect();
    if (!client) throw new Error('staging_store_unavailable');
    let discard;
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3s'");
      const { rows: [target] } = await client.query('SELECT current_database() AS database, current_user AS "role"');
      if (target?.database !== 'pbk_composio_staging' || target.role !== 'pbk_composio_staging_user')
        throw new Error('staging_store_mismatch');
      return await action(client);
    } finally {
      try { await client.query('ROLLBACK'); } catch (error) { discard = error; }
      client.release(discard);
    }
  }

  return {
    async handle(request) {
      const hidden = () => response(404, 'QA lead unavailable.');
      if (!staging || !expected || !grant || grant.expiresAt <= now() || request.headers.origin) return hidden();
      if (request.method !== 'POST') return response(405, 'Use POST.');
      const supplied = request.headers.authorization;
      if (typeof supplied !== 'string' || supplied.length > 160 || !timingSafeEqual(sha256(supplied), expected))
        return response(401, 'Unauthorized.');
      try {
        const selection = await readRequest(request);
        if (!validScope(selection)) return response(400, 'Provide the exact QA lead revision.');
        if (!exact(selection, grant, scopeKeys) || grant.expiresAt <= now()) return hidden();
        const record = await readOnly(client => readExact(client, selection));
        return record && grant.expiresAt > now() ? { status: 200, body: { record } } : hidden();
      } catch {
        return response(503, 'The staging QA source is unavailable.');
      }
    },
    async discover() {
      if (!staging || !Number.isSafeInteger(discoveryUntil) || discoveryUntil <= now()) return null;
      try {
        return await readOnly(async client => {
          const { rows: [selection] } = await client.query(`
            SELECT ${selectionSql} FROM public.lead_profiles
            WHERE ${fictionalSql} AND address <> '' AND city <> ''
            ORDER BY id LIMIT 1
          `);
          if (!selection || !['accountId', 'leadId', 'revision'].every(key => id(selection[key])))
            return { verified: false, reason: 'no_eligible_existing_qa_lead' };
          if (!await readExact(client, selection)) return { verified: false, reason: 'exact_revision_unavailable' };
          return { verified: true, accountId: selection.accountId, leadId: selection.leadId, revision: selection.revision };
        });
      } catch {
        return { verified: false, reason: 'staging_store_unavailable' };
      }
    },
  };
}
