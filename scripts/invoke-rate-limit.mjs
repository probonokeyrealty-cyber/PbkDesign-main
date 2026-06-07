import { createHash } from 'node:crypto';

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function hashValue(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);
}

export function buildInvokeRateLimitIdentity({ authorization = '', ip = '' } = {}) {
  const auth = String(authorization || '').trim();
  const clientIp = String(ip || 'unknown').trim() || 'unknown';
  return hashValue(`${auth ? `auth:${auth}` : 'anonymous'}|ip:${clientIp}`);
}

export function createInvokeRateLimiter(options = {}) {
  const minimumLimit = clampInteger(options.minimumLimit, 10, 1, 100_000);
  const limit = clampInteger(options.limit, 300, minimumLimit, 100_000);
  const windowMs = clampInteger(options.windowMs, 60_000, 1_000, 24 * 60 * 60 * 1000);
  const getRedisClient =
    typeof options.getRedisClient === 'function'
      ? options.getRedisClient
      : async () => null;
  const makeRedisKey =
    typeof options.makeRedisKey === 'function'
      ? options.makeRedisKey
      : (identity) => `pbk:rate-limit:invoke:${identity}`;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const redisTimeoutMs = clampInteger(
    options.redisTimeoutMs,
    250,
    25,
    5_000
  );
  const maxLocalBuckets = clampInteger(
    options.maxLocalBuckets,
    5_000,
    100,
    100_000
  );
  const failClosedOnRedisError = options.failClosedOnRedisError === true;
  const localBuckets = new Map();

  function denyForRedisFailure(redisError = '') {
    const currentTime = now();
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt: currentTime + windowMs,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
      source: 'redis_unavailable',
      redisError,
    };
  }

  function pruneLocalBuckets(currentTime) {
    for (const [key, bucket] of localBuckets.entries()) {
      if (bucket.resetAt <= currentTime) localBuckets.delete(key);
    }
    while (localBuckets.size >= maxLocalBuckets) {
      const oldestKey = localBuckets.keys().next().value;
      if (!oldestKey) break;
      localBuckets.delete(oldestKey);
    }
  }

  function consumeLocal(identity, redisError = '') {
    const currentTime = now();
    const current = localBuckets.get(identity);
    if (!current || current.resetAt <= currentTime) {
      pruneLocalBuckets(currentTime);
      const bucket = { count: 1, resetAt: currentTime + windowMs };
      localBuckets.set(identity, bucket);
      return {
        ok: true,
        limit,
        remaining: limit - 1,
        resetAt: bucket.resetAt,
        retryAfterSeconds: 0,
        source: 'memory_fallback',
        redisError,
      };
    }

    current.count += 1;
    const ok = current.count <= limit;
    return {
      ok,
      limit,
      remaining: ok ? Math.max(0, limit - current.count) : 0,
      resetAt: current.resetAt,
      retryAfterSeconds: ok
        ? 0
        : Math.max(1, Math.ceil((current.resetAt - currentTime) / 1000)),
      source: 'memory_fallback',
      redisError,
    };
  }

  async function consume(identity) {
    const normalizedIdentity = String(identity || '').trim() || 'anonymous';
    let client = null;
    try {
      client = await getRedisClient();
    } catch (error) {
      const redisError = String(error?.message || error || 'Redis unavailable').slice(0, 180);
      if (failClosedOnRedisError) return denyForRedisFailure(redisError);
      return consumeLocal(
        normalizedIdentity,
        redisError
      );
    }

    if (!client) {
      if (failClosedOnRedisError) {
        return denyForRedisFailure('Redis rate-limit client is unavailable.');
      }
      return consumeLocal(normalizedIdentity);
    }

    try {
      let timeout = null;
      const result = await Promise.race([
        client.eval(
          `
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
              redis.call('PEXPIRE', KEYS[1], ARGV[1])
            end
            local ttl = redis.call('PTTL', KEYS[1])
            return { current, ttl }
          `,
          {
            keys: [makeRedisKey(normalizedIdentity)],
            arguments: [String(windowMs)],
          }
        ),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Redis rate-limit command timed out.')),
            redisTimeoutMs
          );
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });
      if (
        !Array.isArray(result)
        || result.length < 2
        || !Number.isFinite(Number(result[0]))
        || !Number.isFinite(Number(result[1]))
      ) {
        throw new Error('Redis rate-limit command returned an invalid reply.');
      }
      const count = Number(Array.isArray(result) ? result[0] : 0);
      const ttlMs = Math.max(
        1,
        Number(Array.isArray(result) ? result[1] : windowMs) || windowMs
      );
      const ok = count <= limit;
      return {
        ok,
        limit,
        remaining: ok ? Math.max(0, limit - count) : 0,
        resetAt: now() + ttlMs,
        retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
        source: 'redis',
        redisError: '',
      };
    } catch (error) {
      const redisError = String(error?.message || error || 'Redis rate limit failed').slice(0, 180);
      if (failClosedOnRedisError) return denyForRedisFailure(redisError);
      return consumeLocal(
        normalizedIdentity,
        redisError
      );
    }
  }

  return {
    limit,
    windowMs,
    consume,
  };
}
