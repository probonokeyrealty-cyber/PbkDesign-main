import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import { validateBacklogReconciliation } from './backlog-reconciliation-collector.mjs';

const SCHEMA = 'pbk-backlog-reconciliation-v1';
const SUITE = 'backlog_reconciliation_v1';
const SOURCE = 'server:backlog-reconciliation:v1';
const DAY_MS = 24 * 3600_000;
const MAX_DURATION_MS = 60_000;
const MAX_REPORT_BYTES = 65_536;
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype);
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,120}$/.test(value);
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const validSecret = value => typeof value === 'string' && value.length > 0;
const validClock = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
const iso = value => new Date(value).toISOString();
const timeOf = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ? Date.parse(value) : NaN;
const guard = () => ({ noContact: true, providerWritesBlocked: true, callerReportsAccepted: false });
const ADMISSION_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

function admissionTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && iso(ms).slice(0, 23) === value.slice(0, 23) ? ms : NaN;
}

function timeoutError() {
  return Object.assign(new Error('Reconciliation deadline exceeded'), { code: 'RECONCILIATION_TIMEOUT' });
}

function deadline() {
  const started = performance.now();
  let expired = false;
  const elapsed = () => performance.now() - started;
  const remaining = () => MAX_DURATION_MS - elapsed();
  const check = () => {
    if (expired || remaining() <= 0) { expired = true; throw timeoutError(); }
  };
  return { elapsed, remaining, check, async run(action, { onTimeout, onLate } = {}) {
    check();
    let timer;
    let abandoned = false;
    const abandon = () => {
      if (!abandoned) { abandoned = true; expired = true; onTimeout?.(); }
    };
    const operation = Promise.resolve().then(() => { check(); return action(); });
    // A client can arrive after acquisition timed out; it still belongs to this operation to release.
    operation.then(value => { if (abandoned) onLate?.(value); }, () => {}).catch(() => {});
    try {
      const value = await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => { abandon(); reject(timeoutError()); }, Math.max(1, Math.ceil(remaining())));
      })]);
      try { check(); }
      catch (error) { abandon(); onLate?.(value); throw error; }
      return value;
    } finally { clearTimeout(timer); }
  } };
}

async function withClient(pool, budget, action) {
  const client = await budget.run(() => pool.connect(), { onLate: late => late.release(true) });
  let released = false;
  const release = destroy => {
    if (!released) { released = true; client.release(destroy); }
  };
  const query = (text, values = []) => budget.run(() => client.query({ text, values,
    query_timeout: Math.max(1, Math.ceil(budget.remaining())) }), { onTimeout: () => release(true) });
  try { return await action(query); }
  catch (error) { release(true); throw error; }
  finally { release(false); }
}

