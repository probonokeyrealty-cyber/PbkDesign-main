/**
 * Calculates a conservative maximum allowable offer for wholesale deal screening.
 *
 * @param {object} params
 * @param {number|string} params.arv - After-repair value.
 * @param {number|string} [params.repairs=0] - Estimated repairs.
 * @param {number|string} [params.maoPercent=70] - ARV rule percentage, expressed as 70 for 70%.
 * @param {number|string} [params.assignmentFee=0] - Desired assignment fee to reserve.
 * @param {number|string} [params.holdingCosts=0] - Optional holding cost reserve.
 * @param {number|string} [params.closingCosts=0] - Optional closing cost reserve.
 * @returns {{arv:number, repairs:number, maoPercent:number, assignmentFee:number, holdingCosts:number, closingCosts:number, mao:number}}
 * @sideEffects None. This helper is pure and safe for unit tests.
 */
export function analyzeDeal(params = {}) {
  return calculateMao(params);
}

export function calculateMao({
  arv = 0,
  repairs = 0,
  maoPercent = 70,
  assignmentFee = 0,
  holdingCosts = 0,
  closingCosts = 0,
} = {}) {
  const normalizedArv = moneyNumber(arv);
  const normalizedRepairs = moneyNumber(repairs);
  const normalizedMaoPercent = percentageNumber(maoPercent);
  const normalizedAssignmentFee = moneyNumber(assignmentFee);
  const normalizedHoldingCosts = moneyNumber(holdingCosts);
  const normalizedClosingCosts = moneyNumber(closingCosts);
  const mao = Math.max(
    0,
    Math.round(
      normalizedArv * normalizedMaoPercent -
        normalizedRepairs -
        normalizedAssignmentFee -
        normalizedHoldingCosts -
        normalizedClosingCosts
    )
  );

  return {
    arv: normalizedArv,
    repairs: normalizedRepairs,
    maoPercent: Math.round(normalizedMaoPercent * 10000) / 100,
    assignmentFee: normalizedAssignmentFee,
    holdingCosts: normalizedHoldingCosts,
    closingCosts: normalizedClosingCosts,
    mao,
  };
}

function moneyNumber(value) {
  const parsed = Number(String(value ?? 0).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function percentageNumber(value) {
  const parsed = Number(String(value ?? 70).replace(/[%\s]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0.7;
  return parsed > 1 ? parsed / 100 : parsed;
}
