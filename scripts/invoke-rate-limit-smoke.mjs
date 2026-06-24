import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildInvokeRateLimitIdentity,
  createInvokeRateLimiter,
} from './invoke-rate-limit.mjs';

const identity = buildInvokeRateLimitIdentity({
  authorization: 'Bearer super-secret-token',
  ip: '203.0.113.8',
});
assert.equal(identity.length, 32);
assert(!identity.includes('super-secret-token'));
assert(!identity.includes('203.0.113.8'));
assert.equal(
  identity,
  buildInvokeRateLimitIdentity({
    authorization: 'Bearer super-secret-token',
    ip: '203.0.113.8',
  })
);

let redisCount = 0;
const redisLimiter = createInvokeRateLimiter({
  limit: 10,
  windowMs: 60_000,
  now: () => 1_000,
  getRedisClient: async () => ({
    eval: async (_script, options) => {
      assert.deepEqual(options.keys, [`pbk:test:${identity}`]);
      assert.deepEqual(options.arguments, ['60000']);
      redisCount += 1;
      return [redisCount, 60_000];
    },
  }),
  makeRedisKey: (value) => `pbk:test:${value}`,
});
for (let index = 0; index < 10; index += 1) {
  assert.equal((await redisLimiter.consume(identity)).ok, true);
}
const limited = await redisLimiter.consume(identity);
assert.equal(limited.ok, false);
assert.equal(limited.source, 'redis');
assert.equal(limited.retryAfterSeconds, 60);

let clock = 5_000;
const fallbackLimiter = createInvokeRateLimiter({
  limit: 10,
  windowMs: 1_000,
  now: () => clock,
  getRedisClient: async () => null,
});
for (let index = 0; index < 10; index += 1) {
  assert.equal((await fallbackLimiter.consume(identity)).ok, true);
}
assert.equal((await fallbackLimiter.consume(identity)).ok, false);
clock += 1_001;
assert.equal((await fallbackLimiter.consume(identity)).ok, true);

const failClosedLimiter = createInvokeRateLimiter({
  limit: 8,
  minimumLimit: 3,
  windowMs: 60_000,
  getRedisClient: async () => {
    throw new Error('redis offline');
  },
  failClosedOnRedisError: true,
});
const failClosedResult = await failClosedLimiter.consume('team-login-ip');
assert.equal(failClosedResult.ok, false);
assert.equal(failClosedResult.source, 'redis_unavailable');
assert.match(failClosedResult.redisError, /redis offline/);
assert.equal(failClosedResult.limit, 8);

const missingRedisLimiter = createInvokeRateLimiter({
  limit: 8,
  minimumLimit: 3,
  windowMs: 60_000,
  getRedisClient: async () => null,
  failClosedOnRedisError: true,
});
const missingRedisResult = await missingRedisLimiter.consume('team-login-ip');
assert.equal(missingRedisResult.ok, false);
assert.equal(missingRedisResult.source, 'redis_unavailable');

const malformedRedisLimiter = createInvokeRateLimiter({
  limit: 8,
  minimumLimit: 3,
  windowMs: 60_000,
  getRedisClient: async () => ({
    eval: async () => null,
  }),
  failClosedOnRedisError: true,
});
const malformedRedisResult = await malformedRedisLimiter.consume('team-login-ip');
assert.equal(malformedRedisResult.ok, false);
assert.equal(malformedRedisResult.source, 'redis_unavailable');
assert.match(malformedRedisResult.redisError, /invalid reply/);

const bridge = await readFile(
  new URL('./openclaw-local-server.mjs', import.meta.url),
  'utf8'
);
assert(
  /const invokeRateLimit = await checkInvokeRateLimit\(request\);[\s\S]{0,900}await readBody\(request\)/.test(
    bridge
  ),
  'The bridge must rate-limit authenticated /invoke traffic before reading the request body.'
);
assert(
  /PBK_INVOKE_RATE_LIMIT_MAX/.test(bridge) &&
    /PBK_INVOKE_RATE_LIMIT_WINDOW_MS/.test(bridge),
  'The /invoke limiter must expose environment-controlled limits.'
);
assert(
  /TEAM_AUTH_RATE_LIMIT_MAX/.test(bridge) &&
    /checkTeamAuthRateLimit\(request\)/.test(bridge) &&
    /team_auth_rate_limited/.test(bridge),
  'Team passcode verification must have a dedicated rate limit.'
);
const teamAuthLimiterBlock =
  bridge.match(/const teamAuthRateLimiter = createInvokeRateLimiter\(\{[\s\S]*?\n\}\);/)?.[0] || '';
assert(
  teamAuthLimiterBlock &&
    !/failClosedOnRedisError:\s*true/.test(teamAuthLimiterBlock),
  'Team passcode login must use bounded memory fallback when Redis is unavailable so operators are not locked out.'
);
const teamAuthRouteStart = bridge.indexOf(
  "if (request.method === 'POST' && pathname === '/api/auth/team')"
);
const teamAuthRouteEnd = bridge.indexOf(
  "if (request.method === 'GET' && matchesPath(pathname, ['/state', '/api/state']))",
  teamAuthRouteStart
);
const teamAuthRouteBlock =
  teamAuthRouteStart >= 0 && teamAuthRouteEnd > teamAuthRouteStart
    ? bridge.slice(teamAuthRouteStart, teamAuthRouteEnd)
    : '';
assert(
  teamAuthRouteBlock &&
    /createTeamSessionToken/.test(teamAuthRouteBlock) &&
    /persistStateInBackground\('team-auth-session'\)/.test(teamAuthRouteBlock) &&
    !/await persistState\(state\)/.test(teamAuthRouteBlock),
  'Team passcode login must return the signed session even when non-critical activity persistence is temporarily unavailable.'
);
assert(
  /function hasTeamAuthCredentials/.test(bridge) &&
    (bridge.match(/const teamAuthPresented = hasTeamAuthCredentials\(request, body\);/g) || []).length >= 2 &&
    /canApproveProviderActions/.test(bridge) &&
    /canPlaceCalls/.test(bridge) &&
    /canSendSms/.test(bridge) &&
    /canSendEmail/.test(bridge) &&
    /contract\|docusign\|admin\|kill\|delete\|campaign\|prompt\|rex-decision\|nurture/.test(bridge),
  'Team-session approval decisions must enforce explicit communication permissions while keeping admin/contract/campaign actions restricted.'
);

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);
assert.equal(
  packageJson.scripts?.['test:invoke-rate-limit'],
  'node ./scripts/invoke-rate-limit-smoke.mjs'
);
assert(
  packageJson.scripts?.['test:founder']?.includes('test:invoke-rate-limit'),
  'The founder release gate must include the /invoke rate-limit smoke test.'
);

console.log('invoke-rate-limit-smoke: ok');
