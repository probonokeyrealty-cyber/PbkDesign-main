import { createHash, randomUUID } from 'node:crypto';

const TASK_TYPE = 'ava_rex_research';
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,120}$/;
const PROVIDER_RESPONSE_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const US_REGIONS = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function parseRexResearch(text) {
  const match = /^ask rex to research ([\p{L}][\p{L} .’'-]{0,59}),\s*([a-z]{2})[.!]?$/iu.exec(text.trim());
  const region = match?.[2].toUpperCase();
  return US_REGIONS.has(region) ? `${match[1].trim()}, ${region}` : null;
}

export function rexLeadVersion(lead) {
  if (!lead) return null;
  return digest({
    updatedAt: lead.updatedAt || lead.updated_at,
    address: lead.address || lead.propertyAddress,
    property: lead.property,
    deal: lead.deal,
    selectedComps: lead.analyzer?.comps,
    recordedSales: lead.analyzer?.recordedSales,
  });
}

function taskId({ owner, requestId }) {
  return owner && typeof requestId === 'string' && REQUEST_ID.test(requestId)
    ? `rex-handoff-${digest([owner, requestId])}` : '';
}

function citedEvidence(output) {
  const answer = typeof output?.answer === 'string' ? output.answer.trim().slice(0, 8000) : '';
  const citations = [...new Set((Array.isArray(output?.citations) ? output.citations : []).flatMap(citation => {
    if (typeof citation !== 'string') return [];
    const link = citation.match(/https?:\/\/[^\s]+$/i)?.[0];
    if (!link || link.length > 2048) return [];
    try {
      const url = new URL(link);
      return url.username || url.password ? [] : [url.href];
    } catch {
      return [];
    }
  }))].slice(0, 8);
  return answer && citations.length ? { answer, citations } : null;
}

function isProviderResponseId(value) {
  return typeof value === 'string' && PROVIDER_RESPONSE_ID.test(value);
}

function receiptDigest({ id, requestId, leadId, binding, version, token, answer, citations }, { responseId, completedAt }) {
  return digest([id, requestId, leadId, binding, version, token, answer, citations, responseId, completedAt]);
}

async function view(store, record, readVersion, now) {
  if (!record) return { status: 'missing' };
  if (record.status === 'running' && now() >= record.expiresAt) {
    await store.finish(record.id, record.token, { status: 'reconciliation_required' });
    record = await store.read(record.id);
  }
  const { id, leadId, status, version, answer, citations, requestId, failureReason, receipt } = record;
  if (status === 'complete') {
    if (leadId && (await readVersion(leadId)) !== version) return { id, leadId, requestId, status: 'stale' };
    if (receipt?.version === 1 && isProviderResponseId(receipt.responseId) &&
        Number.isFinite(Date.parse(receipt.completedAt)) && receipt.digest === receiptDigest(record, receipt)) {
      return { id, leadId, requestId, status, answer, citations, verifiedAt: receipt.completedAt };
    }
  }
  if (status === 'complete' || status === 'unverified') {
    return {
      id, leadId, requestId, status: 'unverified',
      answer: 'I could not verify the saved research result for this request.',
    };
  }
  return { id, leadId, requestId, status, ...(failureReason ? { failureReason } : {}) };
}

export async function readRexHandoff({ owner, requestId, leadId, store, readVersion, now = Date.now }) {
  const id = taskId({ owner, requestId });
  if (!id) return { status: 'invalid' };
  const record = await store.read(id);
  if (leadId !== undefined && record?.leadId !== leadId) return { status: 'missing' };
  return view(store, record, readVersion, now);
}

export async function runRexHandoff({ owner, requestId, market, leadId = '', store, readVersion, research, now = Date.now, leaseMs = 45_000 }) {
  const id = taskId({ owner, requestId });
  if (!id) return { status: 'invalid' };
  const binding = digest([owner, market.toLowerCase().replace(/\s+/g, ' '), leadId]);
  const existing = await store.read(id);
  if (existing) {
    return existing.binding === binding ? view(store, existing, readVersion, now) : { id, status: 'conflict' };
  }
  const version = leadId ? await readVersion(leadId) : '';
  if (leadId && !version) return { status: 'missing_lead' };
  const token = randomUUID();
  const expiresAt = now() + leaseMs;
  const claim = await store.claim({ id, requestId, binding, leadId, version, token, expiresAt });
  if (claim !== true) {
    const winner = claim || await store.read(id);
    return winner?.binding === binding ? view(store, winner, readVersion, now) : { id, status: 'conflict' };
  }

  let result;
  try {
    const output = await research(market, id);
    const evidence = output?.ok === true ? citedEvidence(output) : null;
    if (evidence && output.result === 'live' && isProviderResponseId(output.responseId)) {
      const receipt = { version: 1, responseId: output.responseId, completedAt: new Date(now()).toISOString() };
      receipt.digest = receiptDigest({ id, requestId, leadId, binding, version, token, ...evidence }, receipt);
      result = { status: 'complete', ...evidence, receipt };
    } else if (output?.result === 'reconciliation_required') {
      result = { status: 'reconciliation_required' };
    } else {
      result = { status: evidence ? 'unverified' : 'failed' };
    }
    if (result.status === 'failed' && output?.result === 'provider_quota_exhausted') {
      result.failureReason = 'provider_quota_exhausted';
    }
  } catch {
    result = { status: 'reconciliation_required' };
  }
  await store.finish(id, token, now() >= expiresAt ? { status: 'reconciliation_required' } : result);
  return view(store, await store.read(id), readVersion, now);
}

export function postgresRexHandoffStore(pool) {
  function recordFromRow(row) {
    return row ? { ...row.metadata, id: row.id, status: row.status } : null;
  }
  async function readUnresolved(binding, client = pool) {
    const { rows } = await client.query(
      `SELECT id, status, metadata FROM public.pbk_tasks
       WHERE tenant_id = 'pbk' AND task_type = $1 AND to_agent = 'Rex'
         AND status IN ('running', 'reconciliation_required') AND metadata @> $2::jsonb
       ORDER BY created_at DESC LIMIT 1`, [TASK_TYPE, JSON.stringify({ binding })]
    );
    return recordFromRow(rows[0]);
  }
  return {
    async read(id) {
      const { rows } = await pool.query(
        `SELECT id, status, metadata FROM public.pbk_tasks
         WHERE id = $1 AND tenant_id = 'pbk' AND task_type = $2`, [id, TASK_TYPE]
      );
      return recordFromRow(rows[0]);
    },
    async claim({ id, ...metadata }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [metadata.binding]);
        const pending = await readUnresolved(metadata.binding, client);
        const { rowCount } = pending ? { rowCount: 0 } : await client.query(
          `INSERT INTO public.pbk_tasks
             (id, tenant_id, from_agent, to_agent, task_type, status, correlation_id, provider_writes, summary, metadata)
           VALUES ($1, 'pbk', 'Ava', 'Rex', $2, 'running', $1, 'blocked', 'Rex market research', $3::jsonb)
           ON CONFLICT (id) DO NOTHING`, [id, TASK_TYPE, JSON.stringify(metadata)]
        );
        await client.query('COMMIT');
        return pending || rowCount === 1;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async finish(id, token, { status, ...result }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Check the deadline only after waiting for any concurrent row writer.
        await client.query(
          `SELECT id FROM public.pbk_tasks
           WHERE id = $1 AND tenant_id = 'pbk' AND task_type = $2 FOR UPDATE`,
          [id, TASK_TYPE]
        );
        const { rowCount } = await client.query(
          `UPDATE public.pbk_tasks
           SET status = $3, metadata = metadata || $4::jsonb, updated_at = clock_timestamp()
           WHERE id = $1 AND tenant_id = 'pbk' AND task_type = $5
             AND status = 'running' AND metadata->>'token' = $2
             AND ($3 = 'reconciliation_required' OR (metadata->>'expiresAt')::bigint > EXTRACT(EPOCH FROM clock_timestamp()) * 1000)`,
          [id, token, status, JSON.stringify(result), TASK_TYPE]
        );
        await client.query('COMMIT');
        return rowCount === 1;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
