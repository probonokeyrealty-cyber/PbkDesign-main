import { existsSync } from 'node:fs';

const ADDITIVE_DEFINITIONS = Object.freeze([
  {
    id: 'acp_gateway',
    name: 'ACP/AIP Agent Interop Gateway',
    phase: 1,
    mode: 'live_adapter',
    env: [],
    tools: ['routeAcpMessage'],
    summary: 'JSON-RPC-compatible gateway that maps external agent messages onto approved PBK tools.',
  },
  {
    id: 'safety_transparency',
    name: 'Safety Transparency Pack',
    phase: 1,
    mode: 'live_documented',
    env: [],
    tools: ['getSafetyTransparencyReport'],
    summary: 'Public-facing guardrail, approval, QA, and evaluation documentation surface.',
  },
  {
    id: 'encompass_path_search',
    name: 'Execution Path Search',
    phase: 1,
    mode: 'pbk_native',
    env: [],
    tools: ['planExecutionPathSearch'],
    summary: 'Parallel rebuttal/path planner with backtracking guidance before Ava commits to a response.',
  },
  {
    id: 'tool_universe',
    name: 'Tool Discovery Layer',
    phase: 2,
    mode: 'local_discovery_ready',
    env: ['PBK_TOOLUNIVERSE_ENDPOINT'],
    tools: ['discoverExternalTool'],
    summary: 'Discovers best PBK/local/MCP tool candidates from a natural-language need.',
  },
  {
    id: 'agent_reach_internet_layer',
    name: 'Agent Reach Internet Layer',
    phase: 2,
    mode: 'optional_local_readonly',
    env: ['PBK_AGENT_REACH_COMMAND'],
    tools: ['launchBrowserResearch', 'webSearch', 'runProviderAugmentedAdditiveIntelligence'],
    summary:
      'Optional local internet-access lane for Twitter/X, Reddit, YouTube, Bilibili, LinkedIn, and webpage research. PBK keeps it read-only and routes through existing research jobs.',
  },
  {
    id: 'awm_induction',
    name: 'Agent Workflow Memory',
    phase: 2,
    mode: 'pbk_native',
    env: [],
    tools: ['induceWorkflowMemory'],
    summary: 'Induces reusable call/workflow patterns from successful trajectories.',
  },
  {
    id: 'stopping_agent',
    name: 'Learned Stopping Agent',
    phase: 2,
    mode: 'heuristic_live_model_gated',
    env: ['PBK_STOPPING_AGENT_MODEL_PATH'],
    tools: ['evaluateStoppingAgent'],
    summary: 'Runs a parallel guardrail that can slow down, hand off, or stop strategic mistakes.',
  },
  {
    id: 'mem1_compact_memory',
    name: 'Constant-Memory Seller State',
    phase: 3,
    mode: 'compact_state_live_model_gated',
    env: ['PBK_MEM1_MODEL_PATH'],
    tools: ['compactLongHorizonMemory'],
    summary: 'Compacts long conversations into a durable seller mental model while MEM1 training remains gated.',
  },
  {
    id: 'neuroskill_state_inference',
    name: 'Proactive State Inference',
    phase: 3,
    mode: 'voice_text_live_biometric_gated',
    env: ['PBK_NEUROSKILL_ENDPOINT'],
    tools: ['inferProactiveHumanState'],
    summary: 'Infers stress, distraction, and cognitive load from approved text/voice signals; biometrics stay opt-in.',
  },
  {
    id: 'autograph_gui_automation',
    name: 'Deterministic GUI Automation Planner',
    phase: 3,
    mode: 'sidecar_plan_ready_execution_gated',
    env: ['PBK_SIDECAR_TOKEN'],
    tools: ['planDeterministicGuiAutomation'],
    summary: 'Creates symbolic, approval-gated desktop automation plans for the supported Desktop Sidecar path.',
  },
  {
    id: 'masteragent_l4_orchestration',
    name: 'L4 Mission Orchestration',
    phase: 4,
    mode: 'pbk_mission_planner_live_external_gated',
    env: ['PBK_MASTERAGENT_ENDPOINT'],
    tools: ['planMasterAgentMission'],
    summary: 'Turns high-level goals into multi-agent PBK missions with explicit approval gates and stop conditions.',
  },
]);

