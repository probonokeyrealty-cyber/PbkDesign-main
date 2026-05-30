import type { Handler } from '@netlify/functions';

const BRIDGE_URL = String(
  process.env.PBK_BRIDGE_URL
    || process.env.PBK_PUBLIC_BRIDGE_URL
    || 'https://pbk-openclaw-bridge.onrender.com',
).replace(/\/+$/g, '');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
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

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'authorization',
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
  'x-request-id',
]);

function json(payload: unknown, statusCode = 200, extraHeaders: Record<string, string> = {}) {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function normalizeProxyPath(eventPath = '', requestedPath = '') {
  const raw = String(requestedPath || '').trim()
    || String(eventPath || '').replace(/^\/\.netlify\/functions\/pbk-bridge-proxy\/?/, '');
  const path = `/${raw.replace(/^\/+/, '')}`;
  return path === '/' ? '/health' : path;
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
  headers['X-PBK-Netlify-Proxy'] = 'pbk-bridge-proxy';
  headers['X-Request-ID'] = requestId;
  return headers;
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

function shouldCompactHealthResponse(targetPath = '') {
  return ['/health', '/status', '/api/health', '/api/status'].includes(targetPath);
}

export const handler: Handler = async (event) => {
  const requestId = getRequestId(event);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...CORS_HEADERS,
        'X-Request-ID': requestId,
      },
      body: '',
    };
  }

  const targetPath = normalizeProxyPath(event.path, event.queryStringParameters?.path || '');
  const targetUrl = new URL(targetPath, `${BRIDGE_URL}/`);
  appendQueryParams(targetUrl, event);

  const hasBody = !['GET', 'HEAD'].includes(String(event.httpMethod || 'GET').toUpperCase()) && event.body != null;
  const body = hasBody
    ? Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8')
    : undefined;

  try {
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: buildRequestHeaders(event, requestId),
      body,
    });

    const responseHeaders: Record<string, string> = {
      ...CORS_HEADERS,
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
        });
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
    return json(
      {
        ok: false,
        error: 'PBK bridge proxy could not reach the hosted bridge.',
        message: error instanceof Error ? error.message : 'Unknown bridge proxy error',
        target: targetPath,
        requestId,
      },
      502,
      { 'X-Request-ID': requestId },
    );
  }
};
