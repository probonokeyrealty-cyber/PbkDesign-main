import assert from 'node:assert/strict';
import { chromium, devices, expect as baseExpect, webkit } from '@playwright/test';
import { createServer } from 'vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null } });
await server.listen();
const expect = baseExpect.configure({ timeout: 20_000 });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const property = {
  address: '123 Fixture Avenue', city: 'Example City', state: 'CA', zip: '90210',
  sqft: 1600, arv: 250000, mao: 152000, type: 'house',
};
const propertyAddress = '123 Fixture Avenue, Example City, CA 90210';
const savedAt = '2026-11-20T12:00:00Z';
function savedSelection(id, address, price) {
  const sale = { id, address, price, soldDate: '2026-10-20' };
  return {
    comps: {
      A: { address, price, date: sale.soldDate, link: '' },
      B: { address: '', price: 0, date: '', link: '' },
      C: { address: '', price: 0, date: '', link: '' },
    },
    recordedSales: {
      provider: 'ATTOM', review: 'operator-selected', selectedIds: [id], sales: [sale],
      address: { street: property.address, city: property.city, state: property.state, zip: property.zip },
      retrievedAt: savedAt,
    },
  };
}
const leadA = {
  id: 'fixture-north', leadId: 'fixture-north', selectedPath: 'cash', score: 88,
  seller: { name: 'Fixture North', email: 'north@example.invalid' },
  property, assignment: { stage: 'negotiating', assignedAgent: 'Fixture Agent' },
  analyzer: savedSelection('north-comp', '12 North Fixture Avenue', 250000),
  bant: { nextStep: 'Confirm the closing date' }, updatedAt: '2026-06-08T15:00:00Z',
  ghlPipeline: { stageLabel: 'Setter', occurredAt: '2026-11-20T12:00:00Z' },
  compliance: { dncStatus: 'clear', tcpaConsent: 'yes' },
};
const leadB = {
  ...leadA, id: 'fixture-south', leadId: 'fixture-south',
  seller: { name: 'Fixture South', email: 'south@example.invalid' },
  ghlPipeline: undefined, compliance: { dncStatus: 'blocked', tcpaConsent: 'unknown' },
  analyzer: savedSelection('south-comp', '97 South Fixture Avenue', 310000),
  deal: { propertyRecordSnapshot: {
    source: 'attom', address: propertyAddress, retrievedAt: savedAt,
    facts: { apn: '002-03', beds: 3, livingSqft: 1800 },
  } },
};
const analyzerKey = 'pbk:local:analyzer:current-deal';

