import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterAll, beforeAll, beforeEach, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { recordRuntimeSourceEvidence, captureRuntimeSourceWriteBinding, runtimeSourceWriteReturning,
  collectRuntimeSourceSnapshot } from './runtime-source-evidence.mjs';
import { withRuntimeEvidenceContext, getRuntimeEvidenceContext } from './runtime-evidence-context.mjs';
import { createConversationStore } from './conversation-store.mjs';
import { CONVERSATION_SCHEMA_SQL } from './conversation-schema.mjs';
import { createAvaRequestTiming } from './ava-request-timing.mjs';
import { appendAssistantMessage, normalizeAssistantSession } from './ava-assistant-chat.mjs';
import { sanitizeAvaStreamReply } from './ava-deepseek-stream.mjs';
import { AGENT_LATENCY_PILOT_V2, getAgentLatencyPolicy } from './agent-latency-policy.mjs';
import { createAgentTimingTurn, markAgentTimingFirstContent, bindAgentTimingToParams, getTrustedAgentTimingProof } from './agent-timing-adapters.mjs';
import { controlledExecution } from './controlled-execution-scope.mjs';
import { EventEmitter } from 'node:events';
import { invokeRegisteredAgent, normalizeAgentRegistryId } from './agent-registry.mjs';
import { buildAgentExecutionEvidence, isAgentHandlerCompletion } from './agent-fleet-measurement.mjs';
import { registeredAgentTimingChannel, agentTimingResultSucceeded } from './agent-timing-adapters.mjs';
import { createLiveConversationProjector } from './conversation-live-projector.mjs';
import { createRuntimeEventArchive, createProviderCircuitBreaker } from './production-maturity-loop.mjs';
import { createRuntimeCoverageSampler } from './runtime-coverage-sampler.mjs';
import { readRuntimeCoverage } from './runtime-coverage-store.mjs';
import { createOperationalAuditPool } from './operational-audit-store.mjs';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const secret = 'explicit-local-task4-overwrite-fixture-material';
const revision = 'a'.repeat(40);
const sourceId = 'task4-local-archive-write';
let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE activity_log (
      id text PRIMARY KEY, workspace_id text, lead_id text, lead_name text,
      address text, actor text, category text, status text, text text, target text,
      source text, metadata jsonb, created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE pbk_eval_runs (
      id text PRIMARY KEY, tenant_id text, suite_name text, ok boolean,
      total int, passed int, failed int, report jsonb, source text, created_at timestamptz
    );
    CREATE TABLE pbk_qa_audit(id text PRIMARY KEY,tenant_id text,tool_name text,passed boolean,skipped boolean,
      reason text,validator text,retry_count int,params jsonb,result jsonb,qa jsonb,source text,created_at timestamptz);
    CREATE TABLE pbk_safety_audit(id text PRIMARY KEY,tenant_id text,tool_name text,blocked boolean,
      approval_required boolean,params jsonb,validation jsonb,source text,created_at timestamptz);
    CREATE TABLE lead_profiles(id text PRIMARY KEY);
  `);
  await db.exec(CONVERSATION_SCHEMA_SQL.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
}, 30000);

afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('TRUNCATE activity_log,pbk_eval_runs,pbk_qa_audit,pbk_safety_audit,conversation_events,conversation_threads CASCADE');
});

const bridgeSource = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = bridgeSource.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end = bridgeSource.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start, name);
  return bridgeSource.slice(start, end);
}

function chatFixture({ answer = 'Actual answer', cancel = false, source = 'forged-diagnostic', failTool = false,
  delivery, policyReady = true, streaming = true, toolOutcome } = {}) {
  let clock = 0;
  const ops = [], previews = [];
  const controller = new AbortController();
  const context = vm.createContext({ Date, console, process: { env: {} },
    OUTLOOK_LEAD_EMAIL_ENABLED: false,
    withRuntimeEvidenceContext, getRuntimeEvidenceContext,
    createBridgeAgentTimingTurn: () => createAgentTimingTurn({ secret, revision,
      policy: policyReady ? getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(AGENT_LATENCY_PILOT_V2) }) : null,
      channel: 'chat', agentId: 'ava', runId: 'agent-ops-measure-local', now: () => NOW + clock, monotonicNow: () => clock }),
    markAgentTimingFirstContent, bindAgentTimingToParams, getTrustedAgentTimingProof, agentTimingResultSucceeded,
    chatTimingDeliveries: { get: () => delivery },
    createAvaRequestTiming: () => createAvaRequestTiming({ now: () => clock }),
    readBody: async () => ({ message: 'local question', source,
      metadata: { timingProof: { signature: 'forged' }, channel: 'phone', outputCodePoints: 1 } }),
    normalizeConversationMessages: () => [], sanitizePublicAvaChatTurn: content => ({ content }),
    getLastUserMessage: (_, fallback) => fallback,
    getPublicAvaAssistantSessionId: () => 'local-session', readPublicAvaAssistantSession: async () => ({ history: [] }),
    dropCurrentAssistantUserTurn: () => [], normalizeAssistantSession, mergeAssistantHistories: () => [],
    detectAssistantIntent: () => ({ intent: 'general' }), isAvaReadOnlyAuditRequest: () => false,
    looksLikeCurrentLeadContextRequest: () => false, getCleanAvaActiveMemories: () => [],
    runAvaMissionController: async () => ({ mission: {}, trace: {}, controlEnvelope: {} }),
    planAssistantIntent: () => ({ action: 'general' }), enforceAvaControlEnvelope: () => ({ ok: true }),
    appendAssistantMessage, sanitizeAvaStreamReply, normalizeAvaAssistantAnswer: value => value,
    recordAvaMissionLedger: () => ({}), getAvaDeepSeekDecisionFromToolResult: () => null,
    isPublicAvaBrainAnswerSafe: () => true,
    runInternalAvaDeepSeekChat: async ({ stream }) => {
      clock = 80;
      if (stream) await stream.onAnswer('Actual prefix');
      if (cancel) controller.abort();
      clock = 160;
      return { ok: true, answer, toolResult: toolOutcome || { ok: !failTool } };
    },
    writePublicAvaAssistantSession: async () => { clock += 10; },
    addActivity() {}, makeActivity: value => value, persistStateInBackground() {}, state: { leadImports: [] },
    recordAgentOps: params => { ops.push({ params, proof: getTrustedAgentTimingProof(params) }); },
    summarizeProviderActionResult: value => value,
  });
  for (const name of ['recordAvaAssistantPlanOps', 'handleInternalAvaAssistantChatRequest']) vm.runInContext(extract(name), context);
  return { ops, previews, run: () => context.handleInternalAvaAssistantChatRequest(streaming ? {
    avaStream: { signal: controller.signal, onAnswer: async text => { previews.push(text); } },
  } : {}) };
}

test.each([['short', 'Small answer'], ['long', 'Detailed answer. '.repeat(500) + '\u{1f642}']])
('actual operator handler signs its %s final result and preserves first content callback', async (_label, answer) => {
  const fixture = chatFixture({ answer });
  const result = await fixture.run();
  assert.equal(result.body.answer, answer);
  assert.equal(fixture.ops.length, 1);
  assert.ok(fixture.ops[0].proof, 'actual handler must privately bind its meter into the AgentOps boundary');
  assert.equal(fixture.ops[0].proof.outputCodePoints, [...answer].length);
  assert.equal(fixture.ops[0].proof.channel, 'chat');
  assert.equal(fixture.ops[0].proof.timings.firstTokenMs, 80);
  assert.equal(fixture.previews.length, 1);
});

test('cancelled actual chat never records completed timing', async () => {
  const fixture = chatFixture({ cancel: true });
  await assert.rejects(fixture.run(), { name: 'AbortError' });
  assert.equal(fixture.ops.length, 0);
});

test.each(['failed', 'partial', 'cancelled', 'policy', 'controlled', 'diagnostic', 'nonstream'])
('actual chat preserves replies but does not invent qualifying %s milestones', async mode => {
  const fixture = chatFixture({ policyReady: mode !== 'policy', streaming: mode !== 'nonstream',
    toolOutcome: { ok: mode !== 'failed', status: ['partial', 'cancelled'].includes(mode) ? mode : 'complete' } });
  const run = () => fixture.run();
  const result = await (mode === 'controlled' ? controlledExecution.run({}, run)
    : mode === 'diagnostic' ? withRuntimeEvidenceContext('diagnostic', run) : run());
  assert.equal(result.body.answer, 'Actual answer');
  assert.equal(fixture.ops.length, 1);
  if (mode === 'nonstream') assert.equal(fixture.ops[0].proof.timings.firstTokenMs, undefined);
  else assert.equal(fixture.ops[0].proof, null);
});

test.each([true, false])('actual chat waits for private delivery outcome before timing attestation: %s', async delivered => {
  let release;
  const delivery = new Promise(resolve => { release = resolve; });
  const fixture = chatFixture({ delivery });
  await fixture.run();
  assert.equal(fixture.ops.length, 0, 'a not-yet-delivered final reply cannot qualify');
  release(delivered);
  await delivery;
  await Promise.resolve();
  assert.equal(fixture.ops.length, 1);
  assert.equal(Boolean(fixture.ops[0].proof), delivered);
});

test.each(['done', 'partial', 'error', 'aborted'])('actual delivery observer retains transport semantics and rejects %s incompletion', async mode => {
  const request = new EventEmitter();
  const response = new EventEmitter();
  const writes = [];
  const original = function (...args) { writes.push(args); return false; };
  response.write = original;
  response.statusCode = 200;
  const deliveries = new WeakMap();
  const context = vm.createContext({ chatTimingDeliveries: deliveries });
  vm.runInContext(extract('observeAvaChatDelivery'), context);
  context.observeAvaChatDelivery(request, response, true);
  const chunk = mode === 'done' ? 'event: done\ndata: {"answer":"fixture"}\n\n'
    : mode === 'error' ? 'event: error\ndata: {}\n\n' : 'event: answer\ndata: {}\n\n';
  assert.equal(response.write(chunk, 'utf8'), false);
  assert.deepEqual(writes, [[chunk, 'utf8']]);
  if (mode === 'aborted') request.emit('aborted');
  else response.emit('finish');
  assert.equal(await deliveries.get(request), mode === 'done');
  assert.equal(response.write, original);
});

test('actual AgentOps mirror accepts only the private measurement binding, not forged metadata', async () => {
  const records = [];
  const context = vm.createContext({ Date, getTrustedAgentTimingProof, getRuntimeEvidenceContext: () => ({ classification: 'operational' }),
    ensureAgentFleetCollections() {}, isoNow: () => new Date(NOW + 20).toISOString(),
    normalizeAgentName: name => name, normalizeAgentRosterId: name => name.toLowerCase(), slugify: name => name,
    normalizeTenantId: value => value, hashString: () => 12, isNonOperationalAgentEvidence: () => false,
    upsertById: (_state, _key, record) => records.push(record), state: { agentTasks: [], status: {} },
    sortNewest: rows => rows, LIMITS: { agentTasks: 100 }, persistStateInBackground() {},
  });
  vm.runInContext(extract('mirrorAgentOpsMeasurementToState'), context);
  await withRuntimeEvidenceContext('operator_chat', () => {
    const handle = createAgentTimingTurn({ secret, revision,
      policy: getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(AGENT_LATENCY_PILOT_V2) }),
      channel: 'chat', agentId: 'ava', runId: 'agent-ops-measure-private', now: () => NOW, monotonicNow: () => 0 });
    const params = bindAgentTimingToParams({ agentName: 'Ava', success: true,
      metadata: { channel: 'phone', requestTiming: { metricKind: 'operator_request', firstTokenMs: 1 } } },
    handle, { answer: 'actual final answer', successful: true });
    context.mirrorAgentOpsMeasurementToState(params);
    assert.equal(records[0].metadata.timingProof?.runId, 'agent-ops-measure-private');
    assert.equal(records[0].id, 'agent-ops-measure-private');
    context.mirrorAgentOpsMeasurementToState({ ...params, metadata: { ...params.metadata, timingProof: records[0].metadata.timingProof } });
    assert.equal(records[1].metadata.timingProof, undefined);
    assert.equal(records[1].metadata.channel, 'unknown');
    assert.equal(Object.keys(records[1].metadata.timings).length, 0);
  });
});

test.each([
  ['disconnected', false, false],
  ['reconnecting', true, false],
  ['missing-readiness', true, undefined],
  ['closed-ready-latch', false, true],
])('actual event-bus health leaves durable coverage pending after %s despite stale connected latch', async (state, isOpen, isReady) => {
  let wall = NOW, monotonic = 100;
  const bus = { mode: 'redis', connected: true, redisClient: { isOpen: true, isReady: true } };
  const context = vm.createContext({ BRIDGE_API_KEY: secret, runtimeStateBootstrap: { ready: true },
    state: { status: { mode: 'approval' } }, getDefaultEventBus: () => bus,
    getPbkObservabilityStatus: () => ({ enabled: true, initialized: true, otelReady: true }),
    getRuntimeEventArchiveStatus: () => ({ ready: true }), getProviderCircuitStatus: () => ({ ready: true }),
  });
  vm.runInContext(extract('getRuntimeCoverageHealth'), context);
  const pool = { connect: async () => ({ release() {}, query: config => {
    if (config.text.includes('clock_timestamp() AS coverage_now')) return { rows: [{ coverage_now: new Date(wall) }] };
    return db.query(config.text, config.values);
  } }) };
  const fixtureSecret = `explicit-local-eventbus-coverage-${state}`;
  const sampler = createRuntimeCoverageSampler({ pool, secret: fixtureSecret, revision, enabled: true, hosted: true,
    health: context.getRuntimeCoverageHealth, now: () => wall, monotonicNow: () => monotonic, bootId: 'eventbus-health-fixture' });
  const advance = () => { wall += 60000; monotonic += 60000; };
  try {
    assert.equal((await sampler.sample()).verified, true);
    advance();
    const healthy = await sampler.sample();
    assert.equal(healthy.verified, true);
    assert.equal(healthy.report.health.eventBusConnected, true);
    assert.equal(Object.keys(healthy.report.health).length, 7);
    assert.equal(healthy.report.health.approvalMode, 'approval');
    bus.redisClient.isOpen = isOpen;
    bus.redisClient.isReady = isReady;
    advance();
    const lost = await sampler.sample();
    assert.equal(lost.verified, false, 'stale connected/isOpen cannot certify a disconnected or reconnecting bus');
    assert.equal(lost.result, 'coverage_health_unready');
    assert.equal(context.getRuntimeCoverageHealth().eventBusConnected, false);
    const rows = (await db.query(`SELECT suite_name,report FROM pbk_eval_runs
      WHERE suite_name IN ('runtime_coverage_v1','runtime_coverage_control_v1')`)).rows;
    assert.equal(rows.filter(row => row.suite_name === 'runtime_coverage_v1').length, 2);
    assert.equal(rows.find(row => row.suite_name === 'runtime_coverage_control_v1').report.phase, 'pending');
    assert.equal(sampler.status().segmentRef, null);
    const denied = await readRuntimeCoverage({ pool, secret: fixtureSecret, revision, now: () => wall });
    assert.equal(denied.verified, false);
    assert.equal(denied.result, 'coverage_latest_unverified');
    bus.redisClient.isOpen = true;
    bus.redisClient.isReady = true;
    advance();
    const recovered = await sampler.sample();
    assert.equal(recovered.verified, true);
    assert.equal(recovered.report.previous, null);
    assert.equal(recovered.report.intervalStart, recovered.report.cutoff);
    assert.notEqual(recovered.report.segmentRef, healthy.report.segmentRef, 'recovery must not bridge the unready interval');
  } finally { sampler.stop(); }
});

test.each(['missing', 'off', 'local', 'bootstrap', 'database', 'db-url', 'pool', 'secret', 'controlled', 'diagnostic', 'ready'])
('actual lifecycle startup gates %s without evidence writes outside admitted startup', async mode => {
  let created = 0, started = 0, stopped = 0;
  const health = { enabled: true, initialized: true, otelReady: true };
  const processFixture = new EventEmitter();
  processFixture.env = mode === 'missing' ? {} : { PBK_RUNTIME_COVERAGE_ENABLED: mode === 'off' ? 'false' : 'true' };
  const server = new EventEmitter();
  const context = vm.createContext({ process: processFixture, IS_HOSTED: mode !== 'local',
    DATABASE_URL: mode === 'db-url' ? '' : 'fixture-local-only', BRIDGE_API_KEY: mode === 'secret' ? '' : secret, BUILD_REVISION: revision,
    runtimeCoverageSampler: undefined, runtimeCoverageStopped: false, runtimeCoverageStarted: false,
    runtimeStateBootstrap: { ready: mode !== 'bootstrap' },
    state: { status: { mode: 'approval' } },
    getPostgresHealthMeta: () => ({ ready: mode !== 'database' }),
    getRuntimeEvidenceContext: () => ({ classification: ['controlled', 'diagnostic'].includes(mode) ? mode : 'unknown' }),
    getPgPool: () => mode === 'pool' ? null : ({ connect() { throw Error('startup must not connect in this fixture'); } }),
    getRuntimeEventArchiveStatus: () => ({ ready: true }), getProviderCircuitStatus: () => ({ ready: true }),
    getPbkObservabilityStatus: () => health,
    createOperationalAuditPool,
    getDefaultEventBus: () => ({ mode: 'redis', connected: true, redisClient: { isOpen: true, isReady: true } }),
    createRuntimeCoverageSampler: options => {
      created++;
      const fixedHealth = options.health();
      assert.equal(Object.keys(fixedHealth).length, 7);
      assert.equal(fixedHealth.approvalMode, 'approval');
      for (const field of Object.keys(fixedHealth).filter(key => key !== 'approvalMode')) assert.equal(fixedHealth[field], true);
      return { start: () => { started++; return true; }, stop: () => { stopped++; } };
    },
  });
  for (const name of ['getRuntimeCoverageHealth', 'startRuntimeCoverageIfReady', 'stopRuntimeCoverage', 'wireRuntimeCoverageLifecycle']) {
    vm.runInContext(extract(name), context);
  }
  context.wireRuntimeCoverageLifecycle(server);
  assert.equal(processFixture.listenerCount('SIGTERM'), 0);
  server.emit('listening');
  context.startRuntimeCoverageIfReady();
  if (mode === 'ready') {
    assert.equal(created, 1);
    assert.equal(started, 1);
    health.otelReady = false;
    assert.equal(context.getRuntimeCoverageHealth().observabilityReady, false);
    server.emit('close');
    assert.equal(stopped, 1);
    assert.equal(context.startRuntimeCoverageIfReady(), false);
  } else assert.equal(created, 0);
});

test.each(['mp3', 'PCMU'])('actual outbound sender retains MP3-only transport and the existing text cap: %s', async mode => {
  const texts = [], messages = [];
  const context = vm.createContext({ Date, process: { env: {} },
    sanitizeAvaSpokenOutput: value => value, PBK_TELNYX_ELEVENLABS_MEDIA_REPLY_ENABLED: true,
    TELNYX_BIDIRECTIONAL_MEDIA_MODE: mode, ELEVENLABS_TTS_ENABLED: true,
    ELEVENLABS_API_KEY: 'explicit-local-tts-fixture-material', WebSocket: { OPEN: 1 },
    TELNYX_ELEVENLABS_MEDIA_REPLY_MIN_MS: 0, TELNYX_ELEVENLABS_OUTPUT_FORMAT: 'mp3_44100_128',
    ELEVENLABS_TELNYX_TTS_TIMEOUT_MS: 1234, toNumber: (value, fallback) => Number(value ?? fallback),
    fetchElevenLabsTts: async (params, text, options) => {
      texts.push(text);
      assert.equal(params.outputFormat, 'mp3_44100_128');
      assert.equal(options.timeoutMs, 1234);
      return { response: { ok: true }, outputFormat: 'mp3_44100_128' };
    },
    readPhoneTtsAudio: async (_response, onFirstByte) => { onFirstByte(); return Buffer.from('fixture-compressed-bytes'); },
    isTelnyxTtsReplyStale: () => ({ stale: false }), recordCallTrace() {}, recordElevenLabsValidation() {},
  });
  vm.runInContext(extract('sendElevenLabsTtsToTelnyxMediaStream'), context);
  const phoneTurnTiming = {};
  const result = await context.sendElevenLabsTtsToTelnyxMediaStream({ streamId: 'fixture-stream',
    telnyxMediaSocket: { readyState: 1, send: message => messages.push(JSON.parse(message)) } },
  'x'.repeat(1200), { phoneTurnTiming });
  if (mode === 'mp3') {
    assert.equal(result.ok, true);
    assert.equal(texts[0].length, 900);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].event, 'media');
    assert.equal(typeof phoneTurnTiming.mediaEnqueuedAt, 'number');
    assert.equal(phoneTurnTiming.mediaDurationMs, undefined);
    assert.equal(phoneTurnTiming.speechCompletionMs, undefined);
  } else {
    assert.equal(result.result, 'unsupported_mode');
    assert.equal(texts.length, 0);
    assert.equal(messages.length, 0);
  }
});

test('actual bootstrap recovery starts the admitted sampler once after restoring state', async () => {
  let starts = 0;
  const context = vm.createContext({ DATABASE_URL: 'fixture-local-only', runtimeStateBootstrap: { ready: false },
    runtimeStateRecoveryPromise: null, loadState: async () => ({}), createScopedState: value => value,
    syncAgentRegistryFromPg: async () => ({ persistence: { ok: true } }), clearBridgeReadCache() {},
    isoNow: () => new Date(NOW).toISOString(), scheduleRuntimeStateBroadcast() {},
    startRuntimeCoverageIfReady: () => { starts++; }, console: { log() {}, warn() {} },
  });
  vm.runInContext(extract('recoverRuntimeStateAfterBootstrapFailure'), context);
  await context.recoverRuntimeStateAfterBootstrapFailure();
  await context.recoverRuntimeStateAfterBootstrapFailure();
  assert.equal(starts, 1);
});

test.each(['organic', 'controlled', 'failed', 'partial', 'cancelled', 'provider'])('actual registered advisory handler measures its result: %s', async mode => {
  let elapsed = 0;
  const tasks = [];
  const output = { ok: mode !== 'failed', answer: 'Research conclusion '.repeat(100), citations: ['local-fixture'] };
  const agentId = mode === 'provider' ? 'bant-enforcer' : 'rex';
  const bant = { budget: 'fixture', authority: 'fixture', need: 'fixture', timeline: 'fixture', urgency: 'fixture' };
  if (['partial', 'cancelled'].includes(mode)) output.status = mode;
  const context = vm.createContext({ Date, performance: { now: () => elapsed }, controlledExecution,
    withRuntimeEvidenceContext, registeredAgentTimingChannel, bindAgentTimingToParams, getTrustedAgentTimingProof, agentTimingResultSucceeded,
    getCurrentAgentRegistry: () => [{ id: agentId, name: agentId, status: 'active', endpoint: 'local', metadata: { local: true } }],
    normalizeAgentRegistryId, buildAgentRegistrySnapshot: () => ({}),
    buildAgentWorkOrderEnvelope: () => ({ id: 'local-work-order', goal: 'local research', approvalPolicy: { providerWriteIntent: false } }),
    recordAgentHandoffTask: async record => { tasks.push(record); return record; },
    normalizeAgentName: value => value,
    prepareAgentActionPBKIntelligenceContext: async () => ({}), finalizeAgentActionPBKIntelligenceContext: async () => ({}),
    summarizeRuntimePBKIntelligenceContext: value => value, invokeRegisteredAgent,
    toolHandlers: { getBrainState: async () => { elapsed += 250; return output; } },
    normalizeBantInfo: () => bant, getMissingBantFields: () => [], extractBantFromTranscript: () => ({}),
    createBridgeAgentTimingTurn: (channel, agentId, runId) => createAgentTimingTurn({ secret, revision,
      policy: getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(AGENT_LATENCY_PILOT_V2) }),
      channel, agentId, runId, now: () => NOW + elapsed, monotonicNow: () => elapsed }),
    buildAgentExecutionEvidence, isAgentHandlerCompletion, isoNow: () => new Date(NOW + elapsed).toISOString(),
    persistState: async () => {}, state: {},
  });
  for (const name of ['getLocalAgentRegistryHandlers', 'invokeAgentFromRegistry']) vm.runInContext(extract(name), context);
  const run = () => context.invokeAgentFromRegistry({ agentId, payload: {
    query: 'local fixture', metadata: { channel: 'phone', outputCodePoints: 1, timingProof: { signature: 'forged' } },
  } });
  await (mode === 'controlled' ? controlledExecution.run({ workflowInput: {}, fixture: {}, runId: 'local-controlled' }, run) : run());
  const proof = tasks.at(-1).metadata.executionEvidence.timingProof;
  if (['organic', 'provider'].includes(mode)) {
    assert.ok(proof, 'registered handler must attach a server measurement');
    assert.equal(proof.runId, 'local-work-order');
    assert.equal(proof.channel, mode === 'provider' ? 'provider' : 'research');
    assert.equal(proof.outputCodePoints, mode === 'provider' ? null : [...output.answer].length);
  } else assert.equal(proof, undefined);
});

test.each(['mp3', 'clipped', 'stale', 'failed', 'controlled'])('actual phone closure leaves unsupported milestones unverified: %s', async mode => {
  let elapsed = 0;
  const ops = [], sent = [];
  const answer = mode === 'clipped' ? 'Long generated answer. '.repeat(100) : 'Actual phone answer';
  const session = { callId: 'local-call', sellerTranscriptVersion: 1 };
  const noop = () => {};
  const context = vm.createContext({ Date, session, state: {}, withRuntimeEvidenceContext,
    PBK_TELNYX_BRIDGE_AVA_REPLY_ENABLED: true, PBK_TELNYX_BRIDGE_AVA_REPLY_FORCE: false,
    TELNYX_BRIDGE_AVA_REPLY_MIN_MS: 0, STRATEGIST_PROVIDER: 'fixture', DEEPSEEK_LIVE_MODEL: 'fixture',
    isCurrentTelnyxMediaSession: () => true, expandAvaLiveOptionLetterAnswer: () => '',
    classifyAvaLiveSellerIntent: () => ({}), buildAvaLiveTurnStateSnapshot: () => ({}),
    getCallById: () => ({}), hasPendingAvaSellerTurnFingerprint: () => ({}), getActiveTelnyxAvaTurnLock: () => null,
    isCallerRequestingFloor: () => false, extractLikelyCallerNameOnlyUtterance: () => '',
    shouldSkipTelnyxLiveAckOnlyReply: () => false, isAvaLiveAuthorityQuestion: () => false,
    isWeakTelnyxSellerUtterance: () => false, hasRecentAvaSellerTurnFingerprint: () => ({}),
    isTelnyxCallStillSpeakable: () => true, rememberPendingAvaSellerTurnFingerprint: () => 'local-fingerprint',
    buildTelnyxLiveAvaReply: async () => {
      elapsed += 250;
      if (mode === 'stale') session.sellerTranscriptVersion++;
      return { text: answer, pbkIntelligenceContext: {}, replyMode: 'local' };
    },
    guardTelnyxLiveSpokenReply: reply => reply, sanitizeAvaSpokenOutput: value => value,
    buildOperatorWhisperRecord: () => null, buildLiveCallBantStatus: () => ({}),
    buildAvaLiveSkillOutcomeDraft: () => ({}), buildAvaLiveCockpitSnapshot: () => ({}),
    mergePBKIntelligenceContextOutcome: value => value, buildDefaultAgentFleet: () => [],
    setTelnyxAvaTurnLock: () => ({}), estimateTelnyxAvaSpeechLockMs: () => 0,
    sendAvaPhoneReplyAudio: async (_session, text) => { sent.push(text); elapsed += 100; return { ok: mode !== 'failed', provider: 'fixture-mp3' }; },
    summarizePhoneTurnTiming: () => ({}), recordPbkTurnLatency: async () => {}, getTelnyxLiveReplyStrategistTimeoutMs: () => 0,
    isoNow: () => new Date(NOW + elapsed).toISOString(), summarizeRuntimePBKIntelligenceContext: value => value,
    makeActivity: value => value, persistState: async () => {}, syncTelnyxSessionToRedis: async () => {},
    createBridgeAgentTimingTurn: channel => createAgentTimingTurn({ secret, revision,
      policy: getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(AGENT_LATENCY_PILOT_V2) }),
      channel, agentId: 'ava', runId: 'local-phone-run', now: () => NOW + elapsed, monotonicNow: () => elapsed }),
    bindAgentTimingToParams, getRuntimeEvidenceContext, agentTimingResultSucceeded,
    recordAgentOps: params => { ops.push({ params, proof: getTrustedAgentTimingProof(params) }); },
  });
  for (const name of ['recordCallTrace', 'applyAvaLiveTurnFacts', 'recordAvaLiveTurnDecision', 'refreshAvaLiveCallStartCache',
    'clearPendingAvaSellerTurnFingerprint', 'applyRuntimePBKIntelligenceContextToSession', 'rememberAvaSellerTurnFingerprint',
    'recordLatencyMetric', 'rememberContextAwareScriptSelection', 'rememberAvaLiveReplyFingerprint', 'addActivity',
    'upsertCall', 'scheduleRuntimeStateBroadcast']) context[name] = noop;
  const start = bridgeSource.indexOf('  const maybeSpeakTelnyxAvaReply = async (item) =>');
  const end = bridgeSource.indexOf('\n\n  const noteTelnyxCallerSpeechDuringAva', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(`${bridgeSource.slice(start, end)}\nglobalThis.phoneTurn = maybeSpeakTelnyxAvaReply;`, context);
  const run = () => context.phoneTurn({ speechFinal: true, transcript: 'Local fixture property question', turnVersion: 1 });
  await (mode === 'controlled' ? controlledExecution.run({}, run) : run());
  if (mode === 'stale') assert.equal(ops.length, 0);
  else {
    assert.equal(ops.length, 1, 'actual phone closure must pass its server timing boundary');
    if (['failed', 'controlled'].includes(mode)) assert.equal(ops[0].proof, null);
    else {
      assert.equal(ops[0].proof.channel, 'phone');
      assert.equal(ops[0].proof.outputCodePoints, [...answer].length);
      assert.equal(Object.keys(ops[0].proof.timings).join(','), 'completionMs');
      assert.equal(ops[0].proof.mediaDurationMs, null);
      assert.equal(ops[0].params.metadata.fullReplySpokenVerified, false);
    }
    assert.equal(sent[0], answer);
  }
});

function sourceWriterFixture({ failWrite = false, failReceipt = false } = {}) {
  const receipts = [];
  const pool = { connect: async () => ({ query: config => db.query(config.text, config.values), release() {} }),
    query: (sql, values) => { if (failWrite) throw Error('fixture write failure'); return db.query(sql, values); } };
  const context = vm.createContext({ Date, console: { warn() {} },
    getPgPool: () => pool, BRIDGE_API_KEY: secret, BUILD_REVISION: revision, process: { env: {} },
    runtimeSourceWriteReturning, captureRuntimeSourceWriteBinding,
    recordRuntimeSourceEvidence: input => {
      const result = failReceipt ? Promise.resolve({ verified: false }) : recordRuntimeSourceEvidence({ ...input, now: NOW });
      receipts.push(result);
      return result;
    },
    normalizeTenantId: value => value, toNumber: (value, fallback) => Number(value ?? fallback),
    isoNow: () => new Date(NOW - 1000).toISOString(), recordGuardrailViolationMetric() {},
  });
  for (const name of ['captureBridgeRuntimeSourceWrite', 'queueRuntimeSourceReceipt', 'queueRuntimeSourceWrite',
    'recordPbkQaAudit', 'recordPbkSafetyAudit']) vm.runInContext(extract(name), context);
  return { context, receipts };
}

test.each(['qa', 'safety'])('actual %s wrapper alone never creates operational origin or hides adverse outcomes', async sourceKind => {
  const fixture = sourceWriterFixture();
  const name = sourceKind === 'qa' ? 'recordPbkQaAudit' : 'recordPbkSafetyAudit';
  const result = await fixture.context[name]({ id: 'unknown-audit', toolName: 'local_tool', passed: false,
    blocked: true, source: 'controlled-qualification', metadata: { origin: 'operator_chat', diagnostic: true } });
  assert.equal(result.ok, true);
  assert.equal((await fixture.receipts[0]).classification, 'unknown');
  const snapshot = await collectRuntimeSourceSnapshot({ client: { query: config => db.query(config.text, config.values) },
    secret, revision, now: NOW, windowStart: NOW - 86400000, windowEnd: NOW });
  const counts = snapshot.sources.find(source => source.sourceKind === sourceKind).counts;
  assert.equal(counts.unknown, 1);
  assert.equal(counts[sourceKind === 'qa' ? 'failed' : 'blocked'], 1);
  assert.equal(snapshot.eligible, false);
});

test.each(['qa', 'safety'])('%s real writer pairs only actual persistence under inherited context', async sourceKind => {
  const { context, receipts } = sourceWriterFixture();
  const name = sourceKind === 'qa' ? 'recordPbkQaAudit' : 'recordPbkSafetyAudit';
  const record = { id: 'local-audit', toolName: 'local_tool', passed: true, blocked: false, source: 'controlled-diagnostic-label' };
  assert.equal((await withRuntimeEvidenceContext('operator_chat', () => context[name](record))).ok, true);
  assert.equal((await receipts[0]).classification, 'operational', 'public labels do not hide actual results');
  assert.equal(receipts.length, 1);
  const proof = (await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'sourceKind'=$1`, [sourceKind])).rows[0].report;
  assert.equal(proof.outcome, sourceKind === 'qa' ? 'success' : 'allowed');
  const failed = sourceWriterFixture({ failWrite: true });
  assert.equal((await failed.context[name]({ ...record, id: 'failed' })).ok, false);
  assert.equal(failed.receipts.length, 0);
  const gap = sourceWriterFixture({ failReceipt: true });
  assert.equal((await gap.context[name]({ ...record, id: 'receipt-gap' })).ok, true);
  await Promise.all(gap.receipts);
});

