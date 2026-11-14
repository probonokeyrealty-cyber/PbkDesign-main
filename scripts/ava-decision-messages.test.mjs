import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { buildAssistantPrompt } from './ava-assistant-chat.mjs';
import { buildAvaDecisionMessages, isAvaCompactDecisionSafe } from './ava-decision-messages.mjs';

test('decision contract avoids generating invented work and repeated conversational metadata', () => {
  const contract = buildAvaDecisionMessages('approval-gated', 'Explain your role')[1].content;
  assert(contract.includes('compact JSON'));
  assert(contract.includes('nextAction=""'));
  assert(contract.includes('missionTimeline=[]'));
  assert(contract.includes('Do not omit required fields'));
});

test('compact no-tool decisions cannot hide action or approval proposals', () => {
  const answer = { reply: 'A specific answer.', decision: 'answer', confidence: 0.8, nextAction: '', missionTimeline: [], needsApproval: false, toolIntent: null };
  assert.equal(isAvaCompactDecisionSafe(JSON.stringify(answer)), true);
  for (const decision of ['act', 'delegate', 'approval_required']) {
    assert.equal(isAvaCompactDecisionSafe(JSON.stringify({ ...answer, decision })), false);
  }
  assert.equal(isAvaCompactDecisionSafe(JSON.stringify({ ...answer, needsApproval: true })), false);
  assert.equal(isAvaCompactDecisionSafe(JSON.stringify({ ...answer, needs_approval: true })), false);
  assert.equal(isAvaCompactDecisionSafe(JSON.stringify({ ...answer, toolIntent: { providerWrite: true } })), false);
  const write = { ...answer, decision: 'act', toolIntent: { name: 'telnyx_sms', providerWrite: true, summary: 'Proposed only', paramsJson: '{}' } };
  assert.equal(isAvaCompactDecisionSafe(JSON.stringify(write)), false);
  assert.equal(isAvaCompactDecisionSafe(JSON.stringify({ ...write, needsApproval: true })), true);
  assert.equal(isAvaCompactDecisionSafe(JSON.stringify({ ...answer, toolIntent: { name: '', providerWrite: false, provider_write: true, summary: '', paramsJson: '' } })), false);
  for (const invalid of ['safe plain text', '{"reply":"partial', JSON.stringify({ ...answer, confidence: 2 }), JSON.stringify({ ...answer, decision: 'unknown' }), JSON.stringify({ ...answer, toolIntent: [] })]) {
    assert.equal(isAvaCompactDecisionSafe(invalid), false);
  }
});

test('compact no-tool JSON preserves the canonical safe decision object', () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('function parseAvaDeepSeekDecisionAnswer(');
  const end = source.indexOf('\nfunction normalizeAvaAssistantAnswer', start);
  const context = vm.createContext({ extractJsonObjectFromText: JSON.parse, sanitizeAvaSpokenOutput: (text) => String(text), toNumber: Number });
  vm.runInContext(source.slice(start, end), context);
  const decision = { reply: 'A specific answer.', decision: 'answer', confidence: 0.8, nextAction: '', needsApproval: false, missionTimeline: [] };
  assert.equal(JSON.stringify(context.parseAvaDeepSeekDecisionAnswer(JSON.stringify({ ...decision, toolIntent: null }))),
    JSON.stringify(context.parseAvaDeepSeekDecisionAnswer(JSON.stringify({ ...decision, toolIntent: { name: '', providerWrite: false, summary: '', paramsJson: '' } }))));
});

