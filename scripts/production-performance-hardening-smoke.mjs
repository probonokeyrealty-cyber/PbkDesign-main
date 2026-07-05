import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  PERFORMANCE_HARDENING_REVISION,
  REQUIRED_PROVIDER_CIRCUITS,
  REQUIRED_POSTGRES_HOT_INDEXES,
  buildLoadScenarioPlan,
  buildLiveCallSpeedBudget,
  buildManualSendOutboxEnvelope,
  buildPostgresPerformanceReadiness,
  buildProviderCircuitCoverage,
  deriveManualSendIdempotencyKey,
} from './production-performance-hardening.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

assert.match(PERFORMANCE_HARDENING_REVISION, /production-performance-hardening/);

const closedCircuitStatus = {
  statuses: REQUIRED_PROVIDER_CIRCUITS.map((provider) => ({
    provider,
    state: 'closed',
    failures: 0,
  })),
};
const circuitCoverage = buildProviderCircuitCoverage({ circuitStatus: closedCircuitStatus });
assert.equal(circuitCoverage.ready, true);
assert.deepEqual(circuitCoverage.missingProviders, []);
assert.ok(circuitCoverage.requiredProviders.includes('slack'));

const missingSlackCoverage = buildProviderCircuitCoverage({
  circuitStatus: {
    statuses: closedCircuitStatus.statuses.filter((status) => status.provider !== 'slack'),
  },
});
assert.equal(missingSlackCoverage.ready, false);
assert.deepEqual(missingSlackCoverage.missingProviders, ['slack']);

const readiness = buildPostgresPerformanceReadiness({
  connection: {
    ok: true,
    databaseUrl: 'postgres://pbk:secret@pbk-openclaw-db.internal:5432/pbk',
  },
  requiredTables: [
    'conversation_threads',
    'conversation_thread_identities',
    'conversation_events',
    'communication_sender_identities',
    'lead_profiles',
    'provider_action_dispatches',
  ],
  tableRows: [
    { table_name: 'conversation_threads', exists: true },
    { table_name: 'conversation_thread_identities', exists: true },
    { table_name: 'conversation_events', exists: true },
    { table_name: 'communication_sender_identities', exists: true },
    { table_name: 'lead_profiles', exists: true },
    { table_name: 'provider_action_dispatches', exists: true },
  ],
  indexRows: REQUIRED_POSTGRES_HOT_INDEXES.map((indexName) => ({ index_name: indexName })),
});
assert.equal(readiness.ready, true);
assert.equal(readiness.usesRawPrivateIp, false);

const rawIpReadiness = buildPostgresPerformanceReadiness({
  connection: {
    ok: true,
    databaseUrl: 'postgres://pbk:secret@10.208.245.134:5432/pbk',
  },
  requiredTables: ['conversation_threads'],
  tableRows: [{ table_name: 'conversation_threads', exists: true }],
  indexRows: REQUIRED_POSTGRES_HOT_INDEXES.map((indexName) => ({ index_name: indexName })),
});
assert.equal(rawIpReadiness.ready, false);
assert.equal(rawIpReadiness.usesRawPrivateIp, true);
assert.ok(rawIpReadiness.blockers.includes('postgres_url_raw_private_ip'));

const firstKey = deriveManualSendIdempotencyKey({
  channel: 'sms',
  leadId: 'lead-123',
  recipient: '+16145550142',
  body: 'Can we talk today?',
  requestedBy: 'operator',
});
const secondKey = deriveManualSendIdempotencyKey({
  channel: 'sms',
  leadId: 'lead-123',
  recipient: '+1 (614) 555-0142',
  body: 'Can we talk today?',
  requestedBy: 'operator',
});
assert.equal(firstKey, secondKey);
assert.match(firstKey, /^manual-send:sms:/);

const failedOutbox = buildManualSendOutboxEnvelope({
  channel: 'sms',
  provider: 'telnyx',
  status: 'failed',
  idempotencyKey: firstKey,
  recipient: '+16145550142',
  error: 'Telnyx 409 conflict',
});
assert.equal(failedOutbox.ok, false);
assert.equal(failedOutbox.retryable, true);
assert.equal(failedOutbox.operatorVisible, true);
assert.equal(failedOutbox.timelineStatus, 'failed');

const plan = buildLoadScenarioPlan({
  baseUrl: 'https://pbk-openclaw-bridge.onrender.com',
  concurrency: 50,
});
assert.equal(plan.ready, true);
assert.equal(plan.concurrency, 50);
for (const pathName of [
  '/health',
  '/state?compact=1',
  '/api/conversations?limit=5',
  '/api/leads/search?q=test&limit=5',
  '/api/circuit/status',
  '/api/connection-health',
]) {
  assert.ok(
    plan.scenarios.some((scenario) => scenario.path === pathName),
    `missing load scenario ${pathName}`
  );
}

