import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import { prepareRuntimeSourceObservation, collectRuntimeSourceSnapshotInTransaction } from './runtime-source-evidence.mjs';
import { getRuntimeEvidenceContext } from './runtime-evidence-context.mjs';
import { preparePagedCensusObservation, collectPagedCensusSnapshotInTransaction,
  readPagedCensusIntervalRoots, readPagedCensusInventory } from './runtime-paged-census.mjs';

export const RUNTIME_COVERAGE_POLICY = Object.freeze({ version: 'pbk-runtime-coverage-policy-v1',
  sampleMs: 60000, maxGapMs: 90000, windowMs: 86400000, maxCheckpoints: 2000,
  maxReportBytes: 8192, maxBytes: 16777216, operationMs: 15000, queryMs: 2000, leaseMs: 120000 });
const P = RUNTIME_COVERAGE_POLICY;
const SCHEMA = 'pbk-runtime-coverage-v1', INSTRUMENTATION = 'runtime-source-evidence-v1';
const PAGED_INSTRUMENTATION = 'runtime-paged-census-v2';
const censusProtocol = input => input.protocol ?? process.env.PBK_RUNTIME_CENSUS_PROTOCOL ?? 'legacy-v1';
const validProtocol = protocol => ['legacy-v1', 'paged-v2'].includes(protocol);
const instrumentation = protocol => protocol === 'paged-v2' ? PAGED_INSTRUMENTATION : INSTRUMENTATION;
const REFERENCE_SCHEMA = 'pbk-runtime-coverage-reference-v1';
const SUITE = 'runtime_coverage_v1', SOURCE = 'server:runtime-coverage:v1';
const CONTROL_SUITE = 'runtime_coverage_control_v1', CONTROL_SOURCE = 'server:runtime-coverage-control:v1';
const CONTROL_ID = 'runtime-coverage-control-pbk-v1';
const SELECT = 'SELECT id,tenant_id,suite_name,ok,total,passed,failed,report,source,created_at FROM public.pbk_eval_runs';
const HEALTH_KEYS = ['authenticationConfigured', 'bootstrapReady', 'archiveReady',
  'providerCircuitsReady', 'observabilityReady', 'eventBusConnected'];
const iso = n => new Date(n).toISOString();
const clock = value => typeof value === 'function' ? value() : value;
const validClock = n => Number.isSafeInteger(n) && Number.isFinite(new Date(n).getTime());
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && iso(Date.parse(value)) === value ? Date.parse(value) : NaN;
const bytes = value => Buffer.byteLength(canonicalJson(value));
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const failure = result => ({ verified: false, result, proof: null, sources: [], diagnostics: {} });
const FAILURE = Symbol('coverage-internal-failure');
const errorFor = result => Object.assign(new Error(result), { result, [FAILURE]: true });
const reject = result => { throw errorFor(result); };
const errorResult = (error, fallback) => error?.[FAILURE] === true ? error.result : fallback;
export const runtimeCoverageHealthReady = health => Boolean(health && HEALTH_KEYS.every(key => health[key] === true)
  && health.approvalMode === 'approval');
const fixedHealth = health => Object.fromEntries([...HEALTH_KEYS.map(key => [key, health?.[key] === true]),
  ['approvalMode', health?.approvalMode === 'approval' ? 'approval' : 'unverified']]);

function digest(secret, purpose, value) {
  const key = createHmac('sha256', secret).update('pbk.runtime-coverage.signing-key.v1').digest();
  return createHmac('sha256', key).update(`${SCHEMA}\n${purpose}\n${canonicalJson(value)}`).digest('hex');
}
const policyHash = secret => digest(secret, 'policy', P);
const sign = (secret, report) => {
  const { signature: _ignored, ...unsigned } = report;
  return digest(secret, report.kind === 'control' ? 'control-signature' : 'checkpoint-signature', unsigned);
};
const seal = (secret, report) => ({ ...report, signature: sign(secret, report) });
const checkpointId = (secret, report) => `runtime-coverage-${digest(secret, 'checkpoint-id',
  [report.bootRef, report.generation, report.sequence, report.fenceRef])}`;
const configValid = ({ pool, secret, revision }) => pool?.connect && typeof secret === 'string'
  && secret.length > 0 && validRevision(revision);

