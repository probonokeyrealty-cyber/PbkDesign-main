import { useState } from 'react';
import { ArrowRight, Building2, DollarSign, Home, Map, TrendingUp } from 'lucide-react';
import { DealData, PBKPath } from '../types';
import { formatCurrency } from '../utils/formatting';

interface StrategySelectorProps {
  deal: DealData;
  selectedPath: PBKPath;
  onOpenCallMode: (path: PBKPath) => void;
}

interface StrategyCard {
  path: PBKPath;
  icon: typeof DollarSign;
  title: string;
  badge: string;
  tone: 'green' | 'blue' | 'purple' | 'amber' | 'slate';
  description: string;
  timeline: string;
  viable: boolean;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
}

function getToneClasses(tone: StrategyCard['tone']) {
  const tones = {
    green: {
      card: 'from-green-50 to-emerald-100 dark:from-green-950/30 dark:to-emerald-900/20 border-green-200 dark:border-green-700',
      badge: 'bg-green-500',
      accent: 'text-green-700 dark:text-green-400',
      button: 'bg-green-500 hover:bg-green-600',
    },
    blue: {
      card: 'from-blue-50 to-sky-100 dark:from-blue-950/30 dark:to-sky-900/20 border-blue-200 dark:border-blue-700',
      badge: 'bg-blue-500',
      accent: 'text-blue-700 dark:text-blue-400',
      button: 'bg-blue-500 hover:bg-blue-600',
    },
    purple: {
      card: 'from-purple-50 to-fuchsia-100 dark:from-purple-950/30 dark:to-fuchsia-900/20 border-purple-200 dark:border-purple-700',
      badge: 'bg-purple-500',
      accent: 'text-purple-700 dark:text-purple-400',
      button: 'bg-purple-500 hover:bg-purple-600',
    },
    amber: {
      card: 'from-amber-50 to-orange-100 dark:from-amber-950/30 dark:to-orange-900/20 border-amber-200 dark:border-amber-700',
      badge: 'bg-amber-500',
      accent: 'text-amber-700 dark:text-amber-400',
      button: 'bg-amber-500 hover:bg-amber-600',
    },
    slate: {
      card: 'from-slate-50 to-slate-100 dark:from-slate-900/70 dark:to-slate-800/80 border-slate-200 dark:border-slate-700',
      badge: 'bg-slate-600',
      accent: 'text-slate-700 dark:text-slate-300',
      button: 'bg-slate-700 hover:bg-slate-800',
    },
  };

  return tones[tone];
}

