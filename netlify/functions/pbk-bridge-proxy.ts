import type { Handler } from '@netlify/functions';

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

function getAssistantChatText(path = '', body: Record<string, unknown>) {
  if (!isAssistantChatPath(path)) return '';
  return collectBodyText(body, [
    'message',
    'prompt',
    'command',
    'request',
    'input',
    'text',
    'action',
    'assistantAction',
    'usedIntent',
  ]).toLowerCase();
}

function isApprovalDecisionRequest(method = 'GET', path = '', body: Record<string, unknown>) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(normalizedMethod)) return false;
  if (!/^\/api\/approvals\/[^/]+(?:\/[^/]+)?$/.test(path)) return false;
  const decisionText = `${path} ${collectBodyText(body, ['status', 'action', 'decision'])}`.toLowerCase();
  return /\b(?:approve|approved)\b/.test(decisionText);
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
  const assistantChatText = getAssistantChatText(normalizedPath, body);

  const deny = (permission: string, action: string) => ({
    ok: false,
    statusCode: 403,
    error: `This team session is not permitted to ${action}.`,
    code: 'team_permission_denied',
    permission,
  });

  if (normalizedMethod === 'DELETE' && permissions.canDeleteData !== true) {
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
  const assistantSmsIntent = Boolean(
    assistantChatText
      && /\b(?:(?:send|draft|compose|write|prepare|queue).{0,48}(?:sms|text|message)|(?:sms|text)\s+(?:seller|owner|lead|to))\b/i.test(assistantChatText),
  );
  if ((smsTool || smsRoute || assistantSmsIntent) && permissions.canSendSms !== true) {
    return deny('canSendSms', 'send SMS messages');
  }

  const emailTool = /^(?:sendcoldemail|pbk_send_update)$/i.test(toolName);
  const emailRoute =
    normalizedMethod !== 'GET'
    && /(?:\/api\/cold-email|\/api\/messages|\/api\/conversation|\/api\/conversations|\/api\/email|\/api\/inbox)/.test(normalizedPath)
    && /email|mail|message|conversation|inbox/.test(normalizedPath);
  const assistantEmailIntent = Boolean(
    assistantChatText
      && /\b(?:(?:send|draft|compose|write|prepare|queue).{0,48}(?:email|mail)|email\s+(?:seller|owner|lead|to))\b/i.test(assistantChatText),
  );
  if ((emailTool || emailRoute || assistantEmailIntent) && permissions.canSendEmail !== true) {
    return deny('canSendEmail', 'send emails');
  }

  const callTool = /^(?:telnyx_call|pbk_call_operator)$/i.test(toolName);
  const callRoute =
    normalizedMethod !== 'GET'
    && /(?:\/api\/calls|\/api\/operator\/call|\/api\/call)/.test(normalizedPath);
  const assistantCallIntent = Boolean(
    assistantChatText
      && !/\b(?:review|summarize|score|transcribe|transcript|recording|qa|quality).{0,32}call\b/i.test(assistantChatText)
      && /\b(?:(?:place|make|start|launch|initiate|dial|ring|connect|prepare|queue|set up).{0,48}call|call.{0,48}(?:seller|owner|lead|prospect|now|for approval|request|before dialing|dial))\b/i.test(assistantChatText),
  );
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
  const assistantProviderApprovalIntent = Boolean(
    assistantChatText
      && /\b(?:nurture|sequence|provider|approval|approve|approved|launch campaign|start campaign)\b/i.test(assistantChatText),
  );
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

  return { ok: true, statusCode: 200 };
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
    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        statusCode: response.status === 503 ? 503 : 401,
        error: String(payload.error || 'PBK team session is invalid or expired.'),
        code: String(payload.code || 'invalid_team_session'),
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

export const handler: Handler = async (event) => {
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
  appendQueryParams(targetUrl, event);

  const hasBody = !['GET', 'HEAD'].includes(String(event.httpMethod || 'GET').toUpperCase()) && event.body != null;
  const body = hasBody
    ? Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8')
    : undefined;

  const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB - headroom under Netlify's 6 MB function limit
  if (body && body.byteLength > MAX_BODY_BYTES) {
    return {
      statusCode: 413,
      headers: { 'Content-Type': 'application/json', ...buildCorsHeaders(event), 'X-Request-ID': requestId },
      body: JSON.stringify({ ok: false, error: 'Request body too large', maxBytes: MAX_BODY_BYTES, requestId }),
    };
  }

  if (!isPublicProxyRequest(event.httpMethod, targetPath)) {
    const teamSession = await verifyTeamSession(event, requestId);
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

  const PROXY_TIMEOUT_MS = Math.max(
    5000,
    Math.min(25000, Number(process.env.PBK_BRIDGE_PROXY_TIMEOUT_MS || 20000)),
  );
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: buildRequestHeaders(event, requestId),
      body,
      signal: abortController.signal,
    });
    clearTimeout(timeoutHandle);

    const responseHeaders: Record<string, string> = {
      ...buildCorsHeaders(event),
      'Cache-Control': response.headers.get('cache-control') || 'no-store',
      'X-PBK-Bridge-Proxy': 'netlify',
    };
    responseHeaders['X-Request-ID'] = response.headers.get('x-request-id') || requestId;
    for (const [name, value] of response.headers.entries()) {
      if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = responseHeaders['content-type'] || responseHeaders['Content-Type'] || '';
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

    const textResponse = isTextResponse(contentType);
    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: textResponse ? bytes.toString('utf8') : bytes.toString('base64'),
      isBase64Encoded: !textResponse,
    };
  } catch (error) {
    clearTimeout(timeoutHandle);
    const timedOut = error instanceof Error && error.name === 'AbortError';
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
  }
};
