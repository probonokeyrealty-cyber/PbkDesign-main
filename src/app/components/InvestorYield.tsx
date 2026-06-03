import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Landmark,
  Percent,
  RotateCcw,
  Target,
  TrendingUp,
} from 'lucide-react';
import { DealData } from '../types';
import { amortizedPayment, calculateCreativeFinanceMath } from '../utils/dealCalculations';
import { formatCurrency, formatPercent } from '../utils/formatting';

interface InvestorYieldProps {
  deal: DealData;
  onDealChange: (updates: Partial<DealData>) => void;
  activePath: 'cf' | 'mt';
}

interface CoCInputs {
  price: number;
  downPct: number;
  rate: number;
  term: number;
  rent: number;
  vacancyPct: number;
  expensePct: number;
  closingCosts: number;
  targetCoc: number;
  mtLoanBalance: number;
}

interface CoCMetrics {
  downPayment: number;
  loanAmount: number;
  pmt: number;
  noi: number;
  cashflow: number;
  monthlyCashflow: number;
  equityInvested: number;
  dscr: number;
  coc: number;
  cap: number;
}

type MathCheck =
  | { tone: 'ok'; messages: string[] }
  | { tone: 'warn'; messages: string[] }
  | { tone: 'fail'; messages: string[] };

const termOptions = [1, 2, 3, 5, 7, 10, 12, 15, 20, 25, 30];

const clampNumber = (value: number, fallback = 0) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

const roundMoney = (value: number) => Math.max(0, Math.round(value || 0));
const roundPct = (value: number) => Math.max(0, Math.round((value || 0) * 10) / 10);

function buildInitialInputs(deal: DealData, activePath: 'cf' | 'mt'): CoCInputs {
  const price = roundMoney(deal.agreedPrice || deal.price || 0);
  const rent = roundMoney(deal.rent || 0);
  const targetCoc = deal.underwriting?.targetCocPct || 20;

  if (activePath === 'mt') {
    const upfront = deal.mtUpfront || (price > 0 ? Math.round(price * 0.04) : 0);
    const mtLoanBalance = deal.mtBalanceConfirm || deal.balance || Math.max(0, price - upfront);

    return {
      price,
      downPct: price > 0 && upfront > 0 ? roundPct((upfront / price) * 100) : 4,
      rate: deal.mtRateConfirm || deal.rate || 3.5,
      term: 30,
      rent,
      vacancyPct: 10,
      expensePct: 45,
      closingCosts: price > 0 ? roundMoney(price * 0.025) : 0,
      targetCoc,
      mtLoanBalance: roundMoney(mtLoanBalance),
    };
  }

  const downPayment = deal.cfDownPayment || (price > 0 ? Math.round(price * 0.04) : 0);

  return {
    price,
    downPct: price > 0 && downPayment > 0 ? roundPct((downPayment / price) * 100) : 20,
    rate: deal.cfRate || deal.rate || 5,
    term: deal.cfTerm || 30,
    rent,
    vacancyPct: 10,
    expensePct: 45,
    closingCosts: price > 0 ? roundMoney(price * 0.025) : 0,
    targetCoc,
    mtLoanBalance: 0,
  };
}

function calculateCoCMetrics(inputs: CoCInputs, activePath: 'cf' | 'mt'): CoCMetrics {
  const price = clampNumber(inputs.price);
  const downPayment = price * (clampNumber(inputs.downPct) / 100);
  const defaultLoanAmount = Math.max(0, price - downPayment);
  const loanAmount =
    activePath === 'mt' && inputs.mtLoanBalance > 0
      ? clampNumber(inputs.mtLoanBalance)
      : defaultLoanAmount;
  const termMonths = Math.max(1, Math.round(clampNumber(inputs.term, 30) * 12));
  const pmt =
    inputs.rate > 0 && loanAmount > 0
      ? amortizedPayment(loanAmount, inputs.rate, termMonths)
      : loanAmount > 0
        ? loanAmount / termMonths
        : 0;
  const annualGross = clampNumber(inputs.rent) * 12;
  const vacancyLoss = annualGross * (clampNumber(inputs.vacancyPct) / 100);
  const operatingExpenses = annualGross * (clampNumber(inputs.expensePct) / 100);
  const noi = annualGross - vacancyLoss - operatingExpenses;
  const annualDebt = pmt * 12;
  const cashflow = noi - annualDebt;
  const equityInvested = downPayment + clampNumber(inputs.closingCosts);
  const dscr = pmt > 0 ? noi / 12 / pmt : 0;

  return {
    downPayment,
    loanAmount,
    pmt,
    noi,
    cashflow,
    monthlyCashflow: cashflow / 12,
    equityInvested,
    dscr,
    coc: equityInvested > 0 ? (cashflow / equityInvested) * 100 : 0,
    cap: price > 0 ? (noi / price) * 100 : 0,
  };
}

