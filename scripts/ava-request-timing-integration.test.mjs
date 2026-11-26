import { readAvaSavedLeadReviewId } from './ava-assistant-chat.mjs';
import { readAvaChatCurrentRequest } from './ava-team-chat-permissions.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { createAvaRequestTiming } from './ava-request-timing.mjs';
import { sanitizeAvaStreamReply } from './ava-deepseek-stream.mjs';
import { appendAssistantMessage, normalizeAssistantSession } from './ava-assistant-chat.mjs';
import { withRuntimeEvidenceContext, getRuntimeEvidenceContext } from './runtime-evidence-context.mjs';
import { markAgentTimingFirstContent } from './agent-timing-adapters.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('async function handleInternalAvaAssistantChatRequest(request) {');
const end = source.indexOf('\n}\n', start) + 2;
assert(start >= 0 && end > start);

function fixture({ abortRead = false, blockFinal = false, general = false, messages = [], priorHistory = [], priorSession = {}, historyMode, streaming = false, cancelAfterPreview = false, rewritePreview = false, rewriteFinal = false } = {}) {
  let clock = 0;
  let recorded;
  let writes = 0;
  let gateCalls = 0;
  let contextHistory;
  let contextSession;
  let persistedSession;
  const previews = [];
  const streamController = new AbortController();
  const controller = new AbortController();
  controller.abort();
  const context = vm.createContext({
    Date,
    withRuntimeEvidenceContext, getRuntimeEvidenceContext, markAgentTimingFirstContent,
    createBridgeAgentTimingTurn: () => null,
    chatTimingDeliveries: new WeakMap(),
    sanitizeAvaStreamReply,
    process: { env: { RENDER_GIT_COMMIT: 'fixture-commit' } },
    OUTLOOK_LEAD_EMAIL_ENABLED: false,
    createAvaRequestTiming: () => createAvaRequestTiming({ now: () => clock }),
    readBody: async () => ({ message: 'find absent fixture', sessionId: 'isolated', messages, historyMode }),
    normalizeConversationMessages: () => [],
    sanitizePublicAvaChatTurn: (content) => ({ content }),
    readAvaChatCurrentRequest,
    readAvaSavedLeadReviewId,
    getPublicAvaAssistantSessionId: () => 'isolated',
    readPublicAvaAssistantSession: async () => {
      clock += 1500;
      if (abortRead) controller.signal.throwIfAborted();
      return { ...priorSession, history: priorHistory };
    },
    dropCurrentAssistantUserTurn: () => [],
    normalizeAssistantSession,
    detectAssistantIntent: () => ({ intent: 'lead_lookup' }),
    isAvaReadOnlyAuditRequest: () => false,
    looksLikeCurrentLeadContextRequest: () => false,
    mergeAssistantHistories: () => [],
    getCleanAvaActiveMemories: () => [],
    runAvaMissionController: async ({ controllerStage }) => {
      clock += 10;
      const rewritten = (rewritePreview && controllerStage === 'stream_preview') || (rewriteFinal && controllerStage === 'final');
      return { mission: {}, trace: { guard: { result: rewritten ? 'rewritten' : 'passed' }, turnDecision: { answer: 'Controller-safe replacement.' } }, controlEnvelope: {} };
    },
    planAssistantIntent: () => {
      clock += 20;
      if (general) return { action: 'general' };
      return { action: 'tool_plan', toolPlan: { toolName: 'findLead', params: { query: 'absent fixture' } } };
    },
    appendAssistantMessage,
    enforceAvaControlEnvelope: () => {
      gateCalls += 1;
      return blockFinal && gateCalls === 2
        ? { ok: false, answer: 'Blocked by controller', toolResult: { ok: false, result: 'ava_control_blocked' } }
        : { ok: true };
    },
    findInternalAssistantLead: () => { clock += 3; return null; },
    getInternalAssistantLeadId: () => '',
    normalizeAvaAssistantAnswer: (answer) => answer,
    recordAvaMissionLedger: () => ({}),
    getAvaDeepSeekDecisionFromToolResult: () => null,
    isPublicAvaBrainAnswerSafe: () => true,
    runInternalAvaDeepSeekChat: async ({ assistantContextSession, stream }) => {
      contextSession = assistantContextSession;
      contextHistory = assistantContextSession.history;
      if (stream && await stream.check('Safe prefix')) await stream.onAnswer('Safe prefix');
      if (cancelAfterPreview) streamController.abort();
      return { ok: true, answer: 'Safe answer', usagePersistence: { ok: false, result: 'failed', warning: 'token_usage_persistence_failed' }, toolResult: { ok: true } };
    },
    writePublicAvaAssistantSession: async (_, session) => { persistedSession = session; writes += 1; clock += 900; },
    addActivity: () => {},
    makeActivity: (activity) => activity,
    recordAvaAssistantPlanOps: (record) => { recorded = record; },
    persistStateInBackground: () => {},
    state: { leadImports: [] },
  });
  const normalizerStart = source.indexOf('function normalizeConversationMessages(');
  vm.runInContext(source.slice(normalizerStart, source.indexOf('\nfunction getLastUserMessage', normalizerStart)), context);
  const historyStart = source.indexOf('function mergeAssistantHistories(');
  vm.runInContext(source.slice(historyStart, source.indexOf('\nfunction buildInternalAssistantDeepSeekContext', historyStart)), context);
  vm.runInContext(source.slice(start, end), context);
  return {
    run: () => context.handleInternalAvaAssistantChatRequest(streaming ? {
      avaStream: { signal: streamController.signal, onAnswer: async text => { previews.push(text); } },
    } : {}),
    previews,
    get recorded() { return recorded; },
    get writes() { return writes; },
    get contextHistory() { return contextHistory; },
    get contextSession() { return contextSession; },
    get persistedSession() { return persistedSession; },
  };
}

test('actual chat handler checks streamed prefixes and persists only the complete reply', async () => {
  const runtime = fixture({ general: true, streaming: true });
  const result = await runtime.run();
  assert.deepEqual(runtime.previews, ['Safe prefix']);
  assert.equal(result.body.answer, 'Safe answer');
  assert.equal(runtime.writes, 1);
});

test('actual chat never persists an assistant answer after Stop', async () => {
  const runtime = fixture({ general: true, streaming: true, cancelAfterPreview: true });
  await assert.rejects(runtime.run(), { name: 'AbortError' });
  assert.deepEqual(runtime.previews, ['Safe prefix']);
  assert.equal(runtime.writes, 0);
  assert.equal(runtime.recorded, undefined);
});

test('a rewritten guard result cannot leak an unrewritten streamed prefix', async () => {
  const runtime = fixture({ general: true, streaming: true, rewritePreview: true });
  await runtime.run();
  assert.deepEqual(runtime.previews, []);
});

test('the final event and persisted record honor a controller rewrite after previews', async () => {
  const runtime = fixture({ general: true, streaming: true, rewriteFinal: true });
  const result = await runtime.run();
  assert.equal(result.body.answer, 'Controller-safe replacement.');
  assert.equal(runtime.recorded.answer, 'Controller-safe replacement.');
});

test('actual chat request normalization and merge retain long replies without duplicate echoes', async () => {
  const history = Array.from({ length: 8 }, (_, i) => [
    { role: 'user', content: `Question ${i}` },
    { role: 'assistant', content: `${'Detailed explanation. '.repeat(250)}Ending ${i}` },
  ]).flat();
  const runtime = fixture({ general: true, messages: history, priorHistory: history });
  await runtime.run();
  assert.equal(runtime.contextHistory.length, 16, 'Full replies must deduplicate against persisted history');
  assert.deepEqual(Array.from(runtime.contextHistory, ({ role, content }) => ({ role, content })), history);
});

test('completed-only browser history excludes a saved tail that finished after Stop', async () => {
  const completed = [
    { role: 'user', content: 'Describe CEDAR.' },
    { role: 'assistant', content: 'CEDAR - green walls.' },
  ];
  const runtime = fixture({
    general: true,
    historyMode: 'completed-only',
    messages: [...completed, { role: 'user', content: 'find absent fixture' }],
    priorHistory: [...completed,
      { role: 'user', content: 'Describe ORCHID at length.' },
      { role: 'assistant', content: 'ORCHID - purple walls.' },
    ],
    priorSession: { leadId: 'fixture-lead', pendingAction: { approvalRequired: true } },
  });
  await runtime.run();
  assert.deepEqual(Array.from(runtime.contextHistory, ({ role, content }) => ({ role, content })), completed);
  assert.equal(runtime.contextSession.leadId, 'fixture-lead');
  assert.equal(runtime.contextSession.pendingAction.approvalRequired, true);
});

test('completed-only snapshot preserves repeated answers in the supplied chronological order', async () => {
  const completed = [
    { role: 'user', content: 'Describe CEDAR.' },
    { role: 'assistant', content: 'Green walls.', at: '2026-11-15T10:00:00.000Z' },
    { role: 'user', content: 'Describe ORCHID.' },
    { role: 'assistant', content: 'Purple walls.' },
    { role: 'user', content: 'Describe CEDAR again.' },
    { role: 'assistant', content: 'Green walls.', at: '2026-11-15T10:02:00.000Z', metadata: { source: 'repeated-completion' } },
  ];
  const runtime = fixture({ general: true, historyMode: 'completed-only', messages: completed, priorHistory: completed });
  await runtime.run();
  assert.deepEqual(Array.from(runtime.contextHistory, ({ role, content }) => ({ role, content })),
    completed.map(({ role, content }) => ({ role, content })));
  assert.deepEqual(Array.from(runtime.persistedSession.history.slice(0, -2), ({ role, content }) => ({ role, content })),
    completed.map(({ role, content }) => ({ role, content })));
  assert.equal(runtime.persistedSession.history[1].at, '2026-11-15T10:00:00.000Z');
  assert.equal(runtime.persistedSession.history[5].at, '2026-11-15T10:02:00.000Z');
  assert.equal(runtime.persistedSession.history[5].metadata.source, 'repeated-completion');
});

test('completed-only snapshot with no finished turns does not resurrect a cancelled first reply', async () => {
  const runtime = fixture({
    general: true, historyMode: 'completed-only',
    messages: [{ role: 'user', content: 'find absent fixture' }],
    priorHistory: [{ role: 'user', content: 'Cancelled question' }, { role: 'assistant', content: 'Cancelled answer' }],
  });
  await runtime.run();
  assert.equal(runtime.contextHistory.length, 0);
});

test('a stale tab controls its context without erasing another tab\'s completed saved reply', async () => {
  const tabB = [
    { role: 'user', content: 'Describe CEDAR.' },
    { role: 'assistant', content: 'CEDAR - green walls.' },
  ];
  const tabA = [...tabB,
    { role: 'user', content: 'Describe ORCHID.' },
    { role: 'assistant', content: 'ORCHID - purple walls.', metadata: { source: 'other-tab' } },
  ];
  const runtime = fixture({ general: true, historyMode: 'completed-only', messages: tabB, priorHistory: tabA });
  await runtime.run();
  assert.deepEqual(Array.from(runtime.contextHistory, ({ role, content }) => ({ role, content })), tabB);
  assert.deepEqual(Array.from(runtime.persistedSession.history, turn => turn.content), [
    'Describe CEDAR.', 'CEDAR - green walls.', 'Describe ORCHID.', 'ORCHID - purple walls.',
    'find absent fixture', 'Safe answer',
  ]);
  assert.equal(runtime.persistedSession.history[3].metadata.source, 'other-tab');
});

test('completed browser history bootstraps an expired durable session', async () => {
  const completed = [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }];
  const runtime = fixture({ general: true, historyMode: 'completed-only', messages: completed });
  await runtime.run();
  assert.deepEqual(Array.from(runtime.persistedSession.history, turn => turn.content), [
    'Earlier question', 'Earlier answer', 'find absent fixture', 'Safe answer',
  ]);
});

