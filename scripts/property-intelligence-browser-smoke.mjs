import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
const address = { street: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210' };
const full = '24 Sample Oak Lane, Example City, CA 90210';
const lead = { id: 'comps-fixture', seller: { name: 'Fixture Seller' }, property: { ...address, address: address.street, beds: 3, sqft: 1600 } };
try {
  await mkdir('output/playwright', { recursive: true });
  for (const width of [390, 1440]) {
    let currentLead = structuredClone(lead);
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = []; const outbound = []; const writes = [];
    let fail = false; let pendingFacts;
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
      if (url.origin !== origin) { outbound.push(url.origin); return route.abort(); }
      if (!/^\/(?:api\/|\.netlify\/functions\/|state$|status$|health$|events$|invoke$|metrics$)/.test(path)) return route.continue();
      const send = json => route.fulfill({ json });
      if (path === '/api/property-data/address-suggestions') {
        const body = request.postDataJSON();
        return send(body.placeId ? { status: 'matched', address } : { status: 'matched', suggestions: [{ id: 'fixture-place', label: full }] });
      }
      if (path === '/api/property-data/attom-preview') {
        if (pendingFacts) await pendingFacts.promise;
        return send({ status: 'matched', profile: { address: full, beds: 3, baths: 2, livingSqft: 1800, yearBuilt: 1980 } });
      }
      if (path === '/api/property-data/attom-sales') {
        const radius = request.postDataJSON().radius;
        return send(fail ? { status: 'timed_out' } : { status: 'matched', source: 'ATTOM', windowStart: '2026-10-17', windowEnd: '2026-11-15', retrievedAt: '2026-11-15T12:00:00Z', sales: radius === 2 ? [] : [{ id: 'sale-1', address: '86 Sample Cedar Drive, Example City, CA 90210', soldDate: '2026-11-12', price: 400000, distanceMiles: 0.5, beds: 3, baths: 2, sqft: 1600, pricePerSqft: 250 }] });
      }
      if (path === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
      if (path === '/api/state/stream/session') return send({ ok: false });
      if (path === '/api/scripts/current' && request.method() === 'POST') return send({ ok: true, script: null });
      if (path === '/api/leads/' + lead.id && request.method() === 'PATCH') {
        writes.push(path);
        const patch = request.postDataJSON();
        assert.equal(patch.source, 'lead-comps-reviewed');
        assert.deepEqual(patch.expectedPropertyAddress, address);
        currentLead = { ...currentLead, analyzer: patch.analyzer, deal: patch.deal };
        return send({ ok: true, lead: currentLead });
      }
      if (request.method() !== 'GET') { writes.push(path); return route.abort(); }
      if (path === '/api/leads') return send({ ok: true, leads: [lead] });
      if (path.startsWith('/api/leads/' + lead.id)) return send({ ok: true, lead: currentLead });
      if (path === '/state') return send({ leadImports: [lead] });
      return send({ ok: true, items: [] });
    });
    await page.goto(origin + '/analyzer');
    const input = page.getByRole('combobox', { name: 'Address', exact: true });
    const beds = page.getByRole('spinbutton', { name: 'Bedrooms' });
    await beds.fill('7');
    await input.fill('24 Sample');
    await expect(page.getByRole('option', { name: full })).toBeVisible();
    for (const theme of ['light', 'dark']) {
      const contrast = await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        const list = document.querySelector('.pbk-address-suggestions');
        const luminance = css => {
          const rgb = css.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const bg = luminance(getComputedStyle(list).backgroundColor);
        return [...list.querySelectorAll('button,.pbk-places-attribution')].map(node => {
          const fg = luminance(getComputedStyle(node).color);
          return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        });
      }, theme);
      assert.ok(contrast.every(ratio => ratio >= 4.5), `${theme} suggestions and attribution must have readable contrast: ${contrast}`);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await input.press('ArrowDown'); await input.press('Enter');
    await expect(input).toHaveValue(full);
    await expect(page.getByRole('spinbutton', { name: 'Square footage' })).toHaveValue('1800');
    await expect(beds).toHaveValue('7');
    // A delayed lookup must not overwrite a different property or a field edited in flight.
    pendingFacts = Promise.withResolvers();
    await page.getByRole('spinbutton', { name: 'Square footage' }).fill('');
    await page.getByRole('button', { name: 'Look up ATTOM property facts' }).click();
    await input.fill('Another property in progress');
    pendingFacts.resolve(); pendingFacts = undefined;
    await expect(page.getByRole('spinbutton', { name: 'Square footage' })).toHaveValue('');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.goto(origin + '/leads/' + lead.id);
    await page.getByRole('tab', { name: 'Comps', exact: true }).click();
    const comps = page.getByRole('region', { name: 'Recent comparable sales' });
    await expect(comps.getByText('$400,000', { exact: true })).toBeVisible();
    await comps.getByRole('checkbox', { name: /^Select comp/ }).check();
    await comps.getByRole('button', { name: 'Save selected comps', exact: true }).click();
    await expect(comps.getByText('Selected comps saved to this lead.', { exact: true })).toBeVisible();
    await comps.getByLabel('Sort').selectOption('distance');
    await comps.getByLabel('Radius').selectOption('2');
    await expect(comps.getByText(/No recorded sales within 2 miles/)).toBeVisible();
    fail = true;
    await comps.getByRole('button', { name: 'Refresh recorded sales' }).click();
    await expect(comps.getByRole('alert')).toContainText('timed out');
    fail = false;
    await comps.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(comps.getByText(/No recorded sales within 2 miles/)).toBeVisible();
    await comps.getByLabel('Radius').selectOption('1');
    await expect(comps.getByText('$400,000', { exact: true })).toBeVisible();
    await comps.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/property-comps-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await comps.getByRole('link', { name: 'Open analyzer', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Comp A sold price', exact: true })).toHaveValue('400000');
    await expect(page.getByRole('textbox', { name: 'Comp A address', exact: true })).toHaveValue('86 Sample Cedar Drive, Example City, CA 90210');
    const callMode = page.getByRole('button', { name: 'Open Call Mode', exact: true });
    if (await callMode.isVisible()) await callMode.click();
    else await page.getByRole('button', { name: 'Switch analyzer tab to Call Mode', exact: true }).click();
    const tabs = page.getByRole('tablist', { name: 'Call workbench views' });
    await expect(tabs).toBeVisible();
    const notes = page.getByRole('textbox', { name: 'Call notes', exact: true });
    await expect(notes).toBeVisible();
    await tabs.getByRole('tab', { name: 'Numbers', exact: true }).click();
    await expect(notes).toBeHidden();
    await tabs.getByRole('tab', { name: 'Follow-up', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Post-call actions', exact: true })).toBeVisible();
    await tabs.getByRole('tab', { name: 'Talk', exact: true }).click();
    await expect(notes).toBeVisible();
    await page.screenshot({ path: `output/playwright/property-call-${width}.png`, fullPage: true });
    currentLead.property.address = '789 Different Property Road';
    await page.goto(origin + '/deal/' + lead.id);
    await expect(page.getByRole('spinbutton', { name: 'Comp A sold price', exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'Comp A address', exact: true })).toHaveValue('');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []); assert.deepEqual(writes, ['/api/leads/' + lead.id]);
    assert.ok(outbound.every(host => host === 'https://fonts.googleapis.com'), 'No data-provider or customer traffic is allowed');
    await page.close();
    console.log(`property-intelligence: ${width}px keyboard selection, fact preservation, stale response, comps, empty, timeout and retry passed (fixtures)`);
  }
} finally { await browser.close(); await server.close(); }
