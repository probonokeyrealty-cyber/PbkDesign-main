import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Inbox as InboxIcon,
  Loader2,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { CallFloorPanel } from '../components/CallFloorPanel';
import { CallQualityReviewDialog } from '../components/CallQualityReviewDialog';
import { CompactPager, getPageSlice, OPERATOR_LIST_PAGE_SIZE } from '../components/CompactPager';
import { StatusColorLegend } from '../components/StatusColorLegend';
import { LiveCallWidget } from '../components/shell/LiveCallWidget';
import type { LiveCallState, TranscriptLine } from '../components/shell/LiveCallWidget';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import { PbkDataSource, PbkPanel, PbkPulseDot } from '../../components/pbk/index';
import {
  controlRuntimeCall,
  fetchBridgeConnectionRequest,
  fetchLeadsRequest,
  fetchFounderWorkQueueRequest,
  fetchIntelligenceStreamRequest,
  fetchProductionGapsRequest,
  fetchSystemSourceLabelsRequest,
  fetchWebSearchStatusRequest,
  type FounderWorkQueueItem,
  type IntelligenceStreamItem,
  type BridgeConnectionResponse,
  type PrimaryPathReliabilityReport,
  type ProductionGapLabel,
  updateRuntimeSettingsRequest,
  type RuntimeSnapshot,
  type SystemSourceLabel,
  updateAdminTaskDecision,
  updateApprovalDecision,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';
import {
  getApprovalPreview,
  getApprovalResolutionKeys,
  getPendingApprovals,
} from './inboxRuntimeLogic.js';
import { toOperatorCopy } from '../utils/operatorCopy';

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
  if (
    /^(active|answered|bridged|connected|in[_ -]?progress|live|media|ringing|transferring)$/.test(
      normalized
    )
  )
    return 'connected';
  if (normalized === 'initiated' || normalized === 'dialing' || normalized === 'queued')
    return 'dialing';
  if (normalized === 'hold' || normalized === 'on-hold' || normalized === 'on_hold')
    return 'on-hold';
  if (normalized === 'ended' || normalized === 'completed' || normalized === 'failed')
    return 'ended';
  return 'idle';
}

function isActiveRuntimeCallStatus(status: unknown) {
  return ['connected', 'dialing', 'on-hold'].includes(mapCallStatus(status));
}

function formatRuntimeStatus(status: unknown) {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'provider_missing') return 'Provider key missing';
  if (normalized === 'queued') return 'Queued for worker';
  if (normalized === 'queued_for_approval') return 'Queued for approval';
  if (normalized === 'pending') return 'In progress';
  if (normalized === 'approved') return 'Approved';
  if (normalized === 'rejected') return 'Declined';
  if (normalized === 'needs-revision') return 'Needs Revision';
  if (normalized === 'complete') return 'Complete';
  if (normalized === 'failed') return 'Delivery failed';
  return normalized ? toOperatorCopy(normalized) : 'No data yet';
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

function cleanLiveCallContextValue(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (
    /^#+\s/.test(text) ||
    /\b(you are ava|inbound call mode|bant\+ status|negotiation guidance|core rules|pbk core path library|recent self-learned memories)\b/i.test(
      text
    )
  ) {
    return '';
  }
  return text.replace(/_/g, ' ');
}

function nestedText(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function buildLiveCallCallerContext(call: Record<string, unknown>) {
  const property = nestedText(call, 'property');
  const lead = nestedText(call, 'lead');
  const address = [
    call.address,
    call.propertyAddress,
    call.property_address,
    lead.address,
    property.address,
  ]
    .map(cleanLiveCallContextValue)
    .find(Boolean);
  const status = [call.stage, call.callStage, call.status]
    .map(cleanLiveCallContextValue)
    .find(
      (value) => value && !/^(active|connected|dialing|queued|ended|completed|failed)$/i.test(value)
    );
  return [address, status].filter(Boolean).join(' / ') || undefined;
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
    callId: String(
      call.id || call.callId || call.call_id || call.callControlId || call.call_control_id || ''
    ),
    dealId: call.dealId || call.deal_id ? String(call.dealId || call.deal_id) : null,
    status: mapCallStatus(call.status),
    agentMode:
      String(call.agentMode || call.mode || 'autopilot') === 'human' ? 'human' : 'autopilot',
    caller: {
      name: call.leadName || call.lead_name ? String(call.leadName || call.lead_name) : null,
      phone:
        call.phone || call.recipientPhone || call.recipient_phone
          ? String(call.phone || call.recipientPhone || call.recipient_phone)
          : null,
      context: buildLiveCallCallerContext(call),
    },
    startedAt:
      call.startedAt ||
      call.started_at ||
      call.connectedAt ||
      call.connected_at ||
      call.createdAt ||
      call.created_at
        ? String(
            call.startedAt ||
              call.started_at ||
              call.connectedAt ||
              call.connected_at ||
              call.createdAt ||
              call.created_at
          )
        : null,
    sentiment,
    transcript,
    avaLiveCockpit:
      call.avaLiveCockpit && typeof call.avaLiveCockpit === 'object'
        ? (call.avaLiveCockpit as Record<string, unknown>)
        : call.ava_live_cockpit && typeof call.ava_live_cockpit === 'object'
          ? (call.ava_live_cockpit as Record<string, unknown>)
          : null,
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
  preview: string;
  resolutionKeys: string[];
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
  | 'systemHealth'
  | 'statusLegend'
  | 'tooling'
  | 'activity'
  | 'approvals';

const COMMAND_WIDGET_PREFS_KEY = 'pbk:command-center:widgets';
const COMMAND_WIDGETS: Array<{ id: CommandWidgetId; label: string }> = [
  { id: 'kpis', label: 'Daily numbers' },
  { id: 'liveCall', label: 'Live call' },
  { id: 'callFloor', label: 'Call floor' },
  { id: 'adminActivity', label: 'Team tasks' },
  { id: 'webSearch', label: 'Market context' },
  { id: 'systemHealth', label: 'System health' },
  { id: 'statusLegend', label: 'Status guide' },
  { id: 'tooling', label: 'Ava tools' },
  { id: 'activity', label: 'Activity feed' },
  { id: 'approvals', label: 'Review board' },
];
const DEFAULT_COMMAND_WIDGETS = COMMAND_WIDGETS.reduce(
  (prefs, widget) => ({ ...prefs, [widget.id]: true }),
  {} as Record<CommandWidgetId, boolean>
);
type CommandWidgetPrefs = Record<CommandWidgetId, boolean>;

function normalizeCommandWidgetPrefs(value: unknown): CommandWidgetPrefs | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  let foundWidget = false;
  const next = { ...DEFAULT_COMMAND_WIDGETS };
  for (const widget of COMMAND_WIDGETS) {
    const visible = record[widget.id];
    if (typeof visible === 'boolean') {
      next[widget.id] = visible;
      foundWidget = true;
    }
  }
  return foundWidget ? next : null;
}

function areCommandWidgetPrefsEqual(left: CommandWidgetPrefs, right: CommandWidgetPrefs) {
  return COMMAND_WIDGETS.every((widget) => left[widget.id] === right[widget.id]);
}

function getBridgeCommandWidgetPrefs(snapshot?: RuntimeSnapshot | null) {
  const settings =
    snapshot?.settings && typeof snapshot.settings === 'object' ? snapshot.settings : {};
  const ui =
    settings.ui && typeof settings.ui === 'object' ? (settings.ui as Record<string, unknown>) : {};
  return normalizeCommandWidgetPrefs(ui.commandCenterWidgets);
}

function readCommandWidgetPrefs() {
  if (typeof window === 'undefined') return DEFAULT_COMMAND_WIDGETS;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(COMMAND_WIDGET_PREFS_KEY) || '{}'
    ) as Partial<Record<CommandWidgetId, boolean>> | null;
    return normalizeCommandWidgetPrefs(parsed) || DEFAULT_COMMAND_WIDGETS;
  } catch {
    return DEFAULT_COMMAND_WIDGETS;
  }
}

function writeCommandWidgetPrefs(prefs: CommandWidgetPrefs) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(COMMAND_WIDGET_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // localStorage is a fallback, so private-mode failures should not block bridge writes.
    }
  }
  return prefs;
}

function getCallId(call: Record<string, unknown>) {
  return String(call.id || call.callId || call.call_id || '');
}

const CALL_QUALITY_REVIEWED_KEY = 'pbk:call-quality-reviewed:v1';

function readReviewedCallIds() {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CALL_QUALITY_REVIEWED_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []);
  } catch {
    return new Set<string>();
  }
}

function persistReviewedCallId(callId: string, reviewed: Set<string>) {
  if (!callId || typeof window === 'undefined') return;
  reviewed.add(callId);
  try {
    window.localStorage.setItem(
      CALL_QUALITY_REVIEWED_KEY,
      JSON.stringify(Array.from(reviewed).slice(-100))
    );
  } catch {
    // Review persistence is a convenience and must not block the dashboard.
  }
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
  score: number;
  source: string;
  reason: string;
  cta: string;
  pulse?: 'default' | 'amber' | 'sky' | 'lime';
  targetPath: string;
};

