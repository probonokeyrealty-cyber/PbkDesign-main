import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, expect } from '@playwright/test';
import { createServer } from 'vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
const leadId = 'pbk-qa-ava-specialist-links-mwu2qwk1';
const leadPath = `/leads/${leadId}`;
const leadApiPath = `/api${leadPath}`;
const consultationId = 'ava-lead-triage-e758b87bf1e7255a4205b140330da8581a3f98511dfd0545c61c524bba1e3255';

async function verify(browserType, width) {
  const verifyClipboard = browserType.name() === 'chromium';
  const browser = await browserType.launch(verifyClipboard && process.env.PBK_GUIDANCE_CHROME === '1'
    ? { channel: 'chrome' }
    : {});
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  if (verifyClipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  const writes = [], lookups = [], errors = [];
  let consent = 'no consent', dnc = 'blocked', zip = '';
  let reviewMode = 'mismatched';
  let nextStep = { code: 'hold_contact', title: 'Hold outreach', detail: 'Review the saved contact restriction.' };
  let reviewReads = 0;
  const consultationReads = [];
  const consultationRecords = [
    { id: `${consultationId}-rex`, specialist: 'Rex', status: 'complete', summary: 'Ranked the lead for internal review based on its saved score.', createdAt: '2026-11-24T02:27:28.514Z' },
    { id: `${consultationId}-hermes`, specialist: 'Hermes', status: 'complete', summary: 'Verify decision-making authority and any estate constraints during internal review.', createdAt: '2026-11-24T02:27:28.516Z' },
  ];
  const lead = () => ({
    id: leadId, leadId, seller: { name: 'Guidance Sample' },
    property: { address: '14 Demo Oak Way', city: 'Example City', state: 'CA', zip, sqft: 1480 },
    compliance: { tcpaConsent: consent, dncStatus: dnc },
  });
  page.on('pageerror', error => errors.push(error.message));
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin !== origin) return route.abort();
    if (!/^\/(?:api(?:\/|$)|\.netlify\/functions\/|state$|status$|health$|events$|invoke$|metrics$)/.test(path)) return route.continue();
    if (path === '/api/property-data/attom-preview') lookups.push(path);
    if (path === '/api/state/stream/session') return route.fulfill({ json: { ok: false } });
    if (request.method() !== 'GET') { writes.push(path); return route.abort(); }
    if (url.searchParams.has('consultation')) {
      assert.equal(path, `${leadApiPath}/full`);
      assert.equal(url.searchParams.has('review'), false);
      const id = url.searchParams.get('consultation');
      consultationReads.push(id);
      const consultation = consultationRecords.find((record) => record.id === id);
      return route.fulfill({ json: { ok: true, leadId, consultation } });
    }
    if (url.searchParams.get('review') === 'ava') {
      assert.equal(path, `${leadApiPath}/full`);
      reviewReads += 1;
      return route.fulfill({ json: { ok: true, review: {
        leadId: reviewMode === 'mismatched' ? 'different-fixture' : leadId,
        writeMode: 'read_only', reviewedAt: '2026-11-23T12:00:00Z',
        consultationDecisions: reviewMode === 'fresh-reasons' ? { version: 1, rex: 'elevated_score', hermes: 'tenant_pressure' } : null,
        consultationRecords: ['fresh-reasons', 'legacy-records'].includes(reviewMode) ? consultationRecords : [],
        nextStep,
        evidence: { property: { recorded: true }, contact: { status: 'restricted' }, qualification: { missing: ['authority'] }, underwriting: { recorded: false, recordedAt: null } },
      } } });
    }
    return route.fulfill({ json: path === '/api/auth/team/status' ? { ok: true, configured: false, authRequired: false }
      : path.startsWith(leadApiPath) ? { ok: true, lead: lead() }
        : path === '/api/leads' ? { ok: true, leads: [lead()] }
          : path === '/state' ? { leadImports: [lead()] } : { ok: true, items: [] } });
  });
  try {
    await page.goto(origin + leadPath, { waitUntil: 'domcontentloaded' });
    const contact = page.locator('.pbk-lead-portal-card').filter({ has: page.getByRole('heading', { name: 'Contactability', exact: true }) });
    await expect(contact).toBeVisible({ timeout: 20000 });
    await expect(contact.locator('.pbk-lead-portal-compliance > .clear')).toHaveCount(0);
    await expect(contact.getByText('Contact blocked', { exact: true })).toBeVisible();
    const review = page.getByRole('region', { name: 'Ava lead review' });
    const copyAll = review.getByRole('button', { name: 'Copy all links', exact: true });
    assert.equal(reviewReads, 0, 'Opening a lead leaves the run under operator control');
    await review.getByRole('button', { name: 'Run read-only review' }).click();
    await expect(review.getByRole('alert')).toBeVisible();
    await expect(review.getByText('Hold outreach', { exact: true })).toHaveCount(0);
    reviewMode = 'exact';
    await review.getByRole('button', { name: 'Retry review' }).click();
    await expect(review.getByText('Hold outreach', { exact: true })).toBeVisible();
    await expect(review.getByText('Missing authority', { exact: true })).toBeVisible();
    assert.equal(reviewReads, 2);
    await expect(review.getByText('Reasons weren’t recorded at intake.', { exact: true })).toBeVisible();
    await expect(review.getByText('Your next step', { exact: true })).toBeVisible();
    const restrictionLink = review.getByRole('link', { name: 'View contact restriction' });
    await expect(restrictionLink).toHaveAttribute('href', '#lead-contactability');
    await restrictionLink.press('Enter');
    await expect(contact.getByRole('heading', { name: 'Contactability' })).toBeFocused();
    assert.equal(reviewReads, 2, 'Following the handoff does not rerun Ava');
    await expect(review.getByRole('link')).toHaveCount(1);
    await expect(copyAll).toHaveCount(0);
    await expect(review.getByRole('button', { name: 'Copy link', exact: false })).toHaveCount(0);
    reviewMode = 'legacy-records';
    await review.getByRole('button', { name: 'Run review again' }).click();
    await expect(review.getByRole('link', { name: /^View saved .* consultation$/ })).toHaveCount(2);
    await expect(review.getByText('Reasons weren’t recorded at intake.', { exact: true })).toBeVisible();
    reviewMode = 'fresh-reasons';
    await review.getByRole('button', { name: 'Run review again' }).click();
    await expect(review.getByText('Consulted because the lead score met the review threshold.', { exact: true })).toBeVisible();
    await expect(review.getByText('Consulted because intake flagged a tenancy issue.', { exact: true })).toBeVisible();
    const reviewReadsBeforeLinks = reviewReads;
    for (const { id, specialist, summary } of consultationRecords) {
      const link = review.getByRole('link', { name: `View saved ${specialist} consultation` });
      const copyButton = review.getByRole('button', { name: `Copy link to saved ${specialist} consultation` });
      await expect(copyButton).toBeVisible();
      let destination;
      if (verifyClipboard) {
        const expected = new URL(await link.getAttribute('href'), origin).href;
        await copyButton.click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        destination = await context.newPage();
        await destination.goto(copied);
      } else {
        [destination] = await Promise.all([context.waitForEvent('page'), link.click()]);
      }
      const record = destination.getByRole('article', { name: `${specialist} consultation record` });
      await expect(record).toContainText(summary);
      assert.equal(new URL(destination.url()).pathname, `${leadPath}/consultations/${id}`);
      await expect(destination.getByRole('region', { name: 'Ava lead review' })).toHaveCount(0);
      assert.ok(await destination.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await destination.close();
    }
    assert.equal(reviewReads, reviewReadsBeforeLinks);
    assert.deepEqual(consultationReads, consultationRecords.map((record) => record.id));
    await expect(copyAll).toBeVisible();
    if (verifyClipboard) {
      const expectedLines = consultationRecords.map(({ id, specialist, createdAt }) =>
        `${specialist} consultation (${new Date(createdAt).toISOString()}) — ${origin}${leadPath}/consultations/${id}`);
      await copyAll.click();
      await expect(review.getByText('Links copied', { exact: true })).toBeVisible();
      const readClipboardLines = async () => (await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/);
      await expect.poll(readClipboardLines).toEqual(expectedLines);
      const lines = await readClipboardLines();
      for (const [index, { specialist, summary }] of consultationRecords.entries()) {
        const destination = await context.newPage();
        await destination.goto(lines[index].split(' — ').at(-1));
        await expect(destination.getByRole('article', { name: `${specialist} consultation record` })).toContainText(summary);
        await destination.close();
      }
      assert.equal(reviewReads, reviewReadsBeforeLinks);
      assert.deepEqual(consultationReads, [...consultationRecords, ...consultationRecords].map((record) => record.id));
    }
    assert.ok(await review.evaluate((element) => element.scrollWidth <= element.clientWidth));
    if (process.env.PBK_GUIDANCE_SHOTS === '1') {
      mkdirSync('.pbk-local', { recursive: true });
      await review.screenshot({ path: `.pbk-local/ava-lead-review-${browserType.name()}-${width}.png` });
    }
    for (const [code, name, destination, heading] of [
      ['review_contact', 'Check consent and DNC', '#lead-contactability', 'Contactability'],
      ['confirm_property', 'Open property details', '#lead-property', 'Property'],
      ['review_qualification', 'Review seller timeline', '#lead-timeline', 'Seller timeline'],
      ['review_offer', 'Open saved underwriting', '#lead-numbers', 'Underwriting'],
      ['review_underwriting', 'Open Analyzer', `/deal/${leadId}`],
    ]) {
      nextStep = { code, title: 'Review lead evidence', detail: 'Check the saved evidence.' };
      await review.getByRole('button', { name: 'Run review again' }).click();
      const handoff = review.getByRole('link', { name, exact: true });
      await expect(handoff).toHaveAttribute('href', destination);
      if (heading) {
        await handoff.press('Enter');
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeFocused();
      }
    }
    nextStep = { code: 'future_review_step', title: 'Review additional evidence', detail: 'Check the saved evidence.' };
    reviewMode = 'exact';
    await review.getByRole('button', { name: 'Run review again' }).click();
    await expect(review.getByText(nextStep.title, { exact: true })).toBeVisible();
    await expect(review.getByRole('link')).toHaveCount(0);
    const property = page.getByRole('region', { name: 'Property', exact: true });
    await expect(property.getByText('Missing ZIP', { exact: true })).toBeVisible();
    await property.getByRole('button', { name: 'Complete address', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit complete seller profile', exact: true });
    await expect(edit).toBeVisible();
    await expect(edit.getByLabel('ZIP', { exact: true })).toHaveValue('');
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(edit).toBeHidden();
    zip = '90210';
    for (const value of ['not approved', 'unclear', 'no consent', 'unknown', 'yes']) {
      consent = value;
      dnc = 'clear';
      await page.reload();
      await expect(contact).toBeVisible();
      await expect(contact.locator('.pbk-lead-portal-compliance > .clear')).toHaveCount(value === 'yes' ? 2 : 1);
    }
    for (const value of ['unblocked', 'not blocked', 'needs_review']) {
      dnc = value;
      await page.reload();
      await expect(contact).toBeVisible();
      await expect(contact.getByText('Contact records need review', { exact: true })).toBeVisible();
      await expect(contact.locator('.pbk-lead-portal-compliance > .clear')).toHaveCount(1);
      await expect(contact.locator('.pbk-lead-portal-compliance > .blocked')).toHaveCount(0);
    }
    await property.getByRole('button', { name: 'Review property record', exact: true }).click();
    const tab = property.getByRole('tab', { name: 'Property record', exact: true });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toBeFocused();
    await expect(property.getByRole('tabpanel', { name: 'Property record' })
      .getByRole('button', { name: 'Refresh property intelligence', exact: true })).toBeEnabled();
    await expect(property.getByText('1,480 sq ft', { exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(writes, []);
    assert.deepEqual(lookups, []);
    assert.deepEqual(errors, []);
    if (process.env.PBK_GUIDANCE_SHOTS === '1') {
      mkdirSync('.pbk-local', { recursive: true });
      await property.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.pbk-local/lead-guidance-${browserType.name()}-${width}.png`, scale: 'css' });
    }
    const browserName = verifyClipboard && process.env.PBK_GUIDANCE_CHROME === '1' ? 'Chrome' : browserType.name();
    console.log(`${browserName} ${width}px: lead review, consultation links, address guidance, consent labels, and zero writes/lookups passed`);
  } finally { await browser.close(); }
}
try {
  await verify(chromium, 1440);
  await verify(chromium, 390);
  await verify(webkit, 390);
} finally { await server.close(); }
