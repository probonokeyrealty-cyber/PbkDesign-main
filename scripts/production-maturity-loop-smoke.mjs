import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildCanaryPromotionGate,
  buildFailedCallEvalGate,
  classifySellerFinalOutcome,
  createProviderCircuitBreaker,
  createRuntimeEventArchive,
  scoreSkillOutcomeConfidence,
} from './production-maturity-loop.mjs';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const bridgeSource = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');

let currentTime = new Date('2026-06-13T21:00:00.000Z').getTime();
const now = () => currentTime;

const storedEvents = [];
const archive = createRuntimeEventArchive({
  now,
  writer: async (event) => {
    storedEvents.push(event);
    return { id: `runtime-event-${storedEvents.length}` };
  },
});

const archived = await archive.recordEvent({
  eventType: 'provider_call',
  source: 'telnyx',
  severity: 'info',
  leadId: 'lead-1',
  callId: 'call-1',
  metadata: { action: 'send_sms' },
});

assert.equal(archived.ok, true, 'Runtime event archive should write valid events.');
assert.equal(archived.result, 'runtime_event_archived');
assert.equal(storedEvents[0].event_type, 'provider_call');
assert.equal(storedEvents[0].metadata.action, 'send_sms');

const fallbackEvents = [];
const failingArchive = createRuntimeEventArchive({
  now,
  writer: async () => {
    throw new Error('postgres unavailable');
  },
  fallbackSink: (event) => fallbackEvents.push(event),
});

const failedArchive = await failingArchive.recordEvent({
  eventType: 'error',
  source: 'deepseek',
  severity: 'high',
  metadata: { reason: 'timeout' },
});

assert.equal(failedArchive.ok, false, 'Archive write failures should be explicit.');
assert.equal(failedArchive.nonBlocking, true, 'Archive write failures must not block seller-critical flow.');
assert.equal(failedArchive.operatorVisible, true, 'Archive failures must be operator-visible.');
assert.equal(fallbackEvents.length, 1, 'Archive write failures must enter a fallback sink.');

const circuitEvents = [];
const breaker = createProviderCircuitBreaker({
  now,
  failureThreshold: 3,
  cooldownMs: 60_000,
  onEvent: (event) => circuitEvents.push(event),
});

for (let attempt = 1; attempt <= 3; attempt += 1) {
  const result = await breaker.execute('telnyx', async () => {
    throw new Error(`telnyx failed ${attempt}`);
  });
  assert.equal(result.ok, false, `Provider failure ${attempt} should be explicit.`);
}

const openStatus = breaker.getStatus('telnyx');
assert.equal(openStatus.state, 'open', 'Three provider failures should open the circuit.');
assert(circuitEvents.some((event) => event.eventType === 'circuit_breaker_open'), 'Opening a circuit should emit an event.');

const openResult = await breaker.execute(
  'telnyx',
  async () => ({ ok: true }),
  async () => ({ ok: true, fallback: true, result: 'queued_for_retry' })
);
assert.equal(openResult.ok, false, 'Open circuit should not report the provider action as successful.');
assert.equal(openResult.result, 'provider_circuit_open');
assert.equal(openResult.providerAttempted, false, 'Open circuit should avoid provider execution.');
assert.equal(openResult.fallback.result, 'queued_for_retry', 'Open circuit should return the fallback result.');

currentTime += 61_000;
const halfOpenResult = await breaker.execute('telnyx', async () => ({
  ok: true,
  providerMessageId: 'sms-1',
}));
assert.equal(halfOpenResult.ok, true, 'Circuit should allow half-open success after cooldown.');
assert.equal(breaker.getStatus('telnyx').state, 'closed', 'Successful half-open probe should close the circuit.');

assert.equal(
  classifySellerFinalOutcome({ outcomeLabel: 'Seller signed contract and DocuSign completed.' }).finalOutcome,
  'contract',
  'Contract/signature events should be classified as contract outcomes.'
);
assert.equal(
  classifySellerFinalOutcome({ outcomeLabel: 'Callback scheduled for Thursday at 3pm.' }).finalOutcome,
  'followup',
  'Specific callbacks and scheduled follow-ups should train as followup outcomes.'
);
assert.equal(
  classifySellerFinalOutcome({ outcomeLabel: 'Seller requested do not call / DNC.' }).finalOutcome,
  'dnc',
  'DNC requests must be treated as high-risk final outcomes.'
);
assert.equal(
  classifySellerFinalOutcome({ outcomeLabel: 'Seller ghosted after offer.' }).finalOutcome,
  'ghosted',
  'Ghosting must be measured separately from generic loss.'
);
assert.equal(
  classifySellerFinalOutcome({ outcomeLabel: 'Seller complaint about pressure.' }).finalOutcome,
  'complaint',
  'Seller complaints must be measured separately from generic loss.'
);

