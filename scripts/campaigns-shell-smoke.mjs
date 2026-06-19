import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const router = readFileSync(resolve(root, 'src/app/shell/router.tsx'), 'utf8');
const sidebar = readFileSync(resolve(root, 'src/app/shell/Sidebar.tsx'), 'utf8');
const layout = readFileSync(resolve(root, 'src/app/shell/ParadiseLayout.tsx'), 'utf8');
const runtimeBridge = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');
const campaigns = readFileSync(resolve(root, 'src/app/routes/Campaigns.tsx'), 'utf8');
const styles = readFileSync(resolve(root, 'src/styles/pbk-components.css'), 'utf8');
const dataMap = readFileSync(resolve(root, 'docs/modern-shell-bridge-data-map.md'), 'utf8');
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(packageJson.scripts?.['test:campaigns-shell'], 'package.json must expose test:campaigns-shell.');
assert(/import\('\.\.\/routes\/Campaigns'\)/.test(router), 'Router must lazy-load the Campaigns route.');
assert(/\{\s*path:\s*'campaigns'/.test(router), 'Router must expose /campaigns.');
assert(/\/campaigns/.test(sidebar) && /Campaigns/.test(sidebar), 'Sidebar must include Campaigns navigation.');
assert(/'\/campaigns'/.test(layout), 'ParadiseLayout saved-route validation must allow /campaigns.');

[
  'fetchCampaignsRequest',
  'fetchCampaignLeadSourcesRequest',
  'fetchSenderIdentitiesRequest',
  'syncSenderIdentitiesRequest',
  'createCampaignRequest',
  'patchCampaignRequest',
  'requestCampaignApprovalRequest',
  'runCampaignActionRequest',
  'recordCampaignEventRequest',
].forEach((helper) => {
  assert(new RegExp(`export\\s+async\\s+function\\s+${helper}`).test(runtimeBridge), `${helper} must exist in runtimeBridge.ts.`);
});

[
  '/api/campaigns',
  '/api/campaigns/lead-sources',
  '/api/campaigns/:campaignId/approval',
  '/api/campaigns/:campaignId/actions',
  '/api/campaigns/:campaignId/events',
].forEach((endpoint) => {
  assert(dataMap.includes(endpoint), `Bridge data map must document ${endpoint}.`);
});

assert(/CAMPAIGN_WIZARD_DRAFT_KEY/.test(campaigns), 'Campaign wizard must autosave draft state.');
assert(/fetchCampaignsRequest/.test(campaigns), 'Campaigns page must read live campaign data from the bridge.');
assert(/createCampaignRequest/.test(campaigns), 'Campaign wizard must create campaigns through the bridge.');
assert(
  /SenderIdentitySelect/.test(campaigns) &&
    /campaignSenderQuery/.test(campaigns) &&
    /senderIdentityId/.test(campaigns) &&
    /fetchSenderIdentitiesRequest/.test(campaigns) &&
    /syncSenderIdentitiesRequest/.test(campaigns),
  'Campaign wizard must expose connected Telnyx/Instantly sender identity selection.'
);
assert(
  /buildCampaignPayload\(\s*draft:\s*CampaignWizardDraft,\s*selectedSender:\s*CommunicationSenderIdentity \| null/.test(
    campaigns
  ) &&
    /providerConfig/.test(campaigns) &&
    /selectedFromNumber/.test(campaigns) &&
    /fromEmail/.test(campaigns),
  'Campaign save payload must carry selected sender identity, Telnyx number, or Instantly email.'
);
assert(
  campaigns.includes('name="campaignsSearch"') &&
    campaigns.includes('name="campaignsStatusFilter"') &&
    campaigns.includes('name="campaignTemplateId"') &&
    campaigns.includes('name="campaignFirstMessage"') &&
    campaigns.includes('name="campaignFollowUpMessage"') &&
    campaigns.includes('name="campaignName"') &&
    campaigns.includes('name="campaignScheduledFor"') &&
    campaigns.includes('name="campaignDailyCap"') &&
    campaigns.includes('name="campaignOperatorNotes"'),
  'Campaigns toolbar and wizard controls must have stable browser field names.'
);
assert(
  campaigns.includes('htmlFor="campaign-template-id"') &&
    campaigns.includes('htmlFor="campaign-first-message"') &&
    campaigns.includes('htmlFor="campaign-follow-up-message"'),
  'Campaign wizard PbkField labels must connect to their inputs.'
);
assert(/requestCampaignApprovalRequest/.test(campaigns), 'Campaign launch must request bridge approval.');
assert(
  /const closeWizard = useCallback\(\(\) => setWizardOpen\(false\), \[\]\)/.test(campaigns) &&
    /onClose=\{closeWizard\}/.test(campaigns),
  'Campaign wizard close behavior must stay referentially stable while the draft changes.'
);
assert(
  /event\.target === event\.currentTarget/.test(campaigns),
  'Campaign wizard backdrop must close only on a deliberate backdrop press.'
);
assert(!/SAMPLE_CAMPAIGNS|MOCK_CAMPAIGNS|Diane Kowalski|Marco Hill|Lena Brooks/.test(campaigns), 'Campaigns page must not ship hardcoded seller/campaign mock data.');
assert(
  /@media \(max-width: 560px\)[\s\S]*?\.pbk-wiz-foot \.nav-btns[\s\S]*?grid-template-columns:\s*repeat\(3[\s\S]*?min-height: 44px/.test(
    styles
  ),
  'Campaign wizard actions must stay fully visible and touch-sized on narrow mobile screens.'
);
assert(
  styles.includes('.pbk-campaign-sender-panel') &&
    /@media \(max-width: 900px\)[\s\S]*?\.pbk-campaign-sender-panel[\s\S]*?grid-template-columns:\s*1fr/.test(
      styles
    ),
  'Campaign sender selector must compact cleanly on tablet and mobile viewports.'
);
assert(
  /function getCampaignProviderConfig\([\s\S]*senderIdentityId[\s\S]*safeSenderIdentity/.test(
    bridge
  ) &&
    /senderIdentityId:\s*providerConfig\.senderIdentityId/.test(bridge) &&
    /executeToolHandlerWithQa\('telnyx_sms'[\s\S]*senderIdentityId:\s*providerConfig\.senderIdentityId/.test(
      bridge
    ) &&
    /executeToolHandlerWithQa\('sendColdEmail'[\s\S]*senderIdentityId:\s*providerConfig\.senderIdentityId/.test(
      bridge
    ),
  'Bridge campaign records and worker sends must preserve the selected sender identity.'
);

console.log('campaigns-shell-smoke: ok');
