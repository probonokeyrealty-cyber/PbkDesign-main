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
]);

const FORWARDED_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-disposition',
  'content-type',
  'etag',
  'last-modified',
  'x-pbk-bridge',
  'x-pbk-pdf-renderer',
]);

function json(payload: unknown, statusCode = 200) {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
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

function buildRequestHeaders(event: Parameters<Handler>[0]) {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers || {})) {
    const lower = name.toLowerCase();
    if (!FORWARDED_REQUEST_HEADERS.has(lower) || value == null) continue;
    headers[name] = value;
  }
  headers['X-PBK-Netlify-Proxy'] = 'pbk-bridge-proxy';
  return headers;
}

function isTextResponse(contentType = '') {
  return /json|text|javascript|xml|html|csv|svg/i.test(contentType);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
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
      headers: buildRequestHeaders(event),
      body,
    });

    const responseHeaders: Record<string, string> = {
      ...CORS_HEADERS,
      'Cache-Control': response.headers.get('cache-control') || 'no-store',
      'X-PBK-Bridge-Proxy': 'netlify',
    };
    for (const [name, value] of response.headers.entries()) {
      if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = responseHeaders['content-type'] || responseHeaders['Content-Type'] || '';
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
      },
      502,
    );
  }
};
