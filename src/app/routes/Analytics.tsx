import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, ChevronDown, Database, Download, RefreshCw, X } from 'lucide-react';
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
const ANALYTICS_RANGES = [
  { id: '7d', label: '7D', caption: 'Last 7 days', days: 7 },
  { id: '30d', label: '30D', caption: 'Last 30 days', days: 30 },
  { id: '90d', label: '90D', caption: 'Last 90 days', days: 90 },
  { id: 'ytd', label: 'YTD', caption: 'Year to date', days: 30 },
] as const;
type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
const ANALYTICS_RANGE_KEY = 'pbk-analytics-range';

function readAnalyticsRange() {
  try {
    const stored = window.localStorage.getItem(ANALYTICS_RANGE_KEY);
    return ANALYTICS_RANGES.find(({ id }) => id === stored) || ANALYTICS_RANGES[1];
  } catch {
    return ANALYTICS_RANGES[1];
  }
}

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
  canExport: boolean;
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
    timeZone: 'UTC',
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
  range,
}: {
  drilldown: CampaignDrilldownResponse | null;
  loading: boolean;
  range: AnalyticsRange;
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
    <section
      className="pbk-analytics-card pbk-analytics-attribution-card span-2"
      aria-labelledby="analytics-attribution-title"
    >
      <div className="pbk-analytics-card-head">
        <div>
          <h2 id="analytics-attribution-title">Campaign attribution</h2>
        </div>
        <span className="tf">{range.caption}</span>
      </div>

      {drilldown ? (
        <>
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
              empty="No campaign lead rows returned yet."
            />
            <CampaignAttributionList
              title="Channel ranking"
              rows={channelRows}
              empty="No channel attribution rows returned yet."
            />
          </div>

          <PbkDataSource
            endpoint="GET /api/analytics/campaign-drilldown"
            status="ships"
            note={`${shortNumber(leadRows)} rows returned - ${generated}`}
          />
        </>
      ) : (
        <p className="pbk-analytics-empty compact">
          {loading ? 'Loading campaign attribution...' : 'Campaign attribution unavailable.'}
        </p>
      )}
    </section>
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
        note="campaign attribution by source and channel"
      />
    </div>
  );
}

function AnalyticsStatRibbon({
  stats,
  available,
  range,
}: {
  stats: AnalyticsStats;
  available: boolean;
  range: AnalyticsRange;
}) {
  return (
    <section className="pbk-analytics-grid" aria-label="Key metrics">
      <div className="pbk-analytics-stat">
        <div className="l">Leads tracked</div>
        <div className="v">{available ? shortNumber(stats.leadsTracked) : '-'}</div>
        <div className="delta">Largest funnel stage</div>
      </div>
      <div className="pbk-analytics-stat">
        <div className="l">Closed deals</div>
        <div className="v">{available ? shortNumber(stats.closedDeals) : '-'}</div>
        <div className="delta">
          {available ? `${formatPercent(stats.closedRate)} close rate` : 'Acquisition funnel'}
        </div>
      </div>
      <div className="pbk-analytics-stat">
        <div className="l">Deal revenue</div>
        <div className="v sky">{available ? money(stats.totalRevenue) : '-'}</div>
        <div className="delta">{range.caption}</div>
      </div>
      <div className="pbk-analytics-stat">
        <div className="l">AI ROI</div>
        <div className="v">{available && stats.roiMultiple ? `${stats.roiMultiple}x` : '-'}</div>
        <div className="delta">
          {available ? `${money(stats.aiSpend)} tracked spend` : range.caption}
        </div>
      </div>
    </section>
  );
}