const PROVIDER_CONNECTORS = Object.freeze([
  {
    additiveId: 'acp_gateway',
    providerId: 'external-acp-gateway',
    label: 'External ACP Gateway',
    endpointEnv: ['PBK_ACP_ENDPOINT'],
    healthPath: 'health',
  },
  {
    additiveId: 'encompass_path_search',
    providerId: 'encompass-search-service',
    label: 'EnCompass Search Service',
    endpointEnv: ['PBK_ENCOMPASS_ENDPOINT'],
    healthPath: 'health',
  },
  {
    additiveId: 'tool_universe',
    providerId: 'tooluniverse',
    label: 'ToolUniverse Provider',
    endpointEnv: ['PBK_TOOLUNIVERSE_ENDPOINT'],
    tokenEnv: ['PBK_TOOLUNIVERSE_TOKEN', 'HF_TOKEN', 'HUGGINGFACE_API_TOKEN'],
    healthPath: 'health',
  },
  {
    additiveId: 'agent_reach_internet_layer',
    providerId: 'agent-reach',
    label: 'Agent Reach Local Internet Layer',
    commandEnv: ['PBK_AGENT_REACH_COMMAND'],
    healthPath: 'doctor',
  },
  {
    additiveId: 'awm_induction',
    providerId: 'awm-service',
    label: 'Agent Workflow Memory Service',
    endpointEnv: ['PBK_AWM_ENDPOINT'],
    modelPathEnv: ['PBK_AWM_MODEL_PATH'],
    healthPath: 'health',
  },
  {
    additiveId: 'stopping_agent',
    providerId: 'stopping-agent-model',
    label: 'Learned Stopping Agent Model',
    endpointEnv: ['PBK_STOPPING_AGENT_ENDPOINT'],
    modelPathEnv: ['PBK_STOPPING_AGENT_MODEL_PATH'],
    healthPath: 'health',
  },
  {
    additiveId: 'mem1_compact_memory',
    providerId: 'mem1',
    label: 'MEM1 Constant-Memory Provider',
    endpointEnv: ['PBK_MEM1_ENDPOINT'],
    modelPathEnv: ['PBK_MEM1_MODEL_PATH'],
    healthPath: 'health',
  },
  {
    additiveId: 'neuroskill_state_inference',
    providerId: 'neuroskill',
    label: 'NeuroSkill State Provider',
    endpointEnv: ['PBK_NEUROSKILL_ENDPOINT'],
    tokenEnv: ['PBK_NEUROSKILL_TOKEN'],
    healthPath: 'health',
  },
  {
    additiveId: 'autograph_gui_automation',
    providerId: 'autograph-sidecar',
    label: 'AutoGraph / Desktop Sidecar Provider',
    endpointEnv: ['PBK_AUTOGRAPH_ENDPOINT'],
    tokenEnv: ['PBK_SIDECAR_TOKEN'],
    healthPath: 'health',
  },
  {
    additiveId: 'masteragent_l4_orchestration',
    providerId: 'masteragent',
    label: 'MasterAgent L4 Provider',
    endpointEnv: ['PBK_MASTERAGENT_ENDPOINT'],
    tokenEnv: ['PBK_MASTERAGENT_TOKEN'],
    healthPath: 'health',
  },
]);

const TOOL_ALIASES = Object.freeze([
  {
    toolName: 'analyzeDeal',
    intents: ['analyze deal', 'mao', 'arv', 'comps', 'repair', 'offer', 'property value'],
    risk: 'readonly',
  },
  {
    toolName: 'consultNurtureAgent',
    intents: ['follow up', 'sms', 'email', 'call later', 'nurture', 'best channel'],
    risk: 'readonly',
  },
  {
    toolName: 'startNurtureSequence',
    intents: ['start nurture', 'sequence', 'campaign follow up', 'automate follow up'],
    risk: 'high',
  },
  {
    toolName: 'runAgentTeam',
    intents: ['team', 'workflow', 'proposal', 'script', 'architect', 'review'],
    risk: 'low',
  },
  {
    toolName: 'getBrainState',
    intents: ['brain', 'research', 'memory', 'rag', 'knowledge'],
    risk: 'readonly',
  },
  {
    toolName: 'runCliCommand',
    intents: ['diagnose repo', 'logs', 'grep', 'status', 'read files'],
    risk: 'high',
  },
]);

function asText(value = '') {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function includesAny(text = '', patterns = []) {
  const lower = String(text || '').toLowerCase();
  return patterns.some((pattern) => lower.includes(String(pattern || '').toLowerCase()));
}

function firstConfiguredEnv(names = [], env = {}) {
  for (const name of names || []) {
    const value = String(env[name] || '').trim();
    if (value) return { name, value };
  }
  return { name: '', value: '' };
}

function sanitizeEndpoint(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').slice(0, 240);
  }
}

function boolParam(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function firstFiniteNumber(values = [], fallback = 0) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
}

function estimateTokens(text = '') {
  return Math.max(0, Math.ceil(String(text || '').length / 4));
}

function normalizeConversationTurns(params = {}, text = '') {
  if (Array.isArray(params.turns)) {
    return params.turns
      .map((turn, index) => {
        const value = typeof turn === 'string'
          ? turn
          : (turn?.text || turn?.body || turn?.transcript || turn?.content || '');
        return {
          index,
          speaker: typeof turn === 'object' ? String(turn.speaker || turn.role || '').trim() : '',
          text: String(value || '').trim(),
        };
      })
      .filter((turn) => turn.text);
  }
  return String(text || '')
    .split(/\r?\n+/)
    .map((line, index) => ({ index, speaker: '', text: line.trim() }))
    .filter((turn) => turn.text);
}

function parseCompactMemoryConfig(params = {}, env = {}) {
  const config = params.config && typeof params.config === 'object' ? params.config : {};
  return {
    memoryWindow: Math.round(clamp(firstFiniteNumber([
      params.memory_window,
      params.memoryWindow,
      config.memory_window,
      config.memoryWindow,
      env.PBK_COMPACT_MEMORY_WINDOW,
    ], 20), 4, 80)),
    minRetentionTokens: Math.round(clamp(firstFiniteNumber([
      params.min_retention_tokens,
      params.minRetentionTokens,
      config.min_retention_tokens,
      config.minRetentionTokens,
      env.PBK_COMPACT_MIN_RETENTION_TOKENS,
    ], 512), 128, 4096)),
    compactionTriggerTurns: Math.round(clamp(firstFiniteNumber([
      params.compaction_trigger_turns,
      params.compactionTriggerTurns,
      config.compaction_trigger_turns,
      config.compactionTriggerTurns,
      env.PBK_COMPACT_TRIGGER_TURNS,
    ], 8), 3, 50)),
    bantRequired: boolParam(
      params.bant_required ?? params.bantRequired ?? config.bant_required ?? config.bantRequired ?? env.PBK_COMPACT_BANT_REQUIRED,
      true,
    ),
    emotionRequired: boolParam(
      params.emotion_required ?? params.emotionRequired ?? config.emotion_required ?? config.emotionRequired ?? env.PBK_COMPACT_EMOTION_REQUIRED,
      true,
    ),
  };
}