// One poisoned fence owns acquisition, both admissions, every continuation, COMMIT and readback.
async function operation({ pool, signal, now = Date.now, secret, revision, protocol }, action) {
  const controller = new AbortController();
  const monotonicStart = performance.now(), wallStart = clock(now);
  const deadlineAt = monotonicStart + P.operationMs;
  let raw, client, released = false, poisoned = false, lastWall = wallStart;
  let loadedRows = 0, loadedBytes = 0;
  const release = destroy => {
    if (!released && raw) { released = true; try { raw.release?.(destroy); } catch { /* Monitoring only. */ } }
  };
  const abort = () => { poisoned = true; release(true); if (!controller.signal.aborted) controller.abort(); };
  const externalAbort = () => abort();
  signal?.addEventListener('abort', externalAbort, { once: true });
  const check = () => {
    if (poisoned || signal?.aborted || controller.signal.aborted || performance.now() >= deadlineAt) {
      abort(); reject('coverage_operation_abandoned');
    }
    const wall = clock(now), elapsed = performance.now() - monotonicStart;
    if (!validClock(wall) || !validClock(wallStart) || wall < lastWall || wall - wallStart > elapsed + 1000) {
      abort(); reject('coverage_clock_invalid');
    }
    lastWall = wall;
  };
  const run = async (fn, limit, onLate) => {
    check();
    const runDeadlineAt = Math.min(deadlineAt, performance.now() + Math.max(1, Math.floor(limit)));
    let timer, abandoned = false, abortListener;
    const work = Promise.resolve().then(() => { check(); return fn(); });
    work.then(value => { if (abandoned) onLate?.(value); }, () => {}).catch(() => {});
    try {
      const result = await Promise.race([work, new Promise((_, fail) => {
        abortListener = () => { abandoned = true; fail(errorFor('coverage_operation_abandoned')); };
        controller.signal.addEventListener('abort', abortListener, { once: true });
        timer = setTimeout(() => { abandoned = true; abort(); }, Math.max(1, Math.floor(limit)));
      })]);
      try {
        check();
        // Reject late results even when synchronous work delayed the timer callback.
        if (performance.now() >= runDeadlineAt) { abort(); reject('coverage_operation_abandoned'); }
      } catch (error) { abandoned = true; onLate?.(result); throw error; }
      return result;
    } catch (error) {
      if (performance.now() >= runDeadlineAt) {
        abandoned = true; abort(); reject('coverage_operation_abandoned');
      }
      throw error;
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abortListener); }
  };
  const consume = ({ rows = 0, bytes: byteCount = 0 } = {}) => {
    check();
    if (!Number.isSafeInteger(rows) || rows < 0 || !Number.isSafeInteger(byteCount) || byteCount < 0
      || loadedRows + rows > 10000 || loadedBytes + byteCount > P.maxBytes) {
      abort(); reject('coverage_operation_budget_exceeded');
    }
    loadedRows += rows; loadedBytes += byteCount;
  };
  try {
    raw = await run(() => pool.connect(), deadlineAt - performance.now(), late => {
      raw = late; release(true);
    });
    check();
    client = { async query(config) {
      check();
      const result = await raw.query(config);
      check();
      if (protocol === 'paged-v2' && Array.isArray(result.rows)) {
        consume({ rows: result.rows.length, bytes: Buffer.byteLength(JSON.stringify(result.rows)) });
      }
      return result;
    }, release };
    const query = (text, values = []) => {
      check();
      const limit = Math.max(1, Math.floor(Math.min(P.queryMs, deadlineAt - performance.now())));
      return run(() => client.query({ text, values, query_timeout: limit }), limit);
    };
    const fence = { deadlineAt, signal: controller.signal, onAbort: abort, consume,
      remainingBudget: () => { check(); return { rows: 10000 - loadedRows, bytes: P.maxBytes - loadedBytes }; } };
    return await action({ client, query, check, fence, abort, now, secret, revision, protocol });
  } finally {
    signal?.removeEventListener('abort', externalAbort);
    release(poisoned);
  }
}

async function transaction(op, action) {
  await op.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await op.query(`SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),
      set_config('idle_in_transaction_session_timeout',$1,true)`,
    [`${Math.max(1, Math.floor(Math.min(P.queryMs, op.fence.deadlineAt - performance.now())))}ms`]);
    const locked = await op.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [CONTROL_SOURCE]);
    if (locked.rows?.[0]?.acquired !== true) reject('coverage_lease_busy');
    const result = await action();
    op.check();
    await op.query('COMMIT');
    return result;
  } catch (error) {
    try { op.check(); await op.query('ROLLBACK'); } catch { op.abort(); }
    throw error;
  }
}

