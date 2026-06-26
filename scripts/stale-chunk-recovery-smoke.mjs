import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const router = read('src/app/shell/router.tsx');
const mainShell = read('src/main.shell.tsx');
const analyzerMain = read('src/main.tsx');
const deployVersion = read('src/app/utils/deployVersion.ts');
const errorBoundary = read('src/app/components/ErrorBoundary.tsx');
const dealView = read('src/app/routes/DealView.tsx');
const viteConfig = read('vite.config.ts');
const netlifyConfig = read('netlify.toml');
const packageJson = JSON.parse(read('package.json'));

const lazyCount = (router.match(/lazy\(\(\)\s*=>/g) || []).length;
const guardedRouteCount = (router.match(/loadCurrentRoute\(\(\)\s*=>\s*import\(/g) || []).length;

assert(lazyCount > 0, 'Router should still lazy-load route chunks.');
assert.equal(
  guardedRouteCount,
  lazyCount,
  'Every lazy route import must be wrapped in loadCurrentRoute so stale shells check the deploy manifest before requesting chunks.',
);

assert(
  mainShell.includes('installPbkDeployGuard();'),
  'main.shell.tsx must install the deploy guard before rendering.',
);
assert(
  analyzerMain.includes('installPbkDeployGuard();'),
  'main.tsx must install the deploy guard for direct analyzer.html sessions.',
);
assert(
  deployVersion.includes("window.addEventListener('vite:preloadError'") &&
    /if\s*\(\s*reloadForCurrentDeploy\('vite-preload-error'\)\s*\)\s*\{\s*event\.preventDefault\(\)/s.test(
      deployVersion,
    ),
  'Deploy guard must prevent Vite preload errors only after scheduling a guarded reload.',
);
assert(
  deployVersion.includes("fetch(`${MANIFEST_PATH}?t=${Date.now()}`") &&
    deployVersion.includes("cache: 'no-store'") &&
    deployVersion.includes('deployedBuildId !== BUILD_ID'),
  'Deploy guard must fetch the current manifest without cache and compare build IDs.',
);
assert(
  errorBoundary.includes('reloadForCurrentDeploy') &&
    errorBoundary.includes('isStaleDynamicImportError'),
  'ErrorBoundary must use shared stale chunk recovery instead of isolated reload logic.',
);
assert(
  /if\s*\(\s*reloadForCurrentDeploy\('route-import-error'\)\s*\)\s*\{\s*return new Promise/s.test(
    deployVersion,
  ) && /throw error/.test(deployVersion),
  'Stale route imports must not hang forever when reload cannot be scheduled.',
);
assert(
  dealView.includes("reloadForCurrentDeploy('deal-view-chunk-error')") &&
    dealView.includes('Reload analyzer'),
  'DealView inner analyzer boundary must handle stale chunk errors with shared recovery.',
);

assert(
  viteConfig.includes('__PBK_BUILD_ID__') &&
    viteConfig.includes('pbk-build-manifest') &&
    viteConfig.includes("fileName: 'pbk-build-manifest.json'"),
  'Vite build must embed a build ID and emit pbk-build-manifest.json.',
);
assert(
  /for\s*=\s*"\/pbk-build-manifest\.json"[\s\S]*?Cache-Control\s*=\s*"no-cache, must-revalidate"/.test(
    netlifyConfig,
  ),
  'Netlify must serve pbk-build-manifest.json with no-cache headers.',
);

const assetMissIndex = netlifyConfig.indexOf('from = "/assets/*"');
const catchallIndex = netlifyConfig.lastIndexOf('from = "/*"');
assert(assetMissIndex >= 0, 'Netlify must explicitly 404 missing hashed asset chunks.');
assert(catchallIndex >= 0, 'Netlify must retain the SPA catch-all fallback.');
assert(
  assetMissIndex < catchallIndex,
  'Missing asset chunks must be handled before the SPA catch-all fallback.',
);

for (const route of [
  '/index.shell.html/*',
  '/inbox/*',
  '/skills',
  '/skills/*',
  '/skill-studio',
  '/skill-studio/*',
]) {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert(
    new RegExp(
      `for\\s*=\\s*"${escapedRoute}"[\\s\\S]*?Cache-Control\\s*=\\s*"no-cache, must-revalidate"`,
    ).test(netlifyConfig),
    `${route} must be no-cache because it rewrites to the shell.`,
  );
}

assert.equal(
  packageJson.scripts?.['test:stale-chunk-recovery'],
  'node ./scripts/stale-chunk-recovery-smoke.mjs',
  'package.json must expose test:stale-chunk-recovery.',
);

console.log('[stale-chunk-recovery-smoke] ok');
