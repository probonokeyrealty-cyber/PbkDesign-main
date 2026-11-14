import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCENARIOS = Object.freeze([
  { id: 'lead_lookup', message: 'Find lead PBK-LATENCY-NONCUSTOMER-ABSENT' },
  { id: 'approvals', message: 'Show pending approvals' },
  { id: 'summary', message: 'Summarize recent activity' },
  { id: 'recall', message: 'What was my last question?' },
  { id: 'audit', message: 'Read-only audit of Ava assistant decisions. Do not change anything.' },
  { id: 'model_chat', message: 'In two short sentences, explain your role at PBK Wholesale Paradise. Do not use tools or contact anyone.' },
]);

const MODEL_PROMPTS = [
  SCENARIOS[5].message,
  "In two sentences, describe how you handle uncertainty about a seller's situation. Do not use tools or contact anyone.",
  'In two sentences, explain how you stay truthful about being an AI at PBK. Do not use tools or contact anyone.',
  'Give a brief, empathetic response to an upset seller who feels pressured. No tools or external actions.',
  'In two sentences, describe how you would respond when you do not know an answer. Do not use tools or contact anyone.',
  'Briefly explain the difference between proposing an action and completing it. Do not use tools or contact anyone.',
];

export function buildBenchmarkPlan(count = 24) {
  const cycle = [0, 1, 2, 3, 4, 5, 0, 5];
  let modelIndex = 0;
  return Array.from({ length: count }, (_, index) => {
    const scenario = SCENARIOS[cycle[index % cycle.length]];
    if (scenario.id !== 'model_chat') return scenario;
    const variant = modelIndex++ % MODEL_PROMPTS.length;
    return { ...scenario, message: MODEL_PROMPTS[variant], variant };
  });
}

function isBlocked(sample) {
  return sample.governanceBlocked === true || /^ava_control_/.test(sample.result || '');
}

function isNegativeControl(sample) {
  return sample.scenario === 'lead_lookup' && sample.result === 'lead_not_found';
}

function isCompleted(sample) {
  return sample.httpStatus === 200 && sample.ok === true && sample.toolOk !== false
    && !isBlocked(sample) && !isNegativeControl(sample) && !sample.fallback
    && (sample.scenario !== 'model_chat' || (sample.result === 'deepseek_chat_answer' && sample.usagePersistence?.ok === true));
}

export function summarizeLatency(values) {
  const sorted = values.filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const rank = (percent) => sorted.length ? sorted[Math.ceil(sorted.length * percent) - 1] : null;
  return { count: sorted.length, minMs: sorted[0] ?? null, medianMs: rank(0.5), p95Ms: rank(0.95), maxMs: sorted.at(-1) ?? null };
}

