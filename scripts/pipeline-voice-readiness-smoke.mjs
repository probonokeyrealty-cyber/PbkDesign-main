import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const server = await readFile(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

assert.match(server, /inspectStreakPipelineState\(\{\s*refresh:\s*false\s*\}\)/, 'tooling status must inspect canonical Streak pipeline readiness');
assert.match(server, /const streakPipelineMemoryReady = Boolean\(streakPipelineStatus\?\.readiness\?\.readyForPbk\)/, 'pipeline memory must derive readiness from Streak readyForPbk');
assert.match(server, /mode: streakPipelineMemoryReady \? 'streak_pipeline'/, 'pipeline memory status must expose Streak as its ready mode');
assert.match(server, /mapped: Boolean\(configuredFieldKey \|\| detectedFieldKey\)/, 'detected PBK Streak fields must count as mapped');

assert.match(server, /VOICE_FALLBACK_LOCAL_STATUS_FILE/, 'voice fallback must read a persisted local smoke status');
assert.match(server, /function isVoiceFallbackRoundTripReady/, 'voice fallback must require an audio round-trip helper');
assert.match(server, /voiceFallbackEndpointConfigured && voiceFallbackRoundTripReady/, 'voice fallback must not mark ready from URL configuration alone');
assert.match(server, /localAudioRoundTripPassed: voiceFallbackRoundTripReady/, 'voice fallback status must expose the local round-trip gate');

assert.equal(pkg.scripts['voice-fallback:smoke'], 'node ./scripts/voice-fallback-smoke.mjs', 'package.json must expose the voice fallback smoke command');
assert.equal(pkg.scripts['test:pipeline-voice-readiness'], 'node ./scripts/pipeline-voice-readiness-smoke.mjs', 'package.json must expose the readiness regression smoke');

console.log('Pipeline memory and voice fallback readiness gates are wired.');
