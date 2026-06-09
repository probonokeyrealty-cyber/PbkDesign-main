# Skill Studio Phase 1 Authority Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Render Postgres the only operational authority for PBK skills, prevent every unapproved candidate from executing, add immutable versioned approvals and activations, and provide a last-known-good approved runtime snapshot.

**Architecture:** Add a focused skill-governance schema and store beside the existing bridge, then migrate trusted legacy skills into immutable definitions, versions, approvals, assignments, and activations. The runtime loads only currently approved and active Render rows, caches that exact snapshot in memory, Redis, and the runtime file, and fails closed when neither Render nor the cache can provide approved data. Supabase remains analytics-only; this phase creates transactional outbox events but does not project them yet.

**Tech Stack:** Node.js 22 ESM, PostgreSQL on Render, `pg`, Redis, existing PBK bridge routing, Jest 30, Node smoke tests, GitHub CI.

---

## Scope Boundary

This plan implements Phase 1 from the approved design:

- Candidate execution hardening.
- Immutable definitions and versions.
- Version-bound approval and separate activation.
- Agent assignment records required for runtime loading.
- Audit events and transactional projection outbox records.
- Last-known-good approved runtime snapshots.
- Removal of operational Supabase fallback reads and writes.
- Governance status and protected mutation endpoints.

It does not implement:

- YouTube, text, or file import UI.
- Skill Studio React screens.
- Scenario testing UI.
- Chain authoring.
- Supabase projection delivery.
- Outcome dashboards.

Those capabilities depend on the invariants established here and receive separate implementation plans after this release is green.

## File Structure

### New focused modules

- Create: `scripts/skill-governance-schema.mjs`
  - Own authoritative Render Postgres DDL and schema self-ensure.
- Create: `scripts/skill-governance-store.mjs`
  - Own transactions, immutable versions, approvals, assignments, activations, audit events, outbox rows, and legacy backfill.
- Create: `scripts/skill-runtime-snapshot.mjs`
  - Normalize, validate, cache, and restore approved runtime snapshots.
- Create: `scripts/skill-governance-schema.test.mjs`
- Create: `scripts/skill-governance-store.test.mjs`
- Create: `scripts/skill-runtime-snapshot.test.mjs`
- Create: `scripts/skill-governance-bridge-smoke.mjs`

### Existing modules

- Modify: `scripts/openclaw-local-server.mjs`
  - Ensure the schema, backfill trusted legacy rows, expose protected governance routes, remove operational Supabase fallbacks, and load approved snapshots.
- Modify: `scripts/auto-skill-learner.mjs`
  - Write candidate versions only and stop reloading candidates.
- Modify: `scripts/openclaw-local-server.mjs:19271-19420`
  - Replace direct active script catalog reads with approved snapshot inputs.
- Modify: `scripts/auto-skill-learner-smoke.mjs`
  - Verify candidate-only behavior.
- Modify: `scripts/context-aware-script-rotator-smoke.mjs`
  - Verify runtime inputs are approved snapshot records.
- Modify: `scripts/production-hardening-smoke.mjs`
  - Lock in fail-closed and no-Supabase-authority invariants.
- Modify: `scripts/live-data-audit.mjs`
  - Report authority, snapshot, approval, activation, and outbox health.
- Modify: `package.json`
  - Add focused test commands to the founder gate.
- Create: `docs/skill-governance-operations.md`
  - Document backfill, status, rollback, and failure behavior.

## Canonical Lifecycle Constants

All implementation tasks use these values:

```js
export const SKILL_VERSION_STATES = Object.freeze([
  'candidate',
  'needs_review',
  'test_ready',
  'testing',
  'failed',
  'ready_for_approval',
  'approved_inactive',
  'canary',
  'active',
  'paused',
  'rolled_back',
  'retired',
]);

export const EXECUTABLE_SKILL_STATES = new Set(['canary', 'active']);
export const ACTIVE_ACTIVATION_STATES = new Set(['canary', 'active']);
```

No other status string may make a version executable.

---

### Task 1: Add the Authoritative Skill Governance Schema

**Files:**

- Create: `scripts/skill-governance-schema.mjs`
- Create: `scripts/skill-governance-schema.test.mjs`

- [ ] **Step 1: Write the failing schema contract test**

```js
import { describe, expect, test } from '@jest/globals';
import { SKILL_GOVERNANCE_SCHEMA_SQL, SKILL_VERSION_STATES } from './skill-governance-schema.mjs';

describe('skill governance schema', () => {
  test('defines the authoritative versioned model', () => {
    for (const table of [
      'skill_definitions',
      'skill_versions',
      'skill_approvals',
      'agent_skill_assignments',
      'skill_activations',
      'skill_audit_events',
      'skill_projection_outbox',
    ]) {
      expect(SKILL_GOVERNANCE_SCHEMA_SQL).toContain(`public.${table}`);
      expect(SKILL_GOVERNANCE_SCHEMA_SQL).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      );
    }
    expect(SKILL_VERSION_STATES).toContain('candidate');
    expect(SKILL_VERSION_STATES).toContain('approved_inactive');
    expect(SKILL_VERSION_STATES).toContain('canary');
    expect(SKILL_VERSION_STATES).toContain('active');
    expect(SKILL_GOVERNANCE_SCHEMA_SQL).toContain('skill_projection_outbox_claim_idx');
    expect(SKILL_GOVERNANCE_SCHEMA_SQL).toContain('skill_activations_one_live_subject_uidx');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-governance-schema.test.mjs
```

Expected: FAIL because `scripts/skill-governance-schema.mjs` does not exist.

- [ ] **Step 3: Implement the schema module**

Create `scripts/skill-governance-schema.mjs` with:

