import { DealData, PBKPath, QuickDocumentType } from '../types';
import { calculateMAO } from './dealCalculations';
import { formatCurrency, formatDate, sanitizeLegacyCopy } from './formatting';

export interface PBKBranding {
  companyName: string;
  logoDataUrl?: string;
}

export interface PBKPathOption {
  id: PBKPath;
  label: string;
  shortLabel: string;
  tone: 'green' | 'blue' | 'purple' | 'amber' | 'slate';
}

export interface PBKReadiness {
  ready: boolean;
  missing: string[];
  message: string;
}

export interface PBKAnalyzeReadiness extends PBKReadiness {
  ctaLabel: string;
  successMessage: string;
}

export interface PBKLiveCallChecklistItem {
  id: string;
  label: string;
  complete: boolean;
  confirmed: boolean;
}

export interface PBKLiveCallSupport {
  pathLabel: string;
  checklist: PBKLiveCallChecklistItem[];
  requiredMissing: string[];
  bannerTone: 'success' | 'warning' | 'info';
  bannerTitle: string;
  bannerMessage: string;
  phoneStatus: 'missing' | 'needs-verification' | 'verified';
}

interface PBKDocContext {
  selectedPath: PBKPath;
  propertyAddress: string;
  propertyType: 'House' | 'Land';
  sellerName: string;
  sellerEmail: string;
  sellerPhone: string;
  agreedPrice: number;
  timeline: string;
  earnestDeposit: string;
  cfDownPayment: number;
  cfRate: number;
  cfTerm: number;
  cfTypeLabel: string;
  mtUpfront: number;
  mtBalance: number;
  mtRate: number;
  mtTypeLabel: string;
  lotSize: string;
  cashAlternative: number;
  sellerCosts: string;
  buyerType: string;
  monthlyPayment: number;
  monthlySpread: number;
  arv: number;
  repairBudget: number;
  condition: string;
  offerLines: string[];
  warningLines: string[];
  warnings: string[];
}

const DEFAULT_EARNEST = 'Delivered within 3 business days';
const DEFAULT_COMPANY = 'Probono Key Realty';

export const DEFAULT_BRANDING: PBKBranding = {
  companyName: DEFAULT_COMPANY,
  logoDataUrl: '',
};

function valueOrZero(value?: number | null): number {
  return Number.isFinite(value as number) ? Number(value) : 0;
}

function nonEmpty(value?: string | null): string {
  return String(value || '').trim();
}

function formatMaybeRate(rate: number): string {
  return rate > 0 ? `${rate.toFixed(2)}%` : 'Missing interest rate';
}

function formatMaybeYears(term: number): string {
  return term > 0 ? `${term} years` : 'Missing term';
}

function isLandPath(path: PBKPath): boolean {
  return path === 'land-owner' || path === 'land-agent' || path === 'rbp-land';
}

export function getDefaultSelectedPath(deal: Pick<DealData, 'type' | 'contact'>): PBKPath {
  if (deal.type === 'land') {
    return deal.contact === 'realtor' ? 'land-agent' : 'land-owner';
  }
  return 'cash';
}

export function normalizeSelectedPath(deal: Pick<DealData, 'type' | 'contact' | 'selectedPath'>): PBKPath {
  const selectedPath = deal.selectedPath || getDefaultSelectedPath(deal);

  if (deal.type === 'land') {
    if (selectedPath === 'rbp' || selectedPath === 'rbp-land') return 'rbp-land';
    if (selectedPath === 'land-owner' || selectedPath === 'land-agent') {
      return deal.contact === 'realtor' ? 'land-agent' : 'land-owner';
    }
    return getDefaultSelectedPath(deal);
  }

  if (selectedPath === 'land-owner' || selectedPath === 'land-agent' || selectedPath === 'rbp-land') {
    return 'cash';
  }

  return selectedPath;
}

export function getPathOptions(deal: Pick<DealData, 'type' | 'contact'>): PBKPathOption[] {
  if (deal.type === 'land') {
    return [
      {
        id: deal.contact === 'realtor' ? 'land-agent' : 'land-owner',
        label: 'Land / Builder Assignment',
        shortLabel: 'Land',
        tone: 'slate',
      },
      {
        id: 'rbp-land',
        label: 'Land RBP Backup',
        shortLabel: 'RBP Land',
        tone: 'amber',
      },
    ];
  }

  return [
    { id: 'cash', label: 'Cash Offer', shortLabel: 'Cash', tone: 'green' },
    { id: 'cf', label: 'Creative Finance', shortLabel: 'CF', tone: 'blue' },
    { id: 'mt', label: 'Mortgage Takeover', shortLabel: 'MT', tone: 'purple' },
    { id: 'rbp', label: 'Retail Buyer Program', shortLabel: 'RBP', tone: 'amber' },
  ];
}

export function getPathLabel(path: PBKPath): string {
  const labels: Record<PBKPath, string> = {
    cash: 'Cash Offer',
    cf: 'Creative Finance',
    mt: 'Mortgage Takeover',
    rbp: 'Retail Buyer Program',
    'land-owner': 'Land / Builder Assignment',
    'land-agent': 'Land / Builder Assignment',
    'rbp-land': 'Land RBP Backup',
  };

  return labels[path];
}

export function getLiveInputPath(path: PBKPath): 'cash' | 'creative_finance' | 'subject_to' | 'rbp' | 'land' {
  if (path === 'cf') return 'creative_finance';
  if (path === 'mt') return 'subject_to';
  if (isLandPath(path)) return 'land';
  return path;
}

export function getMasterPackagePath(deal: Pick<DealData, 'type' | 'contact' | 'selectedPath'>): string {
  const path = normalizeSelectedPath(deal);

  if (path === 'cash') {
    if (deal.contact === 'realtor') {
      return deal.type === 'land' ? 'cash-realtor-land' : 'cash-realtor-house';
    }
    return 'cash';
  }

  if (path === 'cf') return 'cf';
  if (path === 'mt') return 'mt';
  if (path === 'rbp') return 'rbp';
  if (path === 'rbp-land' || path === 'land-owner' || path === 'land-agent') return 'cash-realtor-land';

  return 'cash';
}

function getAgreedPrice(deal: DealData): number {
  return valueOrZero(deal.agreedPrice) || valueOrZero(deal.rbpPriceConfirm) || valueOrZero(deal.price);
}

function getEarnest(deal: DealData): string {
  return nonEmpty(deal.earnestDeposit) || DEFAULT_EARNEST;
}

function getSellerCosts(deal: DealData, path: PBKPath): string {
  if (path === 'rbp') return nonEmpty(deal.rbpSellerCosts) || '$0 - covered by PBK';
  if (isLandPath(path)) return nonEmpty(deal.landSellerCosts) || '$0 - covered by PBK';
  return '$0 - covered by PBK';
}

