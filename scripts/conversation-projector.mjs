const FINAL_CALL_STATUSES = new Set([
  'busy',
  'cancelled',
  'canceled',
  'complete',
  'completed',
  'ended',
  'failed',
  'hangup',
  'hungup',
  'no-answer',
  'no_answer',
]);

const STARTED_CALL_STATUSES = new Set([
  'answered',
  'initiated',
  'in-progress',
  'in_progress',
  'live',
  'queued',
  'ringing',
  'started',
]);

const APPROVAL_CREATED_STATUSES = new Set(['pending', 'created', 'requested']);
const APPROVAL_CONCRETE_DECISION_STATUSES = new Set([
  'approved',
  'declined',
  'rejected',
  'needs_revision',
  'cancelled',
  'canceled',
]);
const APPROVAL_DECIDED_STATUSES = new Set([...APPROVAL_CONCRETE_DECISION_STATUSES, 'decided']);

const RECORD_ALIASES = {
  id: ['sourceId', 'source_id'],
  workspaceId: ['workspace_id'],
  leadId: ['lead_id'],
  providerId: ['provider_id'],
  providerMessageId: ['provider_message_id'],
  providerCallId: ['provider_call_id'],
  senderIdentityId: ['sender_identity_id'],
  fromPhone: ['from_phone'],
  toPhone: ['to_phone'],
  fromEmail: ['from_email'],
  toEmail: ['to_email'],
  fromNumber: ['from_number'],
  toNumber: ['to_number'],
  senderAddress: ['sender_address'],
  recipientAddress: ['recipient_address'],
  actorType: ['actor_type'],
  actorName: ['actor_name'],
  senderName: ['sender_name'],
  fromName: ['from_name'],
  sellerName: ['seller_name'],
  agentName: ['agent_name'],
  participantName: ['participant_name'],
  sellerPhone: ['seller_phone'],
  occurredAt: ['occurred_at'],
  sentAt: ['sent_at'],
  createdAt: ['created_at'],
  updatedAt: ['updated_at'],
  actedAt: ['acted_at'],
  decidedAt: ['decided_at'],
  startedAt: ['started_at'],
  endedAt: ['ended_at'],
  completedAt: ['completed_at'],
  signedAt: ['signed_at'],
  viewedAt: ['viewed_at'],
  recordingAt: ['recording_at'],
  recordedAt: ['recorded_at'],
  transcriptAt: ['transcript_at'],
  envelopeId: ['envelope_id'],
  docusignEnvelopeId: ['docusign_envelope_id'],
  documentTitle: ['document_title'],
  templateId: ['template_id'],
  templatePath: ['template_path'],
  selectedPath: ['selected_path'],
  approvalType: ['approval_type'],
  requestedBy: ['requested_by'],
  decidedBy: ['decided_by'],
  recordingUrl: ['recording_url'],
  storagePath: ['storage_path'],
  storageBucket: ['storage_bucket'],
  audioContentType: ['audio_content_type'],
  recordingPath: ['recording_path'],
  durationSeconds: ['duration_seconds'],
  transcriptText: ['transcript_text'],
  transcriptChunk: ['transcript_chunk'],
  currentTranscriptChunk: ['current_transcript_chunk'],
  telnyxCallControlId: ['telnyx_call_control_id'],
  telnyxCallLegId: ['telnyx_call_leg_id'],
  telnyxCallSessionId: ['telnyx_call_session_id'],
};

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(record) {
  if (!isRecord(record)) {
    throw new TypeError('record must be an object');
  }
}

function normalizeRecord(record) {
  const normalizedRecord = { ...record };

  for (const [camelKey, aliases] of Object.entries(RECORD_ALIASES)) {
    if (record[camelKey] === undefined) {
      const alias = aliases.find((key) => record[key] !== undefined);
      if (alias) normalizedRecord[camelKey] = record[alias];
    }
    for (const alias of aliases) delete normalizedRecord[alias];
  }

  return normalizedRecord;
}

function requiredSourceId(record) {
  if (typeof record.id !== 'string' || !record.id.trim()) {
    throw new TypeError('id is required');
  }
  return record.id.trim();
}

function text(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value);
}

