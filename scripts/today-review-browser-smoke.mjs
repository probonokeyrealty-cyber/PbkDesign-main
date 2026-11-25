import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const seller = {
  id: 'qa-sms',
  type: 'SMS',
  status: 'pending',
  leadName: 'QA Seller',
  address: '123 QA Street',
  message: 'Can we talk on Thursday?',
  createdAt: new Date().toISOString(),
};
const second = { ...seller, id: 'qa-other', message: 'Please confirm the property address.' };
const activityEvent = {
  id: 'receipt',
  actor: 'Ava',
  text: 'Drafted a follow-up',
  category: 'draft',
  at: new Date().toISOString(),
};
const longActivityEvent = {
  ...activityEvent,
  id: 'long-receipt',
  actor: 'Hermes',
  category: 'review',
  text: `Reviewed the sample lead. The intake and parcel record agree. The operator can check the saved evidence using reference ${'sample-reference-'.repeat(8)}. Final review detail.`,
};

async function verify(browserType, viewport, device = {}) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    await page.clock.install();
    await page.routeWebSocket('**/*', (socket) => socket.close());
    const requests = [];
    const unexpectedWrites = [];
    let resolved = false;
    let unavailable = true;
    let changed = false;
    let preflightOffline = false;
    let offlineReads = 0;
    let release;
    let respond;
    const responseHeld = new Promise((resolve) => { respond = resolve; });
    const releaseResponse = new Promise((resolve) => { release = resolve; });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/state' && request.method() === 'GET') {
        if (unavailable || preflightOffline) {
          offlineReads++;
          return route.fulfill({ status: 503, json: { error: 'Fixture offline' } });
        }
        return route.fulfill({
          json: {
            approvals: resolved
              ? [{ ...second, message: changed ? 'Updated draft with different details.' : second.message }]
              : [seller, second],
            activity: [activityEvent, longActivityEvent],
          },
        });
      }
      if (/\/api\/approvals\/qa-/.test(url.pathname) && request.method() === 'PUT') {
        requests.push({ path: url.pathname, ...request.postDataJSON() });
        if (url.pathname.endsWith('qa-other')) {
          return route.fulfill({ status: 502, json: { error: 'Fixture lost the response' } });
        }
        respond();
        await releaseResponse;
        resolved = true;
        return route.fulfill({ json: { ok: true, approval: { ...seller, status: 'approved' } } });
      }
      if (url.pathname === '/api/intelligence/stream') {
        return route.fulfill({
          json: { items: [activityEvent, longActivityEvent] },
        });
      }
      if (url.origin !== origin || /^\/(api\/|health$|events$|invoke$)/.test(url.pathname)) {
        if (request.method() !== 'GET' && !/\/(auth\/|state\/stream\/session)/.test(url.pathname)) {
          unexpectedWrites.push(url.pathname);
        }
        return route.fulfill({ json: {} });
      }
      return route.continue();
    });

    await page.goto(`${origin}/command-center`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await expect(page.getByRole('heading', { name: 'Today.', exact: true })).toBeVisible();
    const review = page.getByRole('region', { name: 'Review', exact: true });
    const rail = review.getByRole('list', { name: 'Decision Rail', exact: true });
    await expect(rail).toBeVisible();
    await expect(rail.getByText('Receipt', { exact: true })).toBeVisible();
    await expect(review.getByText('Queue unavailable. No decision can be submitted.', { exact: true })).toBeVisible();
    await expect(review.getByText('Approval queue unavailable.')).toBeVisible();
    await expect(review.getByText('No pending approvals right now.')).toHaveCount(0);
    unavailable = false;
    await page.reload();
    const activity = page.getByRole('region', { name: 'Recent activity', exact: true });
    await expect(activity).toBeVisible();
    const activityShortcut = page.getByRole('navigation', { name: 'Today sections' })
      .getByRole('link', { name: 'Activity', exact: true });
    await activityShortcut.focus();
    await page.keyboard.press('Enter');
    await expect(activity.getByRole('heading', { name: 'Recent activity' })).toBeFocused();
    const entry = activity.locator('details').filter({ hasText: 'Hermes' });
    const summary = entry.locator('summary');
    const detail = entry.locator('.pbk-today-activity-detail');
    await expect(detail).toBeHidden();
    await expect(summary).toContainText('The intake and parcel record agree.');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(detail).toBeVisible();
    await expect(detail.getByText(longActivityEvent.text, { exact: true })).toBeVisible();
    await expect(detail.locator('time')).toHaveAttribute('datetime', longActivityEvent.at);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.PBK_TODAY_REVIEW_SCREENSHOTS === '1') {
      mkdirSync('.pbk-local', { recursive: true });
      await activity.screenshot({ path: `.pbk-local/today-activity-${browserType.name()}-${viewport.width}.png` });
    }
    await page.keyboard.press('Enter');
    await expect(detail).toBeHidden();
    assert.deepEqual(unexpectedWrites, [], 'Activity navigation and disclosure are read-only');
    const row = review.locator('[data-approval-id="qa-sms"]');
    const approve = row.getByRole('button', { name: 'Review approval' });
    await expect(row.getByText(seller.message)).toBeVisible();
    // Advance polling explicitly so it cannot consume a preflight-only outage.
    // Leave headroom for the browser round trip on a busy Windows/WebKit host.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
    if (process.env.PBK_TODAY_REVIEW_SCREENSHOTS === '1') {
      mkdirSync('.pbk-local', { recursive: true });
      await page.screenshot({ path: `.pbk-local/today-review-${browserType.name()}-${viewport.width}.png` });
    }
    await approve.click();
    const dialog = page.getByRole('dialog', { name: 'Approve SMS?' });
    await expect(dialog.getByRole('list', { name: 'Decision Rail' }).locator('[aria-current="step"]')).toContainText('Review');
    await expect(dialog.getByText(seller.message)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(approve).toBeFocused();
    await expect(review.getByText('Review cancelled. Nothing submitted.', { exact: true })).toBeVisible();
    await expect(page.getByText('Shortcut not handled')).toHaveCount(0);
    assert.equal(requests.length, 0);

    await approve.click();
    const readsBeforePolling = offlineReads;
    preflightOffline = true;
    // Hidden tabs back off polling to 60s; drive that timer and bounded read retries.
    await page.clock.fastForward(60_000);
    await expect.poll(async () => {
      await page.clock.fastForward(5_000);
      return dialog.getByRole('button', { name: 'Confirm decision' }).isDisabled();
    }, { timeout: 20000 }).toBe(true);
    assert(offlineReads > readsBeforePolling, 'Polling must actually read the unavailable fixture');
    await expect(review.getByText('Queue unavailable. No decision can be submitted.', { exact: true })).toBeVisible();
    assert.equal(requests.length, 0, 'A polling outage must disable approval without writing');
    preflightOffline = false;
    await page.clock.fastForward(60_000);
    await expect.poll(async () => {
      await page.clock.fastForward(5_000);
      return dialog.getByRole('button', { name: 'Confirm decision' }).isEnabled();
    }, { timeout: 20000 }).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    await approve.click();
    const offlineReadsBeforePreflight = offlineReads;
    preflightOffline = true;
    await dialog.getByRole('button', { name: 'Confirm decision' }).click();
    await expect.poll(async () => {
      await page.clock.fastForward(100);
      return (await rail.locator('[data-state="blocked"]').allTextContents()).join(' ');
    }, { timeout: 20000 }).toContain('Evidence');
    await expect(rail.locator('[data-state="blocked"]')).toContainText('Evidence');
    assert(offlineReads > offlineReadsBeforePreflight, 'The preflight must actually reach the unavailable fixture');
    assert.equal(requests.length, 0, 'A failed preflight must not submit a decision');
    preflightOffline = false;

    await approve.click();
    const confirm = dialog.getByRole('button', { name: 'Confirm decision' });
    await confirm.evaluate((button) => { button.click(); button.click(); });
    await responseHeld;
    await expect(rail.locator('[aria-current="step"]')).toContainText('Review');
    await expect(review.getByRole('region', { name: 'Decision receipt' })).toHaveCount(0);
    await expect(review.locator('[data-approval-id="qa-other"]').getByRole('button', {
      name: 'Review approval',
    })).toBeDisabled();
    release();
    await expect(row).toHaveCount(0);
    await expect(review.locator('[data-approval-id="qa-other"]')).toBeVisible();
    await expect(page.getByRole('status').filter({
      hasText: 'Approval recorded. Delivery has not been confirmed.',
    })).toBeVisible();
    const receipt = review.getByRole('region', { name: 'Decision receipt' });
    await expect(receipt).toContainText('qa-sms');
    await expect(receipt).toContainText('Approved');
    await expect(receipt).toContainText('Delivery not confirmed');
    await expect(receipt.getByRole('button')).toHaveCount(0);
    if (process.env.PBK_TODAY_REVIEW_SCREENSHOTS === '1') {
      await receipt.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.pbk-local/decision-receipt-${browserType.name()}-${viewport.width}.png` });
    }
    assert.deepEqual(requests.map(({ path, status }) => [path, status]), [
      ['/api/approvals/qa-sms', 'approved'],
    ]);
    const other = review.locator('[data-approval-id="qa-other"]');
    const reviewOther = other.getByRole('button', { name: 'Review approval' });
    await reviewOther.click();
    changed = true;
    await dialog.getByRole('button', { name: 'Confirm decision' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'This request changed.' })).toBeVisible();
    await expect(other.getByText('Updated draft with different details.')).toBeVisible();
    await expect(rail.locator('[data-state="blocked"]')).toContainText('Evidence');
    await expect(receipt).toHaveCount(0);
    await expect(reviewOther).toBeEnabled();
    assert.equal(requests.length, 1, 'A changed draft must not be approved');

    await other.getByRole('button', { name: 'Decline' }).click();
    await page.getByRole('dialog', { name: 'Decline SMS?' }).getByRole('button', {
      name: 'Confirm decision',
    }).click();
    await expect(other.getByText('Decision unconfirmed.')).toBeVisible();
    await expect(reviewOther).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Start here', exact: true })
      .getByRole('link', { name: 'Review approvals', exact: true })).toHaveCount(0);
    await expect(rail.locator('[data-state="blocked"]')).toContainText('Receipt');
    await expect(review.getByText('Outcome unknown. Check approval history before retrying.', { exact: true })).toBeVisible();
    await expect(receipt).toHaveCount(0);
    assert.deepEqual(requests.map(({ status }) => status), ['approved', 'rejected']);
    assert.deepEqual(unexpectedWrites, []);
    assert.equal(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
      document.querySelector('.pbk-today-review').scrollWidth <=
        document.querySelector('.pbk-today-review').clientWidth
    ), true, 'Today and Review must not overflow');
    console.log(`${browserType.name()} ${viewport.width}px: activity navigation and disclosure, polling outage/recovery, failed preflight, keyboard cancel, duplicate, changed/unknown decisions, and layout passed.`);
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, { width: 1440, height: 900 });
  await verify(chromium, { width: 390, height: 844 }, devices['Pixel 7']);
  await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
} finally {
  await server.close();
}
