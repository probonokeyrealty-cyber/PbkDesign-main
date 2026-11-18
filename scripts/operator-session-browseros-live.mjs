import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { parseOptions as parseAnalyzerOptions, requestDisposition as analyzerDisposition } from './analyzer-browseros-mobile-live.mjs';
import { fixtureResponse, sampleApproval } from './fixtures/faster-triage-fixture.mjs';

const authKey = 'pbk:team-session:v1';
const composeKey = 'pbk:compose:draft';
const analyzerKey = 'pbk:prod:analyzer:current-deal';
const shellPaths = new Set(['/command-center', '/inbox']);

export function parseOptions(argv) {
  assert.ok(!argv.includes('--desktop'), 'This runner always checks both desktop and mobile.');
  const parsed = parseAnalyzerOptions(argv);
  if (parsed.help) return parsed;
  const { base, cdpUrl, revision, dist } = parsed;
  return { base, cdpUrl, revision, dist, output: argv.includes('--output-dir') ? parsed.output
    : resolve(dirname(fileURLToPath(import.meta.url)), '../.pbk-local/operator-session-' + Date.now()) };
}

export function requestDisposition(method, target, base, staticPaths = new Set()) {
  let url;
  try { url = new URL(target); } catch { return 'deny-read'; }
  if (url.origin === base && !url.username && !url.password && !url.search && !url.hash
      && ['GET', 'HEAD'].includes(method) && shellPaths.has(url.pathname)) return 'live';
  return analyzerDisposition(method, target, base, staticPaths);
}

export function sampleResponse(path, params) {
  if (path === '/state' || path === '/api/state') return {
    ...fixtureResponse('/state', params), ok: true,
    status: { mode: 'approval', pendingApprovals: 1, activeCalls: 0 },
    documentDeliveries: [], adminTasks: [], analyzerRuns: [],
  };
  if (path === '/api/approvals') return { ok: true, approvals: [sampleApproval], items: [sampleApproval] };
  return fixtureResponse(path, params);
}

// Only bytes actually loaded by a QA page count as build evidence.
export function observeLoadedAssets(page, pins, base) {
  const observations = [];
  const onResponse = response => {
    const url = new URL(response.url());
    if (!/^\/(?:assets|fonts)\//.test(url.pathname)) return;
    observations.push((async () => {
      try { return { url, status: response.status(), body: await response.body() }; }
      catch { return { url, unavailable: true }; }
    })());
  };
  page.on('response', onResponse);
  return {
    async verify() {
      assert.ok(observations.length, 'No loaded asset evidence');
      const loaded = new Set();
      for (let i = 0; i < observations.length; i++) {
        const item = await observations[i];
        assert.equal(item.url.origin, base, 'Loaded asset origin mismatch');
        assert.ok(pins.has(item.url.pathname), 'Unpinned loaded asset');
        assert.ok(!item.unavailable, 'Loaded asset body unavailable');
        assert.equal(item.status, 200, 'Loaded asset status mismatch');
        assert.equal(createHash('sha256').update(item.body).digest('hex'),
          createHash('sha256').update(pins.get(item.url.pathname)).digest('hex'), 'Loaded asset body mismatch');
        loaded.add(item.url.pathname);
      }
      return [...loaded].sort();
    },
    stop() { page.off('response', onResponse); },
  };
}

export function observeContextAssets(context, pins, base, onPageError = () => {}) {
  const pages = new Map();
  const onPage = page => {
    const onError = error => onPageError(error);
    page.on('pageerror', onError);
    pages.set(page, { proof: observeLoadedAssets(page, pins, base), onError });
  };
  context.on('page', onPage);
  return {
    async verifyPage(page) {
      assert.ok(pages.has(page), 'QA page has no loaded-build observer');
      return pages.get(page).proof.verify();
    },
    async verifyAll() {
      assert.ok(pages.size, 'No QA page evidence');
      const loaded = new Set();
      for (const { proof } of pages.values()) for (const path of await proof.verify()) loaded.add(path);
      return { pages: pages.size, loadedAssets: [...loaded].sort() };
    },
    stop() {
      context.off('page', onPage);
      for (const [page, { proof, onError }] of pages) {
        proof.stop();
        page.off('pageerror', onError);
      }
    },
  };
}

export async function forwardLiveRequest(route, state, policy) {
  try {
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) return await route.abort();
    await route.fulfill({ response });
    if (policy === 'verify' && response.ok()) state.authVerified++;
  } catch {
    // Playwright fetch errors may contain authentication headers. Never retain or rethrow them.
    state.forwardFailures++;
    try { await route.abort(); } catch { /* The page may already be closed. */ }
  }
}

export function sharedAnalyzerMatches(raw) {
  try {
    const deal = JSON.parse(Buffer.from(raw || '', 'base64').toString('utf8'))?.payload;
    return deal?.arv === 600000 && deal?.comps?.A?.price === 600000;
  } catch { return false; }
}

