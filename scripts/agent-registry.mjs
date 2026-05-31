const REQUIRED_AGENT_IDS = [
  'ava',
  'rex',
  'hermes',
  'call-analyzer',
  'prosody-tuner',
  'script-rotator',
  'bant-enforcer',
  'qa-agent',
  'nurture-agent',
];

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

export function buildDefaultAgentRegistry({ now = Date.now() } = {}) {
  const activeAt = new Date(now).toISOString();
  return [
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
      endpoint: '',
      version: 'v2.1',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: { orchestrationRole: 'supervisor', supervises: ['rex', 'hermes'], local: true },
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
      endpoint: '',
      version: 'v3.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: { orchestrationRole: 'worker', supervisor: 'ava', local: true },
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
      endpoint: '',
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: { orchestrationRole: 'worker', supervisor: 'ava', suggestOnly: true, local: true },
    },
    {
      id: 'call-analyzer',
      name: 'Call Analyzer',
      description:
        'Reviews Ava call transcripts, scores quality, tags failures, and proposes improvements.',
      capabilities: ['analysis', 'post_call', 'quality_scoring', 'failure_tags', 'coaching'],
      status: 'active',
      endpoint: '',
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: { orchestrationRole: 'worker', supervisor: 'rex', local: true },
    },
    {
      id: 'prosody-tuner',
      name: 'Prosody Tuner',
      description: 'Builds and evaluates Ava voice stability, speed, emotion, and prosody choices.',
      capabilities: ['voice_tuning', 'prosody', 'emotion', 'ml', 'tts_quality'],
      status: 'active',
      endpoint: '',
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: { orchestrationRole: 'worker', supervisor: 'rex', local: true },
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
      endpoint: '',
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: { orchestrationRole: 'worker', supervisor: 'ava', local: true },
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
      endpoint: '',
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: { orchestrationRole: 'worker', supervisor: 'ava', local: true },
    },
    {
      id: 'qa-agent',
      name: 'QA Agent',
      description: 'Validates tool outputs, audits provider proof, and escalates silent failures.',
      capabilities: ['qa', 'tool_validation', 'audit', 'approval_escalation', 'reliability'],
      status: 'active',
      endpoint: '',
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: { orchestrationRole: 'worker', supervisor: 'rex', local: true },
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
      endpoint: '',
      version: 'v1.0',
      healthCheckedAt: activeAt,
      lastError: '',
      metadata: {
        orchestrationRole: 'worker',
        supervisor: 'ava',
        approvalGated: true,
        local: true,
      },
    },
  ];
}

export function normalizeAgentRegistryRecord(record = {}) {
  const id = normalizeAgentRegistryId(record.id || record.agentId || record.name);
  const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  return {
    id,
    name: String(record.name || id || '').trim(),
    description: String(record.description || '').trim(),
    capabilities: uniqueStrings(record.capabilities || []),
    status: String(record.status || 'active')
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
    .filter((agent) => includeInactive || agent.status === 'active')
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
  const capabilities = uniqueStrings(agents.flatMap((agent) => agent.capabilities || [])).sort();
  return {
    ok: missing.length === 0 && degraded.length === 0,
    result: missing.length || degraded.length ? 'agent_registry_degraded' : 'agent_registry_ready',
    generatedAt: new Date().toISOString(),
    count: agents.length,
    capabilities,
    required: {
      ids: requiredIds,
      missing,
    },
    degraded: degraded.map((agent) => ({
      id: agent.id,
      status: agent.status,
      lastError: agent.lastError || agent.last_error || '',
    })),
    agents,
  };
}

export async function invokeRegisteredAgent(agent = {}, payload = {}, options = {}) {
  const normalized = normalizeAgentRegistryRecord(agent);
  if (!normalized.id) throw new Error('Agent id is required.');
  if (normalized.status && !['active', 'standby'].includes(normalized.status)) {
    throw new Error(`Agent ${normalized.id} is ${normalized.status}.`);
  }
  if (!normalized.endpoint) {
    const handler = options.localHandlers?.[normalized.id];
    if (typeof handler !== 'function')
      throw new Error(`No local handler registered for agent ${normalized.id}.`);
    return handler(payload, normalized);
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function')
    throw new Error('fetch is not available for remote agent invocation.');
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 5000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${normalized.endpoint.replace(/\/+$/, '')}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { text };
    }
    if (!response.ok) {
      throw new Error(`Agent ${normalized.id} returned HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export const requiredAgentRegistryIds = Object.freeze([...REQUIRED_AGENT_IDS]);
