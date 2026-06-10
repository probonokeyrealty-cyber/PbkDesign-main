import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

function read(file) {
  return readFileSync(resolve(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = read('src/app/App.tsx');
const dealView = read('src/app/routes/DealView.tsx');
const analyzer = read('src/app/components/AnalyzerTab.tsx');
const chrome = read('src/app/components/DealAnalyzerChrome.tsx');
const leftPanel = read('src/app/components/LeftPanel.tsx');
const rightPanel = read('src/app/components/RightPanel.tsx');
const css = read('src/styles/pbk-components.css');
const pkg = JSON.parse(read('package.json'));

assert(/readPbkPrefs/.test(app) && /applyPbkTheme/.test(app), 'Deal Analyzer should use the shared shell theme preference, not only pbk-dark-mode.');
assert(/pbk-deal-surface/.test(app), 'Deal Analyzer root should opt into the modern PBK surface styles.');
assert(/DealAnalyzerCommandHeader/.test(app), 'Deal Analyzer should render the modern command header.');
assert(/DealAnalyzerMobileRail/.test(app), 'Deal Analyzer should render the mobile action rail.');
assert(/setLeftPanelOpen\(true\)/.test(app), 'Mobile rail should open the analyzer snapshot drawer.');
assert(/setRightPanelOpen\(true\)/.test(app), 'Mobile rail should open the workflow/documents drawer.');
assert(/pbk-deal-content-with-mobile-rail/.test(app), 'Scrollable analyzer content should reserve room for the mobile rail.');
assert(/handleCreateLeadFromAnalyzer/.test(app), 'Deal Analyzer should expose a create-lead handoff from the current analyzer state.');
assert(/\/leads\?new=1/.test(app), 'Analyzer create-lead handoff should route to the bridge-backed lead portal.');
assert(/pbk-analyzer-side-panel/.test(leftPanel), 'Analyzer snapshot side panel should use modern side-panel styling.');
assert(/pbk-analyzer-workflow-panel/.test(rightPanel), 'Analyzer workflow side panel should use modern workflow-panel styling.');

assert(
  /useParams/.test(dealView) && /fetchLeadFullRequest\(leadId\)/.test(dealView),
  'The /deal/:id route should fetch the canonical lead before mounting the analyzer.'
);
assert(
  /buildAnalyzerDealFromLead/.test(dealView) &&
    /sellerName/.test(dealView) &&
    /estimatedRepairs/.test(dealView) &&
    /callContext/.test(dealView),
  'Lead hydration should map seller, property, underwriting, and call-context values into DealData.'
);
assert(
  /mergeMeaningfulAnalyzerValues/.test(dealView) &&
    /isMeaningfulAnalyzerValue/.test(dealView),
  'Lead hydration should preserve meaningful analyzer values when the canonical lead contains blanks.'
);
assert(
  /currentLeadId && currentLeadId === leadId[\s\S]*mergeMeaningfulAnalyzerValues\(\{\}, mappedDeal\)/.test(
    dealView
  ),
  'Lead hydration must not preserve analyzer values from a different seller.'
);
assert(
  /propertyTypeSource/.test(dealView) &&
    /selectedPathSource/.test(dealView) &&
    /isAnalyzed:\s*arv !== undefined \|\| mao !== undefined \|\| maoRBP !== undefined\s*\? true\s*:\s*undefined/.test(
      dealView
    ),
  'Lead hydration should not replace existing type, path, or analyzed state with guessed defaults.'
);
assert(
  /window\.PBKAnalyzer\?\.setState/.test(dealView) &&
    /writeAnalyzerStorage/.test(dealView) &&
    /ANALYZER_CURRENT_DEAL_KEY/.test(dealView),
  'Lead hydration should use PBKAnalyzer.setState when available and the established analyzer storage fallback otherwise.'
);
assert(
  /Loading seller deal/.test(dealView) &&
    /Could not load this lead into the Deal Analyzer/.test(dealView),
  'The lead-backed deal route should expose honest loading and error states.'
);
assert(
  /if \(!leadId\)/.test(dealView) && /<App engineOnly \/>/.test(dealView),
  'The plain /deal route should continue to mount the analyzer without fetching a lead.'
);

assert(/PbkDataSource/.test(analyzer), 'AnalyzerTab should show honest source labels.');
assert(/POST \/api\/analyzeDeal/.test(analyzer), 'AnalyzerTab should name the bridge analysis endpoint.');
assert(/local analyzer formulas/.test(analyzer), 'AnalyzerTab should name the local formula fallback.');
assert(/pbk-analyzer-card/.test(analyzer), 'AnalyzerTab cards should use the modern analyzer card class.');
assert(/pbk-analyzer-hero/.test(analyzer), 'AnalyzerTab should include a modern first-card hero treatment.');

assert(/Open analyzer snapshot/.test(chrome), 'Command chrome should expose the snapshot drawer accessibly.');
assert(/Open analyzer workflow/.test(chrome), 'Command chrome should expose the workflow drawer accessibly.');
assert(/Analyze deal/.test(chrome), 'Command chrome should expose analyzer CTA accessibly.');
assert(/aria-label=\{`Switch analyzer tab to/.test(chrome), 'Command chrome tab controls should have contextual aria labels.');
assert(/getPathControlMetric/.test(chrome), 'Command chrome should derive the top control number from the active path.');
assert(!/<span>MAO RBP<\/span>\s*<strong>\{formatCurrency\(deal\.maoRBP\)\}/.test(chrome), 'Top deal metric must not be hard-coded to MAO RBP.');
assert(/pbk-analyzer-mobile-toggle/.test(chrome), 'Command chrome should provide a compact mobile controls disclosure.');
assert(/pbk-analyzer-tab-shell/.test(chrome) && /data-open/.test(chrome), 'Analyzer tabs should collapse behind a mobile-safe controls shell.');
assert(/onCreateLead/.test(chrome), 'Command chrome should include a create-lead action wired by the engine.');

assert(/\.pbk-deal-surface/.test(css), 'PBK CSS should define the deal surface.');
assert(/\.pbk-analyzer-command/.test(css), 'PBK CSS should define analyzer command chrome.');
assert(/\.pbk-analyzer-mobile-rail/.test(css), 'PBK CSS should define the mobile rail.');
assert(/\.pbk-analyzer-mobile-toggle/.test(css), 'PBK CSS should define the mobile controls toggle.');
assert(/\.pbk-analyzer-tab-shell\[data-open='false'\]/.test(css), 'PBK CSS should collapse analyzer tabs on mobile by default.');
assert(/\.pbk-analyzer-ribbon \.pbk-data-source[\s\S]*grid-column: 1 \/ -1/.test(css), 'Analyzer source label should span the ribbon instead of squeezing beside metrics.');
assert(/\.pbk-analyzer-side-panel/.test(css), 'PBK CSS should define analyzer side panel styles.');
assert(/\.pbk-analyzer-workflow-panel/.test(css), 'PBK CSS should define analyzer workflow panel styles.');
assert(/html\[data-theme='light'\] \.pbk-deal-surface \.pbk-analyzer-side-panel \.text-gray-900/.test(css), 'Light theme side panel values should have explicit readable text colors.');
assert(/max-width: 720px/.test(css) && /pbk-analyzer-mobile-rail/.test(css), 'PBK CSS should include mobile-specific analyzer rules.');

assert(
  pkg.scripts?.['test:deal-analyzer-modern-mobile'] ===
    'node ./scripts/deal-analyzer-modern-mobile-smoke.mjs',
  'package.json should expose test:deal-analyzer-modern-mobile.'
);

console.log('[deal-analyzer-modern-mobile-smoke] ok');
