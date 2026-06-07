const PROVIDER_WRITE_TOOLS = new Set([
  'telnyx_call',
  'telnyx_sms',
  'send_verification_sms',
  'sendColdEmail',
  'sendDocuSign',
  'sendContract',
  'prepare_and_send_contract',
  'avaOverrideOffer',
  'pbkSendNegotiationApproval',
  'sendNegotiationApproval',
  'scheduleAppointment',
  'updateCRM',
  'launch_campaign',
  'admin_update_env_var',
]);

const OFFER_TOOLS = new Set([
  'avaOverrideOffer',
  'sendDocuSign',
  'sendContract',
  'prepare_and_send_contract',
  'pbkSendNegotiationApproval',
  'sendNegotiationApproval',
]);

const CALL_TOOLS = new Set(['telnyx_call', 'send_verification_sms']);
const MESSAGE_TOOLS = new Set(['telnyx_sms', 'sendColdEmail']);

function normalizeToolName(value = '') {
  return String(value || '').trim();
}

function money(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  const match = raw.replace(/[$,\s]/g, '').match(/^(-?\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallback;
  if (match[2] === 'm') return Math.round(amount * 1_000_000);
  if (match[2] === 'k') return Math.round(amount * 1_000);
  return Math.round(amount);
}

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|y|dnc|blocked)$/i.test(String(value || '').trim());
}

function falseBool(value) {
  if (typeof value === 'boolean') return value === false;
  return /^(0|false|no|n|missing|denied|revoked|unknown|none)$/i.test(String(value || '').trim());
}

function getOfferAmount(params = {}) {
  return money(
    params.finalOffer
      ?? params.final_offer
      ?? params.approvedOffer
      ?? params.approved_offer
      ?? params.offerAmount
      ?? params.offer_amount
      ?? params.offer
      ?? params.price
      ?? params.amount,
    0,
  );
}

function getMao(params = {}) {
  return money(params.mao ?? params.maxAllowableOffer ?? params.max_allowable_offer ?? params.originalMao ?? params.original_mao, 0);
}

function getCallingHour(options = {}) {
  if (Number.isFinite(Number(options.nowLocalHour ?? options.now_local_hour))) return Number(options.nowLocalHour ?? options.now_local_hour);
  return new Date().getHours();
}

function hasDncFlag(params = {}) {
  return bool(params.dnc)
    || bool(params.doNotCall)
    || bool(params.do_not_call)
    || bool(params.isDnc)
    || bool(params.is_dnc)
    || bool(params.metadata?.dnc)
    || bool(params.lead?.dnc);
}

function getConsentValue(params = {}) {
  return params.tcpaConsent
    ?? params.tcpConsent
    ?? params.tcp_consent
    ?? params.tcpa_consent
    ?? params.hasTcpaConsent
    ?? params.has_tcpa_consent
    ?? params.consent
    ?? params.consentStatus
    ?? params.consent_status
    ?? params.metadata?.tcpaConsent
    ?? params.metadata?.tcp_consent
    ?? params.metadata?.consentStatus
    ?? params.lead?.tcpaConsent
    ?? params.lead?.tcp_consent
    ?? params.lead?.consentStatus;
}

function hasKnownMissingConsent(params = {}) {
  const value = getConsentValue(params);
  if (value === undefined || value === null || value === '') return false;
  return falseBool(value) || /^(missing|denied|revoked|unknown|none|opted[_ -]?out)$/i.test(String(value || '').trim());
}

function requiresTcpaConsent(params = {}, options = {}) {
  return bool(options.requireTcpaConsent)
    || bool(options.require_tcpa_consent)
    || bool(params.requireTcpaConsent)
    || bool(params.require_tcpa_consent);
}

function hasAffirmativeConsent(params = {}) {
  const value = getConsentValue(params);
  return bool(value) || /^(consented|opted[_ -]?in|yes|valid|verified)$/i.test(String(value || '').trim());
}

function pushIssue(list, code, message, severity = 'high', evidence = {}) {
  list.push({ code, message, severity, evidence });
}

export function validateProviderActionSafety(toolName, params = {}, options = {}) {
  const tool = normalizeToolName(toolName);
  const violations = [];
  const warnings = [];
  const providerWrite = PROVIDER_WRITE_TOOLS.has(tool);

  if (!providerWrite) {
    return {
      ok: true,
      result: 'safety_not_required',
      blocked: false,
      approvalRequired: false,
      providerWrite: false,
      violations,
      warnings,
    };
  }

  if (OFFER_TOOLS.has(tool)) {
    const offer = getOfferAmount(params);
    const mao = getMao(params);
    if (offer > 0 && mao > 0 && offer > mao) {
      pushIssue(violations, 'offer_above_mao', `Offer ${offer} exceeds MAO ${mao}.`, 'critical', { offer, mao });
    }
    if (offer > 0 && !mao) {
      pushIssue(warnings, 'mao_missing', 'MAO is missing; require human review before seller-facing offer or contract.', 'medium', { offer });
    }
    const arv = money(params.arv ?? params.afterRepairValue ?? params.after_repair_value, 0);
    const repairs = money(params.repairs ?? params.repairTotal ?? params.repair_total, 0);
    const minMargin = money(params.minProfit ?? params.min_profit ?? params.minimumProfit ?? params.minimum_profit, 10000);
    if (offer > 0 && arv > 0) {
      const projectedMargin = arv - repairs - offer;
      if (projectedMargin < minMargin) {
        pushIssue(violations, 'profit_margin_below_floor', `Projected margin ${projectedMargin} is below floor ${minMargin}.`, 'critical', {
          offer,
          arv,
          repairs,
          projectedMargin,
          minMargin,
        });
      }
    }
  }

  if (CALL_TOOLS.has(tool) || MESSAGE_TOOLS.has(tool)) {
    if (hasDncFlag(params)) {
      pushIssue(violations, 'dnc_block', 'Lead is marked DNC; provider outreach is blocked.', 'critical');
    }
    if (hasKnownMissingConsent(params) || (requiresTcpaConsent(params, options) && !hasAffirmativeConsent(params))) {
      pushIssue(
        violations,
        'tcpa_consent_missing',
        'TCPA consent is missing, denied, or not verified for outbound provider outreach.',
        'critical',
        { consent: getConsentValue(params) ?? null, requireTcpaConsent: requiresTcpaConsent(params, options) },
      );
    }
  }

  if (CALL_TOOLS.has(tool)) {
    const hour = getCallingHour(options);
    const startHour = numberOr(options.callStartHour ?? options.call_start_hour ?? params.callStartHour ?? params.call_start_hour, 8);
    const endHour = numberOr(options.callEndHour ?? options.call_end_hour ?? params.callEndHour ?? params.call_end_hour, 20);
    if (hour < startHour || hour >= endHour) {
      pushIssue(violations, 'outside_calling_hours', `Local hour ${hour} is outside calling window ${startHour}-${endHour}.`, 'critical', {
        hour,
        startHour,
        endHour,
      });
    }
  }

  const blocked = violations.some((item) => ['critical', 'high'].includes(item.severity));
  return {
    ok: !blocked,
    result: blocked ? 'safety_blocked' : warnings.length ? 'safety_review_required' : 'safety_passed',
    blocked,
    approvalRequired: blocked || warnings.length > 0 || providerWrite,
    providerWrite,
    toolName: tool,
    violations,
    warnings,
  };
}
