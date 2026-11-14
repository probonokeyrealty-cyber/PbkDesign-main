import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requiredAgentRegistryIds } from './agent-registry.mjs';
import { buildAgentRuntimeSmokeEnv } from './agent-runtime-smoke-isolation.mjs';

const recipes = {
  ava: { command: 'Ava, who are you?' },
  rex: { query: 'Operator summary', limit: 1, remember: false },
  hermes: { query: 'Inspect advisory status' },
  'prosody-tuner': { query: 'Inspect advice', emotion: 'hesitant', sentiment: 0.45, train: false },
  'bant-enforcer': { query: 'Inspect qualification status', bant: {} },
  'qa-agent': { query: 'Inspect validator registration' },
  'research-orchestrator': { query: 'Evaluate safety guard', transcript: 'Please stop calling.' },
  max: { query: 'Inspect approval-safe closing advice', synthesize: false },
  'script-rotator': { query: 'Inspect closing script advice', synthesize: false },
  'call-analyzer': { query: 'Inspect isolated fixture storage', limit: 1 },
  'nurture-agent': { query: 'Inspect unconfigured nurture branch' },
};
const limitations = {
  max: 'Isolated closing advice only; no provider memory or contract delivery verified.',
  'script-rotator': 'Isolated closing advice only; no provider memory or outcome verified.',
  'call-analyzer': 'Analyzes bridge-seeded demo fixtures in isolated storage, never customer-call evidence.',
  'nurture-agent': 'Unconfigured database branch only; no nurture storage or sequence verified.',
};

export function buildSafeFleetPlan(runId = randomUUID()) {
  assert.match(runId, /^[a-zA-Z0-9-]{1,80}$/);
  return requiredAgentRegistryIds.map((agentId) => {
    const leadId = `diagnostic-fleet-${runId}-${agentId}`;
    return {
      agentId,
      preview: { agentId, leadId, allowImplicitContext: false },
      invoke: recipes[agentId] ? {
        agentId,
        payload: {
          source: 'synthetic-fleet-verification', actor: 'Fleet Diagnostic',
          leadId, allowImplicitContext: false, dryRun: true, smoke: true,
          readOnly: true, noProviderWrites: true, providerWrites: false,
          ...recipes[agentId],
        },
      } : null,
      limitation: limitations[agentId] || (agentId === 'hermes'
        ? 'Provider configuration/status only, not a strategist request.'
        : agentId === 'qa-agent' ? 'Registration status only; QA validators can create approvals.'
          : 'Synthetic diagnostic branch, not production workload or provider delivery.'),
    };
  });
}

export function requireLocalRegistry(registry, agentId) {
  const matches = (registry?.agents || []).filter((agent) => agent.id === agentId);
  assert.equal(matches.length, 1, `${agentId}: missing or duplicate registry entry`);
  const agent = matches[0];
  assert(['active', 'standby'].includes(agent.status), `${agentId}: not routable`);
  assert.notEqual(agent.metadata?.local, false, `${agentId}: explicit nonlocal registration`);
  assert(['', '/invoke'].includes(agent.endpoint || ''), `${agentId}: unreviewed or remote endpoint`);
  return agent;
}

