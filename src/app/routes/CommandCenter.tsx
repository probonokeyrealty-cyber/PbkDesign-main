import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LiveCallWidget } from '../components/shell/LiveCallWidget';
import type { LiveCallState, TranscriptLine } from '../components/shell/LiveCallWidget';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  controlRuntimeCall,
  updateAdminTaskDecision,
  updateApprovalDecision,
} from '../utils/runtimeBridge';

function formatRelative(value?: string) {
  if (!value) return 'just now';
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
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
    rawSentiment == null ? null : rawSentiment <= 1 ? Math.round(rawSentiment * 100) : Math.round(rawSentiment);
  const transcript = Array.isArray(call.transcript)
    ? call.transcript.map(mapTranscriptLine).filter(Boolean) as TranscriptLine[]
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

export function CommandCenter() {
  const navigate = useNavigate();
  const { snapshot, tooling, loading, error, refresh } = useRuntimeSnapshot();
  const [actionStatus, setActionStatus] = useState('');
  const [pendingAction, setPendingAction] = useState('');

  const approvals = Array.isArray(snapshot?.approvals) ? snapshot.approvals : [];
  const adminTasks = Array.isArray(snapshot?.adminTasks) ? snapshot.adminTasks : [];
  const leadImports = Array.isArray(snapshot?.leadImports) ? snapshot.leadImports : [];
  const activity = Array.isArray(snapshot?.activity) ? snapshot.activity.slice(0, 8) : [];
  const calls = Array.isArray(snapshot?.calls) ? snapshot.calls : [];
  const activeCall = mapRuntimeCall(
    calls.find((call) => ['live', 'connected', 'dialing', 'queued', 'on-hold'].includes(String(call.status || '').toLowerCase()))
      || calls[0],
  );
  const toolingSummary = (tooling?.summary || {}) as Record<string, unknown>;
  const toolingHighlights = [
    { label: 'Meta-Agent', meta: tooling?.metaAgent as Record<string, unknown> | undefined },
    { label: 'BrowserOS Agent', meta: tooling?.browserOs as Record<string, unknown> | undefined },
    { label: 'Browser Research', meta: tooling?.browserResearch as Record<string, unknown> | undefined },
    { label: 'Observability', meta: tooling?.observability as Record<string, unknown> | undefined },
  ];

  const kpis = [
    { label: 'Active Leads', value: String(leadImports.length), hint: 'live from bridge intake' },
    { label: 'Calls Today', value: String(calls.length), hint: 'Telnyx + bridge runtime' },
    { label: 'Approvals Pending', value: String(approvals.filter((item) => item.status === 'pending').length), hint: `${adminTasks.filter((item) => item.status === 'pending').length} admin tasks waiting` },
    { label: 'Deals in Pipeline', value: String((snapshot?.contracts || []).length), hint: 'prepared, sent, or signed contracts' },
    { label: 'Tooling Ready', value: `${String(toolingSummary.readyCount || 0)}/${String(toolingSummary.totalCount || 0)}`, hint: 'advanced systems available in repo' },
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
              loading
                ? 'bg-sky-400 animate-pulse'
                : error
                  ? 'bg-amber-400'
                  : 'bg-emerald-400',
            ].join(' ')}
          />
          {loading ? 'Syncing runtime' : error ? 'Bridge offline' : 'Bridge sync healthy'}
        </div>
      </div>

      {actionStatus && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          {actionStatus}
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
              void runRuntimeAction(`call:${callId}:takeover`, 'Human takeover sent to the bridge.', async () => {
                if (callId) await controlRuntimeCall(callId, 'takeover');
                navigate(state.dealId ? `/deal/${state.dealId}` : '/deal');
              });
            }}
            onMute={(state) => {
              const callId = state.callId || '';
              if (!callId) return;
              void runRuntimeAction(`call:${callId}:mute`, 'Ava mute command sent to the bridge.', async () => {
                await controlRuntimeCall(callId, 'mute');
              });
            }}
            onEnd={(state) => {
              const callId = state.callId || '';
              if (!callId) return;
              void runRuntimeAction(`call:${callId}:end`, 'Call end command sent to the bridge.', async () => {
                await controlRuntimeCall(callId, 'end');
              });
            }}
          />

          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Admin Activity</h2>
                <p className="text-xs text-slate-500">Approval-backed infrastructure changes from Rex.</p>
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
                      {String(task.status || 'pending')}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-400">{String(task.summary || task.command || 'Administrative action')}</div>
                  {String(task.status || '').toLowerCase() === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingAction === `admin:${String(task.id)}:approved`}
                        onClick={() => {
                          const taskId = String(task.id || '');
                          if (!taskId) return;
                          void runRuntimeAction(`admin:${taskId}:approved`, 'Admin task approved and replayed through Rex.', async () => {
                            await updateAdminTaskDecision(taskId, 'approved');
                          });
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
                          void runRuntimeAction(`admin:${taskId}:rejected`, 'Admin task rejected.', async () => {
                            await updateAdminTaskDecision(taskId, 'rejected');
                          });
                        }}
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!adminTasks.length && (
                <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                  No admin tasks queued yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Tooling Readiness</h2>
                <p className="text-xs text-slate-500">Research, monitoring, and meta-agent support systems.</p>
              </div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                {String(toolingSummary.readyCount || 0)}/{String(toolingSummary.totalCount || 0)}
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
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-medium text-slate-200">{item.label}</div>
                      <span
                        className={[
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
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
                        {ready ? 'Ready' : 'Setup'}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">{String(item.meta?.note || 'Waiting on bridge status.')}</div>
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
                    <div className="text-xs font-medium text-slate-100">{String(item.actor || 'System')}</div>
                    <div className="text-[10px] text-slate-500">{formatRelative(String(item.at || item.createdAt || ''))}</div>
                  </div>
                  <div className="mt-2 text-xs text-slate-300">{String(item.text || 'Runtime event')}</div>
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
                <h2 className="text-sm font-semibold text-slate-100">Approval Queue</h2>
                <p className="text-xs text-slate-500">Offer, contract, and outbound decisions waiting on a human.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {approvals.filter((item) => item.status === 'pending').slice(0, 6).map((approval) => (
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
                  <div className="mt-1 text-xs text-slate-400">{String(approval.address || 'No address recorded')}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pendingAction === `approval:${String(approval.id)}:approved`}
                      onClick={() => {
                        const approvalId = String(approval.id || '');
                        if (!approvalId) return;
                        void runRuntimeAction(`approval:${approvalId}:approved`, 'Approval decision sent to Ava.', async () => {
                          await updateApprovalDecision(approvalId, 'approved');
                        });
                      }}
                      className="rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={pendingAction === `approval:${String(approval.id)}:rejected`}
                      onClick={() => {
                        const approvalId = String(approval.id || '');
                        if (!approvalId) return;
                        const rejectionStatus = String(approval.type || '').toLowerCase() === 'contract' ? 'needs-revision' : 'rejected';
                        void runRuntimeAction(`approval:${approvalId}:rejected`, 'Approval rejection sent to Ava.', async () => {
                          await updateApprovalDecision(approvalId, rejectionStatus);
                        });
                      }}
                      className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                    >
                      {String(approval.type || '').toLowerCase() === 'contract' ? 'Needs Revision' : 'Reject'}
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
    </div>
  );
}