function AnalyticsHero({
  status,
  range,
  generatedAt,
  onRange,
  onRefresh,
  onExport,
}: {
  status: 'loading' | 'ready' | 'error';
  range: AnalyticsRange;
  generatedAt: string;
  onRange: (range: AnalyticsRange) => void;
  onRefresh: () => void;
  onExport: () => void;
}) {
  return (
    <header className="pbk-analytics-hero">
      <div className="pbk-analytics-hero-top">
        <h1 className="pbk-display pbk-h1">Analytics</h1>
        <div className="pbk-analytics-hero-actions">
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
            className="pbk-btn pbk-btn-primary pbk-btn-sm"
            onClick={onExport}
            disabled={status !== 'ready'}
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>
      <div className="pbk-analytics-toolbar">
        <div className="pbk-analytics-range" role="group" aria-label="Analytics date range">
          {ANALYTICS_RANGES.map((option) => (
            <button
              type="button"
              key={option.id}
              aria-pressed={option.id === range.id}
              onClick={() => onRange(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="pbk-analytics-sync" role="status">
          {status === 'loading'
            ? 'Loading data'
            : generatedAt
              ? `Updated ${formatGeneratedAt(generatedAt)}`
              : 'Data unavailable'}
        </span>
      </div>
    </header>
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
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const percent = maxTotal ? Math.round((stage.total / maxTotal) * 100) : 0;
  return (
    <button
      type="button"
      className="pbk-analytics-funnel-step"
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`Open ${stage.label} drill-down`}
      aria-describedby={`analytics-stage-count-${index}`}
    >
      <span className="fs-label">
        <span className="fs-index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>{' '}
        {stage.label}
      </span>
      <span className="fs-bar" aria-hidden="true">
        <span
          className="fs-fill"
          style={{ width: `${maxTotal ? (stage.total / maxTotal) * 100 : 0}%` }}
        />
      </span>
      <strong className="fs-count" id={`analytics-stage-count-${index}`}>
        {shortNumber(stage.total)}
      </strong>
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
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const height = (day.count / maxDaily) * 100;
  return (
    <button
      type="button"
      className="pbk-analytics-daily-bar"
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`Open daily deals for ${dayLabel(day.day)}: ${shortNumber(day.count)} closed, ${money(day.revenue)} revenue`}
    >
      <span className="bar-track" aria-hidden="true">
        <span className="bar-fill" style={{ height: `${height}%` }} />
      </span>
      <span className="bar-count">{shortNumber(day.count)}</span>
      <span className="bar-label">{dayLabel(day.day)}</span>
      <span className="bar-revenue">{money(day.revenue)}</span>
    </button>
  );
}

function AnalyticsMetricTile({ metric }: { metric: AnalyticsViewModel['aiMetrics'][number] }) {
  return (
    <div className="pbk-analytics-metric">
      <dt className="l">{metric.label}</dt>
      <dd className="v">{metric.value}</dd>
    </div>
  );
}

function DrillDownPanel({
  open,
  title,
  meta,
  items,
  canExport,
  onClose,
  onExport,
}: DrillDownPanelProps) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="pbk-analytics-drill"
      aria-labelledby="analytics-drill-title"
      aria-describedby="analytics-drill-meta"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="pbk-analytics-drill-head">
        <div>
          <h2 id="analytics-drill-title">{title}</h2>
          <p id="analytics-drill-meta">{meta}</p>
        </div>
        <button
          type="button"
          className="pbk-btn pbk-btn-ghost pbk-analytics-drill-close"
          onClick={onClose}
          aria-label="Close drill-down"
        >
          <X size={18} />
        </button>
      </header>

      <div className="pbk-analytics-drill-list">
        {items.length ? (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="pbk-analytics-drill-row"
              onClick={() => {
                onClose();
                navigate(`/leads/${encodeURIComponent(item.id)}`);
              }}
            >
              <span className="pbk-analytics-drill-record">
                <strong>{item.name || 'Unknown seller'}</strong>
                <span>{item.address || 'Address pending'}</span>
                <span>{item.stageLabel || item.stage || 'Lead'}</span>
              </span>
              <span className="pbk-analytics-drill-revenue">{money(item.revenue || 0)}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ))
        ) : (
          <div className="pbk-analytics-empty compact">
            No lead rows returned for this slice yet.
          </div>
        )}
      </div>

      <footer className="pbk-analytics-drill-foot">
        <button
          type="button"
          className="pbk-btn pbk-btn-primary"
          disabled={!canExport}
          onClick={onExport}
        >
          <Download size={15} />
          Export CSV
        </button>
      </footer>
    </dialog>
  );
}

const EMPTY_ANALYTICS = buildAnalyticsViewModel();

export function Analytics() {
  const [range, setRange] = useState(readAnalyticsRange);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<{
    range: AnalyticsRange['id'];
    model: AnalyticsViewModel;
    campaignAttribution: CampaignDrilldownResponse | null;
  }>();
  const requestVersion = useRef(0);
  const invalidateRequest = useCallback(() => {
    requestVersion.current++;
  }, []);
  const drillTrigger = useRef<HTMLButtonElement | null>(null);
  const current = snapshot?.range === range.id ? snapshot : undefined;
  const model = current?.model || EMPTY_ANALYTICS;
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
    const version = ++requestVersion.current;
    setStatus('loading');
    setError('');
    const period = { days: range.days, range: range.id === 'ytd' ? 'ytd' : '' };
    try {
      const [stagesResponse, timelineResponse, aiMetricsResponse, campaignAttributionResponse] =
        await Promise.all([
          fetchLeadStagesRequest({ limit: 500 }),
          fetchDealTimelineRequest(period),
          fetchAiMetricsRequest(period),
          fetchCampaignDrilldownRequest({ range: range.id, limit: 120 }).catch(() => null),
        ]);
      if (version !== requestVersion.current) return;
      if (
        range.id === 'ytd' &&
        (timelineResponse.range !== 'ytd' || aiMetricsResponse.range !== 'ytd')
      ) {
        throw new Error('The bridge did not confirm the year-to-date range.');
      }
      setSnapshot({
        range: range.id,
        model: buildAnalyticsViewModel({ stagesResponse, timelineResponse, aiMetricsResponse }),
        campaignAttribution: campaignAttributionResponse,
      });
      setStatus('ready');
    } catch (loadError) {
      if (version !== requestVersion.current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setStatus('error');
    }
  }, [range]);

  useEffect(() => {
    void loadAnalytics();
    return invalidateRequest;
  }, [invalidateRequest, loadAnalytics]);

  const selectRange = (nextRange: AnalyticsRange) => {
    if (nextRange.id === range.id) return;
    invalidateRequest();
    setStatus('loading');
    setError('');
    setRange(nextRange);
    try {
      window.localStorage.setItem(ANALYTICS_RANGE_KEY, nextRange.id);
    } catch {
      // The range still applies for this visit when storage is unavailable.
    }
  };

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

  const closeDrillDown = () => {
    setDrillDownPanel((current) => ({ ...current, open: false }));
    const trigger = drillTrigger.current;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  };

  const openStage = (stage: AnalyticsViewModel['funnel'][number], trigger: HTMLButtonElement) => {
    drillTrigger.current = trigger;
    setDrillDownPanel({
      open: true,
      title: stage.label,
      items: stage.leads,
      meta: `${shortNumber(stage.total)} total - ${stage.leads.length} rows returned - Revenue ${money(stage.revenue)}`,
    });
  };

  const openDay = (day: AnalyticsViewModel['dailyDeals'][number], trigger: HTMLButtonElement) => {
    drillTrigger.current = trigger;
    setDrillDownPanel({
      open: true,
      title: `Deals closed - ${dayLabel(day.day)}`,
      items: day.leads,
      meta: `${shortNumber(day.count)} closed - ${day.leads.length} rows returned - Revenue ${money(day.revenue)}`,
    });
  };

  return (
    <div className="pbk-analytics-surface">
      <main className="pbk-analytics-main">
        <AnalyticsHero
          status={status}
          range={range}
          generatedAt={model.generatedAt}
          onRange={selectRange}
          onRefresh={loadAnalytics}
          onExport={exportAnalytics}
        />

        {status === 'error' && (
          <section className="pbk-analytics-notice" role="alert">
            <div>
              <h2>{current ? 'Showing last loaded data' : 'Analytics unavailable'}</h2>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="pbk-btn pbk-btn-ghost pbk-btn-sm"
              onClick={loadAnalytics}
            >
              <RefreshCw size={14} />
              Retry
            </button>
          </section>
        )}

        {model.warnings.length > 0 && (
          <section className="pbk-analytics-notice" aria-label="Data source warnings">
            {model.warnings.join(' ')}
          </section>
        )}

        <AnalyticsStatRibbon stats={stats} available={Boolean(current)} range={range} />

        <section className="pbk-analytics-body">
          <div className="pbk-analytics-card">
            <div className="pbk-analytics-card-head">
              <div>
                <h2>Acquisition funnel</h2>
                <p>Counts and share of the largest stage</p>
              </div>
              <span className="tf">Current snapshot</span>
            </div>
            <div className="pbk-analytics-funnel">
              {model.funnel.length ? (
                model.funnel.map((stage, index) => (
                  <AnalyticsFunnelStep
                    key={stage.stage}
                    stage={stage}
                    index={index}
                    maxTotal={maxFunnel}
                    onOpen={(trigger) => openStage(stage, trigger)}
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
                <h2>Daily closed deals</h2>
                <p>Closed deals and revenue by day (UTC)</p>
              </div>
              <span className="tf">{range.caption}</span>
            </div>
            <div
              className="pbk-analytics-daily-bars"
              role="region"
              aria-label="Daily closed deals chart"
              tabIndex={model.dailyDeals.length ? 0 : undefined}
            >
              {model.dailyDeals.length ? (
                model.dailyDeals.map((day) => (
                  <AnalyticsDailyBar
                    key={day.day}
                    day={day}
                    maxDaily={maxDaily}
                    onOpen={(trigger) => openDay(day, trigger)}
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
                <h2>Cost and AI ROI</h2>
                <p>Period spend and revenue; lead counts from the current funnel.</p>
              </div>
              <span className="tf">{range.caption}</span>
            </div>
            <div className="roi-grid">
              <div className="roi-cell">
                <div className="l">Cost per contacted lead</div>
                <div className="v">{current ? money(model.roi.costPerContactedLead) : '-'}</div>
                <div className="sub">AI spend divided by contacted stages</div>
              </div>
              <div className="roi-cell">
                <div className="l">Cost per qualified lead</div>
                <div className="v">{current ? money(model.roi.costPerQualifiedLead) : '-'}</div>
                <div className="sub">Qualified, offer, and closed stages</div>
              </div>
              <div className="roi-cell">
                <div className="l">ROI on AI spend</div>
                <div className="v lime">
                  {model.roi.roiMultiple ? `${model.roi.roiMultiple}x` : '-'}
                </div>
                <div className="sub">
                  {current ? `${money(model.roi.revenue)} revenue` : 'Revenue / AI spend'}
                </div>
              </div>
              <div className="roi-cell">
                <div className="l">Cost per closed deal</div>
                <div className="v">{current ? money(model.roi.costPerClosedDeal) : '-'}</div>
                <div className="sub">
                  {current ? `${shortNumber(stats.closedDeals)} closed deals` : 'Current funnel'}
                </div>
              </div>
            </div>
            {current && (
              <div className="roi-formula">
                {money(model.roi.aiSpend)} AI spend - {shortNumber(stats.leadsTracked)} tracked
                leads - {money(model.roi.revenue)} revenue
              </div>
            )}
            <PbkDataSource endpoint="GET /api/observability/ai-metrics" status="ships" />
          </div>

          <div className="pbk-analytics-card">
            <div className="pbk-analytics-card-head">
              <div>
                <h2>AI performance</h2>
              </div>
              <span className="tf">{range.caption}</span>
            </div>
            <dl className="pbk-analytics-metrics">
              {current
                ? model.aiMetrics.map((metric) => (
                    <AnalyticsMetricTile key={metric.label} metric={metric} />
                  ))
                : model.aiMetrics.map((metric) => (
                    <AnalyticsMetricTile key={metric.label} metric={{ ...metric, value: '-' }} />
                  ))}
            </dl>
            <PbkDataSource endpoint="GET /api/observability/ai-metrics" status="ships" />
          </div>

          <CampaignAttributionPanel
            drilldown={current?.campaignAttribution || null}
            loading={status === 'loading'}
            range={range}
          />
        </section>

        <details className="pbk-analytics-sources">
          <summary>
            <Database size={15} aria-hidden="true" /> Data sources{' '}
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          {current && <p>{model.source}</p>}
          <AnalyticsSourceRail />
        </details>

        <DrillDownPanel
          open={drillDownPanel.open}
          title={drillDownPanel.title}
          meta={drillDownPanel.meta}
          items={drillDownPanel.items}
          canExport={status === 'ready'}
          onClose={closeDrillDown}
          onExport={exportAnalytics}
        />
      </main>
    </div>
  );
}
