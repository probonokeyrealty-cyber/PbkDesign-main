import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildAvaLiveTurnContract,
  compileAvaLiveSkillAction,
  isAvaLiveReplyAlignedWithContract,
  renderAvaLiveContractReply,
  updateAvaLiveFactLedger,
} from './ava-live-turn-contract.mjs';
import { classifyAvaConversationalIntent } from './ava-intent-router.mjs';
import { buildDefaultAgentRegistry, requiredAgentRegistryIds } from './agent-registry.mjs';
import {
  buildPBKIntelligenceContext,
  buildPBKIntelligenceFleetReadiness,
} from './pbk-intelligence-context.mjs';
import {
  evaluateConversationSenderRecommendationCompliance,
  normalizeConversationEmail,
  normalizeConversationPhone,
  rankEligibleSenderIdentities,
} from './conversation-identity.mjs';

const BRIDGE_URL = String(
  process.env.PBK_BEHAVIOR_BRIDGE_URL ||
    process.env.PBK_HOSTED_BRIDGE_URL ||
    process.env.PBK_BRIDGE_URL ||
    'https://pbk-openclaw-bridge.onrender.com'
).replace(/\/+$/g, '');
const FRONTEND_URL = String(
  process.env.PBK_BEHAVIOR_FRONTEND_URL ||
    process.env.PBK_FRONTEND_URL ||
    'https://pbkcommandcenter.netlify.app'
).replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const RUN_HOSTED = /^(1|true|yes)$/i.test(String(process.env.PBK_BEHAVIOR_HOSTED || '').trim());

const root = process.cwd();
const read = (filePath) => readFileSync(resolve(root, filePath), 'utf8');
const bridgeSource = read('scripts/openclaw-local-server.mjs');
const packageJson = JSON.parse(read('package.json'));

function assertIncludesAll(source, values, label) {
  for (const value of values) {
    assert(
      source.includes(value),
      `${label} is missing required contract marker: ${value}`
    );
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawText: text };
    }
  }
  return { response, parsed, text };
}

