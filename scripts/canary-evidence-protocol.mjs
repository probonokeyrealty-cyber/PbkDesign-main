import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { canonicalJson } from './skill-governance-store.mjs';

export const CANARY_EVIDENCE_SCHEMA = 'pbk-canary-evidence-v1';
export const CANARY_EVIDENCE_METRIC_VERSION = 'pbk-canary-metrics-v1';
export const CANARY_EVIDENCE_LIMITS = Object.freeze({
  maxObservationsPerSide: 256, maxRows: 1100, maxBytes: 2 * 1024 * 1024,
  maxObservationReportBytes: 2048, maxRunReportBytes: 64 * 1024,
  maxComparisonReportBytes: 8192, maxDiagnosticsBytes: 8192,
  operationTimeoutMs: 15_000, queryTimeoutMs: 2000, maxAgeMs: 86_400_000,
});
export const CANARY_EVIDENCE_KINDS = Object.freeze(Object.fromEntries(
  [['comparison', 8192], ['run', 64 * 1024], ['observation', 2048]].map(([kind, maxReportBytes]) => [kind, Object.freeze({
    suite: `canary_${kind}_v1`, source: `server:canary-${kind}:v1`, idPrefix: `canary_${kind}_`, maxReportBytes,
  })]),
));

const ROW_KEYS = ['id', 'tenant_id', 'suite_name', 'source', 'ok', 'total', 'passed', 'failed', 'created_at_exact', 'report'];
const COMMON_KEYS = ['schemaVersion', 'kind', 'tenantId', 'id', 'revision', 'admittedAt', 'startedAt', 'completedAt',
  'status', 'provenance', 'scope', 'executed', 'metricVersion', 'policyHash', 'cohortRef', 'attestation'];
const EXTRA_KEYS = {
  comparison: ['baseline', 'candidate'],
  run: ['side', 'comparisonId', 'admittedCount', 'observations'],
  observation: ['comparisonId', 'runId', 'executionRef', 'workloadRef', 'outcome', 'fallback', 'behaviorPassed', 'latencyMs'],
};
const HEX64 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const invalid = 'canary_evidence_invalid';
const limit = 'canary_evidence_limit_exceeded';
const knownCodes = new Set([invalid, limit, 'canary_evidence_stale', 'canary_evidence_future']);
function requireThat(condition, code = invalid) { if (!condition) throw new Error(code); }
const isHex = (value) => typeof value === 'string' && HEX64.test(value);
const isRevision = (value) => typeof value === 'string' && REVISION.test(value);
const isId = (value, kind) => typeof value === 'string' && value.startsWith(CANARY_EVIDENCE_KINDS[kind].idPrefix)
  && isHex(value.slice(CANARY_EVIDENCE_KINDS[kind].idPrefix.length));

