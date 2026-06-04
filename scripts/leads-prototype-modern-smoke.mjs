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
  /PbkDataSource[\s\S]*endpoint="GET \/state"[\s\S]*status="ships"/.test(leads),
  'Leads must mark GET /state as the shipped lead snapshot source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/leads"[\s\S]*status="needs-wiring"/.test(leads),
  'Leads must honestly mark GET /api/leads as the full-roster wiring upgrade.'
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
  runtimeBridge.includes('/api/leads/') &&
    runtimeBridge.includes('/api/contract/send') &&
    runtimeBridge.includes('telnyx_call'),
  'runtimeBridge must contain lead detail, contract, and call helpers.'
);
assert(
  dataMap.includes('GET /api/leads/:id/full') &&
    dataMap.includes('POST /api/contract/send') &&
    dataMap.includes('GET /api/leads'),
  'Bridge data map must document Leads runtime sources and full-roster gap.'
);

[
  '.pbk-leads-hero',
  '.pbk-leads-stat',
  '.pbk-leads-pipeline-rail',
  '.pbk-leads-detail-shell',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

console.log('leads-prototype-modern-smoke: ok');
