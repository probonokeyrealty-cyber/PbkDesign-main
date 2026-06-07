import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, Database, Download, RefreshCw, TrendingUp, X } from 'lucide-react';
import { PbkDataSource } from '../../components/pbk/index';
import {
  fetchAiMetricsRequest,
  fetchCampaignDrilldownRequest,
  fetchDealTimelineRequest,
  fetchLeadStagesRequest,
  type AnalyticsLead,
  type CampaignDrilldownResponse,
  type CampaignDrilldownRow,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';
import { buildAnalyticsCsv, buildAnalyticsViewModel } from './analyticsRuntimeLogic.js';

type AnalyticsViewModel = ReturnType<typeof buildAnalyticsViewModel>;
type AnalyticsLeadItem = AnalyticsLead & {
  name?: string;
  revenue?: number;
};
type AnalyticsStats = {
  leadsTracked: number;
  closedDeals: number;
  closedRate: number;
  totalRevenue: number;
  roiMultiple: number;
  aiSpend: number;
  generatedAt: string;
};
type CampaignAttributionRow = {
  id: string;
  label: string;
  leads: number;
  sent: number;
  opened: number;
  replied: number;
  connected: number;
  cost: number;
};

interface DrillDownPanelProps {
  open: boolean;
  title: string;
  meta: string;
  items: AnalyticsLeadItem[];
  onClose: () => void;
  onExport: () => void;
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function shortNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0);
}

