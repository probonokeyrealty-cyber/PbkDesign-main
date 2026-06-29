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

const approvalMission = await runAvaMissionController({
  sessionId: 'ava_chat_controller_approval_smoke',
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
  toolResult: { ok: true, result: 'queued_for_approval', approvalId: 'approval-1' },
});

assert.equal(approvalMission.mission?.status, 'waiting_on_approval', 'Approval-gated provider writes should wait on approval.');
assert.equal(approvalMission.mission?.approvalRequired, true, 'Mission should make approval requirement explicit.');
assert.equal(approvalMission.trace?.actionPolicy?.providerWritesBlocked, true, 'Trace should preserve provider-write safety policy.');

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

const runtimeBridge = readFileSync(resolve('src/app/utils/runtimeBridge.ts'), 'utf8');
const bridge = readFileSync(resolve('scripts/openclaw-local-server.mjs'), 'utf8');
const route = readFileSync(resolve('src/app/routes/AvaChat.tsx'), 'utf8');

assert.match(runtimeBridge, /mission\?: Record<string, unknown> \| null/, 'Runtime bridge response type should expose mission metadata.');
assert.match(runtimeBridge, /trace\?: Record<string, unknown> \| null/, 'Runtime bridge response type should expose mission trace.');
assert.match(bridge, /runAvaMissionController/, 'Bridge should call the Ava mission controller for assistant chat.');
assert.match(bridge, /missionController\.mission/, 'Assistant chat response should return mission metadata.');
assert.match(bridge, /missionController\.trace/, 'Assistant chat response should return mission trace.');
assert.match(bridge, /avaMissionLedger/, 'Bridge state should include a durable Ava mission ledger.');
assert.match(bridge, /function recordAvaMissionLedger/, 'Assistant chat should persist final mission proof to the durable ledger.');
assert.match(bridge, /initialMissionController = await runAvaMissionController/, 'Assistant chat should run controller-first intake before deterministic planning.');
assert.match(bridge, /controllerStage:\s*'intake'/, 'Controller-first intake should be explicitly labeled.');
const internalHandlerSource = bridge.slice(
  bridge.indexOf('async function handleInternalAvaAssistantChatRequest'),
  bridge.indexOf('\nfunction createTelnyxPublicKeyObject')
);
assert(
  internalHandlerSource.indexOf('initialMissionController = await runAvaMissionController') <
    internalHandlerSource.indexOf('const assistantPlan = planAssistantIntent'),
  'Controller-first intake must run before deterministic assistant planning.'
);
assert.match(bridge, /missionLedger:\s*missionLedgerRecord/, 'Assistant chat response should expose the persisted mission ledger proof.');
assert.match(route, /mission: response\.mission/, 'Ava Chat exchanges should retain mission metadata.');
assert.match(route, /trace: response\.trace/, 'Ava Chat exchanges should retain trace metadata.');

console.log('[ava-mission-controller-smoke] ok');
