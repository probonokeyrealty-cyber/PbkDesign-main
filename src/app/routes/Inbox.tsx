import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Inbox as InboxIcon,
  Loader2,
  Mail,
  MessageSquare,
  MessagesSquare,
  Plus,
  RefreshCw,
  Reply,
  Send,
  UserRound,
  X,
} from 'lucide-react';
import { PbkDataSource } from '../../components/pbk/index';
import { InboxSignalLanes, type InboxSignalLane } from '../components/inbox/InboxSignalLanes';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  archiveMessageRequest,
  fetchLeadsRequest,
  fetchMessagesRequest,
  scheduleMessageRequest,
  sendMessageRequest,
  updateApprovalDecision,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';
import {
  buildComposeRequest,
  buildReplyDraftFromMessage,
  getApprovalPreview,
  getPendingApprovals,
  getSmsSegmentInfo,
  isContractApproval,
  isUnreadMessage,
  normalizeComposeLeads,
  sortMessagesNewest,
} from './inboxRuntimeLogic.js';

const COMPOSE_DRAFT_KEY = 'pbk:compose:draft';
const MESSAGE_PAGE_SIZE = 12;

type ComposeChannel = 'sms' | 'email';

type ComposeLead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
};

type ComposeDraft = {
  channel: ComposeChannel;
  recipient: string;
  leadId: string;
  message: string;
  sendLater: boolean;
  sendAt: string;
};

type ApprovalDecisionDraft = {
  approval: Record<string, unknown>;
  status: string;
  actionLabel: string;
  warning: string;
};

type InboxActionStatus = {
  tone: 'success' | 'error';
  text: string;
};
type InboxStats = {
  pendingApprovals: number;
  unreadMessages: number;
  scheduledMessages: number;
  totalMessages: number;
  visibleMessages: number;
  composeLeadCount: number;
};

const EMPTY_DRAFT: ComposeDraft = {
  channel: 'sms',
  recipient: '',
  leadId: '',
  message: '',
  sendLater: false,
  sendAt: '',
};

const QUICK_TEMPLATES = [
  {
    label: 'Thanks - ask address',
    text: 'Thanks for reaching out. What is the property address so I can take a quick look?',
  },
  {
    label: 'Ask timeline',
    text: 'What timeline would feel ideal if we could make the numbers work?',
  },
  {
    label: 'Ask condition',
    text: 'Can you tell me what repairs or updates the property needs right now?',
  },
  {
    label: 'Offer cash',
    text: 'If you want the cleanest route, I can look at a cash offer with an as-is close.',
  },
  { label: 'Schedule call', text: 'Would today or tomorrow be better for a quick 10-minute call?' },
  {
    label: 'Polite no',
    text: 'I do not think I can be the right buyer at that number, but I appreciate you sharing the details.',
  },
];

const EMOJIS = [
  '\u{1F44D}',
  '\u{1F64F}',
  '\u{1F3E0}',
  '\u{1F4DE}',
  '\u2705',
  '\u{1F4AC}',
  '\u23F1\uFE0F',
  '\u{1F91D}',
  '\u{1F4CD}',
  '\u{1F4B0}',
  '\u{1F642}',
  '\u{1F64C}',
];

function formatRuntimeStatus(status: unknown) {
  const normalized = String(status || 'sent').toLowerCase();
  if (normalized === 'provider_missing') return 'Provider key missing';
  if (normalized === 'queued') return 'Queued to send';
  if (normalized === 'queued_for_approval') return 'Queued for approval';
  if (normalized === 'scheduled') return 'Scheduled';
  if (normalized === 'sent') return 'Sent';
  if (normalized === 'received' || normalized === 'unread' || normalized === 'new')
    return 'New reply';
  if (normalized === 'failed') return 'Delivery failed';
  if (normalized === 'pending') return 'Waiting';
  if (normalized === 'approved') return 'Approved';
  if (normalized === 'rejected') return 'Declined';
  if (normalized === 'needs-revision' || normalized === 'needs_revision') return 'Needs Revision';
  return normalized ? normalized.replace(/_/g, ' ') : 'No data yet';
}

function isValidRecipientEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidRecipientPhone(value: string) {
  return value.replace(/\D/g, '').length >= 10;
}