function optionalId(value) {
  const normalized = text(value);
  return normalized || null;
}

function normalized(value) {
  return text(value).toLowerCase();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      if (value.trim()) return value.trim();
      continue;
    }
    return value;
  }
  return undefined;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value !== null && value !== undefined && typeof value !== 'object') {
      const normalizedValue = String(value);
      if (normalizedValue) return normalizedValue;
    }
  }
  return '';
}

function firstTimestamp(...values) {
  return firstNonEmpty(...values) ?? null;
}

function mergePayloadFields(record, fields) {
  if (!isRecord(record.payload)) return record;

  const mergedRecord = { ...record };
  for (const field of fields) {
    const value = firstNonEmpty(record[field], record.payload[field]);
    if (value !== undefined) mergedRecord[field] = value;
  }
  return mergedRecord;
}

function cleanValue(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(cleanValue);
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, cleanValue(item)])
  );
}

function payloadFrom(record, excludedKeys, additions = {}) {
  const excluded = new Set([
    'id',
    'workspaceId',
    'leadId',
    'actorType',
    'actorName',
    'payload',
    ...excludedKeys,
  ]);
  const payload = isRecord(record.payload) ? cleanValue(record.payload) : {};

  for (const key of excluded) {
    delete payload[key];
  }

  for (const [key, value] of Object.entries(record)) {
    if (!excluded.has(key) && value !== undefined) {
      payload[key] = cleanValue(value);
    }
  }

  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) {
      payload[key] = cleanValue(value);
    }
  }

  return cleanValue(payload);
}

function directionOf(value, fallback = 'internal') {
  const direction = normalized(value);
  return ['inbound', 'outbound', 'internal'].includes(direction) ? direction : fallback;
}

function actorTypeForDirection(direction) {
  if (direction === 'inbound') return 'seller';
  if (direction === 'outbound') return 'agent';
  return 'system';
}

function commonEvent(record, options) {
  const sourceId = requiredSourceId(record);
  const eventType = options.eventType;
  const sourceTable = options.sourceTable;

  return {
    workspaceId: firstText(record.workspaceId) || 'pbk',
    leadId: optionalId(record.leadId),
    eventType,
    channel: options.channel || 'system',
    direction: options.direction || 'internal',
    sourceTable,
    sourceId,
    sourceKey: `${sourceTable}:${sourceId}:${eventType}`,
    provider: firstText(options.provider),
    senderAddress: firstText(options.senderAddress),
    recipientAddress: firstText(options.recipientAddress),
    actorType: options.actorType || 'system',
    actorName: firstText(options.actorName),
    subject: firstText(options.subject),
    body: firstText(options.body),
    status: firstText(options.status),
    occurredAt: options.occurredAt ?? null,
    payload: options.payload || {},
  };
}

