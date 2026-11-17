import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createBoundedCensusFixture, protectedCensusFingerprints } from './bounded-census-test-fixture.mjs';
import { appendRuntimeCoverageCheckpoint, readRuntimeCoverage, verifyRuntimeCoverageReference } from './runtime-coverage-store.mjs';
import { readPagedCensusIntervalRoots } from './runtime-paged-census.mjs';

const health = { authenticationConfigured: true, bootstrapReady: true, archiveReady: true,
  providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true, approvalMode: 'approval' };
const DAY = 86400000;
const measure = async (fixture, action) => {
  fixture.beginOperation();
  const result = await action();
  const measured = fixture.endOperation();
  assert(measured.rows <= 10000); assert(measured.bytes <= 16777216);
  assert(fixture.stats.peakQueryMs <= 2000); assert(fixture.stats.peakOperationMs <= 15000);
  return result;
};

test('paged quiet 24h proof is forward-only, independently readable, and never organic qualification', async () => {
  const fixture = await createBoundedCensusFixture();
  const { db, pool, now, monotonicNow } = fixture;
  const options = { pool, secret: 'explicit-paged-day-fixture-material', revision: 'e'.repeat(40),
    bootId: 'paged-day', protocol: 'paged-v2', now, monotonicNow, health };
  const sample = previous => measure(fixture, () => appendRuntimeCoverageCheckpoint({ ...options, previous }));
  try {
    const protectedBefore = await protectedCensusFingerprints((...args) => db.query(...args));
    let first;
    for (let attempts = 0; attempts < 32; attempts++) {
      const result = await sample();
      if (result.verified) { first = result.report; break; }
      assert.equal(result.result, 'coverage_source_bootstrap_incomplete', JSON.stringify(result));
      fixture.advance();
    }
    assert(first);
    assert.equal(first.intervalStart, first.cutoff);
    assert.equal((await measure(fixture, () => readRuntimeCoverage(options))).result, 'coverage_window_incomplete');
    let previous = first;
    for (let elapsed = 0; elapsed < DAY; elapsed += 60000) {
      fixture.advance();
      const result = await sample(previous);
      assert.equal(result.verified, true, JSON.stringify(result));
      assert.equal(result.report.previous, previous.signature);
      previous = result.report;
    }
    const day = await measure(fixture, () => readRuntimeCoverage(options));
    assert.equal(day.verified, true, JSON.stringify(day));
    assert.equal(day.proof.checkpointCount, 1441);
    assert.equal(day.proof.instrumentation, 'runtime-paged-census-v2');
    assert.equal(day.proof.census.schemaVersion, 'pbk-runtime-source-evidence-v2');
    assert.equal(day.diagnostics.organicCompletions, 0);
    assert.equal(day.diagnostics.fleetQualified, false);
    assert(day.sources.every(source => source.counts.eligible === 0));
    const reference = day.proof.reference;
    assert.equal((await measure(fixture, () => verifyRuntimeCoverageReference({ ...options, reference }))).verified, true);
    fixture.advance();
    const next = await sample(previous);
    assert.equal(next.verified, true, JSON.stringify(next));
    assert.equal((await measure(fixture, () => verifyRuntimeCoverageReference({ ...options, reference }))).verified, true,
      'healthy head advance cannot invalidate the exact retained quiet proof');
    const denied = await measure(fixture, () => appendRuntimeCoverageCheckpoint({ ...options, pool: { ...pool, controlled: true }, previous: next.report }));
    assert.equal(denied.result, 'coverage_controlled_execution');
    fixture.advance(120001);
    const rebooted = await measure(fixture, () => appendRuntimeCoverageCheckpoint({ ...options, bootId: 'fresh-boot' }));
    assert.equal(rebooted.verified, true, JSON.stringify(rebooted));
    assert.equal(rebooted.report.intervalStart, rebooted.report.cutoff);
    assert.notEqual(rebooted.report.segmentRef, next.report.segmentRef);
    assert.equal((await measure(fixture, () => readRuntimeCoverage(options))).result, 'coverage_window_incomplete');
    assert.equal((await measure(fixture, () => verifyRuntimeCoverageReference({ ...options, reference }))).verified, false);
    assert.deepEqual(await protectedCensusFingerprints((...args) => db.query(...args)), protectedBefore);
    console.info(JSON.stringify({ fixture: 'paged-quiet-day', checkpoints: 1441,
      virtualClockOnly: true, organicCompletions: 0, protectedRecordsUnchanged: true, ...fixture.stats }));
  } finally { await fixture.close(); }
}, 600000);

test('240 changed historical roots verify within the original fence at a modest database round trip', async () => {
  const fixture = await createBoundedCensusFixture({ count: 1 });
  const { db, pool, now, monotonicNow } = fixture;
  const secret = 'explicit-paged-network-fixture-material', revision = 'f'.repeat(40);
  const options = { pool, secret, revision, bootId: 'paged-network', protocol: 'paged-v2', now, monotonicNow, health };
  try {
    const before = await protectedCensusFingerprints((...args) => db.query(...args));
    let previous;
    for (let attempts = 0; attempts < 32; attempts++) {
      const result = await measure(fixture, () => appendRuntimeCoverageCheckpoint(options));
      if (result.verified) { previous = result.report; break; }
      assert.equal(result.result, 'coverage_source_bootstrap_incomplete', JSON.stringify(result));
      fixture.advance();
    }
    assert(previous);
    const reports = [];
    for (let step = 0; step < 240; step++) {
      await db.query("UPDATE activity_log SET text=$1 WHERE id='retained-000000001'", [`fixture-change-${step}`]);
      fixture.advance();
      const result = await measure(fixture, () => appendRuntimeCoverageCheckpoint({ ...options, previous }));
      assert.equal(result.verified, true, JSON.stringify(result));
      previous = result.report; reports.push(previous);
    }
    assert.equal(new Set(reports.map(report => report.source.inventory.reference.id)).size, 240);
    const raw = await pool.connect();
    let queries = 0;
    const client = { async query(config) {
      queries++;
      await new Promise(done => setTimeout(done, 20));
      return raw.query(config);
    } };
    const controller = new AbortController();
    const fence = { deadlineAt: performance.now() + 15000, signal: controller.signal,
      onAbort: () => { controller.abort(); raw.release(true); } };
    const start = performance.now();
    fixture.beginOperation();
    try {
      await client.query({ text: 'BEGIN ISOLATION LEVEL REPEATABLE READ' });
      const roots = await readPagedCensusIntervalRoots({ client, secret, revision, now, fence, reports,
        snapshot: { inventory: previous.source.inventory } });
      assert.equal(roots.length, 240);
      assert(roots.every((root, index) => root === reports[index].source.intervalRoot));
      await client.query({ text: 'COMMIT' });
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    finally { raw.release(); }
    const elapsedMs = Math.round(performance.now() - start);
    const measured = fixture.endOperation();
    assert(measured.rows <= 10000); assert(measured.bytes <= 16777216);
    assert(elapsedMs < 15000, `historical reconstruction took ${elapsedMs}ms`);
    assert.deepEqual(await protectedCensusFingerprints((...args) => db.query(...args)), before);
    console.info(JSON.stringify({ fixture: 'paged-network-profile', changedRoots: 240,
      simulatedRoundTripMs: 20, queries, elapsedMs, operationalHistoryClaimed: false }));
  } finally { await fixture.close(); }
}, 600000);
