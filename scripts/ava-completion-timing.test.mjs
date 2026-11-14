import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { createAvaRequestTiming } from './ava-request-timing.mjs';
import { observeUsagePersistence } from './ava-accounting-status.mjs';

test('completion measures provider response and awaited accounting independently', async () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('async function runDeepSeekChatCompletion(');
  const end = source.indexOf('\nfunction buildDeepSeekLiveRetryModels', start);
  let clock = 0;
  const timing = createAvaRequestTiming({ now: () => clock });
  const context = vm.createContext({
    process: { env: {} }, AbortController, Response, setTimeout, clearTimeout, observeUsagePersistence,
    getDeepSeekProviderMeta: () => ({ ready: true, model: 'fixture-model' }),
    DEEPSEEK_MODEL: 'fixture-model', DEEPSEEK_THINKING_MODE: 'disabled', DEEPSEEK_TIMEOUT_MS: 1400,
    DEEPSEEK_STRICT_TOOL_MODE: 'disabled', DEEPSEEK_BASE_URL: 'https://fixture.invalid',
    DEEPSEEK_STRICT_TOOL_BASE_URL: '', DEEPSEEK_REASONING_EXPOSURE: '', DEEPSEEK_API_KEY: 'fixture',
    toNumber: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    normalizeDeepSeekToolsForStrictMode: () => [], readDeepSpecConfig: () => ({}), isDeepSpecConfigured: () => false,
    executeProviderCircuitGuard: (_, operation) => operation(),
    fetch: async () => { clock += 400; return { ok: true, json: async () => { clock += 20; return { choices: [{ message: { content: 'safe answer' } }], usage: { total_tokens: 10 } }; } }; },
    recordTokenUsage: async () => { clock += 900; return { ok: true }; },
    sanitizeDeepSeekToolCalls: (value) => value, buildDeepSeekReasoningPolicy: () => ({}),
    extractDeepSeekToolCallAnswer: () => '',
    isRetryableDeepSeekResult: () => false,
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await context.runDeepSeekChatCompletion([], { requestTiming: timing });
  assert.equal(result.ok, true);
  const stages = timing.snapshot().stages;
  assert.equal(stages.find((item) => item.stage === 'llm_request')?.durationMs, 420);
  assert.equal(stages.find((item) => item.stage === 'llm_usage')?.durationMs, 900);
  assert.equal(timing.snapshot().durationMs, 1320);
  assert.equal(result.provider.usagePersistence?.ok, true);
  context.recordTokenUsage = async () => ({ ok: false, reason: 'query_failed', error: 'secret-database-details' });
  const failedAccounting = await context.runDeepSeekChatCompletion([], { requestTiming: timing });
  assert.equal(failedAccounting.ok, true);
  assert.equal(failedAccounting.provider.usagePersistence.ok, false);
  assert.equal(failedAccounting.provider.usagePersistence.warning, 'token_usage_persistence_failed');
  assert(!JSON.stringify(failedAccounting.provider.usagePersistence).includes('secret-database'));
  context.fetch = async () => ({ ok: true, json: async () => {
    const error = new Error('body cancelled');
    error.name = 'AbortError';
    throw error;
  } });
  let usageCalls = 0;
  context.recordTokenUsage = async () => { usageCalls++; return { ok: true }; };
  const bodyTimeout = await context.runDeepSeekChatCompletion([], { requestTiming: timing });
  assert.equal(bodyTimeout.ok, false);
  assert.equal(bodyTimeout.result, 'provider_timeout');
  assert.equal(usageCalls, 0, 'an interrupted response has no usable token accounting payload');
});
