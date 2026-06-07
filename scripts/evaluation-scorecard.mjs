const METRICS = Object.freeze({
  appointment: { weight: 15 },
  contract: { weight: 20 },
  revenue: { weight: 20, target: 12_000 },
  survival: { weight: 10 },
  trust: { weight: 15 },
  profitPerLead: { weight: 10, target: 2_000 },
  commitmentTime: { weight: 5, target: 10 },
  underwriting: { weight: 5, tolerance: 0.1 },
});

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, numberOr(value)));
}

export function calculateScorecard(callRecord = {}) {
  const contactedLeads = Math.max(1, numberOr(callRecord.contactedLeads ?? callRecord.contacted_leads, 1));
  const profit = Math.max(0, numberOr(callRecord.profit ?? callRecord.assignmentRevenue));
  const minutesToCommitment = Math.max(
    0,
    numberOr(callRecord.minutesToVerbalYes ?? callRecord.minutes_to_verbal_yes)
  );
  const predictedArv = Math.max(0, numberOr(callRecord.predictedArv ?? callRecord.predicted_arv));
  const actualArv = Math.max(0, numberOr(callRecord.actualArv ?? callRecord.actual_arv));
  const cancelled = Boolean(callRecord.cancelled || callRecord.rescinded);
  const complaint = Boolean(callRecord.sellerComplaint || callRecord.seller_complaint);
  const complianceViolation = Boolean(
    callRecord.complianceViolation ||
      callRecord.compliance_violation ||
      callRecord.dncViolation ||
      callRecord.dnc_violation
  );

  const normalized = {
    appointment: callRecord.appointmentBooked || callRecord.appointment_booked ? 1 : 0,
    contract: callRecord.contractSigned || callRecord.contract_signed ? 1 : 0,
    revenue: clamp01(profit / METRICS.revenue.target),
    survival: cancelled ? 0 : 1,
    trust: complaint || complianceViolation ? 0 : 1,
    profitPerLead: clamp01(profit / contactedLeads / METRICS.profitPerLead.target),
    commitmentTime:
      minutesToCommitment > 0
        ? clamp01(1 - minutesToCommitment / (METRICS.commitmentTime.target * 2))
        : 0,
    underwriting:
      predictedArv > 0 && actualArv > 0
        ? clamp01(
            1 -
              Math.abs(predictedArv - actualArv) /
                actualArv /
                Math.max(METRICS.underwriting.tolerance, 0.01)
          )
        : 0,
  };

  const components = Object.fromEntries(
    Object.entries(METRICS).map(([name, config]) => [
      name,
      Number((normalized[name] * config.weight).toFixed(2)),
    ])
  );
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);

  return {
    score: Number(Math.max(0, Math.min(100, score)).toFixed(2)),
    components,
    normalized,
    outcomes: {
      profit,
      contactedLeads,
      cancelled,
      complaint,
      complianceViolation,
      minutesToCommitment,
    },
  };
}

export function calculateRBPMetrics(records = []) {
  const rbp = (Array.isArray(records) ? records : []).filter(
    (record) => String(record.path || record.selectedPath || '').toLowerCase() === 'rbp'
  );
  const qualified = rbp.filter((record) => record.qualified !== false);
  const accepted = qualified.filter(
    (record) => record.accepted || record.contractSigned || record.contract_signed
  );
  const verifiedNetDeltas = rbp
    .map((record) => numberOr(record.rbpSellerNet) - numberOr(record.cashSellerNet))
    .filter((value) => value !== 0);
  return {
    qualifiedCount: qualified.length,
    acceptedCount: accepted.length,
    acceptanceRate: qualified.length ? accepted.length / qualified.length : 0,
    averageSellerNetImprovement: verifiedNetDeltas.length
      ? verifiedNetDeltas.reduce((sum, value) => sum + value, 0) / verifiedNetDeltas.length
      : 0,
    closedCount: accepted.filter((record) => record.closed).length,
  };
}
