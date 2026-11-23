import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url));
const receipt = JSON.parse(read('src/assets/van-nuys/receipt.json'));
const shell = read('dist/index.shell.html');
const browser = await chromium.launch({ channel: 'chrome' });

try {
  const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  try {
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    const blockedActions = [];
    await page.route('**/*', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const isActionRead = /(?:prospecting|hermes|outreach|crm)/i.test(url.pathname)
        && !request.isNavigationRequest() && !url.pathname.startsWith('/assets/');
      if (request.method() !== 'GET' || isActionRead) {
        blockedActions.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/prospecting') return route.fulfill({ contentType: 'text/html', body: shell });
      if (url.pathname === '/api/auth/team/status') return route.fulfill({ json: { ok: true, configured: false, authRequired: false } });
      if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/state') {
        return route.fulfill({ json: { ok: false } });
      }
      return route.continue();
    });

    await page.goto(origin + '/prospecting?view=evidence');
    await page.getByRole('link', { name: 'Receipt & downloads' }).click();
    await expect(page.getByRole('heading', { name: 'Run receipt' })).toBeInViewport();
    const id = page.locator('.pbk-van-id code');
    const grid = page.getByRole('group', { name: 'Receipt downloads' });
    await expect(id).toHaveText(receipt.run_id);
    await expect(id).toBeVisible();
    const layout = await id.evaluate((code) => {
      const range = document.createRange();
      range.selectNodeContents(code);
      const lines = [...range.getClientRects()];
      const box = code.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        fontSize: parseFloat(getComputedStyle(code).fontSize),
        wraps: new Set(lines.map((line) => line.top)).size > 1,
        inside: lines.every((line) => line.left >= box.left - 1 && line.right <= box.right + 1),
      };
    });
    assert.equal(layout.viewport, 390);
    assert.ok(layout.wraps && layout.inside, 'Full ID wraps and fits its container');
    assert.ok(layout.fontSize >= 16, `Run ID font must be at least 16px, got ${layout.fontSize}px`);

    const buttons = await grid.getByRole('link').evaluateAll((links) =>
      links.map((link) => {
        const { x, y, width, height } = link.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    assert.equal(buttons.length, 4);
    assert.equal(new Set(buttons.map(({ x }) => x)).size, 2);
    assert.deepEqual(buttons.map(({ x }) => x), [buttons[0].x, buttons[1].x, buttons[0].x, buttons[1].x]);
    assert.deepEqual(buttons.map(({ y }) => y), [buttons[0].y, buttons[0].y, buttons[2].y, buttons[2].y]);
    assert.ok(buttons[2].y > buttons[0].y);
    assert.ok(buttons.every(({ x, width, height }) => x >= 0 && x + width <= 390 && height >= 48));

    for (const [label, extension] of [['Text', 'txt'], ['PDF', 'pdf'], ['CSV', 'csv'], ['JSON', 'json']]) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        grid.getByRole('link', { name: `Download ${label} receipt` }).click(),
      ]);
      assert.equal(download.suggestedFilename(), `van-nuys-receipt-${receipt.run_id}.${extension}`);
      assert.deepEqual(readFileSync(await download.path()), read(`src/assets/van-nuys/receipt.${extension}`));
      await expect(id).toHaveText(receipt.run_id);
    }
    assert.deepEqual(blockedActions, []);
    console.log(`Chrome 390px: full run ID, 2x2 downloads, four byte-identical exports, no run or write requests (${receipt.run_id}).`);
  } finally {
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
} finally {
  await browser.close();
}
