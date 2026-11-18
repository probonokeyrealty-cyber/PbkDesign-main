import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium, webkit, expect } from '@playwright/test';

await mkdir('output', { recursive: true });
const server = await preview({
  build: { outDir: process.env.PBK_ANALYZER_BUILD_DIR || 'output/address-autofill-build' },
  preview: { host: '127.0.0.1', port: 0 },
});
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const full = '42 Fixture Avenue, Example City, CA 90210';
const draftKey = 'pbk:local:analyzer:current-deal';
const storedDraft = page => page.evaluate(key => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(raw)))).payload; }
  catch { return JSON.parse(raw).payload; }
}, draftKey);

try {
  for (const [engine, width] of [[chromium, 1440], [webkit, 390], [chromium, 320]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const enrichments = [], unexpectedPropertyRequests = [], writes = [];
      let releaseLookup = () => {}, pauseLookup = true;
      await page.routeWebSocket('**/*', socket => socket.close());
      await page.addInitScript(() => {
        const config = { endpoint: location.origin, apiKey: 'local-fixture' };
        localStorage.setItem('pbk:local:openclaw-config', JSON.stringify(config));
        window.PBK = { openclaw: { getConfig: () => config } };
        localStorage.setItem('pbk:prefs:v1', JSON.stringify({ theme: 'dark', tourCompleted: true }));
      });
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (!/^\/(api\/|state$|health$|events$|invoke$|\.netlify\/functions\/)/.test(url.pathname)) return route.continue();
        if (url.pathname === '/api/state/stream/session') return route.fulfill({ json: { ok: false } });
        if (url.pathname === '/api/property-data/enrich') {
          assert.equal(req.method(), 'POST');
          const body = req.postDataJSON();
          enrichments.push(body);
          assert.equal(body.address, full);
          if (body.leadId) {
            assert.equal(body.leadId, 'qa-address-save');
            assert.deepEqual(body.expectedPropertyAddress, { street: '42 Fixture Avenue', city: 'Example City', state: 'CA', zip: '90210' });
          }
          if (pauseLookup) await new Promise(resolve => { releaseLookup = resolve; });
          const retrievedAt = new Date().toISOString();
          const profile = { address: full, attomId: '42', fips: '06037', apn: 'FIXTURE-42', beds: 4, baths: 2, yearBuilt: 1990, livingSqft: 1700, lotSqft: 6000, propertyType: 'Single family', recordedSaleAmount: 250000, recordedSaleDate: '2020-01-01', taxAmount: 2500, taxYear: 2025 };
          const photoUrls = [enrichments.length === 1 ? 'https://ap.rdcpix.com/fixture-front.jpg' : 'https://ap.rdcpix.com/fixture-refresh.jpg'];
          const listing = { cache: { hit: true }, propertyData: { source: 'apify-for-sale', data: { priceBasis: 'asking_price', askingPriceUsd: 450000, listingFacts: { beds: 3, sqft: 1800, year: 1995, dom: 12 }, photoUrls } } };
          const candidate = { id: 'fixture-sale-1', address: '46 Fixture Avenue, Example City, CA 90210', soldDate: '2026-07-01', price: 440000, distanceMiles: 0.3, beds: 4, baths: 2, sqft: 1700, pricePerSqft: 258.82, propertyType: 'Single family' };
          const recordedSales = { source: 'attom', address: full, retrievedAt, radiusMiles: 1, sales: [candidate] };
          return route.fulfill({ json: { ok: true, address: full, records: { status: 'matched', profile }, listing,
            sales: { status: 'found', sales: [candidate] }, saved: Boolean(body.leadId), ...(body.leadId ? { leadId: body.leadId } : {}),
            patch: { deal: { propertyRecordSnapshot: { source: 'attom', address: full, retrievedAt, facts: profile },
              listingSnapshot: { source: 'apify-for-sale', address: full, retrievedAt, askingPrice: 450000, photoUrls, sourceLinks: [], facts: { beds: 3, sqft: 1800, year: 1995, dom: 12 } },
              comps: { A: { address: candidate.address, price: 440000, sqft: 1700, date: candidate.soldDate, suggested: true, reviewed: false, source: 'attom', sourceId: candidate.id } } }, analyzer: { recordedSales } } } });
        }
        if (url.pathname.startsWith('/api/property-data')) {
          unexpectedPropertyRequests.push({ path: url.pathname, method: req.method() });
          return route.fulfill({ json: { status: 'unavailable' } });
        }
        if (req.method() !== 'GET') {
          writes.push({ method: req.method(), path: url.pathname, body: req.postDataJSON() });
          if (req.method() === 'POST' && url.pathname === '/api/leads') return route.fulfill({ json: { ok: true, lead: { leadId: 'qa-address-save' } } });
          if (req.method() === 'PATCH' && url.pathname === '/api/leads/qa-address-save') return route.fulfill({ json: { ok: true, result: 'queued_for_approval', approval: { id: 'fixture-approval' } } });
          return route.abort();
        }
        return route.fulfill({ json: {} });
      });
      await page.goto(origin + '/analyzer');
      const address = page.getByRole('combobox', { name: 'Address', exact: true });
      const beds = page.getByRole('spinbutton', { name: 'Bedrooms' });
      const price = page.getByRole('spinbutton', { name: 'List price in dollars' });
      const arv = page.locator('#deal-arv');
      const refresh = page.getByRole('button', { name: 'Refresh property intelligence', exact: true });
      await expect(address).toBeVisible({ timeout: 20000 });
      await address.fill('42 Fixture');
      await page.waitForTimeout(800);
      await address.fill(full);
      await address.blur();
      await price.focus();
      if (width < 720) {
        await page.getByRole('button', { name: 'Context', exact: true }).click();
        await page.getByRole('button', { name: 'Valuation', exact: true }).click();
      }
      await page.waitForTimeout(1100);
      assert.deepEqual(enrichments, [], 'Typing a complete address, focus, and passive tab renders must not enrich');
      assert.deepEqual(unexpectedPropertyRequests, [], 'Typing/focus must not call suggestion, record, or listing providers');
      await arv.fill('600000');
      await refresh.click();
      await expect.poll(() => enrichments.length).toBe(1);
      assert.equal(enrichments[0].leadId, undefined, 'Unlinked enrichment is draft-only');
      await beds.fill('7');
      await page.getByRole('spinbutton', { name: 'Square footage' }).fill('0');
      await page.getByRole('spinbutton', { name: 'Year built' }).fill('2001');
      await page.getByRole('spinbutton', { name: 'Year built' }).fill('');
      releaseLookup(); pauseLookup = false;
      await expect(price).toHaveValue('450000');
      await expect(beds).toHaveValue('7');
      await expect(page.getByRole('spinbutton', { name: 'Square footage' })).toHaveValue('');
      await expect(page.getByRole('spinbutton', { name: 'Year built' })).toHaveValue('');
      await expect(page.getByRole('spinbutton', { name: 'Bathrooms' })).toHaveValue('2');
      await expect(arv).toHaveValue('600000');
      await expect(page.getByRole('spinbutton', { name: 'Comp A sold price' })).toHaveValue('440000');
      await page.getByText('ATTOM public records · Matched parcel', { exact: true }).click();
      await expect(page.getByText('FIXTURE-42', { exact: true })).toBeVisible();
      assert.deepEqual(writes, [], 'Unlinked explicit enrichment must not create a CRM lead or dispatch work');
      await page.getByRole('button', { name: 'Save Deal', exact: true }).click();
      await expect(page.locator('#analyzer-valuation').getByText(/Add the seller name and a phone or email/)).toBeVisible();
      await expect.poll(async () => (await storedDraft(page))?.propertyRecordSnapshot?.facts?.apn).toBe('FIXTURE-42');
      assert.deepEqual(writes, [], 'Saving an unlinked address persists a draft without creating a lead');
      await page.reload();
      await expect(address).toHaveValue(full);
      await expect(beds).toHaveValue('7');
      await expect(price).toHaveValue('450000');
      await expect(page.getByRole('spinbutton', { name: 'Comp A sold price' })).toHaveValue('440000');
      assert.equal(enrichments.length, 1, 'Draft reload hydrates without provider requests');
      await page.getByText('CRM handoff · New lead', { exact: true }).click();
      await page.getByRole('textbox', { name: 'Seller name', exact: true }).fill('Fixture Owner');
      await page.getByRole('textbox', { name: 'Seller phone', exact: true }).fill('2025550142');
      await page.getByRole('button', { name: 'Save Deal', exact: true }).evaluate(button => { button.click(); button.click(); });
      await expect.poll(() => writes.filter(write => write.path === '/api/leads').length).toBe(1);
      await expect.poll(() => writes.filter(write => write.method === 'PATCH').length).toBe(1);
      let sync = writes.find(write => write.method === 'PATCH');
      assert.equal(sync.body.deal.beds, 7); assert.equal(sync.body.deal.arv, 600000);
      assert.equal(sync.body.deal.propertyRecordSnapshot.facts.apn, 'FIXTURE-42');
      assert.deepEqual(sync.body.deal.listingSnapshot.photoUrls, ['https://ap.rdcpix.com/fixture-front.jpg']);
      await expect.poll(async () => (await storedDraft(page))?.leadId).toBe('qa-address-save');
      await page.getByRole('spinbutton', { name: 'Comp A sold price' }).fill('499999');
      const writeCount = writes.length;
      await refresh.click();
      await expect.poll(() => enrichments.length).toBe(2);
      await expect(refresh).toBeEnabled();
      assert.equal(enrichments[1].leadId, 'qa-address-save');
      assert.equal(writes.length, writeCount, 'Linked evidence is saved through enrich rather than duplicate client PATCH');
      await expect(page.getByRole('spinbutton', { name: 'Comp A sold price' })).toHaveValue('499999');
      await page.getByRole('button', { name: 'Save Deal', exact: true }).click();
      await expect.poll(() => writes.filter(write => write.method === 'PATCH').length).toBe(2);
      sync = writes.filter(write => write.method === 'PATCH').at(-1);
      assert.deepEqual(sync.body.deal.listingSnapshot.photoUrls, ['https://ap.rdcpix.com/fixture-refresh.jpg']);
      assert.equal(sync.body.deal.comps.A.price, 499999);
      assert.equal(writes.filter(write => write.path === '/api/leads').length, 1, 'Repeated save reuses canonical lead');
      await page.reload();
      await expect(address).toHaveValue(full); await expect(beds).toHaveValue('7');
      await expect(page.getByRole('spinbutton', { name: 'Comp A sold price' })).toHaveValue('499999');
      assert.equal(enrichments.length, 2, 'Linked draft reload hydrates without provider requests');
      await page.getByRole('button', { name: /^Analyze Deal/ }).click();
      await expect.poll(() => enrichments.length).toBe(3);
      assert.equal(enrichments[2].leadId, 'qa-address-save', 'Analyze gathers evidence for the captured linked lead before readiness checks');
      await expect(page.getByRole('spinbutton', { name: 'Comp A sold price' })).toHaveValue('499999');
      await expect(beds).toHaveValue('7');
      await expect(arv).toHaveValue('600000');
      await page.screenshot({ path: `output/address-autofill-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px overflow`);
      assert.deepEqual(unexpectedPropertyRequests, []);
      console.log(`Explicit property intelligence passed: ${width}px`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
