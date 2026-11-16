import type { Handler, HandlerResponse } from '@netlify/functions';
import { getAvaChatRequiredPermissions } from '../../scripts/ava-team-chat-permissions.mjs';

const MAX_BODY_BYTES = 5 * 1024 * 1024; // Headroom under Netlify's buffered request limit.

const BRIDGE_URL = String(
  process.env.PBK_BRIDGE_URL
    || process.env.PBK_PUBLIC_BRIDGE_URL
    || 'https://pbk-openclaw-bridge.onrender.com',
).replace(/\/+$/g, '');

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': [
    'Authorization',
    'Content-Type',
    'Idempotency-Key',
    'X-Idempotency-Key',
    'X-PBK-Team-Token',
    'X-PBK-Webhook-Secret',
    'X-Webhook-Secret',
    'X-PBK-Signature',
    'X-Request-ID',
  ].join(', '),
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const DEFAULT_ALLOWED_ORIGINS = [
  'https://pbkcommandcenter.netlify.app',
  'https://pbk-openclaw-bridge.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function getAllowedOrigins() {
  const configured = String(process.env.PBK_ALLOWED_ORIGINS || process.env.PBK_CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function buildCorsHeaders(event?: Parameters<Handler>[0]) {
  const headers: Record<string, string> = { ...CORS_HEADERS, Vary: 'Origin' };
  const origin = event ? getHeader(event, 'origin') : '';
  if (origin && getAllowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'content-type',
  'idempotency-key',
  'x-idempotency-key',
  'x-pbk-team-token',
  'x-pbk-webhook-secret',
  'x-webhook-secret',
  'x-pbk-signature',
  'x-request-id',
]);

const FORWARDED_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-disposition',
  'content-type',
  'etag',
  'last-modified',
  'x-pbk-bridge',
  'x-pbk-pdf-renderer',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-request-id',
  'retry-after',
]);

const PUBLIC_PROXY_READ_PATHS = new Set([
  '/health',
  '/status',
  '/api/health',
  '/api/status',
  '/api/auth/team/status',
]);

const PUBLIC_PROXY_POST_PATHS = new Set([
  '/api/auth/team',
  '/api/auth/team/verify',
  '/api/public/ava-chat',
  '/public/ava-chat',
]);

function json(payload: unknown, statusCode = 200, extraHeaders: Record<string, string> = {}, event?: Parameters<Handler>[0]) {
  return {
    statusCode,
    headers: {
      ...buildCorsHeaders(event),
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function normalizeProxyPath(eventPath = '', requestedPath = '') {
  let raw = String(requestedPath || '').trim()
    || String(eventPath || '').replace(/^\/\.netlify\/functions\/pbk-bridge-proxy\/?/, '');

  for (let pass = 0; pass < 4; pass += 1) {
    let decoded = '';
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      throw new Error('invalid_proxy_path');
    }
    if (decoded === raw) break;
    raw = decoded;
    if (pass === 3) throw new Error('invalid_proxy_path');
  }

  if (/[\0\\]/.test(raw)) throw new Error('invalid_proxy_path');
  const segments = raw.replace(/^\/+/, '').split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('invalid_proxy_path');
  }

  const path = `/${segments.filter(Boolean).join('/')}`;
  return path === '/' ? '/health' : path;
}

function parseJsonBody(body?: Buffer) {
  if (!body?.byteLength) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function collectBodyText(body: Record<string, unknown>, keys: string[]) {
  return keys
    .map((key) => body[key])
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .trim();
}

function getToolName(body: Record<string, unknown>) {
  const params = body.params && typeof body.params === 'object'
    ? body.params as Record<string, unknown>
    : {};
  return String(
    body.toolName
      || body.tool
      || body.name
      || params.toolName
      || params.tool
      || params.name
      || '',
  ).trim();
}

function isAssistantChatPath(path = '') {
  return path === '/api/assistant/chat' || path === '/api/v1/assistant/chat';
}

function isApprovalDecisionRequest(method = 'GET', path = '', body: Record<string, unknown>) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(normalizedMethod)) return false;
  if (!/^\/api\/approvals\/[^/]+(?:\/[^/]+)?$/.test(path)) return false;
  const decisionText = `${path} ${collectBodyText(body, ['status', 'action', 'decision'])}`.toLowerCase();
  return /\b(?:approve|approved)\b/.test(decisionText);
}

