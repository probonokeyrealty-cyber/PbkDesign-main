import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const tempDir = path.join(projectRoot, '.tmp');
const bundledFile = path.join(tempDir, 'pbk-runtime.mjs');

mkdirSync(tempDir, { recursive: true });

buildSync({
  entryPoints: [path.join(projectRoot, 'src', 'app', 'utils', 'pbk.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: bundledFile,
  write: true,
});

const runtime = await import(`${pathToFileURL(bundledFile).href}?t=${Date.now()}`);

const {
  DEFAULT_BRANDING,
  buildDocumentSet,
  buildMasterPackageParams,
  getMasterPackagePath,
  getPdfReadiness,
  normalizeSelectedPath,
} = runtime;

function parseParams(query) {
  return Object.fromEntries(new URLSearchParams(query).entries());
}

function createBaseDeal() {
  return {
    address: '123 Main St, Tampa, FL',
    type: 'house',
    contact: 'owner',
    price: 250000,
    agreedPrice: 240000,
    beds: 3,
    baths: 2,
    sqft: 1500,
    year: 1988,
    dom: 22,
    selectedPath: 'cash',
    sellerName: 'Jane Seller',
    sellerEmail: 'jane@example.com',
    sellerPhone: '555-123-4567',
    motivationScore: 4,
    motivationLevel: 'Motivated',
    timeline: '30-45 Days',
    earnestDeposit: 'Delivered within 3 business days',
    arv: 320000,
    rent: 2400,
    balance: 165000,
    rate: 3.75,
    fee: 8000,
    repairs: {
      low: 10000,
      mid: 18000,
      high: 26000,
      condition: 'C4',
    },
    builderPrice: 30000,
    lotSize: '0.25',
    builderTotal: 30000,
    offer: 23500,
    zipCode: '33602',
    landInputMode: 'quarter-acre',
    landPriceSqFt: 0,
    landLotSizeSqFt: 0,
    comps: {
      A: { address: '111 A St', price: 315000, date: '2026-03-10', link: '' },
      B: { address: '222 B St', price: 325000, date: '2026-03-14', link: '' },
      C: { address: '333 C St', price: 320000, date: '2026-03-20', link: '' },
    },
    mao60: 184000,
    maoRBP: 281600,
    verdict: 'green',
    cfDownPayment: 12000,
    cfRate: 5.5,
    cfTerm: 7,
    cfMonthlyPayment: 1045,
    cfType: 'carry',
    mtUpfront: 9000,
    mtBalanceConfirm: 165000,
    mtRateConfirm: 3.75,
    mtType: 'subto',
    rbpPriceConfirm: 286000,
    rbpBuyerType: 'Primary Residence',
    rbpSellerCosts: '$0 - covered by PBK',
    rbpCashAlternative: 225000,
    cashAsIs: 'yes',
    cashClosePeriod: '21',
    landLotSizeConfirm: '0.25 acres',
    landBuyerType: 'Builder',
    landSellerCosts: '$0 - covered by PBK',
    notes: 'Seller wants a clean close.',
    reductions: 5000,
    vacantStatus: 'Owner Occupied',
    investorCashFlow: 350,
    investorCOC: 12,
    investorROI: 18,
    investorIRR: 16,
  };
}

const scenarios = [
  {
    name: 'cash-owner-house',
    mutate(deal) {
      deal.type = 'house';
      deal.contact = 'owner';
      deal.selectedPath = 'cash';
      deal.agreedPrice = 240000;
    },
    expectedPath: 'cash',
    expectedDocChecks: ['Agreed Price: $240,000', 'Structure: All-cash, as-is, no financing contingency.'],
    expectedParams: ['agreedPrice', 'closeTimeline', 'earnestBase'],
  },
  {
    name: 'cash-realtor-house',
    mutate(deal) {
      deal.type = 'house';
      deal.contact = 'realtor';
      deal.selectedPath = 'cash';
      deal.agreedPrice = 242000;
    },
    expectedPath: 'cash-realtor-house',
    expectedDocChecks: ['Agreed Price: $242,000', 'Structure: All-cash, as-is, no financing contingency.'],
    expectedParams: ['agreedPrice', 'closeTimeline', 'earnestBase'],
  },
  {
    name: 'cf-house',
    mutate(deal) {
      deal.type = 'house';
      deal.contact = 'owner';
      deal.selectedPath = 'cf';
      deal.agreedPrice = 255000;
      deal.cfDownPayment = 11111;
      deal.cfRate = 5.5;
      deal.cfTerm = 7;
      deal.cfType = 'carry';
    },
    expectedPath: 'cf',
    expectedDocChecks: ['Down Payment: $11,111', 'Interest Rate: 5.50%', 'Loan Term: 7 years'],
    expectedParams: ['cfDn', 'cfRate', 'cfTerm', 'cfType'],
  },
  {
    name: 'mt-house',
    mutate(deal) {
      deal.type = 'house';
      deal.contact = 'owner';
      deal.selectedPath = 'mt';
      deal.agreedPrice = 250000;
      deal.mtUpfront = 10000;
      deal.mtBalanceConfirm = 170000;
      deal.mtRateConfirm = 3.5;
      deal.mtType = 'subto';
    },
    expectedPath: 'mt',
    expectedDocChecks: ['Upfront Cash to Seller: $10,000', 'Assume Existing Loan Balance: $170,000', 'Existing Interest Rate: 3.50%'],
    expectedParams: ['mtUpfront', 'mtBal', 'mtRate', 'mtType'],
  },
  {
    name: 'rbp-house',
    mutate(deal) {
      deal.type = 'house';
      deal.contact = 'owner';
      deal.selectedPath = 'rbp';
      deal.agreedPrice = 280000;
      deal.rbpCashAlternative = 230000;
    },
    expectedPath: 'rbp',
    expectedDocChecks: ['Cash Alternative: $230,000', 'Seller Costs: $0 - covered by PBK'],
    expectedParams: ['cashAlternative', 'sellerCosts', 'buyerType'],
  },
  {
    name: 'land-agent',
    mutate(deal) {
      deal.type = 'land';
      deal.contact = 'realtor';
      deal.selectedPath = 'land-agent';
      deal.agreedPrice = 24000;
      deal.landLotSizeConfirm = '0.25 acres';
      deal.builderTotal = 30000;
      deal.offer = 24000;
      deal.landBuyerType = 'Builder';
    },
    expectedPath: 'cash-realtor-land',
    expectedDocChecks: ['Lot Size: 0.25 acres', 'Offer to Seller: $24,000'],
    expectedParams: ['lotSize', 'offerToSeller'],
  },
  {
    name: 'rbp-land',
    mutate(deal) {
      deal.type = 'land';
      deal.contact = 'owner';
      deal.selectedPath = 'rbp-land';
      deal.agreedPrice = 25000;
      deal.landLotSizeConfirm = '0.50 acres';
      deal.builderTotal = 38000;
      deal.offer = 25000;
      deal.rbpCashAlternative = 22000;
    },
    expectedPath: 'cash-realtor-land',
    expectedDocChecks: ['Builder Pays: $38,000', 'Cash Alternative: $22,000'],
    expectedParams: ['builderPays', 'cashAlternative', 'offerToSeller'],
  },
];

const results = [];

for (const scenario of scenarios) {
  const deal = createBaseDeal();
  scenario.mutate(deal);

  const normalizedPath = normalizeSelectedPath(deal);
  const masterPath = getMasterPackagePath(deal);
  const readiness = getPdfReadiness(deal);
  const docs = buildDocumentSet(deal, DEFAULT_BRANDING);
  const params = parseParams(buildMasterPackageParams(deal, DEFAULT_BRANDING, false));

  assert.ok(readiness.ready, `${scenario.name}: PDF readiness should be true`);
  assert.equal(masterPath, scenario.expectedPath, `${scenario.name}: master path mismatch`);
  assert.equal(params.path, scenario.expectedPath, `${scenario.name}: query path mismatch`);
  assert.equal(params.templatePath, scenario.expectedPath, `${scenario.name}: template path mismatch`);
  assert.equal(params.agreedPrice, String(deal.agreedPrice || deal.price), `${scenario.name}: agreed price param mismatch`);
  assert.equal(params.closeTimeline, deal.timeline, `${scenario.name}: timeline param mismatch`);
  assert.equal(params.earnestBase, deal.earnestDeposit, `${scenario.name}: earnest param mismatch`);

  for (const key of scenario.expectedParams) {
    assert.ok(params[key] !== undefined, `${scenario.name}: missing query param ${key}`);
  }

  const combinedDocs = [docs.report, docs.seller, docs.loi, docs.email].join('\n');
  for (const snippet of scenario.expectedDocChecks) {
    assert.ok(combinedDocs.includes(snippet), `${scenario.name}: missing document snippet "${snippet}"`);
  }

  results.push({
    scenario: scenario.name,
    normalizedPath,
    masterPath,
    readiness: readiness.message,
  });
}

writeFileSync(
  path.join(projectRoot, '.tmp', 'parity-results.json'),
  JSON.stringify(results, null, 2),
  'utf8',
);

console.log(JSON.stringify({ ok: true, scenarios: results }, null, 2));
