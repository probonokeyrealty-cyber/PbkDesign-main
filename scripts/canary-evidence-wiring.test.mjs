import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { AGENT_LATENCY_PILOT_V2, getAgentLatencyPolicy } from './agent-latency-policy.mjs';
import { buildExecutedReadinessEvidence } from './production-maturity-loop.mjs';
import { readCanaryEvidence } from './canary-evidence-reader.mjs';
import { verifyCanaryChain } from './canary-evidence-protocol.mjs';
import { makeCanaryFixture, rebuildCanaryFixture } from './fixtures/canary-evidence-fixture.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('async function buildProductionMaturitySnapshot(');
const end = source.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start, 'Isolate the actual maturity builder, never bridge startup');
const env = { PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(AGENT_LATENCY_PILOT_V2) };
const policy = getAgentLatencyPolicy(env, { requireVersion2: true });

function harness(options = {}) {
  const now = Date.now();
  const f = makeCanaryFixture({ now, policyHash: policy.hash });
  options.changeFixture?.(f);
  const verdict = verifyCanaryChain({ ...f, now });
  assert.equal(verdict.verified, true, 'The protocol, not test business logic, produces the proof');
  const canary = { ...verdict, ok: true, readbackVerified: true, source: 'postgres:pbk_eval_runs', runId: f.comparison.id };
  const executedAt = new Date(now - 1000).toISOString();
  const run = (runId, extra = {}) => ({ runId, revision: f.revision, executed: true, executedAt, provenance: 'controlled', ...extra });
  const qualification = { verified: true, source: 'postgres:pbk_eval_runs', qualification: { ready: true }, evidence: {
    failedCallEval: run('controlled-eval', { scenarios: [{ id: 'approval', passed: true }] }),
    behavior: run('controlled-behavior', { passed: true }),
  } };
  const audit = { verified: true, audit: { ready: true }, evidence: {
    silentErrors: run('operational-audit', { passed: true, provenance: 'operational', scope: 'durable_operational_audit' }),
  } };
  const fleet = { ready: true };
  options.changeQualification?.(qualification);
  options.changeAudit?.(audit);
  options.changeFleet?.(fleet);
  const pool = Object.hasOwn(options, 'pool') ? options.pool : {};
  const calls = [], policyCalls = [];
  const sandbox = vm.createContext({
    Date, process: { env: { ...env, ...options.env } }, BUILD_REVISION: f.revision, BRIDGE_API_KEY: f.secret,
    getRuntimeMeta: () => ({}), isoNow: () => new Date(now).toISOString(),
    getRuntimeEventArchiveStatus: () => ({ ready: true }),
    getProviderCircuitStatus: () => ({ ready: true }),
    buildAgentOrchestrationSnapshot: () => ({ measurement: fleet }),
    productionReadinessMonitor: { getSloStatus: () => options.sloStatus || {} },
    getPgPool: () => pool, RELEASE_QUALIFICATION_CASES: ['approval'], AVA_REAL_CALL_EVAL_SCENARIOS: ['approval'],
    readReleaseQualification: async () => qualification,
    readOperationalAudit: async () => audit,
    readBacklogReconciliation: async () => ({ verified: true, reconciliation: { counts: {} } }),
    collectBacklogReconciliation: () => { throw new Error('Maturity must not run reconciliation'); },
    readCallMemorySkipSummary: async () => ({ verified: true, launchQualified: false }),
    getAgentLatencyPolicy: (input, config) => { policyCalls.push({ input, config }); return getAgentLatencyPolicy(input, config); },
    readCanaryEvidence: async (input) => {
      calls.push(input);
      return options.reader ? options.reader(input) : { ...canary, ...options.canary };
    },
    // Use the existing gate unchanged, including its real clock and thresholds.
    buildExecutedReadinessEvidence,
  });
  vm.runInContext(source.slice(start, end), sandbox);
  return { build: (input) => sandbox.buildProductionMaturitySnapshot(input), calls, policyCalls, f, pool, canary };
}