function verifyRow(row, secret, kind) {
  const r = row?.report;
  if (!r || bytes(r) > P.maxReportBytes || r.kind !== kind || r.schemaVersion !== SCHEMA || r.tenantId !== 'pbk'
    || ![INSTRUMENTATION, PAGED_INSTRUMENTATION].includes(r.instrumentation)
    || r.policyHash !== policyHash(secret) || !hex(r.signature)
    || !validRevision(r.revision) || !hex(r.bootRef) || !hex(r.segmentRef) || !hex(r.fenceRef)
    || !Number.isSafeInteger(r.generation) || r.generation < 1 || !Number.isSafeInteger(r.sequence) || r.sequence < 1
    || !Number.isFinite(time(r.cutoff)) || !Number.isFinite(time(r.dbObservedAt))
    || row.tenant_id !== 'pbk' || row.ok !== false || row.total !== 0 || row.passed !== 0 || row.failed !== 0
    || row.suite_name !== (kind === 'control' ? CONTROL_SUITE : SUITE)
    || row.source !== (kind === 'control' ? CONTROL_SOURCE : SOURCE)
    || row.id !== (kind === 'control' ? CONTROL_ID : checkpointId(secret, r))
    || new Date(row.created_at).getTime() !== time(r.cutoff)
    || !timingSafeEqual(Buffer.from(r.signature, 'hex'), Buffer.from(sign(secret, r), 'hex'))) {
    reject('coverage_record_unverified');
  }
  if (kind === 'control') {
    if (!['pending', 'complete'].includes(r.phase) || !Number.isFinite(time(r.expiresAt))
      || time(r.expiresAt) - time(r.dbObservedAt) !== P.leaseMs
      || r.headSignature !== null && !hex(r.headSignature)) reject('coverage_control_unverified');
  } else if (r.instrumentation === PAGED_INSTRUMENTATION && r.source?.inventory?.protocol !== 'paged-v2'
    || !Number.isFinite(time(r.intervalStart)) || time(r.intervalStart) > time(r.cutoff)
    || time(r.cutoff) - time(r.intervalStart) > P.maxGapMs || r.previous !== null && !hex(r.previous)
    || !runtimeCoverageHealthReady(r.health) || !hex(r.source?.intervalRoot)
    || !Number.isFinite(time(r.serverObservedAt)) || time(r.serverObservedAt) < time(r.cutoff)
    || time(r.serverObservedAt) - time(r.cutoff) > P.operationMs
    || !Number.isFinite(time(r.completedAt)) || time(r.completedAt) < time(r.cutoff)
    || time(r.completedAt) - time(r.cutoff) > P.operationMs
    || !Number.isFinite(r.monotonicAt) || !hex(r.source?.coverage?.segmentRef)) reject('coverage_checkpoint_unverified');
  return r;
}
const rowById = async (op, id) => (await op.query(`${SELECT} WHERE id=$1`, [id])).rows?.[0];
async function loadControl(op, secret) {
  const rows = (await op.query(`${SELECT} WHERE tenant_id='pbk' AND (suite_name=$1 OR source=$2 OR id=$3) LIMIT 2`,
    [CONTROL_SUITE, CONTROL_SOURCE, CONTROL_ID])).rows;
  if (!Array.isArray(rows) || rows.length > 1) reject('coverage_control_unverified');
  return rows.length ? verifyRow(rows[0], secret, 'control') : null;
}
async function save(op, report, secret) {
  if (bytes(report) > P.maxReportBytes) reject('coverage_record_oversized');
  const control = report.kind === 'control', id = control ? CONTROL_ID : checkpointId(secret, report);
  const result = await op.query(`INSERT INTO public.pbk_eval_runs /* coverage-${control ? 'control' : 'checkpoint'} */
    (id,tenant_id,suite_name,ok,total,passed,failed,report,source,created_at)
    VALUES ($1,'pbk',$2,false,0,0,0,$3::jsonb,$4,$5::timestamptz)
    ${control ? `ON CONFLICT (id) DO UPDATE SET report=EXCLUDED.report,created_at=EXCLUDED.created_at
      WHERE pbk_eval_runs.tenant_id='pbk' AND pbk_eval_runs.suite_name=$2 AND pbk_eval_runs.source=$4` : ''}`,
  [id, control ? CONTROL_SUITE : SUITE, JSON.stringify(report), control ? CONTROL_SOURCE : SOURCE, report.cutoff]);
  if (result.rowCount !== 1) reject('coverage_write_unverified');
  if (!equal(verifyRow(await rowById(op, id), secret, report.kind), report)) reject('coverage_readback_unverified');
  return id;
}
async function databaseTime(op, now) {
  const db = new Date((await op.query('SELECT clock_timestamp() AS coverage_now')).rows?.[0]?.coverage_now).getTime();
  const wall = clock(now);
  if (!validClock(db) || !validClock(wall) || Math.abs(db - wall) > 1000) reject('coverage_clock_invalid');
  return db;
}

