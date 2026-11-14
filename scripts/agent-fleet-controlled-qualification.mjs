import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requiredAgentRegistryIds } from './agent-registry.mjs';
import { validateDeploymentCommit } from './agent-fleet-safe-verification.mjs';
import { controlledWorkflowOrder } from './controlled-agent-workflow.mjs';

// These prove bounded handler work, not customer delivery or organic performance.
export const qualificationCriteria = {
  ava: ['conversationalResponse'],
  rex: ['strategyAnswer', 'sourceEvidence'],
  hermes: ['patternAnalysisExecuted', 'suggestOnly', 'stoppingInterventionLearned'],
  'prosody-tuner': ['finiteProsody', 'fixtureDecisionPersisted'],
  'bant-enforcer': ['allFieldsComplete'],
  'qa-agent': ['validatorExecuted', 'auditPersisted'],
  'research-orchestrator': ['stopDetected', 'contactHalted'],
  max: ['closingAdvice', 'approvalGatePreserved'],
  'script-rotator': ['closingPhrase', 'fixtureMemoryIsolated'],
  'call-analyzer': ['fixtureOnlyAnalysis', 'analysisPersisted'],
  'nurture-agent': ['fixtureProfilePersisted', 'recommendationProduced', 'noSendScheduled'],
};

function timestamp(value, label) {
  assert.equal(typeof value, 'string', `${label}: missing timestamp`);
  const ms = Date.parse(value);
  assert(Number.isFinite(ms), `${label}: invalid timestamp`);
  return ms;
}

export function validateQualificationReport(report, { now = Date.now(), maxSourceAgeMs = 60000, allowExpired = false } = {}) {
  assert.equal(report?.schemaVersion, 'pbk-controlled-qualification-v1');
  assert.equal(report.source, 'controlled-qualification');
  assert.match(report.runId, /^[a-zA-Z0-9-]{1,80}$/);
  assert.equal(report.productionReadinessVerified, false);
  assert.equal(report.organicReadinessPromoted, false);
  for (const key of ['atomic', 'noContact', 'externalWritesBlocked', 'fixtureOnly']) assert.equal(report.guard?.[key], true, `guard: ${key}`);
  assert.equal(report.storage?.backend, 'postgres');
  assert.equal(report.storage.readbackVerified, true);
  assert.deepEqual(report.workflow?.order, [...controlledWorkflowOrder], 'Missing ordered cross-agent workflow');
  assert.equal(report.workflow.linkedAgentCount, 11, 'Unverified workflow dependencies');
  assert.equal(report.workflow.crossAgentWorkflowVerified, true, 'Independent handlers are not a workflow');
  const sourceAt = timestamp(report.fixture?.sourceUpdatedAt, 'fixture');
  assert(sourceAt <= now, 'Source timestamp is in the future');
  assert(Number.isFinite(maxSourceAgeMs) && maxSourceAgeMs > 0 && maxSourceAgeMs <= 60000, 'Cannot weaken source freshness threshold');
  const sourceExpired = now - sourceAt > maxSourceAgeMs;
  assert(allowExpired || !sourceExpired, 'Source evidence expired');
  assert(report.fixture.leadId && report.fixture.callId, 'Missing fixture identity');
  assert.equal(report.agents?.length, requiredAgentRegistryIds.length);
  assert.deepEqual([...new Set(report.agents.map((agent) => agent.agentId))].sort(), [...requiredAgentRegistryIds].sort());
  const tasks = new Set();
  const contexts = new Set();
  for (const agent of report.agents) {
    const label = agent.agentId;
    assert.equal(agent.completed, true, `${label}: incomplete handler`);
    assert.equal(agent.durable, true, `${label}: missing PG readback`);
    assert.equal(agent.workflowLinkVerified, true, `${label}: missing consumed predecessor proof`);
    assert.equal(agent.operational, false, `${label}: diagnostic became business evidence`);
    assert.equal(agent.runId, report.runId, `${label}: run mismatch`);
    for (const key of ['leadId', 'callId', 'sourceUpdatedAt']) assert.equal(agent[key], report.fixture[key], `${label}: ${key} mismatch`);
    assert(agent.workOrderId && !tasks.has(agent.workOrderId), `${label}: missing or duplicate work order`);
    tasks.add(agent.workOrderId);
    assert(agent.contextId && !contexts.has(agent.contextId), `${label}: missing or duplicate context`);
    contexts.add(agent.contextId);
    const completedAt = timestamp(agent.completedAt, label);
    assert(completedAt >= sourceAt && completedAt <= now, `${label}: completion timestamp invalid`);
    assert(typeof agent.outputResult === 'string' && agent.outputResult.length > 0, `${label}: missing handler result`);
    assert(!/(?:handler_ready|registered|registry_status|no_calls|pending|queued|approval_required)/i.test(agent.outputResult), `${label}: status-only result`);
    assert(Array.isArray(agent.evidenceRecordIds) && agent.evidenceRecordIds.length > 0
      && agent.evidenceRecordIds.every((id) => typeof id === 'string' && id.length > 0), `${label}: missing evidence records`);
    for (const criterion of qualificationCriteria[label]) assert.equal(agent.criteria?.[criterion], true, `${label}: ${criterion}`);
  }
  return { runId: report.runId, qualifiedAgentCount: report.agents.length, sourceExpired,
    sourceAgeMs: now - sourceAt, crossAgentWorkflowVerified: true, productionReadinessVerified: false, organicReadinessPromoted: false };
}

