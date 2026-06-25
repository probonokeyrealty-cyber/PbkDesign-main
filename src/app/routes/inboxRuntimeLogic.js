const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ' +
  ' !"#¤%&\'()*+,-./0123456789:;<=>?' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ`¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€';

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstText(...values) {
  return values.map((value) => text(value)).find(Boolean) || '';
}

function friendlyApprovalLabel(value) {
  const raw = text(value);
  if (!raw) return '';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\bcrm\b/gi, 'CRM')
    .replace(/\bdocusign\b/gi, 'DocuSign')
    .replace(/\bsms\b/gi, 'SMS')
    .replace(/\bemail\b/gi, 'email')
    .replace(/\bupdate\b/gi, 'update')
    .replace(/\bcreate\b/gi, 'create')
    .trim();
}

export function isGenericApprovalCopy(value) {
  const raw = text(value);
  if (!raw) return false;
  const normalized = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  return [
    'administrative action queued for review.',
    'administrative action queued for review',
    'ava or rex needs an operator decision before continuing.',
    'ava or rex needs an operator decision before continuing',
    'actions ava or rex cannot complete without your decision.',
    'actions ava or rex cannot complete without your decision',
  ].includes(normalized);
}

function getApprovalFallbackSummary(approval, payload, metadata, contract) {
  const action = friendlyApprovalLabel(
    firstText(
      approval.approvalAction,
      approval.action,
      approval.type,
      payload.action,
      payload.intent,
      metadata.action
    )
  );
  const seller = firstText(
    approval.leadName,
    approval.sellerName,
    payload.leadName,
    payload.sellerName,
    objectValue(payload.seller).name,
    metadata.leadName
  );
  const address = firstText(
    approval.address,
    approval.propertyAddress,
    payload.address,
    payload.propertyAddress,
    objectValue(payload.property).address,
    contract.address
  );
  const channel = friendlyApprovalLabel(firstText(payload.channel, metadata.channel));
  const parts = [];
  if (action) parts.push(`${action.charAt(0).toUpperCase()}${action.slice(1)}`);
  if (seller) parts.push(`Seller: ${seller}`);
  if (address) parts.push(`Property: ${address}`);
  if (channel) parts.push(`Channel: ${channel}`);
  if (parts.length) return parts.join(' · ');
  return 'Ava has a workspace action ready for review.';
}

export function getApprovalFriendlySummary(approval = {}) {
  const payload = objectValue(approval.payload);
  const metadata = objectValue(approval.metadata);
  const contract = objectValue(approval.contract);
  return getApprovalFallbackSummary(approval, payload, metadata, contract);
}

function gsmSeptetLength(message = '') {
  let units = 0;
  for (const char of String(message || '')) {
    if (GSM_BASIC.includes(char)) {
      units += 1;
    } else if (GSM_EXTENDED.includes(char)) {
      units += 2;
    } else {
      return null;
    }
  }
  return units;
}

export function getSmsSegmentInfo(message = '') {
  const raw = String(message || '');
  const gsmUnits = gsmSeptetLength(raw);
  if (gsmUnits !== null) {
    const perSegment = gsmUnits <= 160 ? 160 : 153;
    return {
      encoding: 'gsm-7',
      units: gsmUnits,
      segments: Math.max(1, Math.ceil(gsmUnits / perSegment)),
      perSegment,
    };
  }

  const units = raw.length;
  const perSegment = units <= 70 ? 70 : 67;
  return {
    encoding: 'ucs-2',
    units,
    segments: Math.max(1, Math.ceil(units / perSegment)),
    perSegment,
  };
}

export function normalizeComposeLead(record = {}, index = 0) {
  const payload = objectValue(record.payload);
  const source = { ...payload, ...record };
  const seller = objectValue(source.seller);
  const property = objectValue(source.property);
  const id = text(source.id || source.leadId || source.lead_id || payload.id || `lead-${index}`);
  return {
    id,
    name: text(source.name || source.leadName || source.lead_name || seller.name, 'Unknown seller'),
    phone: text(source.phone || source.to || seller.phone || seller.mobile || source.mobile),
    email: text(source.email || seller.email || source.recipientEmail || source.recipient_email),
    address: text(
      source.address || property.address || source.propertyAddress || source.property_address
    ),
  };
}

export function normalizeComposeLeads(records = []) {
  return (Array.isArray(records) ? records : [])
    .map(normalizeComposeLead)
    .filter((lead) => lead.id || lead.name || lead.phone || lead.email || lead.address);
}

export function buildComposeRequest(draft = {}, lead = {}) {
  const channel = String(draft.channel || 'sms').toLowerCase() === 'email' ? 'email' : 'sms';
  const recipient = text(draft.recipient || (channel === 'sms' ? lead.phone : lead.email));
  const message = text(draft.message || draft.body);
  const leadId = text(draft.leadId || lead.id || lead.leadId);
  const leadName = text(lead.name || lead.leadName);
  const address = text(lead.address);
  const base = {
    channel,
    leadId,
    leadName,
    address,
    message,
    body: message,
    source: 'inbox-compose',
  };

  if (channel === 'sms') {
    base.phone = recipient;
    base.to = recipient;
  } else {
    base.email = recipient;
    base.to = recipient;
  }

  if (draft.sendLater && draft.sendAt) {
    return {
      path: '/api/messages',
      body: {
        ...base,
        direction: 'outbound',
        status: 'scheduled',
        scheduledFor: draft.sendAt,
        sendAt: draft.sendAt,
      },
    };
  }

  return {
    path: '/api/lead/send-message',
    body: base,
  };
}

export function getApprovalPreview(approval = {}) {
  const payload = objectValue(approval.payload);
  const metadata = objectValue(approval.metadata);
  const contract = objectValue(approval.contract);
  const candidates = [
    approval.message,
    approval.body,
    approval.text,
    approval.content,
    approval.contractBody,
    approval.contract_body,
    approval.emailBody,
    approval.email_body,
    approval.smsBody,
    approval.sms_body,
    payload.message,
    payload.body,
    payload.text,
    payload.content,
    payload.contractBody,
    payload.contract_body,
    metadata.message,
    metadata.body,
    metadata.preview,
    contract.body,
    contract.summary,
    approval.notes,
  ];
  const preview = candidates
    .map((candidate) => text(candidate))
    .find((candidate) => candidate && !isGenericApprovalCopy(candidate));
  if (preview) return preview;
  if (Object.keys(payload).length || Object.keys(metadata).length || Object.keys(contract).length) {
    return getApprovalFallbackSummary(approval, payload, metadata, contract);
  }
  return 'Ava has a workspace action ready for review.';
}

export function isContractApproval(approval = {}) {
  const label = [approval.type, approval.approvalAction, approval.action]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /contract|docusign|docu sign/.test(label);
}

export function getPendingApprovals(approvals = []) {
  return (Array.isArray(approvals) ? approvals : []).filter(
    (approval) => String(approval?.status || 'pending').toLowerCase() === 'pending'
  );
}

export function getPendingApprovalCount(snapshot = {}) {
  return getPendingApprovals(snapshot?.approvals).length;
}

export function getMessageTimestamp(message = {}) {
  return text(
    message.createdAt || message.at || message.updatedAt || message.scheduledFor || message.sendAt
  );
}

export function sortMessagesNewest(messages = []) {
  return [...(Array.isArray(messages) ? messages : [])].sort((a, b) => {
    const left = Date.parse(getMessageTimestamp(a));
    const right = Date.parse(getMessageTimestamp(b));
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });
}

export function isUnreadMessage(message = {}) {
  if (message.readAt || message.archivedAt) return false;
  if (message.unread === true || message.isUnread === true) return true;
  const direction = String(message.direction || '').toLowerCase();
  const status = String(message.status || '').toLowerCase();
  return (
    direction === 'inbound' &&
    ['received', 'new', 'unread', 'pending'].includes(status || 'received')
  );
}

export function buildReplyDraftFromMessage(message = {}) {
  const channel = String(message.channel || 'sms').toLowerCase() === 'email' ? 'email' : 'sms';
  const recipient =
    channel === 'sms'
      ? text(message.from || message.phone || message.to)
      : text(message.fromEmail || message.email || message.from || message.to);
  return {
    channel,
    recipient,
    leadId: text(message.leadId),
    message: '',
    sendLater: false,
    sendAt: '',
  };
}
