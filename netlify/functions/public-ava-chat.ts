import type { Handler } from '@netlify/functions';

declare const Netlify:
  | {
      env?: {
        get?: (name: string) => string | undefined;
      };
    }
  | undefined;

const DEFAULT_ALLOWED_ORIGINS = [] as string[];
const MAX_REQUEST_BODY_BYTES = 10 * 1024;

type RateBucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
  reason?: string;
};

type PublicAvaContext = {
  requestId?: string;
  ip?: string;
};

const rateBuckets = new Map<string, RateBucket>();
let missingPublicKeyWarned = false;
let missingBridgeUrlWarned = false;

function getEnv(name: string) {
  try {
    const fromNetlify = typeof Netlify !== 'undefined' ? Netlify?.env?.get?.(name) : '';
    if (fromNetlify) return String(fromNetlify).trim();
  } catch {
    // Netlify.env is unavailable in local unit-style reads.
  }
  return String(process.env[name] || '').trim();
}

function getRequiredEnv(names: string[]) {
  for (const name of names) {
    const value = getEnv(name);
    if (value) return { ok: true, name, value };
  }
  return { ok: false, name: names[0] || 'unknown', value: '' };
}

function getNumberEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(getEnv(name) || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getAllowedOrigins() {
  const configured = String(getEnv('PBK_ALLOWED_ORIGINS') || getEnv('PBK_CORS_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function buildCorsHeaders(request: Request) {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Headers': 'Content-Type, X-Public-Ava-Key, X-Public-Key, X-Request-ID',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    Vary: 'Origin',
  };
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = getAllowedOrigins();
  if (origin && (allowedOrigins.has(origin) || allowedOrigins.has('*'))) {
    headers['Access-Control-Allow-Origin'] = allowedOrigins.has('*') ? '*' : origin;
  }
  return headers;
}

function jsonResponse(
  request: Request,
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(request),
      ...headers,
    },
  });
}

