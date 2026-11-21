import { createHmac, randomUUID } from 'node:crypto';
import { hashProviderActionContext } from './provider-action-authorization.mjs';


const dayMs = 86_400_000;
const type = 'recording-retention';
const action = 'delete_recordings_retention';
const origin = 'recording-retention-route';
const grants = 'public.pbk_recording_retention_approvals';
const attempts = 'public.pbk_recording_retention_attempts';
const storageWrites = 'public.pbk_recording_storage_writes';
const claimedExecutions = new WeakSet();
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id);
export const validRecordingObjectVersion = validId;

export function validRecordingRetentionStorageKey(key) {
  return typeof key === 'string' && Buffer.byteLength(key) <= 1024 && !/[\\\x00-\x1f\x7f]/u.test(key) &&
    key.split('/').every(part => part && part !== '.' && part !== '..');
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

function workspaceOf(row) {
  return row.workspaceId || row.workspace_id || row.tenantId || row.tenant_id || 'pbk';
}

export function recordingRetentionTargetMatches(target, row, getPath) {
  return row?.id === target.id && workspaceOf(row) === 'pbk' &&
    getPath(row) === target.key && hashProviderActionContext(row) === target.version;
}

export function takeClaimedRecordingRetentionExecution(execution) {
  return claimedExecutions.delete(execution);
}

async function buildPlan(messages, days, cutoffAt, bucket, getPath, getStorageVersion, readObjectVersion, pool) {
  const cutoff = Date.parse(cutoffAt);
  const candidates = messages.filter(row => workspaceOf(row) === 'pbk' && row.channel === 'call' &&
    row.direction === 'recording' && row.retentionStatus !== 'deleted' && Date.parse(row.createdAt || row.updatedAt || '') < cutoff);
  const fenced = await pool.query(`SELECT storage_key, outcome, CASE WHEN outcome = 'pending' THEN message_id END AS message_id FROM ONLY ${attempts}
    WHERE storage_key = ANY($1::text[]) AND outcome IN ('pending', 'confirmed')
       OR message_id = ANY($2::text[]) AND outcome = 'pending'
    UNION ALL
    SELECT storage_key, 'pending', message_id FROM ONLY ${storageWrites}
    WHERE storage_key = ANY($1::text[]) OR message_id = ANY($2::text[])`,
  [[...new Set(candidates.map(getPath).filter(Boolean))], candidates.map(row => row.id)]);
  const fencedKeys = new Map(fenced.rows.filter(row => row.storage_key).map(row => [row.storage_key, row.outcome]));
  const fencedIds = new Set(fenced.rows.map(row => row.message_id).filter(Boolean));
  const blocked = new Set();
  const targets = [];
  const ids = new Set();
  const keys = new Set();
  for (const row of candidates) {
    const key = getPath(row);
    if (!key) continue;
    if (fencedKeys.has(key) || fencedIds.has(row.id)) {
      if (fencedKeys.get(key) === 'pending' || fencedIds.has(row.id)) blocked.add(key);
      continue;
    }
    const recordedBucket = row.storageBucket || row.storage_bucket || row.payload?.storageBucket || row.payload?.storage_bucket || bucket;
    if (recordedBucket !== bucket || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) || keys.has(key) ||
      !validRecordingRetentionStorageKey(key)) return null;
    ids.add(row.id);
    keys.add(key);
    const target = { id: row.id, key, version: hashProviderActionContext(row) };
    const storageVersion = await getStorageVersion(target, cutoffAt);
    if (typeof storageVersion !== 'string' || !/^[a-f0-9]{64}$/u.test(storageVersion)) return null;
    const object = await readObjectVersion(key);
    if (!validRecordingObjectVersion(object?.version) || !Number.isFinite(object.modifiedAt) || object.modifiedAt >= cutoff) return null;
    targets.push(Object.freeze({ ...target, storageVersion, objectVersion: object.version }));
  }
  targets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    targets: Object.freeze(targets),
    plan: Object.freeze({ days, cutoffAt, targetCount: targets.length, targetHash: hashProviderActionContext({ bucket, targets }) }),
    blockedCandidateCount: blocked.size,
  };
}

function matchesPlan(left, right) {
  return Boolean(left && right && left.days === right.days && left.cutoffAt === right.cutoffAt &&
    left.targetCount === right.targetCount && left.targetHash === right.targetHash);
}

export async function handleRecordingRetentionRequest({
  body, getPool, getMessages, getPath, getPolicyDays, getStorageVersion, readObjectVersion, bucket, requestApproval, run,
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
  const pool = getPool();
  if (!pool) return unavailable();
  if (!id) {
    const timestamp = now();
    try {
      const batch = await buildPlan(getMessages(), days, new Date(timestamp - days * dayMs).toISOString(), bucket, getPath, getStorageVersion, readObjectVersion, pool);
      if (!batch) return changed();
      const { blockedCandidateCount } = batch;
      if (!batch.targets.length) return {
        ok: true, result: blockedCandidateCount ? 'retention_candidates_pending' : 'no_retention_candidates',
        blockedCandidateCount, deletedCount: 0,
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
        days, cutoffAt: batch.plan.cutoffAt, candidateCount: batch.plan.targetCount, blockedCandidateCount };
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
    if (!proof || grant.founder_proof !== proof) return block(403, 'retention_approval_required', 'The exact batch requires a direct founder decision.');
    const batch = await buildPlan(getMessages(), days, grant.plan.cutoffAt, bucket, getPath, getStorageVersion, readObjectVersion, pool);
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
    const latest = await buildPlan(getMessages(), days, grant.plan.cutoffAt, bucket, getPath, getStorageVersion, readObjectVersion, pool);
    if (!matchesPlan(latest?.plan, batch.plan)) return changed();
    execution = Object.freeze({ id, ...latest });
    claimedExecutions.add(execution);
  } catch {
    return unavailable();
  }
  return run({ dryRun: false, days, actor, execution });
}