type MissionQuickAction = {
  label: string;
  description: string;
  count: string;
  tone: 'sky' | 'lime' | 'amber';
  targetPath: string;
  icon: typeof AlertCircle;
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

function clampBattlefieldScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rankBattlefieldItems(items: BattlefieldItem[]) {
  return [...items].sort((left, right) => right.score - left.score);
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
      const status = String(call.status || 'Live');
      const sentimentScore =
        sentiment == null ? 0 : Math.round(sentiment <= 1 ? sentiment * 100 : sentiment);
      items.push({
        id: `call-${String(call.id || call.callId || index)}`,
        tag: status,
        body: `${String(call.leadName || call.name || call.phone || 'Active call')} ${
          sentiment == null ? '' : `/ sentiment ${sentimentScore}`
        }`.trim(),
        when: 'now',
        tone: 'urgent',
        score: clampBattlefieldScore(
          ['live', 'connected'].includes(status.toLowerCase()) ? 99 : 92
        ),
        source: 'snapshot.calls',
        reason: 'Active seller call needs operator awareness.',
        cta: 'Open live call',
        pulse: 'default',
        targetPath: '#live-call',
      });
    });

  params.approvals
    .filter((approval) => String(approval.status || '').toLowerCase() === 'pending')
    .slice(0, 4)
    .forEach((approval, index) => {
      const rawType = String(approval.type || 'Approval');
      const type = friendlyRuntimeLabel(rawType, 'Review');
      const amount = approval.offerPrice || approval.mao || approval.amount;
      const isContract = rawType.toLowerCase().includes('contract');
      items.push({
        id: `approval-${String(approval.id || index)}`,
        tag: type,
        body: `${amount ? `${formatCompactMoney(amount)} / ` : ''}${String(
          friendlyRuntimeLabel(approval.leadName || approval.address || 'review item')
        )}`,
        when: formatRelative(getRuntimeDate(approval)),
        tone: isContract ? 'money' : 'hot',
        score: clampBattlefieldScore((isContract ? 91 : 84) + (toNumber(amount, 0) ? 4 : 0)),
        source: 'snapshot.approvals',
        reason: isContract
          ? 'Review this before Ava sends the DocuSign packet.'
          : 'Ava needs a quick yes or no before this step continues.',
        cta: 'Review approval',
        pulse: isContract ? 'lime' : undefined,
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
        score: 94,
        source: 'snapshot.messages',
        reason: 'Provider marked an outbound send as failed.',
        cta: 'Open inbox',
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
        score: 72,
        source: 'snapshot.messages',
        reason: 'Unread seller reply is ready in Inbox.',
        cta: 'Reply',
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
        tag: 'Workspace task',
        body: `${friendlyRuntimeLabel(task.provider || 'Ava')} / ${friendlyRuntimeLabel(
          task.action || task.summary || 'decision'
        )}`,
        when: formatRelative(getRuntimeDate(task)),
        tone: 'hot',
        score: 86,
        source: 'snapshot.adminTasks',
        reason: 'A workspace task needs a quick yes or no.',
        cta: 'Review workspace task',
        targetPath: '#admin-activity',
      });
    });

  params.leadImports
    .filter((lead) => getLeadScore(lead) >= 75)
    .slice(0, 2)
    .forEach((lead, index) => {
      const score = clampBattlefieldScore(getLeadScore(lead));
      items.push({
        id: `lead-${String(lead.id || lead.leadId || index)}`,
        tag: 'Hot lead',
        body: `${getLeadDisplayName(lead)} / ${getLeadDisplayAddress(lead)}`,
        when: `${score}`,
        tone: 'money',
        score,
        source: 'snapshot.leadImports',
        reason: 'Lead score crossed the hot-lead threshold.',
        cta: 'Open lead',
        targetPath: '/leads',
      });
    });

  return rankBattlefieldItems(items).slice(0, OPERATOR_LIST_PAGE_SIZE);
}

function normalizeBridgeBattlefieldItem(
  item: FounderWorkQueueItem,
  index: number
): BattlefieldItem {
  const tone = ['urgent', 'hot', 'warm', 'money'].includes(String(item.tone))
    ? (item.tone as BattlefieldTone)
    : 'warm';
  const pulse = ['default', 'amber', 'sky', 'lime'].includes(String(item.pulse))
    ? (item.pulse as BattlefieldItem['pulse'])
    : undefined;
  return {
    id: String(item.id || `bridge-work-${index}`),
    tag: friendlyRuntimeLabel(item.tag || 'Work item', 'Work item'),
    body: friendlyRuntimeLabel(item.body || 'Recommended next step', 'Recommended next step'),
    when: String(item.when || 'now'),
    tone,
    score: clampBattlefieldScore(toNumber(item.score, 0) || 0),
    source: String(item.source || 'GET /api/founder/work-queue'),
    reason: friendlyBattlefieldReason(item.reason),
    cta: String(item.cta || 'Open'),
    pulse,
    targetPath: String(item.targetPath || '/'),
  };
}

function friendlyBattlefieldReason(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return 'Ava recommends reviewing this next.';
  return text
    .replace(
      /outbound agent action is waiting on approval/gi,
      'Ava has a seller follow-up ready for review'
    )
    .replace(
      /outbound agent action is ready for review/gi,
      'Ava has a seller follow-up ready for review'
    )
    .replace(
      /infrastructure\/admin action is approval gated/gi,
      'Workspace setup needs your review'
    )
    .replace(
      /infrastructure\/workspace task is approval gated/gi,
      'Workspace setup needs your review'
    )
    .replace(/approval gated/gi, 'ready for review')
    .replace(/waiting on approval/gi, 'ready for review')
    .replace(/operator attention/gi, 'your review')
    .replace(/admin action/gi, 'workspace task')
    .replace(/provider action/gi, 'workspace action');
}

function friendlyBattlefieldSource(value: unknown) {
  const source = String(value || '')
    .trim()
    .toLowerCase();
  if (!source) return 'Workspace';
  if (source.includes('approval')) return 'Approval board';
  if (source.includes('admin')) return 'Workspace tasks';
  if (source.includes('message') || source.includes('inbox')) return 'Inbox';
  if (source.includes('lead')) return 'Leads';
  if (source.includes('call')) return 'Call floor';
  if (source.includes('work-queue') || source.includes('founder')) return 'Next steps';
  if (source.includes('state')) return 'Workspace';
  return friendlyRuntimeLabel(value, 'Workspace');
}

function normalizeIntelligenceStreamItem(
  item: IntelligenceStreamItem,
  index: number
): RuntimeRecord {
  return {
    id: item.id || `intelligence-${index}`,
    actor: item.actor || item.title || 'PBK Agent',
    text: friendlyRuntimeText(item.text || item.title || 'Agent intelligence event'),
    category: item.category || item.kind || 'INTELLIGENCE',
    source: item.source || 'GET /api/intelligence/stream',
    status: item.status || '',
    at: item.at || item.createdAt || '',
    createdAt: item.createdAt || item.at || '',
    confidence: item.confidence,
    leadId: item.leadId,
    callId: item.callId,
    metadata: item.metadata || {},
  };
}

function normalizeSystemSourceLabel(item: SystemSourceLabel, index: number): SystemSourceLabel {
  const normalizedStatus = String(item.status || 'fallback').toLowerCase();
  return {
    id: item.id || `source-${index}`,
    label: item.label || item.endpoint || 'Runtime source',
    endpoint: item.endpoint || 'unknown',
    category: item.category || 'runtime',
    status: item.status || 'fallback',
    readiness:
      item.readiness ||
      (normalizedStatus === 'offline' || normalizedStatus === 'needs-wiring'
        ? 'unavailable'
        : 'ready'),
    source: item.source || 'bridge',
    dataState: item.dataState || 'unknown',
    stalenessMs:
      typeof item.stalenessMs === 'number' && Number.isFinite(item.stalenessMs)
        ? Math.max(0, item.stalenessMs)
        : null,
    lastCheckedAt: item.lastCheckedAt || '',
    lastDataAt: item.lastDataAt || item.lastUpdatedAt || '',
    lastUpdatedAt: item.lastUpdatedAt || '',
    fallbackReason: item.fallbackReason || '',
    degradedReason: item.degradedReason || '',
    recordCount: Number.isFinite(Number(item.recordCount)) ? Number(item.recordCount) : 0,
    note: item.note || '',
  };
}

function buildFallbackSourceLabels({
  loading,
  error,
  leadCount,
  activityCount,
  battlefieldSource,
  intelligenceStreamSource,
}: {
  loading: boolean;
  error: string;
  leadCount: number;
  activityCount: number;
  battlefieldSource: string;
  intelligenceStreamSource: string;
}): SystemSourceLabel[] {
  const runtimeStatus = loading ? 'fallback' : error ? 'offline' : 'live';
  const fallbackReason = error || '';
  return [
    {
      id: 'runtime-snapshot-fallback',
      label: 'Runtime snapshot',
      endpoint: 'GET /state',
      category: 'runtime',
      status: runtimeStatus,
      source: 'client runtime snapshot',
      readiness: error ? 'unavailable' : loading ? 'degraded' : 'ready',
      dataState: leadCount ? 'unknown' : 'empty',
      lastCheckedAt: new Date().toISOString(),
      recordCount: leadCount,
      fallbackReason,
      note: 'Client fallback used until /api/system/source-labels responds.',
    },
    {
      id: 'founder-work-queue-fallback',
      label: 'Founder work queue',
      endpoint: 'GET /api/founder/work-queue',
      category: 'operator',
      status: battlefieldSource.startsWith('fallback') ? 'fallback' : 'live',
      source: battlefieldSource,
      readiness: battlefieldSource.startsWith('fallback') ? 'degraded' : 'ready',
      dataState: activityCount ? 'unknown' : 'empty',
      lastCheckedAt: new Date().toISOString(),
      recordCount: activityCount,
      fallbackReason: battlefieldSource.startsWith('fallback') ? battlefieldSource : '',
      note: 'Falls back to client-ranked snapshot work.',
    },
    {
      id: 'intelligence-stream-fallback',
      label: 'Ava/Rex intelligence',
      endpoint: 'GET /api/intelligence/stream',
      category: 'agent',
      status: intelligenceStreamSource.startsWith('fallback') ? 'fallback' : 'live',
      source: intelligenceStreamSource,
      readiness: intelligenceStreamSource.startsWith('fallback') ? 'degraded' : 'ready',
      dataState: activityCount ? 'unknown' : 'empty',
      lastCheckedAt: new Date().toISOString(),
      recordCount: activityCount,
      fallbackReason: intelligenceStreamSource.startsWith('fallback')
        ? intelligenceStreamSource
        : '',
      note: 'Falls back to snapshot.activity when protected bridge calls are unavailable.',
    },
  ];
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
  return (
    <details className="pbk-tech-details">
      <summary>Technical details</summary>
      <PbkDataSource endpoint={endpoint} status={status} note={friendlyRuntimeText(note)} />
    </details>
  );
}

const OPERATOR_COPY_TOKENS = [
  'bridge_healthy',
  'bridge-healthy',
  'render_postgres_ready',
  'render-postgres-ready',
  'retry_gated',
  'retry-gated',
  'primary_path_gated',
  'primary-path-gated',
  'provider_policy',
  'provider-policy',
  'blocking',
  'approval_required',
  'approval-required',
  'dispatching',
  'reconciliation_required',
  'reconciliation-required',
  'delivered',
  'failed',
];

function replaceOperatorCopyTokens(value: string) {
  return OPERATOR_COPY_TOKENS.reduce(
    (text, token) =>
      text.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), () =>
        toOperatorCopy(token)
      ),
    value
  );
}

