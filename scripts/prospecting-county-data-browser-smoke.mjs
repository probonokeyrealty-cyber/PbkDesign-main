import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const check = expect.configure({ timeout: 15_000 });
const parcelHeader = 'AIN,Property Location\n';
const oversizedPrefix = Buffer.from(parcelHeader + '0123456789,');
const rejectedCsvs = [
  {
    name: 'oversized.csv',
    buffer: Buffer.concat([oversizedPrefix, Buffer.alloc(8 * 1024 * 1024 - oversizedPrefix.length, 120), Buffer.from('\n')]),
    error: 'Choose a CSV extract of 8 MB or less.',
  },
  {
    name: 'too-many-parcels.csv',
    buffer: Buffer.from(parcelHeader + Array.from({ length: 25_001 }, (_, i) =>
      String(i + 1).padStart(10, '0') + ',Synthetic Test Lane\n').join('')),
    error: 'Choose a CSV extract with no more than 25,000 records.',
  },
];
process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({
  envDir: false,
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({
    args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
  });
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
      serviceWorkers: 'block',
    });
    const forbidden = [];
    const errors = [];
    try {
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        if (url.origin !== origin) {
          if (!(request.resourceType() === 'stylesheet' && url.origin === 'https://fonts.googleapis.com')) forbidden.push(url.origin);
          return route.abort();
        }
        // Only the shell's synthetic bootstrap responses are allowed.
        if (path === '/api/state/stream/session' && request.method() === 'POST') return route.fulfill({ json: { ok: false } });
        if (request.method() === 'GET') {
          if (path === '/api/auth/team/status') return route.fulfill({ json: { ok: true, configured: false, authRequired: false } });
          if (/^\/(?:state|status|health|metrics|api\/(?:quotas|tooling\/status))$/.test(path)) return route.fulfill({ json: { ok: true } });
          if (!/^\/(?:api\/|\.netlify\/functions\/|invoke$|events$)/.test(path)) return route.continue();
        }
        forbidden.push(request.method() + ' ' + path);
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const response = await page.goto(origin + '/prospecting?view=county', { waitUntil: 'commit', timeout: 45_000 });
      assert.equal(response?.status(), 200);
      const county = page.getByRole('region', { name: 'County data' });
      const countyTab = page.getByRole('tab', { name: 'County data' });
      await county.waitFor({ state: 'visible', timeout: 90_000 });
      await check(countyTab).toHaveAttribute('aria-selected', 'true');
      await check(page.getByRole('tab', { name: 'Find Properties' })).toBeVisible();
      await check(page.getByRole('tab', { name: 'Saved evidence' })).toBeVisible();

      const search = county.getByRole('searchbox', { name: 'Search counties' });
      const preview = county.getByRole('region', { name: 'Local parcel preview' });
      await check(county.getByRole('heading', { name: 'Los Angeles County, CA' })).toBeVisible();
      await check(county.getByRole('link', { name: 'Monthly Parcels' })).toHaveAttribute('href', /egis-lacounty\.hub\.arcgis\.com/);
      await preview.getByLabel('Assessor CSV extract').setInputFiles({
        name: 'county-fixture.csv', mimeType: 'text/csv',
        buffer: Buffer.from('AIN,Property Location,Roll Year,Use Type,Owner Name\n' +
          '0123456789,"14 Sample Lane, Van Nuys, CA",2025,Residential,Private Name\n' +
          '0123456790,"15 Sample Lane, Van Nuys, CA",2024,Commercial,Private Name\n'),
      });
      const parcels = preview.getByRole('searchbox', { name: 'Search local parcels' });
      const results = preview.getByRole('list', { name: 'Local parcel results' });
      const shortlist = preview.getByRole('region', { name: 'Local shortlist' });
      await preview.getByLabel('Property use').selectOption('Residential');
      await check(results).toContainText('14 Sample Lane');
      await check(results).not.toContainText('15 Sample Lane');
      await preview.getByLabel('Roll year').selectOption('2024');
      await check(preview.getByText('No matching parcels.')).toBeVisible();
      await preview.getByLabel('Roll year').selectOption('2025');
      await parcels.fill('0123-456-789');
      await check(results).toContainText('14 Sample Lane');
      await check(preview.getByText('Private Name', { exact: true })).toHaveCount(0);
      await check(preview.getByText('Parcel matches are not contact permission.')).toBeVisible();
      const bookmark = preview.getByRole('button', { name: 'Shortlist AIN 0123456789' });
      await bookmark.click();
      await check(bookmark).toHaveAttribute('aria-pressed', 'true');
      await check(shortlist).toContainText('14 Sample Lane');
      await shortlist.getByRole('button', { name: 'Remove AIN 0123456789' }).click();
      await check(bookmark).toHaveAttribute('aria-pressed', 'false');
      await bookmark.click();
      await search.fill('22071');
      await check(county.getByRole('heading', { name: 'Orleans Parish, LA' })).toBeVisible();
      await check(county.getByText('Source review required')).toBeVisible();
      await check(preview).toHaveCount(0);
      await check(shortlist).toHaveCount(0);
      await county.getByRole('button', { name: 'Copy Rex research brief' }).click();
      await check(county.getByText('Brief copied for Brain.')).toBeVisible();
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Orleans Parish, LA \(FIPS 22071\)/);
      await search.fill('06037');
      await check(preview).toBeVisible();
      await check(parcels).toHaveCount(0);
      await check(shortlist).toHaveCount(0);
      assert.equal(await county.evaluate(pane => document.documentElement.scrollWidth > innerWidth + 1
        || pane.scrollWidth > pane.clientWidth + 1), false, 'County Data overflows at ' + width + 'px');
      await page.getByRole('tab', { name: 'Research', exact: true }).click();
      await check(county).toHaveCount(0);
      await countyTab.click();
      await check(preview).toBeVisible();
      await check(parcels).toHaveCount(0);

      const filePicker = preview.getByLabel('Assessor CSV extract');
      const clearFile = preview.getByRole('button', { name: 'Clear local file' });
      for (const { name, buffer, error } of rejectedCsvs) {
        await filePicker.setInputFiles({ name, mimeType: 'text/csv', buffer });
        await check(preview.getByRole('alert')).toHaveText(error);
        await check(clearFile).toBeVisible();
        await clearFile.click();
        await check(filePicker).toHaveValue('');
        await check(filePicker).toBeFocused();
        await check(preview.getByRole('alert')).toHaveCount(0);
        await check(clearFile).toHaveCount(0);
        await check(parcels).toHaveCount(0);
        await check(shortlist).toHaveCount(0);
      }
      console.log('County Data browser checks passed at ' + width + 'px.');
    } finally {
      await context.close();
      assert.deepEqual(forbidden, [], 'County Data must not access providers or send writes');
      assert.deepEqual(errors, [], 'No uncaught page errors');
    }
  }
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
