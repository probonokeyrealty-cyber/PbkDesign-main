export const PRODUCTION_READINESS_COMMAND_LAYER_REVISION =
  '2026-06-13-production-readiness-command-layer-v1';

const DEFAULT_SLO_TARGETS = {
  bridgeHealth: { kind: 'success_rate', targetPercent: 99.9 },
  manualSend: { kind: 'success_rate', targetPercent: 99.5 },
  leadIdentityResolution: { kind: 'success_rate', targetPercent: 99.9 },
  providerTimelineProjection: { kind: 'success_rate', targetPercent: 99.9 },
  docusignTraceability: { kind: 'success_rate', targetPercent: 100 },
  avaLiveResponse: { kind: 'latency_p95', targetMs: 1800 },
  avaRepeatComplaint: { kind: 'rate', targetPercent: 2 },
};

const ACTION_SLO_MAP = {
  send_sms: 'manualSend',
  send_email: 'manualSend',
  send_contract: 'docusignTraceability',
  send_docusign: 'docusignTraceability',
  prepare_and_send_contract: 'docusignTraceability',
  timeline_projection: 'providerTimelineProjection',
  lead_identity_resolution: 'leadIdentityResolution',
};

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function unique(values = []) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function normalizeActionType(value = '') {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function isReady(value = {}) {
  return Boolean(
    value?.ready === true ||
      value?.status === 'up' ||
      value?.status === 'live' ||
      value?.ok === true ||
      value?.productionReady === true
  );
}

function percentile(values = [], percentileValue = 0.95) {
  const numeric = asArray(values)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numeric.length) return 0;
  const index = Math.min(
    numeric.length - 1,
    Math.max(0, Math.ceil(numeric.length * percentileValue) - 1)
  );
  return numeric[index];
}

function buildCounterMetric(record = {}, target = {}) {
  const successes = Number(record.successes || 0);
  const failures = Number(record.failures || 0);
  const total = successes + failures;
  const successRate = total ? (successes / total) * 100 : 100;
  const targetPercent = Number(target.targetPercent ?? 99.9);
  return {
    kind: 'success_rate',
    targetPercent,
    successes,
    failures,
    total,
    successRate: Number(successRate.toFixed(4)),
    errorBudgetRemainingPercent: Number(Math.max(0, successRate - targetPercent).toFixed(4)),
    burned: total > 0 && successRate < targetPercent,
    lastFailure: record.lastFailure || '',
    lastUpdatedAt: record.lastUpdatedAt || '',
  };
}

function buildLatencyMetric(values = [], target = {}) {
  const p95Ms = percentile(values, 0.95);
  const targetMs = Number(target.targetMs ?? 1800);
  return {
    kind: 'latency_p95',
    targetMs,
    samples: values.length,
    p95Ms,
    burned: values.length > 0 && p95Ms > targetMs,
  };
}

function buildRateMetric(record = {}, target = {}) {
  const count = Number(record.count || 0);
  const total = Number(record.total || 0);
  const rate = total ? (count / total) * 100 : 0;
  const targetPercent = Number(target.targetPercent ?? 2);
  return {
    kind: 'rate',
    targetPercent,
    count,
    total,
    rate: Number(rate.toFixed(4)),
    burned: total > 0 && rate > targetPercent,
    lastUpdatedAt: record.lastUpdatedAt || '',
  };
}

