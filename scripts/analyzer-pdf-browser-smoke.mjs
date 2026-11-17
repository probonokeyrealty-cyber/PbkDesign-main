import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { PDFParse } from 'pdf-parse';

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: ['src/app/utils/pbk.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { buildMasterPackageParams, buildPathPackageText } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const notes = 'Manual 100% [SELLER NAME] & <script>not executable</script> FINAL_SAMPLE_NOTE';
const sample = { address: '11 Fixture Avenue - SAMPLE ONLY', type: 'house', contact: 'owner', selectedPath: 'cash',
  sellerName: 'Sample Seller', sellerEmail: 'sample@example.invalid', sellerPhone: '',
  price: 210000, agreedPrice: 200000, beds: 0, baths: 2, sqft: 1234, year: 1990, dom: 0, zipCode: '90210',
  vacantStatus: 'Owner occupied', arv: 300000, rent: 0, balance: 0, rate: 0, fee: 8000, timeline: '30 days',
  repairs: { low: 5000, mid: 10000, high: 15000, condition: 'C3' },
  builderPrice: 0, lotSize: '', builderTotal: 0, offer: 0, mao60: 180000, maoRBP: 264000, verdict: 'none', notes,
  comps: Object.fromEntries(['A', 'B', 'C'].map(key => [key, { address: key + ' Sample Street', price: 300000, date: '2026-01-01', link: 'https://example.invalid/comp-' + key }])) };
const before = JSON.stringify(sample);
const payload = { documentType: 'masterPackage', documentTitle: 'Sample PBK Master Deal Package', propertyAddress: sample.address,
  companyName: 'Probono Key Realty', selectedPathLabel: 'Cash Offer',
  masterPackageQuery: buildMasterPackageParams(sample), content: buildPathPackageText(sample) };
const source = ts.transpileModule(readFileSync('netlify/functions/documents-pdf.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const exports = {};
const context = vm.createContext({ exports, Buffer, URL, setTimeout, process: { env: {}, cwd: () => process.cwd() }, console,
  require(name) {
    if (!['puppeteer-core', '@sparticuz/chromium', 'node:fs', 'node:path', 'node:url'].includes(name)) throw Error('Unexpected PDF dependency');
    return require(name);
  },
});
vm.runInContext(source, context);
const response = await exports.handler({ httpMethod: 'POST', headers: { host: 'pbkcenter.netlify.app' }, path: '/api/documents/pdf', body: JSON.stringify(payload) });
assert.equal(response.statusCode, 200);
assert.equal(response.headers['X-PBK-PDF-Renderer'], undefined, 'The real bundled Chromium renderer must succeed');
const bytes = Buffer.from(response.body, 'base64');
const parser = new PDFParse({ data: bytes });
const output = resolve('.pbk-local', 'analyzer-pdf-proof-' + Date.now());
mkdirSync(output, { recursive: true });
try {
  const result = await parser.getText();
  assert.match(result.text, /Square footage\s+1,?234/);
  assert.match(result.text, /1,?234/);
  assert.match(result.text, /Owner occupied/);
  assert.match(result.text, /100% \[SELLER NAME\]/);
  assert.match(result.text, /FINAL_SAMPLE_NOTE/);
  assert.match(result.text, /Not verified/);
  assert.match(result.text, /Cash offer price\s+\$200,000/);
  assert.doesNotMatch(result.text, /\u00e2\u20ac|\u00c2\u20ac/);
  assert.doesNotMatch(result.text, /Netlify.*sign in|Team passcode|No document content available/i);
  const detailsIndex = result.pages.findIndex(page => /Square footage/.test(page.text));
  const notesIndex = result.pages.findIndex(page => /FINAL_SAMPLE_NOTE/.test(page.text));
  assert.ok(detailsIndex >= 0 && notesIndex >= 0);
  const images = await parser.getScreenshot({ partial: [...new Set([detailsIndex + 1, notesIndex + 1])], scale: 1.3, imageDataUrl: false });
  for (const image of images.pages) writeFileSync(resolve(output, 'sample-page-' + image.pageNumber + '.png'), image.data);
  writeFileSync(resolve(output, 'sample-master-deal.pdf'), bytes);
  assert.equal(JSON.stringify(sample), before, 'PDF generation must not change manual inputs');
  console.log(JSON.stringify({ ok: true, renderer: 'bundled-offline-template', bytes: bytes.length,
    pages: result.total, detailsPage: detailsIndex + 1, notesPage: notesIndex + 1, output }, null, 2));
} finally { await parser.destroy(); }

const fallbackExports = {};
const fallbackContext = vm.createContext({ ...context, exports: fallbackExports,
  setTimeout: callback => queueMicrotask(callback), console: { warn() {}, error() {} },
  require(name) {
    if (name === 'puppeteer-core') return { launch: async () => { throw Error('Sample-only renderer outage'); } };
    return context.require(name);
  },
});
vm.runInContext(source, fallbackContext);
const fallback = await fallbackExports.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ...payload,
  content: payload.content + '\n' + Array.from({ length: 180 }, (_, index) => 'Retained sample detail ' + index).join('\n') + '\nFINAL_FALLBACK_SAMPLE_FIELD' }) });
assert.equal(fallback.headers['X-PBK-PDF-Renderer'], 'simple-fallback');
const fallbackBytes = Buffer.from(fallback.body, 'base64');
const fallbackParser = new PDFParse({ data: fallbackBytes });
try {
  const result = await fallbackParser.getText();
  assert.match(result.text, /FINAL_FALLBACK_SAMPLE_FIELD/);
  const images = await fallbackParser.getScreenshot({ partial: [result.total], scale: 1.3, imageDataUrl: false });
  writeFileSync(resolve(output, 'sample-fallback-last-page.png'), images.pages[0].data);
  writeFileSync(resolve(output, 'sample-fallback.pdf'), fallbackBytes);
  console.log('Sample fallback PDF retained its final field across ' + result.total + ' pages.');
} finally { await fallbackParser.destroy(); }
