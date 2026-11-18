import { types } from 'node:util';
import { CANARY_EVIDENCE_KINDS as kinds, CANARY_EVIDENCE_LIMITS as limits,
  canaryRowDigest, verifyCanaryAdmission, verifyCanaryChain } from './canary-evidence-protocol.mjs';
import { canonicalJson } from './skill-governance-store.mjs';

const INVALID = 'canary_evidence_invalid';
const LIMIT = 'canary_evidence_limit_exceeded';
const TIMEOUT = 'canary_evidence_timeout';
const UNAVAILABLE = 'canary_evidence_unavailable';
const SUPERSEDED = 'canary_evidence_superseded';
const codes = new Set([INVALID, LIMIT, TIMEOUT, UNAVAILABLE, SUPERSEDED,
  'canary_evidence_missing', 'canary_evidence_pending', 'canary_evidence_stale', 'canary_evidence_future']);
const source = 'postgres:pbk_eval_runs';
const requireThat = (condition, code = INVALID) => { if (!condition) throw new Error(code); };
const failure = (result) => ({ ok: false, verified: false, readbackVerified: false, source,
  result, runId: null, evidence: {}, diagnostics: { codes: [result] } });
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
const isId = (value, kind) => typeof value === 'string' && value.startsWith(kinds[kind].idPrefix)
  && hex(value.slice(kinds[kind].idPrefix.length), 64);
function clientError() { this.fail?.(); }

