import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { CallFloorPanel } from '../components/CallFloorPanel';
import { CallQualityReviewDialog } from '../components/CallQualityReviewDialog';
import { StatusColorLegend } from '../components/StatusColorLegend';
import { LiveCallWidget } from '../components/shell/LiveCallWidget';
import type { LiveCallState, TranscriptLine } from '../components/shell/LiveCallWidget';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import { PbkDataSource, PbkPanel, PbkPulseDot } from '../../components/pbk/index';
import {
  controlRuntimeCall,
  fetchWebSearchStatusRequest,
  updateAdminTaskDecision,
  updateApprovalDecision,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';
import { getApprovalPreview } from './inboxRuntimeLogic.js';

function formatRelative(value?: string) {
  if (!value) return 'just now';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value.slice(0, 16).replace('T', ' ');
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function formatActivityTitle(value?: string) {
  if (!value) return 'Current session';
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function toNumber(value: unknown, fallback: number | null = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mapCallStatus(status: unknown): LiveCallState['status'] {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'live' || normalized === 'connected') return 'connected';
  if (normalized === 'dialing' || normalized === 'queued') return 'dialing';
  if (normalized === 'hold' || normalized === 'on-hold') return 'on-hold';
  if (normalized === 'ended' || normalized === 'completed' || normalized === 'failed')
    return 'ended';
  return 'idle';
}

function formatRuntimeStatus(status: unknown) {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'provider_missing') return 'Provider key missing';
  if (normalized === 'queued') return 'Queued for worker';
  if (normalized === 'queued_for_approval') return 'Queued for approval';
  if (normalized === 'pending') return 'Waiting';
  if (normalized === 'approved') return 'Approved';
  if (normalized === 'rejected') return 'Declined';
  if (normalized === 'needs-revision') return 'Needs Revision';
  if (normalized === 'complete') return 'Complete';
  if (normalized === 'failed') return 'Delivery failed';
  return normalized ? normalized.replace(/_/g, ' ') : 'No data yet';
}

function mapTranscriptLine(line: unknown, index: number): TranscriptLine | null {
  if (!line || typeof line !== 'object') return null;
  const item = line as Record<string, unknown>;
  const speaker = String(item.speaker || '').toLowerCase();
  const mappedSpeaker: TranscriptLine['speaker'] =
    speaker.includes('ai') || speaker.includes('ava')
      ? 'ava'
      : speaker.includes('you') || speaker.includes('user') || speaker.includes('human')
        ? 'user'
        : 'lead';
  const text = String(item.text || item.body || '').trim();
  if (!text) return null;
  return {
    id: String(item.id || `line-${index}`),
    speaker: mappedSpeaker,
    text,
    ts: String(item.ts || item.createdAt || item.at || new Date().toISOString()),
  };
}

function mapRuntimeCall(call: Record<string, unknown> | undefined): LiveCallState | undefined {
  if (!call) return undefined;
  const rawSentiment = toNumber(call.sentiment);
  const sentiment =
    rawSentiment == null
      ? null
      : rawSentiment <= 1
        ? Math.round(rawSentiment * 100)
        : Math.round(rawSentiment);
  const transcript = Array.isArray(call.transcript)
    ? (call.transcript.map(mapTranscriptLine).filter(Boolean) as TranscriptLine[])
    : [];

  return {
    callId: String(call.id || call.callId || ''),
    dealId: call.dealId ? String(call.dealId) : null,
    status: mapCallStatus(call.status),
    agentMode:
      String(call.agentMode || call.mode || 'autopilot') === 'human' ? 'human' : 'autopilot',
    caller: {
      name: call.leadName ? String(call.leadName) : null,
      phone: call.phone ? String(call.phone) : null,
      context: [call.address, call.script].filter(Boolean).map(String).join(' / ') || undefined,
    },
    startedAt: call.startedAt ? String(call.startedAt) : null,
    sentiment,
    transcript,
  };
}

type AdminDecisionDraft = {
  taskId: string;
  status: 'approved' | 'rejected';
  provider: string;
  action: string;
  summary: string;
};

type ApprovalDecisionDraft = {
  approvalId: string;
  status: 'approved' | 'rejected' | 'needs-revision';
  type: string;
  leadName: string;
  address: string;
  actionLabel: string;
};

type ActionStatus = {
  tone: 'pending' | 'success' | 'error';
  text: string;
};

type CommandWidgetId =
  | 'kpis'
  | 'liveCall'
  | 'callFloor'
  | 'adminActivity'
  | 'webSearch'
  | 'statusLegend'
  | 'tooling'
  | 'activity'
  | 'approvals';

const COMMAND_WIDGET_PREFS_KEY = 'pbk:command-center:widgets';
const COMMAND_WIDGETS: Array<{ id: CommandWidgetId; label: string }> = [
  { id: 'kpis', label: 'KPI strip' },
  { id: 'liveCall', label: 'Live call' },
  { id: 'callFloor', label: 'Call floor' },
  { id: 'adminActivity', label: 'Admin activity' },
  { id: 'webSearch', label: 'Web search' },
  { id: 'statusLegend', label: 'Status legend' },
  { id: 'tooling', label: 'Tooling' },
  { id: 'activity', label: 'Activity feed' },
  { id: 'approvals', label: 'Approvals' },
];
const DEFAULT_COMMAND_WIDGETS = COMMAND_WIDGETS.reduce(
  (prefs, widget) => ({ ...prefs, [widget.id]: true }),
  {} as Record<CommandWidgetId, boolean>
);

function readCommandWidgetPrefs() {
  if (typeof window === 'undefined') return DEFAULT_COMMAND_WIDGETS;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(COMMAND_WIDGET_PREFS_KEY) || '{}'
    ) as Partial<Record<CommandWidgetId, boolean>> | null;
    return {
      ...DEFAULT_COMMAND_WIDGETS,
      ...(parsed || {}),
    };
  } catch {
    return DEFAULT_COMMAND_WIDGETS;
  }
}

