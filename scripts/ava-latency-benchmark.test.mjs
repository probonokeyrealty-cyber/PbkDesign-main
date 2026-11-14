import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { summarizeLatency, summarizeBenchmark, runBenchmark, SCENARIOS, buildBenchmarkPlan } from './ava-latency-benchmark.mjs';

test('nearest-rank p95 retains slow observations, with no zero for missing samples', () => {
  assert.equal(summarizeLatency([1, 2, 9000]).p95Ms, 9000);
  assert.equal(summarizeLatency([null, undefined, NaN]).p95Ms, null);
  assert.equal(summarizeLatency([0, 1]).count, 2);
});

test('operator evidence cannot certify phone latency, and failed observations remain', () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({
    elapsedMs: i === 19 ? 9000 : 100, httpStatus: 200, ok: i !== 19,
    timing: { metricKind: 'operator_request', durationMs: 90, stages: [{ stage: 'session_read', durationMs: 80 }] },
  }));
  const report = summarizeBenchmark(samples);
  assert.equal(report.overall.maxMs, 9000);
  assert.equal(report.failedRequests, 1);
  assert.equal(report.phoneLatencyProven, false);
  assert.equal(report.organicReadinessEligible, false);
  assert.equal(report.stages.session_read.count, 20);
  assert.equal(report.budgetProven, false);
});

test('runner sends isolated sessions and diagnostics, keeps transport failures and refuses unclassified responses', async () => {
  let calls = 0;
  const samples = await runBenchmark({ count: 20, runId: 'unit', fetchRequest: async (payload) => {
    calls++;
    assert.equal(payload.source, 'ava-latency-diagnostic');
    assert.equal(payload.diagnostic, true);
    assert(payload.sessionId.startsWith('pbk-latency-unit-'));
    if (calls === 2) throw new Error('secret-shaped message must not escape');
    return { status: 200, body: { ok: true, toolResult: { provider: { model: 'fixture', jsonModeFallback: true, apiKey: 'secret-shaped-value' } }, measurementClassification: { diagnostic: true, operational: false }, requestTiming: { metricKind: 'operator_request', durationMs: 50, stages: [] } } };
  } });
  assert.equal(samples.length, 20);
  assert.equal(samples[1].error, 'transport_failure');
  assert.equal(samples[0].fallback, true);
  assert.equal(samples[0].completion.model, 'fixture');
  assert(!JSON.stringify(samples).includes('secret-shaped'));
  await assert.rejects(runBenchmark({ count: 20, runId: 'bad', fetchRequest: async () => ({ status: 200, body: { ok: true } }) }), /diagnostic isolation/);
  assert(SCENARIOS.length >= 4);
});

test('real operator recorder excludes diagnostic source without changing ordinary operations', () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('function recordAvaAssistantPlanOps({');
  const end = source.indexOf('\nfunction redactAvaMissionLedgerText', start);
  assert(start >= 0 && end > start);
  let record;
  const context = vm.createContext({ Date, recordAgentOps: (value) => { record = value; } });
  vm.runInContext(source.slice(start, end), context);
  context.recordAvaAssistantPlanOps({ source: 'ava-latency-diagnostic' });
  assert.equal(record.metadata.operational, false);
  assert.equal(record.metadata.diagnostic, true);
  context.recordAvaAssistantPlanOps({ source: 'command-center-assistant' });
  assert.equal(record.metadata.operational, true);
  assert.equal(record.metadata.diagnostic, false);
});

test('model fallback and missing release identity cannot certify the budget', () => {
  const samples = buildBenchmarkPlan(24).map(({ id }) => ({ scenario: id, elapsedMs: 100, httpStatus: 200, ok: true,
    result: id === 'model_chat' ? 'deepseek_chat_answer' : 'success', usagePersistence: id === 'model_chat' ? { ok: true } : null,
    releaseCommit: 'same-release', timing: { metricKind: 'operator_request', durationMs: 80, stages: id === 'model_chat' ? [{ stage: 'llm_request', durationMs: 60 }] : [] } }));
  assert.equal(summarizeBenchmark(samples).budgetProven, true);
  assert.equal(summarizeBenchmark(samples.map((sample) => ({ ...sample, fallback: true }))).budgetProven, false);
  assert.equal(summarizeBenchmark(samples.map((sample) => ({ ...sample, releaseCommit: '' }))).budgetProven, false);
  assert.equal(summarizeBenchmark(samples.map((sample) => ({ ...sample, scenario: 'lead_lookup' }))).budgetProven, false);
  const failedAccounting = summarizeBenchmark(samples.map((sample) => ({ ...sample, usagePersistence: { ok: false } })));
  assert.equal(failedAccounting.accountingFailures, 24);
  assert.equal(failedAccounting.budgetProven, false);
});

test('24 plan has six varied model requests; blocked responses never supply completion speed proof', () => {
  const plan = buildBenchmarkPlan(24);
  assert.equal(plan.length, 24);
  const model = plan.filter((item) => item.id === 'model_chat');
  assert.equal(model.length, 6);
  assert.equal(new Set(model.map((item) => item.message)).size, 6);
  const report = summarizeBenchmark(plan.map(({ id }) => ({ scenario: id, elapsedMs: 5, httpStatus: 200, ok: true,
    toolOk: false, governanceBlocked: true, result: 'ava_control_read_only_pause', releaseCommit: 'same',
    timing: { metricKind: 'operator_request', durationMs: 3, stages: id === 'model_chat' ? [{ stage: 'llm_request', durationMs: 2 }] : [] } })));
  assert.equal(report.overall.count, 24);
  assert.equal(report.completed.count, 0);
  assert.equal(report.blocked.count, 24);
  assert.equal(report.modelBacked.observed.count, 6);
  assert.equal(report.modelBacked.completed.count, 0);
  assert.equal(report.budgetProven, false);
  assert.equal(report.latencyWithinBudget, false);
});
