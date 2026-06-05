import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const layout = read('src/app/shell/ParadiseLayout.tsx');
const topbar = read('src/app/shell/ShellTopbar.tsx');
const sidebar = read('src/app/shell/Sidebar.tsx');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:shell-prefs-bridge"'),
  'package.json must expose test:shell-prefs-bridge.'
);

assert(
  /updateRuntimeSettingsRequest/.test(layout),
  'ParadiseLayout must persist theme and rail preferences through updateRuntimeSettingsRequest.'
);

assert(
  /ui\.theme/.test(layout) && /ui:\s*updates/.test(layout),
  'ParadiseLayout must hydrate or write shell theme under settings.ui.theme.'
);

assert(
  /ui\.railCollapsed/.test(layout) && /ui:\s*updates/.test(layout),
  'ParadiseLayout must hydrate or write rail state under settings.ui.railCollapsed.'
);

assert(
  /data-source="PATCH \/api\/settings ui\.theme"/.test(topbar),
  'ShellTopbar theme button must annotate bridge writes as PATCH /api/settings ui.theme.'
);

assert(
  /data-source="PATCH \/api\/settings ui\.railCollapsed"/.test(sidebar),
  'Sidebar rail toggle must annotate bridge writes as PATCH /api/settings ui.railCollapsed.'
);

assert(
  /localStorage:pbk:prefs:v1/.test(layout + topbar + sidebar) &&
    /Local fallback|bridge unavailable/i.test(layout + topbar + sidebar),
  'Shell prefs must retain and label localStorage fallback.'
);

assert(
  /Cross-device user prefs[\s\S]*settings\.ui\.theme[\s\S]*settings\.ui\.railCollapsed[\s\S]*Ships/.test(
    dataMap
  ),
  'Data map must mark shell theme and rail preferences as shipped through bridge settings.'
);

console.log('shell-prefs-bridge-smoke: ok');