// Derived window/historical flags and changing whole-inventory hashes are deliberately excluded.
function observationEvents(snapshot) {
  return snapshot.sources.flatMap(source => [...source.rows, ...source.history].map(row => {
    const { sourceKind, recordRef, sourceBinding, presence, classification, origin, receiptKind,
      outcome, clockValid, observedAt, sequence, revision } = row;
    return { sourceKind, recordRef, sourceBinding, presence, classification, origin, receiptKind,
      outcome, clockValid, observedAt, sequence, revision };
  })).sort((a, b) => time(a.observedAt) - time(b.observedAt)
    || a.sourceKind.localeCompare(b.sourceKind) || a.recordRef.localeCompare(b.recordRef) || a.sequence - b.sequence);
}
async function intervalRoots(secret, snapshot, reports, check = () => {}, op) {
  if (op?.protocol === 'paged-v2') {
    const roots = await readPagedCensusIntervalRoots({ client: op.client, secret, revision: op.revision,
      now: op.now, fence: op.fence, reports, snapshot });
    check();
    if (!Array.isArray(roots) || roots.length !== reports.length || !roots.every(hex)) reject('coverage_source_binding_unverified');
    return roots;
  }
  const events = observationEvents(snapshot), roots = [];
  let cursor = 0;
  for (const r of reports) {
    check();
    const start = time(r.intervalStart), end = time(r.cutoff), group = [];
    while (cursor < events.length && time(events[cursor].observedAt) < start) cursor++;
    let i = cursor;
    while (i < events.length && time(events[i].observedAt) <= end) { group.push(events[i]); i++; }
    // Include the shared boundary in both adjacent intervals, with stable ordering.
    roots.push(digest(secret, 'interval-observations', { start: r.intervalStart, end: r.cutoff, events: group }));
  }
  return roots;
}
function sourceSummary(snapshot, intervalRoot) {
  const { segmentRef, forwardOnlyFrom, gapFloor, gapFingerprint, intersectingGaps, continuous } = snapshot.coverage;
  return { schemaVersion: snapshot.schemaVersion, fingerprint: snapshot.fingerprint, inventory: snapshot.inventory,
    historyCompleteFrom: snapshot.historyCompleteFrom,
    coverage: { segmentRef, forwardOnlyFrom, gapFloor, gapFingerprint, intersectingGaps, continuous }, intervalRoot,
    sources: snapshot.sources.map(({ sourceKind, counts, fingerprint }) => ({ sourceKind, counts, fingerprint })) };
}
async function snapshot(op, input, start, end, admission) {
  const collect = op.protocol === 'paged-v2' ? collectPagedCensusSnapshotInTransaction : collectRuntimeSourceSnapshotInTransaction;
  const result = await collect({ client: op.client, secret: input.secret,
    revision: input.revision, now: input.now, windowStart: start, windowEnd: end, fence: op.fence, admission });
  op.check();
  if (!result.verified || result.transactionPending !== true || result.invalidReceipts !== 0) {
    reject('coverage_source_unverified');
  }
  return result;
}
async function prepare(op, input) {
  const admit = op.protocol === 'paged-v2' ? preparePagedCensusObservation : prepareRuntimeSourceObservation;
  const result = await admit({ client: op.client, secret: input.secret,
    revision: input.revision, now: input.now, fence: op.fence });
  op.check();
  if (!result.verified || result.transactionPending !== false) {
    reject(op.protocol === 'paged-v2' && result.progressRecorded === true
      ? 'coverage_source_bootstrap_incomplete' : 'coverage_source_admission_unverified');
  }
  return result.admission;
}
async function inventoryReadback(op, observed, expected) {
  if (op.protocol === 'paged-v2') {
    const result = await readPagedCensusInventory({ client: op.client, secret: op.secret, revision: op.revision,
      now: op.now, fence: op.fence, inventory: observed.inventory, independent: expected !== undefined });
    op.check();
    if (!result?.verified || expected && !equal(result, expected)) reject('coverage_source_readback_unverified');
    return result;
  }
  const rows = (await op.query(`${SELECT} WHERE tenant_id='pbk' AND suite_name=$1
    AND report->>'ledgerKind'='inventory' LIMIT 2`, ['runtime_source_evidence_v1'])).rows;
  if (rows?.length !== 1 || rows[0].report.admission !== null
    || rows[0].report.generation !== observed.inventory.generation
    || rows[0].report.fingerprint !== observed.inventory.fingerprint
    || expected && !equal(rows[0], expected)) reject('coverage_source_readback_unverified');
  return rows[0];
}