function writeCommandWidgetPrefs(prefs: Record<CommandWidgetId, boolean>) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(COMMAND_WIDGET_PREFS_KEY, JSON.stringify(prefs));
  }
  return prefs;
}

function getCallId(call: Record<string, unknown>) {
  return String(call.id || call.callId || call.call_id || '');
}

function getCallQualityScore(call: Record<string, unknown>) {
  return toNumber(call.qualityScore ?? call.qaScore ?? call.callQualityScore ?? call.score, null);
}

function getCallOutcome(call: Record<string, unknown>) {
  return String(
    call.outcome ||
      call.outcomeLabel ||
      call.outcome_label ||
      call.disposition ||
      call.summary ||
      'No disposition reported'
  );
}

type RuntimeRecord = Record<string, unknown>;
type BattlefieldTone = 'urgent' | 'hot' | 'warm' | 'money';

type BattlefieldItem = {
  id: string;
  tag: string;
  body: string;
  when: string;
  tone: BattlefieldTone;
  pulse?: 'default' | 'amber' | 'sky' | 'lime';
  targetPath: string;
};

function getNestedRecord(record: RuntimeRecord, key: string) {
  return record[key] && typeof record[key] === 'object' ? (record[key] as RuntimeRecord) : {};
}

function getRuntimeDate(record: RuntimeRecord) {
  const raw =
    record.at ||
    record.createdAt ||
    record.created_at ||
    record.updatedAt ||
    record.updated_at ||
    record.startedAt ||
    record.scheduledFor ||
    record.sendAt;
  return raw ? String(raw) : '';
}

function isRecentRuntimeRecord(record: RuntimeRecord, hours = 24) {
  const raw = getRuntimeDate(record);
  if (!raw) return false;
  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= hours * 60 * 60 * 1000;
}

function formatCompactMoney(value: unknown) {
  const amount = toNumber(value, 0) || 0;
  if (!amount) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    notation: Math.abs(amount) >= 100000 ? 'compact' : 'standard',
  }).format(amount);
}

function getLeadDisplayName(lead: RuntimeRecord) {
  const seller = getNestedRecord(lead, 'seller');
  return String(lead.leadName || lead.name || lead.lead_name || seller.name || 'Unnamed lead');
}

function getLeadDisplayAddress(lead: RuntimeRecord) {
  const property = getNestedRecord(lead, 'property');
  return String(
    lead.address ||
      lead.property_address ||
      lead.propertyAddress ||
      property.address ||
      'No address recorded'
  );
}

function getLeadScore(lead: RuntimeRecord) {
  return (
    toNumber(
      lead.priorityScore ??
        lead.priority_score ??
        lead.engagementScore ??
        lead.engagement_score ??
        lead.motivationScore ??
        lead.motivation_score ??
        lead.score,
      0
    ) || 0
  );
}

function getMessageRecipient(message: RuntimeRecord) {
  return String(
    message.leadName ||
      message.to ||
      message.from ||
      message.phone ||
      message.email ||
      message.address ||
      'seller'
  );
}

function buildHeroStats(params: {
  leadImports: RuntimeRecord[];
  calls: RuntimeRecord[];
  messages: RuntimeRecord[];
  contracts: RuntimeRecord[];
}) {
  const calls24h = params.calls.filter((call) => isRecentRuntimeRecord(call, 24)).length;
  const messages24h = params.messages.filter((message) =>
    isRecentRuntimeRecord(message, 24)
  ).length;
  const contacted24h = calls24h + messages24h;
  const sentContracts = params.contracts.filter((contract) =>
    ['sent', 'signed', 'completed', 'closed'].includes(String(contract.status || '').toLowerCase())
  ).length;
  const closedContracts = params.contracts.filter((contract) =>
    ['signed', 'completed', 'closed', 'won'].includes(String(contract.status || '').toLowerCase())
  );
  const pipelineValue = params.contracts.reduce(
    (sum, contract) =>
      sum + (toNumber(contract.amount ?? contract.revenue ?? contract.value, 0) || 0),
    0
  );

  return [
    {
      label: 'Leads Contacted / 24h',
      value: String(contacted24h),
      delta: `${calls24h} calls / ${messages24h} msgs`,
      tone: 'sky',
    },
    {
      label: 'Contracts Sent',
      value: String(sentContracts),
      delta: `${params.contracts.length} total`,
      tone: 'sky',
    },
    {
      label: 'Deals Closed / MTD',
      value: String(closedContracts.length),
      delta: closedContracts.length ? 'active close path' : 'none yet',
      tone: closedContracts.length ? 'lime' : 'warn',
    },
    {
      label: 'Est. Profit Pipeline',
      value: formatCompactMoney(pipelineValue),
      delta: `${params.leadImports.length} leads`,
      tone: pipelineValue ? 'lime' : 'warn',
    },
  ];
}

