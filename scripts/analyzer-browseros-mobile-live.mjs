import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

export function parseOptions(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const flags = new Map();
  const valued = new Set(['--cdp-url', '--expected-build', '--base-url', '--asset-dir', '--output-dir']);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flags.has(flag)) throw new Error('duplicate option: ' + flag);
    if (flag === '--run-live') flags.set(flag, true);
    else if (valued.has(flag)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
      flags.set(flag, value);
    } else throw new Error('Unknown option: ' + flag);
  }
  if (!flags.get('--run-live')) throw new Error('Explicit --run-live is required; importing this module never connects.');
  const revision = flags.get('--expected-build');
  if (!/^[a-f0-9]{40}$/i.test(revision || '')) throw new Error('--expected-build must pin a full commit SHA.');
  let cdp;
  try { cdp = new URL(flags.get('--cdp-url')); } catch { throw new Error('A loopback HTTP --cdp-url is required.'); }
  if (cdp.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(cdp.hostname) ||
      cdp.username || cdp.password || cdp.search || cdp.hash || cdp.pathname !== '/') {
    throw new Error('CDP must use a loopback HTTP origin without credentials, query, or path.');
  }
  const site = new URL(flags.get('--base-url') || 'https://pbkcenter.netlify.app');
  if (site.pathname !== '/' || site.search || site.hash || site.username || site.password) throw new Error('Use a bare PBK origin.');
  if (site.protocol !== 'https:' || !/^(?:[a-z0-9-]+--)?pbkcenter\.netlify\.app$/.test(site.hostname) || site.port) {
    throw new Error('Only the private PBK Netlify site or its deploy URLs may be tested.');
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return { base: site.origin, cdpUrl: cdp.origin, revision: revision.toLowerCase(),
    dist: resolve(flags.get('--asset-dir') || resolve(root, 'dist')),
    output: resolve(flags.get('--output-dir') || resolve(root, '.pbk-local', 'browseros-mobile-' + Date.now())) };
}

const analyzerAsset = /^\/assets\/(App|analyzerStorage|DealView)-[^/]+\.js$/;
const shellPaths = new Set(['/analyzer', '/index.shell.html', '/pbk-build-manifest.json']);

export function requestDisposition(method, value, base, staticPaths = new Set()) {
  const url = new URL(value);
  const read = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (url.username || url.password) return read ? 'deny-read' : 'deny-write';
  if (url.origin !== base) {
    return method === 'GET' && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname) && url.protocol === 'https:'
      ? 'live' : 'deny-external';
  }
  if (!url.search && url.pathname === '/api/auth/team/verify' && method === 'POST') return 'verify';
  if (!url.search && url.pathname === '/api/state/stream/session' && method === 'POST') return 'stream';
  if (!read) return 'deny-write';
  if (!url.search && url.pathname === '/api/auth/team/status' && method === 'GET') return 'live';
  if (url.pathname === '/api/property-data/address-suggestions') return 'suggestions';
  if (/^\/(api(?:\/|$)|brain(?:\/|$)|state$|health$|status$|metrics$|events$|invoke$|\.netlify\/functions(?:\/|$))/.test(url.pathname)) return 'fixture';
  const staticFile = /^\/(assets|fonts)\/[a-zA-Z0-9_./-]+$/.test(url.pathname) && staticPaths.has(url.pathname);
  return !url.search && ['GET', 'HEAD'].includes(method) && (shellPaths.has(url.pathname) || staticFile)
    ? 'live' : 'deny-read';
}

