import { useEffect, useState } from 'react';
import { Activity, Database, ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { PbkDataSource } from '../../components/pbk/index';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  fetchObservabilityStatusRequest,
  fetchReleaseStatusRequest,
  updateAdminTaskDecision,
  type ObservabilityStatusResponse,
  type ReleaseStatusComponent,
  type ReleaseStatusResponse,
} from '../utils/runtimeBridge';

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

type SettingsRuntimeCard = {
  id: string;
  label: string;
  meta: Record<string, unknown> | undefined;
};

type SettingsStat = {
  label: string;
  value: string;
  detail: string;
  tone?: 'sky' | 'lime' | 'amber';
};

function StatusDot({ state }: { state: ReadinessState }) {
  return (
    <span
      aria-hidden="true"
      className={['inline-block h-2 w-2 rounded-full', DOT_CLASS[state]].join(' ')}
    />
  );
}

function SettingsSourceRail() {
  return (
    <div className="pbk-settings-source-rail" aria-label="Settings data sources">
      <PbkDataSource endpoint="GET /state" status="ships" note="runtime settings and admin queue" />
      <PbkDataSource endpoint="GET /api/quotas" status="ships" note="provider readiness cards" />
      <PbkDataSource
        endpoint="GET /api/tooling/status"
        status="ships"
        note="support system health"
      />
      <PbkDataSource endpoint="PUT /api/admin/tasks/:id" status="ships" note="admin decisions" />
      <PbkDataSource
        endpoint="GET/POST /api/settings"
        status="ships"
        note="operator mode and runtime preferences"
      />
      <PbkDataSource
        endpoint="GET /api/observability/status"
        status="ships"
        note="canonical metrics dashboard health"
      />
      <PbkDataSource
        endpoint="GET /api/release/status"
        status="ships"
        note="deploy/release readiness"
      />
    </div>
  );
}

function SettingsStatRibbon({ stats }: { stats: SettingsStat[] }) {
  return (
    <div className="pbk-settings-grid" aria-label="Settings summary">
      {stats.map((stat) => (
        <div key={stat.label} className="pbk-settings-stat">
          <div className="l">{stat.label}</div>
          <div className={['v', stat.tone || ''].join(' ').trim()}>{stat.value}</div>
          <div className="delta">{stat.detail}</div>
        </div>
      ))}
    </div>
  );
}

function SettingsHero({
  loading,
  error,
  stateBackend,
  stats,
  onRefresh,
}: {
  loading: boolean;
  error: string | null | undefined;
  stateBackend: string;
  stats: SettingsStat[];
  onRefresh: () => void;
}) {
  return (
    <section className="pbk-settings-hero">
      <div className="pbk-settings-hero-top">
        <div>
          <div className="pbk-eyebrow">
            Runtime settings -{' '}
            {loading ? 'checking bridge' : error ? 'bridge offline' : stateBackend}
          </div>
          <h1 className="pbk-display pbk-h1">
            Settings &amp; <em>safety</em>.
          </h1>
          <p>
            Provider readiness, tooling health, admin approvals, and safety controls in one
            bridge-backed operating panel. Every tile states its source before it ships.
          </p>
        </div>
        <button
          type="button"
          className="pbk-settings-refresh"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Refreshing' : 'Refresh settings'}
        </button>
      </div>
      <SettingsStatRibbon stats={stats} />
      <SettingsSourceRail />
    </section>
  );
}

function SettingsProviderCard({ card }: { card: SettingsRuntimeCard }) {
  const state = readinessFor(card.meta);
  return (
    <section className="pbk-settings-provider-card">
      <div className="card-head">
        <div>
          <span className="pbk-kicker">Provider</span>
          <h3>{card.label}</h3>
        </div>
        <StatusDot state={state} />
      </div>
      <strong>{describeProvider(card.meta)}</strong>
      <p>{String(card.meta?.note || '') || 'Bridge-backed runtime surface.'}</p>
    </section>
  );
}

function SettingsToolCard({ card }: { card: SettingsRuntimeCard }) {
  const state = readinessFor(card.meta);
  return (
    <section className="pbk-settings-tool-card">
      <div className="card-head">
        <h3>{card.label}</h3>
        <StatusDot state={state} />
      </div>
      <strong>{describeTooling(card.meta)}</strong>
      <p>{String(card.meta?.note || 'Bridge-backed tooling surface.')}</p>
    </section>
  );
}

