import { DealData } from '../types';
import { formatCurrency } from '../utils/formatting';
import { calculateLandOffer } from '../utils/dealCalculations';

interface LandAnalysisProps {
  deal: DealData;
  onDealChange: (updates: Partial<DealData>) => void;
}

export function LandAnalysis({ deal, onDealChange }: LandAnalysisProps) {
  const handleInputChange = (field: keyof DealData, value: any) => {
    onDealChange({ [field]: value });
  };

  // Input mode (default to quarter-acre)
  const inputMode = deal.landInputMode || 'quarter-acre';

  // Conversion constants
  const SQFT_PER_ACRE = 43560;
  const SQFT_PER_QUARTER_ACRE = 10890; // 43560 / 4

  // Sync functions for input mode conversion
  const syncFromQuarterAcre = () => {
    const acres = parseFloat(deal.lotSize) || 0;
    const sqft = acres * SQFT_PER_ACRE;
    const pricePerSqFt = deal.builderPrice / SQFT_PER_QUARTER_ACRE;

    onDealChange({
      landLotSizeSqFt: sqft,
      landPriceSqFt: parseFloat(pricePerSqFt.toFixed(4))
    });
  };

  const syncFromSqFt = () => {
    const sqft = deal.landLotSizeSqFt || 0;
    const acres = sqft / SQFT_PER_ACRE;
    const pricePerQuarterAcre = (deal.landPriceSqFt || 0) * SQFT_PER_QUARTER_ACRE;

    onDealChange({
      lotSize: acres.toFixed(4),
      builderPrice: Math.round(pricePerQuarterAcre)
    });
  };

  // Calculate builder total based on lot size and builder price per 0.25 acre
  // FORMULA LOCKED - Match original HTML dynamic spread calculation
  const calculateBuilderTotal = () => {
    const acres = parseFloat(deal.lotSize) || 0;
    const units = acres / 0.25; // Each 0.25 acre is 1 unit
    const builderTotal = units * deal.builderPrice;

    // Use dynamic spread calculation from original HTML (8K/6.5K/5.5K)
    const { offer: calculatedOffer } = calculateLandOffer(builderTotal);

    onDealChange({
      builderTotal,
      // Auto-calculate offer using dynamic spread if not manually edited
      offer: deal.offer || calculatedOffer
    });
  };

  const builderTotal = (parseFloat(deal.lotSize) || 0) / 0.25 * deal.builderPrice;
  const units = (parseFloat(deal.lotSize) || 0) / 0.25;
  const spread = builderTotal - (deal.offer || 0);
  const spreadPercent = builderTotal > 0 ? ((spread / builderTotal) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Step 2 — Land Numbers
          </h3>
        </div>

        {/* Input Mode Toggle */}
        <div className="flex items-center gap-2 mb-3 p-2 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800">
          <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
            Input Mode:
          </span>
          <button
            onClick={() => {
              handleInputChange('landInputMode', 'quarter-acre');
              if (inputMode === 'sqft') syncFromSqFt();
            }}
            className={`px-3 py-1 rounded text-[11px] font-medium transition-all ${
              inputMode === 'quarter-acre'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
            }`}
          >
            📐 Per ¼ Acre
          </button>
          <button
            onClick={() => {
              handleInputChange('landInputMode', 'sqft');
              if (inputMode === 'quarter-acre') syncFromQuarterAcre();
            }}
            className={`px-3 py-1 rounded text-[11px] font-medium transition-all ${
              inputMode === 'sqft'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
            }`}
          >
            📏 Per Sq Ft
          </button>
        </div>

        <div className="space-y-3">
          {/* Builder Price - Quarter Acre Mode */}
          {inputMode === 'quarter-acre' && (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                  Builder's price per ¼ acre
                  <small className="block text-[10px] text-gray-400">
                    What builder pays per 0.25-acre unit
                  </small>
                </label>
              </div>
              <div className="relative w-32">
                <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                <input
                  type="number"
                  value={deal.builderPrice || ''}
                  onChange={(e) => {
                    handleInputChange('builderPrice', parseFloat(e.target.value) || 0);
                  }}
                  onBlur={() => {
                    calculateBuilderTotal();
                    syncFromQuarterAcre();
                  }}
                  placeholder="30000"
                  className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          )}

          {/* Builder Price - Square Foot Mode */}
          {inputMode === 'sqft' && (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                  Builder's price per sq ft
                  <small className="block text-[10px] text-gray-400">
                    Price basis for a single square foot of land
                  </small>
                </label>
              </div>
              <div className="relative w-32">
                <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={deal.landPriceSqFt || ''}
                  onChange={(e) => {
                    handleInputChange('landPriceSqFt', parseFloat(e.target.value) || 0);
                  }}
                  onBlur={() => {
                    syncFromSqFt();
                    calculateBuilderTotal();
                  }}
                  placeholder="2.75"
                  className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          )}

          {/* Lot Size - Acres Mode */}
          {inputMode === 'quarter-acre' && (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                  Lot size (acres)
                  <small className="block text-[10px] text-gray-400">
                    Every 0.25 ac = 1 unit · 4 units = 1 full acre
                  </small>
                </label>
              </div>
              <div className="w-32">
                <input
                  type="text"
                  value={deal.lotSize || ''}
                  onChange={(e) => handleInputChange('lotSize', e.target.value)}
                  onBlur={() => {
                    calculateBuilderTotal();
                    syncFromQuarterAcre();
                  }}
                  placeholder="0.25"
                  className="w-full h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          )}

          {/* Lot Size - Square Feet Mode */}
          {inputMode === 'sqft' && (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                  Lot size (square feet)
                  <small className="block text-[10px] text-gray-400">
                    43,560 sq ft = 1 acre · 10,890 sq ft = ¼ acre
                  </small>
                </label>
              </div>
              <div className="w-32">
                <input
                  type="number"
                  value={deal.landLotSizeSqFt || ''}
                  onChange={(e) => handleInputChange('landLotSizeSqFt', parseFloat(e.target.value) || 0)}
                  onBlur={() => {
                    syncFromSqFt();
                    calculateBuilderTotal();
                  }}
                  placeholder="10890"
                  className="w-full h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          )}

          {/* Builder Total (calculated) */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-1">
              Builder Total for This Lot
            </div>
            <div className="text-[22px] font-bold text-blue-700 dark:text-blue-300">
              {formatCurrency(builderTotal)}
            </div>
            <div className="text-[10px] text-blue-600 dark:text-blue-500 mt-1">
              {units.toFixed(2)} units × {formatCurrency(deal.builderPrice)} per unit
            </div>
          </div>

          {/* Your Offer */}
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                Your offer to seller
                <small className="block text-[10px] text-gray-400">
                  Auto-calc from lot size × builder price − 20% spread · editable
                </small>
              </label>
            </div>
            <div className="relative w-32">
              <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
              <input
                type="number"
                value={deal.offer || ''}
                onChange={(e) => handleInputChange('offer', parseFloat(e.target.value) || 0)}
                placeholder="24000"
                className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {/* Target Zip Code */}
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                Target zip code
              </label>
            </div>
            <div className="w-32">
              <input
                type="text"
                value={deal.zipCode || ''}
                onChange={(e) => handleInputChange('zipCode', e.target.value)}
                placeholder="33976"
                className="w-full h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Deal Analysis */}
      {builderTotal > 0 && deal.offer > 0 && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
              Deal Analysis
            </h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
            <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(builderTotal)}
              </div>
              <div className="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mt-0.5">
                Builder Total
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(deal.offer)}
              </div>
              <div className="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mt-0.5">
                Your Offer
              </div>
            </div>
            <div className={`rounded-lg p-3 text-center ${
              spread >= builderTotal * 0.15
                ? 'bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700'
                : 'bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-900/20 dark:to-yellow-800/20 border border-yellow-200 dark:border-yellow-700'
            }`}>
              <div className={`text-[16px] font-semibold ${
                spread >= builderTotal * 0.15
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-yellow-700 dark:text-yellow-400'
              }`}>
                {formatCurrency(spread)}
              </div>
              <div className={`text-[9.5px] font-medium uppercase tracking-wide mt-0.5 ${
                spread >= builderTotal * 0.15
                  ? 'text-green-600 dark:text-green-500'
                  : 'text-yellow-600 dark:text-yellow-500'
              }`}>
                Spread ({spreadPercent}%)
              </div>
            </div>
          </div>

          {/* Verdict */}
          <div className={`rounded-lg p-3 border-l-4 ${
            spread >= builderTotal * 0.20
              ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-600'
              : spread >= builderTotal * 0.15
              ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500 dark:border-yellow-600'
              : 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-600'
          }`}>
            <div className={`text-[12.5px] font-semibold leading-relaxed ${
              spread >= builderTotal * 0.20
                ? 'text-green-800 dark:text-green-300'
                : spread >= builderTotal * 0.15
                ? 'text-yellow-800 dark:text-yellow-300'
                : 'text-red-800 dark:text-red-300'
            }`}>
              {spread >= builderTotal * 0.20
                ? '✅ EXCELLENT DEAL — 20%+ spread provides strong profit margin for assignment to builder.'
                : spread >= builderTotal * 0.15
                ? '⚠️ WORKABLE DEAL — 15-20% spread is acceptable. Negotiate for better terms if possible.'
                : '🛑 THIN MARGINS — Less than 15% spread. Need better spread or pass on this deal.'}
            </div>
          </div>

          {/* Strategy Tips */}
          <div className="mt-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-1">
              💡 Strategy Tips
            </div>
            <ul className="text-[11px] text-blue-800 dark:text-blue-300 space-y-1 leading-relaxed">
              <li>• Contact local builders who pay {formatCurrency(deal.builderPrice)} per ¼ acre</li>
              <li>• Verify zoning allows residential development</li>
              <li>• Check for utilities access (water, sewer, electric)</li>
              <li>• Assignment fee: {formatCurrency(spread)} ({spreadPercent}% of builder total)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
