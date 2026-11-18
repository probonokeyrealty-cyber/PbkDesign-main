import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium, webkit, expect } from '@playwright/test';

const server = await preview({
  build: { outDir: process.env.PBK_ANALYZER_BUILD_DIR || 'output/address-autofill-build' },
  preview: { host: '127.0.0.1', port: 0 },
});
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
try {
  for (const [engine, width] of [
    [chromium, 1440],
    [webkit, 390],
    [chromium, 320],
  ]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const lookups = [],
        writes = [];
      let saving = false;
      let releaseLookup = () => {};
      await page.routeWebSocket('**/*', (socket) => socket.close());
      await page.addInitScript(() => {
        const config = { endpoint: location.origin, apiKey: 'local-fixture' };
        localStorage.setItem('pbk:local:openclaw-config', JSON.stringify(config));
        window.PBK = { openclaw: { getConfig: () => config } };
        localStorage.setItem(
          'pbk:prefs:v1',
          JSON.stringify({ theme: 'dark', tourCompleted: true })
        );
      });
      await page.route('**/*', async (route) => {
        const req = route.request(),
          url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (!/^\/(api\/|state$|health$|events$|invoke$|\.netlify\/functions\/)/.test(url.pathname))
          return route.continue();
        if (url.pathname === '/api/state/stream/session')
          return route.fulfill({ json: { ok: false } });
        if (url.pathname === '/api/property-data/address-suggestions')
          return route.fulfill({ json: { status: 'unavailable', suggestions: [] } });
        if (req.method() !== 'GET') {
          writes.push({ method: req.method(), path: url.pathname, body: req.postDataJSON() });
          if (saving && req.method() === 'POST' && url.pathname === '/api/leads')
            return route.fulfill({ json: { ok: true, lead: { leadId: 'qa-address-save' } } });
          if (saving && req.method() === 'PATCH' && url.pathname === '/api/leads/qa-address-save')
            return route.fulfill({
              json: {
                ok: true,
                result: 'queued_for_approval',
                approval: { id: 'fixture-approval' },
              },
            });
          return route.abort();
        }
        if (url.pathname === '/api/property-data') {
          lookups.push(url.searchParams.get('address'));
          await new Promise((resolve) => {
            releaseLookup = resolve;
          });
          assert.equal(url.searchParams.get('includeRecords'), 'true');
          return route.fulfill({
            json: {
              records: {
                status: 'matched',
                profile: {
                  address: url.searchParams.get('address'),
                  apn: 'FIXTURE-42',
                  beds: 4,
                  baths: 2,
                  yearBuilt: 1990,
                  livingSqft: 1700,
                  lotSqft: 6000,
                  propertyType: 'Single family',
                  recordedSaleAmount: 250000,
                  recordedSaleDate: '2020-01-01',
                  taxAmount: 2500,
                  taxYear: 2025,
                },
              },
              cache: { hit: true },
              propertyData: {
                source: 'apify-for-sale',
                data: {
                  priceBasis: 'asking_price',
                  askingPriceUsd: 450000,
                  listingFacts: { beds: 3, sqft: 1800, year: 1995, dom: 12 },
                  photoUrls: [lookups.length === 1 ? 'https://ap.rdcpix.com/fixture-front.jpg' : 'https://ap.rdcpix.com/fixture-refresh.jpg'],
                },
              },
            },
          });
        }
        return route.fulfill({ json: {} });
      });
      await page.goto(origin + '/analyzer');
      const address = page.getByRole('combobox', { name: 'Address', exact: true });
      const beds = page.getByRole('spinbutton', { name: 'Bedrooms' });
      const price = page.getByRole('spinbutton', { name: 'List price in dollars' });
      const arv = page.locator('#deal-arv');
      await expect(address).toBeVisible({ timeout: 20000 });
      await address.fill('42 Fixture');
      await page.waitForTimeout(1100);
      assert.deepEqual(lookups, [], 'Incomplete address must not trigger a lookup');
      await arv.fill('600000');
      const full = '42 Fixture Avenue, Example City, CA 90210';
      await address.fill(full);
      await expect.poll(() => lookups.length).toBe(1);
      await beds.fill('7'); // An edit while the request is pending must win.
      await page.getByRole('spinbutton', { name: 'Square footage' }).fill('0');
      await page.getByRole('spinbutton', { name: 'Year built' }).fill('2001');
      await page.getByRole('spinbutton', { name: 'Year built' }).fill('');
      releaseLookup();
      await expect(price).toHaveValue('450000');
      await expect(beds).toHaveValue('7');
      await expect(page.getByRole('spinbutton', { name: 'Square footage' })).toHaveValue('');
      await expect(page.getByRole('spinbutton', { name: 'Year built' })).toHaveValue('');
      await expect(page.getByRole('spinbutton', { name: 'Bathrooms' })).toHaveValue('2');
      await expect(arv).toHaveValue('600000');
      await expect(page.getByRole('spinbutton', { name: 'Comp A sold price' })).toHaveValue('');
      await page.getByText('ATTOM public records · Matched parcel', { exact: true }).click();
      await expect(page.getByText('FIXTURE-42', { exact: true })).toBeVisible();
      await page.screenshot({ path: `output/address-autofill-${width}.png` });
      assert.deepEqual(writes, [], 'Lookup must not write business records');
      await page.getByRole('button', { name: 'Save Deal', exact: true }).click();
      await expect(page.locator('#analyzer-valuation').getByText(/Add the seller name and a phone or email/)).toBeVisible();
      assert.deepEqual(writes, [], 'Missing contact saves locally without creating a lead');
      await page.getByText('CRM handoff · New lead', { exact: true }).click();
      await page.getByRole('textbox', { name: 'Seller name', exact: true }).fill('Fixture Owner');
      await page.getByRole('textbox', { name: 'Seller phone', exact: true }).fill('2025550142');
      saving = true;
      await page.getByRole('button', { name: 'Save Deal', exact: true }).evaluate(button => { button.click(); button.click(); });
      await expect.poll(() => writes.filter((write) => write.path === '/api/leads').length).toBe(1);
      await expect.poll(() => writes.filter((write) => write.method === 'PATCH').length).toBe(1);
      const sync = writes.find((write) => write.method === 'PATCH');
      assert.equal(sync.body.deal.beds, 7);
      assert.equal(sync.body.deal.sqft, 0);
      assert.equal(sync.body.deal.year, 0);
      assert.equal(sync.body.deal.arv, 600000);
      assert.equal(sync.body.deal.propertyRecordSnapshot.facts.apn, 'FIXTURE-42');
      assert.deepEqual(sync.body.deal.listingSnapshot.photoUrls, ['https://ap.rdcpix.com/fixture-front.jpg']);
      assert.equal(sync.body.deal.listingSnapshot.address, full);
      assert.equal(sync.body.deal.listingSnapshot.askingPrice, 450000);
      await expect(
        page.locator('#analyzer-valuation').getByText(/Saved locally\. Ava queued approval/)
      ).toBeVisible();
      await page.getByRole('button', { name: 'Save Deal', exact: true }).click();
      await expect.poll(() => writes.filter(write => write.method === 'PATCH').length).toBe(2);
      assert.equal(writes.filter(write => write.path === '/api/leads').length, 1, 'Repeated save reuses the canonical lead');
      writes.length = 0;
      saving = false;
      if (width < 720) {
        await page.getByRole('button', { name: 'Context', exact: true }).click();
        await page.getByRole('button', { name: 'Valuation', exact: true }).click();
      }
      await page.waitForTimeout(1100);
      assert.deepEqual(
        lookups,
        [full],
        'Filling fields and switching views must not repeat the request'
      );
      await page.getByRole('button', { name: 'Look up asking price', exact: true }).click();
      await expect.poll(() => lookups.length).toBe(2);
      releaseLookup();
      await expect(page.getByRole('button', { name: 'Look up asking price', exact: true })).toBeEnabled();
      saving = true;
      await page.getByRole('button', { name: 'Save Deal', exact: true }).click();
      await expect.poll(() => writes.filter(write => write.method === 'PATCH').length).toBe(1);
      assert.deepEqual(writes.find(write => write.method === 'PATCH').body.deal.listingSnapshot.photoUrls, ['https://ap.rdcpix.com/fixture-refresh.jpg'], 'Manual lookup must persist refreshed photo evidence even without filling scalar fields');
      writes.length = 0;
      saving = false;
      await price.fill('');
      await address.fill('43 Fixture Avenue, Example City, CA 90210');
      await expect(page.getByRole('textbox', { name: 'Seller phone', exact: true })).toHaveValue(
        ''
      );
      await expect.poll(() => lookups.length).toBe(3);
      await address.fill('44 Unfinished');
      releaseLookup();
      await page.waitForTimeout(1200);
      await expect(price).toHaveValue('');
      assert.equal(
        lookups.length,
        3,
        'Old results and unfinished addresses must not cause extra lookups'
      );
      assert.deepEqual(writes, [], 'Typing and lookup must not save to CRM or dispatch work');
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(address).toHaveValue('');
      await address.fill('45 Fresh Avenue, Example City, CA 90210');
      await expect.poll(() => lookups.length).toBe(4);
      releaseLookup();
      await expect(beds).toHaveValue('3');
      await expect(page.getByRole('spinbutton', { name: 'Square footage' })).toHaveValue('1800');
      await expect(price).toHaveValue('450000');
      assert.deepEqual(writes, [], 'Clear and fresh address do not save to CRM');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log(`Address autofill passed: ${width}px`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
}
