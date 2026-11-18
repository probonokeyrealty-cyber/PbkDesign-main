import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createScopedState, controlledExecution } from './controlled-execution-scope.mjs';

// Execute production functions without importing the bridge's startup, storage or providers.
const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(ast)]));
const now = Date.parse('2026-11-17T18:00:00.000Z');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function sampleState() {
  return {
    status: { mode: 'approval', toolUsage: {} }, settings: { operatingMode: 'approval' },
    calls: [
      { id: 'sample-stale', status: 'live', updatedAt: '2026-11-17T15:00:00.000Z', leadId: 'sample-lead', notes: 'Keep this note' },
      { id: 'sample-active', status: 'connected', updatedAt: '2026-11-17T17:59:00.000Z', leadId: 'sample-other' },
      { id: 'sample-legacy', status: 'ended', direction: 'inbound', source: 'telnyx', leadId: 'lead-diane-kowalski', leadName: 'Legacy sample', address: 'Old sample context' },
      { id: 'sample-ended', status: 'ended', notes: 'Completed sample call', endedAt: '2026-11-16T12:00:00.000Z' },
    ],
    approvals: [{ id: 'sample-approval', status: 'pending', message: 'Never send this fixture' }],
    leadImports: [{ id: 'sample-lead', notes: 'Manual lead notes', soldComps: [{ id: 'sample-comp', price: 300000 }] }],
    drafts: { analyzer: { notes: 'Existing sample draft' }, compose: { message: 'Unsent sample' } },
    brainDocs: [], appointments: [], leadStageTransitions: [], dncEntries: [], contracts: [],
    documentDeliveries: [], adminTasks: [], adminAudit: [], analyzerRuns: [], messages: [], activity: [], agents: [],
  };
}

function harness(state) {
  const context = vm.createContext({
    state, Date: class extends Date { static now() { return now; } },
    LIVE_CALL_STALE_AFTER_MS: 45 * 60_000, PROPERTY_CACHE_TTL_DAYS: 7,
    EMOTION_WORLD_MODEL_ENDPOINT: '', APPROVAL_WEBHOOK_URL: '', LEAD_WEBHOOK_URL: '', TOOL_NAMES: [],
    COMPACT_STATE_ARRAY_LIMIT: 24, COMPACT_STATE_RECORD_BYTES: 6000, COMPACT_STATE_NESTED_BYTES: 2500,
    Buffer, BANT_FIELDS: [], process: { env: {} }, contractTemplateCache: { templates: [], errors: [] },
    isoNow: () => new Date(now).toISOString(),
    getPendingRuntimeApprovals: items => items.filter(item => item.status === 'pending'),
    getPendingAdminTasks: items => items.filter(item => item.status === 'pending'),
    buildToolUsageSeed: () => ({}), getRuntimeMeta: () => ({}),
    buildAgentOrchestrationSnapshot: () => ({}), buildRevenueEngineStatus: () => ({}),
    buildDefaultAgentFleet: () => [], getMessageCounts: () => ({}),
    getCampaignLeadSourceOptions: () => [], getCleanAvaActiveMemories: () => [],
    buildDefaultAvaStories: () => [], getLeadScoringWeights: () => ({}),
    buildAvaNegotiationPersona: () => ({}), buildDefaultNegotiationTactics: () => [],
    buildDefaultEmotionalIntelligenceRules: () => [], buildDefaultCityKnowledge: () => [],
    ensureRuntimeSettings: value => value.settings,
    sanitizeAvaAssistantSessionSnapshot: value => value, sanitizeAvaAssistantExchangeSnapshot: value => value,
    formatMoneyCompact: String, getRuntimeOperatingMode: () => 'approval',
    buildManualControlStatus: () => ({}), normalizeAgentDebugId: String, agentDebugMatches: () => false,
    getRuntimeStateSource: () => 'isolated-sample', formatRelativeTime: String,
    isDemoActivity: () => false,
  });
  for (const name of [
    'getOpenClawGatewayHealthComponent', 'getTelnyxProviderMeta', 'getInstantlyProviderMeta',
    'getDeepgramProviderMeta', 'getBrowserVoiceProviderMeta', 'getElevenLabsProviderMeta',
    'getTavilyProviderMeta', 'getWebSearchProviderStatus', 'getOpenAiWebSearchProviderMeta',
    'getDeepSeekProviderMeta', 'getHermesProviderMeta', 'getGoogleCalendarProviderMeta',
    'getSupabaseStorageProviderMeta', 'getN8nWorkflowProviderMeta', 'getStreakProviderMeta',
    'getCrmSyncProviderMeta', 'getDocuSignProviderMeta', 'getBatchDataProviderMeta',
    'getSlackProviderMeta', 'getRenderProviderMeta', 'getNetlifyProviderMeta', 'getRedisProviderMeta',
  ]) context[name] = () => ({});
  for (const name of [
    'callTimeMs', 'hasLegacyDemoLeadContext', 'sanitizeLegacyInboundCallContext', 'normalizeStaleLiveCall',
    'normalizeStaleLiveCalls', 'isActiveLiveCall', 'getItemTimestamp', 'sortNewest', 'averageNumeric', 'updateDerivedStatus',
    'estimateSnapshotBytes', 'compactSnapshotText', 'compactSnapshotNestedValue', 'compactSnapshotRecord',
    'limitSnapshotArray', 'buildNotificationSnapshot', 'buildStateSnapshot', 'buildAgentStatusBundle',
    'toNumber', 'clampFounderWorkScore', 'getFounderLeadScore', 'getFounderLeadDisplayName',
    'getFounderLeadAddress', 'getFounderMessageRecipient', 'buildFounderWorkQueueSnapshot',
  ]) {
    expect(functions.has(name)).toBe(true);
    vm.runInContext('"use strict";\n' + functions.get(name), context);
  }
  return context;
}

