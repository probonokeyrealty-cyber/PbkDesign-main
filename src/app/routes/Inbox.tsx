import { useEffect, useMemo, useState } from 'react';
import { Plus, Send, X } from 'lucide-react';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import { updateApprovalDecision } from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

const COMPOSE_DRAFT_KEY = 'pbk:compose:draft';

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
  { label: 'Thanks - ask address', text: 'Thanks for reaching out. What is the property address so I can take a quick look?' },
  { label: 'Ask timeline', text: 'What timeline would feel ideal if we could make the numbers work?' },
  { label: 'Ask condition', text: 'Can you tell me what repairs or updates the property needs right now?' },
  { label: 'Offer cash', text: 'If you want the cleanest route, I can look at a cash offer with an as-is close.' },
  { label: 'Schedule call', text: 'Would today or tomorrow be better for a quick 10-minute call?' },
  { label: 'Polite no', text: 'I do not think I can be the right buyer at that number, but I appreciate you sharing the details.' },
];

const EMOJIS = ['👍', '🙏', '🏡', '📞', '✅', '💬', '⏱️', '🤝', '📍', '💰', '🙂', '🙌'];

const MOCK_COMPOSE_LEADS: ComposeLead[] = [
  { id: 'diane', name: 'Diane Kowalski', phone: '(330) 555-2891', email: 'diane@example.com', address: '202 Cherry Ln' },
  { id: 'marco', name: 'Marco Hill', phone: '(216) 555-0188', email: 'marco@example.com', address: '44 Broadview Ave' },
  { id: 'lena', name: 'Lena Brooks', phone: '(614) 555-7721', email: 'lena@example.com', address: '19 Maple Ridge' },
];

