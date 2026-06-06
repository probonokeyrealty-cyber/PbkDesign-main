import { describe, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CONVERSATION_SCHEMA_SQL, ensureConversationSchema } from './conversation-schema.mjs';
import {
  createConversationStore,
  mapConversationEventRow,
  mapConversationThreadRow,
  mapSenderIdentityRow,
} from './conversation-store.mjs';

const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260606091340_pbk_unified_conversations.sql', import.meta.url)
);
const CONVERSATION_TABLES = [
  'conversation_threads',
  'conversation_thread_identities',
  'conversation_events',
  'communication_sender_identities',
];
const THREAD_UUID = '11111111-1111-4111-8111-111111111111';
const SECOND_THREAD_UUID = '22222222-2222-4222-8222-222222222222';
const EVENT_UUID = '33333333-3333-4333-8333-333333333333';

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

function threadRow(overrides = {}) {
  return {
    id: 'thread-1',
    workspace_id: 'pbk',
    lead_id: 'lead-1',
    status: 'open',
    assigned_agent: 'Ava',
    title: 'Seller conversation',
    last_event_at: '2026-06-06T12:00:00.000Z',
    last_inbound_at: '2026-06-06T11:00:00.000Z',
    last_outbound_at: '2026-06-06T12:00:00.000Z',
    unread_count: 2,
    pinned: true,
    archived_at: null,
    spam_reported_at: null,
    merged_into_thread_id: null,
    metadata: { source: 'test' },
    created_at: '2026-06-06T10:00:00.000Z',
    updated_at: '2026-06-06T12:00:00.000Z',
    ...overrides,
  };
}

function eventRow(overrides = {}) {
  return {
    id: 'event-1',
    workspace_id: 'pbk',
    thread_id: 'thread-1',
    lead_id: 'lead-1',
    event_type: 'message.sms',
    channel: 'sms',
    direction: 'inbound',
    source_table: 'telnyx_messages',
    source_id: 'message-1',
    provider: 'telnyx',
    sender_identity_id: 'sender-1',
    actor_type: 'seller',
    actor_name: 'Seller',
    subject: '',
    body: 'Hello',
    status: 'received',
    occurred_at: '2026-06-06T12:00:00.000Z',
    read_at: null,
    hidden_at: null,
    spam_reported_at: null,
    payload: { providerStatus: 'delivered' },
    created_at: '2026-06-06T12:00:00.000Z',
    updated_at: '2026-06-06T12:00:00.000Z',
    ...overrides,
  };
}

function senderRow(overrides = {}) {
  return {
    id: 'sender-1',
    workspace_id: 'pbk',
    provider: 'telnyx',
    provider_identity_id: 'provider-1',
    channel: 'sms',
    address: '(614) 555-0199',
    normalized_address: '+16145550199',
    label: 'Columbus',
    region: 'US-OH',
    lifecycle_status: 'active',
    health_status: 'healthy',
    health_score: '98.5',
    is_workspace_default: true,
    inbound_grace_until: null,
    retired_at: null,
    released_at: null,
    metadata: { pool: 'primary' },
    created_at: '2026-06-06T10:00:00.000Z',
    updated_at: '2026-06-06T12:00:00.000Z',
    ...overrides,
  };
}

function createRecordingTransaction(handler) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      return handler(sql, params, queries);
    },
    release: jest.fn(),
  };
  const pool = {
    connect: jest.fn().mockResolvedValue(client),
    query: jest.fn(),
  };
  return { client, pool, queries };
}

describe('conversation store row mapping', () => {
  test('maps snake-case records and defaults JSON fields safely', () => {
    expect(mapConversationThreadRow(threadRow({ metadata: null }))).toEqual({
      id: 'thread-1',
      workspaceId: 'pbk',
      leadId: 'lead-1',
      status: 'open',
      assignedAgent: 'Ava',
      title: 'Seller conversation',
      lastEventAt: '2026-06-06T12:00:00.000Z',
      lastInboundAt: '2026-06-06T11:00:00.000Z',
      lastOutboundAt: '2026-06-06T12:00:00.000Z',
      unreadCount: 2,
      pinned: true,
      archivedAt: null,
      spamReportedAt: null,
      mergedIntoThreadId: null,
      metadata: {},
      createdAt: '2026-06-06T10:00:00.000Z',
      updatedAt: '2026-06-06T12:00:00.000Z',
    });

    expect(mapConversationEventRow(eventRow({ payload: null }))).toMatchObject({
      id: 'event-1',
      threadId: 'thread-1',
      eventType: 'message.sms',
      occurredAt: '2026-06-06T12:00:00.000Z',
      payload: {},
    });

    expect(mapSenderIdentityRow(senderRow({ metadata: null }))).toMatchObject({
      id: 'sender-1',
      providerIdentityId: 'provider-1',
      normalizedAddress: '+16145550199',
      lifecycleStatus: 'active',
      healthScore: 98.5,
      metadata: {},
    });
  });
});

