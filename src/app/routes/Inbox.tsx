import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Reply, Send, X } from 'lucide-react';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
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
  const sendDisabled =
    sending ||
    !draft.recipient.trim() ||
    !draft.message.trim() ||
    (draft.sendLater && !draft.sendAt.trim());

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
    setSending(true);
    setSendError('');
    const request = buildComposeRequest(draft, selectedLead || {});
    try {
      const response =
        request.path === '/api/messages'
          ? await scheduleMessageRequest(request.body)
          : await sendMessageRequest(request.body);
      const result = String(
        response.result || response.outcome || response.message?.status || ''
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
      showUiToast({ tone: 'error', title: 'Message not sent', desc: message });
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
            value={draft.recipient}
            onFocus={() => {
              if (!leads.length) void onRefreshLeads();
            }}
            onChange={(event) =>
              setDraft((current) => ({ ...current, recipient: event.target.value, leadId: '' }))
            }
            placeholder={draft.channel === 'sms' ? 'Name or phone number' : 'Name or email address'}
          />
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
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {sendError}
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
              <Send size={15} />
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
              {pending ? 'Approving...' : 'Approve DocuSign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Inbox() {
  const { snapshot, loading, error, refresh } = useRuntimeSnapshot();
  const [pendingAction, setPendingAction] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState<ComposeDraft | null>(null);
  const [confirmApproval, setConfirmApproval] = useState<Record<string, unknown> | null>(null);
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
    const timer = window.setTimeout(() => setActionStatus(''), 6000);
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
    setActionStatus('');
    try {
      await updateApprovalDecision(approvalId, status);
      await refreshInbox();
      setActionStatus(
        status === 'approved' ? 'Approved. Ava can continue.' : 'Decision sent to Ava.'
      );
    } catch (nextError) {
      setActionStatus(nextError instanceof Error ? nextError.message : 'Approval update failed.');
    } finally {
      setPendingAction('');
    }
  };

  const openReply = (message: Record<string, unknown>) => {
    setReplyDraft(buildReplyDraftFromMessage(message) as ComposeDraft);
    setComposeOpen(true);
  };

  const statusCopy = loading
    ? 'Loading inbox...'
    : `Showing ${visibleMessages.length} of ${totalMessages || visibleMessages.length} messages`;
  const bridgeError = error || messageError;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Inbox</h1>
          <p className="text-sm text-slate-400">
            Approvals, seller replies, and agent handoffs from the runtime.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-sky-400 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-300"
          >
            <Plus size={15} />
            Compose
          </button>
          <div className="text-xs text-slate-500">{statusCopy}</div>
        </div>
      </div>

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
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          <span>{actionStatus}</span>
          <button
            type="button"
            className="rounded-full p-1 text-sky-100/70 hover:bg-sky-400/10 hover:text-sky-50"
            onClick={() => setActionStatus('')}
            aria-label="Dismiss status"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[390px_1fr] gap-4">
        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Approvals Needed</h2>
          <p className="mt-1 text-xs text-slate-500">
            Items Ava/Rex need you to approve before sending.
          </p>
          <div className="mt-3 space-y-2">
            {approvals.map((approval, index) => {
              const contract = isContractApproval(approval);
              const approvalId = String(approval.id || '');
              return (
                <div
                  key={approvalId}
                  className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3"
                >
                  <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
                    {String(approval.type || 'approval')}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">
                    {String(approval.leadName || 'Pending lead')}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {String(approval.address || 'No address recorded')}
                  </div>
                  <div className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs leading-relaxed text-slate-300">
                    {getApprovalPreview(approval)}
                  </div>
                  {contract && (
                    <div className="mt-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
                      Contract approval can release DocuSign. A confirmation step is required.
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-approval-primary={index === 0 ? 'true' : undefined}
                      disabled={pendingAction === `approval:${approvalId}:approved`}
                      onClick={() => {
                        if (contract) {
                          setConfirmApproval(approval);
                          return;
                        }
                        void decideApproval(approval, 'approved');
                      }}
                      className="rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      data-approval-secondary={index === 0 ? 'true' : undefined}
                      disabled={pendingAction === `approval:${approvalId}:rejected`}
                      onClick={() => {
                        const status = contract ? 'needs-revision' : 'rejected';
                        void decideApproval(approval, status);
                      }}
                      className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                    >
                      {contract ? 'Needs Revision' : 'Decline'}
                    </button>
                  </div>
                </div>
              );
            })}
            {!approvals.length && (
              <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                Nothing is waiting on human approval.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid grid-cols-[auto_1fr_auto] gap-3 text-[11px] uppercase tracking-[0.14em] text-slate-500 sm:flex sm:items-center">
              <span>Channel</span>
              <span>Message</span>
              <span>Status</span>
            </div>
            <div className="text-xs text-slate-500">
              {visibleMessages.length
                ? `Showing ${visibleMessages.length} of ${totalMessages || visibleMessages.length}`
                : 'No messages'}
            </div>
          </div>
          <div className="divide-y divide-slate-800">
            {visibleMessages.map((message) => {
              const unread = isUnreadMessage(message);
              const timestamp = String(
                message.createdAt ||
                  message.at ||
                  message.updatedAt ||
                  message.scheduledFor ||
                  message.sendAt ||
                  ''
              );
              return (
                <div
                  key={String(message.id)}
                  className={[
                    'grid grid-cols-1 gap-3 px-4 py-4 text-sm md:grid-cols-[auto_1fr_auto]',
                    unread
                      ? 'border-l-2 border-sky-300 bg-sky-400/5 text-slate-100'
                      : 'border-l-2 border-transparent text-slate-200',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-2">
                    <div className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                      {String(message.channel || 'sms')}
                    </div>
                    {unread && (
                      <span className="rounded-full bg-sky-300 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-950">
                        New
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100">
                      {String(
                        message.leadName ||
                          message.address ||
                          message.from ||
                          message.to ||
                          'Message'
                      )}
                    </div>
                    {message.subject && (
                      <div className="mt-1 text-xs font-medium text-slate-300">
                        {String(message.subject)}
                      </div>
                    )}
                    <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-400">
                      {String(message.body || '(empty message)')}
                    </div>
                    <button
                      type="button"
                      onClick={() => openReply(message)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-sky-400/50 hover:text-sky-100"
                    >
                      <Reply size={13} />
                      Reply
                    </button>
                  </div>
                  <div className="text-xs text-slate-500 md:text-right">
                    {formatRuntimeStatus(message.status)}
                    {timestamp && (
                      <div title={new Date(timestamp).toLocaleString()}>
                        {formatRelativeTime(timestamp)}
                      </div>
                    )}
                    {(message.scheduledFor || message.sendAt) && (
                      <div className="mt-1 text-[11px] text-slate-400">
                        {formatDateTime(message.scheduledFor || message.sendAt)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {!visibleMessages.length && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No runtime messages yet.
              </div>
            )}
          </div>
          {totalMessages > visibleMessages.length && (
            <div className="border-t border-slate-800 p-3 text-center">
              <button
                type="button"
                onClick={() => setMessageLimit((current) => current + MESSAGE_PAGE_SIZE)}
                className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-sky-400/50 hover:text-sky-100"
              >
                Load more messages
              </button>
            </div>
          )}
        </section>
      </div>
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
    </div>
  );
}
