import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import { getRuntimeEvidenceContext } from './runtime-evidence-context.mjs';

const SCHEMA = 'pbk-runtime-source-evidence-v1';
const SUITE = 'runtime_source_evidence_v1';
const SOURCE = 'server:runtime-source-evidence:v1';
const MAX_ROWS = 10000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_REPORT = 8192;
const DEADLINE_MS = 30000;
const WINDOW_MS = 86400000;
const FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
const stamp = column => `to_char(${column} AT TIME ZONE 'UTC', '${FORMAT}') AS ${column}`;

// Fixed audited projections, not caller SQL or caller provenance. Private fields are only HMAC input.
const sources = Object.freeze({
  runtime_archive: { table: 'activity_log', scope: "workspace_id = 'pbk' AND source LIKE 'runtime-event:%'",
    fields: `id, workspace_id, source, status, category, text, metadata, ${stamp('created_at')}, ${stamp('updated_at')}` },
  conversation_projection: { table: 'conversation_events', scope: "workspace_id = 'pbk'",
    fields: `id, workspace_id, source_table, source_id, event_type, channel, direction, status, body, payload,
      ${stamp('created_at')}, ${stamp('updated_at')}, ${stamp('occurred_at')}` },
  qa: { table: 'pbk_qa_audit', scope: "tenant_id = 'pbk'",
    fields: `id, tenant_id, tool_name, passed, skipped, reason, validator, retry_count, params, result, qa,
      source, ${stamp('created_at')}` },
  safety: { table: 'pbk_safety_audit', scope: "tenant_id = 'pbk'",
    fields: `id, tenant_id, tool_name, blocked, approval_required, params, validation, source, ${stamp('created_at')}` },
});
const kinds = Object.keys(sources);
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype);
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const validSecret = value => typeof value === 'string' && value.length > 0;
const validClock = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = n => new Date(n).toISOString();
const bytes = value => Buffer.byteLength(canonicalJson(value));
const clock = now => typeof now === 'function' ? now() : now;
const time = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;

function opaque(secret, domain, value) {
  const key = createHmac('sha256', secret).update('pbk.runtime-source-evidence.signing-key.v1').digest();
  return createHmac('sha256', key).update(`${SCHEMA}\n${domain}\n${canonicalJson(value)}`).digest('hex');
}
const receiptId = (secret, sourceKind, recordRef) =>
  `runtime-source-${opaque(secret, 'receipt-id', { sourceKind, recordRef })}`;
const signature = (report, secret) => {
  const { signature: _ignored, ...unsigned } = report;
  return opaque(secret, 'receipt-signature', unsigned);
};
const gap = result => ({ ok: false, verified: false, readbackVerified: false, eligible: false, result });
const timeout = () => Object.assign(new Error('Source observation deadline'), { code: 'SOURCE_TIMEOUT' });
const releaseClient = (client, destroy) => { try { client?.release?.(destroy); } catch { /* Monitoring stays non-throwing. */ } };

function deadline() {
  const started = performance.now();
  let expired = false;
  const remaining = () => DEADLINE_MS - (performance.now() - started);
  const check = () => { if (expired || remaining() <= 0) { expired = true; throw timeout(); } };
  return { remaining, check, async run(action, { onTimeout, onLate } = {}) {
    check();
    let timer, abandoned = false;
    const operation = Promise.resolve().then(() => { check(); return action(); });
    operation.then(value => { if (abandoned) onLate?.(value); }, () => {}).catch(() => {});
    try {
      const value = await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => {
          abandoned = true; expired = true; onTimeout?.(); reject(timeout());
        }, Math.max(1, Math.ceil(remaining())));
      })]);
      try { check(); }
      catch (error) { abandoned = true; onTimeout?.(); onLate?.(value); throw error; }
      return value;
    } finally { clearTimeout(timer); }
  } };
}

async function transaction(client, budget, action, destroy) {
  const query = (text, values = []) => budget.run(() => client.query({ text, values,
    query_timeout: Math.max(1, Math.ceil(budget.remaining())) }), { onTimeout: destroy });
  await query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await query(`SELECT set_config('statement_timeout',$1,true), set_config('lock_timeout',$1,true),
      set_config('idle_in_transaction_session_timeout',$1,true)`, [`${Math.max(1, Math.floor(budget.remaining()))}ms`]);
    const lock = await query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [SOURCE]);
    if (lock.rows?.[0]?.acquired !== true) throw new Error('Source evidence busy');
    const value = await action(query);
    budget.check();
    await query('COMMIT');
    return value;
  } catch (error) {
    // An abandoned query must never have a rollback or commit queued behind it.
    if (error.code === 'SOURCE_TIMEOUT') destroy?.();
    else await query('ROLLBACK').catch(() => destroy?.());
    throw error;
  }
}