export function validateDiagnosticResult(entry, result) {
  const id = entry.agentId;
  assert.equal(result.ok, true, `${id}: envelope failed`);
  assert.equal(result.result, 'agent_invoked');
  assert.equal(result.routedTo, `invokeRegisteredAgent:${id}`);
  requireLocalRegistry({ agents: [result.agent] }, id);
  const output = result.output;
  assert(output && output.ok !== false, `${id}: nested handler failed`);
  const order = result.workOrder;
  assert.equal(order?.agentId, id);
  assert(order.id && order.id === result.agentTask?.id, `${id}: work-order/task identity missing`);
  assert.equal(order.source, 'synthetic-fleet-verification');
  assert.equal(order.approvalPolicy?.providerWriteIntent, false, `${id}: unexpected provider-write intent`);
  assert.equal(order.approvalPolicy?.approvalRequired, false, `${id}: unexpected approval requirement`);
  assert.equal(result.agentTask.status, 'complete', `${id}: incomplete task`);
  assert.equal(result.agentTask.metadata?.routedTo, result.routedTo);
  const context = result.pbkIntelligenceContext;
  assert(context?.contextId, `${id}: no context trace`);
  assert.equal(context.identity?.leadId, entry.invoke.payload.leadId);
  assert.equal(context.readiness?.required?.agentCoverage, true);
  // No retrieved source timestamp is supplied by this diagnostic.
  assert.equal(context.dataFreshnessReady, false, `${id}: fabricated source freshness`);
  assert.equal(context.readiness?.ready, false, `${id}: diagnostic must not certify readiness`);
  switch (id) {
    case 'max':
      assert.equal(output.result, 'max_contract_handoff_ready');
      assert.equal(output.closing?.ok, true);
      assert.equal(output.closing?.result, 'closing_intelligence');
      assert.equal(output.safety?.approvalGate, true);
      break;
    case 'script-rotator':
      assert.equal(output.result, 'closing_intelligence');
      assert.equal(typeof output.nextBestPhrase, 'string');
      assert(output.nextBestPhrase.length > 0);
      break;
    case 'call-analyzer':
      assert.equal(output.result, 'call_analysis_complete');
      assert.equal(output.analyzed, 1);
      assert.equal(output.analyses?.length, 1);
      assert(output.analyses[0].callId);
      assert.equal(output.analyses[0].metadata?.source, 'synthetic-fleet-verification');
      assert.equal(output.providerWritesBlocked, true);
      break;
    case 'nurture-agent':
      assert.equal(output.result, 'nurture_agent_handler_ready');
      assert.equal(output.configured, false);
      assert.equal(output.providerReady, false);
      assert.equal(output.recommendation?.approvalRequired, true);
      break;
    case 'ava':
      assert.equal(output.routedTo, 'agent_brain');
      assert.equal(output.response?.ok, true);
      assert(output.response.doctrine?.bantFields?.length);
      break;
    case 'rex':
      assert(output.readableSummary && typeof output.answer === 'string');
      assert.equal(output.memory?.stored, false);
      break;
    case 'hermes':
      assert.equal(output.result, 'hermes_registry_status');
      assert.equal(output.safety?.suggestOnly, true);
      break;
    case 'prosody-tuner':
      assert.equal(output.result, 'prosody_advice');
      assert.equal(output.prosody?.emotion, 'hesitant');
      assert(Number.isFinite(output.prosody?.speed));
      break;
    case 'bant-enforcer':
      assert.equal(output.result, 'bant_enforcer_status');
      assert.equal(output.complete, false);
      assert(output.missing?.length > 0);
      break;
    case 'qa-agent':
      assert.equal(output.result, 'qa_agent_registered');
      assert.equal(output.qa?.validators, 'active');
      break;
    case 'research-orchestrator':
      assert.equal(output.result, 'halt');
      assert(output.flags.includes('dnc_or_stop_request'));
      assert.equal(output.safety?.canOverrideAva, true);
      break;
    default: throw new Error(`No reviewed diagnostic for ${id}`);
  }
  return { agentId: id, valid: true, workOrderId: order.id, contextId: context.contextId,
    contextReady: false, routedTo: result.routedTo,
    evidence: 'synthetic_local_handler_diagnostic', limitation: entry.limitation };
}

export function validatePersistedDiagnostics(diagnostics, storedState) {
  assert.equal(diagnostics.length, requiredAgentRegistryIds.length);
  assert.deepEqual([...new Set(diagnostics.map((item) => item.agentId))].sort(), [...requiredAgentRegistryIds].sort());
  assert.equal(new Set(diagnostics.map((item) => item.workOrderId)).size, diagnostics.length);
  for (const diagnostic of diagnostics) {
    const matches = (storedState.agentTasks || []).filter((task) => task.id === diagnostic.workOrderId);
    assert.equal(matches.length, 1, `${diagnostic.agentId}: persisted task missing or duplicated`);
    const task = matches[0];
    assert.equal(task.status, 'complete', `${diagnostic.agentId}: completion not durable`);
    assert.equal(task.metadata?.workOrder?.source, 'synthetic-fleet-verification');
    assert.equal(task.metadata?.workOrder?.agentId, diagnostic.agentId);
    assert.equal(task.metadata?.routedTo, diagnostic.routedTo);
    assert.equal(task.metadata?.pbkIntelligenceContext?.contextId, diagnostic.contextId);
    assert.equal(task.metadata?.executionEvidence?.operational, false,
      `${diagnostic.agentId}: synthetic task must not enter operational measurements`);
  }
  return { backend: 'isolated_file', taskCount: diagnostics.length,
    evidence: 'synthetic_persisted_task_context_links', crossAgentWorkflowVerified: false,
    sourceFreshnessVerified: false, productionStorageVerified: false };
}

