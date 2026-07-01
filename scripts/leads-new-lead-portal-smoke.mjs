import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const leads = read('src/app/routes/Leads.tsx');
const bridge = read('src/app/utils/runtimeBridge.ts');
const server = read('scripts/openclaw-local-server.mjs');
const app = read('src/app/App.tsx');
const topbar = read('src/app/shell/ShellTopbar.tsx');
const prefs = read('src/app/utils/uiPrefs.ts');
const css = read('src/styles/pbk-components.css');
const pkg = JSON.parse(read('package.json'));

assert(
  /export async function createLeadRequest/.test(bridge) && /path: '\/api\/leads'/.test(bridge),
  'runtimeBridge should expose createLeadRequest backed by POST /api/leads.'
);

assert(/type NewLeadFormState/.test(leads), 'Leads should define a dedicated new lead form state.');
assert(/New PBK lead/.test(leads), 'Leads should render the New PBK lead portal.');
assert(/createLeadRequest/.test(leads), 'Leads page should submit new leads through createLeadRequest.');
assert(
  /response\.leadImport/.test(leads),
  'Leads page must unwrap POST /api/leads leadImport responses before selecting or rendering the new lead.',
);
assert(
  /setLeadRoster\(\(current\) => upsertVisibleLead\(current, lead\)\)/.test(leads),
  'Newly created leads must be optimistically inserted into the visible roster before the bridge roster refresh returns.',
);
assert(
  !/catch \(nextError\) \{[\s\S]{0,180}setLeadRoster\(\[\]\);/.test(leads),
  'Lead roster refresh failures must not clear already visible or newly-created manual leads.'
);
assert(/seedNewLeadFromAnalyzer/.test(leads), 'New lead portal should seed from current analyzer state.');
assert(/ANALYZER_CURRENT_DEAL_KEY/.test(leads), 'New lead portal should read analyzer storage for deal/path sync.');
assert(/useSearchParams/.test(leads), 'Lead portal should support deep-linking from the analyzer with search params.');
assert(/searchParams\.get\('new'\) === '1'/.test(leads), 'Lead portal should open the new lead form when /leads?new=1 is loaded.');
assert(/searchParams\.get\('lead'\)/.test(leads), 'Lead portal should select a lead when /leads?lead=:id is loaded.');
assert(/source:\s*newLeadForm\.leadSource/.test(leads), 'New lead payload should preserve lead source.');
assert(/preferredChannel/.test(leads), 'New lead form should capture preferred channel.');
assert(/tcpaConsent/.test(leads) && /dncStatus/.test(leads), 'New lead form should capture compliance checks.');
assert(/assignedAgent/.test(leads), 'New lead form should capture assigned agent.');
assert(/sellerNotes/.test(leads) && /internalNotes/.test(leads), 'New lead form should preserve seller and internal notes.');
assert(/selected_path/.test(leads) && /callContext/.test(leads), 'New lead payload should include selected path and live call context.');
assert(/window\.dispatchEvent\(new CustomEvent\('pbk:lead-created'/.test(leads), 'Creating a lead should notify the shell/runtime listeners.');
assert(/PbkDataSource endpoint="POST \/api\/leads"/.test(leads), 'New lead portal should show its bridge endpoint source label.');
assert(
  /async function handleManualLeadCreate/.test(server),
  'OpenClaw bridge must expose a direct manual lead-create path instead of routing operator saves through generic intake.'
);
const postLeadsRouteStart = server.indexOf(
  "if (request.method === 'POST' && matchesPath(pathname, ['/api/leads', '/api/leads/import']))"
);
const postLeadsRouteEnd = server.indexOf(
  "if (request.method === 'POST' && pathname === '/api/appointments')",
  postLeadsRouteStart
);
assert(
  postLeadsRouteStart >= 0 && postLeadsRouteEnd > postLeadsRouteStart,
  'POST /api/leads route must be present.'
);
const postLeadsRoute = server.slice(postLeadsRouteStart, postLeadsRouteEnd);
assert(
  /handleManualLeadCreate/.test(postLeadsRoute) &&
    !/handleEvent\('lead-intake'/.test(postLeadsRoute),
  'Manual POST /api/leads must save immediately to bridge/Postgres and must not forward through lead-intake/n8n.'
);
assert(
  /const profilePersistence = \{\s*ok:\s*true,\s*queued:\s*true/.test(server) &&
    /void persistLeadProfileRowToDb\(savedLead, 'manual-lead-create'\)/.test(server),
  'Manual lead creation must not block the operator save on secondary lead-profile projection.'
);
[
  'const leadProfilePatch = plainRecord(payload.leadProfile || payload.lead_profile)',
  'const portalRecordPatch = plainRecord(payload.portalRecord || payload.portal_record)',
  'const contractsPatch = plainRecord(payload.contracts)',
  'const approvalsPatch = plainRecord(payload.approvals)',
  'const liveCallDetailsPatch = plainRecord(payload.liveCallDetails || payload.live_call_details)',
  'normalized.leadProfile = leadProfile',
  'normalized.lead_profile = leadProfile',
  'normalized.portalRecord = portalRecord',
  'normalized.portal_record = portalRecord',
  'normalized.contracts = contracts',
  'normalized.contractContext = contracts',
  'normalized.contract_context = contracts',
  'normalized.approvals = approvals',
  'normalized.approvalContext = approvals',
  'normalized.approval_context = approvals',
  'normalized.liveCallDetails = liveCallDetails',
  'normalized.live_call_details = liveCallDetails',
].forEach((expected) => {
  assert(
    server.includes(expected),
    `Lead save normalization must preserve rich seller profile packet: ${expected}`
  );
});
assert(
  /const leadProfile = \{[\s\S]*seller:\s*\{[\s\S]*\.\.\.normalized\.seller[\s\S]*property:\s*\{[\s\S]*\.\.\.normalized\.property[\s\S]*motivation:\s*\{[\s\S]*\.\.\.normalized\.motivation[\s\S]*compliance:\s*\{[\s\S]*\.\.\.normalized\.compliance[\s\S]*assignment:\s*\{[\s\S]*\.\.\.normalized\.assignment[\s\S]*\}/.test(server),
  'Lead save normalization must refresh the nested leadProfile from the canonical seller/property/motivation/compliance/assignment fields.'
);
assert(
  /const contracts = \{[\s\S]*sellerName:\s*normalized\.seller\.name[\s\S]*sellerEmail:\s*normalized\.seller\.email[\s\S]*sellerPhone:\s*normalized\.seller\.phone[\s\S]*propertyAddress:\s*normalized\.property\.address[\s\S]*readyForDraft:\s*Boolean\(normalized\.seller\.email && normalized\.property\.address\)/.test(server),
  'Lead save normalization must refresh contract readiness fields when seller/contact/property data changes.'
);
assert(
  /const approvals = \{[\s\S]*requiredForFirstOutbound:[\s\S]*normalized\.compliance\.tcpaConsent !== 'yes'[\s\S]*normalized\.compliance\.dncStatus !== 'clear'[\s\S]*compliance:\s*\{[\s\S]*\.\.\.normalized\.compliance/.test(server),
  'Lead save normalization must keep approval/compliance context aligned with the saved lead.'
);
assert(
  /const contractContext = plainRecord\(lead\.contractContext \|\| lead\.contract_context \|\| lead\.contracts\)/.test(server) &&
    /contractContext,[\s\S]*contract_context:\s*contractContext,[\s\S]*approvalContext,[\s\S]*approval_context:\s*approvalContext/.test(server),
  'Full lead detail must expose lead contract/approval context separately from related contract history arrays.'
);

assert(
  !/localStorage\.setItem\('pbk-dark-mode'/.test(app),
  'Deal Analyzer should not write legacy pbk-dark-mode and fight shell theme preferences.'
);
assert(
  /writeLegacyPbkDarkModePreference/.test(prefs) && /readLegacyPbkDarkModePreference/.test(prefs),
  'uiPrefs should centralize legacy dark-mode compatibility.'
);
assert(
  /pbk-shell-topbar-actions/.test(topbar) && /pbk-shell-account-compact/.test(topbar),
  'ShellTopbar should expose mobile-safe action and compact account wrappers.'
);
assert(
  /@media \(max-width: 520px\)[\s\S]*\.pbk-shell-topbar/.test(css) &&
    /grid-template-columns: minmax\(0, 1fr\) auto/.test(css),
  'PBK CSS should include narrow-mobile topbar grid rules.'
);
assert(
  /html\[data-theme='light'\] \.pbk-shell-topbar/.test(css) &&
    /html\[data-theme='dark'\] \.pbk-shell-topbar/.test(css),
  'PBK CSS should define explicit topbar colors for light and dark themes.'
);

assert(
  pkg.scripts?.['test:leads-new-lead-portal'] ===
    'node ./scripts/leads-new-lead-portal-smoke.mjs',
  'package.json should expose test:leads-new-lead-portal.'
);

console.log('[leads-new-lead-portal-smoke] ok');