function sourceClockValid(row, kind, observed) {
  const required = ['created_at', ...(['runtime_archive', 'conversation_projection'].includes(kind) ? ['updated_at'] : []),
    ...(kind === 'conversation_projection' ? ['occurred_at'] : [])];
  const max = iso(observed).replace(/Z$/, '000Z');
  for (const key of required) {
    if (!Number.isFinite(time(row[key])) || row[key] > max) return false;
  }
  return !row.updated_at || row.created_at <= row.updated_at;
}

function outcomeOf(row, kind) {
  if (kind === 'runtime_archive') return ({ success: 'success', warning: 'warning', error: 'failed',
    failed: 'failed', cancelled: 'cancelled' })[row.status] || 'unknown';
  if (kind === 'qa') return typeof row.passed !== 'boolean' || typeof row.skipped !== 'boolean' ? 'unknown'
    : row.skipped ? 'skipped' : row.passed ? 'success' : 'failed';
  if (kind === 'safety') return typeof row.blocked !== 'boolean' || typeof row.approval_required !== 'boolean'
    ? 'unknown' : row.blocked ? 'blocked' : 'allowed';
  return ({ completed: 'success', delivered: 'success', sent: 'success', received: 'success',
    failed: 'failed', error: 'failed', cancelled: 'cancelled', pending: 'pending',
    queued: 'pending', approved: 'pending', rejected: 'blocked' })[row.status] || 'unknown';
}

function binding(row, kind, secret) {
  if (!plain(row) || typeof row.id !== 'string' || !row.id.length || row.id.length > 512
    || (row.workspace_id ?? row.tenant_id) !== 'pbk') throw new Error('Source row invalid');
  return { recordRef: opaque(secret, 'record-reference', { tenantId: 'pbk', sourceKind: kind, id: row.id }),
    sourceBinding: opaque(secret, 'source-binding', { tenantId: 'pbk', sourceKind: kind, row }) };
}

function makeReport({ revision, sourceKind, recordRef, sourceBinding, presence = 'present',
  context, outcome, clockValid, observedAt, secret }) {
  const report = { schemaVersion: SCHEMA, tenantId: 'pbk', revision, sourceKind, recordRef, sourceBinding,
    presence, receiptKind: context.classification === 'unknown' ? 'observed_unknown' : 'source_write',
    origin: context.origin, classification: context.classification, outcome, clockValid, observedAt: iso(observedAt) };
  report.signature = signature(report, secret);
  if (bytes(report) > MAX_REPORT) throw new Error('Source receipt oversized');
  return report;
}

function verifyReceipt(row, { secret, revision, now }) {
  const r = row?.report;
  if (!plain(r) || bytes(r) > MAX_REPORT || r.schemaVersion !== SCHEMA || r.tenantId !== 'pbk'
    || r.revision !== revision || !kinds.includes(r.sourceKind) || !hex(r.recordRef) || !hex(r.sourceBinding)
    || !['present', 'deleted'].includes(r.presence) || typeof r.clockValid !== 'boolean'
    || !Number.isFinite(time(r.observedAt)) || iso(time(r.observedAt)) !== r.observedAt || time(r.observedAt) > now
    || !hex(r.signature) || row.tenant_id !== 'pbk' || row.suite_name !== SUITE || row.source !== SOURCE
    || row.ok !== false || row.total !== 0 || row.passed !== 0 || row.failed !== 0
    || row.id !== receiptId(secret, r.sourceKind, r.recordRef)) return null;
  const stored = row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(row.created_at);
  if (stored !== time(r.observedAt)) return null;
  const originClass = { operator_chat: 'operational', phone_turn: 'operational', registered_business: 'operational',
    runtime_circuit: 'operational', diagnostic: 'diagnostic', controlled: 'controlled', unknown: 'unknown' };
  if (originClass[r.origin] !== r.classification || !originClass[r.origin]
    || r.receiptKind !== (r.classification === 'unknown' ? 'observed_unknown' : 'source_write')
    || r.presence === 'deleted' && (r.classification !== 'unknown' || r.outcome !== 'deleted')
    || !['success', 'warning', 'failed', 'cancelled', 'skipped', 'blocked', 'allowed', 'pending', 'unknown', 'deleted'].includes(r.outcome)) return null;
  const expected = makeReport({ ...r, context: { origin: r.origin, classification: r.classification },
    observedAt: time(r.observedAt), secret });
  return canonicalJson(expected) === canonicalJson(r)
    && timingSafeEqual(Buffer.from(r.signature, 'hex'), Buffer.from(signature(r, secret), 'hex')) ? r : null;
}

