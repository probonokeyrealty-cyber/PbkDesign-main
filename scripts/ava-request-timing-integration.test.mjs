import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { createAvaRequestTiming } from './ava-request-timing.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('async function handleInternalAvaAssistantChatRequest(request) {');
const end = source.indexOf('\n}\n', start) + 2;
assert(start >= 0 && end > start);

function fixture({ abortRead = false, blockFinal = false } = {}) {
  let clock = 0;
  let recorded;
  let writes = 0;
  let gateCalls = 0;
  const controller = new AbortController();
  controller.abort();
  const context = vm.createContext({
    Date,
    createAvaRequestTiming: () => createAvaRequestTiming({ now: () => clock }),
    readBody: async () => ({ message: 'find absent fixture', sessionId: 'isolated' }),
    normalizeConversationMessages: () => [],
    sanitizePublicAvaChatTurn: (content) => ({ content }),
    getLastUserMessage: (_, fallback) => fallback,
    getPublicAvaAssistantSessionId: () => 'isolated',
    readPublicAvaAssistantSession: async () => {
      clock += 1500;
      if (abortRead) controller.signal.throwIfAborted();
      return { history: [] };
    },
    dropCurrentAssistantUserTurn: () => [],
    normalizeAssistantSession: (session = {}) => ({ history: [], ...session }),
    detectAssistantIntent: () => ({ intent: 'lead_lookup' }),
    isAvaReadOnlyAuditRequest: () => false,
    mergeAssistantHistories: () => [],
    getCleanAvaActiveMemories: () => [],
    runAvaMissionController: async () => {
      clock += 10;
      return { mission: {}, trace: {}, controlEnvelope: {} };
    },
    planAssistantIntent: () => {
      clock += 20;
      return { action: 'tool_plan', toolPlan: { toolName: 'findLead', params: { query: 'absent fixture' } } };
    },
    appendAssistantMessage: (session) => session,
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
    writePublicAvaAssistantSession: async () => { writes += 1; clock += 900; },
    addActivity: () => {},
    makeActivity: (activity) => activity,
    recordAvaAssistantPlanOps: (record) => { recorded = record; },
    persistStateInBackground: () => {},
    state: { leadImports: [] },
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    run: () => context.handleInternalAvaAssistantChatRequest({}),
    get recorded() { return recorded; },
    get writes() { return writes; },
  };
}

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