export function projectMessageEvent(record) {
  assertRecord(record);
  record = normalizeRecord(record);
  requiredSourceId(record);

  const channel = normalized(record.channel);
  const nativeRecording = channel === 'call' && normalized(record.direction) === 'recording';
  const nativeTranscript =
    channel === 'call' &&
    ['transcript', 'transcription'].includes(normalized(record.direction));
  if (nativeTranscript) {
    const senderAddress = firstText(record.fromPhone, record.senderAddress, record.from);
    const recipientAddress = firstText(record.toPhone, record.recipientAddress, record.to);

    return commonEvent(record, {
      eventType: 'call.transcript',
      channel: 'call',
      direction: directionOf(record.payload?.callDirection, 'internal'),
      sourceTable: 'unified_messages',
      provider: record.provider,
      senderAddress,
      recipientAddress,
      actorType: firstText(record.actorType) || 'system',
      actorName: record.actorName,
      subject: record.subject,
      body: record.body ?? record.text,
      status: record.status,
      occurredAt: firstTimestamp(
        record.occurredAt,
        record.transcriptAt,
        record.createdAt,
        record.updatedAt
      ),
      payload: payloadFrom(record, [
        'channel',
        'direction',
        'provider',
        'fromPhone',
        'toPhone',
        'senderAddress',
        'recipientAddress',
        'from',
        'to',
        'actorName',
        'subject',
        'body',
        'text',
        'status',
        'occurredAt',
        'transcriptAt',
        'createdAt',
        'updatedAt',
      ]),
    });
  }
  if (nativeRecording) {
    record = mergePayloadFields(record, [
      'recordingUrl',
      'storagePath',
      'storageBucket',
      'audioContentType',
      'durationSeconds',
      'callId',
      'callDirection',
    ]);
    const senderAddress = firstText(record.fromPhone, record.senderAddress, record.from);
    const recipientAddress = firstText(record.toPhone, record.recipientAddress, record.to);

    return commonEvent(record, {
      eventType: 'call.recording',
      channel: 'call',
      direction: 'internal',
      sourceTable: 'unified_messages',
      provider: record.provider,
      senderAddress,
      recipientAddress,
      actorType: firstText(record.actorType) || 'system',
      actorName: record.actorName,
      subject: record.subject,
      body: record.body,
      status: record.status,
      occurredAt: firstTimestamp(
        record.occurredAt,
        record.sentAt,
        record.createdAt,
        record.updatedAt
      ),
      payload: payloadFrom(
        record,
        [
          'channel',
          'direction',
          'provider',
          'fromPhone',
          'toPhone',
          'senderAddress',
          'recipientAddress',
          'from',
          'to',
          'subject',
          'body',
          'status',
          'storagePath',
          'storageBucket',
          'audioContentType',
          'durationSeconds',
          'duration',
          'recordingUrl',
          'callId',
          'occurredAt',
          'sentAt',
          'createdAt',
          'updatedAt',
        ],
        {
          storagePath: firstNonEmpty(record.storagePath),
          storageBucket: firstNonEmpty(record.storageBucket),
          audioContentType: firstNonEmpty(record.audioContentType),
          durationSeconds: firstNonEmpty(record.durationSeconds, record.duration),
          recordingUrl: firstNonEmpty(record.recordingUrl),
          callId: firstNonEmpty(record.callId),
          callDirection: firstNonEmpty(record.callDirection),
        }
      ),
    });
  }
  if (!['sms', 'email'].includes(channel)) {
    throw new TypeError('supported message channel is required');
  }

  const direction = directionOf(record.direction);
  const senderAddress =
    channel === 'sms'
      ? firstText(record.fromPhone, record.senderAddress, record.from)
      : firstText(
          record.fromEmail,
          record.senderAddress,
          record.from,
          direction === 'inbound' ? record.email : ''
        );
  const recipientAddress =
    channel === 'sms'
      ? firstText(record.toPhone, record.recipientAddress, record.to)
      : firstText(
          record.toEmail,
          record.recipientAddress,
          record.to,
          direction === 'outbound' ? record.email : ''
        );
  const actorName = firstText(
    record.senderName,
    record.fromName,
    record.actorName,
    direction === 'inbound' ? record.sellerName : record.agentName
  );

  return commonEvent(record, {
    eventType: `message.${channel}`,
    channel,
    direction,
    sourceTable: 'unified_messages',
    provider: record.provider,
    senderAddress,
    recipientAddress,
    actorType: firstText(record.actorType) || actorTypeForDirection(direction),
    actorName,
    subject: record.subject,
    body: record.body ?? record.text,
    status: record.status,
    occurredAt: firstTimestamp(
      record.occurredAt,
      record.sentAt,
      record.createdAt,
      record.updatedAt
    ),
    payload: payloadFrom(record, [
      'channel',
      'direction',
      'provider',
      'fromPhone',
      'toPhone',
      'fromEmail',
      'toEmail',
      'senderAddress',
      'recipientAddress',
      'from',
      'to',
      'senderName',
      'fromName',
      'actorName',
      'sellerName',
      'agentName',
      'subject',
      'body',
      'text',
      'status',
      'occurredAt',
      'sentAt',
      'createdAt',
      'updatedAt',
    ]),
  });
}

function normalizeCallKind(kind) {
  const value = normalized(kind).replace(/^call\./, '');
  const aliases = {
    start: 'started',
    initiated: 'started',
    transcript: 'transcript',
    recording: 'recording',
    complete: 'completed',
    ended: 'completed',
  };
  const normalizedKind = aliases[value] || value;
  return ['started', 'transcript', 'recording', 'completed'].includes(normalizedKind)
    ? normalizedKind
    : '';
}

