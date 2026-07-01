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
const pathDeliverables = read('src/app/components/PathDeliverables.tsx');
const css = read('src/styles/pbk-components.css');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const leadsRoute = read('src/app/routes/Leads.tsx');
const bridgeServer = read('scripts/openclaw-local-server.mjs');
const pkg = JSON.parse(read('package.json'));

assert(
  /readPbkPrefs/.test(app) && /applyPbkTheme/.test(app),
  'Deal Analyzer should use the shared shell theme preference, not only pbk-dark-mode.'
);
assert(
  /pbk-deal-surface/.test(app),
  'Deal Analyzer root should opt into the modern PBK surface styles.'
);
assert(
  /DealAnalyzerCommandHeader/.test(app),
  'Deal Analyzer should render the modern command header.'
);
assert(/DealAnalyzerMobileRail/.test(app), 'Deal Analyzer should render the mobile action rail.');
assert(
  /<DealAnalyzerMobileRail[\s\S]*onSaveDeal=\{\(\) => void handleSaveDeal\(\)\}/.test(app),
  'Deal Analyzer mobile rail should expose Save so agents can edit and save on phones.'
);
assert(
  /setLeftPanelOpen\(true\)/.test(app),
  'Mobile rail should open the analyzer snapshot drawer.'
);
assert(
  /setRightPanelOpen\(true\)/.test(app),
  'Mobile rail should open the workflow/documents drawer.'
);
assert(
  /pbk-deal-content-with-mobile-rail/.test(app),
  'Scrollable analyzer content should reserve room for the mobile rail.'
);
assert(
  /handleCreateLeadFromAnalyzer/.test(app),
  'Deal Analyzer should expose a create-lead handoff from the current analyzer state.'
);
assert(
  /\/leads\?new=1/.test(app),
  'Analyzer create-lead handoff should route to the bridge-backed lead portal.'
);
assert(
  /patchLeadRequest/.test(app) && /actor: 'Deal Analyzer'/.test(app),
  'Analyzer runs should patch the attached lead with the latest underwriting numbers.'
);
assert(
  /isApprovalQueuedResponse/.test(app) &&
    /Analyzer snapshot queued for approval/.test(app) &&
    /Ava queued approval/.test(app),
  'Deal Analyzer send/save actions must distinguish queued approval from completed CRM/provider sync.'
);
assert(
  !/Analyzer snapshot sent to Ava and the runtime CRM queue|runtime CRM synced|Bridge sync pending/.test(
    app
  ),
  'Deal Analyzer should not claim a provider/CRM sync completed when the bridge only queued approval.'
);
assert(
  /Create or sync this lead before sending seller documents/.test(app),
  'Seller-doc emails should require a canonical bridge lead id before sending.'
);
assert(
  /const leadId = String\(activeDeal\.leadId \|\| ''\)\.trim\(\)/.test(app),
  'Seller-doc emails should use the real leadId without falling back to address.'
);
assert(
  /Add a valid seller email before sending/.test(app),
  'Seller-doc emails should block before sending when the seller email is missing.'
);
assert(
  /Ava could not finish the analysis\. Retry before opening Call Mode/.test(app),
  'Analyzer runtime failures should not unlock Call Mode.'
);
assert(
  !/Runtime sync failed, but the local analyzer is still ready/.test(app),
  'Analyzer should not claim local readiness after a failed runtime sync.'
);
assert(
  /isAnalyzed:\s*false/.test(app),
  'Analyzer runtime failure should leave the deal unanalyzed until sync succeeds.'
);
assert(
  /documentSet\?: Partial<Record<QuickDocumentType, string>>/.test(app),
  'Seller-doc email handler should accept edited document content.'
);
assert(
  /documentSet: documentSet \|\| generatedDocuments/.test(app),
  'Seller-doc email handler should prefer edited documents when provided.'
);
assert(
  /documentSet: editableDocuments/.test(pathDeliverables),
  'Path deliverables should send operator-edited document text to email delivery.'
);
assert(
  /pbk-analyzer-side-panel/.test(leftPanel),
  'Analyzer snapshot side panel should use modern side-panel styling.'
);
assert(
  /pbk-analyzer-workflow-panel/.test(rightPanel),
  'Analyzer workflow side panel should use modern workflow-panel styling.'
);

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
  /mergeMeaningfulAnalyzerValues/.test(dealView) && /isMeaningfulAnalyzerValue/.test(dealView),
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
    /Ava could not load this seller into Deal Analyzer/.test(dealView) &&
    /friendlyDealLoadError/.test(dealView) &&
    /hasDealLeadPayload/.test(dealView),
  'The lead-backed deal route should expose honest, agent-friendly loading and error states.'
);
assert(
  /response\.ok === false \|\| !hasDealLeadPayload\(response\)/.test(dealView) &&
    /The live seller record is not ready yet/.test(dealView),
  'The /deal/:id route must reject empty or malformed bridge payloads instead of hydrating a blank analyzer.'
);
assert(
  /Ava could not open the analyzer view/.test(dealView) &&
    !/this\.state\.error\.message/.test(dealView),
  'Deal route render failures must not expose raw technical exception text to agents.'
);
assert(
  !/Canonical lead loaded into analyzer|Pulling the canonical lead/.test(dealView),
  'Deal route loading and hydration copy should use seller-facing language, not internal canonical lead wording.'
);
assert(
  /if \(!leadId\)/.test(dealView) && /<App engineOnly \/>/.test(dealView),
  'The plain /deal route should continue to mount the analyzer without fetching a lead.'
);
assert(
  /readAnalyzerStorage/.test(leadsRoute) && !/JSON\.parse\(raw\)/.test(leadsRoute),
  'Lead portal analyzer seeding should use encoded analyzer storage instead of raw localStorage JSON.'
);