function isConfirmedLeadDeleteRequest(method = 'GET', path = '', body: Record<string, unknown>) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (normalizedMethod !== 'DELETE') return false;
  if (!/^\/api\/leads\/[^/]+$/.test(path)) return false;
  const reason = String(body.reason || body.deleteReason || '').trim();
  return reason === 'operator_confirmed_delete';
}

function authorizeTeamRequest({
  method = 'GET',
  targetPath = '',
  body = {},
  permissions = {},
}: {
  method?: string;
  targetPath?: string;
  body?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
}) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedPath = String(targetPath || '').toLowerCase();
  const toolName = getToolName(body);
  const normalizedToolName = toolName.toLowerCase();
  const chatPermissions = getAvaChatRequiredPermissions(normalizedPath, body);

  const deny = (permission: string, action: string) => ({
    ok: false as const,
    statusCode: 403,
    error: `This team session is not permitted to ${action}.`,
    code: 'team_permission_denied',
    permission,
  });

  const confirmedLeadDelete = isConfirmedLeadDeleteRequest(normalizedMethod, normalizedPath, body);
  if (confirmedLeadDelete && permissions.canDeleteLeads !== true) {
    return deny('canDeleteLeads', 'delete confirmed leads');
  }

  if (normalizedMethod === 'DELETE' && !confirmedLeadDelete && permissions.canDeleteData !== true) {
    return deny('canDeleteData', 'delete PBK data');
  }

  const contractTool = /^(?:sendcontract|senddocusign|prepare_and_send_contract|preparecontract|sendnegotiationapproval)$/i.test(toolName);
  const contractRoute =
    normalizedMethod !== 'GET'
    && (
      /(?:contract|docusign|document-deliver)/.test(normalizedPath)
      || normalizedPath === '/api/underwriting/sign'
    );
  if ((contractTool || contractRoute) && permissions.canSendContracts !== true) {
    return deny('canSendContracts', 'send or modify contracts');
  }

  const smsTool = /^(?:telnyx_sms|send_verification_sms)$/i.test(toolName);
  const smsRoute =
    normalizedMethod !== 'GET'
    && /(?:\/api\/messages|\/api\/conversation|\/api\/conversations|\/api\/sms|\/api\/inbox)/.test(normalizedPath)
    && /sms|message|conversation|inbox/.test(normalizedPath);
  const assistantSmsIntent = chatPermissions.has('canSendSms');
  if ((smsTool || smsRoute || assistantSmsIntent) && permissions.canSendSms !== true) {
    return deny('canSendSms', 'send SMS messages');
  }

  const emailTool = /^(?:sendcoldemail|pbk_send_update)$/i.test(toolName);
  const emailRoute =
    normalizedMethod !== 'GET'
    && /(?:\/api\/cold-email|\/api\/messages|\/api\/conversation|\/api\/conversations|\/api\/email|\/api\/inbox)/.test(normalizedPath)
    && /email|mail|message|conversation|inbox/.test(normalizedPath);
  const assistantEmailIntent = chatPermissions.has('canSendEmail');
  if ((emailTool || emailRoute || assistantEmailIntent) && permissions.canSendEmail !== true) {
    return deny('canSendEmail', 'send emails');
  }

  const callTool = /^(?:telnyx_call|pbk_call_operator)$/i.test(toolName);
  const callRoute =
    normalizedMethod !== 'GET'
    && /(?:\/api\/calls|\/api\/operator\/call|\/api\/call)/.test(normalizedPath);
  const assistantCallIntent = chatPermissions.has('canPlaceCalls');
  if ((callTool || callRoute || assistantCallIntent) && permissions.canPlaceCalls !== true) {
    return deny('canPlaceCalls', 'place calls');
  }

  const providerApprovalTool = /^(?:startnurturesequence|processduenurturesteps|telnyx_call|telnyx_sms|sendcoldemail|pbk_send_update|send_verification_sms)$/i.test(toolName);
  const providerApprovalRoute =
    isApprovalDecisionRequest(normalizedMethod, normalizedPath, body)
    || (
      normalizedMethod !== 'GET'
      && /(?:\/api\/provider-writes|\/api\/outbound|\/api\/nurture|\/api\/campaigns\/[^/]+\/approval)/.test(normalizedPath)
    );
  const assistantProviderApprovalIntent = chatPermissions.has('canApproveProviderActions');
  if (
    (providerApprovalTool || providerApprovalRoute || assistantProviderApprovalIntent)
    && permissions.canApproveProviderActions !== true
  ) {
    return deny('canApproveProviderActions', 'approve provider actions');
  }

  const killSwitchTool = /^(?:pbk_kill_switch|killswitch|togglekillswitch)$/i.test(toolName);
  const killSwitchRoute =
    normalizedMethod !== 'GET'
    && /(?:kill-switch|killswitch)/.test(normalizedPath);
  if ((killSwitchTool || killSwitchRoute) && permissions.canToggleKillSwitch !== true) {
    return deny('canToggleKillSwitch', 'change the PBK kill switch');
  }

  const skillGovernanceTool =
    /^(?:approveskillversion|activateskillversion|rollbackskillactivation|createskillcandidate|reloadskills|ingestskill)$/i.test(toolName);
  const skillGovernanceRoute =
    normalizedMethod !== 'GET'
    && /(?:\/api\/skills\/(?:candidates|ingest|import-from-article|versions\/[^/]+\/(?:approve|activate)|activations\/[^/]+\/rollback|reload|outcomes)(?:\/|$))/.test(normalizedPath);
  if ((skillGovernanceTool || skillGovernanceRoute) && permissions.canManageSkills !== true) {
    return deny('canManageSkills', 'manage Ava skills and governance');
  }

  const guardrailTool =
    /^(?:admin_update_env_var|admin_restart_openclaw|admin_run_away_worker|routeadmincommand|requestadminaction)$/i.test(toolName)
    || /^admin_/.test(normalizedToolName);
  const guardrailRoute =
    normalizedMethod !== 'GET'
    && /(?:\/api\/admin(?:\/|$)|\/api\/auth\/totp|\/api\/settings(?:\/|$)|\/api\/guardrails|\/api\/desktop-sidecar\/command)/.test(normalizedPath);
  if ((guardrailTool || guardrailRoute) && permissions.canChangeGuardrails !== true) {
    return deny('canChangeGuardrails', 'change infrastructure or security guardrails');
  }

  return { ok: true as const, statusCode: 200 };
}

