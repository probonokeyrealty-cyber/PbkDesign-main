import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFailureAlertPayload,
  fetchJsonWithRetry,
  resolveBridgeUrl,
  resolveMemoryWorkerConfig,
  retryTransientOperation,
} from './ava-memory-worker-lib.mjs';

test('memory worker requires an explicit bridge URL and bounds runtime config', () => {
  assert.throws(
    () => resolveBridgeUrl({}),
    /PBK_BRIDGE_URL.*required/i,
    'Memory worker should fail loudly when no bridge URL env var is configured.'
  );
  assert.equal(
    resolveBridgeUrl({ PBK_BRIDGE_URL: 'https://bridge.example.com///' }),
    'https://bridge.example.com',
    'Memory worker should normalize bridge URLs without falling back to localhost.'
  );

  const config = resolveMemoryWorkerConfig({
    PBK_BRIDGE_URL: 'https://bridge.example.com/',
    PBK_AVA_MEMORY_DAILY_MINUTES: '60',
    PBK_AVA_MEMORY_WORKER_LIMIT: '500',
    PBK_AVA_MEMORY_WORKER_TIMEOUT_MS: '750',
  });
  assert.equal(config.bridgeUrl, 'https://bridge.example.com', 'Worker config should use the configured bridge URL.');
  assert.equal(config.minutesBudget, 60, 'Worker config should preserve the requested daily minutes budget.');
  assert.equal(config.limit, 200, 'Worker config should cap batch size to the existing safety maximum.');
  assert.equal(config.timeoutMs, 750, 'Worker config should honor an explicit circuit-breaker timeout.');
  assert.deepEqual(config.retryDelaysMs, [1000, 5000, 30000], 'Worker config should use 1s/5s/30s retry delays.');
});

test('memory worker retries transient operation failures three times', async () => {
  let retryAttempts = 0;
  const retryResult = await retryTransientOperation(
    async () => {
      retryAttempts += 1;
      if (retryAttempts < 4) {
        const error = new Error('temporary bridge failure');
        error.status = 503;
        throw error;
      }
      return 'ok';
    },
    { delaysMs: [0, 0, 0] }
  );
  assert.equal(retryResult, 'ok', 'Retry helper should return the successful result after transient failures.');
  assert.equal(retryAttempts, 4, 'Retry helper should allow the first try plus three retries.');
});

test('memory worker fetch helper retries transient network failures and parses JSON', async () => {
  let fetchAttempts = 0;
  const fetchResult = await fetchJsonWithRetry(
    'https://bridge.example.com/api/ava/learning/run',
    { method: 'POST', body: '{}' },
    {
      retryDelaysMs: [0, 0, 0],
      timeoutMs: 1000,
      fetchImpl: async () => {
        fetchAttempts += 1;
        if (fetchAttempts === 1) throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
        return new Response(JSON.stringify({ ok: true, result: 'learned' }), { status: 200 });
      },
    }
  );
  assert.equal(fetchAttempts, 2, 'Fetch helper should retry transient network failures.');
  assert.equal(fetchResult.body?.result, 'learned', 'Fetch helper should parse JSON response bodies.');
});

test('memory worker builds a Slack alert payload after final failure', () => {
  const alert = buildFailureAlertPayload(new Error('bridge down'), {
    bridgeUrl: 'https://bridge.example.com',
    status: 503,
    attempts: 4,
  });
  assert.equal(alert.toolName, 'slackNotify', 'Worker failures should produce a Slack notification tool payload.');
  assert.match(alert.params?.text || '', /Ava memory worker failed/i, 'Worker failure alert should name the failed job.');
  assert.equal(alert.params?.severity, 'error', 'Worker failure alert should be error severity.');
});
