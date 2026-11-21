import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { hashProviderActionContext } from './provider-action-authorization.mjs';


const dayMs = 86_400_000;
const type = 'recording-retention';
const action = 'delete_recordings_retention';
const origin = 'recording-retention-route';
const grants = 'public.pbk_recording_retention_approvals';
const attempts = 'public.pbk_recording_retention_attempts';
const storageWrites = 'public.pbk_recording_storage_writes';
const batchSize = 25;
const scanLimit = 50;
const claimedExecutions = new WeakSet();
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id);
export const validRecordingObjectVersion = validId;

export function validRecordingRetentionStorageKey(key) {
  return typeof key === 'string' && Buffer.byteLength(key) <= 1024 && !/[\\\x00-\x1f\x7f]/u.test(key) &&
    key.split('/').every(part => part && part !== '.' && part !== '..');
}

export function hasUntypedRecordingPointer(record = {}, captureRequest = false) {
  const fields = ['storagePath', 'storage_path', 'recordingStoragePath', 'recording_storage_path', 's3Key'];
  const untyped = value => value != null && typeof value !== 'string';
  return (captureRequest && untyped(record.path)) || [record, record.payload].some(value =>
    value != null && (fields.some(field => untyped(value[field])) ||
      [value.s3Archive, value.s3_archive].some(archive => archive != null &&
        ['key', 'storagePath', 's3Key'].some(field => untyped(archive[field])))));
}
const block = (statusCode, result, error) => ({ ok: false, statusCode, result, error });
const unavailable = () => block(503, 'retention_approval_unavailable', 'Recording retention approval could not be confirmed. No storage deletion was started.');
const changed = () => block(409, 'retention_plan_changed', 'The recording list, storage versions, or retention days could not be verified. Review the batch and request a new approval.');

export function isRecordingRetentionApproval(approval) {
  return String(approval?.type || '').trim().toLowerCase() === type;
}

export function checkRecordingRetentionDecision(approval, directFounder) {
  if (!isRecordingRetentionApproval(approval) || directFounder === true) return null;
  return block(403, 'retention_founder_required', 'Decide recording retention approvals through the direct founder API.');
}

function signFounderDecision(key, id, plan, actedAt) {
  return createHmac('sha256', key)
    .update(JSON.stringify(['pbk-recording-retention-founder-v1', id, hashProviderActionContext(plan), actedAt]))
    .digest('hex');
}

export async function claimRecordingRetentionFounderDecision(pool, { id, actor, actedAt, directFounder, founderProofKey }) {
  if (directFounder !== true || !validId(id) || !pool || !founderProofKey) return false;
  const lookup = await pool.query(`SELECT plan FROM ONLY ${grants} WHERE approval_id = $1`, [id]);
  const plan = lookup.rows[0]?.plan;
  if (!plan) return false;
  const proof = signFounderDecision(founderProofKey, id, plan, actedAt);
  const result = await pool.query(`WITH decided AS (
    UPDATE ONLY public.approvals a SET status = 'approved', decided_at = $3::text::timestamptz, updated_at = NOW(),
      payload = a.payload || jsonb_build_object('status', 'approved', 'actor', $2::text, 'actedAt', $3::text)
    FROM ${grants} g, pg_catalog.set_config('synchronous_commit', 'on', true)
    WHERE g.approval_id = a.id AND a.id = $1 AND a.workspace_id COLLATE "C" = 'pbk'
      AND a.status = 'pending' AND a.type = $4 AND a.payload->>'approvalAction' = $5
      AND a.payload->>'source' = $6 AND a.payload#>'{metadata,recordingRetention}' = g.plan
      AND g.plan = $7::jsonb
      AND g.founder_approved_at IS NULL AND g.consumed_at IS NULL AND g.expires_at > statement_timestamp()
    RETURNING a.id, a.decided_at
  )
  UPDATE ${grants} g SET founder_approved_at = d.decided_at, founder_proof = $8
  FROM decided d WHERE g.approval_id = d.id RETURNING g.approval_id`, [id, actor, actedAt, type, action, origin, JSON.stringify(plan), proof]);
  return result.rowCount === 1;
}

export function eligibleDurableRecording(row, cutoffAt) {
  const created = new Date(row?.created_at ?? NaN).getTime();
  return Number.isFinite(created) && created < Date.parse(cutoffAt);
}

