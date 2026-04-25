import { useEffect, useMemo, useState } from 'react';
import { Landmark, Percent, TrendingUp } from 'lucide-react';
import { DealData } from '../types';
import {
  computeCoCExact,
  calculateCreativeFinanceMath,
  calculateMortgageTakeoverYield,
} from '../utils/dealCalculations';
import { formatCurrency, formatPercent } from '../utils/formatting';

interface InvestorYieldProps {
  deal: DealData;
  onDealChange: (updates: Partial<DealData>) => void;
  activePath: 'cf' | 'mt';
}

export function InvestorYield({ deal, onDealChange, activePath }: InvestorYieldProps) {
  const [assumptions, setAssumptions] = useState({
    vacancyPct: 10,
    expensePct: 20,
    closingCosts: 5000,
  });

  const agreedPrice = deal.agreedPrice || deal.price || 0;
  const rent = deal.rent || 0;
  const targetCoc = deal.underwriting?.targetCocPct || 20;

  const metrics = useMemo(() => {
    if (activePath === 'cf') {
      const down = deal.cfDownPayment || (agreedPrice > 0 ? Math.round(agreedPrice * 0.04) : 0);
      const rate = deal.cfRate || deal.rate || 5;
      const term = deal.cfTerm || 7;
      const downPct = agreedPrice > 0 && down > 0 ? Math.round((down / agreedPrice) * 100) : 20;
      const yieldMetrics = computeCoCExact(
        agreedPrice,
        downPct,
        rate,
        rent,
        assumptions.vacancyPct,
        assumptions.expensePct,
        assumptions.closingCosts,
        term,
        'cf',
      );

      return {
        ...yieldMetrics,
        down,
        rate,
        term,
        summary: calculateCreativeFinanceMath(
          deal.price || agreedPrice,
          deal.arv || 0,
          rent,
          deal.balance || 0,
          deal.rate || 0,
          deal.mao60 || 0,
        ),
        paymentLabel: 'Monthly Interest Only',
        paymentSubtext: `${term}-yr balloon @ ${rate}%`,
      };
    }

    const upfront = deal.mtUpfront || (agreedPrice > 0 ? Math.round(agreedPrice * 0.04) : 0);
    const balance = deal.mtBalanceConfirm || deal.balance || Math.max(0, agreedPrice - upfront);
    const rate = deal.mtRateConfirm || deal.rate || 0;
    const yieldMetrics = calculateMortgageTakeoverYield({
      price: agreedPrice,
      rent,
      vacPct: assumptions.vacancyPct,
      expPct: assumptions.expensePct,
      closingCosts: assumptions.closingCosts,
      upfront,
      balance,
      rate,
    });

    return {
      ...yieldMetrics,
      down: upfront,
      rate,
      term: 30,
      summary: null,
      paymentLabel: 'Monthly P&I',
      paymentSubtext: `30-yr @ ${rate || 0}%`,
    };
  }, [
    activePath,
    agreedPrice,
    rent,
    assumptions.vacancyPct,
    assumptions.expensePct,
    assumptions.closingCosts,
    deal.cfDownPayment,
    deal.cfRate,
    deal.cfTerm,
    deal.rate,
    deal.price,
    deal.arv,
    deal.balance,
    deal.mao60,
    deal.mtUpfront,
    deal.mtBalanceConfirm,
    deal.mtRateConfirm,
  ]);

  useEffect(() => {
    onDealChange({
      investorCashFlow: Math.round(metrics.cashflow / 12),
      investorCOC: metrics.coc,
      investorROI: metrics.cap,
      investorIRR: metrics.dscr,
    });
  }, [metrics.cashflow, metrics.coc, metrics.cap, metrics.dscr, onDealChange]);

  const monthlyCashflow = Math.round(metrics.cashflow / 12);
  const verdict =
    metrics.coc >= targetCoc && metrics.dscr >= 1.25 && monthlyCashflow >= 200
      ? { label: 'GO - Strong Hold', tone: 'text-emerald-700 dark:text-emerald-300', card: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-900/10' }
      : metrics.coc >= 12
        ? { label: 'NEGOTIATE - Workable', tone: 'text-amber-700 dark:text-amber-300', card: 'border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-900/10' }
        : { label: 'NO DEAL - Pass', tone: 'text-rose-700 dark:text-rose-300', card: 'border-rose-200 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-900/10' };

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-500">
            Yield-First Calculator
          </div>
          <h4 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {activePath === 'cf' ? 'Creative Finance' : 'Mortgage Takeover'} investor lens
          </h4>
        </div>
        <div className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] ${verdict.card} ${verdict.tone}`}>
          {verdict.label}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/60">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
            Vacancy
          </div>
          <input
            type="number"
            value={assumptions.vacancyPct}
            onChange={(event) =>
              setAssumptions((prev) => ({
                ...prev,
                vacancyPct: Number.parseFloat(event.target.value) || 0,
              }))
            }
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
          />
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/60">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
            Expense Load
          </div>
          <input
            type="number"
            value={assumptions.expensePct}
            onChange={(event) =>
              setAssumptions((prev) => ({
                ...prev,
                expensePct: Number.parseFloat(event.target.value) || 0,
              }))
            }
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
          />
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/60">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
            Closing Costs
          </div>
          <input
            type="number"
            value={assumptions.closingCosts}
            onChange={(event) =>
              setAssumptions((prev) => ({
                ...prev,
                closingCosts: Number.parseFloat(event.target.value) || 0,
              }))
            }
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-purple-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard icon={Percent} label="Cash-on-Cash" value={formatPercent(metrics.coc)} note={`Target ${targetCoc}%+`} />
        <MetricCard icon={Landmark} label="DSCR" value={metrics.dscr.toFixed(2)} note="Target 1.25+" />
        <MetricCard icon={TrendingUp} label="Cap Rate" value={formatPercent(metrics.cap)} note="NOI / purchase price" />
        <MetricCard label={metrics.paymentLabel} value={formatCurrency(Math.round(metrics.pmt))} note={metrics.paymentSubtext} />
        <MetricCard label="Monthly Cash Flow" value={`${formatCurrency(monthlyCashflow)}/mo`} note="NOI less debt service" />
        <MetricCard label="Annual Cash Flow" value={formatCurrency(Math.round(metrics.cashflow))} note="Before taxes and reserves" />
      </div>

      <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/60">
        <div className="grid gap-3 md:grid-cols-4">
          <SummaryField label="Agreed Price" value={formatCurrency(agreedPrice)} />
          <SummaryField label={activePath === 'cf' ? 'Down Payment' : 'Upfront'} value={formatCurrency(metrics.down)} />
          <SummaryField label="Rate" value={`${metrics.rate || 0}%`} />
          <SummaryField label="Term" value={`${metrics.term} years`} />
        </div>
      </div>

      {activePath === 'cf' && metrics.summary ? (
        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 dark:border-blue-800/60 dark:bg-blue-900/10">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
            v5 CF Checkmate Snapshot
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <SummaryField label="Market PITI" value={`${formatCurrency(metrics.summary.marketPiti)}/mo`} />
            <SummaryField label="Sub-To PITI" value={metrics.summary.subjectToPiti > 0 ? `${formatCurrency(metrics.summary.subjectToPiti)}/mo` : '-'} />
            <SummaryField label="Creative Max" value={formatCurrency(metrics.summary.creativeMax)} />
            <SummaryField label="Market CF" value={metrics.summary.marketCashflow !== null ? `${formatCurrency(metrics.summary.marketCashflow)}/mo` : '-'} />
            <SummaryField label="Carry CF" value={metrics.summary.carryCashflow !== null ? `${formatCurrency(metrics.summary.carryCashflow)}/mo` : '-'} />
            <SummaryField label="Deal Rating" value={metrics.summary.dealRating} />
          </div>
          <div className="mt-3 text-sm leading-6 text-blue-900 dark:text-blue-100">
            This block mirrors the v5 buildCFMathBox and calcCF logic so the modern shell stays aligned with the original deal engine.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon?: typeof TrendingUp;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/60">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
        {Icon ? <Icon size={13} /> : null}
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</div>
      <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{note}</div>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}
