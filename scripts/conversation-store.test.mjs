import { describe, expect, jest, test } from '@jest/globals';
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
      if (
        sql.includes('FROM public.conversation_threads') &&
        sql.includes('lead_id = $2') &&
        sql.includes('FOR UPDATE')
      ) {
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
});

describe('conversation event persistence', () => {
  test('uses the partial source conflict target and gates unread increments on inserted inbound events', async () => {
    let insertCount = 0;
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (
        sql.includes('FROM public.conversation_threads') &&
        sql.includes('FOR UPDATE') &&
        sql.includes('id = $1')
      ) {
        return { rows: [{ id: 'thread-1' }] };
      }
      if (sql.includes('INSERT INTO public.conversation_events')) {
        insertCount += 1;
        return {
          rows: [eventRow({ inserted: insertCount === 1 })],
        };
      }
      if (sql.includes('UPDATE public.conversation_threads')) {
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
    const firstThreadLockIndex = queries.findIndex(
      ({ sql }) =>
        sql.includes('FROM public.conversation_threads') &&
        sql.includes('FOR UPDATE') &&
        sql.includes('id = $1')
    );
    const firstEventInsertIndex = queries.findIndex(({ sql }) =>
      sql.includes('INSERT INTO public.conversation_events')
    );
    expect(firstThreadLockIndex).toBeGreaterThan(-1);
    expect(firstThreadLockIndex).toBeLessThan(firstEventInsertIndex);
    expect(eventQueries[0].sql).toContain(
      'ON CONFLICT (workspace_id, source_table, source_id, event_type)'
    );
    expect(eventQueries[0].sql).toContain("WHERE source_table <> '' AND source_id <> ''");
    expect(eventQueries[0].sql).toContain('(xmax = 0) AS inserted');

    const activityQueries = queries.filter(({ sql }) =>
      sql.includes('UPDATE public.conversation_threads')
    );
    expect(activityQueries).toHaveLength(2);
    expect(activityQueries[0].sql).toContain('unread_count = unread_count + CASE');
    expect(activityQueries[0].params).toContain(true);
    expect(activityQueries[1].params).toContain(false);
  });
});

describe('conversation queries and pagination', () => {
  test('parameterizes thread filters, bounds limits, and emits a deterministic cursor', async () => {
    const maliciousSearch = "%' OR TRUE; --";
    const rows = Array.from({ length: 101 }, (_, index) =>
      threadRow({
        id: `thread-${String(index).padStart(3, '0')}`,
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

    await expect(store.getThread('thread-1')).resolves.toMatchObject({ id: 'thread-1' });
    expect(queries[0].sql).toContain('merged_into_thread_id IS NULL');
    expect(queries[0].params).toEqual(['thread-1']);

    const timeline = await store.listTimeline('thread-1', { limit: 1000 });
    expect(timeline.items).toHaveLength(100);
    expect(timeline.nextCursor).toEqual(expect.any(String));
    expect(queries[1].sql).toContain('hidden_at IS NULL');
    expect(queries[1].sql).toContain('ORDER BY occurred_at DESC, id DESC');
    expect(queries[1].params.at(-1)).toBe(101);
  });
});

describe('conversation mutation allowlists and merging', () => {
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
      'No editable thread fields'
    );
    await store.patchThread('thread-1', {
      title: "Seller's home",
      pinned: false,
      metadata: { disposition: 'follow-up' },
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).not.toContain("Seller's home");
    expect(queries[0].params).toContain("Seller's home");
    expect(queries[0].sql).toContain('title = $2');
    expect(queries[0].sql).toContain('pinned = $3');
    expect(queries[0].sql).toContain('metadata = $4::jsonb');
  });

  test('locks merge rows in stable ID order and dedupes source events and identities', async () => {
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            threadRow({ id: 'thread-a', lead_id: 'lead-a', unread_count: 1 }),
            threadRow({ id: 'thread-z', lead_id: null, unread_count: 2 }),
          ],
        };
      }
      if (
        sql.includes('UPDATE public.conversation_threads AS canonical') &&
        sql.includes('RETURNING canonical.*')
      ) {
        return { rows: [threadRow({ id: 'thread-z', unread_count: 3 })] };
      }
      return { rows: [] };
    });

    const result = await createConversationStore(pool).mergeThreads({
      canonicalThreadId: 'thread-z',
      mergedThreadId: 'thread-a',
      actor: { type: 'user', name: "O'Brien" },
    });

    expect(result).toMatchObject({ id: 'thread-z', unreadCount: 3 });
    const lockQuery = queries.find(
      ({ sql }) => sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')
    );
    expect(lockQuery.params).toEqual([['thread-a', 'thread-z']]);
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
    expect(queries.some(({ sql }) => sql.includes("O'Brien"))).toBe(false);
    expect(queries.flatMap(({ params }) => params).join(' ')).toContain("O'Brien");
  });

  test('rejects self-merges before opening a transaction', async () => {
    const pool = { connect: jest.fn() };
    await expect(
      createConversationStore(pool).mergeThreads({
        canonicalThreadId: 'thread-1',
        mergedThreadId: 'thread-1',
        actor: 'user-1',
      })
    ).rejects.toThrow('different');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('rejects merges across workspaces while both rows are locked', async () => {
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            threadRow({ id: 'thread-a', workspace_id: 'other' }),
            threadRow({ id: 'thread-z', workspace_id: 'pbk' }),
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).mergeThreads({
        canonicalThreadId: 'thread-z',
        mergedThreadId: 'thread-a',
        actor: 'user-1',
      })
    ).rejects.toThrow('workspace');
    expect(queries.at(-1)).toEqual({ sql: 'ROLLBACK', params: [] });
  });
});

describe('sender identity persistence', () => {
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
      store.patchSenderIdentity('sender-1', {
        lifecycleStatus: 'retired',
        retiredAt: '2026-06-06T13:00:00.000Z',
        metadata: { reason: "owner's request" },
      })
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
    expect(patchQuery.params).toContain(JSON.stringify({ reason: "owner's request" }));
  });

  test('rejects unknown-only sender identity patches', async () => {
    const pool = { query: jest.fn() };
    await expect(
      createConversationStore(pool).patchSenderIdentity('sender-1', {
        providerIdentityId: 'provider-2',
      })
    ).rejects.toThrow('No editable sender identity fields');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
