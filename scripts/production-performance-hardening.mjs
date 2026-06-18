import crypto from 'node:crypto';

export const PERFORMANCE_HARDENING_REVISION =
  '2026-06-17-production-performance-hardening-v1';

export const REQUIRED_PROVIDER_CIRCUITS = Object.freeze([
  'deepseek',
  'telnyx',
  'deepgram',
  'elevenlabs',
  'docusign',
  'instantly',
  'slack',
]);

export const REQUIRED_POSTGRES_TABLES = Object.freeze([
  'conversation_threads',
  'conversation_thread_identities',
  'conversation_events',
  'communication_sender_identities',
  'lead_profiles',
  'provider_action_dispatches',
  'activity_log',
]);

export const REQUIRED_POSTGRES_HOT_INDEXES = Object.freeze([
  'conversation_threads_activity_idx',
  'conversation_threads_lead_activity_idx',
  'conversation_identity_lookup_idx',
  'conversation_identity_lead_lookup_idx',
  'conversation_events_thread_occurred_idx',
  'conversation_events_lead_occurred_idx',
  'conversation_events_workspace_channel_occurred_idx',
  'sender_identity_channel_status_idx',
  'provider_action_dispatches_workspace_status_idx',
  'activity_log_lead_created_idx',
]);

const LOAD_SCENARIOS = Object.freeze([
  {
    id: 'bridge-health',
    path: '/health',
    auth: false,
    category: 'bridge',
  },
  {
    id: 'conversation-inbox',
    path: '/api/conversations?limit=5',
    auth: true,
    category: 'inbox',
  },
  {
    id: 'lead-search',
    path: '/api/leads/search?q=test&limit=5',
    auth: true,
    category: 'leads',
  },
  {
    id: 'provider-circuits',
    path: '/api/circuit/status',
    auth: true,
    category: 'observability',
  },
  {
    id: 'production-maturity',
    path: '/api/production/maturity',
    auth: true,
    category: 'observability',
  },
]);

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCode(value = '') {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(clean).filter(Boolean))];
}

function normalizeProvider(value = '') {
  return normalizeCode(value || 'provider');
}

