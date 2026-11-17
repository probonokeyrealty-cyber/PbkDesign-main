import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import { getRuntimeEvidenceContext } from './runtime-evidence-context.mjs';

const SCHEMA = 'pbk-runtime-source-evidence-v1';
const SUITE = 'runtime_source_evidence_v1';
const SOURCE = 'server:runtime-source-evidence:v1';
const MAX_ROWS = 10000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_REPORT = 8192;
const DEADLINE_MS = 30000;
const WINDOW_MS = 86400000;
const HISTORY_REACH_MS = 2 * WINDOW_MS;
const FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
const stamp = column => `to_char(${column} AT TIME ZONE 'UTC', '${FORMAT}') AS ${column}`;

// Fixed audited projections, not caller SQL or caller provenance. Private fields are only HMAC input.
const sources = Object.freeze({
  runtime_archive: { table: 'activity_log', scope: "workspace_id = 'pbk' AND source LIKE 'runtime-event:%'",
    fields: `id, workspace_id, source, status, category, text, metadata, ${stamp('created_at')}, ${stamp('updated_at')}` },
  conversation_projection: { table: 'conversation_events', scope: "workspace_id = 'pbk'",
    fields: `id, workspace_id, source_table, source_id, event_type, channel, direction, status, body, payload,
      ${stamp('created_at')}, ${stamp('updated_at')}, ${stamp('occurred_at')}` },
  qa: { table: 'pbk_qa_audit', scope: "tenant_id = 'pbk'",
    fields: `id, tenant_id, tool_name, passed, skipped, reason, validator, retry_count, params, result, qa,
      source, ${stamp('created_at')}` },
  safety: { table: 'pbk_safety_audit', scope: "tenant_id = 'pbk'",
    fields: `id, tenant_id, tool_name, blocked, approval_required, params, validation, source, ${stamp('created_at')}` },
});
const kinds = Object.keys(sources);
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype);
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const validSecret = value => typeof value === 'string' && value.length > 0;
const validClock = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = n => new Date(n).toISOString();
const bytes = value => Buffer.byteLength(canonicalJson(value));
const clock = now => typeof now === 'function' ? now() : now;
const time = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;

function opaque(secret, domain, value) {
  const key = createHmac('sha256', secret).update('pbk.runtime-source-evidence.signing-key.v1').digest();
  return createHmac('sha256', key).update(`${SCHEMA}\n${domain}\n${canonicalJson(value)}`).digest('hex');
}
const receiptId = (secret, sourceKind, recordRef) =>
  `runtime-source-${opaque(secret, 'receipt-id', { sourceKind, recordRef })}`;
const signature = (report, secret) => {
  const { signature: _ignored, ...unsigned } = report;
  return opaque(secret, 'receipt-signature', unsigned);
};
const gap = result => ({ ok: false, verified: false, readbackVerified: false, eligible: false, result });
const timeout = () => Object.assign(new Error('Source observation deadline'), { code: 'SOURCE_TIMEOUT' });
const releaseClient = (client, destroy) => { try { client?.release?.(destroy); } catch { /* Monitoring stays non-throwing. */ } };
const admissionHandles = new WeakMap();
const runtimeGaps = new Map();
const namespaceRef = secret => opaque(secret, 'observation-runtime', 'pbk');
const busy = () => Object.assign(new Error('Source observation owner active'), { code: 'SOURCE_BUSY' });
const stale = () => Object.assign(new Error('Source observation owner stale'), { code: 'SOURCE_STALE' });
function rememberRuntimeGap(secret, now) {
  if (!validSecret(secret) || !validClock(now)) return;
  const key = namespaceRef(secret), previous = runtimeGaps.get(key);
  if (previous || runtimeGaps.size < MAX_ROWS) {
    runtimeGaps.set(key, { startedAt: Math.min(previous?.startedAt ?? now, now) });
  }
}
function forgetRuntimeGap(secret, debt) {
  if (debt && runtimeGaps.get(namespaceRef(secret)) === debt) runtimeGaps.delete(namespaceRef(secret));
}

function deadline() {
  const started = performance.now();
  let expired = false;
  const remaining = () => DEADLINE_MS - (performance.now() - started);
  const check = () => { if (expired || remaining() <= 0) { expired = true; throw timeout(); } };
  return { remaining, check, async run(action, { onTimeout, onLate } = {}) {
    check();
    let timer, abandoned = false;
    const operation = Promise.resolve().then(() => { check(); return action(); });
    operation.then(value => { if (abandoned) onLate?.(value); }, () => {}).catch(() => {});
    try {
      const value = await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => {
          abandoned = true; expired = true; onTimeout?.(); reject(timeout());
        }, Math.max(1, Math.ceil(remaining())));
      })]);
      try { check(); }
      catch (error) { abandoned = true; onTimeout?.(); onLate?.(value); throw error; }
      return value;
    } finally { clearTimeout(timer); }
  } };
}

async function transaction(client, budget, action, destroy) {
  const query = (text, values = []) => budget.run(() => client.query({ text, values,
    query_timeout: Math.max(1, Math.ceil(budget.remaining())) }), { onTimeout: destroy });
  await query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await query(`SELECT set_config('statement_timeout',$1,true), set_config('lock_timeout',$1,true),
      set_config('idle_in_transaction_session_timeout',$1,true)`, [`${Math.max(1, Math.floor(budget.remaining()))}ms`]);
    const lock = await query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [SOURCE]);
    if (lock.rows?.[0]?.acquired !== true) throw busy();
    const value = await action(query);
    budget.check();
    await query('COMMIT');
    return value;
  } catch (error) {
    // An abandoned query must never have a rollback or commit queued behind it.
    if (error.code === 'SOURCE_TIMEOUT') destroy?.();
    else await query('ROLLBACK').catch(() => destroy?.());
    throw error;
  }
}

