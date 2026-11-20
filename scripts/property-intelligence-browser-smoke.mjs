import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { chromium, webkit, expect } from '@playwright/test';
import { preview } from 'vite';
import { propertyIntelligencePatch } from './property-intelligence.mjs';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
// Exercise the same built React shell used by the existing CRM evidence qualification.
const shell = readFileSync('dist/index.shell.html', 'utf8');
const server = await preview({ build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const address = { street: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210' };
const full = '24 Sample Oak Lane, Example City, CA 90210';
const lead = { id: 'comps-fixture', seller: { name: 'Fixture Seller' }, property: { ...address, address: address.street, beds: 3, sqft: 1600 } };
const otherLead = { id: 'comps-other-fixture', seller: { name: 'Other Fixture Seller' }, property: { ...address, address: '88 Other Seller Street' } };
try {
  await mkdir('output/playwright', { recursive: true });
  for (const [engine, width] of [[chromium, 1440], [webkit, 390], [chromium, 320]]) {
    const browser = await engine.launch();
    try {
    let currentLead = structuredClone(lead);
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const errors = []; const outbound = []; const writes = []; const enrichments = []; const unexpected = [];
    let fail = false; let failSave = true; let pendingFacts; let pendingLead; let leadStarted;
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const config = { endpoint: location.origin, apiKey: 'local-fixture' };
      localStorage.setItem('pbk:local:openclaw-config', JSON.stringify(config));
      window.PBK = { openclaw: { getConfig: () => config } };
      localStorage.setItem('pbk:prefs:v1', JSON.stringify({ theme: 'dark', tourCompleted: true }));
    });
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
      if (url.origin !== origin) { outbound.push(url.origin); return route.abort(); }
      if (request.isNavigationRequest() && /^\/(?:leads\/|deal\/|analyzer$)/.test(path)) return route.fulfill({ contentType: 'text/html', body: shell });
      if (!/^\/(?:api\/|\.netlify\/functions\/|state$|status$|health$|events$|invoke$|metrics$)/.test(path)) return route.continue();
      const send = json => route.fulfill({ json });
      if (path === '/api/property-data/enrich') {
        assert.equal(request.method(), 'POST');
        const body = request.postDataJSON(); enrichments.push(body);
        assert.equal(body.address, full);
        if (body.leadId) {
          assert.equal(body.leadId, lead.id);
          assert.deepEqual(body.expectedPropertyAddress, address);
        }
        if (pendingFacts) await pendingFacts.promise;
        if (fail) return route.fulfill({ status: 503, json: { ok: false, error: 'Controlled enrichment failure' } });
        const retrievedAt = '2026-11-19T12:00:00Z';
        const profile = { address: full, beds: 3, baths: 2, livingSqft: 1800, yearBuilt: 1980 };
        const recordedSales = { provider: 'ATTOM', review: 'suggested-unreviewed', address, retrievedAt, windowStart: '2026-10-19', windowEnd: '2026-11-19', radiusMiles: body.radiusMiles || 1, sales: body.radiusMiles === 2 ? [] : [{ id: 'sale-1', address: '86 Sample Cedar Drive, Example City, CA 90210', soldDate: '2026-11-12', price: 400000, distanceMiles: 0.5, beds: 3, baths: 2, sqft: 1600, pricePerSqft: 250 }] };
        const evidence = { records: { status: 'matched', profile }, listing: { propertyData: null }, sales: { status: 'matched', source: 'ATTOM', ...recordedSales } };
        // Keep reviewed-selection retention identical to the real enrichment seam.
        const patch = propertyIntelligencePatch(body.leadId ? currentLead : null, address, evidence, retrievedAt);
        if (body.leadId) currentLead = { ...currentLead, deal: { ...currentLead.deal, ...patch.deal }, analyzer: { ...currentLead.analyzer, ...patch.analyzer } };
        return send({ ok: true, saved: Boolean(body.leadId), leadId: body.leadId, address: full, ...evidence, patch });
      }
      if (path.startsWith('/api/property-data')) { unexpected.push(path); return route.abort(); }
      if (path === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
      if (path === '/api/state/stream/session') return send({ ok: false });
      if (path === '/api/scripts/current' && request.method() === 'POST') return send({ ok: true, script: null });
      if (path === '/api/leads/add-note' && request.method() === 'POST') {
        const body = request.postDataJSON();
        assert.equal(body.leadId, lead.id);
        currentLead.activity = [...(currentLead.activity || []), { ...body, category: 'NOTE', at: new Date().toISOString(), text: body.note || body.text }];
        writes.push(path);
        return send({ ok: true });
      }
      if (path === '/api/leads/' + lead.id && request.method() === 'PATCH') {
        writes.push(path);
        const patch = request.postDataJSON();
        assert.ok(['lead-comps-reviewed', 'deal-analyzer-save'].includes(patch.actionSource));
        assert.ok(!('source' in patch));
        if (patch.actionSource === 'lead-comps-reviewed') assert.deepEqual(patch.expectedPropertyAddress, address);
        if (failSave) return route.fulfill({ status: 503, json: { ok: false, error: 'Controlled save failure' } });
        currentLead = { ...currentLead, property: { ...currentLead.property, ...patch.property }, analyzer: { ...currentLead.analyzer, ...patch.analyzer }, deal: { ...currentLead.deal, ...patch.deal } };
        return send({ ok: true, lead: currentLead });
      }
      if (request.method() !== 'GET') { writes.push(path); return route.abort(); }
      if (path === '/api/leads') return send({ ok: true, leads: [lead] });
      if (path === '/api/leads/' + otherLead.id + '/full') return send({ ok: true, lead: otherLead });
      if (path === '/api/leads/' + lead.id + '/full') {
        if (pendingLead) { leadStarted.started = true; await pendingLead.promise; }
        return send({ ok: true, lead: currentLead });
      }
      if (path === '/state') return send({ leadImports: [lead] });
      return send({ ok: true, items: [] });
    });
    await page.goto(origin + '/analyzer');
    const input = page.getByRole('combobox', { name: 'Address', exact: true });
    const beds = page.getByRole('spinbutton', { name: 'Bedrooms' });
    await beds.fill('7');
    const refresh = page.getByRole('button', { name: 'Refresh property intelligence', exact: true });
    await input.fill(full);
    await page.waitForTimeout(1100); // Cross the retired automatic lookup debounce.
    assert.deepEqual(enrichments, []); assert.deepEqual(writes, []); assert.deepEqual(unexpected, []);
    await refresh.click();
    await expect(page.getByRole('spinbutton', { name: 'Square footage' })).toHaveValue('1800');
    await expect(beds).toHaveValue('7');
    assert.equal(enrichments.length, 1); assert.equal(enrichments[0].leadId, undefined);
    assert.deepEqual(writes, [], 'Unlinked lookup remains draft-only');
    // Wait for an actual request before changing the address, then release its stale result.
    pendingFacts = Promise.withResolvers();
    await page.getByRole('spinbutton', { name: 'Square footage' }).fill('');
    await refresh.click();
    await expect.poll(() => enrichments.length).toBe(2);
    await input.fill('Another property in progress');
    pendingFacts.resolve(); pendingFacts = undefined;
    await expect(refresh).toBeEnabled();
    await expect(page.getByRole('spinbutton', { name: 'Square footage' })).toHaveValue('');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.goto(origin + '/leads/' + lead.id);
    await page.getByRole('tab', { name: 'Comps', exact: true }).click();
    const comps = page.getByRole('region', { name: 'Recent comparable sales' });
    await expect(comps.getByText('No saved recorded sales. Refresh property intelligence to find nearby sales.', { exact: true })).toBeVisible();
    assert.equal(enrichments.length, 2, 'Opening a lead never enriches');
    const refreshComps = comps.getByRole('button', { name: 'Refresh property intelligence with selected radius', exact: true });
    await comps.getByRole('combobox', { name: 'Radius', exact: true }).selectOption('2');
    await refreshComps.click();
    await expect(comps.getByText(/No recorded sales within 2 miles/)).toBeVisible();
    assert.equal(enrichments.length, 3); assert.equal(enrichments[2].leadId, lead.id);
    await comps.getByRole('combobox', { name: 'Radius', exact: true }).selectOption('1');
    await expect(comps.getByText(/No recorded sales within 2 miles/)).toBeVisible();
    assert.equal(enrichments.length, 3, 'Changing radius retains the saved search until triggered');
    await refreshComps.click();
    await expect(comps.locator('td[data-label="Price"]')).toHaveText('$400,000');
    assert.equal(enrichments.length, 4);
    await comps.getByRole('checkbox', { name: /^Select comp/ }).check();
    const beforeRejectedSave = structuredClone(currentLead);
    await comps.getByRole('button', { name: 'Save selected comps', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(comps.getByText('Selected comps saved to this lead.', { exact: true })).toHaveCount(0);
    await expect(comps.getByRole('button', { name: 'Save selected comps', exact: true })).toBeEnabled();
    assert.deepEqual(currentLead, beforeRejectedSave, 'Rejected save cannot persist reviewed comps');
    failSave = false;
    await comps.getByRole('button', { name: 'Save selected comps', exact: true }).click();
    await expect(comps.getByText('Selected comps saved to this lead.', { exact: true })).toBeVisible();
    assert.equal(currentLead.analyzer.recordedSales.review, 'operator-selected');
    await page.reload(); await page.getByRole('tab', { name: 'Comps', exact: true }).click();
    await expect(comps.getByRole('checkbox', { name: /^Select comp/ })).toBeChecked();
    await comps.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('distance');
    await comps.getByRole('combobox', { name: 'Radius', exact: true }).selectOption('2');
    await page.waitForTimeout(1100);
    assert.equal(enrichments.length, 4, 'Reload, sorting and radius changes do not refresh');
    await expect(comps.locator('td[data-label="Price"]')).toHaveText('$400,000');
    fail = true; const savedBeforeFailure = structuredClone(currentLead);
    await refreshComps.click();
    await expect(page.getByText('Controlled enrichment failure', { exact: true })).toBeVisible();
    assert.deepEqual(currentLead, savedBeforeFailure, 'Failed refresh retains saved evidence and reviewed comps');
    await expect(comps.locator('td[data-label="Price"]')).toHaveText('$400,000');
    fail = false; await refreshComps.click();
    await expect(page.getByText('Property intelligence saved. Review suggested sales before underwriting.', { exact: true })).toBeVisible();
    await expect(comps.locator('td[data-label="Price"]')).toHaveText('$400,000');
    await expect(comps.getByRole('checkbox', { name: /^Select comp/ })).toBeChecked();
    assert.deepEqual(currentLead.analyzer.recordedSales, savedBeforeFailure.analyzer.recordedSales, 'Successful refresh preserves reviewed candidates, selected IDs, radius and original capture time');
    assert.equal(enrichments.length, 6);
    await comps.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/property-comps-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await comps.getByRole('link', { name: 'Open analyzer', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Comp A sold price', exact: true })).toHaveValue('400000');
    await expect(page.getByRole('textbox', { name: 'Comp A address', exact: true })).toHaveValue('86 Sample Cedar Drive, Example City, CA 90210');
    await page.getByRole('spinbutton', { name: 'Bedrooms' }).fill('8');
    await page.getByRole('button', { name: 'Save Deal', exact: true }).first().click();
    await expect.poll(() => currentLead.property.beds).toBe(8);
    await page.reload();
    await expect(page.getByRole('spinbutton', { name: 'Bedrooms' })).toHaveValue('8');
    await expect(page.getByRole('spinbutton', { name: 'Comp A sold price', exact: true })).toHaveValue('400000');
    const callMode = page.getByRole('button', { name: 'Open Call Mode', exact: true });
    if (await callMode.isVisible()) await callMode.click();
    else await page.getByRole('button', { name: 'Switch analyzer tab to Call Mode', exact: true }).click();
    const tabs = page.getByRole('tablist', { name: 'Call workbench views' });
    await expect(tabs).toBeVisible();
    const notes = page.getByRole('textbox', { name: 'Call notes', exact: true });
    await expect(notes).toBeVisible();
    await notes.fill('Controlled QA notes: retain across call views.');
    await tabs.getByRole('tab', { name: 'Numbers', exact: true }).click();
    await expect(notes).toBeHidden();
    await tabs.getByRole('tab', { name: 'Follow-up', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Post-call actions', exact: true })).toBeVisible();
    await tabs.getByRole('tab', { name: 'Talk', exact: true }).click();
    await expect(notes).toBeVisible();
    await expect(notes).toHaveValue('Controlled QA notes: retain across call views.');
    await expect.poll(() => currentLead.activity?.some(row => row.text === 'Controlled QA notes: retain across call views.')).toBe(true);
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Address', exact: true })).toHaveValue(full);
    const reopenCall = page.getByRole('button', { name: 'Open Call Mode', exact: true });
    if (await reopenCall.isVisible()) await reopenCall.click();
    else await page.getByRole('button', { name: 'Switch analyzer tab to Call Mode', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Call notes', exact: true })).toHaveValue('Controlled QA notes: retain across call views.');
    await page.screenshot({ path: `output/playwright/property-call-${width}.png`, fullPage: true });
    currentLead.property.address = '789 Different Property Road';
    await page.goto(origin + '/deal/' + lead.id);
    await expect(page.getByRole('spinbutton', { name: 'Comp A sold price', exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'Comp A address', exact: true })).toHaveValue('');
    // An old lead fetch must not overwrite the next seller after client-side navigation.
    pendingLead = Promise.withResolvers(); leadStarted = { started: false };
    await page.goto(origin + '/deal/' + lead.id, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => leadStarted.started === true, { timeout: 15000, message: 'Canonical lead fetch must start before navigation' }).toBe(true);
    await page.evaluate(id => {
      history.pushState({}, '', '/deal/' + id);
      dispatchEvent(new PopStateEvent('popstate'));
    }, otherLead.id);
    const otherAddress = '88 Other Seller Street, Example City, CA 90210';
    await expect(page.getByRole('combobox', { name: 'Address', exact: true })).toHaveValue(otherAddress);
    const oldResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/leads/' + lead.id + '/full');
    pendingLead.resolve(); pendingLead = undefined;
    await oldResponse;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole('combobox', { name: 'Address', exact: true })).toHaveValue(otherAddress);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(enrichments.length, 6, 'Handoff, Save, reload and lead switching never enrich');
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, ['/api/leads/' + lead.id, '/api/leads/' + lead.id, '/api/leads/' + lead.id, '/api/leads/add-note']);
    assert.ok(outbound.every(host => host === 'https://fonts.googleapis.com'), 'Only blocked font requests may be attempted; no provider or customer traffic');
    await page.close();
    console.log(`property-intelligence: ${engine.name()} ${width}px explicit refresh, failed save/retry, comps handoff, lead-switch isolation, note persistence and call views passed (fixtures)`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
