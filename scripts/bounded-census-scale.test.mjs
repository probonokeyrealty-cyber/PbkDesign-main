import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createBoundedCensusFixture, protectedCensusFingerprints } from './bounded-census-test-fixture.mjs';

let coverage = {}, paged = {};
try { coverage = await import('./runtime-coverage-store.mjs'); paged = await import('./runtime-paged-census.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const health = () => ({ authenticationConfigured: true, bootstrapReady: true, archiveReady: true,
  providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true, approvalMode: 'approval' });

test('112693 retained rows over 102 MB bootstrap across bounded operations without deleting history', async () => {
  assert.equal(typeof paged.preparePagedCensusObservation, 'function', 'paged census implementation required');
  assert.equal(typeof coverage.appendRuntimeCoverageCheckpoint, 'function');
  const fixture = await createBoundedCensusFixture({ count: 112693 });
  const { db, pool, now, monotonicNow } = fixture;
  const secret = 'explicit-local-scale-proof-material', revision = 'c'.repeat(40);
  const options = { pool, secret, revision, now, monotonicNow, bootId: 'scale-proof', protocol: 'paged-v2', health: health() };
  try {
    const before = await protectedCensusFingerprints((...args) => db.query(...args));
    const sourceFingerprint = async () => (await db.query(`SELECT count(*)::int AS count,
      sum(octet_length(public.pbk_census_projection('runtime_archive',to_jsonb(t))::text))::text AS bytes,
      md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY id)) AS fingerprint FROM activity_log t`)).rows[0];
    const retained = await sourceFingerprint();
    assert.equal(retained.count, 112693);
    assert(Number(retained.bytes) > 102213520);
    let first;
    for (let attempts = 0; attempts < 2048; attempts++) {
      fixture.beginOperation();
      const result = await coverage.appendRuntimeCoverageCheckpoint(options);
      const observed = fixture.endOperation();
      assert(observed.rows <= 10000, `loaded ${observed.rows} rows in one operation`);
      assert(observed.bytes <= 16777216, `loaded ${observed.bytes} bytes in one operation`);
      if (result.verified) { first = result.report; break; }
      assert.equal(result.result, 'coverage_source_bootstrap_incomplete', JSON.stringify(result));
      assert.equal((await db.query("SELECT count(*)::int AS n FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].n, 0);
      fixture.advance();
    }
    assert(first, 'complete baseline must close within a finite number of bounded operations');
    assert.equal(first.intervalStart, first.cutoff, 'bootstrap is not earlier monitoring coverage');
    assert.equal(first.source.inventory.receiptCount, 112693);
    assert.equal(first.instrumentation, 'runtime-paged-census-v2');
    let previous = first;
    for (let step = 0; step < 3; step++) {
      fixture.advance(); fixture.beginOperation();
      const result = await coverage.appendRuntimeCoverageCheckpoint({ ...options, previous });
      fixture.endOperation();
      assert.equal(result.verified, true, JSON.stringify(result));
      assert.equal(result.report.previous, previous.signature);
      previous = result.report;
    }
    const short = await coverage.readRuntimeCoverage({ ...options, cutoff: fixture.now() });
    assert.equal(short.verified, false);
    assert.equal(short.result, 'coverage_window_incomplete');
    assert.deepEqual(await sourceFingerprint(), retained);
    assert.deepEqual(await protectedCensusFingerprints((...args) => db.query(...args)), before);
    const history = [previous];
    for (let step = 0; step < 4; step++) {
      await db.query('UPDATE activity_log SET text=$2 WHERE id=$1',
        [`retained-${String(step + 1).padStart(9, '0')}`, `explicit-fixture-change-${step}`]);
      fixture.advance(); fixture.beginOperation();
      const result = await coverage.appendRuntimeCoverageCheckpoint({ ...options, previous });
      fixture.endOperation();
      assert.equal(result.verified, true, JSON.stringify(result));
      previous = result.report; history.push(previous);
    }
    const controller = new AbortController();
    const fence = { deadlineAt: performance.now() + 15000, signal: controller.signal,
      onAbort: () => controller.abort() };
    const client = await pool.connect();
    fixture.beginOperation();
    try {
      await client.query({ text: 'BEGIN ISOLATION LEVEL REPEATABLE READ' });
      const roots = await paged.readPagedCensusIntervalRoots({ client, secret, revision, now, fence,
        reports: history, snapshot: { inventory: previous.source.inventory } });
      assert.equal(roots.length, history.length);
      assert(roots.every((root, index) => root === history[index].source.intervalRoot));
      await client.query({ text: 'COMMIT' });
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
    finally { client.release(); }
    const historicalRead = fixture.endOperation();
    assert(historicalRead.rows <= 10000);
    assert(historicalRead.bytes <= 16777216);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM activity_log')).rows[0].n, 112693);
    assert.deepEqual(await protectedCensusFingerprints((...args) => db.query(...args)), before);
    assert(fixture.stats.operations > 1);
    assert(fixture.stats.peakRows <= 10000);
    assert(fixture.stats.peakBytes <= 16777216);
    if (fixture.stats.peakQueryMs > 2000) throw new Error(`Query fence exceeded: ${JSON.stringify(fixture.stats)}`);
    if (fixture.stats.peakOperationMs > 15000) throw new Error(`Operation fence exceeded: ${JSON.stringify(fixture.stats)}`);
    console.info(JSON.stringify({ fixture: 'bounded-census-scale', retainedRows: retained.count,
      retainedProjectedBytes: Number(retained.bytes), ...fixture.stats, checkpoints: 8,
      baselineHistoryUnchanged: true, explicitFixtureChanges: 4, historicalRootsVerified: history.length }));
  } finally { await fixture.close(); }
}, 600000);
