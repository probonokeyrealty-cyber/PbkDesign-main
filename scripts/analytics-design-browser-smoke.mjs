import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const lead = {
  id: 'fixture-deal',
  name: 'Fixture seller',
  address: 'Fixture address',
  revenue: 18000,
};
const generatedAt = '2026-10-28T18:00:00Z';

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({
      ...device,
      viewport,
      timezoneId: 'America/Los_Angeles',
      acceptDownloads: true,
    });
    const requests = [];
    let failAttribution = false;
    let failTimeline = false;
    let supportsYtd = false;
    let holdNinety;
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === '/api/state/stream/session') return route.fulfill({ status: 503, json: {} });
      if (request.method() !== 'GET') return route.fulfill({ status: 405, json: {} });
      const range = url.searchParams.get('range');
      const days = url.searchParams.get('days');
      if (
        [
          '/api/leads/stages',
          '/api/deals/timeline',
          '/api/observability/ai-metrics',
          '/api/analytics/campaign-drilldown',
        ].includes(path)
      ) {
        requests.push({ path, range, days });
      }
      if (path === '/api/deals/timeline' && failTimeline) {
        return route.fulfill({ status: 503, json: { error: 'Fixture timeline offline' } });
      }
      if (path === '/api/deals/timeline' && days === '90' && holdNinety) await holdNinety;
      if (path === '/api/analytics/campaign-drilldown' && failAttribution) {
        return route.fulfill({ status: 503, json: { error: 'Fixture attribution offline' } });
      }
      const revenue =
        range === 'ytd' ? 42000 : days === '7' ? 18000 : days === '90' ? 33000 : 25000;
      const timeline =
        days === '7'
          ? [{ day: '2026-10-28', count: 1, revenue, leads: [lead] }]
          : Array.from({ length: 18 }, (_, i) => ({
              day: `2026-10-${String(i + 11).padStart(2, '0')}`,
              count: i === 0 ? 0 : i === 17 ? 2 : 1,
              revenue: i === 17 ? revenue : 0,
              leads: i === 17 ? [lead] : [],
            }));
      const fixture = {
        '/api/leads/stages': {
          stages: [
            { stage: 'contacted', label: 'Contacted', total: 20, leads: [lead] },
            { stage: 'closed', label: 'Closed', total: 2, revenue: 18000, leads: [lead] },
          ],
        },
        '/api/deals/timeline': { days: timeline },
        '/api/observability/ai-metrics': {
          metrics: {
            p95LatencyMs: 1200,
            qaRetryRate: 0.05,
            safetyBlocks: 3,
            aiSpendUsd: 100,
          },
        },
        '/api/analytics/campaign-drilldown': {
          summary: { leads: 1, replied: 1, replyRate: 50, connectRate: 0 },
          rows: [
            {
              id: 'fixture-attribution',
              source: 'Fixture source',
              channel: 'sms',
              sent: true,
              replied: true,
            },
          ],
        },
      }[path];
      if (fixture)
        return route.fulfill({
          json: {
            ok: true,
            source: 'fixture',
            generatedAt,
            ...(range === 'ytd' && supportsYtd ? { range } : {}),
            ...fixture,
          },
        });
      if (url.origin !== origin || /^\/(api\/|health$|events$)/.test(path))
        return route.fulfill({ json: { ok: true } });
      return route.continue();
    });

    await page.goto(`${origin}/analytics`);
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
    const period = (name) => page.getByRole('button', { name, exact: true });
    const summary = page.getByRole('region', { name: 'Key metrics' });
    const revenue = () =>
      summary.locator('.pbk-analytics-stat').filter({ hasText: 'Deal revenue' });
    await expect(period('30D')).toHaveAttribute('aria-pressed', 'true');
    await expect(revenue()).toContainText('$25,000');
    await expect(summary).toContainText('250x');
    await expect(summary).toContainText('10% close rate');
    await expect(page.getByText('Fixture source', { exact: true })).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    if (process.env.PBK_ANALYTICS_SCREENSHOTS === '1') {
      await page.screenshot({
        path: `.pbk-local/analytics-${engine.name()}-${viewport.width}.png`,
        fullPage: true,
      });
    }

    const stage = page.getByRole('button', { name: 'Open Contacted drill-down' });
    await stage.click();
    const stageDialog = page.getByRole('dialog', { name: 'Contacted' });
    await expect(stageDialog).toContainText('20 total');
    await expect(stageDialog).toContainText('Fixture seller');
    await page.keyboard.press('Escape');
    await expect(stageDialog).toBeHidden();
    await expect(stage).toBeFocused();

    await period('7D').click();
    await expect(revenue()).toContainText('$18,000');
    await expect(summary).toContainText('180x');
    assert(requests.some(({ path, days }) => path === '/api/deals/timeline' && days === '7'));
    assert(
      requests.some(({ path, days }) => path === '/api/observability/ai-metrics' && days === '7')
    );
    assert(
      requests.some(
        ({ path, range }) => path === '/api/analytics/campaign-drilldown' && range === '7d'
      )
    );
    await page.getByRole('button', { name: /Open daily deals for .*Oct 28/ }).click();
    const dealDialog = page.getByRole('dialog', { name: /Deals closed.*Oct 28/ });
    await expect(dealDialog).toContainText('$18,000');
    const downloadPromise = page.waitForEvent('download');
    await dealDialog.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    const csv = await readFile(await download.path(), 'utf8');
    assert.match(csv, /daily_deals,2026-10-28,1,18000/);
    assert.doesNotMatch(csv, /25000/);
    if (process.env.PBK_ANALYTICS_SCREENSHOTS === '1') {
      await page.screenshot({
        path: `.pbk-local/analytics-drill-${engine.name()}-${viewport.width}.png`,
      });
    }
    await dealDialog.getByRole('button', { name: 'Close drill-down' }).click();

    let releaseNinety;
    holdNinety = new Promise((resolve) => {
      releaseNinety = resolve;
    });
    await period('90D').click();
    await expect
      .poll(() =>
        requests.some(({ path, days }) => path === '/api/deals/timeline' && days === '90')
      )
      .toBe(true);
    await period('YTD').click();
    await expect(
      page.getByText('The bridge did not confirm the year-to-date range.')
    ).toBeVisible();
    await expect(revenue()).not.toContainText('$42,000');
    supportsYtd = true;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(revenue()).toContainText('$42,000');
    const ninetyResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/deals/timeline' && url.searchParams.get('days') === '90';
    });
    releaseNinety();
    await (await ninetyResponse).finished();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    await expect(revenue()).toContainText('$42,000');
    assert(requests.some(({ path, range }) => path === '/api/deals/timeline' && range === 'ytd'));
    assert(
      requests.some(
        ({ path, range }) => path === '/api/observability/ai-metrics' && range === 'ytd'
      )
    );
    await page.reload();
    await expect(period('YTD')).toHaveAttribute('aria-pressed', 'true');
    await expect(revenue()).toContainText('$42,000');

    failAttribution = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      page.getByText('Campaign attribution unavailable.', { exact: true })
    ).toBeVisible();
    await expect(revenue()).toContainText('$42,000');
    failTimeline = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Showing last loaded data', { exact: true })).toBeVisible();
    await expect(revenue()).toContainText('$42,000');
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    await stage.click();
    await stageDialog.getByRole('button', { name: /Fixture seller/ }).click();
    await page.waitForURL('**/leads/fixture-deal');
    console.log(
      `Analytics metrics, date ranges, drill-downs, CSV and degraded states: ${engine.name()} ${viewport.width}px`
    );
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, { width: 1440, height: 900 });
  await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
} finally {
  await server.close();
}