function getBuyerType(deal: DealData, path: PBKPath): string {
  if (path === 'rbp') return nonEmpty(deal.rbpBuyerType);
  if (isLandPath(path)) return nonEmpty(deal.landBuyerType);
  return '';
}

function getLotSize(deal: DealData): string {
  return nonEmpty(deal.landLotSizeConfirm) || nonEmpty(deal.lotSize);
}

function getCfTypeLabel(cfType?: string): string {
  if (cfType === 'wrap') return 'Wrap';
  if (cfType === 'subto') return 'Subject-To';
  if (cfType === 'carry') return 'Seller Carry';
  return nonEmpty(cfType) || 'Seller Carry';
}

function getMtTypeLabel(mtType?: string): string {
  if (mtType === 'assume') return 'Assumption';
  if (mtType === 'carry-gap') return 'Carry-Gap';
  if (mtType === 'subto') return 'Subject-To';
  return nonEmpty(mtType) || 'Subject-To';
}

function getDocPathLabel(path: PBKPath): string {
  const labels: Record<PBKPath, string> = {
    cash: 'Cash Offer',
    rbp: 'Retail Buyer Program',
    cf: 'Creative Finance',
    mt: 'Mortgage Takeover',
    'land-agent': 'Land Agent',
    'land-owner': 'Land Owner',
    'rbp-land': 'RBP Land',
  };

  return labels[path];
}

function buildDocContext(deal: DealData): PBKDocContext {
  const selectedPath = normalizeSelectedPath(deal);
  const agreedPrice = getAgreedPrice(deal);
  const propertyType = deal.type === 'land' ? 'Land' : 'House';
  const cfDownPayment = valueOrZero(deal.cfDownPayment) || (agreedPrice > 0 ? Math.round(agreedPrice * 0.04) : 0);
  const cfRate = valueOrZero(deal.cfRate) || valueOrZero(deal.rate);
  const cfTerm = valueOrZero(deal.cfTerm) || 30;
  const mtUpfront = valueOrZero(deal.mtUpfront) || (agreedPrice > 0 ? Math.round(agreedPrice * 0.04) : 0);
  const mtBalance = valueOrZero(deal.mtBalanceConfirm) || valueOrZero(deal.balance);
  const mtRate = valueOrZero(deal.mtRateConfirm) || valueOrZero(deal.rate);
  const cfLoan = Math.max(0, agreedPrice - cfDownPayment);
  const cfMonthlyPayment = cfLoan > 0 && cfRate > 0 ? Math.round(cfLoan * (cfRate / 100 / 12)) : 0;
  const mtMonthlyRate = mtRate > 0 ? mtRate / 100 / 12 : 0;
  const mtMonthlyPayment =
    mtBalance > 0 && mtMonthlyRate > 0
      ? Math.round(mtBalance * ((mtMonthlyRate * Math.pow(1 + mtMonthlyRate, 360)) / (Math.pow(1 + mtMonthlyRate, 360) - 1)))
      : 0;
  const monthlyPayment = selectedPath === 'mt' ? mtMonthlyPayment : selectedPath === 'cf' ? cfMonthlyPayment : 0;
  const monthlySpread = monthlyPayment > 0 ? Math.round(valueOrZero(deal.rent) - monthlyPayment) : 0;
  const cashAlternative = valueOrZero(deal.rbpCashAlternative);
  const lotSize = getLotSize(deal);
  const sellerCosts = getSellerCosts(deal, selectedPath);
  const arv = valueOrZero(deal.arv);
  const repairBudget = valueOrZero(deal.repairs?.mid);
  const condition = nonEmpty(deal.repairs?.condition) || '-';
  const warnings: string[] = [];
  const warningLines: string[] = [];

  const pushWarn = (label: string) => {
    const warning = `⚠ Missing: ${label} - please complete in Live Call Inputs before signing.`;
    warnings.push(warning);
    warningLines.push(warning);
  };

  if (agreedPrice <= 0) pushWarn('Agreed Price');
  if (!nonEmpty(deal.timeline)) pushWarn('Closing Timeline');
  if (!nonEmpty(deal.earnestDeposit)) pushWarn('Earnest Deposit');
  if ((selectedPath === 'rbp' || selectedPath === 'rbp-land') && cashAlternative <= 0) {
    pushWarn('Cash Alternative');
  }
  if (selectedPath === 'cf') {
    if (cfDownPayment <= 0) pushWarn('Down Payment');
    if (cfRate <= 0) pushWarn('Interest Rate');
    if (cfTerm <= 0) {
      pushWarn('Loan Term');
      pushWarn('Balloon Term');
    }
    if (!nonEmpty(deal.cfType)) pushWarn('Structure');
  }
  if (selectedPath === 'mt') {
    if (mtUpfront <= 0) pushWarn('Upfront Cash');
    if (mtBalance <= 0) pushWarn('Existing Loan Balance');
    if (mtRate <= 0) pushWarn('Existing Rate');
    if (!nonEmpty(deal.mtType)) pushWarn('Structure');
  }
  if (isLandPath(selectedPath) && !lotSize) pushWarn('Lot Size');

  const offerLines = [
    'Offer Structure Summary',
    `Path: ${getDocPathLabel(selectedPath)}`,
    `Property Address: ${nonEmpty(deal.address) || '[PROPERTY ADDRESS]'}`,
    `Agreed Price: ${agreedPrice > 0 ? formatCurrency(agreedPrice) : 'Missing agreed price'}`,
    `Closing Timeline: ${nonEmpty(deal.timeline) || 'Missing close timeline'}`,
    `Earnest Deposit: ${nonEmpty(deal.earnestDeposit) || 'Missing earnest deposit'}`,
  ];

  if (selectedPath === 'cash') {
    offerLines.push(`Structure: All-cash, as-is, no financing contingency. Close in ${nonEmpty(deal.timeline) || 'Missing timeline'}.`);
  } else if (selectedPath === 'rbp') {
    offerLines.push('Structure: Retail Buyer Program - buyer uses conventional/FHA/VA financing. Seller pays no costs.');
    offerLines.push(`Seller Costs: ${sellerCosts}`);
    offerLines.push(`Cash Alternative: ${cashAlternative > 0 ? formatCurrency(cashAlternative) : 'Missing cash alternative'}`);
  } else if (selectedPath === 'cf') {
    offerLines.push(`Purchase Price: ${agreedPrice > 0 ? formatCurrency(agreedPrice) : 'Missing agreed price'}`);
    offerLines.push(
      `Down Payment: ${
        cfDownPayment > 0
          ? `${formatCurrency(cfDownPayment)}${agreedPrice > 0 ? ` (${((cfDownPayment / agreedPrice) * 100).toFixed(1)}%)` : ''}`
          : 'Missing down payment'
      }`,
    );
    offerLines.push(`Interest Rate: ${cfRate > 0 ? `${cfRate.toFixed(2)}%` : 'Missing interest rate'}`);
    offerLines.push(`Loan Term: ${cfTerm > 0 ? `${cfTerm} years` : 'Missing loan term'}`);
    offerLines.push(`Balloon Term: ${cfTerm > 0 ? `${cfTerm} years` : 'Missing balloon term'}`);
    offerLines.push(`Monthly Interest-Only Payment: ${monthlyPayment > 0 ? `${formatCurrency(monthlyPayment)}/mo` : 'Missing monthly interest-only payment'}`);
    offerLines.push(`Structure: ${getCfTypeLabel(deal.cfType)}`);
  } else if (selectedPath === 'mt') {
    offerLines.push(`Purchase Price: ${agreedPrice > 0 ? formatCurrency(agreedPrice) : 'Missing agreed price'}`);
    offerLines.push(`Upfront Cash to Seller: ${mtUpfront > 0 ? formatCurrency(mtUpfront) : 'Missing upfront cash'}`);
    offerLines.push(`Assume Existing Loan Balance: ${mtBalance > 0 ? formatCurrency(mtBalance) : 'Missing existing loan balance'}`);
    offerLines.push(`Existing Interest Rate: ${mtRate > 0 ? `${mtRate.toFixed(2)}%` : 'Missing existing rate'}`);
    offerLines.push(`Monthly Payment (PITI est.): ${monthlyPayment > 0 ? `${formatCurrency(monthlyPayment)}/mo` : 'Missing monthly payment'}`);
    offerLines.push(`Structure: ${getMtTypeLabel(deal.mtType)}`);
  } else {
    offerLines.push(`Lot Size: ${lotSize || 'Missing lot size'}`);
    offerLines.push(`Offer to Seller: ${agreedPrice > 0 ? formatCurrency(agreedPrice) : 'Missing offer'}`);
    if (selectedPath === 'rbp-land') {
      offerLines.push(`Builder Pays: ${valueOrZero(deal.builderTotal) > 0 ? formatCurrency(valueOrZero(deal.builderTotal)) : 'Missing builder value'}`);
      offerLines.push(`Cash Alternative: ${cashAlternative > 0 ? formatCurrency(cashAlternative) : 'Missing cash alternative'}`);
    }
  }

  return {
    selectedPath,
    propertyAddress: nonEmpty(deal.address) || '[PROPERTY ADDRESS]',
    propertyType,
    sellerName: nonEmpty(deal.sellerName),
    sellerEmail: nonEmpty(deal.sellerEmail),
    sellerPhone: nonEmpty(deal.sellerPhone),
    agreedPrice,
    timeline: nonEmpty(deal.timeline),
    earnestDeposit: getEarnest(deal),
    cfDownPayment,
    cfRate,
    cfTerm,
    cfTypeLabel: getCfTypeLabel(deal.cfType),
    mtUpfront,
    mtBalance,
    mtRate,
    mtTypeLabel: getMtTypeLabel(deal.mtType),
    lotSize,
    cashAlternative,
    sellerCosts,
    buyerType: getBuyerType(deal, selectedPath),
    monthlyPayment,
    monthlySpread,
    arv,
    repairBudget,
    condition,
    offerLines,
    warningLines,
    warnings,
  };
}