function sourceClockValid(row, kind, observed) {
  const required = ['created_at', ...(['runtime_archive', 'conversation_projection'].includes(kind) ? ['updated_at'] : []),
    ...(kind === 'conversation_projection' ? ['occurred_at'] : [])];
  const max = iso(observed).replace(/Z$/, '000Z');
  for (const key of required) {
    if (!Number.isFinite(time(row[key])) || row[key] > max) return false;
  }
  return !row.updated_at || row.created_at <= row.updated_at;
}

function outcomeOf(row, kind) {
  if (kind === 'runtime_archive') return ({ success: 'success', warning: 'warning', error: 'failed',
    failed: 'failed', cancelled: 'cancelled' })[row.status] || 'unknown';
  if (kind === 'qa') return typeof row.passed !== 'boolean' || typeof row.skipped !== 'boolean' ? 'unknown'
    : row.skipped ? 'skipped' : row.passed ? 'success' : 'failed';
  if (kind === 'safety') return typeof row.blocked !== 'boolean' || typeof row.approval_required !== 'boolean'
    ? 'unknown' : row.blocked ? 'blocked' : 'allowed';
  return ({ completed: 'success', delivered: 'success', sent: 'success', received: 'success',
    failed: 'failed', error: 'failed', cancelled: 'cancelled', pending: 'pending',
    queued: 'pending', approved: 'pending', rejected: 'blocked' })[row.status] || 'unknown';
}

function binding(row, kind, secret) {
  if (!plain(row) || typeof row.id !== 'string' || !row.id.length || row.id.length > 512
    || (row.workspace_id ?? row.tenant_id) !== 'pbk') throw new Error('Source row invalid');
  return { recordRef: opaque(secret, 'record-reference', { tenantId: 'pbk', sourceKind: kind, id: row.id }),
    sourceBinding: opaque(secret, 'source-binding', { tenantId: 'pbk', sourceKind: kind, row }) };
}

function makeReport({ revision, sourceKind, recordRef, sourceBinding, presence = 'present',
  context, outcome, clockValid, observedAt, sequence = 1, history = [], historyFloor = null, secret }) {
  const report = { schemaVersion: SCHEMA, tenantId: 'pbk', revision, sourceKind, recordRef, sourceBinding,
    presence, receiptKind: context.classification === 'unknown' ? 'observed_unknown' : 'source_write',
    origin: context.origin, classification: context.classification, outcome, clockValid, observedAt: iso(observedAt),
    sequence, history, historyFloor };
  report.signature = signature(report, secret);
  if (bytes(report) > MAX_REPORT) throw new Error('Source receipt oversized');
  return report;
}

function eventOf(report) {
  const { revision, sourceBinding, presence, receiptKind, origin, classification,
    outcome, clockValid, observedAt, sequence } = report;
  return { revision, sourceBinding, presence, receiptKind, origin, classification,
    outcome, clockValid, observedAt, sequence };
}

function advanceReport(prior, input) {
  if (!prior) return makeReport(input);
  const cutoff = input.observedAt - HISTORY_REACH_MS;
  const all = [...prior.history, eventOf(prior)];
  const history = all.filter(event => time(event.observedAt) >= cutoff);
  return makeReport({ ...input, sequence: prior.sequence + 1, history,
    historyFloor: history.length < all.length ? iso(cutoff) : prior.historyFloor });
}

function compactReport(report, now, secret) {
  const cutoff = now - HISTORY_REACH_MS;
  const history = report.history.filter(event => time(event.observedAt) >= cutoff);
  return history.length === report.history.length ? report : makeReport({ ...report,
    context: { origin: report.origin, classification: report.classification },
    observedAt: time(report.observedAt), history, historyFloor: iso(cutoff), secret });
}

function validEvent(event, now) {
  const originClass = { operator_chat: 'operational', phone_turn: 'operational', registered_business: 'operational',
    runtime_circuit: 'operational', diagnostic: 'diagnostic', controlled: 'controlled', unknown: 'unknown' };
  return plain(event) && validRevision(event.revision) && hex(event.sourceBinding)
    && ['present', 'deleted'].includes(event.presence) && typeof event.clockValid === 'boolean'
    && Number.isSafeInteger(event.sequence) && event.sequence > 0
    && Number.isFinite(time(event.observedAt)) && iso(time(event.observedAt)) === event.observedAt
    && time(event.observedAt) <= now && originClass[event.origin] === event.classification
    && typeof event.classification === 'string'
    && event.receiptKind === (event.classification === 'unknown' ? 'observed_unknown' : 'source_write')
    && (event.presence !== 'deleted' || event.classification === 'unknown' && event.outcome === 'deleted')
    && ['success', 'warning', 'failed', 'cancelled', 'skipped', 'blocked', 'allowed', 'pending', 'unknown', 'deleted'].includes(event.outcome);
}

