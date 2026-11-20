import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, webkit, expect } from '@playwright/test';
import { createServer } from 'vite';

let server, browser, origin, cache, tempRoot;
const engine = process.env.PBK_CALL_HISTORY_BROWSER === 'webkit' ? webkit : chromium;
const defaultViewport = engine === webkit ? { width: 390, height: 844 } : { width: 1440, height: 960 };
const leads = ['a', 'b'].map((id) => ({
  id: `sample-${id}`, leadId: `sample-${id}`, seller: { name: `Sample ${id.toUpperCase()}` },
  property: { address: '10 Sample Lane' },
}));
const ownCall = { ok: true, leadId: 'sample-a', call: { id: 'own', leadId: 'sample-a' }, summary: 'Seller A only recap', last_offer: 12000, transcript: [{ text: 'Seller A only words' }] };
before(async () => {
  process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
  process.env.PBK_DEV_BRIDGE_API_KEY = '';
  tempRoot = await realpath(tmpdir());
  cache = await mkdtemp(path.join(tempRoot, 'pbk-call-history-vite-'));
  server = await createServer({ envDir: false, cacheDir: cache, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/output/**'] } } });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await engine.launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (cache) {
    const target = await realpath(cache);
    assert.equal(path.dirname(target), tempRoot);
    assert.ok(path.basename(target).startsWith('pbk-call-history-vite-'));
    await rm(target, { recursive: true, force: true });
  }
});

async function open(t, { call = () => ownCall, activity = [], leadContext, leadFallbackContext, roster = () => leads, rosterStatus = () => 200, viewport = defaultViewport } = {}) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(10000);
  t.after(() => page.close());
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (!/^\/(?:api\/|\.netlify\/functions\/|state$|status$|health$|events$|invoke$|metrics$)/.test(url.pathname)) return route.continue();
    const send = (json) => route.fulfill({ json });
    if (url.pathname === '/api/state/stream/session') return send({ ok: false });
    assert.equal(req.method(), 'GET', 'No real writes, even to local fixtures');
    if (url.pathname === '/api/auth/team/status') return send({ ok: true, configured: false, authRequired: false });
    if (url.pathname === '/api/leads') return route.fulfill({ status: rosterStatus(), json: { ok: rosterStatus() === 200, complete: rosterStatus() === 200, leads: roster() } });
    if (url.pathname === '/state') return send({ leadImports: leads, activity });
    const full = url.pathname.match(/^\/api\/leads\/(sample-[ab])\/full$/);
    if (full) return send({ ok: true, lead: { ...leads.find((lead) => lead.id === full[1]), ...(leadContext ? { callContext: leadContext } : {}), ...(leadFallbackContext ? { call_context: leadFallbackContext } : {}) } });
    const last = url.pathname.match(/^\/api\/leads\/(sample-[ab])\/last-call$/);
    if (last) return send(await call(last[1]));
    return send({ ok: true, items: [] });
  });
  await page.goto(origin + '/leads');
  return page;
}
async function select(page, id) {
  await page.locator(`[data-lead-queue-id="${id}"]:visible`).click();
}

test('switching sellers hides old recap and cannot prefill the next contract while loading', async (t) => {
  const pending = Promise.withResolvers();
  t.after(() => pending.resolve({ ok: true, leadId: 'sample-b', call: null }));
  const page = await open(t, { call: (id) => id === 'sample-a' ? ownCall : pending.promise });
  await expect(page.getByText('Seller A only recap', { exact: true })).toBeVisible();
  await select(page, 'sample-b');
  await expect(page.getByText('Seller A only recap', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Seller A only words', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send Contract', exact: true }).click();
  await expect(page.locator('input[type="number"]').last()).toHaveValue('');
});

test('pending next-seller history cannot seed a contract with the previous offer', async (t) => {
  const pending = Promise.withResolvers();
  t.after(() => pending.resolve({ ok: true, leadId: 'sample-b', call: null }));
  const page = await open(t, { call: (id) => id === 'sample-a' ? ownCall : pending.promise });
  await expect(page.getByText('Seller A only recap', { exact: true })).toBeVisible();
  await select(page, 'sample-b');
  await page.getByRole('button', { name: 'Send Contract', exact: true }).click();
  await expect(page.locator('input[type="number"]').last()).toHaveValue('');
});

test('late manual refresh cannot overwrite the selected seller history', async (t) => {
  const pending = Promise.withResolvers();
  const started = Promise.withResolvers();
  let calls = 0;
  t.after(() => pending.resolve(ownCall));
  const page = await open(t, { call: (id) => {
    if (id === 'sample-b') return { ok: true, leadId: id, call: null };
    if (++calls === 1) return ownCall;
    started.resolve();
    return pending.promise;
  } });
  await expect(page.getByText('Seller A only recap', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await started.promise;
  await select(page, 'sample-b');
  await expect(page.getByText('Lead synced from bridge.', { exact: true })).toBeVisible();
  pending.resolve({ ...ownCall, summary: 'Late seller A recap' });
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(page.getByText('Late seller A recap', { exact: true })).toHaveCount(0);
});

for (const [name, payload] of [
  ['missing response ID', { ...ownCall, leadId: undefined }],
  ['mismatched response ID', { ...ownCall, leadId: 'sample-b' }],
  ['mismatched nested call ID', { ...ownCall, call: { id: 'foreign', leadId: 'sample-b' } }],
  ['missing nested call ID', { ...ownCall, call: { id: 'unidentified' } }],
]) {
  test(`rejects ${name} before rendering or contract prefill`, async (t) => {
    const page = await open(t, { call: () => payload });
    await expect(page.getByText('Lead synced from bridge.', { exact: true })).toBeVisible();
    await expect(page.getByText('Seller A only recap', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Send Contract', exact: true }).click();
    await expect(page.locator('input[type="number"]').last()).toHaveValue('');
  });
}

test('shared address and ID substrings cannot attach another seller activity', async (t) => {
  const page = await open(t, { activity: [
    { id: 'own', leadId: 'sample-a', text: 'Own exact activity' },
    { id: 'foreign', leadId: 'sample-ab', text: 'Foreign activity at 10 Sample Lane' },
    { id: 'missing', text: 'Missing ID at 10 Sample Lane' },
  ] });
  await expect(page.getByText('Own exact activity', { exact: true })).toBeVisible();
  await expect(page.getByText('Foreign activity at 10 Sample Lane', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Missing ID at 10 Sample Lane', { exact: true })).toHaveCount(0);
});

test('explicitly foreign saved call context cannot render or seed the contract', async (t) => {
  const page = await open(t, {
    call: (leadId) => ({ ok: true, leadId, call: null }),
    leadContext: { leadId: 'sample-b', summary: 'Foreign saved context', last_offer: 99000 },
  });
  await expect(page.getByText('Lead synced from bridge.', { exact: true })).toBeVisible();
  await expect(page.getByText('Foreign saved context', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send Contract', exact: true }).click();
  await expect(page.locator('input[type="number"]').last()).toHaveValue('');
});

test('390px call history stays contained', async (t) => {
  const page = await open(t, { viewport: { width: 390, height: 844 } });
  await expect(page.getByText('Seller A only recap', { exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: `output/playwright/call-history-${engine.name()}-390.png`, fullPage: true });
});

test('context aliases are ownership-checked before merging into contract prefill', async (t) => {
  const page = await open(t, {
    call: leadId => ({ ok: true, leadId, call: null }),
    leadContext: { leadId: 'sample-a' },
    leadFallbackContext: { leadId: 'sample-b', summary: 'Foreign alias recap', last_offer: 99000 },
  });
  await expect(page.getByText('Lead synced from bridge.', { exact: true })).toBeVisible();
  await expect(page.getByText('Foreign alias recap', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send Contract', exact: true }).click();
  await expect(page.locator('input[type="number"]').last()).toHaveValue('');
});

test('a confirmed empty roster never reintroduces snapshot leads or old call detail', async (t) => {
  let current = leads;
  const page = await open(t, { roster: () => current });
  await expect(page.getByText('Seller A only recap', { exact: true })).toBeVisible();
  current = [];
  await page.getByRole('button', { name: 'Refresh leads', exact: true }).click();
  await expect(page.locator('[data-lead-queue-id]:visible')).toHaveCount(0);
  await expect(page.getByText('Seller A only recap', { exact: true })).toHaveCount(0);
});

test('removing the selected lead does not silently select another seller', async (t) => {
  let current = leads;
  const page = await open(t, { roster: () => current, call: leadId => ({ ok: true, leadId, call: null }) });
  await select(page, 'sample-b');
  await expect(page.getByRole('heading', { name: 'Sample B', exact: true })).toBeVisible();
  current = [leads[0]];
  await page.getByRole('button', { name: 'Refresh leads', exact: true }).click();
  await expect(page.locator('[data-lead-queue-id]:visible')).toHaveCount(1);
  await expect(page.locator('[data-lead-queue-id][aria-pressed="true"]:visible')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send Contract', exact: true })).toHaveCount(0);
});

test('a failed roster refresh retains the last confirmed list and selected seller', async (t) => {
  let status = 200;
  const page = await open(t, { rosterStatus: () => status, call: leadId => ({ ok: true, leadId, call: null }) });
  await select(page, 'sample-b');
  await expect(page.getByRole('heading', { name: 'Sample B', exact: true })).toBeVisible();
  status = 503;
  await page.getByRole('button', { name: 'Refresh leads', exact: true }).click();
  await expect(page.getByText('Last confirmed roster', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Lead roster connection needs attention. Showing the saved roster so you can keep working.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-lead-queue-id]:visible')).toHaveCount(2);
  await expect(page.locator('[data-lead-queue-id="sample-b"]:visible')).toHaveAttribute('aria-pressed', 'true');
});