function getRequestId(request: Request, context: PublicAvaContext) {
  return (
    request.headers.get('x-request-id') ||
    context.requestId ||
    `pbk-public-ava-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function getClientKey(request: Request, context: PublicAvaContext) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip =
    context.ip ||
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('client-ip') ||
    forwarded.split(',')[0]?.trim() ||
    'unknown';
  return `ip:${ip}`;
}

function checkRateLimit(request: Request, context: PublicAvaContext): RateLimitResult {
  try {
    const now = Date.now();
    const key = getClientKey(request, context);
    const windowMs = getNumberEnv('PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, 60_000, 60 * 60 * 1000);
    const max = getNumberEnv('PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_MAX', 60, 1, 600);
    const existing = rateBuckets.get(key);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    rateBuckets.set(key, bucket);

    if (rateBuckets.size > 10000) {
      for (const [bucketKey, value] of rateBuckets.entries()) {
        if (value.resetAt <= now) rateBuckets.delete(bucketKey);
      }
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      allowed: bucket.count <= max,
      remaining: Math.max(0, max - bucket.count),
      retryAfterSeconds,
      resetAt: bucket.resetAt,
    };
  } catch (error) {
    console.error('PBK public Ava rate limit unavailable; failing closed.', error);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
      resetAt: Date.now() + 60_000,
      reason: 'rate_limit_unavailable',
    };
  }
}

function rateLimitHeaders(requestId: string, rateLimit: RateLimitResult) {
  return {
    'X-Request-ID': requestId,
    'X-RateLimit-Limit': String(getNumberEnv('PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_MAX', 60, 1, 600)),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(rateLimit.resetAt),
  };
}

async function readJsonBody(request: Request) {
  const maxBytes = getNumberEnv('PBK_PUBLIC_AVA_MAX_BODY_BYTES', MAX_REQUEST_BODY_BYTES, 1024, 64 * 1024);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    return { ok: false, status: 413, error: `Request body exceeds ${maxBytes} bytes.` };
  }
  const text = await request.text();
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > maxBytes) {
    return { ok: false, status: 413, error: `Request body exceeds ${maxBytes} bytes.` };
  }
  try {
    return { ok: true, body: JSON.parse(text || '{}') as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body.' };
  }
}

async function fetchBridge(bridgeUrl: string, publicKey: string, requestId: string, body: Record<string, unknown>) {
  const timeoutMs = getNumberEnv('PBK_PUBLIC_AVA_BRIDGE_TIMEOUT_MS', 10_000, 1000, 30_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${bridgeUrl.replace(/\/+$/g, '')}/api/public/ava-chat`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-Public-Ava-Key': publicKey,
      },
      body: JSON.stringify({
        ...body,
        source: body.source || 'netlify-public-ava-chat',
      }),
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { ok: false, error: text.slice(0, 500) || `Bridge returned ${response.status}` };
    }
    return { status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function publicAvaChatHandler(request: Request, context: PublicAvaContext) {
  const requestId = getRequestId(request, context);

  if (request.method === 'OPTIONS') {
    return new Response('', {
      status: 204,
      headers: {
        ...buildCorsHeaders(request),
        'X-Request-ID': requestId,
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(request, { ok: false, error: 'Method not allowed', requestId }, 405, { 'X-Request-ID': requestId });
  }

  const publicKey = getRequiredEnv(['PUBLIC_AVA_CHAT_KEY', 'PBK_PUBLIC_AVA_CHAT_KEY']);
  if (!publicKey.ok) {
    if (!missingPublicKeyWarned) {
      console.error('PBK public Ava chat is not configured: set PUBLIC_AVA_CHAT_KEY or PBK_PUBLIC_AVA_CHAT_KEY.');
      missingPublicKeyWarned = true;
    }
    return jsonResponse(
      request,
      {
        ok: false,
        error: 'chat_not_configured',
        message: 'Chat not configured. Contact administrator.',
        requiredEnv: publicKey.name,
        requestId,
      },
      503,
      { 'X-Request-ID': requestId },
    );
  }

  const bridge = getRequiredEnv(['PBK_BRIDGE_URL', 'PBK_PUBLIC_BRIDGE_URL']);
  if (!bridge.ok) {
    if (!missingBridgeUrlWarned) {
      console.error('PBK public Ava chat is not configured: set PBK_BRIDGE_URL or PBK_PUBLIC_BRIDGE_URL.');
      missingBridgeUrlWarned = true;
    }
    return jsonResponse(
      request,
      {
        ok: false,
        error: 'bridge_not_configured',
        message: 'Chat not configured. Contact administrator.',
        requiredEnv: bridge.name,
        requestId,
      },
      503,
      { 'X-Request-ID': requestId },
    );
  }

  const rateLimit = checkRateLimit(request, context);
  const sharedHeaders = rateLimitHeaders(requestId, rateLimit);
  if (!rateLimit.allowed) {
    const unavailable = rateLimit.reason === 'rate_limit_unavailable';
    return jsonResponse(
      request,
      {
        ok: false,
        error: unavailable ? 'rate_limit_unavailable' : 'Rate limit exceeded',
        message: unavailable
          ? 'Chat traffic controls are temporarily unavailable. Please try again shortly.'
          : 'Ava is receiving a lot of public chat traffic. Please wait a moment and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        requestId,
      },
      unavailable ? 503 : 429,
      {
        ...sharedHeaders,
        'Retry-After': String(rateLimit.retryAfterSeconds),
      },
    );
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonResponse(request, { ok: false, error: parsed.error, requestId }, parsed.status || 400, sharedHeaders);
  }

  try {
    const bridgeResponse = await fetchBridge(bridge.value, publicKey.value, requestId, parsed.body || {});
    return jsonResponse(request, bridgeResponse.payload, bridgeResponse.status, {
      ...sharedHeaders,
      'X-PBK-Bridge': bridge.value.replace(/\/+$/g, ''),
    });
  } catch (error) {
    return jsonResponse(
      request,
      {
        ok: false,
        error: 'Ava public chat could not reach the PBK bridge.',
        message: error instanceof Error ? error.message : 'Unknown bridge error',
        requestId,
      },
      502,
      sharedHeaders,
    );
  }
}

function getEventHeader(event: Parameters<Handler>[0], name: string) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (key.toLowerCase() === wanted) return String(value || '').trim();
  }
  return '';
}

function buildRequestFromEvent(event: Parameters<Handler>[0]) {
  const host = getEventHeader(event, 'host') || 'pbkcommandcenter.netlify.app';
  const query = event.rawQuery ? `?${event.rawQuery}` : '';
  const url = event.rawUrl || `https://${host}${event.path || '/api/public/ava-chat'}${query}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (value != null) headers.set(key, String(value));
  }
  const method = event.httpMethod || 'GET';
  const body = ['GET', 'HEAD'].includes(method.toUpperCase())
    ? undefined
    : event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : event.body || '';
  return new Request(url, { method, headers, body });
}

export const handler: Handler = async (event, context) => {
  const response = await publicAvaChatHandler(buildRequestFromEvent(event), {
    requestId: context.awsRequestId,
    ip: getEventHeader(event, 'x-nf-client-connection-ip'),
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
  };
};
