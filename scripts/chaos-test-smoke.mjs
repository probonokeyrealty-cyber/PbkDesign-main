import assert from 'node:assert/strict';
import {
  runPbkChaosHarness,
  simulateEventWorkerRecovery,
  simulateSafetyBoundaryChaos,
} from './chaos-test.mjs';

const safety = await simulateSafetyBoundaryChaos();
assert.equal(safety.unsafeOffer.blocked, true, 'Chaos safety should block offers above MAO.');
assert.equal(safety.dncCall.blocked, true, 'Chaos safety should block DNC outreach.');
assert.equal(safety.missingConsentCall.blocked, true, 'Chaos safety should block outbound calls without TCPA consent.');
assert(
  safety.missingConsentCall.violations.some((item) => item.code === 'tcpa_consent_missing'),
  'Missing TCPA consent violation should be explicit.',
);

const recovery = await simulateEventWorkerRecovery();
assert.equal(recovery.firstPass.failed, 1, 'Worker chaos should capture the injected event failure.');
assert.equal(recovery.deadLetters.length, 1, 'Worker chaos should put failed event into dead-letter sink.');
assert.equal(recovery.secondPass.processed, 1, 'Worker chaos should continue processing after an injected failure.');
assert.equal(recovery.finalStatus.pendingMemoryEvents, 0, 'Worker chaos should drain the in-memory event queue.');

const report = await runPbkChaosHarness();
assert.equal(report.ok, true, 'Full PBK chaos harness should pass.');
assert(report.checks.length >= 2, 'Chaos harness should include safety and worker recovery checks.');

console.log('chaos-test smoke passed', {
  checks: report.checks.map((check) => check.name),
  deadLetters: recovery.deadLetters.length,
});
