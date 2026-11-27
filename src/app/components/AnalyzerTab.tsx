import { useLayoutEffect, useRef, useState } from 'react';
import { Calculator, PanelRight } from 'lucide-react';
import { DealData, PBKPath } from '../types';
import { RepairCalculator } from './RepairCalculator';
import { LandAnalysis } from './LandAnalysis';
import { DealScoring } from './DealScoring';
import { StrategySelector } from './StrategySelector';
import { UnderwritingControls } from './UnderwritingControls';
import { HelpTooltip } from './HelpTooltip';
import {
  AnalyzerListingLookup,
  AnalyzerListingPhotos,
  type AnalyzerPhotoResult,
} from './AnalyzerListingLookup';
import { AnalyzerSellerHistory } from './AnalyzerSellerHistory';
import { AnalyzerAddressField } from './AnalyzerAddressField';
import { formatCurrency } from '../utils/formatting';
import { readAnalyzerDraftManualFields } from '../utils/analyzerStorage';
import { calculateARV } from '../utils/dealCalculations';
import { resetChangedProperty } from '../utils/analyzerIntelligence.mjs';
import { getAnalyzeReadiness } from '../utils/pbk';
import { PbkDataSource } from '../../components/pbk/index';

interface AnalyzerTabProps {
  deal: DealData;
  selectedPath: PBKPath;
  onDealChange: (updates: Partial<DealData>) => void;
  onAnalyze: () => void | Promise<void>;
  onSendToAgent: () => void | Promise<void>;
  onSaveDeal: () => void | Promise<void>;
  onClearDeal: () => boolean | Promise<boolean>;
  onSelectPath: (path: PBKPath) => void;
  onOpenCallMode: (path: PBKPath) => void;
  analyzeStatus: string;
}

type AnalyzerView = 'valuation' | 'context';

