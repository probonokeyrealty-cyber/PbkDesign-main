import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const helperUrl = pathToFileURL(
  resolve(root, 'src/app/routes/conversationRuntimeLogic.js')
).href;

async function loadHelper() {
  try {
    return await import(helperUrl);
  } catch {
    return null;
  }
}

describe('Unified conversation runtime logic', () => {
  test('deduplicates only exact thread ids and preserves distinct server threads', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();

    const rows = helper.normalizeConversationThreads([
      {
        id: 'thread-1',
        leadId: 'lead-1',
        title: 'Seller One',
        lastEventAt: '2026-06-01T10:00:00.000Z',
      },
      {
        id: 'thread-1',
        leadId: 'lead-1',
        title: 'Seller One',
        lastEventAt: '2026-06-02T10:00:00.000Z',
        unreadCount: 2,
      },
      {
        id: 'thread-unknown',
        leadId: null,
        title: 'Unknown +16145550199',
        identities: [{ identityType: 'phone', normalizedValue: '+16145550199' }],
        lastEventAt: '2026-06-03T10:00:00.000Z',
      },
      {
        id: 'thread-linked',
        leadId: 'lead-2',
        title: 'Linked Seller',
        identities: [{ identityType: 'phone', normalizedValue: '+16145550199' }],
        lastEventAt: '2026-06-04T10:00:00.000Z',
      },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.leadId === 'lead-1')).toMatchObject({
      id: 'thread-1',
      unreadCount: 2,
    });
    expect(rows.find((row) => row.id === 'thread-unknown')).toBeDefined();
    expect(rows.find((row) => row.leadId === 'lead-2')).toMatchObject({
      id: 'thread-linked',
    });
  });

  test('sorts thread activity newest first without mutating the source array', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();
    const source = [
      { id: 'older', lastEventAt: '2026-06-01T10:00:00.000Z' },
      { id: 'newer', lastEventAt: '2026-06-04T10:00:00.000Z' },
    ];

    const sorted = helper.sortConversationThreads(source);

    expect(sorted.map((thread) => thread.id)).toEqual(['newer', 'older']);
    expect(source.map((thread) => thread.id)).toEqual(['older', 'newer']);
  });

  test('excludes hidden events by default and groups visible events by calendar day', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();
    const events = [
      {
        id: 'event-1',
        occurredAt: '2026-06-05T16:00:00.000Z',
        body: 'Newest',
      },
      {
        id: 'event-hidden',
        occurredAt: '2026-06-05T15:00:00.000Z',
        hiddenAt: '2026-06-05T15:30:00.000Z',
      },
      {
        id: 'event-2',
        occurredAt: '2026-06-04T12:00:00.000Z',
        body: 'Older',
      },
    ];

    expect(helper.filterVisibleConversationEvents(events).map((event) => event.id)).toEqual([
      'event-1',
      'event-2',
    ]);
    expect(helper.filterVisibleConversationEvents(events, { includeHidden: true })).toHaveLength(3);

    const groups = helper.groupConversationEventsByDay(events, { timeZone: 'UTC' });
    expect(groups).toHaveLength(2);
    expect(groups[0].events.map((event) => event.id)).toEqual(['event-2']);
    expect(groups[1].events.map((event) => event.id)).toEqual(['event-1']);

    const boundaryEvents = [
      { id: 'late-pacific', occurredAt: '2026-06-05T06:30:00.000Z' },
      { id: 'early-pacific', occurredAt: '2026-06-05T08:30:00.000Z' },
    ];
    expect(
      helper.groupConversationEventsByDay(boundaryEvents, {
        timeZone: 'America/Los_Angeles',
      })
    ).toHaveLength(2);
  });

  test('filters sender identities by selected channel while preserving restricted choices', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();
    const identities = [
      {
        id: 'sms-ready',
        channel: 'sms',
        lifecycleStatus: 'active',
        healthStatus: 'healthy',
      },
      {
        id: 'sms-restricted',
        channel: 'sms',
        lifecycleStatus: 'quarantined',
        healthStatus: 'warning',
      },
      {
        id: 'email-ready',
        channel: 'email',
        lifecycleStatus: 'active',
        healthStatus: 'healthy',
      },
    ];

    const sms = helper.filterSenderIdentitiesForChannel(identities, 'sms');
    expect(sms.map((identity) => identity.id)).toEqual(['sms-ready', 'sms-restricted']);
    expect(helper.getSenderRestrictionReason(sms[0])).toBe('');
    expect(helper.getSenderRestrictionReason(sms[1])).toMatch(/quarantined/i);
  });

  test('recognizes every supported approval-gated provider response shape', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();

    expect(
      helper.isConversationApprovalRequired({
        approval: { id: 'approval-top-level' },
      })
    ).toBe(true);
    expect(
      helper.isConversationApprovalRequired({
        providerResult: {
          approval: { id: 'approval-provider' },
        },
      })
    ).toBe(true);
    expect(
      helper.isConversationApprovalRequired({
        providerResult: { requiresApproval: true },
      })
    ).toBe(true);
    expect(
      helper.isConversationApprovalRequired({
        result: 'approval_required',
      })
    ).toBe(true);
    expect(
      helper.isConversationApprovalRequired({
        result: 'queued_for_approval',
      })
    ).toBe(true);
    expect(
      helper.isConversationApprovalRequired({
        result: 'sent',
        providerResult: { requiresApproval: false },
      })
    ).toBe(false);
  });

  test('derives explicit mobile transitions and compact previews', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();

    expect(helper.getConversationMobileState({})).toBe('threads');
    expect(helper.getConversationMobileState({ threadId: 'thread-1' })).toBe('conversation');
    expect(
      helper.getConversationMobileState({ threadId: 'thread-1', profileOpen: true })
    ).toBe('profile');

    expect(
      helper.getConversationPreview({
        latestEvent: {
          eventType: 'call_transcript',
          body: 'Seller needs a quick close and prefers afternoons.',
        },
      })
    ).toBe('Seller needs a quick close and prefers afternoons.');
    expect(
      helper.getConversationPreview({
        latestEvent: {
          eventType: 'call_transcript',
          payload: {
            transcript: [{ text: 'Seller needs' }, { text: 'a June close.' }],
          },
        },
      })
    ).toBe('Seller needs a June close.');
  });
});
