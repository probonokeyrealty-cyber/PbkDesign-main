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
  const preview = candidates.map((candidate) => text(candidate)).find(Boolean);
  if (preview) return preview;
  if (Object.keys(payload).length) return JSON.stringify(payload, null, 2);
  return 'No approval payload was attached by the runtime.';
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
