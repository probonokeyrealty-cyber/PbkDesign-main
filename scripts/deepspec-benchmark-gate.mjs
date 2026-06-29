#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function usage() {
  return [
    'Usage: npm run deepspec:benchmark-gate -- <benchmark.json>',
    '',
    'Required metrics:',
    '- baselineP95Ms',
    '- deepspecP95Ms',
    '- fallbackRate',
    '- qualityPassRate',
    '- approvalGatePassRate',
    '- sampleCount',
    '',
    'On failure, keep PBK_DEEPSPEC_ENABLED=false.',
  ].join('\n');
}

function toNumber(value, fallback = Number.NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readBenchmark(pathArg = '') {
  const path = String(pathArg || '').trim();
  if (!path || path === '--help' || path === '-h') {
    throw new Error(usage());
  }
  const payload = JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
  const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : payload;
  return {
    baselineP50Ms: toNumber(metrics.baselineP50Ms ?? metrics.baseline?.p50Ms ?? metrics.baseline?.p50),
    deepspecP50Ms: toNumber(metrics.deepspecP50Ms ?? metrics.deepspec?.p50Ms ?? metrics.deepspec?.p50),
    baselineP95Ms: toNumber(metrics.baselineP95Ms ?? metrics.baseline?.p95Ms ?? metrics.baseline?.p95),
    deepspecP95Ms: toNumber(metrics.deepspecP95Ms ?? metrics.deepspec?.p95Ms ?? metrics.deepspec?.p95),
    fallbackRate: toNumber(metrics.fallbackRate ?? metrics.deepspec?.fallbackRate),
    qualityPassRate: toNumber(metrics.qualityPassRate ?? metrics.quality?.passRate),
    approvalGatePassRate: toNumber(metrics.approvalGatePassRate ?? metrics.approvalGate?.passRate),
    sampleCount: toNumber(metrics.sampleCount ?? metrics.samples ?? metrics.count),
  };
}

function percentImprovement(baseline, candidate) {
  if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(candidate)) return Number.NaN;
  return (baseline - candidate) / baseline;
}

function evaluateBenchmark(metrics = {}, thresholds = {}) {
  const minSampleCount = toNumber(thresholds.minSampleCount, 20);
  const minP95Improvement = toNumber(thresholds.minP95Improvement, 0.1);
  const maxFallbackRate = toNumber(thresholds.maxFallbackRate, 0.05);
  const minQualityPassRate = toNumber(thresholds.minQualityPassRate, 0.995);
  const minApprovalGatePassRate = toNumber(thresholds.minApprovalGatePassRate, 1);
  const p95Improvement = percentImprovement(metrics.baselineP95Ms, metrics.deepspecP95Ms);
  const p50Improvement = percentImprovement(metrics.baselineP50Ms, metrics.deepspecP50Ms);
  const failures = [];

  if (!Number.isFinite(metrics.sampleCount) || metrics.sampleCount < minSampleCount) {
    failures.push(`sampleCount ${metrics.sampleCount || 0} is below ${minSampleCount}`);
  }
  if (!Number.isFinite(p95Improvement) || p95Improvement < minP95Improvement) {
    failures.push(`p95 improvement ${Number.isFinite(p95Improvement) ? Math.round(p95Improvement * 1000) / 10 : 'missing'}% is below ${Math.round(minP95Improvement * 1000) / 10}%`);
  }
  if (!Number.isFinite(metrics.fallbackRate) || metrics.fallbackRate > maxFallbackRate) {
    failures.push(`fallbackRate ${metrics.fallbackRate} is above ${maxFallbackRate}`);
  }
  if (!Number.isFinite(metrics.qualityPassRate) || metrics.qualityPassRate < minQualityPassRate) {
    failures.push(`qualityPassRate ${metrics.qualityPassRate} is below ${minQualityPassRate}`);
  }
  if (!Number.isFinite(metrics.approvalGatePassRate) || metrics.approvalGatePassRate < minApprovalGatePassRate) {
    failures.push(`approvalGatePassRate ${metrics.approvalGatePassRate} is below ${minApprovalGatePassRate}`);
  }

  return {
    ok: failures.length === 0,
    result: failures.length === 0 ? 'deepspec_benchmark_gate_passed' : 'deepspec_benchmark_gate_failed',
    failures,
    metrics,
    thresholds: {
      minSampleCount,
      minP95Improvement,
      maxFallbackRate,
      minQualityPassRate,
      minApprovalGatePassRate,
    },
    p95Improvement,
    p50Improvement,
  };
}

const benchmarkPath = process.argv[2] || '';

try {
  const metrics = readBenchmark(benchmarkPath);
  const report = evaluateBenchmark(metrics, {
    minSampleCount: process.env.PBK_DEEPSPEC_BENCHMARK_MIN_SAMPLES,
    minP95Improvement: process.env.PBK_DEEPSPEC_BENCHMARK_MIN_P95_IMPROVEMENT,
    maxFallbackRate: process.env.PBK_DEEPSPEC_BENCHMARK_MAX_FALLBACK_RATE,
    minQualityPassRate: process.env.PBK_DEEPSPEC_BENCHMARK_MIN_QUALITY_PASS_RATE,
    minApprovalGatePassRate: process.env.PBK_DEEPSPEC_BENCHMARK_MIN_APPROVAL_GATE_PASS_RATE,
  });
  const output = JSON.stringify(report, null, 2);
  if (!report.ok) {
    console.error(`${output}\nKeep PBK_DEEPSPEC_ENABLED=false until this gate passes.`);
    process.exit(1);
  }
  console.log(output);
} catch (error) {
  console.error(`${error?.message || error}\nKeep PBK_DEEPSPEC_ENABLED=false until benchmark proof exists.`);
  process.exit(1);
}
