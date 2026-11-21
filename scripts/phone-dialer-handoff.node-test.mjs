// Legacy engine + hosted deep-link handoff for the Dialer and Phone Numbers
// surfaces. Both engines reach the same React shell routes (and therefore the
// same bridge-backed data); no provider or dialer logic lives in the legacy page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function parseNetlifyRedirects(toml) {
  return toml.split('[[redirects]]').slice(1).map((block) => ({
    from: block.match(/from\s*=\s*"([^"]+)"/)?.[1],
    to: block.match(/to\s*=\s*"([^"]+)"/)?.[1],
    status: Number(block.match(/status\s*=\s*(\d+)/)?.[1] || 301),
    force: /force\s*=\s*true/.test(block),
  })).filter((r) => r.from);
}

// Netlify evaluates redirect rules top to bottom; the first match wins.
function firstMatch(rules, pathname) {
  return rules.find((rule) => {
    if (rule.from === pathname) return true;
    if (rule.from.endsWith('/*')) {
      const prefix = rule.from.slice(0, -2);
      return prefix === '' ? true : pathname === prefix || pathname.startsWith(`${prefix}/`);
    }
    return false;
  });
}

test('hosted deep links for /dialer and the Phone Numbers settings link rewrite to the shell', () => {
  const rules = parseNetlifyRedirects(read('netlify.toml'));
  for (const pathname of ['/dialer', '/settings']) {
    const rule = firstMatch(rules, pathname);
    assert.ok(rule, `${pathname} has a rule`);
    assert.equal(rule.from, pathname, `${pathname} has its own explicit rewrite, not only the catch-all`);
    assert.equal(rule.to, '/index.shell.html');
    assert.equal(rule.status, 200, 'rewrite, not redirect (URL and #phone-numbers hash are preserved)');
    assert.equal(rule.force, true);
  }
  // Bridge API traffic for these surfaces still goes through the authenticated proxy.
  const api = firstMatch(rules, '/api/phone-numbers');
  assert.match(api.to, /pbk-bridge-proxy/);
  assert.match(firstMatch(rules, '/api/dialer/select').to, /pbk-bridge-proxy/);
  assert.match(read('netlify.toml'), /for = "\/dialer"\s*\n\s*\[headers\.values\]\s*\n\s*Cache-Control = "no-cache, must-revalidate"/);
});

test('render-hosted fallback serves /dialer and /settings as shell app paths', () => {
  const bridge = read('scripts/openclaw-local-server.mjs');
  const appPaths = bridge.match(/const COMMAND_CENTER_APP_PATHS = new Set\(\[([^\]]+)\]\)/)[1];
  assert.match(appPaths, /'\/dialer'/);
  assert.match(appPaths, /'\/settings'/);
  const publicPaths = bridge.match(/const PUBLIC_PATHS = new Set\(\[[\s\S]*?\]\);/)[0];
  assert.match(publicPaths, /'\/dialer',/, 'static shell route only; API routes stay protected');
  assert.equal(/'\/api\/phone-numbers'|'\/api\/dialer/.test(publicPaths), false, 'no phone/dialer API route is public');
});

test('legacy engine hands off to the same shell surfaces without duplicating logic', () => {
  const legacy = read('index.html');
  assert.match(legacy, /<a class="rail-item" href="\/dialer" aria-label="Parcel dialer"[^>]*>/);
  assert.match(legacy, /<a class="settings-nav-item" href="\/settings#phone-numbers"/);
  assert.match(legacy, /#oidBuyBtn'\)\?\.addEventListener\('click', \(\) => \{\s*\/\/[^\n]*\n\s*window\.location\.assign\('\/settings#phone-numbers'\);/);
  assert.equal(/Buy number queued \(demo\)/.test(legacy), false, 'demo-only purchase toast removed');
  assert.equal(/\/api\/phone-numbers|\/api\/dialer/.test(legacy), false, 'legacy page holds no provider/dialer API logic');
});

test('shell routes are inside the staff-gated layout and recognized for route restore', () => {
  const router = read('src/app/shell/router.tsx');
  const layoutChildren = router.slice(router.indexOf('Component: ParadiseLayout'), router.indexOf("{ path: '*'"));
  assert.match(layoutChildren, /\{ path: 'dialer', element: <ParcelDialer \/> \}/);
  assert.match(layoutChildren, /\{ path: 'settings', element: <Settings \/> \}/);
  const layout = read('src/app/shell/ParadiseLayout.tsx');
  assert.match(layout, /<TeamAccessGate onAuthenticated=\{onAuthenticated\}>\{children\}<\/TeamAccessGate>/);
  assert.match(layout, /'\/dialer',/);
  const panel = read('src/app/components/PhoneNumbersPanel.tsx');
  assert.match(panel, /id="phone-numbers"/);
  assert.match(panel, /window\.location\.hash !== '#phone-numbers'/);
  assert.match(panel, /\}, \[inventory, message\]\);/, 'scrolls on data or error');
});

test('render bridge image copies every new bridge module the server imports', () => {
  const docker = read('Dockerfile.openclaw');
  for (const mod of ['phone-numbers.mjs', 'parcel-dialer.mjs', 'phone-dialer-routes.mjs']) {
    assert.match(docker, new RegExp(`COPY scripts/${mod.replace('.', '\\.')} \\./scripts/${mod.replace('.', '\\.')}`), `${mod} is in the image`);
  }
  // The bridge and route module only import these local files.
  assert.match(read('scripts/openclaw-local-server.mjs'), /from '\.\/phone-dialer-routes\.mjs'/);
  const routes = read('scripts/phone-dialer-routes.mjs');
  const localImports = [...routes.matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(localImports, ['parcel-dialer.mjs', 'phone-numbers.mjs']);
  assert.deepEqual([...read('scripts/parcel-dialer.mjs').matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]), ['phone-numbers.mjs']);
});
