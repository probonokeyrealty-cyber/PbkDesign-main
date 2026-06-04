import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  PbkButton,
  PbkDataSource,
  PbkEmpty,
  PbkField,
  PbkInput,
  PbkPageHead,
  PbkPanel,
  PbkSkeleton,
  PbkStatusChip,
} from '../../components/pbk/index';
import {
  createCampaignRequest,
  fetchCampaignLeadSourcesRequest,
  fetchCampaignsRequest,
  patchCampaignRequest,
  requestCampaignApprovalRequest,
  runCampaignActionRequest,
  type CampaignLeadSource,
  type CampaignRecord,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

export const CAMPAIGN_WIZARD_DRAFT_KEY = 'pbk:campaign-wizard:draft:v1';

type LoadStatus = 'loading' | 'ready' | 'error';
type WizardMode = 'save' | 'approval';

type CampaignWizardDraft = {
  name: string;
  channel: string;
  leadSource: string;
  templateId: string;
  scheduledFor: string;
  dailyCap: string;
  firstMessage: string;
  followUpMessage: string;
  notes: string;
};

const DEFAULT_DRAFT: CampaignWizardDraft = {
  name: '',
  channel: 'email',
  leadSource: 'all-imports',
  templateId: 'seller-reactivation',
  scheduledFor: '',
  dailyCap: '50',
  firstMessage: '',
  followUpMessage: '',
  notes: '',
};

const STATUS_FILTERS = ['all', 'draft', 'pending', 'active', 'paused', 'cancelled'];
const CHANNEL_FILTERS = ['all', 'email', 'sms', 'call', 'mixed'];

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(asNumber(value));
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(asNumber(value));
}

function formatDate(value?: string) {
  if (!value) return 'Not scheduled';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function statusVariant(status = ''): 'new' | 'pending' | 'approved' | 'rejected' | 'testing' {
  const normalized = status.toLowerCase();
  if (['active', 'running', 'approved'].includes(normalized)) return 'approved';
  if (['cancelled', 'failed', 'rejected'].includes(normalized)) return 'rejected';
  if (['paused', 'draft'].includes(normalized)) return 'testing';
  if (['pending', 'queued', 'approval_required'].includes(normalized)) return 'pending';
  return 'new';
}

function readDraft() {
  if (typeof window === 'undefined') return DEFAULT_DRAFT;
  try {
    const raw = window.localStorage.getItem(CAMPAIGN_WIZARD_DRAFT_KEY);
    return raw ? { ...DEFAULT_DRAFT, ...JSON.parse(raw) } : DEFAULT_DRAFT;
  } catch {
    return DEFAULT_DRAFT;
  }
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CAMPAIGN_WIZARD_DRAFT_KEY);
  } catch {
    // Local draft cleanup is best-effort only.
  }
}

function metric(campaign: CampaignRecord, key: string) {
  return (campaign.metrics || {})[key] ?? 0;
}

function getSourceLabel(sourceId: string, sources: CampaignLeadSource[]) {
  return sources.find((source) => source.id === sourceId)?.label || sourceId || 'Lead source';
}

function buildCampaignPayload(draft: CampaignWizardDraft, status = 'draft') {
  return {
    name: draft.name.trim(),
    channel: draft.channel,
    leadSource: draft.leadSource,
    templateId: draft.templateId.trim(),
    status,
    schedule: {
      firstSendAt: draft.scheduledFor || null,
      dailyCap: Number(draft.dailyCap || 50),
      window: '9-5-est',
    },
    sequence: {
      subject: draft.templateId.trim() || draft.name.trim(),
      script: draft.firstMessage.trim(),
      steps: [
        {
          step: 1,
          channel: draft.channel,
          delayHours: 0,
          body: draft.firstMessage.trim(),
        },
        {
          step: 2,
          channel: draft.channel,
          delayHours: 72,
          body: draft.followUpMessage.trim(),
        },
      ].filter((step) => step.body),
    },
    notes: draft.notes.trim(),
    actor: 'PBK React shell',
  };
}