```js
export const SKILL_VERSION_STATES = Object.freeze([
  'candidate',
  'needs_review',
  'test_ready',
  'testing',
  'failed',
  'ready_for_approval',
  'approved_inactive',
  'canary',
  'active',
  'paused',
  'rolled_back',
  'retired',
]);

export const EXECUTABLE_SKILL_STATES = new Set(['canary', 'active']);
export const ACTIVE_ACTIVATION_STATES = new Set(['canary', 'active']);

export const SKILL_GOVERNANCE_SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS public.skill_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    owner_id TEXT NOT NULL DEFAULT '',
    risk_class TEXT NOT NULL DEFAULT 'medium'
      CHECK (risk_class IN ('low', 'medium', 'high', 'critical')),
    source TEXT NOT NULL DEFAULT 'operator',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ,
    UNIQUE (workspace_id, slug)
  );

  CREATE TABLE IF NOT EXISTS public.skill_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    skill_definition_id UUID NOT NULL
      REFERENCES public.skill_definitions(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    lifecycle_state TEXT NOT NULL DEFAULT 'candidate'
      CHECK (lifecycle_state IN (
        'candidate', 'needs_review', 'test_ready', 'testing', 'failed',
        'ready_for_approval', 'approved_inactive', 'canary', 'active',
        'paused', 'rolled_back', 'retired'
      )),
    content_hash TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    trigger_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    tool_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    source_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    safety_scan JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (skill_definition_id, version_number),
    UNIQUE (skill_definition_id, content_hash)
  );

  CREATE TABLE IF NOT EXISTS public.skill_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    subject_type TEXT NOT NULL CHECK (subject_type IN ('skill_version', 'chain_version')),
    subject_version_id UUID NOT NULL,
    subject_hash TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    approver_id TEXT NOT NULL,
    evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.agent_skill_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    agent_id TEXT NOT NULL,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('skill_version', 'chain_version')),
    subject_version_id UUID NOT NULL,
    scope JSONB NOT NULL DEFAULT '{"type":"global"}'::jsonb,
    priority INTEGER NOT NULL DEFAULT 100,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.skill_activations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    subject_type TEXT NOT NULL CHECK (subject_type IN ('skill_version', 'chain_version')),
    subject_version_id UUID NOT NULL,
    environment TEXT NOT NULL DEFAULT 'production',
    rollout_mode TEXT NOT NULL DEFAULT 'canary'
      CHECK (rollout_mode IN ('canary', 'full')),
    rollout_percent INTEGER NOT NULL DEFAULT 10
      CHECK (rollout_percent BETWEEN 0 AND 100),
    status TEXT NOT NULL DEFAULT 'canary'
      CHECK (status IN ('canary', 'active', 'paused', 'rolled_back', 'retired')),
    rollback_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
    activated_by TEXT NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS public.skill_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.skill_projection_outbox (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    authority_version BIGINT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    dedupe_key TEXT NOT NULL UNIQUE,
    payload_hash TEXT NOT NULL,
    payload JSONB NOT NULL,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    delivered_at TIMESTAMPTZ,
    dead_lettered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS skill_activations_one_live_subject_uidx
    ON public.skill_activations
      (workspace_id, subject_type, subject_version_id, environment)
    WHERE ended_at IS NULL AND status IN ('canary', 'active');
  CREATE INDEX IF NOT EXISTS skill_versions_lifecycle_idx
    ON public.skill_versions (workspace_id, lifecycle_state, created_at DESC);
  CREATE INDEX IF NOT EXISTS skill_assignments_agent_effective_idx
    ON public.agent_skill_assignments
      (workspace_id, agent_id, effective_from, effective_until);
  CREATE INDEX IF NOT EXISTS skill_projection_outbox_claim_idx
    ON public.skill_projection_outbox
      (available_at, lease_expires_at, created_at)
    WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;

  ALTER TABLE public.skill_definitions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_versions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_approvals ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.agent_skill_assignments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_activations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_audit_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_projection_outbox ENABLE ROW LEVEL SECURITY;

  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON public.skill_definitions FROM anon;
      REVOKE ALL ON public.skill_versions FROM anon;
      REVOKE ALL ON public.skill_approvals FROM anon;
      REVOKE ALL ON public.agent_skill_assignments FROM anon;
      REVOKE ALL ON public.skill_activations FROM anon;
      REVOKE ALL ON public.skill_audit_events FROM anon;
      REVOKE ALL ON public.skill_projection_outbox FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON public.skill_definitions FROM authenticated;
      REVOKE ALL ON public.skill_versions FROM authenticated;
      REVOKE ALL ON public.skill_approvals FROM authenticated;
      REVOKE ALL ON public.agent_skill_assignments FROM authenticated;
      REVOKE ALL ON public.skill_activations FROM authenticated;
      REVOKE ALL ON public.skill_audit_events FROM authenticated;
      REVOKE ALL ON public.skill_projection_outbox FROM authenticated;
    END IF;
  END $$;
`;

export async function ensureSkillGovernanceSchema(pool) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  await pool.query(SKILL_GOVERNANCE_SCHEMA_SQL);
  return { ok: true, result: 'skill_governance_schema_ready' };
}
```

- [ ] **Step 4: Run the schema test**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-governance-schema.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/skill-governance-schema.mjs scripts/skill-governance-schema.test.mjs
git commit -m "feat: add authoritative skill governance schema"
```

---

### Task 2: Add Transactional Governance Store Operations

**Files:**

- Create: `scripts/skill-governance-store.mjs`
- Create: `scripts/skill-governance-store.test.mjs`

- [ ] **Step 1: Write failing transaction and lifecycle tests**

The test must use a fake pool that records `BEGIN`, `COMMIT`, `ROLLBACK`, and SQL calls:

```js
import { describe, expect, test } from '@jest/globals';
import {
  activateSkillVersion,
  approveSkillVersion,
  createSkillCandidate,
  rollbackSkillActivation,
} from './skill-governance-store.mjs';

function fakePool(respond) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return respond(sql, params, queries);
    },
    release() {},
  };
  return {
    queries,
    async connect() {
      return client;
    },
  };
}

test('candidate creation never creates an approval or activation', async () => {
  const pool = fakePool((sql) => {
    if (/INSERT INTO public\.skill_definitions/.test(sql)) {
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
    }
    if (/INSERT INTO public\.skill_versions/.test(sql)) {
      return {
        rows: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            lifecycle_state: 'candidate',
            content_hash: 'hash-1',
          },
        ],
      };
    }
    if (/MAX\(version_number\)/.test(sql)) {
      return { rows: [{ version_number: 1 }] };
    }
    return { rows: [] };
  });

  const result = await createSkillCandidate(pool, {
    workspaceId: 'pbk',
    slug: 'price-gap-discovery',
    displayName: 'Price-gap discovery',
    instructions: 'Ask one calibrated price-gap question.',
    agentId: 'ava',
    createdBy: 'test-operator',
  });

  expect(result.version.lifecycle_state).toBe('candidate');
  expect(pool.queries.some(({ sql }) => /skill_approvals/.test(sql))).toBe(false);
  expect(pool.queries.some(({ sql }) => /skill_activations/.test(sql))).toBe(false);
  expect(pool.queries.at(0).sql).toBe('BEGIN');
  expect(pool.queries.at(-1).sql).toBe('COMMIT');
});

test('activation rejects a stale or missing approval', async () => {
  const pool = fakePool((sql) => {
    if (/FROM public\.skill_versions/.test(sql)) {
      return { rows: [{ id: 'version-1', content_hash: 'current-hash' }] };
    }
    if (/FROM public\.skill_approvals/.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  await expect(
    activateSkillVersion(pool, {
      versionId: 'version-1',
      agentId: 'ava',
      actorId: 'operator-1',
    })
  ).rejects.toThrow(/current approval/i);
  expect(pool.queries.at(-1).sql).toBe('ROLLBACK');
});

test('rollback closes the live activation and appends audit and outbox rows', async () => {
  const pool = fakePool((sql) => {
    if (/UPDATE public\.skill_activations/.test(sql)) {
      return {
        rows: [
          {
            id: 'activation-1',
            subject_version_id: 'version-1',
            status: 'rolled_back',
          },
        ],
      };
    }
    return { rows: [] };
  });

  await rollbackSkillActivation(pool, {
    activationId: 'activation-1',
    actorId: 'operator-1',
    reason: 'canary_quality_regression',
  });

  expect(pool.queries.some(({ sql }) => /skill_audit_events/.test(sql))).toBe(true);
  expect(pool.queries.some(({ sql }) => /skill_projection_outbox/.test(sql))).toBe(true);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-governance-store.test.mjs
```

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement transaction and hash helpers**

