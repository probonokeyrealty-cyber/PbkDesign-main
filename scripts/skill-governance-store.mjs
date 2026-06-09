import { createHash } from 'node:crypto';

const TRUSTED_LEGACY_SOURCES = new Set(['war_manual', 'operator', 'manual', 'approved_migration']);
const TRUSTED_LEGACY_LEVELS = new Set(['approved', 'active', 'production', 'proven']);

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

export function classifyLegacySkillForMigration(row = {}) {
  const source = String(row.source || '')
    .trim()
    .toLowerCase();
  const level = String(row.level || '')
    .trim()
    .toLowerCase();
  const status = String(row.status || '')
    .trim()
    .toLowerCase();
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const explicitlyApproved = metadata.approved === true || metadata.approvalStatus === 'approved';
  const activate =
    status === 'active' &&
    (explicitlyApproved ||
      (TRUSTED_LEGACY_SOURCES.has(source) && TRUSTED_LEGACY_LEVELS.has(level)));
  return {
    activate,
    lifecycleState: activate ? 'active' : 'candidate',
    reason: activate ? 'trusted_legacy_compatibility' : 'requires_human_approval',
  };
}

export async function migrateLegacySkills(pool, input = {}) {
  return withPgTransaction(pool, async (client) => {
    const workspaceId = input.workspaceId || 'pbk';
    const actorId = input.actorId || 'skill-governance-migration';
    const counts = {
      activeMigrated: 0,
      candidatesMigrated: 0,
      alreadyMigrated: 0,
    };
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `skill_governance_migration:${workspaceId}`,
    ]);
    const legacy = await client.query(
      `SELECT id, workspace_id, agent_id, agent_name, name, source, level, status,
              confidence, evidence, metadata, created_at, updated_at
       FROM public.skills
       WHERE workspace_id = $1
       ORDER BY updated_at DESC, created_at DESC`,
      [workspaceId]
    );
    for (const row of legacy.rows || []) {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      if (metadata.governanceVersionId) {
        counts.alreadyMigrated += 1;
        continue;
      }
      const classification = classifyLegacySkillForMigration(row);
      const slug = slugifyLegacySkill(row);
      const versionInput = {
        workspaceId,
        slug,
        displayName: row.name || slug,
        ownerId: actorId,
        riskClass: metadata.riskClass || 'medium',
        source: row.source || 'legacy',
        definitionMetadata: {
          legacySkillId: row.id,
          legacyAgentId: row.agent_id || '',
          migrationReason: classification.reason,
        },
        instructions: buildLegacySkillInstructions(row),
        triggerPolicy: metadata.triggerPolicy || { source: 'legacy_skill' },
        inputSchema: metadata.inputSchema || {},
        outputSchema: metadata.outputSchema || {},
        toolAllowlist: metadata.toolAllowlist || [],
        sourceProvenance: {
          legacySkillId: row.id,
          source: row.source || '',
          level: row.level || '',
          status: row.status || '',
        },
        safetyScan: metadata.safetyScan || {},
        createdBy: actorId,
      };
      const { definition, version } = await createSkillVersionInTransaction(client, versionInput);
      if (classification.activate) {
        await approveAndActivateMigratedSkill(client, {
          workspaceId,
          actorId,
          agentId: row.agent_id || input.defaultAgentId || 'ava',
          version,
          classification,
        });
        counts.activeMigrated += 1;
      } else {
        counts.candidatesMigrated += 1;
      }
      await appendGovernanceEvent(client, {
        workspaceId,
        aggregateType: 'skill_version',
        aggregateId: version.id,
        eventType: classification.activate ? 'legacy_skill_active_migrated' : 'legacy_skill_candidate_migrated',
        actorId,
        payload: {
          legacySkillId: row.id,
          definitionId: definition.id,
          classification,
        },
      });
      await client.query(
        `UPDATE public.skills
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
         WHERE id = $1
           AND workspace_id = $3`,
        [
          row.id,
          JSON.stringify({
            governanceVersionId: version.id,
            governanceClassification: classification,
            governanceMigratedAt: new Date().toISOString(),
          }),
          workspaceId,
        ]
      );
    }
    return counts;
  });
}

