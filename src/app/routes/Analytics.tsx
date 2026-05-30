import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, X } from 'lucide-react';
import { showUiToast } from '../utils/uiFeedback';

type SampleLead = {
  id: string;
  name: string;
  address: string;
  stage: string;
  closeDate?: string;
  revenue: number;
};

const SAMPLE_LEADS: SampleLead[] = [
  { id: 'lead-101', name: 'Diane Kowalski', address: '202 Cherry Ln, Columbus OH', stage: 'Contacted', closeDate: 'Mon', revenue: 8500 },
  { id: 'lead-102', name: 'Marco Hill', address: '44 Broadview Ave, Cleveland OH', stage: 'Qualified', closeDate: 'Tue', revenue: 12000 },
  { id: 'lead-103', name: 'Lena Brooks', address: '19 Maple Ridge, Akron OH', stage: 'Offer Sent', closeDate: 'Wed', revenue: 14000 },
  { id: 'lead-104', name: 'Sam Ortega', address: '780 Lincoln St, Dayton OH', stage: 'Closed', closeDate: 'Fri', revenue: 9800 },
  { id: 'lead-105', name: 'Nora Fields', address: '311 Oak Bend, Toledo OH', stage: 'Closed', closeDate: 'Fri', revenue: 24700 },
  { id: 'lead-106', name: 'Evan Price', address: '88 Grove Park, Columbus OH', stage: 'Qualified', closeDate: 'Sat', revenue: 0 },
];

const FUNNEL = [
  { stage: 'Contacted', total: 836, sampleStage: 'Contacted' },
  { stage: 'Qualified', total: 471, sampleStage: 'Qualified' },
  { stage: 'Offer Sent', total: 128, sampleStage: 'Offer Sent' },
  { stage: 'Closed', total: 27, sampleStage: 'Closed' },
];

const DAILY_DEALS = [
  { day: 'Mon', count: 2, revenue: 8500 },
  { day: 'Tue', count: 3, revenue: 12000 },
  { day: 'Wed', count: 4, revenue: 14000 },
  { day: 'Thu', count: 1, revenue: 4200 },
  { day: 'Fri', count: 5, revenue: 34500 },
  { day: 'Sat', count: 2, revenue: 7600 },
  { day: 'Sun', count: 1, revenue: 5200 },
];

interface DrillDownPanelProps {
  open: boolean;
  title: string;
  meta: string;
  items: SampleLead[];
  onClose: () => void;
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function DrillDownPanel({ open, title, meta, items, onClose }: DrillDownPanelProps) {
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
        className="drill-panel"
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
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close drill-down">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {items.map((item) => (
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
                <span className="font-semibold text-slate-100">{item.name}</span>
                <span className="text-xs text-lime-300">{money(item.revenue)}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">{item.address}</div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">{item.stage}</div>
            </button>
          ))}
        </div>

        <div className="border-t border-slate-800 p-4">
          <button
            type="button"
            className="btn-secondary w-full justify-center"
            onClick={() => showUiToast({ tone: 'info', title: 'Export queued', desc: 'CSV export is a UI-only mock.' })}
          >
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </aside>
    </div>
  );
}

export function Analytics() {
  const [drillDownPanel, setDrillDownPanel] = useState<{
    open: boolean;
    title: string;
    meta: string;
    items: SampleLead[];
  }>({
    open: false,
    title: '',
    meta: '',
    items: [],
  });

  const maxDaily = useMemo(() => Math.max(...DAILY_DEALS.map((item) => item.count)), []);

  const openStage = (stage: string, total: number) => {
    const items = SAMPLE_LEADS.filter((lead) => lead.stage === stage).slice(0, 3);
    setDrillDownPanel({
      open: true,
      title: stage,
      items,
      meta: `Total in stage ${total} - Showing ${items.length} sample - Revenue ${money(items.reduce((sum, lead) => sum + lead.revenue, 0))}`,
    });
  };

  const openDay = (day: string, revenue: number) => {
    const items = SAMPLE_LEADS.filter((lead) => lead.closeDate === day).slice(0, 3);
    setDrillDownPanel({
      open: true,
      title: `Deals closed - ${day}`,
      items,
      meta: `Day total ${items.length || 0} - Showing ${items.length} sample - Revenue ${money(revenue)}`,
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Analytics</h1>
        <p className="text-sm text-slate-400">Clickable funnel and deal bars with UI-only drill-downs.</p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Acquisition funnel</h2>
            <p className="text-xs text-slate-500">Click a stage to inspect sample leads.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {FUNNEL.map((stage, index) => (
            <button
              key={stage.stage}
              type="button"
              className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-left transition hover:border-sky-500/40 hover:bg-slate-900/70"
              onClick={() => openStage(stage.sampleStage, stage.total)}
            >
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Step {index + 1}</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{stage.stage}</div>
              <div className="mt-1 text-2xl font-semibold text-sky-300">{stage.total}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="roi-card">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="l">Cost per contacted lead</div>
            <div className="v">$0.31</div>
          </div>
          <div>
            <div className="l">Cost per qualified lead</div>
            <div className="v">$0.55</div>
          </div>
          <div>
            <div className="l">ROI on AI spend</div>
            <div className="v lime">124×</div>
          </div>
          <div>
            <div className="l">Cost per closed deal</div>
            <div className="v">$14.22</div>
          </div>
        </div>
        <div className="roi-formula">
          $260 total AI spend ÷ 836 calls = $0.31 · $32k profit ÷ $260 = 124×
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-100">Deals closed - daily</h2>
          <p className="text-xs text-slate-500">Each bar opens a right-side filtered panel.</p>
        </div>
        <div className="daily-bars">
          {DAILY_DEALS.map((day) => (
            <button
              key={day.day}
              type="button"
              className="daily-bar"
              onClick={() => openDay(day.day, day.revenue)}
            >
              <span className="bar-track">
                <span className="bar-fill" style={{ height: `${(day.count / maxDaily) * 100}%` }} />
              </span>
              <span className="text-xs text-slate-400">{day.day}</span>
              <span className="text-[11px] text-slate-500">{day.count}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <h2 className="text-sm font-semibold text-slate-100">AI performance</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {['P95 answer latency 1.4s', 'QA retries 0.7%', 'Safety blocks 3'].map((metric) => (
            <div key={metric} className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 text-sm text-slate-300">
              {metric}
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
      />
    </div>
  );
}