function appendQueryParams(url: URL, event: Parameters<Handler>[0]) {
  const multi = event.multiValueQueryStringParameters || {};
  const single = event.queryStringParameters || {};
  const seen = new Set<string>();

  for (const [key, values] of Object.entries(multi)) {
    if (key === 'path') continue;
    seen.add(key);
    for (const value of values || []) url.searchParams.append(key, value);
  }

  for (const [key, value] of Object.entries(single)) {
    if (key === 'path' || seen.has(key) || value == null) continue;
    url.searchParams.append(key, value);
  }
}

function getHeader(event: Parameters<Handler>[0], name: string) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (key.toLowerCase() === wanted) return String(value || '').trim();
  }
  return '';
}

function getRequestId(event: Parameters<Handler>[0]) {
  return getHeader(event, 'x-request-id')
    || `pbk-netlify-proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildRequestHeaders(event: Parameters<Handler>[0], requestId: string) {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers || {})) {
    const lower = name.toLowerCase();
    if (!FORWARDED_REQUEST_HEADERS.has(lower) || value == null) continue;
    if (lower === 'x-request-id') continue; // Set one canonical key below, not two differently cased keys.
    headers[name] = value;
  }
  const bridgeApiKey = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
  if (bridgeApiKey) {
    headers.Authorization = `Bearer ${bridgeApiKey}`;
  }
  const clientIp = getHeader(event, 'x-nf-client-connection-ip')
    || getHeader(event, 'cf-connecting-ip')
    || getHeader(event, 'x-forwarded-for').split(',')[0]?.trim()
    || '';
  if (clientIp) headers['X-PBK-Client-IP'] = clientIp;
  headers['X-PBK-Netlify-Proxy'] = 'pbk-bridge-proxy';
  headers['X-Request-ID'] = requestId;
  return headers;
}

function isPublicProxyRequest(method = 'GET', targetPath = '') {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (
    targetPath.startsWith('/api/public/') ||
    targetPath.startsWith('/public/')
  ) {
    return true;
  }
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') {
    return PUBLIC_PROXY_READ_PATHS.has(targetPath);
  }
  return normalizedMethod === 'POST' && PUBLIC_PROXY_POST_PATHS.has(targetPath);
}

async function verifyTeamSession(
  event: Parameters<Handler>[0],
  requestId: string,
  signal?: AbortSignal,
) {
  const token = getHeader(event, 'x-pbk-team-token');
  if (!token || token.length > 4096) {
    return {
      ok: false,
      statusCode: 401,
      error: 'PBK team session required.',
      code: 'team_auth_required',
    };
  }
  const bridgeApiKey = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
  if (!bridgeApiKey) {
    return {
      ok: false,
      statusCode: 503,
      error: 'Netlify bridge authentication is not configured.',
      code: 'proxy_bridge_auth_not_configured',
    };
  }

  const controller = new AbortController();
  const onDisconnect = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onDisconnect, { once: true });
  if (signal?.aborted) onDisconnect();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${BRIDGE_URL}/api/auth/team/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bridgeApiKey}`,
        'Content-Type': 'application/json',
        'X-PBK-Team-Token': token,
        'X-PBK-Netlify-Proxy': 'pbk-bridge-proxy',
        'X-Request-ID': requestId,
      },
      body: JSON.stringify({ source: 'netlify-bridge-proxy' }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || payload?.ok !== true) {
      // Verifier outages and malformed responses are not proof of session revocation.
      const sessionRejected = response.status === 401
        && /^(?:team_auth_required|invalid_team_session|invalid_team_session_payload|expired_team_session|missing_team_session)$/.test(String(payload?.code || ''));
      const unavailableStatus = response.status === 429 || (response.status >= 500 && response.status <= 599)
        ? response.status : 502;
      return {
        ok: false,
        statusCode: sessionRejected ? 401 : unavailableStatus,
        error: sessionRejected
          ? String(payload.error || 'PBK team session is invalid or expired.')
          : 'PBK team session could not be verified.',
        code: sessionRejected ? String(payload.code) : 'team_auth_verification_unavailable',
      };
    }
    const permissions =
      payload.permissions && typeof payload.permissions === 'object'
        ? payload.permissions as Record<string, unknown>
        : {};
    return { ok: true, statusCode: 200, permissions };
  } catch (error) {
    return {
      ok: false,
      statusCode: error instanceof Error && error.name === 'AbortError' ? 504 : 502,
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'PBK team session verification timed out.'
          : 'PBK team session could not be verified.',
      code: 'team_auth_verification_unavailable',
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onDisconnect);
  }
}