function loadPins(options) {
  const manifest = JSON.parse(readFileSync(resolve(options.dist, 'pbk-build-manifest.json'), 'utf8'));
  assert.equal(manifest.buildId, options.revision, 'Matching local build is required');
  const pins = new Map();
  for (const directory of ['assets', 'fonts']) {
    for (const entry of readdirSync(resolve(options.dist, directory), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|ico)$/.test(entry.name)) continue;
      const full = resolve(entry.parentPath, entry.name);
      pins.set('/' + relative(options.dist, full).split(sep).join('/'), readFileSync(full));
    }
  }
  assert.ok(pins.size, 'No local assets available');
  return pins;
}

async function fingerprintSource(page, base) {
  return page.evaluate(async base => {
    if (location.origin !== base) throw Error('Source tab moved; preservation cannot be verified');
    const result = {};
    for (const [scope, storage] of [['local', localStorage], ['session', sessionStorage]]) {
      for (const key of Object.keys(storage).filter(k => /draft|analyzer|compose/i.test(k)).sort()) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(storage.getItem(key) || ''));
        result[scope + ':' + key] = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      }
    }
    return result;
  }, base);
}

async function protect(context, options, pins) {
  const state = { unavailable: false, authVerified: 0, authFailures: 0, forwardFailures: 0, routeFailures: 0, blockedWrites: [], errors: [] };
  await context.routeWebSocket('**/*', socket => socket.close());
  const paths = new Set(pins.keys());
  const dispatch = async route => {
    const request = route.request(), url = new URL(request.url());
    const policy = requestDisposition(request.method(), request.url(), options.base, paths);
    if (policy === 'verify' || policy === 'live') {
      if (policy === 'verify' && state.unavailable) {
        state.authFailures++;
        return route.fulfill({ status: 503, json: { ok: false, error: 'QA-only verifier interruption' } });
      }
      return forwardLiveRequest(route, state, policy);
    }
    if (policy === 'stream') return route.fulfill({ json: { ok: false } });
    if (policy === 'suggestions') return route.fulfill({ json: { status: 'unavailable', suggestions: [] } });
    if (policy === 'fixture') return route.fulfill({ json: sampleResponse(url.pathname, url.searchParams) });
    if (policy === 'deny-write') state.blockedWrites.push(request.method() + ' ' + url.pathname);
    return route.abort();
  };
  await context.route('**/*', async route => {
    try { await dispatch(route); }
    catch {
      state.routeFailures++;
      try { await route.abort(); } catch { /* A closed route is already unable to forward. */ }
    }
  });
  return state;
}

async function openCompose(page) {
  if (!await page.getByRole('dialog', { name: 'Compose message' }).count()) {
    await page.getByRole('button', { name: 'Compose', exact: true }).click();
  }
  await page.getByPlaceholder('Write a seller-facing message...').waitFor();
}

async function expectCompose(page, text) {
  await expect(page.getByPlaceholder('Write a seller-facing message...')).toHaveValue(text);
}

async function proveApprovals(page) {
  const card = page.locator(`[data-approval-id="${sampleApproval.id}"]`);
  await card.waitFor({ state: 'visible' });
  await card.getByRole('button', { name: 'Review approval', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Decision Rail' }).getByRole('listitem')).toHaveCount(4);
  await expect(dialog.getByRole('button', { name: 'Confirm decision', exact: true })).toBeVisible();
  const box = await dialog.boundingBox();
  const width = await page.evaluate(() => innerWidth);
  assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'Approval dialog overflow');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'Decision receipt' })).toHaveCount(0);
}

async function expireAndRecover(page, context, base, ready, proof) {
  await page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...session, expiresAt: '2000-01-01T00:00:00Z' }));
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage, newValue: localStorage.getItem(key) }));
  }, authKey);
  await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
  const second = await context.newPage();
  try {
    // The init script restores the already-authorized copy only in this ephemeral context.
    // Its real storage event must recover the first tab through the live verifier.
    await second.goto(base + '/command-center');
    await expect(second.getByRole('heading', { name: 'Today.', exact: true })).toBeVisible();
    await ready();
    await proof.verifyPage(second);
  } finally { await second.close(); }
}

async function verifyOutage(page, state) {
  const failures = state.authFailures;
  await page.getByRole('button', { name: 'Verify access again', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'QA-only verifier interruption' })).toBeVisible();
  assert.ok(state.authFailures > failures, 'Require an injected verification failure');
  assert.ok(await page.evaluate(key => Boolean(JSON.parse(localStorage.getItem(key) || 'null')?.token), authKey),
    'A transient outage must retain the valid session');
}

