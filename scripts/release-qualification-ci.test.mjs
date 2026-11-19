import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { jest, test } from '@jest/globals';
import { parse } from 'yaml';
import { loadQualificationCiEvidence } from './release-qualification-ci.mjs';

const revision = 'a'.repeat(40);
const repository = 'probonokeyrealty-cyber/PbkDesign-main';
const base = `https://api.github.com/repos/${repository}/actions`;
const workflowPath = '.github/workflows/release-qualification.yml';
const now = Date.parse('2026-11-15T12:00:00Z');
const created = '2026-11-15T11:00:00Z';
const started = '2026-11-15T11:01:00Z';
const completed = '2026-11-15T11:10:00Z';
const names = [
  'Run disposable Postgres tests',
  'Assert zero skipped or failed Postgres tests',
  'Build isolated browser fixtures',
  'Install Playwright browsers',
  'Run Chromium and WebKit qualification',
];

function fixture() {
  const run = {
    id: 101, run_attempt: 2, head_sha: revision, path: workflowPath,
    repository: { full_name: repository }, head_repository: { full_name: repository },
    event: 'push', status: 'completed', conclusion: 'success',
    created_at: created, run_started_at: started, updated_at: completed,
    html_url: 'https://untrusted.invalid/do-not-fetch',
  };
  const job = {
    id: 201, run_id: run.id, head_sha: revision,
    run_url: `${base}/runs/${run.id}`, name: 'Release qualification',
    status: 'completed', conclusion: 'success', started_at: started, completed_at: completed,
    steps: names.map((name, index) => ({
      name, number: index + 1, status: 'completed', conclusion: 'success',
      started_at: `2026-11-15T11:0${index + 1}:00Z`,
      completed_at: `2026-11-15T11:0${index + 2}:00Z`,
    })),
  };
  return { run, jobs: { total_count: 1, jobs: [job] } };
}

function transport(data = fixture(), authenticated = true) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    if (authenticated) assert.equal(options.headers.Authorization, 'Bearer unit-only-authority');
    else assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
    assert.ok(options.signal instanceof AbortSignal);
    if (url === `${base}/workflows/release-qualification.yml/runs?head_sha=${revision}&per_page=1`) {
      return Response.json({ total_count: 2, workflow_runs: [data.run, ...(data.older ? [data.older] : [])] });
    }
    if (url === `${base}/runs/101/attempts/2/jobs?per_page=100`) return Response.json(data.jobs);
    if (url === `${base}/runs/101`) return Response.json(data.finalRun || data.run);
    assert.fail(`unexpected URL: ${url}`);
  };
  return { calls, fetchImpl };
}

async function load(data = fixture(), options = {}) {
  const api = transport(data);
  const result = await loadQualificationCiEvidence({ revision, token: 'unit-only-authority', now, ...api, ...options });
  return { result, calls: api.calls };
}

function rejected(result, code) {
  assert.equal(result.passed, false);
  assert.equal(result.expiresAt, null);
  assert.equal(result.errorCode, code);
  assert.notEqual(result.status, 'passed');
  assert.equal(JSON.stringify(result).includes('unit-only-authority'), false);
  assert.equal(JSON.stringify(result).includes('untrusted.invalid'), false);
}

test('clean newest attempt returns only controlled provenance and actual completed mandatory steps', async () => {
  const { result, calls } = await load();
  assert.equal(result.runId, '101');
  assert.equal(result.revision, revision);
  assert.equal(result.executed, true);
  assert.equal(result.passed, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.errorCode, null);
  assert.equal(result.source, 'github_actions');
  assert.equal(result.provenance, 'controlled');
  assert.equal(result.executedAt, '2026-11-15T11:06:00.000Z');
  assert.equal(result.expiresAt, '2026-11-16T11:00:00.000Z');
  assert.deepEqual(result.checks.map(({ id, executed, passed, executedAt }) => ({ id, executed, passed, executedAt })), [
    { id: 'postgres_integration', executed: true, passed: true, executedAt: '2026-11-15T11:03:00.000Z' },
    { id: 'browser_regression', executed: true, passed: true, executedAt: '2026-11-15T11:06:00.000Z' },
  ]);
  assert.deepEqual(result.checks.flatMap((check) => check.requiredSteps.map((step) => step.name)), names);
  for (const step of result.checks.flatMap((check) => check.requiredSteps)) {
    assert.equal(step.status, 'completed');
    assert.equal(step.conclusion, 'success');
    assert.ok(Date.parse(step.executedAt) < now);
  }
  assert.deepEqual(Object.keys(result).sort(), ['runId', 'revision', 'executedAt', 'expiresAt', 'executed', 'passed', 'checks', 'source', 'provenance', 'status', 'errorCode'].sort());
  assert.equal(calls.length, 4, 'recheck run attempt and newest identity before accepting evidence');
});

