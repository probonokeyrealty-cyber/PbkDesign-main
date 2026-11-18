import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { canonicalJson, withPgTransaction } from './skill-governance-store.mjs';
import { RUNTIME_COVERAGE_POLICY, verifyRuntimeCoverageReference } from './runtime-coverage-store.mjs';
import { captureDeadLetterAuditBoundary, validateDeadLetterAuditBoundary,
  verifyDeadLetterClosureReference } from './dead-letter-closure-store.mjs';

const SCHEMA = 'pbk-operational-audit-v3';
const SUITE = 'operational_audit_v3';
const SOURCE = 'server:operational-audit:v3';
const VERSIONS = Object.freeze(Object.fromEntries(['v1', 'v2', 'v3'].map(version =>
  [`pbk-operational-audit-${version}`, { suite: `operational_audit_${version}`,
    source: `server:operational-audit:${version}`, key: `pbk.operational-audit.signing-key.${version}` }])));
const LEGACY_SUITE = 'operational_audit_v1', LEGACY_SOURCE = 'server:operational-audit:v1';
const DAY_MS = 24 * 3600_000;
const MAX_DURATION_MS = 60_000;
const MAX_REPORT_BYTES = 65_536;
const auditScope = new AsyncLocalStorage();
const wrappedPools = new WeakMap();

function auditFence(duration = MAX_DURATION_MS) {
  const deadlineAt = Math.min(performance.now() + duration, auditScope.getStore()?.deadlineAt ?? Infinity);
  const controller = new AbortController(), clients = new Set();
  let poisoned = false;
  const error = () => Object.assign(new Error('audit_deadline'), { code: 'AUDIT_TIMEOUT' });
  const abort = () => {
    poisoned = true;
    controller.abort();
    for (const release of clients) { try { release(true); } catch { /* A broken client cannot reopen the fence. */ } }
  };
  const check = () => { if (poisoned || performance.now() >= deadlineAt) { abort(); throw error(); } };
  const run = async (operation, limit = MAX_DURATION_MS, onLate) => {
    check();
    let timer, listener, abandoned = false;
    const work = Promise.resolve().then(() => { check(); return operation(); });
    work.then(value => { if (abandoned) onLate?.(value); }, () => {}).catch(() => {});
    try {
      const value = await Promise.race([work, new Promise((_, reject) => {
        listener = () => { abandoned = true; reject(error()); };
        controller.signal.addEventListener('abort', listener, { once: true });
        timer = setTimeout(abort, Math.max(1, Math.floor(Math.min(limit, deadlineAt - performance.now()))));
      })]);
      try { check(); } catch (err) { abandoned = true; onLate?.(value); throw err; }
      return value;
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', listener); }
  };
  return { deadlineAt, signal: controller.signal, check, run, clients, abort };
}

// Capture audit scope at checkout: detached nested source work cannot outlive its parent.
// Outside an audit the lifecycle sampler retains its original pool and operation budgets.
export function createOperationalAuditPool(pool) {
  if (!pool?.connect) return pool;
  if (wrappedPools.has(pool)) return wrappedPools.get(pool);
  const wrapped = { get controlled() { return pool.controlled; },
    async connect() {
      const fence = auditScope.getStore();
      if (!fence) return pool.connect();
      let released = false;
      const raw = await fence.run(() => pool.connect(), 2000, late => { try { late.release(true); } catch { /* Late checkout. */ } });
      const release = destroy => {
        if (released) return;
        released = true; fence.clients.delete(release);
        raw.release(destroy);
      };
      fence.clients.add(release);
      return { release, on: raw.on?.bind(raw), removeListener: raw.removeListener?.bind(raw), query(config, values) {
        fence.check();
        if (released) throw new Error('audit_client_released');
        const text = typeof config === 'string' ? config : config.text;
        const params = typeof config === 'string' ? values : config.values;
        return fence.run(() => raw.query({ text, values: params,
          query_timeout: Math.max(1, Math.floor(Math.min(2000, deadlineRemaining(fence)))) }), 2000);
      } };
    },
    async query(config, values) {
      if (!auditScope.getStore()) return pool.query(config, values);
      const client = await wrapped.connect();
      try { return await client.query(config, values); }
      finally { client.release(false); }
    } };
  wrappedPools.set(pool, wrapped); wrappedPools.set(wrapped, wrapped);
  return wrapped;
}
const deadlineRemaining = fence => fence.deadlineAt - performance.now();

async function inAuditScope(pool, action) {
  if (auditScope.getStore()) return action(createOperationalAuditPool(pool));
  const fence = auditFence();
  try { return await auditScope.run(fence, () => fence.run(() => action(createOperationalAuditPool(pool)))); }
  finally { fence.abort(); }
}

// The sampler's already-wrapped pool also inherits this child scope at checkout.
export async function withOperationalAuditCollection(pool, action) {
  const fence = auditFence(15_000);
  try { return await auditScope.run(fence, () => fence.run(() => action(createOperationalAuditPool(pool)), 15_000)); }
  finally { fence.abort(); }
}
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
  const schema = report.schemaVersion;
  if (!Object.hasOwn(VERSIONS, schema)) throw new Error('unsupported_audit_schema');
  const key = createHmac('sha256', secret).update(VERSIONS[schema].key).digest();
  return createHmac('sha256', key).update(`${schema}\n${canonicalJson(unsigned)}`).digest('hex');
}

