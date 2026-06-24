import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const campaigns = read('src/app/routes/Campaigns.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const bridge = read('scripts/openclaw-local-server.mjs');
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
  assert(
    campaigns.includes(className) || pbkCss.includes(`.${className}`),
    `${className} must be implemented.`
  );
});

assert(
  /const\s+\[viewMode,\s*setViewMode\]/.test(campaigns),
  'Campaigns should support card/table view mode.'
);
assert(
  /fetchReplyTemplatesRequest/.test(campaigns),
  'Campaign wizard template step must use the real reply-template endpoint helper.'
);
assert(
  /fetchCampaignRankedTemplatesRequest/.test(campaigns),
  'Campaign wizard template step must use the ranked campaign-template endpoint helper.'
);
assert(
  /matchMedia\('\(min-width: 561px\)'\)/.test(campaigns),
  'Campaign wizard should not close from accidental mobile backdrop taps.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/replies\/templates"[\s\S]*status="ships"/.test(
    campaigns
  ),
  'Campaign template step must mark GET /api/replies/templates as a shipped data source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/campaigns\/templates\/ranked"[\s\S]*status="ships"/.test(
    campaigns
  ),
  'Campaign template step must mark ranked campaign-template wiring as shipped.'
);
assert(
  !/SAMPLE_CAMPAIGNS|MOCK_CAMPAIGNS|probate-warmup-q2|absentee-akron-batch/.test(campaigns),
  'Campaigns page must not port prototype mock campaign rows.'
);

assert(
  /export\s+async\s+function\s+fetchReplyTemplatesRequest/.test(runtimeBridge),
  'runtimeBridge must expose fetchReplyTemplatesRequest.'
);
assert(
  /export\s+async\s+function\s+fetchCampaignRankedTemplatesRequest/.test(runtimeBridge),
  'runtimeBridge must expose fetchCampaignRankedTemplatesRequest.'
);
assert(
  /\/api\/replies\/templates/.test(runtimeBridge),
  'fetchReplyTemplatesRequest must target GET /api/replies/templates.'
);
assert(
  dataMap.includes('/api/replies/templates'),
  'Bridge data map must document the campaign wizard template source.'
);
assert(
  /export type CampaignsResponse[\s\S]*source\?: string[\s\S]*generatedAt\?: string[\s\S]*summary\?:/.test(
    runtimeBridge
  ),
  'Campaign responses must expose runtime source, refresh time, and explicit empty/live summary metadata.'
);
assert(
  /pathname === '\/api\/campaigns'[\s\S]*getRuntimeStateProvenance\(\)[\s\S]*fallbackReason[\s\S]*dataState: campaigns\.length \? 'populated' : 'empty'/.test(
    bridge
  ),
  'GET /api/campaigns must identify actual storage provenance and distinguish healthy-empty data.'
);
assert(
  /campaignRuntimeSource/.test(campaigns) &&
    /campaignRuntimeFallbackReason/.test(campaigns) &&
    /No campaigns yet/.test(campaigns) &&
    !/The Render Postgres campaign source is live/.test(campaigns),
  'Campaigns UI must present a source-aware empty state without claiming Postgres is live during fallback.'
);
assert(
  !/sortPerformanceRows\(Array\.from\(grouped\.values\(\)\)\)\.slice\(0,\s*5\)/.test(campaigns),
  'Campaign totals must aggregate all source rows before the UI limits visible rankings.'
);
assert(
  /fallbackSent[\s\S]*fallbackReplied \/ fallbackSent/.test(campaigns) &&
    /fallbackSent[\s\S]*fallbackConnected \/ fallbackSent/.test(campaigns),
  'Campaign reply and connect rates must use contacted leads rather than all loaded leads.'
);
assert(
  /function canRequestCampaignApproval\(campaign: CampaignRecord\)/.test(campaigns) &&
    /const canRequestApproval = canRequestCampaignApproval\(campaign\)/.test(campaigns) &&
    /const approvalAllowed = canRequestCampaignApproval\(campaign\)/.test(campaigns),
  'Campaign card and table approval controls must share one status/pending-action predicate.'
);
assert(
  /Campaign draft saved; approval still needed/.test(campaigns) &&
    /Use Request approval from its card after the approval board is reachable/.test(campaigns),
  'Campaign wizard must not tell users the save failed after a draft was created but approval queuing failed.'
);
assert(
  /Request operator approval for/.test(campaigns) &&
    /does not send outreach until it is approved/.test(campaigns),
  'Existing campaigns should confirm approval requests with non-technical provider-send copy.'
);
assert(
  /Request approval/.test(campaigns) &&
    /Request pause/.test(campaigns) &&
    /Request restart/.test(campaigns) &&
    !/Campaign resumed/.test(campaigns),
  'Campaign controls must use literal approval and hold labels instead of ambiguous launch/resume language.'
);
assert(
  /function canHoldCampaign/.test(campaigns) &&
    /function canCancelCampaign/.test(campaigns) &&
    /runCampaignActionRequest\(campaign\.id,\s*\{\s*action/s.test(campaigns),
  'Campaign hold/cancel controls must share eligibility predicates and route hold actions through the approval board.'
);
assert(
  /\/active\|running\/i\.test\(String\(campaign\.status \|\| ''\)\)/.test(campaigns) &&
    !/\/active\|running\|pending\/i\.test\(String\(campaign\.status \|\| ''\)\)/.test(campaigns),
  'Campaign summary must not double-count pending approval campaigns as active.'
);
assert(
  /leadSourcesFallback/.test(campaigns) &&
    /No live lead group is loaded yet/.test(campaigns) &&
    /Refresh lead groups/.test(campaigns),
  'Campaign wizard must explain the no-lead-source state before an agent can request approval.'
);
assert(
  /disabled=\{busyCampaignId === campaign\.id \|\| !approvalAllowed\}/.test(campaigns),
  'Campaign table Approval must be disabled for pending, active, approved, cancelled, or already-queued campaigns.'
);
assert(
  /const sentRows = rows\.filter\(\(row\) => row\.sent\)[\s\S]*repliedRows\.length \/ sentRows\.length[\s\S]*connectedRows\.length \/ sentRows\.length/.test(
    bridge
  ),
  'Bridge campaign rates must use sent/dialed rows as the denominator.'
);

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
  /@media \(max-width: 560px\)[\s\S]*\.pbk-wiz-modal input,[\s\S]*font-size:\s*16px/.test(pbkCss),
  'Campaign wizard mobile fields must use 16px text to avoid browser zoom while typing.'
);

console.log('campaigns-prototype-modern-smoke: ok');
