import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const layout = read('src/app/shell/ParadiseLayout.tsx');
const topbar = read('src/app/shell/ShellTopbar.tsx');
const sidebar = read('src/app/shell/Sidebar.tsx');
const favorites = read('src/app/shell/FavoritesBar.tsx');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:shell-prototype-modern"'),
  'package.json must expose test:shell-prototype-modern.'
);

[
  'pbk-shell-frame',
  'pbk-shell-main-column',
  'pbk-shell-content',
  'pbk-shell-topbar',
  'pbk-shell-search',
  'pbk-shell-account',
  'pbk-shell-sidebar',
  'pbk-shell-nav-link',
  'pbk-shell-favorites',
].forEach((className) => {
  const haystack = [layout, topbar, sidebar, favorites, pbkCss].join('\n');
  assert(haystack.includes(className) || pbkCss.includes(`.${className}`), `${className} must exist.`);
});

assert(
  /data-source="GET \/api\/search"/.test(topbar),
  'ShellTopbar must annotate global search source as GET /api/search.'
);
assert(
  /pbk-shell-account[\s\S]*data-source="GET \/state"/.test(topbar),
  'ShellTopbar must annotate account source as GET /state.'
);
assert(
  /data-source="PATCH \/api\/settings"/.test(topbar),
  'ShellTopbar must annotate autopilot writes as PATCH /api/settings.'
);
assert(
  /data-source="PATCH \/api\/settings ui\.favorites"/.test(favorites) &&
    /data-fallback="localStorage:pbk:favorites:v1"/.test(favorites),
  'FavoritesBar must annotate bridge-backed favorites and local fallback sources.'
);
assert(
  /data-source="build env"/.test(sidebar),
  'Sidebar must annotate release metadata as build env.'
);
assert(
  /function isHostedShell/.test(sidebar) &&
    /pbkcommandcenter/.test(sidebar) &&
    /netlify\.app/.test(sidebar) &&
    /hosted build/.test(sidebar),
  'Hosted Netlify shell must label missing release env as hosted production, not dev/local build.'
);
assert(
  /useState\('Device prefs'\)/.test(layout) &&
    /themeDataSource = 'Device prefs'/.test(topbar) &&
    /prefsSource = 'Device prefs'/.test(sidebar) &&
    /useState\('Device prefs'\)/.test(favorites),
  'Shell preference labels should default to Device prefs instead of a false local fallback warning.'
);

assert(
  !/Probono Key Realty|probonokeyrealty@gmail\.com|v0\.1|UI-only|SAMPLE_SHELL|MOCK_SHELL/.test(
    [layout, topbar, sidebar, favorites].join('\n')
  ),
  'Shell chrome must not use hardcoded account/demo/release data.'
);

assert(
  /Shell chrome/.test(dataMap) &&
    /GET \/state/.test(dataMap) &&
    /PATCH \/api\/settings/.test(dataMap) &&
    /localStorage:pbk:favorites:v1/.test(dataMap),
  'Bridge data map must document shell chrome sources.'
);

[
  '.pbk-shell-frame',
  '.pbk-shell-topbar',
  '.pbk-shell-sidebar',
  '.pbk-shell-nav-link',
  '.pbk-shell-favorites',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

console.log('shell-prototype-modern-smoke: ok');
