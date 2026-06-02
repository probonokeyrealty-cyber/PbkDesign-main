import type { Handler } from '@netlify/functions';

const BRIDGE_URL = String(
  process.env.PBK_BRIDGE_URL
    || process.env.PBK_PUBLIC_BRIDGE_URL
    || 'https://pbk-openclaw-bridge.onrender.com',
).replace(/\/+$/g, '');

const PUBLIC_AVA_CHAT_KEY = String(
  process.env.PUBLIC_AVA_CHAT_KEY
    || process.env.PBK_PUBLIC_AVA_CHAT_KEY
    || '',
).trim();

const PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_WINDOW_MS = Number(
  process.env.PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
);

const PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_MAX = Number(
  process.env.PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_MAX || 60,
);

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();
let missingPublicKeyWarned = false;

const corsHeaders = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Headers': 'Content-Type, X-Public-Ava-Key, X-Public-Key, X-Request-ID',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

const DEFAULT_ALLOWED_ORIGINS = [
  'https://pbkcommandcenter.netlify.app',
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
  const headers: Record<string, string> = { ...corsHeaders, Vary: 'Origin' };
  const origin = event ? getHeader(event, 'origin') : '';
  if (origin && getAllowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(payload: unknown, statusCode = 200, headers: Record<string, string> = {}, event?: Parameters<Handler>[0]) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(event),
      ...headers,
    },
    body: JSON.stringify(payload),
  };
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
    || `pbk-public-ava-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getClientKey(event: Parameters<Handler>[0]) {
  const forwarded = getHeader(event, 'x-forwarded-for');
  const ip = getHeader(event, 'x-nf-client-connection-ip')
    || getHeader(event, 'client-ip')
    || forwarded.split(',')[0]?.trim()
    || 'unknown';
  return `ip:${ip}`;
}

function checkRateLimit(event: Parameters<Handler>[0]) {
  const now = Date.now();
  const key = getClientKey(event);
  const existing = rateBuckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_WINDOW_MS };
  bucket.count += 1;
  rateBuckets.set(key, bucket);

  if (rateBuckets.size > 10000) {
    for (const [bucketKey, value] of rateBuckets.entries()) {
      if (value.resetAt <= now) rateBuckets.delete(bucketKey);
    }
  }

  const remaining = Math.max(0, PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_MAX - bucket.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    allowed: bucket.count <= PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_MAX,
    remaining,
    retryAfterSeconds,
    resetAt: bucket.resetAt,
  };
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

  if (event.httpMethod !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405, { 'X-Request-ID': requestId }, event);
  }

  if (!PUBLIC_AVA_CHAT_KEY) {
    if (!missingPublicKeyWarned) {
      console.error('PBK public Ava chat is not configured: set PUBLIC_AVA_CHAT_KEY or PBK_PUBLIC_AVA_CHAT_KEY.');
      missingPublicKeyWarned = true;
    }
    return json(
      {
        ok: false,
        error: 'PUBLIC_AVA_CHAT_KEY is not configured.',
        message: 'Public Ava chat is disabled until the Netlify function has a bridge public chat key.',
        requestId,
      },
      503,
      { 'X-Request-ID': requestId },
      event,
    );
  }

  const rateLimit = checkRateLimit(event);
  const rateLimitHeaders = {
    'X-Request-ID': requestId,
    'X-RateLimit-Limit': String(PBK_PUBLIC_AVA_NETLIFY_RATE_LIMIT_MAX),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(rateLimit.resetAt),
  };

  if (!rateLimit.allowed) {
    return json(
      {
        ok: false,
        error: 'Rate limit exceeded',
        message: 'Ava is receiving a lot of public chat traffic. Please wait a moment and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        requestId,
      },
      429,
      {
        ...rateLimitHeaders,
        'Retry-After': String(rateLimit.retryAfterSeconds),
      },
      event,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json({ ok: false, error: 'Invalid JSON body', requestId }, 400, rateLimitHeaders, event);
  }

  try {
    const response = await fetch(`${BRIDGE_URL}/api/public/ava-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-Public-Ava-Key': PUBLIC_AVA_CHAT_KEY,
      },
      body: JSON.stringify({
        ...body,
        source: body.source || 'netlify-public-ava-chat',
      }),
    });

    const payload = await response.json().catch(() => ({
      ok: false,
      error: `Bridge returned ${response.status}`,
    }));

    return json(payload, response.status, {
      ...rateLimitHeaders,
      'X-PBK-Bridge': BRIDGE_URL,
    }, event);
  } catch (error) {
    return json(
      {
        ok: false,
        error: 'Ava public chat could not reach the PBK bridge.',
        message: error instanceof Error ? error.message : 'Unknown bridge error',
        requestId,
      },
      502,
      rateLimitHeaders,
      event,
    );
  }
};
