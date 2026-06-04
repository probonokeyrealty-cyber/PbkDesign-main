import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { CallFloorPanel } from '../components/CallFloorPanel';
import { LiveCallWidget } from '../components/shell/LiveCallWidget';
import type { LiveCallState, TranscriptLine } from '../components/shell/LiveCallWidget';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  controlRuntimeCall,
  fetchWebSearchStatusRequest,
  updateAdminTaskDecision,
  updateApprovalDecision,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

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
  const announcedCallRef = useRef('');

  const approvals = Array.isArray(snapshot?.approvals) ? snapshot.approvals : [];
  const adminTasks = Array.isArray(snapshot?.adminTasks) ? snapshot.adminTasks : [];
  const leadImports = Array.isArray(snapshot?.leadImports) ? snapshot.leadImports : [];
  const activity = Array.isArray(snapshot?.activity) ? snapshot.activity.slice(0, 8) : [];
  const calls = Array.isArray(snapshot?.calls) ? snapshot.calls : [];
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
  const toolingSummary = (tooling?.summary || {}) as Record<string, unknown>;
  const toolingCoreReady =
    toNumber(toolingSummary.requiredReadyCount, toNumber(toolingSummary.readyCount, 0)) || 0;
  const toolingCoreTotal =
    toNumber(toolingSummary.requiredCount, toNumber(toolingSummary.totalCount, 0)) || 0;
  const toolingOptionalReady = toNumber(toolingSummary.optionalReadyCount, 0) || 0;
  const toolingOptionalTotal = toNumber(toolingSummary.optionalCount, 0) || 0;
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

  const kpis = [
    { label: 'Active Leads', value: String(leadImports.length), hint: 'live from bridge intake' },
    { label: 'Calls Today', value: String(calls.length), hint: 'Telnyx + bridge runtime' },
    {
      label: 'Approvals Needed',
      value: String(approvals.filter((item) => item.status === 'pending').length),
      hint: `${adminTasks.filter((item) => item.status === 'pending').length} admin approvals waiting`,
    },
    {
      label: 'Deals in Pipeline',
      value: String((snapshot?.contracts || []).length),
      hint: 'prepared, sent, or signed contracts',
    },
    {
      label: 'Tooling Ready',
      value: `${String(toolingCoreReady)}/${String(toolingCoreTotal)}`,
      hint: toolingOptionalTotal
        ? `${String(toolingOptionalReady)}/${String(toolingOptionalTotal)} optional add-ons enabled`
        : 'advanced systems available in repo',
    },
  ];

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
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Command Center</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live agent activity, approvals, contracts, and admin operations.
          </p>
        </div>
        <div
          className="inline-flex items-center gap-2 self-start rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400 md:self-auto"
          aria-live="polite"
        >
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-slate-800 bg-slate-950 p-4 transition-colors hover:border-slate-700"
          >
            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
              {kpi.label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-100 tabular-nums">
              {kpi.value}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">{kpi.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5 space-y-4">
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

          <CallFloorPanel leads={leadImports} calls={calls} />

          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
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
                        {pendingAction === `admin:${String(task.id)}:approved` ? '…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        disabled={pendingAction === `admin:${String(task.id)}:rejected`}
                        onClick={() => confirmAdminDecision(task, 'rejected')}
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        {pendingAction === `admin:${String(task.id)}:rejected` ? '…' : 'Decline'}
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
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
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
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
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
                      <div className="min-w-0 text-xs font-medium text-slate-200">{item.label}</div>
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
          </section>
        </div>

        <div className="xl:col-span-7 space-y-4">
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Activity Feed</h2>
                <p className="text-xs text-slate-500">Recent Ava, Rex, and provider events.</p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {activity.map((item, index) => (
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
                  <div className="mt-2 text-xs text-slate-300">
                    {String(item.text || 'Runtime event')}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 uppercase tracking-[0.12em]">
                    {String(item.category || 'INFO')}
                  </div>
                </div>
              ))}
              {!activity.length && (
                <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                  The bridge has not recorded activity yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
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
                    className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3"
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
          </section>
        </div>
      </div>

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
            <h3 id="approval-decision-title" className="mt-2 text-lg font-semibold text-slate-100">
              Confirm approval decision
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              This will {approvalDecisionDraft.actionLabel}{' '}
              <span className="font-semibold text-slate-200">{approvalDecisionDraft.type}</span> for{' '}
              {approvalDecisionDraft.leadName}.
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
  );
}
