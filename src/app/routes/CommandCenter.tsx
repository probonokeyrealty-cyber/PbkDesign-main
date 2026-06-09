import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { RefreshCw } from 'lucide-react';
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
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatMoney(value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
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
  if (normalized === 'ended' || normalized === 'completed' || normalized === 'failed') return 'ended';
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
    agentMode: String(call.agentMode || call.mode || 'autopilot') === 'human' ? 'human' : 'autopilot',
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

const ACTIVE_CALL_STATUSES = new Set(['live', 'connected', 'dialing', 'queued', 'on-hold']);

export function CommandCenter() {
  const navigate = useNavigate();
  const { snapshot, tooling, loading, error, refresh } = useRuntimeSnapshot();
  const [actionStatus, setActionStatus] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState<Record<string, string>>({});
  const announcedCallRef = useRef('');

  // Auto-clear action status after 5 seconds
  useEffect(() => {
    if (!actionStatus) return;
    const t = window.setTimeout(() => setActionStatus(''), 5000);
    return () => window.clearTimeout(t);
  }, [actionStatus]);

  const approvals = Array.isArray(snapshot?.approvals) ? snapshot.approvals : [];
  const adminTasks = Array.isArray(snapshot?.adminTasks) ? snapshot.adminTasks : [];
  const leadImports = Array.isArray(snapshot?.leadImports) ? snapshot.leadImports : [];
  const activity = Array.isArray(snapshot?.activity) ? snapshot.activity.slice(0, 8) : [];
  const calls = Array.isArray(snapshot?.calls) ? snapshot.calls : [];
  const contracts = Array.isArray(snapshot?.contracts) ? snapshot.contracts : [];

  // Filter calls to today only
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const callsToday = calls.filter((call) => {
    const ts = String((call as Record<string, unknown>).createdAt || '');
    if (!ts) return false;
    return new Date(ts) >= todayStart;
  });

  // Active contracts (not closed/cancelled)
  const activeContracts = contracts.filter((c) => {
    const s = String((c as Record<string, unknown>).status || '').toLowerCase();
    return !['cancelled', 'voided', 'expired'].includes(s);
  });

  const runtimeProviders = (snapshot?.status?.providers || {}) as Record<string, Record<string, unknown>>;
  const webSearchStatus = runtimeProviders.webSearch || {};
  const webSearchNeuralOutput = (webSearchStatus.neuralOutput || {}) as Record<string, unknown>;
  const webSearchLiveReady = Boolean(webSearchStatus.liveReady);
  const webSearchFallbackProvider = String(webSearchStatus.fallbackProvider || 'pbk_brain').replace(/_/g, ' ');
  const webSearchPrimaryProvider = String(
    webSearchStatus.primaryProvider || (webSearchLiveReady ? 'tavily' : webSearchFallbackProvider)
  ).replace(/_/g, ' ');
  const webSearchMissing = Array.isArray(webSearchStatus.missing)
    ? webSearchStatus.missing.map(String).filter(Boolean)
    : [];

  // Only show an active call — do NOT fall back to stale ended calls
  const activeCall = mapRuntimeCall(
    calls.find((call) => ACTIVE_CALL_STATUSES.has(String((call as Record<string, unknown>).status || '').toLowerCase()))
  );

  // Call status toast — only fires when callId+status changes, not on caller name enrichment
  useEffect(() => {
    if (!activeCall?.callId || activeCall.status === 'idle') return;
    const key = `${activeCall.callId}:${activeCall.status}`;
    if (announcedCallRef.current === key) return;
    announcedCallRef.current = key;
    if (activeCall.status === 'dialing' || activeCall.status === 'connected') {
      showUiToast({
        tone: 'info',
        title: activeCall.status === 'dialing' ? 'Call is dialing' : 'Call connected',
        desc: `${activeCall.caller?.name || 'Unknown caller'} · ${activeCall.caller?.phone || 'no phone'}`,
      });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('PBK call floor', {
          body: `${activeCall.status === 'dialing' ? 'Dialing' : 'Connected'}: ${activeCall.caller?.name || 'Unknown caller'}`,
        });
      }
    }
    if (activeCall.status === 'ended') {
      showUiToast({ tone: 'success', title: 'Call ended', desc: 'Outcome summary will appear when the provider event includes disposition.' });
    }
  // Intentionally keyed only on callId+status to avoid re-firing when the bridge enriches caller info mid-call
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.callId, activeCall?.status]);

  const toolingSummary = (tooling?.summary || {}) as Record<string, unknown>;
  const toolingCoreReady = toNumber(toolingSummary.requiredReadyCount, toNumber(toolingSummary.readyCount, 0)) || 0;
  const toolingCoreTotal = toNumber(toolingSummary.requiredCount, toNumber(toolingSummary.totalCount, 0)) || 0;
  const toolingOptionalReady = toNumber(toolingSummary.optionalReadyCount, 0) || 0;
  const toolingOptionalTotal = toNumber(toolingSummary.optionalCount, 0) || 0;

  // Only reference fields that exist on RuntimeToolingStatus
  const toolingHighlights = [
    { label: 'Meta-Agent', meta: tooling?.metaAgent as Record<string, unknown> | undefined },
    { label: 'BrowserOS Agent', meta: tooling?.browserOs as Record<string, unknown> | undefined },
    { label: 'Browser Research', meta: tooling?.browserResearch as Record<string, unknown> | undefined },
    { label: 'Workflow Ops', meta: tooling?.workflowOps as Record<string, unknown> | undefined },
    { label: 'Context7 Docs', meta: tooling?.context7 as Record<string, unknown> | undefined },
    { label: 'GitHub Integration', meta: tooling?.github as Record<string, unknown> | undefined },
    { label: 'Observability', meta: tooling?.observability as Record<string, unknown> | undefined },
  ];

  const pendingApprovals = approvals.filter((item) => item.status === 'pending');

  const kpis = [
    {
      label: 'Leads Imported',
      value: String(leadImports.length),
      hint: 'bridge lead intake batches',
    },
    {
      label: 'Calls Today',
      value: String(callsToday.length),
      hint: `${calls.length} total · Telnyx + bridge`,
    },
    {
      label: 'Approvals Needed',
      value: String(pendingApprovals.length),
      hint: `${adminTasks.filter((item) => item.status === 'pending').length} admin approvals waiting`,
    },
    {
      label: 'Deals in Pipeline',
      value: String(activeContracts.length),
      hint: `${contracts.length} total contracts on file`,
    },
    {
      label: 'Tooling Ready',
      value: `${String(toolingCoreReady)}/${String(toolingCoreTotal)}`,
      hint: toolingOptionalTotal
        ? `${String(toolingOptionalReady)}/${String(toolingOptionalTotal)} optional add-ons enabled`
        : 'advanced systems available in repo',
    },
  ];

  const runRuntimeAction = async (key: string, successMessage: string, action: () => Promise<void>) => {
    setPendingAction(key);
    setActionStatus('');
    try {
      await action();
      await refresh().catch(() => null);
      setActionStatus(successMessage);
    } catch (nextError) {
      setActionStatus(nextError instanceof Error ? nextError.message : 'Runtime action failed.');
    } finally {
      setPendingAction('');
    }
  };

  const runWebSearchProbe = async () => {
    setPendingAction('web-search:probe');
    setActionStatus('');
    try {
      const result = await fetchWebSearchStatusRequest();
      const status = (result.status || {}) as Record<string, unknown>;
      const neuralOutput = (status.neuralOutput || {}) as Record<string, unknown>;
      const provider = String(status.primaryProvider || webSearchPrimaryProvider).replace(/_/g, ' ');
      const liveLabel = status.liveReady ? 'live Tavily' : 'fallback';
      const spikeVersion = String(neuralOutput.spikeVersion || 'pbk-web-search-spikes-v1');
      setActionStatus(`Web-search is ${liveLabel} via ${provider}; ${spikeVersion} and symbolic facts are available.`);
      await refresh().catch(() => null);
    } catch (nextError) {
      setActionStatus(nextError instanceof Error ? nextError.message : 'Web-search status probe failed.');
    } finally {
      setPendingAction('');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      // error already handled in useRuntimeSnapshot
    } finally {
      setRefreshing(false);
    }
  };

  const isSyncing = loading || refreshing;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Command Center</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live agent activity, approvals, contracts, and admin operations.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => { void handleRefresh(); }}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:cursor-wait disabled:opacity-50"
            title="Force sync from bridge"
          >
            <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <div
            className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/70 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400"
            aria-live="polite"
          >
            <span
              aria-hidden="true"
              className={[
                'h-2 w-2 rounded-full',
                isSyncing ? 'bg-sky-400 animate-pulse' : error ? 'bg-amber-400' : 'bg-emerald-400',
              ].join(' ')}
            />
            {isSyncing ? 'Syncing runtime' : error ? 'Bridge offline' : 'Bridge sync healthy'}
          </div>
        </div>
      </div>

      {actionStatus && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          {actionStatus}
        </div>
      )}

      {error && !isSyncing && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          Bridge unreachable: {error} — data below may be stale.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl border border-slate-800 bg-slate-950 p-4 transition-colors hover:border-slate-700"
          >
            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{kpi.label}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-100 tabular-nums">{kpi.value}</div>
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
                  navigate(state.dealId ? `/deal/${state.dealId}` : '/leads');
                }
              );
            }}
            onMute={(state) => {
              const callId = state.callId || '';
              if (!callId) return;
              const isMuted = state.agentMode === 'human';
              void runRuntimeAction(
                `call:${callId}:${isMuted ? 'unmute' : 'mute'}`,
                isMuted ? 'Ava unmuted.' : 'Ava mute command sent to the bridge.',
                async () => { await controlRuntimeCall(callId, isMuted ? 'unmute' : 'mute'); }
              );
            }}
            onEnd={(state) => {
              const callId = state.callId || '';
              if (!callId) return;
              void runRuntimeAction(
                `call:${callId}:end`,
                'Call end command sent to the bridge.',
                async () => { await controlRuntimeCall(callId, 'end'); }
              );
            }}
          />

          <CallFloorPanel leads={leadImports} calls={calls} />

          {/* Admin Activity */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Admin Activity</h2>
                <p className="text-xs text-slate-500">Approval-backed infrastructure changes from Rex.</p>
              </div>
              {adminTasks.filter((t) => t.status === 'pending').length > 5 && (
                <span className="text-[11px] text-slate-500">
                  +{adminTasks.filter((t) => t.status === 'pending').length - 5} more
                </span>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {adminTasks.slice(0, 10).map((task) => (
                <div key={String(task.id)} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-200">
                      {/* Fix: use task.command not task.action */}
                      {String(task.provider || 'admin')} · {String(task.command || 'review')}
                    </div>
                    <div className="flex items-center gap-2">
                      {task.createdAt && (
                        <span className="text-[10px] text-slate-600">{formatRelative(task.createdAt)}</span>
                      )}
                      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        {formatRuntimeStatus(task.status)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {String(task.command || 'Administrative action')}
                  </div>
                  {String(task.status || '').toLowerCase() === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingAction === `admin:${String(task.id)}:approved`}
                        onClick={() => {
                          const taskId = String(task.id || '');
                          if (!taskId) return;
                          void runRuntimeAction(
                            `admin:${taskId}:approved`,
                            'Admin task approved and replayed through Rex.',
                            async () => { await updateAdminTaskDecision(taskId, 'approved'); }
                          );
                        }}
                        className="rounded-full bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={pendingAction === `admin:${String(task.id)}:rejected`}
                        onClick={() => {
                          const taskId = String(task.id || '');
                          if (!taskId) return;
                          void runRuntimeAction(
                            `admin:${taskId}:rejected`,
                            'Admin task declined.',
                            async () => { await updateAdminTaskDecision(taskId, 'rejected'); }
                          );
                        }}
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!adminTasks.length && (
                <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                  {error ? 'Bridge offline — admin task data unavailable.' : 'No admin approvals are needed.'}
                </div>
              )}
            </div>
          </section>

          {/* Web Search Cognition */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Web Search Cognition</h2>
                <p className="text-xs text-slate-500">Live data status for Ava/Rex spikes, facts, and fallback telemetry.</p>
              </div>
              <span className={[
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]',
                webSearchLiveReady ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300',
              ].join(' ')}>
                <span aria-hidden="true" className={['h-1.5 w-1.5 rounded-full', webSearchLiveReady ? 'bg-emerald-400' : 'bg-amber-300'].join(' ')} />
                {webSearchLiveReady ? 'Tavily live' : 'Fallback active'}
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Provider Path</div>
                <div className="mt-1 text-sm font-semibold capitalize text-slate-100">{webSearchPrimaryProvider}</div>
                <div className="mt-1 text-xs text-slate-500">{String(webSearchStatus.mode || 'waiting for bridge status')}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Neural Contract</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">
                  {String(webSearchNeuralOutput.spikeVersion || 'pbk-web-search-spikes-v1')}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {/* Fix: check both boolean false and string "false" */}
                  {String(webSearchNeuralOutput.exposesSymbolicFacts).toLowerCase() === 'false'
                    ? 'Spikes only'
                    : 'Spikes + symbolic facts'}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-400">
              {String(webSearchStatus.note || 'Waiting for the bridge to report web-search cognition status.')}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-slate-500">
                Log event: <span className="text-slate-300">{String(webSearchStatus.logEvent || 'pbk_web_search_provider')}</span>
                {!webSearchLiveReady && (
                  <span> / Missing: {webSearchMissing.join(', ') || 'PBK_TAVILY_API_KEY'}</span>
                )}
              </div>
              <button
                type="button"
                disabled={pendingAction === 'web-search:probe'}
                onClick={() => { void runWebSearchProbe(); }}
                className="rounded-full border border-sky-500/40 px-3 py-1.5 text-[11px] font-semibold text-sky-200 transition hover:border-sky-300 hover:text-sky-100 disabled:cursor-wait disabled:opacity-60"
              >
                Probe Status
              </button>
            </div>
          </section>

          {/* Tooling Readiness */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Tooling Readiness</h2>
                <p className="text-xs text-slate-500">Research, monitoring, and meta-agent support systems.</p>
              </div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                {String(toolingCoreReady)}/{String(toolingCoreTotal)} core
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {toolingHighlights.map((item) => {
                const ready = Boolean(item.meta?.ready);
                return (
                  <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 transition-colors hover:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 text-xs font-medium text-slate-200">{item.label}</div>
                      <span className={[
                        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
                        ready ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400',
                      ].join(' ')}>
                        <span aria-hidden="true" className={['h-1.5 w-1.5 rounded-full', ready ? 'bg-emerald-400' : 'bg-slate-500'].join(' ')} />
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
          {/* Activity Feed */}
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
                  key={`${String(item.id || item.createdAt || 'activity')}-${index}`}
                  className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-slate-100">
                      {/* Fix: ActivityRecord has leadName and type, not actor */}
                      {String(item.leadName || item.type || 'System')}
                    </div>
                    <div
                      className="text-[10px] text-slate-500"
                      title={item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Current session'}
                    >
                      {formatRelative(item.createdAt)}
                    </div>
                  </div>
                  {/* Fix: ActivityRecord uses 'summary', not 'text' */}
                  <div className="mt-2 text-xs text-slate-300">
                    {String((item as unknown as Record<string, unknown>).summary || item.address || 'Runtime event')}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 uppercase tracking-[0.12em]">
                    {/* Fix: ActivityRecord uses 'type', not 'category' */}
                    {String(item.type || 'INFO')}
                  </div>
                </div>
              ))}
              {!activity.length && (
                <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                  {error ? 'Bridge offline — activity data unavailable.' : 'The bridge has not recorded activity yet.'}
                </div>
              )}
            </div>
          </section>

          {/* Approvals */}
          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Approvals Needed</h2>
                <p className="text-xs text-slate-500">Items Ava/Rex need you to approve before sending.</p>
              </div>
              {pendingApprovals.length > 6 && (
                <span className="text-[11px] text-amber-300">{pendingApprovals.length} pending</span>
              )}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {pendingApprovals.slice(0, 12).map((approval) => {
                const approvalId = String(approval.id || '');
                const isContract = String(approval.type || '').toLowerCase() === 'contract';
                const offerPrice = formatMoney(approval.offerPrice);
                const mao = formatMoney(approval.mao);
                return (
                  <div key={approvalId} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
                        {String(approval.type || 'approval')}
                      </div>
                      {approval.createdAt && (
                        <span className="text-[10px] text-slate-500 shrink-0">{formatRelative(approval.createdAt)}</span>
                      )}
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">
                      {String(approval.leadName || approval.address || 'PBK approval')}
                    </div>
                    {approval.address && approval.leadName && (
                      <div className="mt-0.5 text-xs text-slate-400">{approval.address}</div>
                    )}
                    {/* Show offer price and MAO — critical for making an informed approval decision */}
                    {(offerPrice || mao) && (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {offerPrice && (
                          <div className="text-xs">
                            <span className="text-slate-500">Offer </span>
                            <span className="font-semibold text-sky-300">{offerPrice}</span>
                          </div>
                        )}
                        {mao && (
                          <div className="text-xs">
                            <span className="text-slate-500">MAO </span>
                            <span className="font-semibold text-slate-200">{mao}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {approval.notes && (
                      <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-400">
                        {approval.notes}
                      </div>
                    )}
                    {/* Revision notes input for contract rejections */}
                    {isContract && (
                      <textarea
                        className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-amber-500/60 focus:outline-none"
                        rows={2}
                        placeholder="Revision notes for Ava (optional)…"
                        value={revisionNotes[approvalId] || ''}
                        onChange={(e) => setRevisionNotes((prev) => ({ ...prev, [approvalId]: e.target.value }))}
                      />
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-approval-primary="true"
                        disabled={!approvalId || pendingAction === `approval:${approvalId}:approved`}
                        onClick={() => {
                          if (!approvalId) return;
                          void runRuntimeAction(
                            `approval:${approvalId}:approved`,
                            'Approved. Ava can continue.',
                            async () => { await updateApprovalDecision(approvalId, 'approved'); }
                          );
                        }}
                        className="rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        data-approval-secondary="true"
                        disabled={!approvalId || pendingAction === `approval:${approvalId}:rejected`}
                        onClick={() => {
                          if (!approvalId) return;
                          const rejectionStatus = isContract ? 'needs-revision' : 'rejected';
                          const notes = revisionNotes[approvalId] || undefined;
                          void runRuntimeAction(
                            `approval:${approvalId}:rejected`,
                            'Decision sent to Ava.',
                            async () => { await updateApprovalDecision(approvalId, rejectionStatus, notes); }
                          );
                        }}
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isContract ? 'Needs Revision' : 'Decline'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {!pendingApprovals.length && (
                <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                  {error ? 'Bridge offline — approval data unavailable.' : 'No pending approvals right now.'}
                </div>
              )}
            </div>
          </section>

          {/* Contracts summary */}
          {activeContracts.length > 0 && (
            <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Contracts in Pipeline</h2>
                  <p className="text-xs text-slate-500">{activeContracts.length} active · {contracts.length} total on file</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {activeContracts.slice(0, 6).map((contract, index) => {
                  const c = contract as Record<string, unknown>;
                  const amount = formatMoney(typeof c.amount === 'number' ? c.amount : null);
                  return (
                    <div key={String(c.id || index)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-200 truncate">
                          {String(c.leadName || c.address || 'Contract')}
                        </div>
                        {c.address && c.leadName && (
                          <div className="text-[11px] text-slate-500 truncate">{String(c.address)}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {amount && <span className="text-xs font-semibold text-sky-300">{amount}</span>}
                        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {formatRuntimeStatus(c.status)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
