import { DealData } from '../types';
import { formatCurrency } from '../utils/formatting';

interface LeftPanelProps {
  deal: DealData;
  isOpen: boolean;
}

export function LeftPanel({ deal, isOpen }: LeftPanelProps) {

  return (
    <div
      className={`
        fixed md:relative top-[54px] md:top-0 left-0 bottom-0 z-40
        w-[224px] bg-white dark:bg-slate-900/95 border-r border-gray-200 dark:border-slate-700
        overflow-y-auto p-3 transition-transform duration-250
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        backdrop-blur-lg
      `}
    >
      {/* Property Section */}
      <div className="mb-3">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5 pb-0.5">
          Property
        </div>
        <div className="flex justify-between gap-1 mb-1 items-start">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">Address</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 text-right break-words">
            {deal.address || '—'}
          </span>
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Type</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 capitalize">
            {deal.type || '—'}
          </span>
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Contact</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100 capitalize">
            {deal.contact || '—'}
          </span>
        </div>
      </div>

      {/* Deal Data Section */}
      <div className="mb-3">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5 pb-0.5">
          Deal Data
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Price</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
            {formatCurrency(deal.price)}
          </span>
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Beds/Baths</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
            {deal.beds && deal.baths ? `${deal.beds}/${deal.baths}` : '—'}
          </span>
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Sq Ft</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
            {deal.sqft ? deal.sqft.toLocaleString() : '—'}
          </span>
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Year</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
            {deal.year || '—'}
          </span>
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">DOM</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
            {deal.dom || '—'}
          </span>
        </div>
      </div>

      {/* Finance Section */}
      {deal.type === 'house' && (
        <div className="mb-3">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5 pb-0.5">
            Finance
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Rent</span>
            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(deal.rent)}
            </span>
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Bal.</span>
            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(deal.balance)}
            </span>
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Rate</span>
            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
              {deal.rate ? `${deal.rate}%` : '—'}
            </span>
          </div>
        </div>
      )}

      {/* Repairs Section */}
      {deal.type === 'house' && (
        <div className="mb-3">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5 pb-0.5">
            Repairs
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Low</span>
            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(deal.repairs?.low || 0)}
            </span>
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Mid</span>
            <span className="text-[11px] font-semibold text-blue-500">
              {formatCurrency(deal.repairs?.mid || 0)}
            </span>
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">High</span>
            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(deal.repairs?.high || 0)}
            </span>
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Cond.</span>
            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
              {deal.repairs?.condition || '—'}
            </span>
          </div>
        </div>
      )}

      {/* Key Numbers Section */}
      <div className="mb-3">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5 pb-0.5">
          Key Numbers
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">ARV</span>
          <span className="text-[11px] font-semibold text-blue-500">
            {formatCurrency(deal.arv)}
          </span>
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">MAO 60%</span>
          <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
            {formatCurrency(deal.mao60)}
          </span>
        </div>
        <div className="flex justify-between gap-1 mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">MAO RBP</span>
          <span className="text-[11px] font-semibold text-green-600">
            {formatCurrency(deal.maoRBP)}
          </span>
        </div>
        {deal.type === 'house' && deal.repairs && (
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">MAO+Rep</span>
            <span className="text-[11px] font-semibold text-gray-900 dark:text-gray-100">
              {formatCurrency(deal.mao60 + (deal.repairs.mid || 0))}
            </span>
          </div>
        )}
      </div>

      {/* Profit Estimate Section */}
      {deal.type === 'house' && deal.arv > 0 && deal.price > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-2 mb-3">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 mb-1.5 pb-0.5">
            Profit Est.
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-600 dark:text-gray-400">Assign Fee</span>
            <span className="text-[11px] font-semibold text-green-700 dark:text-green-400">
              {formatCurrency(deal.fee || 8000)}
            </span>
          </div>
          <div className="flex justify-between gap-1 mb-1">
            <span className="text-[11px] text-gray-600 dark:text-gray-400">Pot. Profit</span>
            <span className="text-[11px] font-semibold text-green-700 dark:text-green-400">
              {formatCurrency(Math.max(0, deal.maoRBP - deal.price))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