export function observeAnalyzerBuild(page, expectedAssets, base) {
  const observations = [];
  const onResponse = response => {
    const url = new URL(response.url());
    if (!analyzerAsset.test(url.pathname)) return;
    observations.push((async () => {
      try {
        return { url, status: response.status(), hash: createHash('sha256').update(await response.body()).digest('hex') };
      } catch {
        return { url, unavailable: true };
      }
    })());
  };
  page.on('response', onResponse);
  return {
    async verify() {
      const loaded = new Set();
      // Read every response, including duplicate paths; one matching fetch cannot hide a stale body.
      for (let index = 0; index < observations.length; index++) {
        const { url, status, hash, unavailable } = await observations[index];
        assert.equal(url.origin, base, 'Loaded Analyzer asset origin mismatch');
        assert.ok(expectedAssets.has(url.pathname), 'Unexpected loaded Analyzer asset: ' + url.pathname);
        assert.ok(!unavailable, 'Loaded Analyzer asset body unavailable: ' + url.pathname);
        assert.equal(status, 200, 'Loaded Analyzer asset status mismatch: ' + url.pathname);
        assert.equal(hash, createHash('sha256').update(expectedAssets.get(url.pathname)).digest('hex'),
          'Loaded Analyzer asset body mismatch: ' + url.pathname);
        loaded.add(url.pathname);
      }
      for (const path of expectedAssets.keys()) assert.ok(loaded.has(path), 'Missing loaded Analyzer asset: ' + path);
      return [...expectedAssets.keys()];
    },
    stop() { page.off('response', onResponse); },
  };
}

async function fingerprintDrafts(page, key) {
  return page.evaluate(async key => {
    const hash = async value => value === null ? null : Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    )).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { shared: await hash(localStorage.getItem(key)), private: await hash(sessionStorage.getItem(key + ':session')) };
  }, key);
}

async function run(options) {
  const { base, cdpUrl, revision, dist, output } = options;
  const key = 'pbk:prod:analyzer:current-deal';
  const authKey = 'pbk:team-session:v1';
  const report = { revision, modes: [], blocked: [], bundleMatches: [], loadedBuildChecks: 0 };
  mkdirSync(output, { recursive: true });
  let source, sourceBefore;
  const staticPaths = new Set();
  const pinnedAssets = new Map();
  async function protect(context) {
    const state = { unavailable: false, authVerified: 0, authFailures: 0, businessWrites: 0 };
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      const policy = requestDisposition(request.method(), request.url(), base, staticPaths);
      if (policy === 'verify' || policy === 'live') {
        if (policy === 'verify' && state.unavailable) {
          state.authFailures++;
          return route.fulfill({ status: 503, json: { ok: false, error: 'QA-only verification interruption' } });
        }
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() >= 300 && response.status() < 400) return route.abort();
        if (policy === 'verify' && response.ok()) state.authVerified++;
        return route.fulfill({ response });
      }
      if (policy === 'stream') return route.fulfill({ json: { ok: false } });
      if (policy === 'suggestions') return route.fulfill({ json: { status: 'unavailable', suggestions: [] } });
      if (policy === 'fixture') return route.fulfill({ json: { ok: true, items: [], leads: [], approvals: [] } });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) state.businessWrites++;
      const url = new URL(request.url());
      report.blocked.push(request.method() + ' ' + url.origin + url.pathname);
      return route.abort();
    });
    await context.addInitScript(({ key, base }) => {
      if (location.origin !== base) return;
      window.__qaDraftWrites = 0;
      const set = Storage.prototype.setItem, get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (this === localStorage && name === key && window.__staleDraftRead !== undefined) return window.__staleDraftRead;
        return get.call(this, name);
      };
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key) window.__qaDraftWrites++;
        return set.call(this, name, value);
      };
    }, { key, base });
    return state;
  }
