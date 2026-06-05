import { DealData } from '../types';
import { buildAgentDealContext, type AgentDealContext } from './agentDealContext';
import {
  createPbkSnnWorker,
  injectSearchCognition,
  type SearchCognitionResult,
} from './snnWorkerBridge';

type RuntimeConfig = {
  endpoint?: string;
  apiKey?: string;
};

const DEFAULT_HOSTED_BRIDGE_ENDPOINT = 'https://pbk-openclaw-bridge.onrender.com';
let avaSnnWorker: Worker | null = null;
let rexSnnWorker: Worker | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    avaSnnWorker?.terminate();
    rexSnnWorker?.terminate();
    avaSnnWorker = null;
    rexSnnWorker = null;
  });
}

export type ApprovalRecord = {
  id: string;
  type?: string;
  status?: string;
  leadId?: string;
  leadName?: string;
  address?: string;
  offerPrice?: number;
  mao?: number;
  notes?: string;
  message?: string;
  body?: string;
  text?: string;
  content?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  approvalAction?: string;
  action?: string;
  actor?: string;
  createdAt?: string;
  actedAt?: string;
};

export type ActivityRecord = {
  id: string;
  type?: string;
  leadId?: string;
  leadName?: string;
  address?: string;
  summary?: string;
  createdAt?: string;
  at?: string;
  actor?: string;
  text?: string;
  category?: string;
};

export type BrainDoc = {
  id: string;
  title?: string;
  source?: string;
  kind?: string;
  topic?: string;
  excerpt?: string;
  summary?: string;
  tags?: string[];
  createdAt?: string;
};

export type LeadImport = {
  id: string;
  leadId?: string;
  leadName?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  source?: string;
  status?: string;
  seller?: Record<string, unknown>;
  property?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

export type AnalyzerRun = {
  id: string;
  address?: string;
  type?: string;
  arv?: number;
  mao?: number;
  targetOffer?: number;
  repairs?: number;
  summary?: string;
  createdAt?: string;
};

export type CallRecord = {
  id: string;
  leadId?: string;
  leadName?: string;
  to?: string;
  from?: string;
  status?: string;
  createdAt?: string;
};

export type MessageRecord = {
  id: string;
  leadId?: string;
  leadName?: string;
  channel?: string;
  direction?: string;
  to?: string;
  from?: string;
  phone?: string;
  email?: string;
  address?: string;
  subject?: string;
  body?: string;
  status?: string;
  at?: string;
  updatedAt?: string;
  scheduledFor?: string;
  sendAt?: string;
  readAt?: string;
  archivedAt?: string;
  unread?: boolean;
  isUnread?: boolean;
  createdAt?: string;
};

export type ContractRecord = {
  id: string;
  leadName?: string;
  address?: string;
  amount?: number;
  status?: string;
  envelopeId?: string;
  createdAt?: string;
};

export type AdminTask = {
  id: string;
  command?: string;
  provider?: string;
  status?: string;
  actor?: string;
  createdAt?: string;
  action?: string;
  summary?: string;
};

export type RuntimeSnapshot = {
  status?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  approvals?: ApprovalRecord[];
  activity?: ActivityRecord[];
  brainDocs?: BrainDoc[];
  leadImports?: LeadImport[];
  analyzerRuns?: AnalyzerRun[];
  calls?: CallRecord[];
  messages?: MessageRecord[];
  contracts?: ContractRecord[];
  documentDeliveries?: Array<Record<string, unknown>>;
  callQaScores?: Array<Record<string, unknown>>;
  skillOutcomes?: Array<Record<string, unknown>>;
  adminTasks?: AdminTask[];
  adminAudit?: Array<Record<string, unknown>>;
  campaigns?: CampaignRecord[];
  campaignLeads?: CampaignLeadRecord[];
  campaignEvents?: CampaignEventRecord[];
  campaignLeadSources?: CampaignLeadSource[];
  campaignExecutions?: Array<Record<string, unknown>>;
};

export type RuntimeQuotas = {
  instantly?: Record<string, unknown>;
  telnyx?: Record<string, unknown>;
  docs?: Record<string, unknown>;
};

export type RuntimeToolingStatus = {
  metaAgent?: Record<string, unknown>;
  browserOs?: Record<string, unknown>;
  browserResearch?: Record<string, unknown>;
  context7?: Record<string, unknown>;
  workflowOps?: Record<string, unknown>;
  observability?: Record<string, unknown>;
  github?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  propertyData?: Record<string, unknown>;
  pipelineMemory?: Record<string, unknown>;
  voiceFallback?: Record<string, unknown>;
  desktopCopilot?: Record<string, unknown>;
};

export type AgentHealthProbe = {
  id?: string;
  name?: string;
  status?: string;
  activity?: string;
  present?: boolean;
  ready?: boolean;
  providerReady?: boolean;
  missingTools?: string[];
  healthProbe?: string;
  lastSeen?: string;
  source?: string;
};

export type AgentHealthResponse = {
  ok: boolean;
  result?: string;
  agents?: AgentHealthProbe[];
  registry?: Record<string, unknown>;
  agentRegistry?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  safety?: Record<string, unknown>;
};

export type AgentRegistryRecord = {
  id?: string;
  agentId?: string;
  name?: string;
  initial?: string;
  role?: string;
  description?: string;
  capabilities?: string[];
  status?: string;
  version?: string;
  endpoint?: string;
  healthCheckedAt?: string;
  health_checked_at?: string;
  lastError?: string;
  last_error?: string;
  metadata?: Record<string, unknown>;
};

export type AgentRegistrySnapshot = {
  ok?: boolean;
  result?: string;
  generatedAt?: string;
  count?: number;
  agents?: AgentRegistryRecord[];
  capabilities?: string[];
  required?: Record<string, unknown>;
  degraded?: Array<Record<string, unknown>>;
};

export type AgentRegistryResponse = {
  ok: boolean;
  result?: string;
  loadedAt?: string;
  source?: string;
  capability?: string;
  matches?: AgentRegistryRecord[];
  registry?: AgentRegistrySnapshot;
};

export type GlobalSearchResult = {
  id?: string;
  recordId?: string;
  recordKind?: string;
  routeContext?: string;
  kind?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  target?: string;
  page?: string;
  createdAt?: string;
  tags?: string[];
};

export type GlobalSearchResponse = {
  ok: boolean;
  result?: string;
  query?: string;
  count?: number;
  results?: GlobalSearchResult[];
  source?: string;
};

export type FounderWorkQueueItem = {
  id: string;
  tag?: string;
  body?: string;
  when?: string;
  tone?: 'urgent' | 'hot' | 'warm' | 'money';
  score?: number;
  source?: string;
  reason?: string;
  cta?: string;
  pulse?: 'default' | 'amber' | 'sky' | 'lime';
  targetPath?: string;
  recordKind?: string;
  recordId?: string;
};

export type FounderWorkQueueResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  count?: number;
  items?: FounderWorkQueueItem[];
  summary?: Record<string, unknown>;
};

