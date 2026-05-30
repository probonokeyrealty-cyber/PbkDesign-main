import assert from 'node:assert/strict';
import { recordAvaResponseLatencyStatus } from './ava-latency-status.mjs';

const status = {};

recordAvaResponseLatencyStatus(status, {
  callId: 'call-1',
  leadId: 'lead-1',
  speechFinalToReplyStartMs: 720,
  turnCompletionMs: 1110,
  transcriptToTtsMs: 1110,
  replyMode: 'live',
  provider: 'elevenlabs',
  ok: true,
  createdAt: '2026-05-29T20:00:00.000Z',
});

assert.equal(status.lastAvaResponseLatencyMs, 720, 'last response latency should be stored on runtime status.');
assert.equal(status.avaResponseLatencyMs, 720, 'average response latency should equal the first sample.');
assert.equal(status.avaResponseLatencyP95Ms, 720, 'p95 response latency should equal the first sample.');
assert.equal(status.lastAvaTurnCompletionMs, 1110, 'turn completion latency should be stored.');
assert.equal(status.lastAvaTtsProvider, 'elevenlabs', 'TTS provider should be stored.');
assert.equal(status.avaLatencyInstrumented, true, 'status should mark latency instrumentation active.');
assert.equal(status.avaResponseLatencySamples.length, 1, 'latency sample should be kept for scorecards.');

recordAvaResponseLatencyStatus(status, {
  callId: 'call-2',
  speechFinalToReplyStartMs: 980,
  turnCompletionMs: 1450,
  replyMode: 'fallback',
  ok: false,
  createdAt: '2026-05-29T20:01:00.000Z',
});

assert.equal(status.lastAvaResponseLatencyMs, 980, 'latest latency should replace last value.');
assert.equal(status.avaResponseLatencySamples.length, 2, 'second sample should be retained.');
assert.equal(status.avaResponseLatencyMs, 850, 'average latency should be rounded from retained samples.');
assert.equal(status.avaResponseLatencyP95Ms, 980, 'p95 should track high retained sample.');

console.log('ava-latency-status smoke passed', {
  average: status.avaResponseLatencyMs,
  p95: status.avaResponseLatencyP95Ms,
  samples: status.avaResponseLatencySamples.length,
});