function transcriptChunk(record) {
  return firstNonEmpty(record.transcriptChunk, record.currentTranscriptChunk, record.chunk);
}

function transcriptEntryBody(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (!isRecord(entry)) return '';

  const entryText = firstText(entry.text, entry.transcript, entry.content, entry.message);
  if (!entryText) return '';
  const speaker = firstText(entry.speaker, entry.role, entry.name);
  return speaker ? `${speaker}: ${entryText}` : entryText;
}

function transcriptBody(record) {
  const chunk = transcriptChunk(record);
  if (typeof chunk === 'string') return chunk;
  if (isRecord(chunk)) {
    return firstText(chunk.text, chunk.transcript, chunk.content, chunk.message);
  }

  const directText = firstText(record.transcriptText, record.text);
  if (directText) return directText;
  if (typeof record.transcript === 'string') return record.transcript;
  if (Array.isArray(record.transcript)) {
    return record.transcript.map(transcriptEntryBody).filter(Boolean).join('\n');
  }
  return '';
}

function inferCallKind(record) {
  const states = [record.state, record.status]
    .map((value) => normalized(value).replace(/^call\./, ''))
    .filter(Boolean);
  if (
    states.some((state) => state === 'recording' || state === 'recorded') ||
    firstText(record.recordingUrl, record.recordingURL, record.storagePath, record.recordingPath)
  ) {
    return 'recording';
  }
  if (states.some((state) => FINAL_CALL_STATUSES.has(state))) return 'completed';
  if (
    states.some((state) => state === 'transcript' || state === 'transcribing') ||
    transcriptChunk(record) !== undefined ||
    firstText(record.transcriptText) ||
    (Array.isArray(record.transcript) && record.transcript.length > 0) ||
    firstText(record.transcript)
  ) {
    return 'transcript';
  }
  if (states.some((state) => STARTED_CALL_STATUSES.has(state)) || record.startedAt)
    return 'started';
  return 'started';
}

function callOccurredAt(record, kind) {
  if (kind === 'started') {
    return firstTimestamp(record.startedAt, record.occurredAt, record.createdAt, record.updatedAt);
  }
  if (kind === 'transcript') {
    const chunk = transcriptChunk(record);
    return firstTimestamp(
      record.transcriptAt,
      isRecord(chunk) ? firstNonEmpty(chunk.occurredAt, chunk.timestamp, chunk.at) : null,
      record.occurredAt,
      record.updatedAt,
      record.createdAt
    );
  }
  if (kind === 'recording') {
    return firstTimestamp(
      record.recordingAt,
      record.recordedAt,
      record.occurredAt,
      record.updatedAt,
      record.endedAt,
      record.createdAt
    );
  }
  return firstTimestamp(
    record.endedAt,
    record.completedAt,
    record.occurredAt,
    record.updatedAt,
    record.createdAt
  );
}

function callAddresses(record, direction) {
  const explicitSender = firstText(
    record.fromPhone,
    record.fromNumber,
    record.senderAddress,
    record.from
  );
  const explicitRecipient = firstText(
    record.toPhone,
    record.toNumber,
    record.recipientAddress,
    record.to
  );
  if (explicitRecipient) {
    return { senderAddress: explicitSender, recipientAddress: explicitRecipient };
  }

  const sellerAddress = firstText(record.phone, record.sellerPhone);
  return direction === 'inbound'
    ? { senderAddress: sellerAddress, recipientAddress: explicitSender }
    : { senderAddress: explicitSender, recipientAddress: sellerAddress };
}