export type IntelligenceStreamItem = {
  id?: string;
  kind?: string;
  actor?: string;
  title?: string;
  text?: string;
  category?: string;
  source?: string;
  status?: string;
  at?: string;
  createdAt?: string;
  confidence?: number | null;
  leadId?: string;
  callId?: string;
  metadata?: Record<string, unknown>;
};

export type IntelligenceStreamResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  count?: number;
  items?: IntelligenceStreamItem[];
  summary?: Record<string, unknown>;
};

export type SystemSourceLabel = {
  id: string;
  label: string;
  endpoint: string;
  category?: string;
  status?: 'live' | 'fallback' | 'stale' | 'offline' | 'needs-wiring';
  source?: string;
  confidence?: number | null;
  stalenessMs?: number | null;
  lastUpdatedAt?: string;
  fallbackReason?: string;
  recordCount?: number;
  note?: string;
};

export type SystemSourceLabelsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  count?: number;
  items?: SystemSourceLabel[];
  summary?: Record<string, unknown>;
};

export type ReleaseStatusComponent = {
  id: string;
  label: string;
  status?: 'ready' | 'configured' | 'missing' | 'unknown' | 'degraded';
  ready?: boolean;
  configured?: boolean;
  detail?: string;
  source?: string;
};

export type ReleaseStatusResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  release?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  components?: ReleaseStatusComponent[];
  warnings?: string[];
};

export type RuntimeScriptCandidate = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  pathKey?: string;
  allowedRoles?: string[];
  metadata?: Record<string, unknown>;
  embedding?: number[];
  learnedWeight?: number;
};

export type CurrentScriptResponse = {
  ok: boolean;
  result?: string;
  selectedScript?: RuntimeScriptCandidate | null;
  selected?: RuntimeScriptCandidate | null;
  score?: number;
  reasonCodes?: string[];
  scoredScripts?: Array<Record<string, unknown>>;
  rotationRule?: string;
  source?: string;
};

export type AnalyticsLead = {
  id: string;
  name?: string;
  address?: string;
  stage?: string;
  stageLabel?: string;
  revenue?: number;
  updatedAt?: string;
};

export type LeadStagesResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  stages?: Array<{
    stage: string;
    label?: string;
    total?: number;
    revenue?: number;
    leads?: AnalyticsLead[];
  }>;
  warning?: string;
};

export type DealTimelineResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  days?: Array<{
    day: string;
    count?: number;
    revenue?: number;
    leads?: AnalyticsLead[];
  }>;
  warning?: string;
};

export type AiMetricsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  metrics?: Record<string, unknown>;
  warning?: string;
};

export type SkillOutcomesResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  skills?: Array<Record<string, unknown>>;
  warning?: string;
};

export type SkillTrendsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  skillId?: string;
  skillName?: string;
  points?: Array<Record<string, unknown>>;
  warning?: string;
};

export type ActiveExperimentsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  experiments?: Array<Record<string, unknown>>;
  tests?: Array<Record<string, unknown>>;
  warning?: string;
};

