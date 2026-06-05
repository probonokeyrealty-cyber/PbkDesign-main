import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Loader2,
  Mic,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react';
import {
  PbkButton,
  PbkDataSource,
  PbkEmpty,
  PbkPanel,
  PbkPulseDot,
} from '../../components/pbk/index';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  executeLocalCommandRequest,
  fetchDesktopSidecarStatusRequest,
  fetchLocalCommandsRequest,
  queueLocalCommandRequest,
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
  | 'llm_query';
type SubmitLane = 'rest' | 'invoke';

const ACTIONS: Array<{
  id: AvaCommandAction;
  label: string;
  description: string;
}> = [
  {
    id: 'operator_command',
    label: 'OpenClaw',
    description: 'Natural-language desktop instruction queued for the local worker.',
  },
  {
    id: 'clickui',
    label: 'ClickUI',
    description: 'GUI-control intent for the ClickUI local automation lane.',
  },
  {
    id: 'status',
    label: 'Status',
    description: 'Low-risk sidecar health check.',
  },
  {
    id: 'screenshot',
    label: 'Screenshot',
    description: 'Ask the connected desktop sidecar to observe the screen after approval.',
  },
  {
    id: 'type_text',
    label: 'Type text',
    description: 'Keyboard automation. Always approval-gated.',
  },
  {
    id: 'llm_query',
    label: 'Local LLM',
    description: 'Send a question to the local CPU LLM sidecar if configured.',
  },
];

const QUICK_COMMANDS = [
  'Check OpenClaw sidecar status',
  'Take a screenshot of the current desktop',
  'ClickUI: inspect the active window and report visible buttons',
  'OpenClaw: prepare the next safe PBK script run',
];

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
  return String(status || 'queued').replace(/_/g, ' ');
}

function getCommandTone(command: LocalCommandRecord) {
  const status = String(command.status || '').toLowerCase();
  if (status === 'completed') return 'text-emerald-300 border-emerald-400/20 bg-emerald-400/10';
  if (status === 'failed' || status === 'rejected')
    return 'text-rose-300 border-rose-400/20 bg-rose-400/10';
  if (status === 'approved') return 'text-sky-200 border-sky-400/20 bg-sky-400/10';
  return 'text-amber-200 border-amber-400/20 bg-amber-400/10';
}

function buildCommandParams(action: AvaCommandAction, command: string) {
  if (action === 'type_text') {
    return {
      text: command.replace(/^type\s+/i, ''),
      allowAutomation: false,
    };
  }
  if (action === 'llm_query') return { prompt: command };
  return {};
}