function verifyReceipt(row, { secret, revision, now }) {
  const r = row?.report;
  if (!plain(r) || bytes(r) > MAX_REPORT || r.schemaVersion !== SCHEMA || r.tenantId !== 'pbk'
    || r.revision !== revision || !kinds.includes(r.sourceKind) || !hex(r.recordRef) || !hex(r.sourceBinding)
    || !['present', 'deleted'].includes(r.presence) || typeof r.clockValid !== 'boolean'
    || !Number.isFinite(time(r.observedAt)) || iso(time(r.observedAt)) !== r.observedAt || time(r.observedAt) > now
    || !hex(r.signature) || row.tenant_id !== 'pbk' || row.suite_name !== SUITE || row.source !== SOURCE
    || row.ok !== false || row.total !== 0 || row.passed !== 0 || row.failed !== 0
    || row.id !== receiptId(secret, r.sourceKind, r.recordRef)) return null;
  const stored = row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(row.created_at);
  if (stored !== time(r.observedAt)) return null;
  if (!validEvent(r, now) || !Array.isArray(r.history) || r.history.length >= MAX_ROWS
    || r.historyFloor !== null && (!Number.isFinite(time(r.historyFloor))
      || iso(time(r.historyFloor)) !== r.historyFloor || time(r.historyFloor) > now)) return null;
  const events = [...r.history, eventOf(r)];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!validEvent(event, now) || i < events.length - 1 && canonicalJson(event) !== canonicalJson(eventOf(event))
      || i > 0 && (event.sequence !== events[i - 1].sequence + 1
        || time(event.observedAt) < time(events[i - 1].observedAt))) return null;
  }
  if (events[0].sequence !== 1 && r.historyFloor === null) return null;
  const expected = makeReport({ ...r, context: { origin: r.origin, classification: r.classification },
    observedAt: time(r.observedAt), secret });
  return canonicalJson(expected) === canonicalJson(r)
    && timingSafeEqual(Buffer.from(r.signature, 'hex'), Buffer.from(signature(r, secret), 'hex')) ? r : null;
}

const receiptSelect = `SELECT id, tenant_id, suite_name, ok, total, passed, failed, report, source, created_at
  FROM public.pbk_eval_runs`;
async function save(query, report, secret, now) {
  const id = receiptId(secret, report.sourceKind, report.recordRef);
  const result = await query(`INSERT INTO public.pbk_eval_runs
    (id,tenant_id,suite_name,ok,total,passed,failed,report,source,created_at)
    VALUES ($1,'pbk',$2,false,0,0,0,$3::jsonb,$4,$5::timestamptz)
    ON CONFLICT (id) DO UPDATE SET report=EXCLUDED.report, created_at=EXCLUDED.created_at
    WHERE pbk_eval_runs.tenant_id='pbk' AND pbk_eval_runs.suite_name=$2 AND pbk_eval_runs.source=$4`,
  [id, SUITE, JSON.stringify(report), SOURCE, report.observedAt]);
  if (result.rowCount !== 1 && result.affectedRows !== 1) throw new Error('Source evidence not saved');
  const row = (await query(`${receiptSelect} WHERE id=$1`, [id])).rows?.[0];
  const verified = verifyReceipt(row, { secret, revision: report.revision, now });
  if (!verified || canonicalJson(verified) !== canonicalJson(report)) throw new Error('Source evidence readback failed');
}

const inventoryId = secret => `runtime-source-inventory-${opaque(secret, 'inventory-id', 'pbk')}`;
const inventoryDigest = (reports, secret) => opaque(secret, 'inventory-bindings', [...reports.values()]
  .sort((a, b) => `${a.sourceKind}:${a.recordRef}`.localeCompare(`${b.sourceKind}:${b.recordRef}`)));
const inventorySign = (report, secret) => {
  const { signature: _ignored, ...unsigned } = report;
  return opaque(secret, 'inventory-signature', unsigned);
};

async function proofCensus(query, sourceBytes = 0) {
  const where = "tenant_id='pbk' AND (suite_name=$1 OR source=$2)";
  const size = (await query(`SELECT COUNT(*) AS count, COALESCE(SUM(octet_length(to_jsonb(p)::text)),0) AS bytes
    FROM (${receiptSelect} WHERE ${where}) p`, [SUITE, SOURCE])).rows?.[0];
  const n = Number(size?.count), b = Number(size?.bytes);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_ROWS + 1 || !Number.isSafeInteger(b) || b < 0
    || sourceBytes + b > MAX_BYTES) throw new Error('Proof census oversized');
  const rows = (await query(`${receiptSelect} WHERE ${where} ORDER BY id LIMIT 10002`, [SUITE, SOURCE])).rows;
  if (!Array.isArray(rows) || rows.length !== n || bytes(rows) + sourceBytes > MAX_BYTES) {
    throw new Error('Proof census incomplete');
  }
  return rows;
}

const admissionExpiry = admission => Object.hasOwn(admission, 'expiresAt')
  ? admission.expiresAt : iso(time(admission.startedAt) + DEADLINE_MS);
const inventoryContext = inventory => ({ gaps: inventory.gaps, gapFloor: inventory.gapFloor,
  segmentRef: inventory.segmentRef, segmentRevision: inventory.segmentRevision, forwardOnlyFrom: inventory.forwardOnlyFrom });