export type MemoryEventRecord = {
  id: string;
  type?: string;
  title?: string;
  summary?: string;
  source?: string;
  agentId?: string;
  agentName?: string;
  skillId?: string;
  skillName?: string;
  success?: boolean | null;
  score?: number | null;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type MemoryEventsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  count?: number;
  events?: MemoryEventRecord[];
  warning?: string;
};

export type ObservabilityStatusResponse = {
  ok: boolean;
  enabled?: boolean;
  initialized?: boolean;
  otelReady?: boolean;
  serviceName?: string;
  lastError?: string;
  metrics?: Record<string, unknown>;
  alerts?: Array<Record<string, unknown>>;
  eventBus?: Record<string, unknown>;
};

export type CampaignRecord = {
  id: string;
  name?: string;
  channel?: string;
  provider?: string;
  status?: string;
  templateId?: string;
  leadSource?: string;
  leadFilter?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  sequence?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  approvalId?: string;
  approvalStatus?: string;
  pendingAction?: string;
  leadCount?: number;
  eventCount?: number;
  conflictCount?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CampaignLeadRecord = {
  id: string;
  campaignId?: string;
  leadId?: string;
  leadName?: string;
  address?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  status?: string;
  touchIndex?: number;
  lastTouchAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CampaignEventRecord = {
  id: string;
  campaignId?: string;
  campaignLeadId?: string;
  leadId?: string;
  eventType?: string;
  channel?: string;
  provider?: string;
  providerEventId?: string;
  providerStatus?: string;
  occurredAt?: string;
  createdAt?: string;
  payload?: Record<string, unknown>;
};

export type CampaignLeadSource = {
  id: string;
  label?: string;
  count?: number;
  source?: string;
  note?: string;
};

export type CampaignDrilldownRow = {
  id?: string;
  campaignId?: string;
  campaignName?: string;
  campaignStatus?: string;
  channel?: string;
  provider?: string;
  leadId?: string;
  leadName?: string;
  address?: string;
  source?: string;
  email?: string;
  phone?: string;
  leadStatus?: string;
  tags?: string[];
  events?: number;
  sent?: boolean;
  opened?: boolean;
  replied?: boolean;
  connected?: boolean;
  dnc?: boolean;
  lastEventType?: string;
  lastEventAt?: string;
  updatedAt?: string;
  routeContext?: string;
  [key: string]: unknown;
};

export type CampaignDrilldownSummary = {
  campaigns?: number;
  leads?: number;
  sent?: number;
  opened?: number;
  replied?: number;
  connected?: number;
  dnc?: number;
  estimatedCost?: number;
  replyRate?: number;
  connectRate?: number;
  [key: string]: unknown;
};

export type CampaignDrilldownResponse = {
  ok: boolean;
  result?: string;
  range?: string;
  generatedAt?: string;
  source?: string;
  filters?: Record<string, unknown>;
  summary?: CampaignDrilldownSummary;
  campaigns?: Array<Record<string, unknown>>;
  sources?: string[];
  rows?: CampaignDrilldownRow[];
  warning?: string;
  error?: string;
};

export type CampaignsResponse = {
  ok: boolean;
  result?: string;
  campaigns?: CampaignRecord[];
  leads?: CampaignLeadRecord[];
  events?: CampaignEventRecord[];
  sources?: CampaignLeadSource[];
  state?: RuntimeSnapshot;
  verbiage?: string;
  error?: string;
};

export type ReplyTemplateRecord = {
  templateKey?: string;
  templateVersion?: string;
  channel?: string;
  subject?: string;
  text?: string;
  html?: string;
  [key: string]: unknown;
};

export type ReplyTemplatesResponse = {
  ok: boolean;
  reply?: Record<string, unknown>;
  calendarEvent?: Record<string, unknown> | null;
  selected?: ReplyTemplateRecord;
  templates?: Record<string, ReplyTemplateRecord>;
  error?: string;
};

export type CampaignRankedTemplatesResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  channel?: string;
  leadSource?: string;
  templates?: Record<string, ReplyTemplateRecord & { rank?: number; score?: number }>;
  rankedTemplates?: Array<ReplyTemplateRecord & { key?: string; rank?: number; score?: number }>;
  warning?: string;
  error?: string;
};

type BridgeRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  keepalive?: boolean;
};

function getHostPBK(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  const candidates = [window.parent, window.opener].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (
        candidate &&
        candidate !== window &&
        (candidate as Window & { PBK?: Record<string, unknown> }).PBK
      ) {
        return (candidate as Window & { PBK?: Record<string, unknown> }).PBK || null;
      }
    } catch {
      // cross-origin or inaccessible
    }
  }
  return (window as typeof window & { PBK?: Record<string, unknown> }).PBK || null;
}

function buildLocalBridgeFallback() {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  const isLocalPreview = host === '127.0.0.1' || host === 'localhost';
  if (!isLocalPreview) return null;
  return {
    // Keep local browser traffic on the Vite origin so the dev proxy can
    // attach the private bridge API key without exposing it to frontend JS.
    endpoint: window.location.origin,
  };
}

