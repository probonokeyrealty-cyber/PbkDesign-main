import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const events = [
  {
    id: 'qa-call-price',
    type: 'seller_fact',
    title: 'Call asking price',
    detail: '$240,000',
    source: 'Seller call',
    leadId: 'qa-lead',
    sourceHref: '/leads/qa-lead?source=call',
    createdAt: '2026-11-09T12:00:00Z',
    metadata: { factKey: 'asking_price', factValue: 240000 },
  },
  {
    id: 'qa-email-price',
    type: 'seller_fact',
    title: 'Email asking price',
    detail: '$255,000',
    source: 'Seller email',
    leadId: 'qa-lead',
    sourceHref: '/leads/qa-lead?source=email',
    createdAt: '2026-11-08T12:00:00Z',
    metadata: { fact_key: 'askingPrice', fact_value: '$255,000' },
  },
  {
    id: 'qa-other-price',
    type: 'seller_fact',
    title: 'Another seller asking price',
    detail: '$300,000',
    source: 'Intake',
    leadId: 'qa-other',
    createdAt: '2026-11-07T12:00:00Z',
    metadata: { factKey: 'asking_price', factValue: 300000 },
  },
  {
    id: 'qa-unlinked',
    type: 'seller_fact',
    title: 'No source recorded',
    detail: 'Fixture without a source.',
  },
];

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    const requests = [];
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (path === '/api/memory/events') {
        return route.fulfill({ json: { ok: true, events, source: 'fixture-feed' } });
      }
      const write = /^\/api\/memory\/events\/([^/]+)\/curate$/.exec(path);
      if (write && req.method() === 'POST') {
        const { action, correction } = req.postDataJSON();
        requests.push({ eventId: write[1], action, correction });
        return route.fulfill({
          json: { ok: true, eventId: write[1], action, result: 'memory_curation_recorded' },
        });
      }
      if (url.origin !== origin || /^\/(api\/|health$|state$|events$|invoke$)/.test(path)) {
        return route.fulfill({ json: { ok: true, skills: [], experiments: [] } });
      }
      return route.continue();
    });

    await page.goto(`${origin}/memory`);
    await expect(page.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible();
    const comparison = page.getByRole('region', { name: 'Conflicting facts', exact: true });
    await expect(comparison.getByText('$240,000', { exact: true })).toBeVisible();
    await expect(comparison.getByText('$255,000', { exact: true })).toBeVisible();
    await expect(comparison.getByText('$300,000', { exact: true })).toHaveCount(0);
    await expect(
      comparison.getByRole('link', { name: 'Seller call', exact: true })
    ).toHaveAttribute('href', '/leads/qa-lead?source=call');
    await expect(
      comparison.getByRole('link', { name: 'Seller email', exact: true })
    ).toHaveAttribute('href', '/leads/qa-lead?source=email');
    if (process.env.PBK_MEMORY_SCREENSHOTS === '1') {
      await comparison.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.pbk-local/memory-${engine.name()}-${viewport.width}.png` });
    }

    const search = page.getByRole('searchbox', { name: 'Search memories' });
    const recent = page.getByRole('region', { name: 'Recent memory events' });
    const conflictsFilter = page.getByRole('button', { name: /Possible conflicts\s+2/ });
    await conflictsFilter.click();
    await expect(conflictsFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(recent.getByRole('article', { name: 'Another seller asking price' })).toHaveCount(
      0
    );
    await page.getByRole('button', { name: /All memories/ }).click();
    await search.fill('no source recorded');
    const unlinked = recent.getByRole('article', { name: 'No source recorded' });
    await expect(unlinked.getByText('Source needs review', { exact: true })).toBeVisible();
    await expect(unlinked.getByRole('link', { name: 'Open source record' })).toHaveCount(0);
    await search.fill('call asking price');
    const card = recent.getByRole('article', { name: 'Call asking price' });
    await expect(card).toBeVisible();
    await expect(recent.getByRole('article', { name: 'Email asking price' })).toHaveCount(0);
    await expect(comparison.getByText('$255,000', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: 'Pin', exact: true }).click();
    const pinned = page.getByRole('region', { name: 'Pinned memories' });
    await expect(pinned.getByRole('article', { name: 'Call asking price' })).toBeVisible();
    await pinned.getByRole('button', { name: 'Unpin', exact: true }).click();
    await expect(pinned).toHaveCount(0);
    await card.getByRole('button', { name: 'Correct memory', exact: true }).click();
    await expect(card.getByText('Correction queued', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Forget', exact: true }).click();
    await expect(card.getByText('Forget request recorded', { exact: true })).toBeVisible();
    await expect(card.getByText('$240,000', { exact: true })).toBeVisible();
    assert.deepEqual(
      requests.map(({ eventId, action }) => [eventId, action]),
      [
        ['qa-call-price', 'pin'],
        ['qa-call-price', 'unpin'],
        ['qa-call-price', 'correct'],
        ['qa-call-price', 'forget'],
      ]
    );
    assert.match(requests[2].correction, /Call asking price.*\$240,000/);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    console.log(
      `Memory search, source comparison, pin, correction and forget request: ${engine.name()} ${viewport.width}px`
    );
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, { width: 1440, height: 900 });
  await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
} finally {
  await server.close();
}