async function transaction(pool, budget, action) {
  return withClient(pool, budget, async query => {
    await query('BEGIN');
    try {
      const limit = `${Math.max(1, Math.floor(budget.remaining()))}ms`;
      await query(`SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true),
        set_config('idle_in_transaction_session_timeout', $1, true)`, [limit]);
      const value = await action(query);
      await query('COMMIT');
      return value;
    } catch (error) {
      // Never enqueue ROLLBACK/COMMIT behind an abandoned query. withClient destroys that connection.
      if (error.code !== 'RECONCILIATION_TIMEOUT') await query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

function unavailable(result, source = 'postgres:pbk_eval_runs') {
  return { ok: false, verified: false, readbackVerified: false, source, result,
    runId: null, revision: null, executedAt: null, launchQualified: false, reconciliation: null };
}

function sign(report, secret) {
  const { attestation: _ignored, ...unsigned } = report;
  const key = createHmac('sha256', secret).update('pbk.backlog-reconciliation.signing-key.v1').digest();
  return createHmac('sha256', key).update(`${SCHEMA}\n${canonicalJson(unsigned)}`).digest('hex');
}

async function collectCurrent(collect, now, budget) {
  try {
    const input = await budget.run(() => collect({ now }));
    if (!plain(input) || input.ok !== true || validateBacklogReconciliation(input.reconciliation) !== true) return null;
    // Detach callback-owned objects before signing/comparison; persist only the strict collector schema.
    return JSON.parse(JSON.stringify(input.reconciliation));
  } catch (error) {
    if (error.code === 'RECONCILIATION_TIMEOUT') throw error;
    return null;
  }
}

function verifyRecord(row, { revision, secret, now }) {
  const report = row?.report;
  if (!plain(report) || !validSecret(secret) || !validRevision(revision) || !validClock(now)
    || Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES) {
    return unavailable('backlog_reconciliation_record_unverified');
  }
  if (report.completedAt === null) return unavailable('backlog_reconciliation_pending');
  const started = timeOf(report.startedAt);
  const completed = timeOf(report.completedAt);
  const stored = row.created_at instanceof Date ? row.created_at.getTime() : timeOf(row.created_at);
  const admitted = admissionTime(report.admittedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || started > completed
    || completed > now || now - started >= DAY_MS || completed - started > MAX_DURATION_MS
    || !Number.isFinite(stored) || !Number.isFinite(admitted) || stored !== admitted
    || row.created_at_exact !== report.admittedAt || stored > now || Math.abs(stored - started) > MAX_DURATION_MS) {
    return unavailable('backlog_reconciliation_record_expired_or_undated');
  }
  if (row.tenant_id !== 'pbk' || row.suite_name !== SUITE || row.source !== SOURCE
    || row.id !== report.runId || !safeId(report.runId) || report.revision !== revision) {
    return unavailable('backlog_reconciliation_record_unverified');
  }
  const supplied = report.attestation;
  if (!plain(supplied) || supplied.version !== SCHEMA || typeof supplied.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(supplied.signature) || Object.keys(supplied).length !== 2
    || !timingSafeEqual(Buffer.from(supplied.signature, 'hex'), Buffer.from(sign(report, secret), 'hex'))) {
    return unavailable('backlog_reconciliation_signature_invalid');
  }
  if (validateBacklogReconciliation(report.reconciliation) !== true) {
    return unavailable('backlog_reconciliation_record_unverified');
  }
  const expected = { schemaVersion: SCHEMA, tenantId: 'pbk', runId: report.runId, revision,
    startedAt: iso(started), admittedAt: report.admittedAt, completedAt: iso(completed), provenance: 'operational', guard: guard(),
    reconciliation: report.reconciliation };
  const { attestation: _ignored, ...unsigned } = report;
  const total = report.reconciliation.counts.dispatchesLocked + report.reconciliation.counts.deadLettersOpen;
  if (canonicalJson(unsigned) !== canonicalJson(expected) || row.ok !== false || row.passed !== 0
    || row.total !== total || row.failed !== total) {
    return unavailable('backlog_reconciliation_record_unverified');
  }
  return { ok: true, verified: true, readbackVerified: true, source: 'postgres:pbk_eval_runs',
    result: 'backlog_reconciliation_verified', runId: report.runId, revision,
    executedAt: report.completedAt, launchQualified: false, reconciliation: report.reconciliation };
}

async function selectRecord(pool, id, budget) {
  // Invalid/pending/new-revision admissions must block older evidence, not disappear from this query.
  const result = await withClient(pool, budget, query => query(
    `SELECT id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at,
       to_char(created_at AT TIME ZONE 'UTC', '${ADMISSION_FORMAT}') AS created_at_exact
     FROM public.pbk_eval_runs
     WHERE tenant_id = $1 AND (suite_name = $2 OR source = $3)${id !== undefined ? ' AND id = $4' : ''}
     ORDER BY created_at DESC, id DESC LIMIT 1`, ['pbk', SUITE, SOURCE, ...(id !== undefined ? [id] : [])]));
  return result.rows?.[0];
}

async function readCurrent({ pool, revision, secret, collect, now, id }, budget, currentTime) {
  const row = await selectRecord(pool, id, budget);
  if (!row) return unavailable('backlog_reconciliation_run_missing');
  const verified = verifyRecord(row, { revision, secret, now });
  if (!verified.verified) return verified;
  const current = await collectCurrent(collect, now, budget);
  if (!current || canonicalJson(current) !== canonicalJson(verified.reconciliation)) {
    return unavailable('backlog_reconciliation_source_unverified');
  }
  // Collection can overlap a new admission. Recheck latest after it, including explicit-id reads.
  const latest = await selectRecord(pool, undefined, budget);
  const latestVerified = verifyRecord(latest, { revision, secret, now: currentTime() });
  if (!latestVerified.verified) return latestVerified;
  if (latest.id !== row.id || canonicalJson(latest.report) !== canonicalJson(row.report)) {
    return unavailable('backlog_reconciliation_superseded');
  }
  budget.check();
  return latestVerified;
}

export async function readBacklogReconciliation({ pool, revision, secret, collect, now = Date.now(), id } = {}) {
  const budget = deadline();
  if (!pool?.query || !pool?.connect) return unavailable('backlog_reconciliation_storage_unavailable', 'postgres_unavailable');
  if (!validRevision(revision) || !validSecret(secret) || !validClock(now)
    || typeof collect !== 'function' || id !== undefined && !safeId(id)) {
    return unavailable('backlog_reconciliation_record_unverified');
  }
  try {
    return await readCurrent({ pool, revision, secret, collect, now, id }, budget,
      () => now + Math.floor(budget.elapsed()));
  } catch (error) {
    if (error.code === 'RECONCILIATION_TIMEOUT') return unavailable('backlog_reconciliation_timed_out');
    return unavailable('backlog_reconciliation_storage_unavailable', 'postgres_unavailable');
  }
}

export async function executeBacklogReconciliation({ pool, revision, secret, collect, now = Date.now,
  createId = () => `backlog-reconciliation-${randomUUID()}` } = {}) {
  const budget = deadline();
  if (!pool?.connect || !pool?.query || !validSecret(secret) || !validRevision(revision)
    || typeof collect !== 'function' || typeof now !== 'function' || typeof createId !== 'function') {
    return unavailable('backlog_reconciliation_runtime_unavailable', 'postgres_unavailable');
  }
  try {
    const started = now();
    const runId = createId();
    if (!validClock(started) || !safeId(runId)) return unavailable('backlog_reconciliation_runtime_unavailable');
    const base = { schemaVersion: SCHEMA, tenantId: 'pbk', runId, revision,
      startedAt: iso(started), completedAt: null, provenance: 'operational', guard: guard() };
    let pending;
    const admitted = await transaction(pool, budget, async query => {
      const lock = await query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [SOURCE]);
      if (lock.rows[0]?.acquired !== true) return false;
      const allocation = await query(
        `SELECT to_char(GREATEST(clock_timestamp(), COALESCE((
           SELECT MAX(created_at) + INTERVAL '1 microsecond' FROM public.pbk_eval_runs
           WHERE tenant_id = $1 AND (suite_name = $2 OR source = $3)
         ), clock_timestamp())) AT TIME ZONE 'UTC', '${ADMISSION_FORMAT}') AS admitted_at`, ['pbk', SUITE, SOURCE]);
      const admittedAt = allocation.rows?.[0]?.admitted_at;
      if (!Number.isFinite(admissionTime(admittedAt))) throw new Error('Reconciliation admission is undated');
      pending = { ...base, admittedAt, reconciliation: null };
      pending.attestation = { version: SCHEMA, signature: sign(pending, secret) };
      const insert = await query(
        `INSERT INTO public.pbk_eval_runs
         (id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamptz)`,
        [runId, 'pbk', SUITE, false, 0, 0, 0, JSON.stringify(pending), SOURCE, admittedAt]);
      if (insert.rowCount !== 1) throw new Error('Reconciliation admission was not persisted');
      return true;
    });
    if (!admitted) return unavailable('backlog_reconciliation_in_progress');
    // The admission transaction has committed and released before a collector can acquire pool max:1.
    const reconciliation = await collectCurrent(collect, started, budget);
    if (!reconciliation) return unavailable('backlog_reconciliation_source_unverified');
    const completed = now();
    if (!validClock(completed) || completed < started || completed - started > MAX_DURATION_MS) {
      return unavailable('backlog_reconciliation_execution_undated');
    }
    const report = { ...base, admittedAt: pending.admittedAt, completedAt: iso(completed), reconciliation };
    report.attestation = { version: SCHEMA, signature: sign(report, secret) };
    if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES) {
      return unavailable('backlog_reconciliation_record_unverified');
    }
    const total = reconciliation.counts.dispatchesLocked + reconciliation.counts.deadLettersOpen;
    await transaction(pool, budget, async query => {
      const update = await query(
        `UPDATE public.pbk_eval_runs
         SET ok = $4, total = $5, passed = $6, failed = $7, report = $8::jsonb
         WHERE id = $1 AND tenant_id = $2 AND suite_name = $3 AND source = $9
           AND report = $10::jsonb AND created_at = $11::timestamptz`,
        [runId, 'pbk', SUITE, false, total, 0, total, JSON.stringify(report), SOURCE,
          JSON.stringify(pending), pending.admittedAt]);
      if (update.rowCount !== 1) throw new Error('Reconciliation pending receipt was not finalized');
    });
    const executionTime = () => {
      budget.check();
      const value = now();
      if (!validClock(value) || value < started || value - started > MAX_DURATION_MS) throw timeoutError();
      return value;
    };
    const own = await readCurrent({ pool, revision, secret, collect, now: executionTime(), id: runId }, budget, executionTime);
    if (!own.verified) return own;
    const latest = await readCurrent({ pool, revision, secret, collect, now: executionTime() }, budget, executionTime);
    if (!latest.verified || latest.runId !== runId) return unavailable('backlog_reconciliation_superseded');
    executionTime();
    return latest;
  } catch (error) {
    if (error.code === 'RECONCILIATION_TIMEOUT') return unavailable('backlog_reconciliation_timed_out');
    return unavailable('backlog_reconciliation_storage_unavailable', 'postgres_unavailable');
  }
}