function getStorageEnvironment() {
  if (typeof window === 'undefined') return 'local';
  const host = String(window.location.hostname || 'local').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return 'local';
  if (host.includes('pbkcommandcenter') || host.endsWith('.netlify.app')) return 'prod';
  return host.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'local';
}

function readRuntimeConfigFromStorage(): RuntimeConfig | null {
  if (typeof window === 'undefined') return null;
  const keys = [`pbk:${getStorageEnvironment()}:openclaw-config`, 'pbk-openclaw-config'];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.endpoint) return parsed;
    } catch {
      // ignore localStorage parsing failure
    }
  }
  return null;
}

function getEnvRuntimeConfig(): RuntimeConfig | null {
  const env = import.meta.env || {};
  const endpoint =
    env.VITE_PBK_BRIDGE_URL || env.VITE_PBK_OPENCLAW_URL || env.VITE_PBK_OPENCLAW_ENDPOINT;
  if (!endpoint) return null;

  const apiKey = env.VITE_PBK_BRIDGE_API_KEY || env.VITE_PBK_OPENCLAW_API_KEY;
  return apiKey ? { endpoint, apiKey } : { endpoint };
}

export function getRuntimeConfig(): RuntimeConfig {
  const hostPBK = getHostPBK();
  const fromHost =
    typeof hostPBK?.openclaw === 'object' &&
    typeof (hostPBK.openclaw as { getConfig?: () => RuntimeConfig }).getConfig === 'function'
      ? (hostPBK.openclaw as { getConfig: () => RuntimeConfig }).getConfig()
      : null;

  if (fromHost?.endpoint) return fromHost;

  const stored = readRuntimeConfigFromStorage();
  if (stored?.endpoint) {
    const localFallback = buildLocalBridgeFallback();
    if (isNetlifyHostedRuntimeShell() && !stored.apiKey) {
      return { endpoint: window.location.origin };
    }
    if (
      localFallback &&
      !stored.apiKey &&
      String(stored.endpoint) !== String(localFallback.endpoint)
    ) {
      return localFallback;
    }
    return stored;
  }

  const localFallback = buildLocalBridgeFallback();
  if (localFallback) return localFallback;

  if (isNetlifyHostedRuntimeShell()) return { endpoint: window.location.origin };

  const envConfig = getEnvRuntimeConfig();
  if (envConfig?.endpoint) return envConfig;

  return {
    endpoint:
      DEFAULT_HOSTED_BRIDGE_ENDPOINT ||
      (typeof window !== 'undefined' ? window.location.origin : ''),
  };
}

function isAuthOptionalRuntimePath(path = '') {
  const normalized = `/${
    String(path || '')
      .replace(/^\/+/, '')
      .split('?')[0]
  }`;
  return (
    ['/health', '/status', '/api/health', '/api/status'].includes(normalized) ||
    normalized === '/api/scripts/current' ||
    normalized === '/api/v1/scripts/current' ||
    normalized === '/api/leads/stages' ||
    normalized === '/api/v1/leads/stages' ||
    normalized === '/api/deals/timeline' ||
    normalized === '/api/v1/deals/timeline' ||
    normalized === '/api/observability/ai-metrics' ||
    normalized === '/api/v1/observability/ai-metrics' ||
    normalized === '/api/skills/outcomes' ||
    normalized === '/api/v1/skills/outcomes' ||
    normalized === '/api/skills/trends' ||
    normalized === '/api/v1/skills/trends' ||
    normalized.startsWith('/api/public/')
  );
}

function hasServerSideRuntimeAuth() {
  if (typeof window === 'undefined') return false;
  if (!isNetlifyHostedRuntimeShell()) return false;
  const config = getRuntimeConfig();
  const endpoint = String(config.endpoint || '').replace(/\/+$/g, '');
  const origin = String(window.location.origin || '').replace(/\/+$/g, '');
  return endpoint === origin;
}

function assertRuntimeAuthConfigured(path = '') {
  if (isAuthOptionalRuntimePath(path)) return;
  if (hasServerSideRuntimeAuth()) return;
  const config = getRuntimeConfig();
  if (config.apiKey) return;
  throw new Error(
    'PBK bridge API key is not configured. Open Settings and save PBK_BRIDGE_API_KEY before running protected Command Center actions.'
  );
}

function getWebSearchSnnWorkers() {
  if (typeof Worker === 'undefined') return [];
  if (!avaSnnWorker) avaSnnWorker = createPbkSnnWorker('ava', { role: 'acquisitions' });
  if (!rexSnnWorker) rexSnnWorker = createPbkSnnWorker('rex', { role: 'research' });
  return [avaSnnWorker, rexSnnWorker].filter(Boolean) as Worker[];
}