const confidence = scoreSkillOutcomeConfidence({
  previousConfidence: 62,
  usages: [
    ...Array.from({ length: 8 }, (_, index) => ({ finalOutcome: index % 2 ? 'contract' : 'appointment' })),
    { finalOutcome: 'followup' },
    { finalOutcome: 'complaint' },
    { finalOutcome: 'ghosted' },
    { finalOutcome: 'dnc' },
  ],
});
assert.equal(confidence.sampleSize, 12, 'Outcome confidence should count all measured usages.');
assert(confidence.newConfidence < 80, 'Complaints, DNC, and ghosting should reduce confidence.');
assert(confidence.newConfidence > 40, 'Strong wins should still preserve useful skill confidence.');
assert.equal(confidence.policy, 'measured_outcome_update');

const sparseConfidence = scoreSkillOutcomeConfidence({
  previousConfidence: 71,
  minSamples: 10,
  usages: [{ finalOutcome: 'contract' }],
});
assert.equal(sparseConfidence.newConfidence, 71, 'Sparse samples should not overfit confidence.');
assert.equal(sparseConfidence.policy, 'insufficient_sample_hold');

const failedCallGate = buildFailedCallEvalGate({
  scenarios: [
    { id: 'already-gave-price', passed: true },
    { id: 'stop-repeating', passed: false, reason: 'asked duplicate question' },
  ],
});
assert.equal(failedCallGate.ready, false, 'Failed real-call evals should block release confidence.');
assert.deepEqual(failedCallGate.failedScenarioIds, ['stop-repeating']);

const promotionGate = buildCanaryPromotionGate({
  canaryHealth: { ready: true },
  behaviorGate: { ready: true },
  failedCallEvalGate: { ready: true },
  silentErrorReport: { launchReady: true, blockers: [] },
  sloStatus: { burned: [] },
});
assert.equal(promotionGate.ready, true, 'Canary promotion should pass only when all maturity gates are ready.');

const blockedPromotion = buildCanaryPromotionGate({
  canaryHealth: { ready: true },
  behaviorGate: { ready: true },
  failedCallEvalGate: failedCallGate,
  silentErrorReport: { launchReady: false, blockers: [{ code: 'state_stale' }] },
  sloStatus: { burned: ['manualSend'] },
});
assert.equal(blockedPromotion.ready, false, 'Canary promotion must block on eval, silent-error, or SLO failures.');
assert(blockedPromotion.blockers.includes('failed_call_eval'), 'Promotion should include failed-call blocker.');
assert(blockedPromotion.blockers.includes('silent_error_blockers'), 'Promotion should include silent-error blocker.');
assert(blockedPromotion.blockers.includes('slo_budget_burned:manualsend'), 'Promotion should include SLO blocker.');

assert.equal(
  packageJson.scripts?.['test:production-maturity-loop'],
  'node ./scripts/production-maturity-loop-smoke.mjs',
  'package.json must expose the production maturity loop smoke.'
);
assert(
  packageJson.scripts?.['test:production-hardening']?.includes('test:production-maturity-loop'),
  'Production hardening must include the production maturity loop smoke.'
);
assert(
  bridgeSource.includes('createRuntimeEventArchive') &&
    bridgeSource.includes('createProviderCircuitBreaker') &&
    bridgeSource.includes('buildCanaryPromotionGate'),
  'Bridge must wire runtime archive, provider circuit breakers, and canary promotion gates.'
);
assert(
  bridgeSource.includes('/api/runtime/events/status') &&
    bridgeSource.includes('/api/runtime/archive') &&
    bridgeSource.includes('/api/provider-circuits/status') &&
    bridgeSource.includes('/api/circuit/status') &&
    bridgeSource.includes('/api/production/maturity'),
  'Bridge must expose production maturity, runtime event archive, and provider circuit status endpoints.'
);

console.log('production-maturity-loop-smoke: ok');