function expectPreserved(state, before, calls) {
  expect(state.calls).toBe(calls);
  expect(copy(state.calls)).toEqual(before.calls);
  expect(copy(state.leadImports)).toEqual(before.leadImports);
  expect(copy(state.drafts)).toEqual(before.drafts);
  expect(copy(state.approvals)).toEqual(before.approvals);
}

function readCallRoute(context, path, query = '') {
  const routes = [];
  function visit(node) {
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(ast);
      if ((condition === "request.method === 'GET' && pathname === '/api/calls'" && path === '/api/calls') ||
          (condition === "request.method === 'GET' && matchesPath(pathname, ['/api/calls/summary', '/api/v1/calls/summary'])" && path !== '/api/calls')) {
        routes.push(node);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(routes).toHaveLength(1);
  let reply;
  Object.assign(context, {
    request: { method: 'GET' }, response: {}, pathname: path,
    url: new URL(`http://sample.invalid${path}${query}`),
    matchesPath: (pathname, paths) => paths.includes(pathname),
    buildRexAutonomyKpiSnapshot: () => ({ totalCalls: context.state.calls.length, acceptedOffers: 0, conversionRate: 0 }),
    json: (_response, status, body) => { reply = { status, body: copy(body) }; },
  });
  vm.runInContext(`(() => { "use strict"; ${routes[0].getText(ast)} })()`, context);
  return reply;
}

describe('bridge call history read isolation', () => {
  test('founder queue excludes stale connected calls without changing history', () => {
    const state = sampleState(), calls = state.calls;
    calls[0].status = 'connected';
    const before = copy(state), context = harness(state);
    const queue = context.buildFounderWorkQueueSnapshot();
    expect(copy(queue.items.filter(item => item.recordKind === 'call').map(item => item.recordId))).toEqual(['sample-active']);
    expect(queue.summary.activeCalls).toBe(context.buildStateSnapshot().status.activeCalls);
    expect(queue.summary.approvals).toBe(1);
    expectPreserved(state, before, calls);
  });

  test.each(['/api/calls', '/api/calls/summary', '/api/v1/calls/summary'])('%s agrees with state projections while preserving frozen history', path => {
    const state = sampleState(), calls = state.calls;
    calls[0].status = 'connected';
    const before = copy(state);
    calls.forEach(Object.freeze);
    Object.freeze(calls);
    Object.defineProperty(state, 'calls', { value: calls, writable: false, enumerable: true });
    const context = harness(state), snapshot = context.buildStateSnapshot();
    const reply = readCallRoute(context, path);
    const projected = path === '/api/calls' ? reply.body.calls : reply.body.calls.recent;
    expect(reply.status).toBe(200);
    expect(reply.body.count).toBe(4);
    for (const call of projected) expect(call).toEqual(copy(snapshot.calls.find(item => item.id === call.id)));
    expect(projected.find(call => call.id === 'sample-stale').status).toBe('ended');
    expect(projected.find(call => call.id === 'sample-legacy')).toMatchObject({
      leadId: 'lead-diane-kowalski', leadName: '', address: '', legacyContextSanitized: true,
    });
    expectPreserved(state, before, calls);
  });

  test('call pagination uses normalized timestamps and exact record IDs', () => {
    const state = sampleState(), calls = state.calls;
    calls[0].updated_at = calls[0].updatedAt;
    delete calls[0].updatedAt;
    const before = copy(state), context = harness(state);
    const reply = readCallRoute(context, '/api/calls', '?limit=1&offset=1');
    expect(reply.body).toMatchObject({ count: 4, limit: 1, offset: 1 });
    expect(reply.body.calls).toHaveLength(1);
    expect(reply.body.calls[0]).toMatchObject({ id: 'sample-stale', status: 'ended', leadId: 'sample-lead' });
    expectPreserved(state, before, calls);
  });

  test('derived status counts stale calls without replacing stored records', () => {
    const state = sampleState(), before = copy(state), calls = state.calls;
    const context = harness(state);
    context.updateDerivedStatus(state);
    expectPreserved(state, before, calls);
    expect(state.status.activeCalls).toBe(1);
    expect(state.status.pendingApprovals).toBe(1);
    expect(state.status.mode).toBe('approval');
  });

  test('agent status reads preserve history and still exclude stale active calls', () => {
    const state = sampleState(), before = copy(state), calls = state.calls;
    state.agents = [{ id: 'ava', name: 'Sample supervisor' }];
    const context = harness(state);
    const status = context.buildAgentStatusBundle();
    expectPreserved(state, before, calls);
    expect(status.agents[0].activeCalls).toBe(1);
    expect(state.status.activeCalls).toBe(1);
  });

  test('legacy timestamp aliases still contribute to derived call metrics without being rewritten', () => {
    const state = sampleState(), calls = state.calls;
    calls[0].updated_at = calls[0].updatedAt;
    delete calls[0].updatedAt;
    const before = copy(state), context = harness(state);
    context.updateDerivedStatus(state);
    expectPreserved(state, before, calls);
    expect(state.status.lastCallAt).toBe('2026-11-17T15:00:00.000Z');
  });

  test('agent daily counts retain legacy timestamps without changing call history', () => {
    const state = sampleState(), calls = state.calls;
    state.agents = [{ id: 'ava', name: 'Sample supervisor' }];
    calls[0].updated_at = calls[0].updatedAt;
    delete calls[0].updatedAt;
    const before = copy(state), context = harness(state);
    const status = context.buildAgentStatusBundle();
    expectPreserved(state, before, calls);
    expect(status.agents[0].callsToday).toBe(2);
    expect(status.agents[0].activeCalls).toBe(1);
  });

  test.each([undefined, null, []])('empty or missing history (%j) is not replaced during reads', calls => {
    const state = sampleState();
    state.calls = calls;
    const before = copy(state), context = harness(state);
    const snapshot = context.buildStateSnapshot();
    expectPreserved(state, before, calls);
    expect(copy(snapshot.calls)).toEqual([]);
    expect(snapshot.status.activeCalls).toBe(0);
  });

  test('compact projections truncate large call notes without changing the source', () => {
    const state = sampleState(), calls = state.calls;
    calls[0].notes = 'Sample note '.repeat(1000);
    const before = copy(state), context = harness(state);
    const snapshot = context.buildStateSnapshot({ compact: true });
    expect(snapshot.calls[0]._compact.reason).toBe('compact_state_record_limit');
    expect(snapshot.calls[0].notes.length).toBeLessThan(calls[0].notes.length);
    expect(snapshot.calls[0].status).toBe('ended');
    expectPreserved(state, before, calls);
  });

  test.each([false, true])('repeated compact=%s snapshots preserve calls and expose safe display projections', compact => {
    const state = sampleState(), before = copy(state), calls = state.calls;
    const context = harness(state);
    for (let index = 0; index < 3; index++) {
      const snapshot = context.buildStateSnapshot({ compact });
      expectPreserved(state, before, calls);
      expect(snapshot.status.activeCalls).toBe(1);
      expect(snapshot.calls.find(call => call.id === 'sample-stale')).toMatchObject({ status: 'ended', staleLiveCall: true, notes: 'Keep this note' });
      expect(snapshot.calls.find(call => call.id === 'sample-active').status).toBe('connected');
      expect(snapshot.calls.find(call => call.id === 'sample-legacy')).toMatchObject({ leadName: '', address: '', legacyContextSanitized: true });
      expect(snapshot.notifications.notifications.find(item => item.id === 'sample-stale').title).toMatch(/^ended -/);
    }
  });

  test('snapshot reads tolerate frozen call records and a non-writable call collection', () => {
    const state = sampleState(), before = copy(state), calls = state.calls;
    for (const call of calls) Object.freeze(call);
    Object.freeze(calls);
    Object.defineProperty(state, 'calls', { value: calls, writable: false, enumerable: true });
    const context = harness(state);
    expect(() => context.buildStateSnapshot({ compact: true })).not.toThrow();
    expectPreserved(state, before, calls);
  });

  test('scoped sample reads do not rewrite either scoped or organic call history', async () => {
    const organic = sampleState(), scoped = sampleState();
    scoped.calls[0].id = 'scoped-stale';
    const organicBefore = copy(organic), scopedBefore = copy(scoped);
    const organicCalls = organic.calls, scopedCalls = scoped.calls;
    const context = harness(createScopedState(organic));
    await controlledExecution.run({ state: scoped }, async () => {
      const snapshot = context.buildStateSnapshot();
      expect(snapshot.calls[0].id).toBe('scoped-stale');
      expectPreserved(scoped, scopedBefore, scopedCalls);
    });
    expectPreserved(organic, organicBefore, organicCalls);
  });
});
