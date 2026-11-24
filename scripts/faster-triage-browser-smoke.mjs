import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, expect as playwrightExpect } from '@playwright/test';
import { createTriagePreview, fixtureResponse, sampleApproval, sampleLeads } from './fixtures/faster-triage-fixture.mjs';

const { server, origin } = await createTriagePreview();
const expect = playwrightExpect.configure({ timeout: 20000 });
const initialLeads = structuredClone(sampleLeads);

async function verifyStartingPoint() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    const unexpectedRequests = [];
    const call = { id: 'sample-today-call', status: 'connected', leadName: 'Sample caller' };
    let calls = [];
    let approvals = [sampleApproval];
    let queue = 'ranked';
    let snapshotOffline = false;
    let finishQueueRead;
    const holdQueueRead = new Promise(resolve => { finishQueueRead = resolve; });
    await page.clock.install();
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.searchParams.get('path') || url.pathname;
      if (url.origin !== origin || path.includes('/property-data') || (request.method() !== 'GET' && path !== '/api/state/stream/session')) {
        unexpectedRequests.push(`${request.method()} ${path}`);
        return route.abort();
      }
      if (path === '/state') {
        if (snapshotOffline) return route.fulfill({ status: 503, json: { error: 'Snapshot unavailable' } });
        return route.fulfill({ json: { ...fixtureResponse(path, url.searchParams), approvals, calls } });
      }
      if (path === '/api/debug/live-call-status') {
        return route.fulfill({ json: { ok: true, mediaStreamsOpen: 1, activeMediaSessions: [{ callId: call.id }] } });
      }
      if (path === '/api/founder/work-queue') {
        if (queue === 'holding') await holdQueueRead;
        if (queue === 'offline') return route.fulfill({ status: 503, json: { error: 'Queue unavailable' } });
        if (queue === 'malformed') return route.fulfill({ json: { ok: true } });
        if (queue === 'empty') return route.fulfill({ json: { ok: true, items: [] } });
        if (queue === 'unresolved') return route.fulfill({ json: { ok: true, items: [
          { id: 'sample-unresolved', recordKind: 'lead', recordId: 'wrong-lead', targetPath: '/leads/SYN-L-2291', body: 'Unresolved sample lead' },
        ] } });
      }
      return route.continue();
    });

    const today = page.getByRole('region', { name: 'Start here', exact: true });
    const primary = today.locator('[data-today-primary]');
    const workQueue = page.getByRole('region', { name: 'Work queue', exact: true });
    const load = () => page.goto(`${origin}/command-center?queue=sample`, { waitUntil: 'domcontentloaded' });
    await load();
    await expect(primary).toHaveText('Review approvals', { timeout: 6000 });
    await expect(primary).toHaveCount(1);
    assert.equal(await primary.evaluate(node => node.getBoundingClientRect().height >= 44), true);
    await primary.focus();
    approvals = [sampleApproval, { ...sampleApproval, id: 'sample-second-approval' }];
    await page.clock.fastForward(65_000);
    await expect(today.getByRole('status')).toHaveText('2 items need your decision.');
    await expect(primary).toBeFocused();
    await primary.press('Enter');
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeFocused();

    approvals = [{ ...sampleApproval, id: undefined }];
    await load();
    await expect(primary).toHaveText('Go to work queue', { timeout: 6000 });
    approvals = [sampleApproval];

    calls = [call];
    await load();
    await expect(primary).toHaveText('Open call');
    await primary.click();
    await expect(page.locator('#live-call')).toContainText(call.leadName);
    await expect(page.locator('#live-call').getByRole('heading', { name: 'Live Call' })).toBeFocused();
    calls = [{ ...call, status: 'ended' }];
    await page.clock.fastForward(65_000);
    await expect(primary).toHaveText('Review call');
    await primary.click();
    const callReview = page.getByRole('dialog').filter({ hasText: call.leadName });
    await expect(callReview).toBeVisible();
    await callReview.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(today.getByRole('button', { name: 'View review' })).toBeVisible();
    await expect(primary).toHaveText('Review approvals');

    calls = [call];
    approvals = undefined;
    await page.evaluate(() => localStorage.setItem('pbk:command-center:widgets', JSON.stringify({ liveCall: false })));
    await load();
    await expect(primary).toHaveText('Go to work queue');
    await expect(today.getByRole('link', { name: 'Open call' })).toHaveCount(0);
    await primary.press('Enter');
    await expect(page.getByRole('heading', { name: 'Work queue', exact: true })).toBeFocused();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    queue = 'unresolved';
    await load();
    await expect(primary).toHaveText('Browse leads');
    const unresolved = workQueue.getByRole('button', { name: /Unresolved sample lead/i });
    await expect(unresolved).toBeDisabled();
    await expect(unresolved).toContainText('Lead unavailable');

    queue = 'holding';
    await load();
    await expect(today.getByRole('status')).toHaveText('Loading work queue');
    await expect(today.getByRole('link', { name: 'Browse leads' })).toBeVisible();
    await expect(primary).toHaveCount(0);
    queue = 'empty';
    finishQueueRead();
    await expect(primary).toHaveText('Browse leads');
    await expect(workQueue.getByRole('status')).toContainText('No work items in this queue');
    await expect(workQueue.getByRole('button')).toHaveCount(0);

    for (const unavailable of ['offline', 'malformed']) {
      queue = unavailable;
      calls = [];
      await load();
      await expect(primary).toHaveText('Go to work queue');
      await expect(workQueue.getByText('Showing work from the latest workspace snapshot.')).toBeVisible();
    }

    snapshotOffline = true;
    await load();
    await expect(primary).toHaveText('Browse leads');
    await expect(workQueue.getByRole('status')).toContainText('Work queue unavailable');
    await primary.press('Enter');
    await expect(page).toHaveURL(`${origin}/leads`);
    assert.deepEqual(unexpectedRequests, [], 'Starting links use saved reads and make no provider requests or writes');
    console.log('Today starting action: call review, approvals, queue, fallback, loading, clear and unavailable passed');
  } finally { await browser.close(); }
}
async function verify(type, width) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'dark' });
    const writes = [], errors = [], foreignTimelineReads = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      const path = url.searchParams.get('path') || url.pathname;
      if (url.pathname.includes('/wrong-thread/timeline')) foreignTimelineReads.push(url.pathname);
      if (path.includes('/property-data') || /(^|\.)attom(?:data)?\.com$/i.test(url.hostname)) {
        writes.push(path);
        return route.abort();
      }
      if (url.origin !== origin) return route.abort();
      if (request.method() !== 'GET' && path !== '/api/state/stream/session') { writes.push(path); return route.abort(); }
      return route.continue();
    });
    await page.goto(origin + '/command-center', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`${type.name()} ${width}px: checking queue subtitle`);
    const row = page.locator('[data-today-queue-id="sample-queue-0"]');
    await expect(row.getByText('Existing queue reason')).toBeVisible();
    await expect(row).toContainText(sampleLeads[0].bant.nextStep);
    await expect(row.locator('[data-triage-lead-id]')).toHaveText('SYN-L-2291');
    await expect(row).toHaveAccessibleName(/SYN-L-2291\./);
    await expect(page.locator('[data-today-queue-id="sample-queue-1"]')).toHaveAccessibleName(/SYN-L-22910\./);
    await expect(row).not.toContainText('Other exact ID only.');
    await expect(page.locator('[data-today-queue-id="sample-queue-2"]')).toContainText('No next step recorded');
    await expect(page.locator('[data-today-queue-id="sample-queue-3"]')).toContainText('Next step unavailable');
    assert.deepEqual(await page.locator('[data-today-queue-id]').evaluateAll(nodes => nodes.map(n => n.dataset.todayQueueId)), sampleLeads.map((_, i) => `sample-queue-${i}`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Long queue IDs and text must wrap');
    const loadedFonts = await page.evaluate(async () => {
      const families = ['PBK Plus Jakarta Sans', 'Fraunces', 'PBK JetBrains Mono NF'];
      const result = [];
      for (const family of families) result.push((await document.fonts.load(`14px "${family}"`)).length);
      return result;
    });
    assert(loadedFonts.every(count => count > 0), 'Existing PBK and Nerd Fonts must actually load locally');
    mkdirSync('output/faster-triage', { recursive: true });
    await page.screenshot({ path: `output/faster-triage/today-${type.name()}-${width}.png` });
    const sections = page.getByRole('navigation', { name: 'Today sections', exact: true });
    await sections.getByRole('link', { name: 'Review (1)', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeFocused();
    await sections.getByRole('link', { name: 'Work queue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Work queue', exact: true })).toBeFocused();
    const composeDraft = JSON.stringify({ channel: 'sms', recipient: '+12025550101', leadId: 'SYN-L-2291', message: 'Unsent manual text stays unchanged', sendLater: false, sendAt: '' });
    await page.evaluate(value => localStorage.setItem('pbk:compose:draft', value), composeDraft);
    await row.click();
    await expect(page).toHaveURL(/\/leads\/SYN-L-2291$/);
    await expect(page.getByText('Exact seller sample history', { exact: true })).toBeVisible();
    await expect(page.getByText('FOREIGN SELLER HISTORY MUST NOT APPEAR')).toHaveCount(0);
    const jump = page.getByRole('link', { name: 'Next step', exact: true });
    await jump.click();
    const heading = page.getByRole('heading', { name: 'Next step', exact: true });
    await expect(heading).toBeFocused();
    await expect.poll(async () => heading.evaluate(n => n.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
    await expect(page.locator('#lead-next-step')).toContainText(sampleLeads[0].bant.nextStep);
    await page.getByRole('link', { name: 'Numbers', exact: true }).click();
    await expect(page.locator('#lead-numbers')).toBeVisible();
    await expect(page.locator('#lead-numbers')).toContainText('$245,000');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit complete seller profile', exact: true });
    await edit.getByLabel('Next step', { exact: true }).fill('Unsaved sample edit, never apply');
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#lead-next-step')).toContainText(sampleLeads[0].bant.nextStep);
    await page.getByRole('button', { name: /^Back to today$/i }).click();
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport();
    assert.equal(await page.evaluate(() => localStorage.getItem('pbk:compose:draft')), composeDraft);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await row.click();
    await expect(page).toHaveURL(/\/leads\/SYN-L-2291$/);
    await expect(page.getByText('Exact seller sample history', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('#lead-next-step')).toContainText(sampleLeads[0].bant.nextStep);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []); assert.deepEqual(foreignTimelineReads, []);
    assert.deepEqual(sampleLeads, initialLeads, 'No saved manual fields, ARV or sold comps changed');
    await page.screenshot({ path: `output/faster-triage/workspace-${type.name()}-${width}.png` });
    await page.goto(origin + '/inbox', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Compose', exact: true }).click();
    const compose = page.getByRole('dialog', { name: 'Compose message', exact: true });
    await expect(compose.getByPlaceholder('Write a seller-facing message...', { exact: true })).toHaveValue('Unsent manual text stays unchanged');
    await compose.getByRole('button', { name: 'Close compose', exact: true }).click();
    assert.deepEqual(writes, []);
    console.log(`${type.name()} ${width}px: exact-ID subtitles, empty/unavailable, focus jumps, queue return, preserved local draft, reload, zero writes passed`);
  } finally { await browser.close(); }
}
try {
  await verifyStartingPoint();
  await verify(chromium, 1440);
  await verify(chromium, 390);
  await verify(webkit, 390);
  await verify(chromium, 320);
} finally { await server.close(); }
