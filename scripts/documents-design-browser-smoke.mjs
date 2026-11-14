import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const netlifyConfig = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
const [, csp] = netlifyConfig.match(/Content-Security-Policy = "([^"]+)"/);
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;

try {
  const browser = await chromium.launch();
  try {
    const fixture = await browser.newPage();
    await fixture.setContent('<h1>PBK QA Master Deal Package</h1>');
    const pdf = await fixture.pdf();
    await fixture.close();

    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const requests = [];
      await page.addInitScript(() => {
        window.print = () => {};
        window.qaBlockedFrames = [];
        document.addEventListener('securitypolicyviolation', (event) => {
          if (event.effectiveDirective === 'frame-src') {
            window.qaBlockedFrames.push(event.blockedURI);
          }
        });
        localStorage.setItem('pbk:local:analyzer:current-deal', JSON.stringify({
          address: '123 QA Street', type: 'house', contact: 'owner', selectedPath: 'cash',
          sellerName: 'QA Seller', sellerEmail: 'seller@example.invalid', price: 150000,
          timeline: '15-30 Days',
        }));
      });
      await page.route('**/*', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === origin && url.pathname === '/analyzer') {
          const response = await route.fetch();
          return route.fulfill({ response, headers: {
            ...response.headers(), 'content-security-policy': csp,
          } });
        }
        if (url.pathname === '/api/documents/pdf' && req.method() === 'POST') {
          requests.push(req.postDataJSON());
          return route.fulfill({ contentType: 'application/pdf', body: pdf });
        }
        if (url.origin !== origin || /^\/(api\/|state$|health$|events$|invoke$)/.test(url.pathname)) {
          return route.fulfill({ json: {} });
        }
        return route.continue();
      });

      await page.goto(`${origin}/analyzer`);
      if (width < 721) await page.getByRole('button', { name: /^Controls/ }).click();
      await page.getByRole('button', { name: 'Switch analyzer tab to Documents', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'The paper.', exact: true })).toBeVisible();
      const templates = page.getByRole('region', { name: 'Document Templates', exact: true });
      await templates.getByRole('button', { name: 'LOI', exact: true }).click();
      const editor = templates.getByRole('textbox', { name: 'Edit loi document' });
      await editor.fill('QA editable letter');
      await expect(editor).toHaveValue('QA editable letter');
      await expect(page.getByRole('button', { name: 'Email Selected Documents' })).toBeEnabled();

      const openPackage = async (name, print) => {
        const [popup] = await Promise.all([
          page.context().waitForEvent('page'),
          page.getByRole('button', { name, exact: true }).first().click(),
        ]);
        await popup.waitForURL(/PBK_Master_Deal_Package\.html\?/);
        const url = new URL(popup.url());
        assert.equal(url.searchParams.get('pbk_preview'), '1');
        assert.equal(url.searchParams.get('pbk_print'), print ? '1' : null);
        assert.equal(url.searchParams.get('address'), '123 QA Street');
        assert.equal(await popup.evaluate(() => window.opener === null), true);
        await expect(popup.locator('[data-preview-action="print"]')).toBeVisible();
        await popup.close();
      };
      await openPackage('Preview Package', false);
      const exportStatus = page.getByRole('region', { name: 'Master Deal PDF', exact: true })
        .getByRole('status');
      await expect(exportStatus).toContainText('Preview opened');
      await openPackage('Print Package', true);
      await openPackage('Generate Master PDF', true);
      await expect(exportStatus).toContainText('PDF ready for');

      const panel = page.getByRole('region', { name: 'Master PDF Preview', exact: true });
      await expect(panel.getByText(/^PDF ready/)).toBeVisible();
      assert.equal(requests[0].propertyAddress, '123 QA Street');
      assert.equal(requests[0].selectedPathLabel, 'Cash Offer');
      const iframe = panel.locator('iframe');
      await expect(iframe).toHaveAttribute('src', /^blob:/);
      const beforeRefresh = await iframe.getAttribute('src');
      await panel.getByRole('button', { name: 'Refresh PDF' }).click();
      await expect(iframe).not.toHaveAttribute('src', beforeRefresh);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        panel.getByRole('link', { name: 'Download PDF' }).click(),
      ]);
      assert.deepEqual(await readFile(await download.path()), pdf);
      assert.deepEqual(await page.evaluate(() => window.qaBlockedFrames), [],
        'Production CSP must allow the inline PDF to load');
      assert.equal(await page.locator('.pbk-doc-workbench').evaluate(
        (node) => node.scrollWidth <= node.clientWidth
      ), true, 'Documents workbench must not overflow');
      console.log(`Documents ${width}px: edit, preview, print, generation, refresh and PDF download passed.`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