async function recoverVerifier(page, state) {
  state.unavailable = false;
  const verified = state.authVerified;
  await page.getByRole('button', { name: 'Verify access again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verify access again', exact: true })).toBeHidden();
  assert.ok(state.authVerified > verified, 'Require real backend re-verification');
}

async function proveCompose(page, context, state, options, name, proof) {
  const text = `QA ${name} unsent sample. Never deliver.`;
  await page.goto(options.base + '/inbox');
  await openCompose(page);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), composeKey), null, 'Refuse existing QA draft');
  await page.getByPlaceholder('Name or phone number').fill('qa-invalid-recipient');
  await page.getByPlaceholder('Write a seller-facing message...').fill(text);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').message, composeKey)).toBe(text);
  await expect(page.getByRole('dialog', { name: 'Compose message' }).getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  const saved = await page.evaluate(key => localStorage.getItem(key), composeKey);
  await page.reload();
  await openCompose(page);
  await expectCompose(page, text);

  state.unavailable = true;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
    detail: { code: 'private_site_auth_required', message: 'QA-only private-access interruption' },
  })));
  await page.getByRole('button', { name: 'Close compose', exact: true }).click();
  await verifyOutage(page, state);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), composeKey), saved, 'Compose outage changed draft');
  await recoverVerifier(page, state);
  await openCompose(page);
  await expectCompose(page, text);

  await expireAndRecover(page, context, options.base, async () => {
    await openCompose(page);
    await expectCompose(page, text);
  }, proof);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), composeKey), saved, 'Expiry recovery changed draft');
  const box = await page.getByRole('dialog', { name: 'Compose message' }).boundingBox();
  const width = await page.evaluate(() => innerWidth);
  assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'Compose dialog overflow');
}

async function analyzerReady(page) {
  await expect(page.getByRole('combobox', { name: 'Address', exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean(window.PBKAnalyzer?.getState));
}

async function proveAnalyzer(page, context, state, options, name, proof) {
  const notes = `QA ${name} notes stay unsent.`;
  await page.goto(options.base + '/analyzer');
  await analyzerReady(page);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), analyzerKey), null, 'Refuse existing QA Analyzer draft');
  await page.evaluate(notes => window.PBKAnalyzer.setState({ deal: {
    address: '11 QA Sample Avenue', leadId: '', beds: 4, sqft: 1250, arv: 500000, notes,
    repairs: { condition: 'C3', low: 12000, mid: 15000, high: 18000 },
  }, manualFields: ['notes', 'repairs'] }), notes);
  await page.getByRole('spinbutton', { name: 'Comp A sold price', exact: true }).fill('600000');
  await expect.poll(() => page.evaluate(() => window.PBKAnalyzer.getState().deal.arv)).toBe(600000);
  await expect.poll(async () => sharedAnalyzerMatches(await page.evaluate(key => localStorage.getItem(key), analyzerKey))).toBe(true);
  const saved = await page.evaluate(key => localStorage.getItem(key), analyzerKey);
  const check = async () => {
    await analyzerReady(page);
    await expect.poll(() => page.evaluate(() => window.PBKAnalyzer.getState().deal.notes)).toBe(notes);
    const fields = await page.evaluate(() => {
      const d = window.PBKAnalyzer.getState().deal;
      return { beds: d.beds, arv: d.arv, notes: d.notes, comp: d.comps?.A?.price, repairs: d.repairs?.mid, leadId: d.leadId };
    });
    assert.deepEqual(fields, { beds: 4, arv: 600000, notes, comp: 600000, repairs: 15000, leadId: '' });
    assert.equal(await page.evaluate(key => localStorage.getItem(key), analyzerKey), saved, 'Analyzer draft rewritten');
  };
  await page.reload();
  await check();
  const second = await context.newPage();
  try {
    await second.goto(options.base + '/analyzer');
    await analyzerReady(second);
    await expect.poll(() => second.evaluate(() => window.PBKAnalyzer.getState().deal.notes)).toBe(notes);
    assert.equal(await second.evaluate(key => localStorage.getItem(key), analyzerKey), saved, 'Second tab rewrote draft');
    await proof.verifyPage(second);
  } finally { await second.close(); }
  state.unavailable = true;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
    detail: { code: 'private_site_auth_required', message: 'QA-only Analyzer interruption' },
  })));
  await verifyOutage(page, state);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), analyzerKey), saved, 'Analyzer outage changed draft');
  await recoverVerifier(page, state);
  await check();
}

