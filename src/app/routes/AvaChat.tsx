import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Cpu,
  Filter,
  Keyboard,
  Loader2,
  Mic,
  MonitorUp,
  MousePointer2,
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
  executeLocalCommandRequest,
  fetchDesktopSidecarStatusRequest,
  fetchLocalCommandsRequest,
  queueLocalCommandRequest,
  updateApprovalDecision,
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
type SubmitLane = 'rest' | 'invoke';
type HistoryFilter = 'all' | 'active' | 'completed' | 'failed';
type ConnectionState = 'checking' | 'connected' | 'degraded';
type CommandRiskLevel = 'low' | 'medium' | 'high';

const ACTIONS: Array<{
  id: AvaCommandAction;
  label: string;
  description: string;
  icon: typeof Terminal;
}> = [
  {
    id: 'operator_command',
    label: 'OpenClaw',
    description: 'Natural-language instruction for the connected local worker.',
    icon: Terminal,
  },
  {
    id: 'clickui',
    label: 'ClickUI',
    description: 'Observe and interact with the active desktop interface.',
    icon: MousePointer2,
  },
  {
    id: 'status',
    label: 'Status',
    description: 'Read-only bridge and sidecar health check.',
    icon: Radio,
  },
  {
    id: 'screenshot',
    label: 'Screenshot',
    description: 'Capture the current desktop after approval.',
    icon: Camera,
  },
  {
    id: 'type_text',
    label: 'Type text',
    description: 'Approval-gated keyboard automation.',
    icon: Keyboard,
  },
  {
    id: 'llm_query',
    label: 'Local LLM',
    description: 'Ask the configured local CPU model.',
    icon: BrainCircuit,
  },
  {
    id: 'send_email',
    label: 'Email',
    description: 'Draft seller email and keep sending behind approval.',
    icon: Send,
  },
  {
    id: 'send_sms',
    label: 'SMS',
    description: 'Draft seller text and keep sending behind approval.',
    icon: Send,
  },
  {
    id: 'execute_safe_script',
    label: 'Script',
    description: 'Prepare a local script request for approval.',
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

const QUICK_COMMANDS: Array<{
  command: string;
  action: AvaCommandAction;
  label: string;
  icon: typeof Terminal;
  requiresApproval: boolean;
}> = [
  {
    command: 'Check OpenClaw sidecar status',
    action: 'status',
    label: 'Check system health',
    icon: Radio,
    requiresApproval: false,
  },
  {
    command: 'Take a screenshot of the current desktop',
    action: 'screenshot',
    label: 'Capture desktop',
    icon: Camera,
    requiresApproval: true,
  },
  {
    command: 'ClickUI: inspect the active window and report visible buttons',
    action: 'clickui',
    label: 'Inspect active window',
    icon: MousePointer2,
    requiresApproval: true,
  },
  {
    command: 'OpenClaw: prepare the next safe PBK script run',
    action: 'operator_command',
    label: 'Prepare safe script',
    icon: Terminal,
    requiresApproval: true,
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
      requiresApproval: true,
    },
    {
      pattern: /\b(?:send).{0,32}(?:text|sms|message)\b|\b(?:text|sms)\s+(?:to|the)\b/i,
      action: 'send_sms',
      requiresApproval: true,
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
    return 'Command completed. Structured preview is below.';
  }
  for (const key of ['message', 'summary', 'output', 'result']) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return 'Command completed and returned a result.';
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
  if (status === 'completed') return result || 'Done. The local worker completed this command.';
  if (status === 'rejected' || status === 'cancelled') {
    return 'Denied. Ava left this command stopped.';
  }
  if (FAILED_STATUSES.has(status)) {
    const safeResult = getConversationalResultText(result);
    return safeResult
      ? `The command did not complete. ${safeResult}`
      : 'The command did not complete.';
  }
  if (status === 'approved' || status === 'dispatched' || status === 'running') {
    return 'Approved. I am waiting for the local worker to finish and I will bring the result back here.';
  }
  if (command.requiresApproval || status === 'pending_approval') {
    return `I can do this, but it needs your approval first because ${getReadableRiskReason(command)}.`;
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

export function AvaChat() {
  const { snapshot, refresh } = useRuntimeSnapshot(30000);
  const [draft, setDraft] = useState('');
  const [transcript, setTranscript] = useState('');
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<DesktopSidecarStatusResponse | null>(null);
  const [commands, setCommands] = useState<LocalCommandRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState<AvaCommandAction>('operator_command');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [submitLane, setSubmitLane] = useState<SubmitLane>('rest');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking');
  const [connectionError, setConnectionError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [decidingApprovalId, setDecidingApprovalId] = useState('');
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

  const filteredCommands = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return commands
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
            : 'Sidecar status is unavailable.'
        );
      }
      if (historyResult.status === 'fulfilled') {
        setCommands(historyResult.value.commands || []);
        successCount += 1;
      } else {
        failures.push(
          historyResult.reason instanceof Error
            ? historyResult.reason.message
            : 'Command history is unavailable.'
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
    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || searchQuery || historyFilter !== 'all') return;
    timeline.scrollTop = timeline.scrollHeight;
  }, [commands.length, historyFilter, searchQuery]);

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
      try {
        const routed = classifyConversationalCommand(command, action);
        const nextAction = routed.action;
        const nextRequiresApproval =
          routed.requiresApproval === undefined ? requiresApproval : routed.requiresApproval;
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
        result =
          submitLane === 'invoke'
            ? await executeLocalCommandRequest(payload)
            : await queueLocalCommandRequest(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Command queue failed.';
        setSubmitError(message);
        showUiToast({
          tone: 'error',
          title: 'Ava command failed',
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
        title: result.result === 'queued_for_approval' ? 'Queued for approval' : 'Command queued',
        desc: result.message || `Ava handed ${command} to the local command queue.`,
      });
      setSubmitting(false);

      const refreshResults = await Promise.allSettled([refresh(), load({ silent: true })]);
      if (refreshResults.every((item) => item.status === 'rejected')) {
        showUiToast({
          tone: 'warning',
          title: 'Command queued; refresh delayed',
          desc: 'The bridge accepted the command, but its latest status is not available yet.',
        });
      }
    },
    [action, draft, load, refresh, requiresApproval, submitLane, submitting]
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
              ? 'Ava will continue through the guarded local command path.'
              : 'Ava will leave that command stopped.',
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

  const selectQuickCommand = (item: (typeof QUICK_COMMANDS)[number]) => {
    setAction(item.action);
    setRequiresApproval(item.requiresApproval);
    setDraft(item.command);
    window.requestAnimationFrame(() => composerRef.current?.focus());
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

  return (
    <section className="pbk-ava-chat-surface h-full max-h-full min-h-0 min-w-0 overflow-hidden bg-[var(--ava-bg)] text-[var(--ava-text)]">
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <AvaIdentityBar
          state={avaState}
          connectionState={connectionState}
          sidecarConnected={Boolean(status?.connected)}
          pendingApprovals={pendingApprovals}
          loading={loading}
          onRefresh={() => void load()}
          onOpenContext={() => setContextOpen(true)}
        />

        <div className="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-[var(--ava-border)] xl:grid-rows-[auto_minmax(260px,1fr)_auto]">
            <ConversationToolbar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              filter={historyFilter}
              onFilterChange={setHistoryFilter}
            />

            <div
              ref={timelineRef}
              className="min-h-0 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6 lg:px-8"
              aria-label="Ava command conversation"
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

                {loading && commands.length === 0 ? (
                  <ConversationSkeleton />
                ) : filteredCommands.length ? (
                  <div className="space-y-7">
                    {filteredCommands.map((command) => (
                      <CommandExchange
                        key={command.id}
                        command={command}
                        onReplay={() => replayCommand(command)}
                        onApprovalDecision={handleApprovalDecision}
                        decidingApprovalId={decidingApprovalId}
                      />
                    ))}
                  </div>
                ) : commands.length ? (
                  <PbkEmpty
                    variant="idle"
                    icon={<Search size={24} />}
                    title="No matching commands"
                    description="Clear the search or choose another status to restore the conversation."
                  />
                ) : (
                  <WelcomeState onSelectQuickCommand={selectQuickCommand} />
                )}
              </div>
            </div>

            <AvaComposer
              draft={draft}
              setDraft={setDraft}
              transcript={transcript}
              action={action}
              setAction={setAction}
              requiresApproval={requiresApproval}
              setRequiresApproval={setRequiresApproval}
              submitLane={submitLane}
              setSubmitLane={setSubmitLane}
              listening={listening}
              submitting={submitting}
              speechSupported={speechSupported}
              submitError={submitError}
              textareaRef={composerRef}
              onStartListening={startListening}
              onStopListening={stopListening}
              onSubmit={() => void submitCommand()}
              onSelectQuickCommand={selectQuickCommand}
            />
          </main>

          <AvaContextRail
            action={selectedAction}
            actionIcon={<SelectedActionIcon size={17} />}
            submitLane={submitLane}
            requiresApproval={requiresApproval}
            pendingApprovals={pendingApprovals}
            status={status}
            connectionState={connectionState}
            commands={commands}
            onSelectQuickCommand={selectQuickCommand}
            className="hidden xl:block"
          />
        </div>
      </div>

      {contextOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/55 xl:hidden"
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
                <div className="pbk-eyebrow">Live context</div>
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
              submitLane={submitLane}
              requiresApproval={requiresApproval}
              pendingApprovals={pendingApprovals}
              status={status}
              connectionState={connectionState}
              commands={commands}
              onSelectQuickCommand={(item) => {
                selectQuickCommand(item);
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
  onRefresh,
  onOpenContext,
}: {
  state: 'ready' | 'listening' | 'thinking' | 'working' | 'offline';
  connectionState: ConnectionState;
  sidecarConnected: boolean;
  pendingApprovals: number;
  loading: boolean;
  onRefresh: () => void;
  onOpenContext: () => void;
}) {
  const stateLabel = {
    ready: 'Ready when you are',
    listening: 'Listening',
    thinking: 'Thinking',
    working: 'Working with OpenClaw',
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
          label="Bridge"
          value={connectionState === 'connected' ? 'Connected' : connectionState}
          healthy={connectionState === 'connected'}
        />
        <HeaderHealth
          label="Sidecar"
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
        <button
          type="button"
          className="grid size-11 place-items-center rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel-elevated)] text-[var(--ava-text-muted)] transition hover:text-[var(--ava-text)] xl:hidden"
          onClick={onOpenContext}
          aria-label="Open Ava context"
        >
          <Settings2 size={18} />
        </button>
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
        <span className="sr-only">Search Ava history</span>
        <Search
          size={17}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ava-text-faint)]"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search command history"
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
        <span className="sr-only">Filter command history</span>
        <Filter
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ava-text-faint)]"
        />
        <select
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
          <div className="mt-1.5 flex items-center justify-end gap-2 font-mono text-[10px] uppercase text-[var(--ava-text-faint)]">
            <ActionIcon size={12} />
            <span>{actionConfig.label}</span>
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
              <div className="mt-3 rounded-xl border border-[var(--ava-warning-border)] bg-[var(--ava-warning-soft)] p-2">
                <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold text-[var(--ava-warning)]">
                  <ShieldCheck size={14} />
                  Approval required before Ava continues
                </div>
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
            <span
              className={[
                'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                riskLevel === 'low'
                  ? 'border-[var(--ava-success-border)] bg-[var(--ava-success-soft)] text-[var(--ava-success)]'
                  : riskLevel === 'high'
                    ? 'border-[var(--ava-danger-border)] bg-[var(--ava-danger-soft)] text-[var(--ava-danger)]'
                    : 'border-[var(--ava-warning-border)] bg-[var(--ava-warning-soft)] text-[var(--ava-warning)]',
              ].join(' ')}
            >
              {riskLevel} risk
            </span>
            <span className="text-[var(--ava-text-faint)]">
              {command.requiresApproval ? 'Approval gated' : 'Trusted read-only auto-run'}
            </span>
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 font-semibold text-[var(--ava-sky)] transition hover:bg-[var(--ava-sky-soft)]"
              onClick={onReplay}
            >
              <RotateCcw size={14} />
              Replay
            </button>
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
  setAction,
  requiresApproval,
  setRequiresApproval,
  submitLane,
  setSubmitLane,
  listening,
  submitting,
  speechSupported,
  submitError,
  textareaRef,
  onStartListening,
  onStopListening,
  onSubmit,
  onSelectQuickCommand,
}: {
  draft: string;
  setDraft: (value: string) => void;
  transcript: string;
  action: AvaCommandAction;
  setAction: (value: AvaCommandAction) => void;
  requiresApproval: boolean;
  setRequiresApproval: (value: boolean) => void;
  submitLane: SubmitLane;
  setSubmitLane: (value: SubmitLane) => void;
  listening: boolean;
  submitting: boolean;
  speechSupported: boolean;
  submitError: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onStartListening: () => void;
  onStopListening: () => void;
  onSubmit: () => void;
  onSelectQuickCommand: (item: (typeof QUICK_COMMANDS)[number]) => void;
}) {
  const actionConfig = ACTIONS.find((item) => item.id === action) || ACTIONS[0];
  const ActionIcon = actionConfig.icon;

  return (
    <div className="pbk-ava-chat-composer border-t border-[var(--ava-border)] bg-[var(--ava-bg)] px-2 pt-2 sm:px-5 sm:pb-4 sm:pt-3">
      <div className="mx-auto w-full max-w-4xl">
        <div className="pbk-ava-chat-quick-strip mb-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {QUICK_COMMANDS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.command}
                type="button"
                onClick={() => onSelectQuickCommand(item)}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)] px-3 text-xs text-[var(--ava-text-muted)] transition hover:border-[var(--ava-sky)] hover:text-[var(--ava-text)]"
              >
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </div>

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
            Ask Ava to run a local command
          </label>
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
            placeholder="Ask Ava to inspect, prepare, check, or run something..."
          />

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

              <details className="group relative min-w-0 flex-1 sm:flex-none">
                <summary className="flex min-h-11 w-full cursor-pointer list-none items-center gap-2 rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)] px-3 text-xs font-semibold">
                  <ActionIcon size={16} />
                  <span className="min-w-0 flex-1 truncate text-left">{actionConfig.label}</span>
                  <ChevronDown size={14} className="shrink-0 transition group-open:rotate-180" />
                </summary>
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[min(320px,calc(100vw-32px))] rounded-xl border border-[var(--ava-border)] bg-[var(--ava-panel-elevated)] p-2 shadow-2xl">
                  <div role="radiogroup" aria-label="Ava command action" className="grid gap-1">
                    {ACTIONS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="radio"
                          aria-checked={action === item.id}
                          onClick={(event) => {
                            setAction(item.id);
                            event.currentTarget.closest('details')?.removeAttribute('open');
                          }}
                          className={[
                            'flex min-h-11 items-start gap-3 rounded-lg p-2 text-left transition',
                            action === item.id
                              ? 'bg-[var(--ava-sky-soft)] text-[var(--ava-text)]'
                              : 'text-[var(--ava-text-muted)] hover:bg-[var(--ava-hover)]',
                          ].join(' ')}
                        >
                          <Icon size={17} className="mt-0.5 shrink-0" />
                          <span>
                            <span className="block text-xs font-semibold">{item.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-4">
                              {item.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </details>

              <details className="group relative hidden sm:block">
                <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-lg border border-[var(--ava-border)] text-[var(--ava-text-muted)]">
                  <Settings2 size={17} />
                  <span className="sr-only">Advanced command settings</span>
                </summary>
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-72 rounded-xl border border-[var(--ava-border)] bg-[var(--ava-panel-elevated)] p-3 shadow-2xl">
                  <AdvancedSettings
                    requiresApproval={requiresApproval}
                    setRequiresApproval={setRequiresApproval}
                    submitLane={submitLane}
                    setSubmitLane={setSubmitLane}
                  />
                </div>
              </details>

              <button
                type="button"
                className={[
                  'grid size-11 place-items-center rounded-lg border sm:hidden',
                  requiresApproval
                    ? 'border-[var(--ava-warning-border)] bg-[var(--ava-warning-soft)] text-[var(--ava-warning)]'
                    : 'border-[var(--ava-border)] text-[var(--ava-text-muted)]',
                ].join(' ')}
                onClick={() => setRequiresApproval(!requiresApproval)}
                aria-label={
                  requiresApproval ? 'Disable requested approval' : 'Request approval for command'
                }
                aria-pressed={requiresApproval}
              >
                <ShieldCheck size={17} />
              </button>

              <PbkButton
                type="button"
                variant="sky-gradient"
                className="min-h-11 min-w-11 shrink-0 justify-center p-0 sm:hidden"
                disabled={!draft.trim() || submitting}
                onClick={onSubmit}
                aria-label="Send command to Ava"
              >
                {submitting ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}
              </PbkButton>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <span className="hidden max-w-48 truncate text-xs text-[var(--ava-text-faint)] lg:block">
                {listening
                  ? transcript || 'Listening...'
                  : requiresApproval
                    ? 'Approval protected'
                    : 'Low-risk only'}
              </span>
              <PbkButton
                type="button"
                variant="sky-gradient"
                className="min-h-11 min-w-11 justify-center px-3"
                disabled={!draft.trim() || submitting}
                onClick={onSubmit}
                aria-label="Send command to Ava"
              >
                {submitting ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}
                <span className="hidden sm:inline">{submitting ? 'Sending' : 'Send'}</span>
              </PbkButton>
            </div>
          </div>
        </div>
        <p className="pbk-ava-chat-mobile-note mt-1.5 text-center text-[10px] text-[var(--ava-text-faint)]">
          Ava can make mistakes. Review important actions before approval.
        </p>
      </div>
    </div>
  );
}

function AdvancedSettings({
  requiresApproval,
  setRequiresApproval,
  submitLane,
  setSubmitLane,
  compact = false,
}: {
  requiresApproval: boolean;
  setRequiresApproval: (value: boolean) => void;
  submitLane: SubmitLane;
  setSubmitLane: (value: SubmitLane) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'flex flex-wrap items-center justify-between gap-2' : 'space-y-4'}>
      <div>
        {!compact && <div className="pbk-label mb-2">Execution lane</div>}
        <div
          role="radiogroup"
          aria-label="Execution lane"
          className="flex rounded-lg bg-[var(--ava-bg)] p-1"
        >
          {(['rest', 'invoke'] as const).map((lane) => (
            <button
              key={lane}
              type="button"
              role="radio"
              aria-checked={submitLane === lane}
              onClick={() => setSubmitLane(lane)}
              className={[
                'min-h-9 rounded-md px-3 text-xs font-semibold transition',
                submitLane === lane
                  ? 'bg-[var(--ava-panel)] text-[var(--ava-text)] shadow-sm'
                  : 'text-[var(--ava-text-faint)]',
              ].join(' ')}
            >
              {lane === 'rest' ? 'Bridge queue' : 'Invoke tool'}
            </button>
          ))}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-3">
        {!compact && (
          <span>
            <span className="block text-xs font-semibold">Require approval</span>
            <span className="mt-0.5 block text-[11px] text-[var(--ava-text-faint)]">
              The server still enforces risk policy.
            </span>
          </span>
        )}
        {compact && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ava-text-muted)]">
            <ShieldCheck size={14} />
            Approval
          </span>
        )}
        <input
          type="checkbox"
          checked={requiresApproval}
          onChange={(event) => setRequiresApproval(event.target.checked)}
          className="peer sr-only"
        />
        <span className="relative h-6 w-11 rounded-full bg-[var(--ava-border-bright)] transition peer-checked:bg-[var(--ava-sky)] after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
      </label>
    </div>
  );
}

