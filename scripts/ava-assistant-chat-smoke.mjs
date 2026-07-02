import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  appendAssistantMessage,
  buildAssistantPrompt,
  createAssistantSessionId,
  detectAssistantIntent,
  planAssistantIntent,
} from './ava-assistant-chat.mjs';

const root = process.cwd();
const avaChatRoute = readFileSync(resolve(root, 'src/app/routes/AvaChat.tsx'), 'utf8');
const pbkCss = readFileSync(resolve(root, 'src/styles/pbk-components.css'), 'utf8');
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');

const sessionId = createAssistantSessionId();
assert.match(sessionId, /^ava_chat_[0-9a-f]{12}$/i, 'Assistant session id should be stable, short, and namespaced.');

let session = { history: [] };
for (let index = 0; index < 45; index += 1) {
  session = appendAssistantMessage(session, index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`);
}
assert.equal(session.history.length, 40, 'Assistant session memory should keep only the most recent 40 turns.');
assert.equal(session.history[0].content, 'turn 5', 'Assistant session memory should evict the oldest turns first.');

const redactedSession = appendAssistantMessage(
  { history: [] },
  'user',
  'DocuSign docusign_private_key=abc1234567890 Telnyx telnyx_api_key=key_live_1234567890 Instantly instantly_api_key=inst_1234567890 Bearer abcdefghijklmnopqrstuvwxyz sk-proj-abcdefghijklmnopqrst'
);
assert.match(redactedSession.history[0].content, /\[redacted-secret]/, 'Assistant history should redact secrets.');
assert.doesNotMatch(
  redactedSession.history[0].content,
  /docusign_private_key|telnyx_api_key|instantly_api_key|Bearer\s+abcdefghijklmnopqrstuvwxyz|sk-proj-abcdefghijklmnopqrst/i,
  'Assistant history should not retain provider key labels or values.'
);

const longSession = appendAssistantMessage({ history: [] }, 'user', 'x'.repeat(2000));
assert.equal(longSession.history[0].content.length, 1800, 'Assistant history should still cap oversized turns.');
assert.equal(longSession.history[0].metadata.truncated, true, 'Assistant history should mark silently truncated turns.');
assert.match(
  longSession.history[0].metadata.warning,
  /Long text truncated/i,
  'Assistant history should explain when only the first part of a turn was retained.'
);

const analyzeIntent = detectAssistantIntent('Analyze 202 Cherry Ln and tell me the MAO.');
assert.equal(analyzeIntent.intent, 'analyze_deal', 'Assistant should detect deal-analysis requests.');
assert.equal(analyzeIntent.address, '202 Cherry Ln', 'Assistant should extract a simple street address from analysis requests.');

const nuancedAnalyzeIntent = detectAssistantIntent('Is this worth chasing?');
assert.equal(
  nuancedAnalyzeIntent.intent,
  'analyze_deal',
  'Assistant should route common nuanced deal-evaluation phrasing to analysis instead of general chat.'
);

const callIntent = detectAssistantIntent('Call 614-555-0199 for me now.');
assert.equal(callIntent.intent, 'call', 'Assistant should detect call requests.');
assert.equal(callIntent.phone, '6145550199', 'Assistant should normalize phone numbers.');

const smsIntent = detectAssistantIntent('Send a text to this lead that I can call tomorrow at 3.');
assert.equal(smsIntent.intent, 'seller_message', 'Assistant should detect seller SMS requests.');
assert.equal(smsIntent.channel, 'sms', 'Seller text requests should route to SMS.');
assert.equal(smsIntent.delivery, 'send', 'Explicit send language should request approval-gated delivery.');
assert.match(smsIntent.messageBody, /call tomorrow/i, 'SMS intent should extract the operator message body.');

const emailIntent = detectAssistantIntent('Send an email to seller@example.com saying we can review the offer tonight.');
assert.equal(emailIntent.intent, 'seller_message', 'Assistant should detect seller email requests.');
assert.equal(emailIntent.channel, 'email', 'Email requests should route to email.');
assert.equal(emailIntent.email, 'seller@example.com', 'Email intent should extract the recipient email.');

const contractPrepareIntent = detectAssistantIntent('Prepare the contract for 202 Cherry Ln but do not send it.');
assert.equal(contractPrepareIntent.intent, 'contract_prepare', 'Assistant should detect contract-preparation requests.');
const contractSendIntent = detectAssistantIntent('Send DocuSign contract for 202 Cherry Ln.');
assert.equal(contractSendIntent.intent, 'contract_send', 'Assistant should distinguish DocuSign send requests from draft prep.');

const scheduleIntent = detectAssistantIntent('Schedule a follow-up for this lead tomorrow.');
assert.equal(scheduleIntent.intent, 'schedule_follow_up', 'Assistant should detect follow-up scheduling requests.');
assert.equal(scheduleIntent.when, 'tomorrow', 'Follow-up scheduling should extract simple timing hints.');

const memoryIntent = detectAssistantIntent('Remember this note: seller needs spouse approval.');
assert.equal(memoryIntent.intent, 'remember_note', 'Assistant should detect memory capture requests.');
assert.match(memoryIntent.note, /spouse approval/i, 'Memory capture should retain the note body.');

const callReviewIntent = detectAssistantIntent('Review the latest call and tell me what Ava missed.');
assert.equal(callReviewIntent.intent, 'call_review', 'Assistant should detect latest-call review requests.');

const additiveIntent = detectAssistantIntent('Use all frontier additives and sync the whole system intelligence.');
assert.equal(
  additiveIntent.intent,
  'unified_additive_intelligence',
  'Assistant should detect unified additive intelligence requests.'
);

const publicCallPlan = planAssistantIntent(callIntent, { publicMode: true });
assert.equal(publicCallPlan.action, 'blocked_public_provider_write', 'Public assistant chat must not place calls.');
assert.match(publicCallPlan.answer, /public chat.*will not start calls/i, 'Public call block should explain the safety boundary.');
assert.deepEqual(publicCallPlan.toolPlan, null, 'Public blocked intents must not return an executable tool plan.');

const publicContractPlan = planAssistantIntent(contractSendIntent, { publicMode: true });
assert.equal(
  publicContractPlan.action,
  'blocked_public_provider_write',
  'Public assistant chat must not prepare private DocuSign actions.'
);

const publicApprovalPlan = planAssistantIntent(detectAssistantIntent("What's my approval status?"), { publicMode: true });
assert.equal(publicApprovalPlan.action, 'blocked_public_private_data', 'Public assistant chat must not expose private approvals.');
assert.match(publicApprovalPlan.answer, /command center/i, 'Public private-data block should point users to the Command Center.');
assert.match(publicApprovalPlan.answer, /\/index\.shell\.html/i, 'Public private-data block should include a concrete Command Center link.');

const internalHelpIntent = detectAssistantIntent('What can you help my agents do from this chat?');
assert.equal(internalHelpIntent.intent, 'help', 'Assistant should treat agent capability questions as help intent.');
const internalHelpPlan = planAssistantIntent(internalHelpIntent, {
  publicMode: false,
  authenticated: true,
});
assert.equal(internalHelpPlan.action, 'internal_help', 'Authenticated help should answer directly instead of falling into generic memory search.');
assert.match(internalHelpPlan.answer, /find leads/i, 'Authenticated help should explain practical agent-facing capabilities.');
assert.doesNotMatch(internalHelpPlan.answer, /bridge state|OpenClaw|sidecar|tool plan/i, 'Authenticated help should avoid internal technical terms.');

const recallIntent = detectAssistantIntent('What did I just ask you?');
assert.equal(recallIntent.intent, 'session_recall', 'Assistant should detect current-session recall requests.');
const recallPlan = planAssistantIntent(recallIntent, {
  publicMode: true,
  session: {
    history: [
      { role: 'user', content: 'Analyze 202 Cherry Ln.' },
      { role: 'assistant', content: 'I can help with that.' },
    ],
  },
});
assert.match(recallPlan.answer, /Analyze 202 Cherry Ln/i, 'Assistant should answer recall requests from current session history.');

const persistedRecallPlan = planAssistantIntent(recallIntent, {
  publicMode: true,
  session: { history: [] },
  recalledHistory: [
    { role: 'user', content: 'Check the MAO on 789 Maple Ave.' },
    { role: 'assistant', content: 'I can help with that.' },
  ],
});
assert.match(
  persistedRecallPlan.answer,
  /789 Maple Ave/i,
  'Assistant should answer recall requests from reloaded persisted session turns after refresh.'
);

const internalAnalyzePlan = planAssistantIntent(analyzeIntent, { publicMode: false, authenticated: true });
assert.equal(internalAnalyzePlan.action, 'tool_plan', 'Authenticated assistant should produce a safe tool plan for deal analysis.');
assert.equal(internalAnalyzePlan.toolPlan?.toolName, 'analyzeDeal', 'Deal analysis should route to analyzeDeal.');
assert.equal(internalAnalyzePlan.toolPlan?.params?.address, '202 Cherry Ln', 'Deal analysis tool plan should include the extracted address.');
assert.equal(internalAnalyzePlan.toolPlan?.requiresBridgeConfirmation, true, 'Deal analysis plans should require bridge fulfillment confirmation.');

const nuancedAnalyzePlan = planAssistantIntent(nuancedAnalyzeIntent, { publicMode: false, authenticated: true });
assert.equal(
  nuancedAnalyzePlan.action,
  'missing_required_info',
  'Nuanced deal analysis without an address should ask for the missing address instead of becoming general chat.'
);

const internalCallPlan = planAssistantIntent(callIntent, { publicMode: false, authenticated: true });
assert.equal(internalCallPlan.action, 'approval_required', 'Authenticated call requests should still stay approval-gated.');
assert.equal(internalCallPlan.toolPlan?.toolName, 'telnyx_call', 'Call requests should map to the Telnyx call tool only as an approval-gated plan.');
assert.equal(internalCallPlan.toolPlan?.params?.forceApproval, true, 'Assistant call requests should force approval even if autopilot is enabled.');

const internalSmsPlan = planAssistantIntent(smsIntent, {
  publicMode: false,
  authenticated: true,
  leadId: 'lead-sms-1',
});
assert.equal(internalSmsPlan.action, 'approval_required', 'Ava-initiated SMS sends should be approval-gated.');
assert.equal(internalSmsPlan.toolPlan?.toolName, 'telnyx_sms', 'SMS sends should route to Telnyx SMS.');
assert.equal(internalSmsPlan.toolPlan?.params?.forceApproval, true, 'SMS sends should force approval.');

const internalEmailPlan = planAssistantIntent(emailIntent, {
  publicMode: false,
  authenticated: true,
});
assert.equal(internalEmailPlan.action, 'approval_required', 'Ava-initiated email sends should be approval-gated.');
assert.equal(internalEmailPlan.toolPlan?.toolName, 'sendColdEmail', 'Email sends should route to the email sender.');
assert.equal(internalEmailPlan.toolPlan?.params?.email, 'seller@example.com', 'Email plan should keep the recipient email.');

const internalContractPreparePlan = planAssistantIntent(contractPrepareIntent, {
  publicMode: false,
  authenticated: true,
});
assert.equal(internalContractPreparePlan.action, 'tool_plan', 'Contract prep should create a draft plan without sending.');
assert.equal(internalContractPreparePlan.toolPlan?.toolName, 'prepareContract', 'Contract prep should route to prepareContract.');

const internalContractSendPlan = planAssistantIntent(contractSendIntent, {
  publicMode: false,
  authenticated: true,
});
assert.equal(internalContractSendPlan.action, 'approval_required', 'DocuSign sends should be approval-gated.');
assert.equal(
  internalContractSendPlan.toolPlan?.toolName,
  'prepare_and_send_contract',
  'DocuSign sends should route to the path-aware contract sender.'
);
assert.equal(internalContractSendPlan.toolPlan?.params?.forceApproval, true, 'DocuSign sends should force approval.');

const internalSchedulePlan = planAssistantIntent(scheduleIntent, {
  publicMode: false,
  authenticated: true,
  leadId: 'lead-follow-up-1',
});
assert.equal(internalSchedulePlan.action, 'approval_required', 'Follow-up scheduling from Ava should be approval-gated.');
assert.equal(internalSchedulePlan.toolPlan?.toolName, 'scheduleAppointment', 'Follow-up scheduling should route to scheduleAppointment.');

const internalMemoryPlan = planAssistantIntent(memoryIntent, {
  publicMode: false,
  authenticated: true,
  leadId: 'lead-memory-1',
});
assert.equal(internalMemoryPlan.action, 'tool_plan', 'Memory capture should use a readonly tool plan.');
assert.equal(internalMemoryPlan.toolPlan?.toolName, 'addPbkMemory', 'Memory capture should route to PBK memory.');

const internalCallReviewPlan = planAssistantIntent(callReviewIntent, {
  publicMode: false,
  authenticated: true,
});
assert.equal(internalCallReviewPlan.action, 'call_review_summary', 'Call reviews should use the internal call review summary path.');

const nurtureStartIntent = detectAssistantIntent('Start a nurture sequence for this lead tonight.');
assert.equal(nurtureStartIntent.intent, 'nurture_start', 'Assistant should distinguish explicit nurture automation from read-only consultation.');
const nurtureStartPlan = planAssistantIntent(nurtureStartIntent, {
  publicMode: false,
  authenticated: true,
  leadId: 'smoke-lead-1',
});
assert.equal(nurtureStartPlan.action, 'approval_required', 'Starting nurture from chat should be approval-gated.');
assert.equal(nurtureStartPlan.toolPlan?.toolName, 'startNurtureSequence', 'Explicit nurture starts should route to the sequence starter.');
assert.equal(nurtureStartPlan.toolPlan?.params?.forceApproval, true, 'Nurture starts should force the approval guard.');

const fuzzyNurtureIntent = detectAssistantIntent('Start a nurture sequence for Diane Kowalski tonight.');
const fuzzyNurturePlan = planAssistantIntent(fuzzyNurtureIntent, {
  publicMode: false,
  authenticated: true,
  leads: [
    { id: 'lead-diane', name: 'Diane Kowalski', address: '123 Oak St' },
    { id: 'lead-marco', name: 'Marco Hill', address: '88 Pine Rd' },
  ],
});
assert.equal(
  fuzzyNurturePlan.action,
  'lead_confirmation_required',
  'Nurture requests without an exact lead id should fuzzy-match a likely lead before asking the user to confirm.'
);
assert.equal(fuzzyNurturePlan.leadMatch?.leadId, 'lead-diane', 'Fuzzy nurture matching should return the best lead id.');
assert.equal(fuzzyNurturePlan.toolPlan?.toolName, 'confirmLeadMatch', 'Fuzzy nurture matching should not start provider work before confirmation.');
assert.equal(
  fuzzyNurturePlan.toolPlan?.params?.nextToolName,
  'startNurtureSequence',
  'Confirmed fuzzy nurture matches should know the approval-gated follow-up tool.'
);
assert.equal(fuzzyNurturePlan.toolPlan?.providerWrite, false, 'Lead confirmation plans should be readonly.');

const additivePlan = planAssistantIntent(additiveIntent, { publicMode: false, authenticated: true });
assert.equal(additivePlan.action, 'tool_plan', 'Authenticated additive requests should produce a safe tool plan.');
assert.equal(
  additivePlan.toolPlan?.toolName,
  'runUnifiedAdditiveIntelligence',
  'Unified additive requests should route to the explicit unified additive intelligence tool.'
);
assert.equal(additivePlan.toolPlan?.providerWrite, false, 'Unified additive intelligence should stay readonly.');
assert.equal(additivePlan.toolPlan?.params?.liveProbe, true, 'Provider-aware additive intelligence should check configured providers.');

const prompt = buildAssistantPrompt({
  history: [
    { role: 'user', content: 'Remember 123 Cedar St.' },
    { role: 'assistant', content: 'I have that context.' },
  ],
});
assert.match(prompt, /Previous conversation:/, 'Assistant prompt should include recent session context.');
assert.match(prompt, /123 Cedar St/, 'Assistant prompt should include prior user turns.');
assert.doesNotMatch(
  prompt,
  /Keep replies under two sentences/i,
  'Ava Chat should not force every DeepSeek-backed reply into a robotic two-sentence ceiling.'
);
assert.match(
  prompt,
  /fuller conversation when the operator is asking for strategy, coaching, memory, or a complicated next action/i,
  'Ava Chat should allow richer companion responses when the operator needs strategy or coaching.'
);

assert(
  avaChatRoute.includes('AvaThinkingBubble') &&
    avaChatRoute.includes('AssistantExchange') &&
    avaChatRoute.includes('AvaMissionTimeline') &&
    avaChatRoute.includes('pbk-ava-mission-timeline') &&
    avaChatRoute.includes('sendAvaAssistantChatRequest') &&
    avaChatRoute.includes('shouldUseAssistantChatRoute') &&
    avaChatRoute.includes('pbk-ava-inline-approval') &&
    avaChatRoute.includes('Review before Ava continues') &&
    avaChatRoute.includes('Speak to Ava'),
  'Ava Chat route must expose direct assistant replies, thinking, voice input, and inline approval states.'
);
assert(
  avaChatRoute.includes('Ava plan') &&
    avaChatRoute.includes('Understood:') &&
    avaChatRoute.includes('Checked:') &&
    avaChatRoute.includes('Ava decided:') &&
    avaChatRoute.includes('Next move:') &&
    avaChatRoute.includes('deepSeekDecision') &&
    avaChatRoute.includes('missionTimeline') &&
    avaChatRoute.includes('confidencePercent') &&
    avaChatRoute.includes('normalizeAvaDeepSeekDecision') &&
    avaChatRoute.includes('blockedDecision') &&
    avaChatRoute.includes('Paused') &&
    avaChatRoute.includes('mission?.timeline') &&
    avaChatRoute.includes('mission?.tasks') &&
    avaChatRoute.includes('currentStep') &&
    avaChatRoute.includes('Ava checked the request and is keeping the next move inside the right lane.') &&
    avaChatRoute.includes('Review needed') &&
    avaChatRoute.includes('Safe lane') &&
    avaChatRoute.includes('Used {memories.length} memory signal'),
  'Ava Chat must visibly explain Ava mission state, checked context, approval posture, and memory use.'
);
assert(
  avaChatRoute.includes('PBK_COMPANION_ACTIONS') &&
    avaChatRoute.includes('pbk-ava-slash-panel') &&
    avaChatRoute.includes('pbk-ava-bubble-system') &&
    avaChatRoute.includes('Tell me what you need in plain English') &&
    avaChatRoute.includes('Draft Text') &&
    avaChatRoute.includes('Draft Email') &&
    avaChatRoute.includes('Prep Call') &&
    avaChatRoute.includes('Find Lead') &&
    avaChatRoute.includes('Prepare Contract') &&
    avaChatRoute.includes('Review Call') &&
    avaChatRoute.includes('Schedule Follow-up'),
  'Ava Chat must keep PBK task intelligence available through natural language and plain shortcuts.'
);
assert(
  !avaChatRoute.includes("label: 'OpenClaw'") &&
    !avaChatRoute.includes("label: 'ClickUI'") &&
    !avaChatRoute.includes("label: 'Local LLM'") &&
    !avaChatRoute.includes('Bridge queue') &&
    !avaChatRoute.includes('Invoke tool'),
  'Ava Chat must not expose internal action-category labels in the primary chat UI.'
);
assert(
  !avaChatRoute.includes('CompanionActionCards') &&
    !avaChatRoute.includes('AvaComposerModePicker') &&
    !avaChatRoute.includes('pbk-ava-chat-quick-strip') &&
    !avaChatRoute.includes('pbk-ava-composer-modes') &&
    !avaChatRoute.includes('pbk-ava-companion-actions'),
  'Ava Chat must not render the old menu-style companion action grid or mode picker.'
);
assert(
  avaChatRoute.includes('AVA_OPERATOR_MEMORY_KEY') &&
    avaChatRoute.includes('AVA_ASSISTANT_EXCHANGES_KEY') &&
    avaChatRoute.includes('window.localStorage.setItem') &&
    avaChatRoute.includes('window.localStorage.getItem') &&
    avaChatRoute.includes('Resume last ask'),
  'Ava Chat must persist lightweight chat and draft memory so it can stay in the conversation across pages.'
);
assert(
    avaChatRoute.includes('pbk-ava-system-drawer') &&
    avaChatRoute.includes('getAvaSystemStatus') &&
    avaChatRoute.includes('systemStatus.visible &&') &&
    avaChatRoute.includes('Open Ava support details:') &&
    avaChatRoute.includes('pbk-ava-chat-thread') &&
    avaChatRoute.includes('pbk-ava-chat-composer'),
  'Ava Chat must keep system/debug controls out of the default chat unless system status has a warning.'
);
assert(
  avaChatRoute.includes('pbk-ava-chat-send-button') &&
    /aria-label="Send to Ava"/.test(avaChatRoute),
  'Ava Chat send button must have a stable mobile-safe selector and accessible label.'
);
assert(
  /ContextPanel title="Support log"[\s\S]*<details/.test(avaChatRoute),
  'Ava Chat technical support details should live behind the collapsible Support log drawer.'
);
assert(
    pbkCss.includes('.pbk-ava-thinking-bubble') &&
    pbkCss.includes('.pbk-ava-thinking-dots') &&
    pbkCss.includes('.pbk-ava-inline-approval') &&
    pbkCss.includes('.pbk-ava-system-indicator') &&
    pbkCss.includes('.pbk-ava-system-drawer') &&
    pbkCss.includes('.pbk-ava-slash-panel') &&
    pbkCss.includes('.pbk-ava-bubble-system') &&
    pbkCss.includes('.pbk-ava-chat-send-button') &&
    !pbkCss.includes('.pbk-ava-companion-actions') &&
    !pbkCss.includes('.pbk-ava-composer-modes'),
  'Ava Chat must style thinking animation, inline approval, slash commands, and system drawer boundaries without the old menu CSS.'
);
assert(
  /@media \(max-width: 767px\)[\s\S]*--pbk-mobile-nav-clearance:\s*max\(86px, calc\(76px \+ env\(safe-area-inset-bottom\)\)\)[\s\S]*\.pbk-shell-content-chat\s*{[\s\S]*height:\s*calc\(100dvh - 56px - var\(--pbk-mobile-nav-clearance\)\)/.test(
    pbkCss
  ),
  'Mobile Ava Chat must shrink the full-height workspace above the fixed bottom nav so Send stays tappable.'
);
assert(
  /\.pbk-ava-chat-send-button\s*{[\s\S]*touch-action:\s*manipulation[\s\S]*pointer-events:\s*auto/.test(
    pbkCss
  ),
  'Ava Chat send button must remain explicitly touchable on mobile browsers.'
);
assert(
  /function recordAvaAssistantPlanOps/.test(bridge) &&
    /step:\s*'assistant_plan'/.test(bridge) &&
    /traceContract:\s*'intent_plan_guardrail_proof_outcome'/.test(bridge) &&
    /researchBasis:\s*\['openai_traces_evals', 'deepseek_function_calling_json', 'google_sre_golden_signals'\]/.test(
      bridge
    ),
  'Ava assistant turns must be recorded as traceable plan operations with intent, guardrail, proof, and outcome metadata.'
);
assert(
  /handleInternalAvaAssistantChatRequest[\s\S]*const assistantOpsStartedAt = Date\.now\(\)[\s\S]*recordAvaAssistantPlanOps\(\{[\s\S]*publicMode:\s*false/.test(
    bridge
  ) &&
    /handlePublicAvaChatRequest[\s\S]*const assistantOpsStartedAt = Date\.now\(\)[\s\S]*recordAvaAssistantPlanOps\(\{[\s\S]*publicMode:\s*true/.test(
      bridge
    ),
  'Both public and authenticated Ava chat handlers must emit assistant-plan operations.'
);
assert(
  /assistantSessions:\s*500/.test(bridge) &&
    /assistantExchanges:\s*2000/.test(bridge) &&
    /function mirrorAvaAssistantSessionToBridgeState/.test(bridge) &&
    /state\.assistantSessions\.find/.test(bridge) &&
    /state\.assistantExchanges/.test(bridge) &&
    /status\.assistantSessions/.test(bridge) &&
    /status\.assistantExchanges/.test(bridge),
  'Ava Chat should mirror sessions and exchanges into bridge state for durable companion memory breadcrumbs.'
);
assert(
  /import \{[\s\S]*buildAssistantPrompt[\s\S]*\} from '\.\/ava-assistant-chat\.mjs'/.test(bridge) &&
    /normalizeAssistantSession\(\{\s*history:\s*messages\s*\}\)/.test(bridge) &&
    /const requestedHistory =/.test(bridge) &&
    /assistantContextSession[\s\S]*history:\s*mergeAssistantHistories/.test(bridge),
  'Authenticated Ava chat must merge browser-supplied chat history into the server session before planning.'
);
assert(
  /async function runInternalAvaDeepSeekChat/.test(bridge) &&
    /buildAssistantPrompt\(assistantContextSession/.test(bridge) &&
    /runDeepSeekChatCompletion\(deepSeekMessages/.test(bridge) &&
    /Recent Ava lessons:/.test(bridge) &&
    /missionController,\s*\n\s*memories: assistantMemories/.test(bridge) &&
    /assistantPlan\.action === 'general'[\s\S]*runInternalAvaDeepSeekChat/.test(bridge),
  'Authenticated general Ava chat must use DeepSeek with recent session history, active memories, and mission context before falling back.'
);
assert(
  /const DEEPSEEK_STRICT_TOOL_MODE =[\s\S]*PBK_DEEPSEEK_STRICT_TOOL_MODE/.test(bridge) &&
    /const DEEPSEEK_STRICT_TOOL_BASE_URL =[\s\S]*PBK_DEEPSEEK_STRICT_TOOL_BASE_URL/.test(bridge) &&
    /function normalizeDeepSeekToolsForStrictMode/.test(bridge) &&
    /strict:\s*true/.test(bridge) &&
    /\.slice\(0,\s*DEEPSEEK_MAX_TOOL_DEFINITIONS\)/.test(bridge),
  'DeepSeek must expose a gated strict-tool contract with strict schemas capped to the provider limit.'
);
assert(
  /const deepSeekUrl = hasDeepSeekTools && DEEPSEEK_STRICT_TOOL_MODE === 'enabled'/.test(bridge) &&
    /fetch\(`\$\{deepSeekUrl\}\/chat\/completions`/.test(bridge) &&
    /tool_calls/.test(bridge) &&
    /function sanitizeDeepSeekToolCalls/.test(bridge) &&
    /argumentsRedacted:\s*Boolean\(text\)/.test(bridge) &&
    /reasoningRedacted:\s*Boolean\(reasoning\)/.test(bridge) &&
    /reasoningPolicy:\s*buildDeepSeekReasoningPolicy/.test(bridge),
  'DeepSeek chat completion must route strict tools through the beta base URL, preserve sanitized tool-call proof, and redact raw thinking output.'
);
assert(
  /params\.speculative !== false && !hasDeepSeekTools && isDeepSpecConfigured/.test(bridge),
  'DeepSpec speculative decoding must be skipped for strict-tool requests until the endpoint proves tool-call compatibility.'
);
assert(
  /function buildAvaDeepSeekDecisionTools/.test(bridge) &&
    /function parseAvaDeepSeekDecisionAnswer/.test(bridge) &&
    /function ensureDeepSeekJsonModeMessages/.test(bridge) &&
    /messages:\s*requestMessages/.test(bridge) &&
    /runInternalAvaDeepSeekChat[\s\S]*responseFormat:\s*'json'[\s\S]*tools:\s*buildAvaDeepSeekDecisionTools\(\)[\s\S]*deepSeekDecision/.test(bridge) &&
    /deepSeekDecision:\s*getAvaDeepSeekDecisionFromToolResult\(toolResult\)/.test(bridge) &&
    /return null;[\s\S]*async function runInternalAvaDeepSeekChat/.test(bridge) &&
    /reasoningPolicy:\s*deepSeek\.reasoningPolicy/.test(bridge),
  'Ava DeepSeek chat must use and return a structured decision envelope instead of free-form fallback text.'
);
assert(
  /function sanitizeAvaAssistantSessionSnapshot/.test(bridge) &&
    /function sanitizeAvaAssistantExchangeSnapshot/.test(bridge) &&
    /assistantSessions:\s*list\(\(state\.assistantSessions \|\| \[\]\)\.map\(sanitizeAvaAssistantSessionSnapshot\)/.test(bridge) &&
    /assistantExchanges:\s*list\(\(state\.assistantExchanges \|\| \[\]\)\.map\(sanitizeAvaAssistantExchangeSnapshot\)/.test(bridge) &&
    !/assistantSessions:\s*list\(state\.assistantSessions/.test(bridge) &&
    !/assistantExchanges:\s*list\(state\.assistantExchanges/.test(bridge),
  'The authenticated runtime snapshot must expose sanitized Ava session/exchange previews, not only counters.'
);
assert(
  /import \{ runAvaMissionController \} from '\.\/ava-mission-controller\.mjs'/.test(bridge) &&
    /let missionController = await runAvaMissionController\(\{[\s\S]*memories:\s*assistantMemories/.test(bridge) &&
    /handleInternalAvaAssistantChatRequest[\s\S]*runAvaMissionController\(\{[\s\S]*assistantIntent[\s\S]*assistantPlan[\s\S]*assistantSession[\s\S]*toolResult/.test(
      bridge
    ) &&
    /missionController = await runAvaMissionController\(\{[\s\S]*toolResult[\s\S]*memories:\s*assistantMemories/.test(bridge) &&
    /mission:\s*missionController\.mission/.test(bridge) &&
    /trace:\s*missionController\.trace/.test(bridge),
  'Authenticated Ava chat must run the mission controller before and after execution, then return compact mission/trace metadata.'
);

console.log('[ava-assistant-chat-smoke] ok');
