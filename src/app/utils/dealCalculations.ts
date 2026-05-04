/**
 * Deal calculation utilities
 * Centralizes all real estate deal math and formulas
 */

import { DealData } from '../types';

/**
 * Calculate After Repair Value (ARV) from comparable sales
 */
export const calculateARV = (comps: DealData['comps']): number => {
  const prices = [
    comps.A.price || 0,
    comps.B.price || 0,
    comps.C.price || 0,
  ].filter(p => p > 0);

  if (prices.length === 0) return 0;
  return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
};

/**
 * Calculate Maximum Allowable Offer (MAO) for different strategies
 * FORMULAS LOCKED - Match original HTML exactly
 */
export const calculateMAO = {
  // MAO Cash (60%) - subtracts assignment FEE, not repairs
  wholesale: (arv: number, assignmentFee: number = 8000, percent: number = 60): number => {
    return Math.max(0, Math.round(arv * (percent / 100) - assignmentFee));
  },

  // MAO RBP (88%) - no deductions
  rbp: (arv: number, percent: number = 88): number => {
    return Math.max(0, Math.round(arv * (percent / 100)));
  },

  // MAO After Repairs (65%) - subtracts BOTH repairs AND fee
  afterRepairs: (arv: number, repairs: number, assignmentFee: number = 8000, percent: number = 65): number => {
    return Math.max(0, Math.round(arv * (percent / 100) - repairs - assignmentFee));
  },

  // Fix & Flip (70%) - different strategy, keeps current formula
  fixFlip: (arv: number, repairs: number): number => {
    return Math.round(arv * 0.70 - repairs);
  }
};

/**
 * Calculate deal verdict based on price vs MAO
 */
export const calculateVerdict = (
  price: number,
  arv: number,
  maoRBP: number
): 'none' | 'green' | 'yellow' | 'red' => {
  if (price === 0 || arv === 0) return 'none';

  if (price <= maoRBP) return 'green';
  if (price <= arv * 0.95) return 'yellow';
  return 'red';
};

/**
 * Get verdict display properties
 */
export const getVerdictProps = (verdict: 'none' | 'green' | 'yellow' | 'red') => {
  const props = {
    none: {
      label: 'Not analyzed',
      emoji: '',
      color: 'gray',
      bgClass: 'bg-gray-100 dark:bg-gray-900',
      textClass: 'text-gray-600 dark:text-gray-400',
      message: 'Add property details to analyze this deal.',
    },
    green: {
      label: 'Go',
      emoji: '',
      color: 'green',
      bgClass: 'bg-green-100 dark:bg-green-900/20',
      textClass: 'text-green-800 dark:text-green-400',
      message: 'Great deal! Price is at or below RBP',
    },
    yellow: {
      label: 'Review',
      emoji: '',
      color: 'yellow',
      bgClass: 'bg-yellow-100 dark:bg-yellow-900/20',
      textClass: 'text-yellow-800 dark:text-yellow-400',
      message: 'Marginal deal - price is workable but tight',
    },
    red: {
      label: 'Pass',
      emoji: '',
      color: 'red',
      bgClass: 'bg-red-100 dark:bg-red-900/20',
      textClass: 'text-red-800 dark:text-red-400',
      message: 'Overpriced - list price exceeds safe margins',
    },
  };

  return props[verdict];
};

/**
 * Calculate monthly mortgage payment (PITI formula)
 * FORMULA LOCKED - Match original HTML (line 1246)
 */
export const calculateMonthlyPayment = (
  principal: number,
  annualRate: number,
  years: number = 30,
  ltvPercent: number = 80  // Original HTML uses 80% LTV
): number => {
  if (principal === 0 || annualRate === 0) return 0;

  const loanAmount = principal * (ltvPercent / 100);  // Apply LTV
  const monthlyRate = annualRate / 100 / 12;
  const numPayments = years * 12;

  const payment = (loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -numPayments));

  return Math.round(payment);
};

export const amortizedPayment = (
  principal: number,
  annualRate: number,
  months: number = 360,
): number => {
  if (principal <= 0 || annualRate <= 0 || months <= 0) return 0;

  const monthlyRate = annualRate / 100 / 12;
  const factor =
    (monthlyRate * Math.pow(1 + monthlyRate, months)) /
    (Math.pow(1 + monthlyRate, months) - 1);

  return Math.round(principal * factor);
};

