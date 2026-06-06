import { describe, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CONVERSATION_SCHEMA_SQL, ensureConversationSchema } from './conversation-schema.mjs';

const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260606091340_pbk_unified_conversations.sql', import.meta.url)
);
const CONVERSATION_TABLES = [
  'conversation_threads',
  'conversation_thread_identities',
  'conversation_events',
  'communication_sender_identities',
];

function normalizeSql(sql) {
  const normalized = sql.replace(/\r\n/g, '\n');
  const isIndentedTemplate = normalized.startsWith('\n');
  const trimmed = normalized.trim();
  if (!isIndentedTemplate) return trimmed;
  return trimmed
    .split('\n')
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n');
}

describe('conversation schema', () => {
  test('defines bridge-only conversation tables with RLS and indexes', () => {
    for (const table of CONVERSATION_TABLES) {
      expect(CONVERSATION_SCHEMA_SQL).toContain(`public.${table}`);
      expect(CONVERSATION_SCHEMA_SQL).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
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

  test('guards browser-role revocations for Postgres installs without Supabase roles', () => {
    expect(CONVERSATION_SCHEMA_SQL).not.toContain('FROM anon, authenticated');

    for (const role of ['anon', 'authenticated']) {
      const guard = `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN`;
      const guardStart = CONVERSATION_SCHEMA_SQL.indexOf(guard);
      const blockStart = CONVERSATION_SCHEMA_SQL.lastIndexOf('DO $$', guardStart);
      const previousBlockEnd = CONVERSATION_SCHEMA_SQL.lastIndexOf('END $$;', guardStart);
      const blockEnd = CONVERSATION_SCHEMA_SQL.indexOf('END $$;', guardStart);

      expect(guardStart).toBeGreaterThan(-1);
      expect(blockStart).toBeGreaterThan(previousBlockEnd);
      expect(blockEnd).toBeGreaterThan(guardStart);
      const block = CONVERSATION_SCHEMA_SQL.slice(blockStart, blockEnd);
      for (const table of CONVERSATION_TABLES) {
        expect(block).toContain(`REVOKE ALL ON public.${table} FROM ${role};`);
      }
    }
  });

  test('keeps the migration normalized-exact with the runtime schema SQL', () => {
    const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
    expect(normalizeSql(migrationSql)).toBe(normalizeSql(CONVERSATION_SCHEMA_SQL));
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

const postgresIntegrationTest = process.env.PBK_TEST_DATABASE_URL ? test : test.skip;

describe('conversation schema Postgres integration', () => {
  postgresIntegrationTest(
    'applies twice with RLS enabled and rolls back all test changes',
    async () => {
      const { Client } = await import('pg');
      const client = new Client({
        connectionString: process.env.PBK_TEST_DATABASE_URL,
      });

      await client.connect();
      try {
        await client.query('BEGIN');
        const leadProfiles = await client.query(
          `SELECT to_regclass('public.lead_profiles') AS relation`
        );
        if (!leadProfiles.rows[0].relation) {
          await client.query(`
            CREATE TABLE public.lead_profiles (
              id TEXT PRIMARY KEY
            )
          `);
        }
        await client.query(CONVERSATION_SCHEMA_SQL);
        await client.query(CONVERSATION_SCHEMA_SQL);

        const result = await client.query(
          `
            SELECT c.relname, c.relrowsecurity
            FROM pg_class AS c
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = ANY($1::text[])
            ORDER BY c.relname
          `,
          [CONVERSATION_TABLES]
        );

        expect(result.rows).toEqual(
          [...CONVERSATION_TABLES].sort().map((relname) => ({ relname, relrowsecurity: true }))
        );
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        await client.end();
      }
    },
    30_000
  );
});
