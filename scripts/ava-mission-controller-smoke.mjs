#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runAvaMissionController } from './ava-mission-controller.mjs';

const mission = await runAvaMissionController({
  sessionId: 'ava_chat_controller_smoke',
  text: 'Analyze 202 Cherry Ln and tell Rex to review the next move.',
  leadId: 'lead-202',
  source: 'ava-chat-page',
  assistantIntent: { intent: 'analyze_deal', address: '202 Cherry Ln' },
  assistantPlan: {
    action: 'tool_plan',
    usedIntent: 'analyze_deal',
    toolPlan: {
      toolName: 'analyzeDeal',
      requiresBridgeConfirmation: true,
      providerWrite: false,
      params: { address: '202 Cherry Ln' },
    },
  },
  answer: 'I finished the deal math for 202 Cherry Ln.',
  toolResult: { ok: true, result: 'deal_analyzed' },
  assistantSession: {
    history: [
      { role: 'user', content: 'Remember this seller wants speed.' },
      { role: 'assistant', content: 'Saved.' },
    ],
  },
  state: {
    leadImports: [
      {
        id: 'lead-202',
        leadId: 'lead-202',
        leadName: 'Terry Seller',
        address: '202 Cherry Ln',
        mao: 180000,
      },
    ],
  },
});

assert.equal(mission.ok, true, 'Mission controller should return ok.');
assert.equal(mission.result, 'ava_mission_controller_ready', 'Mission controller should identify its result.');
assert.equal(mission.mission?.schema, 'pbk.ava.mission_controller.v1', 'Mission ledger should be versioned.');
assert.equal(mission.mission?.sessionId, 'ava_chat_controller_smoke', 'Mission ledger should retain session id.');
assert.equal(mission.mission?.leadId, 'lead-202', 'Mission ledger should retain lead id.');
assert.equal(mission.mission?.status, 'completed', 'Successful readonly tool plans should produce completed mission status.');
assert.equal(mission.mission?.steps?.[0]?.id, 'understand', 'Mission ledger should begin with the user goal.');
assert.equal(mission.mission?.steps?.some((step) => step.id === 'orchestrate'), true, 'Mission ledger should include the orchestrator step.');
assert.equal(mission.mission?.steps?.some((step) => step.id === 'execute'), true, 'Mission ledger should include execution status.');
assert.equal(mission.trace?.controllerPath, 'orchestrateAvaTurn', 'Trace should prove the rich Ava orchestrator was used.');
assert.equal(mission.trace?.intent, 'analyze_deal', 'Trace should preserve detected intent.');
assert.equal(mission.trace?.toolName, 'analyzeDeal', 'Trace should preserve planned tool.');
assert.ok(mission.trace?.turnDecision?.nextMoveType, 'Trace should expose turn decision.');
assert.ok(mission.trace?.workingMemory?.brief, 'Trace should expose working memory brief.');
assert.ok(mission.trace?.actionDecision?.decision, 'Trace should expose action decision.');
assert.equal(mission.trace?.unison?.revision, 'ava-intelligence-unison-v1', 'Trace should expose Ava intelligence unison status.');
assert.equal(mission.controlEnvelope?.schema, 'pbk.ava.control_envelope.v1', 'Mission controller should return a versioned hard-control envelope.');
assert.equal(mission.controlEnvelope?.decision, 'allow', 'Readonly tool plans should be allowed by the control envelope.');
assert.equal(mission.controlEnvelope?.authorizesExecution, true, 'Readonly tool plans should be execution-authorized.');
assert.equal(mission.controlEnvelope?.exactAction?.toolName, 'analyzeDeal', 'Control envelope should bind the exact planned tool.');
assert.ok(mission.controlEnvelope?.controllerDecisionId, 'Control envelope should carry a durable controller decision id.');

const approvalMission = await runAvaMissionController({
  sessionId: 'ava_chat_controller_approval_smoke',
  text: 'Text the seller after approval.',
  assistantIntent: { intent: 'send_sms', phone: '+16575001765' },
  assistantPlan: {
    action: 'approval_required',
    usedIntent: 'send_sms',
    toolPlan: {
      toolName: 'telnyx_sms',
      providerWrite: true,
      params: { to: '+16575001765', message: 'Canary proof text', forceApproval: true },
    },
  },
  answer: 'I prepared the approval-gated text. Nothing goes out until it is approved.',
  toolResult: { ok: true, result: 'queued_for_approval', approvalId: 'approval-1' },
});

