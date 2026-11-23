import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';

const outDir = resolve(process.env.PBK_MARKET_TEST_OUT_DIR || 'dist');
const shell = readFileSync(resolve(outDir, 'index.shell.html'), 'utf8');
const qaEntry = resolve(outDir, 'market-comparison-qa.html');
const qa91411Path = '/market-comparison-91411-qa.html';
const expectQa91411 = process.env.PBK_MARKET_TEST_91411_QA === '1';
const { portalEnvironment } = JSON.parse(readFileSync(resolve(outDir, 'pbk-build-manifest.json'), 'utf8'));
const expectStagingIndicators = process.env.PBK_MARKET_TEST_STAGING_INDICATORS === '1';
assert.equal(portalEnvironment, 'live');
assert.equal(existsSync(qaEntry), false, 'The offline QA page must not be shipped.');
assert.equal(existsSync(resolve(outDir, qa91411Path.slice(1))), expectQa91411,
  'The 91411 fixture must only be built for Preview #111.');
const server = await preview({
  configFile: false,
  build: { outDir },
  preview: { host: '127.0.0.1', port: 0 },
});
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const captured = '2026-11-17T12:00:00Z';

function lead(id, { zip = '90210', price = 640000, listingAddress, observed = captured, type = 'Single family', listingBeds = 3 } = {}) {
  const address = `24 Sample Oak Lane, Example City, CA ${zip}`;
  return {
    id, leadId: id, seller: { name: 'Fictional Market QA' },
    property: { address: '24 Sample Oak Lane', city: 'Example City', state: 'CA', zip, askingPrice: 999999, beds: 8, sqft: 2000, propertyType: type },
    deal: {
      listingSnapshot: { source: 'apify-for-sale', address: listingAddress ?? address, retrievedAt: observed, askingPrice: price, facts: { beds: listingBeds, sqft: 1600, dom: 34 } },
      propertyRecordSnapshot: { source: 'attom', address, retrievedAt: captured, facts: { address, apn: 'FICTIONAL-PARCEL', propertyType: type, livingSqft: 1700, recordedSaleAmount: 470000, recordedSaleDate: '2020-06-12' } },
    },
  };
}
const fixtures = [
  lead('market-comparison-fit'),
  lead('market-comparison-other-zip', { zip: '91401', price: 555000 }),
  lead('market-comparison-wrong-property', { listingAddress: '99 Other Road, Example City, CA 90210', price: 880000 }),
  lead('market-comparison-old', { observed: '2025-11-17T12:00:00Z', price: 590000 }),
  lead('market-comparison-condo', { type: 'Condominium' }),
  lead('market-comparison-other-beds', { listingBeds: 2 }),
  lead('market-comparison-missing-public', { zip: '00000' }),
  lead('market-comparison-leading-zero', { zip: '00601' }),
  lead('market-comparison-staging-indicators', { zip: '91411' }),
];

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  if (expectQa91411) {
    const qa = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const forbiddenQa = [];
    await qa.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin || request.method() !== 'GET' ||
          !['document', 'script', 'stylesheet', 'font', 'image'].includes(request.resourceType())) {
        forbiddenQa.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    await qa.routeWebSocket('**/*', socket => {
      forbiddenQa.push('WebSocket');
      socket.close();
    });
    await qa.goto(origin + qa91411Path);
    await expect(qa.getByRole('heading', { name: '91411 Market Comparison QA' })).toBeVisible();
    await expect(qa.getByText(/Fictional property. Read-only./)).toBeVisible();
    const income = qa.getByRole('region', { name: 'Census ZCTA 91411 income', exact: true });
    const county = qa.getByRole('region', { name: 'Los Angeles County unemployment', exact: true });
    await expect(income.getByText('$74,617', { exact: true })).toBeVisible();
    await expect(income.getByText('90% range: $68,141 to $81,093', { exact: true })).toBeVisible();
    await expect(county.getByText('5.0%', { exact: true })).toBeVisible();
    await expect(county).toContainText('FIPS 06037');
    await expect(county).toContainText('December 2025');
    assert.ok(await county.evaluate(card =>
      innerWidth === 390 && document.documentElement.scrollWidth <= innerWidth
      && card.scrollWidth <= card.clientWidth
      && card.previousElementSibling.scrollWidth <= card.previousElementSibling.clientWidth
      && card.getBoundingClientRect().top >= card.previousElementSibling.getBoundingClientRect().bottom
    ));
    const trends = qa.getByRole('region', { name: 'Market trends' });
    await expect(trends.getByText('Fictional market data', { exact: true })).toBeVisible();
    const month = trends.getByRole('slider', { name: 'Inspect month' });
    await expect(month).toHaveAttribute('aria-valuetext', 'Oct 2026');
    await trends.getByRole('button', { name: 'Inventory change' }).click();
    await expect(trends.getByText('Year over year, %', { exact: true })).toBeVisible();
    await trends.getByRole('button', { name: '6M' }).click();
    await trends.getByText('View data table', { exact: true }).click();
    await expect(trends.locator('tbody tr')).toHaveCount(6);
    await expect(trends.locator('tbody tr[aria-current=true]')).toContainText('Oct 2026');
    await trends.getByRole('button', { name: '2Y' }).click();
    await month.press('Home');
    for (let i = 0; i < 15; i++) await month.press('ArrowRight');
    await expect(trends.locator('tbody tr[aria-current=true]')).toContainText('Unavailable');
    await expect(trends.getByRole('link', { name: /Reventure research hub/ })).toHaveAttribute('href', 'https://blog.reventure.app/graph');

    assert.deepEqual(forbiddenQa, [], 'The standalone QA fixture must not request any API or external asset.');
    console.log('Preview #111 fixture: separate ZIP and county charts at 390px; static requests only');
    await qa.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const forbidden = [];
  await page.addInitScript(() => {
    const config = { endpoint: location.origin, apiKey: 'local-fixture' };
    localStorage.setItem('pbk:local:openclaw-config', JSON.stringify(config));
    localStorage.setItem('pbk:prefs:v1', JSON.stringify({ theme: 'dark', tourCompleted: true }));
    window.PBK = { openclaw: { getConfig: () => config } };
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const bridgePath = url.searchParams.get('path') || url.pathname;
    // The shell tries to negotiate a read stream on boot. No session is created.
    if (url.origin === origin && url.pathname === '/api/state/stream/session' && request.method() === 'POST') {
      return route.fulfill({ json: { ok: false } });
    }
    const providerRead = /(?:^|\/)(?:property-data|salestrend|market-comparison|attom)(?:\/|$)/i.test(bridgePath)
      || /(^|\.)attom(?:data)?\.com$/i.test(url.hostname);
    if (request.method() !== 'GET' || providerRead) {
      forbidden.push(`${request.method()} ${bridgePath}`);
      return route.abort();
    }
    if (url.origin !== origin) return route.abort();
    if (request.isNavigationRequest() && (url.pathname === '/leads' || url.pathname.startsWith('/leads/'))) {
      return route.fulfill({ contentType: 'text/html', body: shell });
    }
    const send = json => route.fulfill({ json });
    if (url.pathname === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
    if (url.pathname === '/api/leads') return send({ ok: true, leads: fixtures });
    const match = fixtures.find(entry => url.pathname === `/api/leads/${entry.id}/full`);
    if (match) return send({ ok: true, lead: match });
    if (url.pathname === '/state') return send({ leadImports: fixtures });
    if (url.pathname.startsWith('/api/')) return send({ ok: false, items: [] });
    return route.continue();
  });

  await page.goto(origin + '/leads');
  await expect(page.getByRole('heading', { name: 'Seller leads.' })).toBeVisible();
  const qaLink = page.getByRole('link', { name: '91411 QA fixture (read-only)', exact: true });
  if (expectQa91411) {
    await expect(qaLink).toBeVisible();
    await expect(qaLink).toHaveAttribute('href', qa91411Path);
    assert.ok(await qaLink.evaluate(link => {
      const bounds = link.getBoundingClientRect();
      return innerWidth === 390 && bounds.left >= 0 && bounds.right <= innerWidth;
    }), 'The link must fit within the 390px viewport.');
    await qaLink.click();
    await expect(page).toHaveURL(origin + qa91411Path);
    await expect(page.getByRole('heading', { name: '91411 Market Comparison QA' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Census ZCTA 91411 income' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Los Angeles County unemployment' })).toBeVisible();
  } else {
    await expect(qaLink).toHaveCount(0);
  }

  const workspace = page.getByRole('region', { name: 'Property', exact: true });
  const market = workspace.getByRole('tab', { name: 'Market Comparison', exact: true });
  const panel = workspace.getByRole('tabpanel', { name: 'Market Comparison', exact: true });
  const row = name => panel.getByRole('article', { name, exact: true });
  async function open(id) {
    await page.goto(`${origin}/leads/${id}#lead-investor`);
    await expect(workspace.getByRole('tab', { name: 'Investor', exact: true })).toHaveAttribute('aria-selected', 'true');
    const requests = [];
    const track = request => {
      if (['fetch', 'xhr', 'eventsource'].includes(request.resourceType())) requests.push(request.method());
    };
    page.on('request', track);
    try {
      await market.click({ timeout: 5000 });
      await expect(panel.getByRole('heading', { name: 'House vs. ZIP' })).toBeVisible();
      await expect(panel.getByText('Fictional ZIP benchmarks', { exact: true })).toBeVisible();
      assert.deepEqual(requests, [], 'Opening Market Comparison must not request data.');
    } finally {
      page.off('request', track);
    }
  }

  await open(fixtures[0].id);
  {
    const tabs = await workspace.getByRole('tab').allTextContents();
    assert.equal(tabs[tabs.indexOf('Investor') + 1], 'Market Comparison');
    await expect(row('Asking price')).toContainText('$640,000');
    await expect(row('Asking price')).toContainText('$695,000');
    await expect(row('Asking price').getByText('Saved house', { exact: true })).toBeVisible();
    await expect(row('Asking price').getByText('Fictional ZIP median', { exact: true })).toBeVisible();
    await expect(row('Asking price')).toContainText('7.9% below');
    await expect(row('Asking price per sq ft')).toContainText('$400');
    await expect(row('Active days listed')).toContainText('7 days more');
    await expect(row('Three-bedroom asking rent')).toContainText('No saved subject asking rent');
    await expect(row('Three-bedroom asking rent')).toContainText('$3,200');
    await expect(panel.getByText('$999,999', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('$470,000', { exact: true })).toBeVisible();
    await expect(workspace.getByRole('button', { name: /refresh property intelligence|edit lead/i })).toHaveCount(0);
    await expect(workspace.getByRole('link', { name: 'Open on Zillow' })).toHaveCount(0);
    const details = panel.getByText('Sources and limits', { exact: true });
    await details.focus();
    await details.press('Enter');
    assert.equal(await details.evaluate(summary => summary.parentElement.open), true);
    assert.ok(await page.evaluate(() => innerWidth === 390 && document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await panel.locator('.pbk-market-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length), 1);
    if (process.env.PBK_MARKET_SCREENSHOT) {
      await panel.getByRole('heading', { name: 'House vs. ZIP' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.PBK_MARKET_SCREENSHOT, fullPage: true });
    }

    await open(fixtures[1].id);
    await expect(row('Asking price')).toContainText('$555,000');
    await expect(panel.getByText('No fictional cohort matches this ZIP and property type.')).toBeVisible();
    await expect(panel.getByText('$695,000', { exact: true })).toHaveCount(0);
    const publicContext = panel.getByRole('region', { name: 'Public housing context' });
    const evidenceSection = panel.getByRole('region', { name: 'Saved property evidence' });
    await expect(publicContext.getByText('Census ZCTA 91401', { exact: true })).toBeVisible();
    await expect(evidenceSection.getByText('Fictional ZIP benchmarks', { exact: true })).toBeVisible();
    assert.ok(
      await panel.evaluate(element => {
        const publicData = element.querySelector('[aria-label="Public housing context"]');
        const evidence = element.querySelector('[aria-label="Saved property evidence"]');
        return publicData && evidence &&
          Boolean(publicData.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING);
      })
    );
    await expect(publicContext.getByText('$1,881', { exact: true })).toBeVisible();
    await expect(publicContext.getByText('$1,047,700', { exact: true })).toBeVisible();
    const savedListing = publicContext.getByRole('complementary', { name: 'Saved listing reference' });
    const censusSurvey = publicContext.getByRole('region', { name: 'Census survey' });
    await expect(savedListing).toContainText('$555,000');
    await expect(savedListing).toContainText('Captured Nov 17, 2026');
    await expect(censusSurvey.getByText('$555,000', { exact: true })).toHaveCount(0);
    await expect(censusSurvey.locator('.pbk-market-snapshot-band')).toHaveCount(2);
    await expect(censusSurvey.locator('.pbk-market-snapshot-point')).toHaveCount(2);
    await expect(censusSurvey.getByText('90% range: $1,838 to $1,924', { exact: true })).toBeVisible();
    if (process.env.PBK_MARKET_CHART_SCREENSHOT) {
      await censusSurvey.scrollIntoViewIfNeeded();
      await censusSurvey.screenshot({ path: process.env.PBK_MARKET_CHART_SCREENSHOT });
    }
    await expect(publicContext.getByText(/90% margin of error: \$43/)).toBeVisible();
    await expect(publicContext.getByText('FHFA ZIP 91401', { exact: true })).toBeVisible();
    await expect(publicContext.getByText('Annual house price index change (2025)', { exact: true })).toBeVisible();
    await expect(publicContext.getByText('-0.26%', { exact: true })).toBeVisible();
    await expect(publicContext.getByText('3 of 3 measures available', { exact: true })).toBeVisible();
    await expect(publicContext.getByText(/The FHFA index fell in 2025/)).toBeVisible();
    await publicContext.getByText('Read the Census estimates', { exact: true }).click();
    await expect(publicContext.getByText('$1,838 to $1,924', { exact: true })).toBeVisible();
    await expect(publicContext.getByText('Margin is 2.3% of the estimate.', { exact: true })).toBeVisible();

    await publicContext.getByText('Compare another ZIP', { exact: true }).click();
    await publicContext.getByRole('textbox', { name: 'Comparison ZIP' }).fill('01001');
    await publicContext.getByRole('button', { name: 'Compare', exact: true }).click();
    const comparison = publicContext.getByRole('region', { name: 'Comparison with 01001' });
    await expect(comparison.getByText('ZCTA 01001', { exact: true }).first()).toBeVisible();
    await expect(comparison.getByText('$1,248 to $1,388', { exact: true })).toBeVisible();
    await expect(comparison.getByText(/not a statistical significance test/).first()).toBeVisible();
    await publicContext.getByRole('textbox', { name: 'Comparison ZIP' }).fill('02838');
    await publicContext.getByRole('button', { name: 'Compare', exact: true }).click();
    const mixedYears = publicContext.getByRole('region', { name: 'Comparison with 02838' });
    await expect(mixedYears.getByText('ZIP 02838 · 2024', { exact: true })).toBeVisible();
    await expect(mixedYears.getByText('-8.33%', { exact: true })).toBeVisible();
    await expect(mixedYears.getByText(/Different observation years/)).toBeVisible();
    await expect(mixedYears.getByText(/intervals overlap/).first()).toBeVisible();
    assert.ok(await mixedYears.evaluate(element => element.scrollWidth <= element.clientWidth));
    await publicContext.getByRole('textbox', { name: 'Comparison ZIP' }).fill('00000');
    await publicContext.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(publicContext.getByText('No public housing observations are available for 00000.', { exact: true })).toBeVisible();
    await expect(mixedYears).toHaveCount(0);
    await publicContext.getByRole('textbox', { name: 'Comparison ZIP' }).fill('01001');
    await publicContext.getByRole('button', { name: 'Compare', exact: true }).press('Enter');
    await expect(comparison).toBeVisible();
    await expect(publicContext.getByText('No public housing observations are available for 00000.', { exact: true })).toHaveCount(0);
    await publicContext.getByRole('textbox', { name: 'Comparison ZIP' }).fill('91401');
    await publicContext.getByRole('button', { name: 'Compare', exact: true }).press('Enter');
    await expect(publicContext.getByText('Choose a ZIP other than the saved lead ZIP.', { exact: true })).toBeVisible();
    await expect(comparison).toHaveCount(0);
    await expect(publicContext.getByRole('region', { name: 'Comparison with 91401' })).toHaveCount(0);
    await expect(publicContext.getByText('$1,838 to $1,924', { exact: true })).toBeVisible();
    assert.ok(await publicContext.evaluate(element => {
      return innerWidth === 390 && document.documentElement.scrollWidth <= 390
        && element.scrollWidth <= element.clientWidth;
    }));

    await open(fixtures[2].id);
    await expect(row('Asking price')).toContainText('Not captured');
    await expect(panel.getByText('$880,000', { exact: true })).toHaveCount(0);

    await open(fixtures[3].id);
    await expect(row('Asking price')).toContainText('$590,000');
    await expect(panel.getByText('The saved listing was captured outside the fictional benchmark window.')).toBeVisible();
    await expect(panel.getByText(/% (above|below) fictional/)).toHaveCount(0);

    await open(fixtures[4].id);
    await expect(panel.getByText('No fictional cohort matches this ZIP and property type.')).toBeVisible();

    await open(fixtures[5].id);
    await expect(row('Three-bedroom asking rent')).toContainText('Unavailable');
    await expect(row('Three-bedroom asking rent')).not.toContainText('$3,200');

    await open(fixtures[6].id);
    await expect(publicContext.getByText('0 of 3 measures available', { exact: true })).toBeVisible();
    await expect(publicContext.getByText('Unavailable', { exact: true })).toHaveCount(3);
    await expect(censusSurvey.locator('.pbk-market-snapshot-chart')).toHaveCount(0);
    await open(fixtures[7].id);
    await expect(publicContext.getByText('Census ZCTA 00601', { exact: true })).toBeVisible();
    await expect(publicContext.getByText('$427', { exact: true })).toBeVisible();

    const indicators = panel.getByRole('region', { name: 'Staging market indicators', exact: true });
    await expect(indicators).toHaveCount(0);
    await open(fixtures[8].id);
    if (expectStagingIndicators) {
      const income = indicators.getByRole('region', { name: 'Census ZCTA 91411 income', exact: true });
      const unemployment = indicators.getByRole('region', { name: 'Los Angeles County unemployment', exact: true });
      await expect(income.getByText('$74,617', { exact: true })).toBeVisible();
      await expect(income.getByText('90% range: $68,141 to $81,093', { exact: true })).toBeVisible();
      await expect(income).toContainText('2024 dollars');
      await expect(income.locator('.pbk-market-snapshot-band')).toBeVisible();
      await expect(unemployment.getByText('5.0%', { exact: true })).toBeVisible();
      await expect(unemployment).toContainText('December 2025');
      await expect(unemployment).toContainText('Not seasonally adjusted');
      await expect(unemployment).toContainText('FIPS 06037');
      await expect(unemployment.getByRole('meter')).toHaveAttribute('value', '5');
      await expect(unemployment).toContainText('not a ZIP or property-level rate');
      assert.ok(await indicators.evaluate(section => {
        const cards = Array.from(section.querySelectorAll('section[aria-label]'));
        return innerWidth === 390 && document.documentElement.scrollWidth <= innerWidth
          && cards.length === 2 && cards.every(card => card.scrollWidth <= card.clientWidth)
          && cards[1].getBoundingClientRect().top >= cards[0].getBoundingClientRect().bottom;
      }));
      if (process.env.PBK_MARKET_INDICATOR_SCREENSHOT) {
        await indicators.screenshot({ path: process.env.PBK_MARKET_INDICATOR_SCREENSHOT });
      }
      await open(fixtures[7].id);
      await expect(indicators).toHaveCount(0);
    } else {
      await expect(indicators).toHaveCount(0);
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await open(fixtures[1].id);
    await expect(publicContext.getByText('Census ZCTA 91401', { exact: true })).toBeVisible();
    assert.ok(await publicContext.evaluate(element => {
      const summary = element.querySelector('.pbk-market-summary');
      return innerWidth === 1280 && document.documentElement.scrollWidth <= innerWidth
        && element.scrollWidth <= element.clientWidth
        && getComputedStyle(summary).gridTemplateColumns.split(' ').length === 2;
    }));
  }
  assert.deepEqual(forbidden, []);
  console.log(`Chrome 390px and 1280px: staging indicators ${expectStagingIndicators ? 'visible only for ZCTA 91411' : 'disabled'}, no provider lookups or mutations`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