function readLedger(rows, secret, now, activeAdmission = null, inspectPending = false) {
  const reports = new Map();
  let inventory;
  for (const row of rows) {
    if (row.id === inventoryId(secret)) { if (inventory) throw new Error('Duplicate inventory'); inventory = row; continue; }
    const report = validRevision(row.report?.revision)
      ? verifyReceipt(row, { secret, revision: row.report.revision, now }) : null;
    if (!report) throw new Error('History receipt unverified');
    const key = `${report.sourceKind}:${report.recordRef}`;
    if (reports.has(key)) throw new Error('Duplicate source history');
    reports.set(key, report);
  }
  if (!rows.length) {
    if (activeAdmission) throw new Error('Source observation admission missing');
    return { reports, inventory: null };
  }
  const r = inventory?.report;
  if (!plain(r) || bytes(r) > MAX_REPORT || r.schemaVersion !== SCHEMA || r.ledgerKind !== 'inventory'
    || r.tenantId !== 'pbk' || !Number.isSafeInteger(r.generation) || r.generation < 1
    || r.receiptCount !== reports.size || r.fingerprint !== inventoryDigest(reports, secret)
    || !hex(r.signature) || !Number.isFinite(time(r.observedAt)) || iso(time(r.observedAt)) !== r.observedAt
    || time(r.observedAt) > now || inventory.tenant_id !== 'pbk' || inventory.suite_name !== SUITE
    || inventory.source !== SOURCE || inventory.ok !== false || inventory.total !== 0
    || inventory.passed !== 0 || inventory.failed !== 0
    || new Date(inventory.created_at).getTime() !== time(r.observedAt)) throw new Error('History inventory unverified');
  const expected = { schemaVersion: SCHEMA, ledgerKind: 'inventory', tenantId: 'pbk', generation: r.generation,
    receiptCount: reports.size, fingerprint: inventoryDigest(reports, secret), observedAt: r.observedAt };
  if (Object.hasOwn(r, 'admission')) expected.admission = r.admission;
  if (r.admission !== null && r.admission !== undefined) {
    const a = r.admission;
    const expectedAdmission = { tokenRef: a.tokenRef, revision: a.revision, startedAt: a.startedAt };
    if (Object.hasOwn(a, 'expiresAt')) expectedAdmission.expiresAt = a.expiresAt;
    if (!plain(a) || !hex(a.tokenRef) || !validRevision(a.revision) || !Number.isFinite(time(a.startedAt))
      || iso(time(a.startedAt)) !== a.startedAt || time(a.startedAt) > now
      || !Number.isFinite(time(admissionExpiry(a))) || iso(time(admissionExpiry(a))) !== admissionExpiry(a)
      || time(admissionExpiry(a)) <= time(a.startedAt) || time(admissionExpiry(a)) - time(a.startedAt) > DEADLINE_MS
      || canonicalJson(a) !== canonicalJson(expectedAdmission)) throw new Error('Source admission unverified');
  }
  if (Object.hasOwn(r, 'gaps')) {
    Object.assign(expected, inventoryContext(r));
    if (!Array.isArray(r.gaps) || r.gaps.length > MAX_ROWS || !hex(r.segmentRef) || !validRevision(r.segmentRevision)
      || !Number.isFinite(time(r.forwardOnlyFrom)) || iso(time(r.forwardOnlyFrom)) !== r.forwardOnlyFrom
      || time(r.forwardOnlyFrom) > now || r.gapFloor !== null && (!Number.isFinite(time(r.gapFloor))
        || iso(time(r.gapFloor)) !== r.gapFloor || time(r.gapFloor) > now)) throw new Error('Gap history invalid');
    const references = new Set();
    for (const event of r.gaps) {
      if (!plain(event) || !hex(event.gapRef) || references.has(event.gapRef) || event.classification !== 'unknown'
        || !['observation_abandoned', 'storage_unverified'].includes(event.reason)
        || !Number.isFinite(time(event.startedAt)) || !Number.isFinite(time(event.endedAt))
        || iso(time(event.startedAt)) !== event.startedAt || iso(time(event.endedAt)) !== event.endedAt
        || time(event.startedAt) > time(event.endedAt) || time(event.endedAt) > now
        || canonicalJson(event) !== canonicalJson({ gapRef: event.gapRef, classification: 'unknown',
          reason: event.reason, startedAt: event.startedAt, endedAt: event.endedAt })) throw new Error('Gap history invalid');
      references.add(event.gapRef);
    }
  }
  expected.signature = inventorySign(expected, secret);
  if (canonicalJson(expected) !== canonicalJson(r)
    || !timingSafeEqual(Buffer.from(r.signature, 'hex'), Buffer.from(expected.signature, 'hex'))) {
    throw new Error('History inventory signature invalid');
  }
  if ([...reports.values()].reduce((n, report) => n + report.history.length + 1, r.gaps?.length || 0) > MAX_ROWS) {
    throw new Error('History census oversized');
  }
  if (!inspectPending) {
    if (r.admission && !activeAdmission) throw busy();
    if (activeAdmission && (!r.admission || canonicalJson(r.admission) !== canonicalJson(activeAdmission)
      || now >= time(admissionExpiry(r.admission)))) throw stale();
  }
  return { reports, inventory: r };
}

async function saveLedger(query, ledger, reports, secret, now, sourceBytes = 0) {
  const fingerprint = inventoryDigest(reports, secret);
  const count = [...reports.values()].reduce((n, report) => n + report.history.length + 1, ledger.inventory?.gaps?.length || 0);
  if (count > MAX_ROWS || reports.size > MAX_ROWS || bytes([...reports.values()]) + sourceBytes + MAX_REPORT > MAX_BYTES) {
    throw new Error('History census oversized');
  }
  if (ledger.inventory?.fingerprint === fingerprint) return ledger.inventory;
  const inventory = { schemaVersion: SCHEMA, ledgerKind: 'inventory', tenantId: 'pbk',
    generation: (ledger.inventory?.generation || 0) + 1, receiptCount: reports.size, fingerprint, observedAt: iso(now),
    admission: ledger.inventory?.admission || null, ...inventoryContext(ledger.inventory) };
  inventory.signature = inventorySign(inventory, secret);
  if (bytes(inventory) > MAX_REPORT) throw new Error('Inventory oversized');
  for (const [key, report] of reports) {
    if (canonicalJson(ledger.reports.get(key) || null) !== canonicalJson(report)) await save(query, report, secret, now);
  }
  await writeInventory(query, inventory, secret, now, inventory.admission, sourceBytes);
  return inventory;
}

async function writeInventory(query, inventory, secret, now, activeAdmission = null, sourceBytes = 0) {
  inventory.signature = inventorySign(inventory, secret);
  if (bytes(inventory) > MAX_REPORT) throw new Error('Inventory oversized');
  const id = inventoryId(secret);
  const result = await query(`INSERT INTO public.pbk_eval_runs
    (id,tenant_id,suite_name,ok,total,passed,failed,report,source,created_at)
    VALUES ($1,'pbk',$2,false,0,0,0,$3::jsonb,$4,$5::timestamptz)
    ON CONFLICT (id) DO UPDATE SET report=EXCLUDED.report,created_at=EXCLUDED.created_at
    WHERE pbk_eval_runs.tenant_id='pbk' AND pbk_eval_runs.suite_name=$2 AND pbk_eval_runs.source=$4`,
  [id, SUITE, JSON.stringify(inventory), SOURCE, inventory.observedAt]);
  if (result.rowCount !== 1 && result.affectedRows !== 1) throw new Error('Inventory not saved');
  const readback = readLedger(await proofCensus(query, sourceBytes), secret, now, activeAdmission);
  if (canonicalJson(readback.inventory) !== canonicalJson(inventory)) throw new Error('Inventory readback changed');
}