export function AnalyzerTab({
  deal,
  selectedPath,
  onDealChange,
  onAnalyze,
  onSendToAgent,
  onSaveDeal,
  onClearDeal,
  onSelectPath,
  onOpenCallMode,
  analyzeStatus,
}: AnalyzerTabProps) {
  const operatorFields = useRef(
    new Set<keyof DealData>((readAnalyzerDraftManualFields() || []) as (keyof DealData)[])
  );
  const handleInputChange = (field: keyof DealData, value: DealData[keyof DealData]) => {
    operatorFields.current.add(field);
    onDealChange({ [field]: value });
  };

  const handleCompChange = (comp: 'A' | 'B' | 'C', field: string, value: string | number) => {
    operatorFields.current.add('comps');
    operatorFields.current.add('arv');
    const comps = {
      ...deal.comps,
      [comp]: { ...deal.comps[comp], [field]: value },
    };
    onDealChange({
      compManualSlots: [...new Set([...(deal.compManualSlots || []), comp])],
      comps,
      // A deliberate comp edit updates the existing mean-ARV calculation.
      // Automatic evidence fills preserve an operator's ARV override instead.
      arv: calculateARV(comps),
    });
  };

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [view, setView] = useState<AnalyzerView>('valuation');
  const [photoResult, setPhotoResult] = useState<AnalyzerPhotoResult | null>(null);
  const scrollOffsets = useRef<Record<AnalyzerView, number>>({ valuation: 0, context: 0 });
  const scrollContainer = useRef<HTMLElement | null>(null);
  const leadId = deal.leadId?.trim() || '';
  const address = deal.address.trim();
  const currentPhotoResult = photoResult?.address === address ? photoResult : null;

  function switchView(next: AnalyzerView, button: HTMLButtonElement) {
    if (view === next) return;
    scrollContainer.current = button.closest<HTMLElement>('.pbk-deal-content');
    scrollOffsets.current[view] = scrollContainer.current?.scrollTop ?? 0;
    setView(next);
  }

  useLayoutEffect(() => {
    const container = scrollContainer.current;
    if (container) container.scrollTop = scrollOffsets.current[view];
  }, [view]);

  const arv = deal.arv || calculateARV(deal.comps);
  const analyzeReadiness = getAnalyzeReadiness(deal);
  const analyzeCtaLabel =
    analyzeReadiness.ready && deal.isAnalyzed ? 'Open Call Mode ->' : 'Analyze Deal ->';
  const handleAnalyzeCta = async () => {
    if (analyzeReadiness.ready && deal.isAnalyzed) {
      onOpenCallMode(selectedPath);
      return;
    }
    setIsAnalyzing(true);
    try {
      await onAnalyze();
    } finally {
      setIsAnalyzing(false);
    }
  };
  const handleSendToAgent = async () => {
    setIsSending(true);
    try {
      await onSendToAgent();
    } finally {
      setIsSending(false);
    }
  };
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

  const valuation = (
    <div id="analyzer-valuation" className="pbk-analyzer-valuation">
      <section
        aria-labelledby="analyzer-property-heading"
        className="pbk-analyzer-card pbk-analyzer-hero pbk-analyzer-workbench-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 id="analyzer-property-heading" className="pbk-analyzer-section-title">
            01 / Property details
          </h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onSaveDeal} className="pbk-btn pbk-btn-ghost pbk-btn-sm">
              Save deal
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await onClearDeal()) {
                  operatorFields.current.clear();
                }
              }}
              className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mb-3">
          <label
            htmlFor="deal-property-address"
            className="block text-[11px] text-gray-600 dark:text-gray-400 mb-1"
          >
            Address
          </label>
          <AnalyzerAddressField
            deal={deal}
            automaticLookup
            onChange={(patch) => {
              if (patch.address !== undefined) {
                const reset = resetChangedProperty(deal,patch.address);
                if (Object.keys(reset).length) operatorFields.current.clear();
                onDealChange({
                  ...reset,
                  ...patch,
                  leadId: undefined,
                  crmCreateKey: undefined,
                  propertyRecordSnapshot: undefined,
                  listingSnapshot: undefined,
                  recordedSales: undefined,
                  ...(deal.leadId || deal.crmCreateKey
                    ? {
                        sellerName: '',
                        sellerPhone: '',
                        sellerEmail: '',
                        sellerPhoneVerified: false,
                      }
                    : {}),
                });
              } else onDealChange(patch);
            }}
          />
          <AnalyzerListingLookup
            key={JSON.stringify([leadId, address])}
            deal={deal}
            protectedFields={operatorFields.current}
            onFill={onDealChange}
            onPhotoResult={setPhotoResult}
          />
          <details className="pbk-analyzer-records">
            <summary>Lead details · {leadId ? 'Linked lead' : 'New lead'}</summary>
            <p className="mb-2">
              Save deal keeps a local copy and syncs to the team record. New leads need a seller
              name and a phone or email.
            </p>
            {leadId && <p className="mb-2">Lead ID: {leadId}</p>}
            {(
              [
                ['sellerName', 'Seller name', 'text'],
                ['sellerPhone', 'Seller phone', 'tel'],
                ['sellerEmail', 'Seller email', 'email'],
              ] as const
            ).map(([field, label, type]) => (
              <label key={field} className="block mb-2">
                <span className="block mb-1">{label}</span>
                <input
                  type={type}
                  value={deal[field] || ''}
                  onChange={(event) => handleInputChange(field, event.target.value)}
                  className="w-full min-w-0 h-10 px-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100"
                />
              </label>
            ))}
            <p>
              Contact details do not grant permission to call, text or email. Existing approval
              checks still apply.
            </p>
          </details>
        </div>

        <div className="pbk-analyzer-segments" role="group" aria-label="Contact type">
          <span>Contact</span>
          <button
            type="button"
            aria-pressed={deal.contact === 'owner'}
            onClick={() => handleInputChange('contact', 'owner')}
          >
            Owner/FSBO
          </button>
          <button
            type="button"
            aria-pressed={deal.contact === 'realtor'}
            onClick={() => handleInputChange('contact', 'realtor')}
          >
            Realtor Listed
          </button>
        </div>

        <div className="pbk-analyzer-segments" role="group" aria-label="Property type">
          <span>Type</span>
          <button
            type="button"
            aria-pressed={deal.type === 'house'}
            onClick={() => handleInputChange('type', 'house')}
          >
            House
          </button>
          <button
            type="button"
            aria-pressed={deal.type === 'land'}
            onClick={() => handleInputChange('type', 'land')}
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
              aria-label="List price in dollars"
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
              aria-label="Bedrooms"
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
              aria-label="Bathrooms"
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
                aria-label="Square footage"
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
                step="any"
                aria-label="Lot size in acres"
                value={deal.lotSize || ''}
                onChange={(e) => {
                  operatorFields.current.add('lotSize');
                  operatorFields.current.add('landLotSizeSqFt');
                  const lotSize = e.target.value;
                  const acres = Number(lotSize);
                  onDealChange({
                    lotSize,
                    landLotSizeSqFt: Number.isFinite(acres) && acres > 0 ? acres * 43560 : 0,
                  });
                }}
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
              aria-label="Year built"
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
              aria-label="Days on market"
              value={deal.dom || ''}
              onChange={(e) => handleInputChange('dom', parseFloat(e.target.value) || 0)}
              placeholder="0"
              className="w-full border-none outline-none bg-transparent text-[14px] font-semibold text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
        <PbkDataSource
          endpoint="Ava deal analysis"
          status="ships"
          note="live analysis with local underwriting formulas"
        />
      </section>

      {deal.type === 'house' && (
        <>
          <section
            aria-labelledby="analyzer-house-heading"
            className="pbk-analyzer-card pbk-analyzer-workbench-section"
          >
            <h2 id="analyzer-house-heading" className="pbk-analyzer-section-title mb-3">
              02 / House numbers
            </h2>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <label
                    htmlFor="deal-arv"
                    className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1"
                  >
                    ARV
                    <small className="block text-[10px] text-gray-400">
                      Auto from comps, editable when underwriting overrides it
                    </small>
                  </label>
                </div>
                <div className="relative w-32">
                  <input
                    id="deal-arv"
                    type="number"
                    value={arv || ''}
                    onChange={(e) => handleInputChange('arv', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-gray-500"
                  >
                    $
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <label
                    htmlFor="deal-rent"
                    className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1"
                  >
                    Monthly rent estimate
                    <small className="block text-[10px] text-gray-400">
                      Check Zillow rent estimate tab
                    </small>
                  </label>
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                  <input
                    id="deal-rent"
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
                  <label
                    htmlFor="deal-balance"
                    className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1"
                  >
                    Seller mortgage balance
                    <small className="block text-[10px] text-gray-400">
                      For sub-2 / creative finance
                    </small>
                  </label>
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                  <input
                    id="deal-balance"
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
                  <label
                    htmlFor="deal-rate"
                    className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1"
                  >
                    Seller interest rate
                    <small className="block text-[10px] text-gray-400">
                      If sub-2 or assumable target
                    </small>
                  </label>
                </div>
                <div className="relative w-32">
                  <input
                    id="deal-rate"
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
                  <label
                    htmlFor="deal-fee"
                    className="block text-[12px] text-gray-600 dark:text-gray-400 mb-1"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      Your assignment fee
                      <HelpTooltip text="Your wholesale fee - the difference between your contract price and what you assign it to your buyer for. Default $10,000; adjust based on deal margin." />
                    </span>
                  </label>
                </div>
                <div className="relative w-32">
                  <span className="absolute left-2 top-2 text-[12px] text-gray-500">$</span>
                  <input
                    id="deal-fee"
                    type="number"
                    value={deal.fee || ''}
                    onChange={(e) => handleInputChange('fee', parseFloat(e.target.value) || 0)}
                    placeholder="8000"
                    className="w-full h-9 pl-5 pr-3 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 transition-all"
                  />
                </div>
              </div>
            </div>
          </section>

          <RepairCalculator onRepairChange={(repairs) => handleInputChange('repairs', repairs)} />
        </>
      )}

      {deal.type === 'land' && <LandAnalysis deal={deal} onDealChange={onDealChange} />}

      <section
        aria-labelledby="analyzer-comps-heading"
        className="pbk-analyzer-card pbk-analyzer-workbench-section"
      >
        <h2 id="analyzer-comps-heading" className="pbk-analyzer-section-title mb-3">
          Comparable Sales (Mean = ARV)
        </h2>
        {deal.recordedSales?.review === 'suggested-unreviewed' && (
          <p role="status" className="pbk-property-evidence-note mb-3">
            ATTOM sale candidates · Not yet reviewed. Auto-filled comps and their mean ARV are
            provisional. Review property similarity and sale terms before making an offer.
            Select and save reviewed sales in this lead’s Property → Comps tab.
          </p>
        )}
        <div>
          {(['A', 'B', 'C'] as const).map((comp) => (
            <div
              key={comp}
              className="pbk-analyzer-comp-row"
              role="group"
              aria-label={`Comparable sale ${comp}`}
            >
              <span className="pbk-analyzer-comp-id" aria-hidden="true">
                {comp}
              </span>
              <label className="pbk-analyzer-comp-address">
                <span aria-hidden="true">Address</span>
                <input
                  type="text"
                  inputMode="text"
                  enterKeyHint="next"
                  autoComplete="street-address"
                  aria-label={`Comp ${comp} address`}
                  value={deal.comps[comp].address}
                  onChange={(e) => handleCompChange(comp, 'address', e.target.value)}
                  placeholder="123 Main St, City, MI"
                />
              </label>
              <label>
                <span aria-hidden="true">Sold price ($)</span>
                <input
                  type="number"
                  aria-label={`Comp ${comp} sold price`}
                  value={deal.comps[comp].price || ''}
                  onChange={(e) => handleCompChange(comp, 'price', parseFloat(e.target.value) || 0)}
                  placeholder="0"
                />
              </label>
              <label>
                <span aria-hidden="true">Sold date</span>
                <input
                  type="text"
                  aria-label={`Comp ${comp} sold date`}
                  value={deal.comps[comp].date}
                  onChange={(e) => handleCompChange(comp, 'date', e.target.value)}
                  placeholder="Jan 2025"
                />
              </label>
            </div>
          ))}
        </div>

        <div className="text-[10.5px] text-gray-500 dark:text-gray-400 mt-2">
          ARV = average of Comp A + B + C sold prices. Edit any comp to recalculate.
        </div>
      </section>

      {arv > 0 && (
        <div className="pbk-analyzer-card bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
              Key Numbers
            </h3>
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          onClick={handleAnalyzeCta}
          disabled={isAnalyzing}
          className="w-full px-4 py-3 rounded-full bg-gradient-to-r from-black to-gray-800 dark:from-slate-700 dark:to-slate-600 text-white text-[13px] font-semibold hover:opacity-90 transition-all shadow-md disabled:opacity-60 disabled:cursor-wait"
        >
          {isAnalyzing ? 'Analyzing…' : analyzeCtaLabel}
        </button>
        <button
          onClick={handleSendToAgent}
          disabled={isSending}
          className="w-full px-4 py-3 rounded-full border border-blue-200 bg-blue-50 text-[13px] font-semibold text-blue-700 transition-all hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300 disabled:opacity-60 disabled:cursor-wait"
        >
          {isSending ? 'Sending…' : 'Send to Agent'}
        </button>
      </div>
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
            onSelectPath={onSelectPath}
            onOpenCallMode={onOpenCallMode}
          />
          <UnderwritingControls deal={deal} onDealChange={onDealChange} />
        </>
      )}
    </div>
  );

  return (
    <div className="pbk-analyzer-main p-3.5">
      <div className="pbk-analyzer-context-switch" role="group" aria-label="Analyzer view">
        <button
          type="button"
          aria-pressed={view === 'valuation'}
          aria-controls="analyzer-valuation"
          onClick={(event) => switchView('valuation', event.currentTarget)}
        >
          <Calculator size={16} aria-hidden="true" /> Valuation
        </button>
        <button
          type="button"
          aria-pressed={view === 'context'}
          aria-controls="analyzer-deal-context"
          onClick={(event) => switchView('context', event.currentTarget)}
        >
          <PanelRight size={16} aria-hidden="true" /> Context
        </button>
      </div>
      <div className="pbk-analyzer-context-layout" data-view={view}>
        {valuation}
        <aside
          id="analyzer-deal-context"
          className="pbk-analyzer-context"
          aria-labelledby="analyzer-context-heading"
        >
          <h2 id="analyzer-context-heading">Deal context</h2>
          <AnalyzerListingPhotos
            key={address + ':' + currentPhotoResult?.status}
            result={currentPhotoResult}
          />
          <AnalyzerSellerHistory key={leadId} leadId={leadId} />
        </aside>
      </div>
    </div>
  );
}
