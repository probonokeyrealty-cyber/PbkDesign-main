import assert from 'node:assert/strict';
import { chromium, webkit, devices, expect } from '@playwright/test';
import { preview } from 'vite';
import { readFileSync } from 'node:fs';
process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await preview({ build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
const address = '24 Sample Oak Lane, Example City, CA 90210';
const photos = ['front', 'yard', 'broken'].map(x => `https://ap.rdcpix.com/crm-fixture-${x}.jpg`);
const captured = '2026-11-17T12:00:00Z';
const lead = { id: 'crm-evidence-fixture', leadId: 'crm-evidence-fixture', seller: { name: 'Fixture Seller' },
  property: { address: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210', askingPrice: 450000, beds: 3, baths: 2, sqft: 1800, yearBuilt: 1995 },
  deal: {
    listingSnapshot: { source: 'apify-for-sale', address, retrievedAt: captured, askingPrice: 450000, photoUrls: photos, sourceLinks: ['https://www.realtor.com/realestateandhomes-detail/fixture'], facts: { beds: 3, baths: 2, sqft: 1800, year: 1995, dom: 12 } },
    propertyRecordSnapshot: { source: 'attom', address, retrievedAt: captured, facts: { address, apn: 'FIXTURE-24', propertyType: 'Single family', livingSqft: 1700, beds: 4, baths: 2, yearBuilt: 1995, lotSqft: 6000, taxAmount: 2500, taxYear: 2025, recordedSaleAmount: 250000, recordedSaleDate: '2020-01-01' } },
  },
};
async function verify(engine, config, label) {
  const browser = await engine.launch();
  const page = await browser.newPage(config);
  const writes = [], reads = [], errors = [];
  const fixture = structuredClone(lead);
  let freshPhotos = false;
  try {
    await page.addInitScript(() => {
      const config = { endpoint: location.origin, apiKey: 'local-fixture' };
      localStorage.setItem('pbk:local:openclaw-config', JSON.stringify(config));
      window.PBK = { openclaw: { getConfig: () => config } };
      localStorage.setItem('pbk:prefs:v1', JSON.stringify({ theme: 'dark', tourCompleted: true }));
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => {
      const r = route.request(), u = new URL(r.url());
      if (photos.includes(u.href)) return u.href.includes('broken') ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${u.href.includes('front') ? 120 : 800}" height="480"><rect width="800" height="480" fill="#253848"/><path d="M120 320V180l180-100 180 100v140Z" fill="#7dd3fc"/></svg>` });
      if (u.origin !== origin) return route.abort();
      if (r.isNavigationRequest() && u.pathname.startsWith('/leads/')) return route.fulfill({ contentType: 'text/html', body: readFileSync('dist/index.shell.html', 'utf8') });
      if (!/^\/(api\/|state$|events$|invoke$|health$|\.netlify\/functions\/)/.test(u.pathname)) return route.continue();
      const send = json => route.fulfill({ json });
      if (u.pathname === '/api/state/stream/session') return send({ ok: false });
      if (u.pathname === '/api/property-data/attom-preview' && r.method() === 'POST') { reads.push(u.pathname); return send({ status: 'unavailable' }); }
      if (r.method() !== 'GET') { writes.push(u.pathname); return route.abort(); }
      reads.push(u.pathname);
      if (u.pathname === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
      if (u.pathname === '/api/leads') return send({ ok: true, leads: [lead] });
      if (u.pathname.includes('/api/leads/' + lead.id)) return send({ ok: true, lead: fixture });
      if (u.pathname === '/api/property-data') return send(freshPhotos ? { cache: { hit: true }, propertyData: { source: 'apify-for-sale', data: { photoUrls: [photos[1]] } } } : { cache: { hit: false }, propertyData: null });
      if (u.pathname === '/state') return send({ leadImports: [lead] });
      return send({ ok: true, items: [] });
    });
    await page.goto(origin + '/leads/' + lead.id);
    const workspace = page.getByRole('region', { name: 'Property', exact: true });
    await expect(workspace).toBeVisible({ timeout: 20000 });
    const overview = workspace.getByRole('tabpanel', { name: 'Overview' });
    await expect(overview.getByRole('img', { name: 'Listing photo 1', exact: true })).toBeVisible();
    await overview.getByRole('img', { name: 'Listing photo 1', exact: true }).scrollIntoViewIfNeeded();
    await expect(overview.getByText('Low-resolution source preview. Open the listing for more detail.', { exact: true })).toBeVisible();
    await overview.getByRole('button', { name: 'View photo 2', exact: true }).click();
    await expect(overview.getByRole('img', { name: 'Listing photo 2', exact: true })).toHaveAttribute('src', photos[1]);
    await expect(overview.getByText('Low-resolution source preview. Open the listing for more detail.', { exact: true })).toHaveCount(0);
    await expect(overview.getByText('Saved listing snapshot', { exact: true })).toBeVisible();
    await expect(overview.getByText('FIXTURE-24', { exact: true })).toBeVisible();
    await expect(overview.getByRole('link', { name: 'Realtor.com', exact: true })).toHaveAttribute('href', lead.deal.listingSnapshot.sourceLinks[0]);
    await workspace.getByRole('tab', { name: 'Property record' }).click();
    await expect(workspace.getByText('Saved ATTOM snapshot', { exact: true })).toBeVisible();
    await expect(workspace.getByText('1,700 sq ft', { exact: true })).toBeVisible();
    await expect(workspace.getByText('Differs', { exact: true }).first()).toBeVisible();
    assert.ok(!reads.includes('/api/property-data/attom-preview'));
    await workspace.getByText('Taxes and recorded transfer', { exact: true }).click();
    await expect(workspace.getByText('$2,500', { exact: true })).toBeVisible();
    await workspace.getByRole('button', { name: 'Run lookup again' }).click();
    await expect(workspace.getByText('Refresh unavailable. Showing the saved ATTOM snapshot.', { exact: true })).toBeVisible();
    await expect(workspace.getByText('1,700 sq ft', { exact: true })).toBeVisible();
    await workspace.getByRole('tab', { name: 'Photos', exact: true }).click();
    await workspace.getByRole('button', { name: 'Refresh Apify photos' }).click();
    await expect(workspace.getByText('Showing saved photos. No newer photos were returned.', { exact: true })).toBeVisible();
    await expect(workspace.getByRole('img', { name: 'Listing photo 1', exact: true })).toBeVisible();
    freshPhotos = true;
    await workspace.getByRole('button', { name: 'Refresh Apify photos' }).click();
    await expect(workspace.getByText('Latest cached listing photos. Refresh does not replace the saved snapshot.', { exact: true })).toBeVisible();
    await expect(workspace.getByRole('img', { name: 'Listing photo 1', exact: true })).toHaveAttribute('src', photos[1]);
    await expect(workspace.getByText(/^Captured /)).toHaveCount(0);
    fixture.deal.propertyRecordSnapshot.facts.livingSqft = 1900;
    fixture.deal.propertyRecordSnapshot.retrievedAt = '2026-11-17T13:00:00Z';
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await workspace.getByRole('tab', { name: 'Property record', exact: true }).click();
    await expect(workspace.getByText('1,900 sq ft', { exact: true })).toBeVisible();
    await expect(workspace.getByText('1,700 sq ft', { exact: true })).toHaveCount(0);
    assert.equal(writes.length, 0, 'Viewing evidence must never save or dispatch');
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' horizontal overflow');
    if (process.env.PBK_CRM_EVIDENCE_SHOTS) {
      await workspace.getByRole('tab', { name: 'Overview', exact: true }).click();
      await workspace.scrollIntoViewIfNeeded();
      await page.screenshot({ path: '.pbk-local/crm-property-' + label + '.png', fullPage: false });
    }
    console.log(label + ': CRM saved gallery, source details, parcel comparison, refresh fallback and no writes passed');
  } finally { await browser.close(); }
}
try {
  await verify(chromium, { viewport: { width: 1440, height: 1000 } }, 'desktop');
  await verify(webkit, { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, 'mobile-webkit');
  await verify(chromium, { viewport: { width: 320, height: 800 }, isMobile: true }, 'narrow');
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
