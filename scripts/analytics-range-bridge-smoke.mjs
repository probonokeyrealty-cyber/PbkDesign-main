import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const bridge = await startIsolatedBridge({ entry: fileURLToPath(new URL('./fixtures/analytics-proof-range-entry.mjs', import.meta.url)) });
try {
  const read = async (path) => {
    const response = await bridge.fetch(bridge.origin + path, { headers: { Authorization: `Bearer ${bridge.apiKey}` } });
    assert.equal(response.status, 200);
    return response.json();
  };
  const protectedRows = async () => {
    const state = await read('/state');
    return JSON.stringify({ calls: state.calls, approvals: state.approvals,
      leads: state.leadImports, contracts: state.contracts });
  };
  const before = await protectedRows();
  const defaultTimeline = await read('/api/deals/timeline');
  assert.deepEqual(defaultTimeline.days.map(({ day, revenue }) => [day, revenue]), [
    ['2025-12-31', 4000], ['2026-01-01', 6000], ['2026-01-02', 7000],
  ]);
  const ytd = await read('/api/deals/timeline?range=ytd');
  assert.equal(ytd.range, 'ytd');
  assert.equal(ytd.reportingPeriod, 'ytd:2026');
  assert.deepEqual(ytd.days.map(({ day, revenue }) => [day, revenue]), [
    ['2026-01-01', 6000], ['2026-01-02', 7000],
  ]);
  assert.equal((await read('/api/observability/ai-metrics?range=ytd')).range, 'ytd');
  assert.equal((await read('/api/observability/ai-metrics?days=7')).days, 7);
  assert.equal(await protectedRows(), before, 'analytics GETs preserve protected synthetic records');
  console.log('Isolated analytics bridge: rolling/YTD, explicit revenue, signed exclusion, and protected fingerprints passed.');
} finally { await bridge.stop(); }