export function summarizeBenchmark(samples) {
  const stageValues = {};
  for (const sample of samples) {
    for (const stage of sample.timing?.stages || []) (stageValues[stage.stage] ||= []).push(stage.durationMs);
  }
  const overall = summarizeLatency(samples.map((sample) => sample.elapsedMs));
  const failedRequests = samples.filter((sample) => sample.ok !== true || sample.httpStatus !== 200).length;
  const missingTiming = samples.filter((sample) => sample.timing?.metricKind !== 'operator_request' || !Number.isFinite(sample.timing.durationMs)).length;
  const fallbackRequests = samples.filter((sample) => sample.fallback === true).length;
  const commits = new Set(samples.map((sample) => sample.releaseCommit).filter(Boolean));
  const versionBound = commits.size === 1 && samples.every((sample) => Boolean(sample.releaseCommit));
  const representativeCoverage = SCENARIOS.every(({ id }) => samples.filter((sample) => sample.scenario === id).length >= 3);
  const unexpectedToolFailures = samples.filter((sample) => sample.toolOk === false && !(sample.scenario === 'lead_lookup' && sample.result === 'lead_not_found')).length;
  const accountingFailures = samples.filter((sample) => sample.usagePersistence?.ok === false).length;
  const blocked = samples.filter(isBlocked);
  const completed = samples.filter(isCompleted);
  const model = samples.filter((sample) => sample.scenario === 'model_chat' && sample.timing?.stages?.some((stage) => stage.stage === 'llm_request'));
  const completedModel = model.filter(isCompleted);
  const completedLatency = summarizeLatency(completed.map((sample) => sample.elapsedMs));
  const modelLatency = summarizeLatency(model.map((sample) => sample.elapsedMs));
  const modelCompletedLatency = summarizeLatency(completedModel.map((sample) => sample.elapsedMs));
  const speedProven = overall.count >= 20 && overall.p95Ms < 2500 && blocked.length === 0
    && completedLatency.count > 0 && completedLatency.p95Ms < 2500
    && completedModel.length >= 6 && completedModel.length === model.length && modelCompletedLatency.p95Ms < 2500;
  return {
    schema: 'pbk.ava.controlled_latency.v2', metricKind: 'operator_request', diagnostic: true,
    composition: 'Per 24-request cycle: 18 deterministic (6 negative lookup controls) and 6 varied model requests; prior v1 used 20 deterministic and 4 model requests',
    organicReadinessEligible: false, phoneLatencyProven: false, sampleCount: samples.length,
    failedRequests, missingTiming, overall,
    completed: completedLatency,
    blocked: summarizeLatency(blocked.map((sample) => sample.elapsedMs)),
    negativeControls: summarizeLatency(samples.filter(isNegativeControl).map((sample) => sample.elapsedMs)),
    modelBacked: { planned: samples.filter((sample) => sample.scenario === 'model_chat').length, observed: modelLatency, completed: modelCompletedLatency, blocked: model.filter(isBlocked).length },
    toolFailures: samples.filter((sample) => sample.toolOk === false).length,
    fallbackRequests, versionBound, representativeCoverage, unexpectedToolFailures, accountingFailures, releaseCommit: versionBound ? [...commits][0] : '',
    server: summarizeLatency(samples.map((sample) => sample.timing?.durationMs)),
    stages: Object.fromEntries(Object.entries(stageValues).map(([name, values]) => [name, summarizeLatency(values)])),
    scenarios: Object.fromEntries(SCENARIOS.map(({ id }) => [id, summarizeLatency(samples.filter((sample) => sample.scenario === id).map((sample) => sample.elapsedMs))])),
    budgetMs: 2500,
    latencyWithinBudget: speedProven,
    budgetProven: speedProven && representativeCoverage && failedRequests === 0 && unexpectedToolFailures === 0 && accountingFailures === 0 && missingTiming === 0 && fallbackRequests === 0 && versionBound,
    samples,
  };
}