function getStrategies(deal: DealData): StrategyCard[] {
  if (deal.type === 'land') {
    const landPath: PBKPath = deal.contact === 'realtor' ? 'land-agent' : 'land-owner';

    return [
      {
        path: landPath,
        icon: Map,
        title: 'Builder Assignment',
        badge: deal.contact === 'realtor' ? 'LAND AGENT' : 'LAND OWNER',
        tone: 'slate',
        description: 'Builder-facing land workflow with offer-to-seller math and quick disposition timing.',
        timeline: '21-30 days',
        viable: deal.builderTotal > 0 || deal.offer > 0 || Number.parseFloat(deal.lotSize || '0') > 0,
        primaryLabel: 'Offer to Seller',
        primaryValue: formatCurrency(deal.offer),
        secondaryLabel: 'Builder Total',
        secondaryValue: formatCurrency(deal.builderTotal),
      },
      {
        path: 'rbp-land',
        icon: TrendingUp,
        title: 'Land RBP Backup',
        badge: 'BACKUP EXIT',
        tone: 'amber',
        description: 'Backup land path that keeps the retail-style leverage while protecting the seller conversation.',
        timeline: '21-30 days',
        viable: deal.builderTotal > 0 || deal.offer > 0,
        primaryLabel: 'Cash Alternative',
        primaryValue: formatCurrency(deal.rbpCashAlternative || 0),
        secondaryLabel: 'Builder Pays',
        secondaryValue: formatCurrency(deal.builderTotal),
      },
    ];
  }

  return [
    {
      path: 'cash',
      icon: DollarSign,
      title: 'Cash Wholesale',
      badge: 'FAST CLOSE',
      tone: 'green',
      description: 'Use the fastest path when the seller wants certainty, speed, and an as-is exit.',
      timeline: '7-14 days',
      viable: deal.price > 0 && deal.arv > 0,
      primaryLabel: 'MAO Cash',
      primaryValue: formatCurrency(deal.mao60),
      secondaryLabel: 'Fee Target',
      secondaryValue: formatCurrency(deal.fee || 8000),
    },
    {
      path: 'cf',
      icon: Building2,
      title: 'Creative Finance',
      badge: 'SELLER TERMS',
      tone: 'blue',
      description: 'Structured terms path for higher headline price, monthly spread, and flexible seller outcomes.',
      timeline: '14-30 days',
      viable: deal.price > 0 && deal.arv > 0,
      primaryLabel: 'Down Payment',
      primaryValue: formatCurrency(deal.cfDownPayment || Math.round((deal.agreedPrice || deal.price || 0) * 0.04)),
      secondaryLabel: 'Rate / Term',
      secondaryValue: `${deal.cfRate || 5}% / ${deal.cfTerm || 30}y`,
    },
    {
      path: 'mt',
      icon: Home,
      title: 'Mortgage Takeover',
      badge: 'DEBT RELIEF',
      tone: 'purple',
      description: 'Use the existing mortgage when the seller needs relief and the current loan gives the deal leverage.',
      timeline: '14-30 days',
      viable: deal.balance > 0 || deal.rate > 0,
      primaryLabel: 'Loan Balance',
      primaryValue: formatCurrency(deal.mtBalanceConfirm || deal.balance || 0),
      secondaryLabel: 'Existing Rate',
      secondaryValue: `${deal.mtRateConfirm || deal.rate || 0}%`,
    },
    {
      path: 'rbp',
      icon: TrendingUp,
      title: 'Retail Buyer Program',
      badge: 'MAX PRICE',
      tone: 'amber',
      description: 'Retail-buyer path with a stronger top-line price and cash fallback for seller confidence.',
      timeline: '14-21 days',
      viable: deal.price > 0 && deal.arv > 0,
      primaryLabel: 'MAO RBP',
      primaryValue: formatCurrency(deal.maoRBP),
      secondaryLabel: 'Cash Backup',
      secondaryValue: formatCurrency(deal.rbpCashAlternative || 0),
    },
  ];
}

