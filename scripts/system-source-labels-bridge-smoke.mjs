import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildSourceTruthLabel,
  summarizeSourceTruthLabels,
} from './system-source-health.mjs';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const bridge = read('scripts/openclaw-local-server.mjs');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const sourceLabelsRow =
  dataMap.split(/\r?\n/).find((line) => line.includes('| Runtime source health and data activity')) || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:system-source-labels-bridge"'),
  'package.json must expose test:system-source-labels-bridge.'
);

assert(
  /export type SystemSourceLabel/.test(runtimeBridge),
  'runtimeBridge must type system source labels.'
);

assert(
  /export async function fetchSystemSourceLabelsRequest/.test(runtimeBridge) &&
    /path:\s*['"`]\/api\/system\/source-labels/.test(runtimeBridge),
  'runtimeBridge must expose fetchSystemSourceLabelsRequest for /api/system/source-labels.'
);

assert(
  /buildSystemSourceLabelsSnapshot/.test(bridge),
  'Bridge must build canonical system source label snapshots.'
);

const checkedAt = '2026-06-11T12:00:00.000Z';
const healthyEmpty = buildSourceTruthLabel({
  id: 'campaigns',
  label: 'Campaigns',
  endpoint: 'GET /api/campaigns',
  checkedAt,
  recordCount: 0,
});
assert(
  healthyEmpty.status === 'live' &&
    healthyEmpty.dataState === 'empty' &&
    !Object.hasOwn(healthyEmpty, 'confidence') &&
    !Object.hasOwn(healthyEmpty, 'reliability'),
  'A healthy endpoint with no records must be live/empty, not stale or fallback.'
);

const healthyQuiet = buildSourceTruthLabel({
  id: 'runtime',
  label: 'Runtime',
  endpoint: 'GET /state',
  checkedAt,
  recordCount: 4,
  lastDataAt: '2026-06-10T00:00:00.000Z',
});
assert(
  healthyQuiet.status === 'live' && healthyQuiet.dataState === 'stale',
  'Old business activity must not make a responding endpoint stale.'
);

const degraded = buildSourceTruthLabel({
  id: 'tooling',
  label: 'Tooling',
  endpoint: 'GET /api/tooling/status',
  checkedAt,
  degradedReason: '2 optional providers are not connected',
});
assert(
  degraded.status === 'live' &&
    degraded.readiness === 'degraded' &&
    degraded.degradedReason === '2 optional providers are not connected',
  'A responding endpoint with incomplete readiness must be live/degraded, not fallback.'
);

const fallback = buildSourceTruthLabel({
  id: 'runtime',
  label: 'Runtime',
  endpoint: 'GET /state',
  checkedAt,
  fallbackReason: 'Postgres unavailable; serving runtime file',
});
assert(
  fallback.status === 'fallback' &&
    fallback.fallbackReason === 'Postgres unavailable; serving runtime file',
  'Fallback status must require an explicit alternate-source reason.'
);

const sourceSummary = summarizeSourceTruthLabels([healthyEmpty, healthyQuiet, degraded, fallback]);
assert(
    sourceSummary.live === 3 &&
    sourceSummary.fallback === 1 &&
    sourceSummary.readiness.degraded === 1 &&
    sourceSummary.data.empty === 3 &&
    sourceSummary.data.stale === 1,
  'Source summary must separate endpoint health from data activity.'
);

assert(
  /\/api\/system\/source-labels/.test(bridge),
  'Bridge must route GET /api/system/source-labels.'
);

assert(
  /\/api\/health\/staleness/.test(bridge),
  'Bridge must expose authenticated source freshness diagnostics.'
);

assert(
  /buildSourceTruthLabel/.test(bridge) && /summarizeSourceTruthLabels/.test(bridge),
  'Bridge source labels must use the tested source-truth classifier.'
);

assert(
  /runtimeStateProvenance/.test(bridge) &&
    /render-postgres-unavailable/.test(bridge) &&
    /render-postgres-initialized/.test(bridge) &&
    /local-bridge-state/.test(bridge) &&
    /fallbackReason/.test(bridge) &&
    !/runtime-file-fallback/.test(bridge),
  'Bridge must record fail-closed Postgres provenance without hosted runtime-file fallbacks.'
);

assert(
  /async function buildSystemSourceLabelsSnapshot/.test(bridge) &&
    /const toolingStatus = await buildToolingStatus\(\)/.test(bridge) &&
    /await buildSystemSourceLabelsSnapshot\(\)/.test(bridge),
  'Source labels must inspect the real tooling builder asynchronously.'
);

assert(
  !/lastUpdatedAt:\s*workQueue\.generatedAt/.test(bridge) &&
    !/lastUpdatedAt:\s*intelligenceStream\.generatedAt/.test(bridge),
  'Response generation time must never masquerade as business-data activity time.'
);

assert(
  !/supabase-bridge-state/.test(bridge),
  'Render Postgres runtime state must not be mislabeled as Supabase bridge state.'
);

assert(
  /fetchSystemSourceLabelsRequest/.test(commandCenter),
  'Command Center must fetch the source labels bridge endpoint.'
);

assert(
  /sourceConfidenceItems/.test(commandCenter) && /SourceConfidenceRail/.test(commandCenter),
  'Command Center must render a source confidence rail from bridge source labels.'
);

assert(
  /Endpoint health and data activity are checked separately/.test(commandCenter) &&
    /dataState/.test(commandCenter) &&
    /lastCheckedAt/.test(commandCenter) &&
    /fallbackReason/.test(commandCenter) &&
    !/\{item\.status \|\| 'unknown'\} \/ \{confidence\}/.test(commandCenter),
  'Command Center must present endpoint health and data activity separately instead of a misleading percentage.'
);

assert(
  /refreshSourceLabels/.test(commandCenter) &&
    /fetchSystemSourceLabelsRequest/.test(commandCenter) &&
    /setInterval\(\s*refreshSourceLabels,\s*30_000\s*\)/.test(commandCenter),
  'Command Center must refresh source truth on a fixed interval even when record counts do not change.'
);

assert(
  /endpoint="GET \/api\/system\/source-labels"/.test(commandCenter),
  'Command Center source rail must label GET /api/system/source-labels as its data source.'
);

assert(
  /GET \/api\/system\/source-labels/.test(sourceLabelsRow) &&
    /GET \/api\/health\/staleness/.test(sourceLabelsRow) &&
    /Ships/.test(sourceLabelsRow),
  'Data map must mark source health diagnostics as shipped through both supported endpoints.'
);

assert(
  !/Needs Mastra wiring/i.test(sourceLabelsRow),
  'Data map must not leave system confidence/source labels marked needs Mastra wiring.'
);

console.log('system-source-labels-bridge-smoke: ok');
