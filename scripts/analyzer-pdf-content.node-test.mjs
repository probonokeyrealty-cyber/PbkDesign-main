import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { PDFParse } from 'pdf-parse';

const bundle = await build({ entryPoints: ['src/app/utils/pbk.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sample = () => ({ address: '11 Fixture Avenue', type: 'house', contact: 'owner', selectedPath: 'cash',
  price: 210000, agreedPrice: 200000, beds: 0, baths: 2, sqft: 1234, year: 1990, dom: 0, zipCode: '90210',
  sellerName: 'Sample Seller', sellerEmail: 'sample@example.invalid', sellerPhone: '',
  arv: 300000, rent: 0, balance: 0, rate: 0, fee: 8000, timeline: '30 days',
  repairs: { low: 5000, mid: 10000, high: 15000, condition: 'C3' },
  builderPrice: 0, lotSize: '', builderTotal: 0, offer: 0, mao60: 180000, maoRBP: 264000, verdict: 'none',
  comps: Object.fromEntries(['A', 'B', 'C'].map(key => [key, { address: key + ' Sample Street', price: 300000, date: '2026-01-01', link: 'https://example.invalid/comp-' + key }])),
  notes: 'Manual note: 100% retained & <script>not executable</script>', vacantStatus: 'Owner occupied' });

test('known property fields and internal notes reach the PDF without changing the deal', () => {
  const deal = sample(), before = JSON.stringify(deal);
  const query = new URLSearchParams(api.buildMasterPackageParams(deal));
  for (const field of ['beds', 'baths', 'sqft', 'year', 'dom', 'zipCode', 'notes', 'vacantStatus']) {
    assert.equal(query.get(field), String(deal[field]), field);
  }
  assert.equal(query.get('compALink'), deal.comps.A.link);
  assert.equal(JSON.stringify(deal), before);
  const text = api.buildPathPackageText(deal);
  assert.match(text, /Square footage: 1,234/);
  assert.match(text, /Bedrooms: 0/);
  assert.match(text, /Owner occupied/);
  assert.ok(text.includes(deal.notes));
});

test('unsupported risk and arrears claims remain unverified', () => {
  const query = new URLSearchParams(api.buildMasterPackageParams(sample()));
  for (const key of ['titleRisk', 'paymentTolerance', 'reinstatementNeed', 'arrearsAmount']) {
    assert.equal(query.get(key), 'Not verified');
  }
});

test('unset price, area, and year are not asserted as factual zeros', () => {
  const deal = { ...sample(), price: 0, sqft: 0, year: 0 };
  const before = JSON.stringify(deal);
  const query = new URLSearchParams(api.buildMasterPackageParams(deal));
  for (const key of ['listPrice', 'sqft', 'year']) assert.equal(query.get(key), '', key);
  const text = api.buildPathPackageText(deal);
  for (const label of ['List price', 'Square footage', 'Year built']) {
    assert.ok(text.includes(label + ': Not provided'), label);
  }
  assert.equal(query.get('beds'), '0');
  assert.equal(query.get('dom'), '0');
  assert.equal(JSON.stringify(deal), before);
});

test('the template separates an agreed cash offer from MAO and preserves percent characters', () => {
  const html = readFileSync('public/PBK_Master_Deal_Package.html', 'utf8');
  const reader = html.match(/\(function\(\) \{[\s\S]*?\}\)\(\);/)[0];
  for (const selectedPath of ['cash', 'cf', 'mt', 'rbp']) {
    const deal = { ...sample(), selectedPath, sellerName: 'Sample 100% Owner' };
    const context = vm.createContext({ window: { location: { search: '?' + api.buildMasterPackageParams(deal) } }, URLSearchParams });
    vm.runInContext(reader, context);
    assert.equal(context.window._pbk.cashPrice, selectedPath === 'cash' ? '$200,000' : '$180,000');
    assert.equal(context.window._pbkFill('[MAO CASH]'), '$180,000');
    assert.equal(context.window._pbk.sellerName, deal.sellerName);
  }
});

function handlerFixture({ failBrowser = false } = {}) {
  const seen = { url: '', interception: false, listener: null };
  const page = {
    async goto(url) { seen.url = url; }, async emulateMediaType() {}, async evaluate() {},
    async setRequestInterception() { seen.interception = true; }, on(_event, listener) { seen.listener = listener; },
    async waitForSelector() {}, async setContent() {}, async pdf() { return Buffer.from('%PDF-fixture'); },
  };
  const source = readFileSync('netlify/functions/documents-pdf.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  const context = vm.createContext({ exports, Buffer, URL, process: { env: {}, cwd: () => process.cwd() },
    console: { warn() {}, error() {} }, setTimeout: callback => { queueMicrotask(callback); },
    require(name) {
      if (name === '@sparticuz/chromium') return { args: [], executablePath: async () => 'fixture' };
      if (name === 'puppeteer-core') return { launch: async () => {
        if (failBrowser) throw Error('fixture browser unavailable');
        return { newPage: async () => page, close: async () => {} };
      } };
      if (name === 'node:fs') return { existsSync: () => true };
      if (name === 'node:path') return { resolve: (...parts) => parts.join('/') };
      if (name === 'node:url') return { pathToFileURL: path => new URL('file:///' + path.replace(/\\/g, '/').replace(/^\//, '')) };
      throw Error('Unexpected module in isolated PDF fixture: ' + name);
    },
  });
  vm.runInContext(compiled, context);
  return { seen, handler: exports.handler };
}

test('private-site master rendering uses a bundled document, not a protected network page', async () => {
  const { handler, seen } = handlerFixture();
  const result = await handler({ httpMethod: 'POST', headers: { host: 'pbkcenter.netlify.app' }, path: '/api/documents/pdf',
    body: JSON.stringify({ documentType: 'masterPackage', masterPackageQuery: api.buildMasterPackageParams(sample()) }) });
  assert.equal(result.statusCode, 200);
  assert.equal(new URL(seen.url).protocol, 'file:');
  assert.equal(new URL(seen.url).searchParams.get('address'), sample().address);
  assert.equal(seen.interception, true);
  assert.ok(seen.listener);
  let denied = false;
  seen.listener({ isInterceptResolutionHandled: () => false, url: () => 'https://provider.example/send',
    abort: async () => { denied = true; } });
  assert.equal(denied, true);
});

test('fallback PDF retains long report content and the final field instead of truncating', async () => {
  const { handler } = handlerFixture({ failBrowser: true });
  const content = Array.from({ length: 180 }, (_, index) => 'Sample detail row ' + index + ': retained underwriting context.').join('\n') + '\nFINAL_SAMPLE_FIELD_RETAINED';
  const result = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ documentTitle: 'Sample report', propertyAddress: sample().address, content }) });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['X-PBK-PDF-Renderer'], 'simple-fallback');
  const parser = new PDFParse({ data: Buffer.from(result.body, 'base64') });
  try {
    const pdf = await parser.getText();
    assert.match(pdf.text, /FINAL_SAMPLE_FIELD_RETAINED/);
    assert.match(pdf.text, /Sample detail row 179/);
    assert.doesNotMatch(pdf.text, /fixture browser unavailable|stack trace/);
  } finally { await parser.destroy(); }
});
