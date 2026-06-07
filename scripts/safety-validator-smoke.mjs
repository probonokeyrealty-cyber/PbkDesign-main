import assert from 'node:assert/strict';
import { validateProviderActionSafety } from './safety-validator.mjs';

const safeOffer = validateProviderActionSafety('avaOverrideOffer', {
  finalOffer: 90000,
  mao: 100000,
  arv: 180000,
  repairs: 25000,
});

assert.equal(safeOffer.ok, true, 'Offer below MAO should pass safety validation.');
assert.equal(safeOffer.blocked, false, 'Safe offer should not be blocked.');

const highOffer = validateProviderActionSafety('avaOverrideOffer', {
  finalOffer: 115000,
  mao: 100000,
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

const missingMaoOffer = validateProviderActionSafety('sendDocuSign', {
  finalOffer: 95000,
});

assert.equal(missingMaoOffer.blocked, false, 'Missing MAO should not hard-block existing approval flow.');
assert.equal(missingMaoOffer.approvalRequired, true, 'Missing MAO should force approval/review.');
assert(missingMaoOffer.warnings.some((item) => item.code === 'mao_missing'), 'Missing MAO warning should be explicit.');

const distressedSellerOffer = validateProviderActionSafety('sendDocuSign', {
  finalOffer: 90000,
  mao: 100000,
  emotion: 'anger',
});

assert.equal(distressedSellerOffer.blocked, false, 'Seller emotion should route to review instead of hard-blocking.');
assert.equal(distressedSellerOffer.result, 'safety_review_required');
assert(
  distressedSellerOffer.warnings.some((item) => item.code === 'emotion_requires_review'),
  'Emotion review warning should be explicit.',
);

console.log('safety-validator smoke passed', {
  safeOffer: safeOffer.result,
  highOffer: highOffer.result,
  dncCall: dncCall.result,
  afterHoursCall: afterHoursCall.result,
  missingConsentCall: missingConsentCall.result,
  distressedSellerOffer: distressedSellerOffer.result,
});
