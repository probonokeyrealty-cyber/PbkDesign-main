import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const netlifyConfig = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
const shellHtml = readFileSync(resolve(root, 'index.shell.html'), 'utf8');
const legacyHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const mainShell = readFileSync(resolve(root, 'src/main.shell.tsx'), 'utf8');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
const buildDir = resolve(root, process.argv[2] || 'dist');
const includesLegacy = process.env.PBK_INCLUDE_LEGACY_SHELL === 'true';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function redirectTargetsShell(path) {
  return netlifyConfig.split('[[redirects]]').slice(1).some((block) =>
    block.match(/^from\s*=\s*"([^"]+)"/m)?.[1] === path &&
      /^to\s*=\s*"\/index\.shell\.html"/m.test(block) &&
      /^status\s*=\s*200$/m.test(block)
  );
}

assert(
  /to\s*=\s*"\/index\.shell\.html"/.test(netlifyConfig),
  'Netlify must route the root dashboard to index.shell.html.'
);

[
  '/',
  '/dashboard',
  '/command-center',
  '/leads',
  '/deal',
  '/deal/*',
  '/deals',
  '/deals/*',
  '/analyzer',
  '/inbox',
  '/fleet',
  '/agent-fleet',
  '/memory',
  '/brain',
  '/skills',
  '/skills/*',
  '/skill-studio',
  '/skill-studio/*',
  '/analytics',
  '/settings',
  '/campaigns',
  '/agent',
  '/agent-console',
  '/ava-chat',
].forEach((path) => {
  assert(redirectTargetsShell(path), `Netlify must route ${path} to the modern shell.`);
});

[
  '/dashboard',
  '/leads',
  '/deal',
  '/deals',
  '/analyzer',
  '/inbox',
  '/fleet',
  '/agent-fleet',
  '/agents',
  '/skill-studio',
  '/campaigns',
  '/agent',
  '/agent-console',
  '/ava-chat',
].forEach((path) => {
  assert(
    viteConfig.includes(`'${path}'`),
    `Vite dev fallback must route ${path} to the modern shell.`
  );
});

assert(
  /src\/main\.shell\.tsx/.test(shellHtml),
  'index.shell.html must mount the React shell entry.'
);
assert(
  /<title>PBK Command Center<\/title>/.test(shellHtml),
  'index.shell.html must expose a production Command Center title.'
);
assert(
  !/Shell Preview/.test(shellHtml),
  'index.shell.html must not expose preview copy in production.'
);
assert(
  /PBK Wholesale Paradise/.test(legacyHtml),
  'The original Command Center source must remain available for explicit legacy tests.'
);
assert(
  readFileSync(resolve(buildDir, 'index.html'), 'utf8') ===
    readFileSync(resolve(buildDir, 'index.shell.html'), 'utf8'),
  'The built default index.html must contain only the modern shell.'
);
const legacyEntry = resolve(buildDir, 'legacy-command-center.html');
assert(
  existsSync(legacyEntry) === includesLegacy,
  'The separate legacy entry must exist only for an explicitly enabled build.'
);
if (includesLegacy) {
  assert(/PBK Wholesale Paradise/.test(readFileSync(legacyEntry, 'utf8')), 'The opt-in entry must contain the legacy shell.');
}
const archiveDir = resolve(buildDir, 'legacy');
assert(
  !existsSync(archiveDir) || readdirSync(archiveDir, { recursive: true, withFileTypes: true })
    .every((entry) => entry.isDirectory()),
  'Historical design references must not be published.'
);
assert(
  !/Production deploy continues to use `index\.html`/.test(mainShell),
  'main.shell.tsx comments must not describe the legacy dashboard as the production default.'
);

console.log('root-shell-promotion-smoke: ok');