function buildBattlefieldItems(params: {
  approvals: RuntimeRecord[];
  adminTasks: RuntimeRecord[];
  leadImports: RuntimeRecord[];
  messages: RuntimeRecord[];
  calls: RuntimeRecord[];
}) {
  const items: BattlefieldItem[] = [];

  params.calls
    .filter((call) =>
      ['live', 'connected', 'dialing', 'queued', 'on-hold'].includes(
        String(call.status || '').toLowerCase()
      )
    )
    .slice(0, 2)
    .forEach((call, index) => {
      const sentiment = toNumber(call.sentiment, null);
      items.push({
        id: `call-${String(call.id || call.callId || index)}`,
        tag: String(call.status || 'Live'),
        body: `${String(call.leadName || call.name || call.phone || 'Active call')} ${
          sentiment == null
            ? ''
            : `/ sentiment ${Math.round(sentiment <= 1 ? sentiment * 100 : sentiment)}`
        }`.trim(),
        when: 'now',
        tone: 'urgent',
        pulse: 'default',
        targetPath: '#live-call',
      });
    });

  params.approvals
    .filter((approval) => String(approval.status || '').toLowerCase() === 'pending')
    .slice(0, 4)
    .forEach((approval, index) => {
      const type = String(approval.type || 'Approval');
      const amount = approval.offerPrice || approval.mao || approval.amount;
      items.push({
        id: `approval-${String(approval.id || index)}`,
        tag: type,
        body: `${amount ? `${formatCompactMoney(amount)} / ` : ''}${String(
          approval.leadName || approval.address || 'approval needed'
        )}`,
        when: formatRelative(getRuntimeDate(approval)),
        tone: type.toLowerCase().includes('contract') ? 'money' : 'hot',
        pulse: type.toLowerCase().includes('contract') ? 'lime' : undefined,
        targetPath: '#approvals',
      });
    });

  params.messages
    .filter((message) =>
      ['failed', 'delivery_failed', 'error'].includes(String(message.status || '').toLowerCase())
    )
    .slice(0, 2)
    .forEach((message, index) => {
      items.push({
        id: `message-failed-${String(message.id || index)}`,
        tag: 'Send failed',
        body: `${String(message.channel || 'message').toUpperCase()} to ${getMessageRecipient(message)}`,
        when: formatRelative(getRuntimeDate(message)),
        tone: 'urgent',
        targetPath: '/inbox',
      });
    });

  params.messages
    .filter((message) => Boolean(message.unread || message.isUnread))
    .slice(0, 2)
    .forEach((message, index) => {
      items.push({
        id: `message-unread-${String(message.id || index)}`,
        tag: String(message.channel || 'Reply'),
        body: `${getMessageRecipient(message)} / ${String(
          message.subject || message.body || 'new seller reply'
        ).slice(0, 56)}`,
        when: formatRelative(getRuntimeDate(message)),
        tone: 'warm',
        pulse: 'amber',
        targetPath: '/inbox',
      });
    });

  params.adminTasks
    .filter((task) => String(task.status || '').toLowerCase() === 'pending')
    .slice(0, 2)
    .forEach((task, index) => {
      items.push({
        id: `admin-${String(task.id || index)}`,
        tag: 'Admin',
        body: `${String(task.provider || 'Rex')} / ${String(task.action || task.summary || 'decision')}`,
        when: formatRelative(getRuntimeDate(task)),
        tone: 'hot',
        targetPath: '#admin-activity',
      });
    });

  params.leadImports
    .filter((lead) => getLeadScore(lead) >= 75)
    .slice(0, 2)
    .forEach((lead, index) => {
      items.push({
        id: `lead-${String(lead.id || lead.leadId || index)}`,
        tag: 'Hot lead',
        body: `${getLeadDisplayName(lead)} / ${getLeadDisplayAddress(lead)}`,
        when: `${Math.round(getLeadScore(lead))}`,
        tone: 'money',
        targetPath: '/leads',
      });
    });

  return items.slice(0, 8);
}

function DataSourceCaption({
  endpoint,
  status = 'ships',
  note,
}: {
  endpoint: string;
  status?: 'ships' | 'needs-wiring';
  note?: string;
}) {
  return <PbkDataSource endpoint={endpoint} status={status} note={note} />;
}

function StatSpark({ tone }: { tone: string }) {
  const stroke = tone === 'lime' ? 'var(--lime)' : tone === 'warn' ? 'var(--amber)' : 'var(--sky)';
  return (
    <svg className="pbk-stat-spark" viewBox="0 0 70 24" fill="none" aria-hidden="true">
      <path
        d="M0 20 L10 17 L20 18 L30 12 L40 14 L50 8 L60 10 L70 5"
        stroke={stroke}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function FounderBattlefield({
  items,
  loading,
  error,
  agentsReady,
  agentsTotal,
  mode,
  onSelect,
}: {
  items: BattlefieldItem[];
  loading: boolean;
  error: string;
  agentsReady: number;
  agentsTotal: number;
  mode: string;
  onSelect: (item: BattlefieldItem) => void;
}) {
  const urgentCount = items.filter((item) => item.tone === 'urgent' || item.tone === 'hot').length;
  const approvalCount = items.filter((item) => /approval|contract/i.test(item.tag)).length;
  const failedCount = items.filter((item) => /failed/i.test(item.tag)).length;
  const sub =
    items.length > 0
      ? `${approvalCount} approvals / ${failedCount} failed sends / ${urgentCount} urgent`
      : loading
        ? 'bridge sync in progress'
        : 'no ranked work waiting';
  const bridgeTone = loading ? 'amber' : error ? 'crimson' : 'lime';
  const bridgeLabel = loading ? 'syncing' : error ? 'offline' : 'healthy';

  return (
    <section className="space-y-2" aria-labelledby="battlefield-title">
      <div className="pbk-battlefield">
        <div className="pbk-battlefield-left">
          <div id="battlefield-title" className="pbk-battlefield-label">
            Do next / ranked queue
          </div>
          <div className="pbk-battlefield-count">
            <em>{items.length}</em> waiting on you
          </div>
          <div className="pbk-battlefield-sub">{sub}</div>
        </div>
        <div className="pbk-battlefield-center" aria-label="Ranked work queue">
          {items.length ? (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`pbk-bf-chip ${item.tone}`}
                title={`${item.tag}: ${item.body}`}
                onClick={() => onSelect(item)}
              >
                {item.pulse && <PbkPulseDot color={item.pulse} />}
                <span className="pbk-bf-chip-tag">{item.tag}</span>
                <span className="pbk-bf-chip-body">{item.body}</span>
                <span className="pbk-bf-chip-when">{item.when}</span>
              </button>
            ))
          ) : (
            <button type="button" className="pbk-bf-chip warm" onClick={() => undefined}>
              <PbkPulseDot color="sky" />
              <span className="pbk-bf-chip-tag">Clear</span>
              <span className="pbk-bf-chip-body">
                No urgent approvals, live calls, or failed sends in the bridge snapshot
              </span>
              <span className="pbk-bf-chip-when">now</span>
            </button>
          )}
        </div>
        <div className="pbk-battlefield-right">
          <div className="pbk-bf-mini-stat">
            <div className="l">Bridge</div>
            <div className={`v ${bridgeTone}`}>{bridgeLabel}</div>
          </div>
          <div className="pbk-bf-mini-stat">
            <div className="l">Agents</div>
            <div className="v">
              {agentsReady}/{agentsTotal || agentsReady || 0}
            </div>
          </div>
          <div className="pbk-bf-mini-stat">
            <div className="l">Mode</div>
            <div className="v amber">{mode}</div>
          </div>
        </div>
      </div>
      <DataSourceCaption
        endpoint="snapshot.approvals + snapshot.calls + snapshot.messages + snapshot.leadImports"
        note="canonical GET /api/founder/work-queue needs Mastra wiring"
      />
    </section>
  );
}