assert(
  /leadId: deal\.leadId/.test(runtimeBridge) &&
    /sellerEmail: deal\.sellerEmail/.test(runtimeBridge) &&
    /selectedPath/.test(runtimeBridge) &&
    /maoRBP: deal\.maoRBP/.test(runtimeBridge) &&
    /pathTerms/.test(runtimeBridge),
  'Analyzer bridge payload should include lead, seller, path, underwriting, and path-term context.'
);

assert(
  /syncAnalyzerRunToLeadProfile/.test(bridgeServer) &&
    /leadSynced/.test(bridgeServer) &&
    /lastAnalyzerRunId/.test(bridgeServer),
  'Bridge analyzeDeal should sync successful analyzer runs back to the matching lead profile.'
);
assert(
  /A valid seller email is required before sending seller documents/.test(bridgeServer) &&
    /getSenderAddress\(senderProfile, selectedFromEmail\)/.test(bridgeServer) &&
    /fromEmail: from/.test(bridgeServer),
  'Seller document delivery should validate recipient email and preserve the chosen sender address.'
);
assert(
  /latestAnalyzerRun/.test(bridgeServer) &&
    /analyzerAmount/.test(bridgeServer) &&
    /analyzerSnapshot/.test(bridgeServer),
  'Contract prep should inherit and persist the latest analyzer run when preparing paperwork.'
);

assert(/PbkDataSource/.test(analyzer), 'AnalyzerTab should show honest source labels.');
assert(
  /Ava deal analysis/.test(analyzer),
  'AnalyzerTab should name the agent-facing analysis source.'
);
assert(
  /live analysis with local underwriting formulas/.test(analyzer),
  'AnalyzerTab should name the local formula fallback without internal endpoint copy.'
);
assert(
  !/POST \/api|bridge sync|deterministic local fallback/.test(analyzer),
  'AnalyzerTab source labels must avoid internal endpoint/runtime wording.'
);
assert(
  /pbk-analyzer-card/.test(analyzer),
  'AnalyzerTab cards should use the modern analyzer card class.'
);
assert(
  /pbk-analyzer-hero/.test(analyzer),
  'AnalyzerTab should include a modern first-card hero treatment.'
);

