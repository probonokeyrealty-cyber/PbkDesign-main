import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { createAvaRequestTiming } from './ava-request-timing.mjs';

test('completion measures provider response and awaited accounting independently', async () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('async function runDeepSeekChatCompletion(');
  const end = source.indexOf('\nfunction buildDeepSeekLiveRetryModels', start);
  let clock = 0;
  const timing = createAvaRequestTiming({ now: () => clock });
  const context = vm.createContext({
    process: { env: {} }, AbortController, Response, setTimeout, clearTimeout,
    getDeepSeekProviderMeta: () => ({ ready: true, model: 'fixture-model' }),
    DEEPSEEK_MODEL: 'fixture-model', DEEPSEEK_THINKING_MODE: 'disabled', DEEPSEEK_TIMEOUT_MS: 1400,
    DEEPSEEK_STRICT_TOOL_MODE: 'disabled', DEEPSEEK_BASE_URL: 'https://fixture.invalid',
    DEEPSEEK_STRICT_TOOL_BASE_URL: '', DEEPSEEK_REASONING_EXPOSURE: '', DEEPSEEK_API_KEY: 'fixture',
    toNumber: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    normalizeDeepSeekToolsForStrictMode: () => [], readDeepSpecConfig: () => ({}), isDeepSpecConfigured: () => false,
    executeProviderCircuitGuard: (_, operation) => operation(),
    fetch: async () => { clock += 400; return { ok: true, json: async () => { clock += 20; return { choices: [{ message: { content: 'safe answer' } }], usage: { total_tokens: 10 } }; } }; },
    recordTokenUsage: async () => { clock += 900; },
    sanitizeDeepSeekToolCalls: (value) => value, buildDeepSeekReasoningPolicy: () => ({}),
    isRetryableDeepSeekResult: () => false,
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await context.runDeepSeekChatCompletion([], { requestTiming: timing });
  assert.equal(result.ok, true);
  const stages = timing.snapshot().stages;
  assert.equal(stages.find((item) => item.stage === 'llm_request')?.durationMs, 420);
  assert.equal(stages.find((item) => item.stage === 'llm_usage')?.durationMs, 900);
  assert.equal(timing.snapshot().durationMs, 1320);
});