export async function runBenchmark({ count = 24, runId = randomUUID(), fetchRequest, onSample = () => {} }) {
  if (!Number.isInteger(count) || count < 20 || count > 40) throw new Error('Use 20 to 40 controlled requests');
  const samples = [];
  const plan = buildBenchmarkPlan(count);
  for (let index = 0; index < count; index++) {
    const scenario = plan[index];
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let response;
    try {
      response = await fetchRequest({
        message: scenario.message, sessionId: `pbk-latency-${runId}-${scenario.id}`,
        source: 'ava-latency-diagnostic', diagnostic: true, metadata: { diagnostic: true, operational: false },
      });
    } catch {
      const sample = { index, scenario: scenario.id, startedAt, elapsedMs: performance.now() - started, ok: false, error: 'transport_failure' };
      samples.push(sample);
      await onSample(sample, samples);
      continue;
    }
    const elapsedMs = performance.now() - started;
    const body = response.body || {};
    const classification = body.measurementClassification;
    if (classification?.diagnostic !== true || classification?.operational !== false) throw new Error('Server has not confirmed diagnostic isolation; stop benchmark');
    const sample = {
      index, scenario: scenario.id, startedAt, elapsedMs, httpStatus: response.status,
      variant: scenario.variant ?? null,
      governanceBlocked: /^ava_control_/.test(body.toolResult?.result || '') || ['blocked', 'ask_user', 'approval_required'].includes(body.controlEnvelope?.decision),
      governance: { decision: body.controlEnvelope?.decision || '', reason: body.controlEnvelope?.reason || body.toolResult?.reason || '', guardReasons: body.trace?.guard?.reasons || [] },
      ok: body.ok === true, toolOk: body.toolResult?.ok ?? null,
      fallback: Boolean(body.toolResult?.deepSeekFallback || body.toolResult?.fallback || body.toolResult?.provider?.jsonModeFallback || body.toolResult?.provider?.modelFallback || body.toolResult?.result === 'brain_answer'),
      intent: body.usedIntent || '', action: body.assistantAction || '', result: body.toolResult?.result || '',
      releaseCommit: body.releaseCommit || '',
      usagePersistence: body.usagePersistence ? { ok: body.usagePersistence.ok === true, result: body.usagePersistence.result || '' } : null,
      completion: {
        model: body.toolResult?.provider?.model || '',
        thinkingMode: body.toolResult?.provider?.thinkingMode || '',
        attempts: (body.toolResult?.attempts || []).map((attempt) => ({
          model: attempt.model || '', ok: attempt.ok === true, result: attempt.result || '',
          status: attempt.status ?? null, retry: attempt.retry || '', attemptTimeoutMs: attempt.attemptTimeoutMs ?? null,
        })),
      },
      timing: body.requestTiming || null,
    };
    samples.push(sample);
    await onSample(sample, samples);
  }
  return samples;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--run')) throw new Error('Explicit --run required; only read-only diagnostic requests are permitted');
  const base = process.env.PBK_BRIDGE_URL;
  const key = process.env.PBK_BRIDGE_API_KEY;
  if (!base || !key) throw new Error('PBK_BRIDGE_URL and PBK_BRIDGE_API_KEY are required');
  const outputArg = args.indexOf('--output');
  if (outputArg < 0 || !args[outputArg + 1]) throw new Error('--output is required');
  const output = resolve(args[outputArg + 1]);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const request = async (path, payload) => {
    const response = await fetch(new URL(path, base), { method: payload ? 'POST' : 'GET', headers, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(60000) });
    return { status: response.status, body: await response.json() };
  };
  const before = await request('/health');
  const runId = randomUUID();
  const identity = (body) => ({ revision: body.revision || '', commit: body.commit || body.gitCommit || body.runtime?.gitCommit || body.deploy?.commit || '', uptime: body.uptime });
  const deploymentBefore = identity(before.body);
  const countArg = args.indexOf('--count');
  const count = countArg < 0 ? 24 : Number(args[countArg + 1]);
  await mkdir(dirname(output), { recursive: true });
  const startedAt = new Date().toISOString();
  const samples = await runBenchmark({ count, runId, fetchRequest: (payload) => request('/api/assistant/chat', payload),
    onSample: async (sample, current) => {
      await writeFile(output, JSON.stringify({ ...summarizeBenchmark(current), runId, startedAt, deploymentBefore, complete: false }, null, 2));
      console.log(JSON.stringify({ index: sample.index, scenario: sample.scenario, elapsedMs: sample.elapsedMs, ok: sample.ok, timing: sample.timing }));
    },
  });
  const after = await request('/health');
  const deploymentAfter = identity(after.body);
  const summary = summarizeBenchmark(samples);
  const deploymentStable = summary.versionBound && deploymentBefore.revision === deploymentAfter.revision && deploymentBefore.commit === deploymentAfter.commit;
  const report = { ...summarizeBenchmark(samples), runId, startedAt, completedAt: new Date().toISOString(), deploymentBefore, deploymentAfter, deploymentStable, complete: true };
  report.budgetProven = report.budgetProven && deploymentStable;
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, sampleCount: samples.length, overall: report.overall, failedRequests: report.failedRequests, budgetProven: report.budgetProven, phoneLatencyProven: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Ava benchmark stopped; check diagnostic isolation, configuration, and saved partial evidence.'); process.exitCode = 1; });