assert(
  /Open analyzer snapshot/.test(chrome),
  'Command chrome should expose the snapshot drawer accessibly.'
);
assert(
  /Open analyzer workflow/.test(chrome),
  'Command chrome should expose the workflow drawer accessibly.'
);
assert(/Analyze deal/.test(chrome), 'Command chrome should expose analyzer CTA accessibly.');
assert(
  /analyzeStatus/.test(chrome) && /pbk-analyzer-mobile-status/.test(chrome),
  'Mobile analyzer rail must show Analyze feedback near the rail.'
);
assert(
  /aria-label=\{`Switch analyzer tab to/.test(chrome),
  'Command chrome tab controls should have contextual aria labels.'
);
assert(
  /getPathControlMetric/.test(chrome),
  'Command chrome should derive the top control number from the active path.'
);
assert(
  !/<span>MAO RBP<\/span>\s*<strong>\{formatCurrency\(deal\.maoRBP\)\}/.test(chrome),
  'Top deal metric must not be hard-coded to MAO RBP.'
);
assert(
  /pbk-analyzer-mobile-toggle/.test(chrome),
  'Command chrome should provide a compact mobile controls disclosure.'
);
assert(
  /pbk-analyzer-tab-shell/.test(chrome) && /data-open/.test(chrome),
  'Analyzer tabs should collapse behind a mobile-safe controls shell.'
);
assert(
  /onCreateLead/.test(chrome),
  'Command chrome should include a create-lead action wired by the engine.'
);

assert(/\.pbk-deal-surface/.test(css), 'PBK CSS should define the deal surface.');
assert(/\.pbk-analyzer-command/.test(css), 'PBK CSS should define analyzer command chrome.');
assert(/\.pbk-analyzer-mobile-rail/.test(css), 'PBK CSS should define the mobile rail.');
assert(
  /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(css),
  'Mobile analyzer rail should reserve room for Snapshot, Analyze, Save, Call, and Path controls.'
);
assert(
  /\.pbk-analyzer-mobile-status/.test(css),
  'PBK CSS should define the mobile analyzer feedback status.'
);
assert(
  /\.pbk-analyzer-mobile-toggle/.test(css),
  'PBK CSS should define the mobile controls toggle.'
);
assert(
  /\.pbk-analyzer-tab-shell\[data-open='false'\]/.test(css),
  'PBK CSS should collapse analyzer tabs on mobile by default.'
);
assert(
  /\.pbk-analyzer-ribbon \.pbk-data-source[\s\S]*grid-column: 1 \/ -1/.test(css),
  'Analyzer source label should span the ribbon instead of squeezing beside metrics.'
);
assert(/\.pbk-analyzer-side-panel/.test(css), 'PBK CSS should define analyzer side panel styles.');
assert(
  /\.pbk-analyzer-workflow-panel/.test(css),
  'PBK CSS should define analyzer workflow panel styles.'
);
assert(
  /html\[data-theme='light'\] \.pbk-deal-surface \.pbk-analyzer-side-panel \.text-gray-900/.test(
    css
  ),
  'Light theme side panel values should have explicit readable text colors.'
);
assert(
  /max-width: 720px/.test(css) && /pbk-analyzer-mobile-rail/.test(css),
  'PBK CSS should include mobile-specific analyzer rules.'
);
assert(
  /@media \(max-width: 720px\)[\s\S]*\.pbk-deal-surface \.pbk-analyzer-card input[\s\S]*font-size:\s*16px/.test(
    css
  ) &&
    /@media \(max-width: 720px\)[\s\S]*\.pbk-deal-surface \.pbk-doc-card select[\s\S]*font-size:\s*16px/.test(
      css
    ),
  'Mobile analyzer, call, and document inputs should use 16px text so agents can edit without viewport zoom.'
);
assert(
  /@media \(max-width: 720px\)[\s\S]*\.pbk-deal-surface :is\(input, select, textarea\)[\s\S]*font-size:\s*16px[\s\S]*line-height:\s*1\.25[\s\S]*touch-action:\s*manipulation/.test(
    css
  ),
  'Every mobile deal analyzer form control should keep the 16px no-zoom baseline.'
);
assert(
  /@media \(max-width: 720px\)[\s\S]*\.pbk-deal-surface :is\(input, select, textarea\):focus[\s\S]*scroll-margin-bottom:\s*calc\(env\(safe-area-inset-bottom\) \+ 120px\)/.test(
    css
  ),
  'Focused mobile deal analyzer fields should leave keyboard-safe scroll room.'
);

assert(
  pkg.scripts?.['test:deal-analyzer-modern-mobile'] ===
    'node ./scripts/deal-analyzer-modern-mobile-smoke.mjs',
  'package.json should expose test:deal-analyzer-modern-mobile.'
);

console.log('[deal-analyzer-modern-mobile-smoke] ok');
