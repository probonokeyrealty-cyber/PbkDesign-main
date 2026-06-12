import assert from 'node:assert/strict';
import {
  applyExternalAgentEndpointOverrides,
  buildAgentRegistrySnapshot,
  buildDefaultAgentRegistry,
  findAgentsByCapability,
  invokeRegisteredAgent,
  mergeAgentRegistryRecords,
  normalizeAgentRegistryId,
} from './agent-registry.mjs';

async function main() {
  const registry = buildDefaultAgentRegistry({ now: 1780000000000, env: {} });
  const ids = registry.map((agent) => agent.id);

  for (const required of [
    'ava',
    'max',
    'rex',
    'hermes',
    'call-analyzer',
    'prosody-tuner',
    'script-rotator',
    'bant-enforcer',
    'qa-agent',
    'nurture-agent',
    'research-orchestrator',
  ]) {
    assert(ids.includes(required), `Default registry should include ${required}.`);
  }

  for (const agent of registry) {
    assert.equal(
      agent.endpoint,
      '/invoke',
      `${agent.id} should explicitly route local dispatch through the bridge invoke endpoint.`
    );
    assert.equal(agent.metadata?.local, true, `${agent.id} should be marked as local-only.`);
    assert(
      Array.isArray(agent.metadata?.requiredTools) && agent.metadata.requiredTools.length >= 2,
      `${agent.id} should declare production required tools for honest health checks.`
    );
  }

  for (const required of [
    'script-rotator',
    'bant-enforcer',
    'qa-agent',
    'nurture-agent',
    'research-orchestrator',
  ]) {
    const agent = registry.find((item) => item.id === required);
    assert.equal(agent.endpoint, '/invoke', `${required} should expose the bridge invoke endpoint.`);
    assert.equal(agent.status, 'standby', `${required} should start as standby until a health check runs.`);
    assert.equal(agent.healthCheckedAt, '', `${required} should not pretend it was health-checked at startup.`);
  }

  assert.equal(normalizeAgentRegistryId(' Call Analyzer! '), 'call-analyzer');

  const analyzers = findAgentsByCapability(registry, 'analysis');
  assert(
    analyzers.some((agent) => agent.id === 'call-analyzer'),
    'analysis capability should discover Call Analyzer.'
  );
  assert(
    analyzers.every((agent) => ['active', 'standby'].includes(agent.status)),
    'capability lookup should return routable active or standby agents.'
  );

  const nurtureAgents = findAgentsByCapability(registry, 'nurture');
  assert(
    nurtureAgents.some((agent) => agent.id === 'nurture-agent'),
    'nurture capability should discover Nurture Agent.'
  );
  const researchAgents = findAgentsByCapability(registry, 'research_additives');
  assert(
    researchAgents.some((agent) => agent.id === 'research-orchestrator'),
    'research_additives capability should discover Research Orchestrator.'
  );
  const research = registry.find((agent) => agent.id === 'research-orchestrator');
  assert(
    research.metadata.requiredTools.includes('runProviderAugmentedAdditiveIntelligence') &&
      research.metadata.requiredTools.includes('evaluateStoppingAgent'),
    'Research Orchestrator should require its additive intelligence and stopping-agent tools.'
  );
  const qaAgent = registry.find((agent) => agent.id === 'qa-agent');
  assert(
    qaAgent.metadata.requiredTools.includes('validateProviderActionSafety') &&
      qaAgent.metadata.requiredTools.includes('getObservabilityStatus'),
    'QA Agent should require safety and observability tools.'
  );

  const merged = mergeAgentRegistryRecords(
    [
      {
        id: 'ava',
        status: 'degraded',
        capabilities: ['custom_voice'],
        metadata: { customized: true },
      },
    ],
    registry
  );
  const ava = merged.find((agent) => agent.id === 'ava');
  assert.equal(ava.status, 'degraded', 'existing runtime status should be preserved.');
  assert(
    ava.capabilities.includes('custom_voice'),
    'existing custom capabilities should be preserved.'
  );
  assert(ava.capabilities.includes('closing'), 'default capabilities should be merged in.');
  assert.equal(ava.metadata.customized, true, 'existing metadata should be preserved.');

  const localResult = await invokeRegisteredAgent(
    { id: 'call-analyzer', endpoint: '/invoke', status: 'active', metadata: { local: true } },
    { callId: 'call_123' },
    {
      localHandlers: {
        'call-analyzer': async (payload) => ({
          ok: true,
          handledBy: 'call-analyzer',
          callId: payload.callId,
        }),
      },
    }
  );
  assert.equal(localResult.ok, true);
  assert.equal(localResult.handledBy, 'call-analyzer');

  const remoteRegistry = applyExternalAgentEndpointOverrides(registry, {
    PBK_EXTERNAL_AGENT_NURTURE: 'https://nurture.example.test/api',
  });
  const remoteNurture = remoteRegistry.find((agent) => agent.id === 'nurture-agent');
  assert.equal(remoteNurture.endpoint, 'https://nurture.example.test/api');
  assert.equal(remoteNurture.metadata.local, false);
  assert.equal(remoteNurture.metadata.remote, true);
  assert.equal(remoteNurture.metadata.communication, 'pbk-remote-agent');

  let remoteCall = null;
  const remoteResult = await invokeRegisteredAgent(
    { ...remoteNurture, status: 'active' },
    { leadId: 'lead-remote', sequenceId: 'seq-1' },
    {
      apiKey: 'bridge-secret',
      fetchImpl: async (url, init = {}) => {
        remoteCall = { url, init };
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ ok: true, result: 'remote_nurture_agent_invoked' });
          },
        };
      },
    }
  );
  assert.equal(remoteCall.url, 'https://nurture.example.test/api/invoke');
  assert.equal(remoteCall.init.headers.Authorization, 'Bearer bridge-secret');
  assert.equal(JSON.parse(remoteCall.init.body).leadId, 'lead-remote');
  assert.equal(remoteResult.result, 'remote_nurture_agent_invoked');

  const invocationSmokeHandlers = {
    max: async (payload) => ({
      ok: true,
      result: 'max_contract_handoff_ready',
      leadId: payload.leadId,
    }),
    'script-rotator': async (payload) => ({
      ok: true,
      result: 'script_rotation_selected',
      script: payload.query || 'default',
    }),
    'bant-enforcer': async () => ({
      ok: true,
      result: 'bant_enforcer_status',
      complete: false,
      missing: ['budget'],
    }),
    'qa-agent': async () => ({
      ok: true,
      result: 'qa_agent_registered',
      qa: { validators: ['sendDocuSign'] },
    }),
    'nurture-agent': async () => ({
      ok: true,
      result: 'nurture_recommendation',
      recommendation: { channel: 'sms', urgency: 'today' },
    }),
    'research-orchestrator': async () => ({
      ok: true,
      result: 'research_orchestrator_ready',
      plan: { mode: 'approval_gated' },
    }),
  };
  for (const required of Object.keys(invocationSmokeHandlers)) {
    const agent = registry.find((item) => item.id === required);
    const output = await invokeRegisteredAgent(
      agent,
      { query: 'smoke invocation', leadId: 'lead-smoke' },
      { localHandlers: invocationSmokeHandlers }
    );
    assert.equal(output.ok, true, `${required} should be callable through registry invocation.`);
  }

  const snapshot = buildAgentRegistrySnapshot(registry);
  assert.equal(snapshot.inventoryReady, true, 'default registry should have complete inventory.');
  assert.equal(snapshot.ok, false, 'default registry should not claim health readiness before checks run.');
  assert.equal(snapshot.result, 'agent_registry_pending_health', 'default registry should report pending health.');
  assert.equal(
    snapshot.required.pendingHealth.length,
    registry.length,
    'default registry should list unprobed required agents as pending health.'
  );
  assert(snapshot.capabilities.includes('closing'), 'snapshot should expose capability index.');
  assert.equal(
    snapshot.required.missing.length,
    0,
    'default registry should include all required agents.'
  );
  const checkedSnapshot = buildAgentRegistrySnapshot(
    registry.map((agent) => ({
      ...agent,
      status: 'active',
      healthCheckedAt: '2026-06-12T00:00:00.000Z',
      health_checked_at: '2026-06-12T00:00:00.000Z',
    }))
  );
  assert.equal(checkedSnapshot.ok, true, 'health-checked registry should be ready.');
  assert.equal(checkedSnapshot.required.pendingHealth.length, 0, 'health-checked registry should have no pending health.');

  console.log('Agent registry smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