export const calculateMonthlyInterestOnly = (
  principal: number,
  annualRate: number,
): number => {
  if (principal <= 0 || annualRate <= 0) return 0;
  return Math.round(principal * (annualRate / 100 / 12));
};

export const calculateMarketPiti = (
  price: number,
  marketRate: number = 7.5,
  years: number = 30,
): number => {
  if (price <= 0) return 0;
  const debtService = amortizedPayment(price * 0.8, marketRate, years * 12);
  const taxesAndInsurance = price * 0.012 / 12;
  return Math.round(debtService + taxesAndInsurance);
};

export const calculateSubjectToPiti = (
  balance: number,
  annualRate: number,
  price: number,
  years: number = 30,
): number => {
  if (balance <= 0 || annualRate <= 0) return 0;
  const debtService = amortizedPayment(balance, annualRate, years * 12);
  const taxesAndInsurance = price > 0 ? price * 0.012 / 12 : 0;
  return Math.round(debtService + taxesAndInsurance);
};

export interface YieldMetrics {
  pmt: number;
  noi: number;
  cashflow: number;
  equity: number;
  dscr: number;
  coc: number;
  cap: number;
}

export const computeCoCExact = (
  price: number,
  downPct: number,
  intRate: number,
  grossRent: number,
  vacPct: number,
  expPct: number,
  closingCosts: number,
  termYears: number = 30,
  mode: 'standard' | 'cf' = 'standard',
): YieldMetrics => {
  const years = termYears || 30;
  const down = price * (downPct / 100);
  const loan = price - down;
  const monthlyRate = intRate / 100 / 12;
  const months = years * 12;
  const payment =
    mode === 'cf'
      ? monthlyRate > 0 && loan > 0
        ? loan * monthlyRate
        : 0
      : monthlyRate > 0 && loan > 0
        ? loan * ((monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1))
        : months > 0
          ? loan / months
          : 0;

  const annualGross = grossRent * 12;
  const vacancyLoss = annualGross * (vacPct / 100);
  const expenses = annualGross * (expPct / 100);
  const noi = (annualGross - vacancyLoss) - expenses;
  const cashflow = noi - payment * 12;
  const equity = down + (closingCosts || 0);
  const dscr = payment > 0 ? (noi / 12) / payment : 999;

  return {
    pmt: payment,
    noi,
    cashflow,
    equity,
    dscr,
    coc: equity > 0 ? (cashflow / equity) * 100 : 0,
    cap: price > 0 ? (noi / price) * 100 : 0,
  };
};

export interface CreativeFinanceMath {
  marketPiti: number;
  subjectToPiti: number;
  carryPayment: number;
  marketCashflow: number | null;
  subjectToCashflow: number | null;
  carryCashflow: number | null;
  spread: number;
  creativeMax: number;
  dealRating: string;
  offerOne: {
    price: number;
    down: number;
    rate: number;
    monthly: number;
    term: number;
  };
  offerTwo: {
    price: number;
    down: number;
    rate: number;
    monthly: number;
    term: number;
  };
  calcCf: {
    payment: number;
    expenseLoad: number;
    trueCashflow: number;
    dscr: number;
    go: boolean;
  };
}

