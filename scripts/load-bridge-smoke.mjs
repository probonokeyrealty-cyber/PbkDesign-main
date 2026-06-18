import { buildLoadScenarioPlan } from './production-performance-hardening.mjs';

const BASE_URL = String(process.env.PBK_LOAD_TARGET || process.env.PBK_HOSTED_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com')
  .trim()
  .replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const CONCURRENCY = Math.max(1, Math.min(250, Number(process.env.PBK_LOAD_CONCURRENCY || process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] || 50)));
const PATHNAME = String(process.env.PBK_LOAD_PATH || process.argv.find((arg) => arg.startsWith('--path='))?.split('=')[1] || '/health').trim() || '/health';
const PATHS_ARG = String(process.env.PBK_LOAD_PATHS || process.argv.find((arg) => arg.startsWith('--paths='))?.split('=')[1] || '').trim();
const SCENARIO_MODE = /^(1|true|yes)$/i.test(String(process.env.PBK_LOAD_SCENARIOS || '').trim()) || PATHS_ARG.length > 0;

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

async function hit(index, pathName, auth = true) {
  const started = performance.now();
  const headers = {};
  if (API_KEY && auth && pathName !== '/health') headers.Authorization = `Bearer ${API_KEY}`;
  try {
    const response = await fetch(`${BASE_URL}${pathName}`, { headers });
    await response.arrayBuffer();
    return {
      index,
      ok: response.ok,
      status: response.status,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      index,
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - started),
      error: error?.message || String(error),
    };
  }
}

async function runPath(pathName, auth = true) {
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, index) => hit(index, pathName, auth))
  );
  const totalMs = Math.round(performance.now() - started);
  const failed = results.filter((result) => !result.ok);
  const latencies = results.map((result) => result.ms);
  return {
    ok: failed.length === 0,
    target: BASE_URL,
    path: pathName,
    concurrency: CONCURRENCY,
    totalMs,
    success: results.length - failed.length,
    failed: failed.length,
    p50Ms: percentile(latencies, 50),
    p90Ms: percentile(latencies, 90),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    statuses: results.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {}),
  };
}

let reports = [];
if (SCENARIO_MODE) {
  const explicitPaths = PATHS_ARG
    ? PATHS_ARG.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const plan = buildLoadScenarioPlan({ baseUrl: BASE_URL, concurrency: CONCURRENCY });
  const scenarios = explicitPaths.length
    ? explicitPaths.map((pathName) => ({ path: pathName, auth: pathName !== '/health' }))
    : plan.scenarios;
  reports = [];
  for (const scenario of scenarios) {
    reports.push(await runPath(scenario.path, scenario.auth));
  }
} else {
  reports = [await runPath(PATHNAME, PATHNAME !== '/health')];
}

const failedReports = reports.filter((report) => !report.ok);
const report = {
  ok: failedReports.length === 0,
  target: BASE_URL,
  concurrency: CONCURRENCY,
  scenarioMode: SCENARIO_MODE,
  reports,
  note: 'Read-only bridge load smoke. It does not place calls, send SMS/email, or touch contracts.',
};

console.log(JSON.stringify(report, null, 2));
if (failedReports.length) process.exitCode = 1;