export function createVerifierRequest(baseUrl, apiKey, { isolated = false } = {}) {
  const base = new URL(baseUrl);
  assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash);
  assert(base.protocol === 'https:' || (base.protocol === 'http:' && base.hostname === '127.0.0.1'));
  assert(!isolated || (base.protocol === 'http:' && base.hostname === '127.0.0.1'),
    'Isolated diagnostics require the loopback child, never a hosted bridge');
  assert(apiKey, 'PBK_BRIDGE_API_KEY is required');
  const reads = new Set(['/health', '/api/release/status', '/api/agents/discover', '/api/agents/measurement']);
  return async (path, body) => {
    const preview = path === '/api/agents/deal-context/preview' && body !== undefined;
    const privateTest = isolated && ['/state', '/api/agents/registry/health', '/api/agents/invoke'].includes(path);
    assert(preview || (body === undefined && reads.has(path)) || privateTest,
      'Hosted invocation is disabled: registry preflight is not an atomic local-only guard');
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    assert(response.ok || (path === '/api/agents/measurement' && response.status === 503),
      `${path}: HTTP ${response.status}`);
    return data;
  };
}

export function validateDeploymentCommit(status, expectedRevision) {
  assert.match(expectedRevision, /^[a-f0-9]{40}$/i, 'Expected revision must be a full Git SHA');
  const observed = status?.release?.commit;
  assert.equal(status?.ok, true, 'Release status unavailable');
  assert.equal(typeof observed, 'string', 'Deployed commit is missing');
  assert.match(observed, /^(?:[a-f0-9]{12}|[a-f0-9]{40})$/i, 'Deployed commit must expose at least 12 hex characters');
  assert.equal(observed.toLowerCase(), expectedRevision.slice(0, observed.length).toLowerCase(),
    'Unexpected deployed Git commit');
  return { expectedCommit: expectedRevision, observedCommit: observed,
    matchedCharacters: observed.length, fullShaVerified: observed.length === 40,
    evidence: 'bridge_reported_git_commit', deploymentHealthVerified: false };
}

export async function verifySafeFleet(request, { invokeDiagnostics = false, expectedRevision = '' } = {}) {
  const health = await request('/health');
  const deployment = expectedRevision
    ? validateDeploymentCommit(await request('/api/release/status'), expectedRevision) : null;
  const plan = buildSafeFleetPlan();
  const previews = [];
  const diagnostics = [];
  for (const entry of plan) {
    // Discovery is uncached, unlike /registry. It still cannot lock hosted routing.
    const discovery = await request('/api/agents/discover');
    const registry = discovery.registry?.registry || discovery.registry || discovery;
    const agent = requireLocalRegistry(registry, entry.agentId);
    const preview = await request('/api/agents/deal-context/preview', entry.preview);
    assert.equal(preview.writeMode, 'read_only');
    assert.equal(preview.agent?.id, entry.agentId);
    assert.equal(preview.safety?.providerWritesBlocked, true);
    assert.equal(preview.lead?.found, false, 'Diagnostic unexpectedly matched an existing seller');
    previews.push({ agentId: agent.id, valid: true, local: true, sellerFound: false });
    if (invokeDiagnostics && entry.invoke) {
      const start = performance.now();
      const result = await request('/api/agents/invoke', entry.invoke);
      diagnostics.push({ ...validateDiagnosticResult(entry, result),
        syntheticHttpRoundTripMs: Math.round(performance.now() - start) });
    }
  }
  const measured = await request('/api/agents/measurement');
  return {
    result: invokeDiagnostics ? 'isolated_diagnostics_verified' : 'hosted_previews_verified',
    revision: health.revision, deployment, previews, diagnostics,
    skippedInvocations: plan.filter((entry) => !invokeDiagnostics || !entry.invoke)
      .map(({ agentId, limitation }) => ({ agentId, reason: invokeDiagnostics ? limitation : 'Hosted invoke disabled; preview only.' })),
    observedMeasurementReady: measured.measurement?.ready ?? null,
    fullFleetActionsVerified: false, productionThroughputVerified: false,
    productionReadinessVerified: false, avaLatencySloVerified: false,
    note: 'Client timings are synthetic round trips, never uploaded as agent latency. No source freshness is invented.',
  };
}

