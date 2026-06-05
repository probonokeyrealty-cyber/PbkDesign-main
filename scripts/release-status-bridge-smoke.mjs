import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const settings = read('src/app/routes/Settings.tsx');
const bridge = read('scripts/openclaw-local-server.mjs');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const releaseRow =
  dataMap.split(/\r?\n/).find((line) => line.includes('| Production deploy/release panel')) || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:release-status-bridge"'),
  'package.json must expose test:release-status-bridge.'
);

assert(/export type ReleaseStatusResponse/.test(runtimeBridge), 'runtimeBridge must type release status responses.');

assert(
  /export async function fetchReleaseStatusRequest/.test(runtimeBridge) &&
    /path:\s*['"`]\/api\/release\/status/.test(runtimeBridge),
  'runtimeBridge must expose fetchReleaseStatusRequest for /api/release/status.'
);

assert(
  /buildReleaseStatusSnapshot/.test(bridge),
  'Bridge must build a canonical release status snapshot.'
);

assert(
  /\/api\/release\/status/.test(bridge),
  'Bridge must route GET /api/release/status.'
);

assert(
  /fetchReleaseStatusRequest/.test(settings),
  'Settings must fetch the release status bridge endpoint.'
);

assert(
  /SettingsReleasePanel/.test(settings) && /releaseStatus/.test(settings),
  'Settings must render a release panel from release status.'
);

assert(
  /endpoint="GET \/api\/release\/status"/.test(settings),
  'Settings release panel must label GET /api/release/status as its data source.'
);

assert(
  /GET \/api\/release\/status/.test(releaseRow) && /Ships/.test(releaseRow),
  'Data map must mark production deploy/release panel as shipped through GET /api/release/status.'
);

assert(
  !/Needs Mastra wiring/i.test(releaseRow),
  'Data map must not leave production deploy/release panel marked needs Mastra wiring.'
);

console.log('release-status-bridge-smoke: ok');
