import { Circle, CircleAlert, CircleCheck, CircleDashed, Radio } from 'lucide-react';
import { PbkDataSource } from '../../components/pbk/index';

const STATUS_ITEMS = [
  {
    label: 'Live',
    meaning: 'active call or running worker',
    className: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
    icon: Radio,
  },
  {
    label: 'Ready',
    meaning: 'healthy bridge/provider path',
    className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
    icon: CircleCheck,
  },
  {
    label: 'Review',
    meaning: 'approval, caution, or retry needed',
    className: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
    icon: CircleAlert,
  },
  {
    label: 'Info',
    meaning: 'neutral data or queued work',
    className: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
    icon: Circle,
  },
  {
    label: 'Idle',
    meaning: 'no current data or standby',
    className: 'border-slate-700 bg-slate-800/70 text-slate-300',
    icon: CircleDashed,
  },
];

/** Explains PBK status colors with icons so state is not color-only. */
export function StatusColorLegend() {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Status color legend</h2>
          <p className="text-xs text-slate-500">
            Prototype status chips translated into accessible shell labels.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {STATUS_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className={`rounded-xl border px-3 py-2 ${item.className}`}
              title={`${item.label}: ${item.meaning}`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
                <Icon size={12} />
                {item.label}
              </div>
              <div className="mt-1 text-[11px] leading-snug opacity-80">{item.meaning}</div>
            </div>
          );
        })}
      </div>
      <PbkDataSource endpoint="static PBK status legend" status="ships" />
    </section>
  );
}
