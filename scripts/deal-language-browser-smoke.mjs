import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ timeout: 30000 });
const lead = { id: 'qa-language-only', name: 'Alexandra Example Long Seller Name',
  address: '123 Example Avenue, Columbus OH', phone: '+12025550142',
  email: 'fixture@example.invalid', arv: 220000, mao: 118000, score: 85 };
try {
  await mkdir('output/playwright', { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      window.PBK = { openclaw: { getConfig: () => ({ endpoint: location.origin, apiKey: 'fixture-only' }) } };
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      if (url.origin !== origin) return route.abort();
      if (route.request().isNavigationRequest() && path === '/leads')
        return route.fulfill({ contentType: 'text/html', body: await readFile('dist/index.shell.html', 'utf8') });
      if (path === '/api/leads') return route.fulfill({ json: { ok: true, leads: [lead] } });
      if (path === '/state') return route.fulfill({ json: { ok: true, leadImports: [lead], calls: [] } });
      if (path.includes('/api/leads/')) return route.fulfill({ json: { ok: true, lead, calls: [], activity: [] } });
      if (/^\/(api\/|health$|events$|invoke$)/.test(path)) return route.fulfill({ json: { ok: true } });
      return route.continue();
    });
    await page.goto(`${origin}/leads`);
    await expect(page.getByRole('heading', { name: 'Seller leads.' })).toBeVisible();
    await expect(page.getByText('Phone on file', { exact: true })).toBeVisible();
    await expect(page.getByText('High-priority leads', { exact: true })).toBeVisible();
    const add = page.getByRole('button', { name: 'Add seller', exact: true });
    await expect(add).toBeVisible();
    await add.click();
    await expect(page.getByRole('heading', { name: 'Create lead', exact: true })).toBeVisible();
    await expect(page.getByText('After-repair value (ARV)', { exact: true })).toBeVisible();
    await expect(page.getByText('Maximum allowable offer (MAO)', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `Page overflow at ${width}px`);
    await page.screenshot({ path: `output/playwright/deal-language-${width}.png`, fullPage: true });
    await page.close();
    console.log(`deal-language: ${width}px passed`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
