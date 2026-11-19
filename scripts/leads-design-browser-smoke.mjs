import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { resolve } from 'node:path';

const evidenceDir = process.env.PBK_OPERATOR_EVIDENCE_DIR || '.pbk-local';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const property = {
  address: '123 Fixture Avenue', city: 'Example City', state: 'CA', zip: '90210',
  sqft: 1600, arv: 250000, mao: 152000, type: 'house',
};
const leadA = {
  id: 'fixture-north', leadId: 'fixture-north', selectedPath: 'cash', score: 88,
  seller: { name: 'Fixture North', email: 'north@example.invalid' },
  property, assignment: { stage: 'negotiating', assignedAgent: 'Fixture Agent' },
  bant: { nextStep: 'Confirm the closing date' }, updatedAt: '2026-06-08T15:00:00Z',
};
const leadB = {
  ...leadA, id: 'fixture-south', leadId: 'fixture-south',
  seller: { name: 'Fixture South', email: 'south@example.invalid' },
};
const analyzerKey = 'pbk:local:analyzer:current-deal';

async function assertWorkspaceJump(page, id) {
  const heading = page.locator(`#${id} h2`).first();
  await expect(heading).toBeFocused();
  await expect.poll(() => heading.evaluate(node => {
    const rect = node.getBoundingClientRect(), header = document.querySelector('.pbk-shell-topbar').getBoundingClientRect();
    return rect.top >= header.bottom && rect.bottom <= innerHeight;
  })).toBe(true);
}

