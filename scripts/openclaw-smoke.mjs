import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const PORT = Number(process.env.PBK_SMOKE_PORT || 18788);
const API_KEY = String(process.env.PBK_SMOKE_API_KEY || process.env.PBK_BRIDGE_API_KEY || 'pbk-smoke-test-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function approvalIdFrom(payload) {
  return payload?.approval?.approval?.id
    || payload?.approval?.id
    || payload?.approvalId
    || payload?.approval?.approvalId
    || '';
}

function isQueuedForApprovalPayload(payload) {
  return payload?.result === 'queued_for_approval'
    || payload?.outcome === 'queued_for_approval';
}

async function waitForHealth(timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }

  throw lastError || new Error('Timed out waiting for bridge health.');
}

async function main() {
  const child = spawn(process.execPath, [SERVER_ENTRY, '--reset'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PBK_OPENCLAW_PORT: String(PORT),
      PBK_BRIDGE_API_KEY: API_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  const cleanup = async () => {
    if (!child.killed) {
      child.kill();
      await delay(150);
    }
  };

  try {
    const health = await waitForHealth();
    const unauthorizedState = await fetch(`${BASE_URL}/state`);
    const state = await fetch(`${BASE_URL}/state`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const compactState = await fetch(`${BASE_URL}/state?compact=1`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const ttsHealth = await fetch(`${BASE_URL}/api/voice/tts/health`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const voiceStatus = await fetch(`${BASE_URL}/api/voice/status`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const lastSpoken = await fetch(`${BASE_URL}/api/debug/last-spoken`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const callStateDebug = await fetch(`${BASE_URL}/api/debug/call-state?callId=smoke-missing-call`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const callTraceDebug = await fetch(`${BASE_URL}/api/debug/call-trace?callId=smoke-missing-call`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const injectTranscriptDebugResponse = await fetch(`${BASE_URL}/api/debug/inject-transcript`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        callId: 'smoke-missing-call',
        transcript: 'I inherited the house and need my wife to look at the offer.',
      }),
    });
    const injectTranscriptDebug = await injectTranscriptDebugResponse.json();
    const resetLeadCache = await fetch(`${BASE_URL}/api/debug/reset-lead-cache?phone=6145550199`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    assert(compactState?.status?.snapshotMode === 'compact', 'Compact state endpoint did not report compact mode.');
    assert(voiceStatus?.ok === true && voiceStatus?.result === 'voice_status', 'Voice status endpoint did not return live diagnostics.');
    assert(voiceStatus?.providers?.redis && typeof voiceStatus.providers.redis.configured === 'boolean', 'Voice status endpoint did not expose optional Redis shared-state diagnostics.');
    assert(lastSpoken?.ok === true && /last_spoken_/.test(lastSpoken?.result || ''), 'Last-spoken debug endpoint did not return a safe diagnostic envelope.');
    assert(callStateDebug?.ok === true && /^call_state_/.test(callStateDebug?.result || ''), 'Call-state debug endpoint did not return a safe diagnostic envelope.');
    assert(callTraceDebug?.ok === true && /^call_trace_/.test(callTraceDebug?.result || ''), 'Call-trace debug endpoint did not return a safe diagnostic envelope.');
    assert(injectTranscriptDebugResponse.status === 404 && injectTranscriptDebug?.result === 'active_media_session_not_found', 'Inject-transcript debug endpoint did not safely report a missing active media session.');
    assert(resetLeadCache?.ok === true && resetLeadCache?.result === 'lead_cache_reset', 'Lead-cache reset debug endpoint did not accept a safe reset request.');
    const publicAvaLeadChat = await fetch(`${BASE_URL}/api/public/ava-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId: 'smoke-public-ava-lead-chat-1',
        message: 'I want to sell my house at 808 Smoke Test Ave. Please call me at 614-555-0199.',
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    assert(publicAvaLeadChat?.ok === true, 'Public Ava chat did not accept a seller lead message.');
    assert(publicAvaLeadChat?.leadCaptured === true, 'Public Ava chat did not capture a seller lead signal.');
    assert(
      !/\b(Summary:|Mentor:|Rex here|PBK Research Technique|production debug smoke)\b/i.test(publicAvaLeadChat?.answer || ''),
      'Public Ava chat leaked internal brain/research wording into a visitor response.',
    );
    const publicAvaProcessChat = await fetch(`${BASE_URL}/api/public/ava-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'What is PBK and how does the cash offer process work?',
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    assert(publicAvaProcessChat?.ok === true, 'Public Ava chat did not accept a process question.');
    assert(
      /\b(cash offers?|creative finance|approval-gated|read-only)\b/i.test(publicAvaProcessChat?.answer || ''),
      'Public Ava chat did not give a useful visitor-safe process answer.',
    );
    const publicAvaAssistantChat = await fetch(`${BASE_URL}/api/public/ava-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 'smoke-assistant-session',
        message: 'Call 614-555-0199 for me now.',
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    assert(publicAvaAssistantChat?.ok === true, 'Public Ava assistant chat did not accept a routed assistant request.');
    assert(publicAvaAssistantChat?.sessionId === 'smoke-assistant-session', 'Public Ava assistant chat did not preserve the provided session id.');
    assert(publicAvaAssistantChat?.usedIntent === 'call', 'Public Ava assistant chat did not expose the detected call intent.');
    assert(Array.isArray(publicAvaAssistantChat?.suggestions) && publicAvaAssistantChat.suggestions.length > 0, 'Public Ava assistant chat did not return proactive suggestions.');
    assert(
      /public chat.*will not start calls|will not start calls, texts/i.test(publicAvaAssistantChat?.answer || ''),
      'Public Ava assistant chat did not block provider-write call behavior.',
    );
    const internalAvaAssistantCall = await fetch(`${BASE_URL}/api/assistant/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 'smoke-internal-assistant-session',
        message: 'Call 614-555-0199 for me now.',
      }),
    }).then((response) => response.json());
    assert(internalAvaAssistantCall?.ok === true, 'Internal Ava assistant chat did not accept an authenticated assistant request.');
    assert(internalAvaAssistantCall?.assistantAction === 'approval_required', 'Internal Ava assistant chat did not keep provider-write call requests approval-gated.');
    assert(internalAvaAssistantCall?.toolPlan?.toolName === 'telnyx_call', 'Internal Ava assistant chat did not prepare the expected call tool plan.');
    assert(
      /approval-gated/i.test(internalAvaAssistantCall?.answer || ''),
      'Internal Ava assistant chat did not explain the approval-gated call boundary.',
    );
    assert(
      internalAvaAssistantCall?.initialMission?.controllerStage === 'intake',
      'Internal Ava assistant chat must run controller-first intake before deterministic planning.',
    );
    assert(
      internalAvaAssistantCall?.mission?.schema === 'pbk.ava.mission_controller.v1',
      'Internal Ava assistant chat must return mission metadata.',
    );
    assert(
      internalAvaAssistantCall?.trace?.schema === 'pbk.ava.mission_trace.v1',
      'Internal Ava assistant chat must return mission trace proof.',
    );
    assert(
      internalAvaAssistantCall?.trace?.controllerPath === 'orchestrateAvaTurn',
      '/api/assistant/chat must prove the mission controller path ran.',
    );
    assert(
      internalAvaAssistantCall?.mission?.sessionId === 'smoke-internal-assistant-session',
      'Mission metadata must preserve the assistant session id.',
    );
    assert(
      internalAvaAssistantCall?.mission?.steps?.some((step) => step.id === 'orchestrate'),
      'Mission metadata must include the orchestrate step.',
    );
    assert(
      internalAvaAssistantCall?.mission?.steps?.some((step) => step.id === 'execute'),
      'Mission metadata must include the execute/proof step.',
    );
    assert(
      internalAvaAssistantCall?.mission?.status === 'waiting_on_approval',
      'Approval-gated assistant actions must return a waiting_on_approval mission status.',
    );
    assert(
      internalAvaAssistantCall?.mission?.approvalRequired === true,
      'Mission metadata must expose approval requirement.',
    );
    assert(
      internalAvaAssistantCall?.missionLedger?.schema === 'pbk.ava.mission_ledger.v1',
      'Internal Ava assistant chat must persist and return mission ledger proof.',
    );
    assert(
      !/\b614[\s.-]?555[\s.-]?0199\b|Call 614-555-0199/i.test(JSON.stringify(internalAvaAssistantCall?.missionLedger || {})),
      'Mission ledger proof must not retain raw seller phone/request text.',
    );
    const publicAvaTtsNoLeadChat = await fetch(`${BASE_URL}/api/public/ava-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Ava TTS voice bubble text should not create lerads or fake leads for 123 Voice Bug Ave, call me at 614-555-0199.',
        source: 'ava-chat-bubble-tts',
        noLeadCapture: true,
      }),
    }).then((response) => response.json());
    assert(publicAvaTtsNoLeadChat?.ok === true, 'Public Ava no-lead TTS diagnostic chat did not succeed.');
    assert(publicAvaTtsNoLeadChat?.leadCaptured === false && publicAvaTtsNoLeadChat?.leadCaptureSuppressed === true, 'Public Ava TTS diagnostic text still created a lead.');
    const quotas = await fetch(`${BASE_URL}/api/quotas`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const tooling = await fetch(`${BASE_URL}/api/tooling/status`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const contractTemplates = await fetch(`${BASE_URL}/api/contracts/templates`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const leadEventPayload = {
      eventType: 'lead-intake',
      payload: {
        eventId: 'smoke-lead-event-1',
        leadId: 'smoke-lead-1',
        source: 'smoke-test',
        seller: {
          name: 'Smoke Test Seller',
          phone: '+1 (614) 555-0199',
          email: 'smoke@example.com',
        },
        property: {
          address: '808 Smoke Test Ave, Columbus OH',
          city: 'Columbus',
          state: 'OH',
        },
        tags: ['smoke', 'qa'],
      },
    };
    const firstLeadEvent = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(leadEventPayload),
    }).then((response) => response.json());
    const secondLeadEvent = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(leadEventPayload),
    }).then((response) => response.json());
    const approvalId = state?.approvals?.[0]?.id;
    assert(approvalId, 'Seed state did not provide an approval to replay-test.');
    const approvalDecisionPayload = {
      eventType: 'approval-callback',
      payload: {
        id: approvalId,
        status: 'approved',
        actor: 'smoke-test',
        actedAt: '2026-04-26T18:00:00.000Z',
      },
    };
    const firstApprovalDecision = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(approvalDecisionPayload),
    }).then((response) => response.json());
    const secondApprovalDecision = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(approvalDecisionPayload),
    }).then((response) => response.json());
    const manualProviderCall = await fetch(`${BASE_URL}/api/calls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-manual-provider-action-lead',
        leadName: 'Smoke Manual Provider Action Seller',
        address: '909 Manual Provider Action Ave, Columbus OH',
        phone: '+1 (614) 555-0123',
        script: 'Smoke manual operator call should return structured execution or approval proof.',
        actor: 'smoke-test',
        nowLocalHour: 12,
      }),
    }).then((response) => response.json());
    const manualProviderCallApprovalId = approvalIdFrom(manualProviderCall);
    assert(
      manualProviderCall && typeof manualProviderCall === 'object',
      'Manual /api/calls route should return a structured bridge payload.',
    );
    assert(
      !isQueuedForApprovalPayload(manualProviderCall) || manualProviderCallApprovalId,
      'Manual /api/calls route queued behind approval mode without approval proof.',
    );
    assert(
      isQueuedForApprovalPayload(manualProviderCall)
        || manualProviderCall?.call
        || manualProviderCall?.result
        || manualProviderCall?.ok !== undefined,
      'Manual /api/calls route should return either execution state or approval proof.',
    );
    const queuedProviderCall = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'telnyx_call',
        params: {
          leadId: 'smoke-provider-action-lead',
          leadName: 'Smoke Provider Action Seller',
          address: '909 Provider Action Ave, Columbus OH',
          phone: '+1 (614) 555-0123',
          script: 'Smoke provider-action approval should replay telnyx_call after approval.',
          actor: 'smoke-test',
          nowLocalHour: 12,
        },
      }),
    }).then((response) => response.json());
    const queuedProviderAction = queuedProviderCall?.result || queuedProviderCall;
    const providerActionApprovalId = queuedProviderAction?.approval?.approval?.id
      || queuedProviderAction?.approval?.id;
    assert(
      queuedProviderAction?.result === 'queued_for_approval' && providerActionApprovalId,
      'Autonomous provider-action call did not queue behind approval mode.',
    );
    const providerActionApproval = await fetch(`${BASE_URL}/api/approvals/${encodeURIComponent(providerActionApprovalId)}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
        actedAt: '2026-04-26T18:01:00.000Z',
        notes: 'Smoke provider-action replay approval.',
      }),
    }).then((response) => response.json());
    assert(
      providerActionApproval?.providerActionResult?.ok === false
        && providerActionApproval?.providerActionResult?.result === 'provider_missing'
        && providerActionApproval?.providerActionResult?.call?.phone === '+16145550123'
        && providerActionApproval?.providerActionResult?.call?.status === 'provider_missing',
      'Approved provider-action telnyx_call must replay into an explicit provider-missing call record.',
    );
    const unsafeOfferInvoke = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'sendDocuSign',
        params: {
          leadName: 'Unsafe Offer Smoke',
          email: 'unsafe-offer-smoke@example.com',
          offerAmount: 120000,
          mao: 100000,
          source: 'smoke-test-safety',
        },
      }),
    }).then((response) => response.json());
    assert(
      unsafeOfferInvoke?.ok === false
        && unsafeOfferInvoke?.result?.result === 'safety_blocked'
        && unsafeOfferInvoke?.result?.safety?.violations?.some((item) => item.code === 'offer_above_mao'),
      'Unsafe provider-write offer was not blocked before approval/execution.',
    );
    const safetyValidation = await fetch(`${BASE_URL}/api/safety/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'telnyx_call',
        params: {
          leadName: 'DNC Smoke',
          phone: '+16145550124',
          dnc: true,
          nowLocalHour: 12,
        },
      }),
    }).then((response) => response.json());
    assert(
      safetyValidation?.ok === false
        && safetyValidation?.safety?.violations?.some((item) => item.code === 'dnc_block'),
      'Safety validation endpoint did not block a DNC call.',
    );
    const slackUrlVerification = await fetch(`${BASE_URL}/api/slack/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'url_verification',
        challenge: 'pbk-slack-events-challenge',
      }),
    }).then((response) => response.json());
    assert(
      slackUrlVerification?.challenge === 'pbk-slack-events-challenge',
      'Slack Events API URL verification did not return the challenge.',
    );
    const slackMentionAck = await fetch(`${BASE_URL}/api/slack/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'event_callback',
        event: {
          type: 'app_mention',
          user: 'UFOUNDER',
          channel: 'CDEALS',
          ts: '1717000000.000400',
          text: '<@UAVA123> what needs my attention today?',
        },
      }),
    }).then((response) => response.json());
    assert(
      slackMentionAck?.result === 'slack_app_mention_ack_queued',
      'Slack app mention did not ACK for background routing.',
    );
    const avaEvalRun = await fetch(`${BASE_URL}/api/evals/ava-canonical/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    assert(
      avaEvalRun?.ok === true && avaEvalRun?.total >= 20 && avaEvalRun?.failed === 0,
      'Ava canonical eval suite endpoint did not pass the canonical scenarios.',
    );
    const observabilityStatus = await fetch(`${BASE_URL}/api/observability/status`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    assert(
      observabilityStatus?.ok === true
        && observabilityStatus?.metrics
        && observabilityStatus?.eventBus,
      'Observability status endpoint did not expose metrics and event bus diagnostics.',
    );
    const invoke = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'getBrainState',
        params: {
          query: 'What is the current bridge state?',
        },
      }),
    }).then((response) => response.json());
    const avaCommand = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'runAgentCommand',
        params: {
          command: 'Ava masterclass: explain the subject-to due-on-sale guardrail in one conversational answer.',
          source: 'smoke-test',
        },
      }),
    }).then((response) => response.json());
    const avaResponseOnlyCommand = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'runAgentCommand',
        params: {
          command: 'Ava, give me a one sentence production smoke response. Do not call, text, email, or create contracts.',
          source: 'smoke-test',
        },
      }),
    }).then((response) => response.json());
    const avaSafeStatusCommand = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'runAgentCommand',
        params: {
          command: 'Ava, check PBK system status and tell me the next safe action. Do not call, message, approve, reject, cancel, update CRM, or run any provider write.',
          source: 'smoke-test',
        },
      }),
    }).then((response) => response.json());
    const fastBridgeStatusCommand = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'runAgentCommand',
        params: {
          command: 'Check PBK bridge health',
          source: 'smoke-test-fast-intent',
        },
      }),
    }).then((response) => response.json());
    const cachedFastBridgeStatusCommand = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'runAgentCommand',
        params: {
          command: 'Check PBK bridge health',
          source: 'smoke-test-fast-intent',
        },
      }),
    }).then((response) => response.json());
    const avaTtsDiagnosticCommand = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'runAgentCommand',
        params: {
          command: 'Ava TTS text is creating fake leads or lerads in the chat bubble. Check the voice output bug, no provider writes.',
          source: 'ava-avatar-typed',
          ttsDiagnostic: true,
          skipPreEnrichment: true,
          noProviderWrites: true,
          providerWrites: false,
        },
      }),
    }).then((response) => response.json());
    const closingIntelligence = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'retrieveClosingIntelligence',
        params: {
          query: 'Seller says your cash offer is too low and they may just list with an agent. What should Ava say next?',
          selectedPath: 'cash',
          seller_type: 'seller',
          stage: 'objection_handling',
          source: 'smoke-test',
        },
      }),
    }).then((response) => response.json());
    const closingBrainRetrieve = await fetch(`${BASE_URL}/api/v1/brain/retrieve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'Seller is worried this is a scam and asks how to verify PBK before signing.',
        selectedPath: 'cash',
        seller_type: 'seller',
        stage: 'objection_handling',
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    const avaConversationIntelligence = await fetch(`${BASE_URL}/api/v1/ava/conversation-intelligence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'Seller sounds frustrated and says your number is too low. They want to talk to their wife before signing.',
        selectedPath: 'cash',
        sentiment: 0.28,
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    const avaPathDecisionCases = await Promise.all([
      {
        expectedPath: 'cash',
        expectedCallerRole: 'owner',
        query: 'I am the owner and I just want this house gone fast, it needs repairs, and I want a clean cash close.',
      },
      {
        expectedPath: 'rbp',
        expectedCallerRole: 'owner',
        query: 'I own the house. It is updated and in good condition. I want top dollar and can wait 60 days.',
      },
      {
        expectedPath: 'cf',
        expectedCallerRole: 'agent',
        query: 'I am the listing agent. My seller needs full asking price, but rent does not cover a new loan at today rates.',
      },
      {
        expectedPath: 'mt',
        expectedCallerRole: 'owner',
        query: 'I own the house and I have a 3.5% mortgage. I cannot afford to sell if I lose that low rate.',
      },
      {
        expectedPath: 'land',
        expectedCallerRole: 'owner',
        query: 'I own the land. It is a vacant buildable lot with utilities nearby and builders are buying acreage around us.',
      },
    ].map(async (testCase) => {
      const result = await fetch(`${BASE_URL}/api/v1/ava/conversation-intelligence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          query: testCase.query,
          leadId: `smoke-path-${testCase.expectedPath}`,
          leadName: 'Path Smoke Seller',
          callerRole: testCase.expectedCallerRole || undefined,
          agentCommissionConfirmed: testCase.expectedPath === 'cf' ? true : undefined,
          source: 'smoke-test-path-decision',
        }),
      }).then((response) => response.json());
      return { ...testCase, result };
    }));
    const avaAgentCommissionProbe = await fetch(`${BASE_URL}/api/v1/ava/conversation-intelligence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'I am the listing agent for my client. The seller wants full price but the rents do not cover the payment at today rates.',
        leadId: 'smoke-agent-commission-probe',
        leadName: 'Agent Smoke Test',
        callerRole: 'agent',
        source: 'smoke-test-agent-commission-probe',
      }),
    }).then((response) => response.json());
    const avaOwnerCreativeFinanceGuard = await fetch(`${BASE_URL}/api/v1/ava/conversation-intelligence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'I own the house myself and want to sell. Someone mentioned creative finance and multifamily terms, but I mainly need to know the safest next step.',
        selectedPath: 'cf',
        leadId: 'smoke-owner-cf-guard',
        leadName: 'Owner Smoke Test',
        callerRole: 'owner',
        source: 'smoke-test-owner-cf-guard',
      }),
    }).then((response) => response.json());
    const avaFullIntelligenceContextResume = await fetch(`${BASE_URL}/api/v1/ava/conversation-intelligence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'Right.',
        transcript: 'Right.',
        selectedPath: 'cash',
        leadId: 'smoke-full-intelligence-context',
        leadName: 'Context Resume Seller',
        callerRole: 'owner',
        session: {
          callId: 'smoke-context-resume-call',
          responseRequired: true,
          transcript: [
            {
              speaker: 'Ava',
              transcript: 'What is actually driving this for you right now: repairs, timing, tenants, family, or just wanting a clean exit?',
              isFinal: true,
              speechFinal: true,
            },
            {
              speaker: 'Seller',
              transcript: 'I inherited the house from my mom, probate has been stressful, and I need to sell fast.',
              isFinal: true,
              speechFinal: true,
            },
          ],
        },
        source: 'smoke-test-full-intelligence-context-resume',
      }),
    }).then((response) => response.json());
    const avaFullIntelligenceAgentContextResume = await fetch(`${BASE_URL}/api/v1/ava/conversation-intelligence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'Okay.',
        transcript: 'Okay.',
        selectedPath: 'cf',
        leadId: 'smoke-full-intelligence-agent-context',
        leadName: 'Agent Context Resume',
        callerRole: 'agent',
        agentCommissionConfirmed: true,
        session: {
          callId: 'smoke-context-resume-agent-call',
          responseRequired: true,
          transcript: [
            {
              speaker: 'Agent',
              transcript: 'I am the listing agent. My seller wants full price, but the rent does not cover a new loan at today rates.',
              isFinal: true,
              speechFinal: true,
            },
          ],
        },
        source: 'smoke-test-full-intelligence-agent-context-resume',
      }),
    }).then((response) => response.json());
    const prosodyAdvice = await fetch(`${BASE_URL}/api/v1/voice/prosody`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        text: 'I am angry and this feels like a scam.',
        sentiment: 0.22,
      }),
    }).then((response) => response.json());
    const prosodyDebug = await fetch(`${BASE_URL}/api/v1/prosody/debug`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        text: 'That is great. We can move quickly today.',
        emotion: 'joy',
        intensity: 0.9,
        sentiment: 0.86,
        turnCount: 3,
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    const prosodyAnalytics = await fetch(`${BASE_URL}/api/v1/prosody/analytics?days=14`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const liveReplyPreview = await fetch(`${BASE_URL}/api/voice/live-reply/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadName: 'Rex Strategist',
        transcript: 'call_control_id cc-smoke-123456 stream_id str-smoke-123456 phone +1 (614) 555-0199. I inherited the house and need to know the best option fast.',
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    const callQaScore = await fetch(`${BASE_URL}/api/v1/calls/qa-score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        callId: 'smoke-call-qa-1',
        leadId: 'smoke-lead-1',
        transcript: 'Ava: I hear you on the number. What would make this worth saying yes today? Seller: Send me the agreement and call me tomorrow.',
        createRexDecision: false,
      }),
    }).then((response) => response.json());
    const skillOutcome = await fetch(`${BASE_URL}/api/v1/skills/outcomes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        skillName: 'value_based_negotiation',
        version: 'smoke-v1',
        leadId: 'smoke-lead-1',
        callId: 'smoke-call-qa-1',
        sentimentBefore: 0.35,
        sentimentAfter: 0.55,
        outcomeLabel: 'appointment set',
        minUses: 99,
      }),
    }).then((response) => response.json());
    const similarDeals = await fetch(`${BASE_URL}/api/v1/deals/similar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'cash offer Columbus Ohio repair risk',
        selectedPath: 'cash',
        address: '808 Smoke Test Ave, Columbus OH',
      }),
    }).then((response) => response.json());
    const conversationMemory = await fetch(`${BASE_URL}/api/v1/memory/conversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-lead-1',
        query: 'wife decision maker price objection',
      }),
    }).then((response) => response.json());
    const humanHandoff = await fetch(`${BASE_URL}/api/v1/handoff/human`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-lead-1',
        reason: 'Smoke test seller asked for a human.',
        transcript: 'Can I talk to a real person?',
        transfer: false,
      }),
    }).then((response) => response.json());
    const directSlackNotify = await fetch(`${BASE_URL}/api/slack/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        text: 'PBK smoke Slack notification route test.',
        channel: '#deals',
        source: 'smoke-test',
      }),
    }).then((response) => response.json());
    const filteredApprovals = await fetch(`${BASE_URL}/api/approvals?status=pending&limit=5&includeState=1`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const brainIngest = await fetch(`${BASE_URL}/brain/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        kind: 'note',
        topic: 'Smoke Test Memory',
        title: 'Smoke Test Brain Ingest',
        source: 'bridge-smoke',
        excerpt: 'Smoke brain memory for recording and workflow endpoint coverage.',
        tags: ['smoke', 'brain'],
      }),
    }).then((response) => response.json());
    const youtubeBrainIngest = await fetch(`${BASE_URL}/brain/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        title: 'Smoke YouTube Expert Call',
        url: 'https://www.youtube.com/watch?v=pbkSmoke12345',
        agentId: 'ava',
        transcript: [
          'Expert: What has you thinking about selling the house?',
          'Seller: I inherited it and I need to talk to my wife before signing.',
          'Expert: That makes sense. What would she need to feel comfortable moving forward?',
          'Seller: The price feels low and I need this sold fast because taxes are behind.',
          'Expert: Let us compare the net and solve speed, repairs, and certainty before the deadline.',
        ].join('\n'),
        tags: ['smoke', 'youtube-training'],
      }),
    }).then((response) => response.json());
    const brainQuery = await fetch(`${BASE_URL}/brain/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'Smoke Test Brain Ingest recording workflow',
      }),
    }).then((response) => response.json());
    const rexDecisions = await fetch(`${BASE_URL}/api/rex/decisions`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const rexProposal = await fetch(`${BASE_URL}/api/rex/strategist/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        requestApproval: true,
        actor: 'Rex Smoke Test',
        source: 'smoke-test',
        proposals: [{
          tool: 'update_campaign_script',
          params: { campaignId: 'smoke-campaign', change: 'Add one tactical empathy opener.' },
          rationale: 'Rex should queue strategist proposals through approval, not mutate providers directly.',
          outcomeExpected: 'Smoke test proves Rex proposal lane is alive.',
        }],
      }),
    }).then((response) => response.json());
    const agentOrchestration = await fetch(`${BASE_URL}/api/agents/orchestration`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const agentOrchestrationSmoke = await fetch(`${BASE_URL}/api/agents/orchestration/smoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
        command: 'What is the MAO on 202 Cherry Lane?',
      }),
    }).then((response) => response.json());
    const workflowSave = await fetch(`${BASE_URL}/api/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        workflow: {
          name: 'PBK Smoke Workflow',
          nodes: [],
          connections: {},
          settings: { timezone: 'America/New_York' },
          tags: ['smoke'],
        },
      }),
    }).then((response) => response.json());
    const workflows = await fetch(`${BASE_URL}/api/workflows`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const recordingSave = await fetch(`${BASE_URL}/api/recordings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        messageId: 'smoke-recording-msg-1',
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        storagePath: 'smoke/smoke-recording-msg-1.mp3',
        contentType: 'audio/mpeg',
        durationSeconds: 42,
      }),
    }).then((response) => response.json());
    const recordingLookupResponse = await fetch(`${BASE_URL}/api/recordings/smoke-recording-msg-1`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    const recordingLookup = await recordingLookupResponse.json();
    const sellerDocsResponse = await fetch(`${BASE_URL}/api/send-seller-docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        email: 'smoke@example.com',
        senderProfile: 'warm',
        selectedDocuments: ['seller', 'loi'],
        documentSet: {
          seller: 'Smoke seller guide content.',
          loi: 'Smoke letter of interest content.',
        },
      }),
    });
    const sellerDocs = await sellerDocsResponse.json();
    const browserResearch = await fetch(`${BASE_URL}/api/browser-research/launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'Use BrowserOS to inspect https://pbkcommandcenter.netlify.app and report the page title.',
        requestedBy: 'smoke-test',
        source: 'smoke',
      }),
    }).then((response) => response.json());
    const adminRequest = await fetch(`${BASE_URL}/api/admin/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        command: 'Add pbk-smoke-domain.com to Instantly and start warmup.',
        requestedBy: 'smoke-test',
        requiresApproval: true,
      }),
    }).then((response) => response.json());
    const adminTaskId = adminRequest?.task?.id;
    assert(adminTaskId, 'Admin request did not create a task.');
    const adminApproval = await fetch(`${BASE_URL}/api/admin/tasks/${encodeURIComponent(adminTaskId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        status: 'approved',
        actor: 'smoke-test',
      }),
    }).then((response) => response.json());
    const preparedContract = await fetch(`${BASE_URL}/api/contracts/prepare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        email: 'smoke@example.com',
        amount: 91500,
        selectedPath: 'cash',
        selectedPathLabel: 'Cash Offer',
        bant: {
          budget: '$95k target',
          authority: 'owner confirmed',
          need: 'smoke test seller wants as-is cash offer',
          timeline: '30 days',
          urgency: 'testing contract send path',
        },
      }),
    }).then((response) => response.json());
    const canonicalDraftContract = await fetch(`${BASE_URL}/api/contracts/draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        email: 'smoke@example.com',
        amount: 91500,
        selectedPath: 'cash',
        selectedPathLabel: 'Cash Offer',
      }),
    }).then((response) => response.json());
    const canonicalAnalyzeDeal = await fetch(`${BASE_URL}/api/analyzeDeal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        address: '808 Smoke Test Ave, Columbus OH',
        condition: 'needs roof work',
        sellerFacing: false,
      }),
    }).then((response) => response.json());
    const canonicalApproveRequest = await fetch(`${BASE_URL}/api/approvals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        id: 'smoke-approval-route-approve',
        type: 'offer',
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        offerPrice: 91500,
      }),
    }).then((response) => response.json());
    const canonicalApprove = await fetch(`${BASE_URL}/api/approvals/smoke-approval-route-approve/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
        actedAt: '2026-04-26T18:05:00.000Z',
      }),
    }).then((response) => response.json());
    const canonicalDenyRequest = await fetch(`${BASE_URL}/api/approvals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        id: 'smoke-approval-route-deny',
        type: 'offer',
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        offerPrice: 95000,
      }),
    }).then((response) => response.json());
    const canonicalDeny = await fetch(`${BASE_URL}/api/approvals/smoke-approval-route-deny/deny`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
        actedAt: '2026-04-26T18:06:00.000Z',
      }),
    }).then((response) => response.json());
    const preparedContractId = preparedContract?.contract?.id || '';
    const canonicalContractSend = await fetch(`${BASE_URL}/api/contracts/${encodeURIComponent(preparedContractId)}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
        bant: {
          budget: '$95k target',
          authority: 'owner confirmed',
          need: 'smoke test seller wants as-is cash offer',
          timeline: '30 days',
          urgency: 'testing contract send path',
        },
      }),
    }).then((response) => response.json());
    const canonicalContractRemind = await fetch(`${BASE_URL}/api/contracts/${encodeURIComponent(preparedContractId)}/remind`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
      }),
    }).then((response) => response.json());
    const canonicalContractPdfResponse = await fetch(`${BASE_URL}/api/contracts/${encodeURIComponent(preparedContractId)}/pdf`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    const canonicalContractPdfBuffer = Buffer.from(await canonicalContractPdfResponse.arrayBuffer());
    const canonicalContractVoid = await fetch(`${BASE_URL}/api/contracts/${encodeURIComponent(preparedContractId)}/void`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
      }),
    }).then((response) => response.json());
    const instantlyWebhook = await fetch(`${BASE_URL}/api/webhooks/instantly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        event: 'reply.received',
        leadId: 'smoke-lead-1',
        name: 'Smoke Test Seller',
        email: 'smoke@example.com',
        address: '808 Smoke Test Ave, Columbus OH',
        body: 'Yes, tell me more.',
      }),
    }).then((response) => response.json());
    const emailWebhook = await fetch(`${BASE_URL}/api/webhooks/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        type: 'reply',
        leadId: 'smoke-lead-1',
        name: 'Smoke Test Seller',
        email: 'smoke@example.com',
        address: '808 Smoke Test Ave, Columbus OH',
        subject: 'Re: Seller packet',
        text: 'I am interested and ready for a call.',
      }),
    }).then((response) => response.json());
    const telnyxSmsInboundWebhook = await fetch(`${BASE_URL}/webhooks/telnyx/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          event_type: 'message.received',
          payload: {
            id: 'msg-smoke-telnyx-inbound-sms',
            record_type: 'message',
            type: 'SMS',
            from: { phone_number: '+16145550199' },
            to: [{ phone_number: '+16145550100' }],
            text: 'Smoke SMS should not be routed as an inbound call.',
          },
        },
      }),
    }).then((response) => response.json());
    const pdfResponse = await fetch(`${BASE_URL}/api/documents/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        documentType: 'masterPackage',
        documentTitle: 'PBK Smoke Test Package',
        propertyAddress: '808 Smoke Test Ave, Columbus OH',
        selectedPathLabel: 'Cash Offer',
        companyName: 'Probono Key Realty',
        previewOrigin: 'https://pbkcommandcenter.netlify.app',
        content: 'Smoke test document payload.',
      }),
    });
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    assert(health?.ok === true, 'Bridge health did not report ok: true.');
    assert(typeof health?.revision === 'string' && health.revision.length > 0, 'Bridge health did not return a revision.');
    assert(health?.features?.authRequired === true, 'Bridge health did not report authRequired: true.');
    assert(typeof health?.features?.stateBackend === 'string' && health.features.stateBackend.length > 0, 'Bridge health did not report stateBackend.');
    assert(health?.runtime?.mode === 'local', `Expected local smoke runtime mode, got ${health?.runtime?.mode || 'missing'}.`);
    assert(health?.runtime?.hosted === false, 'Expected local smoke runtime hosted flag to be false.');
    assert(Array.isArray(health?.runtime?.warnings), 'Bridge health did not expose runtime warnings array.');
    assert(health?.components?.bridge?.status === 'up', 'Bridge health did not expose command-center components.');
    assert(health?.components?.postgres?.status, 'Bridge health did not expose state backend component.');
    assert(health?.componentSummary?.total >= 10, 'Bridge health component summary is incomplete.');
    assert(ttsHealth?.ok === true && ttsHealth?.elevenLabs?.provider === 'ElevenLabs', 'ElevenLabs TTS health endpoint did not return provider metadata.');
    assert(ttsHealth?.elevenLabs?.tuning?.dynamicProsody === true, 'ElevenLabs TTS health did not expose dynamic prosody tuning.');
    assert(ttsHealth?.elevenLabs?.tuning?.prosodyLearning === true, 'ElevenLabs TTS health did not expose prosody learning.');
    assert(prosodyDebug?.ok === true && prosodyDebug?.result === 'prosody_debug', 'Prosody debug endpoint did not return a debug result.');
    assert(Array.isArray(prosodyDebug?.prosody?.tags) && prosodyDebug.prosody.tags.length > 0, 'Prosody debug did not plan dynamic emotional tags.');
    if (prosodyDebug?.elevenLabs?.audioTagsEnabled === false) {
      assert(prosodyDebug?.textControls?.appliedTags === false, 'Prosody debug unexpectedly applied audio tags to the low-latency model.');
    }
    assert(prosodyAnalytics?.ok === true && prosodyAnalytics?.summary && typeof prosodyAnalytics.summary.total === 'number', 'Prosody analytics endpoint did not return a summary.');
    assert(unauthorizedState.status === 401, `Expected unauthenticated /state to return 401, got ${unauthorizedState.status}.`);
    assert(Array.isArray(state?.approvals), 'Authenticated /state did not return approvals.');
    assert(quotas?.ok === true, 'Quota endpoint did not return ok: true.');
    assert(typeof quotas?.quotas?.docs?.deliveredToday === 'number', 'Quota endpoint did not return docs counters.');
    assert(tooling?.ok === true, 'Tooling status endpoint did not return ok: true.');
    assert(Number(tooling?.tooling?.summary?.totalCount || 0) >= 5, 'Tooling status did not report the advanced stack.');
    assert(typeof tooling?.tooling?.browserOs?.note === 'string', 'Tooling status did not return BrowserOS metadata.');
    assert(Array.isArray(contractTemplates?.templates), 'Contract template endpoint did not return templates.');
    assert(firstLeadEvent?.ok === true, 'First lead-intake event did not succeed.');
    assert(secondLeadEvent?.replayed === true, 'Second identical lead-intake event was not treated as a replay.');
    assert(firstApprovalDecision?.ok === true, 'First approval callback did not succeed.');
    assert(secondApprovalDecision?.replayed === true, 'Second identical approval callback was not treated as a replay.');
    assert(invoke?.ok === true, 'Authenticated /invoke getBrainState did not succeed.');
    assert(avaCommand?.ok === true, 'Ava runAgentCommand smoke did not succeed.');
    assert(avaCommand?.result?.routedTo === 'agent_brain', `Ava masterclass command routed to ${avaCommand?.result?.routedTo || 'missing'} instead of agent_brain.`);
    assert(/due[- ]on[- ]sale|attorney|loan/i.test(String(avaCommand?.result?.response?.answer || avaCommand?.result?.response?.verbiage || '')), 'Ava masterclass command did not return subject-to guardrail language.');
    assert(avaResponseOnlyCommand?.ok === true, 'Ava response-only command did not succeed.');
    assert(
      avaResponseOnlyCommand?.result?.routedTo === 'ava_conversation_intelligence',
      `Ava response-only command routed to ${avaResponseOnlyCommand?.result?.routedTo || 'missing'} instead of ava_conversation_intelligence.`,
    );
    assert(
      avaResponseOnlyCommand?.result?.response?.result === 'ava_conversation_intelligence',
      'Ava response-only command did not return conversation intelligence.',
    );
    assert(
      !/\b(do-not-call|do not call list|stop outreach|marked do-not-call)\b/i.test(String(avaResponseOnlyCommand?.result?.response?.answer || '')),
      'Ava response-only command treated routing guardrails as seller-facing DNC intent.',
    );
    assert(avaSafeStatusCommand?.ok === true, 'Ava safe status command did not succeed.');
    assert(
      avaSafeStatusCommand?.result?.routedTo === 'ava_conversation_intelligence',
      `Ava safe status command routed to ${avaSafeStatusCommand?.result?.routedTo || 'missing'} instead of ava_conversation_intelligence.`,
    );
    assert(
      avaSafeStatusCommand?.result?.response?.result === 'ava_conversation_intelligence',
      'Ava safe status command did not return conversation intelligence.',
    );
    assert(fastBridgeStatusCommand?.ok === true, 'Fast bridge status command did not succeed.');
    assert(
      fastBridgeStatusCommand?.result?.routedTo === 'bridge_health_status',
      `Fast bridge status command routed to ${fastBridgeStatusCommand?.result?.routedTo || 'missing'} instead of bridge_health_status.`,
    );
    assert(
      fastBridgeStatusCommand?.result?.intentRouter?.providerBypassed === true
        && fastBridgeStatusCommand?.result?.intentRouter?.cache === 'miss',
      'First fast bridge status command did not report a provider-bypassed cache miss.',
    );
    assert(
      cachedFastBridgeStatusCommand?.result?.intentRouter?.providerBypassed === true
        && cachedFastBridgeStatusCommand?.result?.intentRouter?.cache === 'hit',
      'Repeated fast bridge status command did not use the short-lived result cache.',
    );
    assert(avaTtsDiagnosticCommand?.ok === true, 'Ava TTS diagnostic command did not succeed.');
    assert(
      avaTtsDiagnosticCommand?.result?.routedTo === 'ava_conversation_intelligence',
      `Ava TTS diagnostic command routed to ${avaTtsDiagnosticCommand?.result?.routedTo || 'missing'} instead of ava_conversation_intelligence.`,
    );
    assert(
      avaTtsDiagnosticCommand?.result?.response?.result === 'ava_conversation_intelligence',
      'Ava TTS diagnostic command did not return conversation intelligence.',
    );
    assert(
      avaTtsDiagnosticCommand?.result?.response?.actionPolicy?.providerWritesBlocked === true
        || /provider writes blocked|no provider writes|read[-\s]?only/i.test(JSON.stringify(avaTtsDiagnosticCommand?.result?.response || {})),
      'Ava TTS diagnostic command did not preserve no-provider-write context.',
    );
    assert(closingIntelligence?.ok === true, 'Closing intelligence invoke did not succeed.');
    assert(closingIntelligence?.result?.result === 'closing_intelligence', 'Closing intelligence invoke did not return the closing_intelligence result.');
    assert(/repair|closing risk|holding|certainty|listing|net/i.test(String(closingIntelligence?.result?.nextBestPhrase || '')), 'Closing intelligence did not return a seller-facing next best phrase.');
    assert(Array.isArray(closingIntelligence?.result?.doNotSay) && closingIntelligence.result.doNotSay.length > 0, 'Closing intelligence did not return guardrails.');
    assert(closingBrainRetrieve?.ok === true && closingBrainRetrieve?.result === 'closing_intelligence', 'Brain retrieve endpoint did not return closing intelligence.');
    assert(/verify|proof|comfortable|company/i.test(String(closingBrainRetrieve?.nextBestPhrase || closingBrainRetrieve?.advice?.nextBestPhrase || '')), 'Brain retrieve endpoint did not return verification-aware closing language.');
    assert(avaConversationIntelligence?.ok === true && avaConversationIntelligence?.result === 'ava_conversation_intelligence', 'Ava conversation intelligence endpoint did not succeed.');
    assert(avaConversationIntelligence?.reaction?.trigger === 'de_escalate', 'Ava conversation intelligence did not react to low sentiment with de-escalation.');
    assert(avaConversationIntelligence?.prosody?.profile === 'de_escalation', 'Ava conversation intelligence did not return de-escalation prosody.');
    assert(avaConversationIntelligence?.promptFrame?.role?.includes('top 1%'), 'Ava conversation intelligence did not include seven-figure prompt framing.');
    assert(avaConversationIntelligence?.warManual?.revision, 'Ava conversation intelligence did not include the War Manual context.');
    assert(avaConversationIntelligence?.warManual?.source === 'fifty_plus_objection_decoder', 'Ava War Manual context did not expose the 50+ objection decoder source.');
    assert(avaConversationIntelligence?.warManual?.pathPicker?.name === '7-second path picker', 'Ava War Manual context did not include the 7-second path picker.');
    assert(avaConversationIntelligence?.warManual?.objection?.tag === 'price_too_low', 'Ava War Manual context did not decode the price-too-low objection.');
    assert(avaConversationIntelligence?.warManual?.listenProbe?.doctrine === 'L.I.S.T.E.N.', 'Ava War Manual context did not include the L.I.S.T.E.N. probe.');
    assert(avaConversationIntelligence?.warManual?.toneMode?.label, 'Ava War Manual context did not include a delivery tone mode.');
    assert(avaConversationIntelligence?.activeListening?.revision, 'Ava conversation intelligence did not include the active-listening call-flow layer.');
    assert(avaConversationIntelligence?.activeListening?.mode === 'twenty_year_pro_ready', 'Ava active listening was not marked 20-year-pro ready.');
    assert(avaConversationIntelligence?.activeListening?.responseRequired === true, 'Ava active listening did not require a seller response.');
    assert(avaConversationIntelligence?.activeListening?.mirroredPhrase, 'Ava active listening did not extract seller words to mirror.');
    assert(avaConversationIntelligence?.activeListening?.callFlow?.schema === 'call_flow/call_flow_edges', 'Ava active listening did not expose the call_flow/call_flow_edges decision tree.');
    assert(avaConversationIntelligence?.activeListening?.callFlow?.nextStepId, 'Ava active listening did not choose a next call-flow step.');
    assert(avaConversationIntelligence?.activeListening?.callFlow?.nextStepId === 'objection.spouse_3way', 'Ava active listening did not route spouse authority to the 3-way call branch.');
    assert(/\b(?:three-way|3-way)\b/i.test(String(avaConversationIntelligence?.answer || avaConversationIntelligence?.nextBestPhrase || '')), 'Ava active-listening answer did not use the spouse 3-way branch.');
    assert(/[?]\s*$/.test(String(avaConversationIntelligence?.answer || avaConversationIntelligence?.nextBestPhrase || '')), 'Ava active-listening answer did not end with a seller-response hook.');
    assert(avaAgentCommissionProbe?.callerRole?.role === 'agent', 'Ava did not classify an explicit listing agent as agent caller role.');
    assert(/\b(full commission|keep you in the deal|protect(?:ed)? commission)\b/i.test(String(avaAgentCommissionProbe?.answer || avaAgentCommissionProbe?.nextBestPhrase || '')), 'Ava did not reassure the agent that commission stays protected before probing.');
    assert(/\b(address|listed|market|condition|seller|client|property)\b/i.test(String(avaAgentCommissionProbe?.answer || avaAgentCommissionProbe?.nextBestPhrase || '')), 'Ava did not probe the agent for property/listing details.');
    assert(avaOwnerCreativeFinanceGuard?.callerRole?.role === 'owner', 'Ava did not classify an explicit homeowner as owner caller role.');
    assert(!['cf', 'creative_finance', 'mf', 'multi_family', 'multifamily'].includes(String(avaOwnerCreativeFinanceGuard?.pathDecision?.selectedPath || '').toLowerCase()), 'Ava allowed an owner call to stay on a CF/MF path.');
    assert(!/\b(creative finance|seller financ|carry(?:ing)? the note|multifamily|multi-family|mf path)\b/i.test(String(avaOwnerCreativeFinanceGuard?.answer || avaOwnerCreativeFinanceGuard?.nextBestPhrase || '')), 'Ava spoke agent-only CF/MF language to a homeowner.');
    assert(avaFullIntelligenceContextResume?.ok === true, 'Ava full-intelligence context-resume smoke did not succeed.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.enabled === true, 'Ava full intelligence mode was not enabled for a weak transcript turn.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.mode === 'full', 'Ava full intelligence mode was not set to full.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.context?.weakTranscript === true, 'Ava did not mark the latest weak transcript as weak.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.context?.source !== 'current_transcript', 'Ava did not promote recent seller context over the weak current transcript.');
    assert(/\b(inherited|probate|sell fast)\b/i.test(String(avaFullIntelligenceContextResume?.fullIntelligence?.context?.bestTranscript || '')), 'Ava did not preserve the strongest recent seller context for answering.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.layers?.bant === true, 'Ava full intelligence did not force BANT on.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.layers?.pathDecision === true, 'Ava full intelligence did not force path decision on.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.layers?.warManual === true, 'Ava full intelligence did not force the War Manual on.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.layers?.activeListening === true, 'Ava full intelligence did not force active listening on.');
    assert(avaFullIntelligenceContextResume?.fullIntelligence?.layers?.scripts === true, 'Ava full intelligence did not force scripts on.');
    assert(/[?]\s*$/.test(String(avaFullIntelligenceContextResume?.answer || avaFullIntelligenceContextResume?.nextBestPhrase || '')), 'Ava full-intelligence weak transcript answer did not end with a seller-response hook.');
    assert(avaFullIntelligenceAgentContextResume?.fullIntelligence?.context?.source !== 'current_transcript', 'Ava did not preserve a realtor/agent caller turn as resumable best context.');
    assert(/\b(listing agent|full price|rent|loan)\b/i.test(String(avaFullIntelligenceAgentContextResume?.fullIntelligence?.context?.bestTranscript || '')), 'Ava did not promote the agent caller context for CF/MF-safe handling.');
    for (const testCase of avaPathDecisionCases) {
      const decision = testCase.result?.pathDecision || testCase.result?.architecture?.pathDecision || {};
      const answer = String(testCase.result?.answer || testCase.result?.nextBestPhrase || '');
      const expectedAnswerPatterns = {
        cash: /fastest|surest|cash offer/i,
        rbp: /Retail Buyer Program|side-by-side|45 to 60/i,
        cf: /Creative Finance|carry|carrying|full asking/i,
        mt: /mortgage takeover|low-rate|existing payment|highest-net/i,
        land: /builders|builder-backed|zoning|utilities/i,
      };
      assert(
        testCase.result?.ok === true && decision.selectedPath === testCase.expectedPath,
        `Ava path decision expected ${testCase.expectedPath} but got ${decision.selectedPath || 'missing'} for "${testCase.query}".`,
      );
      assert(decision.pathLocked === true, `Ava path decision did not lock ${testCase.expectedPath}.`);
      assert(
        typeof decision.scriptTrigger === 'string' && decision.scriptTrigger.length > 20,
        `Ava path decision did not return a script trigger for ${testCase.expectedPath}.`,
      );
      assert(
        expectedAnswerPatterns[testCase.expectedPath].test(answer),
        `Ava answer did not close down the ${testCase.expectedPath} script path. Answer was: ${answer}`,
      );
    }
    assert(prosodyAdvice?.ok === true && prosodyAdvice?.prosody?.speed < 0.9, 'Prosody advice did not slow down for angry sentiment.');
    assert(liveReplyPreview?.ok === true && liveReplyPreview?.noProviderWrites === true, 'Live reply preview did not return a safe no-write response.');
    assert(!/\b(Rex Strategist|Ava Strategist|PBK Production Voice Proof|PBK Command Center|OpenClaw)\b/i.test(String(liveReplyPreview?.text || '')), 'Live reply preview leaked internal agent/test identity into seller-facing speech.');
    assert(!/\b(call[_\s-]?control|stream[_\s-]?id|lead[_\s-]?id|request[_\s-]?id|the number on file|614[\s.-]?555[\s.-]?0199)\b/i.test(String(liveReplyPreview?.text || '')), 'Live reply preview leaked internal IDs or phone-like text into seller-facing speech.');
    assert(callQaScore?.ok === true && Number(callQaScore?.score?.score || 0) > 0, 'Call QA score endpoint did not score the transcript.');
    assert(Array.isArray(callQaScore?.state?.callQaScores), 'Call QA score endpoint did not return state with call QA rows.');
    assert(skillOutcome?.ok === true && skillOutcome?.summary?.total >= 1, 'Skill outcome endpoint did not record measured skill usage.');
    assert(Array.isArray(skillOutcome?.state?.skillOutcomes), 'Skill outcome endpoint did not return state with skill outcomes.');
    assert(similarDeals?.ok === true && Array.isArray(similarDeals?.deals), 'Similar deals endpoint did not return a deals array.');
    assert(conversationMemory?.ok === true && Array.isArray(conversationMemory?.memories), 'Conversation memory endpoint did not return memories array.');
    assert(humanHandoff?.ok === true && ['handoff_queued', 'live_transfer'].includes(String(humanHandoff?.result || '')), 'Human handoff endpoint did not queue or transfer cleanly.');
    assert(directSlackNotify?.ok === true, 'Direct Slack notify endpoint did not return a handled bridge response.');
    assert(['live', 'provider_missing'].includes(String(directSlackNotify?.result || '')), 'Direct Slack notify endpoint did not return live/provider_missing result.');
    assert(Array.isArray(directSlackNotify?.state?.activity), 'Direct Slack notify endpoint did not return updated runtime state.');
    assert(filteredApprovals?.ok === true, 'Filtered approvals endpoint did not succeed.');
    assert(Array.isArray(filteredApprovals?.approvals), 'Filtered approvals endpoint did not return approvals array.');
    assert(filteredApprovals.approvals.every((approval) => String(approval.status || '').toLowerCase() === 'pending'), 'Filtered approvals endpoint returned non-pending approvals.');
    assert(filteredApprovals?.stateIncluded === true, 'Filtered approvals endpoint did not honor includeState=1.');
    assert(filteredApprovals?.state?.approvals, 'Filtered approvals endpoint did not return runtime state for the approval board.');
    assert(brainIngest?.ok === true, 'Brain ingest endpoint did not succeed.');
    assert(youtubeBrainIngest?.ok === true, 'YouTube Brain ingest endpoint did not succeed.');
    assert(youtubeBrainIngest?.result === 'youtube_training_ready', 'YouTube Brain ingest did not route through training pipeline.');
    assert(youtubeBrainIngest?.testCase?.assertions?.length >= 3, 'YouTube Brain ingest did not create eval assertions.');
    assert(youtubeBrainIngest?.coachMemoryEntries?.some((entry) => entry.objectionTag === 'spouse_approval'), 'YouTube Brain ingest did not extract spouse objection memory.');
    assert(Array.isArray(brainQuery?.brainDocs), 'Brain query endpoint did not return brainDocs.');
    assert(rexDecisions?.ok === true && Array.isArray(rexDecisions?.decisions), 'Rex decisions endpoint did not return decisions.');
    assert(rexProposal?.ok === true, 'Rex strategist proposal endpoint did not queue a proposal.');
    assert(rexProposal?.approval || rexProposal?.decision || rexProposal?.state, 'Rex strategist proposal did not return approval/decision state.');
    assert(agentOrchestration?.ok === true, 'Agent orchestration endpoint did not report ok.');
    assert(agentOrchestration?.orchestration?.topology === 'supervisor-worker', 'Agent orchestration did not report supervisor-worker topology.');
    assert(agentOrchestration?.orchestration?.supervisor?.id === 'ava', 'Agent orchestration did not report Ava as supervisor.');
    assert((agentOrchestration?.orchestration?.workers || []).some((agent) => agent.id === 'rex'), 'Agent orchestration did not include Rex as a worker.');
    assert((agentOrchestration?.orchestration?.workers || []).some((agent) => agent.id === 'hermes'), 'Agent orchestration did not include Hermes as a worker.');
    const orchestrationAgentIds = new Set([
      agentOrchestration?.orchestration?.supervisor?.id,
      ...(agentOrchestration?.orchestration?.workers || []).map((agent) => agent.id),
    ]);
    for (const requiredAgentId of [
      'ava',
      'rex',
      'max',
      'hermes',
      'call-analyzer',
      'prosody-tuner',
      'script-rotator',
      'bant-enforcer',
      'qa-agent',
      'nurture-agent',
      'research-orchestrator',
    ]) {
      assert(orchestrationAgentIds.has(requiredAgentId), `Agent orchestration did not include ${requiredAgentId}.`);
    }
    assert(agentOrchestrationSmoke?.ok === true, 'Agent orchestration smoke endpoint did not pass.');
    assert(agentOrchestrationSmoke?.probes?.ava?.routedTo === 'tool_first:analyze_deal', 'Agent orchestration smoke did not force Ava through analyze_deal.');
    assert(agentOrchestrationSmoke?.probes?.rex?.ok === true, 'Agent orchestration smoke did not verify Rex handoff.');
    assert(agentOrchestrationSmoke?.probes?.handlerCoverageReady === true, 'Agent orchestration smoke did not verify all local agent handlers.');
    const smokeProbeAgentIds = new Set((agentOrchestrationSmoke?.probes?.agents || []).map((probe) => probe.agentId));
    for (const requiredAgentId of [
      'ava',
      'rex',
      'max',
      'hermes',
      'call-analyzer',
      'prosody-tuner',
      'script-rotator',
      'bant-enforcer',
      'qa-agent',
      'nurture-agent',
      'research-orchestrator',
    ]) {
      assert(smokeProbeAgentIds.has(requiredAgentId), `Agent orchestration smoke did not probe ${requiredAgentId}.`);
    }
    assert(Array.isArray(agentOrchestrationSmoke?.tasks) && agentOrchestrationSmoke.tasks.length >= 10, 'Agent orchestration smoke did not create a full task trail.');
    assert(workflowSave?.ok === true, 'Workflow persistence endpoint did not save a draft.');
    assert(Array.isArray(workflows?.workflows), 'Workflow list endpoint did not return workflows.');
    assert(recordingSave?.ok === true, 'Recording metadata endpoint did not save.');
    assert([200, 501].includes(recordingLookupResponse.status), `Recording signed URL endpoint returned ${recordingLookupResponse.status}.`);
    assert(recordingLookup?.messageId === 'smoke-recording-msg-1', 'Recording signed URL endpoint did not echo the messageId.');
    const sellerDocsManualProviderMissing =
      sellerDocsResponse.status === 409 &&
      sellerDocs?.retryable === true &&
      sellerDocs?.outbox?.status === 'failed' &&
      !sellerDocs?.approval;
    assert(
      sellerDocs?.ok === true || sellerDocsManualProviderMissing,
      'Seller document endpoint must either send successfully or expose a retryable manual provider failure.'
    );
    assert(sellerDocsResponse.status !== 202, 'Manual seller document endpoint must not approval-gate.');
    assert(sellerDocsResponse.status !== 502, 'Manual seller document endpoint must not surface provider failure as bridge 502.');
    assert(typeof browserResearch?.answer === 'string', 'Browser research endpoint did not return a response.');
    assert(adminRequest?.ok === true, 'Admin request endpoint did not succeed.');
    assert(adminApproval?.ok === true, 'Admin approval endpoint did not succeed.');
    assert(preparedContract?.ok === true, 'Contract prepare endpoint did not succeed.');
    assert(canonicalDraftContract?.ok === true, 'Canonical contract draft endpoint did not succeed.');
    assert(canonicalAnalyzeDeal?.ok === true && typeof canonicalAnalyzeDeal?.mao === 'number', 'Canonical analyzeDeal endpoint did not return analysis.');
    assert(canonicalApproveRequest?.ok === true, 'Canonical approval setup for approve endpoint did not succeed.');
    assert(canonicalApprove?.ok === true && canonicalApprove?.approval?.status === 'approved', 'Canonical approval approve endpoint did not approve.');
    assert(canonicalDenyRequest?.ok === true, 'Canonical approval setup for deny endpoint did not succeed.');
    assert(canonicalDeny?.ok === true && canonicalDeny?.approval?.status === 'rejected', 'Canonical approval deny endpoint did not reject.');
    assert(canonicalContractSend?.ok === true, 'Canonical contract send endpoint did not succeed.');
    assert(canonicalContractRemind?.ok === true, 'Canonical contract remind endpoint did not succeed.');
    assert(canonicalContractPdfResponse.ok, `Canonical contract PDF endpoint returned ${canonicalContractPdfResponse.status}.`);
    assert((canonicalContractPdfResponse.headers.get('content-type') || '').includes('application/pdf'), 'Canonical contract PDF endpoint did not return application/pdf.');
    assert(canonicalContractPdfBuffer.subarray(0, 4).toString('utf8') === '%PDF', 'Canonical contract PDF endpoint did not return a valid PDF signature.');
    assert(canonicalContractVoid?.ok === true && String(canonicalContractVoid?.contract?.status || '').includes('void'), 'Canonical contract void endpoint did not void the contract.');
    assert(instantlyWebhook?.ok === true, 'Instantly webhook endpoint did not succeed.');
    assert(emailWebhook?.ok === true, 'Email webhook endpoint did not succeed.');
    assert(telnyxSmsInboundWebhook?.mappedEvent === 'sms-inbound', 'Telnyx SMS sent to inbound webhook was not mapped as SMS.');
    assert(telnyxSmsInboundWebhook?.webhookType === 'message', 'Telnyx SMS sent to inbound webhook was misclassified as call control.');
    assert(pdfResponse.ok, `PDF endpoint returned ${pdfResponse.status}.`);
    assert((pdfResponse.headers.get('content-type') || '').includes('application/pdf'), 'PDF endpoint did not return application/pdf.');
    assert(pdfBuffer.subarray(0, 4).toString('utf8') === '%PDF', 'PDF endpoint did not return a valid PDF signature.');

    console.log(JSON.stringify({
      ok: true,
      revision: health.revision,
      healthStatus: health.status,
      authRequired: health.features.authRequired,
      stateBackend: health.features.stateBackend,
      healthComponents: Number(health?.componentSummary?.total || 0),
      mode: health.runtime.mode,
      approvals: Array.isArray(state?.approvals) ? state.approvals.length : 0,
      activity: Array.isArray(state?.activity) ? state.activity.length : 0,
      contractTemplates: Array.isArray(contractTemplates?.templates) ? contractTemplates.templates.length : 0,
      avaRoutedTo: avaCommand?.result?.routedTo || '',
      avaResponseOnlyRoutedTo: avaResponseOnlyCommand?.result?.routedTo || '',
      avaConversationTrigger: avaConversationIntelligence?.reaction?.trigger || '',
      avaProsodyProfile: avaConversationIntelligence?.prosody?.profile || '',
      callQaScore: Number(callQaScore?.score?.score || 0),
      skillOutcomeCount: Number(skillOutcome?.summary?.total || 0),
      rexDecisions: Array.isArray(rexDecisions?.decisions) ? rexDecisions.decisions.length : 0,
      agentOrchestration: agentOrchestration?.orchestration?.result || '',
      agentOrchestrationTasks: Array.isArray(agentOrchestrationSmoke?.tasks) ? agentOrchestrationSmoke.tasks.length : 0,
      toolingReady: Number(tooling?.tooling?.summary?.readyCount || 0),
      browserOsReady: Boolean(tooling?.tooling?.browserOs?.ready),
      docsDeliveredToday: Number(quotas?.quotas?.docs?.deliveredToday || 0),
      adminQueue: Number(quotas?.quotas?.docs?.queuedAdminTasks || 0),
      leadReplaySafe: Boolean(secondLeadEvent?.replayed),
      approvalReplaySafe: Boolean(secondApprovalDecision?.replayed),
      pdfBytes: pdfBuffer.length,
    }, null, 2));
  } catch (error) {
    await cleanup();
    const message = error instanceof Error ? error.message : 'Unknown smoke test failure';
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    console.error(message);
    process.exitCode = 1;
    return;
  }

  await cleanup();
}

main();
