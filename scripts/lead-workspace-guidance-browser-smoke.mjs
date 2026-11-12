import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, expect } from '@playwright/test';
import { createServer } from 'vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;

async function verify(browserType, width) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const writes = [], lookups = [], errors = [];
  let consent = 'no consent', dnc = 'blocked', zip = '';
  const lead = () => ({
    id: 'guidance-demo', leadId: 'guidance-demo', seller: { name: 'Guidance Sample' },
    property: { address: '14 Demo Oak Way', city: 'Example City', state: 'CA', zip, sqft: 1480 },
    compliance: { tcpaConsent: consent, dncStatus: dnc },
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin !== origin) return route.abort();
    if (!/^\/(?:api(?:\/|$)|\.netlify\/functions\/|state$|status$|health$|events$|invoke$|metrics$)/.test(path)) return route.continue();
    if (path === '/api/property-data/attom-preview') lookups.push(path);
    if (path === '/api/state/stream/session') return route.fulfill({ json: { ok: false } });
    if (request.method() !== 'GET') { writes.push(path); return route.abort(); }
    return route.fulfill({ json: path === '/api/auth/team/status' ? { ok: true, configured: false, authRequired: false }
      : path.startsWith('/api/leads/guidance-demo') ? { ok: true, lead: lead() }
        : path === '/api/leads' ? { ok: true, leads: [lead()] }
          : path === '/state' ? { leadImports: [lead()] } : { ok: true, items: [] } });
  });
  try {
    await page.goto(origin + '/leads/guidance-demo');
    const contact = page.locator('.pbk-lead-portal-card').filter({ has: page.getByRole('heading', { name: 'Contactability', exact: true }) });
    await expect(contact).toBeVisible();
    await expect(contact.locator('.pbk-lead-portal-compliance > .clear')).toHaveCount(0);
    await expect(contact.getByText('Contact blocked', { exact: true })).toBeVisible();
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
    await expect(property.getByRole('button', { name: 'Look up property', exact: true })).toBeEnabled();
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
    console.log(`${browserType.name()} ${width}px: address guidance, edit Cancel, conservative consent labels, record focus, zero writes/lookups passed`);
  } finally { await browser.close(); }
}
try {
  await verify(chromium, 1440);
  await verify(chromium, 390);
  await verify(webkit, 390);
} finally { await server.close(); }
