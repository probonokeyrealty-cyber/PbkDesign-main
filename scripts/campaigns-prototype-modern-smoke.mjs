import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const campaigns = read('src/app/routes/Campaigns.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:campaigns-prototype-modern"'),
  'package.json must expose test:campaigns-prototype-modern.'
);

[
  'CampaignHero',
  'CampaignChannelFilter',
  'CampaignsTableView',
  'CampaignWizardStepper',
  'CampaignWizardPane',
].forEach((component) => {
  assert(campaigns.includes(component), `Campaigns page should include ${component}.`);
});

[
  'pbk-campaign-surface',
  'pbk-campaign-hero',
  'pbk-camp-toolbar',
  'pbk-camp-channel-chip',
  'pbk-camp-card',
  'pbk-camp-table',
  'pbk-wiz-stepper',
  'pbk-wiz-pane',
].forEach((className) => {
  assert(campaigns.includes(className) || pbkCss.includes(`.${className}`), `${className} must be implemented.`);
});

assert(/const\s+\[viewMode,\s*setViewMode\]/.test(campaigns), 'Campaigns should support card/table view mode.');
assert(/fetchReplyTemplatesRequest/.test(campaigns), 'Campaign wizard template step must use the real reply-template endpoint helper.');
assert(/fetchCampaignRankedTemplatesRequest/.test(campaigns), 'Campaign wizard template step must use the ranked campaign-template endpoint helper.');
assert(
  /matchMedia\('\(min-width: 561px\)'\)/.test(campaigns),
  'Campaign wizard should not close from accidental mobile backdrop taps.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/replies\/templates"[\s\S]*status="ships"/.test(campaigns),
  'Campaign template step must mark GET /api/replies/templates as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/campaigns\/templates\/ranked"[\s\S]*status="ships"/.test(campaigns),
  'Campaign template step must mark ranked campaign-template wiring as shipped.'
);
assert(!/SAMPLE_CAMPAIGNS|MOCK_CAMPAIGNS|probate-warmup-q2|absentee-akron-batch/.test(campaigns), 'Campaigns page must not port prototype mock campaign rows.');

assert(/export\s+async\s+function\s+fetchReplyTemplatesRequest/.test(runtimeBridge), 'runtimeBridge must expose fetchReplyTemplatesRequest.');
assert(/export\s+async\s+function\s+fetchCampaignRankedTemplatesRequest/.test(runtimeBridge), 'runtimeBridge must expose fetchCampaignRankedTemplatesRequest.');
assert(/\/api\/replies\/templates/.test(runtimeBridge), 'fetchReplyTemplatesRequest must target GET /api/replies/templates.');
assert(dataMap.includes('/api/replies/templates'), 'Bridge data map must document the campaign wizard template source.');

[
  '.pbk-campaign-hero',
  '.pbk-camp-card',
  '.pbk-camp-channel-badge',
  '.pbk-camp-progress',
  '.pbk-wiz-stepper',
  '.pbk-wiz-pane',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

assert(
  /@media \(max-width: 560px\)[\s\S]*\.pbk-wiz-foot\s*\{[\s\S]*position:\s*sticky[\s\S]*bottom:\s*0/.test(
    pbkCss
  ),
  'Campaign wizard mobile footer must stay reachable at the bottom.'
);
assert(
  /@media \(max-width: 560px\)[\s\S]*\.pbk-wiz-modal input,[\s\S]*font-size:\s*16px/.test(
    pbkCss
  ),
  'Campaign wizard mobile fields must use 16px text to avoid browser zoom while typing.'
);

console.log('campaigns-prototype-modern-smoke: ok');
