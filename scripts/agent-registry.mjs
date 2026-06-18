import { createHash } from 'node:crypto';

const REQUIRED_AGENT_IDS = [
  'ava',
  'max',
  'rex',
  'hermes',
  'call-analyzer',
  'prosody-tuner',
  'script-rotator',
  'bant-enforcer',
  'qa-agent',
  'nurture-agent',
  'research-orchestrator',
];
const LOCAL_BRIDGE_INVOKE_ENDPOINT = '/invoke';
const ROUTABLE_AGENT_STATUSES = new Set(['active', 'standby']);
const DEFAULT_REMOTE_TIMEOUT_MS = 30000;
const EXTERNAL_AGENT_ENV_ALIASES = {
  ava: ['PBK_EXTERNAL_AGENT_AVA'],
  max: ['PBK_EXTERNAL_AGENT_MAX'],
  rex: ['PBK_EXTERNAL_AGENT_REX'],
  hermes: ['PBK_EXTERNAL_AGENT_HERMES'],
  'call-analyzer': ['PBK_EXTERNAL_AGENT_ANALYZER', 'PBK_EXTERNAL_AGENT_CALL_ANALYZER'],
  'prosody-tuner': ['PBK_EXTERNAL_AGENT_PROSODY', 'PBK_EXTERNAL_AGENT_PROSODY_TUNER'],
  'script-rotator': ['PBK_EXTERNAL_AGENT_SCRIPT', 'PBK_EXTERNAL_AGENT_SCRIPT_ROTATOR'],
  'bant-enforcer': ['PBK_EXTERNAL_AGENT_BANT', 'PBK_EXTERNAL_AGENT_BANT_ENFORCER'],
  'qa-agent': ['PBK_EXTERNAL_AGENT_QA', 'PBK_EXTERNAL_AGENT_QA_AGENT'],
  'nurture-agent': ['PBK_EXTERNAL_AGENT_NURTURE', 'PBK_EXTERNAL_AGENT_NURTURE_AGENT'],
  'research-orchestrator': ['PBK_EXTERNAL_AGENT_RESEARCH', 'PBK_EXTERNAL_AGENT_RESEARCH_ORCHESTRATOR'],
};

const AGENT_REQUIRED_TOOLS = {
  ava: ['runAgentCommand', 'getAvaConversationIntelligence', 'analyzeDeal', 'createApproval'],
  max: ['runAgentCommand', 'analyzeDeal', 'prepareContract', 'sendSellerDocs'],
  rex: ['getBrainState', 'createRexDecision', 'queryPbkKnowledge', 'launchBrowserResearch'],
  hermes: ['askStrategist', 'avaAskStrategist', 'recordPbkFeedback'],
  'call-analyzer': ['scoreCallQuality', 'recordSkillOutcome'],
  'prosody-tuner': ['getProsodyAdvice', 'trainEmotionWorldModel'],
  'script-rotator': ['selectContextAwareScript', 'retrieveClosingIntelligence', 'recordContextAwareScriptOutcome'],
  'bant-enforcer': ['classifyParticipant', 'getParticipantProfile', 'getAvaConversationIntelligence'],
  'qa-agent': ['validateProviderActionSafety', 'getObservabilityStatus', 'createApproval'],
  'nurture-agent': ['consultNurtureAgent', 'startNurtureSequence', 'processDueNurtureSteps'],
  'research-orchestrator': [
    'runProviderAugmentedAdditiveIntelligence',
    'evaluateStoppingAgent',
    'discoverExternalTool',
    'compactLongHorizonMemory',
    'induceWorkflowMemory',
  ],
};

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

export function normalizeAgentRegistryId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function percentile(values = [], percentileValue = 0.95) {
  const numeric = (Array.isArray(values) ? values : [values])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!numeric.length) return 0;
  const index = Math.min(
    numeric.length - 1,
    Math.max(0, Math.ceil(numeric.length * percentileValue) - 1)
  );
  return numeric[index];
}

