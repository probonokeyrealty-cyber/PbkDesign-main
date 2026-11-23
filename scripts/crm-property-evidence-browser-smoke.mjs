import assert from 'node:assert/strict';
import { chromium, webkit, devices, expect } from '@playwright/test';
import { preview } from 'vite';
import { readFileSync } from 'node:fs';
import { projectAttomMcpSection } from '../src/app/utils/attomMcpSections.mjs';
import { addDecisionScenario, normalizeDecisionScenario } from '../src/app/utils/investorDecisionBrief.mjs';
process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await preview({ build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 0 } });
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
const structuredAddress = { street: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip: '90210' };
const address = '24 Sample Oak Lane, Example City, CA 90210';
const photos = ['front', 'yard', 'broken'].map(x => `https://ap.rdcpix.com/crm-fixture-${x}.jpg`);
const otherPhoto = 'https://ap.rdcpix.com/crm-fixture-other.jpg';
const captured = '2026-11-17T12:00:00Z';
const sectionCaptured = '2026-11-15T12:00:00Z';
const savedDatasets = [
  projectAttomMcpSection('tax-history', [{ taxYear: 2025, tax: 2500, totalValue: 300000 }, { taxYear: 2024, tax: 2400, totalValue: 290000 }], 'ok', sectionCaptured),
  { ...projectAttomMcpSection('ownership', { names: ['Owner fixture alpha'], mailingAddress: 'Fictional mailing record', ownerOccupied: false }, 'ok', sectionCaptured), refreshStatus: { status: 'timed_out', checkedAt: captured } },
  projectAttomMcpSection('valuation', { valuation: { value: 375000, estimatedDate: '2026-10-01' } }, 'ok', captured),
  projectAttomMcpSection('permits', undefined, 'not_entitled', captured),
];
const sale = { id: 'sale-fixture', address: '86 Sample Cedar Drive, Example City, CA 90210', soldDate: '2026-11-12', price: 400000, distanceMiles: 0.5, beds: 3, baths: 2, sqft: 1600, pricePerSqft: 250, propertyType: 'Single family' };
sale.photoEvidence = { source: 'apify-for-sale', address: sale.address, retrievedAt: captured, photoUrls: ['https://ap.rdcpix.com/comp-fixture-front.jpg'], sourceLinks: [] };
const otherSale = { ...sale, id: 'other-sale', address: '59 Sample Fir Court, Example City, CA 90210', price: 520000, pricePerSqft: 325, photoEvidence: undefined };
const alternateSales = [2,3,4].map(n => ({...sale,id:`sale-${n}`,address:`${86+n} Sample Cedar Drive, Example City, CA 90210`,price:400000+n*10000,photoEvidence:n===2?{...sale.photoEvidence,address:sale.address}:undefined}));
const lead = { id: 'crm-evidence-fixture', leadId: 'crm-evidence-fixture', seller: { name: 'Fixture Seller' },
  property: { address: structuredAddress.street, city: structuredAddress.city, state: structuredAddress.state, zip: structuredAddress.zip, askingPrice: 450000, beds: 3, baths: 2, sqft: 1800, yearBuilt: 1995 },
  analyzer: { recordedSales: { provider: 'ATTOM', review: 'suggested', address: structuredAddress, retrievedAt: captured, windowStart: '2026-10-18', windowEnd: '2026-11-17', radiusMiles: 1, sales: [sale,...alternateSales] } },
  deal: {
    listingSnapshot: { source: 'apify-for-sale', address, retrievedAt: captured, askingPrice: 450000, photoUrls: photos, sourceLinks: ['https://www.realtor.com/realestateandhomes-detail/fixture'], facts: { beds: 3, baths: 2, sqft: 1800, year: 1995, dom: 12 } },
    propertyRecordSnapshot: { source: 'attom', address, retrievedAt: captured, fieldRetrievedAt: {legalDescription:'2026-11-16T12:00:00Z'}, facts: { address, latitude:34.1, longitude:-118.4, legalDescription:'Fixture legal description', coolingType:'Central', taxPerSizeUnit:2.5, grossSqft:2100, apn: 'FIXTURE-24', propertyType: 'Single family', livingSqft: 1700, beds: 4, baths: 2, yearBuilt: 1995, lotSqft: 6000, taxAmount: 2500, taxYear: 2025, recordedSaleAmount: 250000, recordedSaleDate: '2020-01-01' } },
  },
};
lead.deal.propertyRecordSnapshot.sections = savedDatasets;

