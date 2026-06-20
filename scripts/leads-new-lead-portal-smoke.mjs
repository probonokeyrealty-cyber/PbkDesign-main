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
