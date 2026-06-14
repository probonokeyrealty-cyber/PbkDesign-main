import assert from 'node:assert/strict';
import { validateProviderActionSafety } from './safety-validator.mjs';

const safeOffer = validateProviderActionSafety('avaOverrideOffer', {
  finalOffer: 90000,
  mao: 100000,
  arv: 180000,
  repairs: 25000,
  qualificationVerified: true,
});

assert.equal(safeOffer.ok, true, 'Offer below MAO should pass safety validation.');
assert.equal(safeOffer.blocked, false, 'Safe offer should not be blocked.');

const highOffer = validateProviderActionSafety('avaOverrideOffer', {
  finalOffer: 115000,
  mao: 100000,
  qualificationVerified: true,
});

assert.equal(highOffer.ok, false, 'Offer above MAO should fail safety validation.');
assert.equal(highOffer.blocked, true, 'Offer above MAO should be blocked.');
assert(highOffer.violations.some((item) => item.code === 'offer_above_mao'), 'Offer above MAO violation should be explicit.');

const dncCall = validateProviderActionSafety('telnyx_call', {
  phone: '+15555550123',
  dnc: true,
});

assert.equal(dncCall.blocked, true, 'DNC calls must be blocked.');
assert(dncCall.violations.some((item) => item.code === 'dnc_block'), 'DNC violation should be explicit.');

const afterHoursCall = validateProviderActionSafety('telnyx_call', {
  phone: '+15555550123',
  dnc: false,
}, { nowLocalHour: 22 });

assert.equal(afterHoursCall.blocked, true, 'After-hours calls must be blocked.');
assert(afterHoursCall.violations.some((item) => item.code === 'outside_calling_hours'), 'Calling-hours violation should be explicit.');

const missingConsentCall = validateProviderActionSafety('telnyx_call', {
  phone: '+15555550123',
  dnc: false,
  tcpaConsent: false,
}, { nowLocalHour: 12 });

assert.equal(missingConsentCall.blocked, true, 'Explicitly missing TCPA consent must block outbound calls.');
assert(missingConsentCall.violations.some((item) => item.code === 'tcpa_consent_missing'), 'TCPA consent violation should be explicit.');

const manualOneToOneSmsUnknownConsent = validateProviderActionSafety('telnyx_sms', {
  phone: '+15555550123',
  dnc: false,
  consentStatus: 'unknown',
  manual: true,
  manualSend: true,
  source: 'unified_inbox_manual',
  requestedBy: 'unified-inbox-manual',
});

assert.equal(
  manualOneToOneSmsUnknownConsent.blocked,
  false,
  'Manual one-to-one inbox SMS with reviewable consent must not 409 before provider dispatch.'
);
assert(
  !manualOneToOneSmsUnknownConsent.violations.some(
    (item) => item.code === 'tcpa_consent_missing'
  ),
  'Manual one-to-one inbox SMS must not be treated like automated marketing consent failure.'
);

const manualOneToOneSmsDeniedConsent = validateProviderActionSafety('telnyx_sms', {
  phone: '+15555550123',
  dnc: false,
  consentStatus: 'denied',
  manual: true,
  manualSend: true,
  source: 'unified_inbox_manual',
  requestedBy: 'unified-inbox-manual',
});

assert.equal(
  manualOneToOneSmsDeniedConsent.blocked,
  true,
  'Manual one-to-one inbox SMS must still block denied consent.'
);

const missingMaoOffer = validateProviderActionSafety('sendDocuSign', {
  finalOffer: 95000,
  qualificationVerified: true,
});

assert.equal(missingMaoOffer.blocked, false, 'Missing MAO should not hard-block existing approval flow.');
assert.equal(missingMaoOffer.approvalRequired, true, 'Missing MAO should force approval/review.');
assert(missingMaoOffer.warnings.some((item) => item.code === 'mao_missing'), 'Missing MAO warning should be explicit.');

const distressedSellerOffer = validateProviderActionSafety('sendDocuSign', {
  finalOffer: 90000,
  mao: 100000,
  emotion: 'anger',
  qualificationVerified: true,
});

assert.equal(distressedSellerOffer.blocked, false, 'Seller emotion should route to review instead of hard-blocking.');
assert.equal(distressedSellerOffer.result, 'safety_review_required');
assert(
  distressedSellerOffer.warnings.some((item) => item.code === 'emotion_requires_review'),
  'Emotion review warning should be explicit.',
);

const missingBantOffer = validateProviderActionSafety('sendDocuSign', {
  finalOffer: 90000,
  mao: 100000,
});

assert.equal(missingBantOffer.blocked, true, 'Seller-facing contracts must be blocked until BANT+ proof is captured.');
assert(
  missingBantOffer.violations.some((item) => item.code === 'bant_incomplete'),
  'BANT+ qualification violation should be explicit.'
);

const qualifiedBantOffer = validateProviderActionSafety('sendDocuSign', {
  finalOffer: 90000,
  mao: 100000,
  bant: {
    budget: '$100k',
    authority: 'owner confirmed',
    need: 'avoid repairs',
    timeline: '30 days',
    urgency: 'vacant property',
  },
});

assert.equal(qualifiedBantOffer.blocked, false, 'Complete BANT+ proof should unlock seller-facing contract safety.');

console.log('safety-validator smoke passed', {
  safeOffer: safeOffer.result,
  highOffer: highOffer.result,
  dncCall: dncCall.result,
  afterHoursCall: afterHoursCall.result,
  missingConsentCall: missingConsentCall.result,
  distressedSellerOffer: distressedSellerOffer.result,
  missingBantOffer: missingBantOffer.result,
  manualOneToOneSmsUnknownConsent: manualOneToOneSmsUnknownConsent.result,
  manualOneToOneSmsDeniedConsent: manualOneToOneSmsDeniedConsent.result,
});