function AvaContextRail({
  action,
  actionIcon,
  submitLane,
  requiresApproval,
  pendingApprovals,
  status,
  connectionState,
  commands,
  onSelectQuickCommand,
  className = '',
}: {
  action: (typeof ACTIONS)[number];
  actionIcon: ReactNode;
  submitLane: SubmitLane;
  requiresApproval: boolean;
  pendingApprovals: number;
  status: DesktopSidecarStatusResponse | null;
  connectionState: ConnectionState;
  commands: LocalCommandRecord[];
  onSelectQuickCommand: (item: (typeof QUICK_COMMANDS)[number]) => void;
  className?: string;
}) {
  const completedCount = commands.filter(
    (command) => String(command.status || '').toLowerCase() === 'completed'
  ).length;

  return (
    <aside className={`min-h-0 overflow-y-auto bg-[var(--ava-bg)] p-4 ${className}`}>
      <div className="space-y-3">
        <ContextPanel title="Now" icon={<Sparkles size={16} />}>
          <ContextRow label="Selected action">
            <span className="inline-flex items-center gap-2 font-semibold">
              {actionIcon}
              {action.label}
            </span>
          </ContextRow>
          <ContextRow label="Execution lane">
            <span>
              {submitLane === 'rest' ? 'Conversational bridge queue' : 'Direct invoke lane'}
            </span>
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

        <ContextPanel title="Quick actions" icon={<MonitorUp size={16} />}>
          <div className="space-y-1.5">
            {QUICK_COMMANDS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.command}
                  type="button"
                  onClick={() => onSelectQuickCommand(item)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-[var(--ava-border)] px-3 text-left text-xs text-[var(--ava-text-muted)] transition hover:border-[var(--ava-sky)] hover:text-[var(--ava-text)]"
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </ContextPanel>

        <ContextPanel title="Local system" icon={<Cpu size={16} />}>
          <SystemHealthRow
            label="PBK bridge"
            value={connectionState === 'connected' ? 'Healthy' : 'Degraded'}
            healthy={connectionState === 'connected'}
          />
          <SystemHealthRow
            label="OpenClaw sidecar"
            value={status?.connected ? `${status.connectedCount || 1} connected` : 'Waiting'}
            healthy={Boolean(status?.connected)}
          />
          <SystemHealthRow
            label="Recent commands"
            value={`${commands.length} loaded`}
            healthy={commands.length > 0}
          />
          <SystemHealthRow
            label="Completed"
            value={`${completedCount}`}
            healthy={completedCount > 0}
          />
        </ContextPanel>

        <ContextPanel title="Debug log" icon={<Terminal size={16} />}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-[var(--ava-border)] px-3 py-2 text-xs font-semibold text-[var(--ava-text-muted)]">
              Source and transport details
              <ChevronDown size={14} className="transition group-open:rotate-180" />
            </summary>
            <div className="mt-2 space-y-2">
              <PbkDataSource endpoint="POST /api/local/commands" status="ships" />
              <PbkDataSource endpoint="GET /api/desktop-sidecar/status" status="ships" />
              <PbkDataSource endpoint="POST /invoke executeLocalCommand" status="ships" />
            </div>
          </details>
        </ContextPanel>
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
  onSelectQuickCommand,
}: {
  onSelectQuickCommand: (item: (typeof QUICK_COMMANDS)[number]) => void;
}) {
  return (
    <div className="grid min-h-[340px] place-items-center py-8 text-center">
      <div className="max-w-xl">
        <div className="mx-auto mb-5 w-fit">
          <AvaPresenceOrb state="ready" />
        </div>
        <div className="pbk-eyebrow">Senior acquisition operator</div>
        <h2 className="mt-2 font-[var(--font-display)] text-3xl font-semibold">
          What should we handle next?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--ava-text-muted)]">
          Ask Ava to inspect the local desktop, check system health, prepare a safe action, or send
          work to OpenClaw. Risky commands remain approval-gated by the bridge.
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {QUICK_COMMANDS.slice(0, 4).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.command}
                type="button"
                onClick={() => onSelectQuickCommand(item)}
                className="flex min-h-12 items-center gap-3 rounded-lg border border-[var(--ava-border)] bg-[var(--ava-panel)] px-3 text-left text-xs text-[var(--ava-text-muted)] transition hover:border-[var(--ava-sky)] hover:text-[var(--ava-text)]"
              >
                <Icon size={17} className="shrink-0 text-[var(--ava-sky)]" />
                {item.label}
              </button>
            );
          })}
        </div>
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