function isTextResponse(contentType = '') {
  return /json|text|javascript|xml|html|csv|svg/i.test(contentType);
}

function compactHealthPayload(payload: Record<string, any>) {
  const components = payload.components && typeof payload.components === 'object' ? payload.components : {};
  const providers = payload.providers && typeof payload.providers === 'object' ? payload.providers : {};
  const providerStatuses = Object.fromEntries(
    Object.entries(providers).map(([name, value]) => {
      if (typeof value === 'string') return [name, value];
      if (value && typeof value === 'object') {
        const meta = value as Record<string, any>;
        return [name, meta.status || meta.readiness || meta.ready || meta.configured || 'unknown'];
      }
      return [name, 'unknown'];
    }),
  );

  const runtime = payload.runtime && typeof payload.runtime === 'object' ? payload.runtime as Record<string, any> : {};
  const postgres = components.postgres && typeof components.postgres === 'object'
    ? components.postgres as Record<string, any>
    : {};

  return {
    ok: payload.ok !== false,
    status: payload.status || 'unknown',
    service: payload.service || 'pbk-openclaw-bridge',
    revision: payload.revision || '',
    checkedAt: payload.checkedAt || new Date().toISOString(),
    hosted: payload.hosted ?? payload.mode === 'hosted',
    stateBackend: payload.stateBackend || payload.state_backend || runtime.stateBackend || runtime.state_backend || '',
    databaseStatus: postgres.status || postgres.state || '',
    providers: providerStatuses,
    componentCount: Object.keys(components).length,
    healthStatus: payload.healthStatus || payload.status || 'unknown',
  };
}