export function createProductionReadinessMonitor({
  now = () => Date.now(),
  targets = DEFAULT_SLO_TARGETS,
  maxLatencySamples = 1000,
} = {}) {
  const counters = new Map();
  const latencies = new Map();
  const rates = new Map();

  function getCounter(category) {
    const key = clean(category);
    if (!counters.has(key)) {
      counters.set(key, {
        successes: 0,
        failures: 0,
        lastFailure: '',
        lastUpdatedAt: '',
      });
    }
    return counters.get(key);
  }

  function recordSuccess(category) {
    const record = getCounter(category);
    record.successes += 1;
    record.lastUpdatedAt = new Date(now()).toISOString();
  }

  function recordFailure(category, error = '') {
    const record = getCounter(category);
    record.failures += 1;
    record.lastFailure = error?.message || clean(error) || 'failure';
    record.lastUpdatedAt = new Date(now()).toISOString();
  }

  function recordLatency(category, ms) {
    const key = clean(category);
    if (!latencies.has(key)) latencies.set(key, []);
    const values = latencies.get(key);
    values.push(Math.max(0, Number(ms) || 0));
    if (values.length > maxLatencySamples) values.splice(0, values.length - maxLatencySamples);
  }

  function recordRateEvent(category, { failed = false } = {}) {
    const key = clean(category);
    if (!rates.has(key)) {
      rates.set(key, { count: 0, total: 0, lastUpdatedAt: '' });
    }
    const record = rates.get(key);
    record.total += 1;
    if (failed) record.count += 1;
    record.lastUpdatedAt = new Date(now()).toISOString();
  }

  function getSloStatus() {
    const metrics = {};
    for (const [category, target] of Object.entries(targets)) {
      if (target.kind === 'latency_p95') {
        metrics[category] = buildLatencyMetric(latencies.get(category) || [], target);
      } else if (target.kind === 'rate') {
        metrics[category] = buildRateMetric(rates.get(category) || {}, target);
      } else {
        metrics[category] = buildCounterMetric(counters.get(category) || {}, target);
      }
    }
    const burned = Object.entries(metrics)
      .filter(([, value]) => value.burned)
      .map(([key]) => key);
    return {
      ok: true,
      result: burned.length ? 'slo_budget_burn_observed' : 'slo_budget_within_policy',
      revision: PRODUCTION_READINESS_COMMAND_LAYER_REVISION,
      generatedAt: new Date(now()).toISOString(),
      burned,
      metrics,
    };
  }

  return {
    recordSuccess,
    recordFailure,
    recordLatency,
    recordRateEvent,
    getSloStatus,
  };
}

export function createIdempotencyStore({
  now = () => Date.now(),
  ttlMs = 24 * 60 * 60 * 1000,
} = {}) {
  const store = new Map();

  function prune() {
    const current = now();
    for (const [key, value] of store.entries()) {
      if (value.expiresAt <= current) store.delete(key);
    }
  }

  return {
    get(key = '') {
      prune();
      const id = clean(key);
      if (!id) return null;
      return store.get(id)?.value || null;
    },
    set(key = '', value = {}) {
      prune();
      const id = clean(key);
      if (!id) return null;
      const entry = {
        value,
        storedAt: now(),
        expiresAt: now() + ttlMs,
      };
      store.set(id, entry);
      return entry.value;
    },
    status() {
      prune();
      return {
        ok: true,
        result: 'idempotency_store_ready',
        count: store.size,
        ttlMs,
      };
    },
    clear() {
      store.clear();
    },
  };
}

function resolveSloCategory(actionType = '') {
  const action = normalizeActionType(actionType);
  return ACTION_SLO_MAP[action] || action || 'manualSend';
}

