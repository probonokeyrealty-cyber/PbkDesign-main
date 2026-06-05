import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const campaigns = read('src/app/routes/Campaigns.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const bridge = read('scripts/openclaw-local-server.mjs');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const drilldownRow =
  dataMap
    .split(/\r?\n/)
    .find((line) => line.includes('| Campaign analytics drilldown / premium campaign panels')) ||
  '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:campaign-drilldown-bridge"'),
  'package.json must expose test:campaign-drilldown-bridge.'
);

assert(
  /export type CampaignDrilldownResponse/.test(runtimeBridge),
  'runtimeBridge must type campaign drilldown responses.'
);

assert(
  /export async function fetchCampaignDrilldownRequest/.test(runtimeBridge) &&
    /path:\s*`\/api\/analytics\/campaign-drilldown\?/.test(runtimeBridge),
  'runtimeBridge must expose fetchCampaignDrilldownRequest for /api/analytics/campaign-drilldown.'
);

assert(
  /buildCampaignAnalyticsDrilldown/.test(bridge),
  'Bridge must build campaign analytics drilldown payloads.'
);

assert(
  /\/api\/analytics\/campaign-drilldown/.test(bridge),
  'Bridge must route GET /api/analytics/campaign-drilldown.'
);

assert(
  /fetchCampaignDrilldownRequest/.test(campaigns),
  'Campaigns page must fetch the campaign drilldown bridge endpoint.'
);

assert(
  /CampaignDrilldownPanel/.test(campaigns) && /drilldown/.test(campaigns),
  'Campaigns page must render a drilldown panel from bridge drilldown state.'
);

assert(
  /endpoint="GET \/api\/analytics\/campaign-drilldown"/.test(campaigns),
  'Campaign drilldown panel must label GET /api/analytics/campaign-drilldown as its data source.'
);

assert(
  /GET \/api\/analytics\/campaign-drilldown/.test(drilldownRow) && /Ships/.test(drilldownRow),
  'Data map must mark campaign analytics drilldown as shipped through GET /api/analytics/campaign-drilldown.'
);

assert(
  !/Needs Mastra wiring|Partial/i.test(drilldownRow),
  'Data map must not leave campaign analytics drilldown marked partial or needs Mastra wiring.'
);

console.log('campaign-drilldown-bridge-smoke: ok');
