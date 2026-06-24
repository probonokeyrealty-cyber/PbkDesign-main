import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runConnectionHealthCheck } from './connection-strength-check.mjs';

const root = process.cwd();
const bridgeSource = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const healthy = await runConnectionHealthCheck({
  now: () => new Date('2026-06-19T12:00:00.000Z'),
  pool: {
    totalCount: 4,
    idleCount: 3,
    waitingCount: 0,
    query: async (sql) => {
      assert.match(sql, /SELECT 1/i);
      return { rows: [{ ok: 1 }] };
    },
  },
  redis: {
    configured: true,
    enabled: true,
    ping: async () => 'PONG',
  },
  providers: {
    telnyx: { ready: true, messagingReady: true, voiceReady: true },
    deepgram: { ready: true },
    elevenLabs: { ready: true },
    deepSeek: { ready: true },
    slack: { ready: false, configured: false },
  },
  requiredProviders: ['telnyx', 'deepgram', 'elevenLabs', 'deepSeek'],
});

assert.equal(healthy.ok, true, 'Healthy Postgres, Redis, and required providers should pass.');
assert.equal(healthy.result, 'connection_health_ready');
assert.equal(healthy.components.postgres.status, 'healthy');
assert.equal(healthy.components.postgres.pool.totalCount, 4);
assert.equal(healthy.components.redis.status, 'healthy');
assert.equal(healthy.components.providers.slack.required, false, 'Optional providers should not block readiness.');
assert.deepEqual(healthy.blockers, []);

const degraded = await runConnectionHealthCheck({
  now: () => new Date('2026-06-19T12:00:05.000Z'),
  pool: {
    query: async () => {
      const error = new Error('connect ECONNREFUSED 10.0.0.1:5432');
      error.code = 'ECONNREFUSED';
      throw error;
    },
  },
  redis: {
    configured: false,
    enabled: false,
  },
  providers: {
    telnyx: { ready: false, messagingReady: true, voiceReady: false, missing: ['PBK_TELNYX_CONNECTION_ID'] },
    deepgram: { ready: true },
    elevenLabs: { ready: true },
    deepSeek: { ready: true },
  },
  requiredProviders: ['telnyx', 'deepgram', 'elevenLabs', 'deepSeek'],
});

assert.equal(degraded.ok, false, 'Postgres and required provider failures should degrade readiness.');
assert.equal(degraded.result, 'connection_health_degraded');
assert(degraded.blockers.includes('postgres_unhealthy'), 'Degraded check should name Postgres as a blocker.');
assert(degraded.blockers.includes('provider_unready:telnyx'), 'Degraded check should name failed required providers.');
assert.equal(
  degraded.components.postgres.error.includes('10.0.0.1'),
  false,
  'Connection errors should not echo raw private IPs into operator-facing health.'
);

assert(
  bridgeSource.includes('/api/connection-health') &&
    bridgeSource.includes('runConnectionHealthCheck') &&
    bridgeSource.includes('PBK_PG_POOL_MIN') &&
    bridgeSource.includes('PBK_PG_OPERATION_TIMEOUT_MS') &&
    bridgeSource.includes('withPostgresOperationDeadline(rawQuery') &&
    bridgeSource.includes('withPostgresOperationDeadline(rawConnect') &&
    bridgeSource.includes('keepAliveInitialDelayMillis: PG_KEEPALIVE_INITIAL_DELAY_MS'),
  'Bridge must expose connection health and use hardened pool warm/keepalive/deadline settings.'
);

assert.equal(
  packageJson.scripts?.['test:connection-strength'],
  'node ./scripts/connection-strength-check-smoke.mjs',
  'package.json must expose the connection strength smoke.'
);
assert.equal(
  packageJson.scripts?.['render:doctor'],
  'node ./scripts/render-cli-doctor.mjs',
  'package.json must expose the Render CLI doctor for operator and subagent diagnostics.'
);
assert.equal(
  packageJson.scripts?.['render:status'],
  'node ./scripts/render-cli-doctor.mjs --status-only',
  'package.json must expose the Render CLI status check.'
);
assert(
  packageJson.scripts?.['test:production-hardening']?.includes('test:connection-strength'),
  'Production hardening must include connection strength coverage.'
);

console.log('connection-strength-check-smoke: ok');