// Inspect descriptors before reading values: never invoke input accessors/toJSON.
// Depth, node and byte budgets bound malformed structures before canonicalization.
function jsonBytes(value) {
  let bytes = 0;
  let nodes = 0;
  const seen = new Set();
  function visit(item, depth) {
    requireThat(!types.isProxy(item));
    requireThat(++nodes <= 60_000 && depth <= 16, limit);
    if (item === null || typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number') {
      requireThat(typeof item !== 'number' || Number.isFinite(item));
      if (typeof item === 'string') requireThat(item.length <= CANARY_EVIDENCE_LIMITS.maxBytes, limit);
      bytes += Buffer.byteLength(JSON.stringify(item));
    } else {
      requireThat(typeof item === 'object' && !seen.has(item));
      const array = Array.isArray(item);
      requireThat(Object.getPrototypeOf(item) === (array ? Array.prototype : Object.prototype));
      seen.add(item);
      const keys = Reflect.ownKeys(item);
      requireThat(keys.length <= 10_000, limit);
      if (array) {
        requireThat(keys.length === item.length + 1 && keys.includes('length'));
      }
      bytes += 2;
      let count = 0;
      for (const key of keys) {
        if (array && key === 'length') continue;
        requireThat(typeof key === 'string');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        requireThat(descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
        if (array) requireThat(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length);
        else bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
        if (count++) bytes++;
        visit(descriptor.value, depth + 1);
      }
      seen.delete(item);
    }
    requireThat(bytes <= CANARY_EVIDENCE_LIMITS.maxBytes, limit);
  }
  visit(value, 0);
  return bytes;
}

function exactKeys(value, keys) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  const actual = Object.keys(value);
  requireThat(actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}

export function canaryRowDigest(row) {
  jsonBytes(row);
  exactKeys(row, ROW_KEYS);
  return createHash('sha256').update(canonicalJson(row)).digest('hex');
}

function timestamp(value, precision) {
  requireThat(typeof value === 'string');
  const pattern = precision === 6 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  requireThat(pattern.test(value));
  const millisecondText = precision === 6 ? `${value.slice(0, 23)}Z` : value;
  const ms = Date.parse(millisecondText);
  requireThat(Number.isFinite(ms) && new Date(ms).toISOString() === millisecondText);
  return BigInt(ms) * 1000n + (precision === 6 ? BigInt(value.slice(23, 26)) : 0n);
}

function checkCounters(row, total, passed) {
  requireThat(row.total === total && row.passed === passed && row.failed === total - passed && row.ok === (passed === total));
}

function failure(result) { return { verified: false, result, evidence: {}, diagnostics: { codes: [result] } }; }

export function verifyCanaryChain(input = {}) {
  try {
    // Dependencies are server-owned; inspect their descriptors as well, without
    // traversing arbitrary caller context or allowing an input getter to run.
    requireThat(input !== null && typeof input === 'object' && !types.isProxy(input));
    const args = {};
    for (const key of ['comparison', 'runs', 'observations', 'secret', 'revision', 'policyHash', 'now']) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      requireThat(descriptor && Object.hasOwn(descriptor, 'value'));
      args[key] = descriptor.value;
    }
    const { comparison, runs, observations, secret, revision, policyHash, now } = args;
    requireThat(typeof secret === 'string' && secret.length > 0 && secret.length <= 4096);
    requireThat(isRevision(revision) && isHex(policyHash));
    requireThat(typeof now === 'number' && Number.isSafeInteger(now) && Number.isFinite(new Date(now).getTime()));
    if (comparison === null || comparison === undefined) return failure('canary_evidence_missing');
    requireThat(!types.isProxy(runs) && !types.isProxy(observations) && Array.isArray(runs) && Array.isArray(observations));
    requireThat(1 + runs.length + observations.length <= CANARY_EVIDENCE_LIMITS.maxRows, limit);
    // Validate containers before iteration as array indices can be accessors too.
    jsonBytes(runs); jsonBytes(observations);
    const rows = [comparison, ...runs, ...observations];
    let bytes = 0;
    for (const row of rows) bytes += jsonBytes(row);
    requireThat(bytes <= CANARY_EVIDENCE_LIMITS.maxBytes, limit);
    const signingKey = createHmac('sha256', secret).update('pbk.canary-evidence.signing-key.v1').digest();
    const nowUs = BigInt(now) * 1000n;
    const oldestUs = nowUs - BigInt(CANARY_EVIDENCE_LIMITS.maxAgeMs) * 1000n;
    function fresh(time) {
      requireThat(time <= nowUs, 'canary_evidence_future');
      requireThat(time >= oldestUs, 'canary_evidence_stale');
    }
    function sideRef(ref, nullable = false) {
      if (nullable && ref === null) return;
      exactKeys(ref, ['id', 'digest', 'revision']);
      requireThat(isId(ref.id, 'run') && isHex(ref.digest) && isRevision(ref.revision));
    }
    function receipt(row, kind) {
      exactKeys(row, ROW_KEYS);
      const r = row.report;
      exactKeys(r, [...COMMON_KEYS, ...EXTRA_KEYS[kind]]);
      const config = CANARY_EVIDENCE_KINDS[kind];
      requireThat(Buffer.byteLength(canonicalJson(r)) <= config.maxReportBytes, limit);
      requireThat(r.schemaVersion === CANARY_EVIDENCE_SCHEMA && r.kind === kind && r.tenantId === 'pbk');
      requireThat(isId(r.id, kind) && row.id === r.id && row.tenant_id === 'pbk'
        && row.suite_name === config.suite && row.source === config.source);
      requireThat(isRevision(r.revision) && r.policyHash === policyHash && isHex(r.cohortRef));
      requireThat(r.metricVersion === CANARY_EVIDENCE_METRIC_VERSION && r.provenance === 'operational'
        && r.scope === 'independent_canary_execution');
      const pending = r.status === 'pending' && kind !== 'observation';
      requireThat(pending ? r.executed === false && r.completedAt === null : r.status === 'complete' && r.executed === true);
      for (const value of [row.total, row.passed, row.failed]) requireThat(Number.isSafeInteger(value) && value >= 0);
      requireThat(row.total === row.passed + row.failed && typeof row.ok === 'boolean' && row.ok === (row.failed === 0));
      requireThat(row.created_at_exact === r.admittedAt);
      const admitted = timestamp(r.admittedAt, 6);
      const start = timestamp(r.startedAt, 3);
      const end = pending ? null : timestamp(r.completedAt, 3);
      fresh(admitted); fresh(start);
      if (!pending) { fresh(end); requireThat(start < end && admitted <= end); }
      if (kind === 'comparison') {
        requireThat(r.revision === revision && row.total === 2);
        sideRef(r.baseline, pending); sideRef(r.candidate, pending);
        if (r.baseline !== null) requireThat(r.baseline.revision !== revision);
        if (r.candidate !== null) requireThat(r.candidate.revision === revision);
        if (r.baseline !== null && r.candidate !== null) requireThat(r.baseline.id !== r.candidate.id);
      } else if (kind === 'run') {
        requireThat(['baseline', 'candidate'].includes(r.side) && isId(r.comparisonId, 'comparison'));
        requireThat(Number.isSafeInteger(r.admittedCount) && r.admittedCount >= (pending ? 0 : 1)
          && r.admittedCount <= CANARY_EVIDENCE_LIMITS.maxObservationsPerSide, limit);
        requireThat(Array.isArray(r.observations) && r.observations.length === r.admittedCount && row.total === r.admittedCount);
        let previous = '';
        for (const member of r.observations) {
          exactKeys(member, ['id', 'digest']);
          requireThat(isId(member.id, 'observation') && isHex(member.digest) && member.id > previous);
          previous = member.id;
        }
      } else {
        requireThat(isId(r.comparisonId, 'comparison') && isId(r.runId, 'run') && isHex(r.executionRef) && isHex(r.workloadRef));
        requireThat(['success', 'error'].includes(r.outcome) && typeof r.fallback === 'boolean' && typeof r.behaviorPassed === 'boolean');
        requireThat(r.outcome !== 'error' || r.behaviorPassed === false);
        requireThat(typeof r.latencyMs === 'number' && Number.isFinite(r.latencyMs) && r.latencyMs >= 0
          && r.latencyMs <= Number(end - start) / 1000);
        checkCounters(row, 1, r.behaviorPassed ? 1 : 0);
      }
      exactKeys(r.attestation, ['version', 'signature']);
      requireThat(r.attestation.version === CANARY_EVIDENCE_SCHEMA && isHex(r.attestation.signature));
      const { attestation: _signature, ...body } = r;
      const expected = createHmac('sha256', signingKey).update(`${CANARY_EVIDENCE_SCHEMA}\n${canonicalJson(body)}`).digest();
      requireThat(timingSafeEqual(expected, Buffer.from(r.attestation.signature, 'hex')));
      return { row, report: r, admitted, start, end, pending };
    }
    const c = receipt(comparison, 'comparison');
    if (c.pending) return failure('canary_evidence_pending');
    requireThat(runs.length === 2);
    const runMap = new Map();
    let pendingRun = false;
    for (const row of runs) {
      const run = receipt(row, 'run');
      requireThat(!runMap.has(row.id)); runMap.set(row.id, run);
      pendingRun ||= run.pending;
    }
    // Authenticate and bind both runs before returning a pending denial.
    for (const side of ['baseline', 'candidate']) {
      const ref = c.report[side]; const run = runMap.get(ref.id);
      requireThat(run && canaryRowDigest(run.row) === ref.digest && run.report.revision === ref.revision
        && run.report.side === side && run.report.comparisonId === c.report.id && run.report.cohortRef === c.report.cohortRef);
      requireThat(run.start >= c.start && run.admitted >= c.start && run.admitted <= c.end);
      if (!run.pending) requireThat(run.end <= c.end);
    }
    if (pendingRun) return failure('canary_evidence_pending');
    const observationMap = new Map();
    for (const row of observations) { requireThat(!observationMap.has(row.id)); observationMap.set(row.id, row); }
    const usedIds = new Set(); const executions = new Set();
    function facts(run) {
      const members = [];
      for (const ref of run.report.observations) {
        const row = observationMap.get(ref.id);
        requireThat(row && !usedIds.has(ref.id) && canaryRowDigest(row) === ref.digest);
        usedIds.add(ref.id);
        const o = receipt(row, 'observation'); const r = o.report;
        requireThat(r.comparisonId === c.report.id && r.runId === run.report.id && r.revision === run.report.revision
          && r.cohortRef === c.report.cohortRef && !executions.has(r.executionRef));
        executions.add(r.executionRef);
        requireThat(o.start >= run.start && o.end <= run.end && o.admitted >= run.start && o.admitted <= run.end);
        members.push(r);
      }
      const n = members.length;
      const passed = members.filter((r) => r.behaviorPassed).length;
      checkCounters(run.row, n, passed);
      const sorted = members.map((r) => r.latencyMs).sort((a, b) => a - b);
      return {
        proof: { runId: run.report.id, revision: run.report.revision, executed: true,
          executedAt: run.report.completedAt, provenance: 'operational', sampleCount: n,
          behaviorPassRate: passed / n, errorRate: members.filter((r) => r.outcome === 'error').length / n,
          fallbackRate: members.filter((r) => r.fallback).length / n, p95LatencyMs: sorted[Math.ceil(0.95 * n) - 1] },
        workloads: members.map((r) => r.workloadRef).sort(),
      };
    }
    const baseline = facts(runMap.get(c.report.baseline.id));
    const candidate = facts(runMap.get(c.report.candidate.id));
    requireThat(usedIds.size === observations.length && canonicalJson(baseline.workloads) === canonicalJson(candidate.workloads));
    checkCounters(comparison, 2, [...runMap.values()].filter((r) => r.row.failed === 0).length);
    return {
      verified: true, result: 'canary_evidence_verified',
      evidence: { canary: { runId: c.report.id, revision, executed: true, executedAt: c.report.completedAt,
        provenance: 'operational', baseline: baseline.proof, candidate: candidate.proof } },
      diagnostics: { codes: [] },
    };
  } catch (error) {
    return failure(knownCodes.has(error?.message) ? error.message : invalid);
  }
}
