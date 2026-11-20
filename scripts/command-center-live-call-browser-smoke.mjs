import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';

const shell = readFileSync(new URL('../dist/index.shell.html', import.meta.url), 'utf8');
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const question = 'What would you expect an inspection to turn up about the property’s condition?';
const screenshotDir = process.env.PBK_CALL_QA_SCREENSHOTS;

function makeCall(id, leadName, nextBestQuestion) {
  return {
    id, leadName, status: 'connected', startedAt: new Date().toISOString(),
    transcript: [{ id: 'seller-line', speaker: 'lead', text: 'The roof needs work.' }],
    avaLiveCockpit: {
      nextBestQuestion, phase: 'discovery', latencyMs: 180,
      missionTimeline: Array.from({ length: 3 }, (_, index) => ({
        id: `step-${index}`, label: `Review step ${index + 1}`, status: 'waiting',
        detail: 'Confirm the seller’s information before selecting the next action.',
      })),
    },
  };
}

try {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let call = makeCall('call-first', 'First test caller', question);
      let mediaOpen = true;
      const qaScores = [{ callId: 'historical', leadId: 'test-lead', score: 94 }];
      const releaseControl = Promise.withResolvers();
      const callActions = [];
      await page.addInitScript(() => {
        localStorage.setItem('pbk:local:openclaw-config', JSON.stringify({
          endpoint: location.origin, apiKey: 'local-test-fixture',
        }));
      });
      await page.clock.install();
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/' && request.isNavigationRequest()) {
          return route.fulfill({ contentType: 'text/html', body: shell });
        }
        if (url.pathname === '/state' || url.pathname === '/api/state') {
          return route.fulfill({ json: { calls: [
            { id: 'historical', status: 'ended', leadName: 'Historical caller' },
            call,
          ], callQaScores: qaScores, leadImports: [] } });
        }
        if (url.pathname === '/api/debug/live-call-status') {
          return route.fulfill({ json: {
            ok: true, mediaStreamsOpen: mediaOpen ? 1 : 0,
            activeMediaSessions: mediaOpen ? [{ callId: call.id }] : [],
          } });
        }
        if (url.pathname === '/api/calls/call-first/action') {
          assert.equal(request.method(), 'POST');
          callActions.push(request.postDataJSON().action);
          if (callActions.length > 1) return route.fulfill({ json: { ok: true } });
          await releaseControl.promise;
          return route.fulfill({ json: { ok: false, error: 'Call control was not confirmed.' } });
        }
        if (/^\/(?:api\/|health$|events$|invoke$)/.test(url.pathname)) {
          return route.fulfill({ json: { ok: false } });
        }
        return route.continue();
      });

      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const widget = page.getByTestId('live-call-widget');
      const guidance = widget.getByRole('region', { name: 'Ava guidance' });
      await expect(guidance.getByRole('status')).toHaveText(question, { timeout: 30_000 });
      const today = page.getByRole('region', { name: 'Call status', exact: true });
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `today-${width}.png`) });
      const liveLink = today.getByRole('link', { name: 'Open call', exact: true });
      await expect(today.getByRole('status')).toHaveText('Call connected First test caller');
      assert.equal(await liveLink.evaluate((node) => node.getBoundingClientRect().height >= 44), true);
      assert.equal(await today.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
      await liveLink.press('Enter');
      await expect(widget.getByRole('heading', { name: 'Live Call', exact: true })).toBeFocused();
      await expect(today.getByRole('button', { name: 'Review call' })).toHaveCount(0);
      const details = guidance.locator('details');
      assert.equal(await details.evaluate((node) => node.open), false);
      await guidance.getByText('Call details', { exact: true }).press('Enter');
      await expect(guidance.getByText('Review step 3')).toBeVisible();
      const search = widget.getByRole('textbox', { name: 'Search transcript' });
      await search.fill('roof');
      await expect(widget.getByText('1 hit', { exact: true })).toBeVisible();
      const end = widget.getByRole('button', { name: 'End', exact: true });
      const mute = widget.getByRole('button', { name: 'Mute Ava', exact: true });
      await expect(end).toBeEnabled();
      assert.equal(await end.evaluate((node) => {
        const card = node.closest('[data-testid="live-call-widget"]');
        const button = node.getBoundingClientRect();
        const bounds = card.getBoundingClientRect();
        return button.bottom <= bounds.bottom && button.right <= bounds.right
          && card.scrollWidth <= card.clientWidth;
      }), true);
      await mute.click();
      await expect(widget.getByText('Waiting for mute confirmation…', { exact: true })).toBeVisible();
      await expect(mute).toBeDisabled();
      await expect(end).toBeDisabled();
      await expect.poll(() => callActions).toEqual(['mute']);
      releaseControl.resolve();
      await expect(widget.getByText('Call control was not confirmed.', { exact: true })).toBeVisible();
      await expect(mute).toBeEnabled();
      await expect(end).toBeEnabled();
      await mute.click();
      await expect(widget.getByText('Ava mute confirmed.', { exact: true })).toBeVisible();
      assert.deepEqual(callActions, ['mute', 'mute']);

      call = makeCall('call-second', 'Second test caller', '');
      call.leadId = 'test-lead';
      call.status = 'ringing';
      await page.clock.runFor(35_000);
      await expect(today.getByRole('status')).toHaveText('Dialing Second test caller');
      await expect(guidance).toHaveCount(0);
      call.status = 'connected';
      await page.clock.runFor(35_000);
      await expect(widget.getByText('Second test caller')).toBeVisible();
      await expect(widget.getByText('Ava mute confirmed.', { exact: true })).toHaveCount(0);
      await expect(guidance.getByRole('status')).toHaveText('Waiting for Ava’s next question.');
      await expect(search).toHaveValue('');
      assert.equal(await details.evaluate((node) => node.open), false);

      mediaOpen = false;
      await page.clock.runFor(35_000);
      await expect(guidance).toHaveCount(0);
      await expect(end).toBeDisabled();
      await expect(liveLink).toHaveCount(0);
      const reviewLastCall = today.getByRole('button', { name: 'Review call' });
      await expect(reviewLastCall).toHaveCount(0);
      call.status = 'ended';
      await page.clock.runFor(35_000);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(today.getByRole('status')).toHaveText('Call ended Second test caller');
      if (screenshotDir) {
        await reviewLastCall.scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(screenshotDir, `review-${width}.png`) });
      }
      await reviewLastCall.click();
      const review = page.getByRole('dialog', { name: 'Second test caller' });
      await expect(review).toBeVisible();
      await expect(review.getByRole('button', { name: 'Close call quality review' })).toBeFocused();
      assert.equal(await review.evaluate((node) => node.getBoundingClientRect().width <= innerWidth), true);
      await expect(review.getByText('Not scored', { exact: true })).toBeVisible();
      await expect(review.getByRole('link', { name: 'Open lead' })).toHaveAttribute('href', '/leads/test-lead');
      qaScores.unshift({ callId: 'call-second', leadId: 'test-lead', score: 8 });
      call.disposition = 'Follow-up requested';
      await page.clock.runFor(35_000);
      await expect(review.getByText('8/100', { exact: true })).toBeVisible();
      await expect(review.getByText('Follow-up requested', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(reviewLastCall).toBeFocused();
      await reviewLastCall.click();
      await review.getByRole('button', { name: 'Mark reviewed' }).click();
      await expect(today.getByRole('button', { name: 'View review' })).toBeFocused();
      await page.reload();
      assert.deepEqual(
        await page.evaluate(() => JSON.parse(localStorage.getItem('pbk:call-quality-reviewed:v1'))),
        ['call-second']
      );
      console.log(`Command Center live-call controls and guidance passed at ${width}px.`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  server.httpServer.closeAllConnections();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