function emptyCheck(id, reason) {
  return { id, status: 'unverified', reason, counts: {}, firstObservedAt: null, lastObservedAt: null };
}

function normalizeCheck(input, id, windowEnd, v3) {
  if (!plain(input)) return emptyCheck(id, 'invalid_check');
  const counts = {};
  let invalidCounts = !plain(input.counts) || Object.keys(input.counts).length > 32;
  for (const key of v3 && id === 'dead_letters' ? [...COUNT_KEYS, 'totalOriginals', 'resolvedInternal', 'invalidatedClosures'] : COUNT_KEYS) {
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

function normalizeCoverage(coverage) {
  const r = coverage?.reference;
  if (coverage?.verified !== true || !plain(r) || Buffer.byteLength(JSON.stringify(r)) > 8192
    || r.schemaVersion !== 'pbk-runtime-coverage-reference-v1') return { verified: false };
  return { verified: true, schemaVersion: 'pbk-runtime-coverage-v1', policyVersion: RUNTIME_COVERAGE_POLICY.version, policyHash: r.policyHash,
    instrumentation: r.instrumentation, segmentRef: r.segmentRef, cutoff: r.cutoff, reference: r };
}

function normalizeClosures(input, cutoff) {
  const r = input?.reference;
  if (input?.verified !== true || !plain(r) || Buffer.byteLength(JSON.stringify(r)) > MAX_REPORT_BYTES
    || r.schemaVersion !== 'pbk-dead-letter-closure-reference-v1' || r.tenantId !== 'pbk'
    || !validRevision(r.revision) || r.cutoff !== iso(cutoff)
    || !validateDeadLetterAuditBoundary(r.boundary, r.cutoff)
    || !plain(r.counts) || !Array.isArray(r.cases) || r.cases.length > 64
    || !['total', 'closedInternal', 'open', 'invalidated'].every(k => Number.isSafeInteger(r.counts[k]) && r.counts[k] >= 0)
    || r.counts.total !== r.cases.length || r.counts.total !== r.counts.closedInternal + r.counts.open + r.counts.invalidated
    || new Set(r.cases.map(c => c?.recordRef)).size !== r.cases.length
    || !['closed_internal', 'open', 'invalidated'].every((status, i) =>
      r.cases.filter(c => c?.status === status).length === r.counts[['closedInternal', 'open', 'invalidated'][i]])) {
    return { verified: false };
  }
  return { verified: true, reference: r };
}

function normalizeDeadLetters(check, closures) {
  const c = check.counts;
  if (check.status === 'unverified' && Object.keys(c).length === 0) return;
  const keys = ['totalOriginals', 'resolvedInternal', 'outstanding', 'invalidatedClosures'];
  const valid = keys.every(k => Number.isSafeInteger(c[k]) && c[k] >= 0)
    && c.resolvedInternal <= c.totalOriginals && c.invalidatedClosures <= c.totalOriginals - c.resolvedInternal
    && c.outstanding === c.totalOriginals - c.resolvedInternal
    && (!closures.verified ? c.resolvedInternal === 0 : closures.reference.counts.total === c.totalOriginals
      && closures.reference.counts.closedInternal === c.resolvedInternal
      && closures.reference.counts.invalidated === c.invalidatedClosures);
  if (!valid || !closures.verified) {
    if (Number.isSafeInteger(c.totalOriginals)) {
      c.resolvedInternal = 0; c.outstanding = c.totalOriginals;
      c.invalidatedClosures = Math.min(c.invalidatedClosures ?? 0, c.totalOriginals);
    }
    check.status = 'unverified';
    if (!valid) check.reason = 'invalid_counts';
    else if (check.reason === 'no_findings' || check.reason === 'findings_detected') check.reason = 'source_unavailable';
  } else if (check.status !== 'unverified') {
    check.status = c.outstanding ? 'failed' : 'passed';
    check.reason = c.outstanding ? 'findings_detected' : 'no_findings';
  }
}

function normalizeAudit(input, cutoff, failureReason = 'invalid_collection', schema = SCHEMA) {
  const v3 = schema === SCHEMA;
  const windowStart = iso(cutoff - DAY_MS);
  const windowEnd = iso(cutoff);
  const rows = input?.checks;
  const complete = plain(input) && timeOf(input.windowStart) === cutoff - DAY_MS
    && timeOf(input.windowEnd) === cutoff && Array.isArray(rows)
    && rows.length === OPERATIONAL_AUDIT_CHECK_IDS.length
    && new Set(rows.map(row => row?.id)).size === OPERATIONAL_AUDIT_CHECK_IDS.length
    && OPERATIONAL_AUDIT_CHECK_IDS.every(id => rows.some(row => row?.id === id));
  const checks = OPERATIONAL_AUDIT_CHECK_IDS.map(id => complete
    ? normalizeCheck(rows.find(row => row?.id === id), id, cutoff, v3) : emptyCheck(id, failureReason));
  const coverage = complete ? normalizeCoverage(input.coverage) : { verified: false };
  const closures = v3 ? normalizeClosures(input?.closures, cutoff) : undefined;
  if (v3 && complete) normalizeDeadLetters(checks.find(c => c.id === 'dead_letters'), closures);
  if (coverage.verified && (coverage.reference.cutoff !== windowEnd || coverage.reference.windowStart !== windowStart)) {
    return { ready: false, windowStart, windowEnd, checks, coverage: { verified: false }, ...(v3 ? { closures } : {}) };
  }
  const ready = checks.every(check => check.status === 'passed') && coverage.verified && (!v3 || closures.verified)
    && checks.find(check => check.id === 'monitoring_continuity').status === 'passed';
  return { ready, windowStart, windowEnd, checks, coverage, ...(v3 ? { closures } : {}) };
}

function reportGuard() {
  return { noContact: true, providerWritesBlocked: true, callerReportsAccepted: false };
}

function verifyRecord(row, { revision, secret, now }) {
  const report = row?.report;
  if (!plain(report) || !validSecret(secret) || !validRevision(revision) || !validClock(now)
    || Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES || !Object.hasOwn(VERSIONS, report.schemaVersion)) {
    return unavailable('operational_audit_record_unverified');
  }
  // A committed admission blocks all older proof even if collection/finalization never completes.
  if (report.completedAt === null) return unavailable('operational_audit_pending');
  const started = timeOf(report.startedAt);
  const completed = timeOf(report.completedAt);
  const legacy = report.schemaVersion === 'pbk-operational-audit-v1';
  const cutoff = legacy ? started : timeOf(report.observationCutoff);
  const stored = row.created_at instanceof Date ? row.created_at.getTime() : timeOf(row.created_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || started > completed
    || !Number.isFinite(cutoff) || cutoff < started || cutoff > completed
    || completed > now || now - started >= DAY_MS || completed - started > MAX_DURATION_MS
    || !Number.isFinite(stored) || stored > now || Math.abs(stored - started) > MAX_DURATION_MS) {
    return unavailable('operational_audit_record_expired_or_undated');
  }
  const version = VERSIONS[report.schemaVersion];
  if (row.tenant_id !== 'pbk' || row.suite_name !== version.suite
    || row.source !== version.source
    || row.id !== report.runId || !safeId(report.runId) || !validRevision(report.revision)
    || !legacy && report.revision !== revision) {
    return unavailable('operational_audit_record_unverified');
  }
  const supplied = report.attestation;
  if (!plain(supplied) || supplied.version !== report.schemaVersion || !/^[a-f0-9]{64}$/.test(supplied.signature || '')
    || Object.keys(supplied).length !== 2
    || !timingSafeEqual(Buffer.from(supplied.signature, 'hex'), Buffer.from(sign(report, secret), 'hex'))) {
    return unavailable('operational_audit_signature_invalid');
  }
  const audit = normalizeAudit(report.audit, cutoff, 'invalid_collection', report.schemaVersion);
  if (report.schemaVersion === SCHEMA && audit.closures.verified
    && (audit.closures.reference.revision !== report.revision
      || timeOf(audit.closures.reference.boundary.databaseCapturedAt) < started)) return unavailable('operational_audit_record_unverified');
  if (legacy) {
    audit.coverage = { verified: report.audit?.coverage?.verified === true };
    audit.ready = audit.checks.every(check => check.status === 'passed') && audit.coverage.verified;
  }
  const expected = { schemaVersion: report.schemaVersion, tenantId: 'pbk', runId: report.runId,
    revision: report.revision,
    startedAt: iso(started), completedAt: iso(completed), ...(!legacy ? { observationCutoff: iso(cutoff) } : {}),
    provenance: 'operational', guard: reportGuard(), audit };
  const { attestation: _ignored, ...unsigned } = report;
  const passed = audit.checks.filter(check => check.status === 'passed').length;
  if (canonicalJson(unsigned) !== canonicalJson(expected) || row.ok !== audit.ready
    || row.total !== OPERATIONAL_AUDIT_CHECK_IDS.length || row.passed !== passed
    || row.failed !== OPERATIONAL_AUDIT_CHECK_IDS.length - passed) {
    return unavailable('operational_audit_record_unverified');
  }
  if (legacy) return { ...unavailable('operational_audit_legacy_diagnostics'), runId: report.runId,
    revision: report.revision, executedAt: report.completedAt, legacy: { authenticated: true, audit } };
  return { ok: true, verified: true, readbackVerified: true, source: 'postgres:pbk_eval_runs',
    result: audit.ready ? 'operational_audit_passed' : 'operational_audit_incomplete_or_failed',
    runId: report.runId, revision, executedAt: report.completedAt, audit,
    evidence: { silentErrors: { runId: report.runId, revision, executedAt: report.completedAt,
      executed: true, provenance: 'operational', scope: 'durable_operational_audit', passed: audit.ready } } };
}

const latestSql = `SELECT id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at,
  created_at::text AS admission_order
  FROM public.pbk_eval_runs WHERE tenant_id = $1 AND (suite_name = $2 OR source = $3
    OR suite_name = $4 OR source = $5 OR suite_name = $6 OR source = $7) ORDER BY created_at DESC, id DESC LIMIT 1`;
const latestValues = ['pbk', SUITE, SOURCE, LEGACY_SUITE, LEGACY_SOURCE, 'operational_audit_v2', 'server:operational-audit:v2'];

async function verifyCoverage({ pool, secret, revision, now, coverage, coverageVerifier }) {
  if (!coverage?.verified || !coverage.reference) return null;
  const result = await coverageVerifier({ pool, secret, revision, now, reference: coverage.reference });
  return result?.verified === true
    && canonicalJson(result.proof?.reference) === canonicalJson(coverage.reference) ? result : null;
}

async function revalidateClosures({ pool, secret, revision, now, audit, boundary }) {
  if (!audit.closures?.verified) return;
  const reference = audit.closures.reference;
  const current = boundary && canonicalJson(reference.boundary) !== canonicalJson(boundary) ? null
    : await verifyDeadLetterClosureReference({ pool, secret, revision,
      now: typeof now === 'function' ? now() : now, reference });
  if (current?.verified === true && canonicalJson(current.reference) === canonicalJson(reference)) return;
  audit.closures = { verified: false }; audit.ready = false;
  const check = audit.checks.find(c => c.id === 'dead_letters');
  if (Number.isSafeInteger(check.counts.totalOriginals)) {
    check.counts.invalidatedClosures = Math.min(check.counts.totalOriginals,
      check.counts.invalidatedClosures + check.counts.resolvedInternal);
    check.counts.resolvedInternal = 0; check.counts.outstanding = check.counts.totalOriginals;
  }
  check.status = 'unverified'; check.reason = 'source_unavailable';
}

// A verified quiet census need not be eligible business work. Unknown/failing source states still block.
export function operationalAuditSourceStatus(sources, kinds) {
  const selected = kinds.map(kind => sources?.find(s => s.sourceKind === kind));
  if (selected.some(s => !s?.counts)) return 'unverified';
  if (selected.some(s => s.counts.failed > 0)) return 'failed';
  const blockers = ['unknown', 'lateUnknown', 'cancelled', 'skipped', 'pending', 'unknownOutcome', 'invalidClock'];
  if (selected.some(s => blockers.some(key => !Number.isSafeInteger(s.counts[key]) || s.counts[key] !== 0))) return 'unverified';
  return 'passed';
}

export async function readOperationalAudit({ pool, revision, secret, now = Date.now(), id,
  coverageVerifier = verifyRuntimeCoverageReference } = {}) {
  if (!pool?.query || !pool?.connect) return unavailable('operational_audit_storage_unavailable', 'postgres_unavailable');
  if (id !== undefined && !safeId(id)) return unavailable('operational_audit_record_unverified');
  try {
    return await inAuditScope(pool, async boundedPool => {
      // Authenticate newest admission before any asynchronous durable/source verification.
      const row = (await boundedPool.query(latestSql, latestValues)).rows?.[0];
      if (!row) return unavailable('operational_audit_run_missing');
      if (id !== undefined && row.id !== id) return unavailable('operational_audit_superseded');
      const result = verifyRecord(row, { revision, secret, now });
      if (!result.verified) return result;
      await revalidateClosures({ pool: boundedPool, secret, revision, now, audit: result.audit });
      const hadCoverage = result.audit.coverage.verified;
      const coverage = await verifyCoverage({ pool: boundedPool, secret, revision, now,
        coverage: result.audit.coverage, coverageVerifier });
      const latest = (await boundedPool.query(latestSql, latestValues)).rows?.[0];
      if (!latest || latest.id !== row.id || canonicalJson(latest) !== canonicalJson(row)) {
        return unavailable('operational_audit_superseded');
      }
      if (!hadCoverage) {
        // Closure readback and newest-admission check above still run on uncovered audits.
      } else if (!coverage) {
        result.audit.coverage = { verified: false }; result.audit.ready = false;
        const continuity = result.audit.checks.find(check => check.id === 'monitoring_continuity');
        if (continuity.status === 'passed') { continuity.status = 'unverified'; continuity.reason = 'coverage_unverified'; }
        result.coverageDiagnostics = { verified: false, result: 'coverage_reference_unverified' };
      } else {
        const mapping = { runtime_archive: ['runtime_archive'], conversation_projection: ['conversation_projection'],
          safety_qa: ['qa', 'safety'] };
        for (const check of result.audit.checks) {
          if (!mapping[check.id] || check.status !== 'passed') continue;
          const status = operationalAuditSourceStatus(coverage.sources, mapping[check.id]);
          if (status !== 'passed') { check.status = status; check.reason = status === 'failed' ? 'findings_detected' : 'contamination_unverified'; }
        }
        result.audit.ready &&= result.audit.checks.every(check => check.status === 'passed');
        result.sourceDiagnostics = coverage.sources;
        result.coverageDiagnostics = { verified: true, result: 'coverage_verified',
          quiet: coverage.diagnostics.quiet, organicCompletions: coverage.diagnostics.organicCompletions,
          fleetQualified: false };
      }
      result.evidence.silentErrors.passed = result.audit.ready;
      result.result = result.audit.ready ? 'operational_audit_passed' : 'operational_audit_incomplete_or_failed';
      return result;
    });
  } catch {
    return unavailable('operational_audit_storage_unavailable', 'postgres_unavailable');
  }
}

export async function executeOperationalAudit({ pool, revision, secret, collect, now = Date.now,
  coverageVerifier = verifyRuntimeCoverageReference,
  createId = () => `operational-audit-${randomUUID()}` } = {}) {
  if (!pool?.connect || !pool?.query || !validSecret(secret) || !validRevision(revision)
    || typeof collect !== 'function' || typeof now !== 'function' || typeof createId !== 'function') {
    return unavailable('operational_audit_runtime_unavailable', 'postgres_unavailable');
  }
  try {
    return await inAuditScope(pool, collectAndPersist);
  } catch {
    return unavailable('operational_audit_storage_unavailable', 'postgres_unavailable');
  }

  async function collectAndPersist(boundedPool) {
    pool = boundedPool;
    const started = now();
    const runId = createId();
    if (!validClock(started) || !safeId(runId)) return unavailable('operational_audit_runtime_unavailable');
    const base = { schemaVersion: SCHEMA, tenantId: 'pbk', runId, revision,
      startedAt: iso(started), observationCutoff: null, completedAt: null, provenance: 'operational', guard: reportGuard() };
    const pending = { ...base, audit: normalizeAudit(null, started) };
    pending.attestation = { version: SCHEMA, signature: sign(pending, secret) };
    const admitted = await withPgTransaction(pool, async client => {
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [LEGACY_SOURCE]);
      if (lock.rows[0]?.acquired !== true) return false;
      const insert = await client.query(
        `INSERT INTO public.pbk_eval_runs
         (id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,
           GREATEST(clock_timestamp(), COALESCE((
             SELECT MAX(created_at) + INTERVAL '1 microsecond' FROM public.pbk_eval_runs
             WHERE tenant_id = $2 AND (suite_name = $3 OR source = $9
               OR suite_name = 'operational_audit_v1' OR source = 'server:operational-audit:v1'
               OR suite_name = 'operational_audit_v2' OR source = 'server:operational-audit:v2')
           ), clock_timestamp())))`,
        [runId, 'pbk', SUITE, false, OPERATIONAL_AUDIT_CHECK_IDS.length, 0,
          OPERATIONAL_AUDIT_CHECK_IDS.length, JSON.stringify(pending), SOURCE]);
      if (insert.rowCount !== 1) throw new Error('Audit admission was not persisted');
      return true;
    });
    if (!admitted) return unavailable('operational_audit_in_progress');
    const captured = await captureDeadLetterAuditBoundary({ pool, now });
    if (!captured.verified) return unavailable('operational_audit_boundary_unavailable');
    const closureBoundary = captured.boundary;
    const cutoff = now();
    if (!validClock(cutoff) || cutoff < started || cutoff - started >= MAX_DURATION_MS
      || !validateDeadLetterAuditBoundary(closureBoundary, iso(cutoff))) {
      return unavailable('operational_audit_execution_undated');
    }
    let audit;
    // Admission commits and releases its connection before collection can use a one-client pool.
    try {
      const input = await auditScope.getStore().run(() => collect({ pool, now: cutoff, observationNow: now,
        closureBoundary, fence: auditScope.getStore(), windowStart: iso(cutoff - DAY_MS), windowEnd: iso(cutoff) }));
      audit = normalizeAudit(input, cutoff);
      await revalidateClosures({ pool, secret, revision, now, audit, boundary: closureBoundary });
      if (audit.coverage.verified) {
        const verified = await verifyCoverage({ pool, secret, revision, now, coverage: audit.coverage, coverageVerifier });
        if (verified) audit.coverage = normalizeCoverage({ verified: true, reference: verified.proof.reference });
        else { audit.coverage = { verified: false }; audit.ready = false; }
      }
    } catch {
      audit = normalizeAudit(null, cutoff, 'collector_failed');
    }
    const completed = now();
    if (!validClock(completed) || completed < cutoff || completed - started >= MAX_DURATION_MS) {
      return unavailable('operational_audit_execution_undated');
    }
    const report = { ...base, observationCutoff: iso(cutoff), completedAt: iso(completed), audit };
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
    const own = await readOperationalAudit({ pool, revision, secret, now: now(), id: runId, coverageVerifier });
    if (!own.verified) return own;
    // Concurrent admissions are allowed; latest admission always wins, regardless of completion order.
    const latest = await readOperationalAudit({ pool, revision, secret, now: now(), coverageVerifier });
    if (latest.runId !== runId || !latest.verified) return unavailable('operational_audit_superseded');
    return latest;
  }
}
