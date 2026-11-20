import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, webkit, devices, expect } from '@playwright/test';

// Exercise the checked-in Brain renderer/modal/actions with only bridge seams stubbed.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const extract = (start, end) =>
  html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const source = [
  extract('  function renderBrainOperationalStatus(', '  function applyRuntimeMode('),
  extract('  function showUtilityModal(', '  function closeTopUtilityModal('),
  extract('  function findBrowserResearchJob(', '  async function trainRexFromBlogPost('),
].join('\n');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const job = {
  id: 'market-fixture',
  provider: 'e2b',
  market: 'Tampa, FL',
  targetLabel: 'Public market brief: Tampa, FL',
  status: 'complete',
  resultSummary: 'Public evidence summary. Review the source dates before making an offer.',
  sources: ['https://example.org/' + 'market-report-'.repeat(18)],
  resultData: {
    limitations: [
      'Public search summary; individual claims and publication dates require review before an offer.',
      'No lead records or underwriting values were changed.',
    ],
    evidenceDigest: 'hidden-digest',
  },
};
for (const [label, engine, options] of [
  ['desktop', chromium, { viewport: { width: 1440, height: 900 } }],
  ['iphone', webkit, devices['iPhone 13']],
  ['iphone-320', webkit, { ...devices['iPhone SE'], viewport: { width: 320, height: 568 } }],
]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...options, serviceWorkers: 'block' });
    await page.route('**/*', (r) => r.abort());
    await page.setContent(
      `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><main data-page="brain"><div class="brain-upload"></div></main>`
    );
    await page.evaluate(
      ({ source, job }) => {
        window.calls = [];
        window.PBK = {
          state: { openclawRuntime: { browserResearchJobs: [job] } },
          openclaw: {
            isConnected: () => true,
            invoke: async (tool, params) => {
              window.calls.push({ tool, params });
              return { result: 'queued_for_approval' };
            },
          },
        };
        window.escapeHtml = (s) =>
          String(s ?? '').replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
          );
        window.sortRuntimeItems = (a) => a;
        window.formatRelativeTime = () => 'just now';
        window.toast = () => {};
        window.toastOutcome = () => {};
        window.getRuntimeOutcome = () => 'queued_for_approval';
        window.syncOpenClawState = async () => {};
        (0, eval)(
          source +
            '\nwindow.renderMarket=renderBrainOperationalStatus;window.showMarket=showBrowserResearchJob;'
        );
        window.renderMarket(PBK.state.openclawRuntime);
        document
          .querySelector('[data-browser-research-action="view"]')
          .addEventListener('click', () => window.showMarket(job.id));
      },
      { source, job }
    );
    await expect(page.locator('[data-brain-operational-status]')).toContainText(
      'E2B worker complete'
    );
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    await page.getByRole('button', { name: 'View', exact: true }).click();
    const modal = page.locator('.modal[data-utility-modal-id]');
    await expect(modal).toContainText('No lead records or underwriting values were changed.');
    await expect(modal).not.toContainText('hidden-digest');
    assert.equal(await modal.locator('a').getAttribute('href'), job.sources[0]);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Brain must fit viewport'
    );
    assert(
      await modal.evaluate((m) => m.scrollWidth <= m.clientWidth + 1),
      'Result content must not overflow'
    );
    await modal.getByRole('button', { name: 'Prepare another' }).click();
    await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
    assert.deepEqual(await page.evaluate(() => window.calls), [
      {
        tool: 'runAgentCommand',
        params: {
          agentId: 'rex',
          cloudResearchOperation: 'prepare-market-brief',
          market: 'Tampa, FL',
        },
      },
    ]);
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).toHaveCount(0);
    console.log(`public-market-brain: ${label} passed`);
  } finally {
    await browser.close();
  }
}
