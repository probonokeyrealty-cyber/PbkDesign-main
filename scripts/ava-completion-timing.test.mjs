import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { createAvaRequestTiming } from './ava-request-timing.mjs';
import { observeUsagePersistence } from './ava-accounting-status.mjs';

function deadlineCompletionFixture() {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  let clock = 1000;
  let fetchCalls = 0;
  const timers = [];
  const context = vm.createContext({
    Date: { now: () => clock }, process: { env: {} }, AbortController, Response,
    setTimeout: (_, duration) => { timers.push(duration); return timers.length; }, clearTimeout: () => {},
    observeUsagePersistence, getDeepSeekProviderMeta: () => ({ ready: true, model: 'fixture-model' }),
    DEEPSEEK_MODEL: 'fixture-model', DEEPSEEK_THINKING_MODE: 'disabled', DEEPSEEK_TIMEOUT_MS: 1400,
    DEEPSEEK_STRICT_TOOL_MODE: 'disabled', DEEPSEEK_BASE_URL: 'https://fixture.invalid',
    DEEPSEEK_STRICT_TOOL_BASE_URL: '', DEEPSEEK_REASONING_EXPOSURE: '', DEEPSEEK_API_KEY: 'fixture',
    toNumber: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    normalizeDeepSeekToolsForStrictMode: () => [], readDeepSpecConfig: () => ({}), isDeepSpecConfigured: () => false,
    executeProviderCircuitGuard: (_, operation) => operation(),
    fetch: async () => { fetchCalls++; return { ok: true, json: async () => ({ choices: [{ message: { content: 'safe answer' } }] }) }; },
    recordTokenUsage: async () => ({ ok: true }),
    sanitizeDeepSeekToolCalls: (value) => value, buildDeepSeekReasoningPolicy: () => ({}),
    extractDeepSeekToolCallAnswer: () => '', isRetryableDeepSeekResult: () => true,
    sleep: async (duration) => { clock += duration; },
  });
  const start = source.indexOf('async function runDeepSeekChatCompletion(');
  vm.runInContext(source.slice(start, source.indexOf('\nfunction buildDeepSeekLiveRetryModels', start)), context);
  return { context, timers, advance: (duration) => { clock += duration; }, calls: () => fetchCalls };
}

test('absolute deadline includes body reading and never accepts a late native response', async () => {
  const fixture = deadlineCompletionFixture();
  let accounted = 0;
  fixture.context.recordTokenUsage = async () => { accounted++; return { ok: true }; };
  fixture.context.fetch = async () => ({ ok: true, json: async () => {
    fixture.advance(1500);
    return { choices: [{ message: { content: 'late answer' } }] };
  } });
  const result = await fixture.context.runDeepSeekChatCompletion([], { deadlineAt: 2400, attemptTimeoutMs: 2300 });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'provider_timeout');
  assert.equal(accounted, 1, 'a complete late response still incurs real provider usage');
  assert.equal(fixture.timers[0], 1400, 'the attempt cannot receive more than the remaining whole budget');
});

test('primary can finish after 1400ms without a restart while accounting remains awaited', async () => {
  const fixture = deadlineCompletionFixture();
  let calls = 0;
  fixture.context.fetch = async () => {
    calls++;
    fixture.advance(1700);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'native answer' } }] }) };
  };
  fixture.context.recordTokenUsage = async () => { fixture.advance(50); return { ok: true }; };
  const result = await fixture.context.runDeepSeekChatCompletion([], { deadlineAt: 3300, attemptTimeoutMs: 2300, retryAttempts: 1 });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(result.provider.usagePersistence.ok, true);
  fixture.context.recordTokenUsage = async () => { fixture.advance(700); return { ok: true }; };
  const lateAccounting = await fixture.context.runDeepSeekChatCompletion([], { deadlineAt: 5050, attemptTimeoutMs: 2300 });
  assert.equal(lateAccounting.ok, false);
  assert.equal(lateAccounting.result, 'provider_timeout');
  assert.equal(lateAccounting.provider.usagePersistence.ok, true, 'rejecting a late result does not discard accounting');
});

test('retry delay and every attempt consume one absolute budget without a minimum timeout floor', async () => {
  const fixture = deadlineCompletionFixture();
  let calls = 0;
  fixture.context.fetch = async () => {
    calls++;
    if (calls === 1) { fixture.advance(800); return { ok: false, status: 503, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'safe answer' } }] }) };
  };
  const result = await fixture.context.runDeepSeekChatCompletion([], {
    deadlineAt: 2400, attemptTimeoutMs: 2300, retryAttempts: 1, retryDelayMs: 100,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.timers, [1400, 500]);
  assert.equal(result.attempts[1].attemptTimeoutMs, 500);
  assert.equal(result.provider.model, 'fixture-model');
  assert.equal(result.provider.thinkingMode, 'disabled');
});

test('expired whole budget prevents a provider request or a full-budget retry', async () => {
  const fixture = deadlineCompletionFixture();
  const expired = await fixture.context.runDeepSeekChatCompletion([], { deadlineAt: 999, retryAttempts: 2 });
  assert.equal(expired.result, 'provider_timeout');
  assert.equal(fixture.calls(), 0);
  fixture.context.fetch = async () => {
    fixture.advance(1300);
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const exhausted = await fixture.context.runDeepSeekChatCompletion([], { deadlineAt: 2400, retryAttempts: 2, retryDelayMs: 200 });
  assert.equal(exhausted.result, 'provider_timeout');
  assert.equal(exhausted.attempts.length, 1);
});

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
  assert.equal(bodyTimeout.provider.usagePersistence, null, 'timeout accounting is unknown, not a zero receipt');
  context.fetch = async () => ({ ok: true, json: async () => ({
    choices: [{ finish_reason: 'length', message: { content: '{"reply":"unfinished' } }], usage: { total_tokens: 12 },
  }) });
  const truncated = await context.runDeepSeekChatCompletion([], { requestTiming: timing });
  assert.equal(truncated.ok, false, 'token-truncated model output is not a native completion');
  assert.equal(truncated.result, 'provider_incomplete_response');
  assert.equal(usageCalls, 1, 'completed provider usage still requires accounting even when generation was truncated');
  context.isDeepSpecConfigured = () => true;
  context.readDeepSpecConfig = () => ({ targetModel: 'fixture-model' });
  context.incrementObservabilityCounter = () => {};
  context.recordLatencyMetric = () => {};
  context.requestSpeculativeChatCompletion = async () => ({ ok: true, response: {
    choices: [{ finish_reason: 'length', message: { content: 'partial output' } }], usage: { total_tokens: 12 },
  } });
  const speculativeTruncated = await context.runDeepSeekChatCompletion([], {});
  assert.equal(speculativeTruncated.ok, false);
  assert.equal(speculativeTruncated.result, 'provider_incomplete_response');
  assert.equal(usageCalls, 2);
});
