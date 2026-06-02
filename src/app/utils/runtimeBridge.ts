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
  source?: string;
  status?: string;
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
  to?: string;
  body?: string;
  status?: string;
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
};

export type RuntimeSnapshot = {
  status?: Record<string, unknown>;
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
      if (candidate && candidate !== window && (candidate as Window & { PBK?: Record<string, unknown> }).PBK) {
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
    apiKey: '',
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
  const keys = [
    `pbk:${getStorageEnvironment()}:openclaw-config`,
    'pbk-openclaw-config',
  ];
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
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  const endpoint =
    env.VITE_PBK_BRIDGE_URL ||
    env.VITE_PBK_OPENCLAW_URL ||
    env.VITE_PBK_OPENCLAW_ENDPOINT;
  if (!endpoint) return null;

  return {
    endpoint,
    apiKey: env.VITE_PBK_BRIDGE_API_KEY || env.VITE_PBK_OPENCLAW_API_KEY || '',
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  const hostPBK = getHostPBK();
  const fromHost = typeof hostPBK?.openclaw === 'object' && typeof (hostPBK.openclaw as { getConfig?: () => RuntimeConfig }).getConfig === 'function'
    ? (hostPBK.openclaw as { getConfig: () => RuntimeConfig }).getConfig()
    : null;

  if (fromHost?.endpoint) return fromHost;

  const stored = readRuntimeConfigFromStorage();
  if (stored?.endpoint) {
    const localFallback = buildLocalBridgeFallback();
    if (localFallback && !stored.apiKey && String(stored.endpoint) !== String(localFallback.endpoint)) {
      return localFallback;
    }
    return stored;
  }

  const localFallback = buildLocalBridgeFallback();
  if (localFallback) return localFallback;

  const envConfig = getEnvRuntimeConfig();
  if (envConfig?.endpoint) return envConfig;

  return {
    endpoint: DEFAULT_HOSTED_BRIDGE_ENDPOINT || window.location.origin,
    apiKey: '',
  };
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
    agents: workers.map((worker) => (worker as Worker & { pbkAgentId?: string }).pbkAgentId || 'unknown'),
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
  const serializedBody = body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined;
  const canKeepalive = method !== 'GET' && method !== 'DELETE' && (!serializedBody || serializedBody.length < 60000);
  const requestUrl = buildUrl(path);
  const init = {
    method,
    headers: buildHeaders(body !== undefined && method !== 'GET'),
    body: serializedBody,
    keepalive: keepalive ?? canKeepalive,
  };
  let response = await fetch(requestUrl, init);
  if (await shouldRetryRuntimeViaHosted(response, requestUrl)) {
    const fallbackUrl = buildHostedRuntimeFallbackUrl(requestUrl);
    if (fallbackUrl) response = await fetch(fallbackUrl, init);
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
        : `Bridge request failed (${response.status})`,
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
    return new URL(`${current.pathname}${current.search}`, `${DEFAULT_HOSTED_BRIDGE_ENDPOINT}/`).toString();
  } catch {
    return '';
  }
}

async function shouldRetryRuntimeViaHosted(response: Response, url = '') {
  if (!buildHostedRuntimeFallbackUrl(url)) return false;
  if (response.status !== 503) return false;
  const text = await response.clone().text().catch(() => '');
  return /usage_exceeded/i.test(text) || /Usage exceeded/i.test(text);
}

export async function invokeRuntimeTool<T = unknown>(toolName: string, params: Record<string, unknown> = {}) {
  return bridgeRequest<T>({
    method: 'POST',
    path: '/invoke',
    body: { toolName, params },
  });
}

export async function fetchRuntimeState() {
  return bridgeRequest<RuntimeSnapshot>({
    path: '/state',
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
    controller.signal.addEventListener('abort', () => reject(new Error('tooling_status_timeout'))),
  );
  try {
    const response = await Promise.race([
      bridgeRequest<{ ok: boolean; tooling: RuntimeToolingStatus }>({ path: '/api/tooling/status' }),
      timeout$,
    ]);
    return (response as { ok: boolean; tooling: RuntimeToolingStatus }).tooling || {};
  } finally {
    clearTimeout(handle);
  }
}

export function getSnnWorkerStatus(): { ava: boolean; rex: boolean } {
  return { ava: avaSnnWorker !== null, rex: rexSnnWorker !== null };
}

export async function postRuntimeEvent<T = Record<string, unknown>>(eventType: string, payload: Record<string, unknown>) {
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

export async function controlRuntimeCall(callId: string, action: string, extra: Record<string, unknown> = {}) {
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

export async function sendDealToAgent(deal: DealData, options: { agentDealContext?: AgentDealContext } = {}) {
  const agentDealContext = options.agentDealContext || buildAgentDealContext(deal, {
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
