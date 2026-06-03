import assert from 'node:assert/strict';

import {
  appendAssistantMessage,
  buildAssistantPrompt,
  createAssistantSessionId,
  detectAssistantIntent,
  planAssistantIntent,
} from './ava-assistant-chat.mjs';

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

const publicApprovalPlan = planAssistantIntent(detectAssistantIntent("What's my approval status?"), { publicMode: true });
assert.equal(publicApprovalPlan.action, 'blocked_public_private_data', 'Public assistant chat must not expose private approvals.');
assert.match(publicApprovalPlan.answer, /command center/i, 'Public private-data block should point users to the Command Center.');
assert.match(publicApprovalPlan.answer, /\/index\.shell\.html/i, 'Public private-data block should include a concrete Command Center link.');

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

console.log('[ava-assistant-chat-smoke] ok');