export function validateQualificationAging(before, after, options = {}) {
  assert.equal(after.runId, before.runId, 'Readback changed run identity');
  assert.deepEqual(after.fixture, before.fixture, 'Readback refreshed or replaced source fixture');
  for (const agent of before.agents) {
    const stored = after.agents.find((candidate) => candidate.agentId === agent.agentId);
    assert(stored, 'Readback lost agent');
    for (const key of ['workOrderId', 'contextId', 'completedAt', 'sourceUpdatedAt']) assert.equal(stored[key], agent[key], `Readback changed ${key}`);
    assert.deepEqual(stored.evidenceRecordIds, agent.evidenceRecordIds, 'Readback replaced evidence');
  }
  return validateQualificationReport(after, { ...options, allowExpired: true });
}

export function summarizeQualificationResponse(path, httpStatus, data) {
  const knownErrors = new Set(['bridge_error', 'controlled_founder_auth_required', 'controlled_server_fixture_only',
    'controlled_request_rejected', 'controlled_runtime_unavailable', 'controlled_run_in_progress',
    'controlled_custom_column_type_blocked', 'controlled_storage_schema_missing', 'controlled_sql_statement_blocked',
    'controlled_sql_table_blocked', 'controlled_sql_function_blocked', 'controlled_sql_type_blocked']);
  const error = [data?.code, data?.result, data?.error].find((value) => knownErrors.has(value));
  return { path, httpStatus, ...(error ? { errorCode: error } : {}),
    ...(typeof data?.runId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(data.runId) ? { runId: data.runId } : {}),
    ...(Array.isArray(data?.agents) ? { agents: data.agents.filter((item) => qualificationCriteria[item?.agentId]).map((item) => ({
      agentId: item.agentId, completed: item.completed === true, durable: item.durable === true,
      operational: item.operational === true,
      criteria: Object.fromEntries(qualificationCriteria[item.agentId].map((key) => [key, item.criteria?.[key] === true])),
    })) } : {}) };
}

export function createQualificationRequest(baseUrl, apiKey, { onResponse = async () => {} } = {}) {
  const base = new URL(baseUrl);
  assert(base.protocol === 'https:' || (base.protocol === 'http:' && base.hostname === '127.0.0.1'));
  assert(base.pathname === '/' && !base.username && !base.password && !base.search && !base.hash);
  assert(apiKey, 'PBK_BRIDGE_API_KEY is required');
  return async (path, body) => {
    const execute = path === '/api/agents/controlled-qualification' && body !== undefined;
    const readback = /^\/api\/agents\/controlled-qualification\?runId=[a-zA-Z0-9-]{1,80}$/.test(path);
    assert((execute && body && Object.getPrototypeOf(body) === Object.prototype && Object.keys(body).length === 0)
      || (body === undefined && (readback || ['/health', '/api/release/status'].includes(path))), 'Unreviewed qualification request blocked');
    const response = await fetch(new URL(path, base), {
      method: execute ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      ...(execute ? { body: '{}' } : {}), signal: AbortSignal.timeout(120000),
    });
    const data = await response.json();
    await onResponse(summarizeQualificationResponse(path, response.status, data));
    assert(response.ok, `Qualification HTTP ${response.status}`);
    return data;
  };
}