// Count the transferred projection, including auxiliary/control metadata, before
// stripping anything. Never run a row's getters, proxy traps or toJSON method.
function serializedBytes(value) {
  const seen = new Set(); let bytes = 0, nodes = 0;
  function visit(item, depth) {
    requireThat(!types.isProxy(item));
    requireThat(++nodes <= 60_000 && depth <= 16, LIMIT);
    if (item === null || ['string', 'boolean', 'number'].includes(typeof item)) {
      requireThat(typeof item !== 'number' || Number.isFinite(item));
      requireThat(typeof item !== 'string' || item.length <= limits.maxBytes, LIMIT);
      bytes += Buffer.byteLength(JSON.stringify(item));
    } else {
      requireThat(item !== null && typeof item === 'object' && !seen.has(item));
      const array = Array.isArray(item);
      requireThat(Object.getPrototypeOf(item) === (array ? Array.prototype : Object.prototype));
      const keys = Reflect.ownKeys(item);
      requireThat(keys.length <= 10_000, LIMIT);
      if (array) requireThat(keys.length === item.length + 1);
      seen.add(item); bytes += 2; let count = 0;
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
    requireThat(bytes <= limits.maxBytes, LIMIT);
  }
  visit(value, 0); return bytes;
}

function operation() {
  let last = process.hrtime.bigint();
  requireThat(typeof last === 'bigint' && last >= 0n, TIMEOUT);
  const end = last + BigInt(limits.operationTimeoutMs) * 1_000_000n;
  let poisoned = null, lease = null, cancelWait = null, rows = 0, bytes = 0;
  function release(destroy, owned = lease) {
    if (!owned || owned.released) return;
    owned.released = true;
    try {
      owned.client.release(destroy);
      // pg-pool reinstalls its idle listener synchronously on normal release.
      if (!destroy) owned.client.removeListener('error', owned.onError);
    } finally {
      // Keep a retired listener on destroyed/failed-release clients for late
      // driver events, without retaining the operation or poisoning a new lease.
      owned.fail = null;
    }
  }
  function poison(code) {
    poisoned ??= code;
    const error = new Error(poisoned);
    cancelWait?.(error);
    try { release(true); } catch { /* Destruction is best effort; never release twice. */ }
    return error;
  }
  function own(client) {
    const owned = { client, released: false, fail: () => poison(UNAVAILABLE) };
    owned.onError = clientError.bind(owned);
    client.on('error', owned.onError);
    if (poisoned) {
      try { release(true, owned); } catch { /* Late resources cannot rejoin the pool. */ }
    } else lease = owned;
  }
  function check(until = end) {
    if (poisoned) throw new Error(poisoned);
    const current = process.hrtime.bigint();
    if (typeof current !== 'bigint' || current < last || current >= until || current >= end) throw poison(TIMEOUT);
    last = current;
    return Number(end - current) / 1_000_000;
  }
  async function bounded(start, maximum) {
    const remaining = check();
    const ms = Math.floor(Math.min(maximum, remaining));
    if (ms < 1) throw poison(TIMEOUT);
    const until = last + BigInt(ms) * 1_000_000n;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) poison(TIMEOUT); }, ms);
      const cancel = (error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); cancelWait = null; reject(error);
      };
      cancelWait = cancel;
      Promise.resolve().then(() => { check(until); return start(ms); }).then((value) => {
        if (settled) return;
        try { check(until); } catch (error) { cancel(error); return; }
        settled = true; clearTimeout(timer); cancelWait = null; resolve(value);
      }, () => {
        if (settled) return;
        // A rejection may run before an overdue timer callback after a stall.
        let error;
        try { check(until); error = poison(UNAVAILABLE); } catch (caught) { error = caught; }
        cancel(error);
      });
    });
  }
  function charge(result) {
    requireThat(result && !types.isProxy(result));
    const descriptor = Object.getOwnPropertyDescriptor(result, 'rows');
    requireThat(descriptor && Object.hasOwn(descriptor, 'value'));
    const data = descriptor.value;
    requireThat(Array.isArray(data) && !types.isProxy(data));
    rows += data.length; requireThat(rows <= limits.maxRows, LIMIT);
    // Inspect the array descriptors before iteration as well as each row.
    requireThat(Reflect.ownKeys(data).length === data.length + 1);
    for (let i = 0; i < data.length; i++) {
      const item = Object.getOwnPropertyDescriptor(data, String(i));
      requireThat(item && Object.hasOwn(item, 'value'));
      bytes += serializedBytes(item.value); requireThat(bytes <= limits.maxBytes, LIMIT);
    }
    check(); return data;
  }
  return {
    check,
    allowance() { check(); return { bytes: limits.maxBytes - bytes, rows: limits.maxRows - rows }; },
    ensureCapacity(requiredBytes, requiredRows) {
      check(); requireThat(bytes + requiredBytes <= limits.maxBytes && rows + requiredRows <= limits.maxRows, LIMIT);
    },
    async acquire(pool) {
      await bounded(() => new Promise((resolve, reject) => {
        const acquired = (error, client) => {
          if (error) { reject(error); return; }
          try { own(client); resolve(); } catch (caught) { reject(caught); }
        };
        // Native pg removes its idle listener before invoking this callback.
        // Own the event channel here, not in a later promise continuation.
        const pending = pool.connect(acquired);
        // Preserve promise-only pool adapters used by the reader's callers.
        pending?.then((client) => acquired(null, client), reject);
      }), limits.operationTimeoutMs);
      check();
    },
    async query(text, values = []) {
      const result = await bounded((ms) => lease.client.query({ text, values, query_timeout: ms }), limits.queryTimeoutMs);
      try { return charge(result); } catch (error) {
        if (error?.message === LIMIT) throw poison(LIMIT);
        throw error;
      }
    },
    chargeProjectionTransfer(extra) { bytes += extra; if (bytes > limits.maxBytes) throw poison(LIMIT); check(); },
    async finish() {
      if (poisoned) return;
      await this.query('ROLLBACK');
      check();
      try { release(false); } catch { throw poison(UNAVAILABLE); }
      check();
    },
    destroy() { poison(UNAVAILABLE); },
  };
}

const projection = `id, tenant_id, suite_name, source, ok, total, passed, failed,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact,
  report`;
const envelopeOverhead = Buffer.byteLength('{"physical":,"physical_bytes":,"report_bytes":}');
const denialBytes = serializedBytes({ physical: null, physical_bytes: limits.maxBytes + 1,
  report_bytes: limits.maxRunReportBytes + 1 });

