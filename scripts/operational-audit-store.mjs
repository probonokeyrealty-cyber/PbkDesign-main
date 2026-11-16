import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson, withPgTransaction } from './skill-governance-store.mjs';

const SCHEMA = 'pbk-operational-audit-v1';
const SUITE = 'operational_audit_v1';
const SOURCE = 'server:operational-audit:v1';
const DAY_MS = 24 * 3600_000;
const MAX_DURATION_MS = 60_000;
const MAX_REPORT_BYTES = 65_536;
export const OPERATIONAL_AUDIT_CHECK_IDS = Object.freeze(['runtime_archive', 'provider_dispatch',
  'dead_letters', 'conversation_projection', 'safety_qa', 'database_security', 'runtime_health',
  'monitoring_continuity']);
const REASONS = new Set(['no_findings', 'findings_detected', 'coverage_unverified', 'query_failed',
  'missing_table', 'missing_timestamps', 'source_unavailable', 'no_observations', 'invalid_counts',
  'invalid_check', 'invalid_collection', 'collector_failed', 'authoritative_source_unavailable',
  'contamination_unverified', 'invalid_timestamps', 'invalid_aggregate']);
const COUNT_KEYS = Object.freeze(['total', 'errors', 'observations', 'dispatching',
  'reconciliationRequired', 'unknownStatuses', 'completed', 'outstanding', 'linkedDispatches',
  'missingProjections', 'unverifiableDispatches', 'qaFailures', 'blocked', 'excludedFixtures',
  'futureTimestamps', 'missingTimestamps', 'warnings', 'events', 'dispatches', 'qaObservations',
  'safetyObservations', 'qaSkipped', 'requiredTables', 'presentTables', 'missingTables',
  'rlsDisabled', 'publicRoleGrants', 'checked', 'unhealthy']);
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype);
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,120}$/.test(value);
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const validSecret = value => typeof value === 'string' && value.length > 0;
const iso = value => new Date(value).toISOString();
const timeOf = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ? Date.parse(value) : NaN;
const validClock = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());

function unavailable(result, source = 'postgres:pbk_eval_runs') {
  return { ok: false, verified: false, readbackVerified: false, source, result,
    runId: null, revision: null, executedAt: null,
    audit: { ready: false, windowStart: null, windowEnd: null, checks: [], coverage: { verified: false } },
    evidence: {} };
}

function sign(report, secret) {
  const { attestation: _ignored, ...unsigned } = report;
  const key = createHmac('sha256', secret).update('pbk.operational-audit.signing-key.v1').digest();
  return createHmac('sha256', key).update(`${SCHEMA}\n${canonicalJson(unsigned)}`).digest('hex');
}

function emptyCheck(id, reason) {
  return { id, status: 'unverified', reason, counts: {}, firstObservedAt: null, lastObservedAt: null };
}

function normalizeCheck(input, id, windowEnd) {
  if (!plain(input)) return emptyCheck(id, 'invalid_check');
  const counts = {};
  let invalidCounts = !plain(input.counts) || Object.keys(input.counts).length > 32;
  for (const key of COUNT_KEYS) {
    if (!plain(input.counts) || !Object.hasOwn(input.counts, key)) continue;
    const value = input.counts[key];
    if (Number.isSafeInteger(value) && value >= 0) counts[key] = value;
    else invalidCounts = true;
  }
  let status = input.status;
  let reason = input.reason;
  let firstObservedAt = input.firstObservedAt;
  let lastObservedAt = input.lastObservedAt;
  const first = timeOf(firstObservedAt);
  const last = timeOf(lastObservedAt);
  // Outstanding older dispatches/dead letters remain evidence; only future/reversed bounds are invalid.
  const validBounds = firstObservedAt === null && lastObservedAt === null
    || Number.isFinite(first) && Number.isFinite(last) && first <= last && last <= windowEnd;
  if (!['passed', 'failed', 'unverified'].includes(status) || !REASONS.has(reason) || !validBounds) {
    status = 'unverified'; reason = 'invalid_check';
  }
  if (!validBounds) { firstObservedAt = null; lastObservedAt = null; }
  else if (firstObservedAt !== null) { firstObservedAt = iso(first); lastObservedAt = iso(last); }
  if (invalidCounts) { status = 'unverified'; reason = 'invalid_counts'; }
  return { id, status, reason, counts, firstObservedAt, lastObservedAt };
}

