import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { join } from 'node:path';

const evidenceDir = process.env.PBK_OPERATOR_EVIDENCE_DIR || '.pbk-local';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
const address = { street: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210' };
const nextAddress = { ...address, street: '86 Sample Cedar Drive' };
const lead = {
  id: 'property-ui-sample', leadId: 'property-ui-sample',
  seller: { name: 'Sample Seller' }, assignment: { stage: 'new' },
  property: { ...address, address: address.street, type: 'house', sqft: 1600, beds: 3 },
};
const profile = {
  address: '24 SAMPLE OAK LN, EXAMPLE CITY, CA 90210',
  apn: '000-01', propertyType: 'Single family', livingSqft: 1850, lotSqft: 5200,
  beds: 3, baths: 2, yearBuilt: 1986,
};
const nextProfile = { ...profile, address: '86 SAMPLE CEDAR DR, EXAMPLE CITY, CA 90210', apn: '000-02' };

async function verify(browser, config, label) {
  const page = await browser.newPage(config);
  const staleLookup = Promise.withResolvers();
  try {
    page.setDefaultTimeout(15_000);
    const lookups = [];
    const enrichments = [];
    let savedLead = structuredClone(lead);
    const writes = [];
    const mediaRequests = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.routeWebSocket('**/*', (socket) => socket.close());
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== origin) {
        if (/zillow|zillowstatic|mls/i.test(url.hostname)) mediaRequests.push(url.hostname);
        return route.abort();
      }
      const path = url.pathname;
      if (!/^\/(?:api\/|\.netlify\/functions\/|state$|status$|health$|events$|invoke$|metrics$)/.test(path)) {
        return route.continue();
      }
      const send = (json) => route.fulfill({ json });
      if (path === '/api/property-data/enrich' && req.method() === 'POST') {
        const payload = req.postDataJSON();
        assert.deepEqual(payload, { address: '24 Sample Oak Lane, Example City, CA 90210', leadId: lead.id, expectedPropertyAddress: address, radiusMiles: 1 });
        enrichments.push(payload);
        const snapshot = { source: 'attom', address: payload.address, retrievedAt: '2026-11-18T12:00:00Z', facts: profile };
        savedLead = { ...savedLead, deal: { propertyRecordSnapshot: snapshot } };
        return send({ ok: true, address: payload.address, leadId: lead.id, saved: true, patch: { deal: { propertyRecordSnapshot: snapshot } }, records: { status: 'matched', profile }, sales: { status: 'unavailable', sales: [] } });
      }
      if (path === '/api/property-data/attom-preview' && req.method() === 'POST') {
        const payload = req.postDataJSON();
        lookups.push(payload);
        if (payload.street === nextAddress.street) {
          const first = lookups.filter((lookup) => lookup.street === nextAddress.street).length === 1;
          return send(first ? { ok: true, status: 'timed_out' } : { ok: true, status: 'matched', profile: nextProfile });
        }
        if (lookups.length === 2) {
          await staleLookup.promise;
          return send({ ok: true, status: 'matched', profile });
        }
        return send({ ok: true, status: 'matched', profile });
      }
      if (path === '/api/state/stream/session') return send({ ok: false });
      if (req.method() !== 'GET') {
        writes.push([req.method(), path]);
        return route.abort();
      }
      if (path === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
      if (path === '/api/leads') return send({ ok: true, leads: [savedLead] });
      if (path === '/api/leads/' + lead.id + '/full' || path === '/api/leads/' + lead.id) {
        return send({ ok: true, lead: savedLead });
      }
      if (path === '/state') return send({ leadImports: [savedLead] });
      return send({ ok: true, items: [] });
    });

    await page.goto(origin + '/leads/' + lead.id);
    const workspace = page.getByRole('region', { name: 'Property' });
    const overview = workspace.getByRole('tab', { name: 'Overview' });
    const record = workspace.getByRole('tab', { name: /^Property record/ });
    await expect(workspace.getByText('1,600 sq ft', { exact: true })).toBeVisible();
    await overview.focus();
    await overview.press('ArrowRight');
    await expect(record).toBeFocused();
    await record.press('Enter');
    await workspace.getByRole('tabpanel', { name: 'Property record', exact: true }).getByRole('button', { name: 'Refresh property intelligence', exact: true }).click();
    await expect(workspace.getByText('Exact address match')).toBeVisible();
    await expect(workspace.getByText('Only in record', { exact: true }).first()).toBeVisible();
    await expect(workspace.getByText('Address sent', { exact: true })).toBeVisible();
    const differences = workspace.getByRole('button', { name: /^Differences only/ });
    const comparison = workspace.locator('.pbk-attom-rows');
    await differences.click();
    await expect(differences).toHaveAttribute('aria-pressed', 'true');
    await expect(comparison.getByText('1,850 sq ft', { exact: true })).toBeVisible();
    await expect(comparison.getByText('5,200 sq ft', { exact: true })).toHaveCount(0);
    await workspace.getByRole('button', { name: /^All fields/ }).click();
    await expect(comparison.getByText('5,200 sq ft', { exact: true })).toBeVisible();
    if (process.env.PBK_PROPERTY_QA_SHOTS) {
      await workspace.getByRole('tabpanel').scrollIntoViewIfNeeded();
      await page.screenshot({ scale: 'css', path: join(evidenceDir, 'property-record-' + label + '.png') });
    }
    await workspace.getByRole('tab', { name: 'Photos' }).click();
    const photos = workspace.getByRole('tabpanel');
    await expect(photos.getByText('No photos loaded.', { exact: true })).toBeVisible();
    await expect(photos.getByRole('button', { name: 'Refresh property intelligence', exact: true })).toBeEnabled();
    await expect(photos.getByRole('img')).toHaveCount(0);
    await expect(photos.getByText('Exact address match')).toHaveCount(0);
    await record.click();
    await expect(workspace.getByText('Exact address match')).toBeVisible();
    assert.deepEqual(lookups, [], 'Workspace uses one explicit enrich call, never an automatic draft lookup');
    assert.deepEqual(enrichments, [{ address: '24 Sample Oak Lane, Example City, CA 90210', leadId: lead.id, expectedPropertyAddress: address, radiusMiles: 1 }]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    await page.goto(origin + '/leads');
    await page.getByRole('button', { name: 'Add seller', exact: true }).first().click();
    const form = page.getByRole('dialog', { name: 'Create lead' });
    const preview = form.getByRole('region', { name: 'ATTOM property preview' });
    await expect(form.getByText('Unsaved draft', { exact: true })).toBeVisible();
    const lookup = preview.getByRole('button', { name: 'Look up property' });
    await expect(lookup).toBeDisabled();
    await form.getByLabel('Seller name').fill('Manual seller');
    await form.getByLabel('Property address').fill(address.street);
    await expect(lookup).toBeDisabled();
    await form.getByLabel('City', { exact: true }).fill(address.city);
    await form.getByLabel('State', { exact: true }).fill(address.state);
    await form.getByLabel('ZIP', { exact: true }).fill(address.zip);
    const sqft = form.getByLabel('Sq ft', { exact: true });
    const beds = form.getByLabel('Beds', { exact: true });
    await sqft.fill('1600');
    // Snapshot all canonical form fields, not the saved-record search/filter controls.
    const readInputs = () => form.locator('.new-lead-portal-grid label:has(> span.font-medium) > :is(input,select,textarea)').evaluateAll((fields) => fields.map((field) => ({ label: field.parentElement.querySelector('span').textContent, value: field.value })));
    const before = await readInputs();
    assert.ok(before.length >= 20 && before.some(field => field.label === 'Seller name') && before.some(field => field.label === 'Sq ft'), 'Non-vacuous canonical field snapshot');
    await lookup.click();
    await expect(preview.getByText('Exact address match')).toBeVisible();
    await expect(preview.getByText('You typed', { exact: true }).first()).toBeVisible();
    assert.deepEqual(await readInputs(), before);
    await expect(beds).toHaveValue('');
    await sqft.fill('1700');
    await expect(preview.getByText('1,700 sq ft', { exact: true }).last()).toBeVisible();
    await expect(preview.locator('.pbk-attom-rows > div').filter({ has: page.getByText('Living area', { exact: true }) }).getByText('1,850 sq ft', { exact: true })).toBeVisible();
    if (process.env.PBK_PROPERTY_QA_SHOTS) {
      await preview.scrollIntoViewIfNeeded();
      await page.screenshot({ scale: 'css', path: join(evidenceDir, 'create-lead-preview-' + label + '.png') });
    }
    await preview.getByRole('button', { name: 'Run lookup again' }).click();
    await expect.poll(() => lookups.length).toBe(2);
    await expect(preview.getByRole('status')).toHaveText('Looking up property...');
    await form.getByLabel('Property address').fill(nextAddress.street);
    await expect(preview.getByText('Exact address match')).toHaveCount(0);
    const beforeRetry = await readInputs();
    await lookup.click();
    await expect(preview.getByRole('status')).toHaveText('ATTOM took too long to respond.');
    assert.deepEqual(await readInputs(), beforeRetry);
    await preview.getByRole('button', { name: 'Retry lookup' }).click();
    await expect(preview.getByText(nextProfile.address, { exact: true })).toBeVisible();
    const staleResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/property-data/attom-preview' &&
      response.request().postDataJSON()?.street === address.street);
    staleLookup.resolve();
    assert.equal(await (await staleResponse).finished(), null);
    await expect(preview.getByText(nextProfile.address, { exact: true })).toBeVisible();
    await expect(preview.getByText(profile.address, { exact: true })).toHaveCount(0);
    assert.deepEqual(await readInputs(), beforeRetry);
    await expect(sqft).toHaveValue('1700');
    await expect(form.getByRole('button', { name: 'Create lead', exact: true })).toBeInViewport();
    assert.ok(await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(form).toBeHidden();
    assert.deepEqual(lookups, [address, address, nextAddress, nextAddress]);
    assert.equal(enrichments.length, 1, 'Draft changes and tab navigation never repeat enrichment');
    assert.deepEqual(writes, []);
    assert.deepEqual(mediaRequests, []);
    assert.deepEqual(errors, []);
    console.log(label + ': property workspace, draft preservation, timeout recovery, and stale lookup isolation passed');
  } finally {
    staleLookup.resolve();
    await page.close();
  }
}

try {
  const browser = await chromium.launch();
  try {
    await verify(browser, { viewport: { width: 1440, height: 960 } }, 'desktop');
    const { viewport } = devices['iPhone 13'];
    await verify(browser, { viewport, isMobile: true, hasTouch: true }, 'mobile');
  } finally {
    await browser.close();
  }
  if (process.argv.includes('--webkit')) {
    const safari = await webkit.launch();
    try {
      await verify(safari, devices['iPhone 13'], 'webkit-mobile');
    } finally {
      await safari.close();
    }
  }
} finally {
  await server.close();
}