function normalizePhone(value = '') {
  const digits = clean(value).replace(/\D+/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function normalizeRecipient(channel = '', value = '') {
  const type = normalizeCode(channel);
  if (type === 'email') return clean(value).toLowerCase();
  if (type === 'sms' || type === 'call') return normalizePhone(value);
  return clean(value).toLowerCase();
}

function safeDatabaseHost(databaseUrl = '') {
  try {
    return clean(new URL(databaseUrl).hostname);
  } catch {
    return '';
  }
}

function isRawPrivateIpHost(host = '') {
  const normalized = clean(host).toLowerCase();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return false;
  const [a, b] = normalized.split('.').map((part) => Number(part));
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function stableHash(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

export function buildProviderCircuitCoverage({
  circuitStatus = {},
  requiredProviders = REQUIRED_PROVIDER_CIRCUITS,
} = {}) {
  const required = unique(requiredProviders.map(normalizeProvider));
  const statuses = Array.isArray(circuitStatus.statuses) ? circuitStatus.statuses : [];
  const statusByProvider = new Map(
    statuses
      .map((status) => [normalizeProvider(status.provider), { ...status, provider: normalizeProvider(status.provider) }])
      .filter(([provider]) => provider)
  );
  const missingProviders = required.filter((provider) => !statusByProvider.has(provider));
  const openProviders = required.filter((provider) => statusByProvider.get(provider)?.state === 'open');
  const degradedProviders = required.filter((provider) =>
    ['open', 'half_open'].includes(String(statusByProvider.get(provider)?.state || '').toLowerCase())
  );
  return {
    ok: true,
    ready: missingProviders.length === 0 && openProviders.length === 0,
    result:
      missingProviders.length || openProviders.length
        ? 'provider_circuit_coverage_review'
        : 'provider_circuit_coverage_ready',
    revision: PERFORMANCE_HARDENING_REVISION,
    requiredProviders: required,
    missingProviders,
    openProviders,
    degradedProviders,
    statuses: required.map((provider) => statusByProvider.get(provider) || { provider, state: 'missing' }),
  };
}

export function buildPostgresPerformanceReadiness({
  connection = {},
  requiredTables = REQUIRED_POSTGRES_TABLES,
  requiredIndexes = REQUIRED_POSTGRES_HOT_INDEXES,
  tableRows = [],
  indexRows = [],
} = {}) {
  const requiredTableNames = unique(requiredTables);
  const requiredIndexNames = unique(requiredIndexes);
  const tableExists = new Map(
    (Array.isArray(tableRows) ? tableRows : []).map((row) => [
      clean(row.table_name || row.tableName || row.name),
      row.exists !== false && row.exists !== 'false',
    ])
  );
  const existingIndexes = new Set(
    (Array.isArray(indexRows) ? indexRows : [])
      .map((row) => clean(row.index_name || row.indexName || row.name))
      .filter(Boolean)
  );
  const missingTables = requiredTableNames.filter((tableName) => tableExists.get(tableName) !== true);
  const missingIndexes = requiredIndexNames.filter((indexName) => !existingIndexes.has(indexName));
  const host = clean(connection.host || safeDatabaseHost(connection.databaseUrl));
  const usesRawPrivateIp = isRawPrivateIpHost(host);
  const blockers = [
    ...(connection.ok === false || connection.ready === false ? ['postgres_connection'] : []),
    ...(usesRawPrivateIp ? ['postgres_url_raw_private_ip'] : []),
    ...missingTables.map((table) => `missing_table:${table}`),
    ...missingIndexes.map((index) => `missing_index:${index}`),
  ];
  return {
    ok: true,
    ready: blockers.length === 0,
    result: blockers.length ? 'postgres_performance_review' : 'postgres_performance_ready',
    revision: PERFORMANCE_HARDENING_REVISION,
    connection: {
      configured: Boolean(connection.configured ?? true),
      ready: connection.ok !== false && connection.ready !== false,
      status: connection.status || (connection.ok === false || connection.ready === false ? 'unavailable' : 'up'),
      host,
      poolMax: connection.poolMax ?? null,
      connectionTimeoutMs: connection.connectionTimeoutMs ?? null,
      transientGraceActive: Boolean(connection.transientGraceActive),
      error: clean(connection.error || ''),
    },
    usesRawPrivateIp,
    blockers,
    missingTables,
    missingIndexes,
    requiredTables: requiredTableNames,
    requiredIndexes: requiredIndexNames,
  };
}

export function deriveManualSendIdempotencyKey({
  channel = 'sms',
  leadId = '',
  recipient = '',
  body = '',
  subject = '',
  requestedBy = '',
} = {}) {
  const normalizedChannel = normalizeCode(channel || 'message') || 'message';
  const normalizedRecipient = normalizeRecipient(normalizedChannel, recipient);
  const payload = JSON.stringify({
    channel: normalizedChannel,
    leadId: clean(leadId),
    recipient: normalizedRecipient,
    subject: clean(subject).toLowerCase(),
    body: clean(body),
    requestedBy: clean(requestedBy).toLowerCase(),
  });
  return `manual-send:${normalizedChannel}:${stableHash(payload)}`;
}

export function buildManualSendOutboxEnvelope({
  channel = 'sms',
  provider = '',
  status = 'queued',
  idempotencyKey = '',
  leadId = '',
  recipient = '',
  error = '',
  providerResult = null,
  queuedAt = new Date().toISOString(),
  sentAt = '',
  retryAfterMs = 30_000,
} = {}) {
  const normalizedStatus = normalizeCode(status || 'queued');
  const failure = ['failed', 'provider_missing', 'provider_error', 'conflict', 'retryable'].includes(
    normalizedStatus
  );
  const sent = ['sent', 'succeeded', 'live', 'queued_by_provider'].includes(normalizedStatus);
  const retryable =
    failure ||
    /timeout|econn|rate|429|409|conflict|temporar|retry/i.test(clean(error || providerResult?.error || ''));
  return {
    ok: sent || normalizedStatus === 'queued' || normalizedStatus === 'sending',
    result: sent
      ? 'manual_send_outbox_sent'
      : failure
        ? 'manual_send_outbox_failed'
        : 'manual_send_outbox_queued',
    revision: PERFORMANCE_HARDENING_REVISION,
    channel: normalizeCode(channel || 'message'),
    provider: normalizeProvider(provider || channel || 'provider'),
    status: sent ? 'sent' : failure ? 'failed' : normalizedStatus,
    timelineStatus: sent ? 'sent' : failure ? 'failed' : normalizedStatus,
    idempotencyKey: clean(idempotencyKey),
    leadId: clean(leadId),
    recipient: clean(recipient),
    queuedAt,
    sentAt: sentAt || (sent ? new Date().toISOString() : ''),
    retryable,
    retryAfterMs: retryable ? retryAfterMs : 0,
    operatorVisible: true,
    error: clean(error || providerResult?.error || ''),
    providerResult: providerResult && typeof providerResult === 'object' ? providerResult : null,
  };
}

export function buildLoadScenarioPlan({
  baseUrl = 'https://pbk-openclaw-bridge.onrender.com',
  concurrency = 50,
  scenarios = LOAD_SCENARIOS,
} = {}) {
  const safeConcurrency = Math.max(1, Math.min(250, Number(concurrency || 50)));
  const normalizedBaseUrl = clean(baseUrl).replace(/\/+$/g, '');
  const rows = (Array.isArray(scenarios) ? scenarios : LOAD_SCENARIOS).map((scenario) => ({
    id: clean(scenario.id),
    path: clean(scenario.path),
    auth: Boolean(scenario.auth),
    category: clean(scenario.category || 'bridge'),
    method: clean(scenario.method || 'GET').toUpperCase(),
  }));
  return {
    ok: true,
    ready: Boolean(normalizedBaseUrl) && rows.length >= 4,
    result: rows.length >= 4 ? 'load_scenario_plan_ready' : 'load_scenario_plan_incomplete',
    revision: PERFORMANCE_HARDENING_REVISION,
    baseUrl: normalizedBaseUrl,
    concurrency: safeConcurrency,
    scenarios: rows,
    note: 'Read-only load scenarios. They do not place calls, send SMS/email, or touch contracts.',
  };
}

export function buildLiveCallSpeedBudget({
  contractTargetMs = 100,
  strategistAttemptBudgetMs = 1800,
  strategistTotalBudgetMs = 3000,
  duplicateSuppression = true,
  cacheAtCallStart = true,
} = {}) {
  const attempt = Number(strategistAttemptBudgetMs || 0);
  const total = Number(strategistTotalBudgetMs || 0);
  const blockers = [
    ...(Number(contractTargetMs || 0) > 100 ? ['turn_contract_over_100ms'] : []),
    ...(attempt > 2200 ? ['strategist_attempt_budget_too_high'] : []),
    ...(total > 4500 ? ['strategist_total_budget_too_high'] : []),
    ...(duplicateSuppression ? [] : ['transcript_deduplication_missing']),
    ...(cacheAtCallStart ? [] : ['call_start_cache_missing']),
  ];
  return {
    ok: true,
    ready: blockers.length === 0,
    result: blockers.length ? 'live_call_speed_review' : 'live_call_speed_ready',
    revision: PERFORMANCE_HARDENING_REVISION,
    contractTargetMs: Number(contractTargetMs || 0),
    strategistAttemptBudgetMs: attempt,
    strategistTotalBudgetMs: total,
    duplicateSuppression: Boolean(duplicateSuppression),
    cacheAtCallStart: Boolean(cacheAtCallStart),
    blockers,
  };
}

export function buildPerformanceStatusSnapshot({
  postgres,
  providerCircuits,
  loadPlan,
  liveCallSpeed,
  outboxPolicy = {},
} = {}) {
  const blockers = [
    ...(postgres?.ready ? [] : ['postgres_performance']),
    ...(providerCircuits?.ready ? [] : ['provider_circuits']),
    ...(loadPlan?.ready ? [] : ['load_scenarios']),
    ...(liveCallSpeed?.ready ? [] : ['live_call_speed']),
  ];
  return {
    ok: true,
    ready: blockers.length === 0,
    result: blockers.length ? 'performance_hardening_review' : 'performance_hardening_ready',
    revision: PERFORMANCE_HARDENING_REVISION,
    checkedAt: new Date().toISOString(),
    blockers,
    postgres,
    providerCircuits,
    loadPlan,
    liveCallSpeed,
    outboxPolicy: {
      ready: outboxPolicy.ready !== false,
      required: ['write_outbox_before_provider', 'idempotency_key', 'operator_visible_failure', 'retry_envelope'],
      ...outboxPolicy,
    },
  };
}
