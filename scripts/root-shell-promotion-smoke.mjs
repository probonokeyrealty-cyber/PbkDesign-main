import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const netlifyConfig = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
const shellHtml = readFileSync(resolve(root, 'index.shell.html'), 'utf8');
const legacyHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const mainShell = readFileSync(resolve(root, 'src/main.shell.tsx'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function redirectTargetsShell(path) {
  const escaped = path.replace(/\//g, '\\/');
  const pattern = new RegExp(
    `from\\s*=\\s*"${escaped}"[\\s\\S]*?to\\s*=\\s*"\\/index\\.shell\\.html"[\\s\\S]*?status\\s*=\\s*200`
  );
  return pattern.test(netlifyConfig);
}

assert(/to\s*=\s*"\/index\.shell\.html"/.test(netlifyConfig), 'Netlify must route the root dashboard to index.shell.html.');

[
  '/',
  '/dashboard',
  '/command-center',
  '/leads',
  '/deal',
  '/deal/*',
  '/inbox',
  '/fleet',
  '/memory',
  '/analytics',
  '/settings',
  '/campaigns',
].forEach((path) => {
  assert(redirectTargetsShell(path), `Netlify must route ${path} to the modern shell.`);
});

assert(/src\/main\.shell\.tsx/.test(shellHtml), 'index.shell.html must mount the React shell entry.');
assert(/PBK Wholesale Paradise/.test(legacyHtml), 'legacy index.html must remain available as the fallback dashboard artifact.');
assert(!/Production deploy continues to use `index\.html`/.test(mainShell), 'main.shell.tsx comments must not describe the legacy dashboard as the production default.');

console.log('root-shell-promotion-smoke: ok');
