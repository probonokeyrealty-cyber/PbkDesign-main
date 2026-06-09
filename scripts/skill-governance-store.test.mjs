import { describe, expect, test } from '@jest/globals';

import {
  activateSkillVersion,
  approveSkillVersion,
  classifyLegacySkillForMigration,
  createSkillCandidate,
  loadApprovedRuntimeSkills,
  migrateLegacySkills,
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

describe('skill governance store', () => {
  test('candidate creation never creates an approval or activation', async () => {
    const pool = fakePool((sql) => {
      if (/INSERT INTO public\.skill_definitions/.test(sql)) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
      }
      if (/MAX\(version_number\)/.test(sql)) {
        return { rows: [{ version_number: 1 }] };
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
      if (/INSERT INTO public\.skill_audit_events/.test(sql)) {
        return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] };
      }
      if (/INSERT INTO public\.skill_projection_outbox/.test(sql)) {
        return { rows: [] };
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

  test('approval stores the current content hash before activation is possible', async () => {
    const pool = fakePool((sql) => {
      if (/FROM public\.skill_versions/.test(sql)) {
        return {
          rows: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              content_hash: 'current-hash',
            },
          ],
        };
      }
      if (/INSERT INTO public\.skill_approvals/.test(sql)) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              subject_hash: 'current-hash',
              decision: 'approved',
            },
          ],
        };
      }
      if (/INSERT INTO public\.skill_audit_events/.test(sql)) {
        return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] };
      }
      return { rows: [] };
    });

    const approval = await approveSkillVersion(pool, {
      versionId: '22222222-2222-4222-8222-222222222222',
      expectedHash: 'current-hash',
      approverId: 'operator-1',
    });

    expect(approval.subject_hash).toBe('current-hash');
    expect(pool.queries.some(({ sql }) => /SET lifecycle_state = \$2/.test(sql))).toBe(true);
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
              subject_type: 'skill_version',
              subject_version_id: 'version-1',
              status: 'rolled_back',
            },
          ],
        };
      }
      if (/INSERT INTO public\.skill_audit_events/.test(sql)) {
        return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] };
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
    expect(pool.queries.at(-1).sql).toBe('COMMIT');
  });

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

  test('legacy migration activates trusted rows and leaves learned rows as candidates', async () => {
    const legacyRows = [
      {
        id: 'legacy-trusted',
        workspace_id: 'pbk',
        agent_id: 'ava',
        agent_name: 'Ava',
        name: 'War Manual Close',
        source: 'war_manual',
        level: 'active',
        status: 'active',
        evidence: 'Trusted baseline.',
        metadata: {},
      },
      {
        id: 'legacy-learned',
        workspace_id: 'pbk',
        agent_id: 'ava',
        agent_name: 'Ava',
        name: 'Outcome Guess',
        source: 'skill_outcome',
        level: 'measured',
        status: 'active',
        evidence: 'Learned from one outcome.',
        metadata: {},
      },
    ];
    let definitionCount = 0;
    let versionCount = 0;
    const pool = fakePool((sql) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/FROM public\.skills/.test(sql)) return { rows: legacyRows };
      if (/INSERT INTO public\.skill_definitions/.test(sql)) {
        definitionCount += 1;
        return { rows: [{ id: `definition-${definitionCount}` }] };
      }
      if (/MAX\(version_number\)/.test(sql)) return { rows: [{ version_number: 1 }] };
      if (/INSERT INTO public\.skill_versions/.test(sql)) {
        versionCount += 1;
        return {
          rows: [
            {
              id: `version-${versionCount}`,
              skill_definition_id: `definition-${definitionCount}`,
              content_hash: `hash-${versionCount}`,
              lifecycle_state: 'candidate',
            },
          ],
        };
      }
      if (/INSERT INTO public\.skill_approvals/.test(sql)) {
        return { rows: [{ id: 'approval-1', decision: 'approved' }] };
      }
      if (/INSERT INTO public\.agent_skill_assignments/.test(sql)) {
        return { rows: [{ id: 'assignment-1' }] };
      }
      if (/INSERT INTO public\.skill_activations/.test(sql)) {
        return { rows: [{ id: 'activation-1', rollout_mode: 'full', status: 'active' }] };
      }
      if (/INSERT INTO public\.skill_audit_events/.test(sql)) {
        return { rows: [{ id: 'audit-1' }] };
      }
      return { rows: [] };
    });

    const result = await migrateLegacySkills(pool, {
      actorId: 'migration-test',
      workspaceId: 'pbk',
    });

    expect(result.activeMigrated).toBe(1);
    expect(result.candidatesMigrated).toBe(1);
    expect(pool.queries.filter(({ sql }) => /INSERT INTO public\.skill_activations/.test(sql))).toHaveLength(1);
    expect(pool.queries.filter(({ sql }) => /UPDATE public\.skills/.test(sql))).toHaveLength(2);
  });

  test('runtime loader only reads approved active or canary versions', async () => {
    const pool = {
      queries: [],
      async query(sql, params = []) {
        this.queries.push({ sql, params });
        return {
          rows: [
            {
              version_id: 'version-1',
              content_hash: 'hash-1',
              display_name: 'Price Gap',
              instructions: 'Ask the price-gap question.',
              lifecycle_state: 'active',
              activation_status: 'active',
              rollout_percent: 100,
              agent_id: 'ava',
              priority: 100,
            },
          ],
        };
      },
    };

    const rows = await loadApprovedRuntimeSkills(pool, { workspaceId: 'pbk', agentId: 'ava' });

    expect(rows).toHaveLength(1);
    expect(rows[0].versionId).toBe('version-1');
    expect(pool.queries[0].sql).toMatch(/public\.skill_activations/);
    expect(pool.queries[0].sql).toMatch(/public\.skill_approvals/);
    expect(pool.queries[0].sql).toMatch(/public\.agent_skill_assignments/);
    expect(pool.queries[0].sql).toMatch(/activation\.status IN \('canary', 'active'\)/);
    expect(pool.queries[0].params).toEqual(['pbk', 'ava', 'production']);
  });
});