function getUnderwritingRules(deal: DealData, strategies: StrategyCard[]) {
  const byPath: Record<PBKPath, Array<{ rule: string; value: string; pass: boolean }>> = {
    cash: [
      { rule: 'ARV ready', value: 'Comp-backed ARV loaded', pass: deal.arv > 0 },
      { rule: 'List price in range', value: 'Price at or below MAO Cash', pass: deal.price > 0 && deal.mao60 > 0 && deal.price <= deal.mao60 },
      { rule: 'Repairs captured', value: 'Mid repair estimate entered', pass: deal.repairs.mid >= 0 },
    ],
    cf: [
      { rule: 'Price captured', value: 'Seller number loaded', pass: deal.price > 0 || (deal.agreedPrice || 0) > 0 },
      { rule: 'Rate / term ready', value: 'CF rate and term present', pass: (deal.cfRate || 0) > 0 && (deal.cfTerm || 0) > 0 },
      { rule: 'Down payment ready', value: 'CF down payment captured', pass: (deal.cfDownPayment || 0) > 0 },
    ],
    mt: [
      { rule: 'Loan balance ready', value: 'Existing balance captured', pass: (deal.balance || 0) > 0 || (deal.mtBalanceConfirm || 0) > 0 },
      { rule: 'Rate ready', value: 'Existing interest rate captured', pass: (deal.rate || 0) > 0 || (deal.mtRateConfirm || 0) > 0 },
      { rule: 'Rent context ready', value: 'Rent estimate loaded', pass: (deal.rent || 0) > 0 },
    ],
    rbp: [
      { rule: 'ARV ready', value: 'Comp-backed ARV loaded', pass: deal.arv > 0 },
      { rule: 'Price in range', value: 'Price at or below MAO RBP', pass: deal.price > 0 && deal.maoRBP > 0 && deal.price <= deal.maoRBP },
      { rule: 'Cash backup ready', value: 'RBP cash alternative captured', pass: (deal.rbpCashAlternative || 0) > 0 },
    ],
    'land-owner': [
      { rule: 'Lot size ready', value: 'Lot size entered', pass: Number.parseFloat(deal.lotSize || '0') > 0 || (deal.landLotSizeSqFt || 0) > 0 },
      { rule: 'Builder pricing ready', value: 'Builder value loaded', pass: deal.builderTotal > 0 || deal.builderPrice > 0 || (deal.landPriceSqFt || 0) > 0 },
      { rule: 'Offer ready', value: 'Offer to seller captured', pass: deal.offer > 0 },
    ],
    'land-agent': [
      { rule: 'Lot size ready', value: 'Lot size entered', pass: Number.parseFloat(deal.lotSize || '0') > 0 || (deal.landLotSizeSqFt || 0) > 0 },
      { rule: 'Builder pricing ready', value: 'Builder value loaded', pass: deal.builderTotal > 0 || deal.builderPrice > 0 || (deal.landPriceSqFt || 0) > 0 },
      { rule: 'Offer ready', value: 'Offer to seller captured', pass: deal.offer > 0 },
    ],
    'rbp-land': [
      { rule: 'Builder value ready', value: 'Builder total captured', pass: deal.builderTotal > 0 },
      { rule: 'Cash backup ready', value: 'RBP cash alternative entered', pass: (deal.rbpCashAlternative || 0) > 0 },
      { rule: 'Lot size ready', value: 'Lot size confirmed', pass: Number.parseFloat(deal.lotSize || '0') > 0 || (deal.landLotSizeSqFt || 0) > 0 },
    ],
  };

  return strategies.map((strategy) => ({
    strategy,
    rules: byPath[strategy.path] || [],
  }));
}

