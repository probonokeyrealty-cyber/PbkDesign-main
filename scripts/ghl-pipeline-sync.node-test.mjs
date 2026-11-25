import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptGhlStageEvent, buildGhlPipelineView, persistGhlStage, readGhlPipelineConfig } from './ghl-pipeline-sync.mjs';

const config = readGhlPipelineConfig(JSON.stringify({
  locationId: 'sandbox-location', pipelineId: 'sandbox-pipeline', name: 'Sandbox',
  stages: [{ id: 'research', label: 'Research', pbkStage: 'cold' },
    { id: 'review', label: 'Owner Review', pbkStage: 'manual-review', avaNextStepCode: 'review_qualification' }],
}));
const input = {
  leadId: 'pbk-fixture', opportunityId: 'opportunity-fixture', locationId: 'sandbox-location',
  pipelineId: 'sandbox-pipeline', stageId: 'review', occurredAt: '2026-11-24T10:00:00.000Z',
};

test('accepts only the configured pipeline and copies its exact stage label', async () => {
  const writes = [];
  const write = async (event) => { writes.push(event); return 'updated'; };
  assert.equal((await acceptGhlStageEvent({ ...input, pipelineId: 'other' }, config, write)).status, 422);
  assert.equal((await acceptGhlStageEvent({ ...input, stageId: 'unknown' }, config, write)).status, 422);
  assert.equal((await acceptGhlStageEvent(input, config, write)).status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].stageLabel, 'Owner Review');
  assert.equal(writes[0].pbkStage, 'manual-review');
});

test('keeps the official stage order and maps an Ava recommendation to the same stage ID', () => {
  const view = buildGhlPipelineView({ ...input, nextStageId: 'research' }, config);
  assert.equal(view.currentStageLabel, 'Owner Review');
  assert.deepEqual(view.stages.map(({ id }) => id), ['research', 'review']);
  assert.equal(view.stages[1].avaNextStepCode, 'review_qualification');
  assert.equal(view.nextStageId, 'research');
});

test('looks up an identifier-only event and requires the returned opportunity to match', async () => {
  const { stageId, occurredAt, ...notification } = input;
  const returnedOpportunity = {
    id: input.opportunityId,
    locationId: input.locationId,
    pipelineId: input.pipelineId,
    pipelineStageId: stageId,
    lastStageChangeAt: occurredAt,
  };
  const writes = [];
  const write = async (event) => { writes.push(event); return 'updated'; };
  const read = async (id) => {
    assert.equal(id, input.opportunityId);
    return returnedOpportunity;
  };
  assert.equal((await acceptGhlStageEvent(notification, config, write, read)).result, 'updated');
  assert.equal(writes[0].stageId, stageId);
  assert.equal(writes[0].occurredAt, occurredAt);
  assert.equal((await acceptGhlStageEvent({ ...notification, pipelineId: 'other' },
    config, assert.fail, assert.fail)).status, 422);
  assert.equal((await acceptGhlStageEvent({ ...notification, stageId },
    config, assert.fail, assert.fail)).status, 422);
  assert.equal((await acceptGhlStageEvent(notification, config, assert.fail,
    async () => ({ ...returnedOpportunity, pipelineId: 'other' }))).status, 422);
  assert.equal((await acceptGhlStageEvent(notification, config, assert.fail,
    async () => null)).status, 503);
});

test('serializes stage changes, retains unrelated profile data and rejects old events', {
  skip: process.env.PBK_TEST_GHL_POSTGRES !== '1',
}, async () => {
  const { withRetentionPostgres } = await import('./fixtures/recording-retention-postgres.mjs');
  await withRetentionPostgres(async ({ pool }) => {
    await pool.query(`
      CREATE TABLE public.lead_profiles (
        workspace_id text, id text PRIMARY KEY, stage text, status text, raw jsonb, updated_at timestamptz
      );
      INSERT INTO public.lead_profiles VALUES
        ('pbk','pbk-fixture','new','new','{"assignment":{"owner":"Ava"},"dnc":true}',NOW()),
        ('pbk','pbk-other','new','new','{}',NOW());
    `);
    const apply = (event) => acceptGhlStageEvent(event, config, (normalized) => persistGhlStage(pool, normalized));
    const [first, replay] = await Promise.all([apply(input), apply(input)]);
    assert.deepEqual([first.result, replay.result].sort(), ['unchanged', 'updated']);
    assert.equal((await apply({ ...input, leadId: 'pbk-other' })).result, 'link_conflict');
    assert.equal((await apply({ ...input, opportunityId: 'other-opportunity' })).result, 'link_conflict');
    assert.equal((await apply({ ...input, stageId: 'research', occurredAt: '2026-11-24T09:00:00.000Z' })).result, 'unchanged');
    const { rows: [lead] } = await pool.query("SELECT * FROM public.lead_profiles WHERE id = 'pbk-fixture'");
    assert.equal(lead.stage, 'manual-review');
    assert.equal(lead.status, 'manual-review');
    assert.equal(lead.raw.assignment.owner, 'Ava');
    assert.equal(lead.raw.dnc, true);
  }, { supabaseRoles: false });
});

test('leaves unknown or conflicting lead links untouched and treats replays as successful', async () => {
  assert.equal((await acceptGhlStageEvent(input, config, async () => 'unknown_lead')).status, 404);
  assert.equal((await acceptGhlStageEvent(input, config, async () => 'link_conflict')).status, 409);
  assert.deepEqual(await acceptGhlStageEvent(input, config, async () => 'unchanged'), {
    status: 200, ok: true, result: 'unchanged',
  });
  assert.equal((await acceptGhlStageEvent({ ...input, occurredAt: 'not a timestamp' }, config, assert.fail)).status, 422);
});
