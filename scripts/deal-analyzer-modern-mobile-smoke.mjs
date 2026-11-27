import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import strictAssert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { savedLeadComps } from '../src/app/utils/leadComps.mjs';
import { latestCallModeNote } from '../src/app/utils/analyzerLeadPersistence.mjs';
import { samePropertyAddress } from '../src/app/utils/analyzerIntelligence.mjs';

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
const evidenceSource = read('src/app/utils/propertyEvidence.ts').replace(
  "'./attomRecordFields.mjs'",
  JSON.stringify(new URL('../src/app/utils/attomRecordFields.mjs', import.meta.url).href),
).replace(
  "'./attomMcpSections.mjs'",
  JSON.stringify(new URL('../src/app/utils/attomMcpSections.mjs', import.meta.url).href),
);
const evidenceCode = ts.transpileModule(evidenceSource, {
  compilerOptions: {module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const {readPropertyEvidence} = await import('data:text/javascript;base64,'+Buffer.from(evidenceCode).toString('base64'));

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
    /patchLeadRequest\(snapshot.leadId!, buildAnalyzerLeadPatch\(snapshot\)\)/.test(app) &&
    /if \(response.ok === false\) throw new Error/.test(app) &&
    /Lead saved\./.test(app) && /Lead not saved\./.test(app),
  'Agent handoffs must label approvals while manual saves require canonical write confirmation.'
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
  /useParams/.test(dealView) &&
    /await fetchLeadFullRequest\(\s*leadId,\s*\{\s*signal,\s*retryLeadReadDuringRestart:\s*true,?\s*\}\s*\)/.test(dealView) &&
    /controller\.abort\(\)/.test(dealView),
  'The /deal/:id route should fetch the canonical lead with cancellable recovery before mounting the analyzer.'
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
  /propertyTypeSource/.test(dealView) &&
    /selectedPathSource/.test(dealView) &&
    /isAnalyzed:\s*record\(lead\.deal\)\.isAnalyzed === false\s*\? false\s*:\s*arv !== undefined \|\| mao !== undefined \|\| maoRBP !== undefined\s*\? true\s*:\s*undefined/.test(
      dealView
    ) && /if \(mappedDeal\.isAnalyzed === false\) mergedDeal\.isAnalyzed = false/.test(dealView),
  'Lead hydration must preserve explicit unanalyzed state and avoid guessed type, path, or analyzed defaults.'
);

// Execute only the hydration functions with sample state, never the React route or bridge.
const hydrationNames = [
  'record', 'firstText', 'firstNumber', 'normalizePropertyType', 'normalizeContact',
  'normalizePath', 'isMeaningfulAnalyzerValue', 'mergeMeaningfulAnalyzerValues',
  'buildAnalyzerDealFromLead', 'hydrateAnalyzerFromLead',
];
const hydrationAst = ts.createSourceFile('DealView.tsx', dealView, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hydrationFunctions = hydrationAst.statements.filter(node =>
  ts.isFunctionDeclaration(node) && hydrationNames.includes(node.name?.text));
strictAssert.equal(hydrationFunctions.length, hydrationNames.length);
const { outputText: hydrationCode } = ts.transpileModule(hydrationFunctions.map(node => node.getText(hydrationAst)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
let sampleCurrent = {}, sampleHydrated;
let sampleStored = {}, storageReads = 0, storageWrites = 0;
let sampleManualFields = [];
let sampleBaseline = 'fixture-baseline', privateHydration, privateUnpublished;
let sampleFresh = false;
const hydration = vm.createContext({
  exports: {}, savedLeadComps, latestCallModeNote, readPropertyEvidence, samePropertyAddress, ANALYZER_CURRENT_DEAL_KEY: 'sample-only',
  readAnalyzerDraftManualFields: () => sampleManualFields,
  readAnalyzerDraftBaseline: () => sampleBaseline,
  isFreshAnalyzerDraft: () => sampleFresh,
  commitAnalyzerDraft: (deal, fields, expected, force, isCurrent) => {
    if (!isCurrent()) return Promise.resolve('superseded');
    storageWrites += 1;
    sampleStored = structuredClone(deal);
    return Promise.resolve('published');
  },
  writeAnalyzerSessionDeal: (deal, fields, baseline, unpublished) => {
    privateHydration = structuredClone(deal);
    privateUnpublished = unpublished;
  },
  readAnalyzerStorage: (key) => {
    strictAssert.equal(key, 'sample-only');
    storageReads += 1;
    return structuredClone(sampleStored);
  },
  writeAnalyzerStorage: (key, deal) => {
    strictAssert.equal(key, 'sample-only');
    storageWrites += 1;
    sampleStored = structuredClone(deal);
  },
  window: { PBKAnalyzer: {
    getState: () => ({ deal: sampleCurrent }),
    setState: state => { sampleHydrated = structuredClone(state.deal); },
  } },
});
vm.runInContext(hydrationCode, hydration, { timeout: 1000 });
const mapLead = payload => structuredClone(hydration.buildAnalyzerDealFromLead(payload, 'sample-a'));
const blankDeal = mapLead({ id: 'sample-a' });
const evidenceAddress='24 Sample Oak Lane, Example City, CA 90210';
const evidenceLead=mapLead({id:'sample-a',property:{address:'24 Sample Oak Lane',city:'Example City',state:'CA',zip:'90210'},deal:{
  listingSnapshot:{source:'apify-for-sale',address:evidenceAddress,retrievedAt:'2026-11-18T12:00:00Z',photoUrls:['https://ap.rdcpix.com/fixture-front.jpg'],facts:{beds:3},sourceLinks:[],askingPrice:400000},
  propertyRecordSnapshot:{source:'attom',address:evidenceAddress,retrievedAt:'2026-11-18T12:00:00Z',facts:{address:evidenceAddress,apn:'QA-PARCEL'}},
},analyzer:{recordedSales:{provider:'ATTOM',review:'suggested-unreviewed',address:{street:'24 Sample Oak Lane',city:'Example City',state:'CA',zip:'90210'},sales:[]}}});
strictAssert.equal(evidenceLead.propertyRecordSnapshot.facts.apn,'QA-PARCEL');
strictAssert.equal(evidenceLead.listingSnapshot.photoUrls.length,1);
strictAssert.equal(evidenceLead.recordedSales.review,'suggested-unreviewed');
for (const field of ['type', 'selectedPath', 'isAnalyzed']) strictAssert.equal(blankDeal[field], undefined);
for (const field of ['arv', 'mao', 'maoRBP']) {
  strictAssert.equal(mapLead({ id: 'sample-a', property: { [field]: 0 } }).isAnalyzed, true);
}
const manualUnanalyzed = { id: 'sample-a', deal: { isAnalyzed: false }, property: { arv: 245000 } };
strictAssert.equal(mapLead(manualUnanalyzed).isAnalyzed, false);
strictAssert.equal(mapLead(manualUnanalyzed).arv, 245000);
sampleCurrent = { leadId: 'sample-a', type: 'land', selectedPath: 'land-owner', arv: 245000,
  price: 120000, notes: 'Manual wording', isAnalyzed: true, comps: { A: { address: 'Sample comp', price: 260000 } } };
const originalManual = structuredClone(sampleCurrent);
await hydration.hydrateAnalyzerFromLead({ id: 'sample-a' }, 'sample-a');
strictAssert.deepEqual(sampleHydrated, originalManual);
await hydration.hydrateAnalyzerFromLead(manualUnanalyzed, 'sample-a');
strictAssert.equal(sampleHydrated.isAnalyzed, false);
strictAssert.deepEqual(sampleCurrent, originalManual, 'Hydration must not mutate the current draft');
await hydration.hydrateAnalyzerFromLead({ id: 'sample-b' }, 'sample-b');
strictAssert.equal(sampleHydrated.leadId, 'sample-b');
for (const field of ['arv', 'price', 'comps', 'notes', 'selectedPath', 'type']) strictAssert.equal(sampleHydrated[field], undefined);
strictAssert.equal(storageReads, 0, 'Mounted hydration must not read fallback storage');
strictAssert.equal(storageWrites, 0, 'Mounted hydration must not write fallback storage');

// Cold route loads hydrate storage before the Analyzer API has mounted.
delete hydration.window.PBKAnalyzer;
sampleStored = structuredClone(originalManual);
await hydration.hydrateAnalyzerFromLead({ id: 'sample-a' }, 'sample-a');
strictAssert.equal(storageReads, 1);
strictAssert.equal(storageWrites, 0, 'Same-lead cold restoration must not publish a shared envelope');
strictAssert.deepEqual(privateHydration, originalManual);
strictAssert.deepEqual(sampleStored, originalManual, 'Cold hydration must retain same-lead draft values');
await hydration.hydrateAnalyzerFromLead(manualUnanalyzed, 'sample-a');
strictAssert.equal(storageReads, 2);
strictAssert.equal(storageWrites, 0);
strictAssert.equal(privateHydration.isAnalyzed, false);
strictAssert.equal(privateHydration.notes, originalManual.notes);

strictAssert.deepEqual(privateHydration.comps, originalManual.comps);
await hydration.hydrateAnalyzerFromLead({ id: 'sample-a-other' }, 'sample-a-other');
strictAssert.equal(storageReads, 3);
strictAssert.equal(storageWrites, 1, 'An intentional handoff to another lead may publish its context');
strictAssert.equal(sampleStored.leadId, 'sample-a-other');
for (const field of ['arv', 'price', 'comps', 'notes', 'selectedPath', 'type']) strictAssert.equal(sampleStored[field], undefined);
strictAssert.deepEqual(sampleCurrent, originalManual, 'Storage hydration must not mutate the mounted draft fixture');

// Unsaved manual values, including intentional blanks/zeros, win over a fresh canonical read.
sampleCurrent = { ...originalManual, beds: 0, notes: '', arv: 510000 };
sampleManualFields = ['beds', 'notes', 'arv', 'comps'];
hydration.window.PBKAnalyzer = {
  getState: () => ({ deal: sampleCurrent }),
  setState: state => { sampleHydrated = structuredClone(state.deal); },
};
await hydration.hydrateAnalyzerFromLead({ id: 'sample-a', property: { beds: 2, arv: 300000 }, notes: 'Saved canonical notes' }, 'sample-a');
for (const field of sampleManualFields) strictAssert.deepEqual(sampleHydrated[field], sampleCurrent[field], `Manual ${field} must survive canonical hydration`);
sampleManualFields = null;
await hydration.hydrateAnalyzerFromLead({ id: 'sample-a', property: { beds: 2, arv: 300000 } }, 'sample-a');
strictAssert.equal(sampleHydrated.beds, 0, 'Legacy drafts without provenance are preserved conservatively');
await hydration.hydrateAnalyzerFromLead({ id: 'sample-b', property: { beds: 2, arv: 300000 } }, 'sample-b');
strictAssert.equal(sampleHydrated.beds, 2, 'Manual fields must never leak to a different lead');

delete hydration.window.PBKAnalyzer;
sampleStored = structuredClone(originalManual);
sampleBaseline = undefined;
const writesBeforeConflict = storageWrites;
await hydration.hydrateAnalyzerFromLead({ id: 'sample-a', property: { beds: 2 } }, 'sample-a');
strictAssert.equal(storageWrites, writesBeforeConflict, 'A conflicted cold route must not publish over the shared draft');
strictAssert.equal(privateHydration.notes, originalManual.notes);
strictAssert.equal(privateUnpublished, true, 'Same-lead hydration must retain unpublished provenance even when only redacted repairs differ');

sampleBaseline = 'fixture-baseline';
hydration.commitAnalyzerDraft = () => Promise.reject(new Error('Fixture lock unavailable'));
await hydration.hydrateAnalyzerFromLead({ id: 'sample-b' }, 'sample-b');
strictAssert.equal(storageWrites, writesBeforeConflict);
strictAssert.equal(privateHydration.leadId, 'sample-b');
strictAssert.equal(privateUnpublished, true, 'An unpublished cold handoff must not appear clean on remount');

// A previous screen's global API can outlive its DOM during WebKit back navigation.
sampleFresh = true;
sampleStored = { ...originalManual, notes: 'Fresh private notes', comps: { A: { address: 'Fresh private comp', price: 420000 } } };
sampleManualFields = ['notes', 'comps'];
hydration.window.PBKAnalyzer = {
  getState: () => ({ deal: originalManual }),
  setState: () => { throw Error('Fresh hydration reached the previous screen API'); },
};
await hydration.hydrateAnalyzerFromLead({ id: 'sample-a' }, 'sample-a');
strictAssert.equal(privateHydration.notes, sampleStored.notes);
strictAssert.deepEqual(privateHydration.comps, sampleStored.comps);

const selectedLead = {
  id: 'sample-a',
  property: { address: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210' },
  analyzer: {
    recordedSales: {
      address: { street: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210' },
      review: 'operator-selected',
    },
    comps: { A: { address: 'Selected sale', price: 270000 } },
  },
};
sampleFresh = false;
sampleCurrent = {
  ...originalManual,
  address: evidenceAddress,
  comps: { A: { address: 'Old suggestion', price: 240000 }, B: { address: 'Old second suggestion', price: 300000 } },
  recordedSales: { address: evidenceAddress, review: 'suggested-unreviewed' },
  compManualSlots: [],
};
sampleManualFields = ['comps', 'compManualSlots', 'notes'];
hydration.window.PBKAnalyzer = {
  getState: () => ({ deal: sampleCurrent }),
  setState: state => { sampleHydrated = structuredClone(state.deal); },
};
await hydration.hydrateAnalyzerFromLead(selectedLead, 'sample-a');
strictAssert.equal(sampleHydrated.comps.A.address, 'Selected sale', 'Current CRM selection must supersede a draft containing only automatic suggestions');
strictAssert.equal(sampleHydrated.comps.B.price, 0, 'Unused saved comp slots must clear stale suggestions');
strictAssert.equal(sampleHydrated.notes, originalManual.notes);
sampleCurrent.compManualSlots = ['A'];
await hydration.hydrateAnalyzerFromLead(selectedLead, 'sample-a');
strictAssert.equal(sampleHydrated.comps.A.address, 'Old suggestion', 'An intentional same-property edit survives the handoff');
sampleCurrent.address = '30 Different Fixture Avenue, Example City, CA 90210';
await hydration.hydrateAnalyzerFromLead(selectedLead, 'sample-a');
strictAssert.equal(sampleHydrated.address, evidenceAddress);
strictAssert.equal(sampleHydrated.comps.A.address, 'Selected sale');
strictAssert.equal(sampleHydrated.notes, undefined, 'A prior address cannot supply subject-specific draft data');

assert(
  /window\.PBKAnalyzer\?\.setState/.test(dealView) &&
    /commitAnalyzerDraft/.test(dealView) &&
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
  /if \(!leadId\) \{\s*return \([\s\S]*?<App engineOnly key=\{draftIdentity\} \/>/.test(dealView),
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
const sellerDocsStart = bridgeServer.indexOf('  async sendSellerDocs(params = {}) {');
const sellerDocsEnd = bridgeServer.indexOf('  async prepareContract(params = {}) {', sellerDocsStart);
assert(sellerDocsStart >= 0 && sellerDocsEnd > sellerDocsStart, 'Seller document handler must exist.');
const sellerDocsHandler = bridgeServer.slice(sellerDocsStart, sellerDocsEnd);
assert(
  /result: 'missing_recipient_email'[\s\S]*await sendAvaOutlookMail\(\{\s*sender: from,\s*recipient: recipientEmail,/.test(sellerDocsHandler) &&
    /const from = selectedFromEmail \|\| String\(process\.env\.PBK_AVA_OUTLOOK_SENDER/.test(sellerDocsHandler) &&
    /fromEmail: from/.test(sellerDocsHandler),
  'Outlook seller document delivery should validate the recipient and use the selected sender.'
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
  /Open deal summary/.test(chrome),
  'Command chrome should expose the deal summary drawer accessibly.'
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
    'node ./scripts/deal-analyzer-modern-mobile-smoke.mjs && npm run test:analyzer-draft-storage',
  'The existing Analyzer CI gate must also run the draft storage regressions.'
);
assert(
  pkg.scripts?.['test:analyzer-draft-storage'] ===
    'node --test ./scripts/analyzer-storage.node-test.mjs ./scripts/analyzer-browseros-mobile.node-test.mjs ./scripts/operator-session-browseros.node-test.mjs',
  'The Analyzer draft gate must run isolated storage, Analyzer safety, and operator-session safety tests without live access.'
);

// Exercise the actual seller-document handler without starting the bridge or sending mail.
const selectedSender = 'selected@example.com';
const sellerRecipient = 'seller@example.com';
const pdfAttachment = { filename: 'sample.pdf', content: 'sample-pdf' };
const outlookRequests = [];
const deliveries = [];
const sellerDocsRuntime = vm.createContext({
  state: {},
  process: { env: { PBK_AVA_OUTLOOK_SENDER: 'default@example.com' } },
  recordToolUse: () => {},
  findLeadContext: () => ({ leadId: 'sample-lead' }),
  normalizeDocumentItems: () => [{ type: 'offer' }],
  inferSenderProfile: () => 'warm',
  buildPdfAttachment: async () => pdfAttachment,
  sendAvaOutlookMail: async (request) => {
    outlookRequests.push(request);
    return { ok: true };
  },
  createDocumentDeliveryRecord: (fields) => ({ id: 'sample-delivery', ...fields }),
  addDocumentDelivery: (_state, delivery) => deliveries.push(delivery),
  createMessageRecord: (fields) => fields,
  upsertMessage: () => {},
  makeActivity: (fields) => fields,
  addActivity: () => {},
  persistState: async () => {},
});
const sellerDocsFixture = vm.runInContext(`({${sellerDocsHandler}})`, sellerDocsRuntime, { timeout: 1000 });

for (const email of ['', 'not-an-email']) {
  const rejected = await sellerDocsFixture.sendSellerDocs({ email, fromEmail: selectedSender });
  strictAssert.equal(rejected.ok, false);
  strictAssert.equal(rejected.result, 'missing_recipient_email');
  strictAssert.equal(rejected.error, 'A valid seller email is required before sending seller documents.');
}
strictAssert.equal(outlookRequests.length, 0, 'Invalid recipients must not reach Outlook.');
strictAssert.equal(deliveries.length, 0, 'Invalid recipients must not create a delivery.');

const sentSellerDocs = await sellerDocsFixture.sendSellerDocs({ email: sellerRecipient, fromEmail: selectedSender });
strictAssert.equal(sentSellerDocs.ok, true);
strictAssert.equal(outlookRequests.length, 1);
strictAssert.equal(outlookRequests[0].recipient, sellerRecipient);
strictAssert.equal(outlookRequests[0].sender, selectedSender, 'The chosen sender must override the default Outlook sender.');
strictAssert.deepEqual(Array.from(outlookRequests[0].attachments), [pdfAttachment]);
strictAssert.equal(deliveries.length, 1);
strictAssert.equal(deliveries[0].provider, 'outlook');
strictAssert.equal(deliveries[0].fromEmail, selectedSender, 'The delivery record must preserve the chosen sender.');

console.log('[deal-analyzer-modern-mobile-smoke] ok');