export function AvaChat() {
  const { snapshot, refresh } = useRuntimeSnapshot(10000);
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
  const [error, setError] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sidecar, history] = await Promise.all([
        fetchDesktopSidecarStatusRequest(),
        fetchLocalCommandsRequest({ limit: 30 }),
      ]);
      setStatus(sidecar);
      setCommands(history.commands || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ava command bridge is unavailable.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

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
      setError('');
      try {
        const payload = {
          command,
          action,
          params: buildCommandParams(action, command),
          requestedBy: 'ava-chat-page',
          source: 'ava-chat',
          requiresApproval,
        };
        const result =
          submitLane === 'invoke'
            ? await executeLocalCommandRequest(payload)
            : await queueLocalCommandRequest(payload);
        const nextCommand = result.command;
        if (nextCommand) {
          setCommands((current) => [
            nextCommand,
            ...current.filter((item) => item.id !== nextCommand.id),
          ]);
        }
        setDraft('');
        setTranscript(command);
        await refresh();
        await load();
        showUiToast({
          tone: 'success',
          title: result.result === 'queued_for_approval' ? 'Queued for approval' : 'Command queued',
          desc: result.message || `Ava handed ${action} to the local command queue.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Command queue failed.';
        setError(message);
        showUiToast({
          tone: 'error',
          title: 'Ava command failed',
          desc: message,
          critical: true,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [action, draft, load, refresh, requiresApproval, submitLane, submitting]
  );

  const startListening = () => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setError('This browser does not expose SpeechRecognition or webkitSpeechRecognition.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setError(event.error || 'Voice recognition stopped.');
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
      if (last?.isFinal && text) {
        void submitCommand(text);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <section className="min-h-full bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5 p-4 sm:p-5 xl:p-6">
        <div className="overflow-hidden rounded-[28px] border border-sky-400/15 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.24),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] shadow-2xl shadow-sky-950/30">
          <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] lg:p-7">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200">
                  Ava local command center
                </span>
                <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-200">
                  OpenClaw + ClickUI
                </span>
              </div>
              <h1 className="pbk-display text-3xl leading-tight sm:text-4xl lg:text-5xl">
                Ava Chat with voice-controlled local operations.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                Speak or type a command once. Ava queues it in the bridge, creates approval when
                needed, then your local OpenClaw or ClickUI worker can execute from the same durable
                Supabase-backed command record.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <StatusTile
                  icon={<Radio size={18} />}
                  label="Render bridge"
                  value={error ? 'Needs attention' : 'Online path'}
                  tone={error ? 'amber' : 'lime'}
                />
                <StatusTile
                  icon={<Cpu size={18} />}
                  label="OpenClaw sidecar"
                  value={status?.connected ? `${status.connectedCount || 1} connected` : 'Waiting'}
                  tone={status?.connected ? 'lime' : 'amber'}
                />
                <StatusTile
                  icon={<ShieldCheck size={18} />}
                  label="Local approvals"
                  value={`${pendingApprovals} pending`}
                  tone={pendingApprovals ? 'amber' : 'sky'}
                />
              </div>
            </div>

            <PbkPanel elevated className="bg-slate-950/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="pbk-eyebrow">Queue health</div>
                  <h2 className="text-lg font-semibold text-white">Desktop command lane</h2>
                </div>
                <PbkButton
                  size="sm"
                  onClick={load}
                  disabled={loading}
                  aria-label="Refresh Ava command status"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" size={15} />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  Refresh
                </PbkButton>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <div className="flex items-center justify-between gap-3">
                  <span>Sidecar connection</span>
                  <span className="inline-flex items-center gap-2 font-medium text-slate-100">
                    <PbkPulseDot color={status?.connected ? 'lime' : 'amber'} />
                    {status?.connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Bridge queue</span>
                  <span className="font-mono text-xs text-sky-200">
                    {commands.length} recent commands
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Last command</span>
                  <span
                    className="max-w-[180px] truncate text-right"
                    title={latestCommand?.command || ''}
                  >
                    {latestCommand?.command || 'None yet'}
                  </span>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <PbkDataSource endpoint="POST /api/local/commands" status="ships" />
                <PbkDataSource endpoint="GET /api/desktop-sidecar/status" status="ships" />
                <PbkDataSource endpoint="POST /invoke executeLocalCommand" status="ships" />
              </div>
            </PbkPanel>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <PbkPanel elevated className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="pbk-eyebrow">Command composer</div>
                <h2 className="text-xl font-semibold text-white">Tell Ava what to queue</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                  Commands are auditable. Only low-risk status checks can bypass approval; desktop
                  automation remains approval-gated.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <PbkButton
                  type="button"
                  variant={listening ? 'danger' : 'primary'}
                  onClick={listening ? stopListening : startListening}
                  disabled={!speechSupported || submitting}
                  title={
                    speechSupported
                      ? 'Use browser speech recognition'
                      : 'Speech recognition is not available in this browser'
                  }
                >
                  {listening ? <Square size={16} /> : <Mic size={16} />}
                  {listening ? 'Stop' : 'Speak'}
                </PbkButton>
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-3 text-sm text-rose-100">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle size={16} />
                  Ava command bridge needs attention
                </div>
                <p className="mt-1 text-rose-100/80">{error}</p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ACTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAction(item.id)}
                  className={[
                    'rounded-2xl border p-3 text-left transition',
                    action === item.id
                      ? 'border-sky-300/50 bg-sky-400/15 text-white shadow-lg shadow-sky-950/30'
                      : 'border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500',
                  ].join(' ')}
                  aria-pressed={action === item.id}
                >
                  <div className="font-semibold">{item.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{item.description}</div>
                </button>
              ))}
            </div>

            <label className="block">
              <span className="pbk-label">Voice or typed command</span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={6}
                className="mt-2 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                placeholder="Example: ClickUI: inspect the active window and report visible buttons"
              />
            </label>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${requiresApproval ? 'border-amber-300/40 bg-amber-300/10 text-amber-100' : 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'}`}
                  onClick={() => setRequiresApproval((current) => !current)}
                  aria-pressed={requiresApproval}
                >
                  Approval {requiresApproval ? 'required' : 'low-risk only'}
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${submitLane === 'rest' ? 'border-sky-300/40 bg-sky-300/10 text-sky-100' : 'border-slate-700 text-slate-300'}`}
                  onClick={() => setSubmitLane('rest')}
                  aria-pressed={submitLane === 'rest'}
                >
                  REST queue
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${submitLane === 'invoke' ? 'border-sky-300/40 bg-sky-300/10 text-sky-100' : 'border-slate-700 text-slate-300'}`}
                  onClick={() => setSubmitLane('invoke')}
                  aria-pressed={submitLane === 'invoke'}
                >
                  Invoke tool
                </button>
              </div>
              <PbkButton
                type="button"
                variant="sky-gradient"
                disabled={!draft.trim() || submitting}
                onClick={() => void submitCommand()}
              >
                {submitting ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                Queue command
              </PbkButton>
            </div>

            {transcript && (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
                <span className="font-semibold text-slate-100">Last transcript:</span> {transcript}
              </div>
            )}
          </PbkPanel>

          <aside className="space-y-5">
            <PbkPanel elevated>
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-sky-300" />
                <h2 className="text-lg font-semibold text-white">Quick prompts</h2>
              </div>
              <div className="mt-4 space-y-2">
                {QUICK_COMMANDS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setDraft(item)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-left text-sm text-slate-300 transition hover:border-sky-400/40 hover:text-white"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </PbkPanel>

            <PbkPanel elevated>
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-300" />
                <h2 className="text-lg font-semibold text-white">Safety alignment</h2>
              </div>
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                <li className="flex gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                  Commands persist to `pbk_local_commands`.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                  Approval records unlock local execution.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                  OpenClaw/ClickUI workers report results back to the bridge.
                </li>
              </ul>
            </PbkPanel>
          </aside>
        </div>

        <PbkPanel elevated>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="pbk-eyebrow">Command history</div>
              <h2 className="text-xl font-semibold text-white">Bridge-backed local command log</h2>
            </div>
            <PbkDataSource endpoint="GET /api/local/commands" status="ships" />
          </div>
          {loading ? (
            <div className="grid gap-3 md:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-28 animate-pulse rounded-2xl bg-slate-800/70" />
              ))}
            </div>
          ) : commands.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {commands.map((command) => (
                <article
                  key={command.id}
                  className={`rounded-2xl border p-4 ${getCommandTone(command)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-white" title={command.command}>
                        {command.command || 'Local command'}
                      </div>
                      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] opacity-80">
                        {command.action || 'operator_command'} · {normalizeStatus(command.status)}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[10px] font-bold uppercase">
                      {command.requiresApproval ? 'gated' : 'low-risk'}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-slate-400">Created</dt>
                      <dd className="text-slate-100">{formatRelative(command.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Completed</dt>
                      <dd className="text-slate-100">{formatRelative(command.completedAt)}</dd>
                    </div>
                  </dl>
                  {command.error && <p className="mt-3 text-xs text-rose-100">{command.error}</p>}
                </article>
              ))}
            </div>
          ) : (
            <PbkEmpty
              variant="idle"
              icon={<Terminal size={24} />}
              title="No local commands queued"
              description="Speak or type the first Ava command to create a durable OpenClaw/ClickUI queue record."
            />
          )}
        </PbkPanel>
      </div>
    </section>
  );
}

function StatusTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'lime' | 'amber' | 'sky';
}) {
  const toneClass =
    tone === 'lime'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
      : tone === 'amber'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
        : 'border-sky-400/20 bg-sky-400/10 text-sky-100';
  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] opacity-80">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  );
}