export async function executeIdempotentAction({
  actionType = 'action',
  idempotencyKey = '',
  idempotency,
  truthGate = null,
  monitor = null,
  execute,
  projectTimeline = null,
  now = () => Date.now(),
} = {}) {
  if (!idempotency || typeof idempotency.get !== 'function' || typeof idempotency.set !== 'function') {
    throw new TypeError('executeIdempotentAction requires an idempotency store.');
  }
  if (typeof execute !== 'function') {
    throw new TypeError('executeIdempotentAction requires an execute function.');
  }
  const key = clean(idempotencyKey);
  const category = resolveSloCategory(actionType);
  const existing = key ? idempotency.get(key) : null;
  if (existing) {
    return {
      ...existing,
      idempotentReplay: true,
    };
  }

  if (truthGate && truthGate.ready === false) {
    monitor?.recordFailure?.(category, 'truth_gate_blocked');
    return {
      ok: false,
      result: 'truth_gate_blocked',
      actionType: normalizeActionType(actionType),
      idempotencyKey: key,
      providerAttempted: false,
      blockers: truthGate.blockers || [],
      warnings: truthGate.warnings || [],
      truthGate,
      idempotentReplay: false,
      completedAt: new Date(now()).toISOString(),
    };
  }

  const startedAt = now();
  try {
    const result = await execute();
    const timeline =
      typeof projectTimeline === 'function' ? await projectTimeline(result) : null;
    const envelope = {
      ok: result?.ok !== false,
      result,
      timeline,
      actionType: normalizeActionType(actionType),
      idempotencyKey: key,
      providerAttempted: true,
      truthGate,
      idempotentReplay: false,
      completedAt: new Date(now()).toISOString(),
    };
    if (key) idempotency.set(key, envelope);
    if (envelope.ok) monitor?.recordSuccess?.(category);
    else monitor?.recordFailure?.(category, result?.error || result?.result || 'provider_failed');
    monitor?.recordLatency?.(category, now() - startedAt);
    return envelope;
  } catch (error) {
    monitor?.recordFailure?.(category, error);
    monitor?.recordLatency?.(category, now() - startedAt);
    return {
      ok: false,
      result: 'action_execution_failed',
      actionType: normalizeActionType(actionType),
      idempotencyKey: key,
      providerAttempted: true,
      error: error?.message || String(error),
      truthGate,
      idempotentReplay: false,
      completedAt: new Date(now()).toISOString(),
    };
  }
}

function hasLeadIdentity(identity = {}) {
  return Boolean(
    clean(identity.leadId || identity.lead_id || identity.id) ||
      clean(identity.normalizedPhone || identity.phone) ||
      clean(identity.normalizedEmail || identity.email)
  );
}

function actionRequiresConversation(actionType = '') {
  return ['send_sms', 'send_email', 'send_contract', 'send_docusign', 'prepare_and_send_contract'].includes(
    normalizeActionType(actionType)
  );
}

function actionRequiresIdentity(actionType = '') {
  return [
    'send_sms',
    'send_email',
    'start_call',
    'telnyx_call',
    'send_contract',
    'send_docusign',
    'prepare_and_send_contract',
    'analyze_deal',
    'update_lead',
  ].includes(normalizeActionType(actionType));
}

function actionRequiresSender(actionType = '') {
  return ['send_sms', 'send_email'].includes(normalizeActionType(actionType));
}

function providerReadyForAction(actionType = '', providers = {}) {
  const action = normalizeActionType(actionType);
  if (action === 'send_sms') {
    const telnyx = providers.telnyx || {};
    return Boolean(telnyx.messagingReady || telnyx.ready);
  }
  if (action === 'start_call' || action === 'telnyx_call') {
    const telnyx = providers.telnyx || {};
    return Boolean(telnyx.voiceReady || telnyx.ready);
  }
  if (action === 'send_email') {
    const instantly = providers.instantly || providers.email || {};
    return Boolean(instantly.ready || instantly.configured);
  }
  if (['send_contract', 'send_docusign', 'prepare_and_send_contract'].includes(action)) {
    const docusign = providers.docusign || {};
    return Boolean(docusign.productionReady || docusign.ready);
  }
  return true;
}

function providerBlockerForAction(actionType = '') {
  const action = normalizeActionType(actionType);
  if (action === 'send_sms') return 'telnyx_messaging_unavailable';
  if (action === 'start_call' || action === 'telnyx_call') return 'telnyx_voice_unavailable';
  if (action === 'send_email') return 'email_provider_unavailable';
  if (['send_contract', 'send_docusign', 'prepare_and_send_contract'].includes(action)) {
    return 'docusign_unavailable';
  }
  return 'provider_unavailable';
}