async function verify(browserType, viewport, device = {}) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    await page.routeWebSocket('**/*', socket => socket.close());
    const rows = new Map([[leadA.id, leadA], [leadB.id, leadB]]);
    const writes = [];
    const unexpectedWrites = [];
    const previews = [];
    const enrichments = [];
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
      if (path === '/api/property-data/enrich' && method === 'POST') {
        const requestBody = request.postDataJSON();
        enrichments.push(requestBody);
        const lead = rows.get(requestBody.leadId);
        if (!lead) return route.fulfill({ status: 404, json: { ok: false } });
        const facts = {
          address: requestBody.address, apn: '001-02', propertyType: 'Single family',
          livingSqft: 1850, lotSqft: 5200, taxAmount: 3600, taxYear: 2025, recordedSaleAmount: 430000,
        };
        rows.set(lead.id, { ...lead, deal: { ...lead.deal, propertyRecordSnapshot: {
          source: 'attom', address: requestBody.address, retrievedAt: '2026-11-20T12:00:00Z', facts,
        } } });
        return route.fulfill({ json: {
          ok: true, saved: true, leadId: lead.id, address: requestBody.address,
          records: { status: 'matched', profile: facts }, sales: { status: 'unavailable' },
        } });
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
      if (/^\/(api\/|health$|events$|invoke$)/.test(path)) {
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
    const north = roster.getByRole('button', { name: /^Preview lead Fixture North/ });
    const south = roster.getByRole('button', { name: /^Preview lead Fixture South/ });
    await expect(north).toBeVisible();
    await expect(south).toBeVisible();
    const northRow = north.locator('xpath=ancestor::*[contains(@class,"lead-mobile-card") or contains(@class,"pbk-lead-ledger-row")][1]');
    const southRow = south.locator('xpath=ancestor::*[contains(@class,"lead-mobile-card") or contains(@class,"pbk-lead-ledger-row")][1]');
    await expect(northRow.locator('[data-stage-source="ghl"]')).toContainText('Setter');
    await expect(northRow.locator('time[title="GoHighLevel stage change"]')).toHaveAttribute('datetime', savedAt);
    await expect(northRow.getByText('Consent on file', { exact: true })).toBeVisible();
    await expect(northRow.getByText('Confirm the closing date', { exact: true })).toBeVisible();
    await expect(southRow.getByText('Contact blocked', { exact: true })).toBeVisible();
    await expect(southRow.locator('[data-stage-source="ghl"]')).toHaveCount(0);
    const search = roster.getByRole('searchbox', { name: 'Search leads' });
    await search.fill('Fixture South');
    await expect(north).toHaveCount(0);
    await expect(south).toBeVisible();
    await search.clear();
    await expect(north).toBeVisible();
    await expect(south).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/leads-${browserType.name()}-${viewport.width}.png` });
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
    const draftRows = page.getByRole('region', { name: 'ATTOM property preview' }).locator('.pbk-attom-rows');
    await expect(draftRows.getByText('1,850 sq ft', { exact: true })).toBeVisible();
    await page.getByText('Recorded transfer', { exact: true }).click();
    await expect(page.getByText('$430,000', { exact: true })).toBeHidden();
    await page.getByText('Recorded transfer', { exact: true }).click();
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
    await roster.getByRole('link', { name: 'Open lead Fixture North at 123 Fixture Avenue', exact: true }).click();
    await expect(page).toHaveURL(/\/leads\/fixture-north$/);
    await expect(page.getByRole('heading', { name: 'Fixture North', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Lead workspace sections' })).toBeVisible();
    const propertyPanel = page.getByRole('region', { name: 'Property', exact: true });
    await page.getByRole('navigation', { name: 'Lead workspace sections' }).getByRole('link', { name: 'Property', exact: true }).click();
    await expect(propertyPanel.getByRole('heading', { name: 'Property', exact: true })).toBeFocused();
    const overviewTab = propertyPanel.getByRole('tab', { name: 'Overview', exact: true });
    const recordTab = propertyPanel.getByRole('tab', { name: 'Property record', exact: true });
    const photosTab = propertyPanel.getByRole('tab', { name: 'Photos', exact: true });
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    const overview = propertyPanel.getByRole('tabpanel', { name: 'Overview' });
    await expect(overview.getByText('Occupancy', { exact: true })).toBeVisible();
    await expect(propertyPanel.getByText('1,600 sq ft', { exact: true })).toBeVisible();
    assert.equal(previews.length, 2, 'Opening Property must not trigger an ATTOM preview');
    assert.equal(enrichments.length, 0, 'Opening Property must not refresh saved evidence');
    await overviewTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(recordTab).toBeFocused();
    await page.keyboard.press('Enter');
    const record = propertyPanel.getByRole('tabpanel', { name: 'Property record' });
    await record.getByRole('button', { name: 'Refresh property intelligence', exact: true }).click();
    const differences = record.locator('.pbk-attom-rows');
    await expect(differences.getByText('1,850 sq ft', { exact: true })).toBeVisible();
    await record.getByRole('button', { name: /^Differences only/ }).click();
    await expect(differences.getByText('1,600 sq ft', { exact: true })).toBeVisible();
    await expect(differences.getByText('Differs', { exact: true })).toBeVisible();
    await expect(differences.locator('dt').first()).toHaveText('Living area');
    await expect(differences.getByText('Property type', { exact: true })).toHaveCount(0);
    const saved = await differences.getByText('1,600 sq ft', { exact: true }).boundingBox();
    const sourced = await differences.getByText('1,850 sq ft', { exact: true }).boundingBox();
    assert.ok(saved && sourced && sourced.x > saved.x, 'Saved and provider values occupy separate columns');
    await expect(record.getByText('$430,000', { exact: true })).toBeVisible();
    await record.getByText('Recorded transfer', { exact: true }).click();
    await expect(record.getByText('$430,000', { exact: true })).toBeHidden();
    await record.getByText('Recorded transfer', { exact: true }).click();
    await expect(record.getByText('$430,000', { exact: true })).toBeVisible();
    await photosTab.click();
    await expect(propertyPanel.getByRole('tabpanel', { name: 'Photos' }).getByText('No photos loaded.')).toBeVisible();
    await expect(propertyPanel.getByRole('tabpanel', { name: 'Photos' }).getByRole('img')).toHaveCount(0);
    await expect(record).toBeHidden();
    await recordTab.click();
    await expect(differences.getByText('1,850 sq ft', { exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await propertyPanel.screenshot({ path: `.pbk-local/property-workspace-${browserType.name()}-${viewport.width}.png` });
    }
    assert.equal(writes.length, 1, 'Property refresh must not use a generic lead write');
    assert.deepEqual(previews, [
      { street: '47 Analyzer Fixture Road', city: 'Example City', state: 'CA', zip: '90210' },
      { street: '47 Analyzer Fixture Road', city: 'Example City', state: 'CA', zip: '90210' },
    ]);
    assert.deepEqual(enrichments.map(({ leadId, expectedPropertyAddress }) => ({ leadId, expectedPropertyAddress })), [
      { leadId: 'fixture-north', expectedPropertyAddress: { street: '123 Fixture Avenue', city: 'Example City', state: 'CA', zip: '90210' } },
    ]);
    await expect(page.getByText('Confirm the closing date')).toBeVisible();
    assert.equal(await page.evaluate(() =>
      document.querySelector('#lead-timeline').getBoundingClientRect().left <
      document.querySelector('#lead-numbers').getBoundingClientRect().left
    ), viewport.width >= 981, 'Underwriting sits beside the timeline on desktop only');
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/lead-portal-${browserType.name()}-${viewport.width}.png` });
    }
    const timeline = page.getByRole('link', { name: 'Timeline', exact: true });
    await timeline.click();
    await expect(page.getByRole('heading', { name: 'Seller timeline' })).toBeFocused();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    await page.getByLabel('Lead actions', { exact: true }).getByRole('button', { name: 'Edit lead', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit complete seller profile' });
    await edit.getByLabel('Seller name', { exact: true }).fill('Fixture North Updated');
    await edit.getByRole('button', { name: 'Save seller profile' }).click();
    await expect(page.getByRole('heading', { name: 'Fixture North Updated', exact: true })).toBeVisible();
    assert.equal(writes[1].path, '/api/leads/fixture-north');
    assert.equal(writes[1].body.name, 'Fixture North Updated');

    const beforeAnalyzer = enrichments.length;
    const openAnalyzer = page.getByRole('button', { name: 'Open Analyzer', exact: true });
    const backToLead = page.getByRole('link', { name: 'Back to lead', exact: true });
    const analyzerRecord = page.getByText('ATTOM public records · Saved record', { exact: true });
    const compAddress = page.getByRole('textbox', { name: 'Comp A address', exact: true });
    await openAnalyzer.click();
    await expect(page).toHaveURL(/\/deal\/fixture-north(?:#|$)/);
    await expect(analyzerRecord).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#deal-arv')).toHaveValue('250000');
    await expect(compAddress).toHaveValue('12 North Fixture Avenue');
    await analyzerRecord.click();
    await expect(page.getByText('001-02', { exact: true })).toBeVisible();
    await page.getByText('Lead details · Linked lead', { exact: true }).click();
    await expect(page.getByText('Lead ID: fixture-north', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Seller name', { exact: true })).toHaveValue('Fixture North Updated');
    assert.equal(enrichments.length, beforeAnalyzer, 'Opening North Analyzer must only read saved evidence');
    await expect(backToLead).toBeVisible();
    await backToLead.click();
    await expect(page).toHaveURL(/\/leads\/fixture-north#lead-record$/);
    await expect(recordTab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await expect(propertyPanel.getByRole('heading', { name: 'Property', exact: true })).toBeFocused();
    await propertyPanel.getByRole('tab', { name: 'Comps', exact: true }).click();
    await propertyPanel.getByRole('link', { name: 'Open Analyzer', exact: true }).click();
    await expect(compAddress).toHaveValue('12 North Fixture Avenue');
    await page.reload();
    await expect(compAddress).toHaveValue('12 North Fixture Avenue');
    await backToLead.press('Enter');
    await expect(page).toHaveURL(/\/leads\/fixture-north#lead-comps$/);
    await expect(propertyPanel.getByRole('tab', { name: 'Comps', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await photosTab.click();
    await openAnalyzer.click();
    await backToLead.click();
    await expect(page).toHaveURL(/\/leads\/fixture-north#lead-photos$/);
    await expect(photosTab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await overviewTab.click();
    await openAnalyzer.click();
    await backToLead.click();
    await expect(page).toHaveURL(/\/leads\/fixture-north#lead-property$/);
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
    await roster.getByRole('link', { name: 'Open lead Fixture South at 123 Fixture Avenue', exact: true }).click();
    await openAnalyzer.click();
    await expect(page).toHaveURL(/\/deal\/fixture-south$/);
    await expect(compAddress).toHaveValue('97 South Fixture Avenue');
    await expect(page.getByRole('spinbutton', { name: 'Comp A sold price', exact: true })).toHaveValue('310000');
    await expect(page.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('3');
    await analyzerRecord.click();
    await expect(page.getByText('002-03', { exact: true })).toBeVisible();
    await expect(page.getByText('001-02', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('spinbutton', { name: 'Square footage', exact: true })).toHaveValue('1600');
    await page.reload();
    await expect(compAddress).toHaveValue('97 South Fixture Avenue');
    await analyzerRecord.click();
    await expect(page.getByText('002-03', { exact: true })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/lead-analyzer-${browserType.name()}-${viewport.width}.png` });
    }
    await backToLead.click();
    await expect(page).toHaveURL(/\/leads\/fixture-south$/);
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    assert.equal(enrichments.length, beforeAnalyzer, 'Opening and returning from Analyzer must only read saved evidence');
    assert.equal(previews.length, 2, 'Changing leads must not call property preview');
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
    await expect(roster.getByRole('button', { name: /^Preview lead Fixture North Updated/ })).toHaveCount(0);
    assert.deepEqual(writes.map(({ method, path }) => [method, path]), [
      ['POST', '/api/leads'], ['PATCH', '/api/leads/fixture-north'], ['DELETE', '/api/leads/fixture-north'],
    ]);
    assert.deepEqual(unexpectedWrites, []);
    console.log(`${browserType.name()} ${viewport.width}px: exact Analyzer handoff, lead tab restoration, and explicit refresh checks passed.`);
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