async function isolatedSmoke() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const stateDir = await mkdtemp(join(tmpdir(), 'pbk-safe-fleet-'));
  const apiKey = randomUUID();
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const child = spawn(process.execPath, [
    '--import', new URL('./agent-runtime-smoke-isolation.mjs', import.meta.url).href,
    'scripts/openclaw-local-server.mjs',
  ], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...buildAgentRuntimeSmokeEnv(), PBK_AGENT_SMOKE_ISOLATED: '1',
      HOST: '127.0.0.1', PORT: String(port), PBK_BRIDGE_API_KEY: apiKey,
      PBK_OPENCLAW_STATE_DIR: stateDir, PBK_DISABLE_POSTGRES: '1',
      PBK_SUPABASE_ENABLED: '0', PBK_REDIS_ENABLED: '0' },
  });
  child.stdout.resume();
  child.stderr.resume();
  const request = createVerifierRequest(`http://127.0.0.1:${port}`, apiKey, { isolated: true });
  try {
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try { await request('/health'); ready = true; break; } catch { /* Wait for this child only. */ }
      await new Promise((done) => setTimeout(done, 100));
    }
    assert(ready, 'Isolated bridge failed to start (child output withheld).');
    await request('/api/agents/registry/health', { persist: false });
    const before = await request('/state');
    const result = await verifySafeFleet(request, { invokeDiagnostics: true });
    const after = await request('/state');
    for (const collection of ['calls', 'leadImports', 'approvals', 'contracts', 'emotionalLearningMemory']) {
      assert.deepEqual(after[collection], before[collection], `${collection} changed during diagnostics`);
    }
    for (const field of ['pbkIntelligenceContext', 'pbkIntelligenceReadiness', 'lastPBKIntelligenceContextAt']) {
      assert.deepEqual(after.status?.[field], before.status?.[field],
        `${field}: synthetic diagnostics contaminated global readiness`);
    }
    assert.equal(result.diagnostics.length, requiredAgentRegistryIds.length);
    const persisted = JSON.parse(await readFile(join(stateDir, 'openclaw-state.json'), 'utf8'));
    result.storageDiagnostics = validatePersistedDiagnostics(result.diagnostics, persisted);
    const analyses = persisted.callAnalyses.filter((item) => item.metadata?.source === 'synthetic-fleet-verification');
    assert.equal(analyses.length, 1, 'Expected one persisted synthetic analysis');
    assert(before.calls.some((call) => String(call.id) === analyses[0].callId),
      'Analysis must reference a fixture loaded from this isolated child');
    result.storageDiagnostics.syntheticCallAnalysisCount = analyses.length;
    assert.equal(result.observedMeasurementReady, false);
    return result;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    const target = relative(tmpdir(), stateDir);
    assert(!isAbsolute(target) && target.startsWith('pbk-safe-fleet-') && !target.includes('..'));
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function main(args) {
  if (!args.length || (args.length === 1 && args[0] === '--plan')) {
    return { method: 'POST', path: '/api/agents/invoke', auth: 'Bearer PBK_BRIDGE_API_KEY',
      guard: 'Recipes require reviewed local handlers. Flags express intent, not provider enforcement. Hosted execution is disabled.',
      effects: 'Isolated-only tasks/context, activity, fixture call analysis and possible closing-memory updates; latest context may become incomplete.',
      plan: buildSafeFleetPlan('REPLACE-WITH-UNIQUE-RUN-ID') };
  }
  if (args.length === 1 && args[0] === '--isolated') return isolatedSmoke();
  assert(args.length === 4 && args[0] === '--base-url' && args[2] === '--expected-revision',
    'Usage: --plan | --isolated | --base-url URL --expected-revision SHA (hosted previews only)');
  assert(args[3], 'Expected revision is required');
  return verifySafeFleet(createVerifierRequest(args[1], process.env.PBK_BRIDGE_API_KEY), { expectedRevision: args[3] });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
