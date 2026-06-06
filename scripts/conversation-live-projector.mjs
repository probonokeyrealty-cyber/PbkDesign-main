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