// Internal sampler seam only: no caller SQL, provenance labels, source snapshots or business writes.
export async function appendRuntimeCoverageCheckpoint(input = {}) {
  const protocol = censusProtocol(input);
  if (!validProtocol(protocol)) return failure('coverage_protocol_unavailable');
  input = { ...input, protocol };
  if (!configValid(input)) return failure('coverage_runtime_unavailable');
  if (input.pool.controlled || ['controlled', 'diagnostic'].includes(getRuntimeEvidenceContext().classification)) {
    return failure('coverage_controlled_execution');
  }
  const { secret, revision, previous, bootId, monotonicNow = () => performance.now(), health, now = Date.now } = input;
  const started = clock(now);
  if (!validClock(started) || input.cutoff !== undefined && (!validClock(input.cutoff)
      || input.cutoff > started || started - input.cutoff > P.operationMs || !previous)
    || typeof bootId !== 'string' || !bootId.length || bootId.length > 256 || typeof monotonicNow !== 'function') {
    return failure('coverage_clock_invalid');
  }
  const bootRef = digest(secret, 'boot', bootId);
  try {
    return await operation(input, async op => {
      let pending, continuing;
      await transaction(op, async () => {
        const db = await databaseTime(op, now), old = await loadControl(op, secret);
        if (old && time(old.cutoff) > started) reject('coverage_clock_invalid');
        const active = old && db < time(old.expiresAt);
        if (active && (old.bootRef !== bootRef || old.revision !== revision
          || old.instrumentation !== instrumentation(protocol))) reject('coverage_lease_busy');
        continuing = Boolean(active && old.phase === 'complete' && previous
          && previous.signature === old.headSignature && previous.sequence === old.sequence
          && previous.bootRef === bootRef && previous.revision === revision && previous.generation === old.generation
          && previous.instrumentation === instrumentation(protocol));
        const generation = old ? old.generation + Number(!active) : 1;
        pending = seal(secret, { schemaVersion: SCHEMA, kind: 'control', tenantId: 'pbk', revision,
          instrumentation: instrumentation(protocol), policyHash: policyHash(secret), bootRef, generation,
          sequence: active ? old.sequence + 1 : 1, fenceRef: digest(secret, 'fence', randomUUID()),
          segmentRef: continuing ? previous.segmentRef : digest(secret, 'segment', randomUUID()),
          phase: 'pending', cutoff: iso(started), dbObservedAt: iso(db), expiresAt: iso(db + P.leaseMs),
          headId: old?.headId ?? null, headSignature: old?.headSignature ?? null });
        await save(op, pending, secret);
      });
      if (!equal(await loadControl(op, secret), pending)) reject('coverage_readback_unverified');
      if (!runtimeCoverageHealthReady(health)) reject('coverage_health_unready');
      const admission = await prepare(op, { ...input, now });
      let report, finalControl, inventory;
      await transaction(op, async () => {
        const current = await loadControl(op, secret), db = await databaseTime(op, now);
        if (!equal(current, pending) || db >= time(current.expiresAt)) reject('coverage_lease_lost');
        // The default boundary is captured only after admission has established source forward time.
        const serverObservedAt = clock(now), cutoff = input.cutoff ?? serverObservedAt, monotonicAt = monotonicNow();
        if (!validClock(cutoff) || !Number.isFinite(monotonicAt) || cutoff < started && input.cutoff === undefined) {
          reject('coverage_clock_invalid');
        }
        if (continuing) {
          const delta = cutoff - time(previous.cutoff), observedDelta = serverObservedAt - time(previous.serverObservedAt);
          const lag = serverObservedAt - cutoff;
          if (delta <= 0 || observedDelta <= 0 || lag < 0 || lag > P.operationMs
            || Math.abs(observedDelta - (monotonicAt - previous.monotonicAt)) > 1000
            || Math.abs(observedDelta - (db - time(previous.dbObservedAt))) > 1000) reject('coverage_clock_invalid');
          if (delta > P.maxGapMs || observedDelta > P.maxGapMs) continuing = false;
        }
        if (!continuing && input.cutoff !== undefined) reject('coverage_pending_interval_missing');
        if (!continuing) pending = { ...pending, segmentRef: digest(secret, 'segment', randomUUID()) };
        let start = continuing ? time(previous.cutoff) : cutoff;
        const observed = await snapshot(op, { ...input, now }, start, cutoff, admission);
        if (continuing && (observed.coverage.segmentRef !== previous.source.coverage.segmentRef
          || time(observed.coverage.forwardOnlyFrom) > start)) {
          if (input.cutoff !== undefined) reject('coverage_pending_interval_missing');
          continuing = false; start = cutoff;
          pending = { ...pending, segmentRef: digest(secret, 'segment', randomUUID()) };
        }
        if (time(observed.coverage.forwardOnlyFrom) > cutoff) reject('coverage_source_forward_only');
        const root = (await intervalRoots(secret, observed, [{ intervalStart: iso(start), cutoff: iso(cutoff) }], op.check, op))[0];
        const completed = clock(now);
        if (!validClock(completed) || completed < cutoff || completed - cutoff > P.operationMs) reject('coverage_clock_invalid');
        report = seal(secret, { schemaVersion: SCHEMA, kind: 'checkpoint', tenantId: 'pbk', revision,
          instrumentation: instrumentation(protocol), policyHash: policyHash(secret), bootRef,
          generation: pending.generation, sequence: pending.sequence, fenceRef: pending.fenceRef,
          segmentRef: pending.segmentRef, intervalStart: iso(start), cutoff: iso(cutoff),
          completedAt: iso(completed), serverObservedAt: iso(serverObservedAt), dbObservedAt: iso(db), monotonicAt,
          previous: continuing ? previous.signature : null, health: fixedHealth(health), source: sourceSummary(observed, root) });
        const id = await save(op, report, secret);
        finalControl = seal(secret, { ...pending, cutoff: report.cutoff, phase: 'complete', headId: id, headSignature: report.signature });
        await save(op, finalControl, secret);
        inventory = await inventoryReadback(op, observed);
        const finalDb = await databaseTime(op, now);
        if (finalDb >= time(pending.expiresAt)) reject('coverage_lease_lost');
      });
      const durable = verifyRow(await rowById(op, finalControl.headId), secret, 'checkpoint');
      if (!equal(durable, report) || !equal(await loadControl(op, secret), finalControl)) reject('coverage_readback_unverified');
      await inventoryReadback(op, { inventory: report.source.inventory }, inventory);
      op.check();
      return { verified: true, result: 'coverage_checkpoint_recorded', report };
    });
  } catch (error) { return failure(errorResult(error, 'coverage_observation_failed')); }
}