function getComparableLines(deal: DealData): string[] {
  const comps = [deal.comps.A, deal.comps.B, deal.comps.C].filter((comp) => comp.address || comp.price > 0 || comp.date);

  if (!comps.length) {
    return ['Comparable Sales', 'No comparable sales entered yet.'];
  }

  return [
    'Comparable Sales',
    ...comps.map(
      (comp, index) =>
        `${index + 1}. ${comp.address || 'Comp'} | ${formatCurrency(valueOrZero(comp.price))} | ${nonEmpty(comp.date) || 'Date not entered'}`,
    ),
  ];
}

function getOfferStructureLines(doc: PBKDocContext, heading?: string): string[] {
  if (!doc.offerLines.length) return [];
  if (!heading) return [...doc.offerLines];
  return [heading, ...doc.offerLines.slice(1)];
}

function getConditionLines(doc: PBKDocContext): string[] {
  if (doc.propertyType !== 'House') return [];
  return ['Condition Notes', `Condition: ${doc.condition}`, `Repair Estimate: ${formatCurrency(doc.repairBudget)}`];
}

function getWarningLines(doc: PBKDocContext): string[] {
  if (!doc.warningLines.length) return [];
  return ['Warnings', ...doc.warningLines];
}

export function getPdfReadiness(deal: DealData): PBKReadiness {
  const missing: string[] = [];

  if (!normalizeSelectedPath(deal)) missing.push('selected path');
  if (!nonEmpty(deal.sellerName)) missing.push('seller name');
  if (!nonEmpty(deal.sellerEmail) || !nonEmpty(deal.sellerEmail).includes('@')) missing.push('valid seller email');
  if (getAgreedPrice(deal) <= 0) missing.push('agreed price');
  if (!nonEmpty(deal.timeline)) missing.push('close timeline');

  return {
    ready: missing.length === 0,
    missing,
    message:
      missing.length === 0
        ? 'Premium package ready.'
        : `Complete ${missing.join(', ')} before generating the premium package.`,
  };
}

export function getAnalyzeReadiness(deal: DealData): PBKAnalyzeReadiness {
  const missing: string[] = [];
  const selectedPath = normalizeSelectedPath(deal);
  const hasAddress = Boolean(nonEmpty(deal.address));
  const hasLotSize =
    Boolean(getLotSize(deal)) ||
    valueOrZero(parseFloat(nonEmpty(deal.lotSize))) > 0 ||
    valueOrZero(deal.landLotSizeSqFt) > 0;
  const hasLandPriceBasis = valueOrZero(deal.builderPrice) > 0 || valueOrZero(deal.landPriceSqFt) > 0;

  if (!hasAddress) missing.push('property address');

  if (deal.type === 'land') {
    if (!hasLotSize) missing.push('lot size');
    if (!hasLandPriceBasis) missing.push('builder pricing');
  } else {
    if (valueOrZero(deal.price) <= 0) missing.push('list price');
    if (valueOrZero(deal.arv) <= 0) missing.push('comp-based ARV');
  }

  const ready = missing.length === 0;
  const successMessage = `${getPathLabel(selectedPath)} is ready. Move into Call Mode to lock in live terms, scripts, and next steps.`;

  return {
    ready,
    missing,
    message: ready ? successMessage : `Add ${missing.join(', ')} to finish the analysis.`,
    ctaLabel: ready && deal.isAnalyzed ? 'Open Call Mode ->' : 'Analyze Deal ->',
    successMessage,
  };
}

function isConfirmedTerm(deal: DealData, key: string): boolean {
  return Boolean(deal.confirmedTerms && deal.confirmedTerms[key]);
}