test.each(['success', 'write_failure', 'commit_failure', 'receipt_failure'])('conversation capture releases only after acknowledged COMMIT: %s', async mode => {
  const threadId = '11111111-1111-4111-8111-111111111111';
  await db.query('INSERT INTO conversation_threads(id) VALUES ($1)', [threadId]);
  const order = [], receipts = [];
  const pool = { query: () => { throw Error('no separate pool read inside transaction'); },
    connect: async () => ({ release() {}, query: async (sql, values) => {
      if (mode === 'write_failure' && sql.includes('INSERT INTO public.conversation_events')) throw Error('fixture write failure');
      if (sql === 'COMMIT' && mode === 'commit_failure') throw Error('fixture commit failure');
      const result = await db.query(sql, values);
      if (sql === 'COMMIT') order.push('commit');
      return result;
    } }) };
  const store = createConversationStore(pool, {
    captureSourceWrite: row => {
      order.push('capture');
      return captureRuntimeSourceWriteBinding({ secret, revision, sourceKind: 'conversation_projection', row });
    },
    onSourceWriteCommitted: (writeBinding, sourceId) => {
      order.push('callback');
      assert.equal(order.at(-2), 'commit');
      if (mode === 'receipt_failure') throw Error('fixture evidence storage failure');
      const receiptPool = { connect: async () => ({ query: config => db.query(config.text, config.values), release() {} }) };
      receipts.push(recordRuntimeSourceEvidence({ pool: receiptPool, secret, revision, sourceKind: 'conversation_projection',
        sourceId, writeBinding, now: Date.now }));
    },
  });
  const write = () => store.upsertEvent({ threadId, eventType: 'message.sms', channel: 'sms', direction: 'inbound',
    sourceTable: 'fixture', sourceId: 'fixture-version', status: 'received', body: 'private fixture body' });
  if (['success', 'receipt_failure'].includes(mode)) {
    const result = await withRuntimeEvidenceContext('operator_chat', write);
    assert.ok(result.id);
    assert.deepEqual(order, ['capture', 'commit', 'callback']);
    if (mode === 'success') assert.equal((await receipts[0]).verified, true);
    else assert.equal(receipts.length, 0);
  } else {
    await assert.rejects(() => withRuntimeEvidenceContext('operator_chat', write));
    assert.equal(order.includes('callback'), false);
    assert.equal(receipts.length, 0);
  }
});