assert.equal(approvalMission.mission?.status, 'waiting_on_approval', 'Approval-gated provider writes should wait on approval.');
assert.equal(approvalMission.mission?.approvalRequired, true, 'Mission should make approval requirement explicit.');
assert.equal(approvalMission.trace?.actionPolicy?.providerWritesBlocked, true, 'Trace should preserve provider-write safety policy.');
assert.equal(approvalMission.controlEnvelope?.decision, 'approval_required', 'Provider writes should be approval-required until the approval rail clears them.');
assert.equal(approvalMission.controlEnvelope?.authorizesExecution, false, 'Approval-required provider writes should not be execution-authorized.');
assert.equal(approvalMission.controlEnvelope?.exactAction?.toolName, 'telnyx_sms', 'Approval envelope should bind the exact provider action.');
assert.equal(approvalMission.controlEnvelope?.approvalRequired, true, 'Approval envelope should make approval explicit.');
assert.ok(
  approvalMission.controlEnvelope?.proofRequirements?.includes('approval_receipt'),
  'Approval envelope should require approval proof.'
);

const blockedContractMission = await runAvaMissionController({
  sessionId: 'ava_chat_controller_blocked_contract_smoke',
  text: 'Send DocuSign contract for 202 Cherry Ln.',
  assistantIntent: { intent: 'contract_send', address: '202 Cherry Ln' },
  assistantPlan: {
    action: 'approval_required',
    usedIntent: 'contract_send',
    toolPlan: {
      toolName: 'prepare_and_send_contract',
      providerWrite: true,
      params: { address: '202 Cherry Ln', forceApproval: true },
    },
  },
  answer: 'I prepared the approval-gated DocuSign contract. Nothing goes out until it is approved.',
  toolResult: { ok: true, result: 'queued_for_approval', approvalId: 'approval-contract' },
});

assert.equal(blockedContractMission.controlEnvelope?.decision, 'blocked', 'Guard-blocked contract actions must not be downgraded to approval-required.');
assert.equal(blockedContractMission.controlEnvelope?.authorizesExecution, false, 'Guard-blocked contract actions must not authorize execution.');

const unsafeProviderWriteMission = await runAvaMissionController({
  sessionId: 'ava_chat_controller_unsafe_provider_write_smoke',
  text: 'Text the seller now.',
  assistantIntent: { intent: 'send_sms', phone: '+16575001765' },
  assistantPlan: {
    action: 'tool_plan',
    usedIntent: 'send_sms',
    toolPlan: {
      toolName: 'telnyx_sms',
      providerWrite: true,
      params: { to: '+16575001765', message: 'Canary proof text' },
    },
  },
  answer: '',
  toolResult: null,
});

assert.equal(unsafeProviderWriteMission.controlEnvelope?.decision, 'approval_required', 'Provider-write tool plans must be converted to approval-required.');
assert.equal(unsafeProviderWriteMission.controlEnvelope?.authorizesExecution, false, 'Unsafe provider-write plans must fail closed.');
assert.equal(unsafeProviderWriteMission.trace?.controlEnvelope?.decision, 'approval_required', 'Trace should include the hard control envelope decision.');

const intakeMission = await runAvaMissionController({
  sessionId: 'ava_chat_controller_intake_smoke',
  text: 'Find the seller and tell me the safest next move.',
  source: 'ava-chat-page',
  controllerStage: 'intake',
  assistantIntent: { intent: 'find_lead', query: 'seller' },
  assistantPlan: {
    action: 'mission_intake',
    usedIntent: 'find_lead',
  },
  assistantSession: {
    history: [{ role: 'user', content: 'Find the seller.' }],
  },
  state: {
    leadImports: [{ id: 'lead-intake-1', leadName: 'Intake Seller', address: '900 Main St' }],
  },
});

assert.equal(intakeMission.mission?.status, 'planning', 'Controller-first intake should produce a planning mission before tools run.');
assert.equal(intakeMission.mission?.controllerStage, 'intake', 'Mission should preserve the controller stage.');
assert.equal(intakeMission.trace?.controllerStage, 'intake', 'Trace should preserve the controller stage.');
assert.equal(intakeMission.trace?.controllerPath, 'orchestrateAvaTurn', 'Intake should still use the rich Ava orchestrator.');
assert.equal(intakeMission.controlEnvelope?.decision, 'allow', 'Intake should allow planning but not provider execution.');

const runtimeBridge = readFileSync(resolve('src/app/utils/runtimeBridge.ts'), 'utf8');
const bridge = readFileSync(resolve('scripts/openclaw-local-server.mjs'), 'utf8');
const route = readFileSync(resolve('src/app/routes/AvaChat.tsx'), 'utf8');

