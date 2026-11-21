import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as evidence from '../src/app/utils/analyticsEvidence.mjs';
import { buildAnalyticsViewModel } from '../src/app/routes/analyticsRuntimeLogic.js';

const text = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const source = ts.createSourceFile('bridge.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['getRangeStart', 'getRecordTimestamp', 'normalizeAnalyticsStageKey', 'analyticsStageLabel',
  'getAnalyticsLeadStage', 'getAnalyticsLeadRevenue', 'normalizeAnalyticsLead', 'sortAnalyticsStages',
  'groupAnalyticsLeads', 'buildLeadStageFallback', 'buildLeadStageAnalytics', 'isClosedAnalyticsDeal',
  'getAnalyticsDealRevenue', 'getAnalyticsCreationTimestamp', 'normalizeAnalyticsDeal', 'buildDealTimelineFromItems', 'buildDealTimelineAnalytics',
  'buildAiObservabilityMetrics', 'toNumber']);
const statements = source.statements.filter(statement =>
  ts.isFunctionDeclaration(statement) && names.has(statement.name?.text)
  || ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => d.name.getText(source) === 'ANALYTICS_STAGE_ORDER'));

test('actual bridge analytics builders use sample-only SELECTs and preserve protected rows', async () => {
  const db = new PGlite();
  const state = Object.freeze({ leadImports: Object.freeze([]), contracts: Object.freeze([]),
    analyzerRuns: Object.freeze([]), status: Object.freeze({ toolUsage: Object.freeze({}) }) });
  let selects = 0;
  try {
    await db.exec(`
      CREATE TABLE lead_profiles(id text, lead_name text, address text, status text, stage text, raw jsonb,
        workspace_id text DEFAULT 'pbk', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE contracts(id text, lead_id text, status text, amount numeric, payload jsonb,
        workspace_id text DEFAULT 'pbk', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE pbk_turn_latency(created_at timestamptz, turn_completion_ms numeric,
        transcript_to_tts_ms numeric, speech_final_to_reply_start_ms numeric);
      CREATE TABLE pbk_qa_audit(created_at timestamptz, retry_count integer);
      CREATE TABLE pbk_safety_audit(created_at timestamptz, blocked boolean);
      CREATE TABLE pbk_tool_usage(created_at timestamptz DEFAULT now(), context jsonb);
      CREATE TABLE approvals(id text, status text);
      CREATE TABLE calls(id text, status text);
      INSERT INTO approvals VALUES ('SYN-APR','pending');
      INSERT INTO calls VALUES ('SYN-CALL','ended');
      INSERT INTO lead_profiles(id,stage,raw) VALUES
        ('SYN-1','assigned','{"estimatedProfit":25000}'), ('SYN-10','closed','{"revenue":1200}');
      INSERT INTO contracts(id,lead_id,status,amount,payload) VALUES
        ('SYN-SIGNED','SYN-1','signed',900000,'{"estimatedProfit":25000}'),
        ('SYN-CLOSED','SYN-10','closed',900000,'{"revenue":1200}');
      INSERT INTO pbk_tool_usage(context) VALUES ('{"costUsd":100}');
    `);
    const fingerprint = async () => JSON.stringify(await db.query(`SELECT
      (SELECT json_agg(t) FROM approvals t) AS approvals, (SELECT json_agg(t) FROM calls t) AS calls,
      (SELECT json_agg(t) FROM lead_profiles t) AS leads, (SELECT json_agg(t) FROM contracts t) AS contracts`));
    const before = await fingerprint();
    const context = vm.createContext({ ...evidence, state, Date, console,
      isoNow: () => new Date().toISOString(), hashString: () => 1,
      queryPgRows: async (sql, values) => {
        assert.match(sql.trim(), /^(SELECT|WITH)\b/);
        assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
        selects++;
        return { ok: true, ...(await db.query(sql, values)) };
      },
    });
    vm.runInContext(statements.map(s => s.getText(source)).join('\n'), context);
    assert.equal(vm.runInContext("normalizeAnalyticsDeal({id:'SYN-CONTRACT',status:'closed'}).lead.id", context), '',
      'unlinked contract must never manufacture a lead ID');
    assert.equal(vm.runInContext("buildDealTimelineFromItems([{status:'closed',updatedAt:new Date().toISOString()}]).days.length", context), 0,
      'an update timestamp cannot masquerade as contract creation evidence');
    const stages = await vm.runInContext('buildLeadStageAnalytics()', context);
    assert.equal(stages.stages.find(s => s.stage === 'assigned').revenue, null);
    assert.equal(stages.stages.find(s => s.stage === 'closed').total, 1);
    const timeline = await vm.runInContext('buildDealTimelineAnalytics()', context);
    assert.equal(timeline.days.length, 1);
    assert.equal(timeline.days[0].count, 1, 'signed contract cannot count as closed');
    assert.equal(timeline.days[0].revenue, 1200, 'purchase amount cannot enter revenue');
    let metrics = await vm.runInContext('buildAiObservabilityMetrics()', context);
    assert.equal(metrics.metrics.aiSpendUsd, 100);
    assert.equal(metrics.metrics.costEvidence.recordedRecords, 1);
    assert.equal(buildAnalyticsViewModel({ stagesResponse: stages, timelineResponse: timeline,
      aiMetricsResponse: metrics }).roi.roiMultiple, null, 'creation cohort is not a closing-period ratio');
    assert.equal(timeline.dateBasis, 'record_created');
    assert.equal(metrics.metrics.estimatedAiSpendUsd, null, 'absence of estimates is not zero');
    await db.exec(`INSERT INTO pbk_tool_usage(context) VALUES ('{"estimatedCostUsd":20}'), ('{"costUsd":-5}')`);
    metrics = await vm.runInContext('buildAiObservabilityMetrics()', context);
    assert.equal(metrics.metrics.aiSpendUsd, 100);
    assert.equal(metrics.metrics.estimatedAiSpendUsd, 20);
    assert.equal(metrics.metrics.costEvidence.estimatedRecords, 1);
    assert.equal(metrics.metrics.costEvidence.missingRecords, 1);
    assert.equal(buildAnalyticsViewModel({ timelineResponse: timeline, aiMetricsResponse: metrics }).roi.roiMultiple, null);
    await db.exec(`DELETE FROM pbk_tool_usage;
      INSERT INTO pbk_tool_usage(context) VALUES ('{"costUsd":100,"costBasis":"estimated"}'),
        ('{"costUsd":200,"costBasis":"unknown"}')`);
    metrics = await vm.runInContext('buildAiObservabilityMetrics()', context);
    assert.equal(metrics.metrics.costEvidence.recordedRecords, 0);
    assert.equal(metrics.metrics.costEvidence.estimatedRecords, 1);
    assert.equal(metrics.metrics.costEvidence.missingRecords, 1);
    assert.equal(metrics.metrics.aiSpendUsd, null);
    assert.equal(metrics.metrics.estimatedAiSpendUsd, 100);
    await db.exec(`DELETE FROM pbk_tool_usage; INSERT INTO pbk_tool_usage(context) VALUES ('{}'), ('{"estimatedCostUsd":-1}')`);
    metrics = await vm.runInContext('buildAiObservabilityMetrics()', context);
    assert.equal(metrics.metrics.estimatedAiSpendUsd, null);
    await db.exec(`INSERT INTO pbk_tool_usage(context) VALUES ('{"estimatedCostUsd":0}')`);
    metrics = await vm.runInContext('buildAiObservabilityMetrics()', context);
    assert.equal(metrics.metrics.estimatedAiSpendUsd, 0);
    assert.equal(await fingerprint(), before);
    await db.exec(`INSERT INTO contracts(id,lead_id,status,payload,created_at,updated_at) VALUES
      ('SYN-OLD','SYN-10','closed','{"revenue":50}',now()-interval '60 days',now()),
      ('SYN-NEW','deleted-lead','closed','{"revenue":60}',now(),now()-interval '60 days')`);
    const cohort = await vm.runInContext('buildDealTimelineAnalytics()', context);
    assert.equal(cohort.dateBasis, 'record_created');
    assert.equal(cohort.days.reduce((n,d) => n + d.count, 0), 2, 'selection truthfully follows creation, not update/closing date');
    assert.equal(cohort.days.flatMap(d => d.leads).find(l => l.revenue === 60).id, '', 'deleted lead is not inspectable');
    assert(selects >= 10);
  } finally { await db.close(); }
});
