import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from '@jest/globals';

const failureAt = '2026-11-14T03:17:19.443Z';
const heartbeatAt = '2026-11-14T03:30:00.000Z';
const now = Date.parse('2026-11-14T03:47:19.443Z');

function loadFunctions(path, names, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ast.statements.filter(
    (node) => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && names.includes(node.name?.text)
  );
  const { outputText } = ts.transpileModule(functions.map((node) => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const sandbox = vm.createContext({ exports: {}, ...globals });
  vm.runInContext(outputText, sandbox);
  return sandbox;
}

const fleet = loadFunctions(
  '../src/app/routes/AgentFleet.tsx',
  [
    'isRegistryBackedSource',
    'normalizeFleetAgentId',
    'mergeAgentMeasurements',
    'selectAgentMeasurement',
    'formatAgentHealthTimestamp',
    'formatAgentLatency',
    'getAgentHealthState',
    'getAgentCapabilityLabel',
    'getAgentHealthFacts',
  ],
  {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
  }
);

function measurement(overrides = {}) {
  return {
    id: 'ava',
    ready: false,
    measured: false,
    result: 'agent_measurement_gap',
    blockers: [
      'latency_p95_above_budget',
      'last_success_missing',
      'dataFreshness_not_ready',
      'fleetReadiness_not_ready',
    ],
    metrics: {
      lastSuccessAt: '',
      lastFailureAt: failureAt,
      latencyP95Ms: 6544,
      latencySamples: 7,
      maxLatencyP95Ms: 2500,
    },
    missingTools: [],
    requiredTools: ['findLead'],
    ...overrides,
  };
}

function agent(capability = measurement()) {
  return { id: 'ava', name: 'Ava', registrySource: 'bridge registry', capability };
}

function facts(capability = measurement(), overrides = {}) {
  return fleet.getAgentHealthFacts({
    agent: agent(capability),
    healthProbe: { ready: true, lastSeen: heartbeatAt, latencyP95Ms: 100 },
    bridgeWorker: { ready: true, status: 'ready', lastActive: heartbeatAt },
    lastOutcome: 'No call outcome yet',
    ...overrides,
  });
}

test('Ava failure-only measurement overrides healthy heartbeats and probe latency', () => {
  const result = facts();
  assert.equal(result.lastSuccessLabel, 'No live record yet');
  assert.equal(result.lastFailureLabel, '30m ago');
  assert.equal(result.latencyLabel, '6.5s p95');
  assert.equal(result.latencyDetail, '7 samples; 2.5s budget');
  assert.equal(result.capabilityLabel, 'Not measured ready');
  assert.match(result.readinessDetail, /dataFreshness not ready/);
  assert.match(result.readinessDetail, /fleetReadiness not ready/);
  assert.equal(fleet.getAgentHealthState(agent(), { ready: true }), 'degraded');
});

test('missing measurements never promote heartbeat, checkedAt, or call prose to success', () => {
  const result = facts(undefined, {
    agent: {
      ...agent(),
      capability: undefined,
      lastError: 'probe error',
      healthCheckedAt: heartbeatAt,
    },
    lastOutcome: 'Call completed successfully',
  });
  assert.equal(result.lastSuccessLabel, 'No live record yet');
  assert.equal(result.lastFailureLabel, 'No live record yet');
  assert.equal(result.latencyLabel, 'Not sampled');
  assert.equal(
    fleet.getAgentHealthState({ ...agent(), capability: undefined }, { ready: true }),
    'local'
  );
  assert.notEqual(result.capabilityLabel, 'Tools and health clear');
});

test('explicit empty metrics do not fall back to stale aliases or probe evidence', () => {
  const result = facts(
    measurement({
      lastSuccess: heartbeatAt,
      lastFailure: heartbeatAt,
      latencyP95Ms: 100,
      metrics: { lastSuccessAt: '', lastFailureAt: '', latencySamples: 0, latencyP95Ms: 0 },
    })
  );
  assert.equal(result.lastSuccessLabel, 'No live record yet');
  assert.equal(result.lastFailureLabel, 'None reported');
  assert.equal(result.latencyLabel, 'Not sampled');
});

test('zero-millisecond latency is a real sample when canonical sample count is positive', () => {
  const result = facts(
    measurement({ metrics: { latencyP95Ms: 0, latencySamples: 1, maxLatencyP95Ms: 2500 } })
  );
  assert.equal(result.latencyLabel, '0ms p95');
  assert.equal(result.latencyDetail, '1 sample; 2.5s budget');
});

test('only a canonical ready measurement with no blockers gets the ready badge', () => {
  const ready = measurement({
    ready: true,
    measured: true,
    blockers: [],
    metrics: { lastSuccessAt: heartbeatAt },
  });
  assert.equal(fleet.getAgentHealthState(agent(ready), { ready: true }), 'ready');
  assert.equal(fleet.getAgentCapabilityLabel(agent(ready)), 'Measured ready');
  for (const gap of [
    measurement(),
    measurement({ ready: true }),
    measurement({ ready: true, measured: false, blockers: [] }),
  ]) {
    assert.equal(fleet.getAgentHealthState(agent(gap), { ready: true }), 'degraded');
  }
  assert.equal(facts(ready).lastSuccessLabel, '17m ago');
});

test('measurement rows map by identity, not order, and missing rows clear old proof', () => {
  assert.equal(typeof fleet.mergeAgentMeasurements, 'function');
  const original = [
    agent(),
    { id: 'max', name: 'Max', capability: measurement({ id: 'max', ready: true }) },
  ];
  const evidence = measurement({ id: 'AVA' });
  const result = fleet.mergeAgentMeasurements(original, { ready: false, agents: [evidence] });
  assert.equal(result[0].capability, evidence);
  assert.equal(result[1].capability, undefined);
  assert.notEqual(result[0], original[0]);
  assert.equal(fleet.mergeAgentMeasurements(original, undefined)[0].capability, undefined);
});

const fulfilled = (value) => ({ status: 'fulfilled', value: { ok: true, measurement: value } });
const readySnapshot = {
  ready: true,
  generatedAt: '2026-11-14T03:10:00Z',
  agents: [measurement({ ready: true, measured: true, blockers: [] })],
};
const failedSnapshot = {
  ready: false,
  generatedAt: '2026-11-14T03:20:00Z',
  agents: [measurement()],
};

test('newer health measurement beats stale ready endpoint and retains provenance', () => {
  const selected = fleet.selectAgentMeasurement(
    fulfilled(readySnapshot),
    fulfilled(failedSnapshot)
  );
  assert.equal(selected.measurement, failedSnapshot);
  assert.equal(selected.source, 'GET /api/agents/health (measurement)');
  assert.equal(selected.warning, '');
  const [merged] = fleet.mergeAgentMeasurements([agent()], selected.measurement, selected.source);
  assert.equal(merged.measurementSource, selected.source);
  assert.equal(merged.measurementGeneratedAt, failedSnapshot.generatedAt);
  assert.equal(fleet.getAgentHealthState(merged, { ready: true }), 'degraded');
});

test('newer dedicated measurement beats old health evidence by instant, not string order', () => {
  const latest = { ...readySnapshot, generatedAt: '2026-11-14T04:30:00+01:00' };
  const selected = fleet.selectAgentMeasurement(fulfilled(latest), fulfilled(failedSnapshot));
  assert.equal(selected.measurement, latest);
  assert.equal(selected.source, 'GET /api/agents/measurement');
});

for (const invalid of [undefined, '', 'not-a-date']) {
  test(`invalid generatedAt (${invalid}) cannot outrank valid evidence`, () => {
    const invalidSnapshot = { ...readySnapshot, generatedAt: invalid };
    assert.equal(
      fleet.selectAgentMeasurement(fulfilled(invalidSnapshot), fulfilled(failedSnapshot))
        .measurement,
      failedSnapshot
    );
    assert.equal(
      fleet.selectAgentMeasurement(fulfilled(failedSnapshot), fulfilled(invalidSnapshot))
        .measurement,
      failedSnapshot
    );
    const neither = fleet.selectAgentMeasurement(
      fulfilled(invalidSnapshot),
      fulfilled(invalidSnapshot)
    );
    assert.equal(neither.measurement, undefined);
    assert.match(neither.warning, /unverified/i);
  });
}

test('equal timestamps do not let a ready snapshot hide a canonical gap', () => {
  const selected = fleet.selectAgentMeasurement(
    fulfilled({ ...readySnapshot, generatedAt: failedSnapshot.generatedAt }),
    fulfilled(failedSnapshot)
  );
  assert.equal(selected.measurement, failedSnapshot);
});

for (const reason of [
  '401 Unauthorized',
  '403 Forbidden',
  '503 usage_exceeded',
  'Network unavailable',
]) {
  test(`measurement failure stays visibly unverified despite ready health: ${reason}`, () => {
    const selected = fleet.selectAgentMeasurement(
      { status: 'rejected', reason: new Error(reason) },
      fulfilled(readySnapshot)
    );
    assert.equal(selected.measurement, undefined);
    assert.equal(selected.source, '');
    assert.match(selected.warning, /Measurement request failed.*unverified/);
    const [merged] = fleet.mergeAgentMeasurements(
      [agent(readySnapshot.agents[0])],
      selected.measurement,
      selected.source
    );
    assert.equal(merged.measurementSource, undefined);
    assert.equal(merged.measurementGeneratedAt, undefined);
    assert.notEqual(fleet.getAgentHealthState(merged, { ready: true }), 'ready');
  });
}

function bridge(status, payload) {
  return loadFunctions(
    '../src/app/utils/runtimeBridge.ts',
    [
      'bridgeRequest',
      'RuntimeBridgeError',
      'isTeamSessionRejection',
      'bridgeResponseError',
      'acceptAgentMeasurementGapResponse',
      'fetchAgentHealthRequest',
      'fetchAgentMeasurementRequest',
    ],
    {
      AbortController,
      setTimeout,
      clearTimeout,
      BRIDGE_REQUEST_TIMEOUT_MS: 1000,
      assertRuntimeAuthConfigured() {},
      buildUrl: (path) => path,
      buildHeaders: () => ({}),
      shouldRetryRuntimeViaHosted: async () => false,
      extractBridgeErrorMessage: (_, code) => `Bridge request failed (${code})`,
      getRuntimeTeamSession: () => null,
      isNetlifyHostedRuntimeShell: () => false,
      fetch: async () => new Response(JSON.stringify(payload), { status }),
    }
  );
}

const gapPayload = {
  ok: false,
  result: 'stable_agent_fleet_measurement_gaps',
  measurement: {
    ready: false,
    result: 'stable_agent_fleet_measurement_gaps',
    agents: [measurement()],
  },
};

test('health reads retain canonical measurement gaps returned with HTTP 503', async () => {
  const result = await bridge(503, gapPayload).fetchAgentHealthRequest();
  assert.equal(result.ok, false);
  assert.equal(result.measurement.agents[0].metrics.lastFailureAt, failureAt);
});

test('dedicated measurement reads retain HTTP 503 evidence without changing readiness', async () => {
  const runtime = bridge(503, gapPayload);
  assert.equal(typeof runtime.fetchAgentMeasurementRequest, 'function');
  const result = await runtime.fetchAgentMeasurementRequest();
  assert.equal(result.measurement.ready, false);
  assert.equal(result.measurement.agents[0].metrics.latencyP95Ms, 6544);
});

for (const [status, payload] of [
  [401, gapPayload],
  [403, gapPayload],
  [503, { error: 'usage_exceeded' }],
  [503, { measurement: { ready: false } }],
  [500, gapPayload],
]) {
  test(`health read still rejects non-evidence errors: ${status} ${JSON.stringify(payload).slice(0, 45)}`, async () => {
    await assert.rejects(
      bridge(status, payload).fetchAgentHealthRequest(),
      /Bridge request failed/
    );
  });
}

test('ordinary requests and mutations still reject HTTP 503 measurement-shaped bodies', async () => {
  for (const method of ['GET', 'POST']) {
    await assert.rejects(
      bridge(503, gapPayload).bridgeRequest({ path: '/api/other', method }),
      /Bridge request failed/
    );
  }
});
