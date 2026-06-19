function isoNow(now = () => new Date()) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function sanitizeError(error) {
  return String(error?.message || error || 'unknown error')
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://[redacted]@')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[private-ip]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .slice(0, 240);
}

function toLatency(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function normalizeProviderMeta(meta = {}, required = false) {
  const ready =
    meta.ready === true ||
    (meta.messagingReady === true && meta.voiceReady !== false && required === false);
  return {
    configured: Boolean(meta.configured ?? meta.ready ?? meta.messagingReady ?? meta.voiceReady),
    ready: Boolean(ready),
    required: Boolean(required),
    provider: meta.provider || '',
    mode: meta.mode || '',
    status: ready ? 'healthy' : required ? 'unready' : 'optional_unready',
    missing: Array.isArray(meta.missing)
      ? meta.missing
      : [...(Array.isArray(meta.messagingMissing) ? meta.messagingMissing : []), ...(Array.isArray(meta.voiceMissing) ? meta.voiceMissing : [])],
  };
}

async function probePostgres(pool, { timeoutMs = 2500 } = {}) {
  const startedAt = Date.now();
  if (!pool) {
    return {
      ready: false,
      status: 'not_configured',
      latencyMs: 0,
      error: 'PBK_DATABASE_URL is not configured.',
      pool: null,
    };
  }

  try {
    await withTimeout(pool.query('SELECT 1 AS ok'), timeoutMs, 'Postgres connection probe');
    return {
      ready: true,
      status: 'healthy',
      latencyMs: toLatency(startedAt),
      error: '',
      pool: {
        totalCount: Number(pool.totalCount || 0),
        idleCount: Number(pool.idleCount || 0),
        waitingCount: Number(pool.waitingCount || 0),
      },
    };
  } catch (error) {
    return {
      ready: false,
      status: 'unhealthy',
      latencyMs: toLatency(startedAt),
      error: sanitizeError(error),
      pool: {
        totalCount: Number(pool.totalCount || 0),
        idleCount: Number(pool.idleCount || 0),
        waitingCount: Number(pool.waitingCount || 0),
      },
    };
  }
}

async function probeRedis({ redis, redisClientFactory, redisMeta = {}, timeoutMs = 1500 } = {}) {
  const startedAt = Date.now();
  const configured = Boolean(redisMeta.configured ?? redis?.configured);
  const enabled = Boolean(redisMeta.enabled ?? redis?.enabled ?? configured);
  if (!configured || !enabled) {
    return {
      ready: true,
      configured,
      enabled,
      skipped: true,
      status: enabled ? 'not_configured' : 'disabled',
      latencyMs: 0,
      error: '',
    };
  }

  try {
    const client = redis?.ping ? redis : await redisClientFactory?.();
    if (!client?.ping) {
      return {
        ready: false,
        configured,
        enabled,
        status: 'unavailable',
        latencyMs: toLatency(startedAt),
        error: sanitizeError(redisMeta.lastError || 'Redis client is unavailable.'),
      };
    }
    await withTimeout(client.ping(), timeoutMs, 'Redis connection probe');
    return {
      ready: true,
      configured,
      enabled,
      status: 'healthy',
      latencyMs: toLatency(startedAt),
      error: '',
    };
  } catch (error) {
    return {
      ready: false,
      configured,
      enabled,
      status: 'unhealthy',
      latencyMs: toLatency(startedAt),
      error: sanitizeError(error),
    };
  }
}

export async function runConnectionHealthCheck({
  pool = null,
  postgresMeta = {},
  redis = null,
  redisClientFactory = null,
  redisMeta = {},
  providers = {},
  requiredProviders = [],
  timeoutMs = 2500,
  now = () => new Date(),
} = {}) {
  const startedAt = Date.now();
  const required = new Set(requiredProviders.map((provider) => String(provider || '').trim()).filter(Boolean));
  const [postgres, redisStatus] = await Promise.all([
    probePostgres(pool, { timeoutMs }),
    probeRedis({ redis, redisClientFactory, redisMeta, timeoutMs: Math.min(timeoutMs, 1500) }),
  ]);

  const providerEntries = Object.entries(providers).map(([name, meta]) => [
    name,
    normalizeProviderMeta(meta, required.has(name)),
  ]);
  const providerStatuses = Object.fromEntries(providerEntries);

  const blockers = [];
  if (!postgres.ready) blockers.push('postgres_unhealthy');
  for (const [name, status] of providerEntries) {
    if (status.required && !status.ready) blockers.push(`provider_unready:${name}`);
  }
  if (redisStatus.enabled && !redisStatus.ready) blockers.push('redis_unhealthy');
  if (postgresMeta?.staleRenderHost) blockers.push('postgres_url_uses_raw_ip');

  const ready = blockers.length === 0;
  return {
    ok: ready,
    ready,
    result: ready ? 'connection_health_ready' : 'connection_health_degraded',
    checkedAt: isoNow(now),
    latencyMs: toLatency(startedAt),
    blockers,
    components: {
      postgres: {
        ...postgres,
        host: postgresMeta.host || '',
        staleRenderHost: Boolean(postgresMeta.staleRenderHost),
        stateBackend: postgresMeta.stateBackend || '',
        transientGraceActive: Boolean(postgresMeta.transientGraceActive),
        consecutiveFailures: Number(postgresMeta.consecutiveFailures || 0),
      },
      redis: redisStatus,
      providers: providerStatuses,
    },
    recommendations: [
      ...(!postgres.ready ? ['Verify PBK_DATABASE_URL uses Render internal DNS and the database plan does not pause.'] : []),
      ...(postgresMeta?.staleRenderHost ? ['Replace raw Postgres IP with the Render internal connection string hostname.'] : []),
      ...(redisStatus.enabled && !redisStatus.ready ? ['Verify PBK_REDIS_URL/REDIS_URL and Redis service health.'] : []),
      ...providerEntries
        .filter(([, status]) => status.required && !status.ready)
        .map(([name]) => `Configure or repair required provider: ${name}.`),
    ],
  };
}