test.each(['unknown', 'operator_chat'])('actual live projector uses bound post-commit store without upgrading %s origin', async origin => {
  const receipts = [];
  const query = (sql, values) => db.query(typeof sql === 'string' ? sql : sql.text,
    typeof sql === 'string' ? values : sql.values);
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const context = vm.createContext({ createLiveConversationProjector, createConversationStoreBase: createConversationStore,
    captureRuntimeSourceWriteBinding, runtimeSourceWriteReturning, BRIDGE_API_KEY: secret, BUILD_REVISION: revision,
    process: { env: {} }, getPgPool: () => pool, console,
    recordRuntimeSourceEvidence: input => {
      const receipt = recordRuntimeSourceEvidence(input);
      receipts.push(receipt);
      return receipt;
    },
  });
  for (const name of ['captureBridgeRuntimeSourceWrite', 'queueRuntimeSourceReceipt', 'createConversationStore',
    'projectLiveConversationRecord']) vm.runInContext(extract(name), context);
  const run = () => context.projectLiveConversationRecord({ record: { id: 'fixture-source' }, source: 'forged-operational',
    projector: () => ({ workspaceId: 'pbk', eventType: 'message.sms', channel: 'sms', direction: 'inbound',
      senderAddress: '+15555550123', sourceTable: 'fixture', sourceId: 'fixture-source', body: 'fixture body', status: 'received' }) });
  const result = await (origin === 'unknown' ? run() : withRuntimeEvidenceContext(origin, run));
  assert.equal(result.ok, true);
  assert.equal(receipts.length, 1, 'real live projector must use the bridge-bound store factory');
  const receipt = await receipts[0];
  assert.equal(receipt.verified, origin !== 'unknown');
  assert.equal(receipt.classification, origin === 'unknown' ? 'unknown' : 'operational');
});