function coverageReference(secret, proof) {
  const reference = { schemaVersion: REFERENCE_SCHEMA, tenantId: 'pbk', policyHash: proof.policyHash,
    instrumentation: proof.instrumentation, revision: proof.revision, bootRef: proof.bootRef,
    generation: proof.generation, segmentRef: proof.segmentRef, windowStart: proof.windowStart,
    cutoff: proof.cutoff, checkpointCount: proof.checkpointCount, first: proof.first, last: proof.last,
    orderedRoot: proof.orderedRoot, sourceSegmentRef: proof.census.coverage.segmentRef,
    sourceIntervalRoot: proof.census.intervalRoot };
  return { ...reference, signature: digest(secret, 'coverage-reference-signature', reference) };
}

function verifyReference(reference, secret, revision, now, protocol) {
  const r = reference;
  const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const keys = ['schemaVersion', 'tenantId', 'policyHash', 'instrumentation', 'revision', 'bootRef', 'generation',
    'segmentRef', 'windowStart', 'cutoff', 'checkpointCount', 'first', 'last', 'orderedRoot', 'sourceSegmentRef',
    'sourceIntervalRoot', 'signature'];
  const endpoint = value => plain(value) && Object.keys(value).length === 3
    && Object.keys(value).every(key => ['id', 'digest', 'sequence'].includes(key))
    && /^runtime-coverage-[a-f0-9]{64}$/.test(value.id) && hex(value.digest)
    && Number.isSafeInteger(value.sequence) && value.sequence > 0;
  if (!plain(r) || bytes(r) > P.maxReportBytes || Object.keys(r).length !== keys.length
    || !Object.keys(r).every(key => keys.includes(key)) || r.schemaVersion !== REFERENCE_SCHEMA || r.tenantId !== 'pbk'
    || r.policyHash !== policyHash(secret) || r.instrumentation !== instrumentation(protocol) || r.revision !== revision
    || !hex(r.bootRef) || !hex(r.segmentRef) || !hex(r.orderedRoot) || !hex(r.sourceSegmentRef)
    || !hex(r.sourceIntervalRoot) || !hex(r.signature) || !Number.isSafeInteger(r.generation) || r.generation < 1
    || !Number.isSafeInteger(r.checkpointCount) || r.checkpointCount < 2 || r.checkpointCount > P.maxCheckpoints
    || !Number.isFinite(time(r.cutoff)) || !Number.isFinite(time(r.windowStart))
    || time(r.cutoff) - time(r.windowStart) !== P.windowMs || !endpoint(r.first) || !endpoint(r.last)
    || r.last.sequence - r.first.sequence + 1 !== r.checkpointCount) reject('coverage_reference_unverified');
  const { signature, ...unsigned } = r;
  if (!timingSafeEqual(Buffer.from(signature, 'hex'),
    Buffer.from(digest(secret, 'coverage-reference-signature', unsigned), 'hex'))) reject('coverage_reference_unverified');
  if (time(r.cutoff) > now || now - time(r.cutoff) >= P.windowMs) reject('coverage_reference_expired');
  return r;
}