// Intercept every API and remote image request; these checks never touch real leads or providers.
async function verify(engine, config, label) {
  const browser = await engine.launch(
    process.argv.includes('--chrome') ? { channel: 'chrome' } : {}
  );
  const page = await browser.newPage(config);
  const mutations = [], scenarioWrites = [], providerReads = [], canonicalReads = [], errors = [], unexpectedWrites = [];
  const fixture = structuredClone(lead), other = structuredClone(lead);
  other.id = other.leadId = 'crm-evidence-other';
  other.seller.name = 'Other Fixture Seller';
  other.deal.propertyRecordSnapshot.facts.apn = 'OTHER-LEAD-SAME-ADDRESS';
  other.deal.propertyRecordSnapshot.facts.livingSqft = 2100;
  other.deal.propertyRecordSnapshot.sections = [
    projectAttomMcpSection('ownership', { names: ['Other lead owner only'] }, 'ok', captured),
    projectAttomMcpSection('valuation', { valuation: { value: 490000, estimatedDate: '2026-10-01' } }, 'ok', captured),
  ];
  other.analyzer.recordedSales = {
    ...other.analyzer.recordedSales, review: 'operator-selected', selectedIds: [otherSale.id], sales: [otherSale],
  };
  other.deal.listingSnapshot.photoUrls = [otherPhoto];
  let mode = 'success';
  let expectedRefreshLead = fixture;
  try {
    await page.addInitScript(() => {
      const config = { endpoint: location.origin, apiKey: 'local-fixture' };
      localStorage.setItem('pbk:local:openclaw-config', JSON.stringify(config));
      window.PBK = { openclaw: { getConfig: () => config } };
      localStorage.setItem('pbk:prefs:v1', JSON.stringify({ theme: 'dark', tourCompleted: true }));
      // Exercise Ava's speech callback without a microphone or network speech service.
      window.SpeechRecognition = class {
        start() { window.deliverFixtureSpeech = transcript => this.onresult({
          results: [Object.assign([{ transcript }], { isFinal: true })],
        }); }
        stop() { delete window.deliverFixtureSpeech; }
      };
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      const bridgePath = url.searchParams.get('path') || path;
      const propertyLookup = /^\/api\/(?:v1\/)?property-data(?:\/|$)/.test(bridgePath) || /(^|\.)attom(?:data)?\.com$/i.test(url.hostname);
      if (propertyLookup && (url.origin !== origin || path !== '/api/property-data/enrich')) {
        providerReads.push({ path: bridgePath, method: request.method() });
        return route.fulfill({ json: { status: 'unavailable' } });
      }
      if (url.href === sale.photoEvidence.photoUrls[0]) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#253848"/></svg>' });
      if (photos.includes(url.href) || url.href === otherPhoto) return url.href.includes('broken') ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${url.href.includes('front') ? 120 : 800}" height="480"><rect width="800" height="480" fill="#253848"/></svg>` });
      if (url.origin !== origin) return route.abort();
      if (request.isNavigationRequest() && (path.startsWith('/leads/') || path === '/ava-chat')) return route.fulfill({ contentType: 'text/html', body: readFileSync('dist/index.shell.html', 'utf8') });
      if (!/^\/(api\/|state$|status$|events$|invoke$|health$|metrics$|\.netlify\/functions\/)/.test(path)) return route.continue();
      const send = json => route.fulfill({ json });
      if (path === '/api/state/stream/session') return send({ ok: false });
      if (path === '/api/property-data/enrich') {
        assert.equal(request.method(), 'POST');
        const body = request.postDataJSON();
        mutations.push({ path, body });
        assert.equal(body.leadId, expectedRefreshLead.id, 'Refresh captures exact lead ID even with duplicate addresses');
        assert.equal(body.address, address);
        assert.deepEqual(body.expectedPropertyAddress, structuredAddress);
        if (mode === 'failure') return route.fulfill({ status: 503, json: { ok: false, error: 'Controlled enrichment failure' } });
        if (mode === 'success') {
          fixture.deal.listingSnapshot.photoUrls = [photos[1]];
          fixture.deal.listingSnapshot.retrievedAt = '2026-11-18T12:00:00Z';
          fixture.deal.propertyRecordSnapshot.facts.livingSqft = 1900;
          fixture.deal.propertyRecordSnapshot.retrievedAt = '2026-11-18T12:00:00Z';
          fixture.analyzer.recordedSales = { ...fixture.analyzer.recordedSales, radiusMiles: body.radiusMiles, retrievedAt: '2026-11-18T12:00:00Z', sales: [{ ...sale, price: 410000 },...alternateSales] };
        }
        // Only canonical full-lead reload contains authoritative new snapshots.
        return send({ ok: true, saved: true, leadId: expectedRefreshLead.id, address, patch: {},
          records: mode === 'empty' ? { status: 'unavailable' } : {
            status: 'matched', profile: fixture.deal.propertyRecordSnapshot.facts,
            ...(mode === 'partial' ? { partial: true, sections: [
              savedDatasets[0],
              projectAttomMcpSection('ownership', undefined, 'timed_out', captured),
              projectAttomMcpSection('foreclosure-history', [], 'ok', captured),
              savedDatasets[3],
            ] } : {}),
          },
          listing: mode === 'success' ? {
            cache: { hit: true }, propertyData: { source: 'apify-for-sale', data: { photoUrls: [photos[1]] } },
          } : { cache: { hit: false }, propertyData: null },
          sales: mode === 'partial' ? { status: 'timed_out' } : mode === 'empty' ? { status: 'matched', sales: [] } :
            { status: 'matched', source: 'ATTOM', ...fixture.analyzer.recordedSales },
        });
      }
      if (path === '/api/leads/' + fixture.id && request.method() === 'PATCH') {
        const body = request.postDataJSON();
        if (body.investorDecisionScenario) {
          assert.deepEqual(body.expectedPropertyAddress, structuredAddress);
          assert.deepEqual(Object.keys(body).sort(), ['expectedPropertyAddress', 'investorDecisionScenario']);
          const scenario = normalizeDecisionScenario(body.investorDecisionScenario, captured);
          assert.ok(scenario);
          scenarioWrites.push({ path, scenario });
          fixture.deal.investorDecisionScenarios = addDecisionScenario(fixture.deal.investorDecisionScenarios ?? [], scenario);
          return send({ ok: true, scenario });
        }
        mutations.push({ path, body });
        assert.equal(body.actionSource, 'lead-comps-reviewed');
        assert.deepEqual(body.expectedPropertyAddress, structuredAddress);
        assert.deepEqual(body.analyzer.recordedSales.selectedIds, [sale.id]);
        assert.equal(body.deal.comps.A.price, 410000);
        assert.deepEqual(body.analyzer.recordedSales.sales[0].photoEvidence, sale.photoEvidence, 'Comp-specific photo evidence persists in the reviewed envelope');
        fixture.deal = { ...fixture.deal, ...body.deal };
        fixture.analyzer = { ...fixture.analyzer, ...body.analyzer };
        return send({ ok: true, lead: fixture });
      }
      if (request.method() !== 'GET') { unexpectedWrites.push(path); return route.abort(); }
      if (path === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
      if (path === '/api/leads') return send({ ok: true, leads: [fixture, other] });
      if (path === `/api/leads/${fixture.id}/full`) { canonicalReads.push(fixture.id); return send({ ok: true, lead: fixture }); }
      if (path === `/api/leads/${other.id}/full`) { canonicalReads.push(other.id); return send({ ok: true, lead: other }); }
      if (path === '/api/leads/fixture-alias/full') return send({ ok: true, lead: other });
      if (path === '/state') return send({ leadImports: [fixture, other] });
      return send({ ok: true, items: [] });
    });
    const workspace = page.getByRole('region', { name: 'Property', exact: true });
    const refreshResult = workspace.getByRole('region', { name: 'Property refresh result' });
    const tab = name => workspace.getByRole('tab', { name, exact: true }).click();
    const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' horizontal overflow');
    const assertSaved = async () => {
      await tab('Photos');
      await expect(workspace.getByRole('img', { name: 'Listing photo 1', exact: true })).toHaveAttribute('src', photos[1]);
      await expect(workspace.getByRole('tabpanel', {name:'Photos',exact:true}).locator('time[datetime="2026-11-18T12:00:00Z"]').first()).toBeVisible();
      await tab('Property record');
      await expect(workspace.locator('.pbk-attom-rows').getByText('1,900 sq ft', { exact: true })).toBeVisible();
      await expect(workspace.locator('time[datetime="2026-11-18T12:00:00Z"]').first()).toBeVisible();
      await tab('Comps');
      await expect(workspace.locator('td[data-label="Price"]').filter({hasText:/^\$410,000$/})).toBeVisible();
      await noOverflow();
    };
    await page.goto(origin + '/leads/' + fixture.id);
    await expect(workspace).toBeVisible({ timeout: 20000 });
    const overview = workspace.getByRole('tabpanel', { name: 'Overview' });
    const brief = workspace.getByRole('region', { name: 'Evidence brief.' });
    await expect(brief).toBeVisible();
    await expect(brief.getByText('3 populated datasets', { exact: true })).toBeVisible();
    await expect(brief.getByText('0 reviewed selections', { exact: true })).toBeVisible();
    await expect(brief.getByText('3 saved photos', { exact: true })).toBeVisible();
    await expect(brief.getByText('1 retained after a later refresh', { exact: true })).toBeVisible();
    await brief.getByRole('button', { name: 'Compare saved comps', exact: true }).press('Enter');
    await expect(workspace.getByRole('tab', { name: 'Comps', exact: true })).toBeFocused();
    await expect(workspace.getByRole('tabpanel', { name: 'Comps', exact: true })).toBeVisible();
    await tab('Overview');
    await brief.getByRole('button', { name: 'Review records', exact: true }).click();
    await expect(workspace.getByRole('tab', { name: 'Property record', exact: true })).toBeFocused();
    await tab('Overview');
    await brief.getByRole('button', { name: 'Review photos', exact: true }).click();
    await expect(workspace.getByRole('tab', { name: 'Photos', exact: true })).toBeFocused();
    await tab('Overview');
    await brief.getByRole('button', { name: 'Review comps', exact: true }).click();
    await expect(workspace.getByRole('tab', { name: 'Comps', exact: true })).toBeFocused();
    assert.deepEqual(mutations, [], 'Evidence brief navigation must not save or refresh');
    assert.deepEqual(providerReads, [], 'Evidence brief uses saved evidence only');
    await tab('Overview');
    await noOverflow();
    await brief.screenshot({ path: `output/property-evidence-brief-${label}.png` });
    await expect(overview.getByRole('img', { name: 'Listing photo 1', exact: true })).toBeVisible();
    await overview.getByRole('img', { name: 'Listing photo 1', exact: true }).scrollIntoViewIfNeeded();
    await expect(overview.getByText('Low-resolution source preview. Open the listing for more detail.', { exact: true })).toBeVisible();
    await overview.getByRole('button', { name: 'View photo 2', exact: true }).click();
    await expect(overview.getByRole('img', { name: 'Listing photo 2', exact: true })).toHaveAttribute('src', photos[1]);
    await expect(overview.getByRole('link', { name: 'Realtor.com', exact: true })).toHaveAttribute('href', lead.deal.listingSnapshot.sourceLinks[0]);
    await tab('Property record');
    await expect(workspace.getByText('ATTOM | Saved snapshot', { exact: true })).toBeVisible();
    await expect(workspace.locator('.pbk-attom-rows').getByText('1,700 sq ft', { exact: true })).toBeVisible();
    const recordPanel=workspace.getByRole('tabpanel',{name:'Property record',exact:true});
    const recordSearch=recordPanel.getByRole('searchbox',{name:'Search property record',exact:true});
    await recordSearch.fill('longitude');
    await expect(recordPanel.locator('.pbk-attom-record-groups:not(.pbk-record-datasets) .pbk-attom-facts dt')).toHaveText(['Longitude']);
    await expect(recordPanel.locator('.pbk-attom-record-groups:not(.pbk-record-datasets) .pbk-attom-facts').getByText('-118.4',{exact:true})).toBeVisible();
    await recordSearch.fill('legal description');
    await expect(recordPanel.getByText('Fixture legal description',{exact:true})).toBeVisible();
    await expect(recordPanel.locator('.pbk-attom-record-groups time[datetime="2026-11-16T12:00:00Z"]')).toBeVisible();
    await recordSearch.fill('Tax per sq ft');
    await expect(recordPanel.locator('.pbk-attom-record-groups:not(.pbk-record-datasets) .pbk-attom-facts').getByText('$2.50 / sq ft',{exact:true})).toBeVisible();
    await recordSearch.fill('Heating fuel');
    await expect(recordPanel.locator('.pbk-attom-record-groups:not(.pbk-record-datasets) .pbk-attom-facts dt')).toHaveText(['Heating fuel']);
    await expect(recordPanel.locator('.pbk-attom-record-groups:not(.pbk-record-datasets) .pbk-attom-facts').getByText('Not provided',{exact:true})).toBeVisible();
    await recordSearch.fill('no-such-record-field');
    await expect(recordPanel.getByText('No record fields match this search.',{exact:true})).toBeVisible();
    await recordSearch.fill('');
    const missing=recordPanel.getByRole('checkbox',{name:'Show missing fields',exact:true});
    await missing.check();await missing.uncheck();
    const parcelGroup=recordPanel.locator('summary').filter({hasText:'Parcel and building'});
    await parcelGroup.click();await parcelGroup.click();
    const datasets=recordPanel.getByRole('region',{name:'Saved property datasets',exact:true});
    const datasetSearch=datasets.getByRole('searchbox',{name:'Search saved datasets',exact:true});
    await datasetSearch.fill('Tax history');
    await expect(datasets.locator('details')).toHaveCount(1);
    await expect(datasets.getByText('$2,500',{exact:true})).toBeVisible();
    await expect(datasets.locator('time[datetime="2026-11-15T12:00:00Z"]').first()).toBeVisible();
    await datasets.getByRole('combobox',{name:'Filter saved dataset group'}).selectOption('History');
    await expect(datasets.locator('details')).toHaveCount(1);
    await datasets.getByRole('combobox',{name:'Filter saved dataset group'}).selectOption('all');
    await datasetSearch.fill('Ownership');
    await expect(datasets.getByText('Owner fixture alpha',{exact:true})).toBeVisible();
    await expect(datasets.getByText('Retained snapshot',{exact:true})).toBeVisible();
    await expect(datasets.getByText(/Earlier evidence retained; capture time unchanged/)).toBeVisible();
    await datasetSearch.fill('Permits');
    await expect(datasets.getByText('Not included in access',{exact:true})).toBeVisible();
    await datasetSearch.fill('no-such-dataset');
    await expect(datasets.getByText('No saved datasets match these filters.',{exact:true})).toBeVisible();
    await datasetSearch.fill('Valuation estimates');
    await expect(datasets.getByText('$375,000',{exact:true})).toBeVisible();
    await noOverflow();
    await datasets.scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/property-datasets-${label}.png`,fullPage:false});
    await datasetSearch.fill('');
    await noOverflow();
    await recordPanel.locator('.pbk-record-masthead').scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/property-record-${label}.png`,fullPage:false});
    await noOverflow(); await tab('Photos'); await noOverflow(); await tab('Comps');
    await expect(workspace.locator('td[data-label="Price"]').filter({hasText:/^\$400,000$/})).toBeVisible();
    await workspace.getByRole('combobox', { name: 'Radius' }).selectOption('2');
    await workspace.getByRole('combobox', { name: 'Sort' }).selectOption('price');
    await noOverflow();
    await workspace.getByRole('button', { name: 'Edit lead', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit complete seller profile' });
    await edit.getByRole('textbox', { name: 'Property address', exact: true }).fill('99 Unsubmitted Edit Street');
    await page.waitForTimeout(1000); // Cross the previous lookup debounce.
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(providerReads, [], 'Tabs, radius, sort and address edits must not read providers');
    assert.deepEqual(mutations, [], 'Passive browsing and cancelled edits must not persist');
    await expect(refreshResult).toHaveCount(0);
    let fullReadCount = canonicalReads.length;
    await workspace.getByRole('button', { name: 'Refresh property intelligence with selected radius', exact: true }).click();
    await expect(refreshResult.getByRole('status')).toHaveText('Property refresh complete');
    await expect(refreshResult.getByRole('list', { name: 'Updated' })).toContainText('Property record · 1 saved field changed.');
    await expect(refreshResult.getByRole('list', { name: 'Updated' })).toContainText('Listing photos · 1 photo saved from cache.');
    await expect(refreshResult.getByRole('list', { name: 'Updated' })).toContainText('Comparable sales · 4 sales now on file.');
    assert.equal(mutations.length, 1); assert.equal(mutations[0].body.radiusMiles, 2);
    assert.ok(canonicalReads.length > fullReadCount, 'Refresh reloads canonical saved lead');
    await assertSaved();
    fullReadCount = canonicalReads.length;
    await workspace.getByRole('checkbox', { name: 'Select comp ' + sale.address }).check();
    const comparison = workspace.getByRole('region', { name: 'Selected comp comparison' });
    await expect(comparison).toBeVisible();
    await expect(comparison.getByText('$410,000', {exact:true})).toBeVisible();
    await expect(comparison.getByText('1,600', {exact:true})).toBeVisible();
    await expect(comparison.getByText('0.50 mi', {exact:true})).toBeVisible();
    await expect(comparison.getByRole('img')).toHaveAttribute('src', sale.photoEvidence.photoUrls[0]);
    await comparison.getByRole('button', {name:'View photos for '+sale.address}).click();
    const photoViewer=page.getByRole('dialog',{name:'Property photos'});
    await expect(photoViewer).toBeVisible();
    await photoViewer.getByRole('button',{name:'Zoom in',exact:true}).click();
    await expect(photoViewer.getByLabel('Zoom level')).toHaveText('125%');
    await photoViewer.getByRole('button',{name:'Close photo viewer'}).click();
    assert.equal(mutations.length, 1, 'Selecting and viewing a comp must not save or refresh');
    for (const candidate of alternateSales.slice(0,2)) await workspace.getByRole('checkbox',{name:'Select comp '+candidate.address}).check();
    await expect(comparison.locator('article')).toHaveCount(3);
    await expect(workspace.getByRole('checkbox',{name:'Select comp '+alternateSales[2].address})).toBeDisabled();
    await expect(comparison.getByRole('img')).toHaveCount(1);
    if(config.viewport.width>720){
      const tops=await comparison.locator('article dl').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
      assert.ok(Math.max(...tops)-Math.min(...tops)<2,'Comparison metrics align across cards with and without photos');
    }
    await comparison.screenshot({path:`output/comp-comparison-${label}.png`});
    for (const candidate of alternateSales.slice(0,2)) await workspace.getByRole('checkbox',{name:'Select comp '+candidate.address}).uncheck();
    await noOverflow();
    await workspace.getByRole('button', { name: 'Save selected comps', exact: true }).click();
    await expect(workspace.getByText('Selected comps saved to this lead.', { exact: true })).toBeVisible();
    assert.ok(canonicalReads.length > fullReadCount, 'Reviewed comps reload canonical saved lead');
    assert.equal(fixture.analyzer.recordedSales.review, 'operator-selected');
    await page.reload(); await expect(workspace).toBeVisible(); await assertSaved();
    assert.equal(mutations.length, 2, 'Reloading evidence performs no enrichment or writes');
    await expect(workspace.getByRole('checkbox', { name: 'Select comp ' + sale.address })).toBeChecked();
    await expect(workspace.getByRole('region', { name: 'Selected comp comparison' }).getByRole('img')).toHaveAttribute('src', sale.photoEvidence.photoUrls[0]);
    await tab('Overview');
    await expect(brief.getByText('1 reviewed selection', { exact: true })).toBeVisible();
    await expect(brief.getByText('1 saved photo', { exact: true })).toBeVisible();
    assert.equal(mutations.length, 2, 'Viewing updated brief must not save or refresh');
    await page.getByRole('link', { name: 'Investor analysis', exact: true }).click();
    const investor = workspace.getByRole('tabpanel', { name: 'Investor', exact: true });
    await expect(page).toHaveURL(`${origin}/leads/${fixture.id}#lead-investor`);
    await expect(investor.getByText('$375,000', { exact: true })).toBeVisible();
    await expect(investor.getByText(sale.address, { exact: true })).toBeVisible();
    await expect(investor.getByText('$410,000', { exact: true })).toBeVisible();
    await expect(investor.getByText(otherSale.address, { exact: true })).toHaveCount(0);
    await expect(investor.locator('.pbk-investor-hero img')).toHaveAttribute('src', photos[1]);
    const strategy = investor.getByLabel('Choose a strategy');
    await expect(strategy.locator('option')).toHaveCount(12);
    await strategy.selectOption('wholesale');
    await investor.getByLabel('Purchase price', { exact: true }).fill('100000');
    await investor.getByLabel('Expected assignment fee').fill('5000');
    await investor.getByLabel('Total assignment expenses').fill('6000');
    await expect(investor.getByText('-$1,000', { exact: true })).toBeVisible();
    await expect(investor.getByText('$105,000', { exact: true })).toBeVisible();
    await investor.getByRole('button', { name: 'Open saved comps' }).click();
    await expect(workspace.getByRole('tab', { name: 'Comps', exact: true })).toBeFocused();
    await tab('Investor');
    await expect(investor.getByText('-$1,000', { exact: true })).toBeVisible();
    await noOverflow();
    await investor.locator('.pbk-investor-hero').evaluate(hero => {
      hero.style.scrollMarginTop = '116px';
      hero.scrollIntoView({ block: 'start' });
    });
    await page.screenshot({ path: `output/lead-investor-${label}.png` });
    await strategy.selectOption('owner-financing');
    for (const [name, amount] of [
      ['Purchase price', '150000'],
      ['Monthly gross rent', '1600'],
      ['Vacancy or revenue loss (%)', '0'],
      ['Monthly operating expenses', '200'],
      ['Monthly capital reserves', '50'],
      ['Down payment to seller', '30000'],
      ['Seller note interest rate (%)', '0'],
      ['Seller note amortization (months)', '120'],
      ['Months until balloon (0 for none)', '60'],
    ]) await investor.getByLabel(name, { exact: true }).fill(amount);
    await expect(investor.getByText('$60,000', { exact: true })).toBeVisible();
    await expect(investor.locator('.pbk-investor-outcomes').getByText('$350', { exact: true })).toBeVisible();
    await expect(investor.getByRole('region', { name: 'Scenario sensitivity' })).toBeVisible();
    const openAnalyzer = investor.getByRole('link', { name: 'Open Analyzer' });
    await expect(openAnalyzer).toHaveAttribute('href', `/deal/${fixture.id}#lead-investor`);
    await openAnalyzer.click();
    await expect(page).toHaveURL(`${origin}/deal/${fixture.id}#lead-investor`);
    await page.getByRole('link', { name: 'Back to lead', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/leads/${fixture.id}#lead-investor`);
    await expect(investor.getByText('$410,000', { exact: true })).toBeVisible();
    assert.equal(mutations.length, 2, 'Investor examples and navigation must not write or refresh');
    assert.deepEqual(providerReads, [], 'Investor views use saved evidence only');
    const decision = investor.getByRole('region', { name: 'Deal Decision Brief', exact: true });
    await decision.getByText('Scenario assumptions', { exact: true }).click();
    for (const [field, value] of [
      ['After-repair value ($)', '300000'], ['Rehab including contingency ($)', '30000'],
      ['Acquisition closing costs ($)', '5000'], ['Monthly holding costs ($)', '1000'],
      ['Holding period (months)', '6'], ['Selling costs (% of resale)', '6'], ['Minimum profit target ($)', '25000'],
    ]) await decision.getByRole('spinbutton', { name: field, exact: true }).fill(value);
    await expect(decision.getByText('$216,000', { exact: true })).toBeVisible();
    await expect(decision.getByText('$174,800', { exact: true })).toBeVisible();
    await expect(decision.getByText('-$250,200', { exact: true })).toBeVisible();
    await decision.getByText('Value evidence and comparable sales', { exact: true }).click();
    await decision.getByRole('combobox', { name: new RegExp(sale.address) }).selectOption('arv');
    await decision.getByRole('textbox', { name: 'Condition notes' }).fill('Renovated');
    await decision.getByRole('textbox', { name: 'Why it fits' }).fill('Similar floor plan');
    await decision.getByRole('textbox', { name: 'Lease comparable', exact: true }).fill('Nearby lease fixture');
    await decision.getByRole('spinbutton', { name: 'Monthly lease rent ($)', exact: true }).fill('1900');
    await decision.getByLabel('Lease date', { exact: true }).fill('2026-11-01');
    await decision.getByRole('textbox', { name: 'Lease source', exact: true }).fill('Fixture lease');
    await decision.getByRole('button', { name: 'Add lease comp', exact: true }).click();
    await expect(decision.getByText('Nearby lease fixture', { exact: true })).toBeVisible();
    await decision.getByText(/^Verification checklist/).click();
    await decision.getByRole('textbox', { name: 'Source or document reference' }).first().fill('Fixture bid');
    await decision.getByRole('textbox', { name: 'Owner', exact: true }).first().fill('QA operator');
    await decision.getByLabel('Due date', { exact: true }).first().fill('2026-12-01');
    await decision.getByRole('checkbox', { name: 'Verified', exact: true }).first().check();
    await noOverflow();
    assert.equal(scenarioWrites.length, 0, 'Editing decision assumptions never saves or refreshes');
    await decision.getByRole('textbox', { name: 'Scenario name', exact: true }).fill('Fixture flip');
    await decision.getByRole('button', { name: 'Save scenario to lead', exact: true }).click();
    await expect(decision.getByText('Scenario saved to this lead.', { exact: true })).toBeVisible();
    assert.equal(scenarioWrites.length, 1);
    assert.equal(scenarioWrites[0].scenario.comps[0].saleId, sale.id);
    assert.equal(scenarioWrites[0].scenario.comps[1].basis, 'rent');
    assert.equal(scenarioWrites[0].scenario.checks[0].verified, true);
    assert.equal(mutations.length, 2, 'Saving a scenario must not trigger property enrichment');
    const scenarioId = scenarioWrites[0].scenario.id;
    await page.reload();
    await expect(decision.getByRole('combobox', { name: 'Saved scenarios', exact: true })).toHaveValue(scenarioId);
    await expect(decision.getByText('$174,800', { exact: true })).toBeVisible();
    await expect(decision.getByText(/Saved property evidence changed/)).toHaveCount(0);
    await decision.evaluate(element => {
      element.style.scrollMarginTop = '116px';
      element.scrollIntoView({ block: 'start' });
    });
    await page.screenshot({ path: `output/lead-decision-brief-${label}.png` });
    await tab('Comps');
    mode = 'failure';
    const beforeFailure = structuredClone(fixture);
    await workspace.locator('.pbk-property-header').getByRole('button', { name: 'Refresh property intelligence', exact: true }).click();
    await expect(workspace.getByText(/Controlled enrichment failure/)).toBeVisible();
    assert.deepEqual(fixture, beforeFailure); await assertSaved();
    mode = 'partial';
    await workspace.locator('.pbk-property-header').getByRole('button', { name: 'Refresh property intelligence', exact: true }).click();
    await expect(refreshResult.getByRole('status')).toHaveText('Property refresh finished with gaps');
    const kept = refreshResult.getByRole('list', { name: 'Kept on file' });
    await expect(kept).toContainText('Property record checked · saved values stayed the same. ATTOM returned data for 1 of 4 sections.');
    await expect(kept).toContainText('Ownership · Previous evidence kept.');
    await expect(kept).toContainText('1 reviewed comp kept.');
    await expect(kept).toContainText('1 listing photo kept.');
    const gaps = refreshResult.getByRole('list', { name: 'Unavailable or incomplete' });
    await expect(gaps).toContainText('Foreclosure records · No records returned.');
    await expect(gaps).toContainText('Permit records · Outside account access.');
    await expect(gaps).toContainText('ATTOM comparable sales · Timed out.');
    await expect(gaps).toContainText('Listing photos · No matching photos returned from the listing cache.');
    await expect(refreshResult.getByRole('list', { name: 'Updated' })).toHaveCount(0);
    await noOverflow();
    await refreshResult.screenshot({ path: `output/property-refresh-${label}.png` });
    await assertSaved();
    assert.deepEqual(fixture, beforeFailure, 'Partial failure retains snapshots, timestamps and reviewed comps');
    fixture.deal.propertyRecordSnapshot.facts.taxAmount = 2600;
    await page.reload();
    await expect(decision.getByRole('combobox', { name: 'Saved scenarios', exact: true })).toHaveValue(scenarioId);
    await expect(decision.getByText(/Saved property evidence changed/)).toBeVisible();
    await expect(decision.getByText('$174,800', { exact: true })).toBeVisible();
    const beforeSwitch = mutations.length;
    await page.goto(origin + '/leads/' + other.id); await expect(workspace).toBeVisible();
    await expect(brief.getByText('2 populated datasets', { exact: true })).toBeVisible();
    await expect(brief.getByText('1 saved sale candidate', { exact: true })).toBeVisible();
    await expect(brief.getByText('1 reviewed selection', { exact: true })).toBeVisible();
    await tab('Property record');
    await expect(workspace.getByRole('tabpanel', {name:'Property record',exact:true}).locator('dd').filter({hasText:/^OTHER-LEAD-SAME-ADDRESS$/})).toBeVisible();
    await expect(workspace.locator('.pbk-attom-rows').getByText('2,100 sq ft', { exact: true })).toBeVisible();
    await tab('Overview');
    await brief.getByRole('button', { name: 'Review comps', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/leads/${other.id}`);
    await expect(workspace.getByRole('tab', { name: 'Comps', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(workspace.locator('td[data-label="Price"]').filter({hasText:/^\$520,000$/})).toBeVisible();
    await expect(workspace.locator('td[data-label="Price"]').filter({hasText:/^\$410,000$/})).toHaveCount(0);
    await tab('Property record');
    const otherDatasets=workspace.getByRole('region',{name:'Saved property datasets',exact:true});
    await otherDatasets.getByRole('searchbox',{name:'Search saved datasets',exact:true}).fill('Ownership');
    await expect(otherDatasets.getByText('Other lead owner only',{exact:true})).toBeVisible();
    await expect(otherDatasets.getByText('Owner fixture alpha',{exact:true})).toHaveCount(0);
    await tab('Investor');
    await expect(decision.getByRole('combobox', { name: 'Saved scenarios', exact: true }).locator('option')).toHaveCount(1);
    await expect(investor.getByLabel('Choose a strategy')).toHaveValue('fix-flip');
    await expect(investor.getByLabel('Purchase price', { exact: true })).toHaveValue('');
    await expect(investor.getByText('$490,000', { exact: true })).toBeVisible();
    await expect(investor.getByText(otherSale.address, { exact: true })).toBeVisible();
    await expect(investor.getByText('$520,000', { exact: true })).toBeVisible();
    await expect(investor.getByText('$375,000', { exact: true })).toHaveCount(0);
    await expect(investor.getByText('$410,000', { exact: true })).toHaveCount(0);
    await expect(investor.locator('.pbk-investor-hero img')).toHaveAttribute('src', otherPhoto);
    await noOverflow();
    assert.equal(mutations.length, beforeSwitch, 'Switching duplicate-address leads must not save');

    async function speak(command) {
      await page.getByRole('button', { name: 'Speak to Ava', exact: true }).click();
      await page.evaluate(transcript => window.deliverFixtureSpeech(transcript), command);
    }

    const savedPhoto = () => workspace.getByRole('tabpanel', { name: 'Photos', exact: true })
      .getByRole('img', { name: 'Listing photo 1', exact: true });

    for (const [current, price, absentPrice, photoUrl, parcel, absentParcel] of [
      [fixture, '$410,000', '$520,000', photos[1], 'FIXTURE-24', 'OTHER-LEAD-SAME-ADDRESS'],
      [other, '$520,000', '$410,000', otherPhoto, 'OTHER-LEAD-SAME-ADDRESS', 'FIXTURE-24'],
    ]) {
      const leadUrl = `${origin}/leads/${current.id}`;
      const chatUrl = `${origin}/ava-chat?leadId=${current.id}`;
      await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
      await page.getByRole('link', { name: `Open lead ${current.seller.name} at ${structuredAddress.street}`, exact: true }).click();
      await expect(page).toHaveURL(leadUrl);
      const sections = page.getByRole('navigation', { name: 'Lead workspace sections', exact: true });
      await expect(sections).toBeVisible();
      const readsBeforeShortcuts = canonicalReads.length;
      for (const [text, hash, selectedTab] of [
        ['Property record', 'record', 'Property record'],
        ['Saved comps', 'comps', 'Comps'],
        ['Property photos', 'photos', 'Photos'],
      ]) {
        const link = sections.getByRole('link', { name: text, exact: true });
        await expect(link).toHaveAttribute('href', `/leads/${current.id}#lead-${hash}`);
        assert.ok((await link.boundingBox()).height >= 44, 'Workspace shortcuts have 44px targets');
        await link.press('Enter');
        await expect(page).toHaveURL(`${leadUrl}#lead-${hash}`);
        await expect(workspace.getByRole('tab', { name: selectedTab, exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(workspace.getByRole('heading', { name: 'Property', exact: true })).toBeFocused();
        const panel = workspace.getByRole('tabpanel', { name: selectedTab, exact: true });
        if (hash === 'record') {
          await expect(panel.getByText(parcel, { exact: true }).first()).toBeVisible();
          await expect(panel.getByText(absentParcel, { exact: true })).toHaveCount(0);
        } else if (hash === 'comps') {
          await expect(panel.getByText(price, { exact: true }).first()).toBeVisible();
          await expect(panel.getByText(absentPrice, { exact: true })).toHaveCount(0);
        } else {
          await expect(savedPhoto()).toHaveAttribute('src', photoUrl);
        }
      }
      await page.goBack();
      await expect(page).toHaveURL(`${leadUrl}#lead-comps`);
      await expect(workspace.getByRole('tab', { name: 'Comps', exact: true })).toHaveAttribute('aria-selected', 'true');
      assert.equal(canonicalReads.length, readsBeforeShortcuts, 'Shortcuts only select the saved view');
      assert.equal(mutations.length, beforeSwitch, 'Shortcuts never refresh or save');
      await noOverflow();
      await page.getByRole('link', { name: 'Ask Ava about this lead' }).click();
      await expect(page).toHaveURL(chatUrl);

      await page.getByRole('link', { name: /^Open saved comps/ }).click();
      await expect(page).toHaveURL(`${leadUrl}#lead-comps`);
      const comps = workspace.getByRole('tabpanel', { name: 'Comps', exact: true });
      await expect(comps.getByText(price, { exact: true }).first()).toBeVisible();
      await expect(comps.getByText(absentPrice, { exact: true })).toHaveCount(0);
      await page.goBack();
      await page.getByRole('link', { name: /^Open property photos/ }).click();
      await expect(page).toHaveURL(`${leadUrl}#lead-photos`);
      await expect(savedPhoto()).toHaveAttribute('src', photoUrl);
      await expect.poll(() => savedPhoto().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      assert.equal(mutations.length, beforeSwitch, 'Ava evidence links must not refresh or save');

      await page.goBack();
      await expect(page).toHaveURL(chatUrl);
      await speak('Show saved comps');
      await expect(page).toHaveURL(`${leadUrl}#lead-comps`);
      await expect(comps.getByText(price, { exact: true }).first()).toBeVisible();
      await expect(comps.getByText(absentPrice, { exact: true })).toHaveCount(0);
      assert.equal(mutations.length, beforeSwitch, 'Spoken Comps must not refresh or save');

      await page.goBack();
      await expect(page).toHaveURL(chatUrl);
      await speak('Open property photos');
      await expect(page).toHaveURL(`${leadUrl}#lead-photos`);
      await expect(savedPhoto()).toHaveAttribute('src', photoUrl);
      await expect.poll(() => savedPhoto().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      assert.equal(mutations.length, beforeSwitch, 'Spoken Photos must not refresh or save');
    }

    const beforeLeadRefresh = canonicalReads.length;
    await page.getByRole('button', { name: 'Refresh lead', exact: true }).click();
    await expect.poll(() => canonicalReads.length).toBe(beforeLeadRefresh + 1);
    assert.equal(mutations.length, beforeSwitch, 'Refresh lead is a saved-data read');
    expectedRefreshLead = other;
    mode = 'empty';
    await workspace.getByRole('tabpanel', { name: 'Photos', exact: true })
      .getByRole('button', { name: 'Refresh property intelligence', exact: true }).click();
    await expect(refreshResult.getByRole('status')).toHaveText('Property refresh finished with gaps');
    await expect(gaps).toContainText('ATTOM comparable sales · No usable sales returned.');
    assert.deepEqual(mutations.slice(beforeSwitch), [{ path: '/api/property-data/enrich', body: {
      address, leadId: other.id, expectedPropertyAddress: structuredAddress, radiusMiles: 1,
    } }], 'Only Refresh sends one enrichment request for the currently open lead');
    await expect(savedPhoto()).toHaveAttribute('src', otherPhoto);
    await page.goto(`${origin}/leads/fixture-alias?source=fixture#lead-record`);
    await expect(page).toHaveURL(`${origin}/leads/${other.id}?source=fixture#lead-record`);
    await expect(workspace.getByRole('tab', { name: 'Property record', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(workspace.getByRole('tabpanel', { name: 'Property record', exact: true }).getByText('OTHER-LEAD-SAME-ADDRESS', { exact: true }).first()).toBeVisible();
    assert.equal(mutations.length, beforeSwitch + 1, 'Alias navigation must not refresh or save');
    assert.deepEqual(providerReads, [], 'Only explicit unified refresh may access providers');
    assert.deepEqual(unexpectedWrites, []); assert.deepEqual(errors, []); await noOverflow();
    console.log(label + ': Ava saved comps and photos, exact-lead scenarios, and explicit refresh passed');
  } finally { await browser.close(); }
}
try {
  await verify(chromium, { viewport: { width: 1440, height: 1000 } }, 'desktop');
  const chrome = process.argv.includes('--chrome');
  await verify(chrome ? chromium : webkit, { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, chrome ? 'mobile-chrome' : 'mobile-webkit');
  await verify(chromium, { viewport: { width: 320, height: 800 }, isMobile: true }, 'narrow');
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