function hasMeaningfulNumber(value: number, deal: DealData, key: string): boolean {
  return value > 0 || isConfirmedTerm(deal, key);
}

export function getLiveCallSupport(deal: DealData, pathOverride?: PBKPath): PBKLiveCallSupport {
  const selectedPath = pathOverride || normalizeSelectedPath(deal);
  const agreedPrice = getAgreedPrice(deal);
  const earnestDeposit = getEarnest(deal);
  const lotSize = getLotSize(deal);
  const readiness = getPdfReadiness({
    ...deal,
    selectedPath,
  });
  const phoneStatus: PBKLiveCallSupport['phoneStatus'] = !nonEmpty(deal.sellerPhone)
    ? 'missing'
    : deal.sellerPhoneVerified
      ? 'verified'
      : 'needs-verification';
  const checklist: PBKLiveCallChecklistItem[] = [
    {
      id: 'sellerName',
      label: `Seller name: ${nonEmpty(deal.sellerName) || '[enter above]'}`,
      complete: Boolean(nonEmpty(deal.sellerName)),
      confirmed: isConfirmedTerm(deal, 'sellerName'),
    },
    {
      id: 'phoneVerified',
      label: 'Phone verified',
      complete: phoneStatus === 'verified',
      confirmed: isConfirmedTerm(deal, 'phoneVerified'),
    },
    {
      id: 'agreedPrice',
      label: `Agreed offer: ${agreedPrice > 0 ? formatCurrency(agreedPrice) : '[confirm above]'}`,
      complete: agreedPrice > 0,
      confirmed: isConfirmedTerm(deal, 'agreedPrice'),
    },
    {
      id: 'timeline',
      label: `Timeline: ${nonEmpty(deal.timeline) || '[select above]'}`,
      complete: Boolean(nonEmpty(deal.timeline)),
      confirmed: isConfirmedTerm(deal, 'timeline'),
    },
    {
      id: 'earnestDeposit',
      label: `Earnest: ${earnestDeposit || DEFAULT_EARNEST}`,
      complete: Boolean(earnestDeposit),
      confirmed: isConfirmedTerm(deal, 'earnestDeposit'),
    },
  ];

  if (isLandPath(selectedPath)) {
    checklist.push({
      id: 'landLotSizeConfirm',
      label: `Lot size confirmed: ${lotSize || '[confirm lot size]'}`,
      complete: Boolean(lotSize),
      confirmed: isConfirmedTerm(deal, 'landLotSizeConfirm'),
    });
  } else if (selectedPath === 'cf') {
    checklist.push(
      {
        id: 'cfDownPayment',
        label: `Down payment: ${valueOrZero(deal.cfDownPayment) > 0 ? formatCurrency(valueOrZero(deal.cfDownPayment)) : '[confirm amount]'}`,
        complete: hasMeaningfulNumber(valueOrZero(deal.cfDownPayment), deal, 'cfDownPayment'),
        confirmed: isConfirmedTerm(deal, 'cfDownPayment'),
      },
      {
        id: 'cfRate',
        label: `Rate: ${valueOrZero(deal.cfRate) > 0 ? `${valueOrZero(deal.cfRate).toFixed(2)}%` : '[confirm rate]'}`,
        complete: hasMeaningfulNumber(valueOrZero(deal.cfRate), deal, 'cfRate'),
        confirmed: isConfirmedTerm(deal, 'cfRate'),
      },
      {
        id: 'cfTerm',
        label: `Term: ${valueOrZero(deal.cfTerm) > 0 ? `${valueOrZero(deal.cfTerm)} years` : '[confirm term]'}`,
        complete: hasMeaningfulNumber(valueOrZero(deal.cfTerm), deal, 'cfTerm'),
        confirmed: isConfirmedTerm(deal, 'cfTerm'),
      },
      {
        id: 'cfType',
        label: `Structure: ${getCfTypeLabel(deal.cfType)}`,
        complete: Boolean(nonEmpty(deal.cfType)),
        confirmed: isConfirmedTerm(deal, 'cfType'),
      },
    );
  } else if (selectedPath === 'mt') {
    checklist.push(
      {
        id: 'mtUpfront',
        label: `Upfront to seller: ${valueOrZero(deal.mtUpfront) > 0 ? formatCurrency(valueOrZero(deal.mtUpfront)) : '[confirm amount]'}`,
        complete: hasMeaningfulNumber(valueOrZero(deal.mtUpfront), deal, 'mtUpfront'),
        confirmed: isConfirmedTerm(deal, 'mtUpfront'),
      },
      {
        id: 'mtBalanceConfirm',
        label: `Loan balance: ${valueOrZero(deal.mtBalanceConfirm) > 0 ? formatCurrency(valueOrZero(deal.mtBalanceConfirm)) : '[confirm balance]'}`,
        complete: hasMeaningfulNumber(valueOrZero(deal.mtBalanceConfirm), deal, 'mtBalanceConfirm'),
        confirmed: isConfirmedTerm(deal, 'mtBalanceConfirm'),
      },
      {
        id: 'mtRateConfirm',
        label: `Rate: ${valueOrZero(deal.mtRateConfirm) > 0 ? `${valueOrZero(deal.mtRateConfirm).toFixed(2)}%` : '[confirm rate]'}`,
        complete: hasMeaningfulNumber(valueOrZero(deal.mtRateConfirm), deal, 'mtRateConfirm'),
        confirmed: isConfirmedTerm(deal, 'mtRateConfirm'),
      },
      {
        id: 'mtType',
        label: `Structure: ${getMtTypeLabel(deal.mtType)}`,
        complete: Boolean(nonEmpty(deal.mtType)),
        confirmed: isConfirmedTerm(deal, 'mtType'),
      },
    );
  } else if (selectedPath === 'rbp') {
    checklist.push(
      {
        id: 'rbpPriceConfirm',
        label: `RBP offer: ${valueOrZero(deal.rbpPriceConfirm) > 0 ? formatCurrency(valueOrZero(deal.rbpPriceConfirm)) : '[confirm offer]'}`,
        complete: hasMeaningfulNumber(valueOrZero(deal.rbpPriceConfirm), deal, 'rbpPriceConfirm'),
        confirmed: isConfirmedTerm(deal, 'rbpPriceConfirm'),
      },
      {
        id: 'rbpCashAlternative',
        label: `Cash alternative: ${valueOrZero(deal.rbpCashAlternative) > 0 ? formatCurrency(valueOrZero(deal.rbpCashAlternative)) : '[confirm backup cash]'}`,
        complete: hasMeaningfulNumber(valueOrZero(deal.rbpCashAlternative), deal, 'rbpCashAlternative'),
        confirmed: isConfirmedTerm(deal, 'rbpCashAlternative'),
      },
    );
  }

  let bannerTone: PBKLiveCallSupport['bannerTone'] = 'warning';
  let bannerTitle = 'Complete terms before sending docs';
  let bannerMessage = readiness.message;

  if (readiness.ready && phoneStatus === 'verified') {
    bannerTone = 'success';
    bannerTitle = 'Documents are ready';
    bannerMessage = 'Seller details, pricing, and timeline are ready for docs and preview.';
  } else if (readiness.ready) {
    bannerTone = 'info';
    bannerTitle = 'Documents are ready, phone check recommended';
    bannerMessage = 'Docs can be generated now. Phone verification is still a recommended final capture step.';
  } else if (phoneStatus !== 'verified') {
    bannerMessage += ' Phone verification stays a recommended soft check before you send docs.';
  }

  return {
    pathLabel: getPathLabel(selectedPath),
    checklist,
    requiredMissing: readiness.missing,
    bannerTone,
    bannerTitle,
    bannerMessage,
    phoneStatus,
  };
}

