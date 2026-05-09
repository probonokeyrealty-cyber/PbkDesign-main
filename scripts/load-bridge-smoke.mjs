const BASE_URL = String(process.env.PBK_LOAD_TARGET || process.env.PBK_HOSTED_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com')
  .trim()
  .replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const CONCURRENCY = Math.max(1, Math.min(250, Number(process.env.PBK_LOAD_CONCURRENCY || process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] || 50)));
const PATHNAME = String(process.env.PBK_LOAD_PATH || process.argv.find((arg) => arg.startsWith('--path='))?.split('=')[1] || '/health').trim() || '/health';

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

async function hit(index) {
  const started = performance.now();
  const headers = {};
  if (API_KEY && PATHNAME !== '/health') headers.Authorization = `Bearer ${API_KEY}`;
  try {
    const response = await fetch(`${BASE_URL}${PATHNAME}`, { headers });
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

const started = performance.now();
const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, index) => hit(index)));
const totalMs = Math.round(performance.now() - started);
const failed = results.filter((result) => !result.ok);
const latencies = results.map((result) => result.ms);
const report = {
  ok: failed.length === 0,
  target: BASE_URL,
  path: PATHNAME,
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
  note: PATHNAME === '/health'
    ? 'Non-provider load smoke only. It does not place calls, send SMS/email, or touch contracts.'
    : 'Authenticated bridge endpoint load smoke. Provider writes are still not invoked.',
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
