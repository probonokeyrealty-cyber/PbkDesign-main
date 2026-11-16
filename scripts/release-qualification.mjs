import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson, withPgTransaction } from './skill-governance-store.mjs';

const SCHEMA = 'pbk-release-qualification-v1';
const SUITE = 'release_qualification_v1';
const SOURCE = 'server:release-qualification:v1';
const MAX_AGE_MS = 86_400_000;
const MAX_REPORT_BYTES = 65_536;
const CI_CASES = ['postgres_integration', 'browser_regression'];
const LOCAL_SUITES = ['failedCall', 'behavior', 'silentPolicy'];
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,120}$/.test(value);
const timeOf = value => typeof value === 'string' ? Date.parse(value) : NaN;

export function isDirectQualificationFounder(headers = {}, apiKey = '') {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return Boolean(apiKey && normalized.authorization === `Bearer ${apiKey}`
    && !Object.hasOwn(normalized, 'x-pbk-team-token')
    && !Object.hasOwn(normalized, 'x-pbk-netlify-proxy'));
}

export function authorizeQualificationRequest(request, apiKey) {
  if (!isDirectQualificationFounder(request.headers, apiKey)) {
    return { ok: false, status: 403, result: 'qualification_founder_auth_required' };
  }
  if (request.method !== 'POST' || request.search || !request.body || Array.isArray(request.body)
    || Object.getPrototypeOf(request.body) !== Object.prototype || Object.keys(request.body).length) {
    return { ok: false, status: 400, result: 'qualification_fixed_runner_only' };
  }
  return { ok: true };
}

function signature(report, secret) {
  const { attestation: _attestation, ...unsigned } = report;
  const key = createHmac('sha256', secret).update('pbk.release-qualification.signing-key.v1').digest();
  return createHmac('sha256', key).update(`${SCHEMA}\n${canonicalJson(unsigned)}`).digest('hex');
}

function normalizeSuite(value, expected = []) {
  const input = value && typeof value === 'object' ? value : {};
  const results = (Array.isArray(input.results) ? input.results : []).slice(0, 200).map(row => ({
    id: safeId(row?.id) ? row.id : 'invalid_case_id',
    executed: row?.executed === true,
    passed: row?.passed === true,
    ...(row?.passed === true ? {} : { reason: 'regression_failed_or_unexecuted' }),
  }));
  const ids = results.map(row => row.id);
  const expectedValid = expected.length > 0 && expected.every(safeId) && new Set(expected).size === expected.length;
  const complete = expectedValid && ids.length === expected.length && new Set(ids).size === ids.length
    && expected.every(id => ids.includes(id));
  const actualPassed = results.filter(row => row.executed && row.passed).length;
  const countsValid = input.total === results.length && input.passed === actualPassed
    && input.failed === results.length - actualPassed && input.ok === (actualPassed === results.length);
  const passedCount = complete && countsValid ? actualPassed : 0;
  return {
    executed: results.some(row => row.executed), provenance: 'controlled',
    scope: 'deterministic_policy_regression', complete: complete && countsValid,
    passed: complete && countsValid && passedCount === expected.length,
    total: expected.length, passedCount, failedCount: expected.length - passedCount, results,
  };
}

function normalizeCi(value, revision, now) {
  const input = value && typeof value === 'object' ? value : {};
  const at = timeOf(input.executedAt);
  const expiresAt = timeOf(input.expiresAt);
  const verified = input.source === 'github_actions' && input.provenance === 'controlled'
    && input.revision === revision && safeId(String(input.runId || ''))
    && Number.isFinite(at) && at <= now && now - at <= MAX_AGE_MS
    && Number.isFinite(expiresAt) && expiresAt >= now && expiresAt <= at + MAX_AGE_MS;
  const rows = Array.isArray(input.checks) ? input.checks : [];
  const complete = rows.length === CI_CASES.length && new Set(rows.map(row => row.id)).size === CI_CASES.length
    && CI_CASES.every(id => rows.some(row => row.id === id));
  const checks = CI_CASES.map(id => {
    const row = rows.find(item => item.id === id);
    return { id, executed: Boolean(verified && complete && row?.executed === true),
      passed: Boolean(verified && complete && row?.executed === true && row?.passed === true) };
  });
  return {
    source: 'github_actions', provenance: 'controlled', revision,
    runId: verified ? String(input.runId) : null,
    observedRunId: safeId(String(input.observedRunId || input.runId || '')) ? String(input.observedRunId || input.runId) : null,
    status: ['passed', 'failed', 'unavailable'].includes(input.status) ? input.status : 'unavailable',
    errorCode: typeof input.errorCode === 'string' && /^[a-z_]{1,60}$/.test(input.errorCode) ? input.errorCode : null,
    executedAt: verified ? input.executedAt : null,
    expiresAt: Number.isFinite(expiresAt) ? input.expiresAt : null,
    executed: Boolean(verified && complete && input.executed === true),
    passed: Boolean(verified && complete && input.executed === true && input.passed === true && checks.every(row => row.passed)),
    result: verified && complete ? 'ci_execution_observed' : 'ci_execution_unverified', checks,
  };
}

