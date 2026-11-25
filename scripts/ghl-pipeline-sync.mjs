import { withPgTransaction } from './skill-governance-store.mjs';

const IDENTIFIER = /^[a-zA-Z0-9_-]{1,120}$/;
const STAGE = /^[a-z][a-z0-9_-]{0,59}$/;

export function readGhlPipelineConfig(value = '') {
  try {
    const config = JSON.parse(value);
    if (!IDENTIFIER.test(config?.locationId || '') || !IDENTIFIER.test(config?.pipelineId || '') ||
        typeof config.name !== 'string' || !config.name.trim() || !Array.isArray(config.stages) ||
        !config.stages.length || config.stages.length > 60) return null;
    const ids = new Set();
    const nextStepCodes = new Set();
    for (const stage of config.stages) {
      if (!IDENTIFIER.test(stage?.id || '') || ids.has(stage.id) ||
          typeof stage.label !== 'string' || !stage.label.trim() || !STAGE.test(stage.pbkStage || '')) return null;
      if (stage.avaNextStepCode !== undefined &&
          (typeof stage.avaNextStepCode !== 'string' || !STAGE.test(stage.avaNextStepCode) ||
            nextStepCodes.has(stage.avaNextStepCode))) return null;
      ids.add(stage.id);
      if (stage.avaNextStepCode) nextStepCodes.add(stage.avaNextStepCode);
    }
    return {
      locationId: config.locationId,
      pipelineId: config.pipelineId,
      name: config.name.trim().slice(0, 120),
      stages: config.stages.map(({ id, label, pbkStage, avaNextStepCode }) => ({
        id, label: label.trim().slice(0, 120), pbkStage,
        ...(typeof avaNextStepCode === 'string' && STAGE.test(avaNextStepCode) ? { avaNextStepCode } : {}),
      })),
    };
  } catch {
    return null;
  }
}

export function buildGhlPipelineView(link, config) {
  if (!link || !config || link.locationId !== config.locationId || link.pipelineId !== config.pipelineId) return null;
  const current = config.stages.find((stage) => stage.id === link.stageId);
  return {
    name: config.name,
    currentStageId: link.stageId,
    currentStageLabel: current?.label || link.stageLabel,
    occurredAt: link.occurredAt,
    nextStageId: link.nextStageId || '',
    stages: config.stages.map(({ id, label, avaNextStepCode }) => ({ id, label, avaNextStepCode })),
  };
}

export async function readGhlOpportunityStage(opportunityId, {
  token = process.env.PBK_GHL_PIPELINE_READ_TOKEN,
  fetchOpportunity = fetch,
} = {}) {
  if (!token) return null;
  try {
    const response = await fetchOpportunity(
      `https://services.leadconnectorhq.com/opportunities/${encodeURIComponent(opportunityId)}`,
      {
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
        redirect: 'error',
      },
    );
    if (!response.ok) return null;
    const { opportunity } = await response.json();
    return opportunity ?? null;
  } catch {
    return null;
  }
}

export async function acceptGhlStageEvent(input, config, write, readOpportunity = readGhlOpportunityStage) {
  if (!config) return { status: 503, ok: false, result: 'pipeline_unavailable' };
  const { leadId, opportunityId, locationId, pipelineId } = input || {};
  const invalid = { status: 422, ok: false, result: 'invalid_pipeline_event' };
  if (typeof leadId !== 'string' || !IDENTIFIER.test(leadId) || typeof opportunityId !== 'string' ||
      !IDENTIFIER.test(opportunityId) || locationId !== config.locationId || pipelineId !== config.pipelineId) return invalid;

  let { stageId, occurredAt } = input;
  if (stageId === undefined && occurredAt === undefined) {
    const opportunity = await readOpportunity(opportunityId);
    if (!opportunity) return { status: 503, ok: false, result: 'opportunity_lookup_unavailable' };
    if (opportunity.id !== opportunityId || opportunity.locationId !== locationId ||
        opportunity.pipelineId !== pipelineId) return invalid;
    stageId = opportunity.pipelineStageId;
    occurredAt = opportunity.lastStageChangeAt;
  }
  const date = typeof occurredAt === 'string' && /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(occurredAt)
    ? Date.parse(occurredAt) : NaN;
  const stage = config.stages.find((item) => item.id === stageId);
  if (!Number.isFinite(date) || date > Date.now() + 300_000 || !stage) return invalid;
  const result = await write({
    leadId, opportunityId, locationId, pipelineId, stageId, occurredAt: new Date(date).toISOString(),
    stageLabel: stage.label, pbkStage: stage.pbkStage,
  });
  const status = { updated: 200, unchanged: 200, unknown_lead: 404, link_conflict: 409 }[result] || 503;
  return { status, ok: status === 200, result };
}

export async function persistGhlStage(pool, { leadId, pbkStage, ...link }) {
  return withPgTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`pbk-ghl:${link.locationId}:${link.opportunityId}`]);
    const existingLink = await client.query(
      `SELECT id FROM public.lead_profiles
       WHERE COALESCE(workspace_id, 'pbk') = 'pbk' AND id <> $1
         AND raw #>> '{ghlPipeline,locationId}' = $2
         AND raw #>> '{ghlPipeline,opportunityId}' = $3 LIMIT 1`,
      [leadId, link.locationId, link.opportunityId]);
    if (existingLink.rows.length) return 'link_conflict';

    const profile = await client.query(
      "SELECT raw FROM public.lead_profiles WHERE COALESCE(workspace_id, 'pbk') = 'pbk' AND id = $1 FOR UPDATE",
      [leadId]);
    if (!profile.rows.length) return 'unknown_lead';
    const current = profile.rows[0].raw?.ghlPipeline;
    if (current && (current.opportunityId !== link.opportunityId || current.locationId !== link.locationId ||
        current.pipelineId !== link.pipelineId)) return 'link_conflict';
    if (current?.occurredAt >= link.occurredAt) return 'unchanged';
    await client.query(
      `UPDATE public.lead_profiles SET stage = $2, status = $2, updated_at = NOW(),
         raw = (CASE WHEN jsonb_typeof(raw) = 'object' THEN raw ELSE '{}'::jsonb END) || jsonb_build_object(
           'stage', $2::text, 'status', $2::text, 'ghlPipeline', $3::jsonb,
           'assignment', (CASE WHEN jsonb_typeof(raw->'assignment') = 'object' THEN raw->'assignment' ELSE '{}'::jsonb END)
             || jsonb_build_object('stage', $2::text)
         )
       WHERE COALESCE(workspace_id, 'pbk') = 'pbk' AND id = $1`,
      [leadId, pbkStage, JSON.stringify({ ...link, pbkStage })]);
    return 'updated';
  });
}