function getMotivationLabel(deal: DealData): string {
  const score = valueOrZero(deal.motivationScore) || 3;
  if (score <= 2) return 'Low';
  if (score <= 4) return 'Medium';
  return 'High';
}

function getPathNarrative(path: PBKPath): string {
  const copy: Record<PBKPath, string> = {
    cash: 'All-cash, as-is execution with the fastest close and the least seller friction.',
    cf: 'Higher headline number through structured terms and monthly spread.',
    mt: 'Preserve the existing loan while solving the seller’s debt or timing problem.',
    rbp: 'Highest likely seller price with a retail-buyer disposition plan and a cash backup.',
    'land-owner': 'Builder / developer assignment path built around lot value and a fast land close.',
    'land-agent': 'Land assignment structure coordinated through the listing side and a builder buyer.',
    'rbp-land': 'Land backup path built around builder value with a cleaner fallback number.',
  };

  return copy[path];
}

export function buildSellerGuideText(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING): string {
  const doc = buildDocContext(deal);
  const lines = [
    branding.companyName || DEFAULT_COMPANY,
    'SELLER GUIDE',
    '',
    `Property: ${doc.propertyAddress}`,
    `Estimated ARV: ${formatCurrency(doc.arv)}`,
    '',
  ];

  lines.push(...getComparableLines(deal));
  lines.push('');
  lines.push(...getOfferStructureLines(doc, 'Offer Structure'));

  const conditionLines = getConditionLines(doc);
  if (conditionLines.length) {
    lines.push('');
    lines.push(...conditionLines);
  }

  const warningLines = getWarningLines(doc);
  if (warningLines.length) {
    lines.push('');
    lines.push(...warningLines);
  }

  return sanitizeLegacyCopy(lines.join('\n'));
}

export function buildLOIText(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING): string {
  const doc = buildDocContext(deal);
  const lines = [
    branding.companyName || DEFAULT_COMPANY,
    'LETTER OF INTENT',
    '',
    `Seller: ${doc.sellerName || 'Warning: Seller Full Name not entered'}`,
    `Email: ${doc.sellerEmail || 'Warning: Seller Email not entered'}`,
    `Phone: ${doc.sellerPhone || 'Not provided'}`,
    '',
    ...getOfferStructureLines(doc),
  ];

  const conditionLines = getConditionLines(doc);
  if (conditionLines.length) {
    lines.push('');
    lines.push('Condition / Repairs');
    lines.push(...conditionLines.slice(1));
  }

  const warningLines = getWarningLines(doc);
  if (warningLines.length) {
    lines.push('');
    lines.push(...warningLines);
  }

  lines.push('');
  lines.push('This intent reflects the latest live call inputs and selected path.');
  return sanitizeLegacyCopy(lines.join('\n'));
}

export function buildPathPackageText(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING): string {
  const doc = buildDocContext(deal);
  const today = formatDate();
  const lines = [
    branding.companyName || DEFAULT_COMPANY,
    'PATH PACKAGE',
    `${today} | ${doc.propertyAddress}`,
    '',
    `Selected Path: ${getPathLabel(doc.selectedPath)}`,
    getPathNarrative(doc.selectedPath),
    '',
    'Seller Snapshot',
    `Seller: ${doc.sellerName || 'Not entered'}`,
    `Email: ${doc.sellerEmail || 'Not entered'}`,
    `Phone: ${doc.sellerPhone || 'Not entered'}`,
    `Motivation: ${getMotivationLabel(deal)} (${valueOrZero(deal.motivationScore) || 3}/5)`,
    '',
    'Key Numbers',
    `Agreed Price: ${doc.agreedPrice > 0 ? formatCurrency(doc.agreedPrice) : 'Missing agreed price'}`,
    `ARV: ${formatCurrency(doc.arv)}`,
    `MAO Cash: ${formatCurrency(valueOrZero(deal.mao60))}`,
    `MAO RBP: ${formatCurrency(valueOrZero(deal.maoRBP))}`,
  ];

  if (doc.propertyType === 'House') {
    const maoAfterRepairs = calculateMAO.afterRepairs(valueOrZero(deal.arv), valueOrZero(deal.repairs.mid), valueOrZero(deal.fee) || 8000);
    lines.push(`Repairs: ${formatCurrency(doc.repairBudget)}`);
    lines.push(`MAO After Repairs: ${formatCurrency(maoAfterRepairs)}`);
  } else {
    const spread = Math.max(0, valueOrZero(deal.builderTotal) - valueOrZero(deal.offer));
    lines.push(`Lot Size: ${doc.lotSize || 'Missing lot size'}`);
    lines.push(`Builder Total: ${formatCurrency(valueOrZero(deal.builderTotal))}`);
    lines.push(`Offer to Seller: ${formatCurrency(valueOrZero(deal.offer) || doc.agreedPrice)}`);
    lines.push(`Spread: ${formatCurrency(spread)}`);
  }

  lines.push('');
  lines.push(...getComparableLines(deal));
  lines.push('');
  lines.push(...getOfferStructureLines(doc, 'Offer Structure'));

  const conditionLines = getConditionLines(doc);
  if (conditionLines.length) {
    lines.push('');
    lines.push(...conditionLines);
  }

  const warningLines = getWarningLines(doc);
  if (warningLines.length) {
    lines.push('');
    lines.push(...warningLines);
  }

  if (nonEmpty(deal.notes)) {
    lines.push('');
    lines.push('Call Notes');
    lines.push(nonEmpty(deal.notes));
  }

  return sanitizeLegacyCopy(lines.join('\n'));
}

