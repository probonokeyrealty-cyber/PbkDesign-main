import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { withRuntimeEvidenceContext, getRuntimeEvidenceContext } from './runtime-evidence-context.mjs';
import { createAvaRequestTiming } from './ava-request-timing.mjs';
import { createAgentTimingTurn, bindAgentTimingToParams, agentTimingResultSucceeded, getTrustedAgentTimingProof } from './agent-timing-adapters.mjs';
import { AGENT_LATENCY_PILOT_V2, getAgentLatencyPolicy } from './agent-latency-policy.mjs';
import { appendAssistantMessage, normalizeAssistantSession, detectAssistantIntent, planAssistantIntent } from './ava-assistant-chat.mjs';
import { runBenchmark, summarizeBenchmark } from './ava-latency-benchmark.mjs';

// Test-only extraction: actual HTTP route, assistant entry, body reader and recorder;
// replace external/state services, never the context/measurement implementation.
export function createLatencyEntryFixture({ secret = randomUUID(), onSessionWrite = async () => {} } = {}) {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const records = [], entries = [], writes = [], sessions = new Map();
  const revision = 'a'.repeat(40);
  const policy = getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(AGENT_LATENCY_PILOT_V2) });
  const rawSymbol = Symbol.for('pbk.rawBodyBuffer');
  const context = vm.createContext({ Buffer, Date, Symbol, URL, randomUUID,
    process: { env: { RENDER_GIT_COMMIT: revision } },
    OUTLOOK_LEAD_EMAIL_ENABLED: false,
    BRIDGE_API_KEY: secret, RAW_BODY_BUFFER_SYMBOL: rawSymbol, MAX_REQUEST_BODY_BYTES: 1024 * 1024,
    withRuntimeEvidenceContext, getRuntimeEvidenceContext, runBenchmark, summarizeBenchmark,
    createAvaRequestTiming, bindAgentTimingToParams, agentTimingResultSucceeded,
    createBridgeAgentTimingTurn: channel => {
      entries.push({ channel, ...getRuntimeEvidenceContext() });
      return createAgentTimingTurn({ secret, revision, policy, channel, agentId: 'ava', runId: randomUUID() });
    },
    normalizeConversationMessages: messages => messages || [],
    getLastUserMessage: (_messages, text) => text,
    sanitizePublicAvaChatTurn: content => ({ content }),
    getPublicAvaAssistantSessionId: (_request, body) => body.sessionId || 'ordinary',
    readPublicAvaAssistantSession: async id => sessions.get(id) || {},
    normalizeAssistantSession, appendAssistantMessage, detectAssistantIntent, planAssistantIntent,
    getCleanAvaActiveMemories: () => [],
    runAvaMissionController: async () => ({ controlEnvelope: { schema: 'ava_control_envelope_v1',
      decision: 'allow', authorizesExecution: true }, trace: { guard: { result: 'passed' } } }),
    state: { leadImports: [], approvals: [] },
    getPendingRuntimeApprovals: approvals => approvals,
    buildInternalAssistantApprovalAnswer: () => 'No pending approvals.',
    buildInternalAssistantSummaryAnswer: () => 'No recent activity.',
    findInternalAssistantLead: () => null,
    getInternalAssistantLeadId: () => '',
    buildAvaReadOnlyAuditFallback: () => ({ answer: 'Read-only audit.', toolResult: { ok: true, result: 'ava_read_only_audit' } }),
    runInternalAvaDeepSeekChat: async ({ requestTiming }) => requestTiming.measure('llm_request', async () => ({
      ok: true, answer: 'A local read-only model fixture.', usagePersistence: { ok: true, result: 'fixture' },
      toolResult: { ok: true, result: 'deepseek_chat_answer', provider: { model: 'isolated-fixture' } },
    })),
    normalizeAvaAssistantAnswer: answer => answer,
    recordAvaMissionLedger: () => null,
    getAvaDeepSeekDecisionFromToolResult: () => null,
    writePublicAvaAssistantSession: async (id, session) => {
      writes.push(getRuntimeEvidenceContext()); sessions.set(id, session);
      await onSessionWrite();
    },
    addActivity() {}, makeActivity: value => value, persistStateInBackground() {},
    chatTimingDeliveries: new WeakMap(),
    redactApprovalParamPreview: value => value,
    summarizeProviderActionResult: value => ({ ok: value.ok, result: value.result }),
    recordAgentOps: value => records.push({ value, proof: getTrustedAgentTimingProof(value), context: getRuntimeEvidenceContext() }),
  });
  const authorization = readFileSync(new URL('./release-qualification.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  for (const name of ['isDirectQualificationFounder', 'authorizeQualificationRequest']) {
    const start = authorization.indexOf(`function ${name}(`);
    vm.runInContext(authorization.slice(start, authorization.indexOf('\n}\n', start) + 2), context);
  }
  for (const name of ['readRawBodyBuffer', 'readBody', 'dropCurrentAssistantUserTurn', 'mergeAssistantHistories',
    'isAvaReadOnlyAuditRequest', 'enforceAvaControlEnvelope', 'recordAvaAssistantPlanOps', 'handleInternalAvaAssistantChatRequest']) {
    const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
    assert(match, `actual ${name} definition required`);
    const finish = source.indexOf('\n}\n', match.index) + 2;
    vm.runInContext(source.slice(match.index, finish), context);
  }
  const start = source.indexOf("    if (pathname === '/api/admin/ava-latency/run') {");
  assert(start >= 0, 'actual fixed diagnostic HTTP runner must exist');
  const finish = source.indexOf("    if (pathname === '/api/admin/qualification/run')", start);
  assert(finish > start);
  vm.runInContext(`async function route(request, response) {
    const url = new URL(request.url, 'http://isolated.invalid');
    const pathname = url.pathname;
    ${source.slice(start, finish)}
  }`, context);
  context.json = (response, status, body) => Object.assign(response, { status, body });
  return { context, records, entries, writes, secret, revision, policy,
    async request(body = {}, headers = { authorization: `Bearer ${secret}` }, search = '', method = 'POST') {
      const response = {};
      // Parse in the route's realm, just as the actual readBody does.
      const request = { url: '/api/admin/ava-latency/run' + search, method, headers,
        [rawSymbol]: Buffer.from(JSON.stringify(body)) };
      await context.route(request, response);
      return response;
    },
    chat(body, extra = {}) { return context.handleInternalAvaAssistantChatRequest({ headers: {},
      [rawSymbol]: Buffer.from(JSON.stringify(body)), ...extra }); },
  };
}
