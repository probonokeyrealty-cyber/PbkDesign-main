import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';
import App from '../App';
import type { DealData, PBKPath } from '../types';
import {
  ANALYZER_CURRENT_DEAL_KEY,
  readAnalyzerDraftBaseline,
  readAnalyzerDraftManualFields,
  readAnalyzerStorage,
  writeAnalyzerSessionDeal,
  commitAnalyzerDraft,
  isFreshAnalyzerDraft,
} from '../utils/analyzerStorage';
import { isStaleDynamicImportError, reloadForCurrentDeploy } from '../utils/deployVersion';
import { fetchLeadFullRequest } from '../utils/runtimeBridge';
import { readPropertyEvidence } from '../utils/propertyEvidence';
import { samePropertyAddress } from '../utils/analyzerIntelligence.mjs';
import { savedLeadComps } from '../utils/leadComps.mjs';
import { latestCallModeNote } from '../utils/analyzerLeadPersistence.mjs';
import { readLeadEvidenceTarget } from '../utils/avaBrowserCommand.mjs';

type BridgeRecord = Record<string, unknown>;

function record(value: unknown): BridgeRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as BridgeRecord) : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function friendlyDealLoadError(error: unknown) {
  const message = firstText(error instanceof Error ? error.message : error);
  if (
    !message ||
    /\b(bridge|fetch|network|auth|token|unauthor|forbidden|timeout|502|500|404)\b/i.test(message)
  ) {
    return 'Ava could not reach the live seller record. Retry the load, or open the seller from Leads while Ava reconnects.';
  }
  return 'Ava could not load this seller into the analyzer yet. Retry the load, then use Leads if it repeats.';
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numericText = typeof value === 'string' ? value.replace(/[$,\s]/g, '') : '';
    const parsed = typeof value === 'number' ? value : numericText ? Number(numericText) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizePropertyType(value: unknown): DealData['type'] {
  return /\bland|lot|parcel|acre/i.test(firstText(value)) ? 'land' : 'house';
}

function normalizeContact(value: unknown): DealData['contact'] {
  return /\brealtor|agent|broker/i.test(firstText(value)) ? 'realtor' : 'owner';
}

function normalizePath(
  value: unknown,
  propertyType: DealData['type'],
  contact: DealData['contact']
): PBKPath {
  const path = firstText(value).toLowerCase();
  if (propertyType === 'land') {
    if (path.includes('rbp') || path.includes('retail')) return 'rbp-land';
    return contact === 'realtor' ? 'land-agent' : 'land-owner';
  }
  if (path.includes('creative') || path === 'cf' || path.includes('seller financ')) return 'cf';
  if (path.includes('mortgage') || path.includes('subject') || path === 'mt') return 'mt';
  if (path.includes('rbp') || path.includes('retail')) return 'rbp';
  return 'cash';
}

export function isMeaningfulAnalyzerValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value as BridgeRecord).some(isMeaningfulAnalyzerValue);
  }
  return false;
}

export function mergeMeaningfulAnalyzerValues(
  current: Partial<DealData>,
  incoming: Partial<DealData>
): Partial<DealData> {
  const merged = { ...current } as BridgeRecord;

  for (const [key, incomingValue] of Object.entries(incoming)) {
    if (!isMeaningfulAnalyzerValue(incomingValue)) continue;
    const currentValue = merged[key];
    if (
      incomingValue &&
      currentValue &&
      typeof incomingValue === 'object' &&
      typeof currentValue === 'object' &&
      !Array.isArray(incomingValue) &&
      !Array.isArray(currentValue)
    ) {
      merged[key] = mergeMeaningfulAnalyzerValues(
        currentValue as Partial<DealData>,
        incomingValue as Partial<DealData>
      );
    } else {
      merged[key] = incomingValue;
    }
  }

  return merged as Partial<DealData>;
}