test('earliest provenance timestamp expires before recent completion evidence does', async () => {
  const data = fixture();
  data.run.created_at = '2026-11-14T12:00:01Z';
  const { result } = await load(data);
  assert.equal(result.passed, true);
  assert.equal(result.expiresAt, '2026-11-15T12:00:01.000Z');
  assert.equal(result.executedAt, '2026-11-15T11:06:00.000Z');
  const { result: beforeExpiry } = await load(data, { now: Date.parse('2026-11-15T12:00:00.999Z') });
  assert.equal(beforeExpiry.passed, true);
  assert.equal(beforeExpiry.expiresAt, result.expiresAt);
  const { result: afterExpiry } = await load(data, { now: Date.parse('2026-11-15T12:00:01.001Z') });
  rejected(afterExpiry, 'evidence_stale');
});

test('later readback preserves original expiry instead of refreshing it from now', async () => {
  const first = (await load()).result;
  const later = (await load(undefined, { now: Date.parse('2026-11-15T14:00:00Z') })).result;
  assert.equal(first.passed, true);
  assert.equal(later.passed, true);
  assert.equal(first.expiresAt, '2026-11-16T11:00:00.000Z');
  assert.equal(later.expiresAt, first.expiresAt);
  assert.equal(later.executedAt, first.executedAt);
});

test('expiry uses timestamp instants and cannot be supplied by the caller', async () => {
  const data = fixture();
  data.run.created_at = '2026-11-14T07:30:00-07:00';
  const { result } = await load(data, { expiresAt: '2099-01-01T00:00:00Z' });
  assert.equal(result.passed, true);
  assert.equal(result.expiresAt, '2026-11-15T14:30:00.000Z');
});

for (const event of ['pull_request', 'workflow_dispatch']) {
  test(`accepts fixed workflow event ${event}`, async () => {
    const data = fixture();
    data.run.event = event;
    assert.equal((await load(data)).result.passed, true);
  });
}

for (const [defect, code, mutate] of [
  ['wrong SHA', 'revision_mismatch', (d) => { d.run.head_sha = 'b'.repeat(40); }],
  ['short SHA', 'revision_mismatch', (d) => { d.run.head_sha = revision.slice(0, 7); }],
  ['wrong repo', 'repository_mismatch', (d) => { d.run.repository.full_name = 'other/repo'; }],
  ['fork head', 'repository_mismatch', (d) => { d.run.head_repository.full_name = 'other/repo'; }],
  ['wrong path', 'workflow_mismatch', (d) => { d.run.path = '.github/workflows/other.yml'; }],
  ['unallowed event', 'event_not_allowed', (d) => { d.run.event = 'pull_request_target'; }],
  ['stale', 'evidence_stale', (d) => { d.run.created_at = '2026-11-13T11:00:00Z'; }],
  ['future created', 'evidence_future', (d) => { d.run.created_at = '2026-11-15T12:01:00Z'; }],
  ['future updated', 'evidence_future', (d) => { d.run.updated_at = '2026-11-15T12:01:00Z'; }],
  ['missing timestamp', 'invalid_timestamps', (d) => { delete d.run.run_started_at; }],
  ['reversed timestamp', 'invalid_timestamps', (d) => { d.run.updated_at = created; }],
  ['running', 'run_incomplete', (d) => { d.run.status = 'in_progress'; d.run.conclusion = null; }],
  ['latest failed', 'run_not_successful', (d) => { d.older = { ...d.run, id: 100 }; d.run.conclusion = 'failure'; }],
  ['skipped run', 'run_not_successful', (d) => { d.run.conclusion = 'skipped'; }],
  ['unsafe run ID', 'invalid_run', (d) => { d.run.id = '../other'; }],
  ['missing attempt', 'invalid_run', (d) => { delete d.run.run_attempt; }],
]) {
  test(`fails closed for ${defect}`, async () => {
    const data = fixture();
    mutate(data);
    rejected((await load(data)).result, code);
  });
}