function normalizeToolCatalog(toolCatalog = {}) {
  if (Array.isArray(toolCatalog)) {
    return Object.fromEntries(uniqueStrings(toolCatalog).map((tool) => [tool, true]));
  }
  return toolCatalog && typeof toolCatalog === 'object' ? toolCatalog : {};
}

function checksumAgentSnapshotPayload(snapshot = {}) {
  return createHash('sha256')
    .update(
      stableJson({
        schemaVersion: Number(snapshot.schemaVersion || 1),
        workspaceId: snapshot.workspaceId || 'pbk',
        environment: snapshot.environment || 'production',
        authority: snapshot.authority || 'pbk-agent-registry',
        agents: Array.isArray(snapshot.agents) ? snapshot.agents : [],
        requiredIds: Array.isArray(snapshot.requiredIds) ? snapshot.requiredIds : [],
      })
    )
    .digest('hex');
}

function buildExternalAgentEnvKeys(agent = {}) {
  const id = normalizeAgentRegistryId(agent.id || agent.name);
  const generic = id ? `PBK_EXTERNAL_AGENT_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}` : '';
  return uniqueStrings([EXTERNAL_AGENT_ENV_ALIASES[id] || [], generic]);
}

function getExternalAgentEndpoint(agent = {}, env = process.env) {
  for (const key of buildExternalAgentEnvKeys(agent)) {
    const endpoint = String(env?.[key] || '').trim();
    if (/^https?:\/\//i.test(endpoint)) return endpoint.replace(/\/+$/, '');
  }
  return '';
}

export function applyExternalAgentEndpointOverrides(registry = [], env = process.env) {
  return (Array.isArray(registry) ? registry : []).map((agent) => {
    const endpoint = getExternalAgentEndpoint(agent, env);
    if (!endpoint) return agent;
    const metadata = agent.metadata && typeof agent.metadata === 'object' ? agent.metadata : {};
    return {
      ...agent,
      endpoint,
      metadata: {
        ...metadata,
        local: false,
        remote: true,
        communication: 'pbk-remote-agent',
        endpointSource: buildExternalAgentEnvKeys(agent).find((key) => String(env?.[key] || '').trim() === endpoint) || 'env',
      },
    };
  });
}

export function buildDefaultAgentRegistry({ now = Date.now(), env = process.env } = {}) {
  const activeAt = new Date(now).toISOString();
  const agents = [
    {
      id: 'ava',
      name: 'Ava',
      description: 'Primary PBK acquisition closer and voice supervisor.',
      capabilities: [
        'voice',
        'negotiation',
        'closing',
        'bant',
        'path_locking',
        'rag',
        'memory_retrieval',
        'turn_coordination',
      ],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v2.1',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'supervisor',
        supervises: ['max', 'rex', 'hermes'],
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS.ava,
      },
    },
    {
      id: 'max',
      name: 'Max',
      description:
        'PBK closer and contract handoff agent for offer recap, seller follow-up, and approval-gated contract delivery.',
      capabilities: [
        'closing',
        'contract_handoff',
        'offer_recap',
        'seller_follow_up',
        'sms',
        'calling',
        'skill_execution',
      ],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.4',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'ava',
        approvalGated: true,
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS.max,
      },
    },
    {
      id: 'rex',
      name: 'Rex',
      description:
        'PBK strategist, research, autonomous goals, proactive triggers, revenue alignment, and memory agent.',
      capabilities: [
        'strategy',
        'research',
        'revenue_alignment',
        'autonomous_goal_setting',
        'proactive_triggers',
        'market_intel',
        'rex_decisions',
        'memory_synthesis',
      ],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v3.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'ava',
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS.rex,
      },
    },
    {
      id: 'hermes',
      name: 'Hermes',
      description: 'Suggest-only analyst lane for transcript, feedback, and pattern diagnosis.',
      capabilities: [
        'analysis',
        'suggestions',
        'feedback_review',
        'risk_review',
        'pattern_detection',
      ],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'ava',
        suggestOnly: true,
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS.hermes,
      },
    },
    {
      id: 'call-analyzer',
      name: 'Call Analyzer',
      description:
        'Reviews Ava call transcripts, scores quality, tags failures, and proposes improvements.',
      capabilities: ['analysis', 'post_call', 'quality_scoring', 'failure_tags', 'coaching'],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'rex',
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS['call-analyzer'],
      },
    },
    {
      id: 'prosody-tuner',
      name: 'Prosody Tuner',
      description: 'Builds and evaluates Ava voice stability, speed, emotion, and prosody choices.',
      capabilities: ['voice_tuning', 'prosody', 'emotion', 'ml', 'tts_quality'],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'rex',
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS['prosody-tuner'],
      },
    },
    {
      id: 'script-rotator',
      name: 'Script Rotator',
      description:
        'Selects and rotates scripts, trust builders, objections, and war-manual lines using sentiment, objection history, and measured outcomes.',
      capabilities: [
        'script_management',
        'context_aware_rotation',
        'ab_testing',
        'objection_handling',
        'trust_builders',
        'war_manual',
        'anti_repeat',
      ],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'ava',
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS['script-rotator'],
      },
    },
    {
      id: 'bant-enforcer',
      name: 'BANT Enforcer',
      description:
        'Tracks budget, authority, need, timeline, urgency, and call qualification completeness.',
      capabilities: [
        'qualification',
        'bant',
        'goal_inference',
        'clarifying_questions',
        'path_locking',
      ],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'ava',
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS['bant-enforcer'],
      },
    },
    {
      id: 'qa-agent',
      name: 'QA Agent',
      description: 'Validates tool outputs, audits provider proof, and escalates silent failures.',
      capabilities: ['qa', 'tool_validation', 'audit', 'approval_escalation', 'reliability'],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'rex',
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS['qa-agent'],
      },
    },
    {
      id: 'nurture-agent',
      name: 'Nurture Agent',
      description:
        'Recommends and manages approval-gated SMS, email, and call follow-up sequences for warm and hot leads.',
      capabilities: [
        'nurture',
        'campaigns',
        'follow_up',
        'sms',
        'email',
        'calling',
        'scheduling',
        'reply_handling',
      ],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'ava',
        approvalGated: true,
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS['nurture-agent'],
      },
    },
    {
      id: 'research-orchestrator',
      name: 'Research Orchestrator',
      description:
        'Coordinates PBK research additives: ACP-style interop, path search, workflow induction, compact memory, stopping-agent checks, tool discovery, and gated desktop/L4 planning.',
      capabilities: [
        'research_additives',
        'agent_interop',
        'execution_path_search',
        'workflow_induction',
        'tool_discovery',
        'stopping_guardrails',
        'compact_memory',
        'state_inference',
        'desktop_planning',
        'mission_planning',
        'safety_transparency',
      ],
      status: 'active',
      endpoint: LOCAL_BRIDGE_INVOKE_ENDPOINT,
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'rex',
        approvalGated: true,
        local: true,
        requiredTools: AGENT_REQUIRED_TOOLS['research-orchestrator'],
      },
    },
  ];
  return applyExternalAgentEndpointOverrides(
    agents.map((agent) => ({
      ...agent,
      status: 'standby',
      endpoint: agent.endpoint || LOCAL_BRIDGE_INVOKE_ENDPOINT,
      healthCheckedAt: '',
      health_checked_at: '',
      metadata: {
        ...(agent.metadata || {}),
        local: agent.metadata?.local !== false,
        registeredAt: activeAt,
        communication: agent.metadata?.communication || 'pbk-bridge-local',
      },
    })),
    env
  );
}

