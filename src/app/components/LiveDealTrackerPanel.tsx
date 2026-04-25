import { Activity, Clock3, DollarSign, ShieldCheck, Target, TrendingUp } from 'lucide-react';
import { DealData, PBKPath } from '../types';
import { formatCurrency } from '../utils/formatting';

interface LiveDealTrackerPanelProps {
  deal: DealData;
  activePath: PBKPath;
}

type TrackerTone = 'green' | 'amber' | 'red' | 'slate' | 'blue' | 'purple';

function getPathLabel(path: PBKPath): string {
  const labels: Record<PBKPath, string> = {
    cash: 'Cash Offer',
    cf: 'Creative Finance',
    mt: 'Mortgage Takeover',
    rbp: 'Retail Buyer Program',
    'land-owner': 'Land Assignment',
    'land-agent': 'Land Assignment',
    'rbp-land': 'RBP Land',
  };

  return labels[path];
}

function getToneClasses(tone: TrackerTone) {
  const tones: Record<TrackerTone, string> = {
    green: 'text-green-700 dark:text-green-300',
    amber: 'text-amber-700 dark:text-amber-300',
    red: 'text-red-700 dark:text-red-300',
    slate: 'text-gray-700 dark:text-gray-300',
    blue: 'text-blue-700 dark:text-blue-300',
    purple: 'text-purple-700 dark:text-purple-300',
  };

  return tones[tone];
}

function formatSpread(value: number | null, target: number, basisLabel: string) {
  if (value === null) {
    return {
      label: '-',
      tone: 'slate' as TrackerTone,
      note: `Enter an agreed number to compare against ${basisLabel}.`,
    };
  }

  if (value >= 0) {
    return {
      label: `${formatCurrency(value)} under ${basisLabel}`,
      tone: 'green' as TrackerTone,
      note: 'Positive spread means there is room under the PBK ceiling.',
    };
  }

  return {
    label: `${formatCurrency(Math.abs(value))} over ${basisLabel}`,
    tone: 'red' as TrackerTone,
    note: `Target ${formatCurrency(target)} or better.`,
  };
}

