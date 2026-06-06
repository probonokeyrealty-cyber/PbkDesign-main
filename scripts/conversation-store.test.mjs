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

  test('locks all normalized identities in sorted order before reselecting or creating', async () => {
    const { pool, queries } = createRecordingTransaction(async (sql) => {
      if (sql.includes('JOIN public.conversation_threads AS t')) {
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
    expect(aggregateQueries[0].params).toEqual([['thread-1']]);
    expect(aggregateQueries[1].params).toEqual([['thread-1']]);
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
    expect(aggregateQuery.params).toEqual([['thread-new', 'thread-old']]);
    expect(aggregateQuery.sql).toContain('MAX(event.occurred_at)');
    expect(aggregateQuery.sql).toContain('COUNT(event.id) FILTER');
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

  test('preserves includeHidden visibility in timeline cursors across pages', async () => {
    const queries = [];
    const rows = Array.from({ length: 3 }, (_, index) =>
      eventRow({
        id: `event-${index}`,
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

    const firstPage = await store.listTimeline('thread-1', {
      includeHidden: true,
      limit: 2,
    });
    const decoded = JSON.parse(Buffer.from(firstPage.nextCursor, 'base64url').toString('utf8'));
    expect(decoded.includeHidden).toBe(true);

    await store.listTimeline('thread-1', firstPage.nextCursor);
    expect(queries[0].sql).not.toContain('hidden_at IS NULL');
    expect(queries[1].sql).not.toContain('hidden_at IS NULL');

    await expect(
      store.listTimeline('thread-1', {
        cursor: firstPage.nextCursor,
        includeHidden: false,
      })
    ).rejects.toThrow('visibility');
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
    expect(queries[0].sql).toContain('title = $2');
    expect(queries[0].sql).toContain('pinned = $3');
    expect(queries[0].sql).toContain('metadata = $4::jsonb');
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
        if (sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')) {
          return {
            rows: [merged, canonical].sort((left, right) => left.id.localeCompare(right.id)),
          };
        }
        return { rows: [] };
      });

      await expect(
        createConversationStore(pool).mergeThreads({
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
      if (sql.includes('ORDER BY id') && sql.includes('FOR UPDATE')) {
        return {
          rows: [merged, canonical].sort((left, right) => left.id.localeCompare(right.id)),
        };
      }
      return { rows: [] };
    });

    await expect(
      createConversationStore(pool).mergeThreads({
        canonicalThreadId: canonical.id,
        mergedThreadId: merged.id,
        actor: 'user-1',
      })
    ).rejects.toThrow(message);
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
    expect(queries[0].sql).toContain(
      'lifecycle_status = CASE WHEN $20::boolean THEN EXCLUDED.lifecycle_status'
    );
    expect(queries[0].sql).toContain('metadata = CASE WHEN $27::boolean THEN EXCLUDED.metadata');
    expect(queries[0].params[19]).toBe(false);
    expect(queries[0].params[26]).toBe(false);
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
            canonicalThreadId: provisional,
            mergedThreadId: leadAThread,
            actor: 'integration',
          })
        ).rejects.toThrow('must be canonical');
        await expect(
          store.mergeThreads({
            canonicalThreadId: leadAThread,
            mergedThreadId: leadBThread,
            actor: 'integration',
          })
        ).rejects.toThrow('different leads');
      });
    },
    30_000
  );
});