export function normalizeAgentRegistryRecord(record = {}) {
  const id = normalizeAgentRegistryId(record.id || record.agentId || record.name);
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  return {
    id,
    name: String(record.name || id || '').trim(),
    description: String(record.description || '').trim(),
    capabilities: uniqueStrings(record.capabilities || []),
    status: String(record.status || 'standby')
      .trim()
      .toLowerCase(),
    endpoint: String(record.endpoint || '').trim(),
    version: String(record.version || '').trim(),
    healthCheckedAt: record.healthCheckedAt || record.health_checked_at || '',
    health_checked_at: record.healthCheckedAt || record.health_checked_at || '',
    lastError: String(record.lastError || record.last_error || '').trim(),
    last_error: String(record.lastError || record.last_error || '').trim(),
    metadata,
    createdAt: record.createdAt || record.created_at || '',
    updatedAt: record.updatedAt || record.updated_at || '',
  };
}

export function mergeAgentRegistryRecords(existing = [], defaults = buildDefaultAgentRegistry()) {
  const merged = new Map();
  for (const agent of defaults) {
    const normalized = normalizeAgentRegistryRecord(agent);
    if (normalized.id) merged.set(normalized.id, normalized);
  }
  for (const agent of Array.isArray(existing) ? existing : []) {
    const normalized = normalizeAgentRegistryRecord(agent);
    if (!normalized.id) continue;
    const fallback = merged.get(normalized.id) || {};
    merged.set(normalized.id, {
      ...fallback,
      ...normalized,
      name: normalized.name || fallback.name || normalized.id,
      description: normalized.description || fallback.description || '',
      capabilities: uniqueStrings([fallback.capabilities || [], normalized.capabilities || []]),
      metadata: {
        ...(fallback.metadata || {}),
        ...(normalized.metadata || {}),
      },
      healthCheckedAt: normalized.healthCheckedAt || fallback.healthCheckedAt || '',
      health_checked_at: normalized.healthCheckedAt || fallback.healthCheckedAt || '',
      lastError: normalized.lastError || fallback.lastError || '',
      last_error: normalized.lastError || fallback.lastError || '',
    });
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function findAgentsByCapability(
  registry = [],
  capability = '',
  { includeInactive = false } = {}
) {
  const wanted = String(capability || '')
    .trim()
    .toLowerCase();
  if (!wanted) return [];
  return (Array.isArray(registry) ? registry : [])
    .map(normalizeAgentRegistryRecord)
    .filter((agent) => includeInactive || ROUTABLE_AGENT_STATUSES.has(agent.status))
    .filter((agent) => agent.capabilities.map((item) => item.toLowerCase()).includes(wanted));
}

export function buildAgentRegistrySnapshot(
  registry = [],
  { requiredIds = REQUIRED_AGENT_IDS } = {}
) {
  const agents = mergeAgentRegistryRecords(registry, []);
  const ids = new Set(agents.map((agent) => agent.id));
  const missing = requiredIds.filter((id) => !ids.has(id));
  const degraded = agents.filter(
    (agent) => !['active', 'standby'].includes(String(agent.status || '').toLowerCase())
  );
  const pendingHealth = agents.filter(
    (agent) =>
      requiredIds.includes(agent.id) &&
      String(agent.status || '').toLowerCase() !== 'active' &&
      !(agent.healthCheckedAt || agent.health_checked_at)
  );
  const capabilities = uniqueStrings(agents.flatMap((agent) => agent.capabilities || [])).sort();
  const inventoryReady = missing.length === 0 && degraded.length === 0;
  const healthReady = inventoryReady && pendingHealth.length === 0;
  return {
    ok: healthReady,
    ready: healthReady,
    inventoryReady,
    result: !inventoryReady
      ? 'agent_registry_degraded'
      : pendingHealth.length
        ? 'agent_registry_pending_health'
        : 'agent_registry_ready',
    generatedAt: new Date().toISOString(),
    count: agents.length,
    capabilities,
    required: {
      ids: requiredIds,
      missing,
      pendingHealth: pendingHealth.map((agent) => agent.id),
    },
    degraded: degraded.map((agent) => ({
      id: agent.id,
      status: agent.status,
      lastError: agent.lastError || agent.last_error || '',
    })),
    agents,
  };
}

function getMeasurementProbeForAgent(healthProbes = [], agent = {}) {
  const agentId = normalizeAgentRegistryId(agent.id || agent.agentId || agent.name);
  const agentName = normalizeAgentRegistryId(agent.name || '');
  return (Array.isArray(healthProbes) ? healthProbes : []).find((probe = {}) => {
    const probeId = normalizeAgentRegistryId(probe.id || probe.agentId || probe.agent_id || probe.name);
    const probeName = normalizeAgentRegistryId(probe.name || '');
    return probeId === agentId || probeName === agentId || (agentName && probeId === agentName);
  }) || null;
}

function getMeasurementLastAction(lastActions = {}, agent = {}) {
  const agentId = normalizeAgentRegistryId(agent.id || agent.agentId || agent.name);
  if (Array.isArray(lastActions)) {
    return (
      lastActions.find(
        (action = {}) =>
          normalizeAgentRegistryId(
            action.agentId ||
              action.agent_id ||
              action.toAgent ||
              action.to_agent ||
              action.fromAgent ||
              action.from_agent ||
              action.agent ||
              action.name
          ) === agentId
      ) || null
    );
  }
  return lastActions && typeof lastActions === 'object' ? lastActions[agentId] || null : null;
}

function getMeasurementLatencySamples(latencySamples = {}, healthProbe = {}, agent = {}) {
  const agentId = normalizeAgentRegistryId(agent.id || agent.agentId || agent.name);
  const direct = latencySamples && typeof latencySamples === 'object' ? latencySamples[agentId] : [];
  const values = Array.isArray(direct) ? direct : [direct];
  for (const key of ['latencyP95Ms', 'latencyMs', 'probeLatencyMs']) {
    if (Number.isFinite(Number(healthProbe?.[key]))) values.push(Number(healthProbe[key]));
  }
  return values.map(Number).filter(Number.isFinite);
}

function getMeasurementLastSuccessAt(agent = {}, probe = {}, action = null) {
  const actionStatus = String(action?.status || action?.result || '').toLowerCase();
  if (action && !/fail|error|reject|denied|blocked/.test(actionStatus)) {
    return action.at || action.completedAt || action.completed_at || action.updatedAt || action.createdAt || '';
  }
  if (probe?.ready) return probe.lastSeen || probe.last_seen || probe.checkedAt || probe.checked_at || '';
  return agent.healthCheckedAt || agent.health_checked_at || '';
}

function getMeasurementLastFailureAt(agent = {}, probe = {}, action = null) {
  const actionStatus = String(action?.status || action?.result || '').toLowerCase();
  if (action && /fail|error|reject|denied|blocked/.test(actionStatus)) {
    return action.at || action.completedAt || action.completed_at || action.updatedAt || action.createdAt || '';
  }
  if (agent.lastError || agent.last_error || probe?.lastError || probe?.last_error) {
    return agent.healthCheckedAt || agent.health_checked_at || probe.lastSeen || probe.last_seen || '';
  }
  return '';
}

export function buildStableAgentFleetMeasurement(registry = [], options = {}) {
  const requiredIds = uniqueStrings(options.requiredIds || REQUIRED_AGENT_IDS);
  const normalizedRegistry = mergeAgentRegistryRecords(registry, buildDefaultAgentRegistry({ env: options.env || {} }));
  const byId = new Map(normalizedRegistry.map((agent) => [agent.id, agent]));
  const catalog = normalizeToolCatalog(options.toolCatalog || {});
  const maxLatencyP95Ms = Number(options.maxLatencyP95Ms || 2500);
  const minLatencySamples = Math.max(0, Number(options.minLatencySamples ?? 1));
  const context = options.intelligenceContext && typeof options.intelligenceContext === 'object' ? options.intelligenceContext : {};
  const generatedAt = new Date(typeof options.now === 'function' ? options.now() : options.now || Date.now()).toISOString();
  const agents = requiredIds.map((agentId) => {
    const agent = byId.get(agentId) || normalizeAgentRegistryRecord({ id: agentId, name: agentId, status: 'missing' });
    const probe = getMeasurementProbeForAgent(options.healthProbes || [], agent);
    const action = getMeasurementLastAction(options.lastActions || {}, agent);
    const requiredTools = uniqueStrings(agent.metadata?.requiredTools || agent.requiredTools || []);
    const missingTools = requiredTools.filter((tool) => !catalog[tool]);
    const samples = getMeasurementLatencySamples(options.latencySamples || {}, probe || {}, agent);
    const lastSuccessAt = getMeasurementLastSuccessAt(agent, probe || {}, action);
    const lastFailureAt = getMeasurementLastFailureAt(agent, probe || {}, action);
    const status = String(agent.status || '').toLowerCase();
    const blockers = [];
    if (!byId.has(agentId)) blockers.push('agent_missing');
    if (!agent.version) blockers.push('version_missing');
    if (!agent.capabilities?.length) blockers.push('capabilities_missing');
    if (!['active', 'standby'].includes(status)) blockers.push(`registry_status_${status || 'missing'}`);
    if (!probe) blockers.push('health_probe_missing');
    else if (probe.ready === false || probe.present === false) blockers.push('health_probe_not_ready');
    blockers.push(...missingTools.map((tool) => `missing_tool:${tool}`));
    if (samples.length < minLatencySamples) blockers.push('latency_not_sampled');
    if (samples.length && percentile(samples, 0.95) > maxLatencyP95Ms) blockers.push('latency_p95_above_budget');
    if (!lastSuccessAt) blockers.push('last_success_missing');
    for (const key of ['memory', 'skills', 'dataFreshness', 'fleetReadiness']) {
      if (context[key]?.ready === false) blockers.push(`${key}_not_ready`);
    }
    const measured = blockers.length === 0;
    return {
      id: agentId,
      name: agent.name || agentId,
      version: agent.version || '',
      status: agent.status || 'missing',
      measured,
      ready: measured,
      result: measured ? 'agent_fully_measured' : 'agent_measurement_gap',
      blockers,
      measurement: {
        inventory: byId.has(agentId),
        healthProbe: Boolean(probe),
        healthReady: Boolean(probe?.ready !== false && probe?.present !== false && probe),
        toolsMeasured: requiredTools.length > 0,
        toolsReady: missingTools.length === 0,
        latencyMeasured: samples.length >= minLatencySamples,
        latencyWithinBudget: !samples.length || percentile(samples, 0.95) <= maxLatencyP95Ms,
        lastSuccessObserved: Boolean(lastSuccessAt),
        lastFailureObserved: Boolean(lastFailureAt),
        contextKnown: {
          memory: context.memory?.ready !== undefined,
          skills: context.skills?.ready !== undefined,
          dataFreshness: context.dataFreshness?.ready !== undefined,
          fleetReadiness: context.fleetReadiness?.ready !== undefined,
        },
      },
      metrics: {
        latencyP95Ms: percentile(samples, 0.95),
        latencySamples: samples.length,
        lastSuccessAt,
        lastFailureAt,
        maxLatencyP95Ms,
      },
      requiredTools,
      missingTools,
    };
  });
  const measured = agents.filter((agent) => agent.measured);
  const blockers = agents
    .filter((agent) => !agent.measured)
    .map((agent) => `agent_measurement_gap:${agent.id}`);
  return {
    ok: true,
    ready: blockers.length === 0,
    result: blockers.length
      ? 'stable_agent_fleet_measurement_gaps'
      : 'stable_agent_fleet_fully_measured',
    authority: 'pbk-agent-registry',
    measurementVersion: 'stable-11-agent-measurement-v1',
    generatedAt,
    requiredIds,
    total: agents.length,
    measuredCount: measured.length,
    blockers,
    agents,
  };
}

function normalizeAgentVersionSnapshotRecord(agent = {}) {
  const normalized = normalizeAgentRegistryRecord(agent);
  const metadata = normalized.metadata && typeof normalized.metadata === 'object' ? normalized.metadata : {};
  return {
    id: normalized.id,
    name: normalized.name || normalized.id,
    description: normalized.description || '',
    capabilities: uniqueStrings(normalized.capabilities || []).sort(),
    status: normalized.status || 'standby',
    endpoint: normalized.endpoint || LOCAL_BRIDGE_INVOKE_ENDPOINT,
    version: normalized.version || metadata.version || 'v1.0',
    metadata,
  };
}

export function buildAgentVersionSnapshot(registry = [], options = {}) {
  const requiredIds = uniqueStrings(options.requiredIds || REQUIRED_AGENT_IDS);
  const agents = mergeAgentRegistryRecords(registry, buildDefaultAgentRegistry({ env: options.env || {} }))
    .map(normalizeAgentVersionSnapshotRecord)
    .filter((agent) => agent.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const snapshot = {
    schemaVersion: 1,
    id: options.id || options.snapshotId || `agent-version-snapshot-${Date.now()}`,
    workspaceId: options.workspaceId || 'pbk',
    environment: options.environment || 'production',
    authority: 'pbk-agent-registry',
    generatedAt: options.generatedAt || new Date(options.now || Date.now()).toISOString(),
    createdBy: options.createdBy || options.actor || 'PBK Command Center',
    requiredIds,
    agents,
  };
  snapshot.checksum = checksumAgentSnapshotPayload(snapshot);
  return snapshot;
}

export function validateAgentVersionSnapshot(snapshot = {}, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, ready: false, result: 'agent_version_snapshot_invalid', reason: 'snapshot_missing' };
  }
  if (snapshot.authority !== 'pbk-agent-registry') {
    return { ok: false, ready: false, result: 'agent_version_snapshot_invalid', reason: 'invalid_authority' };
  }
  const expectedChecksum = checksumAgentSnapshotPayload(snapshot);
  if (!snapshot.checksum || snapshot.checksum !== expectedChecksum) {
    return { ok: false, ready: false, result: 'agent_version_snapshot_invalid', reason: 'checksum_invalid' };
  }
  const requiredIds = uniqueStrings(options.requiredIds || snapshot.requiredIds || REQUIRED_AGENT_IDS);
  const agents = (Array.isArray(snapshot.agents) ? snapshot.agents : []).map(normalizeAgentVersionSnapshotRecord);
  const ids = new Set(agents.map((agent) => agent.id));
  const missing = requiredIds.filter((id) => !ids.has(id));
  const malformed = agents.filter((agent) => !agent.id || !agent.name || !agent.version || !agent.endpoint);
  const ready = missing.length === 0 && malformed.length === 0;
  return {
    ok: ready,
    ready,
    result: ready ? 'agent_version_snapshot_ready' : 'agent_version_snapshot_incomplete',
    reason: ready ? '' : missing.length ? 'required_agent_missing' : 'malformed_agent_record',
    checksum: snapshot.checksum,
    requiredIds,
    missing,
    malformed: malformed.map((agent) => agent.id || '(missing-id)'),
    agents,
    snapshot: {
      ...snapshot,
      agents,
    },
  };
}

export function buildAgentRollbackPlan({ currentRegistry = [], snapshot = {}, agentIds = [], reason = '', actor = '', now = Date.now() } = {}) {
  const validation = validateAgentVersionSnapshot(snapshot);
  if (!validation.ok) {
    return {
      ok: false,
      ready: false,
      result: 'agent_rollback_blocked',
      reason: validation.reason,
      validation,
    };
  }
  const rollbackReason = String(reason || '').trim();
  if (!rollbackReason) {
    return {
      ok: false,
      ready: false,
      result: 'agent_rollback_reason_required',
      reason: 'rollback_reason_required',
      validation,
    };
  }
  const current = mergeAgentRegistryRecords(currentRegistry, buildDefaultAgentRegistry()).map(normalizeAgentVersionSnapshotRecord);
  const currentById = new Map(current.map((agent) => [agent.id, agent]));
  const snapshotById = new Map(validation.agents.map((agent) => [agent.id, agent]));
  const targets = uniqueStrings(agentIds.length ? agentIds : validation.agents.map((agent) => agent.id));
  const missingTargets = targets.filter((id) => !snapshotById.has(id));
  if (missingTargets.length) {
    return {
      ok: false,
      ready: false,
      result: 'agent_rollback_blocked',
      reason: 'rollback_target_missing_from_snapshot',
      missingTargets,
      validation,
    };
  }
  const rolledBackAt = new Date(now).toISOString();
  const nextById = new Map(currentById);
  const changes = targets.map((id) => {
    const from = currentById.get(id) || null;
    const toSnapshot = snapshotById.get(id);
    const to = {
      ...toSnapshot,
      metadata: {
        ...(toSnapshot.metadata || {}),
        rollback: {
          reason: rollbackReason,
          actor: actor || 'PBK Command Center',
          snapshotId: snapshot.id || '',
          checksum: snapshot.checksum || '',
          rolledBackAt,
          previousVersion: from?.version || '',
          previousStatus: from?.status || '',
        },
      },
      healthCheckedAt: '',
      health_checked_at: '',
      lastError: '',
      last_error: '',
    };
    nextById.set(id, to);
    return {
      agentId: id,
      from: from
        ? {
            version: from.version,
            status: from.status,
            endpoint: from.endpoint,
            capabilities: from.capabilities,
          }
        : null,
      to: {
        version: to.version,
        status: to.status,
        endpoint: to.endpoint,
        capabilities: to.capabilities,
      },
    };
  });
  return {
    ok: true,
    ready: true,
    result: 'agent_rollback_plan_ready',
    actor: actor || 'PBK Command Center',
    reason: rollbackReason,
    snapshotId: snapshot.id || '',
    checksum: snapshot.checksum || '',
    generatedAt: rolledBackAt,
    targets,
    changes,
    nextRegistry: [...nextById.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function applyAgentVersionRollback(params = {}) {
  const plan = buildAgentRollbackPlan(params);
  if (!plan.ok) return plan;
  return {
    ...plan,
    applied: true,
    result: 'agent_version_rollback_applied',
    registry: plan.nextRegistry,
  };
}

export async function invokeRegisteredAgent(agent = {}, payload = {}, options = {}) {
  const normalized = normalizeAgentRegistryRecord(agent);
  if (!normalized.id) throw new Error('Agent id is required.');
  if (normalized.status && !ROUTABLE_AGENT_STATUSES.has(normalized.status)) {
    throw new Error(`Agent ${normalized.id} is ${normalized.status}.`);
  }
  const isRemoteEndpoint = /^https?:\/\//i.test(normalized.endpoint);
  const localPreferred = normalized.metadata?.local !== false && !isRemoteEndpoint;
  if (localPreferred || !normalized.endpoint) {
    const handler = options.localHandlers?.[normalized.id];
    if (typeof handler !== 'function')
      throw new Error(`No local handler registered for agent ${normalized.id}.`);
    return handler(payload, normalized);
  }
  if (!isRemoteEndpoint) {
    throw new Error(`Agent ${normalized.id} endpoint is not a remote URL and no local handler was used.`);
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function')
    throw new Error('fetch is not available for remote agent invocation.');
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_REMOTE_TIMEOUT_MS));
  const apiKey = String(options.apiKey || options.env?.PBK_BRIDGE_API_KEY || process.env.PBK_BRIDGE_API_KEY || '').trim();
  try {
    const endpoint = normalized.endpoint.replace(/\/+$/, '');
    const invokeUrl = /\/invoke$/i.test(endpoint) ? endpoint : `${endpoint}/invoke`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetchImpl(invokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { text };
    }
    if (!response.ok) throw new Error(`Agent ${normalized.id} returned HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Agent ${normalized.id} remote invocation timed out after ${timeoutMs}ms.`);
    throw error;
  }
}

export const requiredAgentRegistryIds = Object.freeze([...REQUIRED_AGENT_IDS]);
