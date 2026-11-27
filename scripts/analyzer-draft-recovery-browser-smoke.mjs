import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { analyzerBrowserFixtureOptions, warmAnalyzerBrowserFixture } from './fixtures/analyzer-browser-warmup.mjs';
import { analyzerPublicationTrace, observeAnalyzerFixtureStartup } from './fixtures/analyzer-publication-trace.mjs';
import { verifyAnalyzerPublicationGuards } from './fixtures/analyzer-publication-timing.mjs';

const chromiumOnly = process.argv.includes('--chromium-only');
const webkitOnly = process.argv.includes('--webkit-only');
const runtimePolling = process.argv.includes('--runtime-polling');
assert.ok(!(chromiumOnly && webkitOnly), 'Choose only one browser filter');
const stressPublication = process.argv.includes('--stress-publication');
const controlledPublication = process.argv.includes('--controlled-publication');
assert.ok(!(chromiumOnly && (process.argv.includes('--stress-contention') || stressPublication)), 'Stress contention uses WebKit; remove the Chromium-only filter');
assert.ok(!(stressPublication && process.argv.includes('--stress-contention')), 'Choose only one stress scenario');
assert.ok(!(controlledPublication && (stressPublication || process.argv.includes('--stress-contention'))), 'Choose controlled timing or stress repetition');
process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const serving = process.argv.includes('--serve-fixtures');
const server = await createServer({
  ...analyzerBrowserFixtureOptions(),
  plugins: [analyzerPublicationTrace(process.env.PBK_DRAFT_DIAGNOSTICS === '1' || controlledPublication), { name: 'read-only-analyzer-preview', configureServer(server) {
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
    hmr: false,
    ...(serving ? { headers: { 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:" } } : {}),
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
    const stateSockets = new Set();
    await context.routeWebSocket('**/*', socket => {
      if (!runtimePolling) return socket.close();
      stateSockets.add(socket);
      socket.onClose(() => stateSockets.delete(socket));
    });
    await context.addInitScript(({ key, authKey, auth, origin, runtimePolling }) => {
      if (location.origin !== origin) return;
      window.__runtimePollingFixture = runtimePolling;
      if (!localStorage.getItem(authKey)) localStorage.setItem(authKey, JSON.stringify(auth));
      window.__draftWrites = [];
      window.__sharedDraftEvents = 0;
      window.__draftPublicationTrace = [];
      let traceSequence = 0;
      const activePublications = new Map();
      window.__recordDraftPublication = (phase, data) => {
        const beds = raw => {
          try { return JSON.parse(decodeURIComponent(escape(atob(raw))))?.payload?.beds; } catch { return null; }
        };
        const hash = raw => typeof raw === 'string'
          ? [...raw].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0 : raw === null ? 'empty' : 'undefined';
        const expectedHash = hash(data.expected);
        let traceId = data.traceId;
        if (phase === 'start') {
          traceId = ++traceSequence;
          activePublications.set(traceId, { beds: data.beds, expectedHash });
        } else if (phase === 'conflict' || phase === 'compare') {
          const matches = [...activePublications].filter(([, value]) => value.beds === data.beds && value.expectedHash === expectedHash);
          traceId = matches.length === 1 ? matches[0][0] : null;
        } else if (traceId) activePublications.delete(traceId);
        window.__draftPublicationTrace.push({ phase, traceId, at: performance.now(), version: data.version, currentVersion: data.currentVersion,
          beds: data.beds, result: data.result, expectedDefined: data.expected !== undefined,
          expectedHash, sharedHash: hash(data.shared),
          canonicalHash: hash(data.canonical), expectedBeds: beds(data.expected), sharedBeds: beds(data.shared),
          canonicalBeds: beds(data.canonical) });
        if (window.__draftPublicationTrace.length > 100) window.__draftPublicationTrace.shift();
        return traceId;
      };
      window.addEventListener('storage', event => { if (event.key === key) window.__sharedDraftEvents++; });
      const set = Storage.prototype.setItem;
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (this === localStorage && name === key && window.__staleDraftRead !== undefined) {
          const stale = window.__staleDraftRead;
          if (window.__staleDraftReadOnce) {
            delete window.__staleDraftReadOnce;
            window.__controlledStaleReads = (window.__controlledStaleReads || 0) + 1;
            queueMicrotask(() => {
              delete window.__staleDraftRead;
              const caughtUp = window.__onControlledCacheCatchup;
              delete window.__onControlledCacheCatchup;
              caughtUp?.();
            });
          }
          return stale;
        }
        return get.call(this, name);
      };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) {
          const envelope = JSON.parse(decodeURIComponent(escape(atob(value))));
          window.__draftWrites.push(envelope.payload);
          if (window.__draftWrites.length > 30) throw Error('Fixture stops a cross-tab write loop');
        }
        return set.call(this, name, value);
      };
    }, { key: draftKey, authKey: sessionKey, auth: session, origin: hosted, runtimePolling });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== hosted) return route.abort();
      if (url.pathname === '/api/auth/team/status') return route.fulfill({ json: { ok: true, configured: true, authRequired: true } });
      if (url.pathname === '/api/auth/team/verify') return verification === 'outage'
        ? route.fulfill({ status: 503, json: { ok: false, error: 'Fixture verification unavailable' } })
        : route.fulfill({ json: { ok: true, ...session } });
      if (url.pathname === '/api/auth/team') return route.fulfill({ json: { ok: true, ...session } });
      if (url.pathname === '/api/state/stream/session') return route.fulfill({ json: runtimePolling
        ? { ok: true, session: { wsUrl: hosted.replace('https:', 'wss:') + '/ws/state' } } : { ok: false } });
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
      // Do not reuse a stale loopback socket between WebKit tab navigations.
      const response = await route.fetch({
        url: origin + url.pathname + url.search,
        headers: { ...req.headers(), connection: 'close' },
      });
      return route.fulfill({ response });
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
    const startup = observeAnalyzerFixtureStartup(first, hosted);
    try {
      await first.goto(hosted + fixture);
    } catch (error) {
      if (process.env.PBK_DRAFT_DIAGNOSTICS === '1') {
        console.log(JSON.stringify({ sampleStartup: { engine: engine.name(), width: viewport.width, ...startup.snapshot() } }));
      }
      throw error;
    } finally { startup.dispose(); }
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
    // Reproduce WebKit's per-process localStorage lag independently of renderer scheduling.
    await second.evaluate(key => { window.__staleDraftRead = localStorage.getItem(key); }, draftKey);
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
    await second.evaluate(() => { delete window.__staleDraftRead; });
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

    // Cancel after the IDB reservation is written, then prove the original baseline still works.
    const beforeReservation = await stored(first);
    const beforeReservationRaw = controlledPublication
      ? await first.evaluate(key => localStorage.getItem(key), draftKey) : undefined;
    const canceledReservation = await first.evaluate(async key => {
      const put = IDBObjectStore.prototype.put;
      let current = true;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        current = false;
        return request;
      };
      try {
        return await window.__commitSampleDraft({ ...window.PBKAnalyzer.getState().deal, beds: 99 }, [], localStorage.getItem(key), false, () => current);
      } finally { IDBObjectStore.prototype.put = put; }
    }, draftKey);
    assert.equal(canceledReservation, 'superseded');
    assert.deepEqual(await stored(first), beforeReservation);
    const failedProjection = await first.evaluate(async key => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key) throw new DOMException('Fixture quota failure', 'QuotaExceededError');
        return set.call(this, name, value);
      };
      try {
        await window.__commitSampleDraft({ ...window.PBKAnalyzer.getState().deal, beds: 98 }, [], localStorage.getItem(key), false, () => true);
        return 'unexpected-success';
      } catch (error) { return error.name; }
      finally { Storage.prototype.setItem = set; }
    }, draftKey);
    assert.equal(failedProjection, 'QuotaExceededError');
    assert.deepEqual(await stored(first), beforeReservation);

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
    if (controlledPublication) await holdDraftLock(second);
    await second.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('7');
    if (controlledPublication) {
      await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThanOrEqual(1);
      await second.evaluate(({ raw, key }) => {
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (...args) {
          const request = get.apply(this, args);
          if (args[0] === key) {
            IDBObjectStore.prototype.get = get;
            request.addEventListener('success', () => {
              window.__staleDraftRead = raw;
              window.__staleDraftReadOnce = true;
            }, { once: true });
          }
          return request;
        };
      }, { raw: beforeReservationRaw, key: draftKey });
      await releaseDraftLock(second);
    }
    try {
      await expect.poll(async () => (await stored(second))?.beds).toBe(7);
    } catch (error) {
      if (process.env.PBK_DRAFT_DIAGNOSTICS === '1') {
        const diagnostic = page => page.evaluate(async key => {
          const decode = raw => raw ? JSON.parse(decodeURIComponent(escape(atob(raw)))) : null;
          const raw = localStorage.getItem(key), shared = decode(raw);
          const privateDraft = decode(sessionStorage.getItem(key + ':session'));
          const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open('pbk-analyzer-draft-coordination', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const coordinator = await new Promise((resolve, reject) => {
              const request = database.transaction('drafts', 'readonly').objectStore('drafts').get(key);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return { sharedBeds: shared?.payload?.beds, privateBeds: privateDraft?.payload?.beds,
              baselineMatches: privateDraft?.sharedBaseline === raw, unpublished: privateDraft?.unpublishedEdits === true,
              coordinatorMatches: coordinator?.raw === raw, status: window.PBKAnalyzer?.getState().analyzeStatus,
              trace: window.__draftPublicationTrace };
          } finally { database.close(); }
        }, draftKey);
        try { console.log(JSON.stringify({ sampleWriter: await diagnostic(second), samplePeer: await diagnostic(first) })); }
        catch { console.log('Sample coordinator diagnostics unavailable'); }
      }
      throw error;
    }
    await first.bringToFront();
    await first.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(first.getByRole('spinbutton', { name: 'Bedrooms', exact: true })).toHaveValue('9');
    if (stressPublication || controlledPublication) {
      const publicationTrace = await second.evaluate(() => window.__draftPublicationTrace.filter(item => item.beds === 7 && item.traceId));
      if (controlledPublication) {
        assert.equal(await second.evaluate(() => window.__controlledStaleReads), 1);
        const mismatch = publicationTrace.find(item => item.phase === 'conflict' && item.expectedBeds === 8 && item.canonicalBeds === 8 && item.sharedBeds === 4);
        const recheck = publicationTrace.find(item => item.phase === 'compare' && item.expectedBeds === 8 && item.canonicalBeds === 8 && item.sharedBeds === 8);
        assert.ok(mismatch && recheck, 'Controlled timing must hit the comparison, then converge');
        assert.equal(recheck.traceId, mismatch.traceId);
        assert.equal(recheck.expectedHash, mismatch.expectedHash, 'Revalidation must retain the original baseline');
        assert.equal(recheck.expectedHash, recheck.canonicalHash);
        assert.equal(recheck.expectedHash, recheck.sharedHash);
        assert.equal(await second.evaluate(() => window.__draftWrites.filter(deal => deal.beds === 7).length), 1);
        const peerDraft = await first.evaluate(() => window.PBKAnalyzer.getState().deal);
        const guards = await verifyAnalyzerPublicationGuards(second, draftKey, beforeReservationRaw);
        assert.deepEqual(await first.evaluate(() => window.PBKAnalyzer.getState().deal), peerDraft, 'Controlled guard tests must preserve the peer draft');
        console.log(`Controlled publication safety: ${engine.name()} ${viewport.width}px ${guards.length} cases passed`);
      }
      if (process.env.PBK_DRAFT_DIAGNOSTICS === '1') {
        console.log(JSON.stringify({ samplePublication: publicationTrace }));
      }
      assert.deepEqual(mutations, [], 'Controlled draft tests must not contact business writers');
      assert.equal(sampleSaves.length, 0, 'Controlled publication must not save a lead');
      assert.ok(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log(`Writer publication after queued cancellation${controlledPublication ? ' with one delayed cache read' : ''}: ${engine.name()} ${viewport.width}px passed`);
      return;
    }

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
    if (runtimePolling) {
      const originalDraft = await stored(first);
      await first.evaluate(async () => {
        await window.__runtimePollingRefresh();
        window.dispatchEvent(new Event('online'));
      });
      const marker = 'sample-state-during-dirty-analyzer';
      await expect.poll(() => stateSockets.size).toBeGreaterThan(0);
      for (const socket of stateSockets) socket.send(JSON.stringify({ type: 'state', snapshot: {
        status: { lastUpdatedAt: marker }, approvals: [], leadImports: [], calls: [],
      } }));
      await expect.poll(() => first.evaluate(() => window.__runtimePollingSnapshot?.status?.lastUpdatedAt)).toBe(marker);
      assert.deepEqual(await stored(first), originalDraft, 'HTTP, stream and reconnect refreshes must preserve actual dirty Analyzer notes and saved comp');
    }
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
    await first.evaluate(() => {
      window.__draftCoordinatorPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = window.__draftCoordinatorPut.apply(this, args);
        this.transaction.abort();
        return request;
      };
    });
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('11');
    await expect(first.locator('#analyzer-valuation').getByText(/Shared draft coordination is unavailable/)).toBeVisible();
    assert.deepEqual(await stored(first), beforeUnavailable, 'An aborted coordination transaction must never project a shared write');
    assert.equal(await first.evaluate(key => JSON.parse(decodeURIComponent(escape(atob(sessionStorage.getItem(`${key}:session`))))).payload.beds, draftKey), 11);
    await first.evaluate(() => { IDBObjectStore.prototype.put = window.__draftCoordinatorPut; });
    await first.evaluate(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
    await first.getByRole('spinbutton', { name: 'Bedrooms', exact: true }).fill('12');
    await expect(first.locator('#analyzer-valuation').getByText(/Shared draft coordination is unavailable/)).toBeVisible();
    assert.deepEqual(await stored(first), beforeUnavailable, 'Unavailable coordination must fail closed without changing shared state');
    assert.equal(await first.evaluate(key => JSON.parse(decodeURIComponent(escape(atob(sessionStorage.getItem(`${key}:session`))))).payload.beds, draftKey), 12);
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
    for (const context of browser.contexts()) await context.unrouteAll({ behavior: 'ignoreErrors' });
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
    await warmAnalyzerBrowserFixture(server);
    if (stressPublication) {
      for (let attempt = 0; attempt < 6; attempt++) await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
    } else if (process.argv.includes('--stress-contention')) {
      for (let attempt = 0; attempt < 6; attempt++) await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
    } else {
      if (!webkitOnly) await verify(chromium, { width: 1440, height: 960 });
      if (chromiumOnly) {
        await verify(chromium, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
      } else {
        await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
        await verify(webkit, { width: 320, height: 844 }, devices['iPhone 13']);
      }
    }
  }
} finally {
  await server.close();
}