async function coverageRows(op, secret, cutoff, control) {
  // One total bound includes the saved window, its actual left endpoint, AND the current head.
  // No intervening post-cutoff tail or second day of checkpoint reports is loaded.
  const scope = "tenant_id='pbk' AND (suite_name=$1 OR source=$2)";
  const where = `${scope} AND ((created_at > $3::timestamptz AND created_at <= $4::timestamptz)
    OR created_at=(SELECT MAX(created_at) FROM public.pbk_eval_runs WHERE ${scope}
      AND created_at <= $3::timestamptz AND created_at >= $5::timestamptz) OR id=$6)`;
  const values = [SUITE, SOURCE, iso(cutoff - P.windowMs), iso(cutoff),
    iso(cutoff - P.windowMs - P.maxGapMs), control.headId];
  const size = (await op.query(`SELECT COUNT(*) AS count,COALESCE(SUM(octet_length(to_jsonb(p)::text)),0) AS bytes
    FROM (${SELECT} WHERE ${where}) p`, values)).rows?.[0];
  if (!Number.isSafeInteger(Number(size?.count)) || Number(size.count) < 1 || Number(size.count) > P.maxCheckpoints
    || !Number.isSafeInteger(Number(size?.bytes)) || Number(size.bytes) < 0 || Number(size.bytes) > P.maxBytes) {
    reject('coverage_census_unverified');
  }
  const rows = (await op.query(`${SELECT} WHERE ${where} ORDER BY created_at,id LIMIT 2001`, values)).rows;
  if (!Array.isArray(rows) || rows.length !== Number(size.count) || bytes(rows) > P.maxBytes) reject('coverage_census_unverified');
  return rows.map(row => { op.check(); return verifyRow(row, secret, 'checkpoint'); });
}

export async function readRuntimeCoverage(input = {}) {
  return readCoverage(input);
}

// INTERNAL signed-audit seam: only a reference issued by a verified read selects a saved window.
// The caller must first authenticate the latest audit admission; sampling control is NOT audit admission.
export async function verifyRuntimeCoverageReference(input = {}) {
  if (Object.hasOwn(input, 'cutoff')) return failure('coverage_reference_unverified');
  return readCoverage(input, true);
}