export function buildNextStepsText(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING): string {
  const doc = buildDocContext(deal);
  const pathSpecificNext: Record<PBKPath, string[]> = {
    cash: [
      'Validate final number and close date on a 5-minute seller call.',
      'Issue the all-cash LOI and premium package within 24 hours.',
      'Open title immediately after acceptance.',
      'Close on the agreed timeline with no financing contingency.',
    ],
    cf: [
      'Confirm down payment, rate, term, and structure with the seller.',
      'Issue the Creative Finance LOI and seller guide.',
      'Review docs with title / attorney if seller wants legal review.',
      'Finalize the note and security instrument before closing.',
    ],
    mt: [
      'Confirm existing balance, rate, and payment status.',
      'Issue the Mortgage Takeover LOI and relief narrative.',
      'Verify title and any lender-facing paperwork needed for closing.',
      'Close with upfront cash and payment transition instructions.',
    ],
    rbp: [
      'Confirm the RBP number and backup cash alternative.',
      'Issue the seller guide and LOI together.',
      'Position the buyer profile and timing expectations clearly.',
      'Move to formal contract once seller accepts the structure.',
    ],
    'land-owner': [
      'Confirm lot size, zoning, and builder appetite.',
      'Issue the land seller guide and LOI.',
      'Open title and verify utilities / access during diligence.',
      'Coordinate builder-side disposition while title clears.',
    ],
    'land-agent': [
      'Confirm listing-side timeline, lot details, and agent expectations.',
      'Issue the land guide and LOI through the listing side.',
      'Verify builder criteria, zoning, and access.',
      'Advance to title and builder coordination once terms are accepted.',
    ],
    'rbp-land': [
      'Confirm builder value and cash backup path.',
      'Issue the land seller guide with the backup comparison.',
      'Verify zoning, utilities, and exit assumptions.',
      'Advance the cleanest builder path after acceptance.',
    ],
  };

  const lines = [
    branding.companyName || DEFAULT_COMPANY,
    'NEXT STEPS / NOTE',
    '',
    `Property: ${doc.propertyAddress}`,
    `Selected Path: ${getPathLabel(doc.selectedPath)}`,
    '',
    ...pathSpecificNext[doc.selectedPath].map((step, index) => `${index + 1}. ${step}`),
    '',
    `Close Timeline: ${doc.timeline || 'Confirm timeline before sending package'}`,
    `Earnest Deposit: ${doc.earnestDeposit}`,
    nonEmpty(deal.notes) ? `Notes: ${nonEmpty(deal.notes)}` : 'Notes: Add any seller-specific call notes here before sending.',
  ];

  const warningLines = getWarningLines(doc);
  if (warningLines.length) {
    lines.push('');
    lines.push(...warningLines);
  }

  return sanitizeLegacyCopy(lines.join('\n'));
}

function getPathExecutionSummary(doc: PBKDocContext): string {
  if (doc.selectedPath === 'cf') {
    return `Seller carry structure with ${doc.cfTypeLabel}, ${doc.cfDownPayment > 0 ? formatCurrency(doc.cfDownPayment) : 'TBD down payment'}, ${formatMaybeRate(doc.cfRate)}, and ${formatMaybeYears(doc.cfTerm)}.`;
  }

  if (doc.selectedPath === 'mt') {
    return `Mortgage takeover structure with ${doc.mtTypeLabel}, ${doc.mtBalance > 0 ? formatCurrency(doc.mtBalance) : 'TBD balance'}, ${formatMaybeRate(doc.mtRate)}, and ${doc.mtUpfront > 0 ? formatCurrency(doc.mtUpfront) : 'TBD upfront cash'}.`;
  }

  if (doc.selectedPath === 'rbp' || doc.selectedPath === 'rbp-land') {
    return `Retail-buyer execution with seller costs at ${doc.sellerCosts} and cash alternative ${doc.cashAlternative > 0 ? formatCurrency(doc.cashAlternative) : 'TBD'}.`;
  }

  if (isLandPath(doc.selectedPath)) {
    return `Land assignment workflow with lot size ${doc.lotSize || 'TBD'} and offer to seller ${doc.agreedPrice > 0 ? formatCurrency(doc.agreedPrice) : 'TBD'}.`;
  }

  return `Cash execution with as-is positioning, ${doc.timeline || 'TBD timeline'}, and earnest deposit ${doc.earnestDeposit}.`;
}

export function buildPurchaseAgreementText(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING): string {
  const doc = buildDocContext(deal);
  const lines = [
    branding.companyName || DEFAULT_COMPANY,
    'PURCHASE AGREEMENT WORKSHEET',
    '',
    'Template status: operational draft for review before legal / title finalization.',
    '',
    `Buyer: ${branding.companyName || DEFAULT_COMPANY}`,
    `Seller: ${doc.sellerName || '[SELLER NAME]'}`,
    `Property: ${doc.propertyAddress}`,
    `Selected Path: ${getPathLabel(doc.selectedPath)}`,
    '',
    'Core Terms',
    `Purchase Price: ${doc.agreedPrice > 0 ? formatCurrency(doc.agreedPrice) : '[AGREED PRICE]'}`,
    `Earnest Deposit: ${doc.earnestDeposit}`,
    `Close Timeline: ${doc.timeline || '[CLOSE TIMELINE]'}`,
    `Seller Email: ${doc.sellerEmail || '[SELLER EMAIL]'}`,
    `Seller Phone: ${doc.sellerPhone || '[SELLER PHONE]'}`,
    '',
    'Execution Notes',
    getPathExecutionSummary(doc),
    'Property to be purchased in as-is condition unless a written addendum states otherwise.',
    'Title, tax prorations, and closing agent details to be confirmed before signature.',
    '',
    ...getWarningLines(doc),
  ];

  return sanitizeLegacyCopy(lines.filter(Boolean).join('\n'));
}

export function buildAssignmentContractText(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING): string {
  const doc = buildDocContext(deal);
  const assignmentFee = valueOrZero(deal.fee) || 8000;
  const lines = [
    branding.companyName || DEFAULT_COMPANY,
    'ASSIGNMENT CONTRACT WORKSHEET',
    '',
    'Template status: internal prep draft for wholesaling / disposition coordination.',
    '',
    `Assignor: ${branding.companyName || DEFAULT_COMPANY}`,
    'Assignee: [END BUYER / ASSIGNEE NAME]',
    `Underlying Seller: ${doc.sellerName || '[SELLER NAME]'}`,
    `Property: ${doc.propertyAddress}`,
    '',
    'Assignment Terms',
    `Original Contract Price: ${doc.agreedPrice > 0 ? formatCurrency(doc.agreedPrice) : '[AGREED PRICE]'}`,
    `Assignment Fee: ${formatCurrency(assignmentFee)}`,
    `Target Close: ${doc.timeline || '[CLOSE TIMELINE]'}`,
    `Earnest Deposit: ${doc.earnestDeposit}`,
    '',
    'Disposition Notes',
    `Selected Path: ${getPathLabel(doc.selectedPath)}`,
    getPathExecutionSummary(doc),
    'Assignee agrees to perform per the underlying purchase agreement and any approved addenda.',
    'Proof of funds, buyer entity details, and title instructions should be attached before release.',
    '',
    ...getWarningLines(doc),
  ];

  return sanitizeLegacyCopy(lines.filter(Boolean).join('\n'));
}