test('actual handler retains unsuccessful lookup and attributes session I/O separately', async () => {
  const runtime = fixture();
  const result = await runtime.run();
  assert.equal(result.body.toolResult.ok, false);
  assert.equal(result.body.toolResult.result, 'lead_not_found');
  assert.equal(runtime.recorded.toolResult.ok, false);
  assert.equal(runtime.writes, 1);
  const timing = result.body.requestTiming;
  assert.equal(timing.metricKind, 'operator_request');
  assert.equal(timing.durationMs, 2453);
  const stages = Object.fromEntries(timing.stages.map((item) => [item.stage, item.durationMs]));
  assert.equal(stages.session_read, 1500);
  assert.equal(stages.lead_lookup, 3);
  assert.equal(stages.session_write, 900);
  assert.equal(stages.intent_plan, 20);
  assert.equal(stages.controller_intake, 10);
  assert.equal(stages.controller_planned, 10);
  assert.equal(stages.controller_final, 10);
  assert.deepEqual(runtime.recorded.requestTiming, timing);
});

test('final governance block is retained with a separately timed recheck', async () => {
  const runtime = fixture({ blockFinal: true });
  const result = await runtime.run();
  assert.equal(result.body.toolResult.ok, false);
  assert.equal(result.body.toolResult.result, 'ava_control_blocked');
  assert.equal(runtime.recorded.toolResult.result, 'ava_control_blocked');
  assert.equal(result.body.requestTiming.durationMs, 2463);
  const rechecks = result.body.requestTiming.stages.filter((stage) => stage.stage === 'controller_final_recheck');
  assert.equal(rechecks.length, 1);
  assert.equal(rechecks[0].durationMs, 10);
});

test('actual handler does not continue to session write after cancelled read', async () => {
  const runtime = fixture({ abortRead: true });
  await assert.rejects(runtime.run(), { name: 'AbortError' });
  assert.equal(runtime.writes, 0);
  assert.equal(runtime.recorded, undefined);
});

test('accounting failure remains visible even when final governance replaces the model result', async () => {
  const runtime = fixture({ general: true, blockFinal: true });
  const result = await runtime.run();
  assert.equal(result.body.toolResult.result, 'ava_control_blocked');
  assert.equal(result.body.usagePersistence.ok, false);
  assert.equal(result.body.instrumentationWarnings[0], 'token_usage_persistence_failed');
});
