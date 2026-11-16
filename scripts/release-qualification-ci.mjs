const REPOSITORY = 'probonokeyrealty-cyber/PbkDesign-main';
const ACTIONS = `https://api.github.com/repos/${REPOSITORY}/actions`;
const WORKFLOW = '.github/workflows/release-qualification.yml';
const MAX_AGE_MS = 86_400_000;
const MAX_BYTES = 1_048_576;
const CHECKS = [
  ['postgres_integration', ['Run disposable Postgres tests', 'Assert zero skipped or failed Postgres tests']],
  ['browser_regression', ['Build isolated browser fixtures', 'Install Playwright browsers', 'Run Chromium and WebKit qualification']],
];
const STATUSES = new Set(['queued', 'in_progress', 'completed', 'pending', 'waiting']);
const CONCLUSIONS = new Set(['success', 'failure', 'skipped', 'neutral', 'cancelled', 'timed_out', 'action_required', 'stale']);

class EvidenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function requireEvidence(condition, code) {
  if (!condition) throw new EvidenceError(code);
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function timestamp(value) {
  return typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? Date.parse(value) : NaN;
}

function latestCompletion(rows) {
  const times = rows.map((row) => timestamp(row.executedAt)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function validateRun(run, revision, now) {
  requireEvidence(run && positiveId(run.id) && positiveId(run.run_attempt), 'invalid_run');
  requireEvidence(run.head_sha === revision, 'revision_mismatch');
  requireEvidence(run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY, 'repository_mismatch');
  requireEvidence(run.path === WORKFLOW, 'workflow_mismatch');
  requireEvidence(['push', 'pull_request', 'workflow_dispatch'].includes(run.event), 'event_not_allowed');
  const times = [run.created_at, run.run_started_at, run.updated_at].map(timestamp);
  requireEvidence(times.every(Number.isFinite), 'invalid_timestamps');
  requireEvidence(times.every((time) => time <= now), 'evidence_future');
  requireEvidence(times.every((time) => now - time <= MAX_AGE_MS), 'evidence_stale');
  requireEvidence(times[0] <= times[1] && times[1] <= times[2], 'invalid_timestamps');
  return { started: times[1], completed: times[2], timestamps: times };
}

function interval(row, lower, upper) {
  const started = timestamp(row?.started_at);
  const completed = timestamp(row?.completed_at);
  return Number.isFinite(started) && Number.isFinite(completed) && lower <= started && started <= completed && completed <= upper;
}

function readChecks(payload, run, bounds) {
  requireEvidence(payload && Array.isArray(payload.jobs) && payload.total_count === payload.jobs.length && payload.jobs.length === 1, 'required_job_invalid');
  const job = payload.jobs[0];
  requireEvidence(job.name === 'Release qualification' && positiveId(job.id) && job.run_id === run.id &&
    job.head_sha === run.head_sha && job.run_url === `${ACTIONS}/runs/${run.id}` &&
    job.status === 'completed' && job.conclusion === 'success' &&
    interval(job, bounds.started, bounds.completed) && Array.isArray(job.steps) && job.steps.length <= 100, 'required_job_invalid');
  const timestamps = [timestamp(job.started_at), timestamp(job.completed_at)];
  let previous = timestamp(job.started_at);
  const checks = CHECKS.map(([id, names]) => {
    let valid = true;
    const requiredSteps = names.map((name) => {
      const matches = job.steps.filter((step) => step?.name === name);
      const step = matches.length === 1 ? matches[0] : null;
      const timed = interval(step, previous, timestamp(job.completed_at));
      const completed = step?.status === 'completed' && ['success', 'failure', 'timed_out'].includes(step.conclusion);
      if (!timed) valid = false;
      if (timed) {
        previous = timestamp(step.completed_at);
        timestamps.push(timestamp(step.started_at), previous);
      }
      return {
        name,
        status: step ? (STATUSES.has(step.status) ? step.status : 'invalid') : 'missing',
        conclusion: CONCLUSIONS.has(step?.conclusion) ? step.conclusion : null,
        executedAt: timed && completed ? new Date(timestamp(step.completed_at)).toISOString() : null,
      };
    });
    const executed = valid && requiredSteps.every((step) => step.status === 'completed' && ['success', 'failure', 'timed_out'].includes(step.conclusion));
    return { id, executed, passed: executed && requiredSteps.every((step) => step.conclusion === 'success'),
      executedAt: latestCompletion(requiredSteps), requiredSteps };
  });
  return { checks, timestamps };
}

// Only fixed REST metadata is read. No artifacts, caller reports, redirects or provider APIs.
export async function loadQualificationCiEvidence({ revision, token, fetchImpl = fetch, now = Date.now(), timeoutMs = 10_000 } = {}) {
  const result = {
    runId: null, revision: typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision) ? revision : null,
    executedAt: null, expiresAt: null, executed: false, passed: false,
    checks: CHECKS.map(([id, names]) => ({ id, executed: false, passed: false, executedAt: null,
      requiredSteps: names.map((name) => ({ name, status: 'missing', conclusion: null, executedAt: null })) })),
    source: 'github_actions', provenance: 'controlled', status: 'unavailable', errorCode: null,
  };
  const controller = new AbortController();
  let timer;
  try {
    requireEvidence(result.revision, 'invalid_revision');
    requireEvidence(Number.isFinite(now) && Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof fetchImpl === 'function', 'invalid_options');
    const credential = typeof token === 'string' ? token.trim() : '';
    const listUrl = `${ACTIONS}/workflows/release-qualification.yml/runs?head_sha=${revision}&per_page=1`;
    async function get(url) {
      requireEvidence(!controller.signal.aborted, 'api_timeout');
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
          'X-GitHub-Api-Version': '2022-11-28' },
      });
      requireEvidence(response.status === 200 && !response.redirected && (!response.url || response.url === url), 'api_error');
      requireEvidence(Number(response.headers.get('content-length') || 0) <= MAX_BYTES, 'response_too_large');
      requireEvidence(response.body && typeof response.body.getReader === 'function', 'invalid_response');
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        const decoder = new TextDecoder();
        let body = '';
        let bytes = 0;
        while (true) {
          requireEvidence(!controller.signal.aborted, 'api_timeout');
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          requireEvidence(bytes <= MAX_BYTES, 'response_too_large');
          body += decoder.decode(value, { stream: true });
        }
        requireEvidence(!controller.signal.aborted, 'api_timeout');
        try { return JSON.parse(body + decoder.decode()); }
        catch { throw new EvidenceError('invalid_response'); }
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        cancel();
      }
    }

    async function newestRun() {
      const payload = await get(listUrl);
      requireEvidence(Array.isArray(payload?.workflow_runs), 'invalid_response');
      requireEvidence(payload.workflow_runs.length > 0, 'run_missing');
      // GitHub returns newest first; never search for a passing status/event/attempt.
      return payload.workflow_runs[0];
    }

    async function readEvidence() {
      const run = await newestRun();
      const bounds = validateRun(run, revision, now);
      result.runId = String(run.id);
      requireEvidence(run.status === 'completed', 'run_incomplete');
      requireEvidence(run.conclusion === 'success', 'run_not_successful');
      const jobs = await get(`${ACTIONS}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
      const checked = readChecks(jobs, run, bounds);
      const provenanceTimes = [...bounds.timestamps, ...checked.timestamps];
      result.checks = checked.checks;
      result.executedAt = latestCompletion(result.checks);
      result.executed = result.checks.every((check) => check.executed);
      requireEvidence(result.checks.every((check) => check.passed), 'required_steps_not_successful');
      const finalRun = await get(`${ACTIONS}/runs/${run.id}`);
      const newest = await newestRun();
      for (const current of [finalRun, newest]) {
        requireEvidence(current?.id === run.id && current.run_attempt === run.run_attempt &&
          current.status === run.status && current.conclusion === run.conclusion &&
          current.updated_at === run.updated_at && current.run_started_at === run.run_started_at &&
          current.created_at === run.created_at, 'run_changed');
        provenanceTimes.push(...validateRun(current, revision, now).timestamps);
      }
      requireEvidence(!controller.signal.aborted, 'api_timeout');
      result.expiresAt = new Date(Math.min(...provenanceTimes) + MAX_AGE_MS).toISOString();
      result.passed = true;
      result.status = 'passed';
    }

    // A single deadline covers transport and body reads, including non-cooperative transports.
    await Promise.race([readEvidence(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new EvidenceError('api_timeout')); }, Math.min(timeoutMs, 10_000));
    })]);
  } catch (error) {
    result.passed = false;
    result.expiresAt = null;
    result.errorCode = controller.signal.aborted ? 'api_timeout' : error instanceof EvidenceError ? error.code : 'api_error';
    result.status = ['run_not_successful', 'required_job_invalid', 'required_steps_not_successful'].includes(result.errorCode) ? 'failed' : 'unavailable';
    // Successful steps from a changed/unavailable attempt are not reusable proof.
    if (!['run_not_successful', 'required_job_invalid', 'required_steps_not_successful'].includes(result.errorCode)) {
      result.executed = false;
      for (const check of result.checks) check.passed = false;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return result;
}