const loadSmokeSource = readFileSync(path.join(rootDir, 'scripts', 'load-bridge-smoke.mjs'), 'utf8');
assert.ok(
  loadSmokeSource.includes('PBK_LOAD_TEAM_PASSCODE') &&
    loadSmokeSource.includes('X-PBK-Team-Token') &&
    loadSmokeSource.includes('/api/auth/team'),
  'load smoke must support short-lived PBK team token auth for protected hosted read scenarios.'
);

const liveCallSpeedReady = buildLiveCallSpeedBudget({
  contractTargetMs: 100,
  strategistAttemptBudgetMs: 1400,
  strategistTotalBudgetMs: 2500,
  duplicateSuppression: true,
  cacheAtCallStart: true,
});
assert.equal(liveCallSpeedReady.ready, true);

const liveCallSpeedMissingCache = buildLiveCallSpeedBudget({
  contractTargetMs: 100,
  strategistAttemptBudgetMs: 1400,
  strategistTotalBudgetMs: 2500,
  duplicateSuppression: true,
  cacheAtCallStart: false,
});
assert.equal(liveCallSpeedMissingCache.ready, false);
assert.ok(liveCallSpeedMissingCache.blockers.includes('call_start_cache_missing'));

const liveCallSpeedSlowTotal = buildLiveCallSpeedBudget({
  contractTargetMs: 100,
  strategistAttemptBudgetMs: 1400,
  strategistTotalBudgetMs: 3500,
  duplicateSuppression: true,
  cacheAtCallStart: true,
});
assert.equal(liveCallSpeedSlowTotal.ready, false);
assert.ok(liveCallSpeedSlowTotal.blockers.includes('strategist_total_budget_too_high'));