function archiveWriter({ pauseReceipt = Promise.resolve(), failWrite = false } = {}) {
  const receipts = [];
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = source.indexOf('async function persistActivityLogRecord(entry = {}) {');
  const end = source.indexOf('\nasync function recordProductionRuntimeEvent(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    Date,
    hashString: () => 1,
    console: { warn() {} },
    getPgPool: () => ({ query: (sql, values) => { if (failWrite) throw Error('fixture persistence failure'); return db.query(sql, values); } }),
    ensureActivityLogSchema: async () => {},
    isoNow: () => new Date(NOW - 1000).toISOString(),
    activityLogPersistenceWarned: false,
    runtimeSourceWriteReturning,
    queueRuntimeSourceWrite: (sourceKind, row) => {
      const writeBinding = captureRuntimeSourceWriteBinding({ secret, revision, sourceKind, row });
      const pool = { connect: async () => ({ query: config => db.query(config.text, config.values), release() {} }) };
      receipts.push((async () => {
        await pauseReceipt;
        return recordRuntimeSourceEvidence({ pool, secret, revision, sourceKind, sourceId: row.id, writeBinding, now: NOW });
      })());
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return { write: context.writeRuntimeEventToActivityLog, receipts };
}

test('a delayed archive receipt must not attest another writer latest row under the first writer origin', async () => {
  let resume;
  const paused = new Promise(resolve => { resume = resolve; });
  const { write, receipts } = archiveWriter({ pauseReceipt: paused });
  await withRuntimeEvidenceContext('operator_chat', async () => {
    await write({ id: sourceId, source: 'fixture', event_type: 'first', severity: 'info' });
  });
  try {
    // This second committed write has no operational context and reuses A's identity.
    await write({ id: sourceId, source: 'fixture', event_type: 'second', severity: 'info' });
    const row = (await db.query('SELECT category FROM activity_log WHERE id=$1', [sourceId])).rows[0];
    assert.equal(row.category, 'SECOND');
  } finally { resume(); }
  assert.equal(receipts.length, 2, 'both actual durable writes must capture their own RETURNING projection');
  const [receipt] = await Promise.all(receipts);
  const proofs = (await db.query(`SELECT report FROM pbk_eval_runs
    WHERE report->>'recordRef' IS NOT NULL`)).rows;
  assert.equal(receipt.verified && receipt.classification === 'operational', false,
    'ID-only Task 2 recorder must not attribute B durable row to A operational context');
  assert.equal(proofs.some(({ report }) => report.classification === 'operational'), false);
});

test('actual archive writer never pairs a failed persistence and signs its own committed version', async () => {
  const failed = archiveWriter({ failWrite: true });
  await assert.rejects(() => failed.write({ id: sourceId }), /activity_log_archive_unavailable/);
  assert.equal(failed.receipts.length, 0);
  const success = archiveWriter();
  await withRuntimeEvidenceContext('operator_chat', () => success.write({ id: sourceId, source: 'fixture', severity: 'info' }));
  assert.equal((await success.receipts[0]).verified, true);
});

test('actual provider-circuit callback establishes internal origin independently of caller labels', async () => {
  const { write, receipts } = archiveWriter();
  const archives = [];
  const archive = createRuntimeEventArchive({ writer: write, now: () => NOW - 1000 });
  const context = vm.createContext({ withRuntimeEvidenceContext, createProviderCircuitBreaker,
    recordProductionRuntimeEvent: event => { const pending = archive.recordEvent(event); archives.push(pending); return pending; } });
  const start = bridgeSource.indexOf('const providerCircuitBreaker = createProviderCircuitBreaker({');
  const end = bridgeSource.indexOf('\n\nfunction buildProviderCircuitOpenResult', start);
  vm.runInContext(`${bridgeSource.slice(start, end)}\nglobalThis.circuits = providerCircuitBreaker;`, context);
  context.circuits.recordSuccess('fixture-provider');
  await Promise.all(archives);
  const receipt = await receipts[0];
  assert.equal(receipt.classification, 'operational');
  const row = (await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'recordRef' IS NOT NULL`)).rows[0];
  assert.equal(row.report.origin, 'runtime_circuit');
});

test.each(['info', 'error'])('actual generic runtime POST stays unknown and retains %s outcomes despite caller labels', async severity => {
  const { write, receipts } = archiveWriter();
  let response;
  const context = vm.createContext({ request: { method: 'POST' }, pathname: '/api/runtime/events', response: {},
    matchesPath: (path, paths) => paths.includes(path),
    readBody: async () => ({ eventType: 'posted_event', severity, source: 'controlled-qualification',
      metadata: { operational: false, diagnostic: true, origin: 'operator_chat', source: 'controlled', timingProof: { signature: 'forged' } } }),
    runtimeEventArchive: createRuntimeEventArchive({ writer: write, now: () => NOW - 1000 }),
    runtimeEventArchiveStats: { attempted: 0, archived: 0, failed: 0 },
    isoNow: () => new Date(NOW).toISOString(), json: (_response, _status, body) => { response = body; },
  });
  vm.runInContext(extract('recordProductionRuntimeEvent'), context);
  const start = bridgeSource.indexOf("    if (request.method === 'POST' && matchesPath(pathname, ['/api/runtime/events',");
  const end = bridgeSource.indexOf("    if (request.method === 'GET' && matchesPath(pathname, ['/api/provider-circuits/status',", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(`globalThis.post = async () => { ${bridgeSource.slice(start, end)} };`, context);
  await context.post();
  assert.equal(response.ok, true);
  assert.equal((await receipts[0]).classification, 'unknown');
  const query = config => db.query(config.text, config.values);
  const snapshot = await collectRuntimeSourceSnapshot({ client: { query }, secret, revision,
    now: NOW, windowStart: NOW - 86400000, windowEnd: NOW });
  const counts = snapshot.sources.find(source => source.sourceKind === 'runtime_archive').counts;
  assert.equal(counts.unknown, 1);
  assert.equal(counts.controlled, 0);
  assert.equal(counts.diagnostic, 0);
  assert.equal(counts.failed, severity === 'error' ? 1 : 0);
  assert.equal(snapshot.eligible, false);
});
