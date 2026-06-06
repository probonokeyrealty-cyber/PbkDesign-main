import { describe, expect, jest, test } from '@jest/globals';

import { createLiveConversationProjector } from './conversation-live-projector.mjs';

function projectedEvent(overrides = {}) {
  return {
    workspaceId: 'pbk',
    leadId: 'lead-1',
    eventType: 'message.sms',
    channel: 'sms',
    direction: 'inbound',
    sourceTable: 'unified_messages',
    sourceId: 'message-1',
    provider: 'telnyx',
    senderAddress: '+16145550199',
    recipientAddress: '+16145550101',
    actorType: 'seller',
    actorName: 'Seller',
    subject: '',
    body: 'Hello',
    status: 'received',
    occurredAt: '2026-06-06T20:00:00.000Z',
    payload: {},
    ...overrides,
  };
}

describe('live conversation projection adapter', () => {
  test('resolves the seller thread and upserts the projected event', async () => {
    const resolveThread = jest.fn(async () => ({ id: 'thread-1' }));
    const upsertEvent = jest.fn(async (event) => ({
      id: 'event-1',
      ...event,
    }));
    const adapter = createLiveConversationProjector({
      pool: {},
      createStore: () => ({ resolveThread, upsertEvent }),
      logger: { warn: jest.fn() },
    });

    const result = await adapter.project({
      record: {
        id: 'message-1',
        leadName: 'Diane',
        address: '202 Cherry Ln',
      },
      projector: () => projectedEvent(),
      source: 'telnyx-webhook',
    });

    expect(result.ok).toBe(true);
    expect(resolveThread).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'pbk',
        leadId: 'lead-1',
        phone: '+16145550199',
        title: 'Diane - 202 Cherry Ln',
        source: 'telnyx-webhook',
      })
    );
    expect(upsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        sourceTable: 'unified_messages',
        sourceId: 'message-1',
        eventType: 'message.sms',
      })
    );
  });

  test('uses seller email for outbound email thread resolution', async () => {
    const resolveThread = jest.fn(async () => ({ id: 'thread-email' }));
    const adapter = createLiveConversationProjector({
      pool: {},
      createStore: () => ({
        resolveThread,
        upsertEvent: jest.fn(async (event) => event),
      }),
      logger: { warn: jest.fn() },
    });

    await adapter.project({
      record: { id: 'email-1' },
      projector: () =>
        projectedEvent({
          channel: 'email',
          direction: 'outbound',
          senderAddress: 'offers@pbk.example',
          recipientAddress: 'seller@example.com',
        }),
    });

    expect(resolveThread).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'seller@example.com', phone: '' })
    );
  });

  test('uses payload contact details for leadless system events', async () => {
    const resolveThread = jest.fn(async () => ({ id: 'thread-approval' }));
    const adapter = createLiveConversationProjector({
      pool: {},
      createStore: () => ({
        resolveThread,
        upsertEvent: jest.fn(async (event) => event),
      }),
      logger: { warn: jest.fn() },
    });

    await adapter.project({
      record: { id: 'approval-1' },
      projector: () =>
        projectedEvent({
          leadId: null,
          eventType: 'approval.created',
          channel: 'system',
          direction: 'internal',
          senderAddress: '',
          recipientAddress: '',
          payload: {
            phone: '+16145550199',
            email: 'seller@example.com',
          },
        }),
    });

    expect(resolveThread).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: null,
        phone: '+16145550199',
        email: 'seller@example.com',
      })
    );
  });

  test('falls back to a provisional contact thread when the lead foreign key is stale', async () => {
    const foreignKeyError = Object.assign(new Error('lead profile missing'), {
      code: '23503',
    });
    const upsertEvent = jest.fn(async (event) => event);
    const resolveThread = jest
      .fn()
      .mockRejectedValueOnce(foreignKeyError)
      .mockResolvedValueOnce({ id: 'thread-provisional' });
    const adapter = createLiveConversationProjector({
      pool: {},
      createStore: () => ({
        resolveThread,
        upsertEvent,
      }),
      logger: { warn: jest.fn() },
    });

    const result = await adapter.project({
      record: { id: 'message-1' },
      projector: () =>
        projectedEvent({
          leadId: 'lead-import-not-yet-profiled',
          senderAddress: '+16145550199',
        }),
      source: 'provider-webhook',
    });

    expect(result.ok).toBe(true);
    expect(resolveThread).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        leadId: null,
        phone: '+16145550199',
        source: 'provider-webhook:provisional',
        metadata: expect.objectContaining({
          unresolvedLeadId: 'lead-import-not-yet-profiled',
        }),
      })
    );
    expect(upsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-provisional',
        leadId: null,
      })
    );
  });

  test('uses the inbound seller number for a provisional recording thread', async () => {
    const foreignKeyError = Object.assign(new Error('lead profile missing'), {
      code: '23503',
    });
    const resolveThread = jest
      .fn()
      .mockRejectedValueOnce(foreignKeyError)
      .mockResolvedValueOnce({ id: 'thread-recording-provisional' });
    const adapter = createLiveConversationProjector({
      pool: {},
      createStore: () => ({
        resolveThread,
        upsertEvent: jest.fn(async (event) => event),
      }),
      logger: { warn: jest.fn() },
    });

    const result = await adapter.project({
      record: { id: 'recording-1' },
      projector: () =>
        projectedEvent({
          leadId: 'lead-import-not-yet-profiled',
          eventType: 'call.recording',
          channel: 'call',
          direction: 'internal',
          senderAddress: '+16145550199',
          recipientAddress: '+16145550101',
          payload: {
            callDirection: 'inbound',
          },
        }),
      source: 'telnyx-recording',
    });

    expect(result.ok).toBe(true);
    expect(resolveThread).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        leadId: null,
        phone: '+16145550199',
        source: 'telnyx-recording:provisional',
      })
    );
  });

  test('returns a structured skip when Postgres is unavailable', async () => {
    const adapter = createLiveConversationProjector({
      pool: null,
      logger: { warn: jest.fn() },
    });

    await expect(
      adapter.project({
        record: { id: 'message-1' },
        projector: () => projectedEvent(),
      })
    ).resolves.toEqual({
      ok: false,
      skipped: true,
      result: 'postgres_unavailable',
    });
  });

  test('does not create anonymous threads for leadless system events', async () => {
    const createStore = jest.fn();
    const adapter = createLiveConversationProjector({
      pool: {},
      createStore,
      logger: { warn: jest.fn() },
    });

    const result = await adapter.project({
      record: { id: 'approval-admin-1' },
      projector: () =>
        projectedEvent({
          leadId: null,
          eventType: 'approval.created',
          channel: 'system',
          direction: 'internal',
          senderAddress: '',
          recipientAddress: '',
          payload: {},
        }),
    });

    expect(result).toMatchObject({
      ok: false,
      skipped: true,
      result: 'seller_identity_unavailable',
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  test('swallows projection failures after provider persistence', async () => {
    const warn = jest.fn();
    const adapter = createLiveConversationProjector({
      pool: {},
      createStore: () => ({
        resolveThread: jest.fn(async () => {
          throw new Error('projection database unavailable');
        }),
        upsertEvent: jest.fn(),
      }),
      logger: { warn },
    });

    const result = await adapter.project({
      record: { id: 'message-1' },
      projector: () => projectedEvent(),
      source: 'provider-webhook',
    });

    expect(result).toMatchObject({
      ok: false,
      result: 'conversation_projection_failed',
      error: 'projection database unavailable',
    });
    expect(warn).toHaveBeenCalledWith(
      '[pbk-conversations] live projection failed',
      expect.objectContaining({
        source: 'provider-webhook',
        sourceId: 'message-1',
        eventType: 'message.sms',
      })
    );
  });
});
