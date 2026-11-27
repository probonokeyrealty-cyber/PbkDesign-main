import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;

try {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'],
      });
      const handoffs = [];
      const reads = [];
      const script = 'QA bridge-selected acquisition script.';
      const objectionScript = 'What would you want to think through before deciding?';
      const delayedScript = Promise.withResolvers();
      let delayAcquisition = false;
      let useLibrary = false;
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
          const section = payload.scripts[0].metadata.activeTab;
          if (section === 'acquisition' && delayAcquisition) await delayedScript.promise;
          if (section === 'objections' && useLibrary) {
            return route.fulfill({ json: { ok: false } });
          }
          return route.fulfill({ json: { ok: true, selectedScript: {
            id: 'qa-script', title: 'QA script',
            content: section === 'objections' ? objectionScript : script,
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

      await page.goto(`${origin}/analyzer`, { waitUntil: 'commit' });
      page.setDefaultTimeout(45_000);
      await page.getByRole('button', {
        name: width < 721 ? 'Open call prep' : 'Switch analyzer tab to Call Mode',
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
      for (const name of ['Copy', 'Download']) {
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
      await page.getByRole('button', { name: 'Objection Engine', exact: true }).click();
      await expect(page.getByText(objectionScript, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Copy', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), objectionScript);
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      assert.equal(await readFile(await (await download).path(), 'utf8'), objectionScript);
      await page.getByRole('button', { name: 'Push to Ava', exact: true }).click();
      await expect.poll(() => handoffs.length).toBe(2);
      assert.equal(handoffs[1].agentDealContext.activeScriptTab, 'objections');
      assert.equal(handoffs[1].agentDealContext.activeScript, objectionScript);
      assert.equal(handoffs[1].agentDealContext.runtimeSelectedScript.content, objectionScript);
      assert.equal(await paths.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
      const panel = page.getByRole('region', { name: 'Call Mode Script Panel' });
      assert.equal(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
      delayAcquisition = true;
      await page.getByRole('button', { name: 'Acquisition', exact: true }).click();
      await expect.poll(() => reads.at(-1)?.scripts[0].metadata.activeTab).toBe('acquisition');
      useLibrary = true;
      await page.getByRole('button', { name: 'Objection Engine', exact: true }).click();
      await expect(panel.getByRole('status')).toHaveText('Script library');
      const lateResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/scripts/current'
        && response.request().postDataJSON().scripts[0].metadata.activeTab === 'acquisition'
      );
      delayedScript.resolve();
      await lateResponse;
      await expect(panel.getByText(script, { exact: true })).toHaveCount(0);
      await expect(panel.getByRole('button', { expanded: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Follow-up', exact: true }).click();
      for (const name of ['Schedule Follow-up Call', 'Send Offer Email', 'Add to CRM']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
      }
      console.log(`Call Mode ${width}px: path, scripts, controls, and mocked Ava handoff passed.`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