export async function runControlledQualification(request, {
  expectedRevision, reviewedGuardRevision, now = Date.now, verifyAging = false,
  wait = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  assert.match(expectedRevision || '', /^[a-f0-9]{40}$/i, 'Full expected revision required');
  assert.equal(reviewedGuardRevision, expectedRevision, 'Independent guard review must match deployed revision');
  const health = await request('/health');
  assert.equal(health.features?.authRequired, true);
  assert.equal(health.features?.stateBackend, 'postgres');
  const deployment = validateDeploymentCommit(await request('/api/release/status'), expectedRevision);
  const report = await request('/api/agents/controlled-qualification', {});
  const execution = validateQualificationReport(report, { now: now() });
  const readback = await request(`/api/agents/controlled-qualification?runId=${encodeURIComponent(report.runId)}`);
  validateQualificationAging(report, readback, { now: now() });
  const persisted = validateQualificationReport(readback, { now: now() });
  let aged = null;
  if (verifyAging) {
    const delay = Math.max(0, Date.parse(report.fixture.sourceUpdatedAt) + 60001 - now());
    await wait(delay);
    aged = validateQualificationAging(report,
      await request(`/api/agents/controlled-qualification?runId=${encodeURIComponent(report.runId)}`), { now: now() });
    assert.equal(aged.sourceExpired, true, 'Source did not age independently');
  }
  return { ...execution, ...persisted, deployment, independentReadbackVerified: true,
    freshnessAgingVerified: Boolean(aged), agedSourceExpired: aged?.sourceExpired ?? null,
    crossAgentWorkflowVerified: persisted.crossAgentWorkflowVerified, phoneLatencyProven: false,
    workflow: readback.workflow,
    evidence: readback.agents.map(({ agentId, workOrderId, contextId, evidenceRecordIds, completedAt, sourceUpdatedAt, workflowLink, workflowLinkVerified }) =>
      ({ agentId, workOrderId, contextId, evidenceRecordIds, completedAt, sourceUpdatedAt,
        workflowLinkVerified, sequence: workflowLink.sequence, predecessorAgentId: workflowLink.predecessorAgentId,
        predecessorWorkOrderId: workflowLink.predecessorWorkOrderId, predecessorOutputDigest: workflowLink.predecessorOutputDigest })) };
}

async function main(args) {
  if (!args.length || (args.length === 1 && args[0] === '--plan')) return {
    endpoint: '/api/agents/controlled-qualification', method: 'POST', body: {},
    guard: 'Requires independent atomic server-guard review at exact deployed commit before execution.',
    agentCriteria: qualificationCriteria, organicReadinessPromoted: false,
  };
  assert(args.length === 7 && args[0] === '--execute' && args[1] === '--expected-revision'
    && args[3] === '--guard-reviewed-revision' && args[5] === '--output',
  'Usage: --plan | --execute --expected-revision SHA --guard-reviewed-revision SHA --output PATH');
  const result = await runControlledQualification(createQualificationRequest(process.env.PBK_BRIDGE_URL, process.env.PBK_BRIDGE_API_KEY,
    { onResponse: (summary) => appendFile(resolve(`${args[6]}.attempt.ndjson`), `${JSON.stringify(summary)}\n`) }),
    { expectedRevision: args[2], reviewedGuardRevision: args[4], verifyAging: true });
  await writeFile(resolve(args[6]), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch(() => { console.error('Controlled qualification failed; no readiness claim made.'); process.exitCode = 1; });
}