export function CommandCenter() {
  const navigate = useNavigate();
  const { snapshot, tooling, loading, error, refresh } = useRuntimeSnapshot();
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [pendingAction, setPendingAction] = useState('');
  const [webSearchProbeFailed, setWebSearchProbeFailed] = useState(false);
  const [webSearchProbeError, setWebSearchProbeError] = useState('');
  const [adminDecisionDraft, setAdminDecisionDraft] = useState<AdminDecisionDraft | null>(null);
  const [approvalDecisionDraft, setApprovalDecisionDraft] = useState<ApprovalDecisionDraft | null>(
    null
  );
  const [activityLimit, setActivityLimit] = useState(8);
  const [widgetPrefs, setWidgetPrefs] = useState(() => readCommandWidgetPrefs());
  const [qualityReviewCall, setQualityReviewCall] = useState<Record<string, unknown> | null>(null);
  const announcedCallRef = useRef('');
  const reviewedCallRef = useRef('');

  const approvals = Array.isArray(snapshot?.approvals) ? snapshot.approvals : [];
  const adminTasks = Array.isArray(snapshot?.adminTasks) ? snapshot.adminTasks : [];
  const leadImports = Array.isArray(snapshot?.leadImports) ? snapshot.leadImports : [];
  const activityItems = Array.isArray(snapshot?.activity) ? snapshot.activity : [];
  const visibleActivity = activityItems.slice(0, activityLimit);
  const calls = Array.isArray(snapshot?.calls) ? snapshot.calls : [];
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const contracts = Array.isArray(snapshot?.contracts) ? snapshot.contracts : [];
  const isWidgetVisible = (id: CommandWidgetId) => widgetPrefs[id] !== false;
  const runtimeProviders = (snapshot?.status?.providers || {}) as Record<
    string,
    Record<string, unknown>
  >;
  const webSearchStatus = runtimeProviders.webSearch || {};
  const webSearchNeuralOutput = (webSearchStatus.neuralOutput || {}) as Record<string, unknown>;
  const webSearchLiveReady = Boolean(webSearchStatus.liveReady);
  const webSearchFallbackProvider = String(webSearchStatus.fallbackProvider || 'pbk_brain').replace(
    /_/g,
    ' '
  );
  const webSearchPrimaryProvider = String(
    webSearchStatus.primaryProvider || (webSearchLiveReady ? 'tavily' : webSearchFallbackProvider)
  ).replace(/_/g, ' ');
  const webSearchMissing = Array.isArray(webSearchStatus.missing)
    ? webSearchStatus.missing.map(String).filter(Boolean)
    : [];
  const activeCall = mapRuntimeCall(
    calls.find((call) =>
      ['live', 'connected', 'dialing', 'queued', 'on-hold'].includes(
        String(call.status || '').toLowerCase()
      )
    ) || calls[0]
  );
  const endedCallForReview = useMemo(
    () =>
      calls.find((call) =>
        ['ended', 'completed', 'failed'].includes(String(call.status || '').toLowerCase())
      ) || null,
    [calls]
  );

  const toggleWidget = (id: CommandWidgetId) => {
    setWidgetPrefs((current) =>
      writeCommandWidgetPrefs({
        ...current,
        [id]: current[id] === false,
      })
    );
  };

  useEffect(() => {
    setActivityLimit(8);
  }, [activityItems.length]);

  useEffect(() => {
    if (!actionStatus) return undefined;
    if (actionStatus.tone !== 'success') return undefined;
    const handle = window.setTimeout(() => setActionStatus(null), 5000);
    return () => window.clearTimeout(handle);
  }, [actionStatus]);

  useEffect(() => {
    if (!activeCall?.callId || activeCall.status === 'idle') return;
    const key = `${activeCall.callId}:${activeCall.status}`;
    if (announcedCallRef.current === key) return;
    announcedCallRef.current = key;
    if (activeCall.status === 'dialing' || activeCall.status === 'connected') {
      showUiToast({
        tone: 'info',
        title: activeCall.status === 'dialing' ? 'Call is dialing' : 'Call connected',
        desc: `${activeCall.caller.name || 'Unknown caller'} · ${activeCall.caller.phone || 'no phone'}`,
      });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('PBK call floor', {
          body: `${activeCall.status === 'dialing' ? 'Dialing' : 'Connected'}: ${activeCall.caller.name || 'Unknown caller'}`,
        });
      }
    }
    if (activeCall.status === 'ended') {
      showUiToast({
        tone: 'success',
        title: 'Call ended',
        desc: 'Outcome summary will appear here when the provider event includes disposition.',
      });
    }
  }, [activeCall?.callId, activeCall?.status, activeCall?.caller.name, activeCall?.caller.phone]);

  useEffect(() => {
    if (!endedCallForReview) return;
    const callId = getCallId(endedCallForReview);
    if (!callId || reviewedCallRef.current === callId) return;
    reviewedCallRef.current = callId;
    setQualityReviewCall(endedCallForReview);
  }, [endedCallForReview]);
  const toolingSummary = (tooling?.summary || {}) as Record<string, unknown>;
  const toolingCoreReady =
    toNumber(toolingSummary.requiredReadyCount, toNumber(toolingSummary.readyCount, 0)) || 0;
  const toolingCoreTotal =
    toNumber(toolingSummary.requiredCount, toNumber(toolingSummary.totalCount, 0)) || 0;
  const toolingHighlights = [
    { label: 'Meta-Agent', meta: tooling?.metaAgent as Record<string, unknown> | undefined },
    { label: 'BrowserOS Agent', meta: tooling?.browserOs as Record<string, unknown> | undefined },
    {
      label: 'Browser Research',
      meta: tooling?.browserResearch as Record<string, unknown> | undefined,
    },
    { label: 'Property Data', meta: tooling?.propertyData as Record<string, unknown> | undefined },
    {
      label: 'Pipeline Memory',
      meta: tooling?.pipelineMemory as Record<string, unknown> | undefined,
    },
    {
      label: 'Voice Fallback',
      meta: tooling?.voiceFallback as Record<string, unknown> | undefined,
    },
    { label: 'Observability', meta: tooling?.observability as Record<string, unknown> | undefined },
  ];

  const heroStats = useMemo(
    () => buildHeroStats({ leadImports, calls, messages, contracts }),
    [leadImports, calls, messages, contracts]
  );
  const battlefieldItems = useMemo(
    () => buildBattlefieldItems({ approvals, adminTasks, leadImports, messages, calls }),
    [approvals, adminTasks, leadImports, messages, calls]
  );
  const pendingApprovalCount = approvals.filter((item) => item.status === 'pending').length;
  const pendingAdminCount = adminTasks.filter((item) => item.status === 'pending').length;
  const heroTimeLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date());
  const approvalMode =
    pendingApprovalCount || pendingAdminCount
      ? 'Approval'
      : String(snapshot?.settings?.mode || snapshot?.status?.mode || 'Auto').replace(/_/g, ' ');

  const selectBattlefieldItem = (item: BattlefieldItem) => {
    if (item.targetPath.startsWith('#')) {
      document
        .querySelector(item.targetPath)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    navigate(item.targetPath);
  };

  const runRuntimeAction = async (
    key: string,
    successMessage: string,
    action: () => Promise<void>
  ) => {
    setPendingAction(key);
    setActionStatus({ tone: 'pending', text: 'Working with the bridge...' });
    try {
      await action();
      await refresh().catch((err) => {
        console.warn('[PBK] State refresh failed after runtime action:', err);
        return null;
      });
      setActionStatus({ tone: 'success', text: successMessage });
      showUiToast({
        tone: 'success',
        title: 'Runtime action complete',
        desc: successMessage,
      });
    } catch (nextError) {
      setActionStatus({
        tone: 'error',
        text: nextError instanceof Error ? nextError.message : 'Runtime action failed.',
      });
    } finally {
      setPendingAction('');
    }
  };

  const runWebSearchProbe = async () => {
    setPendingAction('web-search:probe');
    setActionStatus({ tone: 'pending', text: 'Checking web-search cognition...' });
    setWebSearchProbeFailed(false);
    setWebSearchProbeError('');
    try {
      const result = await fetchWebSearchStatusRequest();
      const status = (result.status || {}) as Record<string, unknown>;
      const neuralOutput = (status.neuralOutput || {}) as Record<string, unknown>;
      const provider = String(status.primaryProvider || webSearchPrimaryProvider).replace(
        /_/g,
        ' '
      );
      const liveLabel = status.liveReady ? 'live Tavily' : 'fallback';
      const spikeVersion = String(neuralOutput.spikeVersion || 'pbk-web-search-spikes-v1');
      setActionStatus({
        tone: 'success',
        text: `Web-search status is ${liveLabel} via ${provider}; ${spikeVersion} and symbolic facts are available.`,
      });
      await refresh().catch((err) => {
        console.warn('[PBK] State refresh failed after web-search probe:', err);
        return null;
      });
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : 'Web-search status probe failed.';
      setWebSearchProbeFailed(true);
      setWebSearchProbeError(message);
      setActionStatus({ tone: 'error', text: message });
    } finally {
      setPendingAction('');
    }
  };

  const confirmAdminDecision = (
    task: Record<string, unknown>,
    status: AdminDecisionDraft['status']
  ) => {
    const taskId = String(task.id || '');
    if (!taskId) return;
    setAdminDecisionDraft({
      taskId,
      status,
      provider: String(task.provider || 'admin'),
      action: String(task.action || 'review'),
      summary: String(task.summary || task.command || 'Administrative action'),
    });
  };

  const executeAdminDecision = () => {
    if (!adminDecisionDraft) return;
    const draft = adminDecisionDraft;
    setAdminDecisionDraft(null);
    void runRuntimeAction(
      `admin:${draft.taskId}:${draft.status}`,
      draft.status === 'approved'
        ? 'Admin task approved and replayed through Rex.'
        : 'Admin task declined.',
      async () => {
        await updateAdminTaskDecision(draft.taskId, draft.status);
      }
    );
  };

  const confirmApprovalDecision = (
    approval: Record<string, unknown>,
    status: ApprovalDecisionDraft['status']
  ) => {
    const approvalId = String(approval.id || '');
    if (!approvalId) return;
    const type = String(approval.type || 'approval');
    const actionLabel =
      status === 'approved'
        ? 'approve'
        : status === 'needs-revision'
          ? 'request revisions for'
          : 'decline';
    setApprovalDecisionDraft({
      approvalId,
      status,
      type,
      leadName: String(approval.leadName || approval.address || 'PBK approval'),
      address: String(approval.address || 'No address recorded'),
      actionLabel,
    });
  };

  const executeApprovalDecision = () => {
    if (!approvalDecisionDraft) return;
    const draft = approvalDecisionDraft;
    setApprovalDecisionDraft(null);
    void runRuntimeAction(
      `approval:${draft.approvalId}:${draft.status}`,
      draft.status === 'approved' ? 'Approved. Ava can continue.' : 'Decision sent to Ava.',
      async () => {
        await updateApprovalDecision(draft.approvalId, draft.status);
      }
    );
  };

  return (
    <div className="pbk-command-surface min-h-full space-y-6 bg-[var(--bg-void)] p-4 text-[var(--text-primary)] md:p-6">
      <div className="mx-auto max-w-screen-2xl space-y-6">
        <section className="pbk-command-hero">
          <div className="pbk-command-hero-top">
            <div>
              <div className="pbk-eyebrow">Live / {heroTimeLabel}</div>
              <h1 className="pbk-display pbk-h1">
                Good morning, PBK.{' '}
                <em>
                  {pendingApprovalCount + pendingAdminCount
                    ? `${pendingApprovalCount + pendingAdminCount} decisions need you.`
                    : 'Your agents are standing by.'}
                </em>
              </h1>
              <p>
                Live agent activity, approvals, contracts, and admin operations. Every number below
                is derived from the bridge snapshot or clearly marked when the canonical endpoint
                still needs wiring.
              </p>
            </div>
            <div className="pbk-hero-sync" aria-live="polite">
              <span
                aria-hidden="true"
                className={[
                  'h-2 w-2 rounded-full',
                  loading ? 'bg-sky-400 animate-pulse' : error ? 'bg-amber-400' : 'bg-emerald-400',
                ].join(' ')}
              />
              {loading ? 'Syncing runtime' : error ? 'Bridge offline' : 'Bridge sync healthy'}
            </div>
          </div>

          {isWidgetVisible('kpis') && (
            <div className="pbk-stats-ribbon">
              {heroStats.map((stat) => (
                <div key={stat.label} className="pbk-stat">
                  <div className="pbk-stat-label">{stat.label}</div>
                  <div className="pbk-stat-value">
                    {stat.value}
                    <span className={`pbk-stat-delta ${stat.tone === 'warn' ? 'warn' : ''}`}>
                      {stat.delta}
                    </span>
                  </div>
                  <StatSpark tone={stat.tone} />
                </div>
              ))}
            </div>
          )}
          <DataSourceCaption
            endpoint="snapshot.leadImports + snapshot.calls + snapshot.messages + snapshot.contracts"
            note="stats ribbon only uses live runtime arrays"
          />
        </section>

        {actionStatus && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={[
              'flex items-start gap-2 rounded-2xl px-4 py-3 text-sm',
              actionStatus.tone === 'error'
                ? 'border border-rose-400/30 bg-rose-500/10 text-rose-100'
                : actionStatus.tone === 'success'
                  ? 'border border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
                  : 'border border-sky-500/20 bg-sky-500/10 text-sky-100',
            ].join(' ')}
          >
            {actionStatus.tone === 'pending' ? (
              <Loader2 size={15} className="animate-spin" />
            ) : actionStatus.tone === 'error' ? (
              <AlertCircle size={15} className="mt-0.5 text-rose-300" />
            ) : (
              <CheckCircle2 size={15} className="mt-0.5 text-emerald-300" />
            )}
            <span>{actionStatus.text}</span>
          </div>
        )}

        <FounderBattlefield
          items={battlefieldItems}
          loading={loading}
          error={error}
          agentsReady={toolingCoreReady}
          agentsTotal={toolingCoreTotal}
          mode={approvalMode}
          onSelect={selectBattlefieldItem}
        />

        <PbkPanel className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Widget controls</h2>
              <p className="text-xs text-slate-500">
                Personalise this dashboard locally without changing bridge data or operator policy.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {COMMAND_WIDGETS.map((widget) => {
                const active = isWidgetVisible(widget.id);
                return (
                  <button
                    key={widget.id}
                    type="button"
                    onClick={() => toggleWidget(widget.id)}
                    className={[
                      'rounded-full border px-3 py-1.5 text-[11px] font-semibold transition',
                      active
                        ? 'border-sky-400/40 bg-sky-500/10 text-sky-200'
                        : 'border-slate-800 bg-slate-900 text-slate-500',
                    ].join(' ')}
                    aria-pressed={active}
                  >
                    {widget.label}
                  </button>
                );
              })}
            </div>
          </div>
          <DataSourceCaption
            endpoint="localStorage pbk:command-center:widgets"
            note="operator display preference only"
          />
        </PbkPanel>

        {isWidgetVisible('statusLegend') && <StatusColorLegend />}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-5 space-y-4">
            {isWidgetVisible('liveCall') && (
              <div
                id="live-call"
                className={
                  activeCall?.status && activeCall.status !== 'idle'
                    ? 'pbk-priority-live rounded-lg'
                    : 'rounded-lg'
                }
              >
                <LiveCallWidget
                  state={activeCall}
                  onTakeOver={(state) => {
                    const callId = state.callId || '';
                    void runRuntimeAction(
                      `call:${callId}:takeover`,
                      'Human takeover sent to the bridge.',
                      async () => {
                        if (callId) await controlRuntimeCall(callId, 'takeover');
                        navigate(state.dealId ? `/deal/${state.dealId}` : '/deal');
                      }
                    );
                  }}
                  onMute={(state) => {
                    const callId = state.callId || '';
                    if (!callId) return;
                    void runRuntimeAction(
                      `call:${callId}:mute`,
                      'Ava mute command sent to the bridge.',
                      async () => {
                        await controlRuntimeCall(callId, 'mute');
                      }
                    );
                  }}
                  onEnd={(state) => {
                    const callId = state.callId || '';
                    if (!callId) return;
                    void runRuntimeAction(
                      `call:${callId}:end`,
                      'Call end command sent to the bridge.',
                      async () => {
                        await controlRuntimeCall(callId, 'end');
                      }
                    );
                  }}
                />
                <DataSourceCaption endpoint="snapshot.calls[0] + POST /api/calls/:id/action" />
              </div>
            )}

            {isWidgetVisible('callFloor') && <CallFloorPanel leads={leadImports} calls={calls} />}

            {isWidgetVisible('adminActivity') && (
              <section
                id="admin-activity"
                className={`pbk-panel ${pendingAdminCount ? 'pbk-priority-high' : 'pbk-priority-low'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Admin Activity</h2>
                    <p className="text-xs text-slate-500">
                      Approval-backed infrastructure changes from Rex.
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {adminTasks.slice(0, 5).map((task) => (
                    <div
                      key={String(task.id)}
                      className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-medium text-slate-200">
                          {String(task.provider || 'admin')} · {String(task.action || 'review')}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                          {formatRuntimeStatus(task.status)}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        {String(task.summary || task.command || 'Administrative action')}
                      </div>
                      {String(task.status || '').toLowerCase() === 'pending' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={pendingAction === `admin:${String(task.id)}:approved`}
                            onClick={() => confirmAdminDecision(task, 'approved')}
                            className="rounded-full bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60"
                          >
                            {pendingAction === `admin:${String(task.id)}:approved`
                              ? '…'
                              : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={pendingAction === `admin:${String(task.id)}:rejected`}
                            onClick={() => confirmAdminDecision(task, 'rejected')}
                            className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                          >
                            {pendingAction === `admin:${String(task.id)}:rejected`
                              ? '…'
                              : 'Decline'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!adminTasks.length && (
                    <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                      No admin approvals are needed.
                    </div>
                  )}
                </div>
                <DataSourceCaption endpoint="snapshot.adminTasks + POST /api/admin/tasks/:id/decision" />
              </section>
            )}

            {isWidgetVisible('webSearch') && (
              <section
                className={`pbk-panel ${webSearchLiveReady ? 'pbk-priority-money' : 'pbk-priority-high'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Web Search Cognition</h2>
                    <p className="text-xs text-slate-500">
                      Live data status for Ava/Rex spikes, facts, and fallback telemetry.
                    </p>
                  </div>
                  <span
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]',
                      webSearchLiveReady
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-amber-500/10 text-amber-300',
                    ].join(' ')}
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        'h-1.5 w-1.5 rounded-full',
                        webSearchLiveReady ? 'bg-emerald-400' : 'bg-amber-300',
                      ].join(' ')}
                    />
                    {webSearchLiveReady ? 'Tavily live' : 'Fallback active'}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Provider Path
                    </div>
                    <div className="mt-1 text-sm font-semibold capitalize text-slate-100">
                      {webSearchPrimaryProvider}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {String(webSearchStatus.mode || 'waiting for bridge status')}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Neural Contract
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-100">
                      {String(webSearchNeuralOutput.spikeVersion || 'pbk-web-search-spikes-v1')}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {webSearchNeuralOutput.exposesSymbolicFacts === false
                        ? 'Spikes only'
                        : 'Spikes + symbolic facts'}
                    </div>
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-400">
                  {String(
                    webSearchStatus.note ||
                      'Waiting for the bridge to report web-search cognition status.'
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-500">
                    Log event:{' '}
                    <span className="text-slate-300">
                      {String(webSearchStatus.logEvent || 'pbk_web_search_provider')}
                    </span>
                    {!webSearchLiveReady && (
                      <span> / Missing: {webSearchMissing.join(', ') || 'PBK_TAVILY_API_KEY'}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {webSearchProbeFailed && (
                      <button
                        type="button"
                        disabled={pendingAction === 'web-search:probe'}
                        onClick={() => {
                          void runWebSearchProbe();
                        }}
                        className="rounded-full bg-sky-400 px-3 py-1.5 text-[11px] font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
                      >
                        Retry Probe
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pendingAction === 'web-search:probe'}
                      onClick={() => {
                        void runWebSearchProbe();
                      }}
                      className="rounded-full border border-sky-500/40 px-3 py-1.5 text-[11px] font-semibold text-sky-200 transition hover:border-sky-300 hover:text-sky-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      Probe Status
                    </button>
                  </div>
                  {webSearchProbeFailed && webSearchProbeError && (
                    <div className="basis-full text-[11px] text-amber-300">
                      Last probe failed: {webSearchProbeError}
                    </div>
                  )}
                </div>
                <DataSourceCaption endpoint="GET /api/web-search/status" />
              </section>
            )}

            {isWidgetVisible('tooling') && (
              <section className="pbk-panel pbk-priority-low">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Tooling Readiness</h2>
                    <p className="text-xs text-slate-500">
                      Research, monitoring, and meta-agent support systems.
                    </p>
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                    {String(toolingCoreReady)}/{String(toolingCoreTotal)} core
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {toolingHighlights.map((item) => {
                    const ready = Boolean(item.meta?.ready);
                    return (
                      <div
                        key={item.label}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 transition-colors hover:border-slate-700"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 text-xs font-medium text-slate-200">
                            {item.label}
                          </div>
                          <span
                            aria-label={`${item.label} status: ${ready ? 'Ready' : 'Needs setup'}`}
                            className={[
                              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
                              ready
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : 'bg-slate-800 text-slate-400',
                            ].join(' ')}
                          >
                            <span
                              aria-hidden="true"
                              className={[
                                'h-1.5 w-1.5 rounded-full',
                                ready ? 'bg-emerald-400' : 'bg-slate-500',
                              ].join(' ')}
                            />
                            {ready ? 'Ready' : 'Needs setup'}
                          </span>
                        </div>
                        <div className="mt-2 break-words text-xs text-slate-400">
                          {String(item.meta?.note || 'Waiting on bridge status.')}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <DataSourceCaption endpoint="GET /api/tooling/status" />
              </section>
            )}
          </div>

          <div className="xl:col-span-7 space-y-4">
            {isWidgetVisible('activity') && (
              <section className="pbk-panel">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Activity Feed</h2>
                    <p className="text-xs text-slate-500">Recent Ava, Rex, and provider events.</p>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {visibleActivity.map((item, index) => (
                    <div
                      key={`${String(item.id || item.at || item.createdAt || 'activity')}-${index}`}
                      className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-medium text-slate-100">
                          {String(item.actor || 'System')}
                        </div>
                        <div
                          className="text-[10px] text-slate-500"
                          title={formatActivityTitle(String(item.at || item.createdAt || ''))}
                        >
                          {formatRelative(String(item.at || item.createdAt || ''))}
                        </div>
                      </div>
                      <div
                        className="mt-2 line-clamp-2 max-w-full text-xs text-slate-300"
                        title={String(item.text || 'Runtime event')}
                      >
                        {String(item.text || 'Runtime event')}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 uppercase tracking-[0.12em]">
                        {String(item.category || 'INFO')}
                      </div>
                    </div>
                  ))}
                  {!visibleActivity.length && (
                    <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                      The bridge has not recorded activity yet.
                    </div>
                  )}
                  {activityItems.length > visibleActivity.length && (
                    <button
                      type="button"
                      onClick={() =>
                        setActivityLimit((current) => Math.min(current + 8, activityItems.length))
                      }
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-sky-200 transition hover:border-sky-500/50"
                    >
                      Load more activity ({visibleActivity.length} of {activityItems.length})
                    </button>
                  )}
                </div>
                <DataSourceCaption endpoint="snapshot.activity" />
              </section>
            )}

            {isWidgetVisible('approvals') && (
              <section
                id="approvals"
                className={`pbk-panel ${pendingApprovalCount ? 'pbk-priority-high' : 'pbk-priority-low'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Approvals Needed</h2>
                    <p className="text-xs text-slate-500">
                      Items Ava/Rex need you to approve before sending.
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {approvals
                    .filter((item) => item.status === 'pending')
                    .slice(0, 6)
                    .map((approval) => (
                      <div
                        key={String(approval.id)}
                        className={`pbk-command-approval-card ${
                          String(approval.type || '')
                            .toLowerCase()
                            .includes('contract')
                            ? 'contract'
                            : ''
                        }`}
                        data-source="snapshot.approvals payload"
                      >
                        <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
                          {String(approval.type || 'approval')}
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-100">
                          {String(approval.leadName || approval.address || 'PBK approval')}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {String(approval.address || 'No address recorded')}
                        </div>
                        <div
                          className="approval-preview"
                          aria-label={`Approval payload preview for ${String(
                            approval.leadName || approval.address || 'PBK approval'
                          )}`}
                        >
                          {getApprovalPreview(approval)}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            data-approval-primary="true"
                            disabled={pendingAction === `approval:${String(approval.id)}:approved`}
                            onClick={() => confirmApprovalDecision(approval, 'approved')}
                            className="rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                          >
                            {pendingAction === `approval:${String(approval.id)}:approved`
                              ? '…'
                              : 'Approve'}
                          </button>
                          <button
                            type="button"
                            data-approval-secondary="true"
                            disabled={pendingAction === `approval:${String(approval.id)}:rejected`}
                            onClick={() => {
                              const rejectionStatus =
                                String(approval.type || '').toLowerCase() === 'contract'
                                  ? 'needs-revision'
                                  : 'rejected';
                              confirmApprovalDecision(approval, rejectionStatus);
                            }}
                            className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                          >
                            {pendingAction === `approval:${String(approval.id)}:rejected`
                              ? '…'
                              : String(approval.type || '').toLowerCase() === 'contract'
                                ? 'Needs Revision'
                                : 'Decline'}
                          </button>
                        </div>
                      </div>
                    ))}
                  {!approvals.filter((item) => item.status === 'pending').length && (
                    <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                      No pending approvals right now.
                    </div>
                  )}
                </div>
                <DataSourceCaption
                  endpoint="snapshot.approvals payload + PUT /api/approvals/:id"
                  note="preview uses message/body/text/content/payload/metadata fields"
                />
              </section>
            )}
          </div>
        </div>

        <CallQualityReviewDialog
          open={Boolean(qualityReviewCall)}
          leadName={String(
            qualityReviewCall?.leadName || qualityReviewCall?.name || qualityReviewCall?.phone || ''
          )}
          score={qualityReviewCall ? getCallQualityScore(qualityReviewCall) : null}
          outcome={qualityReviewCall ? getCallOutcome(qualityReviewCall) : ''}
          sentiment={qualityReviewCall ? toNumber(qualityReviewCall.sentiment, null) : null}
          transcriptCount={
            Array.isArray(qualityReviewCall?.transcript) ? qualityReviewCall.transcript.length : 0
          }
          onClose={() => setQualityReviewCall(null)}
        />

        {adminDecisionDraft && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-decision-title"
              className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.55)]"
            >
              <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
                Admin safety check
              </div>
              <h3 id="admin-decision-title" className="mt-2 text-lg font-semibold text-slate-100">
                Confirm admin decision
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                This will {adminDecisionDraft.status === 'approved' ? 'approve' : 'decline'}{' '}
                <span className="font-semibold text-slate-200">
                  {adminDecisionDraft.provider} / {adminDecisionDraft.action}
                </span>
                .
              </p>
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300">
                {adminDecisionDraft.summary}
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setAdminDecisionDraft(null)}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    pendingAction ===
                    `admin:${adminDecisionDraft.taskId}:${adminDecisionDraft.status}`
                  }
                  onClick={executeAdminDecision}
                  className="rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
                >
                  {adminDecisionDraft.status === 'approved'
                    ? 'Approve admin task'
                    : 'Decline admin task'}
                </button>
              </div>
            </div>
          </div>
        )}

        {approvalDecisionDraft && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="approval-decision-title"
              className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.55)]"
            >
              <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
                Approval safety check
              </div>
              <h3
                id="approval-decision-title"
                className="mt-2 text-lg font-semibold text-slate-100"
              >
                Confirm approval decision
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                This will {approvalDecisionDraft.actionLabel}{' '}
                <span className="font-semibold text-slate-200">{approvalDecisionDraft.type}</span>{' '}
                for {approvalDecisionDraft.leadName}.
              </p>
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300">
                {approvalDecisionDraft.address}
              </div>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setApprovalDecisionDraft(null)}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    pendingAction ===
                    `approval:${approvalDecisionDraft.approvalId}:${approvalDecisionDraft.status}`
                  }
                  onClick={executeApprovalDecision}
                  className="rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                >
                  Confirm decision
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
