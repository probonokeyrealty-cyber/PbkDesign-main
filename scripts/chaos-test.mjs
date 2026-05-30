import { fileURLToPath } from 'node:url';
import { EventTypes, consumeOnce, createEventBus, getEventBusStatus, publishEvent } from './event-bus/streams.mjs';
import { validateProviderActionSafety } from './safety-validator.mjs';

function buildCheck(name, ok, details = {}) {
  return {
    name,
    ok: Boolean(ok),
    details,
  };
}

export async function simulateSafetyBoundaryChaos() {
  const unsafeOffer = validateProviderActionSafety('sendDocuSign', {
    leadId: 'chaos-lead-offer',
    leadName: 'Chaos Safety Seller',
    email: 'chaos-safety@example.com',
    offerAmount: 125000,
    mao: 100000,
    arv: 170000,
    repairs: 20000,
    minProfit: 20000,
  });

  const dncCall = validateProviderActionSafety('telnyx_call', {
    leadId: 'chaos-lead-dnc',
    phone: '+16145550199',
    dnc: true,
    tcpaConsent: true,
  }, { nowLocalHour: 12 });

  const missingConsentCall = validateProviderActionSafety('telnyx_call', {
    leadId: 'chaos-lead-consent',
    phone: '+16145550200',
    dnc: false,
    tcpaConsent: false,
  }, { nowLocalHour: 12 });

  return {
    ok: unsafeOffer.blocked && dncCall.blocked && missingConsentCall.blocked,
    unsafeOffer,
    dncCall,
    missingConsentCall,
  };
}

export async function simulateEventWorkerRecovery() {
  const bus = createEventBus({
    mode: 'memory',
    streamName: 'pbk:chaos:events',
    consumerGroup: 'pbk-chaos-consumers',
    consumerName: 'pbk-chaos-smoke',
  });
  const deadLetters = [];
  const processed = [];

  await publishEvent(EventTypes.CALL_COMPLETED, {
    callId: 'chaos-call-fail-first',
    outcome: 'injected_failure',
  }, 'chaos-test', { bus });

  const firstPass = await consumeOnce(async (event) => {
    throw new Error(`Injected chaos failure for ${event.payload.callId || event.id}`);
  }, {
    bus,
    batchSize: 1,
    blockMs: 0,
    deadLetterSink: async (record) => deadLetters.push(record),
  });

  await publishEvent(EventTypes.CALL_COMPLETED, {
    callId: 'chaos-call-recovery',
    outcome: 'recovered',
  }, 'chaos-test', { bus });

  const secondPass = await consumeOnce(async (event) => {
    processed.push(event);
  }, {
    bus,
    batchSize: 1,
    blockMs: 0,
    deadLetterSink: async (record) => deadLetters.push(record),
  });

  const finalStatus = await getEventBusStatus({ bus });
  return {
    ok: firstPass.failed === 1
      && deadLetters.length === 1
      && secondPass.processed === 1
      && finalStatus.pendingMemoryEvents === 0,
    firstPass,
    secondPass,
    deadLetters,
    processed,
    finalStatus,
  };
}

export async function runPbkChaosHarness() {
  const safety = await simulateSafetyBoundaryChaos();
  const workerRecovery = await simulateEventWorkerRecovery();
  const checks = [
    buildCheck('safety_boundaries_block_unsafe_actions', safety.ok, {
      unsafeOffer: safety.unsafeOffer.result,
      dncCall: safety.dncCall.result,
      missingConsentCall: safety.missingConsentCall.result,
    }),
    buildCheck('event_worker_recovers_after_handler_failure', workerRecovery.ok, {
      firstPass: workerRecovery.firstPass,
      secondPass: workerRecovery.secondPass,
      deadLetters: workerRecovery.deadLetters.length,
      finalStatus: workerRecovery.finalStatus,
    }),
  ];

  return {
    ok: checks.every((check) => check.ok),
    mode: 'safe-simulated-chaos',
    destructive: false,
    checks,
  };
}

async function main() {
  const report = await runPbkChaosHarness();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[pbk-chaos-test] failed:', error);
    process.exit(1);
  });
}