function validateComposeRecipient(draft: ComposeDraft, selectedLead?: ComposeLead) {
  const recipient = draft.recipient.trim();
  if (!recipient) return '';
  if (selectedLead) {
    if (draft.channel === 'sms' && !selectedLead.phone) return 'Selected lead has no phone number.';
    if (draft.channel === 'email' && !selectedLead.email)
      return 'Selected lead has no email address.';
    return '';
  }
  if (draft.channel === 'sms' && !isValidRecipientPhone(recipient)) {
    return 'Enter a phone number with at least 10 digits or choose a lead.';
  }
  if (draft.channel === 'email' && !isValidRecipientEmail(recipient)) {
    return 'Enter a valid email address or choose a lead.';
  }
  return '';
}

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 'just now';
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDateTime(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ');
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getMessageTimestamp(message: Record<string, unknown>) {
  return String(
    message.createdAt ||
      message.at ||
      message.updatedAt ||
      message.scheduledFor ||
      message.sendAt ||
      ''
  );
}

function getMessageTitle(message: Record<string, unknown>) {
  return String(message.leadName || message.address || message.from || message.to || 'Message');
}

function getMessageLeadId(message: Record<string, unknown>) {
  const payload =
    message.payload && typeof message.payload === 'object'
      ? (message.payload as Record<string, unknown>)
      : {};
  return String(message.leadId || message.lead_id || payload.leadId || payload.lead_id || '');
}

function getMessageBody(message: Record<string, unknown>) {
  return String(message.body || message.message || message.text || '(empty message)');
}

function buildInboxStats({
  approvals,
  allMessages,
  visibleMessages,
  totalMessages,
  composeLeadCount,
}: {
  approvals: Record<string, unknown>[];
  allMessages: Record<string, unknown>[];
  visibleMessages: Record<string, unknown>[];
  totalMessages: number;
  composeLeadCount: number;
}): InboxStats {
  return {
    pendingApprovals: approvals.length,
    unreadMessages: allMessages.filter(isUnreadMessage).length,
    scheduledMessages: allMessages.filter((message) =>
      Boolean(
        message.scheduledFor || message.sendAt || String(message.status || '') === 'scheduled'
      )
    ).length,
    totalMessages,
    visibleMessages: visibleMessages.length,
    composeLeadCount,
  };
}

function InboxSourceRail() {
  return (
    <div className="pbk-inbox-source-rail" aria-label="Inbox data sources">
      <PbkDataSource
        endpoint="GET /state"
        status="ships"
        note="approval queue and snapshot fallback messages"
      />
      <PbkDataSource endpoint="GET /api/messages" status="ships" note="message list paging" />
      <PbkDataSource endpoint="GET /api/leads" status="ships" note="compose lead autocomplete" />
      <PbkDataSource endpoint="PUT /api/approvals/:id" status="ships" note="operator decisions" />
      <PbkDataSource
        endpoint="POST /api/lead/send-message"
        status="ships"
        note="send now through bridge providers"
      />
      <PbkDataSource endpoint="POST /api/messages" status="ships" note="send later queue" />
      <PbkDataSource
        endpoint="PATCH /api/messages/:id/archive"
        status="ships"
        note="archive persistence through unified message records"
      />
    </div>
  );
}

function InboxStatRibbon({ stats }: { stats: InboxStats }) {
  return (
    <div className="pbk-inbox-grid">
      <div className="pbk-inbox-stat">
        <div className="l">Approval queue</div>
        <div className="v amber">{stats.pendingApprovals}</div>
        <div className="delta">from runtime snapshot</div>
      </div>
      <div className="pbk-inbox-stat">
        <div className="l">Unread replies</div>
        <div className="v sky">{stats.unreadMessages}</div>
        <div className="delta">inbound seller messages</div>
      </div>
      <div className="pbk-inbox-stat">
        <div className="l">Scheduled sends</div>
        <div className="v lime">{stats.scheduledMessages}</div>
        <div className="delta">bridge queued messages</div>
      </div>
      <div className="pbk-inbox-stat">
        <div className="l">Lead roster</div>
        <div className="v">{stats.composeLeadCount}</div>
        <div className="delta">compose autocomplete</div>
      </div>
    </div>
  );
}

function InboxHero({
  loading,
  stats,
  source,
  onCompose,
  onOpenInbox,
  onRefresh,
}: {
  loading: boolean;
  stats: InboxStats;
  source: string;
  onCompose: () => void;
  onOpenInbox: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="pbk-inbox-hero">
      <div className="pbk-inbox-hero-top">
        <div>
          <div className="pbk-eyebrow">
            Unified inbox - {stats.pendingApprovals} approvals - {stats.unreadMessages} unread
          </div>
          <h1 className="pbk-display pbk-h1">
            Inbox &amp; <em>approvals</em>.
          </h1>
          <p>
            Seller replies, Ava/Rex approvals, scheduled outreach, and bridge-backed compose in one
            operator cockpit. Archive actions persist through the unified message record.
          </p>
        </div>
        <div className="pbk-inbox-hero-actions">
          <span className="pbk-inbox-sync">
            <Database size={13} />
            {loading ? 'syncing' : source || 'runtime'}
          </span>
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-sky-gradient pbk-btn-sm"
            onClick={onOpenInbox}
          >
            <MessagesSquare size={14} />
            Open Unified Inbox
          </button>
          <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={onCompose}>
            <Plus size={14} />
            Compose
          </button>
        </div>
      </div>
      <InboxStatRibbon stats={stats} />
      <InboxSourceRail />
    </section>
  );
}

function InboxThreadRail({
  stats,
  statusCopy,
  leadStatus,
  onCompose,
  onSelectLane,
}: {
  stats: InboxStats;
  statusCopy: string;
  leadStatus: string;
  onCompose: () => void;
  onSelectLane: (lane: InboxSignalLane) => void;
}) {
  return (
    <aside className="pbk-inbox-thread-rail">
      <div className="rail-head">
        <div>
          <h2>Unified Inbox</h2>
          <p>{statusCopy}</p>
        </div>
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={onCompose}>
          <Mail size={14} />
          New
        </button>
      </div>
      <InboxSignalLanes
        approvals={stats.pendingApprovals}
        unread={stats.unreadMessages}
        scheduled={stats.scheduledMessages}
        onSelect={onSelectLane}
      />
      <div className="rail-foot">
        <div className="l">Lead lookup</div>
        <div className="v">{leadStatus || `${stats.composeLeadCount} leads ready for compose`}</div>
      </div>
      <PbkDataSource endpoint="GET /api/leads" status="ships" note="live compose roster" />
    </aside>
  );
}

function InboxApprovalCard({
  approval,
  index,
  pendingAction,
  feedback,
  onDecision,
}: {
  approval: Record<string, unknown>;
  index: number;
  pendingAction: string;
  feedback?: string;
  onDecision: (approval: Record<string, unknown>, status: string) => void;
}) {
  const contract = isContractApproval(approval);
  const approvalId = String(approval.id || '');
  const secondaryStatus = contract ? 'needs-revision' : 'rejected';
  return (
    <div className={`pbk-inbox-approval-card ${contract ? 'contract' : ''}`.trim()}>
      <div className="approval-top">
        <div>
          <div className="approval-type">{String(approval.type || 'approval')}</div>
          <h3>{String(approval.leadName || 'Pending lead')}</h3>
          <p>{String(approval.address || 'No address recorded')}</p>
        </div>
        {feedback && (
          <div className="approval-feedback">
            <CheckCircle2 size={13} />
            {feedback}
          </div>
        )}
      </div>
      <div className="approval-preview">{getApprovalPreview(approval)}</div>
      {contract && (
        <div className="approval-warning">
          Contract approval can release DocuSign. A confirmation step is required.
        </div>
      )}
      <div className="approval-actions">
        <button
          type="button"
          data-approval-primary={index === 0 ? 'true' : undefined}
          disabled={pendingAction === `approval:${approvalId}:approved`}
          onClick={() => onDecision(approval, 'approved')}
          className="pbk-btn pbk-btn-success pbk-btn-sm"
        >
          {pendingAction === `approval:${approvalId}:approved` && (
            <Loader2 size={14} className="animate-spin" />
          )}
          {pendingAction === `approval:${approvalId}:approved` ? 'Approving' : 'Approve'}
        </button>
        <button
          type="button"
          data-approval-secondary={index === 0 ? 'true' : undefined}
          disabled={pendingAction === `approval:${approvalId}:${secondaryStatus}`}
          onClick={() => onDecision(approval, secondaryStatus)}
          className="pbk-btn pbk-btn-ghost pbk-btn-sm"
        >
          {pendingAction === `approval:${approvalId}:${secondaryStatus}` && (
            <Loader2 size={14} className="animate-spin" />
          )}
          {pendingAction === `approval:${approvalId}:${secondaryStatus}`
            ? 'Sending'
            : contract
              ? 'Needs Revision'
              : 'Decline'}
        </button>
      </div>
    </div>
  );
}

function InboxMessageRow({
  message,
  onReply,
  onArchive,
}: {
  message: Record<string, unknown>;
  onReply: (message: Record<string, unknown>) => void;
  onArchive: (message: Record<string, unknown>) => void;
}) {
  const unread = isUnreadMessage(message);
  const timestamp = getMessageTimestamp(message);
  const title = getMessageTitle(message);
  const leadId = getMessageLeadId(message);
  const openLeadPortal = () => {
    if (leadId) {
      window.location.assign(`/leads/${encodeURIComponent(leadId)}`);
      return;
    }
    window.location.assign(`/leads?search=${encodeURIComponent(title)}`);
  };

  return (
    <div className={`pbk-inbox-message-row ${unread ? 'unread' : ''}`.trim()}>
      <div className="msg-channel">
        <span>{String(message.channel || 'sms')}</span>
        {unread && <strong>New</strong>}
      </div>
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-name">{getMessageTitle(message)}</span>
          {Boolean(message.subject) && (
            <span className="msg-subject">{String(message.subject)}</span>
          )}
        </div>
        <div className="msg-preview">{getMessageBody(message)}</div>
        <div className="msg-actions">
          <button
            type="button"
            onClick={() => onReply(message)}
            className="msg-reply"
            aria-label={`Reply to ${title}`}
          >
            <Reply size={13} />
            Reply
          </button>
          <button
            type="button"
            onClick={openLeadPortal}
            className="msg-lead"
            aria-label={`Open lead portal for ${title}`}
          >
            <UserRound size={13} />
            Open lead
          </button>
          <button
            type="button"
            onClick={() => onArchive(message)}
            className="msg-archive"
            aria-label={`Archive message from ${title}`}
          >
            Archive
          </button>
        </div>
      </div>
      <div className="msg-meta">
        <span>{formatRuntimeStatus(message.status)}</span>
        {timestamp && (
          <span title={new Date(timestamp).toLocaleString()}>{formatRelativeTime(timestamp)}</span>
        )}
        {Boolean(message.scheduledFor || message.sendAt) && (
          <span>{formatDateTime(message.scheduledFor || message.sendAt)}</span>
        )}
      </div>
    </div>
  );
}

function readComposeDraft() {
  try {
    const raw = window.localStorage.getItem(COMPOSE_DRAFT_KEY);
    return raw ? ({ ...EMPTY_DRAFT, ...JSON.parse(raw) } as ComposeDraft) : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

function writeComposeDraft(draft: ComposeDraft) {
  try {
    window.localStorage.setItem(COMPOSE_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function clearComposeDraft() {
  try {
    window.localStorage.removeItem(COMPOSE_DRAFT_KEY);
  } catch {
    // No-op.
  }
}

function ComposeModal({
  open,
  leads,
  leadStatus,
  initialDraft,
  onClose,
  onSent,
  onRefreshLeads,
  onInitialDraftUsed,
}: {
  open: boolean;
  leads: ComposeLead[];
  leadStatus: string;
  initialDraft: ComposeDraft | null;
  onClose: () => void;
  onSent: () => Promise<void>;
  onRefreshLeads: () => Promise<void>;
  onInitialDraftUsed: () => void;
}) {
  const [draft, setDraft] = useState<ComposeDraft>(EMPTY_DRAFT);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextDraft = initialDraft ? { ...EMPTY_DRAFT, ...initialDraft } : readComposeDraft();
    setDraft(nextDraft);
    setPickerOpen(false);
    setSending(false);
    setSendError('');
    setDraftSaveFailed(false);
    if (initialDraft) {
      onInitialDraftUsed();
      showUiToast({
        tone: 'info',
        title: 'Reply loaded',
        desc: 'Compose is addressed to this thread.',
      });
    } else if (nextDraft.recipient || nextDraft.message) {
      showUiToast({
        tone: 'info',
        title: 'Draft restored',
        desc: 'Your previous compose draft is back.',
      });
    }
  }, [initialDraft, onInitialDraftUsed, open]);

  useEffect(() => {
    if (!open) return;
    setDraftSaveFailed(!writeComposeDraft(draft));
  }, [draft, open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail;
      if (detail && typeof detail === 'object') detail.handled = true;
      onClose();
    };
    window.addEventListener('pbk:escape-ui', close);
    return () => window.removeEventListener('pbk:escape-ui', close);
  }, [open, onClose]);

  const selectedLead = leads.find((lead) => lead.id === draft.leadId);
  const matches = leads
    .filter((lead) => {
      const query = draft.recipient.trim().toLowerCase();
      if (!query) return false;
      return [lead.name, lead.phone, lead.email, lead.address]
        .join(' ')
        .toLowerCase()
        .includes(query);
    })
    .slice(0, 5);
  const segmentInfo = getSmsSegmentInfo(draft.message);
  const recipientValidation = validateComposeRecipient(draft, selectedLead);
  const sendDisabled =
    sending ||
    !draft.recipient.trim() ||
    !draft.message.trim() ||
    (draft.sendLater && !draft.sendAt.trim()) ||
    Boolean(recipientValidation);

  const setChannel = (channel: ComposeChannel) => {
    setDraft((current) => ({
      ...current,
      channel,
      recipient: selectedLead
        ? channel === 'sms'
          ? selectedLead.phone
          : selectedLead.email
        : current.recipient,
    }));
  };

  const sendCompose = async () => {
    if (sendDisabled) return;
    if (recipientValidation) {
      setSendError(recipientValidation);
      return;
    }
    setSending(true);
    setSendError('');
    const request = buildComposeRequest(draft, selectedLead || {});
    try {
      const response =
        request.path === '/api/messages'
          ? await scheduleMessageRequest(request.body)
          : await sendMessageRequest(request.body);
      const responseMessage =
        response.message && typeof response.message === 'object'
          ? (response.message as Record<string, unknown>)
          : {};
      const result = String(
        response.result || response.outcome || responseMessage.status || ''
      ).toLowerCase();
      const scheduled = request.path === '/api/messages' || result === 'scheduled';
      showUiToast({
        tone: 'success',
        title: scheduled
          ? 'Message scheduled'
          : draft.channel === 'sms'
            ? 'SMS submitted'
            : 'Email submitted',
        desc: scheduled
          ? `Queued in the bridge for ${formatDateTime(draft.sendAt)}.`
          : String(response.verbiage || 'Provider request accepted by the bridge.'),
      });
      clearComposeDraft();
      setDraft(EMPTY_DRAFT);
      await onSent();
      onClose();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Message send failed.';
      setSendError(message);
      showUiToast({ tone: 'error', title: 'Message not sent', desc: message, critical: true });
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal compose-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Compose message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="modal-kicker">New message</div>
            <h3>Compose</h3>
            <p>
              {draft.sendLater
                ? 'Queue a scheduled bridge message.'
                : 'Send through the configured bridge providers.'}
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close compose"
          >
            <X size={18} />
          </button>
        </div>

        <div className="compose-channel-row" role="group" aria-label="Message channel">
          {(['sms', 'email'] as ComposeChannel[]).map((channel) => (
            <button
              key={channel}
              type="button"
              className={draft.channel === channel ? 'is-active' : ''}
              onClick={() => setChannel(channel)}
            >
              {channel === 'sms' ? 'SMS (Telnyx)' : 'Email (Instantly)'}
            </button>
          ))}
        </div>

        <label className="compose-field">
          <span>Recipient</span>
          {selectedLead && (
            <span className="compose-recipient-chip">
              {selectedLead.name} -{' '}
              {draft.channel === 'sms'
                ? selectedLead.phone || 'no phone'
                : selectedLead.email || 'no email'}
              <button
                type="button"
                onClick={() => setDraft((current) => ({ ...current, leadId: '', recipient: '' }))}
              >
                x
              </button>
            </span>
          )}
          <input
            type={draft.channel === 'email' ? 'email' : 'tel'}
            value={draft.recipient}
            onFocus={() => {
              if (!leads.length) void onRefreshLeads();
            }}
            onChange={(event) =>
              setDraft((current) => ({ ...current, recipient: event.target.value, leadId: '' }))
            }
            placeholder={draft.channel === 'sms' ? 'Name or phone number' : 'Name or email address'}
            aria-invalid={Boolean(recipientValidation)}
          />
          {recipientValidation && (
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-rose-300">
              <AlertCircle size={12} />
              {recipientValidation}
            </span>
          )}
          {!!matches.length && !selectedLead && (
            <div className="compose-suggest">
              {matches.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      leadId: lead.id,
                      recipient: draft.channel === 'sms' ? lead.phone : lead.email,
                    }))
                  }
                >
                  <strong>{lead.name}</strong>
                  <span>
                    {draft.channel === 'sms' ? lead.phone || 'No phone' : lead.email || 'No email'}{' '}
                    - {lead.address}
                  </span>
                </button>
              ))}
            </div>
          )}
          {!matches.length && draft.recipient.trim() && !selectedLead && (
            <span className="mt-1 text-[11px] text-slate-500">
              {leadStatus || 'No live lead matches. You can still send to the typed recipient.'}
            </span>
          )}
        </label>

        <label className="compose-field">
          <span>Message</span>
          <textarea
            value={draft.message}
            onChange={(event) =>
              setDraft((current) => ({ ...current, message: event.target.value }))
            }
            placeholder="Write a seller-facing message..."
          />
          <span className="compose-count">
            {draft.message.length} chars
            {draft.channel === 'sms'
              ? ` - ${segmentInfo.segments} SMS segment${segmentInfo.segments === 1 ? '' : 's'} (${segmentInfo.encoding})`
              : ''}
          </span>
        </label>

        <div className="compose-template-row">
          {QUICK_TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  message: current.message ? `${current.message}\n${template.text}` : template.text,
                }))
              }
            >
              {template.label}
            </button>
          ))}
        </div>

        <div className="compose-tools">
          <button type="button" onClick={() => setPickerOpen((value) => !value)}>
            Emoji
          </button>
          <button
            type="button"
            className={draft.sendLater ? 'is-active' : ''}
            onClick={() => setDraft((current) => ({ ...current, sendLater: !current.sendLater }))}
          >
            Send later
          </button>
          {draft.sendLater && (
            <input
              type="datetime-local"
              value={draft.sendAt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, sendAt: event.target.value }))
              }
            />
          )}
        </div>

        {pickerOpen && (
          <div className="emoji-grid">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() =>
                  setDraft((current) => ({ ...current, message: `${current.message}${emoji}` }))
                }
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {sendError && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{sendError}</span>
          </div>
        )}

        <div className="modal-footer">
          <span className={draftSaveFailed ? 'text-xs text-amber-300' : 'text-xs text-slate-500'}>
            {draftSaveFailed
              ? 'Draft could not be saved locally in this browser.'
              : 'Draft saved locally as you type.'}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={sendDisabled}
              onClick={() => void sendCompose()}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={15} />}
              {sending ? 'Sending...' : draft.sendLater ? 'Schedule' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContractApprovalConfirm({
  approval,
  pending,
  onCancel,
  onConfirm,
}: {
  approval: Record<string, unknown> | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!approval) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal max-w-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm contract approval"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="modal-kicker">DocuSign confirmation</div>
            <h3>Approve contract send?</h3>
            <p>Review the payload before releasing this contract action.</p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            aria-label="Close confirmation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Lead</div>
            <div className="mt-1 font-semibold text-slate-100">
              {String(approval.leadName || 'Pending lead')}
            </div>
            <div className="text-xs text-slate-400">
              {String(approval.address || 'No address recorded')}
            </div>
          </div>
          <div className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-xs leading-relaxed text-amber-50">
            {getApprovalPreview(approval)}
          </div>
        </div>
        <div className="modal-footer">
          <span className="text-xs text-slate-500">
            Contract approvals can trigger DocuSign delivery.
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={pending} onClick={onConfirm}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : null}
              {pending ? 'Approving...' : 'Approve DocuSign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalDecisionConfirm({
  draft,
  pending,
  onCancel,
  onConfirm,
}: {
  draft: ApprovalDecisionDraft | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!draft) return null;
  const approval = draft.approval;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal max-w-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-approval-decision-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="modal-kicker">Approval confirmation</div>
            <h3 id="inbox-approval-decision-title">Confirm decision</h3>
            <p>{draft.warning}</p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            aria-label="Close approval confirmation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
              {String(approval.type || 'approval')}
            </div>
            <div className="mt-1 font-semibold text-slate-100">
              {String(approval.leadName || 'Pending lead')}
            </div>
            <div className="text-xs text-slate-400">
              {String(approval.address || 'No address recorded')}
            </div>
          </div>
          <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3 text-xs leading-relaxed text-slate-300">
            {getApprovalPreview(approval)}
          </div>
        </div>
        <div className="modal-footer">
          <span className="text-xs text-slate-500">
            The bridge receives this decision immediately.
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={pending} onClick={onConfirm}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : null}
              {pending ? 'Sending...' : draft.actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Inbox() {
  const navigate = useNavigate();
  const { snapshot, loading, error, refresh } = useRuntimeSnapshot();
  const [pendingAction, setPendingAction] = useState('');
  const [actionStatus, setActionStatus] = useState<InboxActionStatus | null>(null);
  const [approvalFeedbackById, setApprovalFeedbackById] = useState<Record<string, string>>({});
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState<ComposeDraft | null>(null);
  const [confirmApproval, setConfirmApproval] = useState<Record<string, unknown> | null>(null);
  const [approvalDecisionDraft, setApprovalDecisionDraft] = useState<ApprovalDecisionDraft | null>(
    null
  );
  const [messageLimit, setMessageLimit] = useState(MESSAGE_PAGE_SIZE);
  const [liveMessages, setLiveMessages] = useState<Array<Record<string, unknown>>>([]);
  const [messageTotal, setMessageTotal] = useState(0);
  const [messageError, setMessageError] = useState('');
  const [liveLeads, setLiveLeads] = useState<ComposeLead[]>([]);
  const [leadStatus, setLeadStatus] = useState('');

  const approvals = useMemo(() => getPendingApprovals(snapshot?.approvals), [snapshot?.approvals]);
  const fallbackMessages = useMemo(
    () => sortMessagesNewest(snapshot?.messages || []),
    [snapshot?.messages]
  );
  const allMessages = liveMessages.length ? liveMessages : fallbackMessages;
  const visibleMessages = allMessages.slice(0, messageLimit);
  const totalMessages = messageTotal || allMessages.length;
  const composeLeads = useMemo(() => {
    const snapshotLeads = normalizeComposeLeads(snapshot?.leadImports || []) as ComposeLead[];
    return liveLeads.length ? liveLeads : snapshotLeads;
  }, [liveLeads, snapshot?.leadImports]);
  const inboxStats = useMemo(
    () =>
      buildInboxStats({
        approvals,
        allMessages,
        visibleMessages,
        totalMessages,
        composeLeadCount: composeLeads.length,
      }),
    [allMessages, approvals, composeLeads.length, totalMessages, visibleMessages]
  );

  const loadMessages = useCallback(async (limit: number) => {
    try {
      const response = await fetchMessagesRequest({ limit, offset: 0 });
      setLiveMessages(
        sortMessagesNewest(response.messages || []) as Array<Record<string, unknown>>
      );
      setMessageTotal(Number(response.count || response.messages?.length || 0));
      setMessageError('');
    } catch (nextError) {
      setMessageError(nextError instanceof Error ? nextError.message : 'Could not load messages.');
    }
  }, []);

  const loadLeads = useCallback(async () => {
    setLeadStatus('Loading live leads...');
    try {
      const leads = normalizeComposeLeads(await fetchLeadsRequest()) as ComposeLead[];
      setLiveLeads(leads);
      setLeadStatus(
        leads.length
          ? `${leads.length} live leads loaded.`
          : 'No live leads returned by the bridge.'
      );
    } catch (nextError) {
      setLeadStatus(
        nextError instanceof Error
          ? `Lead lookup unavailable: ${nextError.message}`
          : 'Lead lookup unavailable.'
      );
    }
  }, []);

  const refreshInbox = useCallback(async () => {
    await Promise.all([refresh().catch(() => null), loadMessages(messageLimit)]);
  }, [loadMessages, messageLimit, refresh]);

  useEffect(() => {
    void loadMessages(messageLimit);
  }, [loadMessages, messageLimit]);

  useEffect(() => {
    if (composeOpen) void loadLeads();
  }, [composeOpen, loadLeads]);

  useEffect(() => {
    if (!actionStatus) return undefined;
    if (actionStatus.tone !== 'success') return undefined;
    const timer = window.setTimeout(() => setActionStatus(null), 5000);
    return () => window.clearTimeout(timer);
  }, [actionStatus]);

  useEffect(() => {
    const openCompose = (event: Event) => {
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail;
      if (detail && typeof detail === 'object') detail.handled = true;
      setComposeOpen(true);
    };
    window.addEventListener('pbk:open-compose', openCompose);
    return () => window.removeEventListener('pbk:open-compose', openCompose);
  }, []);

  const decideApproval = async (approval: Record<string, unknown>, status: string) => {
    const approvalId = String(approval.id || '');
    if (!approvalId) return;
    const key = `approval:${approvalId}:${status}`;
    setPendingAction(key);
    setActionStatus(null);
    try {
      await updateApprovalDecision(approvalId, status);
      await refreshInbox();
      setActionStatus({
        tone: 'success',
        text: status === 'approved' ? 'Approved. Ava can continue.' : 'Decision sent to Ava.',
      });
      setApprovalFeedbackById((current) => ({
        ...current,
        [approvalId]: status === 'approved' ? 'Approved' : 'Decision sent',
      }));
      window.setTimeout(() => {
        setApprovalFeedbackById((current) => {
          const next = { ...current };
          delete next[approvalId];
          return next;
        });
      }, 3000);
    } catch (nextError) {
      setActionStatus({
        tone: 'error',
        text: nextError instanceof Error ? nextError.message : 'Approval update failed.',
      });
    } finally {
      setPendingAction('');
    }
  };

  const openApprovalDecisionConfirm = (approval: Record<string, unknown>, status: string) => {
    const contract = isContractApproval(approval);
    if (contract && status === 'approved') {
      setConfirmApproval(approval);
      return;
    }
    const actionLabel =
      status === 'approved'
        ? 'Approve'
        : status === 'needs-revision'
          ? 'Request revision'
          : 'Decline';
    const warning =
      status === 'approved'
        ? 'Approving lets Ava continue with this queued action.'
        : status === 'needs-revision'
          ? 'This asks Ava to revise the contract before sending.'
          : 'Declining stops this queued action from being sent.';
    setApprovalDecisionDraft({ approval, status, actionLabel, warning });
  };

  const executeApprovalDecision = () => {
    if (!approvalDecisionDraft) return;
    const draft = approvalDecisionDraft;
    setApprovalDecisionDraft(null);
    void decideApproval(draft.approval, draft.status);
  };

  const openReply = (message: Record<string, unknown>) => {
    setReplyDraft(buildReplyDraftFromMessage(message) as ComposeDraft);
    setComposeOpen(true);
  };

  const archiveMessage = async (message: Record<string, unknown>) => {
    const messageId = String(
      message.id ||
        message.messageId ||
        message.message_id ||
        message.callId ||
        message.call_id ||
        ''
    ).trim();
    if (!messageId) {
      setActionStatus({
        tone: 'error',
        text: 'This message is missing an id, so the bridge cannot archive it.',
      });
      return;
    }
    setPendingAction(`archive:${messageId}`);
    setActionStatus(null);
    try {
      await archiveMessageRequest(messageId, { actor: 'Inbox' });
      await refreshInbox();
      setActionStatus({ tone: 'success', text: 'Message archived.' });
      showUiToast({
        tone: 'success',
        title: 'Inbox updated',
        desc: 'Message archived in the bridge.',
      });
    } catch (nextError) {
      setActionStatus({
        tone: 'error',
        text: nextError instanceof Error ? nextError.message : 'Message archive failed.',
      });
    } finally {
      setPendingAction('');
    }
  };

  const statusCopy = loading
    ? 'Loading inbox...'
    : `Showing ${visibleMessages.length} of ${totalMessages || visibleMessages.length} messages`;
  const bridgeError = error || messageError;
  const snapshotSource =
    snapshot && typeof snapshot === 'object'
      ? String((snapshot as unknown as Record<string, unknown>).source || 'runtime')
      : 'runtime';
  const selectSignalLane = useCallback((lane: InboxSignalLane) => {
    const sectionId = lane === 'approvals' ? 'inbox-approvals' : 'inbox-messages';
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, []);

  return (
    <div className="pbk-inbox-surface min-h-full text-slate-100">
      <main className="space-y-4 p-4 md:p-6">
        <InboxHero
          loading={loading}
          stats={inboxStats}
          source={snapshotSource}
          onCompose={() => setComposeOpen(true)}
          onOpenInbox={() => navigate('/inbox/conversations')}
          onRefresh={() => void refreshInbox()}
        />

        {bridgeError && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-50 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold">Bridge connection issue</div>
              <div className="mt-1 text-xs text-amber-100/80">{bridgeError}</div>
            </div>
            <button
              type="button"
              onClick={() => void refreshInbox()}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/10"
            >
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        {actionStatus && (
          <div
            className={[
              'flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm',
              actionStatus.tone === 'error'
                ? 'border border-rose-400/30 bg-rose-500/10 text-rose-100'
                : 'border border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
            ].join(' ')}
          >
            <span className="flex items-center gap-2">
              {actionStatus.tone === 'error' ? (
                <AlertCircle size={15} className="text-rose-300" />
              ) : (
                <CheckCircle2 size={15} className="text-emerald-300" />
              )}
              {actionStatus.text}
            </span>
            <button
              type="button"
              className="rounded-full p-1 opacity-70 hover:bg-white/10 hover:opacity-100"
              onClick={() => setActionStatus(null)}
              aria-label="Dismiss status"
            >
              <X size={15} />
            </button>
          </div>
        )}

        <section className="pbk-inbox-layout">
          <InboxThreadRail
            stats={inboxStats}
            statusCopy={statusCopy}
            leadStatus={leadStatus}
            onCompose={() => setComposeOpen(true)}
            onSelectLane={selectSignalLane}
          />

          <section id="inbox-approvals" className="pbk-inbox-card">
            <div className="pbk-inbox-card-head">
              <div>
                <h2>Approvals needed</h2>
                <p>Items Ava/Rex need you to approve before sending.</p>
              </div>
              <span className="count">{approvals.length}</span>
            </div>
            <div className="pbk-inbox-approval-list">
              {approvals.map((approval, index) => {
                const approvalId = String(approval.id || '');
                return (
                  <InboxApprovalCard
                    key={approvalId || index}
                    approval={approval}
                    index={index}
                    pendingAction={pendingAction}
                    feedback={approvalFeedbackById[approvalId]}
                    onDecision={openApprovalDecisionConfirm}
                  />
                );
              })}
              {!approvals.length && (
                <div className="pbk-inbox-empty">
                  <InboxIcon size={18} />
                  <span>Nothing is waiting on human approval.</span>
                </div>
              )}
            </div>
            <PbkDataSource endpoint="GET /state" status="ships" note="snapshot.approvals" />
            <PbkDataSource endpoint="PUT /api/approvals/:id" status="ships" />
          </section>

          <section id="inbox-messages" className="pbk-inbox-card pbk-inbox-message-card">
            <div className="pbk-inbox-card-head">
              <div>
                <h2>Message stream</h2>
                <p>Replies, scheduled sends, and provider status from the bridge.</p>
              </div>
              <span className="count">
                {visibleMessages.length
                  ? `${visibleMessages.length}/${totalMessages || visibleMessages.length}`
                  : '0'}
              </span>
            </div>
            <div className="pbk-inbox-message-head">
              <span>Channel</span>
              <span>Message</span>
              <span>Status</span>
            </div>
            <div className="pbk-inbox-message-list">
              {visibleMessages.map((message, index) => (
                <InboxMessageRow
                  key={String(message.id || index)}
                  message={message}
                  onReply={openReply}
                  onArchive={archiveMessage}
                />
              ))}
              {!visibleMessages.length && (
                <div className="pbk-inbox-empty">
                  <MessageSquare size={18} />
                  <span>No runtime messages yet.</span>
                </div>
              )}
            </div>
            {totalMessages > visibleMessages.length && (
              <button
                type="button"
                onClick={() => setMessageLimit((current) => current + MESSAGE_PAGE_SIZE)}
                className="pbk-inbox-load-more"
              >
                Load more messages
              </button>
            )}
            <PbkDataSource endpoint="GET /api/messages" status="ships" note="paged bridge list" />
            <PbkDataSource
              endpoint="PATCH /api/messages/:id/archive"
              status="ships"
              note="archive/swipe action persists through the bridge"
            />
          </section>
        </section>

        <ComposeModal
          open={composeOpen}
          leads={composeLeads}
          leadStatus={leadStatus}
          initialDraft={replyDraft}
          onClose={() => {
            setComposeOpen(false);
            setReplyDraft(null);
          }}
          onSent={refreshInbox}
          onRefreshLeads={loadLeads}
          onInitialDraftUsed={() => setReplyDraft(null)}
        />
        <ContractApprovalConfirm
          approval={confirmApproval}
          pending={Boolean(
            confirmApproval && pendingAction === `approval:${String(confirmApproval.id)}:approved`
          )}
          onCancel={() => setConfirmApproval(null)}
          onConfirm={() => {
            if (!confirmApproval) return;
            void decideApproval(confirmApproval, 'approved').then(() => setConfirmApproval(null));
          }}
        />
        <ApprovalDecisionConfirm
          draft={approvalDecisionDraft}
          pending={Boolean(
            approvalDecisionDraft &&
            pendingAction ===
              `approval:${String(approvalDecisionDraft.approval.id || '')}:${approvalDecisionDraft.status}`
          )}
          onCancel={() => setApprovalDecisionDraft(null)}
          onConfirm={executeApprovalDecision}
        />
      </main>
    </div>
  );
}
