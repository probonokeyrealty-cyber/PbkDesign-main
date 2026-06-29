const DEFAULT_PROVIDER = 'vllm';
const DEFAULT_TIMEOUT_MS = 2500;
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_NUM_SPECULATIVE_TOKENS = 5;

function clean(value) {
  return String(value || '').trim();
}

function enabled(value) {
  return /^(1|true|yes|on)$/i.test(clean(value));
}

function disabled(value) {
  return /^(0|false|no|off)$/i.test(clean(value));
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeBaseUrl(endpoint = '') {
  const raw = clean(endpoint).replace(/\/+$/, '');
  if (!raw) return '';
  return /\/v1$/i.test(raw) ? raw : `${raw}/v1`;
}

function safeErrorMessage(error) {
  return clean(error?.message || error || 'request failed').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}

export function readDeepSpecConfig(env = process.env) {
  const timeoutMs = boundedNumber(
    env.PBK_DEEPSPEC_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );
  return {
    enabled: enabled(env.PBK_DEEPSPEC_ENABLED),
    baseUrl: normalizeBaseUrl(env.PBK_DEEPSPEC_ENDPOINT),
    apiKey: clean(env.PBK_DEEPSPEC_API_KEY),
    provider: clean(env.PBK_DEEPSPEC_PROVIDER) || DEFAULT_PROVIDER,
    targetModel: clean(env.PBK_DEEPSPEC_TARGET_MODEL),
    draftModel: clean(env.PBK_DEEPSPEC_DRAFT_MODEL),
    numSpeculativeTokens: boundedNumber(
      env.PBK_DEEPSPEC_NUM_SPECULATIVE_TOKENS,
      DEFAULT_NUM_SPECULATIVE_TOKENS,
      1,
      32
    ),
    timeoutMs,
    fallbackEnabled: !disabled(env.PBK_DEEPSPEC_FALLBACK_ENABLED),
  };
}

export function isDeepSpecConfigured(config = readDeepSpecConfig()) {
  return Boolean(config.enabled && config.baseUrl && config.targetModel);
}

function buildHeaders(config = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function buildMeta(config = {}, startedAt = Date.now()) {
  return {
    provider: config.provider || DEFAULT_PROVIDER,
    baseUrlConfigured: Boolean(config.baseUrl),
    targetModel: config.targetModel || '',
    draftModelConfigured: Boolean(config.draftModel),
    numSpeculativeTokens: config.numSpeculativeTokens || DEFAULT_NUM_SPECULATIVE_TOKENS,
    timeoutMs: config.timeoutMs || DEFAULT_TIMEOUT_MS,
    latencyMs: Math.max(0, Date.now() - startedAt),
  };
}

export async function requestSpeculativeChatCompletion(payload = {}, options = {}) {
  const config = options.config || readDeepSpecConfig(options.env || process.env);
  const startedAt = Date.now();
  if (!isDeepSpecConfigured(config)) {
    return {
      ok: false,
      reason: 'not_configured',
      meta: buildMeta(config, startedAt),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    clearTimeout(timeout);
    return {
      ok: false,
      reason: 'fetch_unavailable',
      meta: buildMeta(config, startedAt),
    };
  }

  try {
    const requestBody = {
      ...payload,
      model: payload.model || config.targetModel,
    };
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: 'http_error',
        status: response.status,
        error: safeErrorMessage(data?.error?.message || data?.message || `Speculative endpoint returned ${response.status}`),
        meta: buildMeta(config, startedAt),
      };
    }

    if (!data || !Array.isArray(data.choices)) {
      return {
        ok: false,
        reason: 'malformed_response',
        status: response.status,
        error: 'Speculative endpoint returned a malformed chat completion.',
        meta: buildMeta(config, startedAt),
      };
    }

    return {
      ok: true,
      response: data,
      meta: buildMeta(config, startedAt),
    };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'request_error';
    return {
      ok: false,
      reason,
      error: reason === 'timeout' ? 'Speculative endpoint timed out.' : safeErrorMessage(error),
      meta: buildMeta(config, startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}