describe('conversation thread resolution', () => {
  test('resolves lead-first and upserts normalized phone and email identities in one transaction', async () => {
    const { client, pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('FROM public.conversation_threads') && sql.includes('lead_id = $2')) {
        return { rows: [threadRow()] };
      }
      if (sql.includes('WHERE id = ANY($1::uuid[])') && sql.includes('FOR UPDATE')) {
        return { rows: [threadRow()] };
      }
      return { rows: [] };
    });

    const thread = await createConversationStore(pool).resolveThread({
      leadId: 'lead-1',
      phone: '(614) 555-0199',
      email: ' Seller@Example.COM ',
    });

    expect(thread.id).toBe('thread-1');
    expect(queries[0]).toEqual({ sql: 'BEGIN', params: [] });
    const leadQueryIndex = queries.findIndex(({ sql }) => sql.includes('lead_id = $2'));
    const identityQueryIndexes = queries
      .map(({ sql }, index) =>
        sql.includes('INSERT INTO public.conversation_thread_identities') ? index : -1
      )
      .filter((index) => index >= 0);
    expect(queries[leadQueryIndex].params).toEqual(['pbk', 'lead-1']);
    expect(identityQueryIndexes).toHaveLength(2);
    expect(identityQueryIndexes.every((index) => index > leadQueryIndex)).toBe(true);
    expect(queries[identityQueryIndexes[0]].params).toContain('+16145550199');
    expect(queries[identityQueryIndexes[1]].params).toContain('seller@example.com');
    expect(queries.at(-1)).toEqual({ sql: 'COMMIT', params: [] });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back and releases the transaction client when resolution fails', async () => {
    const failure = new Error('database unavailable');
    const { client, pool, queries } = createRecordingTransaction(async () => {
      throw failure;
    });

    await expect(createConversationStore(pool).resolveThread({ leadId: 'lead-1' })).rejects.toBe(
      failure
    );

    expect(queries.map(({ sql }) => sql)).toEqual(['BEGIN', expect.any(String), 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('creates the canonical lead thread when a provisional attach no longer succeeds', async () => {
    let identitySelected = false;
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('JOIN public.conversation_threads AS t')) {
        identitySelected = true;
        return { rows: [threadRow({ id: 'provisional-1', lead_id: null })] };
      }
      if (sql.includes('WHERE id = ANY($1::uuid[])') && sql.includes('FOR UPDATE')) {
        return { rows: [threadRow({ id: 'provisional-1', lead_id: null })] };
      }
      if (sql.includes('UPDATE public.conversation_threads') && sql.includes('lead_id = $3')) {
        return { rows: [] };
      }
      if (
        sql.includes('INSERT INTO public.conversation_threads') &&
        sql.includes('lead_id') &&
        sql.includes('ON CONFLICT')
      ) {
        return { rows: [threadRow({ id: 'canonical-1' })] };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).resolveThread({
        leadId: 'lead-1',
        phone: '(614) 555-0199',
      })
    ).resolves.toMatchObject({ id: 'canonical-1', leadId: 'lead-1' });

    expect(identitySelected).toBe(true);
    expect(
      queries.some(
        ({ sql }) =>
          sql.includes('INSERT INTO public.conversation_threads') &&
          sql.includes('ON CONFLICT (workspace_id, lead_id)')
      )
    ).toBe(true);
  });

  test('locks all normalized identities in sorted order before reselecting or creating', async () => {
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('JOIN public.conversation_threads AS t')) {
        return { rows: [threadRow({ id: 'identity-thread', lead_id: null })] };
      }
      if (sql.includes('WHERE id = ANY($1::uuid[])') && sql.includes('FOR UPDATE')) {
        return { rows: [threadRow({ id: 'identity-thread', lead_id: null })] };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).resolveThread({
        phone: '(614) 555-0199',
        email: 'seller@example.com',
      })
    ).resolves.toMatchObject({ id: 'identity-thread', leadId: null });

    const identityLocks = queries
      .map(({ sql, params }, index) => ({ sql, params, index }))
      .filter(
        ({ sql, params }) =>
          sql.includes('pg_advisory_xact_lock') &&
          sql.includes('hashtextextended($1, 0)') &&
          params[0]?.startsWith('conversation-identity:')
      );
    const identitySelectIndex = queries.findIndex(({ sql }) =>
      sql.includes('JOIN public.conversation_threads AS t')
    );
    const provisionalInsertIndex = queries.findIndex(
      ({ sql }) =>
        sql.includes('INSERT INTO public.conversation_threads') && !sql.includes('lead_id')
    );

    expect(identityLocks.map(({ params }) => params[0])).toEqual([
      'conversation-identity:pbk:email:seller@example.com',
      'conversation-identity:pbk:phone:+16145550199',
    ]);
    expect(identityLocks.every(({ index }) => index < identitySelectIndex)).toBe(true);
    expect(provisionalInsertIndex).toBe(-1);
  });

  test('locks lead and identities before queries and merges a provisional identity thread into canonical', async () => {
    const canonical = threadRow({ id: 'thread-canonical', lead_id: 'lead-1' });
    const provisional = threadRow({ id: 'thread-provisional', lead_id: null });
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('lead_id = $2') && sql.includes('FROM public.conversation_threads')) {
        return { rows: [canonical] };
      }
      if (sql.includes('JOIN public.conversation_threads AS t')) {
        return { rows: [provisional] };
      }
      if (
        sql.includes('WHERE id = ANY($1::uuid[])') &&
        sql.includes('ORDER BY id') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rows: [canonical, provisional].sort((left, right) => left.id.localeCompare(right.id)),
        };
      }
      if (sql.includes('WITH target_threads AS')) {
        return { rows: [canonical] };
      }
      if (
        sql.includes('UPDATE public.conversation_threads AS canonical') &&
        sql.includes('RETURNING canonical.*')
      ) {
        return { rows: [canonical] };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).resolveThread({
        leadId: 'lead-1',
        phone: '(614) 555-0199',
        email: 'seller@example.com',
      })
    ).resolves.toMatchObject({ id: 'thread-canonical', leadId: 'lead-1' });

    const resolutionLocks = queries
      .map(({ sql, params }, index) => ({ sql, params, index }))
      .filter(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    expect(resolutionLocks.map(({ params }) => params[0])).toEqual([
      'conversation-identity:pbk:email:seller@example.com',
      'conversation-identity:pbk:phone:+16145550199',
      'conversation-thread:pbk:lead-1',
    ]);

    const firstResolutionQuery = queries.findIndex(
      ({ sql }) =>
        sql.includes('lead_id = $2') || sql.includes('JOIN public.conversation_threads AS t')
    );
    expect(resolutionLocks.every(({ index }) => index < firstResolutionQuery)).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('JOIN public.conversation_threads AS t'))).toBe(
      true
    );

    const mergedMarkerIndex = queries.findIndex(
      ({ sql }) =>
        sql.includes('merged_into_thread_id = $2') &&
        sql.includes('UPDATE public.conversation_threads')
    );
    const firstIdentityUpsertIndex = queries.findIndex(({ sql }) =>
      sql.includes('INSERT INTO public.conversation_thread_identities')
    );
    expect(mergedMarkerIndex).toBeGreaterThan(-1);
    expect(mergedMarkerIndex).toBeLessThan(firstIdentityUpsertIndex);
    expect(
      queries.some(
        ({ sql, params }) =>
          sql.includes("'thread.merged'") &&
          params.includes('thread-provisional') &&
          params.includes('thread-canonical')
      )
    ).toBe(true);
  });

  test('rejects a different-lead identity conflict without stealing the identity', async () => {
    const canonical = threadRow({ id: 'thread-canonical', lead_id: 'lead-1' });
    const conflicting = threadRow({ id: 'thread-conflict', lead_id: 'lead-2' });
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('lead_id = $2') && sql.includes('FROM public.conversation_threads')) {
        return { rows: [canonical] };
      }
      if (sql.includes('JOIN public.conversation_threads AS t')) {
        return { rows: [conflicting] };
      }
      if (
        sql.includes('WHERE id = ANY($1::uuid[])') &&
        sql.includes('ORDER BY id') &&
        sql.includes('FOR UPDATE')
      ) {
        return {
          rows: [canonical, conflicting].sort((left, right) => left.id.localeCompare(right.id)),
        };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).resolveThread({
        leadId: 'lead-1',
        email: 'seller@example.com',
      })
    ).rejects.toThrow('different lead');

    expect(
      queries.some(({ sql }) => sql.includes('INSERT INTO public.conversation_thread_identities'))
    ).toBe(false);
    expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
  });

  test('follows a merged identity candidate and rejects its different-lead destination', async () => {
    const staleCandidate = threadRow({
      id: 'thread-stale',
      lead_id: null,
      merged_into_thread_id: null,
    });
    const mergedCandidate = {
      ...staleCandidate,
      merged_into_thread_id: 'thread-destination',
    };
    const destination = threadRow({
      id: 'thread-destination',
      lead_id: 'lead-a',
    });
    const { pool, queries } = createRecordingTransaction(async (sql, params) => {
      if (sql.includes('lead_id = $2') && sql.includes('FROM public.conversation_threads')) {
        return { rows: [] };
      }
      if (sql.includes('JOIN public.conversation_threads AS t')) {
        return { rows: [staleCandidate] };
      }
      if (sql.includes('WHERE id = ANY($1::uuid[])') && sql.includes('FOR UPDATE')) {
        if (params[0].includes('thread-destination')) return { rows: [destination] };
        return { rows: [mergedCandidate] };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).resolveThread({
        leadId: 'lead-b',
        email: 'seller@example.com',
      })
    ).rejects.toThrow('different lead');

    expect(
      queries.some(
        ({ sql, params }) =>
          sql.includes('WHERE id = ANY($1::uuid[])') &&
          sql.includes('FOR UPDATE') &&
          params[0].includes('thread-destination')
      )
    ).toBe(true);
    expect(
      queries.some(({ sql }) => sql.includes('INSERT INTO public.conversation_thread_identities'))
    ).toBe(false);
    expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
  });

  test('follows a merged lead candidate and rejects its different-lead destination', async () => {
    const staleLeadCandidate = threadRow({
      id: 'thread-stale',
      lead_id: 'lead-b',
      merged_into_thread_id: null,
    });
    const destination = threadRow({
      id: 'thread-destination',
      lead_id: 'lead-a',
    });
    const { pool, queries } = createRecordingTransaction(async (sql, params) => {
      if (sql.includes('lead_id = $2') && sql.includes('FROM public.conversation_threads')) {
        return { rows: [staleLeadCandidate] };
      }
      if (sql.includes('WHERE id = ANY($1::uuid[])') && sql.includes('FOR UPDATE')) {
        if (params[0].includes('thread-destination')) return { rows: [destination] };
        return {
          rows: [
            {
              ...staleLeadCandidate,
              merged_into_thread_id: 'thread-destination',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).resolveThread({
        leadId: 'lead-b',
        email: 'seller@example.com',
      })
    ).rejects.toThrow('different lead');

    expect(
      queries.some(({ sql }) => sql.includes('INSERT INTO public.conversation_thread_identities'))
    ).toBe(false);
    expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
  });

  test('rejects a merged identity candidate whose canonical destination cannot be loaded', async () => {
    const staleCandidate = threadRow({
      id: 'thread-stale',
      lead_id: null,
      merged_into_thread_id: null,
    });
    const { pool, queries } = createRecordingTransaction(async (sql, params) => {
      if (sql.includes('JOIN public.conversation_threads AS t')) {
        return { rows: [staleCandidate] };
      }
      if (sql.includes('WHERE id = ANY($1::uuid[])') && sql.includes('FOR UPDATE')) {
        if (params[0].includes('thread-destination')) return { rows: [] };
        return {
          rows: [
            {
              ...staleCandidate,
              merged_into_thread_id: 'thread-destination',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).resolveThread({
        email: 'seller@example.com',
      })
    ).rejects.toThrow('canonical destination');

    expect(queries.some(({ sql }) => sql.includes('INSERT INTO public.conversation_threads'))).toBe(
      false
    );
    expect(
      queries.some(({ sql }) => sql.includes('INSERT INTO public.conversation_thread_identities'))
    ).toBe(false);
    expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
  });
});

describe('conversation event persistence', () => {
  test('uses the partial source conflict target and recomputes unchanged retry aggregates', async () => {
    let insertCount = 0;
    const { pool, queries } = createRecordingTransaction(async (sql, params) => {
      if (
        sql.includes('FROM public.conversation_events') &&
        sql.includes('source_table = $2') &&
        sql.includes('source_id = $3')
      ) {
        return {
          rows: insertCount ? [{ id: 'event-1', thread_id: 'thread-1' }] : [],
        };
      }
      if (
        sql.includes('FROM public.conversation_threads') &&
        sql.includes('FOR UPDATE') &&
        sql.includes('ANY($1::uuid[])')
      ) {
        return { rows: params[0].map((id) => ({ id })) };
      }
      if (sql.includes('INSERT INTO public.conversation_events')) {
        insertCount += 1;
        return {
          rows: [eventRow({ inserted: insertCount === 1 })],
        };
      }
      if (
        sql.includes('WITH target_threads AS') &&
        sql.includes('UPDATE public.conversation_threads')
      ) {
        return { rows: [threadRow()] };
      }
      return { rows: [] };
    });
    const store = createConversationStore(pool);
    const input = {
      workspaceId: 'pbk',
      threadId: 'thread-1',
      leadId: 'lead-1',
      eventType: 'message.sms',
      channel: 'sms',
      direction: 'inbound',
      sourceTable: 'telnyx_messages',
      sourceId: 'message-1',
      provider: 'telnyx',
      body: 'Hello',
      occurredAt: '2026-06-06T12:00:00.000Z',
      payload: { providerStatus: 'delivered' },
    };

    await expect(store.upsertEvent(input)).resolves.toMatchObject({
      id: 'event-1',
      inserted: true,
    });
    await expect(store.upsertEvent(input)).resolves.toMatchObject({
      id: 'event-1',
      inserted: false,
    });

    const eventQueries = queries.filter(({ sql }) =>
      sql.includes('INSERT INTO public.conversation_events')
    );
    expect(eventQueries).toHaveLength(2);
    expect(eventQueries[0].sql).toContain(
      'ON CONFLICT (workspace_id, source_table, source_id, event_type)'
    );
    expect(eventQueries[0].sql).toContain("WHERE source_table <> '' AND source_id <> ''");
    expect(eventQueries[0].sql).toContain('(xmax = 0) AS inserted');

    const aggregateQueries = queries.filter(
      ({ sql }) =>
        sql.includes('WITH target_threads AS') && sql.includes('UPDATE public.conversation_threads')
    );
    expect(aggregateQueries).toHaveLength(2);
    expect(aggregateQueries[0].sql).toContain("direction = 'inbound'");
    expect(aggregateQueries[0].sql).toContain('read_at IS NULL');
    expect(aggregateQueries[0].sql).toContain('hidden_at IS NULL');
    expect(aggregateQueries[0].sql).not.toContain('unread_count = unread_count +');
    expect(aggregateQueries[0].params).toEqual([['thread-1'], 'pbk']);
    expect(aggregateQueries[1].params).toEqual([['thread-1'], 'pbk']);
  });

  test('locks the existing source event and recomputes old and new threads when reassigned', async () => {
    const { pool, queries } = createRecordingTransaction(async (sql, params) => {
      if (
        sql.includes('FROM public.conversation_events') &&
        sql.includes('source_table = $2') &&
        sql.includes('source_id = $3')
      ) {
        return { rows: [{ id: 'event-1', thread_id: 'thread-old' }] };
      }
      if (
        sql.includes('FROM public.conversation_threads') &&
        sql.includes('FOR UPDATE') &&
        sql.includes('ANY($1::uuid[])')
      ) {
        return { rows: params[0].map((id) => ({ id })) };
      }
      if (sql.includes('INSERT INTO public.conversation_events')) {
        return {
          rows: [eventRow({ thread_id: 'thread-new', inserted: false })],
        };
      }
      if (sql.includes('WITH target_threads AS')) {
        return {
          rows: [threadRow({ id: 'thread-new' }), threadRow({ id: 'thread-old', unread_count: 0 })],
        };
      }
      return { rows: [] };
    });

    await createConversationStore(pool).upsertEvent({
      workspaceId: 'pbk',
      threadId: 'thread-new',
      eventType: 'message.sms',
      direction: 'inbound',
      sourceTable: 'telnyx_messages',
      sourceId: 'message-1',
      occurredAt: '2026-06-06T12:00:00.000Z',
    });

    const eventLockIndex = queries.findIndex(
      ({ sql }) =>
        sql.includes('FROM public.conversation_events') &&
        sql.includes('source_table = $2') &&
        sql.includes('FOR UPDATE')
    );
    const insertIndex = queries.findIndex(({ sql }) =>
      sql.includes('INSERT INTO public.conversation_events')
    );
    const aggregateQuery = queries.find(({ sql }) => sql.includes('WITH target_threads AS'));

    expect(eventLockIndex).toBeGreaterThan(-1);
    expect(eventLockIndex).toBeLessThan(insertIndex);
    expect(aggregateQuery.params).toEqual([['thread-new', 'thread-old'], 'pbk']);
    expect(aggregateQuery.sql).toContain('MAX(event.occurred_at)');
    expect(aggregateQuery.sql).toContain('COUNT(event.id) FILTER');
    expect(aggregateQuery.sql).toContain('event.workspace_id = $2');
  });
});

describe('conversation queries and pagination', () => {
  test('scopes canonical thread reads and timeline rows to the requested workspace', async () => {
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('FROM public.conversation_threads')) {
          return params[1] === 'pbk' ? { rows: [threadRow({ id: THREAD_UUID })] } : { rows: [] };
        }
        return params[1] === 'pbk'
          ? { rows: [eventRow({ id: EVENT_UUID, thread_id: THREAD_UUID })] }
          : { rows: [] };
      },
    };
    const store = createConversationStore(pool);

    await expect(store.getThread(THREAD_UUID, { workspaceId: 'pbk' })).resolves.toMatchObject({
      id: THREAD_UUID,
    });
    await expect(store.getThread(THREAD_UUID, { workspaceId: 'other' })).resolves.toBeNull();
    const timeline = await store.listTimeline(THREAD_UUID, {
      workspaceId: 'pbk',
      limit: 10,
    });
    const crossWorkspaceTimeline = await store.listTimeline(THREAD_UUID, {
      workspaceId: 'other',
      limit: 10,
    });

    expect(timeline.items).toHaveLength(1);
    expect(crossWorkspaceTimeline.items).toHaveLength(0);
    expect(queries[0].sql).toContain('workspace_id = $2');
    expect(queries[0].params).toEqual([THREAD_UUID, 'pbk']);
    expect(queries[1].params).toEqual([THREAD_UUID, 'other']);
    expect(queries[2].sql).toContain('JOIN public.conversation_threads AS thread');
    expect(queries[2].sql).toContain('thread.workspace_id = $2');
    expect(queries[2].sql).toContain('thread.merged_into_thread_id IS NULL');
    expect(queries[2].params).toEqual([THREAD_UUID, 'pbk', 11]);
    expect(queries[3].params).toEqual([THREAD_UUID, 'other', 11]);
  });

  test('rejects malformed thread cursor shapes before querying Postgres', async () => {
    const pool = { query: jest.fn() };
    const store = createConversationStore(pool);
    const cursor = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

    for (const malformed of [
      cursor({ id: THREAD_UUID }),
      cursor({ lastEventAt: '2026-06-06T12:00:00.000Z' }),
      cursor({ id: 'not-a-uuid', lastEventAt: '2026-06-06T12:00:00.000Z' }),
      cursor({ id: THREAD_UUID, lastEventAt: 'not-a-date' }),
      cursor({ id: THREAD_UUID, lastEventAt: 123 }),
      cursor({
        id: THREAD_UUID,
        lastEventAt: '2026-06-06T12:00:00.000Z',
        occurredAt: '2026-06-06T12:00:00.000Z',
      }),
    ]) {
      await expect(
        store.listThreads({ workspaceId: 'pbk', cursor: malformed })
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects malformed timeline cursor shapes before querying Postgres', async () => {
    const pool = { query: jest.fn() };
    const store = createConversationStore(pool);
    const cursor = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

    for (const malformed of [
      cursor({ id: EVENT_UUID }),
      cursor({ id: EVENT_UUID, occurredAt: null, includeHidden: false }),
      cursor({ id: EVENT_UUID, occurredAt: '2026-06-06T12:00:00.000Z' }),
      cursor({
        id: 'not-a-uuid',
        occurredAt: '2026-06-06T12:00:00.000Z',
        includeHidden: false,
      }),
      cursor({ id: EVENT_UUID, occurredAt: 'invalid', includeHidden: false }),
      cursor({
        id: EVENT_UUID,
        occurredAt: '2026-06-06T12:00:00.000Z',
        includeHidden: 'false',
      }),
      cursor({
        id: EVENT_UUID,
        occurredAt: '2026-06-06T12:00:00.000Z',
        includeHidden: false,
        lastEventAt: '2026-06-06T12:00:00.000Z',
      }),
    ]) {
      await expect(
        store.listTimeline(THREAD_UUID, {
          workspaceId: 'pbk',
          cursor: malformed,
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    }

    await expect(
      store.listTimeline(THREAD_UUID, {
        workspaceId: 'pbk',
        includeHidden: 'false',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('accepts a thread cursor with an explicit null timestamp branch', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    const cursor = Buffer.from(
      JSON.stringify({ id: THREAD_UUID, lastEventAt: null }),
      'utf8'
    ).toString('base64url');

    await expect(
      createConversationStore(pool).listThreads({
        workspaceId: 'pbk',
        cursor,
      })
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('accepts omitted timeline visibility passed as undefined', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    const store = createConversationStore(pool);

    await expect(
      store.listTimeline(THREAD_UUID, {
        workspaceId: 'pbk',
        includeHidden: undefined,
      })
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('parameterizes an exact trimmed assigned-agent thread filter', async () => {
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [] };
      },
    };

    await createConversationStore(pool).listThreads({
      workspaceId: 'pbk',
      assignedAgent: '  Ava  ',
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('t.assigned_agent = $2');
    expect(queries[0].sql).not.toContain('Ava');
    expect(queries[0].params).toEqual(['pbk', 'Ava', 51]);
  });

  test('parameterizes thread filters, bounds limits, and emits a deterministic cursor', async () => {
    const maliciousSearch = "%' OR TRUE; --";
    const rows = Array.from({ length: 101 }, (_, index) =>
      threadRow({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        last_event_at: `2026-06-06T${String(23 - (index % 23)).padStart(2, '0')}:00:00.000Z`,
      })
    );
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows };
      },
    };
    const store = createConversationStore(pool);

    const firstPage = await store.listThreads({
      workspaceId: 'pbk',
      status: 'open',
      channel: 'sms',
      search: maliciousSearch,
      unread: true,
      pinned: false,
      archived: false,
      limit: 500,
    });

    expect(firstPage.items).toHaveLength(100);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(queries[0].sql).not.toContain(maliciousSearch);
    expect(queries[0].params).toContain(maliciousSearch);
    expect(queries[0].params.at(-1)).toBe(101);
    expect(queries[0].sql).toContain('ORDER BY t.last_event_at DESC NULLS LAST, t.id DESC');

    await store.listThreads({ workspaceId: 'pbk', cursor: firstPage.nextCursor, limit: 10 });
    expect(queries[1].sql).toContain('(t.last_event_at, t.id) <');
    expect(queries[1].sql).toContain('OR t.last_event_at IS NULL');
    expect(queries[1].params).toContain(firstPage.items.at(-1).lastEventAt);
    expect(queries[1].params).toContain(firstPage.items.at(-1).id);
  });

  test('gets only canonical threads and hides timeline events by default with bounded pagination', async () => {
    const queries = [];
    const timelineRows = Array.from({ length: 101 }, (_, index) =>
      eventRow({
        id: `event-${String(index).padStart(3, '0')}`,
        occurred_at: `2026-06-06T12:${String(59 - (index % 59)).padStart(2, '0')}:00.000Z`,
      })
    );
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('FROM public.conversation_threads')) return { rows: [threadRow()] };
        return { rows: timelineRows };
      },
    };
    const store = createConversationStore(pool);

    await expect(store.getThread(THREAD_UUID)).resolves.toMatchObject({ id: 'thread-1' });
    expect(queries[0].sql).toContain('merged_into_thread_id IS NULL');
    expect(queries[0].params).toEqual([THREAD_UUID, 'pbk']);

    const timeline = await store.listTimeline(THREAD_UUID, {
      workspaceId: 'pbk',
      limit: 1000,
    });
    expect(timeline.items).toHaveLength(100);
    expect(timeline.nextCursor).toEqual(expect.any(String));
    expect(queries[1].sql).toContain('hidden_at IS NULL');
    expect(queries[1].sql).toContain('ORDER BY event.occurred_at DESC, event.id DESC');
    expect(queries[1].params.at(-1)).toBe(101);
  });

  test('preserves includeHidden visibility in timeline cursors across pages', async () => {
    const queries = [];
    const rows = Array.from({ length: 3 }, (_, index) =>
      eventRow({
        id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
        occurred_at: `2026-06-06T12:0${2 - index}:00.000Z`,
        hidden_at: index === 1 ? '2026-06-06T13:00:00.000Z' : null,
      })
    );
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows };
      },
    };
    const store = createConversationStore(pool);

    const firstPage = await store.listTimeline(THREAD_UUID, {
      workspaceId: 'pbk',
      includeHidden: true,
      limit: 2,
    });
    const decoded = JSON.parse(Buffer.from(firstPage.nextCursor, 'base64url').toString('utf8'));
    expect(decoded.includeHidden).toBe(true);

    await store.listTimeline(THREAD_UUID, {
      workspaceId: 'pbk',
      cursor: firstPage.nextCursor,
    });
    expect(queries[0].sql).not.toContain('hidden_at IS NULL');
    expect(queries[1].sql).not.toContain('hidden_at IS NULL');

    await expect(
      store.listTimeline(THREAD_UUID, {
        workspaceId: 'pbk',
        cursor: firstPage.nextCursor,
        includeHidden: false,
      })
    ).rejects.toThrow('visibility');
  });
});

describe('conversation mutation allowlists and merging', () => {
  test('scopes thread patches to workspace and shifts patch parameter indices', async () => {
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [threadRow({ id: THREAD_UUID })] };
      },
    };

    await createConversationStore(pool).patchThread(
      THREAD_UUID,
      { pinned: false, assignedAgent: 'Rex' },
      { workspaceId: 'pbk' }
    );

    expect(queries[0].sql).toContain('assigned_agent = $3');
    expect(queries[0].sql).toContain('pinned = $4');
    expect(queries[0].sql).toContain('WHERE id = $1');
    expect(queries[0].sql).toContain('workspace_id = $2');
    expect(queries[0].params).toEqual([THREAD_UUID, 'pbk', 'Rex', false]);
  });

  test('requires merge workspace before opening a transaction', async () => {
    const pool = { connect: jest.fn() };
    await expect(
      createConversationStore(pool).mergeThreads({
        canonicalThreadId: THREAD_UUID,
        mergedThreadId: SECOND_THREAD_UUID,
      })
    ).rejects.toThrow('workspaceId is required');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('rejects unknown thread patch fields and parameterizes allowed values', async () => {
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [threadRow({ title: "Seller's home" })] };
      },
    };
    const store = createConversationStore(pool);

    await expect(store.patchThread('thread-1', { leadId: 'lead-2' })).rejects.toThrow(
      'Unknown thread patch fields: leadId'
    );
    await store.patchThread('thread-1', {
      title: "Seller's home",
      pinned: false,
      metadata: { disposition: 'follow-up' },
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).not.toContain("Seller's home");
    expect(queries[0].params).toContain("Seller's home");
    expect(queries[0].sql).toContain('title = $3');
    expect(queries[0].sql).toContain('pinned = $4');
    expect(queries[0].sql).toContain('metadata = $5::jsonb');
  });

  test('rejects a mixed thread patch when any key is unknown', async () => {
    const pool = { query: jest.fn() };

    await expect(
      createConversationStore(pool).patchThread('thread-1', {
        title: 'Allowed title',
        leadId: 'lead-2',
      })
    ).rejects.toThrow('Unknown thread patch fields: leadId');

    expect(pool.query).not.toHaveBeenCalled();
  });

  test('locks merge rows in stable ID order and dedupes source events and identities', async () => {
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (
        sql.includes('LEFT JOIN public.conversation_thread_identities AS identity') &&
        !sql.includes('FOR UPDATE')
      ) {
        return {
          rows: [
            {
              id: 'thread-a',
              workspace_id: 'pbk',
              lead_id: null,
              identity_type: 'email',
              normalized_value: 'seller@example.com',
            },
            {
              id: 'thread-z',
              workspace_id: 'pbk',
              lead_id: 'lead-a',
              identity_type: 'phone',
              normalized_value: '+16145550199',
            },
          ],
        };
      }
      if (sql.includes('SELECT *') && sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            threadRow({ id: 'thread-a', lead_id: null, unread_count: 1 }),
            threadRow({ id: 'thread-z', lead_id: 'lead-a', unread_count: 2 }),
          ],
        };
      }
      if (
        sql.includes('UPDATE public.conversation_threads AS canonical') &&
        sql.includes('RETURNING canonical.*')
      ) {
        return { rows: [threadRow({ id: 'thread-z', unread_count: 3 })] };
      }
      if (sql.includes('WITH target_threads AS')) {
        return { rows: [threadRow({ id: 'thread-z', unread_count: 3 })] };
      }
      return { rows: [] };
    });

    const result = await createConversationStore(pool).mergeThreads({
      workspaceId: 'pbk',
      canonicalThreadId: 'thread-z',
      mergedThreadId: 'thread-a',
      actor: { type: 'user', name: "O'Brien" },
    });

    expect(result).toMatchObject({ id: 'thread-z', unreadCount: 3 });
    const snapshotIndex = queries.findIndex(
      ({ sql }) =>
        sql.includes('LEFT JOIN public.conversation_thread_identities AS identity') &&
        !sql.includes('FOR UPDATE')
    );
    const advisoryLocks = queries
      .map(({ sql, params }, index) => ({ sql, params, index }))
      .filter(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    const lockQuery = queries.find(
      ({ sql }) => sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')
    );
    const lockQueryIndex = queries.indexOf(lockQuery);

    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(queries[snapshotIndex].params).toEqual(['pbk', ['thread-a', 'thread-z']]);
    expect(advisoryLocks.map(({ params }) => params[0])).toEqual([
      'conversation-identity:pbk:email:seller@example.com',
      'conversation-identity:pbk:phone:+16145550199',
      'conversation-thread:pbk:lead-a',
    ]);
    expect(advisoryLocks.every(({ index }) => index > snapshotIndex)).toBe(true);
    expect(advisoryLocks.every(({ index }) => index < lockQueryIndex)).toBe(true);
    expect(lockQuery.params).toEqual([['thread-a', 'thread-z'], 'pbk']);
    expect(queries.some(({ sql }) => sql.includes('DELETE FROM public.conversation_events'))).toBe(
      true
    );
    expect(
      queries.some(
        ({ sql }) =>
          sql.includes('source_table <>') && sql.includes('source_id') && sql.includes('event_type')
      )
    ).toBe(true);
    expect(
      queries.some(({ sql }) => sql.includes('DELETE FROM public.conversation_thread_identities'))
    ).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('merged_into_thread_id'))).toBe(true);
    const auditQuery = queries.find(
      ({ sql }) =>
        sql.includes('INSERT INTO public.conversation_events') && sql.includes("'thread.merged'")
    );
    expect(auditQuery).toBeDefined();
    expect(auditQuery.sql).toContain(
      'ON CONFLICT (workspace_id, source_table, source_id, event_type)'
    );
    expect(auditQuery.params).toContain('thread-a');
    expect(auditQuery.params).toContain("O'Brien");
    expect(queries.some(({ sql }) => sql.includes("O'Brien"))).toBe(false);
    expect(queries.flatMap(({ params }) => params).join(' ')).toContain("O'Brien");
  });

  test('rejects self-merges before opening a transaction', async () => {
    const pool = { connect: jest.fn() };
    await expect(
      createConversationStore(pool).mergeThreads({
        workspaceId: 'pbk',
        canonicalThreadId: 'thread-1',
        mergedThreadId: 'thread-1',
        actor: 'user-1',
      })
    ).rejects.toThrow('different');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('rejects merges across workspaces from the pre-lock snapshot', async () => {
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('LEFT JOIN public.conversation_thread_identities AS identity')) {
        return {
          rows: [
            {
              id: 'thread-a',
              workspace_id: 'other',
              lead_id: 'lead-1',
              identity_type: null,
              normalized_value: null,
            },
            {
              id: 'thread-z',
              workspace_id: 'pbk',
              lead_id: 'lead-1',
              identity_type: null,
              normalized_value: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).mergeThreads({
        workspaceId: 'pbk',
        canonicalThreadId: 'thread-z',
        mergedThreadId: 'thread-a',
        actor: 'user-1',
      })
    ).rejects.toThrow('workspace');
    expect(queries.some(({ sql }) => sql.includes('pg_advisory_xact_lock'))).toBe(false);
    expect(queries.some(({ sql }) => sql.includes('FOR UPDATE'))).toBe(false);
    expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
  });

  test('rejects a merge when lead ownership changes after the advisory-lock snapshot', async () => {
    const snapshotCanonical = threadRow({ id: 'thread-z', lead_id: 'lead-a' });
    const lockedCanonical = threadRow({ id: 'thread-z', lead_id: 'lead-b' });
    const merged = threadRow({ id: 'thread-a', lead_id: null });
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('LEFT JOIN public.conversation_thread_identities AS identity')) {
        return {
          rows: [merged, snapshotCanonical]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((row) => ({
              id: row.id,
              workspace_id: row.workspace_id,
              lead_id: row.lead_id,
              identity_type: null,
              normalized_value: null,
            })),
        };
      }
      if (sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')) {
        return {
          rows: [merged, lockedCanonical].sort((left, right) => left.id.localeCompare(right.id)),
        };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).mergeThreads({
        workspaceId: 'pbk',
        canonicalThreadId: 'thread-z',
        mergedThreadId: 'thread-a',
        actor: 'user-1',
      })
    ).rejects.toThrow('changed after merge lock snapshot');

    expect(queries.some(({ sql }) => sql.includes('DELETE FROM public.conversation_events'))).toBe(
      false
    );
    expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
  });

  test.each([
    {
      name: 'canonical',
      canonical: threadRow({
        id: 'thread-z',
        archived_at: '2026-06-06T13:00:00.000Z',
        merged_into_thread_id: 'thread-old',
      }),
      merged: threadRow({ id: 'thread-a' }),
      message: 'Thread thread-z is already merged into thread-old and cannot be canonical',
    },
    {
      name: 'merged',
      canonical: threadRow({ id: 'thread-z' }),
      merged: threadRow({ id: 'thread-a', merged_into_thread_id: 'thread-old' }),
      message: 'Thread thread-a is already merged into thread-old and cannot be merged',
    },
  ])(
    'rejects an already-merged $name input before moving data',
    async ({ canonical, merged, message }) => {
      const { pool, queries } = createRecordingTransaction(async (sql) => {
        if (sql.includes('LEFT JOIN public.conversation_thread_identities AS identity')) {
          return {
            rows: [merged, canonical]
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((row) => ({
                id: row.id,
                workspace_id: row.workspace_id,
                lead_id: row.lead_id,
                identity_type: null,
                normalized_value: null,
              })),
          };
        }
        if (sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')) {
          return {
            rows: [merged, canonical].sort((left, right) => left.id.localeCompare(right.id)),
          };
        }
        return { rows: [] };
      });

      await expect(
        createConversationStore(pool).mergeThreads({
          workspaceId: 'pbk',
          canonicalThreadId: canonical.id,
          mergedThreadId: merged.id,
          actor: 'user-1',
        })
      ).rejects.toThrow(message);

      expect(
        queries.some(
          ({ sql }) =>
            sql.includes('DELETE FROM public.conversation_events') ||
            sql.includes('UPDATE public.conversation_events') ||
            sql.includes('DELETE FROM public.conversation_thread_identities')
        )
      ).toBe(false);
      expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
    }
  );

  test.each([
    {
      name: 'lead-bound merged thread with provisional canonical',
      canonical: threadRow({ id: 'thread-z', lead_id: null }),
      merged: threadRow({ id: 'thread-a', lead_id: 'lead-a' }),
      message: 'Lead-bound thread thread-a must be canonical',
    },
    {
      name: 'different nonempty lead IDs',
      canonical: threadRow({ id: 'thread-z', lead_id: 'lead-z' }),
      merged: threadRow({ id: 'thread-a', lead_id: 'lead-a' }),
      message: 'Conversation threads belong to different leads',
    },
  ])('rejects merge ownership violation: $name', async ({ canonical, merged, message }) => {
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('LEFT JOIN public.conversation_thread_identities AS identity')) {
        return {
          rows: [merged, canonical]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((row) => ({
              id: row.id,
              workspace_id: row.workspace_id,
              lead_id: row.lead_id,
              identity_type: null,
              normalized_value: null,
            })),
        };
      }
      if (sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')) {
        return {
          rows: [merged, canonical].sort((left, right) => left.id.localeCompare(right.id)),
        };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).mergeThreads({
        workspaceId: 'pbk',
        canonicalThreadId: canonical.id,
        mergedThreadId: merged.id,
        actor: 'user-1',
      })
    ).rejects.toThrow(message);
    expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
  });
});