function friendlyRuntimeLabel(value: unknown, fallback = 'Ready') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const known: Record<string, string> = {
    primary_path_attempts_allowed: 'Ready for first try',
    primary_path_gated: toOperatorCopy('primary_path_gated'),
    primary_path_report_unavailable: 'Readiness check unavailable',
    blocked_until_ready: 'Needs setup first',
    bridge_healthy: toOperatorCopy('bridge_healthy'),
    render_postgres_ready: toOperatorCopy('render_postgres_ready'),
    retry_gated: toOperatorCopy('retry_gated'),
    provider_policy: toOperatorCopy('provider_policy'),
    blocking: toOperatorCopy('blocking'),
    approval_required: toOperatorCopy('approval_required'),
    dispatching: toOperatorCopy('dispatching'),
    reconciliation_required: toOperatorCopy('reconciliation_required'),
    delivered: toOperatorCopy('delivered'),
    failed: toOperatorCopy('failed'),
    retry_then_label_fallback: 'Retry, then mark for review',
    no_fallback_hide_blocker: 'Needs setup before use',
    admin: 'Workspace setup',
    'lead-nurture': 'Lead nurture',
    lead_nurture: 'Lead nurture',
    'rex-decision': 'Rex decision',
    rex_decision: 'Rex decision',
    tavily: 'Web research',
    'tavily-live': 'Live web research',
    tavily_live: 'Live web research',
    'tavily live': 'Live web research',
    'pbk-web-search-spikes': 'Web research signals',
    pbk_web_search_spikes: 'Web research signals',
    'fallback-active': 'Backup path active',
    fallback_active: 'Backup path active',
    'fallback active': 'Backup path active',
  };
  const normalized = raw.toLowerCase();
  if (known[normalized]) return known[normalized];
  return toOperatorCopy(raw);
}

function friendlyRuntimeText(value: unknown, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (
    [
      'tavily',
      'tavily-live',
      'tavily_live',
      'tavily live',
      'pbk-web-search-spikes',
      'pbk_web_search_spikes',
      'fallback-active',
      'fallback_active',
      'fallback active',
    ].includes(normalized)
  ) {
    return friendlyRuntimeLabel(raw, fallback);
  }
  return replaceOperatorCopyTokens(raw)
    .replace(/\bprimary path gated\b/gi, toOperatorCopy('primary_path_gated'))
    .replace(/\bretry gated\b/gi, toOperatorCopy('retry_gated'))
    .replace(/\bprovider policy\b/gi, toOperatorCopy('provider_policy'))
    .replace(/\bapproval required\b/gi, toOperatorCopy('approval_required'))
    .replace(/\breconciliation required\b/gi, toOperatorCopy('reconciliation_required'))
    .replace(/\brender postgres ready\b/gi, toOperatorCopy('render_postgres_ready'))
    .replace(/\bbridge healthy\b/gi, toOperatorCopy('bridge_healthy'))
    .replace(/\bTavily live search\b/gi, 'live web research')
    .replace(/\bTavily live\b/gi, 'live web research')
    .replace(/\bTavily\b/gi, 'web research')
    .replace(/\bpbk-web-search-spikes\b/gi, 'web research signals')
    .replace(/\bFallback active\b/gi, 'Backup path active');
}

type OperatorSystemSourceLabel = Omit<SystemSourceLabel, 'status' | 'readiness' | 'dataState'> & {
  status?: string;
  readiness?: string;
  dataState?: string;
};

function SourceConfidenceRail({
  items,
  source,
}: {
  items: OperatorSystemSourceLabel[];
  source: string;
}) {
  const visibleItems = items.slice(0, OPERATOR_LIST_PAGE_SIZE);
  const statusTone = (status?: string) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'live') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100';
    if (normalized === 'fallback') return 'border-sky-400/25 bg-sky-500/10 text-sky-100';
    if (normalized === 'stale') return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
    return 'border-rose-400/30 bg-rose-500/10 text-rose-100';
  };
  const relativeLabel = (value?: string, prefix = 'Checked') => {
    const parsed = Date.parse(value || '');
    if (!Number.isFinite(parsed)) return `${prefix} time unavailable`;
    const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
    if (minutes < 1) return `${prefix} just now`;
    if (minutes < 60) return `${prefix} ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${prefix} ${hours}h ago`;
    return `${prefix} ${Math.floor(hours / 24)}d ago`;
  };
  const activityLabel = (item: OperatorSystemSourceLabel) => {
    if (item.dataState === 'empty') return 'No records yet';
    if (item.stalenessMs == null) return 'Activity time unavailable';
    const minutes = Math.floor(item.stalenessMs / 60_000);
    if (minutes < 1) return 'Activity just now';
    if (minutes < 60) return `Activity ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Activity ${hours}h ago`;
    return `Activity ${Math.floor(hours / 24)}d ago`;
  };

  return (
    <PbkPanel className="pbk-command-source-rail space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="pbk-eyebrow">Source check</div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Connected sources</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Endpoint health and data activity are checked separately, so a quiet source does not
            look like a broken connection.
          </p>
        </div>
        <DataSourceCaption endpoint="GET /api/system/source-labels" note={source} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {visibleItems.map((item) => {
          const detail = friendlyRuntimeText(
            item.fallbackReason || item.degradedReason || activityLabel(item)
          );
          const tone =
            item.readiness === 'needs_attention' && String(item.status).toLowerCase() === 'live'
              ? 'stale'
              : item.status;
          const statusLabel = friendlyRuntimeLabel(item.status || 'checking', 'Checking');
          const readinessLabel =
            item.readiness === 'needs_attention'
              ? ` / ${friendlyRuntimeLabel('blocking', 'Needs attention')}`
              : '';
          return (
            <div
              key={item.id}
              className={`min-w-0 rounded-lg border p-2.5 ${statusTone(tone)}`}
              title={[item.endpoint, item.fallbackReason, item.degradedReason, item.note]
                .filter(Boolean)
                .join(' - ')}
            >
              <div className="flex items-center justify-between gap-2 text-[10px] uppercase opacity-75">
                <span className="truncate font-semibold">
                  {statusLabel}
                  {readinessLabel}
                </span>
                <span className="truncate">
                  {friendlyRuntimeLabel(item.dataState || 'unknown', 'Checking')}
                </span>
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-current">{item.label}</div>
              <div className="mt-1 truncate text-[11px] opacity-75">
                {item.source || 'bridge'} ·{' '}
                <time dateTime={item.lastCheckedAt || undefined}>
                  {relativeLabel(item.lastCheckedAt, 'checked').replace(/^checked /, '')}
                </time>
              </div>
              <div className="mt-0.5 line-clamp-2 text-[11px] opacity-85">{detail}</div>
            </div>
          );
        })}
      </div>
    </PbkPanel>
  );
}

type OperatorHealthState = 'ready' | 'needs_attention' | 'checking';

type OperatorHealthItem = {
  id: string;
  label: string;
  state: OperatorHealthState;
  copy: string;
};

function pickHealthValue(source: RuntimeRecord, keys: string[]) {
  for (const key of keys) {
    if (Object.hasOwn(source, key)) return source[key];
  }
  return undefined;
}

function pickSourceLabelHealthValue(
  items: OperatorSystemSourceLabel[],
  matchers: string[],
  readyNote: string,
  checkingNote: string
) {
  const matches = items.filter((item) => {
    const text =
      `${item.id} ${item.label} ${item.endpoint} ${item.source} ${item.note}`.toLowerCase();
    return matchers.some((matcher) => text.includes(matcher));
  });
  if (!matches.length) return { state: 'checking', note: checkingNote };

  if (
    matches.some(
      (item) =>
        /offline|unavailable|needs attention|needs_attention|error|failed|missing|degraded/i.test(
          `${item.status} ${item.readiness} ${item.fallbackReason} ${item.degradedReason} ${item.note}`
        ) ||
        /needs[-_\s]?wiring/i.test(
          `${item.status} ${item.readiness} ${item.fallbackReason} ${item.degradedReason} ${item.note}`
        )
    )
  ) {
    return { state: 'needs_attention', note: `${readyNote} needs attention.` };
  }

  if (
    matches.some((item) =>
      /live|ready|connected/i.test(`${item.status} ${item.readiness} ${item.dataState}`)
    )
  ) {
    return { state: 'ready', note: readyNote };
  }

  return { state: 'checking', note: checkingNote };
}

function getOperatorHealthState(value: unknown): OperatorHealthState {
  if (value === true) return 'ready';
  if (value === false) return 'needs_attention';
  if (!value || typeof value !== 'object') return 'checking';
  const record = value as RuntimeRecord;
  const raw = String(
    record.operatorState ||
      record.healthState ||
      record.state ||
      record.status ||
      record.result ||
      ''
  ).toLowerCase();
  if (
    record.warning ||
    record.error ||
    record.lastError ||
    record.blocking ||
    raw.includes('warning') ||
    raw.includes('fail') ||
    raw.includes('error') ||
    raw.includes('missing') ||
    raw.includes('unavailable') ||
    raw.includes('needs_attention')
  ) {
    return 'needs_attention';
  }
  if (
    record.ready === true ||
    record.connected === true ||
    record.healthy === true ||
    record.liveReady === true ||
    record.trained === true ||
    raw.includes('ready') ||
    raw.includes('connected') ||
    raw.includes('healthy') ||
    raw.includes('initialized') ||
    raw.includes('render_postgres_ready')
  ) {
    return 'ready';
  }
  if (
    record.ready === false ||
    record.connected === false ||
    record.healthy === false ||
    record.trained === false ||
    raw.includes('blocked') ||
    raw.includes('gated')
  ) {
    return 'needs_attention';
  }
  return 'checking';
}

function getOperatorHealthStateLabel(state: OperatorHealthState) {
  if (state === 'ready') return 'Ready';
  if (state === 'needs_attention') return toOperatorCopy('blocking');
  return 'Checking';
}

function buildOperatorHealthItem(
  id: string,
  label: string,
  value: unknown,
  copy: Record<OperatorHealthState, string>
): OperatorHealthItem {
  const state = getOperatorHealthState(value);
  const record = value && typeof value === 'object' ? (value as RuntimeRecord) : {};
  const detail = friendlyRuntimeText(
    record.copy || record.operatorCopy || record.message || record.note
  );
  return {
    id,
    label,
    state,
    copy: `${getOperatorHealthStateLabel(state)}: ${detail || copy[state]}`,
  };
}