export function projectCallEvent(record, kind) {
  assertRecord(record);
  record = normalizeRecord(record);
  requiredSourceId(record);

  const explicitKind = kind === undefined ? '' : normalizeCallKind(kind);
  if (kind !== undefined && !explicitKind) {
    throw new TypeError('supported call kind is required');
  }
  const callKind = explicitKind || inferCallKind(record);
  const direction = directionOf(record.direction);
  const { senderAddress, recipientAddress } = callAddresses(record, direction);
  const chunk = transcriptChunk(record);
  const chunkContext = isRecord(chunk)
    ? Object.fromEntries(
        Object.entries(chunk).filter(([key]) => !['text', 'transcript'].includes(key))
      )
    : {};

  return commonEvent(record, {
    eventType: `call.${callKind}`,
    channel: 'call',
    direction,
    sourceTable: 'calls',
    provider: record.provider,
    senderAddress,
    recipientAddress,
    actorType: firstText(record.actorType) || actorTypeForDirection(direction),
    actorName: firstText(record.senderName, record.actorName, record.participantName),
    subject: record.subject,
    body: callKind === 'transcript' ? transcriptBody(record) : record.notes,
    status: record.status,
    occurredAt: callOccurredAt(record, callKind),
    payload: payloadFrom(
      record,
      [
        'direction',
        'provider',
        'fromPhone',
        'toPhone',
        'fromNumber',
        'toNumber',
        'senderAddress',
        'recipientAddress',
        'from',
        'to',
        'phone',
        'sellerPhone',
        'senderName',
        'actorName',
        'participantName',
        'subject',
        'notes',
        'status',
        'transcriptChunk',
        'currentTranscriptChunk',
        'chunk',
        'transcript',
        'transcriptText',
        'text',
        'recordingUrl',
        'recordingURL',
        'storagePath',
        'storageBucket',
        'audioContentType',
        'recordingPath',
        'durationSeconds',
        'duration',
        'startedAt',
        'endedAt',
        'completedAt',
        'recordingAt',
        'recordedAt',
        'transcriptAt',
        'occurredAt',
        'createdAt',
        'updatedAt',
      ],
      {
        ...chunkContext,
        transcript: Array.isArray(record.transcript) ? record.transcript : undefined,
        recordingUrl: firstText(record.recordingUrl, record.recordingURL) || undefined,
        storagePath: firstText(record.storagePath, record.recordingPath) || undefined,
        storageBucket: firstNonEmpty(record.storageBucket),
        audioContentType: firstNonEmpty(record.audioContentType),
        durationSeconds: firstNonEmpty(record.durationSeconds, record.duration),
        callDirection:
          callKind === 'recording' && ['inbound', 'outbound'].includes(direction)
            ? direction
            : undefined,
      }
    ),
  });
}

function contractEventType(status) {
  if (status === 'sent') return 'contract.sent';
  if (status === 'viewed' || status === 'delivered') return 'contract.viewed';
  if (status === 'signed' || status === 'completed') return 'contract.completed';
  return 'system';
}

export function projectContractEvent(record) {
  assertRecord(record);
  record = normalizeRecord(record);
  requiredSourceId(record);

  const status = normalized(record.status);
  const eventType = contractEventType(status);
  const envelopeId = firstText(record.envelopeId, record.docusignEnvelopeId);
  const documentTitle = firstText(record.documentTitle, record.title);
  const template = firstText(
    record.template,
    record.templateId,
    record.templatePath,
    record.selectedPath
  );
  const explicitProvider = firstText(record.provider);
  const provider = explicitProvider || (envelopeId ? 'docusign' : '');
  const statusOccurredAt =
    eventType === 'contract.sent'
      ? record.sentAt
      : eventType === 'contract.viewed'
        ? record.viewedAt
        : eventType === 'contract.completed'
          ? firstNonEmpty(record.completedAt, record.signedAt)
          : null;

  return commonEvent(record, {
    eventType,
    channel: 'system',
    direction: 'internal',
    sourceTable: 'contracts',
    provider,
    actorType: firstText(record.actorType) || 'system',
    actorName: firstText(record.actorName, provider),
    subject: documentTitle,
    body: firstText(record.notes, record.summary),
    status: record.status,
    occurredAt: firstTimestamp(
      statusOccurredAt,
      record.occurredAt,
      record.updatedAt,
      record.createdAt
    ),
    payload: payloadFrom(
      record,
      [
        'status',
        'provider',
        'envelopeId',
        'docusignEnvelopeId',
        'documentTitle',
        'title',
        'template',
        'templateId',
        'templatePath',
        'selectedPath',
        'actorName',
        'notes',
        'summary',
        'sentAt',
        'viewedAt',
        'completedAt',
        'signedAt',
        'occurredAt',
        'createdAt',
        'updatedAt',
      ],
      {
        envelopeId: envelopeId || undefined,
        documentTitle: documentTitle || undefined,
        template: template || undefined,
        status: firstText(record.status) || undefined,
      }
    ),
  });
}

