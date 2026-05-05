import { useState, useEffect, useMemo } from 'react';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { AnalyzerTab } from './components/AnalyzerTab';
import { CallModeTab } from './components/CallModeTab';
import { PathDeliverables } from './components/PathDeliverables';
import { CRMFeatures } from './components/CRMFeatures';
import { DealData, QuickDocumentType } from './types';
import { calculateARV, calculateLandOffer, calculateMAO, calculateVerdict } from './utils/dealCalculations';
import {
  DEFAULT_BRANDING,
  PBKBranding,
  buildDocumentSet,
  buildMasterPackageParams,
  getDefaultSelectedPath,
  getAnalyzeReadiness,
  getPathLabel,
  getPdfReadiness,
  normalizeSelectedPath,
  openMasterPackageWindow,
} from './utils/pbk';
import { sendDealToAgent, sendSellerDocsRequest, syncDealAnalysis } from './utils/runtimeBridge';
import { appendSavedDealActivity, upsertSavedDeal } from './utils/dealStorage';

const ANALYSIS_IMPACT_FIELDS: Array<keyof DealData> = [
  'address',
  'type',
  'contact',
  'price',
  'beds',
  'baths',
  'sqft',
  'year',
  'dom',
  'rent',
  'balance',
  'rate',
  'fee',
  'builderPrice',
  'lotSize',
  'landInputMode',
  'landPriceSqFt',
  'landLotSizeSqFt',
  'comps',
  'repairs',
];

type AppTab = 'analyzer' | 'callmode' | 'documents' | 'crm';

const initialDealData: DealData = {
  address: '',
  type: 'house',
  contact: 'owner',
  price: 0,
  agreedPrice: 0,
  beds: 0,
  baths: 0,
  sqft: 0,
  year: 0,
  dom: 0,
  selectedPath: 'cash',
  isAnalyzed: false,
  arv: 0,
  rent: 0,
  balance: 0,
  rate: 0,
  fee: 8000,
  repairs: {
    low: 0,
    mid: 0,
    high: 0,
    condition: '',
  },
  builderPrice: 30000,
  lotSize: '0.25',
  builderTotal: 0,
  offer: 0,
  zipCode: '',
  comps: {
    A: { address: '', price: 0, date: '', link: '' },
    B: { address: '', price: 0, date: '', link: '' },
    C: { address: '', price: 0, date: '', link: '' },
  },
  mao60: 0,
  maoRBP: 0,
  verdict: 'none',
  underwriting: {
    maoCashPct: 60,
    maoRbpPct: 88,
    maoRepairPct: 65,
    targetCocPct: 20,
    assignFeePct: 30,
  },
  sellerName: '',
  sellerEmail: '',
  sellerPhone: '',
  sellerPhoneVerified: false,
  motivationScore: 3,
  motivationLevel: 'Interested',
  timeline: '14-21 days',
  earnestDeposit: 'Delivered within 3 business days',
  confirmedTerms: {},
  cfDownPayment: 0,
  cfRate: 5,
  cfTerm: 30,
  cfMonthlyPayment: 0,
  cfType: 'carry',
  mtUpfront: 0,
  mtBalanceConfirm: 0,
  mtRateConfirm: 0,
  mtType: 'subto',
  rbpPriceConfirm: 0,
  rbpBuyerType: '',
  rbpSellerCosts: '',
  rbpCashAlternative: 0,
  cashAsIs: 'yes',
  cashClosePeriod: '21',
  landLotSizeConfirm: '',
  landBuyerType: '',
  landSellerCosts: '',
  landInputMode: 'quarter-acre',
  landPriceSqFt: 0,
  landLotSizeSqFt: 0,
  notes: '',
  reductions: 0,
  vacantStatus: '',
  investorCashFlow: 0,
  investorCOC: 0,
  investorROI: 0,
  investorIRR: 0,
};

const BRANDING_STORAGE_KEY = 'pbk-branding';

