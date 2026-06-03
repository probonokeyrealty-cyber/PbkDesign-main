import { useEffect, useState } from 'react';
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
  if (state === 'unknown') return 'Waiting for bridge';
  if (state === 'ready') return 'Ready';
  if (state === 'partial') return 'Connected, not tested';
  return 'Needs setup';
}

function describeTooling(meta: Record<string, unknown> | undefined) {
  const state = readinessFor(meta);
  if (state === 'unknown') return 'Waiting on bridge';
  if (state === 'ready') return 'Ready';
  if (state === 'partial') return 'Needs one more step';
  return 'Needs setup';
}

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatRuntimeStatus(status: unknown) {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'provider_missing') return 'Provider key missing';
  if (normalized === 'queued') return 'Queued for worker';
  if (normalized === 'queued_for_approval') return 'Queued for approval';
  if (normalized === 'pending') return 'Waiting';
  if (normalized === 'approved') return 'Approved';
  if (normalized === 'rejected') return 'Declined';
  if (normalized === 'complete') return 'Complete';
  if (normalized === 'failed') return 'Delivery failed';
  return normalized ? normalized.replace(/_/g, ' ') : 'No data yet';
}

const DOT_CLASS: Record<ReadinessState, string> = {
  ready: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]',
  partial: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.45)]',
  missing: 'bg-slate-600',
  unknown: 'bg-slate-700 animate-pulse',
};
const TOOLING_CARD_FALLBACK_COUNT = 11;

