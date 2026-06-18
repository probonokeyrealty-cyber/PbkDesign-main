import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const layout = read('src/app/shell/ParadiseLayout.tsx');
const sidebar = read('src/app/shell/Sidebar.tsx');
const inbox = read('src/app/routes/Inbox.tsx');
const campaigns = read('src/app/routes/Campaigns.tsx');
const memory = read('src/app/routes/MemoryAnalytics.tsx');
const memoryLogic = read('src/app/routes/memoryAnalyticsRuntimeLogic.js');
const leads = read('src/app/routes/Leads.tsx');
const leadPortal = read('src/app/routes/LeadPortal.tsx');
const leadPortalHeader = read('src/app/components/leads/LeadPortalHeader.tsx');
const legacyShell = read('index.html');
const server = read('scripts/openclaw-local-server.mjs');
const css = read('src/styles/pbk-components.css');
const pkg = JSON.parse(read('package.json'));

assert(
  /export const SHELL_NAV_ITEMS/.test(sidebar),
  'Sidebar should export one canonical SHELL_NAV_ITEMS list for desktop and mobile navigation.'
);
assert(
  /function MobileShellNavigation/.test(sidebar),
  'Sidebar should provide MobileShellNavigation so mobile users can reach every shell page.'
);
assert(
  /<MobileShellNavigation[\s\S]*pendingApprovals=\{pendingApprovalCount\}/.test(layout),
  'ParadiseLayout should render the mobile shell navigation with the approval badge count.'
);
assert(
  /\.pbk-mobile-shell-nav/.test(css) && /max-width: 767px/.test(css),
  'PBK CSS should include mobile-only shell navigation rules.'
);

assert(
  /export async function archiveMessageRequest/.test(runtimeBridge),
  'runtimeBridge should expose archiveMessageRequest for Inbox archive persistence.'
);
assert(
  /export async function fetchCampaignRankedTemplatesRequest/.test(runtimeBridge),
  'runtimeBridge should expose fetchCampaignRankedTemplatesRequest for campaign-specific template ranking.'
);
assert(
  /export async function fetchMemoryEventsRequest/.test(runtimeBridge),
  'runtimeBridge should expose fetchMemoryEventsRequest for the memory event timeline.'
);

assert(
  /PATCH \/api\/messages\/:id\/archive/.test(server),
  'Bridge server should advertise/handle PATCH /api/messages/:id/archive.'
);
assert(
  /\/api\/campaigns\/templates\/ranked/.test(server),
  'Bridge server should handle GET /api/campaigns/templates/ranked.'
);
assert(
  /\/api\/memory\/events/.test(server),
  'Bridge server should handle GET /api/memory/events.'
);

assert(
  /archiveMessageRequest/.test(inbox) &&
    /endpoint="PATCH \/api\/messages\/:id\/archive"[\s\S]*status="ships"/.test(inbox),
  'Inbox should call archiveMessageRequest and mark archive persistence as shipped.'
);
assert(
  /onArchive=\{archiveMessage\}/.test(inbox),
  'Inbox message rows should receive an archive handler.'
);
assert(
  /fetchCampaignRankedTemplatesRequest/.test(campaigns) &&
    /endpoint="GET \/api\/campaigns\/templates\/ranked"[\s\S]*status="ships"/.test(campaigns),
  'Campaign wizard should use the ranked template endpoint and label it as shipped.'
);
assert(
  /fetchMemoryEventsRequest/.test(memory) &&
    /endpoint="GET \/api\/memory\/events"[\s\S]*status="ships"/.test(memory),
  'Memory Analytics should use memory events and label the endpoint as shipped.'
);
assert(
  /memoryEventsResponse/.test(memoryLogic),
  'Memory analytics runtime logic should normalize memoryEventsResponse into the view model.'
);

assert(
  /portalRecord/.test(leads) &&
    /leadProfile/.test(leads) &&
    /contracts/.test(leads) &&
    /analyzer/.test(leads),
  'New PBK lead payload should include a canonical portal record for Ava, Rex, approvals, analyzer, and contracts.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="POST \/api\/leads"[\s\S]*note="canonical seller portal"/.test(
    leads
  ),
  'Leads source rail should identify POST /api/leads as the canonical seller portal.'
);
assert(
  /Add phone/.test(leadPortalHeader) &&
    /onAddPhone=\{startEdit\}/.test(leadPortal) &&
    /lead\.phone\.replace\(\/\\D\/g, ''\)\.length >= 10/.test(leadPortalHeader),
  'Seller portal should expose a direct canonical phone repair action when the lead has no callable number.'
);

assert(
  /async function syncAnalyzerDealPathToLead/.test(legacyShell) &&
    /property: propertyPatch/.test(legacyShell) &&
    /callContext: callContextPatch/.test(legacyShell) &&
    /arv: arv \|\| undefined/.test(legacyShell) &&
    /mao: mao \|\| undefined/.test(legacyShell) &&
    /estimatedRepairs: estimatedRepairs \|\| undefined/.test(legacyShell),
  'Legacy analyzer sync should write ARV, MAO, repair math, and call context into the canonical lead portal.'
);

assert(
  pkg.scripts?.['test:mobile-wiring-lead-portal'] ===
    'node ./scripts/mobile-wiring-lead-portal-smoke.mjs',
  'package.json should expose test:mobile-wiring-lead-portal.'
);

console.log('[mobile-wiring-lead-portal-smoke] ok');