for (const [defect, mutate] of [
  ['missing job', (d) => { d.jobs = { total_count: 0, jobs: [] }; }],
  ['partial job page', (d) => { d.jobs.total_count = 2; }],
  ['wrong job SHA', (d) => { d.jobs.jobs[0].head_sha = 'b'.repeat(40); }],
  ['wrong job run', (d) => { d.jobs.jobs[0].run_id = 100; }],
  ['wrong job URL', (d) => { d.jobs.jobs[0].run_url = 'https://untrusted.invalid'; }],
  ['duplicate job', (d) => { d.jobs.jobs.push({ ...d.jobs.jobs[0] }); d.jobs.total_count = 2; }],
  ['renamed job', (d) => { d.jobs.jobs[0].name = 'Other'; }],
  ['unfinished job', (d) => { d.jobs.jobs[0].status = 'in_progress'; }],
  ['skipped job', (d) => { d.jobs.jobs[0].conclusion = 'skipped'; }],
  ['job without completion', (d) => { d.jobs.jobs[0].completed_at = null; }],
]) {
  test(`rejects ${defect} rather than trusting overall success`, async () => {
    const data = fixture();
    mutate(data);
    rejected((await load(data)).result, 'required_job_invalid');
  });
}

for (const index of [0, 1, 2, 3, 4]) {
  for (const conclusion of ['skipped', 'failure', 'neutral', null]) {
    test(`mandatory step ${names[index]} cannot be ${conclusion}`, async () => {
      const data = fixture();
      data.jobs.jobs[0].steps[index].conclusion = conclusion;
      const { result } = await load(data);
      rejected(result, 'required_steps_not_successful');
      assert.equal(result.checks[index < 2 ? 0 : 1].passed, false);
    });
  }
}

for (const [defect, mutate] of [
  ['missing step', (steps) => { steps.pop(); }],
  ['duplicate step', (steps) => { steps.push({ ...steps[0] }); }],
  ['unfinished step', (steps) => { steps[0].status = 'in_progress'; }],
  ['missing completion', (steps) => { steps[0].completed_at = null; }],
  ['future completion', (steps) => { steps[0].completed_at = '2026-11-15T12:01:00Z'; }],
  ['before job', (steps) => { steps[0].started_at = created; }],
]) {
  test(`rejects mandatory ${defect}`, async () => {
    const data = fixture();
    mutate(data.jobs.jobs[0].steps);
    rejected((await load(data)).result, 'required_steps_not_successful');
  });
}

test('no runs is unavailable, never a default pass', async () => {
  const { result } = await load(undefined, { fetchImpl: async () => Response.json({ total_count: 0, workflow_runs: [] }) });
  rejected(result, 'run_missing');
});

test('skipped steps do not claim an execution completion timestamp', async () => {
  const data = fixture();
  data.jobs.jobs[0].steps[4].conclusion = 'skipped';
  const { result } = await load(data);
  rejected(result, 'required_steps_not_successful');
  assert.equal(result.checks[1].executed, false);
  assert.equal(result.checks[1].requiredSteps[2].executedAt, null);
  assert.equal(result.executedAt, '2026-11-15T11:05:00.000Z');
});

test('newer failure appearing during reads invalidates the earlier pass', async () => {
  const data = fixture();
  const api = transport(data);
  let lists = 0;
  const { result } = await load(data, { fetchImpl: async (url, options) => {
    if (url.includes('/workflows/') && ++lists === 2) {
      return Response.json({ workflow_runs: [{ ...data.run, id: 102, conclusion: 'failure' }] });
    }
    return api.fetchImpl(url, options);
  } });
  rejected(result, 'run_changed');
});