function normalizeAudit(input, started, failureReason = 'invalid_collection') {
  const windowStart = iso(started - DAY_MS);
  const windowEnd = iso(started);
  const rows = input?.checks;
  const complete = plain(input) && timeOf(input.windowStart) === started - DAY_MS
    && timeOf(input.windowEnd) === started && Array.isArray(rows)
    && rows.length === OPERATIONAL_AUDIT_CHECK_IDS.length
    && new Set(rows.map(row => row?.id)).size === OPERATIONAL_AUDIT_CHECK_IDS.length
    && OPERATIONAL_AUDIT_CHECK_IDS.every(id => rows.some(row => row?.id === id));
  const checks = OPERATIONAL_AUDIT_CHECK_IDS.map(id => complete
    ? normalizeCheck(rows.find(row => row?.id === id), id, started) : emptyCheck(id, failureReason));
  const coverage = { verified: Boolean(complete && input.coverage?.verified === true) };
  const ready = checks.every(check => check.status === 'passed') && coverage.verified
    && checks.find(check => check.id === 'monitoring_continuity').status === 'passed';
  return { ready, windowStart, windowEnd, checks, coverage };
}

function reportGuard() {
  return { noContact: true, providerWritesBlocked: true, callerReportsAccepted: false };
}

function verifyRecord(row, { revision, secret, now }) {
  const report = row?.report;
  if (!plain(report) || !validSecret(secret) || !validRevision(revision) || !validClock(now)
    || Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES) {
    return unavailable('operational_audit_record_unverified');
  }
  // A committed admission blocks all older proof even if collection/finalization never completes.
  if (report.completedAt === null) return unavailable('operational_audit_pending');
  const started = timeOf(report.startedAt);
  const completed = timeOf(report.completedAt);
  const stored = row.created_at instanceof Date ? row.created_at.getTime() : timeOf(row.created_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || started > completed
    || completed > now || now - started >= DAY_MS || completed - started > MAX_DURATION_MS
    || !Number.isFinite(stored) || stored > now || Math.abs(stored - started) > MAX_DURATION_MS) {
    return unavailable('operational_audit_record_expired_or_undated');
  }
  if (row.tenant_id !== 'pbk' || row.suite_name !== SUITE || row.source !== SOURCE
    || row.id !== report.runId || !safeId(report.runId) || report.revision !== revision) {
    return unavailable('operational_audit_record_unverified');
  }
  const supplied = report.attestation;
  if (!plain(supplied) || supplied.version !== SCHEMA || !/^[a-f0-9]{64}$/.test(supplied.signature || '')
    || Object.keys(supplied).length !== 2
    || !timingSafeEqual(Buffer.from(supplied.signature, 'hex'), Buffer.from(sign(report, secret), 'hex'))) {
    return unavailable('operational_audit_signature_invalid');
  }
  const audit = normalizeAudit(report.audit, started);
  const expected = { schemaVersion: SCHEMA, tenantId: 'pbk', runId: report.runId, revision,
    startedAt: iso(started), completedAt: iso(completed), provenance: 'operational', guard: reportGuard(), audit };
  const { attestation: _ignored, ...unsigned } = report;
  const passed = audit.checks.filter(check => check.status === 'passed').length;
  if (canonicalJson(unsigned) !== canonicalJson(expected) || row.ok !== audit.ready
    || row.total !== OPERATIONAL_AUDIT_CHECK_IDS.length || row.passed !== passed
    || row.failed !== OPERATIONAL_AUDIT_CHECK_IDS.length - passed) {
    return unavailable('operational_audit_record_unverified');
  }
  return { ok: true, verified: true, readbackVerified: true, source: 'postgres:pbk_eval_runs',
    result: audit.ready ? 'operational_audit_passed' : 'operational_audit_incomplete_or_failed',
    runId: report.runId, revision, executedAt: report.completedAt, audit,
    evidence: { silentErrors: { runId: report.runId, revision, executedAt: report.completedAt,
      executed: true, provenance: 'operational', scope: 'durable_operational_audit', passed: audit.ready } } };
}

