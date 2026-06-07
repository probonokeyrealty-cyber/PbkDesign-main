import { jest } from '@jest/globals';

import {
  BACKFILL_ORDER,
  backfillExitCode,
  parseBackfillArgs,
  runConversationBackfill,
} from './backfill-conversations.mjs';

function sourceRows() {
  return {
    lead_profiles: [
      {
        id: 'lead-1',
        workspace_id: 'pbk',
        lead_name: 'Diane Kowalski',
        phone: '+1 (614) 555-0199',
        email: 'seller@example.com',
        address: '202 Cherry Ln',
      },
    ],
    unified_messages: [
      {
        id: 'message-1',
        workspace_id: 'pbk',
        lead_id: 'lead-1',
        channel: 'sms',
        direction: 'inbound',
        from_phone: '+16145550199',
        to_phone: '+16145550101',
        body: 'Friday works.',
        created_at: '2026-06-01T12:00:00.000Z',
      },
    ],
    calls: [
      {
        id: 'call-1',
        workspace_id: 'pbk',
        lead_id: 'lead-1',
        direction: 'inbound',
        status: 'completed',
        phone: '+16145550199',
        from_number: '+16145550101',
        started_at: '2026-06-01T12:05:00.000Z',
        ended_at: '2026-06-01T12:15:00.000Z',
        transcript: [{ speaker: 'seller', text: 'Friday works.' }],
        storage_path: 'calls/call-1.mp3',
      },
    ],
    contracts: [
      {
        id: 'contract-1',
        workspace_id: 'pbk',
        lead_id: 'lead-1',
        status: 'sent',
        provider: 'docusign',
        envelope_id: 'envelope-1',
        document_title: 'Cash purchase agreement',
        created_at: '2026-06-01T13:00:00.000Z',
      },
    ],
    activity_log: [
      {
        id: 'activity-1',
        workspace_id: 'pbk',
        lead_id: 'lead-1',
        actor: 'Ava',
        category: 'NOTE',
        text: 'Seller prefers afternoons.',
        created_at: '2026-06-01T13:10:00.000Z',
      },
    ],
  };
}

function fakePool(rowsByTable = sourceRows()) {
  return {
    query: jest.fn(async (sql, values) => {
      if (String(sql).includes('SELECT EXISTS')) {
        const [, leadId] = values;
        return {
          rows: [
            {
              present: (rowsByTable.lead_profiles || []).some(
                (lead) => lead.id === leadId
              ),
            },
          ],
        };
      }
      const table = BACKFILL_ORDER.find((name) =>
        String(sql).includes(`public.${name}`)
      );
      if (!table) throw new Error(`Unexpected SQL: ${sql}`);
      const [, cursor = '', limit = 251] = values;
      const rows = (rowsByTable[table] || [])
        .filter((row) => row.id > cursor)
        .slice(0, limit);
      return { rows };
    }),
  };
}

describe('conversation backfill planning', () => {
  test('skips optional source tables that do not exist', async () => {
    const missing = Object.assign(
      new Error('relation "public.unified_messages" does not exist'),
      { code: '42P01' }
    );
    const pool = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('public.unified_messages')) throw missing;
        return { rows: [] };
      }),
    };

    const result = await runConversationBackfill({
      pool,
      apply: false,
    });

    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(
      result.sources.find((source) => source.table === 'unified_messages')
    ).toMatchObject({
      missing: true,
      errors: 0,
    });
  });

  test('uses the required source order and defaults to dry-run', () => {
    expect(BACKFILL_ORDER).toEqual([
      'lead_profiles',
      'unified_messages',
      'calls',
      'contracts',
      'activity_log',
    ]);
    expect(parseBackfillArgs([])).toMatchObject({
      apply: false,
      dryRun: true,
      batchSize: 250,
      cursor: null,
      workspaceId: 'pbk',
    });
  });

  test('parses apply, cursor, workspace, and bounded batch size', () => {
    expect(
      parseBackfillArgs([
        '--apply',
        '--cursor=calls:call-9',
        '--workspace=team-1',
        '--batch-size=500',
      ])
    ).toMatchObject({
      apply: true,
      dryRun: false,
      batchSize: 500,
      cursor: { table: 'calls', id: 'call-9' },
      workspaceId: 'team-1',
    });
    expect(parseBackfillArgs(['--batch-size=99999']).batchSize).toBe(1000);
    expect(parseBackfillArgs(['--cursor=unified_messages:']).cursor).toEqual({
      table: 'unified_messages',
      id: '',
    });
  });

  test('fails apply automation when Postgres is unavailable', () => {
    const unavailable = {
      ok: false,
      result: 'postgres_unavailable',
    };
    expect(backfillExitCode(unavailable, { apply: false })).toBe(0);
    expect(backfillExitCode(unavailable, { apply: true })).toBe(1);
    expect(backfillExitCode({ ok: false, result: 'projection_failed' })).toBe(1);
    expect(backfillExitCode({ ok: true })).toBe(0);
  });
});

