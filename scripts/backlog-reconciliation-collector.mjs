import { createHash, createHmac } from 'node:crypto';

const LIMIT = 64;
const QUERY_MS = 2000;
const DEADLINE_MS = 15000;
const ROW_BYTES = 65536;
const HEX = /^[a-f0-9]{64}$/;
const COUNT_KEYS = ['dispatchesLocked', 'deadLettersOpen', 'qaRecovered', 'qaUnverified',
  'memoryVerified', 'memoryUnverified'];
const SOURCES = new Set(['telnyx-deepgram-finalize', 'telnyx-recording-capture']);
const QA_COMPONENT_VALUES = Object.freeze({ painProbe: [8, 20], objectionHandling: [10, 18, 25],
  offerPresentation: [7, 20], nextStep: [6, 20], toneRapport: [5, 15] });

// Full JSON rows bind every field, including failures, payloads and schema-added timestamps.
// Only these fixed SELECTs run; ids are parameters derived from this transaction's originals.
const DISPATCH_SQL = `SELECT octet_length(to_jsonb(d)::text) AS "originalBytes",
  CASE WHEN octet_length(to_jsonb(d)::text) <= 65536 THEN to_jsonb(d) ELSE NULL END AS original,
  octet_length(to_jsonb(a)::text) AS "approvalBytes",
  CASE WHEN octet_length(to_jsonb(a)::text) <= 65536 THEN to_jsonb(a) ELSE NULL END AS approval
  FROM public.provider_action_dispatches d
  LEFT JOIN public.approvals a ON a.id = d.approval_id AND a.workspace_id = 'pbk'
  WHERE d.workspace_id = 'pbk' AND d.status IS DISTINCT FROM 'completed'
  ORDER BY d.approval_id LIMIT 65`;
const DEAD_SQL = `SELECT octet_length(to_jsonb(d)::text) AS "originalBytes",
  CASE WHEN octet_length(to_jsonb(d)::text) <= 65536 THEN to_jsonb(d) ELSE NULL END AS original
  FROM public.event_dead_letters d
  WHERE d.tenant_id = 'pbk' ORDER BY d.id LIMIT 65`;
const QA_SQL = `SELECT octet_length(to_jsonb(q)::text) AS "proofBytes",
  CASE WHEN octet_length(to_jsonb(q)::text) <= 65536 THEN to_jsonb(q) ELSE NULL END AS proof
  FROM public.pbk_call_qa_scores q
  WHERE q.tenant_id = 'pbk' AND q.id = ANY($1::text[])
  ORDER BY q.id LIMIT 65`;
const MEMORY_SQL = `SELECT octet_length(to_jsonb(e)::text) AS "proofBytes",
  CASE WHEN octet_length(to_jsonb(e)::text) <= 65536 THEN to_jsonb(e) ELSE NULL END AS proof
  FROM public.call_embeddings e
  WHERE e.workspace_id = 'pbk' AND e.call_id = ANY($1::text[])
  ORDER BY e.id LIMIT 65`;

function object(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value, keys) {
  if (!object(value) || Reflect.ownKeys(value).length !== keys.length) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value')
    && descriptors[key].enumerable);
}
function list(value) {
  return Array.isArray(value) && value.length <= LIMIT
    && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({ length: value.length }, (_, i) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable;
    }).every(Boolean);
}
function hex(value) { return typeof value === 'string' && HEX.test(value); }

