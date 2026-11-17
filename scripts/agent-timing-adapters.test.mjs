import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { AGENT_LATENCY_PILOT_V2, getAgentLatencyPolicy } from './agent-latency-policy.mjs';
import { withRuntimeEvidenceContext } from './runtime-evidence-context.mjs';
import { controlledExecution } from './controlled-execution-scope.mjs';

let adapters = {};
try { adapters = await import('./agent-timing-adapters.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const api = name => { assert.equal(typeof adapters[name], 'function', name); return adapters[name]; };
const policy = getAgentLatencyPolicy({ PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(AGENT_LATENCY_PILOT_V2) }, { requireVersion2: true });
const secret = 'explicit-local-adapter-signing-fixture';
const revision = 'a'.repeat(40);
const START = Date.parse('2026-11-17T12:00:00.000Z');
function turn(channel = 'chat', extra = {}) {
  let elapsed = 0;
  const handle = api('createAgentTimingTurn')({ secret, revision, policy, channel, agentId: 'ava',
    runId: 'local-run', now: () => START + Math.ceil(elapsed), monotonicNow: () => elapsed, ...extra });
  return { handle, advance: n => { elapsed += n; } };
}

test.each([['short', 'Hi'], ['long', 'x'.repeat(4000) + '\u{1f642}']])('actual final answer, not metadata, supplies %s output size', async (_label, answer) => {
  await withRuntimeEvidenceContext('operator_chat', () => {
    const { handle, advance } = turn();
    advance(50);
    api('markAgentTimingFirstContent')(handle, 'actual content');
    advance(100);
    const params = { metadata: { channel: 'phone', outputCodePoints: 1, timingProof: { signature: 'forged' } } };
    api('bindAgentTimingToParams')(params, handle, { answer, successful: true });
    const proof = api('getTrustedAgentTimingProof')(params);
    assert.equal(proof.outputCodePoints, [...answer].length);
    assert.equal(proof.channel, 'chat');
    assert.equal(proof.timings.firstTokenMs, 50);
    assert.equal(proof.timings.completionMs, 150);
    assert.equal(proof.media, null);
    assert.equal(api('getTrustedAgentTimingProof')({ ...params }), null);
    assert.equal(JSON.stringify(proof).includes(answer), false);
  });
});

test.each(['unknown', 'controlled', 'diagnostic', 'cancelled', 'partial', 'failed', 'policy', 'copied'])
('nonqualifying %s cannot mint timing proof', async mode => {
  const operation = () => {
    const { handle, advance } = turn('chat', mode === 'policy' ? { policy: null } : {});
    advance(10);
    const controller = new AbortController();
    if (mode === 'cancelled') controller.abort();
    const params = {};
    api('bindAgentTimingToParams')(params, mode === 'copied' ? { ...handle } : handle,
      { answer: 'Actual reply', successful: !['partial', 'failed'].includes(mode), signal: controller.signal });
    assert.equal(api('getTrustedAgentTimingProof')(params), null);
  };
  if (mode === 'unknown') operation();
  else if (mode === 'controlled') await controlledExecution.run({}, () => withRuntimeEvidenceContext('operator_chat', operation));
  else await withRuntimeEvidenceContext(mode === 'diagnostic' ? 'diagnostic' : 'operator_chat', operation);
});

test('phone absent callbacks/media stay absent and the turn cannot be completed twice', async () => {
  await withRuntimeEvidenceContext('phone_turn', () => {
    const { handle, advance } = turn('phone');
    advance(200);
    const params = api('bindAgentTimingToParams')({}, handle, { answer: 'actual phone answer', successful: true });
    const proof = api('getTrustedAgentTimingProof')(params);
    assert.deepEqual(proof.timings, { completionMs: 200 });
    assert.equal(proof.mediaDurationMs, null);
    assert.equal(api('getTrustedAgentTimingProof')(api('bindAgentTimingToParams')({}, handle,
      { answer: 'second completion', successful: true })), null);
  });
});

test('registry classification is fixed to actual local handlers; ambiguous/remote routes remain unknown', () => {
  for (const [id, expected] of [['rex', 'research'], ['max', 'research'], ['script-rotator', 'research'],
    ['hermes', 'research'], ['bant-enforcer', 'provider'], ['qa-agent', 'provider'], ['call-analyzer', 'provider'],
    ['prosody-tuner', 'provider'], ['research-orchestrator', 'unknown'], ['nurture-agent', 'unknown'],
    ['ava', 'unknown'], ['new-agent', 'unknown']]) {
    const localHandlers = { [id]: () => {} };
    assert.equal(api('registeredAgentTimingChannel')({ id, endpoint: 'local' }, localHandlers), expected);
    assert.equal(api('registeredAgentTimingChannel')({ id, endpoint: 'https://fixture.invalid' }, localHandlers), 'unknown');
    assert.equal(api('registeredAgentTimingChannel')({ id, endpoint: 'local' }, {}), 'unknown');
  }
});