assert.match(runtimeBridge, /mission\?: Record<string, unknown> \| null/, 'Runtime bridge response type should expose mission metadata.');
assert.match(runtimeBridge, /trace\?: Record<string, unknown> \| null/, 'Runtime bridge response type should expose mission trace.');
assert.match(bridge, /runAvaMissionController/, 'Bridge should call the Ava mission controller for assistant chat.');
assert.match(bridge, /missionController\.mission/, 'Assistant chat response should return mission metadata.');
assert.match(bridge, /missionController\.trace/, 'Assistant chat response should return mission trace.');
assert.match(bridge, /missionController\.controlEnvelope/, 'Assistant chat response should return the hard control envelope.');
assert.match(bridge, /avaMissionLedger/, 'Bridge state should include a durable Ava mission ledger.');
assert.match(bridge, /function recordAvaMissionLedger/, 'Assistant chat should persist final mission proof to the durable ledger.');
assert.match(bridge, /initialMissionController = await runAvaMissionController/, 'Assistant chat should run controller-first intake before deterministic planning.');
assert.match(bridge, /controllerStage:\s*'intake'/, 'Controller-first intake should be explicitly labeled.');
assert.match(bridge, /function enforceAvaControlEnvelope/, 'Assistant chat should enforce the hard control envelope before tool execution.');
assert.match(bridge, /enforceAvaControlEnvelope\(missionController/, 'Assistant chat should gate planned execution through the control envelope.');
const internalHandlerSource = bridge.slice(
  bridge.indexOf('async function handleInternalAvaAssistantChatRequest'),
  bridge.indexOf('\nfunction createTelnyxPublicKeyObject')
);
const publicHandlerSource = bridge.slice(
  bridge.indexOf('async function handlePublicAvaChatRequest'),
  bridge.indexOf('\nfunction buildInternalAssistantApprovalAnswer')
);
const controlEnvelopeSource = readFileSync(resolve('scripts/ava-mission-controller.mjs'), 'utf8');
assert.match(
  controlEnvelopeSource,
  /const guardBlocked = orchestration\.guard\?\.blocked === true \|\| guardResult === 'blocked' \|\| guardResult === 'handoff'/,
  'Control envelope should treat guard blocked/handoff states as hard blocks.'
);
assert(
  controlEnvelopeSource.indexOf('} else if (guardBlocked)') <
    controlEnvelopeSource.indexOf('providerWrite ||'),
  'Guard blocked/handoff must take precedence over approval-required provider-write routing.'
);
assert(
  internalHandlerSource.indexOf('initialMissionController = await runAvaMissionController') <
    internalHandlerSource.indexOf('const assistantPlan = planAssistantIntent'),
  'Controller-first intake must run before deterministic assistant planning.'
);
assert(
  internalHandlerSource.indexOf('const finalControlGate = enforceAvaControlEnvelope') <
    internalHandlerSource.indexOf("assistantSession = appendAssistantMessage(assistantSession, 'assistant', answer"),
  'Final Ava answer should be control-gated before it is persisted or returned.'
);
assert.match(publicHandlerSource, /publicMissionPlan/, 'Public Ava chat should wrap lead intake in an explicit mission plan.');
assert.match(publicHandlerSource, /runAvaMissionController\(\{[\s\S]*source:\s*'public-ava-chat'/, 'Public Ava chat should run the mission controller before writes.');
assert.match(publicHandlerSource, /const controlGate = enforceAvaControlEnvelope\(missionController, publicMissionPlan\)/, 'Public Ava lead capture must be gated by the hard control envelope.');
assert(
  publicHandlerSource.indexOf('const controlGate = enforceAvaControlEnvelope') <
    publicHandlerSource.indexOf("leadCapture = await handleEvent('lead-intake'"),
  'Public Ava must enforce the control envelope before saving lead intake.'
);
assert.match(publicHandlerSource, /controlEnvelope:\s*missionController\.controlEnvelope/, 'Public Ava response should expose the hard control envelope.');
assert.match(publicHandlerSource, /missionLedger:\s*missionLedgerRecord/, 'Public Ava response should expose persisted mission ledger proof.');
assert.match(bridge, /missionLedger:\s*missionLedgerRecord/, 'Assistant chat response should expose the persisted mission ledger proof.');
assert.match(route, /mission: response\.mission/, 'Ava Chat exchanges should retain mission metadata.');
assert.match(route, /trace: response\.trace/, 'Ava Chat exchanges should retain trace metadata.');

console.log('[ava-mission-controller-smoke] ok');
