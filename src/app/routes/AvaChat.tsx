import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Bot,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Cpu,
  Filter,
  FileText,
  Keyboard,
  Loader2,
  Mail,
  MessageSquare,
  Mic,
  MousePointer2,
  Phone,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { PbkButton, PbkDataSource, PbkEmpty, PbkPulseDot } from '../../components/pbk/index';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  fetchDesktopSidecarStatusRequest,
  fetchLocalCommandsRequest,
  queueLocalCommandRequest,
  sendAvaAssistantChatRequest,
  updateApprovalDecision,
  type AvaAssistantChatResponse,
  type DesktopSidecarStatusResponse,
  type LocalCommandRecord,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

type SpeechRecognitionResultEvent = Event & {
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type AvaCommandAction =
  | 'operator_command'
  | 'clickui'
  | 'status'
  | 'screenshot'
  | 'type_text'
  | 'llm_query'
  | 'send_email'
  | 'send_sms'
  | 'execute_safe_script'
  | 'search_leads'
  | 'analyze_deal';
type HistoryFilter = 'all' | 'active' | 'completed' | 'failed';
type ConnectionState = 'checking' | 'connected' | 'degraded';
type AvaSystemStatus = {
  visible: boolean;
  tone: 'warning' | 'danger';
  label: string;
  reasons: string[];
};
type CommandRiskLevel = 'low' | 'medium' | 'high';
type CompanionAction = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  action: AvaCommandAction;
  icon: typeof Terminal;
  requiresApproval: boolean;
};

type OperatorMemory = {
  draft: string;
  action: AvaCommandAction;
  updatedAt: string;
};
type AvaAssistantExchange = {
  id: string;
  request: string;
  answer: string;
  status: 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  suggestions: string[];
  usedIntent?: string;
  assistantAction?: string;
  warning?: string;
};

const AVA_OPERATOR_MEMORY_KEY = 'pbk:ava-chat:operator-memory';
const AVA_ASSISTANT_SESSION_KEY = 'pbk:ava-chat:assistant-session';
const AVA_ASSISTANT_EXCHANGES_KEY = 'pbk:ava-chat:assistant-exchanges';
const DEFAULT_CHAT_COMMAND_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LOCAL_CONTROL_ACTIONS = new Set<AvaCommandAction>([
  'clickui',
  'status',
  'screenshot',
  'type_text',
  'execute_safe_script',
]);

const PBK_COMPANION_ACTIONS: CompanionAction[] = [
  {
    id: 'send-sms',
    label: 'Draft Text',
    description: 'Write a seller text for review.',
    prompt: 'Draft a concise SMS to this seller using the current PBK context.',
    action: 'send_sms',
    icon: MessageSquare,
    requiresApproval: false,
  },
  {
    id: 'send-email',
    label: 'Draft Email',
    description: 'Write a seller email for review.',
    prompt: 'Draft a seller email using the current PBK context and keep it ready to review.',
    action: 'send_email',
    icon: Mail,
    requiresApproval: false,
  },
  {
    id: 'call-seller',
    label: 'Prep Call',
    description: 'Prepare the call and best opener.',
    prompt: 'Prepare a call to this seller and show the best opening line before dialing.',
    action: 'operator_command',
    icon: Phone,
    requiresApproval: false,
  },
  {
    id: 'open-lead',
    label: 'Find Lead',
    description: 'Find the seller record, timeline, and latest context.',
    prompt: 'Open the current seller lead and summarize the latest timeline context.',
    action: 'search_leads',
    icon: Search,
    requiresApproval: false,
  },
  {
    id: 'analyze-deal',
    label: 'Analyze Deal',
    description: 'Hydrate ARV, repairs, MAO, path, and next script.',
    prompt: 'Analyze this deal and tell me the MAO, offer path, and next seller question.',
    action: 'analyze_deal',
    icon: Sparkles,
    requiresApproval: false,
  },
  {
    id: 'generate-offer',
    label: 'Price Offer',
    description: 'Build a grounded offer from analyzer and seller facts.',
    prompt: 'Generate a seller-safe offer recommendation from analyzer, repairs, and motivation.',
    action: 'analyze_deal',
    icon: FileText,
    requiresApproval: false,
  },
  {
    id: 'prepare-contract',
    label: 'Prepare Contract',
    description: 'Queue the contract package without sending it yet.',
    prompt: 'Prepare the right contract package for this deal but do not send it yet.',
    action: 'operator_command',
    icon: FileText,
    requiresApproval: true,
  },
  {
    id: 'schedule-follow-up',
    label: 'Schedule Follow-up',
    description: 'Turn the next step into a seller timeline event.',
    prompt: 'Schedule the next follow-up for this seller and explain the recommended timing.',
    action: 'operator_command',
    icon: CalendarClock,
    requiresApproval: true,
  },
  {
    id: 'ask-rex',
    label: 'Research',
    description: 'Research missing context without leaving the conversation.',
    prompt: 'Research the missing context for this seller and return the key findings.',
    action: 'llm_query',
    icon: BrainCircuit,
    requiresApproval: false,
  },
  {
    id: 'review-with-qa',
    label: 'Review Call',
    description: 'Inspect a bad call, missed objection, or stale control.',
    prompt:
      'Review the latest seller interaction for missed context, repetition, and the next fix.',
    action: 'operator_command',
    icon: Bot,
    requiresApproval: false,
  },
  {
    id: 'add-memory',
    label: 'Remember Note',
    description: 'Capture a seller fact, operator note, or coaching lesson.',
    prompt: 'Add this as a PBK memory and connect it to the current seller timeline.',
    action: 'operator_command',
    icon: FileText,
    requiresApproval: false,
  },
];

const ACTIONS: Array<{
  id: AvaCommandAction;
  label: string;
  description: string;
  icon: typeof Terminal;
}> = [
  {
    id: 'operator_command',
    label: 'Ask Ava',
    description: 'Tell Ava what you need in plain English.',
    icon: Terminal,
  },
  {
    id: 'clickui',
    label: 'Look at screen',
    description: 'Let Ava review the active desktop view after approval.',
    icon: MousePointer2,
  },
  {
    id: 'status',
    label: 'Check connection',
    description: 'Confirm Ava can reach the local desktop helper.',
    icon: Radio,
  },
  {
    id: 'screenshot',
    label: 'Read my screen',
    description: 'Capture the current desktop after approval.',
    icon: Camera,
  },
  {
    id: 'type_text',
    label: 'Type text',
    description: 'Prepare typing after approval.',
    icon: Keyboard,
  },
  {
    id: 'llm_query',
    label: 'Research',
    description: 'Ask Ava to answer or summarize context.',
    icon: BrainCircuit,
  },
  {
    id: 'send_email',
    label: 'Email',
    description: 'Draft seller email for manual review and send.',
    icon: Send,
  },
  {
    id: 'send_sms',
    label: 'SMS',
    description: 'Draft seller text for manual review and send.',
    icon: Send,
  },
  {
    id: 'execute_safe_script',
    label: 'Approved task',
    description: 'Prepare a machine task for approval.',
    icon: Terminal,
  },
  {
    id: 'search_leads',
    label: 'Search',
    description: 'Look up seller and lead context.',
    icon: Search,
  },
  {
    id: 'analyze_deal',
    label: 'Analyze',
    description: 'Prepare deal analysis context.',
    icon: Sparkles,
  },
];