const STATE_ARRAY_LIMITS: Record<string, number> = {
  activity: 120,
  adminAudit: 80,
  adminTasks: 80,
  agentTasks: 80,
  analyzerRuns: 80,
  approvals: 120,
  brainBlogPosts: 60,
  brainDocs: 80,
  browserResearchJobs: 80,
  callQaScores: 120,
  calls: 120,
  campaignRecords: 100,
  campaigns: 100,
  contracts: 120,
  documentDeliveries: 120,
  leadImports: 250,
  messages: 250,
  recordings: 120,
  revenueActions: 120,
  skillOutcomes: 120,
};

const OMIT_STATE_KEYS = /^(?:embedding|embeddings|vector|vectors|audioBuffer|audioBytes|base64|rawAudio|rawPayload|rawResponse)$/i;
const HEAVY_TEXT_KEYS = /(?:body|content|html|markdown|memo|notes|raw|summary|text|transcript)$/i;

function compactStateValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    const limit = depth <= 2 ? 5000 : 1800;
    return value.length > limit ? `${value.slice(0, limit)}...` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const limit = depth <= 1 ? 40 : 20;
    return value.slice(0, limit).map((item) => compactStateValue(item, depth + 1));
  }

  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (OMIT_STATE_KEYS.test(key)) continue;
    if (typeof nested === 'string' && HEAVY_TEXT_KEYS.test(key)) {
      const limit = depth <= 1 ? 5000 : 1800;
      next[key] = nested.length > limit ? `${nested.slice(0, limit)}...` : nested;
      continue;
    }
    next[key] = compactStateValue(nested, depth + 1);
  }
  return next;
}

function compactStatePayload(payload: Record<string, any>) {
  const arrayCounts: Record<string, number> = {};
  const compact: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload || {})) {
    if (Array.isArray(value)) {
      const limit = STATE_ARRAY_LIMITS[key] || 80;
      arrayCounts[key] = value.length;
      compact[key] = value.slice(0, limit).map((item) => compactStateValue(item, 1));
      continue;
    }
    compact[key] = compactStateValue(value, 1);
  }

  compact.compact = true;
  compact.compactMeta = {
    source: 'netlify-bridge-proxy',
    arrayCounts,
    note: 'Large hosted bridge state compacted below Netlify response limits; use the direct bridge for full exports.',
  };

  return compact;
}

function shouldCompactHealthResponse(targetPath = '') {
  return ['/health', '/status', '/api/health', '/api/status'].includes(targetPath);
}

function shouldCompactStateResponse(targetPath = '') {
  return ['/state', '/api/state'].includes(targetPath);
}

