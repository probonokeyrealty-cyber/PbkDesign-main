// Test-only receipts. Never import this signer into a runtime or persist its output.
import { createHash, createHmac } from 'node:crypto';
import { canonicalJson } from '../skill-governance-store.mjs';

const schema = 'pbk-canary-evidence-v1';
const hex = (value) => createHash('sha256').update(value).digest('hex');
const id = (kind, value) => `canary_${kind}_${hex(value)}`;
const digest = (row) => hex(canonicalJson(row));
const exact = (ms) => new Date(ms).toISOString().replace('Z', '000Z');

export function resignCanaryRow(row, secret) {
  const { attestation: _old, ...body } = row.report;
  const key = createHmac('sha256', secret).update('pbk.canary-evidence.signing-key.v1').digest();
  row.report.attestation = {
    version: schema,
    signature: createHmac('sha256', key).update(`${schema}\n${canonicalJson(body)}`).digest('hex'),
  };
  return row;
}

export function rebuildCanaryFixture(fixture, { membership = true, counters = true } = {}) {
  const { observations, runs, comparison, secret } = fixture;
  const setCounters = (row, total, passed) => Object.assign(row, {
    total, passed, failed: total - passed, ok: passed === total,
  });
  for (const row of observations) {
    if (counters) setCounters(row, 1, row.report.behaviorPassed === true ? 1 : 0);
    resignCanaryRow(row, secret);
  }
  for (const row of runs) {
    const members = observations.filter((item) => item.report.runId === row.id);
    if (membership) {
      row.report.observations = members.map((item) => ({ id: item.id, digest: digest(item) }))
        .sort((a, b) => a.id.localeCompare(b.id));
      row.report.admittedCount = members.length;
    }
    if (counters) setCounters(row, members.length, members.filter((item) => item.report.behaviorPassed).length);
    resignCanaryRow(row, secret);
  }
  for (const side of ['baseline', 'candidate']) {
    const row = runs[side === 'baseline' ? 0 : 1];
    comparison.report[side] = { id: row.id, digest: digest(row), revision: row.report.revision };
  }
  if (counters) setCounters(comparison, 2, runs.filter((row) => row.failed === 0).length);
  resignCanaryRow(comparison, secret);
  return fixture;
}

export function makeCanaryFixture(overrides = {}) {
  const {
    secret = 'fixture-only-canary-secret-not-runtime-authority',
    revision = 'a'.repeat(40), baselineRevision = 'b'.repeat(40),
    policyHash = hex('fixture-approved-policy'), now = Date.parse('2026-11-17T12:00:00.000Z'),
    sampleCount = 20,
  } = overrides;
  const comparisonId = id('comparison', 'fixture-comparison');
  const common = (kind, rowId, rev, start, end) => ({
    schemaVersion: schema, kind, tenantId: 'pbk', id: rowId, revision: rev,
    admittedAt: exact(start), startedAt: new Date(start).toISOString(),
    completedAt: new Date(end).toISOString(), status: 'complete',
    provenance: 'operational', scope: 'independent_canary_execution', executed: true,
    metricVersion: 'pbk-canary-metrics-v1', policyHash, cohortRef: hex('fixture-cohort'),
  });
  const physical = (kind, report) => ({
    id: report.id, tenant_id: 'pbk', suite_name: `canary_${kind}_v1`,
    source: `server:canary-${kind}:v1`, ok: true, total: 0, passed: 0, failed: 0,
    created_at_exact: report.admittedAt, report,
  });
  const comparison = physical('comparison', common('comparison', comparisonId, revision, now - 60_000, now - 1000));
  const runs = ['baseline', 'candidate'].map((side) => physical('run', {
    ...common('run', id('run', side), side === 'candidate' ? revision : baselineRevision, now - 50_000, now - 2000),
    side, comparisonId, admittedCount: sampleCount, observations: [],
  }));
  // Deliberately non-lexical numbers: nearest-rank p95 for 20 samples is 100, not 90 or 9.
  const latencies = [1, 10, 2, 100, 20, 3, 30, 4, 40, 5, 50, 6, 60, 7, 70, 8, 80, 9, 90, 1000];
  const observations = runs.flatMap((run) => Array.from({ length: sampleCount }, (_, index) => physical('observation', {
    ...common('observation', id('observation', `${run.report.side}-${index}`), run.report.revision,
      now - 40_000 + index * 10, now - 38_000 + index * 10),
    comparisonId, runId: run.id, executionRef: hex(`execution-${run.report.side}-${index}`),
    workloadRef: hex(`workload-${index}`), outcome: 'success', fallback: false, behaviorPassed: true,
    latencyMs: latencies[index % latencies.length],
  })));
  return rebuildCanaryFixture({ secret, revision, policyHash, now, comparison, runs, observations });
}