async function readCoverage(input, historical = false) {
  const protocol = censusProtocol(input);
  if (!validProtocol(protocol)) return failure('coverage_protocol_unavailable');
  input = { ...input, protocol };
  if (!configValid(input)) return failure('coverage_runtime_unavailable');
  const { secret, revision, now = Date.now } = input;
  try {
    const started = clock(now);
    if (!validClock(started)) reject('coverage_cutoff_unverified');
    const reference = historical ? verifyReference(input.reference, secret, revision, started, protocol) : null;
    const cutoff = reference ? time(reference.cutoff) : input.cutoff ?? started;
    if (!validClock(cutoff) || cutoff > started || !historical && started - cutoff > P.maxGapMs) {
      reject('coverage_cutoff_unverified');
    }
    return await operation(input, async op => {
      // Validate immutable checkpoint references before admitting a new source observation.
      // Ordinary short windows and invalid old proof must not manufacture source-abandonment gaps.
      const control = await loadControl(op, secret);
      const db = await databaseTime(op, now);
      if (!control || control.revision !== revision || control.phase !== 'complete'
        || control.instrumentation !== instrumentation(protocol)
        || time(control.cutoff) > started || started - time(control.cutoff) > P.maxGapMs
        || time(control.cutoff) < cutoff || !historical && time(control.cutoff) !== cutoff
        || db >= time(control.expiresAt)) reject('coverage_latest_unverified');
      if (reference && (control.bootRef !== reference.bootRef || control.generation !== reference.generation
        || control.segmentRef !== reference.segmentRef)) reject('coverage_reference_context_unverified');
      const newer = (await op.query(`SELECT EXISTS(SELECT 1 FROM public.pbk_eval_runs WHERE tenant_id='pbk'
        AND (suite_name=$1 OR source=$2) AND created_at > $3::timestamptz) AS newer`,
      [SUITE, SOURCE, control.cutoff])).rows?.[0]?.newer;
      if (newer !== false) reject('coverage_head_unverified');
      const all = await coverageRows(op, secret, cutoff, control);
      const latest = all.at(-1);
      if (latest.signature !== control.headSignature || checkpointId(secret, latest) !== control.headId
        || latest.sequence !== control.sequence || latest.fenceRef !== control.fenceRef
        || latest.bootRef !== control.bootRef || latest.generation !== control.generation
        || latest.segmentRef !== control.segmentRef || latest.cutoff !== control.cutoff) reject('coverage_head_unverified');
      const chain = all.filter(r => time(r.cutoff) <= cutoff && r.segmentRef === control.segmentRef);
      if (!chain.length || time(chain.at(-1).cutoff) !== cutoff) reject('coverage_chain_unverified');
      for (let i = 0; i < chain.length; i++) {
        op.check();
        const r = chain[i], prior = chain[i - 1];
        if (r.revision !== revision || r.bootRef !== control.bootRef || r.generation !== control.generation
          || r.instrumentation !== control.instrumentation
          || time(r.cutoff) > cutoff || Math.abs(time(r.serverObservedAt) - time(r.dbObservedAt)) > 1000
          || prior && (r.sequence !== prior.sequence + 1 || r.previous !== prior.signature
            || r.intervalStart !== prior.cutoff || time(r.cutoff) <= time(prior.cutoff)
            || time(r.serverObservedAt) <= time(prior.serverObservedAt)
            || time(r.serverObservedAt) - time(prior.serverObservedAt) > P.maxGapMs
            || Math.abs(time(r.serverObservedAt) - time(prior.serverObservedAt) - (r.monotonicAt - prior.monotonicAt)) > 1000
            || Math.abs(time(r.serverObservedAt) - time(prior.serverObservedAt) - (time(r.dbObservedAt) - time(prior.dbObservedAt))) > 1000)) {
          reject('coverage_chain_unverified');
        }
      }
      const windowStart = cutoff - P.windowMs;
      const anchor = chain.findLastIndex(r => time(r.cutoff) <= windowStart);
      if (anchor < 0) reject('coverage_window_incomplete');
      const selected = chain.slice(anchor);
      const last = selected.at(-1);
      const orderedRoot = digest(secret, 'ordered-checkpoint-references', selected.map(r =>
        [checkpointId(secret, r), r.signature]));
      const firstEndpoint = { id: checkpointId(secret, selected[0]), digest: selected[0].signature, sequence: selected[0].sequence };
      const lastEndpoint = { id: checkpointId(secret, last), digest: last.signature, sequence: last.sequence };
      if (reference && (reference.windowStart !== iso(windowStart) || reference.checkpointCount !== selected.length
        || !equal(reference.first, firstEndpoint) || !equal(reference.last, lastEndpoint)
        || reference.orderedRoot !== orderedRoot)) reject('coverage_reference_binding_unverified');
      const admission = await prepare(op, { ...input, now });
      let result, observed, inventory;
      await transaction(op, async () => {
        if (!equal(await loadControl(op, secret), control)
          || await databaseTime(op, now) >= time(control.expiresAt)) reject('coverage_lease_lost');
        observed = await snapshot(op, { ...input, now }, windowStart, cutoff, admission);
        if (!observed.coverage.continuous || time(observed.coverage.forwardOnlyFrom) > windowStart
          || reference && observed.coverage.segmentRef !== reference.sourceSegmentRef
          || observed.historyCompleteFrom !== null
            && time(observed.historyCompleteFrom) > time(selected[0].intervalStart)) {
          reject('coverage_source_history_unverified');
        }
        const roots = await intervalRoots(secret, observed, selected, op.check, op);
        if (selected.some((r, i) => r.source.intervalRoot !== roots[i]
          || r.source.coverage.segmentRef !== observed.coverage.segmentRef
          || r.source.historyCompleteFrom !== null && time(r.source.historyCompleteFrom) > time(r.intervalStart))) {
          reject('coverage_source_binding_unverified');
        }
        const sources = observed.sources.map(({ sourceKind, counts, fingerprint, eligible }) =>
          ({ sourceKind, counts, fingerprint, provenanceEligible: eligible }));
        const organicCompletions = sources.reduce((sum, s) => sum + s.counts.eligible, 0);
        const sourceIntervalRoot = digest(secret, 'audit-source-intervals', roots);
        if (reference && reference.sourceIntervalRoot !== sourceIntervalRoot) reject('coverage_reference_binding_unverified');
        result = { verified: true, result: 'coverage_verified', proof: {
          schemaVersion: SCHEMA, policy: P, policyHash: policyHash(secret), instrumentation: instrumentation(protocol),
          revision, bootRef: control.bootRef, generation: control.generation, segmentRef: control.segmentRef,
          windowStart: iso(windowStart), cutoff: iso(cutoff), checkpointCount: selected.length,
          first: firstEndpoint, last: lastEndpoint, orderedRoot,
          census: sourceSummary(observed, sourceIntervalRoot),
        }, sources, diagnostics: { quiet: sources.every(s => s.counts.inWindow === 0), organicCompletions,
          sourceProvenanceVerified: sources.every(s => s.provenanceEligible), fleetQualified: false } };
        result.proof.reference = coverageReference(secret, result.proof);
        if (reference && !equal(result.proof.reference, reference)) reject('coverage_reference_binding_unverified');
        inventory = await inventoryReadback(op, observed);
      });
      if (!equal(await loadControl(op, secret), control)) reject('coverage_readback_unverified');
      await inventoryReadback(op, observed, inventory);
      op.check();
      return result;
    });
  } catch (error) { return failure(errorResult(error, 'coverage_read_failed')); }
}