function shouldCompactCampaignResponse(targetPath = '') {
  return ['/api/campaigns', '/api/campaigns/lead-sources'].includes(targetPath);
}

function compactCampaignPayload(payload: Record<string, any>) {
  const compact = { ...payload };
  delete compact.state;
  delete compact.runtimeState;
  delete compact.snapshot;
  compact.compact = true;
  compact.compactMeta = {
    source: 'netlify-bridge-proxy',
    note: 'Full bridge state is omitted from campaign reads to keep the command center under Netlify function response limits.',
  };
  return compact;
}

function bodyTooLarge(event: Parameters<Handler>[0], requestId: string) {
  return {
    statusCode: 413,
    headers: { 'Content-Type': 'application/json', ...buildCorsHeaders(event), 'X-Request-ID': requestId },
    body: JSON.stringify({ ok: false, error: 'Request body too large', maxBytes: MAX_BODY_BYTES, requestId }),
  };
}

// Relay bytes unchanged; the bridge alone owns answer/done events and their payloads.
function forwardStream(body: ReadableStream<Uint8Array>, abort: AbortController, cleanup: () => void) {
  const reader = body.getReader();
  let ended = false;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    if (ended) return false;
    ended = true;
    abort.signal.removeEventListener('abort', onAbort);
    cleanup();
    return true;
  };
  const cancelReader = (reason: unknown) => reader.cancel(reason).catch(() => {}).finally(() => reader.releaseLock());
  const onAbort = () => {
    if (!finish()) return;
    const error = abort.signal.reason || new Error('PBK bridge proxy stream aborted.');
    output.error(error);
    void cancelReader(error);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      abort.signal.addEventListener('abort', onAbort, { once: true });
      if (abort.signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (ended) return;
        if (chunk.done) {
          finish();
          reader.releaseLock();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        if (!finish()) return;
        controller.error(error);
        abort.abort(error);
        reader.releaseLock();
      }
    },
    cancel(reason) {
      if (!finish()) return;
      abort.abort(reason);
      return cancelReader(reason);
    },
  }, { highWaterMark: 0 });
}

