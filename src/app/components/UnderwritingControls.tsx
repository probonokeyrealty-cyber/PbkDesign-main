import { SlidersHorizontal, Target } from 'lucide-react';
import { DealData, UnderwritingSettings } from '../types';
import { formatCurrency } from '../utils/formatting';

interface UnderwritingControlsProps {
  deal: DealData;
  onDealChange: (updates: Partial<DealData>) => void;
}

interface ControlDef {
  key: keyof UnderwritingSettings;
  label: string;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  helper: string;
}

const CONTROL_DEFS: ControlDef[] = [
  {
    key: 'maoCashPct',
    label: 'MAO Cash %',
    min: 40,
    max: 80,
    helper: 'Controls the cash ceiling shown in the analyzer and tracker.',
  },
  {
    key: 'maoRbpPct',
    label: 'MAO RBP %',
    min: 75,
    max: 95,
    helper: 'Controls the RBP ceiling used for retail-buyer positioning.',
  },
  {
    key: 'maoRepairPct',
    label: 'MAO Repair %',
    min: 50,
    max: 75,
    helper: 'Controls the after-repairs ceiling for scenario review.',
  },
  {
    key: 'targetCocPct',
    label: 'Target CoC %',
    min: 5,
    max: 50,
    helper: 'Benchmark for rental / yield conversations in the tracker.',
  },
  {
    key: 'assignFeePct',
    label: 'Assignment Fee %',
    min: 0,
    max: 100,
    helper: 'Profit split applied to the gross spread for quick scenario review.',
  },
];

export function UnderwritingControls({ deal, onDealChange }: UnderwritingControlsProps) {
  const underwriting: UnderwritingSettings = {
    maoCashPct: deal.underwriting?.maoCashPct || 60,
    maoRbpPct: deal.underwriting?.maoRbpPct || 88,
    maoRepairPct: deal.underwriting?.maoRepairPct || 65,
    targetCocPct: deal.underwriting?.targetCocPct || 20,
    assignFeePct: deal.underwriting?.assignFeePct || 30,
  };

  const grossSpread =
    deal.price > 0 && deal.maoRBP > 0 ? Math.max(0, deal.maoRBP - deal.price) : 0;
  const projectedAssignment =
    grossSpread > 0 ? Math.round(grossSpread * (underwriting.assignFeePct / 100)) : 0;
  const maoAfterRepairs =
    deal.arv > 0
      ? Math.max(
          0,
          Math.round(
            deal.arv * (underwriting.maoRepairPct / 100) - (deal.repairs.mid || 0) - (deal.fee || 8000),
          ),
        )
      : 0;

  const handleChange = (key: keyof UnderwritingSettings, value: number) => {
    onDealChange({
      underwriting: {
        ...underwriting,
        [key]: value,
      },
    });
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Underwriting Controls
          </h3>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          <SlidersHorizontal size={12} />
          v5 operator layer
        </div>
      </div>

      <div className="text-[11.5px] leading-5 text-gray-500 dark:text-gray-400 mb-4">
        This restores the v5 underwriting knobs inside the modern shell. Defaults stay aligned to the current PBK engine until you intentionally change them.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {CONTROL_DEFS.map((control) => (
          <div
            key={control.key}
            className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-3 py-3"
          >
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              {control.label}
            </div>
            <div className="relative">
              <input
                type="number"
                min={control.min}
                max={control.max}
                step={control.step || 1}
                value={underwriting[control.key]}
                onChange={(e) => handleChange(control.key, parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 pr-8 text-[13px] font-semibold text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="absolute right-3 top-2 text-[12px] text-gray-500">%</span>
            </div>
            <div className="mt-2 text-[10px] leading-5 text-gray-500 dark:text-gray-400">
              {control.helper}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 px-3 py-3">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Scenario MAO+Repairs
          </div>
          <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
            {formatCurrency(maoAfterRepairs)}
          </div>
          <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
            Based on {underwriting.maoRepairPct}% minus repairs and fee.
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 px-3 py-3">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Gross Spread
          </div>
          <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
            {formatCurrency(grossSpread)}
          </div>
          <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
            Current RBP ceiling minus list/agreed price.
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-blue-50 to-blue-100/70 dark:from-blue-900/20 dark:to-blue-950/30 px-3 py-3">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-1">
            <Target size={12} />
            Projected Assignment
          </div>
          <div className="text-[16px] font-semibold text-blue-900 dark:text-blue-100">
            {formatCurrency(projectedAssignment)}
          </div>
          <div className="mt-1 text-[10px] text-blue-700/80 dark:text-blue-300/80">
            Gross spread × {underwriting.assignFeePct}%.
          </div>
        </div>
      </div>
    </div>
  );
}
