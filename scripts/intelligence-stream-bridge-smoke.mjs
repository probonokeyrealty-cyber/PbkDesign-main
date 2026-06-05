import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const bridge = read('scripts/openclaw-local-server.mjs');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const intelligenceRow =
  dataMap.split(/\r?\n/).find((line) => line.includes('| Ava/Rex intelligence stream')) || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:intelligence-stream-bridge"'),
  'package.json must expose test:intelligence-stream-bridge.'
);

assert(
  /export type IntelligenceStreamItem/.test(runtimeBridge),
  'runtimeBridge must type intelligence stream items.'
);

assert(
  /export async function fetchIntelligenceStreamRequest/.test(runtimeBridge) &&
    /path:\s*`?\/api\/intelligence\/stream/.test(runtimeBridge),
  'runtimeBridge must expose fetchIntelligenceStreamRequest for /api/intelligence/stream.'
);

assert(
  /buildIntelligenceStreamSnapshot/.test(bridge),
  'Bridge must build a canonical intelligence stream snapshot.'
);

assert(
  /\/api\/intelligence\/stream/.test(bridge),
  'Bridge must route GET /api/intelligence/stream.'
);

assert(
  /fetchIntelligenceStreamRequest/.test(commandCenter),
  'Command Center must fetch the intelligence stream bridge endpoint.'
);

assert(
  /intelligenceStreamItems/.test(commandCenter) && /fallbackActivityItems/.test(commandCenter),
  'Command Center must prefer bridge intelligence stream items and retain activity fallback.'
);

assert(
  /endpoint="GET \/api\/intelligence\/stream"/.test(commandCenter),
  'Activity panel must label GET /api/intelligence/stream as its primary data source.'
);

assert(
  /GET \/api\/intelligence\/stream/.test(intelligenceRow) && /Ships/.test(intelligenceRow),
  'Data map must mark Ava/Rex intelligence stream as shipped through GET /api/intelligence/stream.'
);

assert(
  !/Needs Mastra wiring/i.test(intelligenceRow),
  'Data map must not leave Ava/Rex intelligence stream marked needs Mastra wiring.'
);

console.log('intelligence-stream-bridge-smoke: ok');