const receiptSelect = `SELECT id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at
  FROM public.pbk_eval_runs`;
async function save(query, report, secret) {
  const id = receiptId(secret, report.sourceKind, report.recordRef);
  const result = await query(`INSERT INTO public.pbk_eval_runs
    (id,tenant_id,suite_name,ok,total,passed,failed,report,source,created_at)
    VALUES ($1,'pbk',$2,false,0,0,0,$3::jsonb,$4,$5::timestamptz)
    ON CONFLICT (id) DO UPDATE SET report=EXCLUDED.report, created_at=EXCLUDED.created_at
    WHERE pbk_eval_runs.tenant_id='pbk' AND pbk_eval_runs.suite_name=$2 AND pbk_eval_runs.source=$4`,
  [id, SUITE, JSON.stringify(report), SOURCE, report.observedAt]);
  if (result.rowCount !== 1 && result.affectedRows !== 1) throw new Error('Source evidence not saved');
  const row = (await query(`${receiptSelect} WHERE id=$1`, [id])).rows?.[0];
  const verified = verifyReceipt(row, { secret, revision: report.revision, now: time(report.observedAt) });
  if (!verified || canonicalJson(verified) !== canonicalJson(report)) throw new Error('Source evidence readback failed');
}

function observeClock(now, start, previous = start) {
  const value = clock(now);
  if (!validClock(value) || value < previous || value - start > DEADLINE_MS) throw new Error('Source clock invalid');
  return value;
}

export async function recordRuntimeSourceEvidence({ pool, secret, revision, sourceKind, sourceId, now = Date.now } = {}) {
  const context = getRuntimeEvidenceContext();
  if (context.classification === 'unknown') return { ...gap('source_context_unknown'), classification: 'unknown' };
  if (!pool?.connect || !validSecret(secret) || !validRevision(revision) || !kinds.includes(sourceKind)
    || typeof sourceId !== 'string' || !sourceId.length || sourceId.length > 512) return gap('source_input_unverified');
  const budget = deadline();
  let client, released = false;
  const release = destroy => { if (client && !released) { released = true; releaseClient(client, destroy); } };
  try {
    const start = clock(now);
    if (!validClock(start)) return gap('source_clock_unverified');
    client = await budget.run(() => pool.connect(), { onLate: late => releaseClient(late, true) });
    const result = await transaction(client, budget, async query => {
      const source = sources[sourceKind];
      const sql = `SELECT ${source.fields} FROM public.${source.table} WHERE ${source.scope} AND id::text=$1`;
      const size = (await query(`SELECT octet_length(to_jsonb(p)::text) AS bytes FROM (${sql}) p`, [sourceId])).rows;
      if (size?.length !== 1 || !Number.isSafeInteger(Number(size[0].bytes)) || Number(size[0].bytes) > MAX_BYTES) {
        throw new Error('Source missing or oversized');
      }
      const row = (await query(`SELECT to_jsonb(p) AS row FROM (${sql} FOR SHARE) p`, [sourceId])).rows?.[0]?.row;
      const refs = binding(row, sourceKind, secret);
      const observedAt = observeClock(now, start);
      const outcome = outcomeOf(row, sourceKind);
      if (!sourceClockValid(row, sourceKind, observedAt) || outcome === 'unknown') throw new Error('Source unverified');
      const id = receiptId(secret, sourceKind, refs.recordRef);
      const prior = verifyReceipt((await query(`${receiptSelect} WHERE id=$1`, [id])).rows?.[0],
        { secret, revision, now: observedAt });
      if (prior?.classification === 'operational' && context.classification !== 'operational') {
        throw new Error('Source context mismatch');
      }
      // A delayed duplicate must not move the first observation forward or upgrade its origin.
      const report = prior?.presence === 'present' && prior.sourceBinding === refs.sourceBinding ? prior
        : makeReport({ revision, sourceKind, ...refs, context, outcome, clockValid: true, observedAt, secret });
      await save(query, report, secret);
      observeClock(now, start, observedAt);
      return { ok: true, verified: true, readbackVerified: true, eligible: false, result: 'source_receipt_verified',
        sourceKind, recordRef: refs.recordRef, sourceBinding: refs.sourceBinding,
        classification: report.classification, observedAt: report.observedAt };
    }, () => release(true));
    return result;
  } catch (error) {
    release(true);
    return gap(error.code === 'SOURCE_TIMEOUT' ? 'source_evidence_timed_out' : 'source_evidence_unverified');
  } finally { release(false); }
}

