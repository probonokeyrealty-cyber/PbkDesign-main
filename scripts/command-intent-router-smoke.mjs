import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMMAND_INTENT_ROUTER_VERSION,
  classifyCommandIntent,
  listCommandIntentRouterRules,
} from './command-intent-router.mjs';

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), 'utf8');

const statusCases = [
  ['Check PBK bridge health', 'status.bridge'],
  ['Is the OpenClaw gateway online?', 'status.openclaw_gateway'],
  ['Check sidecar connection status', 'status.desktop_sidecar'],
  ['Are all tools working?', 'status.tooling'],
  ['Verify Rex semantic memory readiness', 'status.vector_memory'],
  ['Show provider quota status', 'status.provider_quotas'],
];

for (const [command, expectedIntent] of statusCases) {
  const result = classifyCommandIntent(command);
  assert.equal(result.matched, true, `${command} should match the fast status lane`);
  assert.equal(result.intent, expectedIntent, `${command} should route to ${expectedIntent}`);
  assert.equal(result.confidence, 1, 'Fast routes must require deterministic confidence');
  assert.equal(result.cacheable, true, 'Fast status routes should be cacheable');
  assert.ok(result.ttlSeconds > 0 && result.ttlSeconds <= 30, 'Status cache TTL must stay short');
}

const guardedCases = [
  'Restart OpenClaw',
  'Deploy the bridge',
  'Check the status of lead Diane',
  'Send a text to the seller',
  'Update provider status',
  'Backfill Rex vector memory',
  'Analyze this property deal',
];

for (const command of guardedCases) {
  const result = classifyCommandIntent(command);
  assert.equal(result.matched, false, `${command} must remain on the guarded command path`);
  assert.equal(result.category, 'COMPLEX_TASK');
  assert.equal(result.cacheable, false);
}

const rules = listCommandIntentRouterRules();
assert.equal(rules.length, 6);
assert.match(COMMAND_INTENT_ROUTER_VERSION, /^\d{4}-\d{2}-\d{2}-v\d+$/);

const bridge = read('scripts/openclaw-local-server.mjs');
const dockerfile = read('Dockerfile.openclaw');
const render = read('render.yaml');
const packageJson = JSON.parse(read('package.json'));

assert.match(bridge, /classifyCommandIntent/);
assert.match(bridge, /routeFastCommandIntent/);
assert.match(bridge, /command-intent-result/);
assert.match(bridge, /cache:\s*cacheHit\s*\?\s*'hit'\s*:\s*'miss'/);
assert.match(
  dockerfile,
  /COPY scripts\/command-intent-router\.mjs \.\/scripts\/command-intent-router\.mjs/
);
assert.match(render, /PBK_COMMAND_INTENT_ROUTER_ENABLED/);
assert.match(render, /PBK_COMMAND_INTENT_CACHE_ENABLED/);
assert.ok(packageJson.scripts?.['test:command-intent-router']);
assert.ok(packageJson.scripts?.['test:founder']?.includes('test:command-intent-router'));

assert.doesNotMatch(render, /name:\s*intent-router/i);
assert.doesNotMatch(dockerfile, /\bollama\b/i);

console.log('command-intent-router-smoke: ok');
