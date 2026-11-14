import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const base = new URL(process.argv[2] || 'http://127.0.0.1:5188');
assert(['127.0.0.1', 'localhost'].includes(base.hostname), 'Use a local Vite server.');
const address = '9966 Sunset Blvd, Beverly Hills, CA 90210';
const landAddress = '9921 Tower Ln, Beverly Hills, CA 90210';
const source = 'https://www.redfin.com/CA/Beverly-Hills/9966-Sunset-Blvd-90210/home/6822202';
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const lookups = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/property-data') {
      lookups.push([request.method(), url.search]);
      const land = url.searchParams.get('address') === landAddress;
      const hit = land || url.searchParams.get('address') === address;
      return route.fulfill({ json: {
        ok: hit,
        cache: { hit },
        propertyData: hit ? {
          source: 'apify-for-sale',
          data: {
            priceBasis: 'asking_price',
            askingPriceUsd: land ? 1995000 : 29995000,
            sourceLinks: [source, 'javascript:alert(1)', source],
            propertyType: land ? 'land' : 'house',
            listingFacts: land
              ? { lotSqft: 23531 }
              : { beds: 6, baths: 8, sqft: 9138, year: 1989, dom: 38, lotSqft: 46129 },
            photoUrls: ['https://ap.rdcpix.com/test-property.jpg'],
          },
          values: { arv: 29995000, comps: [{ soldPrice: 29995000 }] },
        } : null,
      } });
    }
    if (url.hostname === 'ap.rdcpix.com') {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="green"/></svg>' });
    }
    if (url.origin !== base.origin || /^\/(api\/|state$|health$|events$|invoke$)/.test(url.pathname)) {
      return route.fulfill({ json: {} });
    }
    return route.continue();
  });

  await page.goto(new URL('/analyzer', base).href);
  const addressInput = page.getByRole('textbox', { name: 'Address', exact: true });
  const listPrice = page.getByRole('spinbutton', { name: 'List price in dollars' });
  const arv = page.getByRole('spinbutton', { name: /^ARV Auto from comps/ });
  const comp = page.getByRole('spinbutton', { name: 'Comp A sold price' });
  await expect(page.getByRole('heading', { name: 'The deal.', exact: true })).toBeVisible();
  const soldComps = page.getByRole('region', { name: 'Comparable Sales (Mean = ARV)' });
  await expect(soldComps).toBeVisible();
  const withinPanel = () => soldComps.evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    return [...panel.querySelectorAll('input')].every((input) => {
      const field = input.getBoundingClientRect();
      return field.width > 0 && field.left >= bounds.left && field.right <= bounds.right;
    });
  });
  assert.equal(await withinPanel(), true, 'Sold comp inputs must fit on mobile.');
  await addressInput.fill(address);
  const arvBefore = await arv.inputValue();
  await page.getByRole('button', { name: 'Look up asking price' }).click({ timeout: 5000 });
  await expect(page.getByText('$29,995,000', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Redfin' })).toHaveAttribute('href', source);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(listPrice).toHaveValue('');
  await expect(arv).toHaveValue(arvBefore);
  await expect(comp).toHaveValue('');

  await arv.fill('2100000');
  await expect(arv).toHaveValue('2100000');
  assert.deepEqual(lookups, [['GET', '?' + new URLSearchParams({ address }).toString()]]);
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  const photo = page.getByRole('img', { name: 'Listing photo 1' });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Valuation', exact: true }).click();
  const beds = page.getByRole('spinbutton', { name: 'Bedrooms' });
  await beds.fill('7');
  await page.getByRole('button', { name: 'Fill empty fields' }).click();
  await expect(beds).toHaveValue('7');
  await expect(listPrice).toHaveValue('29995000');
  await expect(page.getByRole('spinbutton', { name: 'Bathrooms' })).toHaveValue('8');
  await expect(page.getByRole('spinbutton', { name: 'Square footage' })).toHaveValue('9138');
  await expect(page.getByRole('spinbutton', { name: 'Year built' })).toHaveValue('1989');
  await expect(page.getByRole('spinbutton', { name: 'Days on market' })).toHaveValue('38');
  await expect(arv).toHaveValue('2100000');
  await expect(comp).toHaveValue('');

  await addressInput.fill('99999 Unlisted Avenue, Beverly Hills, CA 90210');
  await expect(page.getByRole('link', { name: 'Redfin' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Look up asking price' }).click();
  await expect(page.getByText('No current Apify listing found for this address.')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await withinPanel(), true, 'Sold comp inputs must fit on desktop.');
  await addressInput.fill(landAddress);
  const compAddress = page.getByRole('textbox', { name: 'Comp A address', exact: true });
  const compDate = page.getByRole('textbox', { name: 'Comp A sold date', exact: true });
  await compAddress.fill('QA test comp');
  await comp.fill('2250000');
  await compDate.fill('Jan 2026');
  await expect(arv).toHaveValue('2250000');
  const compB = page.getByRole('spinbutton', { name: 'Comp B sold price' });
  await compB.fill('2750000');
  await expect(arv).toHaveValue('2500000');
  const readUnderwriting = () => page.locator('#deal-arv, input[aria-label^="Comp "]')
    .evaluateAll((inputs) => inputs.map((input) => [input.id || input.getAttribute('aria-label'), input.value]));
  const beforeLand = await readUnderwriting();
  await page.getByRole('button', { name: 'Land/Lot', exact: true }).click();
  const acres = page.getByRole('spinbutton', { name: 'Lot size in acres', exact: true });
  const fill = page.getByRole('button', { name: 'Fill empty fields', exact: true });
  await expect(acres).toHaveValue('');
  await page.getByRole('button', { name: 'Look up asking price' }).click();
  await expect(page.getByText(/Lot: 23,531 sq ft/)).toBeVisible();
  await fill.click();
  await expect(acres).toHaveValue('0.5402');
  await expect(listPrice).toHaveValue('29995000');
  await acres.fill('0.25');
  await listPrice.fill('');
  await fill.click();
  await expect(listPrice).toHaveValue('1995000');
  await expect(acres).toHaveValue('0.25');
  await acres.fill('');
  await fill.click();
  await expect(acres).toHaveValue('0.5402');
  await page.getByRole('button', { name: 'House', exact: true }).click();
  assert.deepEqual(await readUnderwriting(), beforeLand);
  console.log('Analyzer: responsive layout, house and land autofill, manual ARV, comp averaging, and unchanged underwriting passed.');
} finally {
  await browser.close();
}
