/**
 * Custom hooks for deal calculations
 * Centralizes calculation logic and provides memoization for performance
 */

import { useMemo } from 'react';
import { DealData } from '../types';
import {
  calculateARV,
  calculateMAO,
  calculateVerdict,
  getVerdictProps,
  calculateMonthlyPayment,
  getRepairCondition,
  calculateLandMetrics,
  calculateInvestorMetrics,
} from '../utils/dealCalculations';

/**
 * Hook for ARV calculation from comps
 */
export const useARVCalculation = (comps: DealData['comps']) => {
  return useMemo(() => {
    return calculateARV(comps);
  }, [comps.A.price, comps.B.price, comps.C.price]);
};

/**
 * Hook for MAO calculations
 */
export const useMAOCalculations = (arv: number, repairs: number, assignmentFee: number = 8000) => {
  return useMemo(() => {
    return {
      mao60: calculateMAO.wholesale(arv, assignmentFee),  // MAO Cash uses FEE not repairs
      maoRBP: calculateMAO.rbp(arv),
      maoAfterRepairs: calculateMAO.afterRepairs(arv, repairs, assignmentFee),  // Added MAO AR
      maoFixFlip: calculateMAO.fixFlip(arv, repairs),
    };
  }, [arv, repairs, assignmentFee]);
};

/**
 * Hook for deal verdict with display properties
 */
export const useDealVerdict = (price: number, arv: number, maoRBP: number) => {
  return useMemo(() => {
    const verdict = calculateVerdict(price, arv, maoRBP);
    const props = getVerdictProps(verdict);

    return {
      verdict,
      ...props,
    };
  }, [price, arv, maoRBP]);
};

/**
 * Hook for investor yield calculations
 */
export const useInvestorMetrics = (
  deal: DealData,
  assumptions: {
    holdMonths: number;
    closingCosts: number;
    holdingCostsPerMonth: number;
    sellingCostPercent: number;
  }
) => {
  return useMemo(() => {
    const monthlyPayment = calculateMonthlyPayment(deal.balance, deal.rate);

    // Wholesale metrics
    const wholesale = calculateInvestorMetrics.wholesale(
      deal.price,
      deal.arv,
      deal.fee || 8000
    );

    // Fix & Flip metrics
    const fixFlip = calculateInvestorMetrics.fixFlip(
      deal.price,
      deal.repairs.mid,
      deal.arv,
      assumptions.holdMonths,
      assumptions.closingCosts,
      assumptions.holdingCostsPerMonth,
      assumptions.sellingCostPercent
    );

    // BRRRR metrics
    const brrrr = calculateInvestorMetrics.brrrr(
      deal.price,
      deal.repairs.mid,
      deal.arv,
      deal.rent,
      monthlyPayment,
      300 // Monthly reserves
    );

    return {
      wholesale,
      fixFlip,
      brrrr,
      monthlyPayment,
    };
  }, [
    deal.price,
    deal.arv,
    deal.repairs.mid,
    deal.rent,
    deal.balance,
    deal.rate,
    deal.fee,
    assumptions,
  ]);
};

/**
 * Hook for repair condition assessment
 */
export const useRepairCondition = (midRepairs: number, arv: number) => {
  return useMemo(() => {
    return getRepairCondition(midRepairs, arv);
  }, [midRepairs, arv]);
};

/**
 * Hook for land deal metrics
 */
export const useLandMetrics = (lotSizeAcres: string, builderPrice: number) => {
  return useMemo(() => {
    const size = parseFloat(lotSizeAcres) || 0;
    return calculateLandMetrics(size, builderPrice);
  }, [lotSizeAcres, builderPrice]);
};

/**
 * Hook for monthly mortgage payment
 */
export const useMonthlyPayment = (balance: number, rate: number, years: number = 30) => {
  return useMemo(() => {
    return calculateMonthlyPayment(balance, rate, years);
  }, [balance, rate, years]);
};

/**
 * Complete deal analysis hook that combines all calculations
 */
export const useDealAnalysis = (deal: DealData) => {
  const arv = useARVCalculation(deal.comps);
  const { mao60, maoRBP, maoAfterRepairs, maoFixFlip } = useMAOCalculations(arv, deal.repairs.mid, deal.fee);
  const verdictData = useDealVerdict(deal.price, arv, maoRBP);
  const repairCondition = useRepairCondition(deal.repairs.mid, arv);
  const landMetrics = useLandMetrics(deal.lotSize, deal.builderPrice);

  return useMemo(() => {
    return {
      arv,
      mao60,
      maoRBP,
      maoAfterRepairs,
      maoFixFlip,
      verdict: verdictData.verdict,
      verdictProps: verdictData,
      repairCondition,
      landMetrics,
      // Deal quality metrics
      spreadUnderRBP: maoRBP - deal.price,
      spreadPercent: maoRBP > 0 ? ((maoRBP - deal.price) / maoRBP) * 100 : 0,
      // Land spread
      landSpread: deal.type === 'land' ? landMetrics.totalValue - deal.offer : 0,
      landSpreadPercent:
        deal.type === 'land' && landMetrics.totalValue > 0
          ? ((landMetrics.totalValue - deal.offer) / landMetrics.totalValue) * 100
          : 0,
    };
  }, [arv, mao60, maoRBP, maoAfterRepairs, maoFixFlip, verdictData, repairCondition, landMetrics, deal.price, deal.offer, deal.type]);
};