export function validateBacklogReconciliation(value) {
  try {
    if (!exact(value, ['sourceFingerprint', 'complete', 'noContact', 'providerWritesBlocked',
      'counts', 'dispatches', 'deadLetters']) || !hex(value.sourceFingerprint)
      || value.complete !== true || value.noContact !== true || value.providerWritesBlocked !== true
      || !exact(value.counts, COUNT_KEYS) || !list(value.dispatches) || !list(value.deadLetters)) return false;
    if (!COUNT_KEYS.every(key => Number.isSafeInteger(value.counts[key]) && value.counts[key] >= 0)) return false;
    const refs = new Set();
    for (const row of value.dispatches) {
      if (!exact(row, ['recordRef', 'sourceBinding', 'status', 'deliveryProof', 'binding', 'approval'])
        || !hex(row.recordRef) || !hex(row.sourceBinding) || refs.has(row.recordRef)
        || row.status !== 'manual_review_locked' || row.deliveryProof !== 'unverified'
        || !['present', 'missing'].includes(row.binding)
        || !['approved', 'pending', 'other', 'missing'].includes(row.approval)) return false;
      refs.add(row.recordRef);
    }
    for (const row of value.deadLetters) {
      if (!exact(row, ['recordRef', 'sourceBinding', 'status', 'qa', 'memory', 'fullRecovery'])
        || !hex(row.recordRef) || !hex(row.sourceBinding) || refs.has(row.recordRef)
        || row.status !== 'review_required' || row.fullRecovery !== 'unverified'
        || !['verified', 'unverified'].includes(row.qa)
        || !['verified', 'unverified'].includes(row.memory)) return false;
      refs.add(row.recordRef);
    }
    const count = (field, status) => value.deadLetters.filter(row => row[field] === status).length;
    return value.counts.dispatchesLocked === value.dispatches.length
      && value.counts.deadLettersOpen === value.deadLetters.length
      && value.counts.qaRecovered === count('qa', 'verified')
      && value.counts.qaUnverified === count('qa', 'unverified')
      && value.counts.memoryVerified === count('memory', 'verified')
      && value.counts.memoryUnverified === count('memory', 'unverified');
  } catch { return false; }
}

