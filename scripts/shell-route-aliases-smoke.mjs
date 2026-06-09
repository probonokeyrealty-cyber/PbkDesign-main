import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const router = readFileSync(resolve(root, 'src/app/shell/router.tsx'), 'utf8');
const layout = readFileSync(resolve(root, 'src/app/shell/ParadiseLayout.tsx'), 'utf8');
const topbar = readFileSync(resolve(root, 'src/app/shell/ShellTopbar.tsx'), 'utf8');
const netlifyConfig = readFileSync(resolve(root, 'netlify.toml'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasRouterAlias(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`path:\\s*['"]${escaped}['"][\\s\\S]*?<CommandCenter\\s*/>`).test(router);
}

function redirectsToShell(path) {
  const escaped = path.replace(/\//g, '\\/');
  return new RegExp(
    `from\\s*=\\s*"${escaped}"[\\s\\S]*?to\\s*=\\s*"\\/index\\.shell\\.html"[\\s\\S]*?status\\s*=\\s*200`
  ).test(netlifyConfig);
}

assert(hasRouterAlias('command-center'), 'React router must accept /command-center as a Command Center alias.');
assert(hasRouterAlias('dashboard'), 'React router must accept /dashboard as a Command Center alias.');
assert(
  /path:\s*['"]agents['"][\s\S]*?<AgentFleet\s*\/>/.test(router),
  'React router must accept /agents as an Agent Fleet alias.'
);
assert(
  /path:\s*['"]\*['"][\s\S]*?<NotFound\s*\/>/.test(router),
  'React router must provide a branded catch-all route.'
);
assert(layout.includes("'/command-center'"), 'Saved shell route validation must allow /command-center.');
assert(layout.includes("'/dashboard'"), 'Saved shell route validation must allow /dashboard.');
assert(layout.includes("'/inbox/conversations'"), 'Saved route validation must allow the unified inbox.');
assert(layout.includes("'/agents'"), 'Saved route validation must allow the Agent Fleet alias.');
assert(
  layout.includes("/^\\/leads\\/[^/]+$/.test(pathname)"),
  'Saved route validation must allow lead portal paths.'
);
assert(topbar.includes('`/command-center?search='), 'Global search deep links should target /command-center.');
assert(redirectsToShell('/command-center'), 'Netlify must serve the shell for /command-center.');
assert(redirectsToShell('/dashboard'), 'Netlify must serve the shell for /dashboard.');
assert(redirectsToShell('/agents'), 'Netlify must serve the shell for /agents.');

console.log('shell-route-aliases-smoke: ok');
