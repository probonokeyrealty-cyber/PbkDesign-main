import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;

try {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const handoffs = [];
      const reads = [];
      const script = 'QA bridge-selected acquisition script.';
      await page.addInitScript(() => {
        localStorage.setItem('pbk:local:analyzer:current-deal', JSON.stringify({
          address: '123 QA Street', leadId: 'qa-call-mode', type: 'house', contact: 'owner',
          arv: 250000, selectedPath: 'cash',
        }));
      });
      await page.route('**/*', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname === '/api/scripts/current') {
          const payload = req.postDataJSON();
          reads.push(payload);
          return route.fulfill({ json: { ok: true, selectedScript: {
            id: 'qa-script', title: 'QA script', content: script,
          } } });
        }
        if (url.pathname === '/api/leads/qa-call-mode' && req.method() === 'PATCH') {
          handoffs.push(req.postDataJSON());
          return route.fulfill({ json: { ok: true, result: 'approval_queued', approvalId: 'qa' } });
        }
        if (url.origin !== origin || /^\/(api\/|state$|health$|events$|invoke$)/.test(url.pathname)) {
          return route.fulfill({ json: {} });
        }
        return route.continue();
      });

      await page.goto(`${origin}/analyzer`);
      await page.getByRole('button', {
        name: width < 721 ? 'Open Call Mode' : 'Switch analyzer tab to Call Mode',
        exact: true,
      }).click();
      await expect(page.getByRole('heading', { name: 'The call.', exact: true })).toBeVisible();
      const paths = page.getByRole('region', { name: 'Path selector', exact: true });
      const creative = paths.getByRole('button', { name: 'Creative Finance', exact: true });
      await creative.click();
      await expect(creative).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Owner', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Acquisition', exact: true }).click();
      await expect.poll(() => reads.at(-1)?.scripts?.[0]?.metadata?.activeTab).toBe('acquisition');
      await expect(page.getByText(script, { exact: true })).toBeVisible();
      for (const name of ['Copy', 'Download', 'Schedule Follow-up Call', 'Send Offer Email', 'Add to CRM']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
      }
      await expect(page.getByRole('textbox', { name: 'Call notes', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Push to Ava', exact: true }).click();
      await expect.poll(() => handoffs.length).toBe(1);
      const [request] = handoffs;
      assert.equal(request.selectedPath, 'cf');
      assert.equal(request.agentDealContext.scriptVariant, 'agent');
      assert.equal(request.agentDealContext.activeScriptTab, 'acquisition');
      assert.equal(request.agentDealContext.runtimeSelectedScript.content, script);
      assert.equal(request.agentDealContext.analyzerNumbers.arv, 250000);
      assert.equal(await paths.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
      console.log(`Call Mode ${width}px: path, scripts, controls, and mocked Ava handoff passed.`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
