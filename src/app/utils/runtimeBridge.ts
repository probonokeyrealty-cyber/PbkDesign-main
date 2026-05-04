import { DealData } from '../types';

type RuntimeConfig = {
  endpoint?: string;
  apiKey?: string;
};

const DEFAULT_HOSTED_BRIDGE_ENDPOINT = 'https://pbk-openclaw-bridge.onrender.com';

export type RuntimeSnapshot = {
  status?: Record<string, unknown>;
  approvals?: Array<Record<string, unknown>>;
  activity?: Array<Record<string, unknown>>;
  brainDocs?: Array<Record<string, unknown>>;
  leadImports?: Array<Record<string, unknown>>;
  analyzerRuns?: Array<Record<string, unknown>>;
  calls?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  contracts?: Array<Record<string, unknown>>;
  documentDeliveries?: Array<Record<string, unknown>>;
  adminTasks?: Array<Record<string, unknown>>;
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

  try {
    const raw = window.localStorage.getItem('pbk-openclaw-config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.endpoint) {
        const localFallback = buildLocalBridgeFallback();
        if (localFallback && !parsed.apiKey && String(parsed.endpoint) !== String(localFallback.endpoint)) {
          return localFallback;
        }
        return parsed;
      }
    }
  } catch {
    // ignore localStorage parsing failure
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
  const response = await fetch(buildUrl(path), {
    method,
    headers: buildHeaders(body !== undefined && method !== 'GET'),
    body: serializedBody,
    keepalive: keepalive ?? canKeepalive,
  });

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
  const response = await bridgeRequest<{ ok: boolean; tooling: RuntimeToolingStatus }>({
    path: '/api/tooling/status',
  });
  return response.tooling || {};
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

export async function sendDealToAgent(deal: DealData) {
  return invokeRuntimeTool<Record<string, unknown>>('updateCRM', {
    target: deal.address || deal.sellerName || 'deal',
    leadId: deal.address || deal.sellerPhone || deal.sellerEmail || 'manual-deal',
    message: `Analyzer synced ${deal.address || 'deal'} to the runtime for ${deal.selectedPath || 'cash'} follow-up.`,
    deal,
  });
}