const address = page => page.getByRole('combobox', { name: 'Address', exact: true });
const bedrooms = page => page.getByRole('spinbutton', { name: 'Bedrooms', exact: true });
async function ready(page) {
  await expect(address(page)).toBeVisible({ timeout: 90000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.PBKAnalyzer?.getState))).toBe(true);
}
async function loadAnalyzer(page, reload = false) {
  const proof = observeAnalyzerBuild(page, pinnedAssets, base);
  try {
    if (reload) await page.reload();
    else await page.goto(`${base}/analyzer`);
    await ready(page);
    const matched = await proof.verify();
    report.bundleMatches = matched.map(path => path.slice('/assets/'.length));
    report.loadedBuildChecks++;
  } finally { proof.stop(); }
}
const raw = page => page.evaluate(key => localStorage.getItem(key), key);
async function stored(page) {
  const value = await raw(page);
  return value ? JSON.parse(Buffer.from(value, 'base64').toString()).payload : null;
}
async function hold(page) {
  await page.evaluate(key => {
    window.__held = false;
    window.__lock = navigator.locks.request(`${key}:write`, () => {
      window.__held = true;
      return new Promise(resolve => { window.__release = resolve; });
    });
  }, key);
  await expect.poll(() => page.evaluate(() => window.__held)).toBe(true);
}
async function release(page) {
  await page.evaluate(async () => { window.__release(); await window.__lock; });
}