function SettingsSafetyRail({ status }: { status: Record<string, unknown> }) {
  const rows = [
    {
      label: 'Approvals',
      value: `${String(status.pendingApprovals || 0)} offer / outbound approvals pending`,
      icon: ShieldCheck,
    },
    {
      label: 'Admin Queue',
      value: `${String(status.pendingAdminTasks || 0)} admin changes still require review`,
      icon: Activity,
    },
    {
      label: 'Document Sends',
      value: `${String(status.documentDeliveries || 0)} seller document sends tracked in the bridge`,
      icon: Database,
    },
  ];
  return (
    <section className="pbk-settings-card pbk-settings-safety-rail">
      <div className="pbk-settings-card-head">
        <div>
          <span className="pbk-kicker">Guardrails</span>
          <h2>Safety controls</h2>
        </div>
        <PbkDataSource endpoint="GET /state" status="ships" note="status safety counters" />
      </div>
      <div className="safety-list">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="safety-row">
              <span className="safety-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <div>
                <div className="label">{row.label}</div>
                <div className="value">{row.value}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function buildFallbackReleaseStatus({
  error,
  stateBackend,
  toolingCoreReady,
  toolingCoreTotal,
  metricsUrl,
}: {
  error: string | null | undefined;
  stateBackend: string;
  toolingCoreReady: number;
  toolingCoreTotal: number;
  metricsUrl: string;
}): ReleaseStatusResponse {
  const components: ReleaseStatusComponent[] = [
    {
      id: 'runtime-snapshot',
      label: 'Runtime snapshot',
      status: error ? 'degraded' : 'configured',
      ready: !error,
      configured: true,
      detail: error || stateBackend,
      source: 'GET /state',
    },
    {
      id: 'tooling-status',
      label: 'Tooling status',
      status: toolingCoreReady >= toolingCoreTotal && toolingCoreTotal > 0 ? 'ready' : 'configured',
      ready: toolingCoreReady >= toolingCoreTotal && toolingCoreTotal > 0,
      configured: toolingCoreTotal > 0,
      detail: `${toolingCoreReady}/${toolingCoreTotal || 0} core tooling ready`,
      source: 'GET /api/tooling/status',
    },
    {
      id: 'observability-url',
      label: 'Observability URL',
      status: metricsUrl ? 'ready' : 'unknown',
      ready: Boolean(metricsUrl),
      configured: Boolean(metricsUrl),
      detail: metricsUrl || 'waiting for bridge tooling summary',
      source: 'tooling.summary.metricsUrl',
    },
  ];
  return {
    ok: !error,
    result: error ? 'release_status_fallback' : 'release_status_client_fallback',
    source: 'client snapshot fallback',
    generatedAt: new Date().toISOString(),
    release: {
      stateBackend,
      hosted: false,
    },
    summary: {
      ready: components.filter((component) => component.ready).length,
      total: components.length,
      warnings: error ? 1 : 0,
    },
    components,
    warnings: error ? [error] : [],
  };
}

function SettingsReleasePanel({
  releaseStatus,
  fallback,
}: {
  releaseStatus: ReleaseStatusResponse | null;
  fallback: ReleaseStatusResponse;
}) {
  const model = releaseStatus || fallback;
  const components = Array.isArray(model.components) ? model.components : [];
  const release = model.release || {};
  const summary = model.summary || {};
  const readyCount = toNumber(summary.ready);
  const totalCount = toNumber(summary.total, components.length);
  const warnings = Array.isArray(model.warnings) ? model.warnings : [];
  const tone = warnings.length ? 'amber' : readyCount >= totalCount && totalCount ? 'lime' : 'sky';

  return (
    <section className="pbk-settings-card span-2">
      <div className="pbk-settings-card-head">
        <div>
          <span className="pbk-kicker">Release control</span>
          <h2>Production deploy readiness</h2>
          <p>
            Commit, bridge revision, state backend, provider readiness, and migration/admin signals
            summarized before production publish.
          </p>
        </div>
        <PbkDataSource endpoint="GET /api/release/status" status="ships" note={model.source} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="pbk-kicker">Readiness</div>
          <strong
            className={[
              'text-2xl',
              tone === 'lime'
                ? 'text-emerald-200'
                : tone === 'amber'
                  ? 'text-amber-200'
                  : 'text-sky-200',
            ].join(' ')}
          >
            {readyCount}/{totalCount || 0}
          </strong>
          <div className="mt-1 text-xs text-slate-400">release checks ready</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="pbk-kicker">Bridge</div>
          <strong
            className="block truncate text-sm text-slate-100"
            title={String(release.bridgeRevision || '')}
          >
            {String(release.bridgeRevision || 'runtime')}
          </strong>
          <div className="mt-1 truncate text-xs text-slate-400">
            {String(release.stateBackend || 'unknown backend')}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="pbk-kicker">Commit</div>
          <strong className="block truncate text-sm text-slate-100">
            {String(release.commit || 'not exposed')}
          </strong>
          <div className="mt-1 text-xs text-slate-400">
            {release.hosted ? 'hosted bridge' : 'local/dev bridge'}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="pbk-kicker">Deploy IDs</div>
          <strong className="block truncate text-sm text-slate-100">
            {String(release.netlifyDeployId || release.renderServiceId || 'not exposed')}
          </strong>
          <div className="mt-1 text-xs text-slate-400">Render / Netlify</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {components.map((component) => {
          const state = component.ready ? 'ready' : component.configured ? 'partial' : 'missing';
          return (
            <div
              key={component.id}
              className="rounded-2xl border border-slate-800/90 bg-slate-950/40 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold text-slate-100">
                  {component.label}
                </span>
                <StatusDot state={state} />
              </div>
              <p
                className="mt-1 line-clamp-2 text-xs text-slate-400"
                title={component.detail || ''}
              >
                {component.detail || component.source || 'No detail reported'}
              </p>
            </div>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">
          {warnings.slice(0, 3).join(' / ')}
        </div>
      )}
    </section>
  );
}

export function Settings() {
  const { snapshot, quotas, tooling, loading, error, refresh } = useRuntimeSnapshot();
  const [pendingAction, setPendingAction] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [refreshingDecision, setRefreshingDecision] = useState(false);
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatusResponse | null>(null);
  const [observabilityStatus, setObservabilityStatus] =
    useState<ObservabilityStatusResponse | null>(null);
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
  const observabilitySummary = observabilityStatus
    ? [
        observabilityStatus.enabled ? 'enabled' : 'disabled',
        observabilityStatus.otelReady ? 'OTel ready' : 'OTel not ready',
        observabilityStatus.eventBus ? 'event bus reporting' : '',
      ]
        .filter(Boolean)
        .join(' - ')
    : '';

  const providerCards: SettingsRuntimeCard[] = [
    { id: 'telnyx', label: 'Telnyx', meta: quotas?.telnyx || runtimeProviders.telnyx },
    { id: 'instantly', label: 'Instantly', meta: quotas?.instantly || runtimeProviders.instantly },
    { id: 'docs', label: 'Document Sends', meta: quotas?.docs },
  ];
  const toolingCards: SettingsRuntimeCard[] = [
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
  const providerReadyCount = providerCards.filter(
    (card) => readinessFor(card.meta) === 'ready'
  ).length;
  const pendingAdminCount = adminTasks.filter(
    (task) => String(task.status || '').toLowerCase() === 'pending'
  ).length;
  const stateBackend = String(status.stateBackend || 'No data yet');
  const settingsStats: SettingsStat[] = [
    {
      label: 'Providers ready',
      value: `${providerReadyCount}/${providerCards.length}`,
      detail: 'quota and provider status',
      tone: providerReadyCount === providerCards.length ? 'lime' : 'amber',
    },
    {
      label: 'Core tooling',
      value: `${String(toolingCoreReady)}/${String(toolingCoreTotal)}`,
      detail: toolingOptionalTotal
        ? `${String(toolingOptionalReady)}/${String(toolingOptionalTotal)} optional enabled`
        : 'required systems',
      tone: toolingCoreReady >= toolingCoreTotal ? 'lime' : 'sky',
    },
    {
      label: 'Admin queue',
      value: String(pendingAdminCount),
      detail: 'pending infrastructure decisions',
      tone: pendingAdminCount ? 'amber' : 'lime',
    },
    {
      label: 'Safety holds',
      value: String(status.pendingApprovals || 0),
      detail: 'operator-gated outbound actions',
      tone: Number(status.pendingApprovals || 0) ? 'amber' : 'sky',
    },
  ];
  const releaseFallback = buildFallbackReleaseStatus({
    error,
    stateBackend,
    toolingCoreReady,
    toolingCoreTotal,
    metricsUrl,
  });

  useEffect(() => {
    if (!actionStatus) return undefined;
    const handle = window.setTimeout(() => setActionStatus(''), 5000);
    return () => window.clearTimeout(handle);
  }, [actionStatus]);

  useEffect(() => {
    let cancelled = false;
    fetchReleaseStatusRequest()
      .then((response) => {
        if (cancelled) return;
        setReleaseStatus(response);
      })
      .catch(() => {
        if (cancelled) return;
        setReleaseStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stateBackend, toolingCoreReady, toolingCoreTotal]);

  useEffect(() => {
    let cancelled = false;
    fetchObservabilityStatusRequest()
      .then((response) => {
        if (cancelled) return;
        setObservabilityStatus(response);
      })
      .catch(() => {
        if (cancelled) return;
        setObservabilityStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stateBackend]);

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
    <div className="pbk-settings-surface">
      <SettingsHero
        loading={loading}
        error={error}
        stateBackend={stateBackend}
        stats={settingsStats}
        onRefresh={() => void refresh()}
      />

      {actionStatus && (
        <div className="pbk-settings-status" aria-live="polite">
          {actionStatus}
        </div>
      )}
      {refreshingDecision && (
        <div className="pbk-settings-status muted" aria-live="polite">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          Refreshing Settings after admin decision...
        </div>
      )}

      <div className="pbk-settings-provider-strip" aria-label="Provider readiness">
        {providerCards.map((card) => (
          <SettingsProviderCard key={card.id} card={card} />
        ))}
      </div>

      <div className="pbk-settings-layout">
        <SettingsReleasePanel releaseStatus={releaseStatus} fallback={releaseFallback} />

        <section className="pbk-settings-card span-2">
          <div className="pbk-settings-card-head">
            <div>
              <span className="pbk-kicker">Runtime support</span>
              <h2>Agent tools</h2>
              <p>
                Repo-level systems that support research, observability, workflow health, and future
                agent training.
              </p>
            </div>
            <PbkDataSource endpoint="GET /api/tooling/status" status="ships" />
          </div>

          <div className="pbk-settings-tool-grid">
            {toolingCards.map((card) => (
              <SettingsToolCard key={card.id} card={card} />
            ))}
          </div>

          <div className="pbk-settings-metrics">
            <div>
              <span className="pbk-kicker">Metrics endpoint</span>
              {metricsUrl ? (
                <a href={metricsUrl} target="_blank" rel="noreferrer">
                  {metricsUrl}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : (
                <strong>{observabilitySummary || 'Waiting for bridge connection'}</strong>
              )}
            </div>
            <PbkDataSource
              endpoint="GET /api/observability/status"
              status="ships"
              note={observabilityStatus?.serviceName || 'canonical dashboard URL/status'}
            />
          </div>
        </section>

        <section className="pbk-settings-card pbk-settings-admin-card">
          <div className="pbk-settings-card-head">
            <div>
              <span className="pbk-kicker">Approvals</span>
              <h2>Admin approvals needed</h2>
              <p>Test mode and approval-backed infrastructure changes queued by Rex.</p>
            </div>
            <PbkDataSource endpoint="PUT /api/admin/tasks/:id" status="ships" />
          </div>
          <div className="admin-list">
            {adminTasks.map((task) => (
              <div key={String(task.id)} className="admin-row">
                <div>
                  <div className="admin-title">
                    {String(task.provider || 'admin')} / {String(task.action || 'review')}
                  </div>
                  <div className="admin-summary">
                    {String(task.summary || task.command || 'Administrative action')}
                  </div>
                  {String(task.status || '').toLowerCase() === 'pending' && (
                    <div className="admin-actions">
                      <button
                        type="button"
                        disabled={Boolean(pendingAction) || refreshingDecision}
                        onClick={() => confirmSettingsAdminDecision(task, 'approved')}
                        className="approve"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(pendingAction) || refreshingDecision}
                        onClick={() => confirmSettingsAdminDecision(task, 'rejected')}
                        className="decline"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
                <div className="admin-status">{formatRuntimeStatus(task.status)}</div>
              </div>
            ))}
            {!adminTasks.length && (
              <div className="pbk-settings-empty">No admin approvals are needed.</div>
            )}
          </div>
        </section>

        <SettingsSafetyRail status={status} />
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
