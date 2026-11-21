import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { chromium, webkit, expect as playwrightExpect } from '@playwright/test';
import { fixtureResponse, sampleLeads } from './fixtures/faster-triage-fixture.mjs';

// Serve only the local production build; no dev proxy, credentials or provider connection.
const dist = resolve('dist');
assert(existsSync(resolve(dist, 'index.shell.html')), 'Run npm run build first');
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(dist, '.' + (/^\/(?:deal|leads|analyzer)(?:\/|$)/.test(path) ? '/index.shell.html' : path));
  if (!file.startsWith(dist + '/') && !file.startsWith(dist + '\\')) { res.writeHead(403).end(); return; }
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const base = 'https://pbk-fresh-qa.netlify.app';
const key = 'pbk:prod:analyzer:current-deal';
const expect = playwrightExpect.configure({ timeout: 30000 });
const savedLead = { ...structuredClone(sampleLeads[0]),
  property: { ...sampleLeads[0].property, beds: 6, baths: 8, sqft: 9138 },
  deal: { notes: 'Saved manual sample notes, unchanged.', comps: {
    A: { address: '12 Fixture Avenue', price: 400000, date: '2026-10-26', link: '' },
    B: { address: '', price: 0, date: '', link: '' },
    C: { address: '', price: 0, date: '', link: '' },
  } },
};
const originalLead = JSON.stringify(savedLead);
const session = { token: 'fixture-fresh-session', role: 'team', expiresAt: new Date(Date.now() + 3600000).toISOString() };
const address = page => page.getByRole('combobox', { name: 'Address', exact: true });
const beds = page => page.getByRole('spinbutton', { name: 'Bedrooms', exact: true });
async function deal(page) {
  let state;
  await expect.poll(async () => {
    state = await page.evaluate(() => window.PBKAnalyzer?.getState().deal || null);
    return state !== null;
  }).toBe(true);
  return state;
}
const snapshot = page => page.evaluate(key => ({ shared: localStorage.getItem(key),
  private: sessionStorage.getItem(key + ':session'), compose: localStorage.getItem('pbk:compose:draft') }), key);
async function ready(page) {
  await expect(address(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.PBKAnalyzer))).toBe(true);
}