function buildCommandCenterHealthInput({
  snapshot,
  tooling,
  runtimeProviders,
  bridgeConnection,
  toolingCoreReady,
  toolingCoreTotal,
  sourceConfidenceItems,
  loading,
  error,
}: {
  snapshot?: RuntimeSnapshot | null;
  tooling?: RuntimeRecord | null;
  runtimeProviders: Record<string, RuntimeRecord>;
  bridgeConnection?: BridgeConnectionResponse | null;
  toolingCoreReady: number;
  toolingCoreTotal: number;
  sourceConfidenceItems: OperatorSystemSourceLabel[];
  loading: boolean;
  error: string;
}) {
  const status = (snapshot?.status || {}) as RuntimeRecord;
  const providerValues = runtimeProviders as RuntimeRecord;
  const toolingValues = (tooling || {}) as RuntimeRecord;
  const bridgeConnectionRecord =
    bridgeConnection && typeof bridgeConnection === 'object' ? bridgeConnection : null;
  const bridgeConnectionComponents = (bridgeConnectionRecord?.components || {}) as RuntimeRecord;
  const bridgeConnectionProof = bridgeConnectionRecord
    ? bridgeConnectionRecord.ready
      ? {
          ready: true,
          note: 'Live command bridge connection proof is ready.',
        }
      : {
          ready: false,
          note: bridgeConnectionRecord.blockers?.length
            ? `Live command bridge needs attention: ${bridgeConnectionRecord.blockers.join(', ')}.`
            : 'Live command bridge connection proof needs attention.',
        }
    : undefined;
  const docusignProvider = pickHealthValue(providerValues, ['docusign', 'docuSign', 'docs']);
  const documentDeliveries = Array.isArray(snapshot?.documentDeliveries)
    ? snapshot.documentDeliveries
    : [];
  const docusignWarning =
    docusignProvider ||
    documentDeliveries.find((delivery) =>
      /warning|fail|error|missing/i.test(
        String(delivery.status || delivery.result || delivery.error || '')
      )
    );

  return {
    render:
      pickHealthValue(providerValues, ['render', 'renderBridge']) ??
      pickHealthValue(status, ['render', 'renderBridge']) ??
      pickHealthValue(toolingValues, ['render', 'renderBridge']) ??
      (error
        ? { error }
        : pickSourceLabelHealthValue(
            sourceConfidenceItems,
            ['render'],
            'Hosted bridge is reachable.',
            loading ? 'Checking the hosted bridge.' : 'Hosted bridge detail is still being checked.'
          )),
    openclaw:
      pickHealthValue(providerValues, [
        'openclaw',
        'openClaw',
        'openclawGateway',
        'openClawGateway',
        'bridge',
      ]) ??
      pickHealthValue(status, [
        'openclaw',
        'openClaw',
        'openclawGateway',
        'openClawGateway',
        'bridge',
      ]) ??
      pickHealthValue(toolingValues, [
        'openclaw',
        'openClaw',
        'openclawGateway',
        'openClawGateway',
        'bridge',
      ]) ??
      pickHealthValue(bridgeConnectionComponents, ['bridge']) ??
      bridgeConnectionProof ??
      (error
        ? {
            error,
            note: 'Sign in or refresh the team session so protected bridge details can load.',
          }
        : { state: 'checking', note: 'Live command bridge detail is still being checked.' }),
    redis: pickHealthValue(providerValues, ['redis']) ??
      pickHealthValue(status, ['redis']) ?? {
        state: 'checking',
        note: 'Live queue detail is not reported yet.',
      },
    postgres:
      pickHealthValue(providerValues, ['postgres', 'database', 'renderPostgres']) ??
      pickSourceLabelHealthValue(
        sourceConfidenceItems,
        ['postgres', 'database'],
        toOperatorCopy('render_postgres_ready'),
        'Saved data detail is still being checked.'
      ),
    netlify:
      pickHealthValue(providerValues, ['netlify', 'frontend']) ??
      pickHealthValue(status, ['netlify', 'frontend']) ??
      pickHealthValue(toolingValues, ['netlify', 'frontend']) ??
      pickSourceLabelHealthValue(
        sourceConfidenceItems,
        ['netlify', 'frontend'],
        'Agent dashboard is available.',
        loading ? 'Checking the agent dashboard.' : 'Agent dashboard detail is still being checked.'
      ),
    slack: pickHealthValue(providerValues, ['slack']) ??
      pickHealthValue(toolingValues, ['slack']) ?? {
        state: 'checking',
        note: 'Team alert connection is not reported yet.',
      },
    docusign: docusignWarning || {
      state: 'checking',
      note: 'Contract sending detail is not reported yet.',
    },
    sms: pickHealthValue(providerValues, ['sms', 'telnyx']) ?? {
      state: 'checking',
      note: 'Text messaging detail is not reported yet.',
    },
    email: pickHealthValue(providerValues, ['email', 'instantly']) ?? {
      state: 'checking',
      note: 'Email sending detail is not reported yet.',
    },
    avaLearning:
      pickHealthValue(toolingValues, ['pipelineMemory']) ??
      (Array.isArray(snapshot?.callQaScores) && snapshot.callQaScores.length
        ? { trained: true, note: 'Recent call reviews are saved.' }
        : toolingCoreReady && toolingCoreTotal && toolingCoreReady >= toolingCoreTotal
          ? { state: 'checking', note: 'Learning detail is not reported separately yet.' }
          : { trained: false, note: 'Ava learning needs setup detail.' }),
  };
}

function buildCommandCenterHealthSummary(input: RuntimeRecord): OperatorHealthItem[] {
  return [
    buildOperatorHealthItem('render', 'Render', input.render, {
      ready: 'Hosted bridge is reachable.',
      needs_attention: 'Hosted bridge needs a connection check.',
      checking: 'Checking the hosted bridge.',
    }),
    buildOperatorHealthItem('openclaw', 'OpenClaw', input.openclaw, {
      ready: 'Local command bridge is connected.',
      needs_attention: 'Local command bridge needs setup.',
      checking: 'Checking the local command bridge.',
    }),
    buildOperatorHealthItem('redis', 'Redis', input.redis, {
      ready: 'Fast queue and cache are ready.',
      needs_attention: 'Queue or cache needs attention.',
      checking: 'Checking queue and cache.',
    }),
    buildOperatorHealthItem('postgres', 'Postgres', input.postgres, {
      ready: 'Lead and workflow data are saved.',
      needs_attention: 'Saved workspace data needs attention.',
      checking: 'Checking saved workspace data.',
    }),
    buildOperatorHealthItem('netlify', 'Netlify', input.netlify, {
      ready: 'Agent dashboard is available.',
      needs_attention: 'Agent dashboard deploy needs attention.',
      checking: 'Checking the agent dashboard.',
    }),
    buildOperatorHealthItem('slack', 'Slack', input.slack, {
      ready: 'Team alerts can be sent.',
      needs_attention: 'Team alerts need setup.',
      checking: 'Checking team alerts.',
    }),
    buildOperatorHealthItem('docusign', 'DocuSign', input.docusign, {
      ready: 'Contracts can be prepared for signature.',
      needs_attention: 'Contracts need a DocuSign check before sending.',
      checking: 'Checking contract sending.',
    }),
    buildOperatorHealthItem('sms', 'SMS', input.sms, {
      ready: 'Text messages can be sent.',
      needs_attention: 'Text messaging needs setup.',
      checking: 'Checking text messaging.',
    }),
    buildOperatorHealthItem('email', 'Email', input.email, {
      ready: 'Emails can be sent.',
      needs_attention: 'Email sending needs setup.',
      checking: 'Checking email sending.',
    }),
    buildOperatorHealthItem('avaLearning', 'Ava learning', input.avaLearning, {
      ready: 'Ava is saving lessons from calls.',
      needs_attention: 'Ava learning needs attention.',
      checking: 'Checking Ava learning.',
    }),
  ];
}

