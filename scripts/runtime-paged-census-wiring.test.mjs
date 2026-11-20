import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from '@jest/globals';
import { parse } from 'yaml';
import { appendRuntimeCoverageCheckpoint, readRuntimeCoverage } from './runtime-coverage-store.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('an unknown census protocol fails before acquiring any database client', async () => {
  let acquisitions = 0;
  const pool = { connect: async () => { acquisitions++; throw Error('must not connect'); } };
  const input = { pool, secret: 'local-protocol-denial-fixture', revision: 'a'.repeat(40),
    bootId: 'fixture', protocol: 'unreviewed-paging', now: () => Date.parse('2026-11-17T12:00:00Z') };
  assert.equal((await appendRuntimeCoverageCheckpoint(input)).result, 'coverage_protocol_unavailable');
  assert.equal((await readRuntimeCoverage(input)).result, 'coverage_protocol_unavailable');
  assert.equal(acquisitions, 0);
});

test('paged protocol is explicit opt-in and its modules ship in the existing bridge image', () => {
  assert.match(read('.env.example'), /^PBK_RUNTIME_CENSUS_PROTOCOL=legacy-v1$/m);
  const docker = read('Dockerfile.openclaw');
  assert.match(docker, /COPY scripts\/runtime-paged-census\.mjs /);
  assert.match(docker, /COPY scripts\/bounded-census-migration\.mjs /);
  assert.match(docker, /COPY scripts\/migrations\/20261117-bounded-census\.sql /);
});

test('coverage binds paged instrumentation and reconstructs interval witnesses asynchronously', () => {
  const source = read('scripts/runtime-coverage-store.mjs');
  for (const name of ['preparePagedCensusObservation', 'collectPagedCensusSnapshotInTransaction',
    'readPagedCensusIntervalRoots', 'readPagedCensusInventory']) assert(source.includes(name), name);
  assert(source.includes('runtime-paged-census-v2'));
  assert.match(source, /await intervalRoots\(/);
});

test('the existing lifecycle sampler passes the selected protocol to its fenced store', () => {
  const source = read('scripts/runtime-coverage-sampler.mjs');
  assert.match(source, /protocol\s*=\s*process\.env\.PBK_RUNTIME_CENSUS_PROTOCOL/);
  assert.match(source, /appendRuntimeCoverageCheckpoint\(\{[^}]*protocol,/s);
});

test('CI requires the new guarded actual-Postgres proof without replacing existing qualification', () => {
  const workflow = parse(read('.github/workflows/release-qualification.yml'));
  const job = workflow.jobs['release-qualification'];
  const step = job.steps.find(row => row.name === 'Run bounded census Postgres proof');
  assert(step, 'bounded census concurrency/readback proof must execute in release CI');
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert(step.run.includes('--ttl-hours 1'));
  assert(step.run.includes('--branch-name pbk-eval-targeted-readiness-bounded-'));
  assert(step.run.includes('node --test scripts/bounded-census-postgres.node-test.mjs'));
  assert(!step.run.includes('--inject-runtime-db'));
  for (const name of ['Run disposable Postgres tests', 'Assert zero skipped or failed Postgres tests',
    'Run targeted schema and memory Postgres proof', 'Run Chromium and WebKit qualification']) {
    assert(job.steps.some(row => row.name === name), name);
  }
});
