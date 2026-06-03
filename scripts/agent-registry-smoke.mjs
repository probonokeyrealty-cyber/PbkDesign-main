import assert from 'node:assert/strict';
import {
  buildAgentRegistrySnapshot,
  buildDefaultAgentRegistry,
  findAgentsByCapability,
  invokeRegisteredAgent,
  mergeAgentRegistryRecords,
  normalizeAgentRegistryId,
} from './agent-registry.mjs';

async function main() {
  const registry = buildDefaultAgentRegistry({ now: 1780000000000 });
  const ids = registry.map((agent) => agent.id);

  for (const required of [
    'ava',
    'rex',
    'hermes',
    'call-analyzer',
    'prosody-tuner',
    'script-rotator',
    'bant-enforcer',
    'qa-agent',
    'nurture-agent',
  ]) {
    assert(ids.includes(required), `Default registry should include ${required}.`);
  }

  for (const required of ['script-rotator', 'bant-enforcer', 'qa-agent', 'nurture-agent']) {
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

  const invocationSmokeHandlers = {
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
  assert.equal(snapshot.ok, true, 'default registry should be ready.');
  assert(snapshot.capabilities.includes('closing'), 'snapshot should expose capability index.');
  assert.equal(
    snapshot.required.missing.length,
    0,
    'default registry should include all required agents.'
  );

  console.log('Agent registry smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