export function buildAnalyzerDealFromLead(payload: BridgeRecord, requestedLeadId: string) {
  const root = record(payload);
  const lead = record(root.lead || root.profile || root);
  const seller = record(lead.seller);
  const property = record(lead.property);
  const motivation = record(lead.motivation);
  const analysis = record(lead.analysis);
  const callContext = {
    ...record(lead.call_context),
    ...record(lead.callContext),
    ...record(root.call_context),
    ...record(root.callContext),
  };
  const notes = record(lead.notes);
  const propertyTypeSource = firstText(
    lead.property_type,
    property.propertyType,
    property.type,
    callContext.propertyType
  );
  const selectedPathSource = firstText(
    lead.selected_path,
    lead.selectedPath,
    callContext.selected_path,
    callContext.selectedPath,
    callContext.path
  );
  const contactSource = firstText(
    seller.relationship,
    seller.relationshipToProperty,
    lead.relationship,
    callContext.contact
  );
  const propertyType =
    propertyTypeSource || /\bland|lot|parcel|acre/i.test(selectedPathSource)
      ? normalizePropertyType(propertyTypeSource || selectedPathSource)
      : undefined;
  const contact = contactSource ? normalizeContact(contactSource) : undefined;
  const repairEstimate = firstNumber(
    property.estimatedRepairs,
    property.repairs,
    callContext.repairs,
    callContext.estimatedRepairs,
    analysis.repairs,
    lead.estimatedRepairs,
    lead.repairs
  );
  const condition = firstText(property.condition, lead.condition, callContext.condition);
  const selectedPath =
    selectedPathSource || propertyType === 'land'
      ? normalizePath(selectedPathSource, propertyType || 'house', contact || 'owner')
      : undefined;
  const address = firstText(property.address, property.propertyAddress, lead.address);
  const city = firstText(property.city, lead.city);
  const state = firstText(property.state, lead.state);
  const zipCode = firstText(property.zip, property.zipCode, lead.zip, lead.zipCode);
  const fullAddress = address
    ? /[,].*\b[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i.test(address)
      ? address
      : [address, city, [state, zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : '';
  const arv = firstNumber(property.arv, callContext.arv, analysis.arv, lead.arv);
  const evidence = readPropertyEvidence(lead.deal, fullAddress || address);
  const savedFacts = evidence.records?.facts;
  const mao = firstNumber(
    property.mao,
    callContext.mao,
    callContext.maoCash,
    analysis.mao,
    lead.mao
  );
  const maoRBP = firstNumber(
    property.maoRbp,
    property.maoRBP,
    callContext.maoRbp,
    callContext.maoRBP,
    analysis.maoRbp,
    lead.maoRbp
  );
  const deal: Partial<DealData> = {
    leadId: firstText(lead.leadId, lead.id, requestedLeadId),
    address: fullAddress || address,
    type: propertyType,
    contact,
    selectedPath,
    sellerName: firstText(seller.name, lead.name, lead.leadName, lead.sellerName),
    sellerEmail: firstText(seller.email, lead.email),
    sellerPhone: firstText(seller.phone, seller.mobile, lead.phone),
    price: firstNumber(property.askingPrice, motivation.askingPrice, lead.askingPrice),
    agreedPrice: firstNumber(callContext.agreedPrice, callContext.lastOffer, lead.agreedPrice),
    beds: firstNumber(property.beds, lead.beds, savedFacts?.beds),
    baths: firstNumber(property.baths, lead.baths, savedFacts?.baths),
    sqft: firstNumber(property.sqft, property.squareFeet, lead.sqft, savedFacts?.livingSqft),
    year: firstNumber(property.yearBuilt, property.year, lead.yearBuilt, savedFacts?.yearBuilt),
    ...(propertyType === 'land' && savedFacts
      ? {
          landLotSizeSqFt: savedFacts.lotSqft ?? undefined,
          lotSize: savedFacts.lotAcres == null ? undefined : String(savedFacts.lotAcres),
        }
      : {}),
    arv,
    mao60: mao,
    maoRBP,
    offer: firstNumber(callContext.offer, callContext.lastOffer, lead.offer, mao),
    rent: firstNumber(property.rent, callContext.rent, lead.rent),
    balance: firstNumber(
      property.mortgageBalance,
      callContext.mortgageBalance,
      lead.mortgageBalance
    ),
    rate: firstNumber(property.mortgageRate, callContext.mortgageRate, lead.mortgageRate),
    zipCode,
    timeline: firstText(motivation.timeline, callContext.timeline, lead.timeline),
    notes: firstText(
      latestCallModeNote(payload, firstText(lead.leadId, lead.id, requestedLeadId)),
      record(lead.deal).notes,
      callContext.summary,
      callContext.callSummary,
      seller.notes,
      notes.seller,
      notes.internal,
      typeof lead.notes === 'string' ? lead.notes : ''
    ),
    vacantStatus: firstText(property.occupancy, lead.occupancy),
    isAnalyzed:
      record(lead.deal).isAnalyzed === false
        ? false
        : arv !== undefined || mao !== undefined || maoRBP !== undefined
          ? true
          : undefined,
  };
  if (evidence.records) deal.propertyRecordSnapshot = evidence.records;
  if (evidence.listing) deal.listingSnapshot = evidence.listing;
  const savedSales = record(record(lead.analyzer).recordedSales || record(lead.deal).recordedSales);
  if (samePropertyAddress(savedSales.address, deal.address))
    deal.recordedSales = savedSales as DealData['recordedSales'];
  const manualSlots = record(lead.deal).compManualSlots;
  if (Array.isArray(manualSlots))
    deal.compManualSlots = manualSlots.filter((slot): slot is 'A' | 'B' | 'C' =>
      ['A', 'B', 'C'].includes(slot)
    );
  const comps = savedLeadComps(lead);
  if (comps) deal.comps = comps;
  else if (record(record(lead.analyzer).recordedSales).address) {
    deal.comps = Object.fromEntries(
      ['A', 'B', 'C'].map((key) => [key, { address: '', price: 0, date: '', link: '' }])
    ) as DealData['comps'];
    deal.isAnalyzed = false;
  }

  if (repairEstimate !== undefined || condition) {
    deal.repairs = {
      ...(repairEstimate !== undefined
        ? {
            low: repairEstimate,
            mid: repairEstimate,
            high: repairEstimate,
          }
        : {}),
      ...(condition ? { condition } : {}),
    } as DealData['repairs'];
  }

  return deal;
}

function hasDealLeadPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const root = record(payload);
  const lead = record(root.lead || root.profile || root);
  const property = record(lead.property || root.property);
  const address = firstText(
    lead.address,
    lead.propertyAddress,
    lead.property_address,
    property.address,
    property.fullAddress,
    property.full_address
  );
  const seller = firstText(
    lead.sellerName,
    lead.seller_name,
    lead.ownerName,
    lead.owner_name,
    record(lead.seller).name,
    record(root.seller).name
  );
  return Boolean(
    firstText(lead.id, lead.leadId, lead.lead_id, root.id, root.leadId, root.lead_id) ||
    address ||
    seller
  );
}

async function hydrateAnalyzerFromLead(
  payload: BridgeRecord,
  leadId: string,
  isCurrent = () => true
) {
  const mappedDeal = buildAnalyzerDealFromLead(payload, leadId);
  const fresh = isFreshAnalyzerDraft();
  const currentDeal =
    (!fresh && window.PBKAnalyzer?.getState().deal) ||
    readAnalyzerStorage<Partial<DealData>>(ANALYZER_CURRENT_DEAL_KEY, {});
  const currentLeadId = firstText(
    (currentDeal as BridgeRecord).leadId,
    (currentDeal as BridgeRecord).lead_id
  );
  const samePropertyDraft =
    currentLeadId === leadId &&
    (!currentDeal.address ||
      !mappedDeal.address ||
      samePropertyAddress(currentDeal.address, mappedDeal.address));
  const mergedDeal = samePropertyDraft
    ? mergeMeaningfulAnalyzerValues(currentDeal, mappedDeal)
    : mergeMeaningfulAnalyzerValues({}, mappedDeal);
  const replaceSuggestions =
    mappedDeal.recordedSales?.review === 'operator-selected' &&
    currentDeal.recordedSales?.review === 'suggested-unreviewed' &&
    currentDeal.compManualSlots?.length === 0;
  const manualFields = samePropertyDraft
    ? (readAnalyzerDraftManualFields() ?? Object.keys(currentDeal)).filter(
        (field) => !replaceSuggestions || field !== 'comps'
      )
    : [];
  for (const key of manualFields) {
    if (Object.prototype.hasOwnProperty.call(currentDeal, key)) {
      (mergedDeal as BridgeRecord)[key] = (currentDeal as BridgeRecord)[key];
    }
  }
  // Reviewed comp selections replace the whole set, including intentionally emptied slots.
  if (mappedDeal.comps && !manualFields.includes('comps')) mergedDeal.comps = mappedDeal.comps;
  if (mappedDeal.propertyRecordSnapshot)
    mergedDeal.propertyRecordSnapshot = mappedDeal.propertyRecordSnapshot;
  if (mappedDeal.listingSnapshot) mergedDeal.listingSnapshot = mappedDeal.listingSnapshot;
  if (mappedDeal.recordedSales) mergedDeal.recordedSales = mappedDeal.recordedSales;
  if (mappedDeal.isAnalyzed === false) mergedDeal.isAnalyzed = false;
  const baseline = readAnalyzerDraftBaseline();
  const publish = currentLeadId !== leadId && baseline !== undefined;

  if (!fresh && window.PBKAnalyzer?.setState) {
    window.PBKAnalyzer.setState({
      deal: mergedDeal,
      activeTab: 'analyzer',
      analyzeStatus: 'Seller record loaded into Deal Analyzer',
      updatedAt: Date.now(),
      manualFields,
      persistDraft: publish,
    });
  } else {
    if (publish) {
      try {
        const result = await commitAnalyzerDraft(
          mergedDeal as DealData,
          manualFields,
          baseline,
          false,
          isCurrent
        );
        if (result === 'conflict' && isCurrent())
          writeAnalyzerSessionDeal(mergedDeal, manualFields, undefined, true);
      } catch {
        if (isCurrent()) writeAnalyzerSessionDeal(mergedDeal, manualFields, baseline, true);
      }
    } else if (isCurrent())
      writeAnalyzerSessionDeal(mergedDeal, manualFields, baseline, baseline === undefined);
  }
}

type DealViewErrorBoundaryState = {
  error: Error | null;
};

class DealViewErrorBoundary extends Component<{ children: ReactNode }, DealViewErrorBoundaryState> {
  state: DealViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DealViewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[PBK DealView] engine render failed', error);
    if (isStaleDynamicImportError(error)) {
      reloadForCurrentDeploy('deal-view-chunk-error');
    }
  }

  render() {
    if (this.state.error) {
      const staleChunk = isStaleDynamicImportError(this.state.error);
      return (
        <div className="grid h-full place-items-center bg-slate-950 p-6 text-slate-100">
          <div className="max-w-md rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
              Deal Analyzer paused
            </div>
            <h2 className="mt-2 text-lg font-semibold">
              {staleChunk
                ? 'Loading the latest analyzer...'
                : 'Ava could not open the analyzer view.'}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {staleChunk
                ? 'A deploy finished while this page was open. Reload the analyzer to use the current app files.'
                : 'Your leads, approvals, and campaign boards are still available. Retry the analyzer; if it repeats, use the Leads page while the error is reviewed.'}
            </p>
            <button
              type="button"
              className="mt-4 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950"
              onClick={() => {
                if (staleChunk) {
                  window.location.reload();
                  return;
                }
                this.setState({ error: null });
              }}
            >
              {staleChunk ? 'Reload analyzer' : 'Retry'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function DealView() {
  const location = useLocation();
  return <DealViewContent key={location.pathname + location.search} />;
}

function DealViewContent() {
  const { id: leadId = '' } = useParams();
  const location = useLocation();
  const entry = location.state?.leadAnalyzerOrigin;
  const origin = entry?.leadId === leadId ? entry : null;
  const backToLead = leadId ? (
    <Link
      className="pbk-btn pbk-btn-ghost pbk-btn-sm min-h-11"
      to={{
        pathname: `/leads/${encodeURIComponent(leadId)}`,
        search:
          typeof origin?.search === 'string' && origin.search.startsWith('?') ? origin.search : '',
        hash: readLeadEvidenceTarget(location.hash) ? location.hash : '',
      }}
      state={origin ? { leadReturn: origin.leadReturn, fleetReturn: origin.fleetReturn } : null}
      replace
    >
      <ArrowLeft size={16} aria-hidden="true" />
      Back to lead
    </Link>
  ) : null;
  const draftIdentity = location.pathname + location.search;
  const [loading, setLoading] = useState(Boolean(leadId));
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const requestVersion = useRef(0);
  const currentIdentity = useRef(draftIdentity);
  currentIdentity.current = draftIdentity;

  const loadLead = useCallback(async () => {
    if (!leadId) return;
    const version = ++requestVersion.current;
    const isCurrent = () =>
      currentIdentity.current === draftIdentity && requestVersion.current === version;
    setLoading(true);
    setError('');
    try {
      const response = await fetchLeadFullRequest(leadId);
      if (!isCurrent()) return;
      if (response.ok === false || !hasDealLeadPayload(response)) {
        throw new Error(
          firstText(response.error, response.message, response.verbiage) ||
            'The live seller record is not ready yet.'
        );
      }
      const returnedLead = record(response.lead || response.profile || response);
      if (firstText(returnedLead.leadId, returnedLead.id) !== leadId) {
        throw new Error('The returned seller record did not match the requested lead.');
      }
      await hydrateAnalyzerFromLead(response, leadId, isCurrent);
      if (!isCurrent()) return;
      setLoadedIdentity(draftIdentity);
    } catch (nextError) {
      if (isCurrent()) setError(friendlyDealLoadError(nextError));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [leadId, draftIdentity]);

  useEffect(() => {
    if (!leadId) {
      setLoading(false);
      setError('');
      return;
    }
    void loadLead();
    const version = requestVersion.current;
    return () => {
      requestVersion.current = version + 1;
    };
  }, [leadId, loadLead, retryToken]);

  if (!leadId) {
    return (
      <div className="h-full min-h-[680px]">
        <DealViewErrorBoundary key={draftIdentity}>
          <App engineOnly key={draftIdentity} />
        </DealViewErrorBoundary>
      </div>
    );
  }

  if ((loading || loadedIdentity !== draftIdentity) && !error) {
    return (
      <div className="grid h-full min-h-[680px] place-items-center bg-slate-950 p-6 text-slate-100">
        <div role="status" className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          <h2 className="mt-4 text-lg font-semibold">Loading seller deal</h2>
          <p className="mt-1 text-sm text-slate-400">
            Pulling seller details and underwriting context into the analyzer.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-full min-h-[680px] place-items-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded-lg border border-rose-500/30 bg-rose-500/10 p-5">
          <div className="text-[11px] uppercase tracking-[0.16em] text-rose-300">
            Seller record unavailable
          </div>
          <h2 className="mt-2 text-lg font-semibold">
            Ava could not load this seller into Deal Analyzer
          </h2>
          <p className="mt-2 text-sm text-slate-300">{error}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950"
            onClick={() => setRetryToken((current) => current + 1)}
          >
            Retry lead load
          </button>
          <div className="mt-3">{backToLead}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-[680px]">
      <DealViewErrorBoundary key={draftIdentity}>
        <App engineOnly key={draftIdentity} backToLead={backToLead} />
      </DealViewErrorBoundary>
    </div>
  );
}