function formatRuntimeStatus(status: unknown) {
  const normalized = String(status || 'sent').toLowerCase();
  if (normalized === 'provider_missing') return 'Provider key missing';
  if (normalized === 'queued') return 'Queued to send';
  if (normalized === 'queued_for_approval') return 'Queued for approval';
  if (normalized === 'sent') return 'Sent';
  if (normalized === 'failed') return 'Delivery failed';
  if (normalized === 'pending') return 'Waiting';
  if (normalized === 'approved') return 'Approved';
  if (normalized === 'rejected') return 'Declined';
  if (normalized === 'needs-revision') return 'Needs Revision';
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

function readComposeDraft() {
  try {
    const raw = window.localStorage.getItem(COMPOSE_DRAFT_KEY);
    return raw ? { ...EMPTY_DRAFT, ...JSON.parse(raw) } as ComposeDraft : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

function writeComposeDraft(draft: ComposeDraft) {
  try {
    window.localStorage.setItem(COMPOSE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Draft persistence is best-effort only.
  }
}

function clearComposeDraft() {
  try {
    window.localStorage.removeItem(COMPOSE_DRAFT_KEY);
  } catch {
    // No-op.
  }
}

function toComposeLead(record: Record<string, unknown>, index: number): ComposeLead {
  const seller = record.seller && typeof record.seller === 'object' ? record.seller as Record<string, unknown> : {};
  const property = record.property && typeof record.property === 'object' ? record.property as Record<string, unknown> : {};
  return {
    id: String(record.id || record.leadId || `lead-${index}`),
    name: String(record.name || record.leadName || seller.name || 'Unknown seller'),
    phone: String(record.phone || seller.phone || ''),
    email: String(record.email || seller.email || ''),
    address: String(record.address || property.address || ''),
  };
}

function ComposeModal({
  open,
  leads,
  onClose,
}: {
  open: boolean;
  leads: ComposeLead[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ComposeDraft>(EMPTY_DRAFT);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const saved = readComposeDraft();
    setDraft(saved);
    setPickerOpen(false);
    if (saved.recipient || saved.message) {
      showUiToast({ tone: 'info', title: 'Draft restored', desc: 'Your previous compose draft is back.' });
    }
  }, [open]);

  useEffect(() => {
    if (open) writeComposeDraft(draft);
  }, [draft, open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => onClose();
    window.addEventListener('pbk:escape-ui', close);
    return () => window.removeEventListener('pbk:escape-ui', close);
  }, [open, onClose]);

  const matches = leads
    .filter((lead) => {
      const query = draft.recipient.trim().toLowerCase();
      if (!query) return false;
      return [lead.name, lead.phone, lead.email, lead.address].join(' ').toLowerCase().includes(query);
    })
    .slice(0, 5);
  const selectedLead = leads.find((lead) => lead.id === draft.leadId);
  const sendDisabled = !draft.recipient.trim() || !draft.message.trim();
  const segmentCount = Math.max(1, Math.ceil(draft.message.length / 160));

  const setChannel = (channel: ComposeChannel) => {
    setDraft((current) => ({
      ...current,
      channel,
      recipient: selectedLead ? (channel === 'sms' ? selectedLead.phone : selectedLead.email) : current.recipient,
    }));
  };

  const sendDemo = () => {
    showUiToast({
      tone: 'success',
      title: draft.channel === 'sms' ? 'SMS sent (demo)' : 'Email sent (demo)',
      desc: draft.sendLater && draft.sendAt ? `Scheduled for ${draft.sendAt}. No real send occurred.` : 'No real send occurred.',
    });
    clearComposeDraft();
    setDraft(EMPTY_DRAFT);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal compose-modal" role="dialog" aria-modal="true" aria-label="Compose message" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-kicker">New message</div>
            <h3>Compose</h3>
            <p>Draft only - no provider send is wired here.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close compose">
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
              {selectedLead.name} - {draft.channel === 'sms' ? selectedLead.phone || 'no phone' : selectedLead.email || 'no email'}
              <button type="button" onClick={() => setDraft((current) => ({ ...current, leadId: '', recipient: '' }))}>x</button>
            </span>
          )}
          <input
            value={draft.recipient}
            onChange={(event) => setDraft((current) => ({ ...current, recipient: event.target.value, leadId: '' }))}
            placeholder={draft.channel === 'sms' ? 'Name or phone number' : 'Name or email address'}
          />
          {!!matches.length && !selectedLead && (
            <div className="compose-suggest">
              {matches.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => setDraft((current) => ({
                    ...current,
                    leadId: lead.id,
                    recipient: draft.channel === 'sms' ? lead.phone : lead.email,
                  }))}
                >
                  <strong>{lead.name}</strong>
                  <span>{draft.channel === 'sms' ? lead.phone || 'No phone' : lead.email || 'No email'} - {lead.address}</span>
                </button>
              ))}
            </div>
          )}
        </label>

        <label className="compose-field">
          <span>Message</span>
          <textarea
            value={draft.message}
            onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))}
            placeholder="Write a seller-facing message..."
          />
          <span className="compose-count">
            {draft.message.length} chars{draft.channel === 'sms' ? ` - ${segmentCount} SMS segment${segmentCount === 1 ? '' : 's'}` : ''}
          </span>
        </label>

        <div className="compose-template-row">
          {QUICK_TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              onClick={() => setDraft((current) => ({
                ...current,
                message: current.message ? `${current.message}\n${template.text}` : template.text,
              }))}
            >
              {template.label}
            </button>
          ))}
        </div>

        <div className="compose-tools">
          <button type="button" onClick={() => setPickerOpen((value) => !value)}>Emoji</button>
          <button type="button" className={draft.sendLater ? 'is-active' : ''} onClick={() => setDraft((current) => ({ ...current, sendLater: !current.sendLater }))}>
            Send later
          </button>
          {draft.sendLater && (
            <input
              type="datetime-local"
              value={draft.sendAt}
              onChange={(event) => setDraft((current) => ({ ...current, sendAt: event.target.value }))}
            />
          )}
        </div>

        {pickerOpen && (
          <div className="emoji-grid">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setDraft((current) => ({ ...current, message: `${current.message}${emoji}` }))}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <span className="text-xs text-slate-500">Draft saved locally as you type.</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" disabled={sendDisabled} onClick={sendDemo}>
              <Send size={15} />
              Send
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
  const approvals = Array.isArray(snapshot?.approvals) ? snapshot.approvals.filter((item) => item.status === 'pending') : [];
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages.slice(0, 12) : [];
  const composeLeads = useMemo(() => {
    const runtimeLeads = Array.isArray(snapshot?.leadImports)
      ? (snapshot.leadImports as Record<string, unknown>[]).map(toComposeLead)
      : [];
    return runtimeLeads.length ? runtimeLeads : MOCK_COMPOSE_LEADS;
  }, [snapshot?.leadImports]);

  useEffect(() => {
    const openCompose = () => setComposeOpen(true);
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
      await refresh().catch((err) => { console.warn('[PBK] State refresh failed after approval decision:', err); return null; });
      setActionStatus(status === 'approved' ? 'Approved. Ava can continue.' : 'Decision sent to Ava.');
    } catch (nextError) {
      setActionStatus(nextError instanceof Error ? nextError.message : 'Approval update failed.');
    } finally {
      setPendingAction('');
    }
  };

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
          <div className="text-xs text-slate-500">
            {loading ? 'Loading inbox...' : error || `${messages.length} recent messages`}
          </div>
        </div>
      </div>

      {actionStatus && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          {actionStatus}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Approvals Needed</h2>
          <p className="mt-1 text-xs text-slate-500">Items Ava/Rex need you to approve before sending.</p>
          <div className="mt-3 space-y-2">
            {approvals.map((approval) => (
              <div
                key={String(approval.id)}
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
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pendingAction === `approval:${String(approval.id)}:approved`}
                    onClick={() => void decideApproval(approval, 'approved')}
                    className="rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={pendingAction === `approval:${String(approval.id)}:rejected`}
                    onClick={() => {
                      const status = String(approval.type || '').toLowerCase() === 'contract' ? 'needs-revision' : 'rejected';
                      void decideApproval(approval, status);
                    }}
                    className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                  >
                    {String(approval.type || '').toLowerCase() === 'contract' ? 'Needs Revision' : 'Decline'}
                  </button>
                </div>
              </div>
            ))}
            {!approvals.length && (
              <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                Nothing is waiting on human approval.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto] gap-3 border-b border-slate-800 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-slate-500">
            <span>Channel</span>
            <span>Message</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-slate-800">
            {messages.map((message) => (
              <div
                key={String(message.id)}
                className="grid grid-cols-1 gap-2 px-4 py-4 text-sm text-slate-200 md:grid-cols-[auto_1fr_auto]"
              >
                <div className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  {String(message.channel || 'sms')}
                </div>
                <div>
                  <div className="font-medium text-slate-100">{String(message.leadName || message.address || 'Message')}</div>
                  <div className="mt-1 text-xs text-slate-400">{String(message.body || '(empty message)')}</div>
                </div>
                <div className="text-xs text-slate-500 md:text-right">
                  {formatRuntimeStatus(message.status)}
                  {(message.createdAt || message.at) && (
                    <div title={new Date(String(message.createdAt || message.at)).toLocaleString()}>
                      {formatRelativeTime(String(message.createdAt || message.at))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!messages.length && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No runtime messages yet.
              </div>
            )}
          </div>
        </section>
      </div>
      <ComposeModal open={composeOpen} leads={composeLeads} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
