import { describe, expect, it } from '@jest/globals';
import { analyzeDeal, calculateMao } from './analyzeDeal.mjs';

describe('analyzeDeal helper', () => {
  it('calculates MAO using the 70% ARV rule minus repairs', () => {
    const result = calculateMao({ arv: 185000, repairs: 38000, maoPercent: 70 });

    expect(result.mao).toBe(91500);
    expect(result).toMatchObject({
      arv: 185000,
      repairs: 38000,
      maoPercent: 70,
    });
  });

  it('reserves assignment, holding, and closing costs', () => {
    const result = analyzeDeal({
      arv: '$185,000',
      repairs: '$38,000',
      assignmentFee: 10000,
      holdingCosts: 2500,
      closingCosts: 1500,
    });

    expect(result.mao).toBe(77500);
  });

  it('never returns a negative MAO for heavy rehab deals', () => {
    const result = analyzeDeal({ arv: 100000, repairs: 120000, assignmentFee: 10000 });

    expect(result.mao).toBe(0);
  });
});
