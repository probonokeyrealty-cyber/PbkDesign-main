#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const planner = readFileSync(resolve(root, 'scripts/pbk-agent-planner.mjs'), 'utf8');
const worker = readFileSync(resolve(root, 'scripts/pbk-agent-worker.ps1'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

for (const section of ['## Goal', '## Success Criteria', '## Allowed Files', '## Forbidden Files', '## Required Tests', '## Proof', '## Deploy Impact']) {
  assert(
    planner.includes(section),
    `Agent planner prompt must require ${section} in child work orders.`
  );
}

assert.match(
  planner,
  /Proof[\s\S]*commands[\s\S]*logs[\s\S]*artifacts/i,
  'Planner prompt must explain that proof means expected commands, logs, or artifacts.'
);

assert.match(
  worker,
  /function Test-AgentWorkOrderReady/,
  'Agent worker must validate work-order readiness before invoking OpenClaw.'
);
assert.match(
  worker,
  /\$requiredSections\s*=\s*@\([\s\S]*"## Success Criteria"[\s\S]*"## Required Tests"[\s\S]*"## Proof"/,
  'Agent worker readiness validation must require Success Criteria, Required Tests, and Proof.'
);
assert.match(
  worker,
  /agent\/human-required/,
  'Agent worker must move incomplete work orders to human-required instead of running them.'
);
assert.match(
  worker,
  /Test-AgentWorkOrderReady[\s\S]*New-AgentPrompt/,
  'Agent worker must validate a ready issue before constructing the OpenClaw prompt.'
);

assert.equal(
  pkg.scripts?.['test:agent-work-order'],
  'node ./scripts/pbk-agent-work-order-smoke.mjs',
  'package.json must expose test:agent-work-order.'
);

console.log('[pbk-agent-work-order-smoke] ok');