export function takeClaimedRecordingRetentionExecution(execution) {
  return claimedExecutions.delete(execution);
}

function validScanAfter(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value.createdAt) &&
    Number.isFinite(Date.parse(value.createdAt)) && typeof value.id === 'string' && value.id.length > 0 &&
    Buffer.byteLength(value.id) <= 512 && !value.id.includes('\0');
}

async function verifyCandidate(row, bucket, cutoffAt, getPath, getStorageVersion, readObjectVersion) {
  const key = getPath(row);
  const recordedBucket = row.storage_bucket || row.payload?.storageBucket || row.payload?.storage_bucket || bucket;
  if (recordedBucket !== bucket || !row.id?.trim() || hasUntypedRecordingPointer(row) || !validRecordingRetentionStorageKey(key)) {
    return { reason: 'recording_pointer_unverified' };
  }
  const target = { id: row.id, key, createdAt: row.created_at };
  const storageVersion = await getStorageVersion(target, cutoffAt);
  if (typeof storageVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(storageVersion)) return { reason: 'recording_pointer_unverified' };
  const object = await readObjectVersion(key);
  if (object?.missing) return { reason: 'storage_object_missing' };
  if (!validRecordingObjectVersion(object?.version) || !Number.isFinite(object.modifiedAt) || object.modifiedAt >= Date.parse(cutoffAt)) {
    return { reason: 'storage_version_unverified' };
  }
  return { target: Object.freeze({ ...target, storageVersion, objectVersion: object.version }) };
}

async function buildPlan(days, cutoffAt, bucket, getPath, getStorageVersion, readObjectVersion, pool, scanAfter) {
  // The dashboard cache is not a retention inventory. Read the oldest durable
  // candidates in a bounded batch; quarantined rows must not starve later work.
  const { rows: [source] } = await pool.query(`WITH classified AS MATERIALIZED (
    SELECT m.id, m.created_at, m.storage_path, m.storage_bucket, m.payload,
      EXISTS (SELECT 1 FROM ONLY ${attempts} a WHERE a.outcome = 'pending'
        AND (a.message_id = m.id OR a.storage_key = ANY(p.keys) OR a.bucket || '/' || a.storage_key = ANY(p.keys)))
      OR EXISTS (SELECT 1 FROM ONLY ${storageWrites} w WHERE w.rejected_at IS NULL
        AND (w.message_id = m.id OR w.storage_key = ANY(p.keys) OR w.bucket || '/' || w.storage_key = ANY(p.keys))) AS pending,
      EXISTS (SELECT 1 FROM ONLY ${attempts} a WHERE a.outcome = 'confirmed'
        AND (a.storage_key = ANY(p.keys) OR a.bucket || '/' || a.storage_key = ANY(p.keys))) AS retired
    FROM ONLY public.unified_messages m
    CROSS JOIN LATERAL (SELECT ARRAY(SELECT public.pbk_recording_storage_pointers(m.storage_path, m.payload)) COLLATE "C" AS keys) p
    WHERE m.workspace_id COLLATE "C" = 'pbk' AND m.channel = 'call' AND m.direction = 'recording'
      AND m.created_at < $1::timestamptz AND (cardinality(p.keys) > 0 OR public.pbk_recording_has_untyped_pointer(m.payload))
  ), page AS (
    SELECT *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM classified WHERE NOT pending AND NOT retired
      AND ($3::timestamptz IS NULL OR (created_at, id COLLATE "C") > ($3::timestamptz, $4::text COLLATE "C"))
    ORDER BY created_at, id COLLATE "C" LIMIT $2
  )
  SELECT NOT (pg_catalog.row_security_active('public.unified_messages'::regclass)
    OR pg_catalog.row_security_active('${attempts}'::regclass)
    OR pg_catalog.row_security_active('${storageWrites}'::regclass)) AS readable,
    (SELECT count(*) FROM classified WHERE pending) AS blocked_count,
    COALESCE((SELECT jsonb_agg(page ORDER BY created_at, id COLLATE "C") FROM page), '[]'::jsonb) AS candidates`,
  [cutoffAt, scanLimit + 1, scanAfter?.createdAt ?? null, scanAfter?.id ?? null]);
  if (source?.readable !== true) return null;
  const targets = [];
  const blockedCandidates = [];
  let examined = 0;
  for (const row of source.candidates.slice(0, scanLimit)) {
    const proof = await verifyCandidate(row, bucket, cutoffAt, getPath, getStorageVersion, readObjectVersion);
    examined++;
    if (proof.target) targets.push(proof.target);
    else blockedCandidates.push({ messageId: row.id, reason: proof.reason });
    if (targets.length === batchSize) break;
  }
  const moreCandidates = source.candidates.length > examined;
  const last = source.candidates[examined - 1];
  if (new Set(targets.map(target => target.key)).size !== targets.length) return null;
  targets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    targets: Object.freeze(targets),
    plan: Object.freeze({ days, cutoffAt, targetCount: targets.length, targetHash: hashProviderActionContext({ bucket, targets }),
      ...(scanAfter ? { scanAfter } : {}) }),
    blockedCandidateCount: Number(source.blocked_count) + blockedCandidates.length,
    blockedCandidates,
    moreCandidates,
    nextScanAfter: moreCandidates && last ? { createdAt: last.cursor_at, id: last.id } : null,
  };
}

