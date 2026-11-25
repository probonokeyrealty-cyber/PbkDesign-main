import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { canonicalJson } from './skill-governance-store.mjs';
import { runSkillProjectionBatch } from './skill-projection-worker.mjs';

const payload = { reason: 'private operator note', subjectVersionId: '22222222-2222-4222-8222-222222222222' };
const event = {
  event_id: '11111111-1111-4111-8111-111111111111',
  workspace_id: 'pbk',
  aggregate_type: 'skill_activation',
  aggregate_id: '33333333-3333-4333-8333-333333333333',
  authority_version: '1770000000000',
  schema_version: 1,
  dedupe_key: 'fixture',
  payload_hash: createHash('sha256').update(canonicalJson(payload)).digest('hex'),
  payload: { ...payload, auditEventId: '44444444-4444-4444-8444-444444444444', authorityVersion: 1770000000000, eventType: 'skill_activation_rolled_back' },
  attempt_count: 8,
  created_at: new Date('2026-06-09T12:00:00.000Z'),
};

function fixture(events, project) {
  const calls = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        calls.push({ type: 'claim', params });
        return { rows: events };
      }
      const type = sql.includes('delivered_at = NOW()') ? 'delivered' : 'failed';
      calls.push({ type, params });
      return { rows: [event] };
    },
  };
  return { calls, options: { pool, project } };
}

test('projects a verified rollback as a tombstone and acknowledges under the same lease', async () => {
  const { calls, options } = fixture([event], async (rows) => {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_tombstone, true);
    assert.equal(rows[0].event_id, event.event_id);
    assert.equal(rows[0].authority_version, event.authority_version);
    assert.doesNotMatch(JSON.stringify(rows), /private operator note/);
    assert.equal(calls.length, 1);
    return true;
  });
  assert.deepEqual(await runSkillProjectionBatch(options), { claimed: 1, delivered: 1, failed: 0 });
  assert.deepEqual(calls[1].params, [event.event_id, calls[0].params[1]]);
});

test('quarantines an invalid hash and reaches the dead-letter threshold on the eighth claim', async () => {
  const { calls, options } = fixture([{ ...event, payload_hash: 'mismatch' }], async () => {
    assert.fail('Corrupt rows must never be projected');
  });
  assert.equal((await runSkillProjectionBatch(options)).failed, 1);
  assert.equal(calls[1].type, 'failed');
  assert.equal(calls[1].params[4], true);
});

test('provider failure never acknowledges an event or records provider response detail', async () => {
  const { calls, options } = fixture([event], async () => { throw new Error('private provider detail'); });
  assert.equal((await runSkillProjectionBatch(options)).delivered, 0);
  assert.equal(calls[1].type, 'failed');
  assert.doesNotMatch(calls[1].params[2], /private provider detail/);
});
