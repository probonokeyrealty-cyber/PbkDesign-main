import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:command-widgets-bridge"'),
  'package.json must expose test:command-widgets-bridge.'
);

assert(
  /updateRuntimeSettingsRequest/.test(commandCenter),
  'Command Center widget controls must persist through updateRuntimeSettingsRequest.'
);

assert(
  /settings\.ui\.commandCenterWidgets|ui\.commandCenterWidgets/.test(commandCenter),
  'Command Center must hydrate widget prefs from settings.ui.commandCenterWidgets.'
);

assert(
  /ui:\s*\{\s*commandCenterWidgets/.test(commandCenter),
  'Command Center must write widget prefs under settings.ui.commandCenterWidgets.'
);

assert(
  /data-source="PATCH \/api\/settings ui\.commandCenterWidgets"/.test(commandCenter),
  'Widget controls must annotate bridge writes as PATCH /api/settings ui.commandCenterWidgets.'
);

assert(
  /data-fallback="localStorage:pbk:command-center:widgets"/.test(commandCenter) &&
    /Device prefs|Bridge settings|bridge unavailable/i.test(commandCenter),
  'Widget controls must retain and honestly label device/localStorage preferences.'
);

assert(
  /Customize this dashboard for the whole team/.test(commandCenter) &&
    /every agent sees the same command\s+center/.test(commandCenter),
  'Widget controls copy must describe shared team preferences instead of local-only personalization.'
);

assert(
  /GET \/api\/brain\/web-search\/status/.test(commandCenter) &&
    !/GET \/api\/web-search\/status/.test(commandCenter),
  'Command Center must label the shipped web-search status endpoint, not the removed legacy path.'
);

assert(
  /Command Center widget controls[\s\S]*settings\.ui\.commandCenterWidgets[\s\S]*Ships/.test(
    dataMap
  ),
  'Data map must mark Command Center widget controls as shipped through bridge settings.'
);

console.log('command-widgets-bridge-smoke: ok');