// This write commits BEFORE inspection, so rollback cannot erase evidence that an observation was lost.
async function beginObservation(query, secret, revision, now, expiresAt) {
  const ledger = readLedger(await proofCensus(query), secret, now, null, true);
  const old = ledger.inventory;
  if (old?.admission && now < time(admissionExpiry(old.admission))) throw busy();
  const debt = runtimeGaps.get(namespaceRef(secret));
  if (!debt && runtimeGaps.size >= MAX_ROWS) throw new Error('Runtime gap bound exceeded');
  const admission = { tokenRef: opaque(secret, 'observation-admission', randomUUID()), revision,
    startedAt: iso(now), expiresAt: iso(expiresAt) };
  const previousGaps = old?.gaps || [];
  const gaps = previousGaps.filter(event => time(event.endedAt) >= now - HISTORY_REACH_MS);
  const gapFloor = gaps.length < previousGaps.length ? iso(now - HISTORY_REACH_MS) : old?.gapFloor ?? null;
  const hasGap = Boolean(old?.admission || debt);
  if (hasGap) {
    const startedAt = Math.min(old?.admission ? time(old.admission.startedAt) : now, debt?.startedAt ?? now);
    gaps.push({ gapRef: opaque(secret, 'observation-gap', { tokenRef: admission.tokenRef, startedAt, endedAt: now }),
      classification: 'unknown', reason: old?.admission ? 'observation_abandoned' : 'storage_unverified',
      startedAt: iso(startedAt), endedAt: iso(now) });
  }
  const reset = !old?.segmentRef || hasGap || old.segmentRevision !== revision;
  const context = { gaps, gapFloor,
    segmentRef: reset ? opaque(secret, 'observation-segment', admission.tokenRef) : old.segmentRef,
    segmentRevision: revision, forwardOnlyFrom: reset ? iso(now) : old.forwardOnlyFrom };
  const inventory = old ? { ...old, observedAt: iso(now), admission, ...context }
    : { schemaVersion: SCHEMA, ledgerKind: 'inventory', tenantId: 'pbk', generation: 1,
      receiptCount: 0, fingerprint: inventoryDigest(ledger.reports, secret), observedAt: iso(now), admission, ...context };
  await writeInventory(query, inventory, secret, now, admission);
  return { admission, debt };
}

async function finishObservation(query, inventory, secret, now, sourceBytes = 0) {
  if (!inventory.admission || now >= time(admissionExpiry(inventory.admission))) throw stale();
  await writeInventory(query, { ...inventory, admission: null }, secret, now, null, sourceBytes);
}

function mintAdmission(admission, secret, deadlineAt) {
  const handle = Object.freeze({ tokenRef: admission.tokenRef, revision: admission.revision });
  admissionHandles.set(handle, { admission, namespace: namespaceRef(secret), deadlineAt, claimed: false });
  return handle;
}

function claimAdmission(handle, secret, revision, deadlineAt) {
  const state = admissionHandles.get(handle);
  if (!state || state.claimed || state.namespace !== namespaceRef(secret) || state.admission.revision !== revision
    || deadlineAt > state.deadlineAt) throw stale();
  state.claimed = true;
  return state.admission;
}

function observeClock(now, start, previous = start) {
  const value = clock(now);
  if (!validClock(value) || value < previous || value - start > DEADLINE_MS) throw new Error('Source clock invalid');
  return value;
}

export async function recordRuntimeSourceEvidence({ pool, secret, revision, sourceKind, sourceId, now = Date.now } = {}) {
  const context = getRuntimeEvidenceContext();
  if (context.classification === 'unknown') return { ...gap('source_context_unknown'), classification: 'unknown' };
  if (!pool?.connect || !validSecret(secret) || !validRevision(revision) || !kinds.includes(sourceKind)
    || typeof sourceId !== 'string' || !sourceId.length || sourceId.length > 512) return gap('source_input_unverified');
  const budget = deadline();
  let client, released = false, attemptAt;
  const release = destroy => { if (client && !released) { released = true; releaseClient(client, destroy); } };
  try {
    const start = clock(now);
    if (!validClock(start)) return gap('source_clock_unverified');
    attemptAt = start;
    client = await budget.run(() => pool.connect(), { onLate: late => releaseClient(late, true) });
    const prepared = await transaction(client, budget, query => beginObservation(query, secret, revision, start, start + DEADLINE_MS),
      () => release(true));
    forgetRuntimeGap(secret, prepared.debt);
    const result = await transaction(client, budget, async query => {
      const ledger = readLedger(await proofCensus(query), secret, start, prepared.admission);
      const source = sources[sourceKind];
      const sql = `SELECT ${source.fields} FROM public.${source.table} WHERE ${source.scope} AND id::text=$1`;
      const size = (await query(`SELECT octet_length(to_jsonb(p)::text) AS bytes FROM (${sql}) p`, [sourceId])).rows;
      if (size?.length !== 1 || !Number.isSafeInteger(Number(size[0].bytes)) || Number(size[0].bytes) > MAX_BYTES) {
        throw new Error('Source missing or oversized');
      }
      const row = (await query(`SELECT to_jsonb(p) AS row FROM (${sql} FOR SHARE) p`, [sourceId])).rows?.[0]?.row;
      const refs = binding(row, sourceKind, secret);
      const observedAt = observeClock(now, start);
      const outcome = outcomeOf(row, sourceKind);
      if (!sourceClockValid(row, sourceKind, observedAt) || outcome === 'unknown') throw new Error('Source unverified');
      const key = `${sourceKind}:${refs.recordRef}`;
      const prior = ledger.reports.get(key);
      if (prior?.classification === 'operational' && context.classification !== 'operational') {
        throw new Error('Source context mismatch');
      }
      // A delayed duplicate must not move the first observation forward or upgrade its origin.
      const next = prior?.presence === 'present' && prior.sourceBinding === refs.sourceBinding
        && prior.revision === revision ? prior
        : advanceReport(prior, { revision, sourceKind, ...refs, context, outcome, clockValid: true, observedAt, secret });
      const report = compactReport(next, observedAt, secret);
      const reports = new Map(ledger.reports).set(key, report);
      const inventory = await saveLedger(query, ledger, reports, secret, observedAt);
      observeClock(now, start, observedAt);
      await finishObservation(query, inventory, secret, observedAt);
      return { ok: true, verified: true, readbackVerified: true, eligible: false, result: 'source_receipt_verified',
        sourceKind, recordRef: refs.recordRef, sourceBinding: refs.sourceBinding,
        classification: report.classification, observedAt: report.observedAt };
    }, () => release(true));
    return result;
  } catch (error) {
    if (error.code === 'SOURCE_BUSY') return gap('source_observation_busy');
    if (error.code !== 'SOURCE_STALE') rememberRuntimeGap(secret, attemptAt);
    release(true);
    return gap(error.code === 'SOURCE_TIMEOUT' ? 'source_evidence_timed_out' : 'source_evidence_unverified');
  } finally { release(false); }
}