Start `scripts/skill-governance-store.mjs` with:

```js
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

export function hashSkillVersion(input) {
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
```

- [ ] **Step 4: Implement the candidate, approval, activation, and rollback contracts**

The module must export:

```js
export async function createSkillCandidate(pool, input) {
  return withPgTransaction(pool, async (client) => {
    const contentHash = hashSkillVersion(input);
    const definition = await client.query(
      `INSERT INTO public.skill_definitions (
         workspace_id, slug, display_name, owner_id, risk_class, source, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (workspace_id, slug) DO UPDATE
       SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [
        input.workspaceId || 'pbk',
        input.slug,
        input.displayName,
        input.ownerId || input.createdBy,
        input.riskClass || 'medium',
        input.source || 'operator',
        JSON.stringify(input.definitionMetadata || {}),
      ]
    );
    const nextVersion = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
       FROM public.skill_versions
       WHERE skill_definition_id = $1`,
      [definition.rows[0].id]
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
        input.workspaceId || 'pbk',
        definition.rows[0].id,
        Number(nextVersion.rows[0].version_number),
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
      aggregateType: 'skill_version',
      aggregateId: version.rows[0].id,
      eventType: 'skill_candidate_created',
      actorId: input.createdBy,
      payload: { agentId: input.agentId || '', contentHash },
    });
    return { definition: definition.rows[0], version: version.rows[0] };
  });
}

export async function approveSkillVersion(pool, input) {
  return withPgTransaction(pool, async (client) => {
    const version = await selectVersionForUpdate(client, input.versionId);
    if (!version) throw new Error('Skill version not found.');
    if (input.expectedHash && input.expectedHash !== version.content_hash) {
      throw new Error('Skill version changed; approval is stale.');
    }
    const approval = await client.query(
      `INSERT INTO public.skill_approvals (
         workspace_id, subject_type, subject_version_id, subject_hash,
         decision, approver_id, evidence_snapshot
       )
       VALUES ($1,'skill_version',$2,$3,$4,$5,$6::jsonb)
       RETURNING *`,
      [
        input.workspaceId || 'pbk',
        version.id,
        version.content_hash,
        input.decision || 'approved',
        input.approverId,
        JSON.stringify(input.evidenceSnapshot || {}),
      ]
    );
    const nextState = input.decision === 'approved' ? 'approved_inactive' : 'needs_review';
    await client.query(
      `UPDATE public.skill_versions
       SET lifecycle_state = $2
       WHERE id = $1`,
      [version.id, nextState]
    );
    await appendGovernanceEvent(client, {
      aggregateType: 'skill_version',
      aggregateId: version.id,
      eventType: `skill_${input.decision || 'approved'}`,
      actorId: input.approverId,
      payload: { approvalId: approval.rows[0].id, subjectHash: version.content_hash },
    });
    return approval.rows[0];
  });
}

export async function activateSkillVersion(pool, input) {
  return withPgTransaction(pool, async (client) => {
    const version = await selectVersionForUpdate(client, input.versionId);
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
      [
        input.workspaceId || 'pbk',
        input.environment || 'production',
        version.skill_definition_id,
        input.agentId,
      ]
    );
    const assignment = await client.query(
      `INSERT INTO public.agent_skill_assignments (
         workspace_id, agent_id, subject_type, subject_version_id, scope,
         priority, effective_from, effective_until, created_by
       )
       VALUES ($1,$2,'skill_version',$3,$4::jsonb,$5,NOW(),$6,$7)
       RETURNING *`,
      [
        input.workspaceId || 'pbk',
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
        input.workspaceId || 'pbk',
        version.id,
        input.environment || 'production',
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
```

Add these helper bodies in the same file:

```js
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

async function appendGovernanceEvent(client, event) {
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
      event.workspaceId || 'pbk',
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
      event.workspaceId || 'pbk',
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

export async function rollbackSkillActivation(pool, input) {
  return withPgTransaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE public.skill_activations
       SET status = 'rolled_back', ended_at = NOW()
       WHERE id = $1
         AND workspace_id = $2
         AND ended_at IS NULL
       RETURNING *`,
      [input.activationId, input.workspaceId || 'pbk']
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
      [activation.subject_type, activation.subject_version_id, input.workspaceId || 'pbk']
    );
    await appendGovernanceEvent(client, {
      workspaceId: input.workspaceId || 'pbk',
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
```

- [ ] **Step 5: Run the store tests**

Run:

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-governance-store.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/skill-governance-store.mjs scripts/skill-governance-store.test.mjs
git commit -m "feat: add transactional skill governance store"
```

---

### Task 3: Backfill Trusted Legacy Skills Without Activating Candidates

**Files:**

- Modify: `scripts/skill-governance-store.mjs`
- Modify: `scripts/skill-governance-store.test.mjs`
- Modify: `scripts/openclaw-local-server.mjs:5960-5985`

- [ ] **Step 1: Add failing compatibility-rule tests**

```js
import { classifyLegacySkillForMigration, migrateLegacySkills } from './skill-governance-store.mjs';

test('only explicitly trusted legacy rows remain executable', () => {
  expect(
    classifyLegacySkillForMigration({
      source: 'war_manual',
      level: 'active',
      status: 'active',
    }).activate
  ).toBe(true);
  expect(
    classifyLegacySkillForMigration({
      source: 'operator',
      level: 'approved',
      status: 'active',
    }).activate
  ).toBe(true);
  expect(
    classifyLegacySkillForMigration({
      source: 'auto_learner',
      level: 'candidate',
      status: 'active',
    }).activate
  ).toBe(false);
  expect(
    classifyLegacySkillForMigration({
      source: 'skill_outcome',
      level: 'measured',
      status: 'active',
    }).activate
  ).toBe(false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-governance-store.test.mjs
```

Expected: FAIL because the compatibility helpers are missing.

- [ ] **Step 3: Implement conservative migration rules**

Add:

```js
const TRUSTED_LEGACY_SOURCES = new Set(['war_manual', 'operator', 'manual', 'approved_migration']);

const TRUSTED_LEGACY_LEVELS = new Set(['approved', 'active', 'production', 'proven']);

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
  const explicitlyApproved =
    row.metadata?.approved === true || row.metadata?.approvalStatus === 'approved';
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
```

Implement `migrateLegacySkills(pool, { workspaceId = 'pbk', actorId })`:

1. Lock one advisory migration key.
2. Read legacy `public.skills`.
3. Skip rows already carrying `metadata.governanceVersionId`.
4. Create one definition and immutable version per legacy row.
5. For trusted rows only, create approval, global agent assignment, and full activation.
6. For every other row, create a candidate only.
7. Write the new version ID and migration classification into legacy metadata.
8. Add audit and outbox records in the same transaction.
9. Return counts for `activeMigrated`, `candidatesMigrated`, and `alreadyMigrated`.

- [ ] **Step 4: Wire schema ensure and migration into bridge startup**

At the import section of `scripts/openclaw-local-server.mjs`:

```js
import { ensureSkillGovernanceSchema } from './skill-governance-schema.mjs';
import { migrateLegacySkills } from './skill-governance-store.mjs';
```

Inside `ensurePbkOperationalTables(pool)` after conversation schema:

```js
await ensureSkillGovernanceSchema(pool);
await migrateLegacySkills(pool, {
  workspaceId: 'pbk',
  actorId: 'pbk-skill-governance-migration',
});
```

Do not remove the legacy tables in this phase.

- [ ] **Step 5: Run tests**

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-governance-store.test.mjs scripts/skill-governance-schema.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/skill-governance-store.mjs scripts/skill-governance-store.test.mjs scripts/openclaw-local-server.mjs
git commit -m "feat: migrate trusted legacy skills safely"
```

---

### Task 4: Make Auto Skill Learning Candidate-Only

**Files:**

- Modify: `scripts/auto-skill-learner.mjs:106-174`
- Modify: `scripts/auto-skill-learner.mjs:369-470`
- Modify: `scripts/auto-skill-learner-smoke.mjs`
- Modify: `scripts/openclaw-local-server.mjs:44314-44345`

- [ ] **Step 1: Replace smoke expectations with candidate-only invariants**

Add assertions:

```js
const candidateQueries = [];
const candidatePool = {
  async query(sql, params = []) {
    candidateQueries.push({ sql, params });
    if (/INSERT INTO public\.skill_definitions/.test(sql)) {
      return { rows: [{ id: 'definition-1' }] };
    }
    if (/MAX\(version_number\)/.test(sql)) {
      return { rows: [{ version_number: 1 }] };
    }
    if (/INSERT INTO public\.skill_versions/.test(sql)) {
      return {
        rows: [
          {
            id: 'version-1',
            lifecycle_state: 'candidate',
            content_hash: 'hash-1',
          },
        ],
      };
    }
    return { rows: [] };
  },
};

const created = await insertSkillCandidate(
  candidatePool,
  {
    skill_name: 'Price gap',
    skill_type: 'objection_handler',
    trigger_keywords: ['too low'],
    content: 'Ask what evidence would close the price gap.',
    confidence: 0.7,
  },
  'call-1',
  {
    createCandidate: async (_pool, input) => {
      expect(input.createdBy).toBe('auto-skill-learner');
      return {
        definition: { id: 'definition-1' },
        version: { id: 'version-1', lifecycle_state: 'candidate' },
      };
    },
  }
);

assert.equal(created.version.lifecycle_state, 'candidate');
assert.equal(
  candidateQueries.some(({ sql }) => /coach_memory|probe_questions/.test(sql)),
  false,
  'Auto extraction must not bypass governance through active memory or probe tables.'
);
```

Also change the existing reload assertion:

```js
assert.equal(
  reloadPayload,
  null,
  'Candidate creation and confidence changes must not trigger active runtime reloads.'
);
```

- [ ] **Step 2: Run the smoke test and verify it fails**

```powershell
node scripts/auto-skill-learner-smoke.mjs
```

Expected: FAIL because objection handlers and probes still bypass governance and changed rows still trigger reload.

- [ ] **Step 3: Route every extracted type through `createSkillCandidate`**

In `scripts/auto-skill-learner.mjs`:

```js
import { createSkillCandidate } from './skill-governance-store.mjs';
```

Replace `insertSkillCandidate` with:

```js
export async function insertSkillCandidate(pool, candidate, callId, options = {}) {
  const name = String(candidate.skill_name || candidate.name || '')
    .trim()
    .slice(0, 120);
  const instructions = String(
    candidate.content || candidate.response || candidate.question || ''
  ).trim();
  if (!name || !instructions) return null;
  const keywords = Array.isArray(candidate.trigger_keywords)
    ? candidate.trigger_keywords
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const createCandidate = options.createCandidate || createSkillCandidate;
  return createCandidate(pool, {
    workspaceId: 'pbk',
    slug: `auto-${String(callId)}-${name}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120),
    displayName: name,
    ownerId: 'ava',
    agentId: 'ava',
    riskClass: 'medium',
    source: 'auto_learner',
    instructions,
    triggerPolicy: {
      keywords,
      skillType: String(candidate.skill_type || 'closing_tactic'),
    },
    sourceProvenance: {
      sourceSystem: 'successful_call',
      sourceId: String(callId),
      extractorVersion: 'auto-skill-learner-v2',
    },
    safetyScan: { status: 'pending' },
    createdBy: 'auto-skill-learner',
  });
}
```

Do not insert extracted content directly into `coach_memory`, `probe_questions`, or legacy `skills`.

- [ ] **Step 4: Stop auto-reload and auto-promotion**

In `runAutoSkillLearner`:

```js
const changed = [...boosted, ...decayed];
const reloadResult = null;
```

Return:

```js
requiresReviewCount: created.length,
reloadResult,
```

In `runRexSkillAutopilotRecord`, replace direct `promote_skill` execution with an approval proposal:

```js
const decision = await createRexDecision(
  {
    tool: 'request_skill_approval',
    params: {
      agentId: params.agentId || params.agent || 'ava',
      skillName,
      version,
      summary,
    },
    rationale: `${skillName} met the measured promotion threshold and requires human approval.`,
    actor: params.actor || 'Rex Skill Autopilot',
    source: 'skill-outcome-loop',
    requestApproval: true,
  },
  {
    requestApproval: true,
    actor: params.actor || 'Rex Skill Autopilot',
    source: 'skill-outcome-loop',
  }
);
actions.push({ type: 'queue_skill_approval', ok: decision.ok, decision });
```

In the bridge tool wrapper, remove both calls to `runAutoSkillLearnerSupabaseRest`. Return the original Postgres failure:

```js
if (result?.ok === false) {
  return {
    ...result,
    result: 'skill_authority_unavailable',
    fallbackUsed: false,
  };
}
```

- [ ] **Step 5: Run focused tests**

```powershell
node scripts/auto-skill-learner-smoke.mjs
npm run test:ava-negotiation-learning-loop
```

Expected: both PASS; no extracted candidate is reloaded or promoted.

- [ ] **Step 6: Commit**

```powershell
git add scripts/auto-skill-learner.mjs scripts/auto-skill-learner-smoke.mjs scripts/openclaw-local-server.mjs
git commit -m "fix: keep learned skills behind approval"
```

---

### Task 5: Add Approved Runtime Snapshot Loading and Fail-Closed Recovery

**Files:**

- Create: `scripts/skill-runtime-snapshot.mjs`
- Create: `scripts/skill-runtime-snapshot.test.mjs`
- Modify: `scripts/openclaw-local-server.mjs:39768-39842`
- Modify: `scripts/context-aware-script-rotator-smoke.mjs`

- [ ] **Step 1: Write failing snapshot tests**

```js
import { describe, expect, test } from '@jest/globals';
import {
  createSkillRuntimeSnapshotCache,
  normalizeRuntimeSkill,
} from './skill-runtime-snapshot.mjs';

test('normalization rejects non-executable lifecycle states', () => {
  expect(() =>
    normalizeRuntimeSkill({
      versionId: 'version-1',
      lifecycleState: 'candidate',
      activationStatus: 'active',
    })
  ).toThrow(/not executable/i);
});

test('cache returns the last approved snapshot when Render is unavailable', async () => {
  const values = new Map();
  const cache = createSkillRuntimeSnapshotCache({
    redisGetJson: async (key) => values.get(key) || null,
    redisSetJson: async (key, value) => values.set(key, value),
    readFileJson: async () => null,
    writeFileJson: async () => {},
  });
  await cache.save({
    authority: 'render-postgres',
    generatedAt: '2026-06-09T00:00:00.000Z',
    skills: [
      {
        versionId: 'version-1',
        definitionId: 'definition-1',
        name: 'Trusted skill',
        agentId: 'ava',
        lifecycleState: 'active',
        activationStatus: 'active',
        contentHash: 'hash-1',
      },
    ],
  });
  const restored = await cache.load();
  expect(restored.skills).toHaveLength(1);
  expect(restored.authority).toBe('render-postgres');
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-runtime-snapshot.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the cache module**

The module must:

- Accept injected Redis and file adapters.
- Keep a module-local memory snapshot.
- Save only snapshots whose `authority` is `render-postgres`.
- Reject any skill whose version or activation state is not `canary` or `active`.
- Require `versionId`, `definitionId`, `agentId`, `contentHash`, and `name`.
- Load in order: memory, Redis, runtime file.
- Return `null` if every source is empty or invalid.

Use this public implementation shape:

```js
export function createSkillRuntimeSnapshotCache({
  redisGetJson,
  redisSetJson,
  readFileJson,
  writeFileJson,
  redisKey = 'pbk:skill-runtime:approved',
} = {}) {
  let memorySnapshot = null;
  async function readRedis() {
    if (typeof redisGetJson !== 'function') return null;
    return validateRuntimeSnapshot(await redisGetJson(redisKey));
  }
  async function readFileSnapshot() {
    if (typeof readFileJson !== 'function') return null;
    return validateRuntimeSnapshot(await readFileJson());
  }
  return {
    async save(snapshot) {
      const normalized = validateRuntimeSnapshot(snapshot);
      if (!normalized) throw new Error('Only valid Render-approved snapshots can be saved.');
      memorySnapshot = normalized;
      if (typeof redisSetJson === 'function') {
        await redisSetJson(redisKey, normalized, 60 * 60 * 24);
      }
      if (typeof writeFileJson === 'function') {
        await writeFileJson(normalized);
      }
      return normalized;
    },
    async load() {
      return (
        validateRuntimeSnapshot(memorySnapshot) || (await readRedis()) || (await readFileSnapshot())
      );
    },
    clearMemory() {
      memorySnapshot = null;
    },
  };
}
```

Also export:

```js
export function normalizeRuntimeSkill(row = {}) {
  if (!['canary', 'active'].includes(row.lifecycleState)) {
    throw new Error(`Skill version ${row.versionId || ''} is not executable.`);
  }
  if (!['canary', 'active'].includes(row.activationStatus)) {
    throw new Error(`Skill activation ${row.activationId || ''} is not executable.`);
  }
  for (const field of ['versionId', 'definitionId', 'agentId', 'contentHash', 'name']) {
    if (!String(row[field] || '').trim()) {
      throw new Error(`Runtime skill is missing ${field}.`);
    }
  }
  return {
    versionId: String(row.versionId),
    definitionId: String(row.definitionId),
    activationId: String(row.activationId || ''),
    name: String(row.name),
    agentId: String(row.agentId),
    lifecycleState: row.lifecycleState,
    activationStatus: row.activationStatus,
    contentHash: String(row.contentHash),
    instructions: String(row.instructions || ''),
    triggerPolicy: row.triggerPolicy || {},
    toolAllowlist: Array.isArray(row.toolAllowlist) ? row.toolAllowlist : [],
    scope: row.scope || { type: 'global' },
    priority: Number(row.priority || 100),
  };
}

export function validateRuntimeSnapshot(snapshot) {
  if (!snapshot || snapshot.authority !== 'render-postgres') return null;
  const skills = Array.isArray(snapshot.skills) ? snapshot.skills.map(normalizeRuntimeSkill) : [];
  return {
    authority: 'render-postgres',
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    skills,
  };
}
```

- [ ] **Step 4: Add the approved Render query**

Add `loadApprovedRuntimeSkills(pool, options)` to `skill-governance-store.mjs`:

```sql
SELECT
  version.id AS "versionId",
  definition.id AS "definitionId",
  definition.display_name AS name,
  assignment.agent_id AS "agentId",
  version.lifecycle_state AS "lifecycleState",
  version.content_hash AS "contentHash",
  version.instructions,
  version.trigger_policy AS "triggerPolicy",
  version.tool_allowlist AS "toolAllowlist",
  activation.id AS "activationId",
  activation.status AS "activationStatus",
  activation.rollout_mode AS "rolloutMode",
  activation.rollout_percent AS "rolloutPercent",
  assignment.scope,
  assignment.priority
FROM public.skill_activations activation
JOIN public.skill_versions version
  ON version.id = activation.subject_version_id
JOIN public.skill_definitions definition
  ON definition.id = version.skill_definition_id
JOIN public.agent_skill_assignments assignment
  ON assignment.subject_version_id = version.id
WHERE activation.workspace_id = $1
  AND activation.environment = $2
  AND activation.ended_at IS NULL
  AND activation.status IN ('canary', 'active')
  AND version.lifecycle_state IN ('canary', 'active')
  AND assignment.effective_from <= NOW()
  AND (assignment.effective_until IS NULL OR assignment.effective_until > NOW())
  AND EXISTS (
    SELECT 1
    FROM public.skill_approvals approval
    WHERE approval.subject_type = 'skill_version'
      AND approval.subject_version_id = version.id
      AND approval.subject_hash = version.content_hash
      AND approval.decision = 'approved'
  )
ORDER BY assignment.agent_id, assignment.priority DESC, definition.display_name;
```

- [ ] **Step 5: Replace `reloadActiveSkillsIntoBridgeState`**

Rename it to `reloadApprovedSkillsIntoBridgeState`.

Behavior:

1. Query `loadApprovedRuntimeSkills`.
2. On success, save the exact approved snapshot.
3. On Postgres failure, load the last-known-good snapshot.
4. If neither exists, return HTTP-safe failure:

```js
{
  ok: false,
  result: 'skill_authority_unavailable',
  source: 'none',
  skillsReloaded: 0,
  agentsUpdated: 0,
  failClosed: true,
}
```

5. Replace each agent's governed skill set instead of merging stale governed rows.
6. Never call `fetchSkillOutcomesFromSupabaseRest`.
7. Mark cached rows with `snapshotSource: 'last-known-good-render'`.

Use the existing `redisGetJson`, `redisSetJson`, `redisKey`, `RUNTIME_DIR`, `readFile`, and `writeFile` adapters when constructing the cache.

Also update the Ava script library path called out by the backend review:

- `loadContextAwareScriptCatalog` must stop reading `public.scripts WHERE active = TRUE` as an executable source unless the row is tied to an approved active governance version.
- `buildAvaScriptRotationSnapshot` must include `versionId`, `contentHash`, and `snapshotGeneratedAt`.
- `buildContextAwareScriptLibrary` must accept approved snapshot records first and use legacy active scripts only as display-only fallback when no live call is selecting a script.
- `selectContextAwareScript` remains the scorer; the inputs to it are what become authority-gated.

- [ ] **Step 6: Update the rotator smoke**

Add a static invariant:

```js
assert(
  /loadApprovedRuntimeSkills/.test(bridgeSource) &&
    /reloadApprovedSkillsIntoBridgeState/.test(bridgeSource),
  'Runtime skill reload must use approved Render-backed versions.'
);
assert(
  !/reloadActiveSkillsIntoBridgeState[\s\S]*fetchSkillOutcomesFromSupabaseRest/.test(bridgeSource),
  'Runtime reload must never use Supabase as operational authority.'
);
```

- [ ] **Step 7: Run focused tests**

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-runtime-snapshot.test.mjs scripts/skill-governance-store.test.mjs
npm run test:script-rotator
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add scripts/skill-runtime-snapshot.mjs scripts/skill-runtime-snapshot.test.mjs scripts/skill-governance-store.mjs scripts/openclaw-local-server.mjs scripts/context-aware-script-rotator-smoke.mjs
git commit -m "feat: load approved skill snapshots fail closed"
```

---

### Task 6: Remove Supabase From Operational Skill Authority

**Files:**

- Modify: `scripts/openclaw-local-server.mjs:39527-39765`
- Modify: `scripts/openclaw-local-server.mjs:21111-21257`
- Modify: `scripts/production-hardening-smoke.mjs`

- [ ] **Step 1: Add failing source-level safety assertions**

Append:

```js
assert(
  !/runAutoSkillLearnerSupabaseRest/.test(bridge),
  'Auto skill learning must never mutate Supabase as a fallback authority.'
);
assert(
  !/persistSkillUsageToSupabaseRest/.test(bridge),
  'Skill outcome recording must never create or update operational skills through Supabase.'
);
assert(
  !/source:\s*'supabase-rest'[\s\S]*skillsReloaded/.test(bridge),
  'Runtime skill reload must not accept a Supabase projection.'
);
assert(
  /skill_authority_unavailable/.test(bridge) && /failClosed:\s*true/.test(bridge),
  'Skill authority failure must be explicit and fail closed.'
);
```

- [ ] **Step 2: Run and verify failure**

```powershell
npm run test:production-hardening
```

Expected: FAIL because the old fallback functions still exist.

- [ ] **Step 3: Delete mutation fallbacks**

Remove:

- `runAutoSkillLearnerSupabaseRest`.
- `normalizeSkillUsageRestRows`.
- `persistSkillUsageToSupabaseRest`.
- Calls that fall back to either function.

When Render Postgres skill usage persistence fails, retain the already-recorded in-memory outcome event but return:

```js
storage: {
  renderPostgres: false,
  supabaseProjection: false,
  projectionPending: false,
},
warning: 'Skill authority unavailable; no operational skill mutation was attempted.',
```

Do not create a legacy skill from an outcome. Outcomes may update analytics, but they cannot create an executable version.

- [ ] **Step 4: Keep Supabase reads explicitly analytical**

Rename `fetchSkillOutcomesFromSupabaseRest` to:

```js
fetchSkillAnalyticsProjectionFromSupabase;
```

Allow it only inside read-only Memory & Analytics responses. Its returned source must be:

```js
source: 'supabase-analytics-mirror';
```

It must never feed:

- Runtime reload.
- Candidate creation.
- Approval.
- Activation.
- Assignment.
- Confidence mutation.

Rename misleading response labels from `source: 'supabase'` to either:

- `render-postgres`
- `supabase-analytics-mirror`
- `bridge-state-display-fallback`

- [ ] **Step 5: Run tests**

```powershell
npm run test:production-hardening
npm run test:analytics-live-data
npm run test:memory-prototype-modern
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/openclaw-local-server.mjs scripts/production-hardening-smoke.mjs
git commit -m "fix: remove Supabase skill authority fallbacks"
```

---

### Task 7: Expose Protected Approval, Activation, Rollback, and Status Routes

**Files:**

- Modify: `scripts/openclaw-local-server.mjs:59493-59535`
- Create: `scripts/skill-governance-bridge-smoke.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing bridge smoke**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bridge = readFileSync(resolve(process.cwd(), 'scripts/openclaw-local-server.mjs'), 'utf8');

for (const contract of [
  '/api/skills/governance/status',
  '/api/skills/versions/:versionId/approve',
  '/api/skills/versions/:versionId/activate',
  '/api/skills/activations/:activationId/rollback',
]) {
  assert(bridge.includes(contract), `Bridge must expose ${contract}.`);
}

assert(
  /approveSkillVersion[\s\S]*expectedHash/.test(bridge),
  'Approval must bind the operator-provided expected hash.'
);
assert(
  /activateSkillVersion[\s\S]*rolloutMode/.test(bridge),
  'Activation must remain separate and default to canary.'
);
assert(
  /rollbackSkillActivation[\s\S]*reason/.test(bridge),
  'Rollback must record an operator reason.'
);

console.log('skill-governance-bridge-smoke: ok');
```

- [ ] **Step 2: Run and verify failure**

```powershell
node scripts/skill-governance-bridge-smoke.mjs
```

Expected: FAIL because the routes are absent.

- [ ] **Step 3: Add governance status**

Add `getSkillGovernanceStatus(pool, { workspaceId })` to the store. It returns:

```js
{
  ok: true,
  authority: 'render-postgres',
  candidates: 0,
  approvedInactive: 0,
  canary: 0,
  active: 0,
  paused: 0,
  staleApprovals: 0,
  outbox: {
    pending: 0,
    retrying: 0,
    deadLettered: 0,
    oldestPendingAt: null,
  },
  snapshot: {
    available: false,
    generatedAt: null,
    ageSeconds: null,
    source: 'none',
  },
}
```

Counts come from Render Postgres. Snapshot metadata comes from the cache wrapper.

- [ ] **Step 4: Add protected routes**

Use existing `matchPath` and `getConversationRequestActor(request)`:

```js
if (request.method === 'GET' && pathname === '/api/skills/governance/status') {
  json(
    response,
    200,
    await getSkillGovernanceStatus(getPgPool(), {
      workspaceId: 'pbk',
      snapshot: await skillRuntimeSnapshotCache.load(),
    })
  );
  return;
}

const approveSkillMatch = matchPath(pathname, '/api/skills/versions/:versionId/approve');
if (request.method === 'POST' && approveSkillMatch) {
  const body = await readBody(request);
  const result = await approveSkillVersion(getPgPool(), {
    workspaceId: 'pbk',
    versionId: decodeURIComponent(approveSkillMatch.groups.versionId),
    expectedHash: body.expectedHash,
    decision: body.decision || 'approved',
    approverId: getConversationRequestActor(request),
    evidenceSnapshot: body.evidenceSnapshot || {},
  });
  json(response, 200, { ok: true, result: 'skill_version_approved', approval: result });
  return;
}

const activateSkillMatch = matchPath(pathname, '/api/skills/versions/:versionId/activate');
if (request.method === 'POST' && activateSkillMatch) {
  const body = await readBody(request);
  const result = await activateSkillVersion(getPgPool(), {
    workspaceId: 'pbk',
    versionId: decodeURIComponent(activateSkillMatch.groups.versionId),
    agentId: body.agentId,
    scope: body.scope || { type: 'global' },
    priority: body.priority || 100,
    rolloutMode: body.rolloutMode || 'canary',
    rolloutPercent: body.rolloutPercent || 10,
    rollbackThresholds: body.rollbackThresholds || {},
    actorId: getConversationRequestActor(request),
  });
  await reloadApprovedSkillsIntoBridgeState({ actor: result.activation.activated_by });
  json(response, 200, { ok: true, result: 'skill_version_activated', ...result });
  return;
}

const rollbackSkillMatch = matchPath(pathname, '/api/skills/activations/:activationId/rollback');
if (request.method === 'POST' && rollbackSkillMatch) {
  const body = await readBody(request);
  const result = await rollbackSkillActivation(getPgPool(), {
    workspaceId: 'pbk',
    activationId: decodeURIComponent(rollbackSkillMatch.groups.activationId),
    actorId: getConversationRequestActor(request),
    reason: body.reason,
  });
  await reloadApprovedSkillsIntoBridgeState({ actor: result.actorId });
  json(response, 200, { ok: true, result: 'skill_activation_rolled_back', ...result });
  return;
}
```

Return `409` for stale approval, `422` for invalid lifecycle transitions, and `503` for unavailable Render authority.

- [ ] **Step 5: Add package command**

```json
"test:skill-governance-bridge": "node ./scripts/skill-governance-bridge-smoke.mjs"
```

- [ ] **Step 6: Run tests**

```powershell
npm run test:skill-governance-bridge
npm run test:bridge
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add scripts/openclaw-local-server.mjs scripts/skill-governance-store.mjs scripts/skill-governance-bridge-smoke.mjs package.json
git commit -m "feat: expose protected skill governance controls"
```

---

### Task 8: Add Outbox Leasing and Governance Observability

**Files:**

- Modify: `scripts/skill-governance-store.mjs`
- Modify: `scripts/skill-governance-store.test.mjs`
- Modify: `scripts/live-data-audit.mjs`
- Modify: `scripts/production-hardening-smoke.mjs`

- [ ] **Step 1: Add failing lease tests**

```js
import {
  claimSkillProjectionEvents,
  markSkillProjectionDelivered,
  markSkillProjectionFailed,
} from './skill-governance-store.mjs';

test('outbox claim uses skip locked and a bounded lease', async () => {
  const pool = {
    async query(sql) {
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(sql).toMatch(/lease_expires_at/);
      return { rows: [] };
    },
  };
  await claimSkillProjectionEvents(pool, {
    workerId: 'worker-1',
    leaseSeconds: 60,
    limit: 25,
  });
});
```

- [ ] **Step 2: Implement outbox worker primitives**

`claimSkillProjectionEvents` must:

- Bound `limit` to 1-100.
- Bound `leaseSeconds` to 15-900.
- Claim only undelivered, non-dead-letter rows whose lease is empty or expired.
- Use `FOR UPDATE SKIP LOCKED`.
- Increment `attempt_count`.

`markSkillProjectionDelivered` must clear lease fields and set `delivered_at`.

`markSkillProjectionFailed` must:

- Store a redacted error.
- Clear lease fields.
- Set `available_at` to exponential backoff plus jitter.
- Set `dead_lettered_at` at 8 attempts.

This phase does not send events to Supabase. It only guarantees that every authoritative change has a durable, safely claimable projection event for the later projection worker.

- [ ] **Step 3: Add audit checks**

`scripts/live-data-audit.mjs` must report:

- Governance schema present.
- Candidate rows are not executable.
- Active versions have matching approval hashes.
- Active versions have current assignments.
- Outbox pending, retrying, and dead-letter counts.
- Snapshot availability and age.
- Supabase is labeled `analytics mirror`.

The audit must fail its skill-governance check when:

- A candidate has an active activation.
- An activation lacks a current approval.
- A runtime reload source is Supabase.

- [ ] **Step 4: Add production hardening assertions**

```js
assert(
  /FOR UPDATE SKIP LOCKED/.test(
    readFileSync(resolve(root, 'scripts/skill-governance-store.mjs'), 'utf8')
  ),
  'Skill projection events must use skip-locked leasing.'
);
assert(
  /dead_lettered_at/.test(
    readFileSync(resolve(root, 'scripts/skill-governance-store.mjs'), 'utf8')
  ),
  'Repeated projection failures must enter a dead-letter state.'
);
```

- [ ] **Step 5: Run tests**

```powershell
npm run test:unit -- --runTestsByPath scripts/skill-governance-store.test.mjs
npm run test:live-data-audit
npm run test:production-hardening
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add scripts/skill-governance-store.mjs scripts/skill-governance-store.test.mjs scripts/live-data-audit.mjs scripts/production-hardening-smoke.mjs
git commit -m "feat: add skill outbox and authority observability"
```

---

### Task 9: Document Operations and Add the Release Gate

**Files:**

- Create: `docs/skill-governance-operations.md`
- Modify: `package.json`
- Modify: `.github/workflows/tooling-verify.yml` only if it does not already run `npm run test:founder`

- [ ] **Step 1: Write the operations document**

The document must include:

```markdown
# Skill Governance Operations

## Authority

Render Postgres is the only operational authority. Supabase is an analytics mirror and is never used for runtime failover.

## Startup

1. Ensure the governance schema.
2. Run the idempotent legacy migration.
3. Load approved active versions from Render.
4. Save the last-known-good snapshot.
5. If Render is unavailable, use only the validated approved snapshot.
6. If no approved snapshot exists, fail closed.

## Candidate Review

Candidates cannot execute, create active memories, create active probes, or enter agent runtime state.

## Approval and Activation

Approval binds an exact version hash. Activation is a separate protected action and defaults to a 10 percent canary.

## Emergency Rollback

Call `POST /api/skills/activations/:activationId/rollback` with a reason. The bridge ends the activation, expires assignments, reloads the approved runtime snapshot, and appends audit and outbox events.

## Health

Use `GET /api/skills/governance/status` and `npm run test:live-data-audit`.
```

- [ ] **Step 2: Add focused package commands**

```json
"test:skill-governance": "node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./jest.config.mjs --testMatch \"<rootDir>/scripts/skill-governance-*.test.mjs\" --runInBand && npm run test:skill-governance-bridge"
```

Add `npm run test:skill-governance` to `test:founder` before the general bridge smoke.

- [ ] **Step 3: Run formatting checks**

```powershell
npx prettier --write scripts/skill-governance-schema.mjs scripts/skill-governance-store.mjs scripts/skill-runtime-snapshot.mjs scripts/skill-governance-schema.test.mjs scripts/skill-governance-store.test.mjs scripts/skill-runtime-snapshot.test.mjs scripts/skill-governance-bridge-smoke.mjs docs/skill-governance-operations.md package.json
npm run format:check
```

Expected: formatting passes for the new files. If unrelated dirty files fail repository-wide formatting, run Prettier only on the files listed above and record the unrelated failure.

- [ ] **Step 4: Run the Phase 1 verification matrix**

```powershell
npm run test:skill-governance
npm run test:production-hardening
npm run test:script-rotator
npm run test:ava-negotiation-learning-loop
npm run test:analytics-live-data
npm run test:live-data-audit
npm run typecheck
npm run lint
npm run build
```

Expected: all commands PASS.

- [ ] **Step 5: Run the full release gate**

```powershell
npm run test:founder
```

Expected: PASS. Do not deploy if the founder gate fails.

- [ ] **Step 6: Inspect the final diff**

```powershell
git status --short
git diff --check
git diff --stat
```

Expected:

- Only Phase 1 files are part of this implementation.
- Existing unrelated worktree changes remain untouched.
- No generated secrets or environment values are committed.

- [ ] **Step 7: Commit**

```powershell
git add docs/skill-governance-operations.md package.json .github/workflows/tooling-verify.yml
git commit -m "docs: add skill governance release operations"
```

---

## Phase 1 Exit Criteria

Phase 1 is complete only when:

1. A legacy or newly learned candidate cannot enter runtime state.
2. Every runtime skill references an exact immutable version.
3. Every runtime version has a current approval matching its content hash.
4. Approval and activation are separate transactions.
5. Activation defaults to canary.
6. Rollback removes the failed version from new selections immediately.
7. Render Postgres is the only operational read/write authority.
8. Supabase is used only for read-only analytics display.
9. A validated last-known-good Render snapshot supports temporary database outages.
10. Absence of both Render and the approved snapshot fails closed.
11. Every authoritative mutation produces an audit event and outbox event atomically.
12. Focused tests, TypeScript, lint, build, and `test:founder` pass.

## Follow-On Plans

After Phase 1 is implemented and verified:

1. Phase 2: ingestion adapters, safety scanning, candidate review, scenarios, and the modern Skill Studio review workspace.
2. Phase 3: immutable chains, assignment scopes, runtime chain selection, canary controls, and automatic rollback.
3. Phase 4: Supabase projection worker, reconciliation, vector analytics, outcomes, drift alerts, and performance refinement.