const bridgeSource = readFileSync(path.join(rootDir, 'scripts', 'openclaw-local-server.mjs'), 'utf8');
const renderYaml = readFileSync(path.join(rootDir, 'render.yaml'), 'utf8');
assert.ok(
  bridgeSource.includes("from './production-performance-hardening.mjs'"),
  'bridge must import production performance hardening helpers'
);
assert.ok(
  bridgeSource.includes('/api/performance/status'),
  'bridge must expose a production performance status endpoint'
);
assert.ok(
  bridgeSource.includes('buildManualSendOutboxEnvelope'),
  'manual send path must expose outbox envelopes'
);
assert.ok(
  bridgeSource.includes('async function executeProviderCircuitGuard'),
  'bridge must expose a shared provider circuit guard for direct provider helpers'
);
for (const provider of ['telnyx', 'instantly', 'slack', 'deepseek', 'elevenlabs', 'deepgram', 'docusign']) {
  assert.ok(
    new RegExp(`executeProviderCircuitGuard\\(\\s*['"]${provider}['"]`).test(bridgeSource),
    `bridge direct provider helpers must enforce the ${provider} circuit`
  );
}
assert.ok(
  bridgeSource.includes('fuzzyLeadLookupCache') &&
    bridgeSource.includes("stateOmitted: true"),
  'lead search must use burst caching and omit full state snapshots'
);
assert.ok(
  bridgeSource.includes('buildAvaLiveCallStartCache'),
  'live calls must build a call-start cache for lead profile, facts, skills, memory summary, and BANT state'
);
assert.ok(
  bridgeSource.includes('refreshAvaLiveCallStartCache(session, contextCall'),
  'live reply path must refresh the call-start cache before strategist phrasing'
);
assert.ok(
  bridgeSource.includes('getAvaLiveCallSpeedReadiness()'),
  'performance readiness must inspect live-call cache/dedupe/prewarm markers instead of assuming readiness'
);
assert.ok(
  bridgeSource.includes('BRIDGE_READ_CACHE_TTL_MS') &&
    bridgeSource.includes('async function getCachedReadResponse') &&
    bridgeSource.includes('clearBridgeReadCache(') &&
    bridgeSource.includes('bridgeReadCacheInflight') &&
    bridgeSource.includes('bridgeReadCacheGeneration'),
  'bridge must provide a short coalesced read-through cache for high-traffic status/config endpoints'
);
assert.ok(
  /compactState:\s*Math\.max\(500,\s*Math\.min\(5000,\s*Number\(process\.env\.PBK_READ_CACHE_COMPACT_STATE_TTL_MS\s*\|\|\s*1500\)\)\)/.test(
    bridgeSource
  ) &&
    /getCachedReadResponse\(\s*['"]compact-state['"][\s\S]*?buildStateSnapshot\(\{ compact: true \}\)/.test(
      bridgeSource
    ),
  'compact /state reads must use a very short burst cache that is invalidated on state persistence.'
);
assert.ok(
  bridgeSource.includes('COMPACT_STATE_ARRAY_LIMIT') &&
    bridgeSource.includes('COMPACT_STATE_RECORD_BYTES') &&
    bridgeSource.includes('function compactSnapshotRecord') &&
    bridgeSource.includes('compact_state_record_limit') &&
    /items\.slice\(0, Math\.min\(limit, COMPACT_STATE_ARRAY_LIMIT\)\)\.map\(\(item\) => compactSnapshotRecord\(item\)\)/.test(bridgeSource) &&
    bridgeSource.includes('response.pbkCompactJson = compact'),
  'compact /state reads must cap array payloads, summarize oversized records, and skip pretty JSON serialization.'
);
for (const ttlMarker of [
  /agentRegistry:\s*Math\.max\(5000,\s*Math\.min\(60000,\s*Number\(process\.env\.PBK_READ_CACHE_AGENT_REGISTRY_TTL_MS\s*\|\|\s*60000\)\)\)/,
  /communicationIdentities:\s*Math\.max\(5000,\s*Math\.min\(60000,\s*Number\(process\.env\.PBK_READ_CACHE_COMMUNICATION_IDENTITIES_TTL_MS\s*\|\|\s*60000\)\)\)/,
  /productionMaturity:\s*Math\.max\(5000,\s*Math\.min\(60000,\s*Number\(process\.env\.PBK_READ_CACHE_MATURITY_TTL_MS\s*\|\|\s*60000\)\)\)/,
]) {
  assert.match(bridgeSource, ttlMarker, 'hot read endpoints must default to a 60s cache window.');
}
for (const renderMarker of [
  /PBK_READ_CACHE_AGENT_REGISTRY_TTL_MS[\s\S]*value:\s*"60000"/,
  /PBK_READ_CACHE_COMMUNICATION_IDENTITIES_TTL_MS[\s\S]*value:\s*"60000"/,
  /PBK_READ_CACHE_MATURITY_TTL_MS[\s\S]*value:\s*"60000"/,
]) {
  assert.match(renderYaml, renderMarker, 'Render blueprint must pin hot read cache TTLs to 60s.');
}
assert.match(
  bridgeSource,
  /strategistAttemptBudgetMs:\s*STRATEGIST_PROVIDER\s*===\s*['"]gemini['"]\s*\?\s*GEMINI_LIVE_ATTEMPT_TIMEOUT_MS\s*:\s*DEEPSEEK_LIVE_ATTEMPT_TIMEOUT_MS/,
  'performance status must report the active live LLM attempt timeout constant.'
);
assert.match(
  bridgeSource,
  /strategistTotalBudgetMs:\s*TELNYX_LIVE_REPLY_STRATEGIST_TIMEOUT_MS/,
  'performance status must report the active live strategist total timeout constant.'
);
assert.doesNotMatch(
  bridgeSource,
  /strategistAttemptBudgetMs:\s*Number\(process\.env\.PBK_DEEPSEEK_LIVE_TIMEOUT_MS/,
  'performance status must not read the retired DeepSeek live timeout env name.'
);
assert.ok(
  bridgeSource.includes('sharedRedisClient?.isOpen') &&
    bridgeSource.includes('redisGetCachedReadResponseIfOpen') &&
    bridgeSource.includes('redisSetCachedReadResponseIfOpen'),
  'read endpoint cache must use Redis only when the shared client is already open so cold requests do not block on Redis'
);
assert.ok(
  /persistState\(nextState\)[\s\S]*clearBridgeReadCache\(['"]persist_state['"]\)/.test(bridgeSource),
  'state persistence must invalidate cached status/config responses'
);
for (const cacheMarker of [
  "getCachedReadResponse('production-maturity'",
  "getCachedReadResponse('performance-status'",
  "getCachedReadResponse('agent-orchestration'",
  "getCachedReadResponse('agent-registry'",
  "getCachedReadResponse('agent-measurement'",
  "getCachedReadResponse('agent-health'",
  "getCachedReadResponse('agent-fleet'",
  "getCachedReadResponse('communication-identities'",
  "getCachedReadResponse('system-source-labels'",
  "getCachedReadResponse('production-gaps'",
  "getCachedReadResponse('production-primary-path'",
]) {
  assert.ok(bridgeSource.includes(cacheMarker), `bridge must cache ${cacheMarker}`);
}
assert.ok(
  bridgeSource.includes('normalizeTelnyxMediaCodec') &&
    bridgeSource.includes('session.telnyxMediaCodec') &&
    bridgeSource.includes('decodeG711FrameToLinear16(') &&
    bridgeSource.includes('session.telnyxMediaCodec || DEEPGRAM_STREAM_CODEC'),
  'live-call STT fallback must decode replayed Telnyx frames using the actual media codec from the stream.'
);
assert.doesNotMatch(
  bridgeSource,
  /cacheAtCallStart:\s*true/,
  'live call speed readiness must not hardcode cacheAtCallStart true'
);

console.log(
  JSON.stringify(
    {
      ok: true,
      revision: PERFORMANCE_HARDENING_REVISION,
      circuitCoverage: circuitCoverage.result,
      postgresReadiness: readiness.result,
      outbox: failedOutbox.result,
      loadScenarios: plan.scenarios.length,
    },
    null,
    2
  )
);
