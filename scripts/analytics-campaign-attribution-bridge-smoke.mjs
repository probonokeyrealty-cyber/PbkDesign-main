import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const analytics = read('src/app/routes/Analytics.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const bridge = read('scripts/openclaw-local-server.mjs');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const analyticsRows = dataMap
  .split(/\r?\n/)
  .filter((line) => /\| Campaign attribution|\| Funnel cards|\| Daily deals/.test(line));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:analytics-campaign-attribution-bridge"'),
  'package.json must expose test:analytics-campaign-attribution-bridge.'
);

assert(
  /export async function fetchCampaignDrilldownRequest/.test(runtimeBridge) &&
    /\/api\/analytics\/campaign-drilldown/.test(runtimeBridge),
  'runtimeBridge must expose fetchCampaignDrilldownRequest for campaign attribution.'
);

assert(
  /buildCampaignAnalyticsDrilldown/.test(bridge) &&
    /\/api\/analytics\/campaign-drilldown/.test(bridge),
  'Bridge must route GET /api/analytics/campaign-drilldown.'
);

assert(
  /fetchCampaignDrilldownRequest/.test(analytics),
  'Analytics must fetch the campaign drilldown endpoint.'
);

assert(
  /CampaignAttributionPanel/.test(analytics) && /campaignAttribution/.test(analytics),
  'Analytics must render a CampaignAttributionPanel from campaign attribution state.'
);

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/analytics\/campaign-drilldown"[\s\S]*status="ships"/.test(
    analytics
  ),
  'Analytics campaign attribution must mark GET /api/analytics/campaign-drilldown as shipped.'
);

assert(
  !/Premium panels stay disabled until Mastra owns|needs a\s+canonical campaign drill-down endpoint|status="needs-wiring"[\s\S]*campaign-drilldown/i.test(
    analytics
  ),
  'Analytics must not keep campaign attribution as disabled needs-wiring copy.'
);

assert(
  analyticsRows.some(
    (line) =>
      line.includes('| Campaign attribution') &&
      line.includes('fetchCampaignDrilldownRequest()') &&
      line.includes('GET /api/analytics/campaign-drilldown') &&
      line.includes('Ships')
  ),
  'Data map must document Analytics campaign attribution as shipped through fetchCampaignDrilldownRequest().'
);

console.log('analytics-campaign-attribution-bridge-smoke: ok');