export function StrategySelector({
  deal,
  selectedPath,
  onOpenCallMode,
}: StrategySelectorProps) {
  const [showUnderwriting, setShowUnderwriting] = useState(false);
  const [showAllPaths, setShowAllPaths] = useState(false);
  const strategies = getStrategies(deal);
  const underwriting = getUnderwritingRules(deal, strategies);

  const handleStrategyClick = (path: PBKPath) => {
    onOpenCallMode(path);
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Strategy Selector
          </h3>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowUnderwriting((prev) => !prev)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
              showUnderwriting
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-slate-900 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
            }`}
          >
            Underwriting Rules
          </button>
          <button
            onClick={() => setShowAllPaths((prev) => !prev)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
              showAllPaths
                ? 'bg-purple-500 text-white'
                : 'bg-gray-100 dark:bg-slate-900 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
            }`}
          >
            Compare All Paths
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-[11px] leading-5 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
        Tap any strategy card to load that exact path in <strong>Call Mode</strong>. Scripts, live inputs, and objections now stay in Call Mode instead of spilling back into Analyzer.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {strategies.map((strategy) => {
          const tone = getToneClasses(strategy.tone);
          const isSelected = strategy.path === selectedPath;

          return (
            <button
              key={strategy.path}
              type="button"
              onClick={() => handleStrategyClick(strategy.path)}
              className={`relative text-left border rounded-2xl p-4 transition-all bg-gradient-to-br ${tone.card} ${
                isSelected
                  ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-blue-400 shadow-lg scale-[1.01]'
                  : 'hover:shadow-md hover:-translate-y-0.5'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 ${tone.badge} rounded-xl flex items-center justify-center shadow-sm`}>
                    <strategy.icon size={18} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
                      {strategy.title}
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">
                      {strategy.timeline}
                    </div>
                  </div>
                </div>
                <div className={`px-2 py-0.5 ${tone.badge} text-white rounded-full text-[8px] font-bold tracking-wide`}>
                  {strategy.badge}
                </div>
              </div>

              <div className="text-[11px] leading-5 text-gray-700 dark:text-gray-300 mb-3">
                {strategy.description}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-xl border border-white/60 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 px-3 py-2">
                  <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                    {strategy.primaryLabel}
                  </div>
                  <div className="text-[12px] font-semibold text-gray-900 dark:text-gray-100">
                    {strategy.primaryValue}
                  </div>
                </div>
                <div className="rounded-xl border border-white/60 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 px-3 py-2">
                  <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                    {strategy.secondaryLabel}
                  </div>
                  <div className="text-[12px] font-semibold text-gray-900 dark:text-gray-100">
                    {strategy.secondaryValue}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className={`text-[10px] font-semibold ${strategy.viable ? tone.accent : 'text-amber-700 dark:text-amber-300'}`}>
                  {strategy.viable ? 'Ready to work this path' : 'Path available - complete missing inputs in Call Mode'}
                </div>
                <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white ${tone.button}`}>
                  Open Call Mode
                  <ArrowRight size={12} />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {showUnderwriting && (
        <div className="mb-4 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <div className="bg-gradient-to-r from-gray-800 to-slate-900 px-4 py-2">
            <div className="text-[12px] font-bold text-white">
              Underwriting Rules & Path Readiness
            </div>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-slate-900">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {underwriting.map(({ strategy, rules }) => {
                const passedRules = rules.filter((rule) => rule.pass).length;
                const totalRules = rules.length || 1;
                const score = Math.round((passedRules / totalRules) * 100);

                return (
                  <div
                    key={strategy.path}
                    className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-gray-200 dark:border-slate-700"
                  >
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="text-[11px] font-bold text-gray-900 dark:text-gray-100">
                        {strategy.title}
                      </div>
                      <div
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          score === 100
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                            : score >= 67
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                        }`}
                      >
                        {passedRules}/{rules.length} Pass
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {rules.map((rule) => (
                        <div key={rule.rule} className="flex items-start gap-2 text-[11px]">
                          <div className={`mt-0.5 ${rule.pass ? 'text-green-500' : 'text-amber-500'}`}>
                            {rule.pass ? 'OK' : 'NEEDS'}
                          </div>
                          <div className="flex-1">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{rule.rule}</div>
                            <div className="text-[10px] text-gray-500 dark:text-gray-400">{rule.value}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showAllPaths && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <div className="bg-gradient-to-r from-gray-800 to-slate-900 px-4 py-2">
            <div className="text-[12px] font-bold text-white">
              Path Comparison Snapshot
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-gray-100 dark:bg-slate-800">
                  <th className="px-2 py-2 text-left font-bold text-gray-700 dark:text-gray-300">Path</th>
                  <th className="px-2 py-2 text-left font-bold text-gray-700 dark:text-gray-300">Primary</th>
                  <th className="px-2 py-2 text-left font-bold text-gray-700 dark:text-gray-300">Secondary</th>
                  <th className="px-2 py-2 text-left font-bold text-gray-700 dark:text-gray-300">Timeline</th>
                  <th className="px-2 py-2 text-left font-bold text-gray-700 dark:text-gray-300">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900">
                {strategies.map((strategy, index) => (
                  <tr
                    key={strategy.path}
                    className={`border-t border-gray-200 dark:border-slate-700 ${
                      index % 2 === 1 ? 'bg-gray-50 dark:bg-slate-800/50' : ''
                    }`}
                  >
                    <td className="px-2 py-2 font-medium text-gray-800 dark:text-gray-100">{strategy.title}</td>
                    <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{strategy.primaryValue}</td>
                    <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{strategy.secondaryValue}</td>
                    <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{strategy.timeline}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                          strategy.viable
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                        }`}
                      >
                        {strategy.viable ? 'Ready' : 'Needs input'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