export async function readOperationalAudit({ pool, revision, secret, now = Date.now(), id } = {}) {
  if (!pool?.query) return unavailable('operational_audit_storage_unavailable', 'postgres_unavailable');
  if (id !== undefined && !safeId(id)) return unavailable('operational_audit_record_unverified');
  try {
    // Never filter by success/revision/signature: a newer invalid attempt must block older passing proof.
    const result = await pool.query(
      `SELECT id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at
       FROM public.pbk_eval_runs
       WHERE tenant_id = $1 AND (suite_name = $2 OR source = $3)${id !== undefined ? ' AND id = $4' : ''}
       ORDER BY created_at DESC, id DESC LIMIT 1`, ['pbk', SUITE, SOURCE, ...(id !== undefined ? [id] : [])]);
    if (!result.rows?.[0]) return unavailable('operational_audit_run_missing');
    return verifyRecord(result.rows[0], { revision, secret, now });
  } catch {
    return unavailable('operational_audit_storage_unavailable', 'postgres_unavailable');
  }
}

export async function executeOperationalAudit({ pool, revision, secret, collect, now = Date.now,
  createId = () => `operational-audit-${randomUUID()}` } = {}) {
  if (!pool?.connect || !pool?.query || !validSecret(secret) || !validRevision(revision)
    || typeof collect !== 'function' || typeof now !== 'function' || typeof createId !== 'function') {
    return unavailable('operational_audit_runtime_unavailable', 'postgres_unavailable');
  }
  try {
    const started = now();
    const runId = createId();
    if (!validClock(started) || !safeId(runId)) return unavailable('operational_audit_runtime_unavailable');
    const base = { schemaVersion: SCHEMA, tenantId: 'pbk', runId, revision,
      startedAt: iso(started), completedAt: null, provenance: 'operational', guard: reportGuard() };
    const pending = { ...base, audit: normalizeAudit(null, started) };
    pending.attestation = { version: SCHEMA, signature: sign(pending, secret) };
    const admitted = await withPgTransaction(pool, async client => {
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [SOURCE]);
      if (lock.rows[0]?.acquired !== true) return false;
      const insert = await client.query(
        `INSERT INTO public.pbk_eval_runs
         (id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,
           GREATEST(clock_timestamp(), COALESCE((
             SELECT MAX(created_at) + INTERVAL '1 microsecond' FROM public.pbk_eval_runs
             WHERE tenant_id = $2 AND (suite_name = $3 OR source = $9)
           ), clock_timestamp())))`,
        [runId, 'pbk', SUITE, false, OPERATIONAL_AUDIT_CHECK_IDS.length, 0,
          OPERATIONAL_AUDIT_CHECK_IDS.length, JSON.stringify(pending), SOURCE]);
      if (insert.rowCount !== 1) throw new Error('Audit admission was not persisted');
      return true;
    });
    if (!admitted) return unavailable('operational_audit_in_progress');
    let audit;
    // Admission commits and releases its connection before collection can use a one-client pool.
    try {
      const input = await collect({ now: started, windowStart: iso(started - DAY_MS), windowEnd: iso(started) });
      audit = normalizeAudit(input, started);
    } catch {
      audit = normalizeAudit(null, started, 'collector_failed');
    }
    const completed = now();
    if (!validClock(completed) || completed < started || completed - started > MAX_DURATION_MS) {
      return unavailable('operational_audit_execution_undated');
    }
    const report = { ...base, completedAt: iso(completed), audit };
    report.attestation = { version: SCHEMA, signature: sign(report, secret) };
    if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES) throw new Error('Audit receipt exceeds limit');
    const passed = audit.checks.filter(check => check.status === 'passed').length;
    await withPgTransaction(pool, async client => {
      // Compare-and-swap only this signed pending receipt; never change its admission ordering.
      const update = await client.query(
        `UPDATE public.pbk_eval_runs
         SET ok = $4, total = $5, passed = $6, failed = $7, report = $8::jsonb
         WHERE id = $1 AND tenant_id = $2 AND suite_name = $3 AND source = $9
           AND report = $10::jsonb`,
        [runId, 'pbk', SUITE, audit.ready, OPERATIONAL_AUDIT_CHECK_IDS.length, passed,
          OPERATIONAL_AUDIT_CHECK_IDS.length - passed, JSON.stringify(report), SOURCE, JSON.stringify(pending)]);
      if (update.rowCount !== 1) throw new Error('Audit pending receipt was not finalized');
    });
    const own = await readOperationalAudit({ pool, revision, secret, now: now(), id: runId });
    if (!own.verified) return own;
    // Concurrent admissions are allowed; latest admission always wins, regardless of completion order.
    const latest = await readOperationalAudit({ pool, revision, secret, now: now() });
    if (latest.runId !== runId || !latest.verified) return unavailable('operational_audit_superseded');
    return latest;
  } catch {
    return unavailable('operational_audit_storage_unavailable', 'postgres_unavailable');
  }
}