function summarize(report) {
  const suites = report.suites;
  const ci = report.ci;
  const total = LOCAL_SUITES.reduce((sum, id) => sum + suites[id].total, 0) + CI_CASES.length;
  const passed = LOCAL_SUITES.reduce((sum, id) => sum + suites[id].passedCount, 0)
    + ci.checks.filter(row => row.passed).length;
  return {
    ready: LOCAL_SUITES.every(id => suites[id].passed) && ci.passed,
    provenance: 'controlled', scope: 'no_contact_release_qualification',
    operationalReadinessPromoted: false, total, passed, failed: total - passed, suites, ci,
  };
}

function evidenceFor(report) {
  const proof = suite => ({ runId: `${report.runId}:${suite}`, revision: report.revision,
    executedAt: report.completedAt, executed: report.suites[suite].executed,
    provenance: 'controlled', scope: report.suites[suite].scope, passed: report.suites[suite].passed });
  return {
    failedCallEval: { ...proof('failedCall'), scenarios: report.suites.failedCall.results },
    behavior: proof('behavior'),
    // Policy fixtures cannot attest absence of operational silent errors or live canary regressions.
  };
}

function unavailable(result, source = 'postgres:pbk_eval_runs') {
  return { ok: false, verified: false, readbackVerified: false, source, result, evidence: {},
    qualification: { ready: false, operationalReadinessPromoted: false } };
}

function verifyRecord(row, { revision, secret, requiredCases, now }) {
  const report = row?.report;
  if (!report || typeof report !== 'object' || Array.isArray(report) || !secret || !validRevision(revision)
    || !Number.isFinite(now) || !LOCAL_SUITES.every(id => Array.isArray(requiredCases?.[id]) && requiredCases[id].length)) {
    return unavailable('qualification_record_unverified');
  }
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES || report.schemaVersion !== SCHEMA
    || report.tenantId !== 'pbk' || row.tenant_id !== 'pbk' || row.id !== report.runId
    || row.suite_name !== SUITE || row.source !== SOURCE || report.revision !== revision
    || report.provenance !== 'controlled' || report.guard?.noContact !== true
    || report.guard?.providerWritesBlocked !== true || report.guard?.callerReportsAccepted !== false) {
    return unavailable('qualification_record_unverified');
  }
  const start = timeOf(report.startedAt);
  const end = timeOf(report.completedAt);
  const storedAt = new Date(row.created_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end > now
    || now - end > MAX_AGE_MS || end - start > 30_000 || !Number.isFinite(storedAt)
    || Math.abs(storedAt - end) > 30_000) return unavailable('qualification_record_expired_or_undated');
  const supplied = report.attestation;
  if (supplied?.version !== SCHEMA || !/^[a-f0-9]{64}$/.test(supplied.signature || '')
    || !timingSafeEqual(Buffer.from(supplied.signature, 'hex'), Buffer.from(signature(report, secret), 'hex'))) {
    return unavailable('qualification_signature_invalid');
  }
  if (!report.suites || !report.ci || !LOCAL_SUITES.every(id => Array.isArray(report.suites[id]?.results))) {
    return unavailable('qualification_record_unverified');
  }
  for (const id of LOCAL_SUITES) {
    const stored = report.suites[id];
    const reconstructed = normalizeSuite({ ok: stored.passedCount === stored.results.length,
      total: stored.results.length, passed: stored.passedCount, failed: stored.results.length - stored.passedCount,
      results: stored.results }, requiredCases[id]);
    if (stored.passed && (!reconstructed.passed || stored.scope !== 'deterministic_policy_regression'
      || stored.provenance !== 'controlled')) return unavailable('qualification_case_coverage_invalid');
  }
  // Re-check CI's original execution time; re-reading or re-running local checks must not refresh old CI proof.
  const ci = normalizeCi(report.ci, revision, now);
  const normalized = { ...report, ci };
  const qualification = summarize(normalized);
  return { ok: true, verified: true, readbackVerified: true, source: 'postgres:pbk_eval_runs',
    result: qualification.ready ? 'controlled_qualification_passed' : 'controlled_qualification_incomplete_or_failed',
    runId: report.runId, revision, executedAt: report.completedAt, qualification, evidence: evidenceFor(report) };
}