describe('sender identity persistence', () => {
  test('gets a sender identity only within the requested workspace', async () => {
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [senderRow()] };
      },
    };

    await expect(
      createConversationStore(pool).getSenderIdentity('sender-1', {
        workspaceId: 'workspace-a',
      })
    ).resolves.toMatchObject({ id: 'sender-1' });

    expect(queries[0].sql).toContain('WHERE id = $1');
    expect(queries[0].sql).toContain('workspace_id = $2');
    expect(queries[0].params).toEqual(['sender-1', 'workspace-a']);
  });

  test('returns exact sender counts and all safe active/default items without a 100-row cap', async () => {
    const safeItems = Array.from({ length: 105 }, (_, index) =>
      senderRow({
        id: `sender-${index}`,
        channel: index % 2 ? 'email' : 'sms',
        provider: index % 2 ? 'instantly' : 'telnyx',
        is_workspace_default: index === 0,
      })
    );
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('GROUP BY channel')) {
          return {
            rows: [
              {
                total: 105,
                by_channel: { sms: 53, email: 52 },
                by_provider: { telnyx: 53, instantly: 52 },
                by_lifecycle: { active: 105 },
              },
            ],
          };
        }
        return { rows: safeItems };
      },
    };

    const summary = await createConversationStore(pool).getSenderIdentitySummary({
      workspaceId: 'pbk',
    });

    expect(summary.counts).toEqual({
      total: 105,
      byChannel: { sms: 53, email: 52 },
      byProvider: { telnyx: 53, instantly: 52 },
      byLifecycle: { active: 105 },
    });
    expect(summary.items).toHaveLength(105);
    expect(summary.itemsTruncated).toBe(false);
    expect(queries).toHaveLength(2);
    expect(queries.every(({ params }) => params[0] === 'pbk')).toBe(true);
    expect(queries[0].sql).toContain('COUNT(*)::integer');
    expect(queries[0].sql).toContain('GROUP BY channel');
    expect(queries[0].sql).toContain('GROUP BY provider');
    expect(queries[0].sql).toContain('GROUP BY lifecycle_status');
    expect(queries[1].sql).not.toContain('LIMIT');
    expect(queries[1].sql).not.toContain('provider_identity_id');
    expect(queries[1].sql).not.toContain('metadata');
  });

  test('lists, upserts, and lifecycle-patches sender identities with normalized addresses', async () => {
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [senderRow()] };
      },
    };
    const store = createConversationStore(pool);

    await expect(
      store.listSenderIdentities({
        workspaceId: 'pbk',
        provider: 'telnyx',
        channel: 'sms',
        lifecycleStatus: 'active',
      })
    ).resolves.toEqual([expect.objectContaining({ id: 'sender-1', lifecycleStatus: 'active' })]);

    await expect(
      store.upsertSenderIdentity({
        workspaceId: 'pbk',
        provider: 'telnyx',
        channel: 'sms',
        address: '(614) 555-0199',
        label: 'Columbus',
      })
    ).resolves.toMatchObject({ id: 'sender-1', normalizedAddress: '+16145550199' });

    await expect(
      store.patchSenderIdentity(
        'sender-1',
        {
          lifecycleStatus: 'retired',
          retiredAt: '2026-06-06T13:00:00.000Z',
          metadata: { reason: "owner's request" },
        },
        { workspaceId: 'workspace-a' }
      )
    ).resolves.toMatchObject({ id: 'sender-1' });

    const upsertQuery = queries.find(({ sql }) =>
      sql.includes('INSERT INTO public.communication_sender_identities')
    );
    expect(upsertQuery.sql).toContain(
      'ON CONFLICT (workspace_id, provider, channel, normalized_address)'
    );
    expect(upsertQuery.params).toContain('+16145550199');

    const patchQuery = queries.find(
      ({ sql }) =>
        sql.includes('UPDATE public.communication_sender_identities') &&
        !sql.includes('ON CONFLICT')
    );
    expect(patchQuery.sql).not.toContain("owner's request");
    expect(patchQuery.sql).toContain('workspace_id = $2');
    expect(patchQuery.params.slice(0, 2)).toEqual(['sender-1', 'workspace-a']);
    expect(patchQuery.params).toContain(JSON.stringify({ reason: "owner's request" }));
  });

  test('rejects unknown-only sender identity patches', async () => {
    const pool = { query: jest.fn() };
    await expect(
      createConversationStore(pool).patchSenderIdentity('sender-1', {
        providerIdentityId: 'provider-2',
      })
    ).rejects.toThrow('Unknown sender identity patch fields: providerIdentityId');
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('rejects a mixed sender identity patch when any key is unknown', async () => {
    const pool = { query: jest.fn() };

    await expect(
      createConversationStore(pool).patchSenderIdentity('sender-1', {
        lifecycleStatus: 'retired',
        providerIdentityId: 'provider-2',
      })
    ).rejects.toThrow('Unknown sender identity patch fields: providerIdentityId');

    expect(pool.query).not.toHaveBeenCalled();
  });

  test('preserves omitted sender fields on conflict with explicit presence flags', async () => {
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return {
          rows: [
            senderRow({
              lifecycle_status: 'retired',
              retired_at: '2026-06-05T00:00:00.000Z',
              metadata: { preserved: true },
            }),
          ],
        };
      },
    };

    await expect(
      createConversationStore(pool).upsertSenderIdentity({
        workspaceId: 'pbk',
        provider: 'telnyx',
        channel: 'sms',
        address: '(614) 555-0199',
      })
    ).resolves.toMatchObject({
      lifecycleStatus: 'retired',
      retiredAt: '2026-06-05T00:00:00.000Z',
      metadata: { preserved: true },
    });

    expect(queries[0].sql).toContain(
      'ON CONFLICT (workspace_id, provider, channel, normalized_address)'
    );
    expect(queries[0].sql).toContain('lifecycle_status = CASE');
    expect(queries[0].sql).toContain('WHEN $20::boolean THEN EXCLUDED.lifecycle_status');
    expect(queries[0].sql).toContain('metadata = CASE');
    expect(queries[0].sql).toContain('WHEN $27::boolean THEN EXCLUDED.metadata');
    expect(queries[0].params[19]).toBe(false);
    expect(queries[0].params[26]).toBe(false);
  });

  test.each(['retired', 'quarantined', 'release_pending', 'released'])(
    'sync preserves locally managed %s lifecycle and historical metadata',
    async (lifecycleStatus) => {
      const queries = [];
      const pool = {
        async query(sql, params) {
          queries.push({ sql, params });
          return {
            rows: [
              senderRow({
                lifecycle_status: lifecycleStatus,
                retired_at: '2026-06-05T00:00:00.000Z',
                metadata: {
                  releaseApprovalId: 'approval-1',
                  providerStatus: 'active',
                },
              }),
            ],
          };
        },
      };

      await expect(
        createConversationStore(pool).syncSenderIdentity({
          workspaceId: 'pbk',
          provider: 'telnyx',
          providerIdentityId: 'provider-1',
          channel: 'sms',
          address: '+16145550199',
          normalizedAddress: '+16145550199',
          lifecycleStatus: 'active',
          healthStatus: 'healthy',
          metadata: { providerStatus: 'healthy' },
        })
      ).resolves.toMatchObject({
        lifecycleStatus,
        retiredAt: '2026-06-05T00:00:00.000Z',
        metadata: {
          releaseApprovalId: 'approval-1',
          providerStatus: 'active',
        },
      });

      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain('WHEN $28::boolean THEN existing.lifecycle_status');
      expect(queries[0].sql).toContain('existing.metadata || EXCLUDED.metadata');
      expect(queries[0].params[27]).toBe(true);
    }
  );

  test('lifecycle patches preserve historical timestamps unless explicitly changed', async () => {
    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        return {
          rows: [
            senderRow({
              lifecycle_status: 'paused',
              retired_at: '2026-06-05T00:00:00.000Z',
              inbound_grace_until: '2026-07-05T00:00:00.000Z',
            }),
          ],
        };
      },
    };

    await createConversationStore(pool).patchSenderIdentity(
      'sender-1',
      {
        lifecycleStatus: 'paused',
        metadata: { lifecycleReason: 'manual pause' },
      },
      { workspaceId: 'pbk' }
    );

    expect(queries[0].sql).toContain('lifecycle_status = $3');
    expect(queries[0].sql).toContain('metadata = $4::jsonb');
    expect(queries[0].sql).not.toContain('retired_at =');
    expect(queries[0].sql).not.toContain('inbound_grace_until =');
  });
});

