import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit, expect as playwrightExpect } from '@playwright/test';
import { createTriagePreview, sampleLeads } from './fixtures/faster-triage-fixture.mjs';

const { server, origin } = await createTriagePreview();
const expect = playwrightExpect.configure({ timeout: 20000 });
const initialLeads = structuredClone(sampleLeads);
const evidenceDir = process.env.PBK_OPERATOR_EVIDENCE_DIR || 'output/faster-triage';
async function verify(type, width) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'dark' });
    const writes = [], errors = [], foreignTimelineReads = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.includes('/wrong-thread/timeline')) foreignTimelineReads.push(url.pathname);
      if (url.origin !== origin) return route.abort();
      if (request.method() !== 'GET' && url.pathname !== '/api/state/stream/session') { writes.push(url.pathname); return route.abort(); }
      return route.continue();
    });
    await page.goto(origin + '/command-center', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`${type.name()} ${width}px: checking queue subtitle`);
    const row = page.locator('[data-today-queue-id="sample-queue-0"]');
    await expect(row).toContainText(sampleLeads[0].bant.nextStep);
    await expect(row.locator('[data-triage-lead-id]')).toHaveText('SYN-L-2291');
    await expect(row).not.toContainText('Other exact ID only.');
    await expect(page.locator('[data-today-queue-id="sample-queue-2"]')).toContainText('No next step recorded');
    await expect(page.locator('[data-today-queue-id="sample-queue-3"]')).toContainText('Next step unavailable');
    const sections = page.getByRole('navigation', { name: 'Today sections', exact: true });
    await sections.getByRole('link', { name: 'Review (1)', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeFocused();
    await sections.getByRole('link', { name: 'Work queue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Work queue', exact: true })).toBeFocused();
    assert.deepEqual(await page.locator('[data-today-queue-id]').evaluateAll(nodes => nodes.map(n => n.dataset.todayQueueId)), sampleLeads.map((_, i) => `sample-queue-${i}`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Long queue IDs and text must wrap');
    const loadedFonts = await page.evaluate(async () => {
      const families = ['Geist', 'Fraunces', 'PBK JetBrains Mono NF'];
      const result = [];
      for (const family of families) result.push((await document.fonts.load(`14px "${family}"`)).length);
      return result;
    });
    assert(loadedFonts.every(count => count > 0), 'Existing PBK and Nerd Fonts must actually load locally');
    mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: join(evidenceDir, `today-${type.name()}-${width}.png`) });
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
    await page.screenshot({ path: join(evidenceDir, `workspace-${type.name()}-${width}.png`) });
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
  await verify(chromium, 1440);
  await verify(chromium, 390);
  await verify(webkit, 390);
  await verify(chromium, 320);
} finally { await server.close(); }
