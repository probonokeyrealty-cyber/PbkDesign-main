const DEFAULT_CONCESSION_PERCENTS = Object.freeze([0.78, 0.82, 0.85, 0.875, 0.89]);
const DEFAULT_RBP_BUYER_CAPACITY = Object.freeze([0.65, 0.7, 0.72, 0.75]);

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedText(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function shouldUseRBP(repairs, lead = {}, property = {}) {
  const condition = normalizedText(
    lead.propertyCondition ||
      lead.property_condition ||
      property.condition ||
      property.propertyCondition
  );
  const timeline = normalizedText(lead.timeline || lead.sellerTimeline || '');
  const wantsMaximumProceeds = Boolean(
    lead.desiresMaximumProceeds ||
      lead.desires_maximum_proceeds ||
      /highest|max(?:imum)?_?net|best_?price/.test(normalizedText(lead.primaryGoal || lead.goal))
  );
  const urgent = /auction|foreclosure|asap|immediate|this_week|under_14_days/.test(timeline);
  return (
    numberOr(repairs) >= 80_000 ||
    ['uninhabitable', 'severe', 'major_rehab', 'financeability_risk'].includes(condition) ||
    (wantsMaximumProceeds && !urgent)
  );
}

export class NegotiationPolicy {
  constructor(lead = {}, propertyAnalysis = {}, offerHistory = [], options = {}) {
    this.lead = lead && typeof lead === 'object' ? lead : {};
    this.property = propertyAnalysis && typeof propertyAnalysis === 'object' ? propertyAnalysis : {};
    this.offerHistory = Array.isArray(offerHistory) ? offerHistory : [];
    this.assignmentFee = numberOr(options.assignmentFee ?? this.property.assignmentFee, 15_000);
    this.holdingCosts = numberOr(options.holdingCosts ?? this.property.holdingCosts, 0);
    this.closingCosts = numberOr(options.closingCosts ?? this.property.closingCosts, 0);
    this.approvedMaximum = numberOr(
      options.approvedMaximum ?? this.property.approvedMaximum ?? this.property.mao,
      0
    );
    this.concessionPercents = options.concessionPercents || DEFAULT_CONCESSION_PERCENTS;
    this.rbpBuyerCapacity = options.rbpBuyerCapacity || DEFAULT_RBP_BUYER_CAPACITY;
  }

  estimateSellerBATNA() {
    if (this.lead.competingOffer || this.lead.competing_offer) {
      return { strength: 'strong', reason: 'credible_competing_offer' };
    }
    if (this.lead.activeListing || this.lead.active_listing) {
      return { strength: 'medium', reason: 'active_listing' };
    }
    if (this.lead.canWait || this.lead.can_wait) {
      return { strength: 'medium', reason: 'seller_can_wait' };
    }
    return { strength: 'unknown', reason: 'not_enough_evidence' };
  }

  estimatePBKBATNA() {
    return {
      strength: this.approvedMaximum > 0 ? 'known' : 'unknown',
      reason: this.approvedMaximum > 0 ? 'approved_maximum_available' : 'missing_approved_maximum',
      walkAwayValue: this.approvedMaximum || null,
    };
  }

  calculateZOPA() {
    const sellerMinimum = numberOr(
      this.lead.sellerMinimum ??
        this.lead.seller_minimum ??
        this.lead.reservationValue ??
        this.lead.reservation_value,
      0
    );
    const pbkMaximum = this.approvedMaximum;
    if (!sellerMinimum || !pbkMaximum) {
      return { known: false, low: sellerMinimum || null, high: pbkMaximum || null };
    }
    return sellerMinimum <= pbkMaximum
      ? { known: true, exists: true, low: sellerMinimum, high: pbkMaximum }
      : { known: true, exists: false, low: sellerMinimum, high: pbkMaximum };
  }

  shouldUseRBP() {
    return shouldUseRBP(this.property.repairs, this.lead, this.property);
  }

  getCashAnchor() {
    const mao = Math.max(0, numberOr(this.property.mao));
    if (!mao) return 0;
    return Math.round(mao * 0.7 / 100) * 100;
  }

  getRBPOffer(step = this.offerHistory.length) {
    const arv = Math.max(0, numberOr(this.property.arv));
    const repairs = Math.max(0, numberOr(this.property.repairs));
    if (!arv) return 0;
    const capacityPercent = this.rbpBuyerCapacity[
      clamp(Math.floor(numberOr(step)), 0, this.rbpBuyerCapacity.length - 1)
    ];
    const repairAdjustedBuyerCapacity =
      arv * capacityPercent -
      repairs -
      this.assignmentFee -
      this.holdingCosts -
      this.closingCosts;
    const economicCeiling =
      arv - repairs - this.assignmentFee - this.holdingCosts - this.closingCosts;
    const approvedCeiling = this.approvedMaximum > 0 ? this.approvedMaximum : economicCeiling;
    return Math.max(
      0,
      Math.round(Math.min(repairAdjustedBuyerCapacity, economicCeiling, approvedCeiling) / 100) *
        100
    );
  }

  getAnchorOffer() {
    return this.shouldUseRBP() ? this.getRBPOffer(0) : this.getCashAnchor();
  }

  nextConcession() {
    const mao = Math.max(0, numberOr(this.property.mao));
    if (!mao) return { amount: 0, exhausted: true, reason: 'missing_mao' };
    const step = clamp(this.offerHistory.length, 0, this.concessionPercents.length - 1);
    const amount = Math.round(
      Math.min(mao * this.concessionPercents[step], this.approvedMaximum || mao) / 100
    ) * 100;
    return {
      amount,
      exhausted: this.offerHistory.length >= this.concessionPercents.length,
      reason: 'decreasing_concession_ladder',
      step,
    };
  }

  buildRecommendation() {
    const path = this.shouldUseRBP() ? 'rbp' : 'cash';
    const amount = path === 'rbp' ? this.getRBPOffer() : this.getAnchorOffer();
    const zopa = this.calculateZOPA();
    const confidence = [
      numberOr(this.property.arv) > 0,
      numberOr(this.property.repairs) >= 0,
      numberOr(this.property.mao) > 0 || path === 'rbp',
      Boolean(this.lead.timeline),
    ].filter(Boolean).length / 4;
    return {
      path,
      amount,
      confidence: Number(confidence.toFixed(2)),
      zopa,
      sellerBATNA: this.estimateSellerBATNA(),
      pbkBATNA: this.estimatePBKBATNA(),
      requiresApproval: true,
      sellerFacing: false,
      amountUse: 'approval_advisory_only',
      rationale:
        path === 'rbp'
          ? 'High-repair or maximum-net criteria favor the Retail Buying Program.'
          : 'Cash path favors speed, certainty, and a repair-adjusted investor offer.',
    };
  }
}