async function verify(engine, width) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', colorScheme: 'dark' });
    let wrongId = false, unavailable = false, verifierDown = false;
    const writes = [], errors = [], reads = [];
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && message.text().includes('DealView')) console.error(message.text()); });
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(({ session, base }) => {
      if (location.origin !== base) return;
      localStorage.setItem('pbk:prefs:v1', JSON.stringify({ theme: 'dark', tourCompleted: true }));
      if (!localStorage.getItem('pbk:team-session:v1')) localStorage.setItem('pbk:team-session:v1', JSON.stringify(session));
    }, { session, base });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/api/auth/team/status') return route.fulfill({ json: { ok: true, configured: true, authRequired: true } });
      if (url.pathname === '/api/auth/team/verify') return route.fulfill({ status: verifierDown ? 503 : 200,
        json: verifierDown ? { ok: false, error: 'Sample verifier unavailable' } : { ok: true, ...session } });
      if (url.pathname === '/api/auth/team') return route.fulfill({ json: { ok: true, ...session } });
      if (url.pathname === '/api/state/stream/session') return route.fulfill({ json: { ok: false } });
      if (req.method() !== 'GET') { writes.push(req.method() + ' ' + url.pathname); return route.abort(); }
      if (url.pathname === `/api/leads/${savedLead.id}/full`) {
        reads.push(url.pathname);
        return route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { ok: false } : {
          ok: true, lead: wrongId ? { ...savedLead, id: savedLead.id + '0' } : savedLead,
        } });
      }
      if (/^\/(api(?:\/|$)|brain(?:\/|$)|state$|health$|status$|events$|invoke$|metrics$|\.netlify\/functions\/)/.test(url.pathname)) {
        return route.fulfill({ json: fixtureResponse(url.pathname, url.searchParams) });
      }
      return route.fulfill({ response: await route.fetch({ url: origin + url.pathname + url.search }) });
    });

    const original = await context.newPage();
    await original.goto(base + '/analyzer');
    await ready(original);
    await original.evaluate(({ leadId, key }) => {
      localStorage.setItem('pbk:compose:draft', 'Unsent sample Compose draft');
      window.PBKAnalyzer.setState({ deal: { leadId, address: 'Old manual draft', beds: 4, sqft: 1600,
        notes: 'Original unsaved notes', comps: { A: { address: 'Private old comp', price: 123456, date: '', link: '' } } },
      manualFields: ['address', 'beds', 'sqft', 'notes', 'comps'] });
    }, { leadId: savedLead.id, key });
    await expect.poll(() => original.evaluate(key => {
      const raw = localStorage.getItem(key);
      return raw && JSON.parse(decodeURIComponent(escape(atob(raw)))).payload.notes;
    }, key)).toBe('Original unsaved notes');
    const before = await snapshot(original);
    const originalDeal = await deal(original);

    const workspace = await context.newPage();
    await workspace.goto(base + '/leads/' + savedLead.id);
    await workspace.getByRole('tab', { name: 'Photos', exact: true }).click();
    const link = workspace.getByRole('link', { name: 'Open in fresh Analyzer', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /#lead-photos$/);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener/);
    await link.focus();
    await expect(link).toBeFocused();
    const popupEvent = context.waitForEvent('page');
    await link.click();
    const fresh = await popupEvent;
    await ready(fresh);
    assert.equal(await fresh.evaluate(() => window.opener === null), true);
    await expect(beds(fresh)).toHaveValue('6');
    await expect(fresh.getByRole('spinbutton', { name: 'Square footage', exact: true })).toHaveValue('9138');
    await expect(fresh.getByText('Fresh Analyzer / Tab-local draft', { exact: true })).toBeVisible();
    assert.equal((await deal(fresh)).leadId, savedLead.id);
    assert.equal((await deal(fresh)).notes, savedLead.deal.notes);
    assert.equal((await deal(fresh)).comps.A.price, 400000);
    assert.equal((await deal(fresh)).comps.A.address, '12 Fixture Avenue');
    await beds(fresh).fill('7');
    await fresh.getByRole('spinbutton', { name: 'Comp A sold price', exact: true }).fill('420000');
    await expect(fresh.locator('#deal-arv')).toHaveValue('420000');
    await fresh.reload();
    await ready(fresh);
    await expect(beds(fresh)).toHaveValue('7');
    assert.equal((await deal(fresh)).comps.A.price, 420000);
    assert.equal((await deal(fresh)).notes, savedLead.deal.notes);

    // Shared updates cannot replace even untouched values in this fresh draft.
    await original.getByRole('spinbutton', { name: 'Bathrooms', exact: true }).fill('3');
    await expect.poll(() => original.evaluate(key => JSON.parse(decodeURIComponent(escape(atob(localStorage.getItem(key))))).payload.baths, key)).toBe(3);
    const changedOriginal = await snapshot(original);
    await fresh.bringToFront();
    await expect(fresh.getByRole('spinbutton', { name: 'Bathrooms', exact: true })).toHaveValue('8');

    verifierDown = true;
    await fresh.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
      detail: { code: 'private_site_auth_required', message: 'Sample verification outage' },
    })));
    await fresh.getByRole('button', { name: 'Verify access again' }).click();
    await expect(fresh.getByRole('alert')).toContainText(/unavailable|503/i);
    verifierDown = false;
    await fresh.getByRole('button', { name: 'Verify access again' }).click();
    await expect(fresh.getByRole('button', { name: 'Verify access again' })).toHaveCount(0);
    await fresh.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
      detail: { code: 'team_session_rejected', sessionWasCurrent: true },
    })));
    await fresh.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-passcode');
    await fresh.getByRole('button', { name: 'Open command center' }).click();
    await ready(fresh);
    await expect(beds(fresh)).toHaveValue('7');
    assert.equal((await deal(fresh)).comps.A.price, 420000);
    assert.equal((await deal(fresh)).notes, savedLead.deal.notes);
    assert.deepEqual(await snapshot(original), changedOriginal);

    const freshUrl = fresh.url();
    if (width < 720) await fresh.getByRole('button', { name: 'More - open all dashboard pages' }).click();
    await fresh.getByRole('link', { name: 'Deal', exact: true }).click();
    await ready(fresh);
    await expect(address(fresh)).toHaveValue('Old manual draft');
    await expect(beds(fresh)).toHaveValue('4');
    await fresh.goBack();
    await ready(fresh);
    assert.equal(fresh.url(), freshUrl);
    await expect(beds(fresh)).toHaveValue('7');
    await expect(fresh.getByRole('spinbutton', { name: 'Comp A sold price', exact: true })).toHaveValue('420000');
    await expect.poll(async () => (await deal(fresh)).comps.A.price).toBe(420000);
    assert.equal((await deal(fresh)).notes, savedLead.deal.notes);
    await fresh.goForward();
    await ready(fresh);
    await expect(address(fresh)).toHaveValue('Old manual draft');
    await fresh.goBack();
    await ready(fresh);
    await expect(beds(fresh)).toHaveValue('7');
    assert.deepEqual(await snapshot(original), changedOriginal);

    // CRM snapshots for another lead may not replace this URL's private draft.
    await fresh.evaluate(snapshot => localStorage.setItem('pbk:prod:analyzer:saved-deals', JSON.stringify([{
      id: 'sample-other-deal', address: 'Other sample property', status: 'active', lastUpdated: '2026-11-17',
      dealData: { ...snapshot, leadId: snapshot.leadId + '0', address: 'Other sample property', notes: 'Other saved notes' },
    }])), await deal(fresh));
    if (width < 720) await fresh.locator('.pbk-analyzer-mobile-toggle').click();
    await fresh.getByRole('button', { name: 'Switch analyzer tab to CRM', exact: true }).click();
    await fresh.getByRole('button', { name: 'Open Deal', exact: true }).click();
    await expect(fresh.locator('#analyzer-valuation').getByText('Different lead not loaded. This fresh draft has been kept.', { exact: true })).toBeVisible();
    await expect(beds(fresh)).toHaveValue('7');
    assert.equal((await deal(fresh)).notes, savedLead.deal.notes);
    await fresh.reload();
    await ready(fresh);
    await expect(beds(fresh)).toHaveValue('7');
    assert.equal((await deal(fresh)).comps.A.price, 420000);
    assert.deepEqual(await snapshot(original), changedOriginal);

    const extraEvent = context.waitForEvent('page');
    await link.click();
    const extra = await extraEvent;
    await ready(extra);
    await expect(beds(extra)).toHaveValue('6');
    assert.equal((await deal(extra)).comps.A.price, 400000);
    extra.once('dialog', dialog => dialog.accept());
    await extra.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(address(extra)).toHaveValue('');
    assert.deepEqual(await snapshot(original), changedOriginal, 'Clear in a fresh tab cannot erase the shared draft');
    await extra.close();

    wrongId = true;
    const failed = await context.newPage();
    await failed.goto(await link.getAttribute('href').then(href => base + href));
    await expect(failed.getByText('Seller record unavailable', { exact: true })).toBeVisible();
    assert.equal(await failed.evaluate(() => Boolean(window.PBKAnalyzer)), false);
    wrongId = false;
    unavailable = true;
    await failed.reload();
    await expect(failed.getByText('Seller record unavailable', { exact: true })).toBeVisible();
    unavailable = false;
    await failed.getByRole('button', { name: 'Retry lead load' }).click();
    await ready(failed);
    await expect(beds(failed)).toHaveValue('6');
    await failed.getByRole('link', { name: 'Back to lead', exact: true }).click();
    await expect(failed).toHaveURL(base + '/leads/' + savedLead.id + '#lead-photos');
    await expect(failed.getByRole('tab', { name: 'Photos', exact: true })).toHaveAttribute('aria-selected', 'true');
    assert.deepEqual(await snapshot(original), changedOriginal);
    assert.equal(before.compose, changedOriginal.compose);
    assert.equal(originalDeal.notes, (await deal(original)).notes);
    assert.equal(originalLead, JSON.stringify(savedLead));
    assert.deepEqual(writes, [], 'No lead, provider, approval or send requests');
    assert.deepEqual(errors, []);
    assert(reads.length >= 4);
    for (const page of [workspace, fresh]) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No viewport overflow');
    }
    mkdirSync('.pbk-local/fresh-analyzer', { recursive: true });
    await workspace.screenshot({ path: `.pbk-local/fresh-analyzer/workspace-${engine.name()}-${width}.png` });
    await fresh.screenshot({ path: `.pbk-local/fresh-analyzer/analyzer-${engine.name()}-${width}.png` });
    console.log(`${engine.name()} ${width}px: fresh link, exact saved ID, notes/comps, overlap, reload, recovery, clear and errors passed; zero writes`);
  } finally { await browser.close(); }
}

try {
  await verify(chromium, 1440);
  await verify(chromium, 390);
  await verify(webkit, 390);
  await verify(chromium, 320);
} finally { await new Promise(resolve => server.close(resolve)); }
