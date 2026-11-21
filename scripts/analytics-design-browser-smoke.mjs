import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ cacheDir: 'output/proof-first-analytics/vite-cache',
  optimizeDeps: { entries: ['./index.shell.html'] }, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const lead = {
  id: 'fixture-deal',
  name: 'Fixture seller',
  address: 'Fixture address',
  revenue: 18000,
  stage: 'closed',
  revenueBasis: 'recorded',
};
const coverage = count => ({ version: 1, totalRecords: count, recordedRecords: count, missingRecords: 0 });
const generatedAt = '2026-10-28T18:00:00Z';

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  let releaseNinety;
  let page;
  const pageErrors = [];
  const pending = new Set();
  try {
    page = await browser.newPage({
      ...device,
      viewport,
      timezoneId: 'America/Los_Angeles',
      acceptDownloads: true,
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => pending.add(request.url()));
    page.on('requestfinished', request => pending.delete(request.url()));
    page.on('requestfailed', request => pending.delete(request.url()));
    const requests = [];
    const writes = [];
    let failAttribution = false;
    let failTimeline = false;
    let supportsYtd = false;
    let wrongPeriod = false;
    let creationCohort = false;
    let holdNinety;
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === '/api/state/stream/session') return route.fulfill({ status: 503, json: {} });
      if (request.method() !== 'GET') {
        writes.push({ path, method: request.method() });
        return route.fulfill({ status: 405, json: {} });
      }
      if (path === '/api/auth/team/status') return route.fulfill({ json: { ok: true, configured: false, authRequired: false } });
      if (path === `/api/leads/${lead.id}/full`) return route.fulfill({ json: { ok: true, lead: {
        ...lead, seller: { name: lead.name }, property: { address: lead.address },
        soldComps: [{ id: 'SYN-COMP', soldPrice: 18000 }], notes: 'Preserve synthetic note',
      } } });
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
        '/api/deals/timeline': { days: timeline, dateBasis: creationCohort ? 'record_created' : 'closed_at' },
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
      if (fixture) {
        const reportingPeriod = wrongPeriod ? 'rolling:30' : range === 'ytd' ? 'ytd:2026' : `rolling:${days || 30}`;
        if (path === '/api/deals/timeline') {
          for (const day of fixture.days) Object.assign(day, { revenueBasis: 'recorded', revenueCoverage: coverage(day.count) });
          fixture.financialEvidence = { version: 1, revenueCoverage: coverage(fixture.days.reduce((n, d) => n + d.count, 0)) };
        }
        if (path === '/api/observability/ai-metrics') {
          fixture.metrics.costEvidence = { version: 1, totalRecords: 1, recordedRecords: 1, estimatedRecords: 0, missingRecords: 0 };
          fixture.metrics.estimatedAiSpendUsd = 0;
        }
        return route.fulfill({
          json: {
            ok: true,
            result: 'live',
            source: 'fixture',
            generatedAt,
            reportingPeriod,
            ...(range === 'ytd' && supportsYtd ? { range } : {}),
            ...fixture,
          },
        });
      }
      if (url.origin !== origin || /^\/(api\/|state$|health$|events$|status$|invoke$|metrics$)/.test(path))
        return route.fulfill({ json: { ok: true } });
      return route.continue();
    });

    await page.goto(`${origin}/analytics`);
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
    const period = (name) => page.getByRole('button', { name, exact: true });
    const summary = page.getByRole('region', { name: 'Key metrics' });
    const revenue = () =>
      summary.locator('.pbk-analytics-stat').filter({ hasText: 'Recorded revenue' });
    await expect(period('30D')).toHaveAttribute('aria-pressed', 'true');
    await expect(revenue()).toContainText('$25,000');
    await expect(summary).toContainText('250x');
    await expect(summary).not.toContainText('close rate');
    await page.evaluate(() => {
      localStorage.setItem('pbk:analyzer:draft:v1', '{"sample":"original"}');
      localStorage.setItem('pbk:compose:draft:v1', '{"sample":"original-compose"}');
    });
    const draftFingerprint = () => page.evaluate(() => JSON.stringify(
      Object.keys(localStorage).filter(key => /draft|compose|analyzer/i.test(key))
        .sort().map(key => [key, localStorage.getItem(key)])));
    const draftsBefore = await draftFingerprint();
    await expect(page.getByText('Fixture source', { exact: true })).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    if (process.env.PBK_ANALYTICS_SCREENSHOTS === '1') {
      await page.screenshot({
        path: `output/proof-first-analytics/analytics-${engine.name()}-${viewport.width}.png`,
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

    wrongPeriod = true;
    await period('7D').click();
    await expect(page.getByText('The bridge did not confirm the selected reporting period.')).toBeVisible();
    await expect(revenue()).not.toContainText('$18,000');
    wrongPeriod = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
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
    const dealDialog = page.getByRole('dialog', { name: /Closed records.*Oct 28/ });
    await expect(dealDialog).toContainText('$18,000');
    const downloadPromise = page.waitForEvent('download');
    await dealDialog.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    const csv = await readFile(await download.path(), 'utf8');
    assert.match(csv, /daily_deals,2026-10-28,1,18000/);
    assert.doesNotMatch(csv, /25000/);
    if (process.env.PBK_ANALYTICS_SCREENSHOTS === '1') {
      await page.screenshot({
        path: `output/proof-first-analytics/analytics-drill-${engine.name()}-${viewport.width}.png`,
      });
    }
    await dealDialog.getByRole('button', { name: 'Close drill-down' }).click();

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

    creationCohort = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(summary).toContainText('Creation cohort');
    await expect(summary).not.toContainText('420x');
    await page.getByText('Reporting evidence', { exact: true }).click();
    await expect(page.getByText('Contract creation date; not closing date')).toBeVisible();
    await page.getByText('Reporting evidence', { exact: true }).click();
    creationCohort = false;

    failAttribution = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      page.getByText('Campaign attribution unavailable.', { exact: true })
    ).toBeVisible();
    await expect(revenue()).toContainText('$42,000');
    failTimeline = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Showing last loaded data', { exact: true })).toBeVisible();
    await expect(revenue()).not.toContainText('$42,000');
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    failTimeline = false;
    await stage.click();
    await stageDialog.getByRole('button', { name: /Fixture seller/ }).click();
    await page.waitForURL('**/leads/fixture-deal');
    await page.getByRole('button', { name: /Back to analytics|^Analytics$/i }).click();
    await page.waitForURL('**/analytics?*');
    await expect(period('YTD')).toHaveAttribute('aria-pressed', 'true');
    await expect(stage).toBeFocused();
    assert.equal(await draftFingerprint(), draftsBefore, 'local sample drafts remain byte-identical');
    assert.deepEqual(writes, [], 'no provider or lead writes were requested');
    console.log(
      `Analytics metrics, date ranges, drill-downs, CSV and degraded states: ${engine.name()} ${viewport.width}px`
    );
    assert.deepEqual(pageErrors, [], 'no runtime page errors');
  } catch (error) {
    console.error(JSON.stringify({ engine: engine.name(), width: viewport.width,
      pageErrors, pending: [...pending].slice(0, 12), url: page?.url() }));
    if (page) await page.screenshot({ path: `output/proof-first-analytics/failure-${engine.name()}-${viewport.width}.png` }).catch(() => {});
    throw error;
  } finally {
    releaseNinety?.();
    await browser.close();
  }
}

try {
  await mkdir('output/proof-first-analytics', { recursive: true });
  for (const path of ['/src/main.shell.tsx', '/src/app/routes/Analytics.tsx', '/src/app/routes/LeadPortal.tsx', '/src/styles/index.css']) {
    assert.ok(await server.transformRequest(path), `Fixture transform unavailable: ${path}`);
  }
  await server.environments.client.waitForRequestsIdle();
  const optimizer = server.environments.client.depsOptimizer;
  await optimizer?.scanProcessing;
  for (const dependency of optimizer?.metadata.depInfoList || []) await dependency.processing;
  await verify(chromium, { width: 1440, height: 900 });
  await verify(chromium, { width: 320, height: 740 });
  await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
} finally {
  await server.close();
}