test('re-run started during reads cannot inherit the old successful steps', async () => {
  const data = fixture();
  data.finalRun = { ...data.run, run_attempt: 3, status: 'in_progress', conclusion: null };
  rejected((await load(data)).result, 'run_changed');
});

for (const [defect, fetchImpl, code] of [
  ['HTTP failure', async () => new Response('unit-only-authority raw sensitive error', { status: 403 }), 'api_error'],
  ['network failure', async () => { throw new Error('unit-only-authority raw sensitive error'); }, 'api_error'],
  ['redirect', async () => new Response('', { status: 302, headers: { Location: 'https://untrusted.invalid' } }), 'api_error'],
  ['invalid JSON', async () => new Response('unit-only-authority'), 'invalid_response'],
  ['oversized body', async () => new Response('x'.repeat(1_048_577)), 'response_too_large'],
]) {
  test(`sanitizes ${defect}`, async () => {
    const { result } = await load(undefined, { fetchImpl });
    rejected(result, code);
    assert.equal(JSON.stringify(result).includes('raw sensitive error'), false);
  });
}

for (const [defect, options, code] of [
  ['invalid revision', { revision: 'main' }, 'invalid_revision'],
  ['invalid time', { now: NaN }, 'invalid_options'],
  ['invalid timeout', { timeoutMs: 0 }, 'invalid_options'],
]) {
  test(`${defect} does not make any request`, async () => {
    const { result, calls } = await load(undefined, options);
    rejected(result, code);
    assert.equal(calls.length, 0);
  });
}

for (const [label, token] of [['missing', undefined], ['empty', ''], ['blank', ' \t '], ['null', null], ['nonstring', 17]]) {
  test(`${label} token reads public evidence successfully without Authorization`, async () => {
    const api = transport(fixture(), false);
    const result = await loadQualificationCiEvidence({ revision, token, now, fetchImpl: api.fetchImpl });
    assert.equal(result.passed, true);
    assert.equal(result.runId, '101');
    assert.equal(api.calls.length, 4);
    for (const { options } of api.calls) assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
  });
}

test('nonempty string token sends only the trimmed Bearer value', async () => {
  const { result } = await load(undefined, { token: '  unit-only-authority  ' });
  assert.equal(result.passed, true);
});

for (const status of [403, 404, 429]) {
  test(`anonymous API ${status} stays unverified without exposing the response`, async () => {
    const { result } = await load(undefined, { token: '', fetchImpl: async (_url, options) => {
      assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
      return new Response('unit-only-authority raw sensitive error', { status });
    } });
    rejected(result, 'api_error');
    assert.equal(result.executed, false);
    assert.equal(result.status, 'unavailable');
    assert.equal(JSON.stringify(result).includes('raw sensitive error'), false);
  });
}

test('caller run IDs, reports and URLs cannot override the fixed GitHub reads', async () => {
  const { result } = await load(undefined, {
    runId: 100, runUrl: 'https://untrusted.invalid', repository: 'other/repo',
    report: { passed: true }, workflow: 'other.yml',
  });
  assert.equal(result.passed, true);
  assert.equal(result.runId, '101');
});

test('one deadline bounds all fetches even when transport ignores abort', async () => {
  jest.useFakeTimers();
  try {
    const api = transport();
    let count = 0;
    let signal;
    const resultPromise = loadQualificationCiEvidence({ revision, token: 'unit-only-authority', now, timeoutMs: 100,
      fetchImpl: async (url, options) => {
        signal = options.signal;
        await new Promise((resolve) => setTimeout(resolve, 40));
        count++;
        return api.fetchImpl(url, options);
      },
    });
    await jest.advanceTimersByTimeAsync(101);
    rejected(await resultPromise, 'api_timeout');
    assert.equal(signal.aborted, true);
    assert.equal(count, 2, 'must not get a new timeout budget per read');
  } finally { jest.useRealTimers(); }
});