function approvalEventType(status) {
  if (APPROVAL_CREATED_STATUSES.has(status)) return 'approval.created';
  if (APPROVAL_DECIDED_STATUSES.has(status)) return 'approval.decided';
  return 'system';
}

export function projectApprovalEvent(record) {
  assertRecord(record);
  record = normalizeRecord(record);
  requiredSourceId(record);

  const status = normalized(record.status);
  const eventType = approvalEventType(status);
  const approvalType = firstText(record.approvalType, record.type);
  const action = firstText(record.action, record.payload?.action);
  const decision =
    firstText(record.decision, record.payload?.decision, record.outcome, record.payload?.outcome) ||
    (APPROVAL_CONCRETE_DECISION_STATUSES.has(status) ? status : '');
  const actorName =
    eventType === 'approval.decided'
      ? firstText(record.decidedBy, record.actorName, record.actor, record.requestedBy)
      : firstText(record.requestedBy, record.actorName, record.actor);

  return commonEvent(record, {
    eventType,
    channel: 'system',
    direction: 'internal',
    sourceTable: 'approvals',
    provider: record.provider,
    actorType: firstText(record.actorType) || (actorName ? 'agent' : 'system'),
    actorName,
    subject: record.subject,
    body: firstText(record.summary, record.notes),
    status: record.status,
    occurredAt: firstTimestamp(
      eventType === 'approval.decided'
        ? firstNonEmpty(record.actedAt, record.decidedAt)
        : record.createdAt,
      record.updatedAt,
      record.createdAt
    ),
    payload: payloadFrom(
      record,
      [
        'approvalType',
        'type',
        'action',
        'decision',
        'status',
        'provider',
        'decidedBy',
        'requestedBy',
        'actorName',
        'actor',
        'subject',
        'summary',
        'notes',
        'actedAt',
        'decidedAt',
        'createdAt',
        'updatedAt',
      ],
      {
        approvalType: approvalType || undefined,
        action: action || undefined,
        decision: decision || undefined,
      }
    ),
  });
}

function activityEventType(record) {
  const category = normalized(record.category);
  const type = normalized(record.type);
  const action = normalized(record.action);
  const combined = [category, type, action].filter(Boolean).join(' ');

  if (category.includes('note') || type.includes('note') || record.note !== undefined) {
    return 'lead.note';
  }
  if (
    /\blead[\s._-]*(update|updated|edit|edited)\b/.test(combined) ||
    ['update', 'updated', 'edit', 'edited'].includes(action)
  ) {
    return 'lead.updated';
  }
  return 'system';
}

export function projectActivityEvent(record) {
  assertRecord(record);
  record = normalizeRecord(record);
  requiredSourceId(record);

  const eventType = activityEventType(record);
  const actorName = firstText(record.actorName, record.actor);
  const actorType =
    firstText(record.actorType) ||
    (!actorName || normalized(actorName) === 'system' ? 'system' : 'agent');
  const category = firstText(record.category);
  const target = firstText(record.target);
  const source = firstText(record.source);

  return commonEvent(record, {
    eventType,
    channel: 'system',
    direction: 'internal',
    sourceTable: 'activity',
    provider: record.provider,
    actorType,
    actorName,
    subject: record.subject,
    body: firstText(record.text, record.note, record.body),
    status: record.status,
    occurredAt: firstTimestamp(record.occurredAt, record.at, record.createdAt, record.updatedAt),
    payload: payloadFrom(
      record,
      [
        'category',
        'actorName',
        'actor',
        'provider',
        'subject',
        'text',
        'note',
        'body',
        'status',
        'target',
        'source',
        'metadata',
        'occurredAt',
        'at',
        'createdAt',
        'updatedAt',
      ],
      {
        category: category || undefined,
        target: target || undefined,
        source: source || undefined,
        metadata: isRecord(record.metadata) ? record.metadata : undefined,
      }
    ),
  });
}
