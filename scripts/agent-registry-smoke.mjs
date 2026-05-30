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

  for (const required of ['ava', 'rex', 'hermes', 'call-analyzer', 'prosody-tuner', 'script-rotator', 'bant-enforcer', 'qa-agent']) {
    assert(ids.includes(required), `Default registry should include ${required}.`);
  }

  assert.equal(normalizeAgentRegistryId(' Call Analyzer! '), 'call-analyzer');

  const analyzers = findAgentsByCapability(registry, 'analysis');
  assert(analyzers.some((agent) => agent.id === 'call-analyzer'), 'analysis capability should discover Call Analyzer.');
  assert(analyzers.every((agent) => agent.status === 'active'), 'capability lookup should prefer active agents.');

  const merged = mergeAgentRegistryRecords(
    [{ id: 'ava', status: 'degraded', capabilities: ['custom_voice'], metadata: { customized: true } }],
    registry,
  );
  const ava = merged.find((agent) => agent.id === 'ava');
  assert.equal(ava.status, 'degraded', 'existing runtime status should be preserved.');
  assert(ava.capabilities.includes('custom_voice'), 'existing custom capabilities should be preserved.');
  assert(ava.capabilities.includes('closing'), 'default capabilities should be merged in.');
  assert.equal(ava.metadata.customized, true, 'existing metadata should be preserved.');

  const localResult = await invokeRegisteredAgent(
    { id: 'call-analyzer', endpoint: '', status: 'active' },
    { callId: 'call_123' },
    {
      localHandlers: {
        'call-analyzer': async (payload) => ({ ok: true, handledBy: 'call-analyzer', callId: payload.callId }),
      },
    },
  );
  assert.equal(localResult.ok, true);
  assert.equal(localResult.handledBy, 'call-analyzer');

  const snapshot = buildAgentRegistrySnapshot(registry);
  assert.equal(snapshot.ok, true, 'default registry should be ready.');
  assert(snapshot.capabilities.includes('closing'), 'snapshot should expose capability index.');
  assert.equal(snapshot.required.missing.length, 0, 'default registry should include all required agents.');

  console.log('Agent registry smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
