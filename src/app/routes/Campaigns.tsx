import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Grid2X2,
  List,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
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
  PbkPanel,
  PbkSkeleton,
} from '../../components/pbk/index';
import {
  createCampaignRequest,
  fetchCampaignDrilldownRequest,
  fetchCampaignLeadSourcesRequest,
  fetchCampaignRankedTemplatesRequest,
  fetchCampaignsRequest,
  fetchReplyTemplatesRequest,
  patchCampaignRequest,
  requestCampaignApprovalRequest,
  runCampaignActionRequest,
  type CampaignDrilldownResponse,
  type CampaignDrilldownRow,
  type CampaignLeadSource,
  type CampaignRecord,
  type ReplyTemplateRecord,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

export const CAMPAIGN_WIZARD_DRAFT_KEY = 'pbk:campaign-wizard:draft:v1';

type LoadStatus = 'loading' | 'ready' | 'error';
type WizardMode = 'save' | 'approval';
type ViewMode = 'cards' | 'table';
type TemplateStatus = 'idle' | 'loading' | 'ready' | 'error';

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
const WIZARD_STEPS = ['Channel', 'Leads', 'Template', 'Schedule', 'Review'];

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

function formatPercent(value: unknown) {
  return `${asNumber(value).toFixed(1).replace(/\.0$/, '')}%`;
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

function statusClass(status = '') {
  const normalized = status.toLowerCase();
  if (['active', 'running', 'approved'].includes(normalized)) return 'active';
  if (['pending', 'queued', 'approval_required'].includes(normalized)) return 'pending';
  if (['paused'].includes(normalized)) return 'paused';
  if (['complete', 'completed', 'done'].includes(normalized)) return 'completed';
  if (['cancelled', 'failed', 'rejected'].includes(normalized)) return 'cancelled';
  return 'draft';
}

function campaignChannel(campaign: CampaignRecord | Pick<CampaignWizardDraft, 'channel'>) {
  const channel = String(campaign.channel || 'email').toLowerCase();
  if (channel.includes('sms')) return 'sms';
  if (channel.includes('call') || channel.includes('voice')) return 'call';
  if (channel.includes('mixed')) return 'mixed';
  return 'email';
}

function channelLabel(channel = 'email') {
  if (channel === 'sms') return 'SMS';
  if (channel === 'call') return 'Calls';
  if (channel === 'mixed') return 'Mixed';
  return 'Email';
}

function channelProvider(channel = 'email') {
  if (channel === 'sms' || channel === 'call') return 'Telnyx';
  if (channel === 'mixed') return 'Telnyx + Instantly';
  return 'Instantly';
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

function metricFirst(campaign: CampaignRecord, keys: string[], fallback = 0) {
  const metrics = campaign.metrics || {};
  for (const key of keys) {
    if (!(key in metrics)) continue;
    const value = metrics[key];
    if (value !== undefined && value !== null && String(value) !== '') return value;
  }
  return fallback;
}

function getSourceLabel(sourceId: string, sources: CampaignLeadSource[]) {
  return sources.find((source) => source.id === sourceId)?.label || sourceId || 'Lead source';
}

function getCampaignSourceId(campaign: CampaignRecord) {
  const leadFilter = campaign.leadFilter || {};
  const source =
    campaign.leadSource ||
    leadFilter.source ||
    leadFilter.leadSource ||
    leadFilter.importSource ||
    'all-imports';
  return String(source || 'all-imports');
}

function getCampaignProgress(campaign: CampaignRecord) {
  const leads = asNumber(campaign.leadCount || metric(campaign, 'leads'));
  const completed = asNumber(
    metricFirst(campaign, ['sent', 'delivered', 'dialed', 'completed', 'processed'])
  );
  const percent = leads > 0 ? Math.min(100, Math.round((completed / leads) * 100)) : 0;
  return {
    leads,
    completed,
    percent,
    label: leads ? `${formatNumber(completed)} / ${formatNumber(leads)}` : 'no lead count',
  };
}

function getDrilldownRowCost(row: CampaignDrilldownRow) {
  const channel = String(row.channel || '').toLowerCase();
  if (channel === 'sms') return 0.021;
  if (channel === 'call') return 0.014;
  if (channel === 'mixed') return 0.01;
  return 0.01;
}

type CampaignPerformanceRow = {
  id: string;
  label: string;
  leads: number;
  sent: number;
  replied: number;
  connected: number;
  cost: number;
  latestAt?: string;
};

function sortPerformanceRows(rows: CampaignPerformanceRow[]) {
  return rows.sort((left, right) => {
    const leftScore = left.replied * 4 + left.connected * 3 + left.sent + left.leads;
    const rightScore = right.replied * 4 + right.connected * 3 + right.sent + right.leads;
    return rightScore - leftScore;
  });
}

function buildSourcePerformanceRows(
  drilldown: CampaignDrilldownResponse | null,
  campaigns: CampaignRecord[],
  sources: CampaignLeadSource[]
) {
  const grouped = new Map<string, CampaignPerformanceRow>();
  const rows = drilldown?.rows || [];
  if (rows.length) {
    for (const row of rows) {
      const id = String(row.source || 'unassigned');
      const current =
        grouped.get(id) ||
        ({
          id,
          label: id || 'Unassigned source',
          leads: 0,
          sent: 0,
          replied: 0,
          connected: 0,
          cost: 0,
          latestAt: '',
        } satisfies CampaignPerformanceRow);
      current.leads += 1;
      current.sent += row.sent ? 1 : 0;
      current.replied += row.replied ? 1 : 0;
      current.connected += row.connected ? 1 : 0;
      current.cost += getDrilldownRowCost(row);
      current.latestAt = row.lastEventAt || row.updatedAt || current.latestAt;
      grouped.set(id, current);
    }
    return sortPerformanceRows(Array.from(grouped.values())).slice(0, 5);
  }

  for (const campaign of campaigns) {
    const id = getCampaignSourceId(campaign);
    const progress = getCampaignProgress(campaign);
    const current =
      grouped.get(id) ||
      ({
        id,
        label: getSourceLabel(id, sources),
        leads: 0,
        sent: 0,
        replied: 0,
        connected: 0,
        cost: 0,
        latestAt: '',
      } satisfies CampaignPerformanceRow);
    current.leads += progress.leads;
    current.sent += progress.completed;
    current.replied += asNumber(
      metricFirst(campaign, ['replied', 'replies', 'verbal', 'verbalYes'])
    );
    current.connected += asNumber(metricFirst(campaign, ['connected', 'answered']));
    current.cost += asNumber(metricFirst(campaign, ['estimatedCost', 'cost']));
    current.latestAt = campaign.updatedAt || campaign.createdAt || current.latestAt;
    grouped.set(id, current);
  }
  return sortPerformanceRows(Array.from(grouped.values())).slice(0, 5);
}

function buildChannelPerformanceRows(
  drilldown: CampaignDrilldownResponse | null,
  campaigns: CampaignRecord[]
) {
  const grouped = new Map<string, CampaignPerformanceRow>();
  const rows = drilldown?.rows || [];
  if (rows.length) {
    for (const row of rows) {
      const id = campaignChannel({ channel: row.channel || 'email' });
      const current =
        grouped.get(id) ||
        ({
          id,
          label: channelLabel(id),
          leads: 0,
          sent: 0,
          replied: 0,
          connected: 0,
          cost: 0,
          latestAt: '',
        } satisfies CampaignPerformanceRow);
      current.leads += 1;
      current.sent += row.sent ? 1 : 0;
      current.replied += row.replied ? 1 : 0;
      current.connected += row.connected ? 1 : 0;
      current.cost += getDrilldownRowCost(row);
      current.latestAt = row.lastEventAt || row.updatedAt || current.latestAt;
      grouped.set(id, current);
    }
    return sortPerformanceRows(Array.from(grouped.values()));
  }

  for (const campaign of campaigns) {
    const id = campaignChannel(campaign);
    const progress = getCampaignProgress(campaign);
    const current =
      grouped.get(id) ||
      ({
        id,
        label: channelLabel(id),
        leads: 0,
        sent: 0,
        replied: 0,
        connected: 0,
        cost: 0,
        latestAt: '',
      } satisfies CampaignPerformanceRow);
    current.leads += progress.leads;
    current.sent += progress.completed;
    current.replied += asNumber(
      metricFirst(campaign, ['replied', 'replies', 'verbal', 'verbalYes'])
    );
    current.connected += asNumber(metricFirst(campaign, ['connected', 'answered']));
    current.cost += asNumber(metricFirst(campaign, ['estimatedCost', 'cost']));
    current.latestAt = campaign.updatedAt || campaign.createdAt || current.latestAt;
    grouped.set(id, current);
  }
  return sortPerformanceRows(Array.from(grouped.values()));
}

function getDrilldownSummary(
  drilldown: CampaignDrilldownResponse | null,
  campaigns: CampaignRecord[],
  sourceRows: CampaignPerformanceRow[]
) {
  const fallbackLeads = sourceRows.reduce((sum, row) => sum + row.leads, 0);
  const fallbackSent = sourceRows.reduce((sum, row) => sum + row.sent, 0);
  const fallbackReplied = sourceRows.reduce((sum, row) => sum + row.replied, 0);
  const fallbackConnected = sourceRows.reduce((sum, row) => sum + row.connected, 0);
  const fallbackCost = sourceRows.reduce((sum, row) => sum + row.cost, 0);
  const summary = drilldown?.summary || {};
  return {
    campaigns: asNumber(summary.campaigns, campaigns.length),
    leads: asNumber(summary.leads, fallbackLeads),
    sent: asNumber(summary.sent, fallbackSent),
    replied: asNumber(summary.replied, fallbackReplied),
    connected: asNumber(summary.connected, fallbackConnected),
    estimatedCost: asNumber(summary.estimatedCost, fallbackCost),
    replyRate:
      summary.replyRate !== undefined
        ? asNumber(summary.replyRate)
        : fallbackLeads
          ? (fallbackReplied / fallbackLeads) * 100
          : 0,
    connectRate:
      summary.connectRate !== undefined
        ? asNumber(summary.connectRate)
        : fallbackLeads
          ? (fallbackConnected / fallbackLeads) * 100
          : 0,
  };
}

function getCampaignPriority(
  campaign: CampaignRecord
): 'high' | 'live' | 'money' | 'low' | undefined {
  const status = String(campaign.status || '').toLowerCase();
  if (/pending|approval/.test(status) || campaign.pendingAction) return 'high';
  if (/active|running/.test(status)) return 'live';
  if (asNumber(metricFirst(campaign, ['closed', 'revenue', 'profit'])) > 0) return 'money';
  if (/cancelled|draft|paused/.test(status)) return 'low';
  return undefined;
}

function normalizeTemplateOptions(templates: Record<string, ReplyTemplateRecord> | null) {
  return Object.entries(templates || {}).map(([key, template]) => ({
    key,
    label: template.subject || template.templateKey || key,
    version: template.templateVersion || 'reply-template',
    channel: template.channel || 'email',
    text: template.text || '',
  }));
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

function ChannelBadge({ channel }: { channel: string }) {
  const normalized = campaignChannel({ channel });
  const Icon = normalized === 'call' ? Phone : normalized === 'sms' ? MessageSquare : Mail;
  return (
    <span className={`pbk-camp-channel-badge ${normalized}`}>
      <Icon size={12} />
      {channelLabel(normalized)}
    </span>
  );
}

function CampaignPerformanceList({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: CampaignPerformanceRow[];
  emptyLabel: string;
}) {
  return (
    <div className="pbk-camp-drilldown-list">
      <h3>{title}</h3>
      {rows.length ? (
        rows.map((row) => {
          const replyRate = row.leads ? (row.replied / row.leads) * 100 : 0;
          return (
            <div className="pbk-camp-drilldown-row" key={row.id}>
              <div className="min-w-0">
                <strong title={row.label}>{row.label}</strong>
                <span>
                  {formatNumber(row.sent)} sent - {formatNumber(row.replied)} replies -{' '}
                  {formatMoney(row.cost)} spend
                </span>
              </div>
              <div className="pbk-camp-drilldown-rate">
                <span>{formatPercent(replyRate)}</span>
                <div className="pbk-camp-progress" aria-hidden="true">
                  <div
                    className="pbk-camp-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(0, replyRate))}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="pbk-camp-drilldown-empty">{emptyLabel}</div>
      )}
    </div>
  );
}

function CampaignDrilldownPanel({
  drilldown,
  campaigns,
  sources,
  loading,
}: {
  drilldown: CampaignDrilldownResponse | null;
  campaigns: CampaignRecord[];
  sources: CampaignLeadSource[];
  loading: boolean;
}) {
  const sourceRows = useMemo(
    () => buildSourcePerformanceRows(drilldown, campaigns, sources),
    [campaigns, drilldown, sources]
  );
  const channelRows = useMemo(
    () => buildChannelPerformanceRows(drilldown, campaigns),
    [campaigns, drilldown]
  );
  const drilldownSummary = useMemo(
    () => getDrilldownSummary(drilldown, campaigns, sourceRows),
    [campaigns, drilldown, sourceRows]
  );
  const generatedLabel = drilldown?.generatedAt ? formatDate(drilldown.generatedAt) : 'waiting';
  const bridgeRows = drilldown?.rows?.length || 0;
  const sourceNote = bridgeRows
    ? `${formatNumber(bridgeRows)} lead drilldown rows - ${drilldown?.source || 'bridge state'}`
    : 'fallback aggregation from bridge campaign records until lead rows exist';

  if (loading && !campaigns.length && !drilldown) {
    return (
      <PbkPanel className="pbk-camp-drilldown" elevated>
        <PbkSkeleton variant="title" />
        <PbkSkeleton variant="card" />
        <PbkSkeleton variant="text" />
      </PbkPanel>
    );
  }

  return (
    <PbkPanel className="pbk-camp-drilldown" elevated priority="money">
      <div className="pbk-camp-drilldown-head">
        <div>
          <span className="pbk-eyebrow">Premium campaign analytics</span>
          <h2>Source-ranked campaign drilldown</h2>
          <p>
            Ranks source and channel performance from live campaign leads, delivery events, replies,
            and connected-call signals.
          </p>
        </div>
        <span className={`pbk-camp-status-pill ${bridgeRows ? 'active' : 'draft'}`}>
          {bridgeRows ? 'live rows' : 'campaign fallback'}
        </span>
      </div>

      <div className="pbk-camp-drilldown-summary">
        <div>
          <span>Campaigns</span>
          <strong>{formatNumber(drilldownSummary.campaigns)}</strong>
        </div>
        <div>
          <span>Leads scored</span>
          <strong>{formatNumber(drilldownSummary.leads)}</strong>
        </div>
        <div>
          <span>Reply rate</span>
          <strong>{formatPercent(drilldownSummary.replyRate)}</strong>
        </div>
        <div>
          <span>Connect rate</span>
          <strong>{formatPercent(drilldownSummary.connectRate)}</strong>
        </div>
        <div>
          <span>Est. spend</span>
          <strong>{formatMoney(drilldownSummary.estimatedCost)}</strong>
        </div>
      </div>

      <div className="pbk-camp-drilldown-grid">
        <CampaignPerformanceList
          title="Source ranking"
          rows={sourceRows}
          emptyLabel="No source rows returned yet."
        />
        <CampaignPerformanceList
          title="Channel performance"
          rows={channelRows}
          emptyLabel="No channel rows returned yet."
        />
      </div>

      <PbkDataSource
        endpoint="GET /api/analytics/campaign-drilldown"
        status="ships"
        note={`${sourceNote} - generated ${generatedLabel}`}
      />
    </PbkPanel>
  );
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
  const normalizedChannel = campaignChannel(campaign);
  const progress = getCampaignProgress(campaign);
  const canRequestApproval = !['pending', 'active', 'running', 'cancelled'].includes(
    status.toLowerCase()
  );
  const nextHoldStatus = status.toLowerCase() === 'paused' ? 'draft' : 'paused';
  const sentLabel =
    normalizedChannel === 'call' ? 'Dialed' : normalizedChannel === 'sms' ? 'Sent' : 'Sent';
  const replyLabel = normalizedChannel === 'call' ? 'Verbal' : 'Replies';
  const sequenceSteps = Array.isArray(campaign.sequence?.steps)
    ? campaign.sequence.steps.length
    : asNumber(metricFirst(campaign, ['steps', 'touches']), 0);

  return (
    <PbkPanel
      className="pbk-camp-card flex h-full flex-col gap-4"
      elevated
      priority={getCampaignPriority(campaign)}
    >
      <div className="pbk-camp-card-head">
        <div className="min-w-0">
          <h2 title={campaign.name}>
            {campaign.name || 'Untitled'} <em>campaign</em>
          </h2>
          <span className={`pbk-camp-status-pill ${statusClass(status)}`}>
            {status.replace(/_/g, ' ')}
          </span>
        </div>
        <ChannelBadge channel={normalizedChannel} />
      </div>

      <div className="pbk-camp-card-meta">
        <span>
          <strong>{formatNumber(progress.leads)}</strong> leads
        </span>
        <span className="dot" />
        <span>
          {sequenceSteps ? `${sequenceSteps}-touch sequence` : campaign.templateId || 'custom copy'}
        </span>
        <span className="dot" />
        <span>
          {formatDate(String(campaign.schedule?.firstSendAt || campaign.updatedAt || ''))}
        </span>
      </div>

      <div className="pbk-camp-card-stats">
        <div className="pbk-camp-stat">
          <div className="l">{sentLabel}</div>
          <div className="v">{formatNumber(progress.completed)}</div>
        </div>
        <div className="pbk-camp-stat">
          <div className="l">{normalizedChannel === 'call' ? 'Connected' : 'Opens'}</div>
          <div className="v">
            {formatNumber(metricFirst(campaign, ['connected', 'opens', 'opened']))}
          </div>
        </div>
        <div className="pbk-camp-stat">
          <div className="l">{replyLabel}</div>
          <div className="v good">
            {formatNumber(metricFirst(campaign, ['replied', 'replies', 'verbal', 'verbalYes']))}
          </div>
        </div>
        <div className="pbk-camp-stat">
          <div className="l">Cost</div>
          <div className="v">{formatMoney(metricFirst(campaign, ['estimatedCost', 'cost']))}</div>
        </div>
      </div>

      {campaign.pendingAction ? (
        <div className="pbk-camp-warning">
          <strong>Awaiting approval</strong>
          <span>{String(campaign.pendingAction).replace(/_/g, ' ')}</span>
        </div>
      ) : (
        <div>
          <div className="pbk-camp-progress">
            <div className="pbk-camp-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="pbk-camp-progress-meta">
            <span>{progress.percent}% complete</span>
            <span>{progress.label}</span>
          </div>
        </div>
      )}

      {campaign.notes && (
        <p className="line-clamp-2 text-xs text-slate-500" title={campaign.notes}>
          {campaign.notes}
        </p>
      )}

      <div className="pbk-camp-card-actions">
        <PbkButton
          size="sm"
          variant="success"
          disabled={busy || !canRequestApproval}
          onClick={() => onRequestApproval(campaign)}
        >
          <ShieldCheck size={14} />
          Approval
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
          aria-label={`Cancel campaign ${campaign.name || campaign.id}`}
        >
          <Trash2 size={14} />
          Cancel
        </PbkButton>
      </div>

      <PbkDataSource endpoint="GET/PATCH /api/campaigns" status="ships" />
    </PbkPanel>
  );
}

function CampaignHero({
  summary,
  loading,
  onNewCampaign,
}: {
  summary: {
    active: number;
    draft: number;
    pending: number;
    completed: number;
    leads: number;
    replies: number;
    cost: number;
  };
  loading: boolean;
  onNewCampaign: () => void;
}) {
  return (
    <section className="pbk-campaign-hero">
      <div className="pbk-campaign-hero-top">
        <div>
          <div className="pbk-eyebrow">
            Campaigns - {summary.active} active - {summary.draft} draft - {summary.completed}{' '}
            complete
          </div>
          <h1 className="pbk-display pbk-h1">
            Outreach <em>campaigns</em>.
          </h1>
          <p>
            Email sequences via <strong>Instantly</strong>. Outbound calls and SMS via{' '}
            <strong>Telnyx</strong>. Approval-gated, bridge-tracked, paused or resumed from one
            cockpit.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PbkButton
            variant="ghost"
            onClick={() => window.dispatchEvent(new CustomEvent('pbk:open-compose'))}
          >
            <MessageSquare size={15} />
            Compose
          </PbkButton>
          <PbkButton variant="primary" onClick={onNewCampaign}>
            <Plus size={15} />
            New campaign
          </PbkButton>
        </div>
      </div>

      <div className="pbk-stats-ribbon">
        <div className="pbk-stat">
          <div className="pbk-stat-label">Active / pending</div>
          <div className="pbk-stat-value">
            {summary.active}
            <span className="pbk-stat-delta warn">{summary.pending} pending</span>
          </div>
        </div>
        <div className="pbk-stat">
          <div className="pbk-stat-label">Leads loaded</div>
          <div className="pbk-stat-value">{formatNumber(summary.leads)}</div>
        </div>
        <div className="pbk-stat">
          <div className="pbk-stat-label">Replies / verbal</div>
          <div className="pbk-stat-value">
            {formatNumber(summary.replies)}
            <span className="pbk-stat-delta">
              {summary.leads ? formatPercent((summary.replies / summary.leads) * 100) : '0%'}
            </span>
          </div>
        </div>
        <div className="pbk-stat">
          <div className="pbk-stat-label">Estimated spend</div>
          <div className="pbk-stat-value">{formatMoney(summary.cost)}</div>
        </div>
      </div>

      <PbkDataSource
        endpoint="GET /api/campaigns + GET /api/campaigns/lead-sources"
        status="ships"
        note={
          loading ? 'refreshing campaign cockpit' : 'hero stats derive from bridge campaign records'
        }
      />
    </section>
  );
}

function CampaignChannelFilter({
  campaigns,
  value,
  onChange,
}: {
  campaigns: CampaignRecord[];
  value: string;
  onChange: (channel: string) => void;
}) {
  const counts = useMemo(() => {
    const next: Record<string, number> = {
      all: campaigns.length,
      email: 0,
      call: 0,
      sms: 0,
      mixed: 0,
    };
    for (const campaign of campaigns) {
      const channel = campaignChannel(campaign);
      next[channel] = (next[channel] || 0) + 1;
    }
    return next;
  }, [campaigns]);

  return (
    <div className="flex flex-wrap gap-2" aria-label="Campaign channel filters">
      {CHANNEL_FILTERS.map((channel) => (
        <button
          key={channel}
          type="button"
          className={`pbk-camp-channel-chip ${value === channel ? 'active' : ''}`.trim()}
          onClick={() => onChange(channel)}
          aria-pressed={value === channel}
        >
          {channel === 'all' ? 'All' : channelLabel(channel)}
          <span>{counts[channel] || 0}</span>
        </button>
      ))}
    </div>
  );
}

function CampaignsTableView({
  campaigns,
  busyCampaignId,
  onRequestApproval,
  onPatchStatus,
  onCancel,
}: {
  campaigns: CampaignRecord[];
  busyCampaignId: string;
  onRequestApproval: (campaign: CampaignRecord) => void;
  onPatchStatus: (campaign: CampaignRecord, status: string) => void;
  onCancel: (campaign: CampaignRecord) => void;
}) {
  return (
    <div className="pbk-camp-table" role="table" aria-label="Campaign table">
      <div className="pbk-camp-table-row head" role="row">
        <span>Name</span>
        <span>Channel</span>
        <span>Status</span>
        <span>Leads</span>
        <span>Progress</span>
        <span>Replies</span>
        <span>Actions</span>
      </div>
      {campaigns.map((campaign) => {
        const status = String(campaign.status || 'draft');
        const progress = getCampaignProgress(campaign);
        const nextHoldStatus = status.toLowerCase() === 'paused' ? 'draft' : 'paused';
        return (
          <div className="pbk-camp-table-row" role="row" key={campaign.id}>
            <div className="name">
              <ChannelBadge channel={campaignChannel(campaign)} />
              <span title={campaign.name}>{campaign.name || 'Untitled campaign'}</span>
            </div>
            <span>{channelProvider(campaignChannel(campaign))}</span>
            <span>
              <span className={`pbk-camp-status-pill ${statusClass(status)}`}>
                {status.replace(/_/g, ' ')}
              </span>
            </span>
            <span className="num">{formatNumber(progress.leads)}</span>
            <span className="num">{progress.label}</span>
            <span className="num good">
              {formatNumber(metricFirst(campaign, ['replied', 'replies', 'verbal', 'verbalYes']))}
            </span>
            <span className="actions">
              <button
                type="button"
                className="chip-btn"
                disabled={busyCampaignId === campaign.id}
                onClick={() => onRequestApproval(campaign)}
              >
                Approval
              </button>
              <button
                type="button"
                className="chip-btn"
                disabled={busyCampaignId === campaign.id}
                onClick={() => onPatchStatus(campaign, nextHoldStatus)}
              >
                {nextHoldStatus === 'paused' ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                className="chip-btn"
                disabled={busyCampaignId === campaign.id}
                onClick={() => onCancel(campaign)}
              >
                Cancel
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CampaignWizardStepper({ step, onStep }: { step: number; onStep: (step: number) => void }) {
  return (
    <div className="pbk-wiz-stepper" aria-label="Campaign wizard progress">
      {WIZARD_STEPS.map((label, index) => {
        const current = index + 1;
        return (
          <button
            key={label}
            type="button"
            className={`pbk-wiz-step ${current === step ? 'active' : ''} ${current < step ? 'done' : ''}`.trim()}
            onClick={() => onStep(current)}
            aria-current={current === step ? 'step' : undefined}
          >
            <span className="num">{current}</span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function CampaignWizardPane({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className="pbk-wiz-pane" hidden={!active}>
      {children}
    </div>
  );
}

function CampaignWizard({
  open,
  sources,
  templates,
  templateStatus,
  draft,
  saving,
  onChange,
  onRefreshTemplates,
  onClose,
  onSubmit,
}: {
  open: boolean;
  sources: CampaignLeadSource[];
  templates: Record<string, ReplyTemplateRecord> | null;
  templateStatus: TemplateStatus;
  draft: CampaignWizardDraft;
  saving: WizardMode | null;
  onChange: (draft: CampaignWizardDraft) => void;
  onRefreshTemplates: () => void;
  onClose: () => void;
  onSubmit: (mode: WizardMode) => void;
}) {
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setStep(1);
    setStepError('');
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  if (!open) return null;

  const update = (patch: Partial<CampaignWizardDraft>) => {
    setStepError('');
    onChange({ ...draft, ...patch });
  };
  const source = sources.find((item) => item.id === draft.leadSource);
  const templateOptions = normalizeTemplateOptions(templates);
  const canSubmit = Boolean(draft.name.trim()) && Boolean(draft.firstMessage.trim());
  const estimatedCost = asNumber(source?.count, 0) * (draft.channel === 'email' ? 0.002 : 0.03);
  const validateStep = () => {
    if (step === 1 && !['email', 'call', 'sms'].includes(draft.channel)) {
      return 'Choose Email, Calls, or SMS before continuing.';
    }
    if (step === 2 && !draft.leadSource.trim()) {
      return 'Choose a lead source before continuing.';
    }
    if (step === 3 && !draft.firstMessage.trim()) {
      return 'Add the first seller-facing message before continuing.';
    }
    if (step === 4 && !draft.name.trim()) {
      return 'Name the campaign before reviewing it.';
    }
    if (step === 4 && asNumber(draft.dailyCap, 0) < 1) {
      return 'Daily cap must be at least 1.';
    }
    return '';
  };
  const next = () => {
    const validationError = validateStep();
    if (validationError) {
      setStepError(validationError);
      return;
    }
    setStepError('');
    if (step < WIZARD_STEPS.length) {
      setStep((current) => Math.min(WIZARD_STEPS.length, current + 1));
      return;
    }
    onSubmit('approval');
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="pbk-wiz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-wizard-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pbk-wiz-head">
          <div className="pbk-wiz-head-row">
            <h2 id="campaign-wizard-title">
              New <em>campaign</em>
            </h2>
            <button
              type="button"
              className="pbk-wiz-close"
              onClick={onClose}
              aria-label="Close wizard"
            >
              <X size={16} />
            </button>
          </div>
          <CampaignWizardStepper step={step} onStep={setStep} />
        </div>

        <div className="pbk-wiz-body">
          {stepError && (
            <div className="pbk-wiz-validation" role="alert" aria-live="assertive">
              <AlertCircle size={15} />
              <span>{stepError}</span>
            </div>
          )}
          <CampaignWizardPane active={step === 1}>
            <h3>
              Pick a <em>channel</em>.
            </h3>
            <p>
              Email goes through Instantly. Calls and SMS go through Telnyx. Provider actions stay
              approval-gated through the bridge.
            </p>
            <div className="pbk-channel-grid">
              {['email', 'call', 'sms'].map((channel) => {
                const Icon = channel === 'call' ? Phone : channel === 'sms' ? MessageSquare : Mail;
                return (
                  <button
                    key={channel}
                    type="button"
                    className={`pbk-channel-opt ${draft.channel === channel ? 'selected' : ''}`.trim()}
                    onClick={() => update({ channel })}
                    aria-pressed={draft.channel === channel}
                  >
                    <span className="icon">
                      <Icon size={22} />
                    </span>
                    <strong>{channelLabel(channel)}</strong>
                    <span>{channelProvider(channel)} - approval gated - tracked</span>
                  </button>
                );
              })}
            </div>
          </CampaignWizardPane>

          <CampaignWizardPane active={step === 2}>
            <h3>
              Choose <em>lead source</em>.
            </h3>
            <p>Lead groups come from the bridge, not from prototype samples.</p>
            <div className="pbk-source-list">
              {sources.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`pbk-source-opt ${draft.leadSource === item.id ? 'selected' : ''}`.trim()}
                  onClick={() => update({ leadSource: item.id })}
                  aria-pressed={draft.leadSource === item.id}
                >
                  <span className="radio" />
                  <span className="info">
                    <strong>{item.label || item.id}</strong>
                    <span>{item.note || 'Bridge lead-source segment'}</span>
                  </span>
                  <span className="count">{formatNumber(item.count || 0)} leads</span>
                </button>
              ))}
            </div>
            <PbkDataSource endpoint="GET /api/campaigns/lead-sources" status="ships" />
          </CampaignWizardPane>

          <CampaignWizardPane active={step === 3}>
            <h3>
              Pick a <em>template</em>.
            </h3>
            <p>
              Starter copy is ranked by the campaign bridge using channel, lead source, and recorded
              campaign outcomes. The generic reply catalog remains the fallback source.
            </p>
            {templateStatus === 'loading' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <PbkSkeleton variant="card" />
                <PbkSkeleton variant="card" />
              </div>
            )}
            {templateStatus === 'error' && (
              <PbkPanel className="border-amber-400/30 bg-amber-950/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-amber-100">Template catalog did not load.</span>
                  <PbkButton size="sm" variant="ghost" onClick={onRefreshTemplates}>
                    Retry
                  </PbkButton>
                </div>
              </PbkPanel>
            )}
            {templateStatus === 'ready' && templateOptions.length > 0 && (
              <div className="pbk-tpl-grid">
                {templateOptions.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    className={`pbk-tpl-opt ${draft.templateId === template.key ? 'selected' : ''}`.trim()}
                    onClick={() =>
                      update({
                        templateId: template.key,
                        firstMessage: draft.firstMessage || String(template.text || ''),
                      })
                    }
                    aria-pressed={draft.templateId === template.key}
                  >
                    <strong>{template.label}</strong>
                    <span>{String(template.text || 'No body returned.').slice(0, 140)}</span>
                    <span className="meta">
                      <span>{template.channel}</span>
                      <span>{template.version}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {templateStatus === 'ready' && templateOptions.length === 0 && (
              <PbkEmpty
                title="No reply templates returned"
                description="Use custom copy for now. The bridge returned no ranked or catalog templates."
              />
            )}
            <PbkDataSource endpoint="GET /api/replies/templates" status="ships" />
            <PbkDataSource
              endpoint="GET /api/campaigns/templates/ranked"
              status="ships"
              note="campaign-specific performance ranking"
            />

            <div className="mt-4 grid gap-4">
              <PbkField label="Template ID">
                <PbkInput
                  value={draft.templateId}
                  onChange={(event) => update({ templateId: event.target.value })}
                />
              </PbkField>
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
          </CampaignWizardPane>

          <CampaignWizardPane active={step === 4}>
            <h3>
              Set the <em>schedule</em>.
            </h3>
            <p>Choose when the bridge may begin outreach after approval.</p>
            <div className="pbk-schedule-list">
              <label className="pbk-schedule-row">
                <span className="label">Campaign name</span>
                <PbkInput
                  value={draft.name}
                  onChange={(event) => update({ name: event.target.value })}
                  placeholder="June probate seller reactivation"
                />
              </label>
              <label className="pbk-schedule-row">
                <span className="label">First send</span>
                <PbkInput
                  type="datetime-local"
                  value={draft.scheduledFor}
                  onChange={(event) => update({ scheduledFor: event.target.value })}
                />
              </label>
              <label className="pbk-schedule-row">
                <span className="label">Daily cap</span>
                <PbkInput
                  type="number"
                  min={1}
                  max={1000}
                  value={draft.dailyCap}
                  onChange={(event) => update({ dailyCap: event.target.value })}
                />
              </label>
              <label className="pbk-schedule-row">
                <span className="label">Operator notes</span>
                <textarea
                  className="pbk-input min-h-24"
                  value={draft.notes}
                  onChange={(event) => update({ notes: event.target.value })}
                  placeholder="Risk notes, target seller segment, or approval context."
                />
              </label>
            </div>
          </CampaignWizardPane>

          <CampaignWizardPane active={step === 5}>
            <h3>
              Final <em>review</em>.
            </h3>
            <p>
              Save as a bridge campaign or send it into the approval queue for provider execution.
            </p>
            <div className="pbk-review-grid">
              <div className="pbk-review-card">
                <h5>Channel</h5>
                <div className="row">
                  <span className="l">Provider</span>
                  <span className="v">
                    {channelProvider(draft.channel)} - {channelLabel(draft.channel)}
                  </span>
                </div>
                <div className="row">
                  <span className="l">Approval</span>
                  <span className="v">operator gated</span>
                </div>
              </div>
              <div className="pbk-review-card">
                <h5>Audience</h5>
                <div className="row">
                  <span className="l">Source</span>
                  <span className="v">{getSourceLabel(draft.leadSource, sources)}</span>
                </div>
                <div className="row">
                  <span className="l">Lead count</span>
                  <span className="v">{formatNumber(source?.count || 0)}</span>
                </div>
              </div>
              <div className="pbk-review-card">
                <h5>Template</h5>
                <div className="row">
                  <span className="l">Template ID</span>
                  <span className="v">{draft.templateId || 'custom'}</span>
                </div>
                <div className="row">
                  <span className="l">Follow-up</span>
                  <span className="v">
                    {draft.followUpMessage.trim() ? '2 touches' : '1 touch'}
                  </span>
                </div>
              </div>
              <div className="pbk-review-cost">
                <h5>Estimated spend</h5>
                <div className="big">{formatMoney(estimatedCost)}</div>
                <p>
                  Estimate uses the selected bridge lead-source count and current channel. Provider
                  billing remains source-of-truth at send time.
                </p>
              </div>
            </div>
          </CampaignWizardPane>
        </div>

        <div className="pbk-wiz-foot">
          <span className="progress-text">
            Step {step} of {WIZARD_STEPS.length}
          </span>
          <div className="nav-btns">
            <PbkButton
              type="button"
              variant="ghost"
              disabled={step === 1 || Boolean(saving)}
              onClick={() => {
                setStepError('');
                setStep((current) => Math.max(1, current - 1));
              }}
            >
              Back
            </PbkButton>
            <PbkButton
              type="button"
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
              type="button"
              variant={step === WIZARD_STEPS.length ? 'success' : 'primary'}
              disabled={(step === WIZARD_STEPS.length && !canSubmit) || Boolean(saving)}
              onClick={next}
            >
              {saving === 'approval' ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {step === WIZARD_STEPS.length ? 'Request approval' : 'Next'}
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
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [wizardOpen, setWizardOpen] = useState(false);
  const closeWizard = useCallback(() => setWizardOpen(false), []);
  const [draft, setDraft] = useState<CampaignWizardDraft>(() => readDraft());
  const [templates, setTemplates] = useState<Record<string, ReplyTemplateRecord> | null>(null);
  const [templateStatus, setTemplateStatus] = useState<TemplateStatus>('idle');
  const [saving, setSaving] = useState<WizardMode | null>(null);
  const [busyCampaignId, setBusyCampaignId] = useState('');
  const [drilldown, setDrilldown] = useState<CampaignDrilldownResponse | null>(null);

  const loadCampaigns = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [campaignResponse, sourceResponse, drilldownResponse] = await Promise.all([
        fetchCampaignsRequest({
          search,
          status: statusFilter,
          channel: 'all',
        }),
        fetchCampaignLeadSourcesRequest(),
        fetchCampaignDrilldownRequest({
          range: '30d',
          status: statusFilter,
          channel: 'all',
          limit: 120,
        }).catch(() => null),
      ]);
      setCampaigns(campaignResponse.campaigns || []);
      setSources(sourceResponse.sources || campaignResponse.sources || []);
      setDrilldown(drilldownResponse);
      setStatus('ready');
    } catch (loadError) {
      setStatus('error');
      setDrilldown(null);
      setError(loadError instanceof Error ? loadError.message : 'Campaign bridge request failed.');
    }
  }, [search, statusFilter]);

  const loadTemplates = useCallback(
    async (channel = draft.channel) => {
      setTemplateStatus('loading');
      try {
        const response = await fetchCampaignRankedTemplatesRequest({
          channel,
          leadSource: draft.leadSource,
          limit: 8,
        });
        setTemplates(response.templates || null);
        setTemplateStatus('ready');
      } catch {
        try {
          const fallbackResponse = await fetchReplyTemplatesRequest({ channel });
          setTemplates(fallbackResponse.templates || null);
          setTemplateStatus('ready');
        } catch {
          setTemplates(null);
          setTemplateStatus('error');
        }
      }
    },
    [draft.channel, draft.leadSource]
  );

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    if (!wizardOpen) return;
    void loadTemplates(draft.channel);
  }, [draft.channel, draft.leadSource, loadTemplates, wizardOpen]);

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
    const draftCount = campaigns.filter((campaign) =>
      /draft/i.test(String(campaign.status || ''))
    ).length;
    const pending = campaigns.filter(
      (campaign) =>
        /pending|approval/i.test(String(campaign.status || '')) || campaign.pendingAction
    ).length;
    const completed = campaigns.filter((campaign) =>
      /complete|completed|done/i.test(String(campaign.status || ''))
    ).length;
    const leads = campaigns.reduce(
      (sum, campaign) => sum + asNumber(campaign.leadCount || metric(campaign, 'leads')),
      0
    );
    const replies = campaigns.reduce(
      (sum, campaign) =>
        sum + asNumber(metricFirst(campaign, ['replied', 'replies', 'verbal', 'verbalYes'])),
      0
    );
    const cost = campaigns.reduce(
      (sum, campaign) => sum + asNumber(metricFirst(campaign, ['estimatedCost', 'cost'])),
      0
    );
    return { active, draft: draftCount, pending, completed, leads, replies, cost };
  }, [campaigns]);

  const displayedCampaigns = useMemo(() => {
    if (channelFilter === 'all') return campaigns;
    return campaigns.filter((campaign) => campaignChannel(campaign) === channelFilter);
  }, [campaigns, channelFilter]);

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
    <div className="pbk-campaign-surface min-h-full text-slate-100">
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 py-5 pb-8">
        <CampaignHero
          summary={summary}
          loading={status === 'loading'}
          onNewCampaign={() => setWizardOpen(true)}
        />

        <CampaignDrilldownPanel
          drilldown={drilldown}
          campaigns={campaigns}
          sources={sources}
          loading={status === 'loading'}
        />

        <PbkPanel className="pbk-camp-toolbar">
          <div className="pbk-camp-search">
            <Search size={15} />
            <PbkInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search campaign name, provider, template, notes..."
              aria-label="Search campaigns"
            />
          </div>

          <CampaignChannelFilter
            campaigns={campaigns}
            value={channelFilter}
            onChange={setChannelFilter}
          />

          <select
            className="pbk-input pbk-camp-select"
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

          <div className="pbk-camp-view-toggle" aria-label="Campaign view mode">
            <button
              type="button"
              className={viewMode === 'cards' ? 'active' : ''}
              onClick={() => setViewMode('cards')}
              aria-pressed={viewMode === 'cards'}
              aria-label="Show campaign cards"
            >
              <Grid2X2 size={14} />
            </button>
            <button
              type="button"
              className={viewMode === 'table' ? 'active' : ''}
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              aria-label="Show campaign table"
            >
              <List size={14} />
            </button>
          </div>

          <PbkButton variant="ghost" onClick={() => void loadCampaigns()}>
            <RefreshCw size={15} className={status === 'loading' ? 'animate-spin' : ''} />
            Refresh
          </PbkButton>

          <PbkDataSource
            endpoint="GET /api/campaigns + GET /api/campaigns/lead-sources"
            status="ships"
          />
        </PbkPanel>

        {status === 'loading' && (
          <div className="pbk-camp-grid" aria-label="Loading campaign cards">
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

        {status === 'ready' && campaigns.length > 0 && displayedCampaigns.length === 0 && (
          <PbkEmpty
            title="No campaigns match these filters"
            description="Change the channel or status filter. The list only renders bridge-returned campaigns."
          />
        )}

        {status === 'ready' && displayedCampaigns.length > 0 && viewMode === 'cards' && (
          <div className="pbk-camp-grid">
            {displayedCampaigns.map((campaign) => (
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

        {status === 'ready' && displayedCampaigns.length > 0 && viewMode === 'table' && (
          <CampaignsTableView
            campaigns={displayedCampaigns}
            busyCampaignId={busyCampaignId}
            onRequestApproval={(item) => void requestApproval(item)}
            onPatchStatus={(item, nextStatus) => void patchStatus(item, nextStatus)}
            onCancel={(item) => void cancelCampaign(item)}
          />
        )}
      </main>

      <CampaignWizard
        open={wizardOpen}
        sources={
          sources.length ? sources : [{ id: 'all-imports', label: 'All imported leads', count: 0 }]
        }
        templates={templates}
        templateStatus={templateStatus}
        draft={draft}
        saving={saving}
        onChange={setDraft}
        onRefreshTemplates={() => void loadTemplates(draft.channel)}
        onClose={closeWizard}
        onSubmit={(mode) => void handleWizardSubmit(mode)}
      />
    </div>
  );
}