type SettingsAdminDecisionDraft = {
  taskId: string;
  status: 'approved' | 'rejected';
  provider: string;
  action: string;
  summary: string;
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
  const [refreshingDecision, setRefreshingDecision] = useState(false);
  const [settingsAdminDecisionDraft, setSettingsAdminDecisionDraft] =
    useState<SettingsAdminDecisionDraft | null>(null);
  const status = (snapshot?.status || {}) as Record<string, unknown>;
  const runtimeProviders = (status.providers || {}) as Record<string, Record<string, unknown>>;
  const adminTasks = Array.isArray(snapshot?.adminTasks) ? snapshot.adminTasks : [];
  const toolingSummary = (tooling?.summary || {}) as Record<string, unknown>;
  const toolingCoreReady = toNumber(
    toolingSummary.requiredReadyCount,
    toNumber(toolingSummary.readyCount)
  );
  const toolingCoreTotal = toNumber(
    toolingSummary.requiredCount,
    toNumber(toolingSummary.totalCount, TOOLING_CARD_FALLBACK_COUNT)
  );
  const toolingOptionalReady = toNumber(toolingSummary.optionalReadyCount);
  const toolingOptionalTotal = toNumber(toolingSummary.optionalCount);
  const metricsUrl = String(toolingSummary.metricsUrl || '').trim();

  const providerCards = [
    { id: 'telnyx', label: 'Telnyx', meta: quotas?.telnyx || runtimeProviders.telnyx },
    { id: 'instantly', label: 'Instantly', meta: quotas?.instantly || runtimeProviders.instantly },
    { id: 'docs', label: 'Document Sends', meta: quotas?.docs },
  ];
  const toolingCards = [
    {
      id: 'meta-agent',
      label: 'Meta-Agent Lab',
      meta: tooling?.metaAgent as Record<string, unknown> | undefined,
    },
    {
      id: 'browser-os',
      label: 'BrowserOS Agent',
      meta: tooling?.browserOs as Record<string, unknown> | undefined,
    },
    {
      id: 'browser-research',
      label: 'Browser Research',
      meta: tooling?.browserResearch as Record<string, unknown> | undefined,
    },
    {
      id: 'property-data',
      label: 'Property Data Layer',
      meta: tooling?.propertyData as Record<string, unknown> | undefined,
    },
    {
      id: 'pipeline-memory',
      label: 'Pipeline Memory',
      meta: tooling?.pipelineMemory as Record<string, unknown> | undefined,
    },
    {
      id: 'voice-fallback',
      label: 'Voice Fallback',
      meta: tooling?.voiceFallback as Record<string, unknown> | undefined,
    },
    {
      id: 'desktop-copilot',
      label: 'Desktop Copilot',
      meta: tooling?.desktopCopilot as Record<string, unknown> | undefined,
    },
    {
      id: 'context7',
      label: 'Context7 MCP',
      meta: tooling?.context7 as Record<string, unknown> | undefined,
    },
    {
      id: 'workflow-ops',
      label: 'Workflow Ops',
      meta: tooling?.workflowOps as Record<string, unknown> | undefined,
    },
    {
      id: 'observability',
      label: 'Observability',
      meta: tooling?.observability as Record<string, unknown> | undefined,
    },
    {
      id: 'github',
      label: 'GitHub Verify',
      meta: tooling?.github as Record<string, unknown> | undefined,
    },
  ];

  useEffect(() => {
    if (!actionStatus) return undefined;
    const handle = window.setTimeout(() => setActionStatus(''), 5000);
    return () => window.clearTimeout(handle);
  }, [actionStatus]);

  const confirmSettingsAdminDecision = (
    task: Record<string, unknown>,
    status: SettingsAdminDecisionDraft['status']
  ) => {
    const taskId = String(task.id || '');
    if (!taskId) return;
    setSettingsAdminDecisionDraft({
      taskId,
      status,
      provider: String(task.provider || 'admin'),
      action: String(task.action || 'review'),
      summary: String(task.summary || task.command || 'Administrative action'),
    });
  };

  const decideAdminTask = async () => {
    if (!settingsAdminDecisionDraft) return;
    const { taskId, status } = settingsAdminDecisionDraft;
    const key = `admin:${taskId}:${status}`;
    setSettingsAdminDecisionDraft(null);
    setPendingAction(key);
    setActionStatus('');
    let decisionSent = false;
    try {
      await updateAdminTaskDecision(taskId, status);
      decisionSent = true;
      setRefreshingDecision(true);
      await refresh();
      setActionStatus(
        status === 'approved' ? 'Admin task approved and executed.' : 'Admin task declined.'
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Admin task update failed.';
      setActionStatus(
        decisionSent ? `Decision sent, but latest settings could not refresh: ${message}` : message
      );
    } finally {
      setRefreshingDecision(false);
      setPendingAction('');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">
            Provider status, usage limits, and safety controls.
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
          {loading
            ? 'Checking bridge connection'
            : error
              ? 'Bridge offline'
              : `State backend · ${(status.stateBackend as string) || 'No data yet'}`}
        </div>
      </div>

      {actionStatus && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          {actionStatus}
        </div>
      )}
      {refreshingDecision && (
        <div className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-300">
          Refreshing Settings after admin decision...
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
            <h2 className="text-sm font-semibold text-slate-100">Agent Tools</h2>
            <p className="mt-1 text-xs text-slate-500">
              Repo-level systems that support research, observability, workflow health, and future
              agent training.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {String(toolingCoreReady)}/{String(toolingCoreTotal)} core ready
            {toolingOptionalTotal
              ? ` · ${String(toolingOptionalReady)}/${String(toolingOptionalTotal)} optional enabled`
              : ''}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                    {card.label}
                  </div>
                  <StatusDot state={state} />
                </div>
                <div className="mt-2 break-words text-lg font-semibold text-slate-100">
                  {describeTooling(card.meta)}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">
                  {String(card.meta?.note || 'Bridge-backed tooling surface.')}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-400">
          Metrics endpoint:{' '}
          {metricsUrl ? (
            <a
              href={metricsUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sky-300 underline-offset-4 hover:underline"
            >
              {metricsUrl}
            </a>
          ) : (
            <span className="text-slate-200">waiting for bridge connection</span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Admin Approvals Needed</h2>
            <p className="mt-1 text-xs text-slate-500">
              Test mode and approval-backed infrastructure changes queued by Rex.
            </p>
          </div>
          <div className="divide-y divide-slate-800">
            {adminTasks.map((task) => (
              <div
                key={String(task.id)}
                className="grid grid-cols-1 gap-2 px-4 py-4 text-sm text-slate-200 md:grid-cols-[1fr_auto]"
              >
                <div>
                  <div className="font-medium text-slate-100">
                    {String(task.provider || 'admin')} / {String(task.action || 'review')}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {String(task.summary || task.command || 'Administrative action')}
                  </div>
                  {String(task.status || '').toLowerCase() === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={Boolean(pendingAction) || refreshingDecision}
                        onClick={() => confirmSettingsAdminDecision(task, 'approved')}
                        className="rounded-full bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(pendingAction) || refreshingDecision}
                        onClick={() => confirmSettingsAdminDecision(task, 'rejected')}
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
                  {formatRuntimeStatus(task.status)}
                </div>
              </div>
            ))}
            {!adminTasks.length && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No admin approvals are needed.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Safety Controls</h2>
          <div className="mt-3 space-y-3 text-sm">
            <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                Approvals
              </div>
              <div className="mt-1 text-slate-100">
                {String(status.pendingApprovals || 0)} offer / outbound approvals pending
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                Admin Queue
              </div>
              <div className="mt-1 text-slate-100">
                {String(status.pendingAdminTasks || 0)} admin changes still require review
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                Document Sends
              </div>
              <div className="mt-1 text-slate-100">
                {String(status.documentDeliveries || 0)} seller document sends tracked in the bridge
              </div>
            </div>
          </div>
        </section>
      </div>

      {settingsAdminDecisionDraft && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-admin-decision-title"
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.55)]"
          >
            <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
              Admin safety check
            </div>
            <h3
              id="settings-admin-decision-title"
              className="mt-2 text-lg font-semibold text-slate-100"
            >
              Confirm admin decision
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              This will {settingsAdminDecisionDraft.status === 'approved' ? 'approve' : 'decline'}{' '}
              <span className="font-semibold text-slate-200">
                {settingsAdminDecisionDraft.provider} / {settingsAdminDecisionDraft.action}
              </span>
              .
            </p>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300">
              {settingsAdminDecisionDraft.summary}
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setSettingsAdminDecisionDraft(null)}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  refreshingDecision ||
                  pendingAction ===
                    `admin:${settingsAdminDecisionDraft.taskId}:${settingsAdminDecisionDraft.status}`
                }
                onClick={() => void decideAdminTask()}
                className="rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-wait disabled:opacity-60"
              >
                {settingsAdminDecisionDraft.status === 'approved'
                  ? 'Approve admin task'
                  : 'Decline admin task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
