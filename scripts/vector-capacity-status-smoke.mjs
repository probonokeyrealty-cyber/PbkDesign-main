import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const settings = read('src/app/routes/Settings.tsx');
const bridge = read('scripts/openclaw-local-server.mjs');
const dataMap = read('docs/modern-shell-bridge-data-map.md');
const vectorRow =
  dataMap.split(/\r?\n/).find((line) => line.includes('| Vector capacity')) || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:vector-capacity-status"'),
  'package.json must expose test:vector-capacity-status.'
);

assert(
  /export type VectorCapacityStatusResponse/.test(runtimeBridge),
  'runtimeBridge must type vector capacity status responses.'
);

assert(
  /export async function fetchVectorCapacityStatusRequest/.test(runtimeBridge) &&
    /path:\s*['"`]\/api\/vector\/capacity/.test(runtimeBridge),
  'runtimeBridge must fetch /api/vector/capacity.'
);

assert(
  /async function buildVectorCapacityStatus/.test(bridge),
  'Bridge must build vector capacity status from the Postgres catalog.'
);

assert(
  /estimated_embedded_count/.test(bridge) &&
    /pg_total_relation_size/.test(bridge) &&
    /vectorIndexMethod/.test(bridge) &&
    /brain_blog_posts/.test(bridge),
  'Vector capacity must expose row, storage, and vector-index evidence.'
);

assert(
  /s3Role:\s*['"]backup_only['"]/.test(bridge) &&
    /mastraRequired:\s*false/.test(bridge),
  'Bridge must keep S3 backup-only and avoid claiming Mastra is required.'
);

assert(
  /SettingsVectorCapacityPanel/.test(settings) &&
    /fetchVectorCapacityStatusRequest/.test(settings),
  'Settings must render the bridge-backed vector capacity panel.'
);

assert(
  /endpoint="GET \/api\/vector\/capacity"/.test(settings),
  'Settings must identify GET /api/vector/capacity as the panel source.'
);

assert(
  /GET \/api\/vector\/capacity/.test(vectorRow) && /Ships/.test(vectorRow),
  'The bridge data map must mark vector capacity as shipped.'
);

console.log('vector-capacity-status-smoke: ok');