export async function loadApprovedRuntimeSkills(pool, input = {}) {
  if (!pool?.query) return [];
  const workspaceId = input.workspaceId || 'pbk';
  const agentId = input.agentId || 'ava';
  const environment = input.environment || 'production';
  const result = await pool.query(
    `SELECT
       version.id AS version_id,
       definition.id AS definition_id,
       definition.slug,
       definition.display_name,
       definition.risk_class,
       version.content_hash,
       version.instructions,
       version.trigger_policy,
       version.input_schema,
       version.output_schema,
       version.tool_allowlist,
       version.source_provenance,
       version.safety_scan,
       version.lifecycle_state,
       assignment.agent_id,
       assignment.scope,
       assignment.priority,
       activation.id AS activation_id,
       activation.status AS activation_status,
       activation.rollout_mode,
       activation.rollout_percent,
       activation.rollback_thresholds,
       activation.activated_at,
       approval.id AS approval_id,
       approval.approver_id,
       approval.decided_at AS approved_at
     FROM public.skill_activations AS activation
     JOIN public.skill_versions AS version
       ON version.id = activation.subject_version_id
     JOIN public.skill_definitions AS definition
       ON definition.id = version.skill_definition_id
     JOIN public.agent_skill_assignments AS assignment
       ON assignment.subject_version_id = version.id
      AND assignment.subject_type = 'skill_version'
      AND assignment.workspace_id = activation.workspace_id
     JOIN public.skill_approvals AS approval
       ON approval.subject_version_id = version.id
      AND approval.subject_hash = version.content_hash
      AND approval.decision = 'approved'
     WHERE activation.workspace_id = $1
       AND ($2 = '' OR assignment.agent_id = $2)
       AND activation.environment = $3
       AND activation.subject_type = 'skill_version'
       AND activation.ended_at IS NULL
       AND assignment.effective_from <= NOW()
       AND (assignment.effective_until IS NULL OR assignment.effective_until > NOW())
       AND activation.status IN ('canary', 'active')
       AND version.lifecycle_state IN ('canary', 'active')
     ORDER BY assignment.priority ASC, activation.activated_at DESC`,
    [workspaceId, agentId, environment]
  );
  return (result.rows || []).map(normalizeRuntimeSkillRow);
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

function normalizeRuntimeSkillRow(row = {}) {
  return {
    id: row.version_id,
    versionId: row.version_id,
    definitionId: row.definition_id,
    activationId: row.activation_id,
    approvalId: row.approval_id,
    slug: row.slug || '',
    name: row.display_name || row.slug || '',
    displayName: row.display_name || row.slug || '',
    instructions: row.instructions || '',
    contentHash: row.content_hash || '',
    lifecycleState: row.lifecycle_state || '',
    status: row.activation_status || '',
    rolloutMode: row.rollout_mode || '',
    rolloutPercent: Number(row.rollout_percent || 0),
    riskClass: row.risk_class || 'medium',
    agentId: row.agent_id || '',
    priority: Number(row.priority || 100),
    triggerPolicy: row.trigger_policy || {},
    inputSchema: row.input_schema || {},
    outputSchema: row.output_schema || {},
    toolAllowlist: Array.isArray(row.tool_allowlist) ? row.tool_allowlist : [],
    sourceProvenance: row.source_provenance || {},
    safetyScan: row.safety_scan || {},
    scope: row.scope || {},
    rollbackThresholds: row.rollback_thresholds || {},
    approvedBy: row.approver_id || '',
    approvedAt: row.approved_at || null,
    activatedAt: row.activated_at || null,
  };
}

async function createSkillVersionInTransaction(client, input = {}) {
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
      Number(nextVersion.rows[0]?.version_number || 1),
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
  return { definition: definition.rows[0], version: version.rows[0] };
}

async function approveAndActivateMigratedSkill(client, input = {}) {
  const activationStatus = 'active';
  const version = input.version;
  const workspaceId = input.workspaceId || 'pbk';
  await client.query(
    `INSERT INTO public.skill_approvals (
       workspace_id, subject_type, subject_version_id, subject_hash,
       decision, approver_id, evidence_snapshot
     )
     VALUES ($1,'skill_version',$2,$3,'approved',$4,$5::jsonb)
     RETURNING *`,
    [
      workspaceId,
      version.id,
      version.content_hash,
      input.actorId,
      JSON.stringify({
        migrationReason: input.classification?.reason || 'trusted_legacy_compatibility',
      }),
    ]
  );
  await client.query(
    `INSERT INTO public.agent_skill_assignments (
       workspace_id, agent_id, subject_type, subject_version_id, scope,
       priority, effective_from, effective_until, created_by
     )
     VALUES ($1,$2,'skill_version',$3,$4::jsonb,100,NOW(),NULL,$5)
     RETURNING *`,
    [workspaceId, input.agentId || 'ava', version.id, JSON.stringify({ type: 'global' }), input.actorId]
  );
  await client.query(
    `INSERT INTO public.skill_activations (
       workspace_id, subject_type, subject_version_id, environment,
       rollout_mode, rollout_percent, status, rollback_thresholds, activated_by
     )
     VALUES ($1,'skill_version',$2,'production','full',100,$3,$4::jsonb,$5)
     RETURNING *`,
    [workspaceId, version.id, activationStatus, JSON.stringify({ migratedLegacy: true }), input.actorId]
  );
  await client.query(`UPDATE public.skill_versions SET lifecycle_state = $2 WHERE id = $1`, [
    version.id,
    activationStatus,
  ]);
}

function slugifyLegacySkill(row = {}) {
  const base = String(row.name || row.id || 'legacy-skill')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'legacy-skill';
}

function buildLegacySkillInstructions(row = {}) {
  const name = row.name || 'Legacy skill';
  const evidence = String(row.evidence || '').trim();
  if (evidence) return `${name}\n\nLegacy evidence:\n${evidence}`;
  return `${name}\n\nLegacy skill migrated from public.skills. Review before production use unless trusted by migration policy.`;
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