describe('runConversationBackfill', () => {
  test('plans every source without resolving threads or writing events', async () => {
    const pool = fakePool();
    const resolveThread = jest.fn();
    const upsertEvent = jest.fn();

    const result = await runConversationBackfill({
      pool,
      apply: false,
      createStore: () => ({ resolveThread, upsertEvent }),
      ensureSchema: jest.fn(),
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'dry-run',
      complete: true,
      totals: {
        sourceRows: 5,
        plannedEvents: 7,
        threadsResolved: 0,
        insertedEvents: 0,
        updatedEvents: 0,
      },
    });
    expect(result.sources.map((source) => source.table)).toEqual(BACKFILL_ORDER);
    expect(resolveThread).not.toHaveBeenCalled();
    expect(upsertEvent).not.toHaveBeenCalled();
  });

  test('applies canonical threads and idempotent event upserts', async () => {
    const pool = fakePool();
    const resolveThread = jest.fn(async ({ leadId }) => ({
      id: `thread-${leadId || 'contact'}`,
    }));
    const upsertEvent = jest.fn(async (event) => ({
      ...event,
      inserted: event.sourceId !== 'activity-1',
    }));
    const ensureSchema = jest.fn(async () => true);

    const result = await runConversationBackfill({
      pool,
      apply: true,
      batchSize: 1,
      createStore: () => ({ resolveThread, upsertEvent }),
      ensureSchema,
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'apply',
      complete: true,
      totals: {
        sourceRows: 5,
        plannedEvents: 7,
        threadsResolved: 8,
        insertedEvents: 6,
        updatedEvents: 1,
      },
    });
    expect(ensureSchema).toHaveBeenCalledWith(pool);
    expect(resolveThread).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workspaceId: 'pbk',
        leadId: 'lead-1',
        phone: '+1 (614) 555-0199',
        email: 'seller@example.com',
      })
    );
    expect(resolveThread).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'pbk',
        leadId: 'lead-1',
        phone: '+16145550199',
        email: '',
      })
    );
    expect(upsertEvent).toHaveBeenCalledTimes(7);
    expect(
      upsertEvent.mock.calls.map(([event]) => event.eventType)
    ).toEqual([
      'message.sms',
      'call.started',
      'call.transcript',
      'call.recording',
      'call.completed',
      'contract.sent',
      'lead.note',
    ]);
  });

  test('skips orphan events that have no surviving contact identity', async () => {
    const rows = sourceRows();
    rows.activity_log = [
      {
        id: 'activity-orphan',
        workspace_id: 'pbk',
        lead_id: 'lead-missing',
        actor: 'Ava',
        category: 'NOTE',
        text: 'Legacy note without a surviving seller record.',
        created_at: '2026-06-01T13:10:00.000Z',
      },
    ];
    const resolveThread = jest.fn(async ({ leadId }) => ({
      id: `thread-${leadId || 'contact'}`,
    }));
    const upsertEvent = jest.fn(async (event) => ({
      ...event,
      inserted: true,
    }));

    const result = await runConversationBackfill({
      pool: fakePool(rows),
      apply: true,
      createStore: () => ({ resolveThread, upsertEvent }),
      ensureSchema: jest.fn(),
    });

    expect(result.ok).toBe(true);
    expect(
      result.sources.find((source) => source.table === 'activity_log')
    ).toMatchObject({
      skippedOrphans: 1,
      errors: 0,
    });
    expect(upsertEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'activity-orphan' })
    );
  });

  test('returns a safe no-database result', async () => {
    await expect(runConversationBackfill({ pool: null })).resolves.toMatchObject({
      ok: false,
      skipped: true,
      result: 'postgres_unavailable',
      mode: 'dry-run',
    });
  });

  test('checkpoints only the last successful row when projection fails', async () => {
    const rows = sourceRows();
    rows.unified_messages.push({
      id: 'message-2',
      workspace_id: 'pbk',
      lead_id: 'lead-1',
      channel: 'fax',
      direction: 'inbound',
    });
    const result = await runConversationBackfill({
      pool: fakePool(rows),
      apply: false,
      cursor: { table: 'unified_messages', id: '' },
    });

    expect(result).toMatchObject({
      ok: false,
      complete: false,
      nextCursor: {
        table: 'unified_messages',
        id: 'message-1',
      },
      failures: [
        expect.objectContaining({
          table: 'unified_messages',
          id: 'message-2',
        }),
      ],
    });
  });
});