export function buildProductionTruthGate({
  runtimeMeta = {},
  identity = {},
  conversation = {},
  memory = {},
  skills = {},
  turnContract = {},
  senderIdentity = null,
  providers = {},
  actionType = '',
  requireIdentity = null,
  requireMemory = false,
  requireSkills = true,
  requireTurnContract = true,
  requireConversation = null,
} = {}) {
  const blockers = [];
  const warnings = [];
  const action = normalizeActionType(actionType);

  if (runtimeMeta.hosted && runtimeMeta.stateBackend !== 'postgres') {
    blockers.push('hosted_state_backend_not_postgres');
  }
  if (runtimeMeta.productionReady === false) {
    warnings.push('runtime_not_marked_production_ready');
  }
  const needsIdentity = typeof requireIdentity === 'boolean' ? requireIdentity : actionRequiresIdentity(action);
  if (needsIdentity && !hasLeadIdentity(identity)) {
    blockers.push('lead_identity_missing');
  }
  const needsConversation =
    typeof requireConversation === 'boolean' ? requireConversation : actionRequiresConversation(action);
  if (needsConversation && !clean(conversation.threadId || conversation.thread_id || conversation.id)) {
    blockers.push('conversation_thread_missing');
  }
  if (requireMemory && memory.ready === false) {
    blockers.push('memory_not_ready');
  } else if (memory.ready === false) {
    warnings.push('memory_not_ready');
  }
  if (requireSkills && !(skills.ready || asArray(skills.active).length)) {
    blockers.push('active_skills_missing');
  }
  if (requireTurnContract && turnContract.ok === false) {
    blockers.push('turn_contract_unavailable');
  }
  if (actionRequiresSender(action) && !senderIdentity) {
    blockers.push('sender_identity_missing');
  }
  if (senderIdentity && String(senderIdentity.healthStatus || senderIdentity.lifecycleStatus || '').toLowerCase() === 'retired') {
    blockers.push('sender_identity_retired');
  }
  if (!providerReadyForAction(action, providers)) {
    blockers.push(providerBlockerForAction(action));
  }

  return {
    ok: true,
    ready: blockers.length === 0,
    result: blockers.length ? 'production_truth_blocked' : 'production_truth_ready',
    revision: PRODUCTION_READINESS_COMMAND_LAYER_REVISION,
    checkedAt: new Date().toISOString(),
    actionType: action,
    blockers: unique(blockers),
    warnings: unique(warnings),
    facts: {
      leadIdentity: hasLeadIdentity(identity),
      leadIdentityRequired: needsIdentity,
      conversationThread: Boolean(clean(conversation.threadId || conversation.thread_id || conversation.id)),
      memoryReady: Boolean(memory.ready),
      skillsReady: Boolean(skills.ready || asArray(skills.active).length),
      turnContractReady: turnContract.ok !== false,
      senderIdentityReady: !actionRequiresSender(action) || Boolean(senderIdentity),
      providerReady: providerReadyForAction(action, providers),
    },
  };
}

function normalizeToolCatalog(toolCatalog = {}) {
  if (Array.isArray(toolCatalog)) {
    return Object.fromEntries(toolCatalog.map((tool) => [clean(tool), true]).filter(([tool]) => tool));
  }
  return toolCatalog && typeof toolCatalog === 'object' ? toolCatalog : {};
}

