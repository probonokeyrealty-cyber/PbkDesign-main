import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, RefreshCw, X } from 'lucide-react';
import {
  fetchAiMetricsRequest,
  fetchDealTimelineRequest,
  fetchLeadStagesRequest,
  type AnalyticsLead,
} from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';
import { buildAnalyticsCsv, buildAnalyticsViewModel } from './analyticsRuntimeLogic.js';

type AnalyticsViewModel = ReturnType<typeof buildAnalyticsViewModel>;
type AnalyticsLeadItem = AnalyticsLead & {
  name?: string;
  revenue?: number;
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
                  navigate(`/leads?lead=${encodeURIComponent(item.id)}`);
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
      const [stagesResponse, timelineResponse, aiMetricsResponse] = await Promise.all([
        fetchLeadStagesRequest({ limit: 500 }),
        fetchDealTimelineRequest({ days: 30 }),
        fetchAiMetricsRequest({ days: 30 }),
      ]);
      setModel(buildAnalyticsViewModel({ stagesResponse, timelineResponse, aiMetricsResponse }));
      setStatus('ready');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
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
  const totalFunnel = useMemo(
    () => model.funnel.reduce((sum, stage) => sum + stage.total, 0),
    [model.funnel]
  );
  const totalRevenue = useMemo(
    () => model.dailyDeals.reduce((sum, day) => sum + day.revenue, 0),
    [model.dailyDeals]
  );

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
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Analytics</h1>
          <p className="text-sm text-slate-400">
            Live funnel, deal revenue, ROI, and AI performance from the PBK bridge.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {status === 'loading'
              ? 'Loading runtime analytics...'
              : `${shortNumber(totalFunnel)} leads tracked - ${money(totalRevenue)} deal revenue`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={loadAnalytics}
            disabled={status === 'loading'}
          >
            <RefreshCw size={15} />
            Retry
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={exportAnalytics}
            disabled={status !== 'ready'}
          >
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </div>

      {status === 'error' && (
        <section className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4">
          <h2 className="text-sm font-semibold text-red-100">Analytics bridge unavailable</h2>
          <p className="mt-1 text-sm text-red-200/80">{error}</p>
        </section>
      )}

      {model.warnings.length > 0 && (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          {model.warnings.join(' ')}
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Acquisition funnel</h2>
            <p className="text-xs text-slate-500">Click a stage to inspect returned lead rows.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {model.funnel.length ? (
            model.funnel.map((stage, index) => (
              <button
                key={stage.stage}
                type="button"
                className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-left transition hover:border-sky-500/40 hover:bg-slate-900/70"
                onClick={() => openStage(stage)}
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  Step {index + 1}
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-100">{stage.label}</div>
                <div className="mt-1 text-2xl font-semibold text-sky-300">
                  {shortNumber(stage.total)}
                </div>
              </button>
            ))
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-6 text-sm text-slate-400 md:col-span-4">
              {status === 'loading' ? 'Loading lead stages...' : 'No lead stage data returned yet.'}
            </div>
          )}
        </div>
      </section>

      <section className="roi-card">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="l">Cost per contacted lead</div>
            <div className="v">{money(model.roi.costPerContactedLead)}</div>
          </div>
          <div>
            <div className="l">Cost per qualified lead</div>
            <div className="v">{money(model.roi.costPerQualifiedLead)}</div>
          </div>
          <div>
            <div className="l">ROI on AI spend</div>
            <div className="v lime">
              {model.roi.roiMultiple ? `${model.roi.roiMultiple}x` : '-'}
            </div>
          </div>
          <div>
            <div className="l">Cost per closed deal</div>
            <div className="v">{money(model.roi.costPerClosedDeal)}</div>
          </div>
        </div>
        <div className="roi-formula">
          {money(model.roi.aiSpend)} AI spend / {shortNumber(totalFunnel)} leads -{' '}
          {money(model.roi.revenue)} revenue
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-100">Deals closed - daily</h2>
          <p className="text-xs text-slate-500">
            Each bar opens the deal rows returned for that day.
          </p>
        </div>
        <div className="daily-bars">
          {model.dailyDeals.length ? (
            model.dailyDeals.map((day) => (
              <button
                key={day.day}
                type="button"
                className="daily-bar"
                onClick={() => openDay(day)}
              >
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ height: `${(day.count / maxDaily) * 100}%` }}
                  />
                </span>
                <span className="text-xs text-slate-400">{dayLabel(day.day)}</span>
                <span className="text-[11px] text-slate-500">{shortNumber(day.count)}</span>
              </button>
            ))
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-6 text-sm text-slate-400">
              {status === 'loading'
                ? 'Loading deal timeline...'
                : 'No closed deal timeline returned yet.'}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <h2 className="text-sm font-semibold text-slate-100">AI performance</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {model.aiMetrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-300"
            >
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                {metric.label}
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-100">{metric.value}</div>
            </div>
          ))}
        </div>
      </section>

      <DrillDownPanel
        open={drillDownPanel.open}
        title={drillDownPanel.title}
        meta={drillDownPanel.meta}
        items={drillDownPanel.items}
        onClose={() => setDrillDownPanel((current) => ({ ...current, open: false }))}
        onExport={exportAnalytics}
      />
    </div>
  );
}
