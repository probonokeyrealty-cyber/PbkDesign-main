import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const serving = process.argv.includes('--serve-fixtures');
const server = await createServer({
  plugins: [{ name: 'read-only-analyzer-preview', configureServer(server) {
    if (!serving) return;
    server.middlewares.use((req, res, next) => {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (!/^\/(api\/|state$|health$|events$|invoke$|\.netlify\/functions\/)/.test(path)) return next();
      const allowed = ['GET', 'HEAD'].includes(req.method);
      res.writeHead(allowed ? 200 : 403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(allowed ? { ok: true, items: [], leads: [], approvals: [] }
        : { ok: false, error: 'Read-only fixture: CRM and provider writes are disabled.' }));
    });
  } }],
  server: { host: '127.0.0.1', port: serving ? 5213 : 0, strictPort: serving,
    ...(serving ? { hmr: false, headers: { 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:" } } : {}),
  },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const hosted = 'https://pbk-analyzer-qa.netlify.app';
const fixture = '/scripts/fixtures/analyzer-draft-recovery.html';
const draftKey = 'pbk:prod:analyzer:current-deal';
const sessionKey = 'pbk:team-session:v1';
const session = { token: 'fixture-analyzer-session', role: 'team', expiresAt: new Date(Date.now() + 3600000).toISOString() };

async function holdDraftLock(page) {
  await page.evaluate(key => {
    window.__draftLockHeld = false;
    window.__draftLockRequest = navigator.locks.request(`${key}:write`, () => {
      window.__draftLockHeld = true;
      return new Promise(resolve => { window.__releaseDraftLock = resolve; });
    });
  }, draftKey);
  await expect.poll(() => page.evaluate(() => window.__draftLockHeld)).toBe(true);
}

async function releaseDraftLock(page) {
  await page.evaluate(async () => { window.__releaseDraftLock(); await window.__draftLockRequest; });
}

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ ...device, viewport, serviceWorkers: 'block' });
    let verification = 'valid';
    let pendingSave;
    const sampleSaves = [];
    const mutations = [];
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(({ key, authKey, auth }) => {
      if (!localStorage.getItem(authKey)) localStorage.setItem(authKey, JSON.stringify(auth));
      window.__draftWrites = [];
      window.__sharedDraftEvents = 0;
      window.addEventListener('storage', event => { if (event.key === key) window.__sharedDraftEvents++; });
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) {
          const envelope = JSON.parse(decodeURIComponent(escape(atob(value))));
          window.__draftWrites.push(envelope.payload);
          if (window.__draftWrites.length > 30) throw Error('Fixture stops a cross-tab write loop');
        }
        return set.call(this, name, value);
      };
    }, { key: draftKey, authKey: sessionKey, auth: session });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== hosted) return route.abort();
      if (url.pathname === '/api/auth/team/status') return route.fulfill({ json: { ok: true, configured: true, authRequired: true } });
      if (url.pathname === '/api/auth/team/verify') return verification === 'outage'
        ? route.fulfill({ status: 503, json: { ok: false, error: 'Fixture verification unavailable' } })
        : route.fulfill({ json: { ok: true, ...session } });
      if (url.pathname === '/api/auth/team') return route.fulfill({ json: { ok: true, ...session } });
      if (url.pathname === '/api/state/stream/session') return route.fulfill({ json: { ok: false } });
      if (url.pathname === '/api/property-data/address-suggestions') return route.fulfill({ json: { status: 'unavailable', suggestions: [] } });
      if (url.pathname === '/api/leads/qa-draft' && req.method() === 'PATCH') {
        sampleSaves.push(req.postDataJSON());
        pendingSave = route;
        return;
      }
      if (req.method() !== 'GET') {
        mutations.push(`${req.method()} ${url.pathname}`);
        return route.abort();
      }
      if (url.pathname === '/api/leads/qa-draft/full') return route.fulfill({ json: { ok: true, lead: {
        id: 'qa-draft', seller: { name: 'Fixture seller' },
        property: { address: '11 Fixture Avenue', arv: 300000, beds: 2 },
      } } });
      if (/^\/(api\/|state$|health$|events$|invoke$|\.netlify\/functions\/)/.test(url.pathname)) {
        return route.fulfill({ json: { ok: true, items: [], approvals: [], leads: [] } });
      }
      if (!['document', 'script', 'stylesheet', 'font', 'image'].includes(req.resourceType())) return route.abort();
      return route.fulfill({ response: await route.fetch({ url: origin + url.pathname + url.search }) });
    });
    const first = await context.newPage();
    const address = page => page.getByRole('combobox', { name: 'Address', exact: true });
    const ready = async page => {
      await expect(address(page)).toBeVisible({ timeout: 60000 });
      await expect.poll(() => page.evaluate(() => Boolean(window.PBKAnalyzer?.getState))).toBe(true);
    };
    const stored = page => page.evaluate(key => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(decodeURIComponent(escape(atob(raw)))).payload : null;
    }, draftKey);
    await first.goto(hosted + fixture);
    await ready(first);
    await first.evaluate(() => window.PBKAnalyzer.setState({ deal: {
      leadId: 'qa-draft', address: '11 Fixture Avenue', beds: 4, arv: 500000,
      notes: 'Manual sample notes', repairs: { condition: 'C3', low: 12000, mid: 15000, high: 18000 },
    }, manualFields: ['notes', 'repairs'] }));
    await expect.poll(async () => (await stored(first))?.notes).toBe('Manual sample notes');
    await first.reload();
    await ready(first);
    await expect(address(first)).toHaveValue('11 Fixture Avenue');
    assert.deepEqual(await first.evaluate(() => window.__draftWrites), [],
      'Restoring an Analyzer draft must not write initial defaults or recalculate shared storage');

    const second = await context.newPage();
    await second.goto(hosted + fixture);
    await ready(second);
    assert.deepEqual(await second.evaluate(() => window.__draftWrites), [], 'An overlapping Analyzer tab must be read-only until edited');

    const seed = await first.evaluate(() => window.PBKAnalyzer.getState().deal);
    await holdDraftLock(first);
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('5');
    await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThanOrEqual(1);
    await second.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('6');
    await expect.poll(() => second.evaluate(key => {
      const envelope = JSON.parse(decodeURIComponent(escape(atob(sessionStorage.getItem(`${key}:session`)))));
      return envelope.unpublishedEdits && envelope.payload.beds;
    }, draftKey)).toBe(6);
    assert.equal((await stored(first)).beds, 4, 'Neither contender may publish while another context holds the shared draft lock');
    await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThanOrEqual(2);
    await releaseDraftLock(first);
    await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(0);
    const publications = [...await first.evaluate(() => window.__draftWrites), ...await second.evaluate(() => window.__draftWrites)];
    assert.equal(publications.length, 1, `Exactly one simultaneous writer may publish from the shared baseline: ${JSON.stringify(publications.map(value => ({ beds: value.beds, arv: value.arv, mao: value.mao, isAnalyzed: value.isAnalyzed })))}`);
    const winner = (await stored(first)).beds;
    assert.ok([5, 6].includes(winner));
    const loser = winner === 5 ? second : first;
    const privateBeds = winner === 5 ? 6 : 5;
    await expect(loser.locator('#analyzer-valuation').getByText(/Another tab changed this draft/)).toBeVisible();
    assert.equal(await loser.evaluate(key => JSON.parse(decodeURIComponent(escape(atob(sessionStorage.getItem(`${key}:session`))))).payload.beds, draftKey), privateBeds,
      'The losing simultaneous writer must retain its private edit');
    await loser.reload();
    await ready(loser);
    await expect(loser.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue(String(privateBeds));
    assert.deepEqual(await loser.evaluate(() => window.__draftWrites), []);
    console.log(`Simultaneous draft writers: ${engine.name()} ${viewport.width}px passed`);
    if (process.argv.includes('--stress-contention')) return;

    await first.evaluate(deal => {
      document.activeElement?.blur();
      window.PBKAnalyzer.setState({ deal, manualFields: ['notes', 'repairs'] });
    }, seed);
    await expect.poll(async () => (await stored(first))?.beds).toBe(4);
    await second.evaluate(key => sessionStorage.removeItem(`${key}:session`), draftKey);
    await first.reload();
    await second.reload();
    await ready(first);
    await ready(second);

    await holdDraftLock(first);
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('5');
    await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThanOrEqual(1);
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('8');
    await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThanOrEqual(2);
    assert.equal((await stored(first)).beds, 4);
    await releaseDraftLock(first);
    await expect.poll(async () => (await stored(first))?.beds).toBe(8);
    assert.deepEqual(await first.evaluate(() => window.__draftWrites.map(value => value.beds)), [8], 'Only the latest queued edit may publish');
    await expect(second.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('8');

    // The lock holder survives while a different tab's Analyzer is unmounted by sign-in.
    await holdDraftLock(second);
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('9');
    await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThanOrEqual(1);
    await first.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
      detail: { code: 'team_session_rejected', sessionWasCurrent: true },
    })));
    await first.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-passcode');
    await first.getByRole('button', { name: 'Open command center' }).click();
    await ready(first);
    await expect(first.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('9');
    await releaseDraftLock(second);
    await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(0);
    assert.equal((await stored(first)).beds, 8, 'An unmounted publisher must not flush a queued edit');
    await second.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('7');
    await expect.poll(async () => (await stored(second))?.beds).toBe(7);
    await first.bringToFront();
    await first.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(first.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('9');

    await holdDraftLock(second);
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('12');
    await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThanOrEqual(1);
    first.once('dialog', dialog => dialog.accept());
    await first.getByRole('button', { name: 'Clear', exact: true }).click();
    await releaseDraftLock(second);
    await expect.poll(() => stored(first)).toBe(null);
    await expect(address(first)).toHaveValue('');
    assert.ok(!(await first.evaluate(() => window.__draftWrites)).some(value => value.beds === 12), 'Clear must cancel queued edits before removing shared state');

    await holdDraftLock(first);
    const third = await context.newPage();
    await third.goto(hosted + fixture + '?lead=qa-draft');
    await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThan(0);
    await third.goto(hosted + fixture);
    await ready(third);
    await releaseDraftLock(first);
    await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(0);
    assert.equal(await stored(first), null, 'A canceled cold lead handoff must not publish after navigation');
    await third.close();

    await first.evaluate(deal => {
      document.activeElement?.blur();
      window.PBKAnalyzer.setState({ deal, manualFields: ['notes', 'repairs'] });
    }, seed);
    await expect.poll(async () => (await stored(first))?.beds).toBe(4);
    await second.evaluate(key => sessionStorage.removeItem(`${key}:session`), draftKey);
    await first.reload();
    await second.reload();
    await ready(first);
    await ready(second);
    console.log(`Queued draft lifecycle: ${engine.name()} ${viewport.width}px passed`);
    await second.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('6');
    await expect.poll(async () => (await stored(second))?.beds).toBe(6);
    await expect(first.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('6');
    assert.deepEqual(await first.evaluate(() => window.__draftWrites), [], 'A passive storage listener must not echo its stale session draft');

    await first.locator('#deal-arv').fill('510000');
    await first.getByRole('spinbutton', { name: 'Comp A sold price', exact: true }).fill('600000');
    await expect(first.locator('#deal-arv')).toHaveValue('600000');
    await expect.poll(async () => (await stored(first))?.comps.A.price).toBe(600000);
    await second.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('7');
    await expect(second.locator('#analyzer-valuation').getByText('Another tab changed this draft. Your edits are kept in this tab. Review before saving.')).toBeVisible();
    assert.ok(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.PBK_DRAFT_SCREENSHOTS === '1') {
      mkdirSync('.pbk-local', { recursive: true });
      await second.screenshot({ path: `.pbk-local/analyzer-draft-conflict-${engine.name()}-${viewport.width}.png` });
    }
    assert.equal((await stored(first)).beds, 6, 'A stale manual edit must not replace the newer shared draft');
    assert.equal((await stored(first)).comps.A.price, 600000);
    await second.reload();
    await ready(second);
    await expect(second.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('7');
    assert.deepEqual(await second.evaluate(() => window.__draftWrites), [], 'A conflicted tab must recover its private draft without publishing it');
    assert.equal((await stored(first)).beds, 6);
    await first.getByRole('spinbutton', { name: 'Square footage', exact: true }).fill('1250');
    await expect.poll(() => second.evaluate(() => window.__sharedDraftEvents)).toBeGreaterThan(0);
    await second.bringToFront();
    await second.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(second.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('7');
    const sharedBeforeLinkedReload = await stored(first);
    await second.goto(hosted + fixture + '?lead=qa-draft');
    await ready(second);
    await expect(second.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('7');
    assert.deepEqual(await stored(first), sharedBeforeLinkedReload, 'Cold linked-route hydration must not publish a conflicted private draft');

    const before = await stored(second);
    verification = 'outage';
    await first.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
      detail: { code: 'private_site_auth_required', message: 'Fixture verifier outage' },
    })));
    await first.getByRole('button', { name: 'Verify access again' }).click();
    await expect(first.getByRole('alert')).toContainText(/unavailable|503/i);
    assert.deepEqual(await stored(first), before);
    verification = 'valid';
    await first.getByRole('button', { name: 'Verify access again' }).click();
    await expect(first.getByRole('button', { name: 'Verify access again' })).toHaveCount(0);
    assert.deepEqual(await stored(first), before);

    const writesBeforeSignIn = await first.evaluate(() => window.__draftWrites.length);
    await first.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
      detail: { code: 'team_session_rejected', sessionWasCurrent: true },
    })));
    await first.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-passcode');
    await first.getByRole('button', { name: 'Open command center' }).click();
    await ready(first);
    await expect(first.locator('#deal-arv')).toHaveValue('600000');
    assert.equal(await first.evaluate(() => window.__draftWrites.length), writesBeforeSignIn, 'Sign-in remount must not publish defaults or restored state');
    assert.deepEqual(await stored(first), before);

    await first.goto(hosted + fixture + '?lead=qa-draft');
    await ready(first);
    await expect(first.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('6');
    await expect(first.locator('#deal-arv')).toHaveValue('600000');
    await expect(first.getByRole('spinbutton', { name: 'Comp A sold price', exact: true })).toHaveValue('600000');
    assert.deepEqual(await first.evaluate(() => window.__draftWrites), [], 'Same-lead restoration must not publish a new shared envelope');
    await first.getByRole('spinbutton', { name: 'Bathrooms', exact: true }).fill('3');
    await expect.poll(async () => (await stored(first))?.baths).toBe(3);
    assert.equal((await stored(first)).notes, 'Manual sample notes', 'Reopening a saved lead must not replace its unsaved draft');
    await first.getByRole('button', { name: /^Save(?: deal)?$/ }).filter({ visible: true }).click();
    await expect.poll(() => sampleSaves.length).toBe(1);
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('9');
    await expect.poll(async () => (await stored(first))?.beds).toBe(9);
    await pendingSave.fulfill({ json: { ok: true } });
    await expect(first.locator('#analyzer-valuation').getByText(/newer edits remain/i)).toBeVisible();
    assert.equal((await stored(first)).beds, 9, 'Acknowledging an older save must not replace subsequent edits');
    await first.getByRole('button', { name: /^Save(?: deal)?$/ }).filter({ visible: true }).click();
    await expect.poll(() => sampleSaves.length).toBe(2);
    await first.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
      detail: { code: 'team_session_rejected', sessionWasCurrent: true },
    })));
    await first.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-passcode');
    await first.getByRole('button', { name: 'Open command center' }).click();
    await ready(first);
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('10');
    await expect.poll(async () => (await stored(first))?.beds).toBe(10);
    const writesAfterRemount = await first.evaluate(() => window.__draftWrites.length);
    const completedSave = first.waitForResponse(response => response.url() === hosted + '/api/leads/qa-draft' && response.request().method() === 'PATCH');
    await pendingSave.fulfill({ json: { ok: true } });
    await completedSave;
    await first.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await first.evaluate(() => window.__draftWrites.length), writesAfterRemount, 'An obsolete save completion must not write after a session remount');
    assert.equal((await stored(first)).beds, 10);
    const beforeUnavailable = await stored(first);
    await first.evaluate(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('11');
    await expect(first.locator('#analyzer-valuation').getByText(/Shared draft coordination is unavailable/)).toBeVisible();
    assert.deepEqual(await stored(first), beforeUnavailable, 'Unavailable coordination must fail closed without changing shared state');
    assert.equal(await first.evaluate(key => JSON.parse(decodeURIComponent(escape(atob(sessionStorage.getItem(`${key}:session`))))).payload.beds, draftKey), 11);
    await first.evaluate(key => localStorage.removeItem(key), draftKey);
    await second.reload();
    await ready(second);
    await second.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('8');
    await expect(second.locator('#analyzer-valuation').getByText(/Another tab changed this draft/)).toBeVisible();
    assert.equal(await stored(first), null, 'A private draft must not recreate a shared clear without explicit Save');
    await second.close();
    assert.deepEqual(mutations, [], 'Draft tests must not save leads or contact providers');
    assert.ok(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`Analyzer draft restoration, overlapping tabs and session recovery: ${engine.name()} ${viewport.width}px passed`);
  } finally {
    await browser.close();
  }
}

try {
  if (serving) {
    console.log(`Read-only Analyzer sample preview: ${origin}${fixture}?sample=1`);
    await new Promise(resolve => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } else {
    if (process.argv.includes('--stress-contention')) {
      for (let attempt = 0; attempt < 6; attempt++) await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
    } else {
      if (!process.argv.includes('--webkit-only')) await verify(chromium, { width: 1440, height: 960 });
      await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
      await verify(webkit, { width: 320, height: 844 }, devices['iPhone 13']);
    }
  }
} finally {
  await server.close();
}
