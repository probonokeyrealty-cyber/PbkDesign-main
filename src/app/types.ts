export type PBKPath =
  | 'cash'
  | 'cf'
  | 'mt'
  | 'rbp'
  | 'land-owner'
  | 'land-agent'
  | 'rbp-land';

export type QuickDocumentType =
  | 'report'
  | 'seller'
  | 'loi'
  | 'email'
  | 'purchaseAgreement'
  | 'assignmentContract'
  | 'sellerQuestionnaire';

export interface UnderwritingSettings {
  maoCashPct: number;
  maoRbpPct: number;
  maoRepairPct: number;
  targetCocPct: number;
  assignFeePct: number;
}

export interface DealData {
  // Property details
  address: string;
  type: 'house' | 'land';
  contact: 'owner' | 'realtor';
  price: number;
  agreedPrice?: number;
  beds: number;
  baths: number;
  sqft: number;
  year: number;
  dom: number;
  selectedPath?: PBKPath;
  isAnalyzed?: boolean;

  // Seller Information (for PDFs)
  sellerName?: string;
  sellerEmail?: string;
  sellerPhone?: string;
  sellerPhoneVerified?: boolean;
  motivationScore?: number; // 1-5 scale
  motivationLevel?: string;
  timeline?: string;
  earnestDeposit?: string;
  confirmedTerms?: Record<string, boolean>;

  // House-specific
  arv: number;
  rent: number;
  balance: number;
  rate: number;
  fee: number;
  repairs: {
    low: number;
    mid: number;
    high: number;
    condition: string;
  };

  // Land-specific
  builderPrice: number;
  lotSize: string;
  builderTotal: number;
  offer: number;
  zipCode: string;
  landInputMode?: 'quarter-acre' | 'sqft';
  landPriceSqFt?: number;
  landLotSizeSqFt?: number;

  // Comps
  comps: {
    A: { address: string; price: number; date: string; link: string };
    B: { address: string; price: number; date: string; link: string };
    C: { address: string; price: number; date: string; link: string };
  };

  // Calculated values
  mao60: number;
  maoRBP: number;
  verdict: 'none' | 'green' | 'yellow' | 'red';
  underwriting?: UnderwritingSettings;

  // Creative Finance terms
  cfDownPayment?: number;
  cfRate?: number;
  cfTerm?: number;
  cfMonthlyPayment?: number;
  cfType?: 'carry' | 'subto' | 'wrap';

  // Mortgage Takeover (Subject-To) fields
  mtUpfront?: number;
  mtBalanceConfirm?: number;
  mtRateConfirm?: number;
  mtType?: 'subto' | 'assume' | 'carry-gap';

  // RBP (Retail Buyer Program) fields
  rbpPriceConfirm?: number;
  rbpBuyerType?: string;
  rbpSellerCosts?: string;
  rbpCashAlternative?: number;

  // Cash Offer fields
  cashAsIs?: 'yes' | 'inspection';
  cashClosePeriod?: '21' | '30' | '45';

  // Land-specific fields (path-conditional)
  landLotSizeConfirm?: string;
  landBuyerType?: string;
  landSellerCosts?: string;

  // Universal Live Call fields
  notes?: string;
  reductions?: number;
  vacantStatus?: string;

  // Investor Yield Metrics
  investorCashFlow?: number;
  investorCOC?: number; // Cash-on-Cash Return
  investorROI?: number;
  investorIRR?: number; // Internal Rate of Return
}

export interface RepairItem {
  id: string;
  label: string;
  desc: string;
  low: number;
  mid: number;
  high: number;
  checked: boolean;
}