function fail(reason) { throw Object.assign(new Error(reason), { reason }); }
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!object(value)) fail('invalid_source');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function keyed(secret, domain, value) {
  return createHmac('sha256', secret).update(`pbk:backlog-reconciliation:v1:${domain}\0`)
    .update(canonical(value)).digest('hex');
}
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function time(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at >= 0 && at <= now ? at : null;
}
function originalShape(row, id, tenant, now) {
  if (!object(row) || !nonempty(row[id]) || row[tenant] !== 'pbk'
    || time(row.created_at, now) === null) fail('invalid_source');
}
function proofShape(row, tenant) {
  if (!object(row) || !nonempty(row.id) || row[tenant] !== 'pbk'
    || typeof row.call_id !== 'string' || !object(row.metadata)) fail('invalid_source');
}
function boundedRow(row, field, nullable = false) {
  const bytes = row[`${field}Bytes`];
  if (nullable && bytes === null && row[field] === null) return;
  if (!Number.isSafeInteger(bytes) || bytes < 0) fail('invalid_source');
  if (bytes > ROW_BYTES) fail('source_overflow');
  if (!object(row[field])) fail('invalid_source');
}
function identity(payload, keys) {
  const values = keys.filter(key => Object.hasOwn(payload, key)).map(key => payload[key]);
  if (!values.length || !values.every(nonempty)) return null;
  const trimmed = values.map(value => value.trim());
  return trimmed.every(value => value === trimmed[0]) ? trimmed[0] : null;
}
function nonsynthetic(value) {
  return !['synthetic', 'fixture', 'test', 'controlled'].some(key => Object.hasOwn(value, key) && value[key] !== false)
    && !/synthetic|fixture|controlled-qualification|chaos-test/i.test(String(value.source || ''))
    && (!Object.hasOwn(value, 'metadata') || (object(value.metadata) && nonsynthetic(value.metadata)));
}
function context(original, now) {
  const p = original.payload;
  const call = identity(p, ['callId', 'call_id']);
  const scope = identity(p, ['workspaceId', 'workspace_id']);
  const text = typeof p.transcript === 'string' ? p.transcript.trim() : '';
  const eligible = original.event_type === 'call.completed' && SOURCES.has(original.source)
    && nonempty(original.event_id) && call !== null && scope === 'pbk' && text.length > 0
    && nonsynthetic(p) && time(original.created_at, now) !== null;
  return { call, text, eligible, qaId: `call-qa-event-${original.event_id}` };
}
function completedQaScore(proof) {
  if (typeof proof.score !== 'number' || !Number.isFinite(proof.score)
    || proof.score < 0 || proof.score > 100) return false;
  // Validate buildCallQaScore's stored outputs, without re-scoring or imposing a passing grade.
  const grade = proof.score >= 85 ? 'A' : proof.score >= 72 ? 'B' : proof.score >= 60 ? 'C' : 'needs_coaching';
  if (proof.grade !== grade || !exact(proof.breakdown, Object.keys(QA_COMPONENT_VALUES))) return false;
  let total = 0;
  for (const [key, values] of Object.entries(QA_COMPONENT_VALUES)) {
    if (!values.includes(proof.breakdown[key])) return false;
    total += proof.breakdown[key];
  }
  return total === proof.score;
}
function embedding(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) && parsed.length === 1536
      && parsed.every(n => typeof n === 'number' && Number.isFinite(n))
      && parsed.some(n => n !== 0);
  } catch { return false; }
}
function summarize(dispatches, deadLetters, qa, memory, secret, now) {
  const output = {
    sourceFingerprint: keyed(secret, 'full-source', { dispatches, deadLetters, qa, memory }),
    complete: true, noContact: true, providerWritesBlocked: true,
    counts: { dispatchesLocked: dispatches.length, deadLettersOpen: deadLetters.length,
      qaRecovered: 0, qaUnverified: 0, memoryVerified: 0, memoryUnverified: 0 },
    dispatches: dispatches.map(row => ({
      recordRef: keyed(secret, 'dispatch-ref', row.original.approval_id),
      sourceBinding: keyed(secret, 'dispatch-binding', row),
      status: 'manual_review_locked', deliveryProof: 'unverified',
      binding: nonempty(row.original.binding_hash) ? 'present' : 'missing',
      approval: row.approval === null ? 'missing'
        : ['approved', 'pending'].includes(row.approval.status) ? row.approval.status : 'other',
    })),
    deadLetters: deadLetters.map(({ original }) => {
      const c = context(original, now);
      const qaRows = qa.filter(({ proof }) => proof.id === c.qaId);
      const memoryRows = memory.filter(({ proof }) => proof.call_id === c.call);
      const qaVerified = c.eligible && c.text.length <= 2000 && qaRows.some(({ proof }) => proof.id === c.qaId
        && proof.call_id === c.call && proof.transcript_snippet === c.text
        && time(proof.created_at, now) !== null && nonsynthetic(proof.metadata) && completedQaScore(proof));
      const hash = createHash('sha256').update(c.text).digest('hex');
      const memoryVerified = c.eligible && memoryRows.some(({ proof }) => proof.source_text === c.text
        && proof.transcript_hash === hash && proof.synthetic === false && nonsynthetic(proof.metadata)
        && nonempty(proof.embedding_model)
        && !/(?:^|[^a-z0-9])(?:synthetic|fixture|mock|test)(?:$|[^a-z0-9])/i.test(proof.embedding_model)
        && embedding(proof.embedding)
        && time(proof.created_at, now) !== null && time(proof.updated_at, now) !== null
        && Date.parse(proof.updated_at) >= Date.parse(proof.created_at));
      return {
        recordRef: keyed(secret, 'dead-letter-ref', original.id),
        sourceBinding: keyed(secret, 'dead-letter-binding', { original, qa: qaRows, memory: memoryRows }),
        status: 'review_required', qa: qaVerified ? 'verified' : 'unverified',
        memory: memoryVerified ? 'verified' : 'unverified', fullRecovery: 'unverified',
      };
    }),
  };
  // Counts are filled below to avoid retaining any source data in the public shape.
  output.counts.qaRecovered = output.deadLetters.filter(row => row.qa === 'verified').length;
  output.counts.qaUnverified = deadLetters.length - output.counts.qaRecovered;
  output.counts.memoryVerified = output.deadLetters.filter(row => row.memory === 'verified').length;
  output.counts.memoryUnverified = deadLetters.length - output.counts.memoryVerified;
  if (!validateBacklogReconciliation(output)) fail('invalid_source');
  return output;
}

