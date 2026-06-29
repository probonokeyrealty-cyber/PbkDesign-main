#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const scriptPath = resolve(root, 'scripts/deepspec-benchmark-gate.mjs');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const runbook = readFileSync(resolve(root, 'docs/operations/ava-deepspec-runbook.md'), 'utf8');
const source = readFileSync(scriptPath, 'utf8');

assert.match(source, /baselineP95Ms/, 'DeepSpec benchmark gate must evaluate baseline p95 latency.');
assert.match(source, /deepspecP95Ms/, 'DeepSpec benchmark gate must evaluate DeepSpec p95 latency.');
assert.match(source, /fallbackRate/, 'DeepSpec benchmark gate must evaluate fallback rate.');
assert.match(source, /qualityPassRate/, 'DeepSpec benchmark gate must evaluate answer quality.');
assert.match(source, /approvalGatePassRate/, 'DeepSpec benchmark gate must evaluate approval/provider gate safety.');
assert.match(source, /PBK_DEEPSPEC_ENABLED=false/, 'DeepSpec benchmark gate should keep production enablement disabled on failure messaging.');

const tempDir = mkdtempSync(join(tmpdir(), 'pbk-deepspec-gate-'));
try {
  const passingPath = join(tempDir, 'passing.json');
  writeFileSync(
    passingPath,
    JSON.stringify({
      baselineP95Ms: 2200,
      deepspecP95Ms: 1450,
      baselineP50Ms: 1300,
      deepspecP50Ms: 900,
      fallbackRate: 0.02,
      qualityPassRate: 1,
      approvalGatePassRate: 1,
      sampleCount: 48,
    }),
    'utf8'
  );
  const passing = spawnSync(process.execPath, [scriptPath, passingPath], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(passing.status, 0, `Passing benchmark should pass. stderr=${passing.stderr}`);
  assert.match(passing.stdout, /deepspec_benchmark_gate_passed/, 'Passing benchmark should print a pass result.');

  const failingPath = join(tempDir, 'failing.json');
  writeFileSync(
    failingPath,
    JSON.stringify({
      baselineP95Ms: 2200,
      deepspecP95Ms: 2300,
      fallbackRate: 0.2,
      qualityPassRate: 0.98,
      approvalGatePassRate: 1,
      sampleCount: 8,
    }),
    'utf8'
  );
  const failing = spawnSync(process.execPath, [scriptPath, failingPath], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(failing.status, 0, 'Failing benchmark should block DeepSpec enablement.');
  assert.match(failing.stderr + failing.stdout, /PBK_DEEPSPEC_ENABLED=false/, 'Failure output should tell operators to keep DeepSpec disabled.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

assert.equal(
  pkg.scripts?.['deepspec:benchmark-gate'],
  'node ./scripts/deepspec-benchmark-gate.mjs',
  'package.json must expose deepspec:benchmark-gate.'
);
assert.equal(
  pkg.scripts?.['test:deepspec-benchmark-gate'],
  'node ./scripts/deepspec-benchmark-gate-smoke.mjs',
  'package.json must expose test:deepspec-benchmark-gate.'
);
assert.match(
  runbook,
  /npm run deepspec:benchmark-gate/,
  'DeepSpec runbook must require the executable benchmark gate before promotion.'
);

console.log('[deepspec-benchmark-gate-smoke] ok');
