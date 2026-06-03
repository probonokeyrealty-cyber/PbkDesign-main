export const DEFAULT_RETRY_DELAYS_MS = [1000, 5000, 30000];
export const DEFAULT_WORKER_TIMEOUT_MS = 55 * 60 * 1000;

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

export function resolveBridgeUrl(env = process.env) {
  const bridgeUrl = String(env.PBK_BRIDGE_URL || env.PBK_OPENCLAW_URL || env.OPENCLAW_URL || '')
    .trim()
    .replace(/\/+$/g, '');
  if (!bridgeUrl) {
    throw new Error(
      'PBK_BRIDGE_URL is required for the Ava memory worker. Set PBK_BRIDGE_URL to the hosted bridge URL before running scheduled memory consolidation.'
    );
  }
  return bridgeUrl;
}

export function resolveMemoryWorkerConfig(env = process.env) {
  const bridgeUrl = resolveBridgeUrl(env);
  const minutesBudget = clampNumber(env.PBK_AVA_MEMORY_DAILY_MINUTES || 60, 60, 1, 240);
  const limit = clampNumber(env.PBK_AVA_MEMORY_WORKER_LIMIT || 40, 40, 1, 200);
  const maxTimeoutMs = Math.max(1, Math.min(DEFAULT_WORKER_TIMEOUT_MS, minutesBudget * 60 * 1000 - 5000));
  const requestedTimeoutMs = Number(env.PBK_AVA_MEMORY_WORKER_TIMEOUT_MS || 0);
  const timeoutMs = requestedTimeoutMs > 0
    ? clampNumber(requestedTimeoutMs, maxTimeoutMs, 1, maxTimeoutMs)
    : maxTimeoutMs;
  return {
    bridgeUrl,
    apiKey: String(env.PBK_BRIDGE_API_KEY || '').trim(),
    minutesBudget,
    limit,
    timeoutMs,
    retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
  };
}

export function isTransientWorkerFailure(error = {}) {
  if (error?.permanent) return false;
  const status = Number(error.status || error.response?.status || 0);
  if (status === 408 || status === 429 || status >= 500) return true;
  const code = String(error.code || error.cause?.code || error.name || '');
  return /^(AbortError|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/i.test(
    code
  );
}

export function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export async function retryTransientOperation(operation, { delaysMs = DEFAULT_RETRY_DELAYS_MS } = {}) {
  let attempt = 0;
  let lastError = null;
  const maxAttempts = delaysMs.length + 1;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation({ attempt, maxAttempts });
    } catch (error) {
      lastError = error;
      lastError.attempts = attempt;
      if (attempt >= maxAttempts || !isTransientWorkerFailure(error)) {
        throw lastError;
      }
      await sleep(delaysMs[attempt - 1]);
    }
  }
  throw lastError || new Error('Ava memory worker retry loop exited unexpectedly.');
}

function parseJsonBody(text = '') {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function fetchJsonOnce(url, init = {}, { timeoutMs = DEFAULT_WORKER_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, Math.max(1, Number(timeoutMs) || DEFAULT_WORKER_TIMEOUT_MS));
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: init.signal || controller.signal,
    });
    const text = await response.text();
    const body = parseJsonBody(text);
    if (!response.ok || body?.ok === false) {
      const error = new Error(body?.error || body?.message || `Bridge returned ${response.status}`);
      error.status = response.status;
      error.response = response;
      error.body = body;
      error.text = text;
      throw error;
    }
    return {
      response,
      status: response.status,
      ok: true,
      body,
      text,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(`Ava memory worker bridge request timed out after ${timeoutMs}ms.`);
      timeoutError.name = 'AvaMemoryWorkerTimeoutError';
      timeoutError.permanent = true;
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchJsonWithRetry(url, init = {}, options = {}) {
  const retryDelaysMs = Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
  let attempts = 0;
  const result = await retryTransientOperation(
    async ({ attempt }) => {
      attempts = attempt;
      return fetchJsonOnce(url, init, options);
    },
    { delaysMs: retryDelaysMs }
  );
  return {
    ...result,
    attempts,
  };
}

export function buildFailureAlertPayload(error = {}, context = {}) {
  const status = context.status || error.status || 'network';
  const attempts = context.attempts || error.attempts || 1;
  const bridgeUrl = context.bridgeUrl || '';
  const message = String(error.message || error.error || error || 'Unknown error').slice(0, 500);
  return {
    toolName: 'slackNotify',
    params: {
      severity: 'error',
      channel: 'ops',
      title: 'Ava memory worker failed',
      text: `Ava memory worker failed after ${attempts} attempt${attempts === 1 ? '' : 's'} (${status}). ${message}`,
      target: 'ava-memory-worker',
      metadata: {
        bridgeUrl,
        status,
        attempts,
        body: context.body || error.body || null,
        failedAt: new Date().toISOString(),
      },
    },
  };
}

export async function sendFailureAlert({
  bridgeUrl,
  apiKey = '',
  alertPayload,
  fetchImpl = fetch,
  timeoutMs = 10000,
} = {}) {
  if (!bridgeUrl || !alertPayload?.toolName) return { ok: false, skipped: true };
  try {
    const result = await fetchJsonOnce(
      `${bridgeUrl.replace(/\/+$/g, '')}/invoke`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(alertPayload),
      },
      { fetchImpl, timeoutMs }
    );
    return { ok: true, status: result.status, body: result.body };
  } catch (error) {
    return {
      ok: false,
      error: String(error.message || error),
      status: error.status || 0,
    };
  }
}
