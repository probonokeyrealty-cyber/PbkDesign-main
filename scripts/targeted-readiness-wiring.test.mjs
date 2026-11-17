import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from '@jest/globals';
import { isExcludedEpisodicCall, selectBestEpisodicTranscript } from './ava-episodic-memory.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(name) {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert(node, `Missing actual bridge function ${name}`);
  return node;
}

for (const name of ['buildProductionReadinessSnapshot', 'buildAgentOrchestrationSnapshot']) {
  test(`${name} uses validated latency policy rather than an empty matrix`, () => {
    const text = declaration(name).getText(ast);
    assert.match(text, /getAgentLatencyPolicy\(process\.env\)/);
    assert.doesNotMatch(text, /latencyBudgetsMs:\s*\{\s*\}/);
    assert.match(text, /latencyBudgetsMs:\s*latencyPolicy\.budgets/);
  });
}

function memoryRuntime({ call = null, outcome = { verified: true }, receiptError = false } = {}) {
  const receipts = [];
  const pool = {};
  const sandbox = vm.createContext({
    AVA_EPISODIC_MEMORY_ENABLED: true, DATABASE_URL: 'fixture-database',
    BRIDGE_API_KEY: 'fixture-authority', BUILD_REVISION: 'a'.repeat(40),
    process: { env: { RENDER_GIT_COMMIT: 'a'.repeat(40) } },
    loadCallRecordForEmbedding: async () => call,
    isExcludedEpisodicCall, selectBestEpisodicTranscript,
    getPgPool: () => pool,
    createHash, TEXT_EMBEDDING_MODEL: 'fixture-model',
    queryPgRows: async () => ({ ok: true, rows: [{ id: 'existing-memory' }] }),
    recordCallMemorySkip: async options => {
      receipts.push(options);
      if (receiptError) throw new Error('fixture database unavailable');
      return outcome;
    },
  });
  const invoke = vm.runInContext(`(${declaration('upsertCallEmbeddingFromTranscript').getText(ast)})`, sandbox);
  return { invoke, receipts, pool };
}

test('actual short-memory branch records source-bound evidence only after evaluating the skip', async () => {
  const f = memoryRuntime();
  const result = await f.invoke({ callId: 'call-fixture', eventId: 'event-fixture', transcript: 'Short reply.' });
  assert.equal(result.result, 'insufficient_call_memory');
  assert.equal(result.skipped, true);
  assert.equal(f.receipts.length, 1);
  assert.equal(f.receipts[0].pool, f.pool);
  assert.equal(f.receipts[0].eventId, 'event-fixture');
  assert.equal(f.receipts[0].callId, 'call-fixture');
  assert.equal(f.receipts[0].sourceText, 'Short reply.');
  assert.equal(result.memoryPolicyOutcome.verified, true);
  assert.equal(result.memoryPolicyOutcome.embeddingVerified, false);
  assert.equal(result.memoryPolicyOutcome.fullRecoveryVerified, false);
});

test('missing original event cannot create a historical skip claim', async () => {
  const f = memoryRuntime();
  const result = await f.invoke({ callId: 'call-fixture', transcript: 'Short reply.' });
  assert.equal(f.receipts.length, 0);
  assert.equal(result.memoryPolicyOutcome.verified, false);
});

test('failed receipt persistence remains unverified without changing skip semantics', async () => {
  const f = memoryRuntime({ outcome: { verified: false, recorded: false, result: 'source_unverified' } });
  const result = await f.invoke({ callId: 'call-fixture', eventId: 'event-fixture', transcript: 'Short reply.' });
  assert.equal(result.result, 'insufficient_call_memory');
  assert.equal(result.memoryPolicyOutcome.verified, false);
  assert.equal(result.memoryPolicyOutcome.embeddingVerified, false);
});

test('cross-workspace requests do not create PBK skip evidence', async () => {
  const f = memoryRuntime();
  const result = await f.invoke({ workspaceId: 'other', callId: 'call-fixture',
    eventId: 'event-fixture', transcript: 'Short reply.' });
  assert.equal(f.receipts.length, 0);
  assert.equal(result.memoryPolicyOutcome.verified, false);
});

test('canonical longer source is not labelled a short skip', async () => {
  const f = memoryRuntime({ call: { transcript: 'Longer canonical transcript. '.repeat(5) } });
  const result = await f.invoke({ callId: 'call-fixture', eventId: 'event-fixture', transcript: 'Okay.' });
  assert.equal(f.receipts.length, 0);
  assert.equal(result.result, 'call_embedding_already_current');
  assert.equal(result.memoryPolicyOutcome, undefined);
});

test('synthetic source is excluded before receipt generation', async () => {
  const f = memoryRuntime();
  const result = await f.invoke({ synthetic: true, callId: 'call-fixture',
    eventId: 'event-fixture', transcript: 'Short reply.' });
  assert.equal(result.result, 'excluded_call_memory');
  assert.equal(f.receipts.length, 0);
});

test('receipt exceptions surface an unverified outcome without provider fallthrough', async () => {
  const f = memoryRuntime({ receiptError: true });
  const result = await f.invoke({ callId: 'call-fixture', eventId: 'event-fixture', transcript: 'Short reply.' });
  assert.equal(result.result, 'insufficient_call_memory');
  assert.equal(result.memoryPolicyOutcome.verified, false);
  assert.equal(result.memoryPolicyOutcome.result, 'memory_skip_receipt_unavailable');
});

test('worker passes original event identity into the existing memory tool', () => {
  const worker = readFileSync(new URL('./event-worker.mjs', import.meta.url), 'utf8');
  const node = ts.createSourceFile('worker.mjs', worker, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let memoryCall;
  const visit = item => {
    if (ts.isCallExpression(item) && item.arguments[0]?.text === 'upsertCallEmbeddingFromTranscript') memoryCall = item;
    ts.forEachChild(item, visit);
  };
  visit(node);
  assert(memoryCall);
  const args = memoryCall.arguments[1];
  assert(ts.isObjectLiteralExpression(args));
  assert(args.properties.some(item => item.name?.getText(node) === 'eventId'
    && item.initializer?.getText(node) === 'event.id'));
});

test('maturity exposes memory outcomes without replacing signed reconciliation embedding counts', () => {
  const text = declaration('buildProductionMaturitySnapshot').getText(ast);
  assert.match(text, /readCallMemorySkipSummary/);
  assert.match(text, /memoryPolicyOutcomes/);
  assert.match(text, /counts:\s*backlogReconciliation\.verified \? backlogReconciliation\.reconciliation\.counts : null/);
  assert.match(text, /launchQualified:\s*false/);
});

test('compact context retains source freshness without converting generatedAt into source time', () => {
  const summarize = vm.runInNewContext(`(${declaration('summarizeRuntimePBKIntelligenceContext').getText(ast)})`);
  const sourceAt = '2026-11-16T12:00:00.000Z';
  const context = { generatedAt: '2026-11-16T12:05:00.000Z', identity: { leadId: 'fixture-lead' },
    dataFreshness: { ready: false, lastSyncAt: sourceAt,
      source: { kind: 'runtime_lead_record', recordId: 'fixture-lead', at: sourceAt } } };
  const summary = summarize(context);
  assert.equal(summary.dataFreshness.lastSyncAt, sourceAt);
  assert.equal(summary.dataFreshness.source.at, sourceAt);
  assert.equal(summary.dataFreshnessReady, false);
  assert.equal(summarize({ generatedAt: context.generatedAt }).dataFreshness, null);
});