function dayLabel(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value || '-';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, '')}%`;
}

function formatGeneratedAt(value: string) {
  if (!value) return 'runtime';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function buildAnalyticsStats(model: AnalyticsViewModel): AnalyticsStats {
  const leadUniverse = Math.max(0, ...model.funnel.map((stage) => stage.total));
  const closedFromFunnel = model.funnel
    .filter((stage) => /closed|won|signed|funded/i.test(`${stage.stage} ${stage.label}`))
    .reduce((sum, stage) => sum + stage.total, 0);
  const closedFromTimeline = model.dailyDeals.reduce((sum, day) => sum + day.count, 0);
  const closedDeals = closedFromFunnel || closedFromTimeline;
  const totalRevenue = model.dailyDeals.reduce((sum, day) => sum + day.revenue, 0);
  return {
    leadsTracked: leadUniverse,
    closedDeals,
    closedRate: leadUniverse ? (closedDeals / leadUniverse) * 100 : 0,
    totalRevenue,
    roiMultiple: model.roi.roiMultiple,
    aiSpend: model.roi.aiSpend,
    generatedAt: model.generatedAt,
  };
}

function campaignRowCost(row: CampaignDrilldownRow) {
  const channel = String(row.channel || '').toLowerCase();
  if (channel === 'sms') return 0.021;
  if (channel === 'call') return 0.014;
  return 0.01;
}

function addCampaignAttributionRow(
  grouped: Map<string, CampaignAttributionRow>,
  id: string,
  label: string,
  row: CampaignDrilldownRow
) {
  const current =
    grouped.get(id) ||
    ({
      id,
      label,
      leads: 0,
      sent: 0,
      opened: 0,
      replied: 0,
      connected: 0,
      cost: 0,
    } satisfies CampaignAttributionRow);
  current.leads += 1;
  current.sent += row.sent ? 1 : 0;
  current.opened += row.opened ? 1 : 0;
  current.replied += row.replied ? 1 : 0;
  current.connected += row.connected ? 1 : 0;
  current.cost += campaignRowCost(row);
  grouped.set(id, current);
}

function sortCampaignAttributionRows(rows: CampaignAttributionRow[]) {
  return rows.sort((left, right) => {
    const leftScore = left.replied * 4 + left.connected * 3 + left.opened + left.sent;
    const rightScore = right.replied * 4 + right.connected * 3 + right.opened + right.sent;
    return rightScore - leftScore;
  });
}

function buildCampaignAttributionRows(
  drilldown: CampaignDrilldownResponse | null,
  groupBy: 'source' | 'channel'
) {
  const grouped = new Map<string, CampaignAttributionRow>();
  for (const row of drilldown?.rows || []) {
    const id =
      groupBy === 'source'
        ? String(row.source || 'unassigned')
        : String(row.channel || 'email').toLowerCase();
    const label =
      groupBy === 'source'
        ? id || 'Unassigned source'
        : id === 'sms'
          ? 'SMS'
          : id === 'call'
            ? 'Calls'
            : id === 'mixed'
              ? 'Mixed'
              : 'Email';
    addCampaignAttributionRow(grouped, id || 'unassigned', label, row);
  }
  return sortCampaignAttributionRows(Array.from(grouped.values())).slice(
    0,
    groupBy === 'source' ? 5 : 4
  );
}

function CampaignAttributionList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: CampaignAttributionRow[];
  empty: string;
}) {
  return (
    <div className="pbk-analytics-attribution-list">
      <h3>{title}</h3>
      {rows.length ? (
        rows.map((row) => {
          const replyRate = row.leads ? (row.replied / row.leads) * 100 : 0;
          return (
            <div className="pbk-analytics-attribution-row" key={row.id}>
              <div className="min-w-0">
                <strong title={row.label}>{row.label}</strong>
                <span>
                  {shortNumber(row.sent)} sent - {shortNumber(row.replied)} replies -{' '}
                  {money(row.cost)} spend
                </span>
              </div>
              <div className="rate">{formatPercent(replyRate)}</div>
            </div>
          );
        })
      ) : (
        <div className="pbk-analytics-empty compact">{empty}</div>
      )}
    </div>
  );
}

function CampaignAttributionPanel({
  drilldown,
  loading,
}: {
  drilldown: CampaignDrilldownResponse | null;
  loading: boolean;
}) {
  const sourceRows = useMemo(() => buildCampaignAttributionRows(drilldown, 'source'), [drilldown]);
  const channelRows = useMemo(
    () => buildCampaignAttributionRows(drilldown, 'channel'),
    [drilldown]
  );
  const summary = drilldown?.summary || {};
  const leadRows = drilldown?.rows?.length || 0;
  const replyRate = Number(summary.replyRate || 0);
  const connectRate = Number(summary.connectRate || 0);
  const generated = drilldown?.generatedAt ? formatGeneratedAt(drilldown.generatedAt) : 'waiting';

  return (
    <div className="pbk-analytics-card pbk-analytics-premium-card pbk-analytics-attribution-card">
      <div className="pbk-analytics-card-head">
        <div>
          <h2>Campaign attribution</h2>
          <p>Source, channel, reply, and connected-call signals from campaign drilldown rows.</p>
        </div>
        <span className="tf">{loading && !drilldown ? 'syncing' : 'bridge drilldown'}</span>
      </div>

      <div className="pbk-analytics-attribution-summary">
        <div>
          <span>Lead rows</span>
          <strong>{shortNumber(Number(summary.leads || leadRows || 0))}</strong>
        </div>
        <div>
          <span>Replies</span>
          <strong>{shortNumber(Number(summary.replied || 0))}</strong>
        </div>
        <div>
          <span>Reply rate</span>
          <strong>{formatPercent(replyRate)}</strong>
        </div>
        <div>
          <span>Connect</span>
          <strong>{formatPercent(connectRate)}</strong>
        </div>
      </div>

      <div className="pbk-analytics-attribution-grid">
        <CampaignAttributionList
          title="Source ranking"
          rows={sourceRows}
          empty={
            loading
              ? 'Loading campaign attribution from the bridge...'
              : 'No campaign lead rows returned yet.'
          }
        />
        <CampaignAttributionList
          title="Channel ranking"
          rows={channelRows}
          empty={
            loading
              ? 'Loading channel attribution from the bridge...'
              : 'No channel attribution rows returned yet.'
          }
        />
      </div>

      <PbkDataSource
        endpoint="GET /api/analytics/campaign-drilldown"
        status="ships"
        note={`${leadRows ? `${shortNumber(leadRows)} rows` : 'no rows yet'} - generated ${generated}`}
      />
    </div>
  );
}

function AnalyticsSourceRail() {
  return (
    <div className="pbk-analytics-source-rail" aria-label="Analytics data sources">
      <PbkDataSource
        endpoint="GET /api/leads/stages"
        status="ships"
        note="funnel totals and lead drill-down rows"
      />
      <PbkDataSource
        endpoint="GET /api/deals/timeline"
        status="ships"
        note="daily closed deals and revenue"
      />
      <PbkDataSource
        endpoint="GET /api/observability/ai-metrics"
        status="ships"
        note="AI spend, latency, retries, and safety metrics"
      />
      <PbkDataSource
        endpoint="GET /api/analytics/campaign-drilldown"
        status="ships"
        note="premium source-ranked campaign attribution"
      />
    </div>
  );
}

function AnalyticsStatRibbon({ stats }: { stats: AnalyticsStats }) {
  const generatedLabel = formatGeneratedAt(stats.generatedAt);
  return (
    <div className="pbk-analytics-grid">
      <div className="pbk-analytics-stat">
        <div className="l">Leads tracked</div>
        <div className="v sky">{shortNumber(stats.leadsTracked)}</div>
        <div className="delta">largest bridge funnel stage</div>
      </div>
      <div className="pbk-analytics-stat">
        <div className="l">Closed deals</div>
        <div className="v lime">{shortNumber(stats.closedDeals)}</div>
        <div className="delta">{formatPercent(stats.closedRate)} close rate</div>
      </div>
      <div className="pbk-analytics-stat">
        <div className="l">Deal revenue</div>
        <div className="v">{money(stats.totalRevenue)}</div>
        <div className="delta">from deal timeline</div>
      </div>
      <div className="pbk-analytics-stat">
        <div className="l">AI ROI</div>
        <div className="v amber">{stats.roiMultiple ? `${stats.roiMultiple}x` : '-'}</div>
        <div className="delta">
          {money(stats.aiSpend)} tracked spend - {generatedLabel}
        </div>
      </div>
    </div>
  );
}

function AnalyticsHero({
  status,
  stats,
  source,
  onRefresh,
  onExport,
}: {
  status: 'loading' | 'ready' | 'error';
  stats: AnalyticsStats;
  source: string;
  onRefresh: () => void;
  onExport: () => void;
}) {
  return (
    <section className="pbk-analytics-hero">
      <div className="pbk-analytics-hero-top">
        <div>
          <div className="pbk-eyebrow">
            Live analytics - {shortNumber(stats.leadsTracked)} leads - {money(stats.totalRevenue)}
          </div>
          <h1 className="pbk-display pbk-h1">
            Analytics &amp; <em>deal flow</em>.
          </h1>
          <p>
            Funnel, deal revenue, ROI, and AI performance are pulled from the PBK bridge. Premium
            campaign attribution now reads the same bridge drilldown contract used by Campaigns.
          </p>
        </div>
        <div className="pbk-analytics-hero-actions">
          <span className="pbk-analytics-sync">
            <Database size={13} />
            {status === 'loading' ? 'syncing' : source || 'runtime'}
          </span>
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            onClick={onRefresh}
            disabled={status === 'loading'}
          >
            <RefreshCw size={14} className={status === 'loading' ? 'animate-spin' : ''} />
            {status === 'loading' ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-sky-gradient pbk-btn-sm"
            onClick={onExport}
            disabled={status !== 'ready'}
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>
      <AnalyticsStatRibbon stats={stats} />
      <AnalyticsSourceRail />
    </section>
  );
}

function AnalyticsFunnelStep({
  stage,
  index,
  maxTotal,
  onOpen,
}: {
  stage: AnalyticsViewModel['funnel'][number];
  index: number;
  maxTotal: number;
  onOpen: () => void;
}) {
  const percent = maxTotal ? Math.round((stage.total / maxTotal) * 100) : 0;
  return (
    <button
      type="button"
      className={`pbk-analytics-funnel-step s${Math.min(index + 1, 5)}`}
      onClick={onOpen}
      aria-label={`Open ${stage.label} drill-down`}
    >
      <span className="fs-label">
        Step {index + 1} - {stage.label}
      </span>
      <span className="fs-bar">
        <span className="fs-fill" style={{ width: `${Math.max(4, percent)}%` }} />
        <strong>{shortNumber(stage.total)}</strong>
      </span>
      <span className="fs-val">{percent}%</span>
    </button>
  );
}

function AnalyticsDailyBar({
  day,
  maxDaily,
  onOpen,
}: {
  day: AnalyticsViewModel['dailyDeals'][number];
  maxDaily: number;
  onOpen: () => void;
}) {
  const height = Math.max(4, (day.count / maxDaily) * 100);
  return (
    <button
      type="button"
      className="pbk-analytics-daily-bar"
      onClick={onOpen}
      aria-label={`Open daily deals for ${dayLabel(day.day)}`}
    >
      <span className="bar-track">
        <span className="bar-fill" style={{ height: `${height}%` }} />
      </span>
      <span className="bar-count">{shortNumber(day.count)}</span>
      <span className="bar-label">{dayLabel(day.day)}</span>
      <span className="bar-revenue">{money(day.revenue)}</span>
    </button>
  );
}

function AnalyticsMetricTile({ metric }: { metric: AnalyticsViewModel['aiMetrics'][number] }) {
  const label = metric.label.toLowerCase();
  const tone = label.includes('safety') ? 'amber' : label.includes('retry') ? 'lime' : 'sky';
  return (
    <div className={`pbk-analytics-metric ${tone}`}>
      <div className="metric-icon">
        <BarChart3 size={15} />
      </div>
      <div>
        <div className="l">{metric.label}</div>
        <div className="v">{metric.value}</div>
        <div className="sub">raw {String(metric.raw ?? 0)}</div>
      </div>
    </div>
  );
}

function DrillDownPanel({ open, title, meta, items, onClose, onExport }: DrillDownPanelProps) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drill-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="drill-panel min-w-[min(320px,calc(100vw-2rem))]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Drill-down</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-100">{title}</h2>
            <p className="mt-1 text-xs text-slate-500">{meta}</p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close drill-down"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {items.length ? (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 py-3 text-left transition hover:border-sky-500/40"
                onClick={() => {
                  onClose();
                  navigate(`/leads/${encodeURIComponent(item.id)}`);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-100">
                    {item.name || 'Unknown seller'}
                  </span>
                  <span className="text-xs text-lime-300">{money(item.revenue || 0)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {item.address || 'Address pending'}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  {item.stageLabel || item.stage || 'Lead'}
                </div>
              </button>
            ))
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-6 text-center text-sm text-slate-400">
              No lead rows returned for this slice yet.
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 p-4">
          <button type="button" className="btn-secondary w-full justify-center" onClick={onExport}>
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </aside>
    </div>
  );
}

const EMPTY_ANALYTICS = buildAnalyticsViewModel();

export function Analytics() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [model, setModel] = useState<AnalyticsViewModel>(EMPTY_ANALYTICS);
  const [campaignAttribution, setCampaignAttribution] = useState<CampaignDrilldownResponse | null>(
    null
  );
  const [drillDownPanel, setDrillDownPanel] = useState<{
    open: boolean;
    title: string;
    meta: string;
    items: AnalyticsLeadItem[];
  }>({
    open: false,
    title: '',
    meta: '',
    items: [],
  });

  const loadAnalytics = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [stagesResponse, timelineResponse, aiMetricsResponse, campaignAttributionResponse] =
        await Promise.all([
          fetchLeadStagesRequest({ limit: 500 }),
          fetchDealTimelineRequest({ days: 30 }),
          fetchAiMetricsRequest({ days: 30 }),
          fetchCampaignDrilldownRequest({ range: '30d', limit: 120 }).catch(() => null),
        ]);
      setModel(buildAnalyticsViewModel({ stagesResponse, timelineResponse, aiMetricsResponse }));
      setCampaignAttribution(campaignAttributionResponse);
      setStatus('ready');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setCampaignAttribution(null);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const maxDaily = useMemo(
    () => Math.max(1, ...model.dailyDeals.map((item) => item.count)),
    [model.dailyDeals]
  );
  const maxFunnel = useMemo(
    () => Math.max(1, ...model.funnel.map((stage) => stage.total)),
    [model.funnel]
  );
  const stats = useMemo(() => buildAnalyticsStats(model), [model]);

  const exportAnalytics = useCallback(() => {
    downloadCsv(
      `pbk-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
      buildAnalyticsCsv(model)
    );
    showUiToast({
      tone: 'success',
      title: 'CSV downloaded',
      desc: 'Exported the current analytics dataset.',
    });
  }, [model]);

  const openStage = (stage: AnalyticsViewModel['funnel'][number]) => {
    setDrillDownPanel({
      open: true,
      title: stage.label,
      items: stage.leads,
      meta: `${shortNumber(stage.total)} total - ${stage.leads.length} rows returned - Revenue ${money(stage.revenue)}`,
    });
  };

  const openDay = (day: AnalyticsViewModel['dailyDeals'][number]) => {
    setDrillDownPanel({
      open: true,
      title: `Deals closed - ${dayLabel(day.day)}`,
      items: day.leads,
      meta: `${shortNumber(day.count)} closed - ${day.leads.length} rows returned - Revenue ${money(day.revenue)}`,
    });
  };

  return (
    <div className="pbk-analytics-surface min-h-full text-slate-100">
      <main className="space-y-4 p-4 md:p-6">
        <AnalyticsHero
          status={status}
          stats={stats}
          source={model.source}
          onRefresh={loadAnalytics}
          onExport={exportAnalytics}
        />

        {status === 'error' && (
          <section className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
            <h2 className="text-sm font-semibold text-red-100">Analytics bridge unavailable</h2>
            <p className="mt-1 text-sm text-red-200/80">{error}</p>
            <button
              type="button"
              className="pbk-btn pbk-btn-ghost pbk-btn-sm mt-3"
              onClick={loadAnalytics}
            >
              <RefreshCw size={14} />
              Retry bridge fetch
            </button>
          </section>
        )}

        {model.warnings.length > 0 && (
          <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            {model.warnings.join(' ')}
          </section>
        )}

        <section className="pbk-analytics-body">
          <div className="pbk-analytics-card span-2">
            <div className="pbk-analytics-card-head">
              <div>
                <h2>Acquisition funnel</h2>
                <p>
                  {shortNumber(stats.leadsTracked)} leads - {shortNumber(stats.closedDeals)} closed
                  - {formatPercent(stats.closedRate)} closed rate
                </p>
              </div>
              <span className="tf">bridge funnel</span>
            </div>
            <div className="pbk-analytics-funnel">
              {model.funnel.length ? (
                model.funnel.map((stage, index) => (
                  <AnalyticsFunnelStep
                    key={stage.stage}
                    stage={stage}
                    index={index}
                    maxTotal={maxFunnel}
                    onOpen={() => openStage(stage)}
                  />
                ))
              ) : (
                <div className="pbk-analytics-empty">
                  {status === 'loading'
                    ? 'Loading lead stages from the bridge...'
                    : 'No lead stage data returned yet.'}
                </div>
              )}
            </div>
            <PbkDataSource endpoint="GET /api/leads/stages" status="ships" />
          </div>

          <div className="pbk-analytics-card pbk-analytics-deal-card">
            <div className="pbk-analytics-card-head">
              <div>
                <h2>Deals closed - daily</h2>
                <p>Each bar opens bridge-returned deal rows for that day.</p>
              </div>
              <span className="tf">30 days</span>
            </div>
            <div className="pbk-analytics-daily-bars">
              {model.dailyDeals.length ? (
                model.dailyDeals.map((day) => (
                  <AnalyticsDailyBar
                    key={day.day}
                    day={day}
                    maxDaily={maxDaily}
                    onOpen={() => openDay(day)}
                  />
                ))
              ) : (
                <div className="pbk-analytics-empty">
                  {status === 'loading'
                    ? 'Loading deal timeline from the bridge...'
                    : 'No closed deal timeline returned yet.'}
                </div>
              )}
            </div>
            <PbkDataSource endpoint="GET /api/deals/timeline" status="ships" />
          </div>

          <div className="pbk-analytics-card pbk-analytics-roi-card">
            <div className="pbk-analytics-card-head">
              <div>
                <h2>Cost per lead - AI ROI</h2>
                <p>Spend math uses observability metrics plus deal timeline revenue.</p>
              </div>
              <TrendingUp size={16} />
            </div>
            <div className="roi-grid">
              <div className="roi-cell">
                <div className="l">Cost per contacted lead</div>
                <div className="v">{money(model.roi.costPerContactedLead)}</div>
                <div className="sub">AI spend divided by contacted stages</div>
              </div>
              <div className="roi-cell">
                <div className="l">Cost per qualified lead</div>
                <div className="v">{money(model.roi.costPerQualifiedLead)}</div>
                <div className="sub">Qualified, offer, and closed stages</div>
              </div>
              <div className="roi-cell">
                <div className="l">ROI on AI spend</div>
                <div className="v lime">
                  {model.roi.roiMultiple ? `${model.roi.roiMultiple}x` : '-'}
                </div>
                <div className="sub">{money(model.roi.revenue)} revenue</div>
              </div>
              <div className="roi-cell">
                <div className="l">Cost per closed deal</div>
                <div className="v">{money(model.roi.costPerClosedDeal)}</div>
                <div className="sub">{shortNumber(stats.closedDeals)} closed deals</div>
              </div>
            </div>
            <div className="roi-formula">
              {money(model.roi.aiSpend)} AI spend - {shortNumber(stats.leadsTracked)} tracked leads
              - {money(model.roi.revenue)} revenue
            </div>
            <PbkDataSource endpoint="GET /api/observability/ai-metrics" status="ships" />
          </div>

          <div className="pbk-analytics-card">
            <div className="pbk-analytics-card-head">
              <div>
                <h2>AI performance</h2>
                <p>Latency, QA retry, and safety signal health.</p>
              </div>
            </div>
            <div className="pbk-analytics-metrics">
              {model.aiMetrics.map((metric) => (
                <AnalyticsMetricTile key={metric.label} metric={metric} />
              ))}
            </div>
            <PbkDataSource endpoint="GET /api/observability/ai-metrics" status="ships" />
          </div>

          <CampaignAttributionPanel
            drilldown={campaignAttribution}
            loading={status === 'loading'}
          />
        </section>

        <DrillDownPanel
          open={drillDownPanel.open}
          title={drillDownPanel.title}
          meta={drillDownPanel.meta}
          items={drillDownPanel.items}
          onClose={() => setDrillDownPanel((current) => ({ ...current, open: false }))}
          onExport={exportAnalytics}
        />
      </main>
    </div>
  );
}
