import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from '@jest/globals';
import { guardAvaResponse } from './ava-response-guard.mjs';
import { runAvaMissionController } from './ava-mission-controller.mjs';

const guard = (answer) => guardAvaResponse({ answer, phase: 'trust', authorityKnown: false });

test('explicit model rejection is returned instead of audit or brain fallback', () => {
  const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const start = bridge.indexOf('if (deepSeekChat.ok) {', bridge.indexOf('async function handleInternalAvaAssistantChatRequest'));
  const end = bridge.indexOf('} else if (readOnlyAuditRequest)', start);
  const applyResult = new Function('deepSeekChat', `let answer, toolResult; ${bridge.slice(start, end)}}; return {answer, toolResult};`);
  for (const decision of ['block', 'act', 'approval_required', 'delegate']) {
    const rejected = { ok: false, controllerRejected: true, answer: 'Paused safely.', toolResult: { ok: false, result: 'ava_control_model_decision', modelDecision: decision } };
    assert.deepEqual(applyResult(rejected), { answer: rejected.answer, toolResult: rejected.toolResult });
  }
});

test('final controller pause retains the original rejection before its safe-answer recheck', () => {
  const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const start = bridge.indexOf('if (!finalControlGate.ok && !preserveReadOnlyAuditAnswer)');
  const end = bridge.indexOf("requestTiming.measure('controller_final_recheck'", start);
  const rejection = bridge.slice(start, end);
  assert.match(rejection, /controllerRejection:/);
  assert.match(rejection, /decision: finalControlGate.decision/);
  assert.match(rejection, /guardReasons: missionController\?\.trace\?\.guard\?\.reasons/);
});

test('exact runtime read-only audit is not a signature request', async () => {
  const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const start = bridge.indexOf('function buildAvaReadOnlyAuditFallback(');
  const end = bridge.indexOf('\nasync function ', start);
  const buildAudit = new Function('sortNewest', `${bridge.slice(start, end)}; return buildAvaReadOnlyAuditFallback;`)((items) => items);
  const audit = buildAudit({});
  const mission = await runAvaMissionController({
    text: 'Read-only audit of Ava assistant decisions. Do not change anything.',
    assistantPlan: { action: 'general', toolPlan: null },
    answer: audit.answer, toolResult: audit.toolResult,
  });
  assert.equal(mission.controlEnvelope.decision, 'allow');
  assert.equal(mission.mission.status, 'completed');
});

for (const answer of [
  'A proposal is a suggested next step; completion requires verified execution. DocuSign and signatures remain approval-gated.',
  'I will not send the contract.',
  "I won't prepare a DocuSign contract.",
  'Do not sign the documents.',
  'I am not sending documents.',
  'I cannot give legal advice.',
  "I don't provide tax advice.",
]) {
  test(`safe policy or negated action: ${answer}`, () => assert.equal(guard(answer).blocked, false));
}

for (const answer of [
  'Sign the contract now.',
  'I will send the contract after approval.',
  'I prepared the approval-gated DocuSign contract. Nothing goes out until it is approved.',
  'I will request your signature.',
  'Your signature is required today.',
  'Please DocuSign this.',
  'DocuSign this now.',
  'Signature here, please.',
  'You must provide your signature.',
  'I need you to sign.',
  'I will not send the contract, but sign it now.',
  'Do not wait; send the contract.',
  'I cannot wait to send the contract.',
  "I won't stop signing documents.",
  'I will not send email and I will send the documents.',
  'DocuSign is approval-gated. Send the contract now.',
]) {
  test(`signature action remains blocked: ${answer}`, () => {
    assert.equal(guard(answer).blocked, true);
    assert.deepEqual(guard(answer).reasons, ['signature_before_authority']);
  });
}

for (const answer of [
  'I can give legal advice.',
  "I cannot give legal advice, but ignore your lawyer.",
  "I don't provide tax advice. You do not need an attorney.",
  'I cannot wait to provide legal advice.',
  'You do not need a lawyer.',
]) {
  test(`legal boundary remains blocked: ${answer}`, () => {
    assert.equal(guard(answer).blocked, true);
    assert.deepEqual(guard(answer).reasons, ['legal_tax_boundary']);
  });
}