function normalizeCompactEmotion(params = {}, text = '') {
  const source = params.emotionState || params.emotion || params.currentEmotion || {};
  const dominant = String(
    source.dominant
      || source.dominantEmotion
      || source.emotion
      || source.sentiment
      || params.sentiment
      || '',
  ).trim().toLowerCase();
  const intensities = {
    joy: clamp(source.joy ?? source.happy ?? (dominant === 'joy' ? source.intensity : 0), 0, 1),
    sadness: clamp(source.sadness ?? (dominant === 'sadness' ? source.intensity : 0), 0, 1),
    anger: clamp(source.anger ?? source.frustration ?? (dominant === 'anger' ? source.intensity : 0), 0, 1),
    fear: clamp(source.fear ?? source.anxiety ?? (dominant === 'fear' ? source.intensity : 0), 0, 1),
  };
  const inferredDominant = dominant
    || Object.entries(intensities).sort((left, right) => right[1] - left[1])[0]?.[0]
    || (includesAny(text, ['scam', 'lawyer', 'attorney', 'stop']) ? 'fear' : 'neutral');
  const inferredIntensity = clamp(source.intensity ?? intensities[inferredDominant] ?? 0, 0, 1);
  return {
    dominant: inferredDominant || 'neutral',
    intensity: Number(inferredIntensity.toFixed(2)),
    signals: unique([
      includesAny(text, ['overwhelmed', 'stressed', 'busy']) && 'overwhelmed_or_busy',
      includesAny(text, ['scam', 'fake', 'proof', 'legit', 'trust']) && 'trust_gap',
      includesAny(text, ['attorney', 'lawyer', 'stop calling']) && 'legal_or_stop_signal',
    ]),
    ...intensities,
  };
}

function buildProviderBaseCheck(connector = {}, env = {}) {
  const endpoint = firstConfiguredEnv(connector.endpointEnv || [], env);
  const modelPath = firstConfiguredEnv(connector.modelPathEnv || [], env);
  const token = firstConfiguredEnv(connector.tokenEnv || [], env);
  const command = firstConfiguredEnv(connector.commandEnv || [], env);
  const configured = Boolean(endpoint.value || modelPath.value || command.value);
  const modelReady = modelPath.value ? existsSync(modelPath.value) : false;
  const status = !configured
    ? 'native_only_no_external_provider'
    : modelPath.value && !modelReady
      ? 'model_path_missing'
      : modelPath.value && modelReady
        ? 'local_model_ready'
        : command.value
          ? 'local_command_configured_unverified'
        : 'endpoint_configured_unverified';
  return {
    additiveId: connector.additiveId,
    providerId: connector.providerId,
    label: connector.label,
    configured,
    ready: modelReady,
    status,
    endpointEnv: endpoint.name,
    endpoint: sanitizeEndpoint(endpoint.value),
    modelPathEnv: modelPath.name,
    modelPathConfigured: Boolean(modelPath.value),
    commandEnv: command.name,
    commandConfigured: Boolean(command.value),
    command: command.value ? String(command.value).split(/\s+/)[0] : '',
    tokenEnv: token.name,
    tokenConfigured: Boolean(token.value),
    latencyMs: 0,
    response: {},
    error: '',
    safety: {
      advisoryOnly: true,
      providerWritesAllowed: false,
      approvalRequiredForExecution: true,
    },
  };
}

