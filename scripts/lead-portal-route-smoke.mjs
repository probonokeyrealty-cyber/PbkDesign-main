import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const files = [
  'src/app/routes/LeadPortal.tsx',
  'src/app/components/leads/LeadPortalHeader.tsx',
  'src/app/components/leads/LeadPortalOverview.tsx',
  'src/app/components/leads/LeadPortalContactability.tsx',
  'src/app/components/leads/LeadPortalProperty.tsx',
  'src/app/components/leads/LeadPortalDealContext.tsx',
  'src/app/components/leads/LeadPortalTimeline.tsx',
];

for (const file of files) {
  assert(existsSync(resolve(root, file)), `${file} must exist.`);
}

const portal = read('src/app/routes/LeadPortal.tsx');
const components = files.slice(1).map(read).join('\n');
const router = read('src/app/shell/router.tsx');
const leads = read('src/app/routes/Leads.tsx');
const topbar = read('src/app/shell/ShellTopbar.tsx');
const unifiedInbox = read('src/app/routes/UnifiedInbox.tsx');
const inspector = read('src/app/components/inbox/LeadContextInspector.tsx');
const bridge = read('src/app/utils/runtimeBridge.ts');
const server = read('scripts/openclaw-local-server.mjs');
const store = read('scripts/conversation-store.mjs');
const css = read('src/styles/pbk-components.css');
const netlify = read('netlify.toml');
const pkg = JSON.parse(read('package.json'));
const combined = `${portal}\n${components}`;

assert(
  /const LeadPortal = lazy\(/.test(router) &&
    /path:\s*['"]leads\/:leadId['"]/.test(router),
  'Router must lazy-load the canonical /leads/:leadId route.'
);

for (const endpoint of [
  'GET /api/leads/:id/full',
  'GET /api/conversations?leadId=:leadId',
  'GET /api/conversations/:threadId/timeline',
]) {
  assert(combined.includes(endpoint), `Lead portal must identify ${endpoint}.`);
}

for (const helper of [
  'fetchLeadFullRequest',
  'fetchConversationsRequest',
  'fetchConversationTimelineRequest',
  'patchLeadRequest',
  'deleteLeadRequest',
  'startLeadCallRequest',
  'sendLeadContractRequest',
  'saveLeadNoteRequest',
]) {
  assert(portal.includes(helper), `Lead portal must use ${helper}.`);
}
assert(
  components.includes('Delete lead') &&
    portal.includes("confirmAction === 'delete'") &&
    /method:\s*'DELETE'[\s\S]*?\/api\/leads\//.test(bridge),
  'Lead Portal must expose a confirmed bridge-backed delete action.'
);
assert(
  portal.includes('BANT+ call context') &&
    read('src/app/components/leads/leadPortalModel.ts').includes('buildLeadPortalPatch') &&
    read('src/app/components/leads/leadPortalModel.ts').includes('call_metadata') &&
    !/BANT\+ JSON|bantJsonError|validateBantJson/.test(portal),
  'Lead Portal edit modal must expose human BANT+ fields and persist them through the canonical patch.'
);
assert(
  /useSearchParams/.test(portal) &&
    /searchParams\.get\('edit'\) !== '1'/.test(portal) &&
    /setEditOpen\(true\)/.test(portal),
  'Lead Portal should support a one-click ?edit=1 handoff into the canonical edit dialog.'
);
assert(
  /pbk-lead-portal :where\(h1, h2, p, strong, span\)[\s\S]*overflow-wrap:\s*break-word[\s\S]*word-break:\s*normal/.test(
    read('src/styles/pbk-components.css')
  ),
  'Lead Portal text should wrap naturally without breaking words.'
);

assert(
  /leadId\?: string/.test(bridge) &&
    /\['leadId', leadId\]/.test(bridge),
  'Conversation runtime helper must support an exact leadId filter.'
);
assert(
  /leadId:\s*url\.searchParams\.get\('leadId'\)/.test(server),
  'Conversation route must pass leadId to the store.'
);
assert(
  /filters\.leadId/.test(store) && /t\.lead_id/.test(store),
  'Conversation store must filter directly by t.lead_id.'
);
assert(
  portal.includes('canonicalLeadId') &&
    /navigate\(`\/leads\/\$\{encodeURIComponent\(canonicalLeadId\)\}`/.test(portal),
  'Alias lead URLs must normalize before resolving the canonical conversation thread.'
);
assert(
  portal.includes('toolResult') &&
    portal.includes('providerLive') &&
    portal.includes('Call staged; provider not live'),
  'Call feedback must inspect the nested /invoke result and distinguish simulated calls.'
);
assert(
  portal.includes('timelineProjected') &&
    server.includes('projectionResult'),
  'Lead-note feedback must expose conversation projection degradation.'
);
assert(
  server.includes('existingNotesRecord') &&
    server.includes('nextLead.motivation') &&
    server.includes('nextLead.compliance') &&
    server.includes('nextLead.assignment') &&
    server.includes('syncLeadCompatibilityAliases(nextLead)'),
  'Lead PATCH must preserve nested seller metadata while applying edits.'
);
assert(
  server.includes('function syncLeadCompatibilityAliases') &&
    /firstText\(assignment\.assignedAgent,\s*ava\.assignedAgent,\s*lead\.assignedAgent\)/.test(
      read('src/app/components/leads/leadPortalModel.ts')
    ),
  'Canonical nested values must refresh and outrank legacy top-level lead aliases.'
);
assert(
  topbar.includes('/inbox/conversations?thread=') &&
    topbar.includes('/inbox/conversations?lead=') &&
    unifiedInbox.includes('requestedLeadId') &&
    unifiedInbox.includes('leadThreadResolveSequence'),
  'Message search results must resolve into the canonical unified inbox.'
);

assert(
  /navigate\(`\/leads\/\$\{encodeURIComponent\(requestedLeadId\)\}`/.test(leads),
  'Legacy /leads?lead=:id links must normalize to /leads/:leadId.'
);
assert(
  !/\/leads\?lead=\$\{encodeURIComponent/.test(`${topbar}\n${inspector}`),
  'Shell search and lead inspector must use canonical lead routes.'
);

for (const copy of [
  'Seller workspace',
  'Contactability',
  'Property',
  'Deal context',
  'Ava pre-call brief',
  'Unified seller timeline',
]) {
  assert(combined.includes(copy), `Lead portal must render "${copy}".`);
}

assert(
  !/Diane Kowalski|Marco Hill|John Smith|202 Cherry Ln|seller@example\.com/.test(combined),
  'Canonical lead portal must not contain sample seller or property data.'
);
assert(
  css.includes('.pbk-lead-portal') &&
    css.includes('@media (max-width: 760px)') &&
    css.includes('.pbk-lead-portal-actions'),
  'Lead portal must include responsive PBK styles.'
);
assert(
  /from\s*=\s*["']\/leads\/\*["'][\s\S]*?to\s*=\s*["']\/index\.shell\.html["']/.test(
    netlify
  ),
  'Netlify must route canonical lead portal URLs to the modern shell.'
);
assert(
  pkg.scripts?.['test:lead-portal-route'] ===
    'node ./scripts/lead-portal-route-smoke.mjs',
  'package.json must expose test:lead-portal-route.'
);

console.log('[lead-portal-route-smoke] ok');
