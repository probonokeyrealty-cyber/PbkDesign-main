import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
try {
  for (const width of [390, 1440]) {
    const control = { id: 'qa-control', seller: { name: 'Untouched control' }, property: { address: '99 Control Street' } };
    const records = new Map([[control.id, structuredClone(control)]]);
    const writes = []; const errors = [];
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.route('**/*', async route => {
      const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
      if (url.origin !== origin) return route.abort();
      if (!/^\/(api\/|state$|health$|events$|invoke$|status$|metrics$|\.netlify\/)/.test(path)) return route.continue();
      const send = json => route.fulfill({ json });
      if (path === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
      if (path === '/api/state/stream/session') return send({ ok: false });
      if (path === '/api/leads' && req.method() === 'POST') {
        const body = req.postDataJSON();
        assert.ok(!body.seller?.phone && !body.seller?.email, 'No contact details are required for a manual record');
        const lead = { ...body, id: 'qa-created', leadId: 'qa-created' };
        records.set(lead.id, lead); writes.push('create');
        return send({ ok: true, lead });
      }
      if (path === '/api/leads/qa-created' && req.method() === 'PATCH') {
        const body = req.postDataJSON(); const prior = records.get('qa-created');
        const lead = { ...prior, ...body, seller: { ...prior.seller, ...body.seller }, property: { ...prior.property, ...body.property } };
        records.set(lead.id, lead); writes.push('edit'); return send({ ok: true, lead });
      }
      if (req.method() !== 'GET') throw new Error(`Unexpected write: ${req.method()} ${path}`);
      if (path === '/api/leads') return send({ ok: true, complete: true, leads: [...records.values()] });
      if (path === '/state') return send({ leadImports: [...records.values()] });
      const id = path.match(/^\/api\/leads\/([^/]+)(?:\/full)?$/)?.[1];
      if (id) return send({ ok: true, lead: records.get(id) });
      return send({ ok: true, items: [] });
    });
    await page.goto(origin + '/leads');
    await page.getByRole('button', { name: 'Add seller', exact: true }).first().click();
    const form = page.getByRole('dialog', { name: 'Create lead' });
    await form.getByLabel('Seller name', { exact: true }).fill('[PBK QA] Manual seller');
    await form.getByLabel('Property address', { exact: true }).fill('24 Sample Oak Lane');
    await form.getByLabel('City', { exact: true }).fill('Example City');
    await form.getByLabel('State', { exact: true }).fill('CA');
    await form.getByLabel('ZIP', { exact: true }).fill('90210');
    await form.getByLabel('Beds', { exact: true }).fill('3');
    await form.getByLabel('Sq ft', { exact: true }).fill('1600');
    await form.getByRole('button', { name: 'Create lead', exact: true }).click();
    await expect(page).toHaveURL(/\/leads\/qa-created/);
    await page.reload();
    await page.goto(origin + '/leads/qa-created?edit=1');
    const edit = page.getByRole('dialog', { name: 'Edit complete seller profile' });
    await expect(edit.getByLabel('Seller name', { exact: true })).toHaveValue('[PBK QA] Manual seller');
    await expect(edit.getByLabel('Sq ft', { exact: true })).toHaveValue('1600');
    await edit.getByLabel('Seller name', { exact: true }).fill('[PBK QA] Edited seller');
    await edit.getByLabel('Beds', { exact: true }).fill('4');
    await edit.getByRole('button', { name: 'Save seller profile', exact: true }).click();
    await expect(edit).toBeHidden();
    await page.goto(origin + '/leads/qa-control');
    await expect(page.getByRole('heading', { name: 'Untouched control', exact: true })).toBeVisible();
    await page.goto(origin + '/leads/qa-created?edit=1');
    await expect(edit.getByLabel('Seller name', { exact: true })).toHaveValue('[PBK QA] Edited seller');
    await expect(edit.getByLabel('Beds', { exact: true })).toHaveValue('4');
    await expect(edit.getByLabel('Sq ft', { exact: true })).toHaveValue('1600');
    assert.deepEqual(records.get(control.id), control);
    assert.deepEqual(writes, ['create', 'edit']);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}px: no-contact manual create, canonical edit, refresh and lead-switch persistence passed`);
  }
} finally { await browser.close(); await server.close(); }