export async function readReleaseQualification({ pool, revision, secret, requiredCases, now = Date.now(), id } = {}) {
  if (!pool?.query) return unavailable('qualification_storage_unavailable', 'postgres_unavailable');
  try {
    const result = await pool.query(
      `SELECT id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at
       FROM public.pbk_eval_runs
       WHERE tenant_id = $1 AND (suite_name = $2 OR source = $3)${id ? ' AND id = $4' : ''}
       ORDER BY created_at DESC, id DESC LIMIT 1`, ['pbk', SUITE, SOURCE, ...(id ? [id] : [])]);
    if (!result.rows?.[0]) return unavailable('qualification_run_missing');
    return verifyRecord(result.rows[0], { revision, secret, requiredCases, now });
  } catch {
    return unavailable('qualification_storage_unavailable', 'postgres_unavailable');
  }
}

export async function executeReleaseQualification({ pool, revision, secret, requiredCases, runChecks, loadCi,
  now = Date.now, createId = () => `release-qualification-${randomUUID()}` } = {}) {
  if (!pool?.connect || !secret || !validRevision(revision)
    || !LOCAL_SUITES.every(id => Array.isArray(requiredCases?.[id]) && requiredCases[id].length)) {
    return unavailable('qualification_runtime_unavailable', 'postgres_unavailable');
  }
  const startedAt = new Date(now()).toISOString();
  let ci;
  try { ci = await loadCi(); } catch { ci = {}; }
  try {
    const record = await withPgTransaction(pool, async client => {
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [SOURCE]);
      if (lock.rows[0]?.acquired !== true) return null;
      let checks;
      try { checks = await runChecks(); } catch { checks = {}; }
      const completedAt = new Date(now()).toISOString();
      const report = {
        schemaVersion: SCHEMA, tenantId: 'pbk', runId: createId(), revision, startedAt, completedAt,
        provenance: 'controlled', guard: { noContact: true, providerWritesBlocked: true, callerReportsAccepted: false },
        suites: Object.fromEntries(LOCAL_SUITES.map(id => [id, normalizeSuite(checks?.[id], requiredCases[id])])),
        ci: normalizeCi(ci, revision, now()),
      };
      if (!safeId(report.runId)) throw new Error('Invalid qualification run identity');
      report.attestation = { version: SCHEMA, signature: signature(report, secret) };
      if (Buffer.byteLength(JSON.stringify(report)) > MAX_REPORT_BYTES) throw new Error('Qualification report too large');
      const totals = summarize(report);
      await client.query(
        `INSERT INTO public.pbk_eval_runs
         (id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,
           GREATEST(clock_timestamp(), COALESCE((
             SELECT MAX(created_at) + INTERVAL '1 microsecond' FROM public.pbk_eval_runs
             WHERE tenant_id = $2 AND (suite_name = $3 OR source = $9)
           ), clock_timestamp())))`,
        [report.runId, 'pbk', SUITE, totals.ready, totals.total, totals.passed, totals.failed,
          JSON.stringify(report), SOURCE]);
      return report;
    });
    if (!record) return unavailable('qualification_run_in_progress');
    return await readReleaseQualification({ pool, revision, secret, requiredCases, now: now(), id: record.runId });
  } catch {
    return unavailable('qualification_storage_unavailable', 'postgres_unavailable');
  }
}