function matchesPlan(left, right) {
  return Boolean(left && right && left.days === right.days && left.cutoffAt === right.cutoffAt &&
    left.targetCount === right.targetCount && left.targetHash === right.targetHash &&
    left.scanAfter?.createdAt === right.scanAfter?.createdAt && left.scanAfter?.id === right.scanAfter?.id);
}

function scanReport({ blockedCandidateCount, blockedCandidates, moreCandidates, nextScanAfter }) {
  return { blockedCandidateCount, blockedCandidates, moreCandidates, nextScanAfter };
}

export async function handleRecordingRetentionRequest({
  body, getPool, getPath, getPolicyDays, getStorageVersion, readObjectVersion, bucket, requestApproval, run,
  founderProofKey, now = Date.now,
}) {
  if (body?.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return block(400, 'invalid_retention_request', 'dryRun must be a boolean.');
  }
  const suppliedDays = body?.days ?? body?.retentionDays ?? 0;
  const requestedDays = typeof suppliedDays === 'number' || (typeof suppliedDays === 'string' && /^\d+$/u.test(suppliedDays))
    ? Number(suppliedDays) : NaN;
  const days = requestedDays === 0 ? getPolicyDays() : requestedDays;
  if (!Number.isInteger(days) || days < 1 || days > 36_500) {
    return block(400, 'invalid_retention_request', 'Retention days must be a whole number between 1 and 36500.');
  }
  const actor = typeof body?.actor === 'string' && body.actor.trim() ? body.actor : 'Retention worker';
  if (body?.dryRun !== false) return run({ dryRun: true, days, actor });

  const id = body.approvalId ?? body.approval_id;
  if (id !== undefined && !validId(id)) return block(403, 'retention_approval_required', 'A valid recording retention approval is required.');
  const requestedScanAfter = body.scanAfter;
  if (requestedScanAfter !== undefined && (id || !validScanAfter(requestedScanAfter))) {
    return block(400, 'invalid_retention_request', 'A scan cursor can only be used to request a new approval.');
  }
  const scanAfter = requestedScanAfter && { createdAt: requestedScanAfter.createdAt, id: requestedScanAfter.id };
  const pool = getPool();
  if (!pool) return unavailable();
  if (!id) {
    const timestamp = now();
    try {
      const batch = await buildPlan(days, new Date(timestamp - days * dayMs).toISOString(), bucket, getPath, getStorageVersion, readObjectVersion, pool, scanAfter);
      if (!batch) return changed();
      const { blockedCandidateCount } = batch;
      if (!batch.targets.length) return {
        ok: true, result: blockedCandidateCount ? 'retention_candidates_pending' : 'no_retention_candidates',
        ...scanReport(batch), deletedCount: 0,
      };
      const approvalId = randomUUID();
      const expiresAt = new Date(timestamp + dayMs).toISOString();
      const requested = await requestApproval({
        id: approvalId, type, approvalAction: action, source: origin,
        leadName: 'Recording retention', address: 'PBK primary recording storage',
        notes: `Delete primary storage for ${batch.plan.targetCount} recording(s) older than ${batch.plan.cutoffAt} (${days} days). Archive copies are not included. Decide via the direct founder API.`,
        metadata: { recordingRetention: batch.plan },
      });
      if (requested?.approval?.id !== approvalId || requested.approvalPersistence?.ok !== true) return unavailable();
      const grant = await pool.query(`INSERT INTO ${grants} (approval_id, plan, expires_at)
        SELECT id, $2::jsonb, $3::timestamptz FROM ONLY public.approvals
        WHERE id = $1 AND workspace_id = 'pbk' AND type = $4 AND status = 'pending'
          AND payload->>'approvalAction' = $5 AND payload->>'source' = $6
          AND payload#>'{metadata,recordingRetention}' = $2::jsonb
        ON CONFLICT (approval_id) DO NOTHING`, [approvalId, JSON.stringify(batch.plan), expiresAt, type, action, origin]);
      if (grant.rowCount !== 1) return unavailable();
      return { ok: true, statusCode: 202, result: 'queued_for_approval', approvalId, expiresAt,
        days, cutoffAt: batch.plan.cutoffAt, candidateCount: batch.plan.targetCount, ...scanReport(batch) };
    } catch {
      return unavailable();
    }
  }

  let execution;
  try {
    const lookup = await pool.query(`SELECT plan, founder_approved_at, founder_proof, consumed_at, expires_at > statement_timestamp() AS active
      FROM ONLY ${grants} WHERE approval_id = $1`, [id]);
    const grant = lookup.rows[0];
    if (!grant) return block(403, 'retention_approval_required', 'Request a recording retention approval for this batch first.');
    if (grant.consumed_at) {
      const saved = await pool.query(`SELECT message_id AS "messageId", outcome, started_at AS "startedAt",
        finished_at AS "finishedAt" FROM ONLY ${attempts} WHERE approval_id = $1 ORDER BY message_id`, [id]);
      return {
        ...block(409, 'retention_approval_consumed', 'This approval already started a cleanup. Review its outcome before requesting another approval.'),
        outcomes: saved.rows, notStartedCount: Math.max(0, grant.plan.targetCount - saved.rows.length),
      };
    }
    if (!grant.active) return block(403, 'retention_approval_expired', 'The recording retention approval expired.');
    const approvedAt = grant.founder_approved_at?.toISOString();
    const proof = approvedAt && founderProofKey ? signFounderDecision(founderProofKey, id, grant.plan, approvedAt) : null;
    if (!proof || typeof grant.founder_proof !== 'string' || !/^[a-f0-9]{64}$/u.test(grant.founder_proof) ||
      !timingSafeEqual(Buffer.from(grant.founder_proof, 'hex'), Buffer.from(proof, 'hex'))) {
      return block(403, 'retention_approval_required', 'The exact batch requires a direct founder decision.');
    }
    const batch = await buildPlan(days, grant.plan.cutoffAt, bucket, getPath, getStorageVersion, readObjectVersion, pool, grant.plan.scanAfter);
    if (!matchesPlan(batch?.plan, grant.plan)) return changed();
    // The approval row and one-use claim are checked together. Uncertain
    // claims are not retried and no mutable bridge approval can authorize I/O.
    const claim = await pool.query(`WITH approved AS MATERIALIZED (
        SELECT a.id, a.decided_at FROM ONLY public.approvals a WHERE a.id = $1 AND a.workspace_id COLLATE "C" = 'pbk'
          AND a.type = $3 AND a.status = 'approved' AND a.decided_at IS NOT NULL
          AND a.payload->>'approvalAction' = $4 AND a.payload->>'source' = $5
          AND a.payload#>'{metadata,recordingRetention}' = $2::jsonb
        FOR UPDATE
      )
      UPDATE ${grants} g SET consumed_at = statement_timestamp()
      FROM approved a, pg_catalog.set_config('synchronous_commit', 'on', true)
      WHERE g.approval_id = a.id AND g.plan = $2::jsonb AND g.consumed_at IS NULL
        AND g.founder_approved_at = a.decided_at AND g.founder_proof = $6
        AND g.expires_at > statement_timestamp()
      RETURNING g.approval_id`, [id, JSON.stringify(batch.plan), type, action, origin, proof]);
    if (claim.rowCount !== 1) return block(403, 'retention_approval_required', 'The exact batch must be approved, unexpired and unused.');
    const latest = await buildPlan(days, grant.plan.cutoffAt, bucket, getPath, getStorageVersion, readObjectVersion, pool, grant.plan.scanAfter);
    if (!matchesPlan(latest?.plan, batch.plan)) return changed();
    execution = Object.freeze({ id, ...latest });
    claimedExecutions.add(execution);
  } catch {
    return unavailable();
  }
  return run({ dryRun: false, days, actor, execution });
}
