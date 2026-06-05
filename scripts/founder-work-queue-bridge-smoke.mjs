import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const bridge = read('scripts/openclaw-local-server.mjs');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const founderQueueRow = dataMap
  .split(/\r?\n/)
  .find((line) => line.includes('| Founder command queue')) || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:founder-work-queue-bridge"'),
  'package.json must expose test:founder-work-queue-bridge.'
);

assert(
  /export type FounderWorkQueueItem/.test(runtimeBridge),
  'runtimeBridge must type founder work queue items.'
);

assert(
  /export async function fetchFounderWorkQueueRequest/.test(runtimeBridge) &&
    /path:\s*`?\/api\/founder\/work-queue/.test(runtimeBridge),
  'runtimeBridge must expose fetchFounderWorkQueueRequest for /api/founder/work-queue.'
);

assert(
  /buildFounderWorkQueueSnapshot/.test(bridge),
  'Bridge must build a canonical founder work queue snapshot.'
);

assert(
  /\/api\/founder\/work-queue/.test(bridge),
  'Bridge must route GET /api/founder/work-queue.'
);

assert(
  /fetchFounderWorkQueueRequest/.test(commandCenter),
  'Command Center must fetch the founder work queue bridge endpoint.'
);

assert(
  /bridgeBattlefieldItems/.test(commandCenter) && /fallbackBattlefieldItems/.test(commandCenter),
  'Command Center must prefer bridge-ranked battlefield items and retain a client snapshot fallback.'
);

assert(
  /endpoint="GET \/api\/founder\/work-queue"/.test(commandCenter),
  'FounderBattlefield must label GET /api/founder/work-queue as its primary data source.'
);

assert(
  /GET \/api\/founder\/work-queue/.test(founderQueueRow) && /Ships/.test(founderQueueRow),
  'Data map must mark Founder command queue as shipped through GET /api/founder/work-queue.'
);

assert(
  !/Needs Mastra wiring/i.test(founderQueueRow),
  'Data map must not leave the Founder command queue marked needs Mastra wiring.'
);

console.log('founder-work-queue-bridge-smoke: ok');