const ACTIVE_STATUSES = new Set([
  'queued',
  'pending',
  'pending_approval',
  'approved',
  'dispatched',
  'running',
]);
const FAILED_STATUSES = new Set(['failed', 'rejected', 'cancelled']);

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function formatRelative(value?: string | null) {
  if (!value) return 'not yet';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return String(value).slice(0, 16).replace('T', ' ');
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function normalizeStatus(status?: string) {
  return String(status || 'queued')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeAction(value?: string): AvaCommandAction {
  return ACTIONS.some((item) => item.id === value)
    ? (value as AvaCommandAction)
    : 'operator_command';
}

function buildCommandParams(action: AvaCommandAction, command: string) {
  if (action === 'type_text') {
    return {
      text: command.replace(/^type\s+/i, ''),
      allowAutomation: false,
    };
  }
  if (action === 'llm_query') return { prompt: command };
  if (action === 'send_email') return { channel: 'email', draftOnly: true };
  if (action === 'send_sms') return { channel: 'sms', draftOnly: true };
  if (action === 'search_leads') return { query: command };
  if (action === 'analyze_deal') return { prompt: command };
  return {};
}

function classifyConversationalCommand(command: string, selectedAction: AvaCommandAction) {
  const text = command.trim();
  const routes: Array<{
    pattern: RegExp;
    action: AvaCommandAction;
    requiresApproval: boolean;
  }> = [
    {
      pattern:
        /^(?:hi|hello|hey|yo|yes|yeah|yep|no|nah|why|ok|okay|thanks|thank you|good morning|good afternoon|good evening|how are you|what'?s up)[\s.!?]*$/i,
      action: 'llm_query',
      requiresApproval: false,
    },
    {
      pattern:
        /\b(?:research|search(?![^.!?\n]{0,32}\b(?:lead|seller|contact|property|record)s?\b)|find(?![^.!?\n]{0,32}\b(?:lead|seller|contact|property|record)s?\b)|look up(?![^.!?\n]{0,32}\b(?:lead|seller|contact|property|record)s?\b)|what is|what are|how does|how do|tell me about|explain|teach me|summarize)\b/i,
      action: 'llm_query',
      requiresApproval: false,
    },
    {
      pattern: /\b(?:draft|compose|write|prepare).{0,32}(?:email|mail)\b/i,
      action: 'llm_query',
      requiresApproval: false,
    },
    {
      pattern: /\b(?:draft|compose|write|prepare).{0,32}(?:text|sms|message)\b/i,
      action: 'llm_query',
      requiresApproval: false,
    },
    {
      pattern:
        /\b(?:take|grab|capture|get|snap).{0,24}(?:screenshot|screen shot|screen capture|desktop)\b|\bwhat(?:'s| is).{0,24}(?:on|shown on).{0,12}(?:my )?screen\b/i,
      action: 'screenshot',
      requiresApproval: true,
    },
    {
      pattern:
        /\b(?:clickui|click ui|inspect|observe|see|find).{0,32}(?:window|button|screen|desktop|app|ui)\b/i,
      action: 'clickui',
      requiresApproval: true,
    },
    {
      pattern:
        /\b(?:run|execute|start|launch).{0,32}(?:script|command|powershell|terminal|shell|program|app)\b/i,
      action: 'execute_safe_script',
      requiresApproval: true,
    },
    {
      pattern: /\b(?:send).{0,32}(?:email|mail)\b|\bemail\s+(?:to|the)\b/i,
      action: 'send_email',
      requiresApproval: false,
    },
    {
      pattern: /\b(?:send).{0,32}(?:text|sms|message)\b|\b(?:text|sms)\s+(?:to|the)\b/i,
      action: 'send_sms',
      requiresApproval: false,
    },
    {
      pattern: /\b(?:health|status|ready|online|offline|sidecar|bridge|openclaw|connection)\b/i,
      action: 'status',
      requiresApproval: false,
    },
    {
      pattern: /\b(?:search|find|look up|lookup).{0,32}(?:lead|seller|contact|property|record)\b/i,
      action: 'search_leads',
      requiresApproval: false,
    },
    {
      pattern:
        /\b(?:analy[sz]e|evaluate|underwrite|calculate).{0,32}(?:deal|property|mao|arv|offer)\b|\b(?:mao|arv|repair estimate)\b/i,
      action: 'analyze_deal',
      requiresApproval: false,
    },
  ];
  const match = routes.find((route) => route.pattern.test(text));
  if (!match || selectedAction !== 'operator_command') {
    return { action: selectedAction, requiresApproval: undefined, matched: false };
  }
  return { ...match, matched: true };
}

function createAvaAssistantExchangeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `ava-${crypto.randomUUID()}`;
  }
  return `ava-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function shouldUseAssistantChatRoute({
  action,
  selectedAction,
  requiresApproval,
}: {
  action: AvaCommandAction;
  selectedAction: AvaCommandAction;
  requiresApproval: boolean;
}) {
  if (LOCAL_CONTROL_ACTIONS.has(action)) return false;
  if (selectedAction === 'operator_command' && requiresApproval) return false;
  return true;
}

function normalizeAssistantSuggestions(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
}

function buildAssistantExchange(
  request: string,
  response: AvaAssistantChatResponse,
  fallbackAnswer = ''
): AvaAssistantExchange {
  const now = new Date().toISOString();
  const answer = String(response.answer || response.result || fallbackAnswer || '').trim();
  return {
    id: createAvaAssistantExchangeId(),
    request,
    answer: answer || 'Ava answered, but no readable message came back.',
    status: response.ok === false ? 'failed' : 'completed',
    createdAt: now,
    updatedAt: now,
    suggestions: normalizeAssistantSuggestions(response.suggestions),
    usedIntent: response.usedIntent,
    assistantAction: response.assistantAction,
    warning: response.warning,
  };
}

function getResultText(command: LocalCommandRecord) {
  if (command.error) return command.error;
  const result = command.result;
  if (!result) return '';
  const payload = getResultPayload(command);
  if (getSafeResultImageUrl(payload)) {
    for (const key of ['message', 'summary', 'output', 'result']) {
      const value = payload?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    const sourceName = String(payload?.sourceName || payload?.windowTitle || '').trim();
    return sourceName
      ? `Screenshot captured from ${sourceName}.`
      : 'Screenshot captured. Preview is below.';
  }
  if (getStructuredResultItems(payload)) {
    for (const key of ['message', 'summary', 'output', 'result']) {
      const value = payload?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return 'Done. The details are below.';
  }
  for (const key of ['message', 'summary', 'output', 'result']) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return 'Done. Ava received a result.';
  }
}

function getResultPayload(command: LocalCommandRecord) {
  const result = command.result;
  if (!result || typeof result !== 'object') return null;
  const nested = result.payload;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : result;
}

function getSafeResultImageUrl(payload: Record<string, unknown> | null) {
  const candidate = String(
    payload?.imageDataUrl || payload?.imageUrl || payload?.screenshotUrl || payload?.url || ''
  ).trim();
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(candidate)) return candidate;
  if (/^https:\/\//i.test(candidate)) return candidate;
  return '';
}

function getStructuredResultItems(payload: Record<string, unknown> | null) {
  for (const key of ['buttons', 'windows', 'entries', 'items']) {
    const value = payload?.[key];
    if (Array.isArray(value)) {
      return {
        label: key,
        items: value.slice(0, 40),
      };
    }
  }
  return null;
}

function formatStructuredResultItem(item: unknown) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item ?? '');
  const record = item as Record<string, unknown>;
  return (
    [record.name, record.label, record.title, record.type, record.status]
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' · ') || JSON.stringify(record)
  );
}

function getCommandRiskLevel(command: LocalCommandRecord): CommandRiskLevel {
  const value = String(command.riskLevel || '').toLowerCase();
  if (value === 'low' || value === 'high') return value;
  return command.requiresApproval === false ? 'low' : 'medium';
}

function getAssistantMessage(command: LocalCommandRecord) {
  const status = String(command.status || 'queued').toLowerCase();
  const result = getResultText(command);
  if (status === 'completed') return result || 'Done. Ava finished that request.';
  if (status === 'rejected' || status === 'cancelled') {
    return 'Stopped. Ava will not continue that request.';
  }
  if (FAILED_STATUSES.has(status)) {
    const safeResult = getConversationalResultText(result);
    return safeResult
      ? `Ava could not finish that. ${safeResult}`
      : 'Ava could not finish that request.';
  }
  if (status === 'approved' || status === 'dispatched' || status === 'running') {
    return 'Approved. I am working on it and will bring the result back here.';
  }
  if (command.requiresApproval || status === 'pending_approval') {
    return `Review this before I continue because ${getReadableRiskReason(command)}.`;
  }
  return 'I am handling that now and will update this thread when the result is ready.';
}

function getConversationalResultText(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^(?:approve|approval)\s+local\s+/i.test(text)) return '';
  if (/\b(?:POST|GET|PATCH|DELETE)\s+\/api\//.test(text)) return '';
  if (/\bSOURCE\s+(?:GET|POST|PATCH|DELETE)\b/i.test(text)) return '';
  return text;
}

function getReadableRiskReason(command: LocalCommandRecord) {
  const action = String(command.action || '').toLowerCase();
  const reason = String(command.riskReason || '').trim();
  if (action === 'screenshot' || action === 'screenshot_ocr')
    return 'screen capture can expose private desktop data';
  if (action === 'clickui') return 'desktop inspection or automation can affect sensitive UI state';
  if (action === 'type_text') return 'keyboard automation can change open applications';
  if (action === 'send_email') return 'seller emails must be reviewed before sending';
  if (action === 'send_sms') return 'seller texts must be reviewed before sending';
  if (action === 'execute_safe_script') return 'local scripts can change this machine';
  return reason || 'this action can affect your local system or providers';
}

function matchesHistoryFilter(command: LocalCommandRecord, filter: HistoryFilter) {
  const status = String(command.status || 'queued').toLowerCase();
  if (filter === 'completed') return status === 'completed';
  if (filter === 'failed') return FAILED_STATUSES.has(status);
  if (filter === 'active') return ACTIVE_STATUSES.has(status);
  return true;
}

function isActiveCommand(command?: LocalCommandRecord) {
  return Boolean(command && ACTIVE_STATUSES.has(String(command.status || '').toLowerCase()));
}

function shouldShowCommandInDefaultChat(command: LocalCommandRecord) {
  const status = String(command.status || 'queued').toLowerCase();
  if (!['queued', 'pending', 'pending_approval', 'dispatched', 'running'].includes(status)) {
    return false;
  }
  const timestamp = Date.parse(
    command.updatedAt || command.dispatchedAt || command.approvedAt || command.createdAt || ''
  );
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= DEFAULT_CHAT_COMMAND_MAX_AGE_MS;
}

function getAvaSystemStatus({
  connectionState,
  connectionError,
  submitError,
  pendingApprovals,
  commands,
}: {
  connectionState: ConnectionState;
  connectionError: string;
  submitError: string;
  pendingApprovals: number;
  commands: LocalCommandRecord[];
}): AvaSystemStatus {
  const reasons: string[] = [];
  let hasFailure = false;

  if (connectionState === 'degraded' || connectionError) {
    hasFailure = true;
    reasons.push("Ava's live connection is delayed.");
  }

  if (submitError) {
    hasFailure = true;
    reasons.push('The last Ava request needs attention.');
  }

  const failedCommands = commands.filter((command) =>
    FAILED_STATUSES.has(String(command.status || '').toLowerCase())
  ).length;
  if (failedCommands > 0) {
    hasFailure = true;
    reasons.push(`${failedCommands} request${failedCommands === 1 ? '' : 's'} need review.`);
  }

  if (pendingApprovals > 0) {
    reasons.push(`${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting.`);
  }

  return {
    visible: reasons.length > 0,
    tone: hasFailure ? 'danger' : 'warning',
    label: reasons[0] || 'System healthy',
    reasons,
  };
}

export function AvaChat() {
  const { snapshot, refresh } = useRuntimeSnapshot(30000);
  const [draft, setDraft] = useState('');
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<DesktopSidecarStatusResponse | null>(null);
  const [commands, setCommands] = useState<LocalCommandRecord[]>([]);
  const [assistantExchanges, setAssistantExchanges] = useState<AvaAssistantExchange[]>([]);
  const [assistantSessionId, setAssistantSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState<AvaCommandAction>('operator_command');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking');
  const [connectionError, setConnectionError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [decidingApprovalId, setDecidingApprovalId] = useState('');
  const [operatorMemory, setOperatorMemory] = useState<OperatorMemory | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const loadInFlightRef = useRef(false);

  const pendingApprovals = useMemo(
    () =>
      (snapshot?.approvals || []).filter(
        (approval) =>
          String(approval.status || '').toLowerCase() === 'pending' &&
          (String(approval.type || '').toLowerCase() === 'local_command' ||
            String(approval.approvalAction || '').toLowerCase() === 'executelocalcommand')
      ).length,
    [snapshot?.approvals]
  );

  const latestCommand = commands[0];
  const speechSupported = Boolean(getSpeechRecognitionConstructor());
  const selectedAction = ACTIONS.find((item) => item.id === action) || ACTIONS[0];
  const SelectedActionIcon = selectedAction.icon;
  const avaState = listening
    ? 'listening'
    : submitting
      ? 'thinking'
      : isActiveCommand(latestCommand)
        ? 'working'
        : connectionState === 'degraded'
          ? 'offline'
          : 'ready';

  const systemStatus = useMemo(
    () =>
      getAvaSystemStatus({
        connectionState,
        connectionError,
        submitError,
        pendingApprovals,
        commands,
      }),
    [commands, connectionError, connectionState, pendingApprovals, submitError]
  );

  const filteredCommands = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const defaultChatView = !query && historyFilter === 'all';
    return commands
      .filter((command) => !defaultChatView || shouldShowCommandInDefaultChat(command))
      .filter((command) => matchesHistoryFilter(command, historyFilter))
      .filter((command) => {
        if (!query) return true;
        return [
          command.command,
          command.action,
          command.status,
          command.error,
          getResultText(command),
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(query)
        );
      })
      .reverse();
  }, [commands, historyFilter, searchQuery]);

  const filteredAssistantExchanges = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return assistantExchanges.filter((exchange) => {
      if (historyFilter === 'active') return false;
      if (historyFilter === 'failed' && exchange.status !== 'failed') return false;
      if (historyFilter === 'completed' && exchange.status !== 'completed') return false;
      if (!query) return true;
      return [
        exchange.request,
        exchange.answer,
        exchange.usedIntent,
        exchange.assistantAction,
        ...exchange.suggestions,
      ].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(query)
      );
    });
  }, [assistantExchanges, historyFilter, searchQuery]);

  const conversationItems = useMemo(
    () =>
      [
        ...filteredAssistantExchanges.map((exchange) => ({
          kind: 'assistant' as const,
          id: exchange.id,
          createdAt: exchange.createdAt,
          exchange,
        })),
        ...filteredCommands.map((command) => ({
          kind: 'command' as const,
          id: command.id,
          createdAt: command.createdAt || command.updatedAt || '',
          command,
        })),
      ].sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()),
    [filteredAssistantExchanges, filteredCommands]
  );

  const conversationCount = assistantExchanges.length + commands.length;
  const defaultChatView = !searchQuery.trim() && historyFilter === 'all';

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const [sidecarResult, historyResult] = await Promise.allSettled([
        fetchDesktopSidecarStatusRequest(),
        fetchLocalCommandsRequest({ limit: 40 }),
      ]);

      let successCount = 0;
      const failures: string[] = [];
      if (sidecarResult.status === 'fulfilled') {
        setStatus(sidecarResult.value);
        successCount += 1;
      } else {
        failures.push(
          sidecarResult.reason instanceof Error
            ? sidecarResult.reason.message
            : 'Ava desktop connection is unavailable.'
        );
      }
      if (historyResult.status === 'fulfilled') {
        setCommands(historyResult.value.commands || []);
        successCount += 1;
      } else {
        failures.push(
          historyResult.reason instanceof Error
            ? historyResult.reason.message
            : 'Ava history is unavailable.'
        );
      }

      setConnectionState(
        successCount === 2 ? 'connected' : successCount === 0 ? 'degraded' : 'degraded'
      );
      setConnectionError(failures.join(' '));
    } finally {
      loadInFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    }, 6000);
    return () => window.clearInterval(poll);
  }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reloadCommandsAfterApprovalDecision = () => {
      void load({ silent: true });
    };
    window.addEventListener('pbk:approval-decision', reloadCommandsAfterApprovalDecision);
    return () =>
      window.removeEventListener('pbk:approval-decision', reloadCommandsAfterApprovalDecision);
  }, [load]);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(AVA_OPERATOR_MEMORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as OperatorMemory;
      if (!parsed?.draft || !ACTIONS.some((item) => item.id === parsed.action)) return;
      setOperatorMemory(parsed);
    } catch {
      window.localStorage.removeItem(AVA_OPERATOR_MEMORY_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedSessionId = String(
      window.localStorage.getItem(AVA_ASSISTANT_SESSION_KEY) || ''
    ).trim();
    if (storedSessionId) setAssistantSessionId(storedSessionId);
    try {
      const raw = window.localStorage.getItem(AVA_ASSISTANT_EXCHANGES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setAssistantExchanges(
        parsed
          .map(
            (item): AvaAssistantExchange => ({
              id: String(item?.id || createAvaAssistantExchangeId()),
              request: String(item?.request || '').slice(0, 1200),
              answer: String(item?.answer || '').slice(0, 4000),
              status: item?.status === 'failed' ? 'failed' : 'completed',
              createdAt: String(item?.createdAt || item?.updatedAt || new Date().toISOString()),
              updatedAt: String(item?.updatedAt || item?.createdAt || new Date().toISOString()),
              suggestions: normalizeAssistantSuggestions(item?.suggestions),
              usedIntent: String(item?.usedIntent || ''),
              assistantAction: String(item?.assistantAction || ''),
              warning: String(item?.warning || ''),
            })
          )
          .filter((item) => item.request && item.answer)
          .slice(-30)
      );
    } catch {
      window.localStorage.removeItem(AVA_ASSISTANT_EXCHANGES_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !assistantSessionId) return;
    window.localStorage.setItem(AVA_ASSISTANT_SESSION_KEY, assistantSessionId);
  }, [assistantSessionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      AVA_ASSISTANT_EXCHANGES_KEY,
      JSON.stringify(assistantExchanges.slice(-30))
    );
  }, [assistantExchanges]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const trimmedDraft = draft.trim();
    if (!trimmedDraft) return;
    const nextMemory: OperatorMemory = {
      draft: trimmedDraft.slice(0, 280),
      action,
      updatedAt: new Date().toISOString(),
    };
    setOperatorMemory(nextMemory);
    window.localStorage.setItem(AVA_OPERATOR_MEMORY_KEY, JSON.stringify(nextMemory));
  }, [action, draft]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || searchQuery || historyFilter !== 'all') return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [conversationCount, historyFilter, searchQuery]);

  useEffect(() => {
    if (!systemStatus.visible && contextOpen) setContextOpen(false);
  }, [contextOpen, systemStatus.visible]);

  const stopListening = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  };

  const submitCommand = useCallback(
    async (value = draft) => {
      const command = value.trim();
      if (!command || submitting) return;
      setSubmitting(true);
      setSubmitError('');

      let result;
      let useAssistantChat = false;
      try {
        const routed = classifyConversationalCommand(command, action);
        const nextAction = routed.action;
        const nextRequiresApproval =
          routed.requiresApproval === undefined ? requiresApproval : routed.requiresApproval;
        useAssistantChat = shouldUseAssistantChatRoute({
          action: nextAction,
          selectedAction: action,
          requiresApproval: nextRequiresApproval,
        });
        if (useAssistantChat) {
          const response = await sendAvaAssistantChatRequest({
            message: command,
            sessionId: assistantSessionId || undefined,
            source: 'ava-chat-page',
          });
          if (response.sessionId) setAssistantSessionId(response.sessionId);
          setAssistantExchanges((current) =>
            [...current, buildAssistantExchange(command, response)].slice(-30)
          );
          setDraft('');
          setTranscript(command);
          showUiToast({
            tone: response.ok === false ? 'warning' : 'success',
            title: response.ok === false ? 'Ava needs review' : 'Ava answered',
            desc: response.warning || 'Ava replied in the chat.',
          });
          setSubmitting(false);
          return;
        }
        const payload = {
          command,
          action: nextAction,
          params: {
            ...buildCommandParams(nextAction, command),
            conversationalIntent: routed.matched,
          },
          requestedBy: 'ava-chat-page',
          source: 'ava-chat',
          requiresApproval: nextRequiresApproval,
        };
        result = await queueLocalCommandRequest(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ava could not start that request.';
        setSubmitError(message);
        if (useAssistantChat) {
          setAssistantExchanges((current) =>
            [
              ...current,
              {
                id: createAvaAssistantExchangeId(),
                request: command,
                answer: message,
                status: 'failed',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                suggestions: ['Try again', 'Ask a simpler question'],
              } satisfies AvaAssistantExchange,
            ].slice(-30)
          );
        }
        showUiToast({
          tone: 'error',
          title: 'Ava could not start that',
          desc: message,
          critical: true,
        });
        setSubmitting(false);
        return;
      }

      const nextCommand = result.command;
      if (nextCommand) {
        setCommands((current) => [
          nextCommand,
          ...current.filter((item) => item.id !== nextCommand.id),
        ]);
      }
      setDraft('');
      setTranscript(command);
      showUiToast({
        tone: 'success',
        title: result.result === 'queued_for_approval' ? 'Ready for your approval' : 'Ava is on it',
        desc: result.message || 'Ava picked up your request.',
      });
      setSubmitting(false);

      const refreshResults = await Promise.allSettled([refresh(), load({ silent: true })]);
      if (refreshResults.every((item) => item.status === 'rejected')) {
        showUiToast({
          tone: 'warning',
          title: 'Ava started; status is delayed',
          desc: 'The request was accepted, but the latest update is not available yet.',
        });
      }
    },
    [action, assistantSessionId, draft, load, refresh, requiresApproval, submitting]
  );

  const handleApprovalDecision = useCallback(
    async (command: LocalCommandRecord, decision: 'approved' | 'rejected') => {
      const approvalId = String(command.approvalId || '').trim();
      if (!approvalId || decidingApprovalId) return;
      setDecidingApprovalId(approvalId);
      setSubmitError('');
      try {
        await updateApprovalDecision(approvalId, decision);
        showUiToast({
          tone: decision === 'approved' ? 'success' : 'info',
          title: decision === 'approved' ? 'Approved' : 'Denied',
          desc:
            decision === 'approved'
              ? 'Ava will continue now that you approved it.'
              : 'Ava will leave that request stopped.',
        });
        await Promise.allSettled([refresh(), load({ silent: true })]);
      } catch (err) {
        const message = err instanceof Error ? err.message : `Could not ${decision} this approval.`;
        setSubmitError(message);
        showUiToast({
          tone: 'error',
          title: 'Approval update failed',
          desc: message,
          critical: true,
        });
      } finally {
        setDecidingApprovalId('');
      }
    },
    [decidingApprovalId, load, refresh]
  );

  const startListening = () => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setSubmitError('This browser does not expose SpeechRecognition or webkitSpeechRecognition.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setSubmitError(event.error || 'Voice recognition stopped.');
      setListening(false);
    };
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim();
      setTranscript(text);
      setDraft(text);
      const last = event.results[event.results.length - 1];
      if (last?.isFinal && text) void submitCommand(text);
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const replayCommand = (command: LocalCommandRecord) => {
    setAction(normalizeAction(command.action));
    setRequiresApproval(command.requiresApproval !== false);
    setDraft(command.command || '');
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const selectCompanionAction = (item: CompanionAction) => {
    setAction(item.action);
    setRequiresApproval(item.requiresApproval);
    setDraft(item.prompt);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const resumeOperatorMemory = () => {
    if (!operatorMemory) return;
    setAction(operatorMemory.action);
    setDraft(operatorMemory.draft);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <section className="pbk-ava-chat-surface h-full max-h-full min-h-0 min-w-0 overflow-hidden bg-[var(--ava-bg)] text-[var(--ava-text)]">
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <AvaIdentityBar
          state={avaState}
          connectionState={connectionState}
          sidecarConnected={Boolean(status?.connected)}
          pendingApprovals={pendingApprovals}
          loading={loading}
          systemStatus={systemStatus}
          onRefresh={() => void load()}
          onOpenContext={() => setContextOpen(true)}
        />

        <div className="grid min-h-0">
          <main className="pbk-ava-chat-main grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            {(conversationItems.length > 0 || !defaultChatView) && (
              <ConversationToolbar
                query={searchQuery}
                onQueryChange={setSearchQuery}
                filter={historyFilter}
                onFilterChange={setHistoryFilter}
              />
            )}

            <div
              ref={timelineRef}
              className="pbk-ava-chat-thread min-h-0 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6 lg:px-8"
              aria-label="Ava conversation"
            >
              <div className="mx-auto w-full max-w-4xl">
                {connectionError && (
                  <div
                    role="alert"
                    className="mb-5 flex items-start gap-3 rounded-lg border border-[var(--ava-danger-border)] bg-[var(--ava-danger-soft)] p-3 text-sm"
                  >
                    <CircleAlert size={18} className="mt-0.5 shrink-0 text-[var(--ava-danger)]" />
                    <div className="min-w-0">
                      <div className="font-semibold">Some live context is delayed</div>
                      <p className="mt-1 break-words text-[var(--ava-text-muted)]">
                        {connectionError}
                      </p>
                    </div>
                  </div>
                )}

                {loading && conversationCount === 0 ? (
                  <ConversationSkeleton />
                ) : conversationItems.length ? (
                  <div className="space-y-7">
                    {conversationItems.map((item) =>
                      item.kind === 'assistant' ? (
                        <AssistantExchange
                          key={item.id}
                          exchange={item.exchange}
                          onReplay={() => {
                            setDraft(item.exchange.request);
                            window.requestAnimationFrame(() => composerRef.current?.focus());
                          }}
                          onUseSuggestion={(suggestion) => {
                            setDraft(suggestion);
                            window.requestAnimationFrame(() => composerRef.current?.focus());
                          }}
                        />
                      ) : (
                        <CommandExchange
                          key={item.id}
                          command={item.command}
                          onReplay={() => replayCommand(item.command)}
                          onApprovalDecision={handleApprovalDecision}
                          decidingApprovalId={decidingApprovalId}
                        />
                      )
                    )}
                  </div>
                ) : conversationCount && !defaultChatView ? (
                  <PbkEmpty
                    variant="idle"
                    icon={<Search size={24} />}
                    title="No matching chats"
                    description="Clear the search or choose another status to restore the conversation."
                  />
                ) : (
                  <WelcomeState
                    operatorMemory={operatorMemory}
                    onResumeOperatorMemory={resumeOperatorMemory}
                  />
                )}

                {submitting && <AvaThinkingBubble />}
              </div>
            </div>

            <AvaComposer
              draft={draft}
              setDraft={setDraft}
              transcript={transcript}
              action={action}
              requiresApproval={requiresApproval}
              listening={listening}
              submitting={submitting}
              speechSupported={speechSupported}
              submitError={submitError}
              textareaRef={composerRef}
              onStartListening={startListening}
              onStopListening={stopListening}
              onSubmit={() => void submitCommand()}
              onSelectCompanionAction={selectCompanionAction}
            />
          </main>
        </div>
      </div>

      {contextOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/55"
          role="dialog"
          aria-modal="true"
          aria-label="Ava context"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setContextOpen(false);
          }}
        >
          <div className="max-h-[82dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--ava-border)] bg-[var(--ava-panel)] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--ava-border)] bg-[var(--ava-panel)] px-4 py-3">
              <div>
                <div className="pbk-eyebrow">Ava context</div>
                <h2 className="font-semibold">What Ava will do next</h2>
              </div>
              <button
                type="button"
                className="grid size-11 place-items-center rounded-lg border border-[var(--ava-border)] text-[var(--ava-text-muted)]"
                onClick={() => setContextOpen(false)}
                aria-label="Close Ava context"
              >
                <X size={18} />
              </button>
            </div>
            <AvaContextRail
              action={selectedAction}
              actionIcon={<SelectedActionIcon size={17} />}
              requiresApproval={requiresApproval}
              pendingApprovals={pendingApprovals}
              status={status}
              connectionState={connectionState}
              commands={commands}
              operatorMemory={operatorMemory}
              onResumeOperatorMemory={() => {
                resumeOperatorMemory();
                setContextOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function AvaIdentityBar({
  state,
  connectionState,
  sidecarConnected,
  pendingApprovals,
  loading,
  systemStatus,
  onRefresh,
  onOpenContext,
}: {
  state: 'ready' | 'listening' | 'thinking' | 'working' | 'offline';
  connectionState: ConnectionState;
  sidecarConnected: boolean;
  pendingApprovals: number;
  loading: boolean;
  systemStatus: AvaSystemStatus;
  onRefresh: () => void;
  onOpenContext: () => void;
}) {
  const stateLabel = {
    ready: 'Ready when you are',
    listening: 'Listening',
    thinking: 'Thinking',
    working: 'Working on your request',
    offline: 'Connection needs attention',
  }[state];

  return (
    <header className="flex min-h-16 items-center justify-between gap-3 border-b border-[var(--ava-border)] bg-[var(--ava-panel)] px-3 py-2.5 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <AvaPresenceOrb state={state} compact />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-[var(--font-display)] text-2xl font-semibold leading-none">Ava</h1>
            <PbkPulseDot color={state === 'offline' ? 'amber' : 'lime'} />
          </div>
          <p className="mt-1 truncate text-xs text-[var(--ava-text-muted)]">{stateLabel}</p>
        </div>
      </div>

      <div className="hidden items-stretch divide-x divide-[var(--ava-border)] md:flex">
        <HeaderHealth
          label="Ava"
          value={connectionState === 'connected' ? 'Connected' : connectionState}
          healthy={connectionState === 'connected'}
        />
        <HeaderHealth
          label="Desktop"
          value={sidecarConnected ? 'Connected' : 'Waiting'}
          healthy={sidecarConnected}
        />
        <HeaderHealth
          label="Approvals"
          value={`${pendingApprovals} pending`}
          healthy={pendingApprovals === 0}
          warning={pendingApprovals > 0}
        />
      </div>

      <div className="flex items-center gap-2">
        {systemStatus.visible && (
          <button
            type="button"
            className={[
              'pbk-ava-system-indicator grid size-11 place-items-center rounded-lg border bg-[var(--ava-panel-elevated)] transition',
              systemStatus.tone === 'danger' ? 'is-danger' : 'is-warning',
            ].join(' ')}
            onClick={onOpenContext}
            aria-label={`Open Ava support details: ${systemStatus.label}`}
            title={systemStatus.reasons.join('\n')}
          >
            <Settings2 size={18} />
          </button>
        )}
        <button
          type="button"
          className="grid size-11 place-items-center rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel-elevated)] text-[var(--ava-text-muted)] transition hover:text-[var(--ava-text)]"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh Ava status"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </header>
  );
}

function HeaderHealth({
  label,
  value,
  healthy,
  warning = false,
}: {
  label: string;
  value: string;
  healthy: boolean;
  warning?: boolean;
}) {
  return (
    <div className="min-w-28 px-5">
      <div className="text-[10px] font-bold uppercase text-[var(--ava-text-faint)]">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span
          className={[
            'size-2 rounded-full',
            healthy
              ? 'bg-[var(--ava-success)]'
              : warning
                ? 'bg-[var(--ava-warning)]'
                : 'bg-[var(--ava-danger)]',
          ].join(' ')}
        />
        <span className="max-w-32 truncate">{value}</span>
      </div>
    </div>
  );
}

function ConversationToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  filter: HistoryFilter;
  onFilterChange: (value: HistoryFilter) => void;
}) {
  return (
    <div className="pbk-ava-chat-toolbar flex flex-col gap-2 border-b border-[var(--ava-border)] bg-[var(--ava-bg)] px-3 py-3 sm:flex-row sm:px-5">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search past chats</span>
        <Search
          size={17}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ava-text-faint)]"
        />
        <input
          id="ava-history-search"
          name="avaHistorySearch"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search past chats"
          className="h-11 w-full rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)] pl-10 pr-9 text-sm text-[var(--ava-text)] outline-none placeholder:text-[var(--ava-text-faint)] focus:border-[var(--ava-sky)]"
        />
        {query && (
          <button
            type="button"
            className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center text-[var(--ava-text-muted)]"
            onClick={() => onQueryChange('')}
            aria-label="Clear history search"
          >
            <X size={16} />
          </button>
        )}
      </label>
      <label className="relative">
        <span className="sr-only">Filter past chats</span>
        <Filter
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ava-text-faint)]"
        />
        <select
          id="ava-history-filter"
          name="avaHistoryFilter"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value as HistoryFilter)}
          className="h-11 w-full min-w-40 appearance-none rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)] pl-9 pr-9 text-sm text-[var(--ava-text)] outline-none focus:border-[var(--ava-sky)] sm:w-auto"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <ChevronDown
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ava-text-faint)]"
        />
      </label>
    </div>
  );
}

function AvaThinkingBubble() {
  return (
    <div className="mt-6 flex items-start gap-3" aria-live="polite" role="status">
      <AvaPresenceOrb state="thinking" compact />
      <div className="min-w-0 max-w-[88%] sm:max-w-[76%]">
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <span className="font-semibold">Ava</span>
          <span className="text-[var(--ava-text-faint)]">thinking</span>
        </div>
        <div className="pbk-ava-thinking-bubble rounded-[4px_16px_16px_16px] border border-[var(--ava-border)] bg-[var(--ava-panel)] px-4 py-3 text-sm shadow-sm">
          <span>Ava is checking the next best step</span>
          <span className="pbk-ava-thinking-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <small>Working in this chat</small>
        </div>
      </div>
    </div>
  );
}

function AssistantExchange({
  exchange,
  onReplay,
  onUseSuggestion,
}: {
  exchange: AvaAssistantExchange;
  onReplay: () => void;
  onUseSuggestion: (suggestion: string) => void;
}) {
  const failed = exchange.status === 'failed';
  return (
    <article className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[88%] sm:max-w-[72%]">
          <div className="rounded-[16px_16px_4px_16px] border border-[var(--ava-user-border)] bg-[var(--ava-user-bubble)] px-4 py-3 text-sm leading-6 shadow-sm">
            <p className="break-words">{exchange.request}</p>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-2 text-[11px] text-[var(--ava-text-faint)]">
            <span>You</span>
            <span>{formatRelative(exchange.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <AvaPresenceOrb state={failed ? 'offline' : 'ready'} compact />
        <div className="min-w-0 max-w-[88%] sm:max-w-[76%]">
          <div className="mb-1.5 flex items-center gap-2 text-xs">
            <span className="font-semibold">Ava</span>
            <span className="text-[var(--ava-text-faint)]">
              {formatRelative(exchange.updatedAt)}
            </span>
          </div>
          <div
            className={[
              'rounded-[4px_16px_16px_16px] border px-4 py-3 text-sm leading-6 shadow-sm',
              failed
                ? 'border-[var(--ava-danger-border)] bg-[var(--ava-danger-soft)]'
                : 'border-[var(--ava-border)] bg-[var(--ava-panel)]',
            ].join(' ')}
          >
            {exchange.warning && (
              <p className="mb-2 text-xs font-semibold text-[var(--ava-warning)]">
                {exchange.warning}
              </p>
            )}
            <p className="whitespace-pre-wrap break-words">{exchange.answer}</p>
            {exchange.suggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {exchange.suggestions.map((suggestion) => (
                  <button
                    key={`${exchange.id}-${suggestion}`}
                    type="button"
                    className="rounded-full border border-[var(--ava-border)] bg-[var(--ava-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ava-text-muted)] transition hover:border-[var(--ava-sky)] hover:text-[var(--ava-text)]"
                    onClick={() => onUseSuggestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span
              className={[
                'inline-flex items-center gap-1.5 font-semibold',
                failed ? 'text-[var(--ava-danger)]' : 'text-[var(--ava-success)]',
              ].join(' ')}
            >
              {failed ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              {failed ? 'Needs review' : 'Answered'}
            </span>
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 font-semibold text-[var(--ava-sky)] transition hover:bg-[var(--ava-sky-soft)]"
              onClick={onReplay}
            >
              <RotateCcw size={14} />
              Ask again
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function CommandExchange({
  command,
  onReplay,
  onApprovalDecision,
  decidingApprovalId,
}: {
  command: LocalCommandRecord;
  onReplay: () => void;
  onApprovalDecision: (command: LocalCommandRecord, decision: 'approved' | 'rejected') => void;
  decidingApprovalId: string;
}) {
  const status = String(command.status || 'queued').toLowerCase();
  const failed = FAILED_STATUSES.has(status);
  const completed = status === 'completed';
  const active = ACTIVE_STATUSES.has(status);
  const actionConfig = ACTIONS.find((item) => item.id === command.action) || ACTIONS[0];
  const ActionIcon = actionConfig.icon;
  const riskLevel = getCommandRiskLevel(command);
  const awaitingApproval =
    Boolean(command.approvalId) &&
    (command.requiresApproval || status === 'pending_approval') &&
    !failed &&
    !completed &&
    !['approved', 'dispatched', 'running'].includes(status);
  const decisionBusy = decidingApprovalId === command.approvalId;

  return (
    <article className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[88%] sm:max-w-[72%]">
          <div className="rounded-[16px_16px_4px_16px] border border-[var(--ava-user-border)] bg-[var(--ava-user-bubble)] px-4 py-3 text-sm leading-6 shadow-sm">
            <p className="break-words">{command.command || 'Local command'}</p>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-2 text-[11px] text-[var(--ava-text-faint)]">
            <span>You</span>
            <span>{formatRelative(command.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <AvaPresenceOrb
          state={failed ? 'offline' : active ? 'working' : completed ? 'ready' : 'ready'}
          compact
        />
        <div className="min-w-0 max-w-[88%] sm:max-w-[76%]">
          <div className="mb-1.5 flex items-center gap-2 text-xs">
            <span className="font-semibold">Ava</span>
            <span className="text-[var(--ava-text-faint)]">
              {formatRelative(command.updatedAt || command.completedAt || command.createdAt)}
            </span>
          </div>
          <div
            className={[
              'rounded-[4px_16px_16px_16px] border px-4 py-3 text-sm leading-6 shadow-sm',
              failed
                ? 'border-[var(--ava-danger-border)] bg-[var(--ava-danger-soft)]'
                : 'border-[var(--ava-border)] bg-[var(--ava-panel)]',
            ].join(' ')}
          >
            <p className="whitespace-pre-wrap break-words">{getAssistantMessage(command)}</p>
            <CommandResultPreview command={command} />
            {awaitingApproval && (
              <div className="pbk-ava-inline-approval mt-3 rounded-xl border border-[var(--ava-warning-border)] bg-[var(--ava-warning-soft)] p-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[var(--ava-warning)]">
                  <ShieldCheck size={15} />
                  Review before Ava continues
                </div>
                <p className="mb-3 text-xs leading-5 text-[var(--ava-text-muted)]">
                  Ava paused because this could send a message, read your screen, or change
                  something important. Approve only when the next step looks right.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <PbkButton
                    type="button"
                    variant="sky-gradient"
                    className="min-h-10 justify-center text-xs"
                    disabled={decisionBusy}
                    onClick={() => onApprovalDecision(command, 'approved')}
                  >
                    {decisionBusy ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    Approve
                  </PbkButton>
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)] px-3 text-xs font-semibold text-[var(--ava-text-muted)] transition hover:border-[var(--ava-danger-border)] hover:text-[var(--ava-danger)]"
                    disabled={decisionBusy}
                    onClick={() => onApprovalDecision(command, 'rejected')}
                  >
                    <X size={14} />
                    Deny
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <CommandStatus command={command} />
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 font-semibold text-[var(--ava-sky)] transition hover:bg-[var(--ava-sky-soft)]"
              onClick={onReplay}
            >
              <RotateCcw size={14} />
              Replay
            </button>
            <details className="pbk-ava-bubble-system">
              <summary>Details</summary>
              <div>
                <span className="inline-flex items-center gap-1.5">
                  <ActionIcon size={13} />
                  {actionConfig.label}
                </span>
                <span>{riskLevel} risk</span>
                <span>{command.requiresApproval ? 'Needs review' : 'Read-only'}</span>
              </div>
            </details>
          </div>
        </div>
      </div>
    </article>
  );
}

function CommandResultPreview({ command }: { command: LocalCommandRecord }) {
  const payload = getResultPayload(command);
  if (!payload || Object.keys(payload).length === 0) return null;

  const imageDataUrl = getSafeResultImageUrl(payload);
  const structured = getStructuredResultItems(payload);
  const sourceName = String(payload.sourceName || payload.windowTitle || payload.path || '').trim();
  const hiddenKeys = new Set([
    'imageDataUrl',
    'imageUrl',
    'screenshotUrl',
    'url',
    'buttons',
    'windows',
    'entries',
    'items',
    'message',
    'summary',
    'output',
    'result',
    'payload',
  ]);
  const facts = Object.entries(payload)
    .filter(
      ([key, value]) =>
        !hiddenKeys.has(key) &&
        ['string', 'number', 'boolean'].includes(typeof value) &&
        String(value).trim()
    )
    .slice(0, 10);

  if (!imageDataUrl && !structured && facts.length === 0) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[var(--ava-border)] bg-[var(--ava-bg)]">
      {imageDataUrl && (
        <figure>
          <img
            src={imageDataUrl}
            alt={sourceName ? `Desktop capture of ${sourceName}` : 'Desktop command result'}
            className="block max-h-[420px] w-full bg-black object-contain"
            loading="lazy"
          />
          {sourceName && (
            <figcaption className="border-t border-[var(--ava-border)] px-3 py-2 text-[11px] text-[var(--ava-text-muted)]">
              {sourceName}
            </figcaption>
          )}
        </figure>
      )}

      {structured && (
        <div className="border-t border-[var(--ava-border)] p-3 first:border-t-0">
          <div className="mb-2 text-[10px] font-bold uppercase text-[var(--ava-text-faint)]">
            {structured.label}
          </div>
          <ul className="grid gap-1.5">
            {structured.items.map((item, index) => (
              <li
                key={`${structured.label}-${index}-${formatStructuredResultItem(item)}`}
                className="rounded-lg bg-[var(--ava-panel)] px-3 py-2 text-xs text-[var(--ava-text-muted)]"
              >
                {formatStructuredResultItem(item)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {facts.length > 0 && (
        <dl className="grid gap-x-4 gap-y-2 border-t border-[var(--ava-border)] p-3 first:border-t-0 sm:grid-cols-2">
          {facts.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-[10px] font-bold uppercase text-[var(--ava-text-faint)]">
                {key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}
              </dt>
              <dd className="mt-0.5 break-words text-xs text-[var(--ava-text-muted)]">
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function CommandStatus({ command }: { command: LocalCommandRecord }) {
  const status = String(command.status || 'queued').toLowerCase();
  const failed = FAILED_STATUSES.has(status);
  const completed = status === 'completed';
  const Icon = failed ? AlertTriangle : completed ? CheckCircle2 : Clock3;
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 font-semibold',
        failed
          ? 'text-[var(--ava-danger)]'
          : completed
            ? 'text-[var(--ava-success)]'
            : 'text-[var(--ava-warning)]',
      ].join(' ')}
    >
      <Icon size={14} className={!failed && !completed ? 'animate-pulse' : ''} />
      {normalizeStatus(command.status)}
    </span>
  );
}

function AvaComposer({
  draft,
  setDraft,
  transcript,
  action,
  requiresApproval,
  listening,
  submitting,
  speechSupported,
  submitError,
  textareaRef,
  onStartListening,
  onStopListening,
  onSubmit,
  onSelectCompanionAction,
}: {
  draft: string;
  setDraft: (value: string) => void;
  transcript: string;
  action: AvaCommandAction;
  requiresApproval: boolean;
  listening: boolean;
  submitting: boolean;
  speechSupported: boolean;
  submitError: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onStartListening: () => void;
  onStopListening: () => void;
  onSubmit: () => void;
  onSelectCompanionAction: (item: CompanionAction) => void;
}) {
  const actionConfig = ACTIONS.find((item) => item.id === action) || ACTIONS[0];
  const slashQuery = draft.trimStart().startsWith('/')
    ? draft.trimStart().slice(1).toLowerCase()
    : '';
  const slashCommandsVisible = draft.trimStart().startsWith('/');
  const slashMatches = PBK_COMPANION_ACTIONS.filter((item) => {
    if (!slashQuery) return true;
    return [item.id, item.label, item.description].some((value) =>
      value.toLowerCase().includes(slashQuery)
    );
  }).slice(0, 6);

  return (
    <div className="pbk-ava-chat-composer border-t border-[var(--ava-border)] bg-[var(--ava-bg)] px-2 pt-2 sm:px-5 sm:pb-4 sm:pt-3">
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-[var(--ava-border-bright)] bg-[var(--ava-panel-elevated)] p-2 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
          {submitError && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--ava-danger-soft)] px-3 py-2 text-xs text-[var(--ava-danger)]"
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span className="break-words">{submitError}</span>
            </div>
          )}
          <label className="sr-only" htmlFor="ava-command-input">
            Ask Ava anything
          </label>
          <div className="pbk-ava-chat-action-rail" aria-label="Ava starter prompts">
            {PBK_COMPANION_ACTIONS.slice(0, 4).map((item) => {
              const QuickIcon = item.icon;
              return (
                <button key={item.id} type="button" onClick={() => onSelectCompanionAction(item)}>
                  <QuickIcon size={14} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <textarea
            id="ava-command-input"
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            rows={2}
            className="max-h-36 min-h-14 w-full resize-y bg-transparent px-3 py-2 text-[16px] leading-6 text-[var(--ava-text)] outline-none placeholder:text-[var(--ava-text-faint)] sm:text-sm"
            placeholder="Ask Ava anything..."
          />
          {slashCommandsVisible && (
            <div className="pbk-ava-slash-panel" role="listbox" aria-label="Ava shortcuts">
              {slashMatches.length ? (
                slashMatches.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={action === item.action}
                      onClick={() => onSelectCompanionAction(item)}
                    >
                      <Icon size={16} />
                      <span>
                        <strong>/{item.id.replace(/-/g, '')}</strong>
                        <small>{item.description}</small>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="pbk-ava-slash-empty">No Ava shortcut matches that.</div>
              )}
            </div>
          )}

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--ava-border)] px-1 pt-2">
            <div className="pbk-ava-chat-controls flex w-full min-w-0 flex-nowrap items-center gap-2 sm:w-auto sm:flex-wrap">
              <button
                type="button"
                onClick={listening ? onStopListening : onStartListening}
                disabled={!speechSupported || submitting}
                className={[
                  'grid size-11 shrink-0 place-items-center rounded-full border transition',
                  listening
                    ? 'border-[var(--ava-danger)] bg-[var(--ava-danger-soft)] text-[var(--ava-danger)]'
                    : 'border-[var(--ava-sky)] bg-[var(--ava-sky-soft)] text-[var(--ava-sky)]',
                ].join(' ')}
                aria-label={listening ? 'Stop listening' : 'Speak to Ava'}
                aria-pressed={listening}
              >
                {listening ? <Square size={17} /> : <Mic size={18} />}
              </button>

              <div className="hidden min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)] px-3 text-xs font-semibold text-[var(--ava-text-muted)] sm:flex sm:flex-none">
                <ShieldCheck size={15} className="text-[var(--ava-sky)]" />
                <span className="truncate">
                  {requiresApproval ? 'Ava will ask before protected actions' : actionConfig.label}
                </span>
              </div>
            </div>

            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <span className="hidden max-w-48 truncate text-xs text-[var(--ava-text-faint)] lg:block">
                {listening
                  ? transcript || 'Listening...'
                  : requiresApproval
                    ? 'Review before sending'
                    : 'Ready'}
              </span>
              <PbkButton
                type="button"
                variant="sky-gradient"
                className="pbk-ava-chat-send-button min-h-11 min-w-11 justify-center px-3"
                disabled={!draft.trim() || submitting}
                onClick={onSubmit}
                aria-label="Send to Ava"
              >
                {submitting ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}
                <span className="hidden sm:inline">{submitting ? 'Sending' : 'Send'}</span>
              </PbkButton>
            </div>
          </div>
        </div>
        <p className="pbk-ava-chat-mobile-note mt-1.5 text-center text-[10px] text-[var(--ava-text-faint)]">
          Ava can make mistakes. Review important actions before sending.
        </p>
      </div>
    </div>
  );
}

function AvaContextRail({
  action,
  actionIcon,
  requiresApproval,
  pendingApprovals,
  status,
  connectionState,
  commands,
  operatorMemory,
  onResumeOperatorMemory,
  className = '',
}: {
  action: (typeof ACTIONS)[number];
  actionIcon: ReactNode;
  requiresApproval: boolean;
  pendingApprovals: number;
  status: DesktopSidecarStatusResponse | null;
  connectionState: ConnectionState;
  commands: LocalCommandRecord[];
  operatorMemory: OperatorMemory | null;
  onResumeOperatorMemory: () => void;
  className?: string;
}) {
  const completedCount = commands.filter(
    (command) => String(command.status || '').toLowerCase() === 'completed'
  ).length;

  return (
    <aside className={`min-h-0 overflow-y-auto bg-[var(--ava-bg)] p-4 ${className}`}>
      <div className="space-y-3">
        <ContextPanel title="Recent ask" icon={<Clock3 size={16} />}>
          {operatorMemory ? (
            <button
              type="button"
              className="w-full rounded-lg border border-[var(--ava-border)] bg-[var(--ava-bg)] p-3 text-left text-xs text-[var(--ava-text-muted)] transition hover:border-[var(--ava-sky)] hover:text-[var(--ava-text)]"
              onClick={onResumeOperatorMemory}
            >
              <span className="block font-semibold text-[var(--ava-text)]">Resume last ask</span>
              <span className="mt-1 block truncate">{operatorMemory.draft}</span>
              <span className="mt-1 block text-[10px] uppercase text-[var(--ava-text-faint)]">
                {formatRelative(operatorMemory.updatedAt)}
              </span>
            </button>
          ) : (
            <p className="text-xs leading-5 text-[var(--ava-text-muted)]">
              Ava keeps your latest unsent ask on this device so you can pick it back up.
            </p>
          )}
          {pendingApprovals > 0 && (
            <div className="rounded-lg border border-[var(--ava-warning-border)] bg-[var(--ava-warning-soft)] p-3 text-xs">
              <div className="font-semibold text-[var(--ava-warning)]">
                {pendingApprovals} local {pendingApprovals === 1 ? 'approval' : 'approvals'} waiting
              </div>
              <p className="mt-1 text-[var(--ava-text-muted)]">
                Review guarded actions in the Approvals workspace.
              </p>
            </div>
          )}
        </ContextPanel>

        <details className="pbk-ava-system-drawer group rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Settings2 size={16} className="text-[var(--ava-sky)]" />
              <span>Support details</span>
            </span>
            <ChevronDown size={15} className="transition group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-[var(--ava-border)] p-3">
            <ContextPanel title="Now" icon={<Sparkles size={16} />}>
              <ContextRow label="Next step">
                <span className="inline-flex items-center gap-2 font-semibold">
                  {actionIcon}
                  {action.label}
                </span>
              </ContextRow>
              <ContextRow label="How Ava handles it">
                <span>Chat workspace</span>
              </ContextRow>
              <ContextRow label="Safety">
                <span
                  className={
                    requiresApproval ? 'text-[var(--ava-warning)]' : 'text-[var(--ava-success)]'
                  }
                >
                  {requiresApproval ? 'Approval requested' : 'Low-risk request'}
                </span>
              </ContextRow>
            </ContextPanel>

            <ContextPanel title="Connections" icon={<Cpu size={16} />}>
              <SystemHealthRow
                label="Ava service"
                value={connectionState === 'connected' ? 'Healthy' : 'Degraded'}
                healthy={connectionState === 'connected'}
              />
              <SystemHealthRow
                label="Desktop helper"
                value={status?.connected ? `${status.connectedCount || 1} connected` : 'Waiting'}
                healthy={Boolean(status?.connected)}
              />
              <SystemHealthRow
                label="Recent chats"
                value={`${commands.length} loaded`}
                healthy={commands.length > 0}
              />
              <SystemHealthRow
                label="Completed"
                value={`${completedCount}`}
                healthy={completedCount > 0}
              />
            </ContextPanel>

            <ContextPanel title="Support log" icon={<Terminal size={16} />}>
              <details className="group rounded-lg border border-[var(--ava-border)] bg-[var(--ava-bg)]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-semibold text-[var(--ava-text-muted)]">
                  <span>Connection details</span>
                  <ChevronDown size={14} className="transition group-open:rotate-180" />
                </summary>
                <div className="space-y-2 border-t border-[var(--ava-border)] p-3">
                  <PbkDataSource endpoint="POST /api/local/commands" status="ships" />
                  <PbkDataSource endpoint="GET /api/desktop-sidecar/status" status="ships" />
                  <PbkDataSource endpoint="POST /invoke executeLocalCommand" status="ships" />
                </div>
              </details>
            </ContextPanel>
          </div>
        </details>
      </div>
    </aside>
  );
}

function ContextPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)] p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[var(--ava-sky)]">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ContextRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase text-[var(--ava-text-faint)]">{label}</div>
      <div className="mt-1 text-xs text-[var(--ava-text-muted)]">{children}</div>
    </div>
  );
}

function SystemHealthRow({
  label,
  value,
  healthy,
}: {
  label: string;
  value: string;
  healthy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="inline-flex min-w-0 items-center gap-2 text-[var(--ava-text-muted)]">
        <span
          className={`size-2 shrink-0 rounded-full ${healthy ? 'bg-[var(--ava-success)]' : 'bg-[var(--ava-warning)]'}`}
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-mono text-[10px]">{value}</span>
    </div>
  );
}

function AvaPresenceOrb({
  state,
  compact = false,
}: {
  state: 'ready' | 'listening' | 'thinking' | 'working' | 'offline';
  compact?: boolean;
}) {
  return (
    <div
      className={[
        'pbk-ava-presence-orb relative grid shrink-0 place-items-center rounded-full border',
        compact ? 'size-10' : 'size-24',
        `is-${state}`,
      ].join(' ')}
      aria-hidden="true"
    >
      <div className="flex h-5 items-center gap-[2px]">
        {[7, 13, 18, 11, 16, 9].map((height, index) => (
          <span
            key={`${height}-${index}`}
            className="w-[2px] rounded-full bg-current"
            style={{ height }}
          />
        ))}
      </div>
    </div>
  );
}

function WelcomeState({
  operatorMemory,
  onResumeOperatorMemory,
}: {
  operatorMemory: OperatorMemory | null;
  onResumeOperatorMemory: () => void;
}) {
  return (
    <div className="flex min-h-[340px] items-end py-8">
      <div className="max-w-2xl">
        <div className="flex items-start gap-3">
          <AvaPresenceOrb state="ready" compact />
          <div className="rounded-[4px_18px_18px_18px] border border-[var(--ava-border)] bg-[var(--ava-panel)] p-4 text-left shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--ava-text)]">
              <span>Ava</span>
              <span className="text-[var(--ava-text-faint)]">PBK assistant</span>
            </div>
            <p className="text-sm leading-6 text-[var(--ava-text-muted)]">
              Tell me what you need in plain English. I can find seller context, analyze a deal,
              draft a follow-up, prep approvals, summarize calls, or help you decide what to say
              next.
            </p>
          </div>
        </div>
        {operatorMemory && (
          <button
            type="button"
            className="ml-[52px] mt-4 flex max-w-md items-start gap-3 rounded-xl border border-[var(--ava-border)] bg-[var(--ava-panel)] p-3 text-left text-xs text-[var(--ava-text-muted)] transition hover:border-[var(--ava-sky)] hover:text-[var(--ava-text)]"
            onClick={onResumeOperatorMemory}
          >
            <Clock3 size={16} className="mt-0.5 shrink-0 text-[var(--ava-sky)]" />
            <span className="min-w-0">
              <span className="block font-semibold text-[var(--ava-text)]">Resume last ask</span>
              <span className="mt-1 block truncate">{operatorMemory.draft}</span>
              <span className="mt-1 block text-[10px] uppercase text-[var(--ava-text-faint)]">
                {formatRelative(operatorMemory.updatedAt)}
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="space-y-7" aria-label="Loading Ava conversation">
      {[0, 1, 2].map((item) => (
        <div key={item} className="animate-pulse space-y-3">
          <div className="ml-auto h-14 w-2/3 rounded-2xl bg-[var(--ava-panel-elevated)]" />
          <div className="flex gap-3">
            <div className="size-10 rounded-full bg-[var(--ava-panel-elevated)]" />
            <div className="h-20 w-3/4 rounded-2xl bg-[var(--ava-panel)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
