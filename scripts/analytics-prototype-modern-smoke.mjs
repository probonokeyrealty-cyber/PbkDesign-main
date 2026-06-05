import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const analytics = read('src/app/routes/Analytics.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:analytics-prototype-modern"'),
  'package.json must expose test:analytics-prototype-modern.'
);

[
  'AnalyticsHero',
  'AnalyticsSourceRail',
  'AnalyticsStatRibbon',
  'AnalyticsFunnelStep',
  'AnalyticsDailyBar',
  'AnalyticsMetricTile',
].forEach((component) => {
  assert(analytics.includes(component), `Analytics should include ${component}.`);
});

[
  'pbk-analytics-surface',
  'pbk-analytics-hero',
  'pbk-analytics-source-rail',
  'pbk-analytics-grid',
  'pbk-analytics-stat',
  'pbk-analytics-body',
  'pbk-analytics-card',
  'pbk-analytics-funnel',
  'pbk-analytics-funnel-step',
  'pbk-analytics-daily-bars',
  'pbk-analytics-metric',
].forEach((className) => {
  assert(
    analytics.includes(className) || pbkCss.includes(`.${className}`),
    `${className} must be implemented.`
  );
});

[
  'GET /api/leads/stages',
  'GET /api/deals/timeline',
  'GET /api/observability/ai-metrics',
  'GET /api/analytics/campaign-drilldown',
].forEach((endpoint) => {
  assert(analytics.includes(endpoint), `Analytics should surface data source ${endpoint}.`);
});

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/leads\/stages"[\s\S]*status="ships"/.test(
    analytics
  ),
  'Analytics must mark GET /api/leads/stages as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/deals\/timeline"[\s\S]*status="ships"/.test(
    analytics
  ),
  'Analytics must mark GET /api/deals/timeline as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/observability\/ai-metrics"[\s\S]*status="ships"/.test(
    analytics
  ),
  'Analytics must mark GET /api/observability/ai-metrics as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/analytics\/campaign-drilldown"[\s\S]*status="ships"/.test(
    analytics
  ),
  'Analytics must mark premium campaign drill-down analytics as a shipped data source.'
);

assert(
  !/1,247|\$260|Diane Kowalski|SAMPLE_LEADS|UI-only|124x|124×/.test(analytics),
  'Analytics must not port prototype sample values or UI-only copy.'
);

assert(
  runtimeBridge.includes('/api/leads/stages') &&
    runtimeBridge.includes('/api/deals/timeline') &&
    runtimeBridge.includes('/api/observability/ai-metrics'),
  'runtimeBridge must contain the Analytics endpoint helpers.'
);
assert(
  dataMap.includes('/api/leads/stages') &&
    dataMap.includes('/api/deals/timeline') &&
    dataMap.includes('/api/observability/ai-metrics'),
  'Bridge data map must document Analytics runtime sources.'
);

[
  '.pbk-analytics-hero',
  '.pbk-analytics-card',
  '.pbk-analytics-funnel-step',
  '.pbk-analytics-daily-bars',
  '.pbk-analytics-metric',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

console.log('analytics-prototype-modern-smoke: ok');