export function LiveDealTrackerPanel({ deal, activePath }: LiveDealTrackerPanelProps) {
  const agreed =
    deal.type === 'land'
      ? deal.offer || deal.agreedPrice || deal.rbpPriceConfirm || deal.price || 0
      : deal.agreedPrice || deal.rbpPriceConfirm || deal.price || 0;
  const cashSpread = deal.mao60 > 0 && agreed > 0 ? deal.mao60 - agreed : null;
  const rbpSpread = deal.maoRBP > 0 && agreed > 0 ? deal.maoRBP - agreed : null;
  const rbpGain = deal.maoRBP > 0 && deal.mao60 > 0 ? deal.maoRBP - deal.mao60 : null;
  const maoCeiling = deal.mao60 > 0 ? Math.round(deal.mao60 * 1.1) : 0;
  const assignmentPct = deal.underwriting?.assignFeePct || 30;
  const targetCocPct = deal.underwriting?.targetCocPct || 20;
  const grossSpread = agreed > 0 && deal.maoRBP > 0 ? Math.max(0, deal.maoRBP - agreed) : 0;
  const projectedAssignment = grossSpread > 0 ? Math.round(grossSpread * (assignmentPct / 100)) : 0;
  const dealZone =
    !agreed || !deal.mao60
      ? { label: 'Incomplete', tone: 'slate' as TrackerTone, note: 'Confirm the agreed number to classify the deal.' }
      : agreed <= deal.mao60
        ? { label: 'Strong', tone: 'green' as TrackerTone, note: 'Inside MAO Cash. Strong negotiating position.' }
        : agreed <= maoCeiling
          ? { label: 'Acceptable', tone: 'amber' as TrackerTone, note: 'Inside the 10% stretch band. Stay disciplined.' }
          : { label: 'Pass', tone: 'red' as TrackerTone, note: 'Above the 10% cash ceiling. Re-negotiate or walk.' };
  const verdict =
    deal.verdict === 'green'
      ? { label: 'GO', tone: 'green' as TrackerTone, note: 'The deal is clearing the current PBK bar.' }
      : deal.verdict === 'yellow'
        ? { label: 'MAYBE', tone: 'amber' as TrackerTone, note: 'Numbers are workable, but the margin is thin.' }
        : deal.verdict === 'red'
          ? { label: 'STOP', tone: 'red' as TrackerTone, note: 'Current pricing is outside the safer range.' }
          : { label: 'NO DATA', tone: 'slate' as TrackerTone, note: 'Enter pricing and comps to score the deal.' };
  const cashSpreadSummary = formatSpread(cashSpread, deal.mao60, 'MAO Cash');
  const rbpSpreadSummary = formatSpread(rbpSpread, deal.maoRBP, 'MAO RBP');

  const pathVerdict =
    activePath === 'cf'
      ? deal.cfMonthlyPayment && deal.rent
        ? deal.rent - deal.cfMonthlyPayment > 0
          ? { label: 'CF Works', tone: 'green' as TrackerTone, note: 'Projected rent covers the proposed CF payment.' }
          : { label: 'CF Tight', tone: 'amber' as TrackerTone, note: 'Terms need to improve for comfortable monthly spread.' }
        : { label: 'CF Pending', tone: 'slate' as TrackerTone, note: 'Confirm CF terms to rate this path.' }
      : activePath === 'mt'
        ? deal.mtRateConfirm || deal.rate
          ? (deal.mtRateConfirm || deal.rate) < 5.5
            ? { label: 'MT Advantage', tone: 'green' as TrackerTone, note: 'Existing debt is meaningfully better than market financing.' }
            : { label: 'MT Review', tone: 'amber' as TrackerTone, note: 'The structure may still work, but the rate is less compelling.' }
          : { label: 'MT Pending', tone: 'slate' as TrackerTone, note: 'Confirm the existing loan rate and balance.' }
        : activePath === 'rbp' || activePath === 'rbp-land'
          ? rbpSpread !== null
            ? rbpSpread >= 0
              ? { label: 'RBP Works', tone: 'green' as TrackerTone, note: 'The agreed number still fits under MAO RBP.' }
              : { label: 'RBP Stretch', tone: 'amber' as TrackerTone, note: 'The RBP path needs a lower price or stronger buyer upside.' }
            : { label: 'RBP Pending', tone: 'slate' as TrackerTone, note: 'Confirm the agreed number to compare against MAO RBP.' }
          : cashSpread !== null
            ? cashSpread >= 0
              ? { label: 'Cash Works', tone: 'green' as TrackerTone, note: 'The agreed number is inside MAO Cash.' }
              : { label: 'Cash Over', tone: 'red' as TrackerTone, note: 'The agreed number is above MAO Cash.' }
            : { label: 'Cash Pending', tone: 'slate' as TrackerTone, note: 'Confirm the agreed number to compare against MAO Cash.' };

  const stats = [
    {
      icon: DollarSign,
      label: deal.type === 'land' ? 'Builder Value' : 'ARV',
      value: formatCurrency(deal.arv),
      tone: 'blue' as TrackerTone,
      subtext: deal.type === 'land' ? 'Comp-based land reference' : 'After Repair Value',
    },
    {
      icon: Target,
      label: deal.type === 'land' ? 'Offer to Seller' : 'MAO Cash',
      value: formatCurrency(deal.mao60),
      tone: 'green' as TrackerTone,
      subtext: deal.type === 'land' ? 'PBK working offer' : 'Wholesale ceiling',
    },
    {
      icon: TrendingUp,
      label: 'MAO RBP',
      value: formatCurrency(deal.maoRBP),
      tone: 'purple' as TrackerTone,
      subtext: 'RBP ceiling',
    },
    {
      icon: Activity,
      label: 'Agreed / Anchor',
      value: agreed > 0 ? formatCurrency(agreed) : '-',
      tone: agreed > 0 ? 'slate' : 'amber',
      subtext: 'Live call price',
    },
    {
      icon: ShieldCheck,
      label: 'Spread vs Cash',
      value: cashSpreadSummary.label,
      tone: cashSpreadSummary.tone,
      subtext: cashSpreadSummary.note,
    },
    {
      icon: Clock3,
      label: 'Verdict',
      value: verdict.label,
      tone: verdict.tone,
      subtext: verdict.note,
    },
  ];

  const referenceRows = [
    {
      label: deal.type === 'land' ? 'Offer to Seller' : 'Agreed / Working Price',
      value: agreed > 0 ? formatCurrency(agreed) : '-',
      tone: 'slate' as TrackerTone,
    },
    {
      label: 'Spread vs MAO Cash',
      value: cashSpreadSummary.label,
      tone: cashSpreadSummary.tone,
    },
    {
      label: 'Spread vs MAO RBP',
      value: rbpSpreadSummary.label,
      tone: rbpSpreadSummary.tone,
    },
    {
      label: 'RBP Gain vs Cash',
      value: rbpGain !== null ? formatCurrency(rbpGain) : '-',
      tone: rbpGain !== null && rbpGain > 0 ? 'green' : 'slate',
    },
    {
      label: 'Assignment Fee %',
      value: `${assignmentPct}%`,
      tone: 'blue' as TrackerTone,
    },
  ];

  const viabilityRows = [
    {
      label: 'Current Path',
      value: getPathLabel(activePath),
      tone: 'blue' as TrackerTone,
    },
    {
      label: 'Path Verdict',
      value: pathVerdict.label,
      tone: pathVerdict.tone,
    },
    {
      label: 'Deal Zone',
      value: dealZone.label,
      tone: dealZone.tone,
    },
    {
      label: 'Cash Ceiling (+10%)',
      value: maoCeiling > 0 ? formatCurrency(maoCeiling) : '-',
      tone: 'slate' as TrackerTone,
    },
    {
      label: 'Projected Assignment',
      value: projectedAssignment > 0 ? formatCurrency(projectedAssignment) : '-',
      tone: projectedAssignment > 0 ? ('green' as TrackerTone) : ('slate' as TrackerTone),
    },
  ];

  const investorRows =
    deal.type === 'house'
      ? [
          {
            label: 'Cash Flow',
            value: deal.investorCashFlow ? `${formatCurrency(deal.investorCashFlow)}/mo` : '-',
          },
          {
            label: 'CoC Return',
            value: deal.investorCOC ? `${deal.investorCOC.toFixed(1)}%` : '-',
          },
          {
            label: 'Target CoC',
            value: `${targetCocPct}%`,
          },
          {
            label: 'ROI',
            value: deal.investorROI ? `${deal.investorROI.toFixed(1)}%` : '-',
          },
          {
            label: activePath === 'cf' ? 'CF Payment' : activePath === 'mt' ? 'MT Payment' : 'Timeline',
            value:
              activePath === 'cf'
                ? deal.cfMonthlyPayment
                  ? `${formatCurrency(deal.cfMonthlyPayment)}/mo`
                  : '-'
                : activePath === 'mt'
                  ? deal.mtBalanceConfirm || deal.balance
                    ? `${formatCurrency(deal.mtBalanceConfirm || deal.balance)} loan`
                    : '-'
                  : deal.timeline || '-',
          },
        ]
      : [
          {
            label: 'Lot Size',
            value: deal.landLotSizeConfirm || deal.lotSize || '-',
          },
          {
            label: 'Builder Pays',
            value: deal.builderTotal ? formatCurrency(deal.builderTotal) : '-',
          },
          {
            label: 'Offer to Seller',
            value: deal.offer ? formatCurrency(deal.offer) : '-',
          },
          {
            label: 'Timeline',
            value: deal.timeline || '-',
          },
        ];

  return (
    <>
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">Live Deal Tracker</h3>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-6 gap-3 mb-3">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-slate-900 dark:to-slate-800 rounded-lg p-3 border border-gray-200 dark:border-slate-700"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center bg-slate-900 dark:bg-slate-700">
                    <Icon size={14} className="text-white" />
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {stat.label}
                  </div>
                </div>
                <div className={`text-[15px] font-bold mb-0.5 ${getToneClasses(stat.tone)}`}>{stat.value}</div>
                <div className="text-[9px] text-gray-500 dark:text-gray-400 leading-relaxed">{stat.subtext}</div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 p-3">
            <div className="text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              Reference Numbers
            </div>
            <div className="space-y-2">
              {referenceRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">{row.label}</span>
                  <span className={`text-[11.5px] font-semibold text-right ${getToneClasses(row.tone)}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 p-3">
            <div className="text-[9px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              Path Viability
            </div>
            <div className="space-y-2">
              {viabilityRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">{row.label}</span>
                  <span className={`text-[11.5px] font-semibold text-right ${getToneClasses(row.tone)}`}>{row.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-white/10 bg-white/60 dark:bg-slate-950/60 px-3 py-2 text-[10.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
              {pathVerdict.note} {dealZone.note}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-slate-900 to-gray-900 dark:from-slate-950 dark:to-gray-950 border border-gray-700 dark:border-slate-800 rounded-xl p-4 mb-3 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3 bg-green-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-green-400">Decision Snapshot</h3>
          </div>
          <div
            className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${
              verdict.tone === 'green'
                ? 'bg-green-500/20 text-green-400'
                : verdict.tone === 'amber'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : verdict.tone === 'red'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {verdict.label}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Decision</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10.5px] text-gray-400">Path Verdict</span>
                <span className={`text-[11.5px] font-semibold ${getToneClasses(pathVerdict.tone)}`}>{pathVerdict.label}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10.5px] text-gray-400">Deal Zone</span>
                <span className={`text-[11.5px] font-semibold ${getToneClasses(dealZone.tone)}`}>{dealZone.label}</span>
              </div>
              <div className="text-[10px] text-gray-300 leading-relaxed">{verdict.note}</div>
            </div>
          </div>

          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Offer Math</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10.5px] text-gray-400">Anchor Price</span>
                <span className="text-[11.5px] font-semibold text-white">{agreed > 0 ? formatCurrency(agreed) : '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10.5px] text-gray-400">Cash Spread</span>
                <span className={`text-[11.5px] font-semibold ${getToneClasses(cashSpreadSummary.tone)}`}>{cashSpreadSummary.label}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10.5px] text-gray-400">RBP Gain</span>
                <span className={`text-[11.5px] font-semibold ${getToneClasses(rbpGain !== null && rbpGain > 0 ? 'green' : 'slate')}`}>
                  {rbpGain !== null ? formatCurrency(rbpGain) : '-'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">Investor Benchmarks</div>
            <div className="space-y-2">
              {investorRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <span className="text-[10.5px] text-gray-400">{row.label}</span>
                  <span className="text-[11.5px] font-semibold text-white text-right">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