async function verify(browserType, viewport, device = {}) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    page.on('console', message => { if (message.type() === 'error') console.error('Synthetic browser console:', message.text()); });
    page.on('pageerror', error => console.error('Synthetic page error:', error.message));
    const rows = new Map([[leadA.id, leadA], [leadB.id, leadB]]);
    const writes = [];
    const unexpectedWrites = [];
    const previews = [];
    const enrichments = [];
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.addInitScript(({ key, value }) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(value));
    }, { key: `${analyzerKey}:session`, value: {
      address: '47 Analyzer Fixture Road', sellerName: 'Fixture Analyzer', sellerEmail: 'seed@example.invalid',
      type: 'house', selectedPath: 'cash', price: 144000, arv: 240000, mao60: 134000,
    } });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const path = url.pathname;
      if (url.origin !== origin) return route.abort();
      const leadPath = path.match(/^\/api\/leads\/([^/]+)(?:\/full)?$/);
      if (path === '/api/property-data/enrich' && method === 'POST') {
        const body = request.postDataJSON();
        assert.deepEqual(body, { address: '123 Fixture Avenue, Example City, CA 90210', leadId: leadA.id,
          expectedPropertyAddress: { street: property.address, city: property.city, state: property.state, zip: property.zip }, radiusMiles: 1 });
        enrichments.push(body);
        const existing = rows.get(leadA.id);
        const facts = { address: body.address, apn: '001-02', propertyType: 'Single family', livingSqft: 1850, lotSqft: 5200,
          taxAmount: 3600, taxYear: 2025, recordedSaleAmount: 430000 };
        rows.set(leadA.id, { ...existing, deal: { propertyRecordSnapshot: { source: 'attom', address: body.address,
          retrievedAt: '2026-11-18T12:00:00Z', facts } } });
        return route.fulfill({ json: { ok: true, saved: true, records: { status: 'matched', profile: facts }, sales: { status: 'unavailable', sales: [] } } });
      }
      if (path === '/api/property-data/attom-preview' && method === 'POST') {
        const address = request.postDataJSON();
        previews.push(address);
        if (previews.length === 1) return route.fulfill({ json: { ok: true, status: 'timed_out' } });
        return route.fulfill({ json: { ok: true, status: 'matched', profile: {
          address: address.street + ', Example City, CA 90210', apn: '001-02',
          propertyType: 'Single family', livingSqft: 1850, lotSqft: 5200,
          taxAmount: 3600, taxYear: 2025, recordedSaleAmount: 430000,
        } } });
      }
      if (path === '/state') return route.fulfill({ json: { leadImports: [...rows.values()] } });
      if (path === '/api/leads' && method === 'GET') {
        return route.fulfill({ json: { leads: [...rows.values()] } });
      }
      if (path === '/api/leads' && method === 'POST') {
        const body = request.postDataJSON();
        writes.push({ method, path, body });
        const lead = { ...body, id: 'fixture-created', leadId: 'fixture-created' };
        rows.set(lead.id, lead);
        return route.fulfill({ json: { ok: true, lead } });
      }
      if (leadPath && ['GET', 'PATCH', 'DELETE'].includes(method)) {
        const id = leadPath[1];
        const existing = rows.get(id);
        if (!existing) return route.fulfill({ status: 404, json: { ok: false } });
        if (method === 'DELETE') {
          writes.push({ method, path });
          rows.delete(id);
          return route.fulfill({ json: { ok: true, leadId: id, deleted: true } });
        }
        if (method === 'PATCH') {
          const body = request.postDataJSON();
          writes.push({ method, path, body });
          const lead = { ...existing, ...body, seller: { ...existing.seller, name: body.name } };
          rows.set(id, lead);
          return route.fulfill({ json: { ok: true, lead } });
        }
        return route.fulfill({ json: { ok: true, lead: existing } });
      }
      if (/^\/(api(?:\/|$)|\.netlify\/functions\/|health$|status$|events$|invoke$|metrics$)/.test(path)) {
        if (method !== 'GET' && !/\/(auth\/|state\/stream\/session)/.test(path)) {
          unexpectedWrites.push([method, path]);
        }
        return route.fulfill({ json: {} });
      }
      return route.continue();
    });

    await page.goto(`${origin}/leads`);
    await expect(page.getByRole('heading', { name: 'Seller leads.', exact: true })).toBeVisible({ timeout: 12000 });
    const roster = page.getByRole('region', { name: 'Seller roster', exact: true });
    const north = roster.getByRole('button', { name: /^Open lead Fixture North/ });
    const south = roster.getByRole('button', { name: /^Open lead Fixture South/ });
    await expect(north).toBeVisible();
    await expect(south).toBeVisible();
    const search = roster.getByRole('searchbox', { name: 'Search leads' });
    await search.fill('Fixture South');
    await expect(north).toHaveCount(0);
    await expect(south).toBeVisible();
    await search.clear();
    await expect(north).toBeVisible();
    await expect(south).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ path: resolve(evidenceDir, `leads-${browserType.name()}-${viewport.width}.png`) });
    }

    await page.getByRole('button', { name: 'Add seller', exact: true }).click();
    await expect(page.getByPlaceholder('Seller full name')).toHaveValue('Fixture Analyzer');
    const createAddress = page.getByPlaceholder('Property street address');
    await page.getByPlaceholder('Columbus').fill('Example City');
    await page.getByPlaceholder('OH').fill('CA');
    await page.getByPlaceholder('43215').fill('90210');
    const streetBox = await createAddress.boundingBox();
    const cityBox = await page.getByPlaceholder('Columbus').boundingBox();
    const stateBox = await page.getByPlaceholder('OH').boundingBox();
    assert.ok(streetBox && cityBox && stateBox && streetBox.width > stateBox.width && streetBox.y < cityBox.y,
      'Street address must get a full-width row ahead of locality');
    await page.getByRole('button', { name: 'Look up property' }).click();
    await expect(page.getByText('ATTOM took too long to respond.', { exact: true })).toBeVisible();
    await expect(createAddress).toHaveValue('47 Analyzer Fixture Road');
    await expect(page.getByPlaceholder('Seller full name')).toHaveValue('Fixture Analyzer');
    assert.equal(previews.length, 1, 'A timeout must not automatically repeat the lookup');
    await page.getByRole('button', { name: 'Retry lookup', exact: true }).click();
    const previewLivingArea = page.getByRole('region', { name: 'ATTOM property preview', exact: true }).locator('.pbk-attom-rows > div').filter({ has: page.getByText('Living area', { exact: true }) });
    await expect(previewLivingArea.getByText('1,850 sq ft', { exact: true })).toBeVisible();
    await expect(page.getByText('$430,000', { exact: true })).toBeVisible();
    const draftTransfer = page.getByRole('region', { name: 'ATTOM property preview', exact: true }).locator('details').filter({ has: page.locator('summary').getByText('Recorded transfer', { exact: true }) });
    await draftTransfer.locator('summary').click();
    await expect(page.getByText('$430,000', { exact: true })).toBeHidden();
    await draftTransfer.locator('summary').click();
    await expect(page.getByText('$430,000', { exact: true })).toBeVisible();
    await expect(createAddress).toHaveValue('47 Analyzer Fixture Road');
    await expect(page.getByPlaceholder('Seller full name')).toHaveValue('Fixture Analyzer');
    assert.equal(writes.length, 0, 'A lookup must not create a lead');
    await createAddress.fill('48 Analyzer Fixture Road');
    await expect(page.getByText('1,850 sq ft', { exact: true })).toHaveCount(0);
    await createAddress.fill('47 Analyzer Fixture Road');
    await expect(page.getByText('1,850 sq ft', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Create lead', exact: true }).click();
    await expect(page).toHaveURL(/\/leads\/fixture-created$/);
    assert.equal(writes[0].body.property.address, '47 Analyzer Fixture Road');
    assert.equal(writes[0].body.property.arv, 240000);
    await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
    await expect(north).toBeVisible();
    if (viewport.width < 721) {
      await roster.getByRole('link', { name: 'Open workspace for Fixture North', exact: true }).click();
    } else {
      await north.click();
      await page.getByRole('button', { name: 'Open lead', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/leads\/fixture-north$/);
    await expect(page.getByRole('heading', { name: 'Fixture North', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Lead workspace sections' })).toBeVisible();
    const propertyPanel = page.getByRole('region', { name: 'Property', exact: true });
    await page.getByRole('navigation', { name: 'Lead workspace sections' }).getByRole('link', { name: 'Property' }).click();
    await expect(page).toHaveURL(`${origin}/leads/fixture-north`);
    await assertWorkspaceJump(page, 'lead-property');
    const overviewTab = propertyPanel.getByRole('tab', { name: 'Overview', exact: true });
    const recordTab = propertyPanel.getByRole('tab', { name: 'Property record', exact: true });
    const photosTab = propertyPanel.getByRole('tab', { name: 'Photos', exact: true });
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    const overview = propertyPanel.getByRole('tabpanel', { name: 'Overview' });
    await expect(overview.getByText('Occupancy', { exact: true })).toBeVisible();
    await expect(propertyPanel.getByText('1,600 sq ft', { exact: true })).toBeVisible();
    assert.equal(previews.length, 2, 'Opening Property must not trigger an ATTOM request');
    await overviewTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(recordTab).toBeFocused();
    await page.keyboard.press('Enter');
    const record = propertyPanel.getByRole('tabpanel', { name: 'Property record' });
    await record.getByRole('button', { name: 'Refresh property intelligence' }).click();
    const differences = record.locator('.pbk-attom-rows > div[data-status="different"]');
    await expect(differences.getByText('1,850 sq ft', { exact: true })).toBeVisible();
    await expect(differences.getByText('1,600 sq ft', { exact: true })).toBeVisible();
    await expect(differences.getByText('Differs', { exact: true })).toBeVisible();
    await expect(differences.locator('dt').first()).toHaveText('Living area');
    await expect(record.locator('.pbk-attom-rows > div[data-status="match"]').getByText('House', { exact: true })).toBeVisible();
    await expect(differences.getByText('Property type', { exact: true })).toHaveCount(0);
    const saved = await differences.getByText('1,600 sq ft', { exact: true }).boundingBox();
    const sourced = await differences.getByText('1,850 sq ft', { exact: true }).boundingBox();
    assert.ok(saved && sourced && sourced.x >= saved.x + saved.width,
      'Current comparison grid keeps saved lead and ATTOM values in separate ordered columns at desktop and mobile widths');
    const recordTransfer = record.locator('details').filter({ has: page.locator('summary').getByText('Recorded transfer', { exact: true }) });
    await expect(record.getByText('$430,000', { exact: true })).toBeVisible();
    await recordTransfer.locator('summary').click();
    await expect(record.getByText('$430,000', { exact: true })).toBeHidden();
    await recordTransfer.locator('summary').click();
    await expect(record.getByText('$430,000', { exact: true })).toBeVisible();
    await photosTab.click();
    await expect(propertyPanel.getByRole('tabpanel', { name: 'Photos' }).getByText('No photos loaded.', { exact: true })).toBeVisible();
    await expect(propertyPanel.getByRole('tabpanel', { name: 'Photos' }).getByRole('img')).toHaveCount(0);
    await expect(record).toBeHidden();
    await recordTab.click();
    await expect(differences.getByText('1,850 sq ft', { exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await propertyPanel.screenshot({ path: resolve(evidenceDir, `property-workspace-${browserType.name()}-${viewport.width}.png`) });
    }
    assert.equal(writes.length, 1, 'Property evidence refresh must not write lead CRUD or dispatch');
    assert.deepEqual(enrichments, [{ address: '123 Fixture Avenue, Example City, CA 90210', leadId: leadA.id,
      expectedPropertyAddress: { street: property.address, city: property.city, state: property.state, zip: property.zip }, radiusMiles: 1 }], 'One explicit mocked evidence refresh, exact existing lead and address');
    assert.deepEqual(previews, [
      { street: '47 Analyzer Fixture Road', city: 'Example City', state: 'CA', zip: '90210' },
      { street: '47 Analyzer Fixture Road', city: 'Example City', state: 'CA', zip: '90210' },
    ]);
    await expect(page.locator('#lead-next-step').getByText('Confirm the closing date', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() =>
      document.querySelector('#lead-timeline').getBoundingClientRect().left <
      document.querySelector('#lead-numbers').getBoundingClientRect().left
    ), viewport.width >= 981, 'Underwriting sits beside the timeline on desktop only');
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ path: resolve(evidenceDir, `lead-portal-${browserType.name()}-${viewport.width}.png`) });
    }
    const timeline = page.getByRole('link', { name: 'Timeline', exact: true });
    await timeline.click();
    await expect(page).toHaveURL(`${origin}/leads/fixture-north`);
    await assertWorkspaceJump(page, 'lead-timeline');
    await expect(page.getByRole('heading', { name: 'Seller timeline' })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit complete seller profile' });
    await edit.getByLabel('Seller name', { exact: true }).fill('Fixture North Updated');
    await edit.getByRole('button', { name: 'Save seller profile' }).click();
    await expect(page.getByRole('heading', { name: 'Fixture North Updated', exact: true })).toBeVisible();
    assert.equal(writes[1].path, '/api/leads/fixture-north');
    assert.equal(writes[1].body.name, 'Fixture North Updated');

    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    await expect(page).toHaveURL(/\/deal\/fixture-north$/);
    await expect(page.getByRole('heading', { name: '01 / Property details', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Address', exact: true })).toHaveValue('123 Fixture Avenue, Example City, CA 90210');
    await expect.poll(() => page.evaluate((key) => {
      const raw = sessionStorage.getItem(`${key}:session`) || localStorage.getItem(key) || '{}';
      let stored;
      try { stored = JSON.parse(atob(raw)); } catch { stored = JSON.parse(raw); }
      const deal = stored.payload || stored;
      return [deal?.leadId, deal?.sellerName, deal?.arv];
    }, analyzerKey)).toEqual(['fixture-north', 'Fixture North Updated', 250000]);
    await page.goto(`${origin}/leads/fixture-north`);
    const deleteButton = page.getByRole('button', { name: 'Delete lead', exact: true });
    await deleteButton.click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete Fixture North Updated?' });
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(writes.length, 2, 'Cancel must not delete a lead');
    await deleteButton.click();
    await confirm.getByRole('button', { name: 'Delete lead', exact: true }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await expect(south).toBeVisible();
    await expect(north).toHaveCount(0);
    await expect(roster.getByRole('button', { name: /^Open lead Fixture North Updated/ })).toHaveCount(0);
    assert.deepEqual(writes.map(({ method, path }) => [method, path]), [
      ['POST', '/api/leads'], ['PATCH', '/api/leads/fixture-north'], ['DELETE', '/api/leads/fixture-north'],
    ]);
    assert.deepEqual(unexpectedWrites, []);
    console.log(`${browserType.name()} ${viewport.width}px: roster, lead creation, save, Analyzer sync, and exact confirmed delete passed.`);
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, { width: 1440, height: 900 });
  await verify(chromium, { width: 390, height: 844 }, devices['Pixel 7']);
  await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
} finally {
  await server.close();
}