export function buildSellerQuestionnaireText(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING): string {
  const doc = buildDocContext(deal);
  const lines = [
    branding.companyName || DEFAULT_COMPANY,
    'SELLER QUESTIONNAIRE',
    '',
    `Property: ${doc.propertyAddress}`,
    `Seller: ${doc.sellerName || '[SELLER NAME]'}`,
    `Phone: ${doc.sellerPhone || '[SELLER PHONE]'}`,
    `Email: ${doc.sellerEmail || '[SELLER EMAIL]'}`,
    '',
    'Property & Motivation Intake',
    `1. Why are you selling this property? ${nonEmpty(deal.notes) || '[SELLER RESPONSE]'}`,
    `2. Ideal close timeline: ${doc.timeline || '[CLOSE TIMELINE]'}`,
    `3. Agreed price discussed: ${doc.agreedPrice > 0 ? formatCurrency(doc.agreedPrice) : '[AGREED PRICE]'}`,
    `4. Occupancy / vacancy status: ${nonEmpty(deal.vacantStatus) || '[OWNER / TENANT / VACANT]'}`,
    `5. Property condition / repairs: ${doc.condition || '[CONDITION]'}`,
    `6. Estimated repairs or reductions: ${valueOrZero(deal.reductions) > 0 ? formatCurrency(valueOrZero(deal.reductions)) : '[REDUCTIONS / REPAIRS]'}`,
    `7. Existing loan balance / debt: ${doc.mtBalance > 0 ? formatCurrency(doc.mtBalance) : '[LOAN BALANCE / NONE]'}`,
    `8. Existing interest rate: ${doc.mtRate > 0 ? formatMaybeRate(doc.mtRate) : '[INTEREST RATE / NONE]'}`,
    `9. Monthly rent or payment context: ${valueOrZero(deal.rent) > 0 ? formatCurrency(valueOrZero(deal.rent)) : '[RENT / PAYMENT]'}`,
    `10. Best follow-up plan and notes: ${nonEmpty(deal.notes) || '[FOLLOW-UP NOTES]'}`,
    '',
    ...getWarningLines(doc),
  ];

  return sanitizeLegacyCopy(lines.filter(Boolean).join('\n'));
}

export function buildDocumentSet(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING): Record<QuickDocumentType, string> {
  return {
    report: buildPathPackageText(deal, branding),
    seller: buildSellerGuideText(deal, branding),
    loi: buildLOIText(deal, branding),
    email: buildNextStepsText(deal, branding),
    purchaseAgreement: buildPurchaseAgreementText(deal, branding),
    assignmentContract: buildAssignmentContractText(deal, branding),
    sellerQuestionnaire: buildSellerQuestionnaireText(deal, branding),
  };
}