async function prove(context, state, name) {
  const first = context.pages().find(page => page.url().startsWith(base)) || await context.newPage();
  await loadAnalyzer(first);
  assert.equal(await raw(first), null, 'Refuse to overwrite an existing shared QA draft');
  assert.equal(await first.evaluate(key => sessionStorage.getItem(`${key}:session`), key), null, 'Refuse to overwrite an existing private QA draft');
  await first.evaluate(() => window.PBKAnalyzer.setState({ deal: {
    address: '11 Fixture Avenue (QA sample)', leadId: '', beds: 4, arv: 500000,
    notes: 'Unsent QA sample; never save to a lead',
    repairs: { condition: 'C3', low: 12000, mid: 15000, high: 18000 },
  }, manualFields: ['notes', 'repairs'] }));
  await expect.poll(async () => (await stored(first))?.beds).toBe(4);
  const seed = await first.evaluate(() => window.PBKAnalyzer.getState().deal);
  const initial = await raw(first);
  await loadAnalyzer(first, true);
  assert.equal(await raw(first), initial);
  assert.equal(await first.evaluate(() => window.__qaDraftWrites), 0);
  const second = await context.newPage();
  await loadAnalyzer(second);
  assert.equal(await second.evaluate(() => window.__qaDraftWrites), 0);

  await second.evaluate(key => { window.__staleDraftRead = localStorage.getItem(key); }, key);
  await hold(first);
  await bedrooms(first).fill('5');
  await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBeGreaterThan(0);
  await bedrooms(second).fill('6');
  await expect.poll(() => second.evaluate(key => {
    const value = JSON.parse(decodeURIComponent(escape(atob(sessionStorage.getItem(`${key}:session`)))));
    return value.unpublishedEdits && value.payload.beds;
  }, key)).toBe(6);
  assert.equal((await stored(first)).beds, 4);
  await release(first);
  await expect.poll(() => first.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(0);
  assert.equal(await first.evaluate(() => window.__qaDraftWrites) + await second.evaluate(() => window.__qaDraftWrites), 1);
  await second.evaluate(() => { delete window.__staleDraftRead; });
  const winner = (await stored(first)).beds;
  assert.ok([5, 6].includes(winner));
  const loser = winner === 5 ? second : first;
  const privateBeds = winner === 5 ? 6 : 5;
  await expect(loser.locator('#analyzer-valuation').getByText(/Another tab changed this draft/)).toBeVisible();
  await loadAnalyzer(loser, true);
  await expect(bedrooms(loser)).toHaveValue(String(privateBeds));
  assert.equal(await loser.evaluate(() => window.__qaDraftWrites), 0);
  await first.evaluate(deal => { document.activeElement?.blur(); window.PBKAnalyzer.setState({ deal, manualFields: ['notes', 'repairs'] }); }, seed);
  await expect.poll(async () => (await stored(first))?.beds).toBe(4);
  await second.evaluate(key => sessionStorage.removeItem(`${key}:session`), key);
  await loadAnalyzer(first, true); await loadAnalyzer(second, true);

  await bedrooms(second).fill('6');
  await expect.poll(async () => (await stored(second))?.beds).toBe(6);
  await expect(bedrooms(first)).toHaveValue('6');
  assert.equal(await first.evaluate(() => window.__qaDraftWrites), 0);
  await first.locator('#deal-arv').fill('510000');
  await first.getByRole('spinbutton', { name: 'Comp A sold price', exact: true }).fill('600000');
  await expect(first.locator('#deal-arv')).toHaveValue('600000');
  await expect.poll(async () => (await stored(first))?.comps.A.price).toBe(600000);
  await bedrooms(second).fill('7');
  await expect(second.locator('#analyzer-valuation').getByText(/Another tab changed this draft/)).toBeVisible();
  const shared = await raw(first);
  await loadAnalyzer(second, true);
  await expect(bedrooms(second)).toHaveValue('7');
  assert.equal(await raw(first), shared);
  assert.equal(await second.evaluate(() => window.__qaDraftWrites), 0);
  await first.getByRole('spinbutton', { name: 'Square footage', exact: true }).fill('1250');
  await expect.poll(async () => (await stored(first))?.sqft).toBe(1250);
  const before = await raw(first);
  await first.bringToFront();
  state.unavailable = true;
  await first.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
    detail: { code: 'private_site_auth_required', message: 'QA-only access interruption' },
  })));
  await first.getByRole('button', { name: 'Verify access again' }).evaluate(button => button.click());
  await expect.poll(() => state.authFailures).toBeGreaterThan(0);
  await expect(first.getByRole('button', { name: 'Verify access again' })).toBeEnabled();
  await expect(first.getByRole('alert')).toContainText(/interruption|503|unavailable/i);
  assert.equal(await raw(first), before);
  state.unavailable = false;
  const verified = state.authVerified;
  await first.getByRole('button', { name: 'Verify access again' }).evaluate(button => button.click());
  await expect(first.getByRole('button', { name: 'Verify access again' })).toHaveCount(0);
  assert.ok(state.authVerified > verified);
  const writes = await first.evaluate(() => window.__qaDraftWrites);
  await first.evaluate(() => window.dispatchEvent(new CustomEvent('pbk:runtime-access-error', {
    detail: { code: 'team_session_rejected', sessionWasCurrent: true },
  })));
  await expect(first.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
  await first.evaluate(authKey => window.dispatchEvent(new StorageEvent('storage', {
    key: authKey, storageArea: localStorage, newValue: localStorage.getItem(authKey),
  })), authKey);
  await ready(first);
  await expect(first.locator('#deal-arv')).toHaveValue('600000');
  assert.equal(await raw(first), before);
  assert.equal(await first.evaluate(() => window.__qaDraftWrites), writes);
  assert.equal((await stored(first)).notes, 'Unsent QA sample; never save to a lead');
  assert.equal(await first.evaluate(() => window.PBKAnalyzer.getState().deal.repairs.mid), 15000);
  for (const page of [first, second]) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const [page, suffix] of [[first, ''], [second, '-conflict']]) {
    await page.bringToFront();
    try {
      await page.screenshot({ path: `${output}/${name}${suffix}.png`, timeout: 10000, animations: 'disabled' });
    } catch {
      (report.artifactWarnings ||= []).push(`${name}${suffix}: screenshot capture timed out`);
    }
  }
  assert.equal(state.businessWrites, 0);
  assert.ok(state.authFailures > 0, 'Require an injected failure before real recovery');
  report.modes.push({ name, overlap: 'pass', simultaneousWrites: 'pass', drafts: 'pass', recovery: 'pass', liveAuthVerifications: state.authVerified, injectedAuthFailures: state.authFailures, businessWrites: 0 });
  console.log(`${name}: live concurrency, private drafts, ARV/comps and session recovery passed; no business writes`);
  await first.close(); await second.close();
}

  try {
    const localManifest = JSON.parse(readFileSync(resolve(dist, 'pbk-build-manifest.json'), 'utf8'));
    assert.equal(localManifest.buildId, revision, 'Local assets must belong to the pinned build');
    for (const directory of readdirSync(dist, { withFileTypes: true }).filter(entry =>
      entry.isDirectory() && ['assets', 'fonts'].includes(entry.name))) {
      for (const entry of readdirSync(resolve(dist, directory.name), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|ico)$/.test(entry.name)) continue;
        const path = '/' + relative(dist, resolve(entry.parentPath, entry.name)).split(sep).join('/');
        staticPaths.add(path);
        if (analyzerAsset.test(path)) pinnedAssets.set(path, readFileSync(resolve(dist, '.' + path)));
      }
    }
    for (const family of ['App', 'DealView', 'analyzerStorage']) {
      assert.equal([...pinnedAssets.keys()].filter(path => analyzerAsset.exec(path)?.[1] === family).length,
        1, 'Require exactly one local pinned Analyzer bundle for ' + family);
    }
    const browser = await chromium.connectOverCDP(cdpUrl);
    source = browser.contexts().flatMap(context => context.pages()).find(page => new URL(page.url()).origin === base);
    assert.ok(source, 'Open an authenticated PBK tab in BrowserOS before this manual test.');
    sourceBefore = await fingerprintDrafts(source, key);
    const liveManifest = await source.evaluate(async () => {
      const response = await fetch('/pbk-build-manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Private-site access must already be unlocked in BrowserOS.');
      return response.json();
    });
    assert.equal(liveManifest.buildId, revision, 'Refuse to test a different deployed build');
    // Transfer only this site's auth into ephemeral contexts; never serialize credentials or storageState.
    const session = await source.evaluate(key => localStorage.getItem(key), authKey);
    assert.ok(session, 'Unlock the existing PBK team session before testing.');
    const cookies = await source.context().cookies(base);
    assert.ok(cookies.length, 'Private-site access cookie missing.');
    for (const width of [390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true,
        hasTouch: true, deviceScaleFactor: 3, serviceWorkers: 'block' });
      try {
        await context.addCookies(cookies);
        await context.addInitScript(({ key, value, base }) => {
          if (location.origin === base) localStorage.setItem(key, value);
        }, { key: authKey, value: session, base });
        const state = await protect(context);
        const page = await context.newPage();
        await loadAnalyzer(page);
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, touch: navigator.maxTouchPoints }));
        assert.equal(viewport.width, width);
        assert.ok(viewport.touch > 0);
        console.log('BrowserOS actual mobile viewport: ' + JSON.stringify(viewport));
        await prove(context, state, 'browseros-mobile-chromium-' + width);
      } finally { await context.close(); }
    }
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error.message;
    console.error(error.message);
  } finally {
    if (source && sourceBefore) {
      try {
        const after = await fingerprintDrafts(source, key);
        report.originalDraftsUnchanged = after.shared === sourceBefore.shared && after.private === sourceBefore.private;
        if (!report.originalDraftsUnchanged) { report.ok = false; report.error = 'Original draft fingerprints changed during the run.'; }
      } catch { report.ok = false; report.error = 'Could not verify original draft preservation.'; }
    }
    writeFileSync(output + '/report.json', JSON.stringify(report, null, 2));
    console.log('REPORT: ' + output + '/report.json');
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      console.log('Manual BrowserOS mobile proof (no deployments or business writes).\n' +
        'node scripts/analyzer-browseros-mobile-live.mjs --run-live --cdp-url http://LOOPBACK:PORT --expected-build FULL_SHA\n' +
        'Optional: --base-url PBK_HTTPS_ORIGIN --asset-dir MATCHING_DIST --output-dir IGNORED_ARTIFACT_DIR');
      process.exit(0);
    }
    // Disconnect only this client on exit. Never close the attached user BrowserOS instance.
    process.exit(await run(options));
  } catch (error) { console.error(error.message); process.exit(1); }
}