test('actual chat keeps a complete JSON contract outside truncated memory context', async () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  let sentMessages;
  let sentParams;
  let completionAnswer = JSON.stringify({ reply: 'safe answer', decision: 'answer', confidence: 0.8, nextAction: '', missionTimeline: [], needsApproval: false, toolIntent: null });
  const context = vm.createContext({
    buildAssistantPrompt, buildAvaDecisionMessages, isAvaCompactDecisionSafe,
    buildAvaDeepSeekDecisionTools: () => [],
    runDeepSeekChatCompletion: async (messages, params) => {
      sentMessages = messages;
      sentParams = params;
      return { ok: true, answer: completionAnswer, provider: { usagePersistence: { ok: true } }, reasoningPolicy: {} };
    },
    DEEPSEEK_LIVE_MODEL: 'fixture-model', DEEPSEEK_THINKING_MODE: 'disabled',
    DEEPSEEK_LIVE_ATTEMPT_TIMEOUT_MS: 1400, DEEPSEEK_LIVE_RETRY_ATTEMPTS: 1, DEEPSEEK_LIVE_RETRY_DELAY_MS: 100,
    parseAvaDeepSeekDecisionAnswer: (answer) => { try { return JSON.parse(answer); } catch { return { reply: answer }; } },
    isPublicAvaBrainAnswerSafe: () => true,
    buildDeepSeekReasoningPolicy: () => ({}),
  });
  const contextStart = source.indexOf('function buildInternalAssistantDeepSeekContext(');
  const contextEnd = source.indexOf('\nfunction buildAvaDeepSeekDecisionTools', contextStart);
  vm.runInContext(source.slice(contextStart, contextEnd), context);
  const start = source.indexOf('async function runInternalAvaDeepSeekChat(');
  const end = source.indexOf('\nfunction enforceAvaControlEnvelope', start);
  vm.runInContext(source.slice(start, end), context);
  const accepted = await context.runInternalAvaDeepSeekChat({
    text: 'Explain your role', body: { source: 'ava-latency-diagnostic' },
    memories: Array.from({ length: 5 }, () => ({ summary: 'memory '.repeat(80) })),
    missionController: { mission: { status: 'completed' }, trace: { turnDecision: { reason: 'r'.repeat(220) }, workingMemory: { brief: 'b'.repeat(500) } } },
  });
  assert.equal(accepted.ok, true);
  assert(Number.isFinite(sentParams.deadlineAt), 'live completion must carry one absolute request deadline');
  assert(sentParams.deadlineAt <= Date.now() + 2300);
  assert.equal(sentParams.attemptTimeoutMs, 2300, 'primary can finish within the whole budget instead of restarting at 1400');
  assert.equal(sentParams.speculative, false, 'the native live path cannot spend its budget on another endpoint');
  const contract = sentMessages.find((message) => message.role === 'system' && message.content.includes('EXAMPLE JSON'));
  assert(contract, 'JSON format instructions must survive large memory context');
  for (const key of ['reply', 'decision', 'confidence', 'nextAction', 'needsApproval', 'missionTimeline', 'toolIntent']) assert(contract.content.includes(`"${key}"`));
  assert(sentMessages[0].content.includes('approval-gated'));
  assert.equal(sentMessages.at(-1).content, 'Explain your role');
  for (const badAnswer of ['{"reply":"unfinished', JSON.stringify({ reply: 'Proposed action', decision: 'act', confidence: 0.8, nextAction: '', needsApproval: false, missionTimeline: [], toolIntent: null })]) {
    completionAnswer = badAnswer;
    const rejected = await context.runInternalAvaDeepSeekChat({ text: 'Explain your role' });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.answer, '');
    assert.equal(rejected.toolResult.result, 'provider_invalid_decision');
    assert.equal(rejected.usagePersistence.ok, true, 'a rejected decision retains real provider accounting');
  }
  for (const decision of ['block', 'approval_required', 'act', 'delegate']) {
    completionAnswer = JSON.stringify({
      reply: 'A calm, safe sentence.', decision, confidence: 0.8, nextAction: '',
      needsApproval: decision !== 'block', missionTimeline: [],
      toolIntent: decision === 'block' ? null : { name: 'telnyx_sms', providerWrite: true, summary: 'Proposed only', paramsJson: '{}' },
    });
    const rejected = await context.runInternalAvaDeepSeekChat({ text: 'Explain your role' });
    assert.equal(rejected.ok, false, `${decision} cannot become a native read-only answer`);
    assert.equal(rejected.controllerRejected, true);
    assert.equal(rejected.toolResult.result, 'ava_control_model_decision');
    assert.equal(rejected.toolResult.deepSeekDecision.decision, decision);
    assert.equal(rejected.usagePersistence.ok, true);
  }
  const fallbackParams = [];
  context.Date = { now: () => 1000 };
  context.ensureDeepSeekJsonModeMessages = (messages) => messages;
  context.isAvaDeepSeekJsonModeFallbackCandidate = (result) => ['provider_empty_response', 'provider_reasoning_only'].includes(result.result);
  context.buildDeepSeekLiveRetryModels = () => ['fixture-model', 'fixture-secondary'];
  context.runDeepSeekChatCompletion = async (_, params) => {
    fallbackParams.push(params);
    if (fallbackParams.length < 3) return { ok: false, result: 'provider_empty_response', provider: {}, attempts: [] };
    return {
      ok: true, answer: JSON.stringify({ reply: 'A safe answer.', decision: 'answer', confidence: 0.8, nextAction: '', missionTimeline: [], needsApproval: false, toolIntent: null }),
      provider: { usagePersistence: { ok: true } }, attempts: [],
    };
  };
  const fallback = await context.runInternalAvaDeepSeekChat({
    text: 'Explain your role', requestTiming: { snapshot: () => ({ durationMs: 350 }) },
  });
  assert.equal(fallbackParams.length, 3);
  assert(fallbackParams.every((params) => params.deadlineAt === 2950), 'JSON and model fallbacks cannot reset elapsed request budget');
  assert(fallbackParams.every((params) => params.speculative === false));
  assert.equal(fallbackParams[0].model, 'fixture-model');
  assert.equal(fallbackParams[1].model, 'fixture-model');
  assert.equal(fallbackParams[2].model, 'fixture-secondary');
  assert.equal(fallback.toolResult.provider.jsonModeFallback, true);
  assert.equal(fallback.toolResult.provider.modelFallback, true, 'fallback completion remains visibly labeled, never native');
});
