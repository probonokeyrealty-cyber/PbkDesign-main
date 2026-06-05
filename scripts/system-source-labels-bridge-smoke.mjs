import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const bridge = read('scripts/openclaw-local-server.mjs');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const sourceLabelsRow =
  dataMap.split(/\r?\n/).find((line) => line.includes('| System confidence/source labels')) || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:system-source-labels-bridge"'),
  'package.json must expose test:system-source-labels-bridge.'
);

assert(
  /export type SystemSourceLabel/.test(runtimeBridge),
  'runtimeBridge must type system source labels.'
);

assert(
  /export async function fetchSystemSourceLabelsRequest/.test(runtimeBridge) &&
    /path:\s*['"`]\/api\/system\/source-labels/.test(runtimeBridge),
  'runtimeBridge must expose fetchSystemSourceLabelsRequest for /api/system/source-labels.'
);

assert(
  /buildSystemSourceLabelsSnapshot/.test(bridge),
  'Bridge must build canonical system source label snapshots.'
);

assert(
  /\/api\/system\/source-labels/.test(bridge),
  'Bridge must route GET /api/system/source-labels.'
);

assert(
  /fetchSystemSourceLabelsRequest/.test(commandCenter),
  'Command Center must fetch the source labels bridge endpoint.'
);

assert(
  /sourceConfidenceItems/.test(commandCenter) && /SourceConfidenceRail/.test(commandCenter),
  'Command Center must render a source confidence rail from bridge source labels.'
);

assert(
  /endpoint="GET \/api\/system\/source-labels"/.test(commandCenter),
  'Command Center source rail must label GET /api/system/source-labels as its data source.'
);

assert(
  /GET \/api\/system\/source-labels/.test(sourceLabelsRow) && /Ships/.test(sourceLabelsRow),
  'Data map must mark system confidence/source labels as shipped through GET /api/system/source-labels.'
);

assert(
  !/Needs Mastra wiring/i.test(sourceLabelsRow),
  'Data map must not leave system confidence/source labels marked needs Mastra wiring.'
);

console.log('system-source-labels-bridge-smoke: ok');
