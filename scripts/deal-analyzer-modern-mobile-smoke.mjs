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
assert(/pbk-analyzer-side-panel/.test(leftPanel), 'Analyzer snapshot side panel should use modern side-panel styling.');
assert(/pbk-analyzer-workflow-panel/.test(rightPanel), 'Analyzer workflow side panel should use modern workflow-panel styling.');

assert(/PbkDataSource/.test(analyzer), 'AnalyzerTab should show honest source labels.');
assert(/POST \/api\/analyzeDeal/.test(analyzer), 'AnalyzerTab should name the bridge analysis endpoint.');
assert(/local analyzer formulas/.test(analyzer), 'AnalyzerTab should name the local formula fallback.');
assert(/pbk-analyzer-card/.test(analyzer), 'AnalyzerTab cards should use the modern analyzer card class.');
assert(/pbk-analyzer-hero/.test(analyzer), 'AnalyzerTab should include a modern first-card hero treatment.');

assert(/Open analyzer snapshot/.test(chrome), 'Command chrome should expose the snapshot drawer accessibly.');
assert(/Open analyzer workflow/.test(chrome), 'Command chrome should expose the workflow drawer accessibly.');
assert(/Analyze deal/.test(chrome), 'Command chrome should expose analyzer CTA accessibly.');
assert(/aria-label=\{`Switch analyzer tab to/.test(chrome), 'Command chrome tab controls should have contextual aria labels.');

assert(/\.pbk-deal-surface/.test(css), 'PBK CSS should define the deal surface.');
assert(/\.pbk-analyzer-command/.test(css), 'PBK CSS should define analyzer command chrome.');
assert(/\.pbk-analyzer-mobile-rail/.test(css), 'PBK CSS should define the mobile rail.');
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