export default function App() {
  const [deal, setDeal] = useState<DealData>(initialDealData);
  const [activeTab, setActiveTab] = useState<AppTab>('analyzer');
  const [activeDocument, setActiveDocument] = useState<QuickDocumentType>('report');
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [branding, setBranding] = useState<PBKBranding>(DEFAULT_BRANDING);
  const [exportStatus, setExportStatus] = useState('Select a path and complete seller info to generate.');
  const [analyzeStatus, setAnalyzeStatus] = useState('');
  const [documentDeliveryStatus, setDocumentDeliveryStatus] = useState('Choose the documents you want to email from the PBK business sender.');
  const activeSelectedPath = normalizeSelectedPath(deal);
  const activeDeal = useMemo(
    () => ({
      ...deal,
      selectedPath: activeSelectedPath,
    }),
    [deal, activeSelectedPath],
  );
  const generatedDocuments = useMemo(
    () => buildDocumentSet(activeDeal, branding),
    [activeDeal, branding],
  );

  const buildMergedDealState = (base: DealData, incoming: Partial<DealData> = {}): DealData => {
    const next: DealData = {
      ...base,
      ...incoming,
      repairs:
        incoming.repairs && typeof incoming.repairs === 'object'
          ? {
              ...base.repairs,
              ...incoming.repairs,
            }
          : base.repairs,
      underwriting:
        incoming.underwriting && typeof incoming.underwriting === 'object'
          ? {
              ...base.underwriting,
              ...incoming.underwriting,
            }
          : base.underwriting,
      confirmedTerms:
        incoming.confirmedTerms && typeof incoming.confirmedTerms === 'object'
          ? {
              ...base.confirmedTerms,
              ...incoming.confirmedTerms,
            }
          : base.confirmedTerms,
      comps: incoming.comps
        ? {
            A: {
              ...base.comps.A,
              ...(incoming.comps.A || {}),
            },
            B: {
              ...base.comps.B,
              ...(incoming.comps.B || {}),
            },
            C: {
              ...base.comps.C,
              ...(incoming.comps.C || {}),
            },
          }
        : base.comps,
    };

    next.selectedPath = normalizeSelectedPath({
      type: next.type,
      contact: next.contact,
      selectedPath: next.selectedPath,
    });

    return next;
  };

  const mergeExternalDeal = (incoming: Partial<DealData>) => {
    setDeal((prev) => buildMergedDealState(prev, incoming));
  };

  const isEditingAnalyzerField = () => {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    const tagName = activeElement.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  };

  const applyBridgeState = (payload: {
    deal?: Partial<DealData>;
    activeTab?: AppTab | string;
  }) => {
    if (!payload || typeof payload !== 'object') return;
    const isEditing = isEditingAnalyzerField();

    if (payload.deal && !isEditing) {
      mergeExternalDeal(payload.deal);
    }

    if (
      !isEditing &&
      payload.activeTab &&
      ['analyzer', 'callmode', 'documents', 'crm'].includes(payload.activeTab)
    ) {
      setActiveTab(payload.activeTab as AppTab);
    }
  };

  // Load saved data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('pbk-deal-data');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const mergedDeal: DealData = {
          ...initialDealData,
          ...parsed,
        };

        mergedDeal.selectedPath = normalizeSelectedPath({
          type: mergedDeal.type,
          contact: mergedDeal.contact,
          selectedPath: mergedDeal.selectedPath,
        });

        setDeal(mergedDeal);
      } catch (e) {
        console.error('Failed to load saved data', e);
      }
    }

    // Check for dark mode preference
    const savedDarkMode = localStorage.getItem('pbk-dark-mode');
    if (savedDarkMode === 'true') {
      setDarkMode(true);
    }

    const savedBranding = localStorage.getItem(BRANDING_STORAGE_KEY);
    if (savedBranding) {
      try {
        setBranding({
          ...DEFAULT_BRANDING,
          ...JSON.parse(savedBranding),
        });
      } catch (e) {
        console.error('Failed to load branding', e);
      }
    }
  }, []);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('pbk-deal-data', JSON.stringify(activeDeal));
  }, [activeDeal]);

  useEffect(() => {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(branding));
  }, [branding]);

  useEffect(() => {
    const origin = window.location.origin;
    const handleMessage = (
      event: MessageEvent<{
        type?: string;
        payload?: {
          deal?: Partial<DealData>;
          activeTab?: AppTab | string;
        };
      }>,
    ) => {
      if (event.origin !== origin || !event.data || typeof event.data !== 'object') {
        return;
      }

      const { type, payload } = event.data;
      if (type === 'pbk:analyzer:set-state') {
        applyBridgeState(payload || {});
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'pbk-deal-data' || !event.newValue) return;

      try {
        applyBridgeState({
          deal: JSON.parse(event.newValue),
        });
      } catch (error) {
        console.error('Failed to hydrate analyzer bridge state', error);
      }
    };

    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'pbk:analyzer:ready',
          payload: {
            activeTab,
          },
        },
        origin,
      );
    }

    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Apply dark mode class to body
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('pbk-dark-mode', darkMode.toString());
  }, [darkMode]);

  useEffect(() => {
    setDeal((prev) => {
      const selectedPath = normalizeSelectedPath({
        type: prev.type,
        contact: prev.contact,
        selectedPath: prev.selectedPath,
      });

      if (prev.selectedPath === selectedPath) {
        return prev;
      }

      return {
        ...prev,
        selectedPath,
      };
    });
  }, [deal.type, deal.contact]);

  // Calculate verdict based on deal data
  // FORMULAS LOCKED - Using centralized calculations that match original HTML
  useEffect(() => {
    // Calculate ARV from comps using centralized function
    const arv = calculateARV(deal.comps);

    // Calculate MAO values using corrected formulas
    const mao60 = calculateMAO.wholesale(
      arv,
      deal.fee || 8000,
      deal.underwriting?.maoCashPct || 60,
    );
    const maoRBP = calculateMAO.rbp(arv, deal.underwriting?.maoRbpPct || 88);

    // Determine verdict using centralized function
    const newVerdict = calculateVerdict(deal.price, arv, maoRBP);

    // Only update if values changed to avoid infinite loops
    if (
      deal.arv !== arv ||
      deal.mao60 !== mao60 ||
      deal.maoRBP !== maoRBP ||
      deal.verdict !== newVerdict
    ) {
      setDeal((prev) => ({
        ...prev,
        arv,
        mao60,
        maoRBP,
        verdict: newVerdict,
      }));
    }
  }, [
    deal.price,
    deal.comps.A.price,
    deal.comps.B.price,
    deal.comps.C.price,
    deal.fee,
    deal.underwriting?.maoCashPct,
    deal.underwriting?.maoRbpPct,
  ]);

  useEffect(() => {
    if (deal.type !== 'land') return;

    const acres = parseFloat(deal.lotSize) || 0;
    const builderTotal = acres > 0 ? Math.round((acres / 0.25) * deal.builderPrice) : 0;
    const autoOffer = builderTotal > 0 ? calculateLandOffer(builderTotal).offer : 0;

    if (deal.builderTotal !== builderTotal || (!deal.offer && autoOffer > 0)) {
      setDeal((prev) => ({
        ...prev,
        builderTotal,
        offer: prev.offer || autoOffer,
      }));
    }
  }, [deal.type, deal.lotSize, deal.builderPrice, deal.builderTotal, deal.offer]);

  const handleDealChange = (updates: Partial<DealData>) => {
    const shouldResetAnalysis = Object.keys(updates).some((key) =>
      ANALYSIS_IMPACT_FIELDS.includes(key as keyof DealData),
    );

    if (shouldResetAnalysis) {
      setAnalyzeStatus('');
    }

    setDeal((prev) => {
      const next = {
        ...prev,
        ...updates,
      };

      if (shouldResetAnalysis) {
        next.isAnalyzed = false;
      }

      next.selectedPath = normalizeSelectedPath({
        type: next.type,
        contact: next.contact,
        selectedPath: next.selectedPath,
      });

      return next;
    });
  };

  const handleAnalyzeDeal = async () => {
    const readiness = getAnalyzeReadiness(deal);

    if (!readiness.ready) {
      setAnalyzeStatus(readiness.message);
      setActiveTab('analyzer');
      return;
    }

    try {
      const response = await syncDealAnalysis(deal);
      const result = (response as { result?: Record<string, unknown> }).result || (response as Record<string, unknown>);
      setDeal((prev) => ({
        ...prev,
        isAnalyzed: true,
        arv: Number(result?.arv || prev.arv || 0),
        mao60: Number(result?.mao || prev.mao60 || 0),
        maoRBP: Number(result?.mao || prev.maoRBP || 0),
        offer: Number(result?.targetOffer || prev.offer || 0),
        repairs: {
          ...prev.repairs,
          mid: Number(result?.repairsMid || prev.repairs.mid || 0),
        },
      }));
      setAnalyzeStatus(
        result?.mao
          ? `Bridge analysis synced. ARV ${Number(result.arv || 0).toLocaleString()} · MAO ${Number(result.mao || 0).toLocaleString()}`
          : readiness.successMessage,
      );
    } catch (error) {
      setDeal((prev) => ({
        ...prev,
        isAnalyzed: true,
      }));
      setAnalyzeStatus(
        error instanceof Error
          ? `Runtime sync failed, but the local analyzer is still ready: ${error.message}`
          : readiness.successMessage,
      );
    }

    setAnalyzeStatus((prev) =>
      prev ? `${prev} Call Mode is ready when you choose a path.` : 'Analysis ready. Choose a path or open Call Mode when ready.',
    );
  };

  const handleSendToAgent = async () => {
    if (!activeDeal.address.trim()) {
      setAnalyzeStatus('Enter a property address before sending this deal to Ava.');
      setActiveTab('analyzer');
      return;
    }

    try {
      await sendDealToAgent(activeDeal);
      setAnalyzeStatus('Analyzer snapshot sent to Ava and the runtime CRM queue.');
    } catch (error) {
      setAnalyzeStatus(
        error instanceof Error ? `Could not send this deal to Ava: ${error.message}` : 'Could not send this deal to Ava.',
      );
    }
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all deal data? This cannot be undone.')) {
      setDeal(initialDealData);
      localStorage.removeItem('pbk-deal-data');
    }
  };

  const handleClearAnalyzer = () => {
    if (confirm('Clear the current analyzer deal? CRM saved deals and notes will stay intact.')) {
      setDeal(initialDealData);
      localStorage.removeItem('pbk-deal-data');
      setAnalyzeStatus('Analyzer cleared. Start a new deal when ready.');
      setActiveTab('analyzer');
    }
  };

  const handleSaveDeal = async () => {
    try {
      const saved = upsertSavedDeal(activeDeal);
      localStorage.setItem('pbk-deal-data', JSON.stringify(activeDeal));
      window.dispatchEvent(new CustomEvent('pbk:deal-saved', { detail: saved }));
      appendSavedDealActivity(activeDeal, {
        type: 'note',
        content: `Analyzer deal saved with path ${getPathLabel(activeSelectedPath)}.`,
      });
      setAnalyzeStatus(`${saved.address}: Saved locally · Bridge sync pending.`);
      try {
        await sendDealToAgent(activeDeal);
        appendSavedDealActivity(activeDeal, {
          type: 'note',
          content: `Activity saved to team CRM for ${getPathLabel(activeSelectedPath)}.`,
        });
        setAnalyzeStatus(`${saved.address}: Saved locally · runtime CRM synced for ${getPathLabel(activeSelectedPath)}.`);
      } catch (syncError) {
        setAnalyzeStatus(
          syncError instanceof Error
            ? `${saved.address}: Saved locally · Bridge sync pending: ${syncError.message}`
            : `${saved.address}: Saved locally · Bridge sync pending.`,
        );
      }
    } catch (error) {
      setAnalyzeStatus(error instanceof Error ? error.message : 'Could not save this deal.');
      setActiveTab('analyzer');
    }
  };

  const handleLoadSavedDeal = (savedDeal: DealData) => {
    const merged = buildMergedDealState(initialDealData, savedDeal);
    setDeal(merged);
    localStorage.setItem('pbk-deal-data', JSON.stringify(merged));
    setAnalyzeStatus(`${merged.address || 'Saved deal'} loaded into the analyzer.`);
    setActiveTab('analyzer');
  };

  const setSelectedPath = (selectedPath: DealData['selectedPath']) => {
    handleDealChange({
      selectedPath: selectedPath || getDefaultSelectedPath(deal),
    });
  };

  const handleOpenCallModeForPath = (path: DealData['selectedPath']) => {
    setSelectedPath(path);
    setActiveTab('callmode');
    setRightPanelOpen(false);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleOpenDocuments = (documentType: QuickDocumentType = 'report') => {
    setActiveTab('documents');
    setActiveDocument(documentType);
    setRightPanelOpen(true);
  };

  const handlePreview = () => {
    const popup = openMasterPackageWindow(activeDeal, branding, false);
    if (!popup) {
      setExportStatus('Preview was blocked. Allow popups and try again.');
    } else {
      appendSavedDealActivity(activeDeal, {
        type: 'pdf',
        content: `Previewed Master Deal PDF for ${getPathLabel(activeSelectedPath)}.`,
      });
      setExportStatus(`Preview opened in a new tab for ${getPathLabel(activeSelectedPath)}.`);
    }
  };

  const handlePrintPackage = () => {
    const readiness = getPdfReadiness(activeDeal);
    if (!readiness.ready) {
      setExportStatus(readiness.message);
      setActiveTab('documents');
      return;
    }

    const popup = openMasterPackageWindow(activeDeal, branding, true);
    if (!popup) {
      setExportStatus('Print preview was blocked. Allow popups and try again.');
    } else {
      appendSavedDealActivity(activeDeal, {
        type: 'pdf',
        content: `Opened print-ready Master Deal PDF for ${getPathLabel(activeSelectedPath)}.`,
      });
      setExportStatus(`Print-ready package opened in a new tab for ${getPathLabel(activeSelectedPath)}.`);
    }
  };

  const handleGeneratePackage = () => {
    const readiness = getPdfReadiness(activeDeal);
    if (!readiness.ready) {
      setExportStatus(readiness.message);
      setActiveTab('documents');
      return;
    }

    const popup = openMasterPackageWindow(activeDeal, branding, true);
    if (!popup) {
      setExportStatus('Master PDF was blocked. Allow popups and try again.');
    } else {
      appendSavedDealActivity(activeDeal, {
        type: 'pdf',
        content: `Generated Master Deal PDF for ${getPathLabel(activeSelectedPath)}.`,
      });
      setExportStatus(`PDF ready for ${getPathLabel(activeSelectedPath)}.`);
    }
  };

  const handleEmailDocuments = async ({
    selectedDocuments,
    senderProfile,
  }: {
    selectedDocuments: QuickDocumentType[];
    senderProfile: 'warm' | 'cold';
  }) => {
    try {
      const response = await sendSellerDocsRequest({
        leadId: activeDeal.address || undefined,
        leadName: activeDeal.sellerName || undefined,
        address: activeDeal.address,
        email: activeDeal.sellerEmail,
        senderProfile,
        selectedDocuments,
        documentSet: generatedDocuments,
        selectedPath: activeSelectedPath,
        selectedPathLabel: getPathLabel(activeSelectedPath),
      });
      const delivery = response?.delivery as { status?: string } | undefined;
      const deliveryStatus = String(delivery?.status || response?.result || '').toLowerCase();
      const deliveryLabel =
        deliveryStatus === 'sent'
          ? 'Sent'
          : deliveryStatus === 'provider_missing'
            ? 'Provider key missing'
            : deliveryStatus === 'queued_for_approval'
              ? 'Queued for approval'
              : 'Queued to send';
      appendSavedDealActivity(activeDeal, {
        type: 'email',
        content: `Seller documents: ${deliveryLabel} via ${senderProfile} sender for ${getPathLabel(activeSelectedPath)}: ${selectedDocuments.join(', ')}.`,
      });
      setDocumentDeliveryStatus(
        deliveryStatus === 'sent'
          ? `Seller package emailed from the ${senderProfile} sender profile for ${getPathLabel(activeSelectedPath)}.`
          : deliveryStatus === 'provider_missing'
            ? `Provider key missing. Seller package was not sent for ${getPathLabel(activeSelectedPath)}.`
            : `Queued for approval with the ${senderProfile} sender profile for ${getPathLabel(activeSelectedPath)}.`,
      );
    } catch (error) {
      setDocumentDeliveryStatus(
        error instanceof Error ? `Delivery failed: ${error.message}` : 'Delivery failed.',
      );
    }
  };

  const handlePdfPanelAction = (action: 'refresh' | 'download' | 'open') => {
    const labels: Record<'refresh' | 'download' | 'open', string> = {
      refresh: 'Manually refreshed Master PDF preview',
      download: 'Downloaded Master PDF',
      open: 'Opened Master PDF',
    };
    appendSavedDealActivity(activeDeal, {
      type: 'pdf',
      content: `${labels[action]} for ${getPathLabel(activeSelectedPath)}.`,
    });
  };

  const closeDrawers = () => {
    setLeftPanelOpen(false);
    setRightPanelOpen(false);
  };

  useEffect(() => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'pbk:analyzer:state',
          payload: {
            deal: activeDeal,
            activeTab,
            analyzeStatus,
            updatedAt: Date.now(),
          },
        },
        window.location.origin,
      );
    }
  }, [activeDeal, activeTab, analyzeStatus]);

  useEffect(() => {
    const hostPBK = (() => {
      try {
        if (window.parent && window.parent !== window) {
          return (window.parent as typeof window & { PBK?: unknown }).PBK;
        }

        if (window.opener) {
          return (window.opener as typeof window & { PBK?: unknown }).PBK;
        }
      } catch (error) {
        console.warn('PBK host bridge unavailable', error);
      }

      return undefined;
    })() as
      | {
          openclaw?: {
            invoke?: (toolName: string, params?: unknown) => Promise<unknown>;
          };
        }
      | undefined;

    (window as typeof window & {
      PBKAnalyzer?: unknown;
      PBK?: Record<string, unknown>;
    }).PBKAnalyzer = {
      getState: () => ({
        deal: activeDeal,
        activeTab,
        analyzeStatus,
      }),
      getBranding: () => branding,
      getSelectedPath: () => activeSelectedPath,
      getPdfReadiness: (incomingDeal?: Partial<DealData>) =>
        getPdfReadiness(buildMergedDealState(activeDeal, incomingDeal || {})),
      getDocumentSet: (
        incomingDeal?: Partial<DealData>,
        incomingBranding?: Partial<PBKBranding>,
      ) =>
        buildDocumentSet(
          buildMergedDealState(activeDeal, incomingDeal || {}),
          {
            ...branding,
            ...(incomingBranding || {}),
          },
        ),
      buildMasterPackageQuery: ({
        deal: incomingDeal,
        branding: incomingBranding,
        printMode = false,
      }: {
        deal?: Partial<DealData>;
        branding?: Partial<PBKBranding>;
        printMode?: boolean;
      } = {}) =>
        buildMasterPackageParams(
          buildMergedDealState(activeDeal, incomingDeal || {}),
          {
            ...branding,
            ...(incomingBranding || {}),
          },
          Boolean(printMode),
        ),
      setState: applyBridgeState,
      setActiveTab: (nextTab: AppTab) => setActiveTab(nextTab),
      analyze: handleAnalyzeDeal,
    };

    (window as typeof window & {
      PBK?: Record<string, unknown>;
    }).PBK = {
      ...((window as typeof window & { PBK?: Record<string, unknown> }).PBK || {}),
      openclaw: {
        invoke: (toolName: string, params?: unknown) => {
          if (hostPBK?.openclaw?.invoke) {
            return hostPBK.openclaw.invoke(toolName, params);
          }

          return Promise.reject(
            new Error('OpenClaw bridge is not available in this analyzer context yet.'),
          );
        },
      },
    };

    return () => {
      delete (window as typeof window & { PBKAnalyzer?: unknown }).PBKAnalyzer;
    };
  }, [activeDeal, activeSelectedPath, activeTab, analyzeStatus, branding]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#EDF0F7] dark:bg-slate-950">
      <TopBar
        address={activeDeal.address}
        verdict={activeDeal.verdict}
        onMenuToggle={() => setLeftPanelOpen(!leftPanelOpen)}
        onCallModeClick={() => setActiveTab('callmode')}
        onDocsClick={() => handleOpenDocuments('report')}
        onPrint={handlePrint}
        onReset={handleReset}
        darkMode={darkMode}
        onDarkModeToggle={() => setDarkMode(!darkMode)}
      />

      {/* Overlay for mobile */}
      {(leftPanelOpen || rightPanelOpen) && (
        <div
          className="fixed inset-0 top-[54px] bg-black/40 z-30 md:hidden"
          onClick={closeDrawers}
        />
      )}

      <div className="fixed top-[54px] left-0 right-0 bottom-0 flex overflow-hidden">
        <LeftPanel deal={activeDeal} isOpen={leftPanelOpen} />

        {/* Main Content */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 overflow-x-auto flex-shrink-0">
            <button
              onClick={() => setActiveTab('analyzer')}
              className={`px-4 py-3 text-[12px] font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'analyzer'
                  ? 'text-blue-500 border-blue-500'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Analyzer
            </button>
            <button
              onClick={() => setActiveTab('callmode')}
              className={`px-4 py-3 text-[12px] font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'callmode'
                  ? 'text-blue-500 border-blue-500'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Call Mode
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className={`px-4 py-3 text-[12px] font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'documents'
                  ? 'text-blue-500 border-blue-500'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Documents
            </button>
            <button
              onClick={() => setActiveTab('crm')}
              className={`px-4 py-3 text-[12px] font-medium border-b-2 transition-all whitespace-nowrap ${
                activeTab === 'crm'
                  ? 'text-blue-500 border-blue-500'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              CRM Features
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto bg-[#F8FAFC] dark:bg-slate-900">
            {activeTab === 'analyzer' && (
              <AnalyzerTab
                deal={activeDeal}
                selectedPath={activeSelectedPath}
                onDealChange={handleDealChange}
                onAnalyze={handleAnalyzeDeal}
                onSendToAgent={handleSendToAgent}
                onSaveDeal={handleSaveDeal}
                onClearDeal={handleClearAnalyzer}
                onSelectPath={setSelectedPath}
                onOpenCallMode={handleOpenCallModeForPath}
                analyzeStatus={analyzeStatus}
              />
            )}
            {activeTab === 'callmode' && (
              <CallModeTab
                deal={activeDeal}
                onDealChange={handleDealChange}
                selectedPath={activeSelectedPath}
                onSelectPath={setSelectedPath}
              />
            )}
            {activeTab === 'documents' && (
              <PathDeliverables
                deal={activeDeal}
                selectedPath={activeSelectedPath}
                activeDocument={activeDocument}
                onDocumentChange={setActiveDocument}
                branding={branding}
                onBrandingChange={setBranding}
                exportStatus={exportStatus}
                documentDeliveryStatus={documentDeliveryStatus}
                onPreview={handlePreview}
                onPrint={handlePrintPackage}
                onGenerate={handleGeneratePackage}
                onEmailDocuments={handleEmailDocuments}
                onPdfAction={handlePdfPanelAction}
              />
            )}
            {activeTab === 'crm' && (
              <CRMFeatures
                deal={activeDeal}
                onLoadDeal={handleLoadSavedDeal}
              />
            )}
          </div>
        </div>

        <RightPanel
          isOpen={rightPanelOpen}
          onClose={() => setRightPanelOpen(false)}
          deal={activeDeal}
          selectedPath={activeSelectedPath}
          exportStatus={exportStatus}
          onGenerate={handleGeneratePackage}
          onPreview={handlePreview}
          onPrintPackage={handlePrintPackage}
          onOpenDocument={handleOpenDocuments}
        />
      </div>
    </div>
  );
}