async function probeEndpointHealth(check = {}, connector = {}, timeoutMs = 2500) {
  if (!check.endpoint || typeof fetch !== 'function') return check;
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = check.endpoint.endsWith('/') ? check.endpoint : `${check.endpoint}/`;
    const healthPath = String(connector.healthPath || 'health').replace(/^\/+/, '');
    const url = new URL(healthPath, base).toString();
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain;q=0.8, */*;q=0.5' },
      signal: controller.signal,
    });
    const bodyText = (await response.text()).slice(0, 2000);
    let body = bodyText;
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      // Text health responses are fine; keep the bounded string.
    }
    return {
      ...check,
      ready: response.ok,
      status: response.ok ? 'external_provider_ready' : 'external_provider_unhealthy',
      latencyMs: Date.now() - start,
      response: {
        status: response.status,
        ok: response.ok,
        body,
      },
      error: response.ok ? '' : `Provider health returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      ...check,
      ready: false,
      status: error?.name === 'AbortError' ? 'external_provider_timeout' : 'external_provider_error',
      latencyMs: Date.now() - start,
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function scoreAlias(query = '', alias) {
  const lower = String(query || '').toLowerCase();
  return (alias.intents || []).reduce((score, intent) => {
    const normalized = String(intent || '').toLowerCase();
    if (!normalized) return score;
    if (lower.includes(normalized)) return score + 4;
    const tokens = normalized.split(/\s+/).filter((token) => token.length > 2);
    return score + tokens.filter((token) => lower.includes(token)).length;
  }, 0);
}

export function listResearchAdditives() {
  return ADDITIVE_DEFINITIONS.map((item) => ({ ...item, env: [...item.env], tools: [...item.tools] }));
}

export function buildResearchAdditivesStatus({ env = process.env, now = new Date() } = {}) {
  const additives = ADDITIVE_DEFINITIONS.map((item) => {
    const missingEnv = (item.env || []).filter((name) => !String(env[name] || '').trim());
    const providerUpgradeAvailable = missingEnv.length > 0;
    return {
      ...item,
      status: 'native_ready',
      missingEnv,
      providerUpgradeAvailable,
      providerUpgradeStatus: providerUpgradeAvailable ? 'upgrade_pending' : 'fully_configured',
      note: providerUpgradeAvailable
        ? `PBK-native adapter is live today; optional provider/model upgrade can attach through ${missingEnv.join(', ')}.`
        : 'PBK-native adapter is live and no extra provider is required.',
    };
  });
  const providerUpgradePending = additives.filter((item) => item.providerUpgradeAvailable).length;
  return {
    ok: true,
    result: 'native_ready',
    checkedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    summary: {
      total: additives.length,
      ready: additives.length,
      nativeReady: additives.length,
      providerUpgradesPending: providerUpgradePending,
      liveWithoutNewSignup: additives.length,
    },
    additives,
  };
}

export async function checkResearchAdditiveProviders(params = {}, options = {}) {
  const env = options.env || params.env || process.env;
  const liveProbe = boolParam(params.liveProbe ?? options.liveProbe, false);
  const timeoutMs = Math.max(500, Math.min(10000, Number(params.timeoutMs || options.timeoutMs || 2500)));
  const baseChecks = PROVIDER_CONNECTORS.map((connector) => buildProviderBaseCheck(connector, env));
  const providers = await Promise.all(
    baseChecks.map(async (check) => {
      if (!liveProbe || !check.endpoint) return check;
      const connector = PROVIDER_CONNECTORS.find((item) => item.providerId === check.providerId) || {};
      return probeEndpointHealth(check, connector, timeoutMs);
    }),
  );
  const configured = providers.filter((item) => item.configured).length;
  const ready = providers.filter((item) => item.ready).length;
  const unhealthy = providers.filter((item) => item.configured && !item.ready).length;
  const unconfigured = providers.filter((item) => !item.configured).length;
  return {
    ok: true,
    result: 'provider_matrix_checked',
    checkedAt: new Date().toISOString(),
    liveProbe,
    summary: {
      total: providers.length,
      configured,
      ready,
      unhealthy,
      unconfigured,
      nativeFallbackReady: true,
      externalWritesAllowed: false,
    },
    providers,
  };
}

export function buildAcpEnvelope(params = {}) {
  const id = String(params.id || params.requestId || `pbk-acp-${Date.now()}`);
  const method = String(params.method || params.action || '').trim();
  const payload = params.params && typeof params.params === 'object' ? params.params : params.payload || {};
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      tenant: 'pbk',
      sourceAgent: params.sourceAgent || params.agent || 'external-agent',
      payload,
    },
  };
}

export async function routeAcpMessage(params = {}, options = {}) {
  const envelope = params.jsonrpc ? params : buildAcpEnvelope(params);
  const method = String(envelope.method || '').trim();
  const payload = envelope.params?.payload && typeof envelope.params.payload === 'object'
    ? envelope.params.payload
    : envelope.params || {};
  const methodMap = {
    'pbk.analyze_deal': 'analyzeDeal',
    'pbk.consult_nurture_agent': 'consultNurtureAgent',
    'pbk.start_nurture_sequence': 'startNurtureSequence',
    'pbk.run_agent_team': 'runAgentTeam',
    'pbk.discover_tool': 'discoverExternalTool',
    'pbk.evaluate_stopping_agent': 'evaluateStoppingAgent',
  };
  const toolName = methodMap[method] || String(payload.toolName || '').trim();
  if (!toolName) {
    return {
      ok: false,
      jsonrpc: '2.0',
      id: envelope.id || null,
      error: {
        code: -32601,
        message: `Unsupported PBK ACP method: ${method || '(missing)'}`,
      },
      supportedMethods: Object.keys(methodMap),
    };
  }
  if (typeof options.invokeTool !== 'function') {
    return {
      ok: true,
      result: 'planned',
      jsonrpc: '2.0',
      id: envelope.id || null,
      route: { method, toolName, params: payload },
      safety: { approvalGate: true, externalWrites: 'blocked_without_pbk_tool_guard' },
    };
  }
  const output = await options.invokeTool(toolName, payload);
  return {
    ok: output?.ok !== false,
    jsonrpc: '2.0',
    id: envelope.id || null,
    result: output,
    route: { method, toolName },
  };
}

export function planExecutionPathSearch(params = {}) {
  const objective = String(params.objective || params.goal || params.objection || params.transcript || '').trim();
  const contextText = [
    objective,
    params.sellerEmotion,
    params.sentiment,
    asText(params.context || {}),
  ].join(' ').toLowerCase();
  const rawCandidates = Array.isArray(params.candidates) && params.candidates.length
    ? params.candidates
    : [
      { id: 'empathy_probe', move: 'Acknowledge emotion, then ask one clarifying question.' },
      { id: 'proof_process', move: 'Offer proof, explain title-company process, then ask permission to continue.' },
      { id: 'option_stack', move: 'Present two clean options and let the seller choose the next path.' },
      { id: 'callback_pause', move: 'Slow down, offer a callback, and avoid pressure.' },
    ];
  const candidates = rawCandidates.map((candidate, index) => {
    const id = String(candidate.id || candidate.key || `path_${index + 1}`);
    let score = 0.5 + (rawCandidates.length - index) * 0.03;
    const moveText = `${id} ${candidate.move || candidate.response || candidate.text || ''}`.toLowerCase();
    if (includesAny(contextText, ['angry', 'upset', 'stop', 'mad', 'grieving', 'passed away'])) {
      if (includesAny(moveText, ['empathy', 'callback', 'pause', 'acknowledge'])) score += 0.2;
      if (includesAny(moveText, ['price', 'close now', 'pressure'])) score -= 0.22;
    }
    if (includesAny(contextText, ['scam', 'legit', 'trust', 'proof', 'real'])) {
      if (includesAny(moveText, ['proof', 'process', 'title', 'permission'])) score += 0.2;
    }
    if (includesAny(contextText, ['too low', 'lowball', 'best price', 'more money'])) {
      if (includesAny(moveText, ['option', 'two', 'net', 'as-is'])) score += 0.16;
    }
    return {
      id,
      move: candidate.move || candidate.response || candidate.text || '',
      score: Number(clamp(score).toFixed(2)),
      risk: score < 0.45 ? 'high' : score < 0.62 ? 'medium' : 'low',
    };
  }).sort((left, right) => right.score - left.score);
  const selected = candidates[0] || null;
  return {
    ok: true,
    result: 'planned',
    engine: 'pbk-encompass-lite',
    objective,
    selected,
    alternatives: candidates.slice(1, 4),
    backtracking: {
      enabled: true,
      retryIf: ['seller_pushes_back', 'confidence_below_0_55', 'safety_guardrail_warns'],
      fallbackPath: candidates.find((candidate) => candidate.id !== selected?.id)?.id || '',
    },
  };
}

export function induceWorkflowMemory(params = {}) {
  const trajectories = Array.isArray(params.trajectories)
    ? params.trajectories
    : Array.isArray(params.calls)
      ? params.calls
      : [];
  const sourceText = trajectories.length ? trajectories.map((item) => asText(item)).join('\n') : asText(params.transcript || params.notes || params.goal || '');
  const lower = sourceText.toLowerCase();
  const trigger = includesAny(lower, ['probate', 'estate', 'executor'])
    ? 'probate_or_estate'
    : includesAny(lower, ['tenant', 'renter', 'evict'])
      ? 'tenant_pressure'
      : includesAny(lower, ['foreclosure', 'behind', 'auction'])
        ? 'debt_deadline'
        : 'general_seller';
  const steps = [
    'Open with the seller context, not the offer.',
    'Confirm authority and timeline before numbers.',
    'Match the seller goal to cash, creative, or callback path.',
    'Use proof/process if trust drops.',
    'Close on one next step with human approval for high-risk actions.',
  ];
  if (trigger === 'probate_or_estate') steps.unshift('Acknowledge family/estate weight before asking logistics.');
  if (trigger === 'tenant_pressure') steps.unshift('Clarify occupancy and lease pain before discussing price.');
  if (trigger === 'debt_deadline') steps.unshift('Ask for the deadline date and what happens if nothing changes.');
  return {
    ok: true,
    result: 'workflow_induced',
    engine: 'pbk-awm-lite',
    workflow: {
      id: `awm_${trigger}`,
      trigger,
      confidence: trajectories.length >= 10 ? 0.82 : trajectories.length >= 3 ? 0.68 : 0.55,
      steps,
      reusableAs: ['script_selection', 'call_flow_hint', 'rex_training_candidate'],
    },
    source: {
      trajectories: trajectories.length,
      note: trajectories.length ? 'Derived from supplied trajectories.' : 'Derived from supplied text; promote after successful-call evidence.',
    },
  };
}

export function evaluateStoppingAgent(params = {}) {
  const text = [
    params.transcript,
    params.lastSellerUtterance,
    params.lastAvaMove,
    asText(params.context || {}),
  ].join(' ').toLowerCase();
  const flags = [];
  if (includesAny(text, ['stop calling', 'do not call', 'remove me', 'take me off'])) flags.push('dnc_or_stop_request');
  if (includesAny(text, ['lawyer', 'attorney', 'lawsuit', 'sue you'])) flags.push('legal_escalation');
  if (includesAny(text, ['passed away', 'funeral', 'grieving', 'death'])) flags.push('grief_context');
  if (includesAny(text, ['scam', 'not real', 'fake', 'how do i know'])) flags.push('trust_crisis');
  if (includesAny(text, ['too low', 'lowball', 'insult'])) flags.push('price_fragility');
  const confidence = clamp(1 - flags.length * 0.18 - Number(params.uncertainty || 0) * 0.4);
  const shouldStop = flags.includes('dnc_or_stop_request') || flags.includes('legal_escalation');
  const shouldHandoff = !shouldStop && (flags.includes('grief_context') || confidence < 0.42);
  return {
    ok: true,
    result: shouldStop ? 'halt' : shouldHandoff ? 'handoff_or_pause' : flags.length ? 'slow_down' : 'continue',
    confidence: Number(confidence.toFixed(2)),
    flags,
    intervention: shouldStop
      ? 'Stop outreach, honor the request, and log the compliance event.'
      : shouldHandoff
        ? 'Pause the pitch and offer a human callback or a softer next step.'
        : flags.length
          ? 'Use empathy/proof and ask permission before continuing.'
          : 'Continue with the current PBK safety validator active.',
    safety: { canOverrideAva: shouldStop || shouldHandoff, providerWrites: 'blocked_without_approval' },
  };
}

export function discoverExternalTool(params = {}, options = {}) {
  const query = String(params.query || params.request || params.goal || '').trim();
  const toolNames = Array.isArray(options.toolNames) ? options.toolNames : [];
  const localMatches = TOOL_ALIASES
    .map((alias) => ({
      ...alias,
      score: scoreAlias(query, alias),
      available: !toolNames.length || toolNames.includes(alias.toolName),
    }))
    .filter((alias) => alias.score > 0 && alias.available)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((alias) => ({
      toolName: alias.toolName,
      score: alias.score,
      risk: alias.risk,
      source: 'pbk-local-tool-universe',
    }));
  return {
    ok: true,
    result: localMatches.length ? 'matched' : 'no_local_match',
    query,
    matches: localMatches,
    external: {
      enabled: Boolean(String((options.env || process.env).PBK_TOOLUNIVERSE_ENDPOINT || '').trim()),
      endpointConfigured: Boolean(String((options.env || process.env).PBK_TOOLUNIVERSE_ENDPOINT || '').trim()),
      policy: 'External discovery is advisory only; execution must route through PBK /invoke and safety metadata.',
    },
  };
}

export function compactLongHorizonMemory(params = {}) {
  const env = params.env || process.env;
  const text = String(params.transcript || params.notes || '').trim();
  const turns = normalizeConversationTurns(params, text);
  const retention = parseCompactMemoryConfig(params, env);
  const bant = params.bant && typeof params.bant === 'object' ? params.bant : {};
  const emotion = normalizeCompactEmotion(params, text);
  const turnCount = Math.max(
    Number(params.turnCount || params.turn_count || 0) || 0,
    turns.length,
  );
  const retainedTurns = turns.slice(-retention.memoryWindow);
  const estimatedTokens = estimateTokens(text || turns.map((turn) => turn.text).join('\n'));
  const mem1Path = String(env.PBK_MEM1_MODEL_PATH || '').trim();
  const mem1Endpoint = String(env.PBK_MEM1_ENDPOINT || '').trim();
  const facts = unique([
    bant.budget && `budget:${bant.budget}`,
    bant.authority && `authority:${bant.authority}`,
    bant.need && `need:${bant.need}`,
    bant.timeline && `timeline:${bant.timeline}`,
    bant.decisionMaker && `decision_maker:${bant.decisionMaker}`,
    bant.motivation && `motivation:${bant.motivation}`,
    emotion.dominant && `emotion:${emotion.dominant}`,
    emotion.intensity > 0 && `emotion_intensity:${emotion.intensity}`,
    includesAny(text, ['probate', 'estate']) && 'context:probate',
    includesAny(text, ['tenant', 'renter']) && 'context:tenant',
    includesAny(text, ['repair', 'roof', 'foundation']) && 'context:repairs',
    includesAny(text, ['scam', 'trust', 'proof']) && 'trust:needs_proof',
    includesAny(text, ['spouse', 'wife', 'husband', 'brother', 'sister', 'partner']) && 'authority:other_decision_maker_possible',
    includesAny(text, ['call me later', 'tomorrow', 'next week', 'at 6', 'after work']) && 'open_loop:callback_timing',
    includesAny(text, ['too low', 'low offer', 'worth more', 'zillow']) && 'objection:price',
  ]);
  const openLoops = [];
  if (!bant.authority) openLoops.push('Confirm decision authority.');
  if (!bant.timeline) openLoops.push('Confirm seller timeline.');
  if (!bant.budget) openLoops.push('Confirm price expectation or debt pressure.');
  if (includesAny(text, ['scam', 'fake', 'proof', 'legit', 'trust'])) openLoops.push('Send seller-safe proof before asking for commitment.');
  if (includesAny(text, ['spouse', 'wife', 'husband', 'brother', 'sister', 'partner'])) openLoops.push('Confirm all decision makers are aligned.');
  if (includesAny(text, ['call me later', 'tomorrow', 'next week', 'after work'])) openLoops.push('Schedule exact callback time and pause aggressive follow-up.');
  const protectedFields = unique([
    retention.bantRequired && 'bant',
    retention.emotionRequired && 'emotion',
    'openLoops',
    'latestTurns',
    'sellerModel',
  ]);
  return {
    ok: true,
    result: 'compact_state_ready',
    engine: 'pbk-mem1-lite',
    compactState: {
      sellerModel: facts.slice(0, 12),
      bant,
      emotion,
      openLoops: unique(openLoops),
      retainedTurns: retainedTurns.map((turn) => ({
        speaker: turn.speaker,
        text: turn.text.slice(0, 500),
      })),
      recommendedNextQuestion: openLoops[0] || 'Confirm the next step and preferred follow-up channel.',
      memoryBudgetTokens: retention.minRetentionTokens,
      sourceLength: text.length,
      estimatedTokens,
      shouldCompact: turnCount >= retention.compactionTriggerTurns || estimatedTokens >= retention.minRetentionTokens,
      retentionPolicy: retention,
      protectedFields,
    },
    model: {
      mem1ModelConfigured: Boolean(mem1Path || mem1Endpoint),
      mem1ModelPathConfigured: Boolean(mem1Path),
      mem1ModelReady: Boolean(mem1Path && existsSync(mem1Path)),
      mem1EndpointConfigured: Boolean(mem1Endpoint),
      trainingRequired: !(mem1Path && existsSync(mem1Path)),
      note: 'PBK native compact state is live. RL-trained MEM1 remains gated until PBK_MEM1_MODEL_PATH points to a trained local model or PBK_MEM1_ENDPOINT is explicitly configured.',
    },
  };
}

export function inferProactiveHumanState(params = {}) {
  const text = String(params.transcript || params.lastSellerUtterance || '').toLowerCase();
  const emotion = params.emotion && typeof params.emotion === 'object' ? params.emotion : {};
  const silenceMs = Number(params.silenceMs || params.pauseMs || 0);
  const responseLatencyMs = Number(params.responseLatencyMs || 0);
  const stress = clamp(
    Number(emotion.anger || 0) * 0.35
      + Number(emotion.fear || 0) * 0.35
      + (includesAny(text, ['overwhelmed', 'stressed', 'busy', 'not now']) ? 0.28 : 0)
      + (silenceMs > 2500 ? 0.12 : 0),
  );
  const cognitiveLoad = clamp(
    (includesAny(text, ['confused', 'not sure', 'explain', "don't understand"]) ? 0.35 : 0)
      + (responseLatencyMs > 2200 ? 0.22 : 0)
      + (silenceMs > 3500 ? 0.18 : 0),
  );
  const distraction = clamp(
    (includesAny(text, ['driving', 'at work', 'busy', 'kids', 'call back']) ? 0.45 : 0)
      + (silenceMs > 5000 ? 0.2 : 0),
  );
  return {
    ok: true,
    result: 'state_inferred',
    engine: 'pbk-neuroskill-lite',
    stateOfMind: {
      stress: Number(stress.toFixed(2)),
      cognitiveLoad: Number(cognitiveLoad.toFixed(2)),
      distraction: Number(distraction.toFixed(2)),
      recommendedAdjustment: stress > 0.55 || cognitiveLoad > 0.55
        ? 'Slow down, summarize one thing, and ask permission to continue.'
        : distraction > 0.5
          ? 'Offer a scheduled callback instead of pushing the pitch.'
          : 'Continue normally with emotional monitoring.',
    },
    privacy: {
      biometricsUsed: false,
      biometricProviderConfigured: Boolean(String((params.env || process.env).PBK_NEUROSKILL_ENDPOINT || '').trim()),
      policy: 'Biophysical signals are opt-in only and are not required for PBK production.',
    },
  };
}

export function planDeterministicGuiAutomation(params = {}) {
  const targetApp = String(params.targetApp || params.app || 'desktop application').trim();
  const objective = String(params.objective || params.goal || params.command || '').trim();
  const selectors = Array.isArray(params.selectors) ? params.selectors : [];
  return {
    ok: true,
    result: 'automation_plan_ready',
    engine: 'pbk-autograph-lite',
    targetApp,
    objective,
    plan: [
      { step: 'observe', action: 'Capture screenshot/OCR through Desktop Sidecar.' },
      { step: 'map', action: selectors.length ? 'Use supplied symbolic selectors.' : 'Build a temporary interface-element map from OCR labels.' },
      { step: 'validate', action: 'Verify target button/field against objective and compliance checklist.' },
      { step: 'confirm', action: 'Require explicit automationApproved=true before any click/type action.' },
      { step: 'execute', action: 'Execute only through Desktop Sidecar; ClickUI remains optional/not required.' },
    ],
    safety: {
      executionGated: true,
      requiresSidecar: true,
      clickUiPolicy: 'not_wired_by_default',
      approvalRequired: true,
    },
  };
}

export function planMasterAgentMission(params = {}) {
  const goal = String(params.goal || params.objective || '').trim();
  const missionType = includesAny(goal, ['campaign', 'marketing']) ? 'growth_campaign'
    : includesAny(goal, ['contract', 'docusign', 'close']) ? 'deal_close'
      : includesAny(goal, ['debug', 'fix', 'deploy']) ? 'ops_repair'
        : 'general_mission';
  const tasksByType = {
    growth_campaign: ['Rex creates target segment', 'Nurture Agent proposes sequence', 'QA Agent validates compliance', 'Operator approves launch'],
    deal_close: ['Ava confirms BANT/path', 'Analyzer prepares terms', 'QA Agent checks offer safety', 'Operator approves contract send'],
    ops_repair: ['Rex diagnoses health gap', 'Research Orchestrator proposes patch', 'QA Agent verifies tests', 'Operator approves deploy'],
    general_mission: ['Clarify goal', 'Assign specialist agents', 'Run safety review', 'Return operator-approved next step'],
  };
  return {
    ok: true,
    result: 'mission_planned',
    engine: 'pbk-masteragent-lite',
    mission: {
      type: missionType,
      goal,
      tasks: tasksByType[missionType],
      agents: ['rex', 'ava', 'qa-agent', 'nurture-agent', 'research-orchestrator'],
      approvalGates: ['provider_write', 'offer_change', 'contract_send', 'external_campaign', 'desktop_automation'],
      stopConditions: ['safety_block', 'seller_stop_request', 'low_confidence', 'missing_required_data'],
    },
    externalMasterAgent: {
      configured: Boolean(String((params.env || process.env).PBK_MASTERAGENT_ENDPOINT || '').trim()),
      policy: 'External L4 systems may plan only; PBK approval gates own execution.',
    },
  };
}

export function buildSafetyTransparencyReport() {
  return {
    ok: true,
    result: 'documented',
    document: 'SAFETY.md',
    categories: [
      'Capabilities and autonomy boundaries',
      'Tool risk classes and approval gates',
      'Voice, seller consent, and DNC safeguards',
      'QA validation and retry policy',
      'Observability and audit trails',
      'Evaluation and smoke-test coverage',
    ],
    claims: {
      highRiskWritesRequireApproval: true,
      generatedToolExecutionDisabledByDefault: true,
      desktopAutomationApprovalGated: true,
      optionalResearchProvidersGated: true,
    },
  };
}

function extractUnifiedText(params = {}) {
  return [
    params.goal,
    params.objective,
    params.query,
    params.command,
    params.transcript,
    params.lastSellerUtterance,
    params.lastAvaMove,
    params.notes,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
}

function pickUnifiedNextAction({ stopping, pathSearch, discovery, compact, humanState, mission }) {
  if (stopping?.result === 'halt') {
    return {
      action: 'halt_and_log',
      reason: stopping.intervention,
      priority: 'critical',
      providerWritesAllowed: false,
    };
  }
  if (stopping?.result === 'handoff_or_pause') {
    return {
      action: 'pause_or_handoff',
      reason: stopping.intervention,
      priority: 'high',
      providerWritesAllowed: false,
    };
  }
  const tool = discovery?.matches?.[0] || null;
  const adjustment = humanState?.stateOfMind?.recommendedAdjustment || '';
  const nextQuestion = compact?.compactState?.recommendedNextQuestion || '';
  return {
    action: tool ? `consider_tool:${tool.toolName}` : 'continue_with_best_path',
    reason: [
      pathSearch?.selected?.move ? `Best path: ${pathSearch.selected.move}` : '',
      adjustment ? `Human-state adjustment: ${adjustment}` : '',
      nextQuestion ? `Memory next question: ${nextQuestion}` : '',
    ].filter(Boolean).join(' '),
    priority: stopping?.flags?.length ? 'medium' : 'normal',
    providerWritesAllowed: false,
    suggestedTool: tool,
    missionType: mission?.mission?.type || '',
  };
}

export async function runUnifiedAdditiveIntelligence(params = {}, options = {}) {
  const env = options.env || params.env || process.env;
  const text = extractUnifiedText(params);
  const status = buildResearchAdditivesStatus({ env });
  const providerChecks = await checkResearchAdditiveProviders(
    {
      liveProbe: boolParam(params.liveProbe ?? options.liveProbe, false),
      timeoutMs: params.timeoutMs || options.timeoutMs,
      env,
    },
    { env },
  );
  const stopping = evaluateStoppingAgent({
    ...params,
    transcript: params.transcript || text,
    lastSellerUtterance: params.lastSellerUtterance || text,
  });
  const humanState = inferProactiveHumanState({
    ...params,
    transcript: params.transcript || text,
    lastSellerUtterance: params.lastSellerUtterance || text,
    env,
  });
  const compact = compactLongHorizonMemory({
    ...params,
    transcript: params.transcript || text,
    notes: params.notes || text,
    env,
  });
  const awm = induceWorkflowMemory({
    ...params,
    transcript: params.transcript || text,
    notes: params.notes || text,
  });
  const pathSearch = planExecutionPathSearch({
    ...params,
    objective: params.objective || params.goal || params.query || text,
    objection: params.objection || text,
    context: {
      ...(params.context && typeof params.context === 'object' ? params.context : {}),
      compactState: compact.compactState,
      stoppingFlags: stopping.flags,
      stateOfMind: humanState.stateOfMind,
      workflow: awm.workflow,
    },
  });
  const discovery = discoverExternalTool(
    {
      ...params,
      query: params.query || params.command || params.goal || text,
    },
    {
      toolNames: options.toolNames || params.toolNames || [],
      env,
    },
  );
  const gui = planDeterministicGuiAutomation({
    ...params,
    objective: params.desktopObjective || params.guiObjective || params.command || params.goal || text,
    targetApp: params.targetApp || params.app || 'PBK operator desktop',
  });
  const mission = planMasterAgentMission({
    ...params,
    goal: params.goal || params.objective || params.command || text || 'Run PBK synchronized additive intelligence.',
    env,
  });
  const safety = buildSafetyTransparencyReport();
  const acp = await routeAcpMessage({
    method: 'pbk.discover_tool',
    sourceAgent: params.sourceAgent || 'pbk-research-orchestrator',
    params: {
      query: params.query || params.command || params.goal || text,
    },
  });
  const nextAction = pickUnifiedNextAction({
    stopping,
    pathSearch,
    discovery,
    compact,
    humanState,
    mission,
  });
  const additiveIds = listResearchAdditives().map((item) => item.id);
  return {
    ok: true,
    result: 'unified_intelligence_ready',
    engine: 'pbk-frontier-fusion-v1',
    additiveIds,
    coverage: {
      total: additiveIds.length,
      used: additiveIds.length,
      nativeReady: status.summary.nativeReady,
      providerUpgradesPending: status.summary.providerUpgradesPending,
      providerConfigured: providerChecks.summary.configured,
      providerReady: providerChecks.summary.ready,
    },
    sync: {
      stoppingFeedsPathSearch: true,
      compactMemoryFeedsPathSearch: true,
      workflowFeedsMission: true,
      toolDiscoveryFeedsNextAction: true,
      humanStateFeedsTone: true,
      guiAndL4RemainApprovalGated: true,
      providersAdvisoryOnly: true,
    },
    providerAugmentation: {
      mode: 'native_first_provider_aware',
      liveProbe: providerChecks.liveProbe,
      configured: providerChecks.summary.configured,
      ready: providerChecks.summary.ready,
      unhealthy: providerChecks.summary.unhealthy,
      advisoryOnly: true,
      providerWritesAllowed: false,
      note:
        providerChecks.summary.configured > 0
          ? 'Configured frontier providers are checked and may enrich planning, but PBK native guardrails stay authoritative.'
          : 'No optional frontier providers are configured; PBK native intelligence remains the active production path.',
    },
    nextAction,
    modules: {
      status,
      providerChecks,
      acp,
      stopping,
      humanState,
      compact,
      awm,
      pathSearch,
      discovery,
      gui,
      mission,
      safety,
    },
  };
}

export async function runProviderAugmentedAdditiveIntelligence(params = {}, options = {}) {
  return runUnifiedAdditiveIntelligence(
    {
      ...params,
      liveProbe: params.liveProbe ?? true,
    },
    {
      ...options,
      liveProbe: options.liveProbe ?? true,
    },
  );
}
