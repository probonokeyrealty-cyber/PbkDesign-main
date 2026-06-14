import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProductionGapLabelsReport } from './production-gap-labels.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const report = buildProductionGapLabelsReport({
  checkedAt: '2026-06-14T00:00:00.000Z',
  sourceLabels: [
    {
      id: 'runtime',
      label: 'Runtime snapshot',
      endpoint: 'GET /state',
      status: 'live',
      readiness: 'ready',
      source: 'render-postgres',
      dataState: 'fresh',
      recordCount: 3,
    },
    {
      id: 'campaigns',
      label: 'Campaigns',
      endpoint: 'GET /api/campaigns',
      status: 'live',
      readiness: 'ready',
      source: 'render-postgres',
      dataState: 'empty',
      recordCount: 0,
    },
  ],
  releaseStatus: {
    components: [
      {
        id: 'state-backend',
        label: 'State backend',
        ready: true,
        detail: 'postgres',
      },
      {
        id: 'netlify',
        label: 'Netlify production deploy',
        ready: false,
        configured: false,
        detail: 'Netlify env not exposed to bridge',
      },
    ],
  },
  toolingStatus: {
    commandIntentRouter: {
      ready: true,
      optional: false,
      note: 'deterministic router ready',
    },
    agentReach: {
      ready: false,
      optional: true,
      configured: true,
      status: 'not_installed',
      error: 'spawnSync agent-reach ENOENT',
    },
    voiceFallback: {
      ready: false,
      optional: true,
      configured: true,
      note: 'Do not mark live until audio round trip passes.',
    },
    summary: { readyCount: 1 },
  },
  runtimeMeta: {
    providers: {
      telnyx: { label: 'Telnyx phone/SMS', ready: true, status: 'up' },
      batchdata: {
        label: 'BatchData skip trace',
        ready: false,
        configured: false,
        optional: true,
        missing: ['PBK_BATCHDATA_API_KEY'],
        status: 'optional_missing',
      },
    },
  },
});

assert.equal(report.ok, true, 'Production gap report should be ok.');
assert.equal(report.summary.blocking, 0, 'Fixture should have no launch blockers.');
assert(report.gaps.some((gap) => gap.id === 'release-netlify'), 'Netlify metadata gap should be labeled.');
assert(report.gaps.some((gap) => gap.id === 'source-campaigns'), 'Live-but-empty campaign data should be labeled.');
assert(report.gaps.some((gap) => gap.id === 'tooling-agentreach'), 'Agent Reach not-live state should be labeled.');
assert(report.gaps.some((gap) => gap.id === 'tooling-voicefallback'), 'Voice fallback not-live state should be labeled.');
assert(report.gaps.some((gap) => gap.id === 'provider-batchdata'), 'BatchData optional provider gap should be labeled.');
assert(report.gaps.every((gap) => gap.detail), 'Every gap must carry an operator-facing detail.');
assert(report.gaps.every((gap) => gap.operatorAction), 'Every gap must carry an operator action.');

const bridge = readFileSync(path.join(ROOT, 'scripts', 'openclaw-local-server.mjs'), 'utf8');
const runtimeBridge = readFileSync(path.join(ROOT, 'src', 'app', 'utils', 'runtimeBridge.ts'), 'utf8');
const commandCenter = readFileSync(path.join(ROOT, 'src', 'app', 'routes', 'CommandCenter.tsx'), 'utf8');

assert(
  /buildProductionGapsSnapshot/.test(bridge) && /\/api\/production\/gaps/.test(bridge),
  'Bridge must expose GET /api/production/gaps.'
);
assert(
  /fetchProductionGapsRequest/.test(runtimeBridge) && /ProductionGapLabel/.test(runtimeBridge),
  'Runtime bridge client must expose the production gaps request and type.'
);
assert(
  /ProductionGapsRail/.test(commandCenter) && /GET \/api\/production\/gaps/.test(commandCenter),
  'Command Center must render the production gaps rail.'
);

console.log('production-gap-labels-smoke: ok');