export const calculateCreativeFinanceMath = (
  price: number,
  arv: number,
  rent: number,
  balance: number,
  sellerRate: number,
  maoCash: number,
): CreativeFinanceMath => {
  const marketPiti = calculateMarketPiti(price, 7.5, 30);
  const subjectToPiti = sellerRate > 0 && balance > 0
    ? calculateSubjectToPiti(balance, sellerRate, price, 30)
    : 0;
  const carryRate = sellerRate > 0 ? sellerRate : 4;
  const carryPayment = price > 0
    ? amortizedPayment(price * 0.96, carryRate, 360)
    : 0;
  const marketCashflow = rent > 0 ? Math.round(rent * 0.8 - marketPiti) : null;
  const subjectToCashflow = rent > 0 && subjectToPiti > 0 ? Math.round(rent * 0.8 - subjectToPiti) : null;
  const carryCashflow = rent > 0 && carryPayment > 0 ? Math.round(rent * 0.8 - carryPayment) : null;
  const spread = price > 0 ? price - maoCash : 0;
  const creativeMax = maoCash + Math.round(spread * 0.75);
  const dealRating =
    spread > 80000
      ? 'GREEN - Strong CF deal'
      : spread > 40000
        ? 'YELLOW - Moderate CF deal'
        : 'RED - Tight (be conservative)';
  const offerOnePrice = price;
  const offerOneDown = Math.round(price * 0.04);
  const offerOneRate = sellerRate > 0 ? Math.min(sellerRate, 6) : 5;
  const offerOneMonthly = Math.round((offerOnePrice - offerOneDown) * (offerOneRate / 100 / 12));
  const offerTwoPrice = Math.round(price * 0.98);
  const offerTwoDown = Math.round(price * 0.08);
  const offerTwoRate = Math.max(0, sellerRate > 0 ? sellerRate - 1 : 3);
  const offerTwoMonthly =
    offerTwoRate > 0 ? Math.round((offerTwoPrice - offerTwoDown) * (offerTwoRate / 100 / 12)) : 0;

  const calcCfRate = sellerRate > 0 ? sellerRate : 7.5;
  const calcCfPayment = price > 0
    ? amortizedPayment(price * 0.8, calcCfRate, 360)
    : 0;
  const expenseLoad = rent * 0.5;
  const trueCashflow = rent - expenseLoad - calcCfPayment;
  const dscr = calcCfPayment > 0 ? (rent - expenseLoad) / calcCfPayment : 0;
  let score = 0;
  if (trueCashflow > 300) score += 2;
  if (dscr > 1.25) score += 2;
  if (calcCfPayment < rent * 0.4) score += 1;

  return {
    marketPiti,
    subjectToPiti,
    carryPayment,
    marketCashflow,
    subjectToCashflow,
    carryCashflow,
    spread,
    creativeMax,
    dealRating,
    offerOne: {
      price: offerOnePrice,
      down: offerOneDown,
      rate: offerOneRate,
      monthly: offerOneMonthly,
      term: 7,
    },
    offerTwo: {
      price: offerTwoPrice,
      down: offerTwoDown,
      rate: offerTwoRate,
      monthly: offerTwoMonthly,
      term: 10,
    },
    calcCf: {
      payment: Math.round(calcCfPayment),
      expenseLoad: Math.round(expenseLoad),
      trueCashflow: Math.round(trueCashflow),
      dscr: Math.round(dscr * 100) / 100,
      go: score >= 4,
    },
  };
};

export const calculateMortgageTakeoverYield = ({
  price,
  rent,
  vacPct = 10,
  expPct = 20,
  closingCosts = 0,
  upfront,
  balance,
  rate,
}: {
  price: number;
  rent: number;
  vacPct?: number;
  expPct?: number;
  closingCosts?: number;
  upfront: number;
  balance: number;
  rate: number;
}): YieldMetrics => {
  const annualGross = rent * 12;
  const vacancyLoss = annualGross * (vacPct / 100);
  const expenses = annualGross * (expPct / 100);
  const noi = (annualGross - vacancyLoss) - expenses;
  const payment = rate > 0 && balance > 0
    ? amortizedPayment(balance, rate, 360)
    : balance > 0
      ? balance / 360
      : 0;
  const cashflow = noi - payment * 12;
  const equity = Math.max(0, upfront) + (closingCosts || 0);
  const dscr = payment > 0 ? (noi / 12) / payment : 999;

  return {
    pmt: payment,
    noi,
    cashflow,
    equity,
    dscr,
    coc: equity > 0 ? (cashflow / equity) * 100 : 0,
    cap: price > 0 ? (noi / price) * 100 : 0,
  };
};

/**
 * Calculate repair condition based on mid-point estimate
 */