async function bounded(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('query_failed'), { reason: 'query_failed' })), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function collectBacklogReconciliation({ pool, secret, now = Date.now() } = {}) {
  const failure = result => ({ ok: false, result, reconciliation: null });
  if (typeof secret !== 'string' || !secret.trim() || !Number.isSafeInteger(now) || now < 0
    || !Number.isFinite(new Date(now).getTime())) return failure('invalid_input');
  if (!pool || typeof pool.connect !== 'function' || pool.controlled === true) return failure('source_unavailable');
  let client;
  let abandoned = false;
  let destroy = false;
  let report;
  const deadline = performance.now() + DEADLINE_MS;
  const remaining = () => {
    const ms = Math.floor(deadline - performance.now());
    if (ms <= 0) fail('query_failed');
    return Math.min(QUERY_MS, ms);
  };
  try {
    const connection = Promise.resolve().then(() => pool.connect()).then(acquired => {
      if (abandoned) {
        try { acquired?.release(true); } catch { /* Late clients are never reused. */ }
        return null;
      }
      return acquired;
    });
    try { client = await bounded(() => connection, remaining()); }
    catch (error) { abandoned = true; throw error; }
    if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') fail('source_unavailable');
    const query = (text, values = []) => {
      const ms = remaining();
      return bounded(() => client.query({ text, values, query_timeout: ms }), ms);
    };
    const rows = async (sql, values = []) => {
      const result = await query(sql, values);
      if (!Array.isArray(result?.rows)) fail('invalid_source');
      if (result.rows.length > LIMIT) fail('source_overflow');
      return result.rows;
    };
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await query("SET LOCAL statement_timeout = '1500ms'");
    await query("SET LOCAL lock_timeout = '500ms'");
    await query("SET LOCAL idle_in_transaction_session_timeout = '3000ms'");
    const dispatches = await rows(DISPATCH_SQL);
    const deadLetters = await rows(DEAD_SQL);
    for (const row of dispatches) {
      if (!exact(row, ['original', 'originalBytes', 'approval', 'approvalBytes'])) fail('invalid_source');
      boundedRow(row, 'original');
      boundedRow(row, 'approval', true);
      originalShape(row.original, 'approval_id', 'workspace_id', now);
      if (typeof row.original.status !== 'string' || row.original.status === 'completed'
        || typeof row.original.binding_hash !== 'string' || time(row.original.updated_at, now) === null) fail('invalid_source');
      if (row.approval !== null) {
        originalShape(row.approval, 'id', 'workspace_id', now);
        if (row.approval.id !== row.original.approval_id || typeof row.approval.status !== 'string'
          || time(row.approval.updated_at, now) === null) fail('invalid_source');
      }
    }
    for (const row of deadLetters) {
      if (!exact(row, ['original', 'originalBytes'])) fail('invalid_source');
      boundedRow(row, 'original');
      originalShape(row.original, 'id', 'tenant_id', now);
      if (!object(row.original.payload) || typeof row.original.event_id !== 'string'
        || typeof row.original.event_type !== 'string' || typeof row.original.source !== 'string') fail('invalid_source');
    }
    const contexts = deadLetters.map(({ original }) => context(original, now));
    const calls = [...new Set(contexts.map(c => c.call).filter(nonempty))];
    const qa = await rows(QA_SQL, [[...new Set(contexts.map(c => c.qaId))]]);
    const memory = await rows(MEMORY_SQL, [calls]);
    for (const row of qa) {
      if (!exact(row, ['proof', 'proofBytes'])) fail('invalid_source');
      boundedRow(row, 'proof');
      proofShape(row.proof, 'tenant_id');
      if (typeof row.proof.transcript_snippet !== 'string') fail('invalid_source');
    }
    for (const row of memory) {
      if (!exact(row, ['proof', 'proofBytes'])) fail('invalid_source');
      boundedRow(row, 'proof');
      proofShape(row.proof, 'workspace_id');
      if (typeof row.proof.source_text !== 'string' || typeof row.proof.transcript_hash !== 'string'
        || typeof row.proof.synthetic !== 'boolean') fail('invalid_source');
    }
    const reconciliation = summarize(dispatches, deadLetters, qa, memory, secret, now);
    remaining();
    report = { ok: true, result: 'backlog_reconciliation_collected', reconciliation };
  } catch (error) {
    destroy = true;
    const reason = ['invalid_source', 'source_overflow', 'source_unavailable', 'query_failed'].includes(error?.reason)
      ? error.reason : ['42P01', '42703', '3F000'].includes(error?.code) ? 'source_unavailable' : 'query_failed';
    report = failure(reason);
  } finally {
    if (client) {
      try {
        await bounded(() => client.query({ text: 'ROLLBACK', values: [], query_timeout: 500 }), 500);
      } catch { destroy = true; report = failure('query_failed'); }
      finally {
        try { client.release(destroy); }
        catch { report = failure('query_failed'); }
      }
    }
  }
  return report;
}
