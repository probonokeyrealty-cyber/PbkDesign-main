import { describe, expect, jest, test } from '@jest/globals';

import {
  CONVERSATION_SCHEMA_SQL,
  ensureConversationSchema,
} from './conversation-schema.mjs';

const CONVERSATION_TABLES = [
  'conversation_threads',
  'conversation_thread_identities',
  'conversation_events',
  'communication_sender_identities',
];

describe('conversation schema', () => {
  test('defines bridge-only conversation tables with RLS and indexes', () => {
    for (const table of CONVERSATION_TABLES) {
      expect(CONVERSATION_SCHEMA_SQL).toContain(`public.${table}`);
      expect(CONVERSATION_SCHEMA_SQL).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      );
      expect(CONVERSATION_SCHEMA_SQL).toContain(
        `REVOKE ALL ON public.${table} FROM anon, authenticated`
      );
    }

    for (const index of [
      'conversation_threads_workspace_lead_uidx',
      'conversation_thread_identity_uidx',
      'sender_identity_provider_address_uidx',
      'conversation_events_source_uidx',
      'conversation_events_thread_occurred_idx',
      'conversation_threads_activity_idx',
      'conversation_identity_lookup_idx',
    ]) {
      expect(CONVERSATION_SCHEMA_SQL).toContain(index);
    }
  });

  test('reports postgres availability and applies the schema through the pool', async () => {
    await expect(ensureConversationSchema()).resolves.toEqual({
      ok: false,
      reason: 'postgres_unavailable',
    });

    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await expect(ensureConversationSchema(pool)).resolves.toEqual({
      ok: true,
      result: 'conversation_schema_ready',
    });
    expect(pool.query).toHaveBeenCalledWith(CONVERSATION_SCHEMA_SQL);
  });
});