function CampaignCard({
  campaign,
  busy,
  onRequestApproval,
  onPatchStatus,
  onCancel,
}: {
  campaign: CampaignRecord;
  busy: boolean;
  onRequestApproval: (campaign: CampaignRecord) => void;
  onPatchStatus: (campaign: CampaignRecord, status: string) => void;
  onCancel: (campaign: CampaignRecord) => void;
}) {
  const status = String(campaign.status || 'draft');
  const canRequestApproval = !['pending', 'active', 'running', 'cancelled'].includes(
    status.toLowerCase()
  );
  const nextHoldStatus = status.toLowerCase() === 'paused' ? 'draft' : 'paused';

  return (
    <PbkPanel className="flex h-full flex-col gap-4 p-4" elevated>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Megaphone size={16} className="text-sky-300" />
            <h2 className="truncate text-base font-semibold text-slate-100" title={campaign.name}>
              {campaign.name || 'Untitled campaign'}
            </h2>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {campaign.provider || campaign.channel || 'provider pending'} -{' '}
            {campaign.templateId || 'template pending'}
          </div>
        </div>
        <PbkStatusChip status={statusVariant(status)}>{status.replace(/_/g, ' ')}</PbkStatusChip>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Leads</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {formatNumber(campaign.leadCount || metric(campaign, 'leads'))}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Replies</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {formatNumber(metric(campaign, 'replied'))}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Cost</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">
            {formatMoney(metric(campaign, 'estimatedCost'))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
        <div className="flex items-center gap-2 text-slate-300">
          <Clock3 size={14} />
          {formatDate(String(campaign.schedule?.firstSendAt || campaign.updatedAt || ''))}
        </div>
        {campaign.pendingAction && (
          <div className="mt-2 text-amber-200">
            Pending approval: {String(campaign.pendingAction).replace(/_/g, ' ')}
          </div>
        )}
        {campaign.notes && (
          <p className="mt-2 line-clamp-2" title={campaign.notes}>
            {campaign.notes}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <PbkButton
          size="sm"
          variant="success"
          disabled={busy || !canRequestApproval}
          onClick={() => onRequestApproval(campaign)}
        >
          <ShieldCheck size={14} />
          Request approval
        </PbkButton>
        <PbkButton
          size="sm"
          variant="ghost"
          disabled={busy || status.toLowerCase() === 'cancelled'}
          onClick={() => onPatchStatus(campaign, nextHoldStatus)}
        >
          {nextHoldStatus === 'paused' ? 'Pause' : 'Resume'}
        </PbkButton>
        <PbkButton
          size="sm"
          variant="danger"
          disabled={busy || status.toLowerCase() === 'cancelled'}
          onClick={() => onCancel(campaign)}
        >
          <Trash2 size={14} />
          Cancel
        </PbkButton>
      </div>
    </PbkPanel>
  );
}

function CampaignWizard({
  open,
  sources,
  draft,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  sources: CampaignLeadSource[];
  draft: CampaignWizardDraft;
  saving: WizardMode | null;
  onChange: (draft: CampaignWizardDraft) => void;
  onClose: () => void;
  onSubmit: (mode: WizardMode) => void;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  if (!open) return null;

  const update = (patch: Partial<CampaignWizardDraft>) => onChange({ ...draft, ...patch });
  const source = sources.find((item) => item.id === draft.leadSource);
  const canSubmit = Boolean(draft.name.trim()) && Boolean(draft.firstMessage.trim());

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal max-w-4xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-wizard-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="pbk-eyebrow">Campaign wizard</div>
            <h2 id="campaign-wizard-title" className="pbk-display pbk-h2 m-0">
              Build an approval-gated seller sequence
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Draft autosaves locally, then saves to the bridge before launch approval.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close wizard">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <PbkField label="Campaign name" required>
              <PbkInput
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder="June probate seller reactivation"
              />
            </PbkField>

            <div className="grid gap-4 sm:grid-cols-2">
              <PbkField label="Channel">
                <select
                  className="pbk-input"
                  value={draft.channel}
                  onChange={(event) => update({ channel: event.target.value })}
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="call">Call</option>
                  <option value="mixed">Mixed</option>
                </select>
              </PbkField>

              <PbkField label="Lead source">
                <select
                  className="pbk-input"
                  value={draft.leadSource}
                  onChange={(event) => update({ leadSource: event.target.value })}
                >
                  {sources.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label || item.id} ({item.count || 0})
                    </option>
                  ))}
                </select>
              </PbkField>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <PbkField label="Template ID">
                <PbkInput
                  value={draft.templateId}
                  onChange={(event) => update({ templateId: event.target.value })}
                />
              </PbkField>
              <PbkField label="First send">
                <PbkInput
                  type="datetime-local"
                  value={draft.scheduledFor}
                  onChange={(event) => update({ scheduledFor: event.target.value })}
                />
              </PbkField>
              <PbkField label="Daily cap">
                <PbkInput
                  type="number"
                  min={1}
                  max={1000}
                  value={draft.dailyCap}
                  onChange={(event) => update({ dailyCap: event.target.value })}
                />
              </PbkField>
            </div>

            <PbkField label="First touch copy" required>
              <textarea
                className="pbk-input min-h-32"
                value={draft.firstMessage}
                onChange={(event) => update({ firstMessage: event.target.value })}
                placeholder="Write the first seller-facing message Ava should send after approval."
              />
            </PbkField>

            <PbkField label="Follow-up copy">
              <textarea
                className="pbk-input min-h-24"
                value={draft.followUpMessage}
                onChange={(event) => update({ followUpMessage: event.target.value })}
                placeholder="Optional second touch, usually 72 hours later."
              />
            </PbkField>
          </div>

          <PbkPanel className="space-y-4 p-4">
            <div>
              <div className="pbk-eyebrow">Real data source</div>
              <PbkDataSource endpoint="GET/POST /api/campaigns" status="ships" />
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                Selected source
              </div>
              <div className="mt-1 font-semibold text-slate-100">
                {getSourceLabel(draft.leadSource, sources)}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {source?.note || 'Bridge did not return a note for this source.'}
              </p>
            </div>
            <PbkField label="Operator notes">
              <textarea
                className="pbk-input min-h-28"
                value={draft.notes}
                onChange={(event) => update({ notes: event.target.value })}
                placeholder="Risk notes, target seller segment, or approval context."
              />
            </PbkField>
            <div className="rounded-lg border border-sky-400/20 bg-sky-400/10 p-3 text-xs text-sky-100">
              Autosaved locally. Provider writes still require bridge save and operator approval.
            </div>
          </PbkPanel>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <div className="flex flex-wrap gap-2">
            <PbkButton
              variant="ghost"
              disabled={!canSubmit || Boolean(saving)}
              onClick={() => onSubmit('save')}
            >
              {saving === 'save' ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              Save draft
            </PbkButton>
            <PbkButton
              variant="success"
              disabled={!canSubmit || Boolean(saving)}
              onClick={() => onSubmit('approval')}
            >
              {saving === 'approval' ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Save and request approval
            </PbkButton>
          </div>
        </div>
      </section>
    </div>
  );
}

export function Campaigns() {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [sources, setSources] = useState<CampaignLeadSource[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [draft, setDraft] = useState<CampaignWizardDraft>(() => readDraft());
  const [saving, setSaving] = useState<WizardMode | null>(null);
  const [busyCampaignId, setBusyCampaignId] = useState('');

  const loadCampaigns = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [campaignResponse, sourceResponse] = await Promise.all([
        fetchCampaignsRequest({
          search,
          status: statusFilter,
          channel: channelFilter,
        }),
        fetchCampaignLeadSourcesRequest(),
      ]);
      setCampaigns(campaignResponse.campaigns || []);
      setSources(sourceResponse.sources || campaignResponse.sources || []);
      setStatus('ready');
    } catch (loadError) {
      setStatus('error');
      setError(loadError instanceof Error ? loadError.message : 'Campaign bridge request failed.');
    }
  }, [channelFilter, search, statusFilter]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (!wizardOpen || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CAMPAIGN_WIZARD_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      showUiToast({
        tone: 'warning',
        title: 'Campaign draft not saved locally',
        desc: 'Your browser blocked local storage, so keep this wizard open until you save.',
      });
    }
  }, [draft, wizardOpen]);

  const summary = useMemo(() => {
    const active = campaigns.filter((campaign) =>
      /active|running|pending/i.test(String(campaign.status || ''))
    ).length;
    const leads = campaigns.reduce(
      (sum, campaign) => sum + asNumber(campaign.leadCount || metric(campaign, 'leads')),
      0
    );
    const replies = campaigns.reduce(
      (sum, campaign) => sum + asNumber(metric(campaign, 'replied')),
      0
    );
    return { active, leads, replies };
  }, [campaigns]);

  const handleWizardSubmit = async (mode: WizardMode) => {
    setSaving(mode);
    try {
      const response = await createCampaignRequest(buildCampaignPayload(draft));
      if (!response.ok || !response.campaign?.id) {
        throw new Error(response.error || response.verbiage || 'Campaign save failed.');
      }
      if (mode === 'approval') {
        const approvalResponse = await requestCampaignApprovalRequest(response.campaign.id, {
          requestedAction: 'start_campaign',
          notes: draft.notes || `Start ${draft.name}`,
          actor: 'PBK React shell',
        });
        if (!approvalResponse.ok) {
          throw new Error(
            approvalResponse.error || approvalResponse.verbiage || 'Approval request failed.'
          );
        }
      }
      clearDraft();
      setDraft(DEFAULT_DRAFT);
      setWizardOpen(false);
      await loadCampaigns();
      showUiToast({
        tone: 'success',
        title: mode === 'approval' ? 'Campaign queued for approval' : 'Campaign draft saved',
        desc:
          mode === 'approval'
            ? 'The approval queue now owns provider execution.'
            : 'The campaign is saved in the bridge as a draft.',
      });
    } catch (submitError) {
      showUiToast({
        tone: 'error',
        critical: true,
        title: 'Campaign save failed',
        desc:
          submitError instanceof Error ? submitError.message : 'The bridge rejected the campaign.',
      });
    } finally {
      setSaving(null);
    }
  };

  const requestApproval = async (campaign: CampaignRecord) => {
    if (!campaign.id) return;
    setBusyCampaignId(campaign.id);
    try {
      await requestCampaignApprovalRequest(campaign.id, {
        requestedAction: 'start_campaign',
        actor: 'PBK React shell',
      });
      await loadCampaigns();
      showUiToast({
        tone: 'success',
        title: 'Approval requested',
        desc: `${campaign.name || 'Campaign'} is waiting in the approval queue.`,
      });
    } catch (actionError) {
      showUiToast({
        tone: 'error',
        critical: true,
        title: 'Approval request failed',
        desc:
          actionError instanceof Error ? actionError.message : 'The bridge rejected the request.',
      });
    } finally {
      setBusyCampaignId('');
    }
  };

  const patchStatus = async (campaign: CampaignRecord, nextStatus: string) => {
    if (!campaign.id) return;
    setBusyCampaignId(campaign.id);
    try {
      await patchCampaignRequest(campaign.id, {
        status: nextStatus,
        actor: 'PBK React shell',
      });
      await loadCampaigns();
      showUiToast({
        tone: 'success',
        title: nextStatus === 'paused' ? 'Campaign paused' : 'Campaign resumed',
        desc: campaign.name || campaign.id,
      });
    } catch (actionError) {
      showUiToast({
        tone: 'error',
        critical: true,
        title: 'Campaign update failed',
        desc:
          actionError instanceof Error ? actionError.message : 'The bridge rejected the update.',
      });
    } finally {
      setBusyCampaignId('');
    }
  };

  const cancelCampaign = async (campaign: CampaignRecord) => {
    if (!campaign.id) return;
    const confirmed = window.confirm(`Cancel campaign "${campaign.name || campaign.id}"?`);
    if (!confirmed) return;
    setBusyCampaignId(campaign.id);
    try {
      await runCampaignActionRequest(campaign.id, {
        action: 'cancel_campaign',
        actor: 'PBK React shell',
      });
      await loadCampaigns();
      showUiToast({
        tone: 'warning',
        title: 'Campaign cancelled',
        desc: campaign.name || campaign.id,
      });
    } catch (actionError) {
      showUiToast({
        tone: 'error',
        critical: true,
        title: 'Campaign cancel failed',
        desc:
          actionError instanceof Error ? actionError.message : 'The bridge rejected the action.',
      });
    } finally {
      setBusyCampaignId('');
    }
  };

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <PbkPageHead
        eyebrow="Outbound control"
        title={
          <>
            Campaigns <em className="text-sky-200">with approval gates</em>
          </>
        }
        description="Bridge-backed campaign drafts, lead sources, launch approvals, and provider-safe actions."
        status="production"
        statusLabel="live endpoints"
        actions={
          <PbkButton variant="primary" onClick={() => setWizardOpen(true)}>
            <Plus size={15} />
            New campaign
          </PbkButton>
        }
      />

      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 pb-8">
        <div className="grid gap-3 md:grid-cols-3">
          <PbkPanel className="p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Active</div>
            <div className="mt-1 text-3xl font-semibold text-slate-100">{summary.active}</div>
          </PbkPanel>
          <PbkPanel className="p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
              Leads loaded
            </div>
            <div className="mt-1 text-3xl font-semibold text-slate-100">
              {formatNumber(summary.leads)}
            </div>
          </PbkPanel>
          <PbkPanel className="p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Replies</div>
            <div className="mt-1 text-3xl font-semibold text-slate-100">
              {formatNumber(summary.replies)}
            </div>
          </PbkPanel>
        </div>

        <PbkPanel className="p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
            <PbkInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search campaign name, provider, template, notes..."
              aria-label="Search campaigns"
            />
            <select
              className="pbk-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by campaign status"
            >
              {STATUS_FILTERS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              className="pbk-input"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              aria-label="Filter by campaign channel"
            >
              {CHANNEL_FILTERS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <PbkButton variant="ghost" onClick={() => void loadCampaigns()}>
              <RefreshCw size={15} className={status === 'loading' ? 'animate-spin' : ''} />
              Refresh
            </PbkButton>
          </div>
          <div className="mt-3">
            <PbkDataSource
              endpoint="GET /api/campaigns + GET /api/campaigns/lead-sources"
              status="ships"
            />
          </div>
        </PbkPanel>

        {status === 'loading' && (
          <div className="grid gap-4 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <PbkPanel key={index} className="space-y-4 p-4" elevated>
                <PbkSkeleton variant="title" />
                <PbkSkeleton variant="card" />
                <PbkSkeleton variant="text" />
              </PbkPanel>
            ))}
          </div>
        )}

        {status === 'error' && (
          <PbkPanel className="border-red-400/30 bg-red-950/30 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3 text-red-100">
                <AlertCircle size={18} />
                <div>
                  <div className="font-semibold">Campaign bridge unavailable</div>
                  <div className="mt-1 text-sm text-red-200/80">{error}</div>
                </div>
              </div>
              <PbkButton variant="ghost" onClick={() => void loadCampaigns()}>
                Retry
              </PbkButton>
            </div>
          </PbkPanel>
        )}

        {status === 'ready' && campaigns.length === 0 && (
          <PbkEmpty
            title="No bridge campaigns returned"
            description="Create the first campaign draft or adjust the filters. This page will not invent fake seller campaigns."
            action={
              <PbkButton variant="primary" onClick={() => setWizardOpen(true)}>
                <Plus size={15} />
                New campaign
              </PbkButton>
            }
          />
        )}

        {status === 'ready' && campaigns.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-3">
            {campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                busy={busyCampaignId === campaign.id}
                onRequestApproval={(item) => void requestApproval(item)}
                onPatchStatus={(item, nextStatus) => void patchStatus(item, nextStatus)}
                onCancel={(item) => void cancelCampaign(item)}
              />
            ))}
          </div>
        )}
      </main>

      <CampaignWizard
        open={wizardOpen}
        sources={
          sources.length ? sources : [{ id: 'all-imports', label: 'All imported leads', count: 0 }]
        }
        draft={draft}
        saving={saving}
        onChange={setDraft}
        onClose={() => setWizardOpen(false)}
        onSubmit={(mode) => void handleWizardSubmit(mode)}
      />
    </div>
  );
}