// Selection precedes admission: never filter an oversized newest row into an
// older pass. Admit the ENTIRE batch (including envelope metadata) or return one
// capped size-only denial. No physical field is returned outside this guard.
function admittedSql(selection, cap) {
  const fits = `batch_bytes <= $${cap + 1}::bigint AND batch_rows <= $${cap + 2}::int AND reports_fit`;
  return `WITH selected AS MATERIALIZED (
  ${selection}
), projected AS MATERIALIZED (
  SELECT row_to_json(selected) AS physical, COALESCE(octet_length(report::text), 4) AS report_bytes FROM selected
), sized AS MATERIALIZED (
  SELECT physical, report_bytes, octet_length(physical::text) AS physical_bytes FROM projected
), batch AS MATERIALIZED (
  SELECT COALESCE(sum(physical_bytes::bigint + octet_length(physical_bytes::text)
    + octet_length(report_bytes::text) + ${envelopeOverhead}), 0) AS batch_bytes,
    count(*) AS batch_rows, COALESCE(bool_and(report_bytes <= $${cap}), true) AS reports_fit,
    COALESCE(max(report_bytes), 0) AS max_report_bytes FROM sized
)
SELECT physical, physical_bytes, report_bytes FROM sized CROSS JOIN batch WHERE ${fits}
UNION ALL
SELECT NULL::json AS physical, LEAST(batch_bytes, ${limits.maxBytes + 1})::int AS physical_bytes,
  LEAST(max_report_bytes, ${limits.maxRunReportBytes + 1})::int AS report_bytes FROM batch WHERE NOT (${fits})`;
}
const newestSql = admittedSql(`SELECT ${projection} FROM public.pbk_eval_runs
  WHERE tenant_id = $1 AND (suite_name = $2 OR source = $3)
  ORDER BY created_at DESC, id DESC LIMIT 1`, 4);
const dependencySql = (count) => admittedSql(`SELECT ${projection} FROM public.pbk_eval_runs
  WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY id LIMIT ${count + 1}`, 3);

function physicalRows(raw, kind, op) {
  return raw.map((row) => {
    requireThat(row && typeof row === 'object' && Object.keys(row).length === 3
      && ['physical', 'physical_bytes', 'report_bytes'].every((key) => Object.hasOwn(row, key)));
    const { report_bytes, physical_bytes, physical } = row;
    requireThat(Number.isSafeInteger(physical_bytes) && physical_bytes >= 0);
    requireThat(Number.isSafeInteger(report_bytes) && report_bytes >= 0);
    requireThat(physical !== null && physical_bytes <= limits.maxBytes, LIMIT);
    requireThat(report_bytes <= kinds[kind].maxReportBytes, LIMIT);
    requireThat(physical && typeof physical === 'object');
    requireThat(physical.report !== null);
    const actual = serializedBytes(physical), reportActual = serializedBytes(physical.report);
    requireThat(reportActual <= report_bytes && actual + report_bytes - reportActual <= physical_bytes);
    // pg parses the physical JSON envelope. Charge whitespace/escaping removed
    // by parsing, across ALL fields, in addition to already charged metadata.
    op.chargeProjectionTransfer(physical_bytes - actual);
    canaryRowDigest(physical);
    return physical;
  });
}

const identity = (rows) => rows.map((row) => [row.id, canaryRowDigest(row)]).sort(([a], [b]) => a.localeCompare(b));
function sameRead(rows, previous) {
  const current = identity(rows);
  if (previous) requireThat(canonicalJson(current) === canonicalJson(previous), SUPERSEDED);
  return current;
}

