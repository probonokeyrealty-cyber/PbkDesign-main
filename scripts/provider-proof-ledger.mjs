const PROVIDER_ALIASES = new Map([
  ['telnyx', 'telnyx'],
  ['sendgrid', 'sendgrid'],
  ['docusign', 'docusign'],
  ['docu sign', 'docusign'],
  ['slack', 'slack'],
]);

const DELIVERY_MAPPINGS = {
  telnyx: {
    confirmed: new Set(['delivered']),
    failed: new Set([
      'delivery_failed',
      'failed',
      'undelivered',
      'rejected',
      'expired',
    ]),
    pending: new Set(['accepted', 'queued', 'sending', 'sent', 'finalized']),
  },
  sendgrid: {
    confirmed: new Set(['delivered', 'open', 'click']),
    failed: new Set(['bounce', 'bounced', 'dropped', 'blocked']),
    pending: new Set(['processed', 'deferred']),
  },
  docusign: {
    confirmed: new Set(['completed', 'delivered', 'signed']),
    failed: new Set(['declined', 'voided', 'deleted']),
    pending: new Set(['created', 'sent', 'envelope_sent']),
  },
  slack: {
    confirmed: new Set(['ok', 'posted', 'sent', 'delivered']),
    failed: new Set(['error', 'failed', 'not_in_channel', 'channel_not_found']),
    pending: new Set(['queued', 'pending', 'rate_limited']),
  },
};

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, '_');
}

