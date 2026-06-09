import { createHash } from 'node:crypto';

export async function withPgTransaction(pool, callback) {
  if (!pool?.connect) throw new Error('A connected Render Postgres pool is required.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashSkillVersion(input = {}) {
  return createHash('sha256')
    .update(
      canonicalJson({
        instructions: String(input.instructions || ''),
        triggerPolicy: input.triggerPolicy || {},
        inputSchema: input.inputSchema || {},
        outputSchema: input.outputSchema || {},
        toolAllowlist: [...(input.toolAllowlist || [])].sort(),
        sourceProvenance: input.sourceProvenance || {},
      })
    )
    .digest('hex');
}

export async function createSkillCandidate(pool, input = {}) {
  return withPgTransaction(pool, async (client) => {
    const contentHash = hashSkillVersion(input);
    const workspaceId = input.workspaceId || 'pbk';
    const definition = await client.query(
      `INSERT INTO public.skill_definitions (
         workspace_id, slug, display_name, owner_id, risk_class, source, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (workspace_id, slug) DO UPDATE
       SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [
        workspaceId,
        input.slug,
        input.displayName,
        input.ownerId || input.createdBy,
        input.riskClass || 'medium',
        input.source || 'operator',
        JSON.stringify(input.definitionMetadata || {}),
      ]
    );
    const definitionId = definition.rows[0]?.id;
    const nextVersion = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
       FROM public.skill_versions
       WHERE skill_definition_id = $1`,
      [definitionId]
    );
    const versionNumber = Number(nextVersion.rows[0]?.version_number || 1);
    const version = await client.query(
      `INSERT INTO public.skill_versions (
         workspace_id, skill_definition_id, version_number, lifecycle_state,
         content_hash, instructions, trigger_policy, input_schema, output_schema,
         tool_allowlist, source_provenance, safety_scan, created_by
       )
       VALUES ($1,$2,$3,'candidate',$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,
               $9::text[],$10::jsonb,$11::jsonb,$12)
       ON CONFLICT (skill_definition_id, content_hash) DO UPDATE
       SET content_hash = EXCLUDED.content_hash
       RETURNING *`,
      [
        workspaceId,
        definitionId,
        versionNumber,
        contentHash,
        input.instructions || '',
        JSON.stringify(input.triggerPolicy || {}),
        JSON.stringify(input.inputSchema || {}),
        JSON.stringify(input.outputSchema || {}),
        input.toolAllowlist || [],
        JSON.stringify(input.sourceProvenance || {}),
        JSON.stringify(input.safetyScan || {}),
        input.createdBy,
      ]
    );
    await appendGovernanceEvent(client, {
      workspaceId,
      aggregateType: 'skill_version',
      aggregateId: version.rows[0].id,
      eventType: 'skill_candidate_created',
      actorId: input.createdBy,
      payload: { agentId: input.agentId || '', contentHash },
    });
    return { definition: definition.rows[0], version: version.rows[0] };
  });
}

export async function approveSkillVersion(pool, input = {}) {
  return withPgTransaction(pool, async (client) => {
    const workspaceId = input.workspaceId || 'pbk';
    const version = await selectVersionForUpdate(client, input.versionId);
    if (!version) throw new Error('Skill version not found.');
    if (input.expectedHash && input.expectedHash !== version.content_hash) {
      throw new Error('Skill version changed; approval is stale.');
    }
    const decision = input.decision || 'approved';
    const approval = await client.query(
      `INSERT INTO public.skill_approvals (
         workspace_id, subject_type, subject_version_id, subject_hash,
         decision, approver_id, evidence_snapshot
       )
       VALUES ($1,'skill_version',$2,$3,$4,$5,$6::jsonb)
       RETURNING *`,
      [
        workspaceId,
        version.id,
        version.content_hash,
        decision,
        input.approverId,
        JSON.stringify(input.evidenceSnapshot || {}),
      ]
    );
    const nextState = decision === 'approved' ? 'approved_inactive' : 'needs_review';
    await client.query(
      `UPDATE public.skill_versions
       SET lifecycle_state = $2
       WHERE id = $1`,
      [version.id, nextState]
    );
    await appendGovernanceEvent(client, {
      workspaceId,
      aggregateType: 'skill_version',
      aggregateId: version.id,
      eventType: `skill_${decision}`,
      actorId: input.approverId,
      payload: { approvalId: approval.rows[0].id, subjectHash: version.content_hash },
    });
    return approval.rows[0];
  });
}

export async function activateSkillVersion(pool, input = {}) {
  return withPgTransaction(pool, async (client) => {
    const workspaceId = input.workspaceId || 'pbk';
    const environment = input.environment || 'production';
    const version = await selectVersionForUpdate(client, input.versionId);
    if (!version) throw new Error('Skill version not found.');
    const approval = await selectCurrentApproval(client, version);
    if (!approval) throw new Error('A current approval is required before activation.');
    await client.query(
      `UPDATE public.skill_activations AS prior_activation
       SET status = 'paused', ended_at = NOW()
       FROM public.skill_versions AS prior_version
       JOIN public.agent_skill_assignments AS prior_assignment
         ON prior_assignment.subject_version_id = prior_version.id
       WHERE prior_activation.subject_version_id = prior_version.id
         AND prior_activation.workspace_id = $1
         AND prior_activation.subject_type = 'skill_version'
         AND prior_activation.environment = $2
         AND prior_activation.ended_at IS NULL
         AND prior_activation.status IN ('canary', 'active')
         AND prior_version.skill_definition_id = $3
         AND prior_assignment.agent_id = $4`,
      [workspaceId, environment, version.skill_definition_id, input.agentId]
    );
    const assignment = await client.query(
      `INSERT INTO public.agent_skill_assignments (
         workspace_id, agent_id, subject_type, subject_version_id, scope,
         priority, effective_from, effective_until, created_by
       )
       VALUES ($1,$2,'skill_version',$3,$4::jsonb,$5,NOW(),$6,$7)
       RETURNING *`,
      [
        workspaceId,
        input.agentId,
        version.id,
        JSON.stringify(input.scope || { type: 'global' }),
        Number(input.priority || 100),
        input.effectiveUntil || null,
        input.actorId,
      ]
    );
    const status = input.rolloutMode === 'full' ? 'active' : 'canary';
    const activation = await client.query(
      `INSERT INTO public.skill_activations (
         workspace_id, subject_type, subject_version_id, environment,
         rollout_mode, rollout_percent, status, rollback_thresholds, activated_by
       )
       VALUES ($1,'skill_version',$2,$3,$4,$5,$6,$7::jsonb,$8)
       RETURNING *`,
      [
        workspaceId,
        version.id,
        environment,
        input.rolloutMode || 'canary',
        input.rolloutMode === 'full' ? 100 : Number(input.rolloutPercent || 10),
        status,
        JSON.stringify(input.rollbackThresholds || {}),
        input.actorId,
      ]
    );
    await client.query(`UPDATE public.skill_versions SET lifecycle_state = $2 WHERE id = $1`, [
      version.id,
      status,
    ]);
    await appendGovernanceEvent(client, {
      workspaceId,
      aggregateType: 'skill_activation',
      aggregateId: activation.rows[0].id,
      eventType: 'skill_activated',
      actorId: input.actorId,
      payload: {
        versionId: version.id,
        assignmentId: assignment.rows[0].id,
        rolloutMode: activation.rows[0].rollout_mode,
      },
    });
    return { activation: activation.rows[0], assignment: assignment.rows[0] };
  });
}

export async function rollbackSkillActivation(pool, input = {}) {
  return withPgTransaction(pool, async (client) => {
    const workspaceId = input.workspaceId || 'pbk';
    const result = await client.query(
      `UPDATE public.skill_activations
       SET status = 'rolled_back', ended_at = NOW()
       WHERE id = $1
         AND workspace_id = $2
         AND ended_at IS NULL
       RETURNING *`,
      [input.activationId, workspaceId]
    );
    const activation = result.rows[0];
    if (!activation) throw new Error('Live skill activation not found.');
    await client.query(
      `UPDATE public.skill_versions
       SET lifecycle_state = 'rolled_back'
       WHERE id = $1`,
      [activation.subject_version_id]
    );
    await client.query(
      `UPDATE public.agent_skill_assignments
       SET effective_until = NOW()
       WHERE subject_type = $1
         AND subject_version_id = $2
         AND workspace_id = $3
         AND effective_until IS NULL`,
      [activation.subject_type, activation.subject_version_id, workspaceId]
    );
    await appendGovernanceEvent(client, {
      workspaceId,
      aggregateType: 'skill_activation',
      aggregateId: activation.id,
      eventType: 'skill_activation_rolled_back',
      actorId: input.actorId,
      payload: {
        reason: input.reason || 'operator_rollback',
        subjectVersionId: activation.subject_version_id,
      },
    });
    return {
      activation,
      actorId: input.actorId,
      reason: input.reason || 'operator_rollback',
    };
  });
}

async function selectVersionForUpdate(client, versionId) {
  const result = await client.query(
    `SELECT *
     FROM public.skill_versions
     WHERE id = $1
     FOR UPDATE`,
    [versionId]
  );
  return result.rows[0] || null;
}

async function selectCurrentApproval(client, version) {
  if (!version?.id) return null;
  const result = await client.query(
    `SELECT *
     FROM public.skill_approvals
     WHERE subject_type = 'skill_version'
       AND subject_version_id = $1
       AND subject_hash = $2
       AND decision = 'approved'
     ORDER BY decided_at DESC
     LIMIT 1`,
    [version.id, version.content_hash]
  );
  return result.rows[0] || null;
}

export async function appendGovernanceEvent(client, event = {}) {
  const workspaceId = event.workspaceId || 'pbk';
  const payload = event.payload || {};
  const payloadText = canonicalJson(payload);
  const payloadHash = createHash('sha256').update(payloadText).digest('hex');
  const audit = await client.query(
    `INSERT INTO public.skill_audit_events (
       workspace_id, aggregate_type, aggregate_id, event_type, actor_id, payload
     )
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     RETURNING id, created_at`,
    [
      workspaceId,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      event.actorId,
      JSON.stringify(payload),
    ]
  );
  const authorityVersion = Date.now();
  await client.query(
    `INSERT INTO public.skill_projection_outbox (
       workspace_id, aggregate_type, aggregate_id, authority_version,
       schema_version, dedupe_key, payload_hash, payload
     )
     VALUES ($1,$2,$3,$4,1,$5,$6,$7::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      workspaceId,
      event.aggregateType,
      event.aggregateId,
      authorityVersion,
      `${event.aggregateType}:${event.aggregateId}:${event.eventType}:${audit.rows[0].id}`,
      payloadHash,
      JSON.stringify({
        ...payload,
        auditEventId: audit.rows[0].id,
        eventType: event.eventType,
        authorityVersion,
      }),
    ]
  );
  return audit.rows[0];
}