function SystemHealthPanel({ items, source }: { items: OperatorHealthItem[]; source?: string }) {
  const counts = items.reduce(
    (total, item) => ({ ...total, [item.state]: total[item.state] + 1 }),
    { ready: 0, needs_attention: 0, checking: 0 } as Record<OperatorHealthState, number>
  );
  const stateClass = (state: OperatorHealthState) => {
    if (state === 'ready') return 'bg-emerald-500/10 text-emerald-300';
    if (state === 'needs_attention') return 'bg-amber-500/10 text-amber-300';
    return 'bg-slate-800 text-slate-400';
  };

  return (
    <PbkPanel className="pbk-priority-low p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="pbk-eyebrow">System health</div>
          <h2 className="text-sm font-semibold text-slate-100">What Ava can use right now</h2>
          <p className="mt-1 text-xs text-slate-500">
            Plain-English checks for calls, contracts, messages, saved data, and team alerts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em]">
          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">
            {counts.ready} ready
          </span>
          <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-300">
            {counts.needs_attention} need attention
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-400">
            {counts.checking} checking
          </span>
        </div>
      </div>
      <div className="mt-3 divide-y divide-slate-800">
        {items.map((item) => (
          <div key={item.id} className="grid gap-2 py-2.5 sm:grid-cols-[140px_120px_1fr]">
            <div className="text-xs font-semibold text-slate-100">{item.label}</div>
            <div>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${stateClass(
                  item.state
                )}`}
              >
                {getOperatorHealthStateLabel(item.state)}
              </span>
            </div>
            <div className="text-xs text-slate-400">{item.copy}</div>
          </div>
        ))}
      </div>
      <DataSourceCaption
        endpoint="snapshot.status.providers + GET /api/bridge/connection + GET /api/tooling/status + GET /api/system/source-labels"
        note={`Health rows use checking when live provider detail is missing. ${source || ''}`.trim()}
      />
    </PbkPanel>
  );
}

function ProductionGapsRail({
  gaps,
  source,
  loading,
  primaryPath,
}: {
  gaps: ProductionGapLabel[];
  source: string;
  loading: boolean;
  primaryPath?: PrimaryPathReliabilityReport | null;
}) {
  const visibleGaps = gaps.slice(0, 4);
  const visiblePrimaryControls = (primaryPath?.controls || []).slice(0, 3);
  const hiddenGapsCount = Math.max(0, gaps.length - visibleGaps.length);
  const hiddenControlCount = Math.max(
    0,
    (primaryPath?.controls || []).length - visiblePrimaryControls.length
  );
  const blockingCount = gaps.filter((gap) => gap.blocking).length;
  const optionalCount = gaps.filter((gap) => gap.optional).length;
  const primaryAllowed = primaryPath?.summary?.primaryAllowed !== false;
  const severityTone = (severity?: string) => {
    if (severity === 'critical' || severity === 'high') {
      return 'border-rose-400/30 bg-rose-500/10 text-rose-100';
    }
    if (severity === 'medium') return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
    if (severity === 'low') return 'border-sky-400/25 bg-sky-500/10 text-sky-100';
    return 'border-slate-700 bg-slate-900 text-slate-300';
  };

  return (
    <PbkPanel className="pbk-command-production-gaps">
      <div className="pbk-production-gaps-head">
        <div className="min-w-0">
          <div className="pbk-eyebrow">Workspace readiness</div>
          <h2>A few setup items may need attention</h2>
        </div>
        <div className="pbk-production-gaps-chips" aria-label="Workspace readiness summary">
          <span className="pbk-production-chip neutral">{gaps.length} checks</span>
          <span className={`pbk-production-chip ${blockingCount ? 'danger' : 'good'}`.trim()}>
            {blockingCount} needs attention
          </span>
          <span className="pbk-production-chip info">{optionalCount} optional</span>
          <span className={`pbk-production-chip ${primaryAllowed ? 'good' : 'danger'}`.trim()}>
            Main workflow {primaryAllowed ? 'ready' : 'needs review'}
          </span>
          {primaryPath?.summary && (
            <span className="pbk-production-chip warn">
              {primaryPath.summary.retryBeforeFallback || 0} retry protected
            </span>
          )}
        </div>
        <DataSourceCaption endpoint="GET /api/production/gaps" note={source} />
      </div>
      {primaryPath?.summary && (
        <div className="pbk-production-speed-strip">
          <span>
            <small>First try</small>
            <strong className={primaryAllowed ? 'text-emerald-200' : 'text-rose-200'}>
              {friendlyRuntimeLabel(
                primaryPath.result ||
                  (primaryAllowed ? 'primary_path_attempts_allowed' : 'primary_path_gated')
              )}
            </strong>
            <em>fallback goal {primaryPath.fallbackSloTargetPercent ?? 0.1}%</em>
          </span>
          <span>
            <small>Watch items</small>
            <strong>
              {primaryPath.summary.blocking || 0} needs review /{' '}
              {primaryPath.summary.disabledOptional || 0} optional paused
            </strong>
            <em>{primaryPath.summary.timeoutEventsRequired || 0} slow events before fallback</em>
          </span>
          <span>
            <small>Provider setup</small>
            <strong>{primaryPath.summary.providerPolicies || 0} providers checked</strong>
            <em>check / wait / retry / label</em>
          </span>
        </div>
      )}
      {visiblePrimaryControls.length > 0 && (
        <details className="pbk-production-compact-details">
          <summary>
            <span>Workflow safeguards</span>
            <small>
              {visiblePrimaryControls.length}
              {hiddenControlCount ? ` + ${hiddenControlCount}` : ''} tracked
            </small>
          </summary>
          <div className="pbk-production-compact-list" aria-label="Primary path controls">
            {visiblePrimaryControls.map((control) => (
              <div
                key={control.id}
                className={[
                  'pbk-production-compact-row',
                  control.blocking ? 'danger' : control.optional ? 'info' : 'warn',
                ].join(' ')}
                title={[control.reason, control.operatorAction].filter(Boolean).join(' - ')}
              >
                <span className="pbk-production-row-status">
                  {control.retryBeforeFallback || 0} retry
                </span>
                <div className="min-w-0">
                  <strong>{control.label}</strong>
                  <small>
                    {friendlyRuntimeLabel(control.fallbackPolicy || 'retry_then_label_fallback')} /{' '}
                    {control.timeoutMs || 5000}ms
                  </small>
                  <em>
                    {friendlyRuntimeText(
                      control.reason ||
                        friendlyRuntimeLabel(control.primaryAttempt, 'Workflow check ready.')
                    )}
                  </em>
                </div>
              </div>
            ))}
            {hiddenControlCount > 0 && (
              <div className="pbk-production-more-row">
                +{hiddenControlCount} more controls tracked
              </div>
            )}
          </div>
        </details>
      )}
      {loading ? (
        <div className="pbk-production-empty-row">Checking production controls...</div>
      ) : visibleGaps.length ? (
        <details className="pbk-production-compact-details">
          <summary>
            <span>Setup notes</span>
            <small>
              {visibleGaps.length}
              {hiddenGapsCount ? ` + ${hiddenGapsCount}` : ''} labeled
            </small>
          </summary>
          <div className="pbk-production-compact-list" aria-label="Workspace setup notes">
            {visibleGaps.map((gap) => (
              <div
                key={gap.id}
                className={`pbk-production-compact-row ${severityTone(gap.severity)}`}
                title={[gap.endpoint, gap.detail, gap.operatorAction].filter(Boolean).join(' - ')}
              >
                <span className="pbk-production-row-status">
                  {friendlyRuntimeLabel(gap.optional ? 'optional' : gap.severity || 'required')}
                </span>
                <div className="min-w-0">
                  <strong>{gap.label}</strong>
                  <small>
                    {friendlyRuntimeLabel(gap.category || 'workspace')} /{' '}
                    {friendlyRuntimeLabel(gap.status || 'not live')}
                  </small>
                  <em>
                    {friendlyRuntimeText(gap.operatorAction || gap.detail || 'No detail reported.')}
                  </em>
                </div>
              </div>
            ))}
            {hiddenGapsCount > 0 && (
              <div className="pbk-production-more-row">+{hiddenGapsCount} more gaps tracked</div>
            )}
          </div>
        </details>
      ) : (
        <div className="pbk-production-empty-row ready">Workspace checks are clear.</div>
      )}
    </PbkPanel>
  );
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
  sourceLabel,
  sourceNote,
  onSelect,
}: {
  items: BattlefieldItem[];
  loading: boolean;
  error: string;
  agentsReady: number;
  agentsTotal: number;
  mode: string;
  sourceLabel: string;
  sourceNote: string;
  onSelect: (item: BattlefieldItem) => void;
}) {
  const urgentCount = items.filter((item) => item.tone === 'urgent' || item.tone === 'hot').length;
  const approvalCount = items.filter((item) => /approval|contract/i.test(item.tag)).length;
  const failedCount = items.filter((item) => /failed/i.test(item.tag)).length;
  const sub =
    items.length > 0
      ? `${approvalCount} review items / ${failedCount} follow-ups need retry / ${urgentCount} high priority`
      : loading
        ? 'updating your workspace'
        : 'no urgent work right now';
  const bridgeTone = loading ? 'amber' : error ? 'crimson' : 'lime';
  const bridgeLabel = loading
    ? toOperatorCopy('dispatching')
    : error
      ? toOperatorCopy('blocking')
      : toOperatorCopy('bridge_healthy');

  return (
    <section className="space-y-2" aria-labelledby="battlefield-title">
      <div className="pbk-battlefield">
        <div className="pbk-battlefield-left">
          <div id="battlefield-title" className="pbk-battlefield-label">
            Next best steps
          </div>
          <div className="pbk-battlefield-count">
            <em>{items.length}</em> ready to review
          </div>
          <div className="pbk-battlefield-sub">{sub}</div>
        </div>
        <div className="pbk-battlefield-center" aria-label="Ranked work queue">
          {items.length ? (
            items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`pbk-bf-chip ${item.tone}`}
                title={`${item.tag}: ${item.body} / ${item.reason}`}
                aria-label={`Rank ${index + 1}, score ${item.score}, ${item.tag}: ${item.body}. ${item.reason}`}
                onClick={() => onSelect(item)}
              >
                <span className="pbk-bf-rank">#{index + 1}</span>
                <span className="pbk-bf-chip-main">
                  <span className="pbk-bf-chip-line">
                    {item.pulse && <PbkPulseDot color={item.pulse} />}
                    <span className="pbk-bf-chip-tag">{item.tag}</span>
                    <span className="pbk-bf-chip-body">{item.body}</span>
                  </span>
                  <span className="pbk-bf-reason">{item.reason}</span>
                </span>
                <span className="pbk-bf-chip-meta">
                  <span className="pbk-bf-score">{item.score}</span>
                  <span className="pbk-bf-source">{friendlyBattlefieldSource(item.source)}</span>
                  <span className="pbk-bf-chip-when">{item.when}</span>
                </span>
              </button>
            ))
          ) : (
            <button
              type="button"
              className="pbk-bf-chip warm"
              aria-label="Ranked queue is clear"
              onClick={() => undefined}
            >
              <span className="pbk-bf-rank">#0</span>
              <span className="pbk-bf-chip-main">
                <span className="pbk-bf-chip-line">
                  <PbkPulseDot color="sky" />
                  <span className="pbk-bf-chip-tag">Clear</span>
                  <span className="pbk-bf-chip-body">
                    No urgent approvals, live calls, or failed sends right now
                  </span>
                </span>
                <span className="pbk-bf-reason">
                  Ava will surface the next item when it matters.
                </span>
              </span>
              <span className="pbk-bf-chip-meta">
                <span className="pbk-bf-score">0</span>
                <span className="pbk-bf-source">GET /state</span>
                <span className="pbk-bf-chip-when">now</span>
              </span>
            </button>
          )}
        </div>
        <div className="pbk-battlefield-right">
          <div className="pbk-bf-mini-stat">
            <div className="l">Connection</div>
            <div className={`v ${bridgeTone}`}>{bridgeLabel}</div>
          </div>
          <div className="pbk-bf-mini-stat">
            <div className="l">Team</div>
            <div className="v">
              {agentsReady}/{agentsTotal || agentsReady || 0}
            </div>
          </div>
          <div className="pbk-bf-mini-stat">
            <div className="l">Ava mode</div>
            <div className="v amber">{friendlyRuntimeLabel(mode, 'Auto')}</div>
          </div>
        </div>
      </div>
      <DataSourceCaption
        endpoint="GET /api/founder/work-queue"
        note={`${sourceLabel}; ${sourceNote}`}
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
  const [activityPage, setActivityPage] = useState(0);
  const [approvalPage, setApprovalPage] = useState(0);
  const [adminPage, setAdminPage] = useState(0);
  const [resolvedApprovalIds, setResolvedApprovalIds] = useState<Set<string>>(() => new Set());
  const [widgetPrefs, setWidgetPrefs] = useState(() => readCommandWidgetPrefs());
  const [widgetPrefsSource, setWidgetPrefsSource] = useState('Device prefs');
  const [bridgeBattlefieldItems, setBridgeBattlefieldItems] = useState<BattlefieldItem[] | null>(
    null
  );
  const [battlefieldSource, setBattlefieldSource] = useState('client snapshot fallback');
  const [battlefieldQueueLoading, setBattlefieldQueueLoading] = useState(false);
  const [intelligenceStreamItems, setIntelligenceStreamItems] = useState<RuntimeRecord[] | null>(
    null
  );
  const [intelligenceStreamSource, setIntelligenceStreamSource] = useState(
    'snapshot activity fallback'
  );
  const [sourceConfidenceItems, setSourceConfidenceItems] = useState<SystemSourceLabel[] | null>(
    null
  );
  const [sourceConfidenceSource, setSourceConfidenceSource] = useState('client source fallback');
  const [bridgeConnection, setBridgeConnection] = useState<BridgeConnectionResponse | null>(null);
  const [bridgeConnectionSource, setBridgeConnectionSource] = useState(
    'GET /api/bridge/connection pending'
  );
  const [productionGaps, setProductionGaps] = useState<ProductionGapLabel[]>([]);
  const [primaryPathReliability, setPrimaryPathReliability] =
    useState<PrimaryPathReliabilityReport | null>(null);
  const [productionGapsSource, setProductionGapsSource] = useState('GET /api/production/gaps');
  const [productionGapsLoading, setProductionGapsLoading] = useState(false);
  const [qualityReviewCall, setQualityReviewCall] = useState<Record<string, unknown> | null>(null);
  const [bridgeLeadRoster, setBridgeLeadRoster] = useState<RuntimeRecord[]>([]);
  const [leadRosterSource, setLeadRosterSource] = useState('GET /api/leads pending');
  const announcedCallRef = useRef('');
  const reviewedCallRef = useRef(readReviewedCallIds());
  const promptedCallRef = useRef('');

  const approvals = useMemo(
    () => (Array.isArray(snapshot?.approvals) ? snapshot.approvals : []),
    [snapshot?.approvals]
  );
  const adminTasks = useMemo(
    () => (Array.isArray(snapshot?.adminTasks) ? snapshot.adminTasks : []),
    [snapshot?.adminTasks]
  );
  const snapshotLeadImports = useMemo(
    () => (Array.isArray(snapshot?.leadImports) ? snapshot.leadImports : []),
    [snapshot?.leadImports]
  );
  const leadImports = useMemo(
    () => (bridgeLeadRoster.length ? bridgeLeadRoster : snapshotLeadImports),
    [bridgeLeadRoster, snapshotLeadImports]
  );
  const fallbackActivityItems = useMemo(
    () =>
      (Array.isArray(snapshot?.activity) ? snapshot.activity : []).map((item) => {
        const record = item as Record<string, unknown>;
        return {
          ...record,
          text: friendlyRuntimeText(record.text || record.body || record.title || 'Runtime event'),
          body: friendlyRuntimeText(record.body || record.text || record.title || 'Runtime event'),
          title: friendlyRuntimeText(record.title),
        };
      }),
    [snapshot?.activity]
  );
  const activityItems = intelligenceStreamItems || fallbackActivityItems;
  const pendingApprovals = useMemo(
    () =>
      getPendingApprovals(approvals).filter(
        (item) => !getApprovalResolutionKeys(item).some((key) => resolvedApprovalIds.has(key))
      ),
    [approvals, resolvedApprovalIds]
  );
  const visibleApprovals = useMemo(
    () => getPageSlice(pendingApprovals, approvalPage, OPERATOR_LIST_PAGE_SIZE),
    [approvalPage, pendingApprovals]
  );
  const visibleAdminTasks = useMemo(
    () => getPageSlice(adminTasks, adminPage, OPERATOR_LIST_PAGE_SIZE),
    [adminPage, adminTasks]
  );
  const visibleActivity = useMemo(
    () => getPageSlice(activityItems, activityPage, OPERATOR_LIST_PAGE_SIZE),
    [activityItems, activityPage]
  );
  const calls = useMemo(
    () => (Array.isArray(snapshot?.calls) ? snapshot.calls : []),
    [snapshot?.calls]
  );
  const messages = useMemo(
    () => (Array.isArray(snapshot?.messages) ? snapshot.messages : []),
    [snapshot?.messages]
  );
  const contracts = useMemo(
    () => (Array.isArray(snapshot?.contracts) ? snapshot.contracts : []),
    [snapshot?.contracts]
  );
  const fallbackSourceConfidenceItems = useMemo(
    () =>
      buildFallbackSourceLabels({
        loading,
        error,
        leadCount: leadImports.length,
        activityCount: fallbackActivityItems.length,
        battlefieldSource,
        intelligenceStreamSource,
      }),
    [
      battlefieldSource,
      error,
      fallbackActivityItems.length,
      intelligenceStreamSource,
      leadImports.length,
      loading,
    ]
  );
  const displayedSourceConfidenceItems = (
    sourceConfidenceItems && sourceConfidenceItems.length
      ? sourceConfidenceItems
      : fallbackSourceConfidenceItems
  ).map((item) => ({
    ...item,
    status: friendlyRuntimeLabel(item.status || 'checking', 'Checking'),
    readiness: item.readiness === 'degraded' ? 'needs_attention' : item.readiness,
    dataState: friendlyRuntimeLabel(item.dataState || 'checking', 'Checking'),
    source: friendlyRuntimeText(item.source || 'bridge'),
    fallbackReason: friendlyRuntimeText(item.fallbackReason),
    degradedReason: friendlyRuntimeText(item.degradedReason),
    note: friendlyRuntimeText(item.note),
  }));
  const isWidgetVisible = (id: CommandWidgetId) => widgetPrefs[id] !== false;
  const runtimeProviders = useMemo(
    () => (snapshot?.status?.providers || {}) as Record<string, Record<string, unknown>>,
    [snapshot?.status?.providers]
  );
  const webSearchStatus = runtimeProviders.webSearch || {};
  const webSearchNeuralOutput = (webSearchStatus.neuralOutput || {}) as Record<string, unknown>;
  const webSearchLiveReady = Boolean(webSearchStatus.liveReady);
  const activeCall = mapRuntimeCall(calls.find((call) => isActiveRuntimeCallStatus(call.status)));
  const endedCallForReview = useMemo(
    () =>
      calls.find((call) =>
        ['ended', 'completed', 'failed'].includes(String(call.status || '').toLowerCase())
      ) || null,
    [calls]
  );

  const toggleWidget = (id: CommandWidgetId) => {
    const next = writeCommandWidgetPrefs({
      ...widgetPrefs,
      [id]: widgetPrefs[id] === false,
    });
    setWidgetPrefs(next);
    updateRuntimeSettingsRequest({
      ui: { commandCenterWidgets: next },
      actor: 'CommandCenter',
    })
      .then(() => {
        setWidgetPrefsSource('Bridge settings');
        return refresh();
      })
      .catch((nextError) => {
        setWidgetPrefsSource('Device prefs');
        showUiToast({
          tone: 'warning',
          title: 'Widget layout saved locally',
          desc:
            nextError instanceof Error
              ? `${nextError.message}. Using localStorage:pbk:command-center:widgets fallback.`
              : 'Bridge settings were unavailable. Using localStorage:pbk:command-center:widgets fallback.',
        });
      });
  };

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(activityItems.length / OPERATOR_LIST_PAGE_SIZE));
    setActivityPage((current) => Math.min(current, pageCount - 1));
  }, [activityItems.length]);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(pendingApprovals.length / OPERATOR_LIST_PAGE_SIZE));
    setApprovalPage((current) => Math.min(current, pageCount - 1));
  }, [pendingApprovals.length]);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(adminTasks.length / OPERATOR_LIST_PAGE_SIZE));
    setAdminPage((current) => Math.min(current, pageCount - 1));
  }, [adminTasks.length]);

  useEffect(() => {
    const hideResolvedApproval = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          approvalId?: string;
          approvalIds?: string[];
          approvalKeys?: string[];
          response?: { approval?: Record<string, unknown> };
        }>
      ).detail;
      const approvalId = String(detail?.approvalId || '').trim();
      const nextKeys = [
        approvalId,
        ...(Array.isArray(detail?.approvalIds) ? detail.approvalIds : []),
        ...(Array.isArray(detail?.approvalKeys) ? detail.approvalKeys : []),
        ...getApprovalResolutionKeys(detail?.response?.approval || {}),
      ].filter(Boolean);
      if (!nextKeys.length) return;
      setResolvedApprovalIds((current) => {
        const next = new Set(current);
        nextKeys.forEach((key) => next.add(key));
        return next;
      });
    };
    window.addEventListener('pbk:approval-decision', hideResolvedApproval);
    return () => window.removeEventListener('pbk:approval-decision', hideResolvedApproval);
  }, []);

  const loadCommandLeadRoster = useCallback(async () => {
    try {
      const roster = await fetchLeadsRequest();
      setBridgeLeadRoster(Array.isArray(roster) ? (roster as RuntimeRecord[]) : []);
      setLeadRosterSource('GET /api/leads full roster');
    } catch (rosterError) {
      setBridgeLeadRoster([]);
      setLeadRosterSource(
        rosterError instanceof Error
          ? `snapshot fallback: ${rosterError.message}`
          : 'snapshot fallback'
      );
    }
  }, []);

  useEffect(() => {
    void loadCommandLeadRoster();
  }, [loadCommandLeadRoster]);

  useEffect(() => {
    let cancelled = false;
    fetchIntelligenceStreamRequest({ limit: 40 })
      .then((response) => {
        if (cancelled) return;
        const items = Array.isArray(response.items)
          ? response.items.map(normalizeIntelligenceStreamItem)
          : [];
        setIntelligenceStreamItems(items);
        setIntelligenceStreamSource(response.source || response.result || 'bridge intelligence');
      })
      .catch((streamError) => {
        if (cancelled) return;
        setIntelligenceStreamItems(null);
        setIntelligenceStreamSource(
          streamError instanceof Error
            ? `fallback: ${streamError.message}`
            : 'snapshot activity fallback'
        );
      });
    return () => {
      cancelled = true;
    };
  }, [fallbackActivityItems.length]);

  useEffect(() => {
    let cancelled = false;
    const refreshBridgeConnection = () => {
      fetchBridgeConnectionRequest()
        .then((response) => {
          if (cancelled) return;
          setBridgeConnection(response);
          setBridgeConnectionSource(response.result || 'GET /api/bridge/connection');
        })
        .catch((connectionError) => {
          if (cancelled) return;
          setBridgeConnection(null);
          setBridgeConnectionSource(
            connectionError instanceof Error
              ? `team session needed: ${connectionError.message}`
              : 'team session needed'
          );
        });
    };
    refreshBridgeConnection();
    const refreshTimer = window.setInterval(refreshBridgeConnection, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshSourceLabels = () => {
      fetchSystemSourceLabelsRequest()
        .then((response) => {
          if (cancelled) return;
          const items = Array.isArray(response.items)
            ? response.items.map(normalizeSystemSourceLabel)
            : [];
          setSourceConfidenceItems(items);
          setSourceConfidenceSource(response.source || response.result || 'bridge source labels');
        })
        .catch((sourceError) => {
          if (cancelled) return;
          setSourceConfidenceItems(null);
          setSourceConfidenceSource(
            sourceError instanceof Error ? `fallback: ${sourceError.message}` : 'client fallback'
          );
        });
    };
    refreshSourceLabels();
    const refreshTimer = window.setInterval(refreshSourceLabels, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshProductionGaps = () => {
      setProductionGapsLoading(true);
      fetchProductionGapsRequest()
        .then((response) => {
          if (cancelled) return;
          setProductionGaps(Array.isArray(response.gaps) ? response.gaps : []);
          setPrimaryPathReliability(response.primaryPath || null);
          setProductionGapsSource(response.result || 'bridge production gap labels');
        })
        .catch((gapError) => {
          if (cancelled) return;
          const detail =
            gapError instanceof Error
              ? gapError.message
              : 'Production gap report could not be loaded.';
          setProductionGaps([
            {
              id: 'production-gap-report-unavailable',
              label: 'Production gap report',
              category: 'control_plane',
              severity: 'high',
              status: 'unavailable',
              source: 'GET /api/production/gaps',
              endpoint: 'GET /api/production/gaps',
              detail,
              operatorAction:
                'Check bridge auth, route wiring, and hosted deploy revision before trusting launch controls.',
              optional: false,
              blocking: true,
              controlLive: false,
            },
          ]);
          setPrimaryPathReliability({
            ok: false,
            result: 'primary_path_report_unavailable',
            fallbackSloTargetPercent: 0.1,
            summary: {
              primaryAllowed: false,
              totalControls: 1,
              allowedPrimary: 0,
              blocking: 1,
              disabledOptional: 0,
              retryBeforeFallback: 0,
              timeoutEventsRequired: 1,
              providerPolicies: 0,
            },
            controls: [
              {
                id: 'primary-production-gap-report-unavailable',
                label: 'Production gap report',
                category: 'control_plane',
                status: 'unavailable',
                primaryAttempt: 'blocked_until_ready',
                allowPrimaryAttempt: false,
                blocking: true,
                optional: false,
                retryBeforeFallback: 0,
                timeoutMs: 5000,
                timeoutEventRequired: true,
                fallbackPolicy: 'no_fallback_hide_blocker',
                reason: detail,
                operatorAction:
                  'Restore GET /api/production/gaps before trusting first-attempt launch readiness.',
              },
            ],
          });
          setProductionGapsSource(`fallback: ${detail}`);
        })
        .finally(() => {
          if (!cancelled) setProductionGapsLoading(false);
        });
    };
    refreshProductionGaps();
    const refreshTimer = window.setInterval(refreshProductionGaps, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    const bridgePrefs = getBridgeCommandWidgetPrefs(snapshot);
    if (!bridgePrefs) return;
    setWidgetPrefsSource('Bridge settings');
    setWidgetPrefs((current) =>
      areCommandWidgetPrefsEqual(current, bridgePrefs)
        ? current
        : writeCommandWidgetPrefs(bridgePrefs)
    );
  }, [snapshot]);

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
    if (!callId || reviewedCallRef.current.has(callId) || promptedCallRef.current === callId) {
      return;
    }
    promptedCallRef.current = callId;
    setQualityReviewCall(endedCallForReview);
  }, [endedCallForReview]);

  const closeQualityReview = useCallback(() => {
    const callId = qualityReviewCall ? getCallId(qualityReviewCall) : '';
    persistReviewedCallId(callId, reviewedCallRef.current);
    setQualityReviewCall(null);
  }, [qualityReviewCall]);
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
  const fallbackBattlefieldItems = useMemo(
    () => buildBattlefieldItems({ approvals, adminTasks, leadImports, messages, calls }),
    [approvals, adminTasks, leadImports, messages, calls]
  );
  const pendingApprovalIds = useMemo(
    () => new Set(pendingApprovals.map((approval) => String(approval.id || '')).filter(Boolean)),
    [pendingApprovals]
  );
  const battlefieldItems = useMemo(() => {
    const items = bridgeBattlefieldItems || fallbackBattlefieldItems;
    return items.filter((item) => {
      const approvalId = item.id.replace(/^approval-/, '');
      const looksLikeApproval =
        item.id.startsWith('approval-') || /approval|contract/i.test(`${item.tag} ${item.reason}`);
      if (!looksLikeApproval) return true;
      if (resolvedApprovalIds.has(approvalId) || resolvedApprovalIds.has(item.id)) return false;
      return pendingApprovalIds.size
        ? pendingApprovalIds.has(approvalId) || pendingApprovalIds.has(item.id)
        : true;
    });
  }, [bridgeBattlefieldItems, fallbackBattlefieldItems, pendingApprovalIds, resolvedApprovalIds]);
  const battlefieldSourceNote = bridgeBattlefieldItems
    ? 'bridge-ranked founder queue'
    : 'client-ranked snapshot fallback';
  const pendingApprovalCount = pendingApprovals.length;
  const pendingAdminCount = adminTasks.filter((item) => item.status === 'pending').length;
  const unreadMessageCount = messages.filter((message) => {
    const status = String(message.status || '').toLowerCase();
    return (
      Boolean(message.unread || message.isUnread) || /unread|received|inbound|reply/.test(status)
    );
  }).length;
  const missionQuickActions: MissionQuickAction[] = [
    {
      label: 'Ask Ava',
      description: 'Plan the next move, draft messages, and hand off work.',
      count: 'Start',
      tone: 'sky',
      targetPath: '/ava-chat',
      icon: Bot,
    },
    {
      label: 'Work leads',
      description: 'Open seller records, missing facts, and call context.',
      count: `${leadImports.length}`,
      tone: 'lime',
      targetPath: '/leads',
      icon: Users,
    },
    {
      label: 'Reply inbox',
      description: 'Handle seller replies, scheduled sends, and conversations.',
      count: `${unreadMessageCount || messages.length}`,
      tone: unreadMessageCount ? 'amber' : 'sky',
      targetPath: '/inbox',
      icon: InboxIcon,
    },
    {
      label: 'Review decisions',
      description: 'Approve only the actions that truly need a human.',
      count: `${pendingApprovalCount + pendingAdminCount}`,
      tone: pendingApprovalCount + pendingAdminCount ? 'amber' : 'sky',
      targetPath: '#approvals',
      icon: ClipboardCheck,
    },
  ];
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
  const systemHealthItems = useMemo(
    () =>
      buildCommandCenterHealthSummary(
        buildCommandCenterHealthInput({
          snapshot,
          tooling: tooling as RuntimeRecord | null,
          runtimeProviders,
          bridgeConnection,
          toolingCoreReady,
          toolingCoreTotal,
          sourceConfidenceItems: displayedSourceConfidenceItems,
          loading,
          error,
        })
      ),
    [
      displayedSourceConfidenceItems,
      bridgeConnection,
      error,
      loading,
      runtimeProviders,
      snapshot,
      tooling,
      toolingCoreReady,
      toolingCoreTotal,
    ]
  );

  useEffect(() => {
    let cancelled = false;
    setBattlefieldQueueLoading(true);
    fetchFounderWorkQueueRequest({ limit: OPERATOR_LIST_PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        const items = Array.isArray(response.items)
          ? response.items.map(normalizeBridgeBattlefieldItem)
          : [];
        setBridgeBattlefieldItems(items);
        setBattlefieldSource(response.source || response.result || 'bridge work queue');
      })
      .catch((queueError) => {
        if (cancelled) return;
        setBridgeBattlefieldItems(null);
        setBattlefieldSource(
          queueError instanceof Error
            ? `fallback: ${queueError.message}`
            : 'client snapshot fallback'
        );
      })
      .finally(() => {
        if (!cancelled) setBattlefieldQueueLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [approvals, adminTasks, leadImports, messages, calls]);

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
    if (pendingAction) {
      setActionStatus({ tone: 'pending', text: 'Another Ava action is already running.' });
      return;
    }
    setPendingAction(key);
    setActionStatus({ tone: 'pending', text: 'Working on that request...' });
    try {
      await action();
      await refresh().catch((err) => {
        console.warn('[PBK] State refresh failed after runtime action:', err);
        return null;
      });
      setActionStatus({ tone: 'success', text: successMessage });
      showUiToast({
        tone: 'success',
        title: 'Ava updated the workspace',
        desc: successMessage,
      });
    } catch (nextError) {
      setActionStatus({
        tone: 'error',
        text: nextError instanceof Error ? nextError.message : 'Ava could not finish that action.',
      });
    } finally {
      setPendingAction('');
    }
  };

  const runWebSearchProbe = async () => {
    setPendingAction('web-search:probe');
    setActionStatus({ tone: 'pending', text: 'Checking market research connection...' });
    setWebSearchProbeFailed(false);
    setWebSearchProbeError('');
    try {
      const result = await fetchWebSearchStatusRequest();
      const status = (result.status || {}) as Record<string, unknown>;
      setActionStatus({
        tone: 'success',
        text: status.liveReady
          ? 'Live market research is ready for Ava.'
          : 'Ava can still work from saved knowledge while live research is being connected.',
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
    if (pendingAction.startsWith(`admin:${taskId}:`)) return;
    setAdminDecisionDraft({
      taskId,
      status,
      provider: friendlyRuntimeLabel(task.provider || 'Ava'),
      action: friendlyRuntimeLabel(task.action || 'review'),
      summary: String(task.summary || task.command || 'Workspace action'),
    });
  };

  const executeAdminDecision = () => {
    if (!adminDecisionDraft) return;
    const draft = adminDecisionDraft;
    if (pendingAction.startsWith(`admin:${draft.taskId}:`)) return;
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
    if (pendingAction.startsWith(`approval:${approvalId}:`)) return;
    const type = friendlyRuntimeLabel(approval.type || 'approval');
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
      leadName: friendlyRuntimeLabel(approval.leadName || approval.address || 'PBK approval'),
      address: String(approval.address || 'No address recorded'),
      actionLabel,
      preview: getApprovalPreview(approval),
      resolutionKeys: getApprovalResolutionKeys(approval),
    });
  };

  const executeApprovalDecision = () => {
    if (!approvalDecisionDraft) return;
    const draft = approvalDecisionDraft;
    if (pendingAction.startsWith(`approval:${draft.approvalId}:`)) return;
    setApprovalDecisionDraft(null);
    void runRuntimeAction(
      `approval:${draft.approvalId}:${draft.status}`,
      draft.status === 'approved' ? 'Approved. Ava can continue.' : 'Decision sent to Ava.',
      async () => {
        await updateApprovalDecision(draft.approvalId, draft.status);
        setResolvedApprovalIds((current) => {
          const next = new Set(current);
          next.add(draft.approvalId);
          draft.resolutionKeys.forEach((key) => next.add(key));
          return next;
        });
      }
    );
  };

  const isAdminDecisionPending = (taskId: string) => pendingAction.startsWith(`admin:${taskId}:`);
  const isApprovalDecisionPending = (approvalId: string) =>
    pendingAction.startsWith(`approval:${approvalId}:`);
  const getApprovalSecondaryStatus = (
    approval: Record<string, unknown>
  ): ApprovalDecisionDraft['status'] =>
    String(approval.type || '').toLowerCase() === 'contract' ? 'needs-revision' : 'rejected';

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
                    ? `${pendingApprovalCount + pendingAdminCount} items are ready for review.`
                    : 'Ava and the team are ready.'}
                </em>
              </h1>
              <p>
                Your calls, messages, leads, approvals, and agent activity are organized here so the
                next step is easy to choose.
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
              {loading ? 'Updating workspace' : error ? 'Connection needs attention' : 'Connected'}
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

          <div className="pbk-mission-actions" aria-label="Today quick actions">
            {missionQuickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  className={`pbk-mission-action is-${action.tone}`}
                  onClick={() => {
                    if (action.targetPath.startsWith('#')) {
                      document
                        .querySelector(action.targetPath)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      return;
                    }
                    navigate(action.targetPath);
                  }}
                >
                  <span className="pbk-mission-action-icon">
                    <Icon size={17} />
                  </span>
                  <span className="pbk-mission-action-copy">
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>
                  <span className="pbk-mission-action-count">{action.count}</span>
                </button>
              );
            })}
          </div>

          <DataSourceCaption
            endpoint="GET /api/leads + snapshot.calls + snapshot.messages + snapshot.contracts"
            note={`${leadRosterSource}; non-lead stats use live runtime arrays`}
          />
        </section>

        <SourceConfidenceRail
          items={displayedSourceConfidenceItems}
          source={sourceConfidenceSource}
        />

        <ProductionGapsRail
          gaps={productionGaps}
          source={productionGapsSource}
          loading={productionGapsLoading}
          primaryPath={primaryPathReliability}
        />

        {isWidgetVisible('systemHealth') && (
          <SystemHealthPanel items={systemHealthItems} source={bridgeConnectionSource} />
        )}

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
            <span>{friendlyRuntimeText(actionStatus.text)}</span>
          </div>
        )}

        <FounderBattlefield
          items={battlefieldItems}
          loading={loading || battlefieldQueueLoading}
          error={error}
          agentsReady={toolingCoreReady}
          agentsTotal={toolingCoreTotal}
          mode={approvalMode}
          sourceLabel={battlefieldSource}
          sourceNote={battlefieldSourceNote}
          onSelect={selectBattlefieldItem}
        />

        <PbkPanel className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Customize this dashboard for the whole team
              </h2>
              <p className="text-xs text-slate-500">
                every agent sees the same command center, so keep the shared view focused on
                today&apos;s work.
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
                    data-source="PATCH /api/settings ui.commandCenterWidgets"
                    data-fallback="localStorage:pbk:command-center:widgets"
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
            endpoint="PATCH /api/settings ui.commandCenterWidgets"
            note={`${widgetPrefsSource}; localStorage:pbk:command-center:widgets fallback`}
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

            {isWidgetVisible('callFloor') && (
              <CallFloorPanel
                leads={leadImports}
                calls={calls}
                leadSourceEndpoint={leadRosterSource}
              />
            )}

            {isWidgetVisible('adminActivity') && (
              <section
                id="admin-activity"
                className={`pbk-panel ${pendingAdminCount ? 'pbk-priority-high' : 'pbk-priority-low'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Workspace tasks</h2>
                    <p className="text-xs text-slate-500">
                      Setup or background tasks that need a quick yes or no.
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {visibleAdminTasks.map((task) => (
                    <div
                      key={String(task.id)}
                      className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-medium text-slate-200">
                          {friendlyRuntimeLabel(task.provider || 'Ava')} ·{' '}
                          {friendlyRuntimeLabel(task.action || 'review')}
                        </div>
                        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                          {formatRuntimeStatus(task.status)}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        {String(task.summary || task.command || 'Workspace action')}
                      </div>
                      {String(task.status || '').toLowerCase() === 'pending' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isAdminDecisionPending(String(task.id))}
                            onClick={() => confirmAdminDecision(task, 'approved')}
                            className="rounded-full bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60"
                          >
                            {isAdminDecisionPending(String(task.id)) ? '…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={isAdminDecisionPending(String(task.id))}
                            onClick={() => confirmAdminDecision(task, 'rejected')}
                            className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                          >
                            {isAdminDecisionPending(String(task.id)) ? '…' : 'Decline'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {!adminTasks.length && (
                    <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                      No workspace tasks need review.
                    </div>
                  )}
                </div>
                <CompactPager
                  page={adminPage}
                  total={adminTasks.length}
                  label="Workspace task pages"
                  itemLabel="tasks"
                  onPageChange={setAdminPage}
                />
                <DataSourceCaption endpoint="snapshot.adminTasks + POST /api/admin/tasks/:id/decision" />
              </section>
            )}

            {isWidgetVisible('webSearch') && (
              <section
                className={`pbk-panel ${webSearchLiveReady ? 'pbk-priority-money' : 'pbk-priority-high'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Market and web research
                    </h2>
                    <p className="text-xs text-slate-500">
                      Live research status for Ava and Rex when they need current market context.
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
                    {webSearchLiveReady ? 'Live research ready' : 'Saved knowledge active'}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Current information
                    </div>
                    <div className="mt-1 text-sm font-semibold capitalize text-slate-100">
                      {webSearchLiveReady ? 'Ready for live research' : 'Using saved knowledge'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {webSearchLiveReady
                        ? 'Ava can check current market context.'
                        : 'Ava can continue from the workspace record.'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Research memory
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-100">
                      {webSearchNeuralOutput.exposesSymbolicFacts === false
                        ? 'Saved guidance'
                        : 'Saved guidance + facts'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {webSearchNeuralOutput.exposesSymbolicFacts === false
                        ? 'Good for prepared answers.'
                        : 'Good for prepared answers and known facts.'}
                    </div>
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-400">
                  {webSearchLiveReady
                    ? 'Ava can use current market context when a conversation needs it.'
                    : 'Ava can keep working from saved guidance while live research is connected.'}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-500">
                    Research check:{' '}
                    <span className="text-slate-300">
                      {webSearchLiveReady ? 'ready' : 'needs setup'}
                    </span>
                    {!webSearchLiveReady && (
                      <span> / connect live research in Settings when available</span>
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
                      Connection check
                    </button>
                  </div>
                  {webSearchProbeFailed && webSearchProbeError && (
                    <div className="basis-full text-[11px] text-amber-300">
                      Last check needs attention: {friendlyRuntimeText(webSearchProbeError)}
                    </div>
                  )}
                </div>
                <DataSourceCaption endpoint="GET /api/brain/web-search/status" />
              </section>
            )}

            {isWidgetVisible('tooling') && (
              <section className="pbk-panel pbk-priority-low">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Support tools</h2>
                    <p className="text-xs text-slate-500">
                      Research, monitoring, and automation helpers Ava can use.
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
                          {friendlyRuntimeText(item.meta?.note || 'Checking connection status.')}
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
                    <p className="text-xs text-slate-500">
                      Recent work from Ava, Rex, calls, messages, and providers.
                    </p>
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
                        {friendlyRuntimeLabel(item.category || 'INFO')}
                      </div>
                    </div>
                  ))}
                  {!visibleActivity.length && (
                    <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                      No activity is on this page yet.
                    </div>
                  )}
                </div>
                <CompactPager
                  page={activityPage}
                  total={activityItems.length}
                  label="Activity feed pages"
                  itemLabel="events"
                  onPageChange={setActivityPage}
                />
                <DataSourceCaption
                  endpoint="GET /api/intelligence/stream"
                  note={`${intelligenceStreamSource}; snapshot.activity fallback`}
                />
              </section>
            )}

            {isWidgetVisible('approvals') && (
              <section
                id="approvals"
                className={`pbk-panel ${pendingApprovalCount ? 'pbk-priority-high' : 'pbk-priority-low'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">Approval board</h2>
                    <p className="text-xs text-slate-500">
                      Review what Ava needs before she sends, signs, or changes anything.
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {visibleApprovals.map((approval) => (
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
                        {friendlyRuntimeLabel(approval.type || 'approval')}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-100">
                        {friendlyRuntimeLabel(
                          approval.leadName || approval.address || 'PBK approval'
                        )}
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
                          disabled={isApprovalDecisionPending(String(approval.id))}
                          onClick={() => confirmApprovalDecision(approval, 'approved')}
                          className="rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isApprovalDecisionPending(String(approval.id)) ? '…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          data-approval-secondary="true"
                          disabled={isApprovalDecisionPending(String(approval.id))}
                          onClick={() => {
                            confirmApprovalDecision(approval, getApprovalSecondaryStatus(approval));
                          }}
                          className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isApprovalDecisionPending(String(approval.id))
                            ? '…'
                            : String(approval.type || '').toLowerCase() === 'contract'
                              ? 'Needs Revision'
                              : 'Decline'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {!pendingApprovals.length && (
                    <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                      No pending approvals right now.
                    </div>
                  )}
                </div>
                <CompactPager
                  page={approvalPage}
                  total={pendingApprovals.length}
                  label="Approval board pages"
                  itemLabel="reviews"
                  onPageChange={setApprovalPage}
                />
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
          onClose={closeQualityReview}
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
                Workspace review
              </div>
              <h3 id="admin-decision-title" className="mt-2 text-lg font-semibold text-slate-100">
                Confirm workspace choice
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
                Review before sending
              </div>
              <h3
                id="approval-decision-title"
                className="mt-2 text-lg font-semibold text-slate-100"
              >
                Confirm your choice
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                This will {approvalDecisionDraft.actionLabel}{' '}
                <span className="font-semibold text-slate-200">{approvalDecisionDraft.type}</span>{' '}
                for {approvalDecisionDraft.leadName}.
              </p>
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300">
                {approvalDecisionDraft.address}
              </div>
              <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-3 text-sm leading-relaxed text-amber-50">
                {approvalDecisionDraft.preview}
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