export function buildAgentCapabilityReadiness({
  agents = [],
  toolCatalog = {},
  intelligenceContext = {},
  latencySamples = {},
  lastActions = {},
  requireIntelligenceContext = true,
} = {}) {
  const catalog = normalizeToolCatalog(toolCatalog);
  const normalizedAgents = asArray(agents).map((agent) => {
    const id = clean(agent.id || agent.agentId || agent.name).toLowerCase();
    const requiredTools = unique(agent.requiredTools || agent.metadata?.requiredTools || []);
    const missingTools = requiredTools.filter((tool) => !catalog[tool]);
    const samples = asArray(latencySamples[id]).map(Number).filter(Number.isFinite);
    const lastAction = lastActions[id] || null;
    const contextReady = {
      memory: Boolean(intelligenceContext.memory?.ready),
      skills: Boolean(intelligenceContext.skills?.ready),
      dataFreshness: Boolean(intelligenceContext.dataFreshness?.ready),
      fleet: Boolean(intelligenceContext.fleetReadiness?.ready),
    };
    const contextKnown = {
      memory: intelligenceContext.memory?.ready !== undefined,
      skills: intelligenceContext.skills?.ready !== undefined,
      dataFreshness: intelligenceContext.dataFreshness?.ready !== undefined,
      fleet: intelligenceContext.fleetReadiness?.ready !== undefined,
    };
    const blockedReasons = [
      ...missingTools.map((tool) => `missing_tool:${tool}`),
      ...Object.entries(contextReady)
        .filter(([key, ready]) => requireIntelligenceContext && contextKnown[key] && !ready)
        .map(([key]) => `${key}_not_ready`),
    ];
    const ready = blockedReasons.length === 0;
    return {
      ...agent,
      id,
      capability: {
        ready,
        result: ready ? 'agent_capability_ready' : 'agent_capability_degraded',
        requiredTools,
        missingTools,
        contextReady,
        contextKnown,
        latencyP95Ms: percentile(samples, 0.95),
        lastSuccess: lastAction?.status === 'success' ? lastAction.at || lastAction.completedAt || '' : '',
        lastFailure: lastAction?.status === 'failure' ? lastAction.at || lastAction.completedAt || '' : '',
        blockedReason: blockedReasons[0] || '',
        blockedReasons,
      },
    };
  });
  const degraded = normalizedAgents.filter((agent) => agent.capability.ready === false);
  return {
    ok: true,
    ready: degraded.length === 0,
    result: degraded.length ? 'agent_capability_degraded' : 'agent_capability_ready',
    revision: PRODUCTION_READINESS_COMMAND_LAYER_REVISION,
    generatedAt: new Date().toISOString(),
    total: normalizedAgents.length,
    readyCount: normalizedAgents.length - degraded.length,
    degraded: degraded.map((agent) => ({
      id: agent.id,
      blockedReasons: agent.capability.blockedReasons,
    })),
    agents: normalizedAgents,
  };
}

export function buildBridgeConnectionStatus({
  runtimeMeta = {},
  health = {},
  requiredComponents = ['bridge', 'postgres', 'agentOrchestration'],
} = {}) {
  const components = health.components || {};
  const blockers = [];
  if (runtimeMeta.hosted && !runtimeMeta.authRequired) blockers.push('hosted_auth_not_required');
  if (runtimeMeta.hosted && runtimeMeta.stateBackend !== 'postgres') {
    blockers.push('hosted_state_backend_not_postgres');
  }
  if (runtimeMeta.productionReady === false) blockers.push('runtime_not_production_ready');
  for (const component of requiredComponents) {
    if (!isReady(components[component])) blockers.push(`${component}_not_ready`);
  }
  return {
    ok: true,
    ready: blockers.length === 0,
    result: blockers.length ? 'bridge_connection_degraded' : 'bridge_connection_ready',
    revision: PRODUCTION_READINESS_COMMAND_LAYER_REVISION,
    checkedAt: new Date().toISOString(),
    blockers,
    stateBackend: runtimeMeta.stateBackend || '',
    hosted: Boolean(runtimeMeta.hosted),
    authRequired: Boolean(runtimeMeta.authRequired),
    productionReady: Boolean(runtimeMeta.productionReady),
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [
        key,
        {
          ready: isReady(value),
          status: value?.status || '',
          note: value?.note || '',
        },
      ])
    ),
  };
}