async function proxyRequest(event: Parameters<Handler>[0], options: {
  streaming?: boolean;
  signal?: AbortSignal;
  body?: Buffer<ArrayBuffer>;
} = {}): Promise<HandlerResponse | Response> {
  const requestId = getRequestId(event);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...buildCorsHeaders(event),
        'X-Request-ID': requestId,
      },
      body: '',
    };
  }

  let targetPath = '';
  try {
    targetPath = normalizeProxyPath(event.path, event.queryStringParameters?.path || '');
  } catch {
    return json(
      {
        ok: false,
        error: 'Invalid bridge proxy path.',
        code: 'invalid_proxy_path',
        requestId,
      },
      400,
      { 'X-Request-ID': requestId },
      event,
    );
  }
  const targetUrl = new URL(targetPath, `${BRIDGE_URL}/`);
  if (targetUrl.pathname.replace(/\/+$/, '') === '/api/leads/batch-apply') {
    return json({ ok: false, error: 'Batch apply requires direct operator authentication.' }, 403, {}, event);
  }
  appendQueryParams(targetUrl, event);

  const hasBody = !['GET', 'HEAD'].includes(String(event.httpMethod || 'GET').toUpperCase()) && (event.body != null || options.body != null);
  const body = hasBody
    ? options.body ?? Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8')
    : undefined;

  if (body && body.byteLength > MAX_BODY_BYTES) {
    return bodyTooLarge(event, requestId);
  }

  if (!isPublicProxyRequest(event.httpMethod, targetPath)) {
    const teamSession = await verifyTeamSession(event, requestId, options.signal);
    if (!teamSession.ok) {
      return json(
        {
          ok: false,
          error: teamSession.error,
          code: teamSession.code,
          requestId,
        },
        teamSession.statusCode,
        { 'X-Request-ID': requestId },
        event,
      );
    }
    const authorization = authorizeTeamRequest({
      method: event.httpMethod,
      targetPath,
      body: parseJsonBody(body),
      permissions: teamSession.permissions,
    });
    if (!authorization.ok) {
      return json(
        {
          ok: false,
          error: authorization.error,
          code: authorization.code,
          permission: authorization.permission,
          requestId,
        },
        authorization.statusCode,
        { 'X-Request-ID': requestId },
        event,
      );
    }
  }

  const PROXY_TIMEOUT_MS = isAssistantChatPath(targetPath) ? 40_000 : Math.max(
    5000,
    Math.min(25000, Number(process.env.PBK_BRIDGE_PROXY_TIMEOUT_MS || 20000)),
  );
  const abortController = new AbortController();
  const onDisconnect = () => abortController.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onDisconnect, { once: true });
  if (options.signal?.aborted) onDisconnect();
  let timedOut = false;
  let streamOwnsCleanup = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    abortController.abort(new Error('PBK bridge proxy timed out.'));
  }, PROXY_TIMEOUT_MS);
  const cleanup = () => {
    clearTimeout(timeoutHandle);
    options.signal?.removeEventListener('abort', onDisconnect);
  };

  try {
    abortController.signal.throwIfAborted();
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: buildRequestHeaders(event, requestId),
      body,
      signal: abortController.signal,
    });
    const responseHeaders: Record<string, string> = {
      ...buildCorsHeaders(event),
      'Cache-Control': response.headers.get('cache-control') || 'no-store',
      'X-PBK-Bridge-Proxy': 'netlify',
    };
    responseHeaders['X-Request-ID'] = response.headers.get('x-request-id') || requestId;
    for (const [name, value] of response.headers.entries()) {
      if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
    }

    const contentType = responseHeaders['content-type'] || responseHeaders['Content-Type'] || '';
    if (options.streaming && event.httpMethod === 'POST' && isAssistantChatPath(targetPath)
      && getHeader(event, 'accept').toLowerCase().includes('text/event-stream')
      && parseJsonBody(body).stream === true && /^text\/event-stream\b/i.test(contentType) && response.body) {
      const streamed = new Response(forwardStream(response.body, abortController, cleanup), {
        status: response.status,
        headers: webHeaders(responseHeaders),
      });
      streamOwnsCleanup = true;
      return streamed;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (['/api/leads', '/api/leads/import'].includes(targetPath) && isTextResponse(contentType)) {
      try {
        // The full roster's pretty-printed JSON can exceed Netlify's response limit.
        // Preserve every record, field, and alias; remove only transport whitespace.
        return json(JSON.parse(bytes.toString('utf8')), response.status, {
          'X-PBK-Bridge-Proxy': 'netlify',
          'X-Request-ID': responseHeaders['X-Request-ID'] || requestId,
        }, event);
      } catch {
        // Preserve upstream error bodies that are not JSON.
      }
    }
    if (shouldCompactHealthResponse(targetPath) && isTextResponse(contentType)) {
      try {
        const payload = JSON.parse(bytes.toString('utf8'));
        return json(compactHealthPayload(payload), response.status, {
          'X-PBK-Bridge-Proxy': 'netlify',
          'X-Request-ID': responseHeaders['X-Request-ID'] || requestId,
        }, event);
      } catch {
        // Fall through to the normal proxy response when upstream is not JSON.
      }
    }
    if (shouldCompactStateResponse(targetPath) && isTextResponse(contentType)) {
      try {
        const payload = JSON.parse(bytes.toString('utf8'));
        return json(compactStatePayload(payload), response.status, {
          'X-PBK-Bridge-Proxy': 'netlify',
          'X-Request-ID': responseHeaders['X-Request-ID'] || requestId,
        }, event);
      } catch {
        // Fall through to the normal proxy response when upstream is not JSON.
      }
    }
    if (shouldCompactCampaignResponse(targetPath) && isTextResponse(contentType)) {
      try {
        const payload = JSON.parse(bytes.toString('utf8'));
        return json(compactCampaignPayload(payload), response.status, {
          'X-PBK-Bridge-Proxy': 'netlify',
          'X-Request-ID': responseHeaders['X-Request-ID'] || requestId,
        }, event);
      } catch {
        // Fall through to the normal proxy response when upstream is not JSON.
      }
    }

    const textResponse = isTextResponse(contentType);
    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: textResponse ? bytes.toString('utf8') : bytes.toString('base64'),
      isBase64Encoded: !textResponse,
    };
  } catch (error) {
    timedOut ||= error instanceof Error && error.name === 'AbortError' && !options.signal?.aborted;
    return json(
      {
        ok: false,
        error: timedOut ? 'PBK bridge proxy timed out.' : 'PBK bridge proxy could not reach the hosted bridge.',
        message: timedOut ? `Bridge did not respond within ${PROXY_TIMEOUT_MS}ms.` : (error instanceof Error ? error.message : 'Unknown bridge proxy error'),
        target: targetPath,
        requestId,
      },
      timedOut ? 504 : 502,
      { 'X-Request-ID': requestId },
      event,
    );
  } finally {
    if (!streamOwnsCleanup) cleanup();
  }
}

