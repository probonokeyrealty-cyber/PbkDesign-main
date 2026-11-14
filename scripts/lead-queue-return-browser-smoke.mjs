import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
const leads = Array.from({ length: 24 }, (_, i) => ({
  id: 'queue-demo-' + i, leadId: 'queue-demo-' + i,
  seller: { name: 'Queue Sample ' + i }, score: 90,
  property: { address: i + ' Demo Street', city: 'Example City', state: 'CA', zip: '90210' },
}));
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const writes = [];
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (url.origin !== origin) return route.abort();
      if (!/^\/(?:api\/|\.netlify\/functions\/|state$|status$|health$|events$|invoke$|metrics$)/.test(path)) return route.continue();
      if (path === '/api/state/stream/session') return route.fulfill({ json: { ok: false } });
      if (request.method() !== 'GET') { writes.push(path); return route.abort(); }
      const id = path.match(/^\/api\/leads\/([^/]+)/)?.[1];
      if (path === '/api/founder/work-queue') return route.fulfill({ json: {
        ok: true, items: [{ id: 'demo-today-item', tag: 'Lead', body: 'Queue Sample 12',
          score: 90, reason: 'Review sample property facts', targetPath: '/leads?lead=queue-demo-12' }],
      } });
      return route.fulfill({ json: path === '/api/auth/team/status' ? { ok: true, configured: false, authRequired: false }
        : path === '/api/leads' ? { ok: true, leads }
          : id ? { ok: true, lead: leads.find(lead => lead.id === id) }
            : path === '/state' ? { leadImports: leads } : { ok: true, items: [] } });
    });
    try {
      await page.goto(origin + '/leads?search=Initial');
      const search = page.getByRole('searchbox', { name: /Search leads/ });
      await search.fill('Queue Sample');
      await page.getByRole('button', { name: 'Contract ready', exact: true }).click();
      // No fixture emails: confirm that the filter really changes the roster.
      await expect(page.getByText('0 matching leads', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Hot 80+', exact: true }).click();
      await page.getByRole('button', { name: 'Next leads page', exact: true }).click();
      const selected = page.getByRole('button', { name: /^Open lead Queue Sample 12 at / }).filter({ visible: true });
      const queueUrl = page.url();
      await selected.click();
      await expect(page).toHaveURL(queueUrl);
      await page.getByRole('button', { name: 'Open lead', exact: true }).click();
      await expect(page).toHaveURL(origin + '/leads/queue-demo-12');
      await expect(page.getByRole('heading', { name: 'Queue Sample 12', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
      await expect(search).toHaveValue('Queue Sample');
      await expect(page.getByRole('button', { name: 'Hot 80+', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText('Page 2 of 3', { exact: false })).toBeVisible();
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      await expect(selected).toBeFocused();
      await expect(selected).toBeInViewport();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.PBK_QUEUE_SCREENSHOTS === '1') {
        mkdirSync('.pbk-local/queue-return', { recursive: true });
        await page.screenshot({ path: `.pbk-local/queue-return/queue-${width}.png` });
      }
      await page.getByRole('button', { name: 'Contract ready', exact: true }).click();
      await expect(page.getByText('0 matching leads', { exact: true })).toBeVisible();
      await page.goto(origin + '/command-center');
      const todayItem = page.locator('[data-today-queue-id="demo-today-item"]');
      await todayItem.click();
      await expect(page.getByRole('heading', { name: 'Queue Sample 12', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back to today', exact: true }).click();
      await expect(page).toHaveURL(origin + '/command-center');
      await expect(todayItem).toBeFocused();
      await expect(todayItem).toBeInViewport();
      await page.goto(origin + '/leads/queue-demo-12');
      await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
      await expect(page).toHaveURL(origin + '/leads');
      await page.goto(origin + '/leads/queue-demo-12');
      await page.evaluate(() => history.replaceState({ ...history.state, usr: {
        leadReturn: { path: 'https://example.invalid', search: '', scrollY: 0, leadId: 'queue-demo-12' },
      } }, ''));
      await page.reload();
      await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
      await expect(page).toHaveURL(origin + '/leads');
      assert.deepEqual(writes, []);
      console.log(width + 'px: Leads context, Today return, focus and direct-link fallback passed; zero writes');
    } catch (error) {
      console.error((await page.locator('body').innerText()).slice(-2200));
      throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); await server.close(); }
