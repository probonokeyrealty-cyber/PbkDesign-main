import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const property = { address: '123 Fixture Avenue', arv: 250000, mao: 152000, type: 'house' };
const leadA = {
  id: 'fixture-north', leadId: 'fixture-north', selectedPath: 'cash', score: 88,
  seller: { name: 'Fixture North', email: 'north@example.invalid' },
  property, assignment: { stage: 'negotiating', assignedAgent: 'Fixture Agent' },
  bant: { nextStep: 'Confirm the closing date' }, updatedAt: '2026-06-08T15:00:00Z',
};
const leadB = {
  ...leadA, id: 'fixture-south', leadId: 'fixture-south',
  seller: { name: 'Fixture South', email: 'south@example.invalid' },
};
const analyzerKey = 'pbk:local:analyzer:current-deal';

async function verify(browserType, viewport, device = {}) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    const rows = new Map([[leadA.id, leadA], [leadB.id, leadB]]);
    const writes = [];
    const unexpectedWrites = [];
    await page.addInitScript(({ key, value }) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(value));
    }, { key: `${analyzerKey}:session`, value: {
      address: '47 Analyzer Fixture Road', sellerName: 'Fixture Analyzer', sellerEmail: 'seed@example.invalid',
      type: 'house', selectedPath: 'cash', price: 144000, arv: 240000, mao60: 134000,
    } });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const path = url.pathname;
      if (url.origin !== origin) return route.abort();
      const leadPath = path.match(/^\/api\/leads\/([^/]+)(?:\/full)?$/);
      if (path === '/state') return route.fulfill({ json: { leadImports: [...rows.values()] } });
      if (path === '/api/leads' && method === 'GET') {
        return route.fulfill({ json: { leads: [...rows.values()] } });
      }
      if (path === '/api/leads' && method === 'POST') {
        const body = request.postDataJSON();
        writes.push({ method, path, body });
        const lead = { ...body, id: 'fixture-created', leadId: 'fixture-created' };
        rows.set(lead.id, lead);
        return route.fulfill({ json: { ok: true, lead } });
      }
      if (leadPath && ['GET', 'PATCH', 'DELETE'].includes(method)) {
        const id = leadPath[1];
        const existing = rows.get(id);
        if (!existing) return route.fulfill({ status: 404, json: { ok: false } });
        if (method === 'DELETE') {
          writes.push({ method, path });
          rows.delete(id);
          return route.fulfill({ json: { ok: true, leadId: id, deleted: true } });
        }
        if (method === 'PATCH') {
          const body = request.postDataJSON();
          writes.push({ method, path, body });
          const lead = { ...existing, ...body, seller: { ...existing.seller, name: body.name } };
          rows.set(id, lead);
          return route.fulfill({ json: { ok: true, lead } });
        }
        return route.fulfill({ json: { ok: true, lead: existing } });
      }
      if (/^\/(api\/|health$|events$|invoke$)/.test(path)) {
        if (method !== 'GET' && !/\/(auth\/|state\/stream\/session)/.test(path)) {
          unexpectedWrites.push([method, path]);
        }
        return route.fulfill({ json: {} });
      }
      return route.continue();
    });

    await page.goto(`${origin}/leads`);
    await expect(page.getByRole('heading', { name: 'Leads.', exact: true })).toBeVisible({ timeout: 12000 });
    const roster = page.getByRole('region', { name: 'Seller roster', exact: true });
    const north = roster.getByRole('button', { name: /^Open lead Fixture North/ });
    const south = roster.getByRole('button', { name: /^Open lead Fixture South/ });
    await expect(north).toBeVisible();
    await expect(south).toBeVisible();
    const search = roster.getByRole('searchbox', { name: 'Search leads' });
    await search.fill('Fixture South');
    await expect(north).toHaveCount(0);
    await expect(south).toBeVisible();
    await search.clear();
    await expect(north).toBeVisible();
    await expect(south).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/leads-${browserType.name()}-${viewport.width}.png` });
    }

    await page.getByRole('button', { name: 'New PBK lead', exact: true }).click();
    await expect(page.getByPlaceholder('Seller full name')).toHaveValue('Fixture Analyzer');
    await page.getByRole('button', { name: 'Create lead', exact: true }).click();
    await expect(page).toHaveURL(/\/leads\/fixture-created$/);
    assert.equal(writes[0].body.property.address, '47 Analyzer Fixture Road');
    assert.equal(writes[0].body.property.arv, 240000);
    await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
    await expect(north).toBeVisible();
    if (viewport.width < 721) {
      await roster.getByRole('link', { name: 'Open workspace for Fixture North', exact: true }).click();
    } else {
      await north.click();
      await page.getByRole('button', { name: 'Open lead', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/leads\/fixture-north$/);
    await expect(page.getByRole('heading', { name: 'Fixture North', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Lead workspace sections' })).toBeVisible();
    await expect(page.getByText('Confirm the closing date')).toBeVisible();
    assert.equal(await page.evaluate(() =>
      document.querySelector('#lead-timeline').getBoundingClientRect().left <
      document.querySelector('#lead-numbers').getBoundingClientRect().left
    ), viewport.width >= 981, 'Underwriting sits beside the timeline on desktop only');
    if (process.env.PBK_LEADS_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/lead-portal-${browserType.name()}-${viewport.width}.png` });
    }
    const timeline = page.getByRole('link', { name: 'Timeline', exact: true });
    await timeline.click();
    await expect(page).toHaveURL(/#lead-timeline$/);
    await expect(page.getByRole('heading', { name: 'Seller timeline' })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit complete seller profile' });
    await edit.getByLabel('Seller name', { exact: true }).fill('Fixture North Updated');
    await edit.getByRole('button', { name: 'Save seller profile' }).click();
    await expect(page.getByRole('heading', { name: 'Fixture North Updated', exact: true })).toBeVisible();
    assert.equal(writes[1].path, '/api/leads/fixture-north');
    assert.equal(writes[1].body.name, 'Fixture North Updated');

    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    await expect(page).toHaveURL(/\/deal\/fixture-north$/);
    await expect.poll(() => page.evaluate((key) => {
      const raw = sessionStorage.getItem(key) || '{}';
      let stored;
      try { stored = JSON.parse(atob(raw)); } catch { stored = JSON.parse(raw); }
      const deal = stored.payload || stored;
      return [deal?.leadId, deal?.sellerName, deal?.arv];
    }, `${analyzerKey}:session`)).toEqual(['fixture-north', 'Fixture North Updated', 250000]);
    await page.goto(`${origin}/leads/fixture-north`);
    const deleteButton = page.getByRole('button', { name: 'Delete lead', exact: true });
    await deleteButton.click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete Fixture North Updated?' });
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(writes.length, 2, 'Cancel must not delete a lead');
    await deleteButton.click();
    await confirm.getByRole('button', { name: 'Delete lead', exact: true }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await expect(south).toBeVisible();
    await expect(north).toHaveCount(0);
    await expect(roster.getByRole('button', { name: /^Open lead Fixture North Updated/ })).toHaveCount(0);
    assert.deepEqual(writes.map(({ method, path }) => [method, path]), [
      ['POST', '/api/leads'], ['PATCH', '/api/leads/fixture-north'], ['DELETE', '/api/leads/fixture-north'],
    ]);
    assert.deepEqual(unexpectedWrites, []);
    console.log(`${browserType.name()} ${viewport.width}px: roster, lead creation, save, Analyzer sync, and exact confirmed delete passed.`);
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