// Keep the Lambda-compatible helper for fixtures without forcing Netlify API v1.
export const legacyHandler: Handler = (event) => proxyRequest(event) as Promise<HandlerResponse>;

function webHeaders(headers: HandlerResponse['headers'] = {}) {
  const result = new Headers();
  // Legacy responses may have differently cased keys; set instead of combining them.
  for (const [name, value] of Object.entries(headers)) {
    if (value != null) result.set(name, String(value));
  }
  return result;
}

function webResponse(result: HandlerResponse | Response, method: string) {
  if (result instanceof Response) return result;
  const noBody = method === 'HEAD' || [204, 205, 304].includes(result.statusCode);
  return new Response(noBody ? null : result.isBase64Encoded
    ? Buffer.from(result.body || '', 'base64') : result.body, {
    status: result.statusCode,
    headers: webHeaders(result.headers),
  });
}

async function readRequestBody(request: Request): Promise<Buffer<ArrayBuffer> | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const onDisconnect = () => { void reader.cancel(request.signal.reason).catch(() => {}); };
  request.signal.addEventListener('abort', onDisconnect, { once: true });
  if (request.signal.aborted) onDisconnect();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      request.signal.throwIfAborted();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel('Request body too large').catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    request.signal.removeEventListener('abort', onDisconnect);
    reader.releaseLock();
  }
}

// Modern Netlify Functions stream a web Response body without Lambda buffering.
export default async function fetchHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query: Record<string, string> = Object.create(null);
  const multi: Record<string, string[]> = Object.create(null);
  for (const [name, value] of url.searchParams) {
    query[name] ??= value;
    (multi[name] ??= []).push(value);
  }
  const event: Parameters<Handler>[0] = {
    httpMethod: request.method,
    path: url.pathname,
    rawUrl: request.url,
    rawQuery: url.search.slice(1),
    headers: Object.fromEntries(request.headers),
    multiValueHeaders: {},
    queryStringParameters: query,
    multiValueQueryStringParameters: multi,
    body: null,
    isBase64Encoded: false,
  };
  const requestId = getRequestId(event);
  event.headers['x-request-id'] = requestId;
  let body: Buffer<ArrayBuffer> | undefined;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
      void request.body?.cancel('Request body too large').catch(() => {});
      return webResponse(bodyTooLarge(event, requestId), request.method);
    }
    try {
      const bytes = await readRequestBody(request);
      if (bytes === null) return webResponse(bodyTooLarge(event, requestId), request.method);
      body = bytes;
    } catch {
      return webResponse(json({ ok: false, error: 'Could not read request body.', requestId }, 400,
        { 'X-Request-ID': requestId }, event), request.method);
    }
  }
  return webResponse(await proxyRequest(event, { streaming: true, signal: request.signal, body }), request.method);
}
