import { createConversationStore } from './conversation-store.mjs';

export function sellerContactFromEvent(event = {}) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  if (event.channel === 'email') {
    return {
      email:
        event.direction === 'inbound'
          ? event.senderAddress || ''
          : event.recipientAddress || '',
      phone: '',
    };
  }
  if (event.channel === 'sms' || event.channel === 'call') {
    const contactDirection =
      event.channel === 'call' && event.direction === 'internal'
        ? String(payload.callDirection || '').trim().toLowerCase()
        : event.direction;
    return {
      email: '',
      phone:
        contactDirection === 'inbound'
          ? event.senderAddress || ''
          : contactDirection === 'outbound'
            ? event.recipientAddress || ''
            : String(payload.phone || payload.sellerPhone || '').trim(),
    };
  }
  return {
    email: String(payload.email || payload.sellerEmail || '').trim(),
    phone: String(payload.phone || payload.sellerPhone || '').trim(),
  };
}

export function conversationThreadTitle(record = {}) {
  const leadName = String(record.leadName || record.sellerName || '').trim();
  const address = String(record.address || record.propertyAddress || '').trim();
  return [leadName, address].filter(Boolean).join(' - ');
}

async function projectAnchoredCallCompletion(store, event) {
  const { approvalId, providerReceiptId, durationSeconds } = event.payload || {};
  if (event.eventType !== 'call.completed' || event.sourceTable !== 'calls' ||
      event.direction !== 'outbound' || !event.leadId || !approvalId || !providerReceiptId) return null;
  const { items: threads } = await store.listThreads({ workspaceId: event.workspaceId, leadId: event.leadId, limit: 2 });
  if (threads.length !== 1 || threads[0].leadId !== event.leadId) return null;
  const thread = threads[0];
  const { items } = await store.listTimeline(thread.id, { workspaceId: event.workspaceId, limit: 100 });
  const anchored = items.some((item) => item.leadId === event.leadId && (
    (item.sourceTable === 'calls' && item.sourceId === event.sourceId) ||
    (item.sourceTable === 'activity' && item.eventType === 'system' && item.payload?.callId === event.sourceId)
  ));
  if (!anchored) return null;

  // A known thread can receive the terminal receipt without resolving or
  // claiming the conflicting phone identity or copying conversation content.
  const projected = await store.upsertEvent({
    ...event,
    threadId: thread.id,
    expectedLeadThread: event.leadId,
    senderAddress: '',
    recipientAddress: '',
    actorName: '',
    subject: '',
    body: 'Telnyx call completed',
    payload: { approvalId, providerReceiptId, durationSeconds },
  });
  return { ok: true, result: 'conversation_event_projected', thread, event: projected };
}

export function createLiveConversationProjector({
  pool,
  createStore = createConversationStore,
  logger = console,
} = {}) {
  async function project({
    record,
    projector,
    kind,
    source = 'bridge',
    allowExistingCallThread = false,
  } = {}) {
    if (!pool) {
      return {
        ok: false,
        skipped: true,
        result: 'postgres_unavailable',
      };
    }

    let event = null;
    try {
      event = kind === undefined ? projector(record) : projector(record, kind);
      const contact = sellerContactFromEvent(event);
      if (!event.leadId && !contact.phone && !contact.email) {
        return {
          ok: false,
          skipped: true,
          result: 'seller_identity_unavailable',
          event,
        };
      }
      const store = createStore(pool);
      const threadRequest = {
        workspaceId: event.workspaceId,
        leadId: event.leadId || null,
        phone: contact.phone,
        email: contact.email,
        title: conversationThreadTitle(record),
        source,
        metadata: {
          projectionSource: source,
          sourceTable: event.sourceTable,
          sourceId: event.sourceId,
          eventType: event.eventType,
        },
      };
      let thread;
      let usedProvisionalThread = false;
      try {
        thread = await store.resolveThread(threadRequest);
      } catch (error) {
        if (allowExistingCallThread && /^Conversation identity belongs to a different lead on thread /.test(error?.message || '')) {
          const anchored = await projectAnchoredCallCompletion(store, event);
          if (anchored) return anchored;
        }
        const code = String(error?.code || error?.cause?.code || '');
        if (
          code !== '23503' ||
          !threadRequest.leadId ||
          (!threadRequest.phone && !threadRequest.email)
        ) {
          throw error;
        }
        thread = await store.resolveThread({
          ...threadRequest,
          leadId: null,
          source: `${source}:provisional`,
          metadata: {
            ...threadRequest.metadata,
            unresolvedLeadId: threadRequest.leadId,
          },
        });
        usedProvisionalThread = true;
      }
      const projected = await store.upsertEvent({
        ...event,
        leadId: usedProvisionalThread ? null : event.leadId,
        threadId: thread.id,
        senderIdentityId:
          event.senderIdentityId ||
          event.payload?.senderIdentityId ||
          record?.senderIdentityId ||
          record?.sender_identity_id ||
          null,
      });
      return {
        ok: true,
        result: 'conversation_event_projected',
        thread,
        event: projected,
      };
    } catch (error) {
      const errorMessage = error?.message || String(error);
      logger.warn('[pbk-conversations] live projection failed', {
        source,
        sourceTable: event?.sourceTable || '',
        sourceId:
          event?.sourceId ||
          record?.id ||
          record?.sourceId ||
          record?.source_id ||
          '',
        eventType: event?.eventType || '',
        error: errorMessage,
      });
      return {
        ok: false,
        result: 'conversation_projection_failed',
        error: errorMessage,
      };
    }
  }

  return { project };
}