async function testHostedBridgeHealth() {
  if (!RUN_HOSTED) {
    return { skipped: true, reason: 'Set PBK_BEHAVIOR_HOSTED=1 to run hosted bridge checks.' };
  }

  const { response, parsed } = await fetchJson(`${BRIDGE_URL}/health`);
  assert.equal(response.status, 200, `Hosted bridge /health returned ${response.status}.`);
  assert.equal(parsed?.ok, true, 'Hosted bridge /health must report ok: true.');
  assert.equal(parsed?.features?.productionReady, true, 'Hosted bridge must report productionReady: true.');
  assert.equal(parsed?.features?.stateBackend, 'postgres', 'Hosted bridge must use Postgres state.');
  assert.equal(parsed?.components?.bridge?.status, 'up', 'Bridge component must be up.');
  assert.equal(parsed?.components?.postgres?.status, 'up', 'Postgres component must be up.');
  assert.equal(
    parsed?.components?.agentOrchestration?.status,
    'up',
    'Agent orchestration component must be up.'
  );
  assert.equal(parsed?.providers?.telnyx?.messagingReady, true, 'Telnyx SMS must be ready.');
  assert.equal(parsed?.providers?.telnyx?.voiceReady, true, 'Telnyx voice must be ready.');
  assert.equal(parsed?.providers?.deepgram?.ready, true, 'Deepgram must be ready.');
  assert.equal(parsed?.providers?.elevenLabs?.ready, true, 'ElevenLabs must be ready.');
  assert.equal(parsed?.providers?.docusign?.productionReady, true, 'DocuSign must be production ready.');

  const frontend = await fetch(FRONTEND_URL, { method: 'GET' });
  assert.equal(frontend.status, 200, `Frontend returned ${frontend.status}.`);

  const unauthorizedState = await fetch(`${BRIDGE_URL}/state`);
  assert.equal(unauthorizedState.status, 401, 'Hosted /state must fail closed without auth.');

  if (API_KEY) {
    const state = await fetchJson(`${BRIDGE_URL}/state`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    assert.equal(state.response.status, 200, `Authenticated /state returned ${state.response.status}.`);
    assert(Array.isArray(state.parsed?.approvals), 'Authenticated /state must expose approvals.');

    const orchestration = await fetchJson(`${BRIDGE_URL}/api/agents/orchestration`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    assert.equal(
      orchestration.response.status,
      200,
      `Agent orchestration returned ${orchestration.response.status}.`
    );
    assert.equal(orchestration.parsed?.ok, true, 'Agent orchestration must report ok.');
    assert.equal(
      orchestration.parsed?.orchestration?.supervisor?.id,
      'ava',
      'Ava must remain the orchestration supervisor.'
    );
  }

  return {
    skipped: false,
    revision: parsed.revision,
    stateBackend: parsed.features.stateBackend,
    componentStatus: parsed.status,
  };
}

function testConversationIdentityAndSenderRanking() {
  assert.equal(normalizeConversationPhone('(614) 555-0142'), '+16145550142');
  assert.equal(normalizeConversationPhone('+1 614.555.0142'), '+16145550142');
  assert.equal(normalizeConversationEmail(' Seller@Example.COM '), 'seller@example.com');

  const rankedSms = rankEligibleSenderIdentities(
    [
      {
        id: 'retired',
        channel: 'sms',
        lifecycleStatus: 'retired',
        healthStatus: 'active',
        address: '+16145550000',
      },
      {
        id: 'workspace-default',
        channel: 'sms',
        lifecycleStatus: 'active',
        healthStatus: 'active',
        isWorkspaceDefault: true,
        healthScore: 70,
        region: 'oh',
        address: '+16145550111',
      },
      {
        id: 'previous',
        channel: 'sms',
        lifecycleStatus: 'active',
        healthStatus: 'active',
        healthScore: 20,
        region: 'oh',
        address: '+16145550142',
      },
    ],
    { previousSenderIdentityId: 'previous', leadRegion: 'oh' }
  );

  assert.deepEqual(
    rankedSms.map((identity) => identity.id),
    ['previous', 'workspace-default'],
    'Sender ranking must prefer previous continuity while excluding retired identities.'
  );

  assert.deepEqual(
    evaluateConversationSenderRecommendationCompliance({
      channel: 'sms',
      dncBlocked: true,
      consentStatus: 'granted',
    }),
    { allowed: false, reasonCodes: ['dnc_blocked'] }
  );
  assert.deepEqual(
    evaluateConversationSenderRecommendationCompliance({
      channel: 'sms',
      dncBlocked: false,
      consentStatus: 'unknown',
    }),
    { allowed: true, reasonCodes: ['consent_unknown', 'approval_required'] }
  );
  assert.deepEqual(
    evaluateConversationSenderRecommendationCompliance({
      channel: 'email',
      dncBlocked: false,
      consentStatus: 'revoked',
    }),
    { allowed: true, reasonCodes: [] }
  );
}

function testManualMessageBridgeContract() {
  assertIncludesAll(
    bridgeSource,
    [
      'function parseConversationSendBody(body)',
      "'source'",
      "'manual'",
      "'manualSend'",
      'manualSend = body.manual === true || body.manualSend === true',
      'requestedBy: parsed.requestedBy || actor',
      "source: parsed.source || (parsed.manualSend ? 'unified_conversation_manual' : 'unified_conversation')",
      'manual: parsed.manual',
      'manualSend: parsed.manualSend',
      'function isTrustedManualConversationProviderSend',
      "['telnyx_sms', 'sendColdEmail', 'telnyx_call', 'sendSellerDocs'].includes(toolName)",
      'isTrustedManualConversationProviderSend(toolName, params)',
      "manual: body.manual === false ? false : true",
      "manualSend: body.manualSend === false ? false : true",
      "source: body.source || 'lead_portal_manual'",
      "source: body.source || 'command_center_manual'",
      'buildConversationSendEventPayload',
    ],
    'Manual SMS/email/call bridge path'
  );

  assert(
    !/approvalId:\s*parsed\.approvalId/.test(bridgeSource),
    'Public conversation sends must not forward arbitrary approvalId values.'
  );
  assert(
    !/approvalId:\s*String\(body\.approvalId/.test(bridgeSource),
    'Conversation send parser must not accept arbitrary approvalId values.'
  );
}

function testAvaIntentRouterBehavior() {
  assert.deepEqual(
    pickIntent(classifyAvaConversationalIntent('hello')),
    { action: 'chat', needsApproval: false, intent: 'chat' }
  );
  assert.deepEqual(
    pickIntent(classifyAvaConversationalIntent('write a seller email about closing Friday')),
    { action: 'draft_email', needsApproval: false, intent: 'draft_email' }
  );
  assert.deepEqual(
    pickIntent(classifyAvaConversationalIntent('search lead Diane')),
    { action: 'search_leads', needsApproval: false, intent: 'search_leads' }
  );
  assert.deepEqual(
    pickIntent(classifyAvaConversationalIntent('send a text to Diane')),
    { action: 'send_sms', needsApproval: true, intent: 'send_sms' }
  );
  assert.deepEqual(
    pickIntent(
      classifyAvaConversationalIntent('send a text to Diane', {
        source: 'unified_inbox_manual',
        manual: true,
        manualSend: true,
      })
    ),
    { action: 'send_sms', needsApproval: false, intent: 'send_sms' }
  );
}

function pickIntent(result) {
  return {
    action: result.action,
    needsApproval: result.needsApproval,
    intent: result.intent,
  };
}

function testAvaTurnContractBehavior() {
  const ledger = updateAvaLiveFactLedger(
    {},
    'I am the owner and I want around 300k. The house is in Michigan and the roof needs work.',
    { contextCall: { phone: '+16145550142' } }
  );

  const contract = buildAvaLiveTurnContract({
    transcript: 'I already told you the price. Stop asking that.',
    session: {
      avaLiveFactLedger: ledger,
      askedQuestionCategories: ['role', 'target_price'],
      lastAvaReplySpoken: 'What number are you trying to get?',
    },
    activeSkill: {
      id: 'skill-price-gap',
      name: 'Price gap discovery',
      instructions: 'Acknowledge known target and ask only for missing deal facts.',
    },
    governedSkillSelection: {
      result: 'governed_skill_selected',
      action: 'jump',
      reasonCodes: ['objection_match'],
      matchedTriggers: ['already_gave_price'],
    },
  });

  assert.equal(contract.intent, 'already_gave_price');
  assert.equal(contract.objection, 'already_gave_price');
  assert.equal(contract.knownFacts.sellerTargetPrice, '300k');
  assert(contract.forbiddenRepeats.includes('target_price'));
  assert.equal(contract.activeSkill.id, 'skill-price-gap');

  const compiled = compileAvaLiveSkillAction(contract);
  assert.equal(compiled.ok, true);
  assert.match(compiled.acknowledgement, /300k/i);
  assert.doesNotMatch(compiled.question, /what number|how much/i);

  const reply = renderAvaLiveContractReply(contract);
  assert(isAvaLiveReplyAlignedWithContract(reply, contract), 'Rendered reply must obey the turn contract.');
  assert.doesNotMatch(reply, /what number|how much/i, 'Ava must not repeat known price questions.');
}

function testPBKIntelligenceContextAndFleetReadiness() {
  const registry = buildDefaultAgentRegistry({ now: Date.now() });
  const registryIds = registry.map((agent) => agent.id);
  for (const requiredId of requiredAgentRegistryIds) {
    assert(registryIds.includes(requiredId), `Agent registry missing ${requiredId}.`);
  }

  const context = buildPBKIntelligenceContext({
    lead: {
      id: 'lead-behavior-1',
      name: 'Behavior Seller',
      phone: '(614) 555-0142',
      email: 'seller@example.com',
    },
    call: {
      id: 'call-behavior-1',
      status: 'active',
    },
    transcript: 'I already told you I want 300k.',
    memory: {
      coaching: [{ content: 'Acknowledge the known target before asking for address.' }],
    },
    skills: {
      active: [{ id: 'skill-price-gap', name: 'Price gap discovery', status: 'active' }],
    },
    turnContract: {
      ok: true,
      intent: 'already_gave_price',
      objection: 'already_gave_price',
      phase: 'discovery',
      knownFacts: { sellerTargetPrice: '300k' },
      missingFacts: ['full_address'],
      nextBestQuestion: 'What is the full street address?',
      forbiddenRepeats: ['target_price'],
      activeSkill: { id: 'skill-price-gap', name: 'Price gap discovery', action: 'jump' },
    },
    agents: registry,
  });

  assert.equal(context.identity.ready, true);
  assert.equal(context.memory.ready, true);
  assert.equal(context.skills.ready, true);
  assert.equal(context.turnContract.intent, 'already_gave_price');
  assert.equal(context.dataFreshness.ready, true);
  assert.equal(context.fleetReadiness.ready, true);
  assert.deepEqual(context.fleetReadiness.missingAgents, []);
  assert(context.agentHandoffs.some((handoff) => handoff.agentId === 'script-rotator'));

  const incomplete = buildPBKIntelligenceFleetReadiness({
    context: {
      identity: { ready: true },
      memory: { ready: false },
      skills: { ready: true },
      turnContract: { ok: true, intent: 'make_offer' },
      dataFreshness: { ready: true },
    },
    agents: registry,
  });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.required.memory, false);
}

function testBehaviorSuiteIsInReleaseGate() {
  assert.equal(packageJson.scripts?.['test:behavior'], 'node ./scripts/behavior-tests.mjs');
  assert(
    packageJson.scripts?.['test:founder']?.includes('test:behavior'),
    'test:founder must include test:behavior so core behavior runs in the launch gate.'
  );
}

async function main() {
  const results = [];

  const tests = [
    ['conversation_identity_and_sender_ranking', testConversationIdentityAndSenderRanking],
    ['manual_message_bridge_contract', testManualMessageBridgeContract],
    ['ava_intent_router_behavior', testAvaIntentRouterBehavior],
    ['ava_turn_contract_behavior', testAvaTurnContractBehavior],
    ['pbk_intelligence_context_and_fleet_readiness', testPBKIntelligenceContextAndFleetReadiness],
    ['behavior_suite_release_gate', testBehaviorSuiteIsInReleaseGate],
  ];

  for (const [name, test] of tests) {
    await test();
    results.push({ name, ok: true });
  }

  const hosted = await testHostedBridgeHealth();
  results.push({ name: 'hosted_bridge_health', ok: true, ...hosted });

  console.log(
    JSON.stringify(
      {
        ok: true,
        result: 'pbk_behavioral_unison_ready',
        mutationSafe: true,
        hostedChecksEnabled: RUN_HOSTED,
        tests: results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