function solveMaxCoCPrice(inputs: CoCInputs, activePath: 'cf' | 'mt') {
  if (inputs.rent <= 0 || inputs.targetCoc <= 0) return 0;

  let lo = 0;
  let hi = Math.max(100000, inputs.rent * 12 * 25, inputs.price * 4);

  for (let i = 0; i < 64; i += 1) {
    const mid = (lo + hi) / 2;
    const test = calculateCoCMetrics(
      {
        ...inputs,
        price: mid,
        mtLoanBalance: activePath === 'mt' && inputs.mtLoanBalance > 0 ? inputs.mtLoanBalance : 0,
      },
      activePath
    );

    if (test.coc >= inputs.targetCoc) lo = mid;
    else hi = mid;
  }

  return Math.max(0, Math.round(lo / 1000) * 1000);
}

function runMathCheck(inputs: CoCInputs, metrics: CoCMetrics, activePath: 'cf' | 'mt'): MathCheck {
  const failures: string[] = [];
  const warnings: string[] = [];
  const valuesToCheck: Array<[string, number]> = [
    ['Purchase price', inputs.price],
    ['Down/upfront percent', inputs.downPct],
    ['Interest rate', inputs.rate],
    ['Loan term', inputs.term],
    ['Gross rent', inputs.rent],
    ['Vacancy percent', inputs.vacancyPct],
    ['Operating expenses percent', inputs.expensePct],
    ['Closing costs', inputs.closingCosts],
    ['Target CoC', inputs.targetCoc],
  ];

  if (activePath === 'mt') {
    valuesToCheck.push(['Existing loan balance', inputs.mtLoanBalance]);
  }

  valuesToCheck.forEach(([label, value]) => {
    if (!Number.isFinite(value)) failures.push(`${label} must be a valid number.`);
    if (value < 0) failures.push(`${label} cannot be negative.`);
  });

  const remainingDebt = inputs.price - metrics.downPayment;
  if (remainingDebt <= 0) failures.push('Price minus down/upfront cash must stay above $0.');
  if (metrics.equityInvested <= 0)
    failures.push('Equity invested must be above $0 so CoC has a valid denominator.');
  if (inputs.rent > 0 && metrics.pmt > inputs.rent) {
    failures.push('Monthly payment is higher than gross monthly rent.');
  }
  if (activePath === 'mt' && inputs.mtLoanBalance > 0 && inputs.price <= inputs.mtLoanBalance) {
    failures.push('MT purchase price must be higher than the existing loan balance.');
  }
  if (inputs.rent <= 0) warnings.push('Gross rent is missing, so rent coverage cannot be checked.');
  if (inputs.price <= 0)
    warnings.push('Purchase price is missing, so cap rate and max price are placeholders.');
  if (inputs.targetCoc <= 0) warnings.push('Target CoC is missing, so reverse solver cannot run.');

  if (failures.length > 0) return { tone: 'fail', messages: failures };
  if (warnings.length > 0) return { tone: 'warn', messages: warnings };
  return { tone: 'ok', messages: ['All math checks passed - numbers are internally consistent.'] };
}