function injectWebSearchCognition(result: SearchCognitionResult) {
  if (!result?.snnSpikeInjection) {
    return { injected: false, reason: 'no_snn_spike_injection', agents: [] };
  }
  const workers = getWebSearchSnnWorkers();
  let injectedCount = 0;
  for (const worker of workers) {
    if (injectSearchCognition(worker, result)) injectedCount += 1;
  }
  return {
    injected: injectedCount > 0,
    injectedCount,
    agents: workers.map(
      (worker) => (worker as Worker & { pbkAgentId?: string }).pbkAgentId || 'unknown'
    ),
  };
}

export function hasRuntimeConnection(): boolean {
  const config = getRuntimeConfig();
  return Boolean(config.endpoint);
}

function buildHeaders(withJson = false) {
  return buildRuntimeHeaders({ json: withJson });
}

export function buildRuntimeHeaders({
  json = false,
  accept = 'application/json',
}: {
  json?: boolean;
  accept?: string;
} = {}) {
  const config = getRuntimeConfig();
  const headers: Record<string, string> = {
    Accept: accept,
  };
  if (json) headers['Content-Type'] = 'application/json';
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function buildUrl(path: string) {
  const config = getRuntimeConfig();
  const endpoint = String(config.endpoint || window.location.origin).replace(/\/+$/g, '');
  return `${endpoint}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildRuntimeUrl(path: string) {
  return buildUrl(path);
}

export async function bridgeRequest<T = unknown>({
  method = 'GET',
  path,
  body,
  keepalive,
}: BridgeRequestOptions): Promise<T> {
  assertRuntimeAuthConfigured(path);
  const serializedBody = body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined;
  const canKeepalive =
    method !== 'GET' && method !== 'DELETE' && (!serializedBody || serializedBody.length < 60000);
  const requestUrl = buildUrl(path);
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 15_000);
  const init = {
    method,
    headers: buildHeaders(body !== undefined && method !== 'GET'),
    body: serializedBody,
    keepalive: keepalive ?? canKeepalive,
    signal: timeoutController.signal,
  };
  let response: Response;
  try {
    response = await fetch(requestUrl, init);
    if (await shouldRetryRuntimeViaHosted(response, requestUrl)) {
      const fallbackUrl = buildHostedRuntimeFallbackUrl(requestUrl);
      if (fallbackUrl) response = await fetch(fallbackUrl, init);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof parsed === 'object' && parsed && 'error' in (parsed as Record<string, unknown>)
        ? String((parsed as Record<string, unknown>).error)
        : `Bridge request failed (${response.status})`
    );
  }

  return parsed as T;
}

function isNetlifyHostedRuntimeShell() {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host.includes('pbkcommandcenter') || host.endsWith('.netlify.app');
}

function buildHostedRuntimeFallbackUrl(url = '') {
  if (!isNetlifyHostedRuntimeShell()) return '';
  try {
    const current = new URL(url, window.location.href);
    if (current.origin !== window.location.origin) return '';
    return new URL(
      `${current.pathname}${current.search}`,
      `${DEFAULT_HOSTED_BRIDGE_ENDPOINT}/`
    ).toString();
  } catch {
    return '';
  }
}

async function shouldRetryRuntimeViaHosted(response: Response, url = '') {
  if (!buildHostedRuntimeFallbackUrl(url)) return false;
  if (response.status !== 503) return false;
  const text = await response
    .clone()
    .text()
    .catch(() => '');
  return /usage_exceeded/i.test(text) || /Usage exceeded/i.test(text);
}

export async function invokeRuntimeTool<T = unknown>(
  toolName: string,
  params: Record<string, unknown> = {}
) {
  return bridgeRequest<T>({
    method: 'POST',
    path: '/invoke',
    body: { toolName, params },
  });
}

export async function startLeadCallRequest(body: Record<string, unknown>) {
  return invokeRuntimeTool<Record<string, unknown>>('telnyx_call', {
    ...body,
    source: body.source || 'command-center-ui',
  });
}

export async function fetchRuntimeState() {
  return bridgeRequest<RuntimeSnapshot>({
    path: '/state',
  });
}

export async function fetchRuntimeSettingsRequest() {
  return bridgeRequest<{
    ok: boolean;
    source?: string;
    settings?: Record<string, unknown>;
  }>({
    path: '/api/settings',
  });
}

export async function updateRuntimeSettingsRequest(body: Record<string, unknown>) {
  return bridgeRequest<{
    ok: boolean;
    source?: string;
    settings?: Record<string, unknown>;
    state?: RuntimeSnapshot;
  }>({
    method: 'PATCH',
    path: '/api/settings',
    body,
  });
}

export async function fetchRuntimeQuotas() {
  const response = await bridgeRequest<{ ok: boolean; quotas: RuntimeQuotas }>({
    path: '/api/quotas',
  });
  return response.quotas || {};
}

export async function fetchRuntimeToolingStatus() {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), 10_000);
  const timeout$ = new Promise<never>((_, reject) =>
    controller.signal.addEventListener('abort', () => reject(new Error('tooling_status_timeout')))
  );
  try {
    const response = await Promise.race([
      bridgeRequest<{ ok: boolean; tooling: RuntimeToolingStatus }>({
        path: '/api/tooling/status',
      }),
      timeout$,
    ]);
    return (response as { ok: boolean; tooling: RuntimeToolingStatus }).tooling || {};
  } finally {
    clearTimeout(handle);
  }
}

export async function fetchAgentHealthRequest() {
  return bridgeRequest<AgentHealthResponse>({
    path: '/api/agents/health',
  });
}

export async function fetchAgentRegistryRequest() {
  return bridgeRequest<AgentRegistryResponse>({
    path: '/api/agents/registry',
  });
}

export async function deployAgentRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/agents/deploy',
    body,
  });
}

export async function fetchAgentSnnStatusRequest() {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    workers?: Array<Record<string, unknown>>;
    frontend?: Record<string, unknown>;
    providers?: Record<string, unknown>;
  }>({
    path: '/api/agents/snn-status',
  });
}

export async function fetchGlobalSearchRequest({
  query = '',
  limit = 8,
}: {
  query?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams();
  params.set('q', query.trim());
  params.set('limit', String(Math.max(1, Math.min(40, limit))));
  return bridgeRequest<GlobalSearchResponse>({
    path: `/api/search?${params.toString()}`,
  });
}

export async function fetchFounderWorkQueueRequest({ limit = 8 }: { limit?: number } = {}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(24, limit))),
  });
  return bridgeRequest<FounderWorkQueueResponse>({
    path: `/api/founder/work-queue?${params.toString()}`,
  });
}

export async function fetchIntelligenceStreamRequest({ limit = 24 }: { limit?: number } = {}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(80, limit))),
  });
  return bridgeRequest<IntelligenceStreamResponse>({
    path: `/api/intelligence/stream?${params.toString()}`,
  });
}

export async function fetchSystemSourceLabelsRequest() {
  return bridgeRequest<SystemSourceLabelsResponse>({
    path: '/api/system/source-labels',
  });
}

export async function fetchReleaseStatusRequest() {
  return bridgeRequest<ReleaseStatusResponse>({
    path: '/api/release/status',
  });
}

export async function fetchObservabilityStatusRequest() {
  return bridgeRequest<ObservabilityStatusResponse>({
    path: '/api/observability/status',
  });
}

export function getSnnWorkerStatus(): { ava: boolean; rex: boolean } {
  return { ava: avaSnnWorker !== null, rex: rexSnnWorker !== null };
}

export async function postRuntimeEvent<T = Record<string, unknown>>(
  eventType: string,
  payload: Record<string, unknown>
) {
  return bridgeRequest<T>({
    method: 'POST',
    path: '/events',
    body: { eventType, payload },
  });
}

export async function updateApprovalDecision(approvalId: string, status: string) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'PUT',
    path: `/api/approvals/${encodeURIComponent(approvalId)}`,
    body: {
      status,
      actor: 'PBK React shell',
      actedAt: new Date().toISOString(),
    },
  });
}

export async function fetchLeadsRequest() {
  const response = await bridgeRequest<{
    ok: boolean;
    leads?: LeadImport[];
    leadImports?: LeadImport[];
  }>({
    path: '/api/leads',
  });
  return response.leads || response.leadImports || [];
}

export async function createLeadRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/leads',
    body,
  });
}

export async function fetchLeadStagesRequest({ limit = 500 } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    groupBy: 'stage',
  });
  return bridgeRequest<LeadStagesResponse>({
    path: `/api/leads/stages?${params.toString()}`,
  });
}

export async function fetchDealTimelineRequest({ days = 30 } = {}) {
  const params = new URLSearchParams({
    days: String(days),
  });
  return bridgeRequest<DealTimelineResponse>({
    path: `/api/deals/timeline?${params.toString()}`,
  });
}

export async function fetchAiMetricsRequest({ days = 30 } = {}) {
  const params = new URLSearchParams({
    days: String(days),
  });
  return bridgeRequest<AiMetricsResponse>({
    path: `/api/observability/ai-metrics?${params.toString()}`,
  });
}

export async function fetchSkillOutcomesRequest() {
  return bridgeRequest<SkillOutcomesResponse>({
    path: '/api/skills/outcomes',
  });
}

export async function fetchSkillTrendsRequest({
  skillId = '',
  skillName = '',
  days = 30,
}: {
  skillId?: string;
  skillName?: string;
  days?: number;
} = {}) {
  const params = new URLSearchParams({
    days: String(days),
  });
  if (skillId) params.set('skillId', skillId);
  if (skillName) params.set('skillName', skillName);
  return bridgeRequest<SkillTrendsResponse>({
    path: `/api/skills/trends?${params.toString()}`,
  });
}

export async function fetchActiveExperimentsRequest() {
  return bridgeRequest<ActiveExperimentsResponse>({
    path: '/api/emotion/policies/experiments',
  });
}

export async function fetchMemoryEventsRequest({ limit = 40 } = {}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(200, limit))),
  });
  return bridgeRequest<MemoryEventsResponse>({
    path: `/api/memory/events?${params.toString()}`,
  });
}

export async function fetchCampaignsRequest({
  search = '',
  status = 'all',
  channel = 'all',
}: {
  search?: string;
  status?: string;
  channel?: string;
} = {}) {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (status && status !== 'all') params.set('status', status);
  if (channel && channel !== 'all') params.set('channel', channel);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return bridgeRequest<CampaignsResponse>({
    path: `/api/campaigns${suffix}`,
  });
}

export async function fetchCampaignLeadSourcesRequest() {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    sources?: CampaignLeadSource[];
    state?: RuntimeSnapshot;
  }>({
    path: '/api/campaigns/lead-sources',
  });
}

export async function fetchCampaignRankedTemplatesRequest({
  channel = 'email',
  leadSource = 'all-imports',
  campaignId = '',
  limit = 8,
}: {
  channel?: string;
  leadSource?: string;
  campaignId?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams({
    channel,
    leadSource,
    limit: String(Math.max(1, Math.min(24, limit))),
  });
  if (campaignId.trim()) params.set('campaignId', campaignId.trim());
  return bridgeRequest<CampaignRankedTemplatesResponse>({
    path: `/api/campaigns/templates/ranked?${params.toString()}`,
  });
}

export async function fetchCampaignDrilldownRequest({
  range = '30d',
  campaignId = 'all',
  source = 'all',
  channel = 'all',
  status = 'all',
  limit = 120,
}: {
  range?: string;
  campaignId?: string;
  source?: string;
  channel?: string;
  status?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams({
    range,
    campaignId,
    source,
    channel,
    status,
    limit: String(Math.max(1, Math.min(500, limit))),
  });
  return bridgeRequest<CampaignDrilldownResponse>({
    path: `/api/analytics/campaign-drilldown?${params.toString()}`,
  });
}

export async function fetchReplyTemplatesRequest({
  channel = 'email',
  leadName = '',
  address = '',
  body = '',
}: {
  channel?: string;
  leadName?: string;
  address?: string;
  body?: string;
} = {}) {
  const params = new URLSearchParams({
    channel,
  });
  if (leadName.trim()) params.set('leadName', leadName.trim());
  if (address.trim()) params.set('address', address.trim());
  if (body.trim()) params.set('body', body.trim());
  return bridgeRequest<ReplyTemplatesResponse>({
    path: `/api/replies/templates?${params.toString()}`,
  });
}

export async function createCampaignRequest(body: Record<string, unknown>) {
  return bridgeRequest<CampaignsResponse & { campaign?: CampaignRecord }>({
    method: 'POST',
    path: '/api/campaigns',
    body,
  });
}

export async function patchCampaignRequest(campaignId: string, body: Record<string, unknown>) {
  return bridgeRequest<CampaignsResponse & { campaign?: CampaignRecord }>({
    method: 'PATCH',
    path: `/api/campaigns/${encodeURIComponent(campaignId)}`,
    body,
  });
}

export async function requestCampaignApprovalRequest(
  campaignId: string,
  body: Record<string, unknown>
) {
  return bridgeRequest<
    CampaignsResponse & { campaign?: CampaignRecord; approval?: ApprovalRecord }
  >({
    method: 'POST',
    path: `/api/campaigns/${encodeURIComponent(campaignId)}/approval`,
    body,
  });
}

export async function runCampaignActionRequest(campaignId: string, body: Record<string, unknown>) {
  return bridgeRequest<CampaignsResponse & { campaign?: CampaignRecord }>({
    method: 'POST',
    path: `/api/campaigns/${encodeURIComponent(campaignId)}/actions`,
    body,
  });
}

export async function recordCampaignEventRequest(
  campaignId: string,
  body: Record<string, unknown>
) {
  return bridgeRequest<CampaignsResponse & { event?: CampaignEventRecord }>({
    method: 'POST',
    path: `/api/campaigns/${encodeURIComponent(campaignId)}/events`,
    body,
  });
}

export async function fetchMessagesRequest({ limit = 80, offset = 0 } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return bridgeRequest<{
    ok: boolean;
    count?: number;
    limit?: number;
    offset?: number;
    messages?: MessageRecord[];
  }>({
    path: `/api/messages?${params.toString()}`,
  });
}

export async function archiveMessageRequest(messageId: string, body: Record<string, unknown> = {}) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    message?: MessageRecord;
    state?: RuntimeSnapshot;
    error?: string;
  }>({
    method: 'PATCH',
    path: `/api/messages/${encodeURIComponent(messageId)}/archive`,
    body: {
      archived: true,
      actor: 'PBK React shell',
      ...body,
    },
  });
}

export async function sendMessageRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/lead/send-message',
    body,
  });
}

export async function fetchCurrentScriptRequest(body: Record<string, unknown>) {
  return bridgeRequest<CurrentScriptResponse>({
    method: 'POST',
    path: '/api/scripts/current',
    body,
  });
}

export async function scheduleMessageRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/messages',
    body,
  });
}

export async function scheduleAppointmentRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/appointments',
    body,
  });
}

export async function cancelScheduledCallRequest(
  appointmentId: string,
  body: Record<string, unknown> = {}
) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/appointments',
    body: {
      ...body,
      id: appointmentId,
      status: 'cancelled',
      actor: body.actor || 'PBK React shell',
      notes: body.notes || 'Cancelled from the PBK call floor.',
    },
  });
}

export async function saveLeadNoteRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/leads/add-note',
    body,
  });
}

export async function sendOfferEmailRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/cold-email/send',
    body,
  });
}

export async function updateAdminTaskDecision(taskId: string, status: string) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'PUT',
    path: `/api/admin/tasks/${encodeURIComponent(taskId)}`,
    body: {
      status,
      actor: 'PBK React shell',
      notes: `React shell marked task ${status}.`,
    },
  });
}

export async function controlRuntimeCall(
  callId: string,
  action: string,
  extra: Record<string, unknown> = {}
) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: `/api/calls/${encodeURIComponent(callId)}/action`,
    body: {
      action,
      actor: 'PBK React shell',
      ...extra,
    },
  });
}

export async function queryBrainRequest(query: string) {
  return invokeRuntimeTool<Record<string, unknown>>('getBrainState', { query });
}

export async function launchBrowserResearchRequest(body: Record<string, unknown>) {
  return invokeRuntimeTool<Record<string, unknown>>('launchBrowserResearch', body);
}

export async function retrieveClosingIntelligenceRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/brain/retrieve',
    body,
  });
}

export async function getAvaConversationIntelligenceRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/ava/conversation-intelligence',
    body,
  });
}

export async function getProsodyAdviceRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/voice/prosody',
    body,
  });
}

export async function scoreCallQualityRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/calls/qa-score',
    body,
  });
}

export async function recordSkillOutcomeRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/skills/outcomes',
    body,
  });
}

export async function runRexSkillAutopilotRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/rex/skill-autopilot',
    body,
  });
}

export async function requestHumanHandoffRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/handoff/human',
    body,
  });
}

export async function retrieveSimilarDealsRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/deals/similar',
    body,
  });
}

export async function recallConversationMemoryRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/memory/conversation',
    body,
  });
}

export async function webSearchRequest(body: Record<string, unknown>) {
  const result = await bridgeRequest<Record<string, unknown> & SearchCognitionResult>({
    method: 'POST',
    path: '/api/brain/web-search',
    body,
  });
  return {
    ...result,
    snnAdapter: injectWebSearchCognition(result),
  };
}

export async function fetchWebSearchStatusRequest() {
  return bridgeRequest<Record<string, unknown>>({
    path: '/api/brain/web-search/status',
  });
}

export async function sendSellerDocsRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/send-seller-docs',
    body,
  });
}

export async function fetchLeadFullRequest(leadId: string) {
  return bridgeRequest<Record<string, unknown>>({
    path: `/api/leads/${encodeURIComponent(leadId)}/full`,
  });
}

export async function fetchLeadLastCallRequest(leadId: string) {
  return bridgeRequest<Record<string, unknown>>({
    path: `/api/leads/${encodeURIComponent(leadId)}/last-call`,
  });
}

export async function patchLeadRequest(leadId: string, body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'PATCH',
    path: `/api/leads/${encodeURIComponent(leadId)}`,
    body,
  });
}

export async function sendLeadContractRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/contract/send',
    body,
  });
}

export async function prepareContractRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/contracts/prepare',
    body,
  });
}

export async function requestAdminActionRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/admin/request',
    body,
  });
}

export function buildAnalyzePayload(deal: DealData) {
  return {
    address: deal.address,
    type: deal.type,
    contact: deal.contact === 'realtor' ? 'agent' : deal.contact,
    price: deal.price,
    agreedPrice: deal.agreedPrice,
    beds: deal.beds,
    baths: deal.baths,
    sqft: deal.sqft,
    year: deal.year,
    dom: deal.dom,
    lotSize: Number(deal.lotSize || 0),
    repairs: deal.repairs?.mid || 0,
    notes: deal.notes || '',
  };
}

export async function syncDealAnalysis(deal: DealData) {
  return invokeRuntimeTool<Record<string, unknown>>('analyzeDeal', buildAnalyzePayload(deal));
}

export async function sendDealToAgent(
  deal: DealData,
  options: { agentDealContext?: AgentDealContext } = {}
) {
  const agentDealContext =
    options.agentDealContext ||
    buildAgentDealContext(deal, {
      requestedBy: 'Analyzer runtime bridge',
    });
  return invokeRuntimeTool<Record<string, unknown>>('updateCRM', {
    target: deal.address || deal.sellerName || 'deal',
    leadId: deal.address || deal.sellerPhone || deal.sellerEmail || 'manual-deal',
    message: `Analyzer synced ${deal.address || 'deal'} to the runtime for ${deal.selectedPath || 'cash'} follow-up. Agent context includes ${agentDealContext.scriptPath}/${agentDealContext.scriptVariant}/${agentDealContext.activeScriptTab} script.`,
    deal,
    agentDealContext,
  });
}