function normalizeProvider(provider) {
  const key = normalizeText(provider).toLowerCase();
  return PROVIDER_ALIASES.get(key) || key;
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function getReceiptBody(receipt = {}) {
  return (
    receipt?.payload?.data ||
    receipt?.raw?.data ||
    receipt?.data ||
    receipt?.body ||
    receipt
  );
}

function getReceiptInput(input = {}) {
  if (input?.receipt && typeof input.receipt === 'object') {
    return input.receipt;
  }
  return input || {};
}

function readReceiptStatus(provider, receipt = {}, body = {}) {
  if (provider === 'slack') {
    if (receipt.ok === true || body.ok === true || body.ts || receipt.ts) {
      return 'ok';
    }
    if (receipt.ok === false || body.ok === false || receipt.error || body.error) {
      return firstText(receipt.error, body.error, 'error');
    }
  }

  return firstText(
    receipt.eventType,
    receipt.event_type,
    receipt.deliveryStatus,
    receipt.delivery_status,
    receipt.status,
    body.eventType,
    body.event_type,
    body.deliveryStatus,
    body.delivery_status,
    body.status,
    receipt.event,
    receipt.event_type,
    receipt.type,
    body.event,
    body.event_type,
    body.type
  );
}

function mapDeliveryState(provider, status) {
  const mapping = DELIVERY_MAPPINGS[provider];
  const key = normalizeKey(status).replace(`${provider}_`, '');
  if (!mapping || !key) return 'pending';
  if (mapping.confirmed.has(key)) return 'confirmed';
  if (mapping.failed.has(key)) return 'failed';
  if (mapping.pending.has(key)) return 'pending';
  return 'pending';
}

function readProviderAttemptId(receipt = {}, body = {}) {
  return firstText(
    receipt.providerAttemptId,
    receipt.provider_attempt_id,
    body.providerAttemptId,
    body.provider_attempt_id,
    body.messageId,
    body.message_id,
    body.envelopeId,
    body.envelope_id,
    body.channelId,
    body.channel_id,
    body.id,
    receipt.messageId,
    receipt.message_id,
    receipt.envelopeId,
    receipt.envelope_id,
    receipt.channelId,
    receipt.channel_id,
    receipt.id
  );
}

function readProviderMessageId(receipt = {}, body = {}) {
  return firstText(
    receipt.providerMessageId,
    receipt.provider_message_id,
    body.providerMessageId,
    body.provider_message_id,
    body.messageId,
    body.message_id,
    body.envelopeId,
    body.envelope_id,
    body.id,
    receipt.messageId,
    receipt.message_id,
    receipt.envelopeId,
    receipt.envelope_id,
    receipt.id
  );
}

function readReceiptEventType(receipt = {}, body = {}) {
  return firstText(
    receipt.eventType,
    receipt.event_type,
    receipt.event,
    receipt.type,
    body.eventType,
    body.event_type,
    body.event,
    body.type,
    body.status,
    receipt.status
  );
}

function mapReceiptStatus(provider, eventType, status) {
  const eventKey = normalizeKey(eventType).replace(`${provider}_`, '');
  const statusKey = normalizeKey(status).replace(`${provider}_`, '');
  if (provider === 'telnyx' && eventKey === 'message.delivered') {
    return 'delivered';
  }
  if (provider === 'telnyx' && eventKey === 'message_delivered') {
    return 'delivered';
  }
  if (provider === 'telnyx' && statusKey === 'message.delivered') {
    return 'delivered';
  }
  if (provider === 'telnyx' && statusKey === 'message_delivered') {
    return 'delivered';
  }
  return statusKey || 'pending';
}

export function buildProviderAttempt({
  approvalId = '',
  provider = '',
  actionType = '',
  actorType = '',
  actorId = '',
  leadId = '',
  idempotencyKey = '',
  providerAttemptId = '',
  status = 'attempted',
  attemptedAt = '',
  sentAt = '',
  requestHash = '',
  metadata = undefined,
  raw = null,
} = {}) {
  const normalizedStatus = normalizeKey(status) || 'attempted';
  const normalizedAttemptedAt = firstText(attemptedAt, sentAt);
  return compactObject({
    approvalId: normalizeText(approvalId),
    provider: normalizeProvider(provider),
    actionType: normalizeText(actionType),
    actorType: normalizeText(actorType),
    actorId: normalizeText(actorId),
    leadId: normalizeText(leadId),
    idempotencyKey: normalizeText(idempotencyKey),
    providerAttemptId: normalizeText(providerAttemptId),
    status: normalizedStatus,
    attemptedAt: normalizedAttemptedAt,
    sentAt: normalizedAttemptedAt,
    requestHash: normalizeText(requestHash),
    metadata,
    raw: raw || undefined,
  });
}

export function normalizeProviderReceipt(input = {}) {
  const receipt = getReceiptInput(input);
  const body = getReceiptBody(receipt);
  const normalizedProvider = normalizeProvider(
    firstText(input.provider, receipt.provider, body.provider)
  );
  const eventType = readReceiptEventType(receipt, body);
  const rawStatus = readReceiptStatus(normalizedProvider, receipt, body);
  const status = mapReceiptStatus(normalizedProvider, eventType, rawStatus);
  const deliveryState = mapDeliveryState(
    normalizedProvider,
    status === 'pending' ? rawStatus || eventType : status
  );

  return compactObject({
    provider: normalizedProvider,
    eventType: normalizeText(eventType),
    providerAttemptId: readProviderAttemptId(receipt, body),
    providerMessageId: readProviderMessageId(receipt, body),
    receiptId: firstText(receipt.receiptId, receipt.receipt_id, receipt.id),
    status,
    deliveryState,
    receivedAt: firstText(
      receipt.receivedAt,
      receipt.received_at,
      receipt.occurredAt,
      receipt.occurred_at,
      receipt.createdAt,
      receipt.created_at,
      body.receivedAt,
      body.received_at,
      body.occurredAt,
      body.occurred_at,
      body.createdAt,
      body.created_at
    ),
    occurredAt: firstText(
      receipt.occurredAt,
      receipt.occurred_at,
      body.occurredAt,
      body.occurred_at,
      receipt.receivedAt,
      receipt.received_at,
      body.receivedAt,
      body.received_at
    ),
    raw: input.raw || receipt,
  });
}

export function summarizeProviderProof({
  provider = '',
  attempt: planAttempt = null,
  receipts: planReceipts = undefined,
  providerAttempt = null,
  providerAttemptId = '',
  providerReceipts = [],
} = {}) {
  const sourceAttempt = planAttempt || providerAttempt;
  const normalizedProvider = normalizeProvider(
    firstText(provider, sourceAttempt?.provider)
  );
  const attempt = sourceAttempt || buildProviderAttempt({
    provider: normalizedProvider,
    providerAttemptId,
  });
  const attemptId = firstText(providerAttemptId, attempt.providerAttemptId);
  const sourceReceipts = Array.isArray(planReceipts)
    ? planReceipts
    : providerReceipts;
  const receipts = sourceReceipts.map((receipt) =>
    receipt?.deliveryState
      ? receipt
      : normalizeProviderReceipt({ provider: normalizedProvider, receipt })
  );
  const matchingReceipts = receipts.filter((receipt) => {
    if (!attemptId || !receipt.providerAttemptId) return true;
    return receipt.providerAttemptId === attemptId;
  });

  let proofStatus = 'sent_waiting_for_receipt';
  if (normalizeKey(attempt.status) === 'failed') {
    proofStatus = 'failed';
  } else if (matchingReceipts.some((receipt) => receipt.deliveryState === 'failed')) {
    proofStatus = 'failed';
  } else if (matchingReceipts.some((receipt) => receipt.deliveryState === 'confirmed')) {
    proofStatus = 'confirmed';
  } else if (receipts.length > 0 && matchingReceipts.length === 0) {
    proofStatus = 'reconciliation_required';
  }
  const needsReconciliation = proofStatus === 'reconciliation_required';

  return compactObject({
    provider: normalizedProvider,
    providerAttemptId: attemptId,
    proofStatus,
    needsReconciliation,
    status: proofStatus,
    attempt,
    providerAttempt: attempt,
    receipts,
    providerReceipts: receipts,
  });
}

export function attachProviderProof(value, context = {}) {
  if (!value || typeof value !== 'object' || value.providerProof) {
    return value;
  }

  const providerActionResult =
    value.providerActionResult && typeof value.providerActionResult === 'object'
      ? value.providerActionResult
      : {};
  const provider = firstText(
    value.provider,
    providerActionResult.provider,
    context.provider,
    value.providerAttempt?.provider
  );
  const providerAttemptId = firstText(
    value.providerAttemptId,
    providerActionResult.providerAttemptId,
    providerActionResult.provider_attempt_id,
    value.providerAttempt?.providerAttemptId
  );
  const providerReceipts = Array.isArray(value.providerReceipts)
    ? value.providerReceipts
    : Array.isArray(value.receipts)
      ? value.receipts
    : [];
  const eventType = firstText(
    value.eventType,
    value.event_type,
    providerActionResult.eventType,
    providerActionResult.event_type
  );
  const providerMessageId = firstText(
    value.providerMessageId,
    value.provider_message_id,
    providerActionResult.providerMessageId,
    providerActionResult.provider_message_id
  );

  if (
    !provider &&
    !eventType &&
    !providerMessageId &&
    !providerAttemptId &&
    providerReceipts.length === 0
  ) {
    return value;
  }

  const providerAttempt = value.providerAttempt || buildProviderAttempt({
    approvalId: context.approvalId,
    provider,
    actionType: value.actionType || providerActionResult.actionType || context.toolName,
    actorType: value.actorType || providerActionResult.actorType,
    actorId: value.actorId || providerActionResult.actorId,
    leadId: value.leadId || providerActionResult.leadId,
    idempotencyKey: value.idempotencyKey || providerActionResult.idempotencyKey,
    providerAttemptId,
    status: providerActionResult.ok === false ? 'failed' : 'attempted',
    attemptedAt: firstText(
      value.attemptedAt,
      providerActionResult.attemptedAt,
      value.sentAt,
      providerActionResult.sentAt,
      context.dispatchStartedAt
    ),
    requestHash: value.requestHash || providerActionResult.requestHash,
    metadata: {
      ...(value.metadata && typeof value.metadata === 'object'
        ? value.metadata
        : {}),
      workspaceId: context.workspaceId,
      toolName: context.toolName,
      bindingHash: context.bindingHash,
      attemptToken: context.attemptToken,
    },
  });
  const inlineReceipt =
    eventType || providerMessageId
      ? [
          normalizeProviderReceipt({
            provider,
            eventType,
            providerMessageId,
            raw: value.raw || providerActionResult.raw || value,
          }),
        ]
      : [];
  const receipts = [...providerReceipts, ...inlineReceipt];

  return {
    ...value,
    providerProof: summarizeProviderProof({
      provider,
      attempt: providerAttempt,
      providerAttemptId,
      receipts,
    }),
  };
}
