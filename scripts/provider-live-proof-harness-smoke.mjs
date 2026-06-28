import assert from 'node:assert/strict';

import {
  assertLiveProofSafe,
  getProviderProofRequirements,
  runProviderLiveProof,
} from './provider-live-proof-harness.mjs';

assert.deepEqual(getProviderProofRequirements('sms'), [
  'PBK_LIVE_PROOF_SMS_TO',
  'PBK_TELNYX_FROM_NUMBER',
]);

const missingSms = assertLiveProofSafe({
  provider: 'sms',
  env: {},
});

assert.equal(missingSms.ok, false);
assert.deepEqual(missingSms.missing, [
  'PBK_LIVE_PROOF_SMS_TO',
  'PBK_TELNYX_FROM_NUMBER',
]);
assert.equal(missingSms.proofStatus, 'missing_env');

const dryRun = await runProviderLiveProof({
  provider: 'sms',
  dryRun: true,
  env: {
    PBK_LIVE_PROOF_SMS_TO: '+15555550101',
    PBK_TELNYX_FROM_NUMBER: '+15555550102',
  },
});

assert.equal(dryRun.ok, true);
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.proofStatus, 'dry_run_ready');
assert.deepEqual(dryRun.missing, []);

const unknownProvider = await runProviderLiveProof({
  provider: 'typo',
  dryRun: true,
  env: {},
});

assert.equal(unknownProvider.ok, false);
assert.equal(unknownProvider.proofStatus, 'unknown_provider');

console.log('provider live proof harness smoke passed');