export function InvestorYield({ deal, onDealChange, activePath }: InvestorYieldProps) {
  const [inputs, setInputs] = useState(() => buildInitialInputs(deal, activePath));
  const [suggestedMaxPrice, setSuggestedMaxPrice] = useState<number | null>(null);
  const [mathCheck, setMathCheck] = useState<MathCheck | null>(null);
  const seed = useMemo(
    () => buildInitialInputs(deal, activePath),
    [
      activePath,
      deal.agreedPrice,
      deal.price,
      deal.rent,
      deal.balance,
      deal.rate,
      deal.cfDownPayment,
      deal.cfRate,
      deal.cfTerm,
      deal.mtUpfront,
      deal.mtBalanceConfirm,
      deal.mtRateConfirm,
      deal.underwriting?.targetCocPct,
    ]
  );
  const seedKey = JSON.stringify(seed);

  useEffect(() => {
    setInputs(seed);
    setSuggestedMaxPrice(null);
    setMathCheck(null);
  }, [seedKey]);

  const metrics = useMemo(() => calculateCoCMetrics(inputs, activePath), [inputs, activePath]);
  const monthlyCashflow = Math.round(metrics.monthlyCashflow);
  const pathLabel = activePath === 'cf' ? 'Creative Finance' : 'Mortgage Takeover';
  const status =
    metrics.coc >= inputs.targetCoc && metrics.dscr >= 1.25 && monthlyCashflow >= 0
      ? {
          label: 'Go - CoC Clears Target',
          tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/10 dark:text-emerald-300',
        }
      : metrics.coc >= Math.max(12, inputs.targetCoc * 0.6)
        ? {
            label: 'Review - Tune Terms',
            tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/10 dark:text-amber-300',
          }
        : {
            label: 'Pass - Below Target',
            tone: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/10 dark:text-rose-300',
          };

  const cfSummary = useMemo(() => {
    if (activePath !== 'cf') return null;
    return calculateCreativeFinanceMath(
      inputs.price || deal.price || 0,
      deal.arv || 0,
      inputs.rent,
      deal.balance || 0,
      inputs.rate || deal.rate || 0,
      deal.mao60 || 0
    );
  }, [
    activePath,
    deal.arv,
    deal.balance,
    deal.mao60,
    deal.price,
    deal.rate,
    inputs.price,
    inputs.rate,
    inputs.rent,
  ]);

  useEffect(() => {
    const next = {
      investorCashFlow: Math.round(metrics.monthlyCashflow),
      investorCOC: metrics.coc,
      investorROI: metrics.cap,
      investorIRR: metrics.dscr,
    };

    const same =
      deal.investorCashFlow === next.investorCashFlow &&
      Math.abs((deal.investorCOC || 0) - next.investorCOC) < 0.01 &&
      Math.abs((deal.investorROI || 0) - next.investorROI) < 0.01 &&
      Math.abs((deal.investorIRR || 0) - next.investorIRR) < 0.01;

    if (!same) onDealChange(next);
  }, [
    deal.investorCashFlow,
    deal.investorCOC,
    deal.investorIRR,
    deal.investorROI,
    metrics.cap,
    metrics.coc,
    metrics.dscr,
    metrics.monthlyCashflow,
    onDealChange,
  ]);

  const syncDealInputs = (next: CoCInputs, changed: Partial<CoCInputs>) => {
    const updates: Partial<DealData> = {};

    if ('price' in changed) updates.agreedPrice = roundMoney(next.price);
    if ('rent' in changed) updates.rent = roundMoney(next.rent);

    if ('price' in changed || 'downPct' in changed) {
      const cashIn = roundMoney(next.price * (next.downPct / 100));
      if (activePath === 'cf') updates.cfDownPayment = cashIn;
      else updates.mtUpfront = cashIn;
    }

    if ('rate' in changed) {
      if (activePath === 'cf') updates.cfRate = next.rate;
      else updates.mtRateConfirm = next.rate;
    }

    if ('term' in changed && activePath === 'cf') updates.cfTerm = Math.round(next.term);
    if ('mtLoanBalance' in changed && activePath === 'mt')
      updates.mtBalanceConfirm = roundMoney(next.mtLoanBalance);

    if ('targetCoc' in changed) {
      updates.underwriting = {
        maoCashPct: deal.underwriting?.maoCashPct ?? 70,
        maoRbpPct: deal.underwriting?.maoRbpPct ?? 80,
        maoRepairPct: deal.underwriting?.maoRepairPct ?? 100,
        assignFeePct: deal.underwriting?.assignFeePct ?? 10,
        targetCocPct: Math.round(next.targetCoc),
      };
    }

    if (Object.keys(updates).length > 0) onDealChange(updates);
  };

  const updateInputs = (changed: Partial<CoCInputs>) => {
    const next = { ...inputs, ...changed };
    setInputs(next);
    syncDealInputs(next, changed);
    setSuggestedMaxPrice(null);
    setMathCheck(null);
  };

  const handleMaxPrice = () => {
    const maxPrice = solveMaxCoCPrice(inputs, activePath);
    setSuggestedMaxPrice(maxPrice);
    if (maxPrice > 0) updateInputs({ price: maxPrice });
  };

  const handleMathCheck = () => {
    setMathCheck(runMathCheck(inputs, metrics, activePath));
  };

  const resetToDeal = () => {
    setInputs(seed);
    setSuggestedMaxPrice(null);
    setMathCheck(null);
  };

  return (
    <div className="overflow-hidden rounded-[28px] border border-blue-100 bg-white shadow-sm shadow-blue-950/5 dark:border-slate-700 dark:bg-slate-900/90">
      <div className="border-b border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 px-4 py-4 dark:border-slate-800 dark:from-blue-950/30 dark:via-slate-900 dark:to-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-blue-600 dark:text-blue-300">
              <Calculator size={14} />
              Cash-on-Cash Calculator
            </div>
            <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              {pathLabel} investor math
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Live CoC, cap rate, NOI, payment, and cash flow. Inputs sync with the current deal so
              the tracker, scripts, and path packet stay on the same terms.
            </p>
          </div>
          <div
            className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] ${status.tone}`}
          >
            {status.label}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InputField
            label="Purchase Price"
            value={inputs.price}
            prefix="$"
            onChange={(value) => updateInputs({ price: value })}
          />
          <InputField
            label={activePath === 'cf' ? 'Down Payment' : 'Upfront Cash'}
            value={inputs.downPct}
            suffix="%"
            step={0.1}
            onChange={(value) => updateInputs({ downPct: value })}
          />
          <InputField
            label="Interest Rate"
            value={inputs.rate}
            suffix="%"
            step={0.125}
            onChange={(value) => updateInputs({ rate: value })}
          />
          <InputField
            label="Loan Term"
            value={inputs.term}
            suffix="yrs"
            selectOptions={termOptions}
            onChange={(value) => updateInputs({ term: value })}
          />
          <InputField
            label="Gross Monthly Rent"
            value={inputs.rent}
            prefix="$"
            onChange={(value) => updateInputs({ rent: value })}
          />
          <InputField
            label="Vacancy"
            value={inputs.vacancyPct}
            suffix="%"
            step={0.5}
            onChange={(value) => updateInputs({ vacancyPct: value })}
          />
          <InputField
            label="Operating Expenses"
            value={inputs.expensePct}
            suffix="%"
            step={0.5}
            onChange={(value) => updateInputs({ expensePct: value })}
          />
          <InputField
            label="Closing Costs"
            value={inputs.closingCosts}
            prefix="$"
            onChange={(value) => updateInputs({ closingCosts: value })}
          />
          {activePath === 'mt' ? (
            <InputField
              label="Existing Loan Balance"
              value={inputs.mtLoanBalance}
              prefix="$"
              onChange={(value) => updateInputs({ mtLoanBalance: value })}
            />
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            icon={Percent}
            label="Cash-on-Cash"
            value={formatPercent(metrics.coc)}
            note={`Target ${inputs.targetCoc}%+`}
          />
          <MetricCard
            icon={TrendingUp}
            label="Cap Rate"
            value={formatPercent(metrics.cap)}
            note="NOI / purchase price"
          />
          <MetricCard
            icon={Landmark}
            label="Monthly P&I"
            value={formatCurrency(Math.round(metrics.pmt))}
            note={`${inputs.term}-yr amortization @ ${inputs.rate || 0}%`}
          />
          <MetricCard
            label="Annual Cash Flow"
            value={formatCurrency(Math.round(metrics.cashflow))}
            note={`${formatCurrency(monthlyCashflow)}/mo after debt`}
            tone={metrics.cashflow >= 0 ? 'positive' : 'negative'}
          />
          <MetricCard
            label="Equity Invested"
            value={formatCurrency(Math.round(metrics.equityInvested))}
            note="Down/upfront + closing"
          />
          <MetricCard
            label="NOI (annual)"
            value={formatCurrency(Math.round(metrics.noi))}
            note="Rent - vacancy - expenses"
          />
        </div>

        <div className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/60 lg:grid-cols-[1fr_auto_auto_1fr]">
          <InputField
            label="Target CoC"
            value={inputs.targetCoc}
            suffix="%"
            onChange={(value) => updateInputs({ targetCoc: value })}
          />
          <button
            type="button"
            onClick={handleMaxPrice}
            disabled={inputs.rent <= 0 || inputs.targetCoc <= 0}
            className="min-h-11 rounded-full bg-blue-600 px-4 text-[12px] font-bold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Compute Max Price
          </button>
          <button
            type="button"
            onClick={handleMathCheck}
            className="min-h-11 rounded-full border border-slate-200 bg-white px-4 text-[12px] font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Check Math Works
          </button>
          <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              <Target size={13} />
              Suggested Max Price
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-50">
              {suggestedMaxPrice ? formatCurrency(suggestedMaxPrice) : '-'}
            </div>
          </div>
        </div>

        {mathCheck ? <MathCheckPanel check={mathCheck} /> : null}

        <div className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/40 md:grid-cols-4">
          <SummaryField
            label={activePath === 'cf' ? 'Down Payment $' : 'Upfront Cash $'}
            value={formatCurrency(Math.round(metrics.downPayment))}
          />
          <SummaryField
            label="Loan Used In Calc"
            value={formatCurrency(Math.round(metrics.loanAmount))}
          />
          <SummaryField label="DSCR" value={metrics.pmt > 0 ? metrics.dscr.toFixed(2) : '-'} />
          <button
            type="button"
            onClick={resetToDeal}
            className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-[12px] font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RotateCcw size={14} />
            Reset to Deal
          </button>
        </div>

        {activePath === 'cf' && cfSummary ? (
          <div className="rounded-3xl border border-blue-200 bg-blue-50/80 px-4 py-4 dark:border-blue-800/60 dark:bg-blue-900/10">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
              Creative Finance Snapshot
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <SummaryField
                label="Market PITI"
                value={`${formatCurrency(cfSummary.marketPiti)}/mo`}
              />
              <SummaryField
                label="Sub-To PITI"
                value={
                  cfSummary.subjectToPiti > 0
                    ? `${formatCurrency(cfSummary.subjectToPiti)}/mo`
                    : '-'
                }
              />
              <SummaryField label="Creative Max" value={formatCurrency(cfSummary.creativeMax)} />
              <SummaryField
                label="Market CF"
                value={
                  cfSummary.marketCashflow !== null
                    ? `${formatCurrency(cfSummary.marketCashflow)}/mo`
                    : '-'
                }
              />
              <SummaryField
                label="Carry CF"
                value={
                  cfSummary.carryCashflow !== null
                    ? `${formatCurrency(cfSummary.carryCashflow)}/mo`
                    : '-'
                }
              />
              <SummaryField label="Deal Rating" value={cfSummary.dealRating} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  selectOptions,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  selectOptions?: number[];
}) {
  return (
    <label className="block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/60">
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="mt-2 flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900">
        {prefix ? <span className="text-sm font-bold text-slate-400">{prefix}</span> : null}
        {selectOptions ? (
          <select
            value={String(value)}
            onChange={(event) => onChange(Number.parseFloat(event.target.value) || 0)}
            className="w-full bg-transparent text-sm font-semibold text-slate-950 outline-none dark:text-slate-50"
          >
            {selectOptions.map((option) => (
              <option key={option} value={option}>
                {option} years
              </option>
            ))}
          </select>
        ) : (
          <input
            type="number"
            min="0"
            step={step}
            value={Number.isFinite(value) ? value : 0}
            onChange={(event) => onChange(Number.parseFloat(event.target.value) || 0)}
            className="w-full bg-transparent text-sm font-semibold text-slate-950 outline-none dark:text-slate-50"
          />
        )}
        {suffix ? <span className="text-xs font-bold text-slate-400">{suffix}</span> : null}
      </span>
    </label>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon?: ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  note: string;
  tone?: 'positive' | 'negative';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600 dark:text-emerald-300'
      : tone === 'negative'
        ? 'text-rose-600 dark:text-rose-300'
        : 'text-slate-950 dark:text-slate-50';

  return (
    <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/60">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {Icon ? <Icon size={13} /> : null}
        {label}
      </div>
      <div className={`mt-2 text-xl font-semibold tracking-tight ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{note}</div>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-slate-50">{value}</div>
    </div>
  );
}

function MathCheckPanel({ check }: { check: MathCheck }) {
  const toneClass =
    check.tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/10 dark:text-emerald-200'
      : check.tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/10 dark:text-amber-200'
        : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-900/10 dark:text-rose-200';
  const Icon = check.tone === 'ok' ? CheckCircle2 : AlertTriangle;

  return (
    <div className={`rounded-3xl border px-4 py-3 text-sm leading-6 ${toneClass}`}>
      <div className="flex items-center gap-2 font-bold">
        <Icon size={16} />
        Math validation
      </div>
      <ul className="mt-2 space-y-1">
        {check.messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