async function census(query) {
  const rows = new Map();
  let count = 0, totalBytes = 0;
  for (const kind of kinds) {
    const source = sources[kind];
    const select = `SELECT ${source.fields} FROM public.${source.table} WHERE ${source.scope}`;
    const size = (await query(`SELECT COUNT(*) AS count, COALESCE(SUM(octet_length(to_jsonb(p)::text)),0) AS bytes
      FROM (${select}) p`)).rows?.[0];
    const n = Number(size?.count), b = Number(size?.bytes);
    if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(b) || b < 0) throw new Error('Census invalid');
    count += n; totalBytes += b;
    if (count > MAX_ROWS || totalBytes > MAX_BYTES) throw new Error('Census oversized');
    const selected = (await query(`SELECT to_jsonb(p) AS row FROM (${select} ORDER BY id LIMIT 10001) p`)).rows;
    if (!Array.isArray(selected) || selected.length !== n) throw new Error('Census incomplete');
    rows.set(kind, selected.map(value => value.row));
  }
  const receipts = await proofCensus(query, totalBytes);
  return { rows, receipts, sourceBytes: totalBytes };
}

function classify(report, windowStart, windowEnd, historical = false) {
  const inWindow = time(report.observedAt) >= windowStart && time(report.observedAt) <= windowEnd;
  return { sourceKind: report.sourceKind, recordRef: report.recordRef, sourceBinding: report.sourceBinding,
    presence: report.presence, classification: report.classification, origin: report.origin,
    receiptKind: report.receiptKind, outcome: report.outcome, clockValid: report.clockValid,
    observedAt: report.observedAt, sequence: report.sequence, revision: report.revision, historical, inWindow,
    eligible: !historical && inWindow && report.classification === 'operational' && report.presence === 'present'
      && report.clockValid && report.outcome === 'success' };
}

function summarize(sourceKind, rows, history, secret, windowEnd) {
  rows.sort((a, b) => a.recordRef.localeCompare(b.recordRef));
  history.sort((a, b) => a.recordRef.localeCompare(b.recordRef) || a.sequence - b.sequence);
  const counts = { census: rows.length, history: history.length, observations: rows.length + history.length,
    present: 0, deleted: 0, inWindow: 0, unknown: 0,
    operational: 0, controlled: 0, diagnostic: 0, lateUnknown: 0, success: 0, warning: 0,
    failed: 0, cancelled: 0, skipped: 0, blocked: 0, allowed: 0, pending: 0,
    unknownOutcome: 0, invalidClock: 0, eligible: 0 };
  for (const row of rows) counts[row.presence]++;
  for (const row of [...rows, ...history]) {
    if (!row.clockValid && (!row.historical || row.inWindow)) counts.invalidClock++;
    if (row.classification === 'unknown' && time(row.observedAt) > windowEnd) counts.lateUnknown++;
    if (row.inWindow) {
      counts.inWindow++;
      counts[row.classification]++;
      if (row.outcome === 'unknown') counts.unknownOutcome++;
      else if (row.outcome !== 'deleted') counts[row.outcome]++;
      if (row.eligible) counts.eligible++;
    }
  }
  const times = [...rows, ...history].map(row => row.observedAt).sort();
  return { sourceKind, counts, fingerprint: opaque(secret, 'source-census', { sourceKind, rows, history }),
    observationBounds: { firstObservedAt: times[0] || null, lastObservedAt: times.at(-1) || null },
    eligible: counts.unknown === 0 && counts.lateUnknown === 0 && counts.failed === 0 && counts.cancelled === 0
      && counts.skipped === 0 && counts.invalidClock === 0, rows, history };
}

const snapshotInputValid = ({ client, secret, revision, windowStart, windowEnd }) => client?.query
  && validSecret(secret) && validRevision(revision) && validClock(windowStart) && validClock(windowEnd)
  && windowStart <= windowEnd && windowEnd - windowStart <= WINDOW_MS;