export const getRepairCondition = (midRepairs: number, arv: number): string => {
  if (midRepairs === 0) return 'Unknown';

  const ratio = midRepairs / arv;

  if (ratio < 0.05) return 'Excellent';
  if (ratio < 0.10) return 'Good';
  if (ratio < 0.15) return 'Fair';
  if (ratio < 0.25) return 'Poor';
  return 'Very Poor';
};

/**
 * Calculate land deal metrics
 */
export const calculateLandMetrics = (
  lotSizeAcres: number,
  builderPricePerQuarterAcre: number
): { units: number; totalValue: number } => {
  const quarterAcreUnits = lotSizeAcres / 0.25;
  const totalValue = Math.round(quarterAcreUnits * builderPricePerQuarterAcre);

  return {
    units: Math.round(quarterAcreUnits * 100) / 100,
    totalValue
  };
};

/**
 * Calculate land offer with dynamic spread
 * FORMULA LOCKED - Match original HTML (lines 2824-2849)
 */
export const calculateLandOffer = (
  totalBuilderValue: number
): { spread: number; offer: number } => {
  // Dynamic spread based on total value
  const spread =
    totalBuilderValue > 50000 ? 8000 :
    totalBuilderValue > 30000 ? 6500 : 5500;

  const offer = Math.max(0, Math.round(totalBuilderValue - spread));

  return { spread, offer };
};

/**
 * Calculate investor ROI metrics for different strategies
 */
export const calculateInvestorMetrics = {
  wholesale: (purchasePrice: number, arvPrice: number, assignmentFee: number) => {
    const profit = assignmentFee;
    const roi = purchasePrice > 0 ? (profit / purchasePrice) * 100 : 0;

    return { profit, roi };
  },

  fixFlip: (
    purchasePrice: number,
    repairs: number,
    arv: number,
    holdMonths: number = 6,
    closingCosts: number = 3000,
    holdingCostsPerMonth: number = 800,
    sellingCostPercent: number = 0.08
  ) => {
    const totalInvestment = purchasePrice + repairs + closingCosts + (holdMonths * holdingCostsPerMonth);
    const sellingCosts = arv * sellingCostPercent;
    const netProceeds = arv - sellingCosts;
    const profit = netProceeds - totalInvestment;
    const roi = totalInvestment > 0 ? (profit / totalInvestment) * 100 : 0;
    const annualizedROI = holdMonths > 0 ? (roi / holdMonths) * 12 : 0;

    return {
      totalInvestment,
      profit,
      roi,
      annualizedROI,
      netProceeds
    };
  },

  brrrr: (
    purchasePrice: number,
    repairs: number,
    arv: number,
    monthlyRent: number,
    monthlyPayment: number,
    monthlyExpenses: number = 300
  ) => {
    const refinanceValue = arv * 0.75; // 75% LTV
    const totalInvestment = purchasePrice + repairs + 3000; // Add closing costs
    const cashLeftIn = totalInvestment - refinanceValue;
    const monthlyCashFlow = monthlyRent - monthlyPayment - monthlyExpenses;
    const annualCashFlow = monthlyCashFlow * 12;
    const coc = cashLeftIn > 0 ? (annualCashFlow / cashLeftIn) * 100 : 0;

    return {
      refinanceValue,
      cashLeftIn: Math.max(0, cashLeftIn),
      monthlyCashFlow,
      annualCashFlow,
      coc
    };
  }
};

/**
 * Validate deal data completeness
 */
export const validateDealData = (deal: DealData): {
  isValid: boolean;
  missingFields: string[];
  warnings: string[];
} => {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!deal.address) missing.push('Property Address');
  if (deal.price === 0) missing.push('List Price');

  if (deal.type === 'house') {
    if (deal.arv === 0) warnings.push('ARV not calculated - add comparable sales');
    if (deal.repairs.mid === 0) warnings.push('Repair estimate not provided');
    if (deal.beds === 0) warnings.push('Bedroom count missing');
    if (deal.baths === 0) warnings.push('Bathroom count missing');
  }

  if (deal.type === 'land') {
    if (parseFloat(deal.lotSize) === 0) missing.push('Lot Size');
    if (deal.builderPrice === 0) warnings.push('Builder price per ¼ acre not set');
  }

  return {
    isValid: missing.length === 0,
    missingFields: missing,
    warnings
  };
};
