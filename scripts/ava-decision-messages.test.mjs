import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { buildAssistantPrompt } from './ava-assistant-chat.mjs';
import { buildAvaDecisionMessages } from './ava-decision-messages.mjs';

test('actual chat keeps a complete JSON contract outside truncated memory context', async () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  let sentMessages;
  const context = vm.createContext({
    buildAssistantPrompt, buildAvaDecisionMessages,
    buildAvaDeepSeekDecisionTools: () => [],
    runDeepSeekChatCompletion: async (messages) => {
      sentMessages = messages;
      return { ok: true, answer: 'safe answer', provider: { usagePersistence: { ok: true } }, reasoningPolicy: {} };
    },
    DEEPSEEK_LIVE_MODEL: 'fixture-model', DEEPSEEK_THINKING_MODE: 'disabled',
    DEEPSEEK_LIVE_ATTEMPT_TIMEOUT_MS: 1400, DEEPSEEK_LIVE_RETRY_ATTEMPTS: 1, DEEPSEEK_LIVE_RETRY_DELAY_MS: 100,
    parseAvaDeepSeekDecisionAnswer: (answer) => ({ reply: answer }), isPublicAvaBrainAnswerSafe: () => true,
  });
  const contextStart = source.indexOf('function buildInternalAssistantDeepSeekContext(');
  const contextEnd = source.indexOf('\nfunction buildAvaDeepSeekDecisionTools', contextStart);
  vm.runInContext(source.slice(contextStart, contextEnd), context);
  const start = source.indexOf('async function runInternalAvaDeepSeekChat(');
  const end = source.indexOf('\nfunction enforceAvaControlEnvelope', start);
  vm.runInContext(source.slice(start, end), context);
  await context.runInternalAvaDeepSeekChat({
    text: 'Explain your role', body: { source: 'ava-latency-diagnostic' },
    memories: Array.from({ length: 5 }, () => ({ summary: 'memory '.repeat(80) })),
    missionController: { mission: { status: 'completed' }, trace: { turnDecision: { reason: 'r'.repeat(220) }, workingMemory: { brief: 'b'.repeat(500) } } },
  });
  const contract = sentMessages.find((message) => message.role === 'system' && message.content.includes('EXAMPLE JSON'));
  assert(contract, 'JSON format instructions must survive large memory context');
  for (const key of ['reply', 'decision', 'confidence', 'nextAction', 'needsApproval', 'missionTimeline', 'toolIntent']) assert(contract.content.includes(`"${key}"`));
  assert(sentMessages[0].content.includes('approval-gated'));
  assert.equal(sentMessages.at(-1).content, 'Explain your role');
});