test('verified protocol chain reaches existing maturity gates with server-owned reader context', async () => {
  const h = harness();
  const result = await h.build({ pool: 'request', secret: 'request', revision: 'request', policy: {}, now: () => 0 });
  assert.equal(h.calls.length, 1);
  const input = h.calls[0];
  assert.equal(input.pool, h.pool);
  assert.equal(input.secret, h.f.secret);
  assert.equal(input.revision, h.f.revision);
  assert.equal(input.policy.ready, true);
  assert.equal(input.policy.version, 2);
  assert.equal(input.policy.hash, policy.hash);
  assert.equal(typeof input.now, 'function');
  assert(Math.abs(input.now() - Date.now()) < 1000);
  assert.equal(h.policyCalls[0].config.requireVersion2, true);
  assert.equal(result.ready, true);
  assert.equal(result.executionEvidence.runs.canary.runId, h.f.comparison.id);
  assert.equal(result.canaryPromotionGate.ready, true);
  assert.equal(result.shadowCanaryComparison.mode, 'verified');
  assert(!result.shadowCanaryComparison.note.startsWith('No independent'));
  assert.equal(result.canaryEvidence.verified, true);
  assert.equal(result.canaryEvidence.readbackVerified, true);
  assert.equal(result.canaryEvidence.runId, h.f.comparison.id);
  assert.equal(result.canaryEvidence.evidence, undefined);
  assert.equal(result.canaryEvidence.secret, undefined);
  assert(Buffer.byteLength(JSON.stringify(result.canaryEvidence)) < 8192);
});

test('Render revision, not request revision, is passed to the reader', async () => {
  const revision = 'c'.repeat(40);
  const h = harness({ env: { RENDER_GIT_COMMIT: revision } });
  await h.build({ revision: 'request' });
  assert.equal(h.calls[0].revision, revision);
});

for (const verified of [false, undefined, null, 'true', 1]) {
  test(`unverified reader cannot smuggle passing canary evidence: ${String(verified)}`, async () => {
    const h = harness({ canary: { verified, readbackVerified: false, result: 'canary_evidence_invalid' } });
    const result = await h.build();
    assert.equal(result.ready, false);
    assert.equal(result.canaryPromotionGate.ready, false);
    assert.equal(result.executionEvidence.runs.canary.runId, null);
    assert.equal(result.canaryEvidence.verified, false);
    assert.equal(result.canaryEvidence.runId, null);
    assert.equal(result.shadowCanaryComparison.mode, 'unverified');
  });
}

for (const [label, changeFixture, blocker] of [
  ['behavior', (f) => { f.observations.at(-1).report.behaviorPassed = false; }, 'behavior_pass_rate_below_threshold'],
  ['latency', (f) => { for (const r of f.observations.slice(20)) r.report.latencyMs = 1500; }, 'p95_latency_regression'],
  ['error', (f) => { Object.assign(f.observations.at(-1).report, { outcome: 'error', behaviorPassed: false }); }, 'error_rate_regression'],
  ['fallback', (f) => { f.observations.at(-1).report.fallback = true; }, 'fallback_rate_regression'],
]) {
  test(`verified ${label} regressions still fail existing thresholds`, async () => {
    const h = harness({ changeFixture: (f) => { changeFixture(f); rebuildCanaryFixture(f); } });
    const result = await h.build();
    assert.equal(result.canaryEvidence.verified, true);
    assert.equal(result.shadowCanaryComparison.mode, 'verified');
    assert(result.shadowCanaryComparison.blockers.includes(blocker));
    assert.equal(result.ready, false);
    assert.equal(result.canaryPromotionGate.ready, false);
  });
}

