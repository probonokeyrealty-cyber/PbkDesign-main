import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, webkit } from '@playwright/test';
import { fixtureResponse, sampleLeads } from './fixtures/faster-triage-fixture.mjs';

const origin = 'http://127.0.0.1:4174';
const dist = resolve(import.meta.dirname, '../dist');
const pages = [
  ['/ava-chat', 'Ava Chat'],
  ['/leads', 'Seller leads.'],
  ['/inbox/conversations', 'Conversations'],
  ['/analyzer', 'The deal.'],
  ['/campaigns', 'Campaigns'],
  ['/skills', 'Skill Studio'],
];
const shellPaths = new Set(pages.map(([path]) => path));
const contentTypes = {
  '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'",
};

export function classifyHostedSmokeRequest(method, target) {
  let url;
  try { url = new URL(target); } catch { return 'blocked-external'; }
  if (url.origin !== origin || url.username || url.password) return 'blocked-external';
  if (method === 'POST' && url.pathname === '/api/state/stream/session' && !url.search) return 'stream-fixture';
  if (!['GET', 'HEAD'].includes(method)) return 'blocked-write';
  if (/^\/(?:api(?:\/|$)|brain(?:\/|$)|\.netlify\/functions\/|state$|health$|status$|metrics$)/.test(url.pathname)) return 'fixture';
  if (shellPaths.has(url.pathname)) return 'shell';
  if (url.pathname === '/pbk-build-manifest.json') return 'static';
  if (/^\/(?:assets|fonts)\/[\w./-]+$/.test(url.pathname) && contentTypes[extname(url.pathname)]) return 'static';
  return 'blocked-read';
}

// Both lexical and real-path checks prevent assets from escaping dist, including symlinks.
async function readAsset(root, path) {
  const candidate = resolve(root, '.' + path);
  const inside = value => { const rel = relative(root, value); return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
  assert.ok(inside(candidate), 'Static asset must stay inside dist');
  const canonical = await realpath(candidate);
  assert.ok(inside(canonical), 'Static asset symlink must stay inside dist');
  return readFile(canonical);
}

export async function runHostedFounderBrowserSmoke() {
  const root = await realpath(dist);
  // Remove speculative remote font connections from the production shell. Browser routing
  // and offline mode remain the enforcement boundary, not this presentation cleanup.
  const shell = (await readAsset(root, '/index.shell.html')).toString().replace(/<link\b[^>]*href="https?:\/\/[^>]*>/g, '');
  const reports = [];
  for (const [engine, viewport, mobile] of [
    [chromium, { width: 1440, height: 1000 }, false],
    [chromium, { width: 390, height: 844 }, true],
    [webkit, { width: 390, height: 844 }, true],
  ]) {
    const browser = await engine.launch({ env: {} });
    try {
      // WebKit rejects fulfilled document navigations in offline mode. Its requests
      // still use the same catch-all, non-forwarding router as Chromium.
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', offline: engine === chromium });
      context.setDefaultTimeout(15000);
      const writes = [], missing = [], errors = [], external = [];
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const policy = classifyHostedSmokeRequest(request.method(), request.url());
        if (policy === 'blocked-external') { external.push(url.origin); return route.abort('blockedbyclient'); }
        if (policy === 'blocked-write') {
          writes.push(`${request.method()} ${url.pathname}`);
          return route.fulfill({ status: 403, headers, json: { ok: false, error: 'Sample-only smoke: writes disabled' } });
        }
        if (policy === 'stream-fixture') return route.fulfill({ headers, json: { ok: false } });
        if (policy === 'fixture') {
          let json = fixtureResponse(url.pathname, url.searchParams);
          if (url.pathname === '/api/desktop-sidecar/status') json = { ok: true, connected: false };
          if (url.pathname === '/api/local/commands') json = { ok: true, commands: [] };
          return route.fulfill({ headers, json });
        }
        if (policy === 'shell') return route.fulfill({ headers, contentType: 'text/html', body: shell });
        if (policy === 'static') {
          try {
            const body = await readAsset(root, url.pathname);
            return route.fulfill({ headers, contentType: contentTypes[extname(url.pathname)], body });
          } catch {
            missing.push(url.pathname);
          }
        } else missing.push(url.pathname);
        return route.fulfill({ status: 404, headers, body: 'Not in the isolated smoke fixture' });
      });
      await context.addInitScript(() => {
        if (location.origin !== 'http://127.0.0.1:4174') return;
        const config = { endpoint: location.origin, apiKey: 'sample-only' };
        window.PBK = { openclaw: { getConfig: () => config } };
        localStorage.setItem('pbk:local:openclaw-config', JSON.stringify(config));
        if (!localStorage.getItem('pbk:prefs:v1')) localStorage.setItem('pbk:prefs:v1', JSON.stringify({ theme: 'dark', railCollapsed: false, tourCompleted: true }));
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const visited = [];
      for (const [path, heading] of pages) {
        await page.goto(origin + path, { waitUntil: 'load' });
        await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
        if (path === '/leads') await expect(page.getByRole('button', { name: /Open lead Fictional Seller/ }).first()).toBeVisible();
        if (path === '/analyzer') await expect(page.getByRole('combobox', { name: 'Address', exact: true })).toBeVisible();
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 1, `${engine.name()} ${viewport.width} ${path} overflows by ${overflow}px`);
        visited.push(path);
      }
      // Prove that fetches to another origin and write-shaped requests cannot escape,
      // even when initiated by a page rather than by the Node test runner.
      const blocked = await page.evaluate(async () => ({
        external: await fetch('https://provider.invalid/smoke-canary').then(() => false, () => true),
        write: await fetch('/invoke', { method: 'POST', body: '{}' }).then(res => res.status),
      }));
      assert.deepEqual(blocked, { external: true, write: 403 });
      assert.deepEqual(writes, ['POST /invoke'], 'Only the deliberate blocked-write canary may occur');
      assert.deepEqual(missing, [], 'No asset or document request may fall through to a server');
      assert.deepEqual(errors, [], 'The sample pages must render without uncaught errors');
      assert.ok(external.every(value => value === 'https://provider.invalid'), 'Unexpected external dependency in built pages');
      reports.push({ engine: engine.name(), viewport, pages: visited, sampleLead: sampleLeads[0].id, writesForwarded: 0, externalForwarded: 0 });
    } finally {
      await browser.close();
    }
  }
  const report = { ok: true, verificationMode: 'isolated_offline', productionVerified: false, providerDeliveryVerified: false, reports };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Hosted Founder Smoke accepts no browser targets or profile overrides.');
    process.exitCode = 1;
  } else {
    await runHostedFounderBrowserSmoke().catch(error => {
      console.error(error instanceof Error ? error.message : 'Isolated browser smoke failed');
      process.exitCode = 1;
    });
  }
}