async function runOperatorSessionProof(options) {
  const pins = loadPins(options);
  const report = { ok: false, revision: options.revision, verificationMode: 'live_assets_and_auth_sample_business_state',
    productionBusinessActionsVerified: false, approvalDecisionExecutionAttempted: false, modes: [] };
  mkdirSync(options.output, { recursive: true });
  let source, before;
  try {
    const browser = await chromium.connectOverCDP(options.cdpUrl);
    source = browser.contexts().flatMap(context => context.pages()).find(page => {
      try { return new URL(page.url()).origin === options.base; } catch { return false; }
    });
    assert.ok(source, 'An already unlocked PBK source tab is required');
    before = await fingerprintSource(source, options.base);
    const manifest = await source.evaluate(async () => {
      const response = await fetch('/pbk-build-manifest.json', { cache: 'no-store' });
      if (!response.ok) throw Error('Private-site access must already be unlocked');
      return response.json();
    });
    assert.equal(manifest.buildId, options.revision, 'Deployed build mismatch');
    const auth = await source.evaluate(key => {
      const raw = localStorage.getItem(key), value = JSON.parse(raw || 'null');
      if (!value?.token || Date.parse(value.expiresAt) <= Date.now()) throw Error('A valid PBK session is required');
      return raw;
    }, authKey);
    const cookies = await source.context().cookies(options.base);
    assert.ok(cookies.length, 'Private-site cookie missing');
    for (const width of [1440, 390]) {
      const name = width < 720 ? 'mobile' : 'desktop';
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 720,
        hasTouch: width < 720, serviceWorkers: 'block' });
      try {
        await context.addCookies(cookies);
        await context.addInitScript(({ base, auth, key }) => {
          if (location.origin === base && !localStorage.getItem(key)) localStorage.setItem(key, auth);
        }, { base: options.base, auth, key: authKey });
        const state = await protect(context, options, pins);
        const proof = observeContextAssets(context, pins, options.base, error => state.errors.push(error.message));
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(30000);
          await page.goto(options.base + '/command-center');
          await proveApprovals(page);
          await proveCompose(page, context, state, options, name, proof);
          await proveAnalyzer(page, context, state, options, name, proof);
          const viewport = await page.evaluate(() => ({ width: innerWidth, touch: navigator.maxTouchPoints,
            overflow: document.documentElement.scrollWidth > innerWidth }));
          assert.equal(viewport.width, width);
          assert.equal(viewport.touch > 0, width < 720);
          assert.equal(viewport.overflow, false, 'Horizontal page overflow');
          assert.deepEqual(state.errors, [], 'Uncaught browser errors');
          assert.deepEqual(state.blockedWrites, [], 'UI attempted a business mutation');
          assert.equal(state.forwardFailures + state.routeFailures, 0, 'A live forwarding or route operation failed');
          assert.ok(state.authVerified > 0 && state.authFailures > 0, 'Real auth recovery evidence required');
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: resolve(options.output, name + '.png'), animations: 'disabled', timeout: 15000 });
          const loaded = await proof.verifyAll();
          report.modes.push({ name, viewport, approvalReviewCancel: true, composeReload: true, verifierRecovery: true,
            expiryLocksWorkspace: true, crossTabRecovery: true, analyzerReloadAndSecondTab: true,
            notesRepairsCompsArvPreserved: true, liveAuthVerifications: state.authVerified, injectedAuthFailures: state.authFailures,
            businessWritesForwarded: 0, providerCallsForwarded: 0, loadedAssetPages: loaded.pages, loadedAssets: loaded.loadedAssets });
          console.log(name + ': review/cancel, session recovery and isolated drafts passed');
        } finally { proof.stop(); }
      } finally { await context.close(); }
    }
    report.ok = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Operator QA failed';
  } finally {
    if (source && before) {
      try {
        const after = await fingerprintSource(source, options.base);
        report.originalDraftsUnchanged = JSON.stringify(before) === JSON.stringify(after);
        report.sourceDraftEntriesChecked = Object.keys(before).length;
        if (!report.originalDraftsUnchanged) { report.ok = false; report.error = 'Original draft fingerprints changed'; }
      } catch { report.ok = false; report.error = 'Original draft preservation could not be verified'; }
    }
    writeFileSync(resolve(options.output, 'report.json'), JSON.stringify(report, null, 2));
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Manual desktop/mobile QA; no deployments, business writes or provider calls.\n' +
      '--run-live --cdp-url LOOPBACK_HTTP_ORIGIN --expected-build FULL_SHA --asset-dir MATCHING_DIST\n' +
      'Optional: --base-url PRIVATE_PBK_ORIGIN --output-dir IGNORED_ARTIFACT_DIRECTORY');
    else {
      const report = await runOperatorSessionProof(options);
      console.log(JSON.stringify({ ok: report.ok, modes: report.modes.length, originalDraftsUnchanged: report.originalDraftsUnchanged,
        error: report.error, report: resolve(options.output, 'report.json') }));
      // Only disconnect this client process; never close the user's BrowserOS instance.
      process.exit(report.ok ? 0 : 1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Operator QA setup failed');
    process.exit(1);
  }
}
