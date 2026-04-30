import { useState } from 'react';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import { updateAdminTaskDecision } from '../utils/runtimeBridge';

type ReadinessState = 'ready' | 'partial' | 'missing' | 'unknown';

function readinessFor(meta: Record<string, unknown> | undefined): ReadinessState {
  if (!meta) return 'unknown';
  if (meta.ready) return 'ready';
  if (
    meta.configured ||
    meta.registryConfigured ||
    meta.workflowConfigured ||
    meta.composeReady ||
    meta.targetsConfigured
  ) {
    return 'partial';
  }
  return 'missing';
}

function describeProvider(meta: Record<string, unknown> | undefined) {
  const state = readinessFor(meta);
  if (state === 'unknown') return 'Waiting on bridge health';
  if (state === 'ready') return 'Live';
  if (state === 'partial') return 'Configured';
  return 'Needs setup';
}

function describeTooling(meta: Record<string, unknown> | undefined) {
  const state = readinessFor(meta);
  if (state === 'unknown') return 'Waiting on bridge';
  if (state === 'ready') return 'Ready';
  if (state === 'partial') return 'Partially wired';
  return 'Needs setup';
}

const DOT_CLASS: Record<ReadinessState, string> = {
  ready: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]',
  partial: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.45)]',
  missing: 'bg-slate-600',
  unknown: 'bg-slate-700 animate-pulse',
};

function StatusDot({ state }: { state: ReadinessState }) {
  return (
    <span
      aria-hidden="true"
      className={['inline-block h-2 w-2 rounded-full', DOT_CLASS[state]].join(' ')}
    />
  );
}

export function Settings() {
  const { snapshot, quotas, tooling, loading, error, refresh } = useRuntimeSnapshot();
  const [pendingAction, setPendingAction] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const status = (snapshot?.status || {}) as Record<string, unknown>;
  const runtimeProviders = (status.providers || {}) as Record<string, Record<string, unknown>>;
  const adminTasks = Array.isArray(snapshot?.adminTasks) ? snapshot.adminTasks : [];
  const toolingSummary = (tooling?.summary || {}) as Record<string, unknown>;

  const providerCards = [
    { id: 'telnyx', label: 'Telnyx', meta: quotas?.telnyx || runtimeProviders.telnyx },
    { id: 'instantly', label: 'Instantly', meta: quotas?.instantly || runtimeProviders.instantly },
    { id: 'docs', label: 'Documents', meta: quotas?.docs },
  ];
  const toolingCards = [
    { id: 'meta-agent', label: 'Meta-Agent Lab', meta: tooling?.metaAgent as Record<string, unknown> | undefined },
    { id: 'browser-os', label: 'BrowserOS Agent', meta: tooling?.browserOs as Record<string, unknown> | undefined },
    { id: 'browser-research', label: 'Browser Research', meta: tooling?.browserResearch as Record<string, unknown> | undefined },
    { id: 'context7', label: 'Context7 MCP', meta: tooling?.context7 as Record<string, unknown> | undefined },
    { id: 'workflow-ops', label: 'Workflow Ops', meta: tooling?.workflowOps as Record<string, unknown> | undefined },
    { id: 'observability', label: 'Observability', meta: tooling?.observability as Record<string, unknown> | undefined },
    { id: 'github', label: 'GitHub Verify', meta: tooling?.github as Record<string, unknown> | undefined },
  ];

  const decideAdminTask = async (task: Record<string, unknown>, status: string) => {
    const taskId = String(task.id || '');
    if (!taskId) return;
    const key = `admin:${taskId}:${status}`;
    setPendingAction(key);
    setActionStatus('');
    try {
      await updateAdminTaskDecision(taskId, status);
      await refresh().catch(() => null);
      setActionStatus(status === 'approved' ? 'Admin task approved and executed.' : 'Admin task rejected.');
    } catch (nextError) {
      setActionStatus(nextError instanceof Error ? nextError.message : 'Admin task update failed.');
    } finally {
      setPendingAction('');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">
            Provider readiness, quotas, and admin guardrails from the runtime.
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
          {loading
            ? 'Checking bridge'
            : error
              ? 'Bridge offline'
              : `State backend · ${(status.stateBackend as string) || 'unknown'}`}
        </div>
      </div>

      {actionStatus && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          {actionStatus}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        {providerCards.map((card) => {
          const meta = card.meta as Record<string, unknown> | undefined;
          const state = readinessFor(meta);
          return (
            <section
              key={card.id}
              className="rounded-2xl border border-slate-800 bg-slate-950 p-4 transition-colors hover:border-slate-700"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                  {card.label}
                </div>
                <StatusDot state={state} />
              </div>
              <div className="mt-2 text-lg font-semibold text-slate-100">
                {describeProvider(meta)}
              </div>
              <div className="mt-1 text-xs text-slate-500 whitespace-pre-wrap">
                {String(meta?.note || '') || 'Bridge-backed runtime surface.'}
              </div>
            </section>
          );
        })}
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Advanced Tooling</h2>
            <p className="mt-1 text-xs text-slate-500">
              Repo-level systems that support research, observability, workflow health, and future agent training.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {String(toolingSummary.readyCount || 0)}/{String(toolingSummary.totalCount || toolingCards.length)} ready
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {toolingCards.map((card) => {
            const state = readinessFor(card.meta);
            return (
              <section
                key={card.id}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                    {card.label}
                  </div>
                  <StatusDot state={state} />
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-100">
                  {describeTooling(card.meta)}
                </div>
                <div className="mt-1 text-xs text-slate-500 whitespace-pre-wrap">
                  {String(card.meta?.note || 'Bridge-backed tooling surface.')}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-400">
          Metrics endpoint: <span className="text-slate-200">{String(toolingSummary.metricsUrl || 'waiting for bridge')}</span>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Pending Admin Tasks</h2>
            <p className="mt-1 text-xs text-slate-500">Dry runs and approval-backed infrastructure changes queued by Rex.</p>
          </div>
          <div className="divide-y divide-slate-800">
            {adminTasks.map((task) => (
              <div
                key={String(task.id)}
                className="grid grid-cols-1 gap-2 px-4 py-4 text-sm text-slate-200 md:grid-cols-[1fr_auto]"
              >
                <div>
                  <div className="font-medium text-slate-100">{String(task.provider || 'admin')} / {String(task.action || 'review')}</div>
                  <div className="mt-1 text-xs text-slate-400">{String(task.summary || task.command || 'Administrative action')}</div>
                  {String(task.status || '').toLowerCase() === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pendingAction === `admin:${String(task.id)}:approved`}
                        onClick={() => void decideAdminTask(task, 'approved')}
                        className="rounded-full bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={pendingAction === `admin:${String(task.id)}:rejected`}
                        onClick={() => void decideAdminTask(task, 'rejected')}
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  {String(task.status || 'pending')}
                </div>
              </div>
            ))}
            {!adminTasks.length && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No admin tasks are queued.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Guardrails Snapshot</h2>
          <div className="mt-3 space-y-3 text-sm">
            <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Approvals</div>
              <div className="mt-1 text-slate-100">{String(status.pendingApprovals || 0)} offer / outbound approvals pending</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Admin Queue</div>
              <div className="mt-1 text-slate-100">{String(status.pendingAdminTasks || 0)} admin changes still require review</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Documents</div>
              <div className="mt-1 text-slate-100">{String(status.documentDeliveries || 0)} seller document sends tracked in the bridge</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
