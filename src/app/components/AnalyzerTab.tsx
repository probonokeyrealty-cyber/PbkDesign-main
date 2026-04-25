import { DealData, PBKPath } from '../types';
import { RepairCalculator } from './RepairCalculator';
import { LandAnalysis } from './LandAnalysis';
import { DealScoring } from './DealScoring';
import { StrategySelector } from './StrategySelector';
import { UnderwritingControls } from './UnderwritingControls';
import { formatCurrency } from '../utils/formatting';
import { calculateARV } from '../utils/dealCalculations';
import { getAnalyzeReadiness } from '../utils/pbk';

interface AnalyzerTabProps {
  deal: DealData;
  selectedPath: PBKPath;
  onDealChange: (updates: Partial<DealData>) => void;
  onAnalyze: () => void;
  onOpenCallMode: (path: PBKPath) => void;
  analyzeStatus: string;
}

export function AnalyzerTab({
  deal,
  selectedPath,
  onDealChange,
  onAnalyze,
  onOpenCallMode,
  analyzeStatus,
}: AnalyzerTabProps) {
  const handleInputChange = (field: keyof DealData, value: DealData[keyof DealData]) => {
    onDealChange({ [field]: value });
  };

  const handleCompChange = (comp: 'A' | 'B' | 'C', field: string, value: string | number) => {
    onDealChange({
      comps: {
        ...deal.comps,
        [comp]: {
          ...deal.comps[comp],
          [field]: value,
        },
      },
    });
  };

  const arv = deal.arv || calculateARV(deal.comps);
  const analyzeReadiness = getAnalyzeReadiness(deal);
  const analyzeCtaLabel = analyzeReadiness.ready && deal.isAnalyzed ? 'Open Call Mode ->' : 'Analyze Deal ->';
  const verdictTone =
    deal.verdict === 'green'
      ? {
          wrapper: 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-600',
          text: 'text-green-800 dark:text-green-300',
          message:
            'Strong deal - price is at or below MAO RBP. This is ready to move into offer strategy and seller conversations.',
        }
      : deal.verdict === 'yellow'
        ? {
            wrapper: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500 dark:border-yellow-600',
            text: 'text-yellow-800 dark:text-yellow-300',
            message:
              'Marginal deal - the numbers are workable, but the margin is tight. Negotiate down or structure terms carefully.',
          }
        : {
            wrapper: 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-600',
            text: 'text-red-800 dark:text-red-300',
            message:
              'Overpriced - the current list price is outside the safer PBK range. Either negotiate significantly or pass.',
          };

  return (
    <div className="p-3.5">
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Step 1 - Enter Property Details
          </h3>
        </div>

        <div className="mb-3">
          <label className="block text-[11px] text-gray-600 dark:text-gray-400 mb-1">Address</label>
          <input
            type="text"
            value={deal.address}
            onChange={(e) => handleInputChange('address', e.target.value)}
            placeholder="123 Main St, City, ST 12345"
            className="w-full h-9 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
          />
        </div>

        <div className="flex gap-1.5 mb-3 flex-wrap items-center">
          <span className="text-[11.5px] text-gray-600 dark:text-gray-400">Contact:</span>
          <button
            onClick={() => handleInputChange('contact', 'owner')}
            className={`px-3 py-1 rounded-full text-[11.5px] border transition-all ${
              deal.contact === 'owner'
                ? 'bg-black dark:bg-slate-700 text-white border-black dark:border-slate-700'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'
            }`}
          >
            Owner/FSBO
          </button>
          <button
            onClick={() => handleInputChange('contact', 'realtor')}
            className={`px-3 py-1 rounded-full text-[11.5px] border transition-all ${
              deal.contact === 'realtor'
                ? 'bg-black dark:bg-slate-700 text-white border-black dark:border-slate-700'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'
            }`}
          >
            Realtor Listed
          </button>
        </div>

        <div className="flex gap-1.5 mb-3 flex-wrap items-center">
          <span className="text-[11.5px] text-gray-600 dark:text-gray-400">Type:</span>
          <button
            onClick={() => handleInputChange('type', 'house')}
            className={`px-3 py-1 rounded-full text-[11.5px] border transition-all ${
              deal.type === 'house'
                ? 'bg-black dark:bg-slate-700 text-white border-black dark:border-slate-700'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'
            }`}
          >
            House
          </button>
          <button
            onClick={() => handleInputChange('type', 'land')}
            className={`px-3 py-1 rounded-full text-[11.5px] border transition-all ${
              deal.type === 'land'
                ? 'bg-black dark:bg-slate-700 text-white border-black dark:border-slate-700'
                : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'
            }`}
          >
            Land/Lot
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              List Price ($)
            </div>
            <input
              type="number"
              value={deal.price || ''}
              onChange={(e) => handleInputChange('price', parseFloat(e.target.value) || 0)}
              placeholder="250000"
              className="w-full border-none outline-none bg-transparent text-[14px] font-semibold text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              Beds
            </div>
            <input
              type="number"
              value={deal.beds || ''}
              onChange={(e) => handleInputChange('beds', parseFloat(e.target.value) || 0)}
              placeholder="3"
              className="w-full border-none outline-none bg-transparent text-[14px] font-semibold text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              Baths
            </div>
            <input
              type="number"
              value={deal.baths || ''}
              onChange={(e) => handleInputChange('baths', parseFloat(e.target.value) || 0)}
              placeholder="2"
              className="w-full border-none outline-none bg-transparent text-[14px] font-semibold text-gray-900 dark:text-gray-100"
            />
          </div>
          {deal.type === 'house' ? (
            <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                Sq Ft
              </div>
              <input
                type="number"
                value={deal.sqft || ''}
                onChange={(e) => handleInputChange('sqft', parseFloat(e.target.value) || 0)}
                placeholder="1500"
                className="w-full border-none outline-none bg-transparent text-[14px] font-semibold text-gray-900 dark:text-gray-100"
              />
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                Lot Size (acres)
              </div>
              <input
                type="number"
                step="0.01"
                value={deal.lotSize || ''}
                onChange={(e) => handleInputChange('lotSize', e.target.value)}
                placeholder="0.25"
                className="w-full border-none outline-none bg-transparent text-[14px] font-semibold text-gray-900 dark:text-gray-100"
              />
            </div>
          )}
          <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              Year Built
            </div>
            <input
              type="number"
              value={deal.year || ''}
              onChange={(e) => handleInputChange('year', parseFloat(e.target.value) || 0)}
              placeholder="1985"
              className="w-full border-none outline-none bg-transparent text-[14px] font-semibold text-gray-900 dark:text-gray-100"
            />
          </div>
          <div className="bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
              Days on Market
            </div>
            <input
              type="number"
              value={deal.dom || ''}
              onChange={(e) => handleInputChange('dom', parseFloat(e.target.value) || 0)}
              placeholder="0"
              className="w-full border-none outline-none bg-transparent text-[14px] font-semibold text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      </div>

      {deal.type === 'house' && (
        <>
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
                Step 2 - House Numbers
              </h3>
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                    ARV (auto from comps)
                    <small className="block text-[10px] text-gray-400">Average of Comp A+B+C</small>
                  </label>
                </div>
                <div className="w-32">
                  <input
                    type="number"
                    value={arv || ''}
                    readOnly
                    placeholder="0"
                    className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-100 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] cursor-default"
                  />
                  <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                    Monthly rent estimate
                    <small className="block text-[10px] text-gray-400">Check Zillow rent estimate tab</small>
                  </label>
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                  <input
                    type="number"
                    value={deal.rent || ''}
                    onChange={(e) => handleInputChange('rent', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                    Seller mortgage balance
                    <small className="block text-[10px] text-gray-400">For sub-2 / creative finance</small>
                  </label>
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                  <input
                    type="number"
                    value={deal.balance || ''}
                    onChange={(e) => handleInputChange('balance', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                    Seller interest rate
                    <small className="block text-[10px] text-gray-400">If sub-2 or assumable target</small>
                  </label>
                </div>
                <div className="relative w-32">
                  <input
                    type="number"
                    step="0.1"
                    value={deal.rate || ''}
                    onChange={(e) => handleInputChange('rate', parseFloat(e.target.value) || 0)}
                    placeholder="0.0"
                    className="w-full h-9 pr-5 pl-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                  />
                  <span className="absolute right-2 top-2 text-[12px] text-gray-500">%</span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <label className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1">
                    Your assignment fee
                  </label>
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                  <input
                    type="number"
                    value={deal.fee || ''}
                    onChange={(e) => handleInputChange('fee', parseFloat(e.target.value) || 0)}
                    placeholder="8000"
                    className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                  />
                </div>
              </div>
            </div>
          </div>

          <RepairCalculator onRepairChange={(repairs) => handleInputChange('repairs', repairs)} />
        </>
      )}

      {deal.type === 'land' && <LandAnalysis deal={deal} onDealChange={onDealChange} />}

      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Comparable Sales (Mean = ARV)
          </h3>
        </div>

        <div className="space-y-2">
          {(['A', 'B', 'C'] as const).map((comp) => (
            <div
              key={comp}
              className="flex items-center gap-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2"
            >
              <span className="text-[11px] font-bold text-blue-500 text-center w-6">{comp}</span>
              <input
                type="text"
                value={deal.comps[comp].address}
                onChange={(e) => handleCompChange(comp, 'address', e.target.value)}
                placeholder="123 Main St, City, MI"
                className="flex-1 h-7 px-2 border border-gray-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-[11.5px] text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500 transition-all"
              />
              <div className="flex items-center bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded px-2 h-7">
                <span className="text-[11.5px] text-gray-500">$</span>
                <input
                  type="number"
                  value={deal.comps[comp].price || ''}
                  onChange={(e) => handleCompChange(comp, 'price', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-20 border-none outline-none bg-transparent text-[11.5px] text-gray-900 dark:text-gray-100"
                />
              </div>
              <input
                type="text"
                value={deal.comps[comp].date}
                onChange={(e) => handleCompChange(comp, 'date', e.target.value)}
                placeholder="Jan 2025"
                className="w-20 h-7 px-2 border border-gray-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-[11.5px] text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500 transition-all"
              />
            </div>
          ))}
        </div>

        <div className="text-[10.5px] text-gray-500 dark:text-gray-400 mt-2">
          ARV = average of Comp A + B + C sold prices. Edit any comp to recalculate.
        </div>
      </div>

      {arv > 0 && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">Key Numbers</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(arv)}
              </div>
              <div className="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mt-0.5">
                ARV
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-3 text-center">
              <div className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(deal.mao60)}
              </div>
              <div className="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mt-0.5">
                MAO Cash
              </div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700 rounded-lg p-3 text-center">
              <div className="text-[16px] font-semibold text-green-700 dark:text-green-400">
                {formatCurrency(deal.maoRBP)}
              </div>
              <div className="text-[9.5px] text-green-600 dark:text-green-500 font-medium uppercase tracking-wide mt-0.5">
                MAO RBP
              </div>
            </div>
          </div>

          {deal.price > 0 && arv > 0 && deal.verdict !== 'none' && (
            <div className={`mt-3 rounded-lg p-3 border-l-4 ${verdictTone.wrapper}`}>
              <div className={`text-[12.5px] font-semibold leading-relaxed ${verdictTone.text}`}>
                {verdictTone.message}
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={onAnalyze}
        className="w-full px-4 py-3 rounded-full bg-gradient-to-r from-black to-gray-800 dark:from-slate-700 dark:to-slate-600 text-white text-[13px] font-semibold hover:opacity-90 transition-all shadow-md"
      >
        {analyzeCtaLabel}
      </button>
      {analyzeStatus && (
        <div
          className={`mt-2 rounded-xl border px-3 py-2 text-[11.5px] leading-relaxed ${
            analyzeReadiness.ready && deal.isAnalyzed
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
          }`}
        >
          {analyzeStatus}
        </div>
      )}

      {deal.price > 0 && (deal.arv > 0 || deal.type === 'land') && (
        <>
          <DealScoring deal={deal} />
          <StrategySelector
            deal={deal}
            selectedPath={selectedPath}
            onOpenCallMode={onOpenCallMode}
          />
          <UnderwritingControls deal={deal} onDealChange={onDealChange} />
        </>
      )}
    </div>
  );
}