export function buildMasterPackageParams(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING, printMode = false): string {
  const selectedPath = normalizeSelectedPath(deal);
  const masterPath = getMasterPackagePath(deal);
  const agreedPrice = getAgreedPrice(deal);
  const arv = valueOrZero(deal.arv);
  const maoCash = valueOrZero(deal.mao60);
  const maoRbp = valueOrZero(deal.maoRBP);
  const repairs = valueOrZero(deal.repairs.mid);
  const fee = valueOrZero(deal.fee) || 8000;
  const maoAfter = calculateMAO.afterRepairs(arv, repairs, fee);
  const cfDownPayment = valueOrZero(deal.cfDownPayment) || (agreedPrice > 0 ? Math.round(agreedPrice * 0.04) : 0);
  const cfRate = valueOrZero(deal.cfRate) || valueOrZero(deal.rate);
  const cfTerm = valueOrZero(deal.cfTerm) || 30;
  const mtUpfront = valueOrZero(deal.mtUpfront) || (agreedPrice > 0 ? Math.round(agreedPrice * 0.04) : 0);
  const mtBalance = valueOrZero(deal.mtBalanceConfirm) || valueOrZero(deal.balance);
  const mtRate = valueOrZero(deal.mtRateConfirm) || valueOrZero(deal.rate);
  const cfLoan = Math.max(0, agreedPrice - cfDownPayment);
  const cfMonthlyPayment = cfLoan > 0 && cfRate > 0 ? Math.round(cfLoan * (cfRate / 100 / 12)) : 0;
  const mtMonthlyRate = mtRate > 0 ? mtRate / 100 / 12 : 0;
  const mtMonthlyPayment =
    mtBalance > 0 && mtMonthlyRate > 0
      ? Math.round(mtBalance * ((mtMonthlyRate * Math.pow(1 + mtMonthlyRate, 360)) / (Math.pow(1 + mtMonthlyRate, 360) - 1)))
      : 0;
  const monthlyPayment = selectedPath === 'mt' ? mtMonthlyPayment : selectedPath === 'cf' ? cfMonthlyPayment : 0;
  const closingCostsEst = Math.round(agreedPrice * 0.02);
  const entryCost = (selectedPath === 'mt' ? mtUpfront : selectedPath === 'cf' ? cfDownPayment : 0) + closingCostsEst;
  const monthlySpread = selectedPath === 'cf' || selectedPath === 'mt' ? Math.round(valueOrZero(deal.rent) - monthlyPayment) : 0;
  const lotSize = getLotSize(deal);
  const sellerCosts = getSellerCosts(deal, selectedPath);
  const cashAlternative = valueOrZero(deal.rbpCashAlternative);
  const timeline = nonEmpty(deal.timeline);
  const earnestDeposit = getEarnest(deal);
  const params = new URLSearchParams();

  params.set('path', masterPath);
  params.set('templatePath', masterPath);
  params.set('pbk_preview', '1');
  if (printMode) params.set('pbk_print', '1');
  params.set('sellerName', nonEmpty(deal.sellerName));
  params.set('sellerEmail', nonEmpty(deal.sellerEmail));
  params.set('sellerPhone', nonEmpty(deal.sellerPhone));
  params.set('address', nonEmpty(deal.address));
  params.set('date', formatDate());
  params.set('timeline', timeline);
  params.set('earnestBase', earnestDeposit);
  params.set('agreedPrice', String(agreedPrice));
  params.set('arv', String(arv));
  params.set('maoCash', String(maoCash));
  params.set('maoRbp', String(maoRbp));
  params.set('maoAfter', String(maoAfter));
  params.set('repairs', String(repairs));
  params.set('rent', String(valueOrZero(deal.rent)));
  params.set('compAAddr', nonEmpty(deal.comps.A.address));
  params.set('compAPrice', String(valueOrZero(deal.comps.A.price)));
  params.set('compADate', nonEmpty(deal.comps.A.date));
  params.set('compBAddr', nonEmpty(deal.comps.B.address));
  params.set('compBPrice', String(valueOrZero(deal.comps.B.price)));
  params.set('compBDate', nonEmpty(deal.comps.B.date));
  params.set('compCAddr', nonEmpty(deal.comps.C.address));
  params.set('compCPrice', String(valueOrZero(deal.comps.C.price)));
  params.set('compCDate', nonEmpty(deal.comps.C.date));
  params.set('cfDn', String(cfDownPayment));
  params.set('cfDownPayment', String(cfDownPayment));
  params.set('cfRate', String(cfRate));
  params.set('cfTerm', String(cfTerm));
  params.set('cfType', nonEmpty(deal.cfType) || 'carry');
  params.set('cfTypeLabel', getCfTypeLabel(deal.cfType));
  params.set('downPayment', String(selectedPath === 'mt' ? mtUpfront : cfDownPayment));
  params.set('downPaymentPercent', String(agreedPrice > 0 ? Math.round(((selectedPath === 'mt' ? mtUpfront : cfDownPayment) / agreedPrice) * 1000) / 10 : 0));
  params.set('interestRate', String(selectedPath === 'mt' ? mtRate : cfRate));
  params.set('loanTerm', String(cfTerm));
  params.set('balloonTerm', String(cfTerm));
  params.set('mtUpfront', String(mtUpfront));
  params.set('mtBal', String(mtBalance));
  params.set('mtBalance', String(mtBalance));
  params.set('mtRate', String(mtRate));
  params.set('mtType', nonEmpty(deal.mtType) || 'subto');
  params.set('mtTypeLabel', getMtTypeLabel(deal.mtType));
  params.set('upfrontCash', String(mtUpfront));
  params.set('loanBalance', String(mtBalance));
  params.set('existingLoanBalance', String(mtBalance));
  params.set('existingRate', String(mtRate));
  params.set('loanTreatment', selectedPath === 'mt' ? getMtTypeLabel(deal.mtType) : selectedPath === 'cf' ? getCfTypeLabel(deal.cfType) : '');
  params.set('monthlyInterestOnlyPayment', String(selectedPath === 'cf' ? cfMonthlyPayment : 0));
  params.set('monthlyPiti', String(selectedPath === 'mt' ? mtMonthlyPayment : 0));
  params.set('monthlyPayment', String(monthlyPayment));
  params.set('sellerCosts', sellerCosts);
  params.set('buyerType', getBuyerType(deal, selectedPath));
  params.set('cashAlternative', String(cashAlternative));
  params.set('lotSize', lotSize);
  params.set('lotSizeConfirmed', lotSize);
  params.set('offerToSeller', String(isLandPath(selectedPath) ? valueOrZero(deal.offer) || agreedPrice : agreedPrice));
  params.set('builderPays', String(selectedPath === 'rbp-land' ? valueOrZero(deal.builderTotal) : 0));
  params.set('closeTimeline', timeline);
  params.set('agreedPriceRaw', String(agreedPrice || ''));
  params.set('downPaymentRaw', String(selectedPath === 'mt' ? mtUpfront : cfDownPayment));
  params.set('interestRateRaw', String(selectedPath === 'mt' ? mtRate : cfRate));
  params.set('loanTermRaw', String(cfTerm));
  params.set('upfrontCashRaw', String(mtUpfront));
  params.set('loanBalanceRaw', String(mtBalance));
  params.set('lotSizeRaw', lotSize);
  params.set('equity', String(Math.max(0, arv - agreedPrice)));
  params.set('monthlySpread', String(monthlySpread));
  params.set('equityCapture', String(Math.max(0, arv - agreedPrice)));
  params.set('entryCost', String(entryCost));
  params.set('balloonYear', String(cfTerm));
  params.set('termLength', String(cfTerm));
  params.set('stretchPrice', String(agreedPrice > 0 ? Math.round(agreedPrice * 1.08) : 0));
  params.set('spread', String(Math.abs(maoCash - agreedPrice)));
  params.set('marketPriceEst', String(arv));
  params.set('netTraditional', String(Math.round(arv * 0.91)));
  params.set('netPbkPath', String(agreedPrice));
  params.set('netAdvantage', String(Math.abs(Math.round(arv * 0.91) - agreedPrice)));
  params.set('netToPbk', String(Math.max(0, (selectedPath === 'cash' ? maoCash : maoRbp) - agreedPrice)));
  params.set('commissionEst', String(Math.round(arv * 0.06)));
  params.set('closingCostsEst', String(closingCostsEst));
  params.set('carryingCosts', String(Math.round(arv * 0.01)));
  params.set('holdingCosts', String(Math.round(arv * 0.005)));
  params.set('repairBudget', String(repairs));
  params.set('repairView', nonEmpty(deal.repairs.condition) || 'C4');
  params.set('condition', nonEmpty(deal.repairs.condition) || 'C4');
  params.set('conditionNotes', nonEmpty(deal.repairs.condition) || 'Average');
  params.set('score', `${valueOrZero(deal.motivationScore) || 3}/5`);
  params.set('level', getMotivationLabel(deal));
  params.set('analystName', 'PBK Underwriting');
  params.set('equityPosition', arv > 0 ? (arv - agreedPrice > arv * 0.2 ? 'Strong' : arv - agreedPrice > 0 ? 'Moderate' : 'Low') : 'Unknown');
  params.set('domHistory', `${valueOrZero(deal.dom)} days`);
  params.set('assessment', valueOrZero(deal.dom) > 60 || repairs > 15000 ? 'Motivated' : 'Stable');
  params.set('titleRisk', 'Low');
  params.set('paymentTolerance', 'Flexible');
  params.set('exitPlan', 'Refinance or Resale');
  params.set('reinstatementNeed', 'None');
  params.set('arrearsAmount', '0');
  params.set('ifAny', 'None');
  params.set('allocatedCosts', sellerCosts || '$0 - covered by PBK');
  params.set('rbpListingPrice', String(agreedPrice || maoRbp));
  params.set('safeRbpPrice', String(maoRbp > 0 ? Math.round(maoRbp * 0.93) : 0));
  params.set('stretchRbpPrice', String(maoRbp));
  params.set('ceilingRbpPrice', String(maoRbp > 0 ? Math.round(maoRbp * 1.05) : 0));
  params.set('companyName', branding.companyName || DEFAULT_COMPANY);
  params.set('logoDataUrl', branding.logoDataUrl || '');

  return params.toString();
}

export function openMasterPackageWindow(deal: DealData, branding: PBKBranding = DEFAULT_BRANDING, printMode = false): Window | null {
  const query = buildMasterPackageParams(deal, branding, printMode);
  return window.open(`/PBK_Master_Deal_Package.html?${query}`, '_blank', 'noopener');
}