async function census(query) {
  const rows = new Map();
  let count = 0, totalBytes = 0;
  for (const kind of kinds) {
    const source = sources[kind];
    const select = `SELECT ${source.fields} FROM public.${source.table} WHERE ${source.scope}`;
    const size = (await query(`SELECT COUNT(*) AS count, COALESCE(SUM(octet_length(to_jsonb(p)::text)),0) AS bytes
      FROM (${select}) p`)).rows?.[0];
    const n = Number(size?.count), b = Number(size?.bytes);
    if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(b) || b < 0) throw new Error('Census invalid');
    count += n; totalBytes += b;
    if (count > MAX_ROWS || totalBytes > MAX_BYTES) throw new Error('Census oversized');
    const selected = (await query(`SELECT to_jsonb(p) AS row FROM (${select} ORDER BY id LIMIT 10001) p`)).rows;
    if (!Array.isArray(selected) || selected.length !== n) throw new Error('Census incomplete');
    rows.set(kind, selected.map(value => value.row));
  }
  const where = "tenant_id='pbk' AND (suite_name=$1 OR source=$2)";
  const size = (await query(`SELECT COUNT(*) AS count, COALESCE(SUM(octet_length(to_jsonb(p)::text)),0) AS bytes
    FROM (${receiptSelect} WHERE ${where}) p`, [SUITE, SOURCE])).rows?.[0];
  const n = Number(size?.count), b = Number(size?.bytes);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_ROWS || !Number.isSafeInteger(b) || b < 0
    || totalBytes + b > MAX_BYTES) throw new Error('Proof census oversized');
  const receipts = (await query(`${receiptSelect} WHERE ${where} ORDER BY id LIMIT 10001`, [SUITE, SOURCE])).rows;
  if (!Array.isArray(receipts) || receipts.length !== n || bytes(receipts) + totalBytes > MAX_BYTES) {
    throw new Error('Proof census incomplete');
  }
  return { rows, receipts, sourceBytes: totalBytes };
}

function classify(report, windowStart, windowEnd) {
  const inWindow = time(report.observedAt) >= windowStart && time(report.observedAt) <= windowEnd;
  return { sourceKind: report.sourceKind, recordRef: report.recordRef, sourceBinding: report.sourceBinding,
    presence: report.presence, classification: report.classification, origin: report.origin,
    receiptKind: report.receiptKind, outcome: report.outcome, clockValid: report.clockValid,
    observedAt: report.observedAt, inWindow,
    eligible: inWindow && report.classification === 'operational' && report.presence === 'present'
      && report.clockValid && report.outcome === 'success' };
}

function summarize(sourceKind, rows, secret, windowEnd) {
  rows.sort((a, b) => a.recordRef.localeCompare(b.recordRef));
  const counts = { census: rows.length, present: 0, deleted: 0, inWindow: 0, unknown: 0,
    operational: 0, controlled: 0, diagnostic: 0, lateUnknown: 0, success: 0, warning: 0,
    failed: 0, cancelled: 0, skipped: 0, blocked: 0, allowed: 0, pending: 0,
    unknownOutcome: 0, invalidClock: 0, eligible: 0 };
  for (const row of rows) {
    counts[row.presence]++;
    if (!row.clockValid) counts.invalidClock++;
    if (row.classification === 'unknown' && time(row.observedAt) > windowEnd) counts.lateUnknown++;
    if (row.inWindow) {
      counts.inWindow++;
      counts[row.classification]++;
      if (row.outcome === 'unknown') counts.unknownOutcome++;
      else if (row.outcome !== 'deleted') counts[row.outcome]++;
      if (row.eligible) counts.eligible++;
    }
  }
  const times = rows.map(row => row.observedAt).sort();
  return { sourceKind, counts, fingerprint: opaque(secret, 'source-census', { sourceKind, rows }),
    observationBounds: { firstObservedAt: times[0] || null, lastObservedAt: times.at(-1) || null },
    eligible: counts.unknown === 0 && counts.lateUnknown === 0 && counts.failed === 0 && counts.cancelled === 0
      && counts.skipped === 0 && counts.invalidClock === 0, rows };
}