// The caller's monotonic deadline and abort signal fence every continuation, not just the outer promise.
function queryFence(client, fence) {
  if (!plain(fence) || !Number.isFinite(fence.deadlineAt) || fence.deadlineAt - performance.now() > 15000
    || typeof fence.signal?.addEventListener !== 'function' || typeof fence.signal.removeEventListener !== 'function'
    || typeof fence.signal.aborted !== 'boolean' || typeof fence.onAbort !== 'function') {
    throw new Error('Inherited fence required');
  }
  const { deadlineAt, signal, onAbort: abortOwner } = fence;
  let stopped = false;
  const stop = () => {
    if (!stopped) {
      stopped = true;
      try { abortOwner(); } catch { /* A failed owner callback cannot reopen the fence. */ }
      releaseClient(client, true);
    }
  };
  const remaining = () => deadlineAt - performance.now();
  const check = () => {
    if (stopped || signal.aborted || remaining() <= 0) { stop(); throw timeout(); }
  };
  signal.addEventListener('abort', stop, { once: true });
  return { check, stop, remaining, deadlineAt, close: () => signal.removeEventListener('abort', stop),
    async query(text, values = []) {
      check();
      const limit = Math.max(1, Math.floor(Math.min(2000, remaining())));
      let timer, rejectAbort;
      const onAbort = () => { stop(); rejectAbort?.(timeout()); };
      const abandoned = new Promise((_, reject) => {
        rejectAbort = reject;
        timer = setTimeout(onAbort, limit);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      const operation = Promise.resolve().then(() => {
        check();
        return client.query({ text, values, query_timeout: limit });
      });
      try {
        const result = await Promise.race([operation, abandoned]);
        check();
        return result;
      } catch (error) { if (error.code === 'SOURCE_TIMEOUT') stop(); throw error; }
      finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
    } };
}

async function lockObservation(control) {
  const query = control.query;
  await query(`SELECT set_config('statement_timeout',$1,true), set_config('lock_timeout',$1,true),
    set_config('idle_in_transaction_session_timeout',$1,true)`,
  [`${Math.max(1, Math.floor(Math.min(2000, control.remaining())))}ms`]);
  const lock = await query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [SOURCE]);
  if (lock.rows?.[0]?.acquired !== true) throw busy();
}

async function snapshotCore({ secret, revision, windowStart, windowEnd, now = Date.now }, control, activeAdmission) {
  control.check();
  const started = clock(now);
  if (!validClock(started) || windowEnd > started) throw new Error('Source observation clock invalid');
  const query = control.query;
  await lockObservation(control);
  readLedger(await proofCensus(query), secret, started, activeAdmission);
  const { rows, receipts, sourceBytes } = await census(query);
  control.check();
  const observedAt = observeClock(now, started);
  const ledger = readLedger(receipts, secret, observedAt, activeAdmission);
  if (ledger.inventory.gapFloor !== null && windowStart < time(ledger.inventory.gapFloor)) {
    throw new Error('Gap history window unavailable');
  }
  const reports = new Map(ledger.reports), missing = new Map(ledger.reports);
  const unknown = { origin: 'unknown', classification: 'unknown' };
  for (const kind of kinds) {
    const seen = new Set();
    for (const row of rows.get(kind)) {
      control.check();
      const refs = binding(row, kind, secret);
      if (seen.has(refs.recordRef)) throw new Error('Duplicate source identity');
      seen.add(refs.recordRef);
      const key = `${kind}:${refs.recordRef}`, prior = reports.get(key);
      missing.delete(key);
      let report = prior?.presence === 'present' && prior.sourceBinding === refs.sourceBinding ? prior
        : advanceReport(prior, { revision, sourceKind: kind, ...refs, context: unknown,
          outcome: outcomeOf(row, kind), clockValid: sourceClockValid(row, kind, observedAt), observedAt, secret });
      if (report.revision !== revision) {
        report = report.classification === 'unknown'
          ? makeReport({ ...report, revision, context: unknown, observedAt: time(report.observedAt), secret })
          : advanceReport(report, { ...report, revision, context: unknown, observedAt, secret });
      }
      reports.set(key, compactReport(report, observedAt, secret));
    }
  }
  for (const [key, prior] of missing) {
    control.check();
    const report = prior.presence === 'deleted' ? (prior.revision === revision ? prior
      : makeReport({ ...prior, revision, context: unknown, observedAt: time(prior.observedAt), secret }))
      : advanceReport(prior, { revision, sourceKind: prior.sourceKind, recordRef: prior.recordRef,
        sourceBinding: opaque(secret, 'deleted-source', { sourceKind: prior.sourceKind,
          recordRef: prior.recordRef, previousBinding: prior.sourceBinding, observedAt }),
        presence: 'deleted', context: unknown, outcome: 'deleted', clockValid: true, observedAt, secret });
    reports.set(key, compactReport(report, observedAt, secret));
  }
  const classified = new Map(kinds.map(kind => [kind, []]));
  const history = new Map(kinds.map(kind => [kind, []]));
  let historyCompleteFrom = ledger.inventory.gapFloor;
  for (const report of reports.values()) {
    control.check();
    if (report.historyFloor !== null && windowStart < time(report.historyFloor)) throw new Error('History window unavailable');
    if (report.historyFloor !== null && (!historyCompleteFrom || report.historyFloor > historyCompleteFrom)) {
      historyCompleteFrom = report.historyFloor;
    }
    classified.get(report.sourceKind).push(classify(report, windowStart, windowEnd));
    for (const event of report.history) {
      history.get(report.sourceKind).push(classify({ ...event, sourceKind: report.sourceKind,
        recordRef: report.recordRef }, windowStart, windowEnd, true));
    }
  }
  control.check();
  const inventory = await saveLedger(query, ledger, reports, secret, observedAt, sourceBytes);
  const summaries = kinds.map(kind => summarize(kind, classified.get(kind), history.get(kind), secret, windowEnd));
  const gaps = inventory.gaps;
  const intersectingGaps = gaps.filter(event => time(event.startedAt) <= windowEnd && time(event.endedAt) >= windowStart).length;
  const coverage = { segmentRef: inventory.segmentRef, forwardOnlyFrom: inventory.forwardOnlyFrom,
    gapFloor: inventory.gapFloor, gaps, intersectingGaps, continuous: intersectingGaps === 0,
    gapFingerprint: opaque(secret, 'observation-gap-history', { gaps, gapFloor: inventory.gapFloor }) };
  const completed = observeClock(now, started, observedAt);
  control.check();
  await finishObservation(query, inventory, secret, observedAt, sourceBytes);
  return { ok: true, verified: true, readbackVerified: true, transactionPending: true,
    result: 'source_snapshot_verified', schemaVersion: SCHEMA, revision,
    windowStart: iso(windowStart), windowEnd: iso(windowEnd),
    observationBounds: { startedAt: iso(started), completedAt: iso(completed) }, invalidReceipts: 0, historyCompleteFrom,
    inventory: { generation: inventory.generation, fingerprint: inventory.fingerprint, receiptCount: inventory.receiptCount },
    coverage,
    eligible: intersectingGaps === 0 && summaries.every(s => s.eligible) && summaries.some(s => s.counts.eligible > 0),
    fingerprint: opaque(secret, 'whole-census', { historyCompleteFrom, inventoryFingerprint: inventory.fingerprint,
      gapFingerprint: coverage.gapFingerprint, segmentRef: coverage.segmentRef,
      sources: summaries.map(({ sourceKind, fingerprint }) => ({ sourceKind, fingerprint })) }),
    sources: summaries };
}

// Internal composition only: caller owns the already-open fenced transaction and its final commit/readback.
export async function collectRuntimeSourceSnapshotInTransaction(input = {}) {
  let control, admission;
  try {
    control = queryFence(input.client, input.fence);
    control.check();
    if (!snapshotInputValid(input)) throw new Error('Source snapshot input invalid');
    admission = claimAdmission(input.admission, input.secret, input.revision, control.deadlineAt);
    return await snapshotCore(input, control, admission);
  } catch (error) {
    if (admission && !['SOURCE_BUSY', 'SOURCE_STALE'].includes(error.code)) rememberRuntimeGap(input.secret, time(admission.startedAt));
    if (error.code === 'SOURCE_BUSY') return gap('source_observation_busy');
    control?.stop();
    return gap(error.code === 'SOURCE_TIMEOUT' ? 'source_snapshot_timed_out' : 'source_snapshot_unverified');
  } finally { control?.close(); }
}

// Must run on a dedicated client BEFORE the caller opens its checkpoint transaction.
export async function prepareRuntimeSourceObservation(input = {}) {
  let control, began = false, attemptAt;
  try {
    control = queryFence(input.client, input.fence);
    control.check();
    if (!input.client?.query || !validSecret(input.secret) || !validRevision(input.revision)) throw new Error('Invalid admission');
    const now = clock(input.now ?? Date.now);
    if (!validClock(now)) throw new Error('Invalid admission clock');
    attemptAt = now;
    await control.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    began = true;
    await lockObservation(control);
    const prepared = await beginObservation(control.query, input.secret, input.revision, now,
      now + Math.max(1, Math.ceil(control.remaining())));
    await control.query('COMMIT');
    began = false;
    forgetRuntimeGap(input.secret, prepared.debt);
    return { ok: true, verified: true, readbackVerified: true, eligible: false, transactionPending: false,
      result: 'source_observation_admitted', admission: mintAdmission(prepared.admission, input.secret, control.deadlineAt) };
  } catch (error) {
    if (!['SOURCE_BUSY', 'SOURCE_STALE'].includes(error.code)) rememberRuntimeGap(input.secret, attemptAt);
    if (began && error.code !== 'SOURCE_TIMEOUT') { try { await control.query('ROLLBACK'); } catch { control.stop(); } }
    if (error.code === 'SOURCE_BUSY') return gap('source_observation_busy');
    control?.stop();
    return gap(error.code === 'SOURCE_TIMEOUT' ? 'source_snapshot_timed_out' : 'source_observation_admission_unverified');
  } finally { control?.close(); }
}

// Standalone wrapper owns its transaction; the same 15s/2s fence guards BEGIN through COMMIT.
export async function collectRuntimeSourceSnapshot(input = {}) {
  if (!snapshotInputValid(input)) return gap('source_snapshot_input_unverified');
  const fence = { deadlineAt: performance.now() + 15000, signal: new AbortController().signal, onAbort() {} };
  const control = queryFence(input.client, fence);
  let began = false, attemptAt;
  try {
    const now = clock(input.now ?? Date.now);
    if (!validClock(now)) throw new Error('Invalid observation admission clock');
    attemptAt = now;
    await control.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    began = true;
    await lockObservation(control);
    const prepared = await beginObservation(control.query, input.secret, input.revision, now,
      now + Math.max(1, Math.ceil(control.remaining())));
    await control.query('COMMIT');
    began = false;
    forgetRuntimeGap(input.secret, prepared.debt);
    await control.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    began = true;
    const result = await snapshotCore(input, control, prepared.admission);
    await control.query('COMMIT');
    return { ...result, transactionPending: false };
  } catch (error) {
    if (!['SOURCE_BUSY', 'SOURCE_STALE'].includes(error.code)) rememberRuntimeGap(input.secret, attemptAt);
    if (began && error.code !== 'SOURCE_TIMEOUT') {
      try { await control.query('ROLLBACK'); } catch { control.stop(); }
    }
    if (error.code === 'SOURCE_BUSY') return gap('source_observation_busy');
    control.stop();
    return gap(error.code === 'SOURCE_TIMEOUT' ? 'source_snapshot_timed_out' : 'source_snapshot_unverified');
  } finally { control.close(); }
}