async function withConversationStoreIntegration(run) {
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
    const queryPool = {
      query: client.query.bind(client),
    };
    await ensureConversationSchema(queryPool);
    await run({
      client,
      store: createConversationStore(queryPool),
      workspaceId: `conversation-store-test-${randomUUID()}`,
    });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

describe('conversation store Postgres integration', () => {
  postgresIntegrationTest(
    'preserves retired sender state and metadata on sparse inventory upsert',
    async () => {
      await withConversationStoreIntegration(async ({ store, workspaceId }) => {
        const provider = `provider-${randomUUID()}`;
        const address = `sender-${randomUUID()}@example.com`;
        await store.upsertSenderIdentity({
          workspaceId,
          provider,
          channel: 'email',
          address,
          lifecycleStatus: 'retired',
          retiredAt: '2026-06-05T00:00:00.000Z',
          metadata: { preserved: true },
        });

        const sparse = await store.upsertSenderIdentity({
          workspaceId,
          provider,
          channel: 'email',
          address,
        });

        expect(sparse).toMatchObject({
          lifecycleStatus: 'retired',
          metadata: { preserved: true },
        });
        expect(sparse.retiredAt.toISOString()).toBe('2026-06-05T00:00:00.000Z');
      });
    },
    30_000
  );

  postgresIntegrationTest(
    'repairs both thread aggregates when a source event is reassigned',
    async () => {
      await withConversationStoreIntegration(async ({ client, store, workspaceId }) => {
        const threadRows = await client.query(
          `
            INSERT INTO public.conversation_threads (workspace_id, title)
            VALUES ($1, 'old'), ($1, 'new')
            RETURNING id, title
          `,
          [workspaceId]
        );
        const oldThreadId = threadRows.rows.find((row) => row.title === 'old').id;
        const newThreadId = threadRows.rows.find((row) => row.title === 'new').id;
        const sourceId = randomUUID();
        const event = {
          workspaceId,
          threadId: oldThreadId,
          eventType: 'message.sms',
          channel: 'sms',
          direction: 'inbound',
          sourceTable: 'integration_messages',
          sourceId,
          occurredAt: '2026-06-06T12:00:00.000Z',
        };

        await store.upsertEvent(event);
        await store.upsertEvent({ ...event, threadId: newThreadId });
        await store.upsertEvent({ ...event, threadId: newThreadId });

        const aggregates = await client.query(
          `
            SELECT id, last_event_at, last_inbound_at, last_outbound_at, unread_count
            FROM public.conversation_threads
            WHERE id = ANY($1::uuid[])
            ORDER BY id
          `,
          [[oldThreadId, newThreadId]]
        );
        const oldThread = aggregates.rows.find((row) => row.id === oldThreadId);
        const newThread = aggregates.rows.find((row) => row.id === newThreadId);

        expect(oldThread).toMatchObject({
          last_event_at: null,
          last_inbound_at: null,
          last_outbound_at: null,
          unread_count: 0,
        });
        expect(newThread.last_event_at.toISOString()).toBe('2026-06-06T12:00:00.000Z');
        expect(newThread.last_inbound_at.toISOString()).toBe('2026-06-06T12:00:00.000Z');
        expect(newThread.last_outbound_at).toBeNull();
        expect(newThread.unread_count).toBe(1);
      });
    },
    30_000
  );

  postgresIntegrationTest(
    'enforces lead-bound canonical ownership and differing-lead rejection',
    async () => {
      await withConversationStoreIntegration(async ({ client, store, workspaceId }) => {
        const leadA = `lead-${randomUUID()}`;
        const leadB = `lead-${randomUUID()}`;
        await client.query(
          `
            INSERT INTO public.lead_profiles (id)
            VALUES ($1), ($2)
            ON CONFLICT (id) DO NOTHING
          `,
          [leadA, leadB]
        );
        const threadRows = await client.query(
          `
            INSERT INTO public.conversation_threads (workspace_id, lead_id, title)
            VALUES
              ($1, NULL, 'provisional'),
              ($1, $2, 'lead-a'),
              ($1, $3, 'lead-b')
            RETURNING id, title
          `,
          [workspaceId, leadA, leadB]
        );
        const provisional = threadRows.rows.find((row) => row.title === 'provisional').id;
        const leadAThread = threadRows.rows.find((row) => row.title === 'lead-a').id;
        const leadBThread = threadRows.rows.find((row) => row.title === 'lead-b').id;

        await expect(
          store.mergeThreads({
            workspaceId,
            canonicalThreadId: provisional,
            mergedThreadId: leadAThread,
            actor: 'integration',
          })
        ).rejects.toThrow('must be canonical');
        await expect(
          store.mergeThreads({
            workspaceId,
            canonicalThreadId: leadAThread,
            mergedThreadId: leadBThread,
            actor: 'integration',
          })
        ).rejects.toThrow('different leads');
      });
    },
    30_000
  );

  postgresIntegrationTest(
    'converges concurrent lead and identity resolution onto one canonical thread',
    async () => {
      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString: process.env.PBK_TEST_DATABASE_URL,
        max: 4,
      });
      const workspaceId = `conversation-convergence-${randomUUID()}`;
      const leadId = `lead-${randomUUID()}`;
      const email = `seller-${randomUUID()}@example.com`;

      try {
        await ensureConversationSchema(pool);
        await pool.query(
          `
            INSERT INTO public.lead_profiles (id)
            VALUES ($1)
            ON CONFLICT (id) DO NOTHING
          `,
          [leadId]
        );
        const canonicalResult = await pool.query(
          `
            INSERT INTO public.conversation_threads (workspace_id, lead_id, title)
            VALUES ($1, $2, 'canonical')
            RETURNING id
          `,
          [workspaceId, leadId]
        );
        const canonicalThreadId = canonicalResult.rows[0].id;
        const store = createConversationStore(pool);

        await Promise.all([
          store.resolveThread({ workspaceId, leadId, email }),
          store.resolveThread({ workspaceId, email }),
        ]);

        const activeThreads = await pool.query(
          `
            SELECT id, lead_id
            FROM public.conversation_threads
            WHERE workspace_id = $1
              AND merged_into_thread_id IS NULL
            ORDER BY id
          `,
          [workspaceId]
        );
        const activeIdentities = await pool.query(
          `
            SELECT identity.thread_id, COUNT(*)::integer AS identity_count
            FROM public.conversation_thread_identities AS identity
            JOIN public.conversation_threads AS thread ON thread.id = identity.thread_id
            WHERE identity.workspace_id = $1
              AND identity.identity_type = 'email'
              AND identity.normalized_value = $2
              AND thread.merged_into_thread_id IS NULL
            GROUP BY identity.thread_id
          `,
          [workspaceId, email]
        );

        expect(activeThreads.rows).toEqual([{ id: canonicalThreadId, lead_id: leadId }]);
        expect(activeIdentities.rows).toEqual([
          { thread_id: canonicalThreadId, identity_count: 1 },
        ]);
      } finally {
        await pool.query(`DELETE FROM public.conversation_threads WHERE workspace_id = $1`, [
          workspaceId,
        ]);
        await pool.query(`DELETE FROM public.lead_profiles WHERE id = $1`, [leadId]);
        await pool.end();
      }
    },
    30_000
  );

  postgresIntegrationTest(
    'serializes explicit merge with lead resolution for an attached identity',
    async () => {
      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString: process.env.PBK_TEST_DATABASE_URL,
        max: 4,
      });
      const workspaceId = `conversation-merge-race-${randomUUID()}`;
      const leadA = `lead-${randomUUID()}`;
      const leadB = `lead-${randomUUID()}`;
      const email = `seller-${randomUUID()}@example.com`;
      let releaseResolution;
      let releaseMerge;
      let identitySelectedResolve;
      let mergeAdvisoryAttemptedResolve;
      let mergeRowsLockedResolve;
      const identitySelected = new Promise((resolve) => {
        identitySelectedResolve = resolve;
      });
      const mergeAdvisoryAttempted = new Promise((resolve) => {
        mergeAdvisoryAttemptedResolve = resolve;
      });
      const mergeRowsLocked = new Promise((resolve) => {
        mergeRowsLockedResolve = resolve;
      });
      const continueResolution = new Promise((resolve) => {
        releaseResolution = resolve;
      });
      const continueMerge = new Promise((resolve) => {
        releaseMerge = resolve;
      });

      try {
        await ensureConversationSchema(pool);
        await pool.query(
          `
            INSERT INTO public.lead_profiles (id)
            VALUES ($1), ($2)
            ON CONFLICT (id) DO NOTHING
          `,
          [leadA, leadB]
        );
        const threadRows = await pool.query(
          `
            INSERT INTO public.conversation_threads (workspace_id, lead_id, title)
            VALUES
              ($1, $2, 'lead-a'),
              ($1, $3, 'lead-b'),
              ($1, NULL, 'provisional')
            RETURNING id, title
          `,
          [workspaceId, leadA, leadB]
        );
        const leadAThreadId = threadRows.rows.find((row) => row.title === 'lead-a').id;
        const leadBThreadId = threadRows.rows.find((row) => row.title === 'lead-b').id;
        const provisionalThreadId = threadRows.rows.find((row) => row.title === 'provisional').id;
        await pool.query(
          `
            INSERT INTO public.conversation_thread_identities (
              workspace_id,
              thread_id,
              identity_type,
              normalized_value,
              display_value
            )
            VALUES ($1, $2, 'email', $3, $3)
          `,
          [workspaceId, provisionalThreadId, email]
        );

        const resolutionPool = {
          async connect() {
            const client = await pool.connect();
            return {
              release: client.release.bind(client),
              async query(sql, params) {
                const result = await client.query(sql, params);
                if (sql.includes('JOIN public.conversation_threads AS t')) {
                  identitySelectedResolve();
                  await continueResolution;
                }
                return result;
              },
            };
          },
        };
        const mergePool = {
          async connect() {
            const client = await pool.connect();
            return {
              release: client.release.bind(client),
              async query(sql, params) {
                if (sql.includes('pg_advisory_xact_lock')) {
                  mergeAdvisoryAttemptedResolve();
                }
                const result = await client.query(sql, params);
                if (
                  sql.includes('SELECT *') &&
                  sql.includes('ORDER BY id') &&
                  sql.includes('FOR UPDATE')
                ) {
                  mergeRowsLockedResolve();
                  await continueMerge;
                }
                return result;
              },
            };
          },
        };

        const resolution = createConversationStore(resolutionPool).resolveThread({
          workspaceId,
          leadId: leadB,
          email,
        });
        await identitySelected;
        const merge = createConversationStore(mergePool).mergeThreads({
          workspaceId,
          canonicalThreadId: leadAThreadId,
          mergedThreadId: provisionalThreadId,
          actor: 'integration-race',
        });

        const firstMergeLock = await Promise.race([
          mergeAdvisoryAttempted.then(() => 'advisory'),
          mergeRowsLocked.then(() => 'row'),
        ]);
        releaseResolution();
        if (firstMergeLock === 'row') {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        releaseMerge();
        await Promise.allSettled([resolution, merge]);

        const duplicateDestinations = await pool.query(
          `
            SELECT
              identity.normalized_value,
              COUNT(DISTINCT identity.thread_id)::integer AS active_thread_count,
              COUNT(DISTINCT thread.lead_id) FILTER (
                WHERE thread.lead_id IS NOT NULL
              )::integer AS active_lead_count
            FROM public.conversation_thread_identities AS identity
            JOIN public.conversation_threads AS thread ON thread.id = identity.thread_id
            WHERE identity.workspace_id = $1
              AND identity.identity_type = 'email'
              AND identity.normalized_value = $2
              AND thread.merged_into_thread_id IS NULL
            GROUP BY identity.normalized_value
          `,
          [workspaceId, email]
        );

        expect(duplicateDestinations.rows).toEqual([
          {
            normalized_value: email,
            active_thread_count: 1,
            active_lead_count: 1,
          },
        ]);
        const activeIdentity = await pool.query(
          `
            SELECT identity.thread_id, thread.lead_id
            FROM public.conversation_thread_identities AS identity
            JOIN public.conversation_threads AS thread ON thread.id = identity.thread_id
            WHERE identity.workspace_id = $1
              AND identity.identity_type = 'email'
              AND identity.normalized_value = $2
              AND thread.merged_into_thread_id IS NULL
          `,
          [workspaceId, email]
        );
        expect([leadAThreadId, leadBThreadId]).toContain(activeIdentity.rows[0].thread_id);
      } finally {
        releaseResolution?.();
        releaseMerge?.();
        await pool.query(`DELETE FROM public.conversation_threads WHERE workspace_id = $1`, [
          workspaceId,
        ]);
        await pool.query(`DELETE FROM public.lead_profiles WHERE id = ANY($1::text[])`, [
          [leadA, leadB],
        ]);
        await pool.end();
      }
    },
    30_000
  );
});