// client must be dedicated and outside any caller transaction. Only monitoring receipts are written.
export async function collectRuntimeSourceSnapshot({ client, secret, revision, windowStart, windowEnd, now = Date.now } = {}) {
  if (!client?.query || !validSecret(secret) || !validRevision(revision)
    || !validClock(windowStart) || !validClock(windowEnd) || windowStart > windowEnd
    || windowEnd - windowStart > WINDOW_MS) return gap('source_snapshot_input_unverified');
  const budget = deadline();
  let destroyed = false;
  const destroy = () => { if (!destroyed) { destroyed = true; releaseClient(client, true); } };
  try {
    const started = clock(now);
    if (!validClock(started) || windowEnd > started) return gap('source_snapshot_clock_unverified');
    return await transaction(client, budget, async query => {
      const { rows, receipts, sourceBytes } = await census(query);
      const observedAt = observeClock(now, started);
      const valid = new Map();
      let invalidReceipts = 0;
      for (const row of receipts) {
        const report = validRevision(row.report?.revision)
          ? verifyReceipt(row, { secret, revision: row.report.revision, now: observedAt }) : null;
        if (!report) { invalidReceipts++; continue; }
        const key = `${report.sourceKind}:${report.recordRef}`;
        if (valid.has(key)) throw new Error('Duplicate source receipt');
        valid.set(key, report);
      }
      const classified = new Map(kinds.map(kind => [kind, []]));
      const pending = [];
      for (const kind of kinds) {
        const seen = new Set();
        for (const row of rows.get(kind)) {
          const refs = binding(row, kind, secret);
          if (seen.has(refs.recordRef)) throw new Error('Duplicate source identity');
          seen.add(refs.recordRef);
          const key = `${kind}:${refs.recordRef}`, prior = valid.get(key);
          valid.delete(key);
          const clockValid = sourceClockValid(row, kind, observedAt), outcome = outcomeOf(row, kind);
          const unchanged = prior?.presence === 'present' && prior.sourceBinding === refs.sourceBinding ? prior
            : makeReport({ revision, sourceKind: kind, ...refs, context: { origin: 'unknown', classification: 'unknown' },
              outcome, clockValid, observedAt, secret });
          const report = unchanged.revision === revision ? unchanged : makeReport({ ...unchanged, revision,
            context: { origin: 'unknown', classification: 'unknown' },
            observedAt: unchanged.classification === 'unknown' ? time(unchanged.observedAt) : observedAt, secret });
          if (report !== prior) pending.push(report);
          classified.get(kind).push(classify(report, windowStart, windowEnd));
        }
      }
      // A tombstone anchors actual observation of absence, never the source's claimed write date.
      for (const prior of valid.values()) {
        const report = prior.presence === 'deleted' ? (prior.revision === revision ? prior
          : makeReport({ ...prior, revision, context: { origin: 'unknown', classification: 'unknown' },
            observedAt: time(prior.observedAt), secret })) : makeReport({ revision,
          sourceKind: prior.sourceKind, recordRef: prior.recordRef,
          sourceBinding: opaque(secret, 'deleted-source', { sourceKind: prior.sourceKind,
            recordRef: prior.recordRef, previousBinding: prior.sourceBinding, observedAt }),
          presence: 'deleted', context: { origin: 'unknown', classification: 'unknown' },
          outcome: 'deleted', clockValid: true, observedAt, secret });
        if (report !== prior) pending.push(report);
        classified.get(report.sourceKind).push(classify(report, windowStart, windowEnd));
      }
      if ([...classified.values()].reduce((n, values) => n + values.length, 0) > MAX_ROWS) throw new Error('Census oversized');
      // Reserve the complete next proof footprint before the first monitoring write.
      const nextReports = [...classified.values()].flat();
      if (sourceBytes + bytes(receipts) + bytes(nextReports) + bytes(pending) > MAX_BYTES) throw new Error('Observation footprint oversized');
      for (const report of pending) await save(query, report, secret);
      const summaries = kinds.map(kind => summarize(kind, classified.get(kind), secret, windowEnd));
      const completed = observeClock(now, started, observedAt);
      return { ok: true, verified: true, readbackVerified: true, result: 'source_snapshot_verified',
        schemaVersion: SCHEMA, revision, windowStart: iso(windowStart), windowEnd: iso(windowEnd),
        observationBounds: { startedAt: iso(started), completedAt: iso(completed) }, invalidReceipts,
        eligible: invalidReceipts === 0 && summaries.every(s => s.eligible)
          && summaries.some(s => s.counts.eligible > 0),
        fingerprint: opaque(secret, 'whole-census', summaries.map(({ sourceKind, fingerprint }) => ({ sourceKind, fingerprint }))),
        sources: summaries };
    }, destroy);
  } catch (error) {
    if (error.code === 'SOURCE_TIMEOUT') destroy();
    return gap(error.code === 'SOURCE_TIMEOUT' ? 'source_snapshot_timed_out' : 'source_snapshot_unverified');
  }
}