test('deadline includes reading a response body that never finishes', async () => {
  const { result } = await load(undefined, { timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ start() {} })) });
  rejected(result, 'api_timeout');
});

function workflow() {
  return parse(readFileSync(new URL('../.github/workflows/release-qualification.yml', import.meta.url), 'utf8'));
}

test('operator workflow proof is unconditional after browser installation and founder unit gate', () => {
  const steps = workflow().jobs['release-qualification'].steps;
  const index = steps.findIndex(step => step.name === 'Run operator workflow browser proof');
  assert.ok(index > steps.findIndex(step => step.name === 'Install Playwright browsers'));
  const step = steps[index];
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(step.run, 'npm run test:operator-workflow-browser');
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts['test:operator-workflow-unit'], 'node --test scripts/worklist-focus.node-test.mjs scripts/skill-evidence-display.node-test.mjs scripts/operator-workflow-local-preview.node-test.mjs');
  assert.equal(scripts['test:operator-workflow-browser'], 'node scripts/leads-workflow-browser-smoke.mjs && node scripts/skill-studio-workflow-browser-smoke.mjs');
  assert.match(scripts['test:founder'], /npm run test:unit && npm run test:operator-workflow-unit &&/);
  const founder = parse(readFileSync(new URL('../.github/workflows/founder-verify.yml', import.meta.url), 'utf8'));
  const founderJob = founder.jobs['founder-verify'];
  const founderGate = founderJob.steps.find(item => item.name === 'Run founder gate');
  assert.equal(founderJob.if, undefined);
  assert.equal(founderJob['continue-on-error'], undefined);
  assert.equal(founderGate.if, undefined);
  assert.equal(founderGate['continue-on-error'], undefined);
  assert.equal(founderGate.run, 'npm run test:founder');
  assert.deepEqual(founder.on, { pull_request: { branches: ['main'] }, push: { branches: ['main'] }, workflow_dispatch: null });
  assert.deepEqual(founder.permissions, { contents: 'read' });
  assert.equal(founderJob['timeout-minutes'], 30);
  assert.equal(founderJob.steps.find(item => item.uses === 'actions/setup-node@v6').with['node-version'], 22);
  assert.doesNotMatch(step.run + scripts['test:operator-workflow-browser'] + scripts['test:operator-workflow-unit'], /skip|continue-on-error|grep|test-name-pattern|\|\|/i);
});

test('workflow requires full isolated Postgres and default Chromium/WebKit execution without conditional steps', () => {
  const config = workflow();
  assert.deepEqual(config.on, { pull_request: { branches: ['main'] }, push: { branches: ['main'] }, workflow_dispatch: null });
  assert.deepEqual(config.permissions, { contents: 'read' });
  const job = config.jobs['release-qualification'];
  assert.equal(job.name, 'Release qualification');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.env.POSTGRES_REPORT, 'release-qualification-postgres.json',
    'Job-level env cannot use runner context; report is relative to the fixed checkout');
  assert.ok(job['timeout-minutes'] <= 30);
  assert.equal(job.steps.find((step) => step.uses === 'actions/setup-node@v6').with['node-version'], 22);
  for (const name of names) {
    const step = job.steps.find((item) => item.name === name);
    assert.ok(step, name);
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
  }
  const postgres = job.steps.find((step) => step.name === names[0]);
  assert.match(postgres.run, /neon:evaluation -- --ttl-hours 1 --/);
  assert.doesNotMatch(postgres.run, /--inject-runtime-db/);
  assert.match(postgres.run, /--experimental-vm-modules/);
  assert.match(postgres.run, /--runInBand/);
  assert.match(postgres.run, /--json/);
  assert.match(postgres.run, /--runTestsByPath scripts\/conversation-store.test.mjs scripts\/provider-action-dispatch.test.mjs scripts\/release-qualification.test.mjs scripts\/operational-audit-store.test.mjs/);
  assert.match(postgres.run, /scripts\/backlog-reconciliation-store.test.mjs/);
  assert.match(postgres.run, /scripts\/backlog-reconciliation-integration.test.mjs/);
  const targeted = job.steps.find(step => step.name === 'Run targeted schema and memory Postgres proof');
  assert(targeted && !targeted.if && !targeted['continue-on-error']);
  assert.match(targeted.run, /pbk-eval-targeted-readiness-/);
  assert.match(targeted.run, /node --test scripts\/targeted-readiness-postgres.node-test.mjs/);
  assert.doesNotMatch(targeted.run, /--inject-runtime-db/);
  assert.match(postgres.env.NEON_API_KEY, /secrets.NEON_API_KEY \|\| secrets.PBK_NEON_API_KEY/);
  assert.match(postgres.env.NEON_PROJECT_ID, /vars.NEON_PROJECT_ID/);
  assert.match(job.steps.find((step) => step.name === names[3]).run, /playwright install --with-deps chromium webkit/);
  assert.equal(job.steps.find((step) => step.name === names[4]).run, 'node scripts/ava-design-browser-smoke.mjs');
  assert.equal(job.steps.find((step) => step.name === names[2]).run, 'npm run build');
  const secrets = JSON.stringify(config).match(/secrets\.[A-Z_]+/g) || [];
  assert.ok(secrets.length > 0);
  assert.ok(secrets.every((name) => /^secrets\.(?:PBK_)?NEON_(?:API_KEY|PROJECT_ID)$/.test(name)));
});

