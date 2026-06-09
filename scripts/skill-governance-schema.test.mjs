import { describe, expect, test } from '@jest/globals';

import {
  SKILL_GOVERNANCE_SCHEMA_SQL,
  SKILL_VERSION_STATES,
} from './skill-governance-schema.mjs';

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