export async function readCanaryEvidence(input = {}) {
  let op;
  try {
    op = operation();
    requireThat(input !== null && typeof input === 'object' && !types.isProxy(input));
    const { pool, secret, revision, policy, now = Date.now } = input;
    requireThat(pool && typeof pool.connect === 'function' && typeof now === 'function');
    requireThat(typeof secret === 'string' && secret.length > 0 && secret.length <= 4096 && hex(revision, 40));
    requireThat(policy?.ready === true && policy.version === 2 && hex(policy.hash, 64));
    const policyHash = policy.hash;
    let previousWall;
    function wall() {
      const value = now();
      requireThat(Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime())
        && (previousWall === undefined || value >= previousWall));
      previousWall = value; op.check(); return value;
    }
    wall();
    const verify = (chain) => {
      const verdict = verifyCanaryChain({ ...chain, secret, revision, policyHash, now: wall() });
      op.check(); return verdict;
    };
    async function snapshot(previous) {
      await op.acquire(pool);
      try {
        await op.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        async function select(text, values) {
          const ms = Math.max(1, Math.floor(Math.min(limits.queryTimeoutMs, op.check())));
          op.ensureCapacity(serializedBytes({ statement_timeout: `${ms}ms`, lock_timeout: `${ms}ms` }), 1);
          await op.query("SELECT set_config('statement_timeout', $1, true) AS statement_timeout, set_config('lock_timeout', $1, true) AS lock_timeout", [`${ms}ms`]);
          op.ensureCapacity(denialBytes, 1);
          const remaining = op.allowance();
          return op.query(text, [...values, remaining.bytes, remaining.rows]);
        }
        const comparisons = physicalRows(await select(newestSql,
          ['pbk', kinds.comparison.suite, kinds.comparison.source, kinds.comparison.maxReportBytes]), 'comparison', op);
        const admissionIdentity = sameRead(comparisons, previous?.comparison);
        requireThat(comparisons.length <= 1);
        if (comparisons.length === 0) throw new Error('canary_evidence_missing');
        const comparison = comparisons[0];
        const authenticated = verifyCanaryAdmission({ comparison, secret, revision, policyHash, now: wall() });
        op.check();
        if (!authenticated.verified) throw new Error(authenticated.result);
        const admission = comparison.report;
        const runIds = ['baseline', 'candidate'].map((side) => {
          const ref = admission[side];
          requireThat(ref && isId(ref.id, 'run') && hex(ref.digest, 64) && hex(ref.revision, 40));
          requireThat(side === 'candidate' ? ref.revision === revision : ref.revision !== revision);
          return ref.id;
        });
        requireThat(new Set(runIds).size === 2);
        const runs = physicalRows(await select(dependencySql(2), ['pbk', runIds, kinds.run.maxReportBytes]), 'run', op);
        const runIdentity = sameRead(runs, previous?.runs);
        requireThat(runs.length === 2 && new Set(runs.map((r) => r.id)).size === 2);
        for (const run of runs) {
          // The already authenticated admission binds the full persisted run,
          // including its signature. Full schema/signature checks follow below.
          const ref = [admission.baseline, admission.candidate].find((r) => r.id === run.id);
          requireThat(ref && canaryRowDigest(run) === ref.digest);
        }
        if (runs.some((r) => r.report.status === 'pending')) throw new Error(verify({ comparison, runs, observations: [] }).result);
        const observationIds = runs.flatMap((r) => {
          requireThat(r.report.status === 'complete' && Array.isArray(r.report.observations));
          requireThat(Number.isSafeInteger(r.report.admittedCount) && r.report.admittedCount > 0
            && r.report.admittedCount <= limits.maxObservationsPerSide, LIMIT);
          requireThat(r.report.observations.length === r.report.admittedCount);
          return r.report.observations.map((member) => { requireThat(isId(member?.id, 'observation') && hex(member.digest, 64)); return member.id; });
        });
        requireThat(new Set(observationIds).size === observationIds.length);
        const observations = physicalRows(await select(dependencySql(observationIds.length),
          ['pbk', observationIds, kinds.observation.maxReportBytes]), 'observation', op);
        const observationIdentity = sameRead(observations, previous?.observations);
        const chain = { comparison, runs, observations };
        const verdict = verify(chain);
        if (!verdict.verified) throw new Error(verdict.result);
        return { chain, comparison: admissionIdentity, runs: runIdentity, observations: observationIdentity };
      } finally { await op.finish(); }
    }
    const first = await snapshot();
    const fresh = await snapshot(first);
    // Never reuse the first proof or its rows. Cleanup is inside the same budget;
    // take a new wall sample after release and verify the fresh chain again.
    const final = verify(fresh.chain);
    if (!final.verified) return failure(final.result);
    // Compute extrema only from the newly authenticated canonical timestamps.
    // Sample completion time AFTER all expensive verification/aggregation work.
    let oldest, newest;
    for (const row of [fresh.chain.comparison, ...fresh.chain.runs, ...fresh.chain.observations]) {
      for (const key of ['admittedAt', 'startedAt', 'completedAt']) {
        const text = row.report[key];
        const time = BigInt(Date.parse(text)) * 1000n + (key === 'admittedAt' ? BigInt(text.slice(23, 26)) : 0n);
        if (oldest === undefined || time < oldest) oldest = time;
        if (newest === undefined || time > newest) newest = time;
      }
    }
    const completedAt = BigInt(wall()) * 1000n;
    requireThat(newest <= completedAt, 'canary_evidence_future');
    requireThat(oldest >= completedAt - BigInt(limits.maxAgeMs) * 1000n, 'canary_evidence_stale');
    op.check();
    return { ...final, ok: true, readbackVerified: true, source, runId: fresh.chain.comparison.id };
  } catch (error) {
    op?.destroy();
    return failure(codes.has(error?.message) ? error.message : UNAVAILABLE);
  }
}