function report() {
  return {
    success: true, numTotalTestSuites: 6, numPassedTestSuites: 6, numFailedTestSuites: 0, numPendingTestSuites: 0,
    numTotalTests: 24, numPassedTests: 24, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numRuntimeErrorTestSuites: 0,
    testResults: ['backlog-reconciliation-integration', 'backlog-reconciliation-store', 'conversation-store', 'operational-audit-store', 'provider-action-dispatch', 'release-qualification'].map((name) => ({
      name: `/fixture/scripts/${name}.test.mjs`, status: 'passed',
      assertionResults: Array.from({ length: 4 }, () => ({ status: 'passed' })),
    })),
  };
}

test('founder CI executes the isolated no-delivery reconciliation boundary smoke', () => {
  const founder = parse(readFileSync(new URL('../.github/workflows/founder-verify.yml', import.meta.url), 'utf8'));
  const commands = founder.jobs['founder-verify'].steps.map(step => step.run || '').join('\n');
  assert.match(commands, /npm run test:backlog-reconciliation-bridge/);
});

for (const [defect, mutate, passes] of [
  ['clean success', () => {}, true],
  ['skipped test', (r) => { r.numPendingTests = 1; }, false],
  ['skipped suite', (r) => { r.numPendingTestSuites = 1; }, false],
  ['failed test', (r) => { r.numFailedTests = 1; }, false],
  ['todo test', (r) => { r.numTodoTests = 1; }, false],
  ['runtime error', (r) => { r.numRuntimeErrorTestSuites = 1; }, false],
  ['missing suite', (r) => { r.testResults.pop(); }, false],
  ['empty results', (r) => { r.numTotalTests = 0; r.numPassedTests = 0; }, false],
  ['hidden skipped assertion', (r) => { r.testResults[0].assertionResults[0].status = 'pending'; }, false],
  ['empty assertions', (r) => { r.testResults[0].assertionResults = []; }, false],
  ['wrong suite', (r) => { r.testResults[0].name = '/fixture/other.test.mjs'; }, false],
]) {
  test(`CI structured Jest gate ${passes ? 'accepts' : 'rejects'} ${defect}`, () => {
    const step = workflow().jobs['release-qualification'].steps.find((item) => item.name === names[1]);
    const script = step.run.match(/<<'NODE'\n([\s\S]*?)\nNODE\s*$/)?.[1];
    assert.ok(script, 'execute the actual workflow report gate');
    const dir = mkdtempSync(path.join(tmpdir(), 'pbk-qualification-ci-'));
    try {
      const data = report();
      mutate(data);
      const file = path.join(dir, 'report.json');
      writeFileSync(file, JSON.stringify(data));
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8', env: { ...process.env, POSTGRES_REPORT: file }, timeout: 5_000,
      });
      assert.equal(result.status === 0, passes, result.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
