import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return readFileSync(path.resolve(root, relativePath), 'utf8');
}

const analyticsSource = read('src/app/routes/Analytics.tsx');
const memorySource = read('src/app/routes/MemoryAnalytics.tsx');
const runtimeBridgeSource = read('src/app/utils/runtimeBridge.ts');
const bridgeSource = read('scripts/openclaw-local-server.mjs');
const packageSource = read('package.json');

for (const [name, source] of [
  ['Analytics.tsx', analyticsSource],
  ['MemoryAnalytics.tsx', memorySource],
]) {
  assert(!/SAMPLE_LEADS|FUNNEL|DAILY_DEALS|SKILLS|BASE_TRENDS/.test(source), `${name} should not define static runtime data arrays.`);
  assert(!/UI-only|static UI sample|cosmetic mock|Diane Kowalski|Marco Hill|Lena Brooks|\$0\.31|124[Ã×x]/.test(source), `${name} should not disclose mock analytics copy or fake metrics.`);
}

for (const endpoint of [
  '/api/leads/stages',
  '/api/deals/timeline',
  '/api/observability/ai-metrics',
  '/api/skills/outcomes',
  '/api/skills/trends',
]) {
  assert(bridgeSource.includes(endpoint), `Bridge should expose ${endpoint}.`);
  assert(new RegExp(`PUBLIC_READ_PATHS[\\s\\S]*${endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(bridgeSource), `${endpoint} should be public for GET without opening mutating routes.`);
  assert(runtimeBridgeSource.includes(endpoint), `runtimeBridge should fetch ${endpoint}.`);
}

assert(runtimeBridgeSource.includes('fetchSkillOutcomesRequest'), 'runtimeBridge should expose a read helper for /api/skills/outcomes.');
assert(/split\('\?'\)\[0\]/.test(runtimeBridgeSource), 'Auth-optional runtime path matching should ignore query strings.');
assert(/"test:analytics-live-data":\s*"node \.\/scripts\/analytics-live-data-smoke\.mjs"/.test(packageSource), 'package.json should expose the analytics live-data smoke test.');
assert(/"test:founder"[\s\S]*npm run test:analytics-live-data/.test(packageSource), 'test:founder should include the analytics live-data smoke test.');

const analyticsLogic = await import(pathToFileURL(path.resolve(root, 'src/app/routes/analyticsRuntimeLogic.js')).href);
const memoryLogic = await import(pathToFileURL(path.resolve(root, 'src/app/routes/memoryAnalyticsRuntimeLogic.js')).href);

const normalizedAnalytics = analyticsLogic.buildAnalyticsViewModel({
  stagesResponse: {
    stages: [
      { stage: 'contacted', total: 10, leads: [{ id: 'real-1', name: 'Real Seller', address: '1 Live Way', revenue: 2500 }] },
      { stage: 'closed', total: 2, leads: [{ id: 'real-2', name: 'Closed Seller', address: '2 Live Way', revenue: 50000 }] },
    ],
  },
  timelineResponse: {
    days: [
      { day: '2026-06-01', count: 1, revenue: 12000, leads: [{ id: 'deal-1', name: 'Deal Seller', address: '3 Live Way', revenue: 12000 }] },
      { day: '2026-06-02', count: 2, revenue: 38000 },
    ],
  },
  aiMetricsResponse: { metrics: { p95LatencyMs: 1480, qaRetryRate: 0.0125, safetyBlocks: 4 } },
});

assert.equal(normalizedAnalytics.funnel[0].total, 10);
assert.equal(normalizedAnalytics.funnel[0].leads[0].name, 'Real Seller');
assert.equal(normalizedAnalytics.dailyDeals[1].revenue, 38000);
assert.deepEqual(normalizedAnalytics.aiMetrics.map((item) => item.label), ['P95 answer latency', 'QA retries', 'Safety blocks']);

const roi = analyticsLogic.computeAnalyticsRoi({
  contacted: 10,
  qualified: 5,
  closed: 2,
  aiSpend: 20,
  revenue: 1000,
});
assert.equal(roi.costPerContactedLead, 2);
assert.equal(roi.roiMultiple, 50);

const csv = analyticsLogic.buildAnalyticsCsv(normalizedAnalytics);
assert(csv.includes('section,label,total,revenue'), 'CSV export should include analytics rows.');
assert(csv.includes('Real Seller'), 'CSV export should include real drill-down leads.');

const normalizedMemory = memoryLogic.buildMemoryAnalyticsViewModel({
  outcomesResponse: {
    skills: [
      { id: 'skill-live', name: 'Live Skill', uses: 20, wins: 15, losses: 5, confidence: 0.87, successRate: 75 },
    ],
  },
  trendsBySkillId: {
    'skill-live': { points: [{ successRate: 70 }, { successRate: 75 }, { successRate: 80 }] },
  },
  experimentsResponse: { experiments: [] },
});

assert.equal(normalizedMemory.skills[0].name, 'Live Skill');
assert.deepEqual(normalizedMemory.skills[0].trend, [70, 75, 80]);
assert.equal(normalizedMemory.experiments.length, 0);

console.log(JSON.stringify({ ok: true, result: 'analytics_live_data_smoke_ready' }, null, 2));
