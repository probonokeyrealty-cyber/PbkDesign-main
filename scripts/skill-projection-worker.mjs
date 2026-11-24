import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalJson,
  claimSkillProjectionEvents,
  markSkillProjectionDelivered,
  markSkillProjectionFailed,
} from './skill-governance-store.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TOMBSTONES = new Set([
  'skill_activation_rolled_back', 'skill_paused', 'skill_retired', 'skill_deleted',
]);

function toProjection(event) {
  const { auditEventId, eventType, authorityVersion, ...facts } = event.payload || {};
  const hash = createHash('sha256').update(canonicalJson(facts)).digest('hex');
  if (event.schema_version !== 1 || hash !== event.payload_hash ||
      String(authorityVersion) !== String(event.authority_version) ||
      !/^(?:skill_|legacy_skill_)[a-z_]+$/.test(eventType || '') || !UUID.test(auditEventId || '')) {
    return null;
  }
  const versionId = event.aggregate_type === 'skill_version'
    ? event.aggregate_id : facts.versionId || facts.subjectVersionId;
  return {
    event_id: event.event_id,
    audit_event_id: auditEventId,
    workspace_id: event.workspace_id,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    skill_version_id: UUID.test(versionId || '') ? versionId : null,
    event_type: eventType,
    authority_version: String(event.authority_version),
    schema_version: event.schema_version,
    dedupe_key: event.dedupe_key,
    payload_hash: event.payload_hash,
    is_tombstone: TOMBSTONES.has(eventType),
    source_created_at: event.created_at,
  };
}

export async function runSkillProjectionBatch({ pool, project }) {
  const workerId = randomUUID();
  const events = await claimSkillProjectionEvents(pool, { workerId, limit: 20, leaseSeconds: 120 });
  const valid = [];
  const failures = [];
  for (const event of events) {
    const row = toProjection(event);
    if (row) valid.push(row);
    else failures.push({ event, error: 'Invalid projection event integrity or schema.' });
  }

  let projected = false;
  if (valid.length) {
    try {
      projected = await project(valid) === true;
    } catch {
      // Provider responses may include sensitive request details.
    }
  }
  const validIds = new Set(valid.map((row) => row.event_id));
  const delivered = [];
  for (const event of events) {
    if (!validIds.has(event.event_id)) continue;
    if (projected) delivered.push(markSkillProjectionDelivered(pool, { eventId: event.event_id, workerId }));
    else failures.push({ event, error: 'Supabase skill projection delivery failed.' });
  }
  const failed = failures.map(({ event, error }) =>
    markSkillProjectionFailed(pool, {
      eventId: event.event_id,
      workerId,
      // The claim already counted this attempt. The store helper adds one.
      attemptCount: event.attempt_count - 1,
      error,
    }));
  const acknowledgments = await Promise.allSettled([...delivered, ...failed]);
  if (acknowledgments.some((result) => result.status === 'rejected')) {
    throw new Error('Skill projection acknowledgments failed.');
  }
  const count = (results) => results.filter((result) => result.value).length;
  return {
    claimed: events.length,
    delivered: count(acknowledgments.slice(0, delivered.length)),
    failed: count(acknowledgments.slice(delivered.length)),
  };
}

export function startSkillProjectionWorker({ pool, url, key, onError = () => {}, fetchImpl = globalThis.fetch }) {
  if (!pool || !key || !URL.canParse(url)) return () => {};
  const endpoint = new URL('/rest/v1/pbk_skill_projection_events', url);
  if (endpoint.protocol !== 'https:') return () => {};
  endpoint.searchParams.set('on_conflict', 'event_id');

  const project = async (rows) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.body) await response.body.cancel();
    return response.ok;
  };

  let stopped = false;
  let timer;
  const schedule = (delay) => {
    if (!stopped) timer = setTimeout(tick, delay).unref();
  };
  async function tick() {
    let delay = 30_000;
    try {
      const result = await runSkillProjectionBatch({ pool, project });
      if (result.failed) onError('Skill analytics projection reported delivery failures.');
      if (result.delivered === 20) delay = 1_000;
    } catch {
      onError('Skill analytics projection batch failed.');
    } finally {
      schedule(delay);
    }
  }
  schedule(5_000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
