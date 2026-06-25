import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const leads = read('src/app/routes/Leads.tsx');
const pbkCss = read('src/styles/pbk-components.css');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:leads-prototype-modern"'),
  'package.json must expose test:leads-prototype-modern.'
);

[
  'LeadsHero',
  'LeadsSourceRail',
  'LeadsStatRibbon',
  'LeadsPipelineRail',
  'LeadsDetailShell',
].forEach((component) => {
  assert(leads.includes(component), `Leads should include ${component}.`);
});

[
  'pbk-leads-surface',
  'pbk-leads-hero',
  'pbk-leads-source-rail',
  'pbk-leads-grid',
  'pbk-leads-stat',
  'pbk-leads-layout',
  'pbk-leads-pipeline-rail',
  'pbk-leads-detail-shell',
].forEach((className) => {
  assert(leads.includes(className) || pbkCss.includes(`.${className}`), `${className} must exist.`);
});

[
  'GET /state',
  'GET /api/leads',
  'GET /api/leads/:id/full',
  'GET /api/leads/:id/last-call',
  'PATCH /api/leads/:id',
  'POST /invoke: telnyx_call',
  'POST /api/contract/send',
].forEach((endpoint) => {
  assert(leads.includes(endpoint), `Leads should surface data source ${endpoint}.`);
});

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/state"[\s\S]*snapshot fallback/.test(leads),
  'Leads must mark GET /state as the fallback lead snapshot source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/leads"[\s\S]*status="ships"/.test(leads),
  'Leads must mark GET /api/leads as the shipped full-roster source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/leads\/:id\/full"[\s\S]*status="ships"/.test(leads),
  'Leads must mark full lead detail as shipped.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="POST \/api\/contract\/send"[\s\S]*status="ships"/.test(leads),
  'Leads must mark contract send as shipped.'
);

assert(
  !/John Smith|Diane Kowalski|123 Main St|Approve Offer|UI-only|SAMPLE_LEADS|MOCK_LEADS/.test(leads),
  'Leads must not port prototype sample people, addresses, or mock labels.'
);
assert(
  /Human BANT\+ fields/.test(leads) &&
    /buildBantFromLeadForm/.test(leads) &&
    !/BANT\+ JSON|bantJsonError|validateBantJson/.test(leads),
  'Leads edit modal must expose human BANT+ fields instead of raw JSON.'
);

assert(
  runtimeBridge.includes('/api/leads/') &&
    runtimeBridge.includes('/api/contract/send') &&
    runtimeBridge.includes('telnyx_call') &&
    runtimeBridge.includes('planLeadNurtureRequest') &&
    runtimeBridge.includes('/api/lead/send-message'),
  'runtimeBridge must contain lead detail, contract, call, SMS, and nurture helpers.'
);
assert(
  leads.includes('startQuickLeadCall') &&
    leads.includes('openQuickSms') &&
    leads.includes('sendQuickSms') &&
    leads.includes('addLeadToNurture') &&
    leads.includes('leads_page_manual') &&
    leads.includes('manualSend: true') &&
    leads.includes('pbk-lead-quick-actions'),
  'Leads must expose direct manual Call, SMS, and Nurture quick actions with trusted bridge metadata.'
);
assert(
  leads.includes('Manual SMS') &&
    leads.includes('Send SMS') &&
    leads.includes('Ava will send this as a direct seller text'),
  'Lead SMS quick action must open an editable manual compose dialog with visible send behavior.'
);
assert(
  leads.includes('pbk-leads-roster-list') &&
    /aria-label="Seller roster results"/.test(leads) &&
    /aria-label=\{`Edit \$\{sellerName\}`\}/.test(leads) &&
    /openEditModalForLead\(lead\)/.test(leads),
  'Leads seller roster must keep entries in a fixed scroll region and expose direct mobile edit actions.'
);
assert(
  leads.includes('Add canonical phone') &&
    leads.includes('pbk-new-lead-modal-backdrop') &&
    leads.includes('pbk-new-lead-modal-footer') &&
    pbkCss.includes('.pbk-new-lead-modal-footer') &&
    pbkCss.includes('calc(16px + env(safe-area-inset-bottom))'),
  'Leads must expose a canonical phone repair action and keep new-lead submit controls tappable on mobile.'
);
assert(
  dataMap.includes('GET /api/leads/:id/full') &&
    dataMap.includes('POST /api/contract/send') &&
    dataMap.includes('GET /api/leads'),
  'Bridge data map must document Leads runtime sources and shipped full-roster endpoint.'
);

[
  '.pbk-leads-hero',
  '.pbk-leads-stat',
  '.pbk-leads-pipeline-rail',
  '.pbk-leads-detail-shell',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

const indexCss = read('src/styles/index.css');
assert(
  indexCss.includes('.pbk-lead-quick-actions') &&
    indexCss.includes('.pbk-lead-quick-actions.compact'),
  'Lead quick actions must have compact mobile and desktop list styling.'
);
assert(
  /@media \(max-width: 720px\)[\s\S]*\.pbk-leads-source-rail\s*{\s*display:\s*none;[\s\S]*\.pbk-leads-pipeline-rail \.pipeline-head \.pbk-data-source\s*{\s*display:\s*none;/.test(
    pbkCss
  ),
  'Mobile Leads should hide source-debug rails so Pipeline leads/Seller roster is not buried below setup metadata.'
);
assert(
  /@media \(max-width: 720px\)[\s\S]*\.lead-mobile-card\s*{[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\);[\s\S]*\.lead-mobile-card > span:last-child\s*{[\s\S]*grid-column:\s*1 \/ -1;/.test(
    indexCss
  ),
  'Mobile seller roster cards should give seller identity full width and move quick actions below the card body.'
);
assert(
  /@media \(max-width: 720px\)[\s\S]*\.leads-mobile-cards\s*{[\s\S]*padding-bottom:\s*calc\(96px \+ env\(safe-area-inset-bottom\)\);/.test(
    indexCss
  ),
  'Mobile seller roster should reserve bottom safe-area padding so the fixed nav does not cover card actions.'
);
assert(
  pbkCss.includes('.pbk-leads-roster-list') &&
    /pbk-leads-pipeline-rail[\s\S]*max-height:\s*min\(78vh, 780px\)/.test(pbkCss) &&
    /@media \(max-width: 720px\)[\s\S]*\.pbk-leads-pipeline-rail\s*{[\s\S]*max-height:\s*min\(62dvh, 560px\)/.test(
      pbkCss
    ),
  'Seller roster entries should scroll inside the fixed pipeline rail on desktop and mobile.'
);
assert(
  leads.includes('pbk-lead-edit-modal-backdrop') &&
    leads.includes('pbk-lead-edit-modal') &&
    leads.includes('pbk-lead-edit-modal-body') &&
    leads.includes('pbk-lead-edit-modal-footer') &&
    pbkCss.includes('.pbk-lead-edit-modal-footer'),
  'Lead edit modal must have mobile-safe classes so agents can edit and save on phones.'
);

console.log('leads-prototype-modern-smoke: ok');