for (const [label, options] of [
  ['fleet', { changeFleet: (f) => { f.ready = false; } }],
  ['qualification', { changeQualification: (q) => { q.qualification.ready = false; q.evidence = {}; } }],
  ['audit', { changeAudit: (a) => { a.audit.ready = false; a.evidence.silentErrors.passed = false; } }],
  ['SLO', { sloStatus: { burned: ['ava_latency'] } }],
]) {
  test(`verified canary does not replace the independent ${label} blocker`, async () => {
    const result = await harness(options).build();
    assert.equal(result.canaryEvidence.verified, true);
    assert.equal(result.shadowCanaryComparison.ready, true);
    assert.equal(result.ready, false);
    if (label === 'fleet') assert(result.summary.blockers.includes('stable_agent_fleet_measurement'));
    else assert.equal(result.canaryPromotionGate.ready, false);
    assert.equal(result.backlogReconciliation.launchQualified, false);
    assert.equal(result.backlogReconciliation.providerWritesBlocked, true);
  });
}

for (const [label, pool, code] of [
  ['missing storage', null, 'canary_evidence_invalid'],
  ['rejected storage', { connect: async () => { throw new Error('private storage failure'); } }, 'canary_evidence_unavailable'],
]) {
  test(`${label} returns safe diagnostics without crashing maturity`, async () => {
    const result = await harness({ pool, reader: readCanaryEvidence }).build();
    assert.equal(result.ok, true);
    assert.equal(result.ready, false);
    assert.equal(result.canaryEvidence.verified, false);
    assert.equal(result.canaryEvidence.runId, null);
    assert.equal(result.canaryEvidence.result, code);
    assert(!JSON.stringify(result).includes('private storage failure'));
  });
}

test('unexpected reader rejection fails closed without exposing its error', async () => {
  const result = await harness({ reader: async () => { throw new Error('private connection details'); } }).build();
  assert.equal(result.ok, true);
  assert.equal(result.ready, false);
  assert.equal(result.canaryEvidence.result, 'canary_evidence_unavailable');
  assert(!JSON.stringify(result).includes('private connection details'));
});

test('unapproved v2 policy is not replaced with a pilot or legacy policy', async () => {
  const h = harness({ env: { PBK_AGENT_LATENCY_POLICY_V2: '' }, reader: readCanaryEvidence });
  const result = await h.build();
  assert.equal(h.calls[0].policy.ready, false);
  assert.equal(h.calls[0].policy.version, 2);
  assert.equal(result.canaryEvidence.verified, false);
  assert.equal(result.ready, false);
});

test('approval, auth, delivery and dispatch code outside maturity remains byte-for-byte unchanged', () => {
  const unchanged = (source.slice(0, start) + source.slice(end))
    .replace("import { readCanaryEvidence } from './canary-evidence-reader.mjs';\n", '');
  // Outlook lead mail binds the saved address to an approval and persists the provider receipt.
  // The Outlook adapter and isolated agent smoke exercise the approval dispatch lease.
  // Lead detail exposes only the selected lead's Outlook delivery projection.
  // Telnyx receipt mapping and the scoped outbound media policy are covered by the
  // unified conversation bridge smoke test.
  assert.equal(createHash('sha256').update(unchanged).digest('hex'),
    'd47b6500d45906e0dec92842fffff7a1d94f5b7076978e1e1394e3cfb9a8c942');
});

test('production distribution includes reader and protocol, never the fixture signer', () => {
  const docker = readFileSync(new URL('../Dockerfile.openclaw', import.meta.url), 'utf8');
  const runtime = docker.slice(docker.lastIndexOf('FROM '));
  for (const name of ['canary-evidence-reader', 'canary-evidence-protocol']) {
    assert(runtime.includes(`COPY scripts/${name}.mjs ./scripts/${name}.mjs`));
  }
  assert(!/^COPY .*\bfixtures\b/m.test(runtime));
  assert(!source.includes("from './fixtures/canary-evidence-fixture.mjs'"));
  assert(source.includes("import { readCanaryEvidence } from './canary-evidence-reader.mjs';"));
});
