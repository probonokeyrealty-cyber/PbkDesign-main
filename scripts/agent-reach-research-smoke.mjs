import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = readFileSync('scripts/openclaw-local-server.mjs', 'utf8');
const additives = readFileSync('scripts/research-additives.mjs', 'utf8');
const dockerfile = readFileSync('Dockerfile.openclaw', 'utf8');

assert.match(bridge, /AGENT_REACH_COMMAND/, 'bridge should define a configurable Agent Reach command.');
assert.match(bridge, /detectAgentReachStatus/, 'bridge should expose a cached Agent Reach status detector.');
assert.match(bridge, /runAgentReachDoctor/, 'bridge should expose a read-only Agent Reach doctor runner.');
assert.match(bridge, /\/api\/diagnostics\/agent-reach/, 'bridge should expose an authenticated Agent Reach diagnostic endpoint.');
assert.match(bridge, /selectAgentReachChannel/, 'bridge should classify Agent Reach platform channels.');
assert.match(bridge, /agentReachChannel/, 'browser research jobs should carry the Agent Reach channel.');
assert.match(bridge, /provider === 'agent-reach'/, 'launchBrowserResearch should branch on Agent Reach jobs.');
assert.match(bridge, /read_only_local_command_queue/, 'Agent Reach jobs should be read-only queued work, not direct provider writes.');
assert.match(bridge, /twitter.*reddit.*youtube.*bilibili.*xiaohongshu.*linkedin/s, 'tooling status should publish Agent Reach platform coverage.');
assert.match(bridge, /Agent Reach is optional and not detected yet/, 'missing Agent Reach should degrade to setup-required guidance.');

assert.match(additives, /agent_reach_internet_layer/, 'research additives should register Agent Reach.');
assert.match(additives, /optional_local_readonly/, 'Agent Reach additive should be optional and read-only.');
assert.match(additives, /PBK_AGENT_REACH_COMMAND/, 'Agent Reach command should be configured by env only.');
assert.match(additives, /local_command_configured_unverified/, 'provider matrix should report command-based providers as unverified until checked.');
assert.match(additives, /providerWritesAllowed:\s*false/, 'Agent Reach provider checks should keep writes blocked.');

assert.match(dockerfile, /agent-reach\/archive\/refs\/tags\/v1\.5\.0\.zip/, 'OpenClaw image should install Agent Reach from a pinned upstream tag.');
assert.match(dockerfile, /ENV PATH="\/app\/\.venv\/bin:\$\{PATH\}"/, 'OpenClaw image should expose venv CLIs, including agent-reach, on PATH.');
assert.match(dockerfile, /agent-reach install --env=auto/, 'OpenClaw image should run Agent Reach core setup best-effort.');
assert.match(dockerfile, /timeout 90s \/app\/\.venv\/bin\/agent-reach install --env=auto/, 'Agent Reach setup should be time-bounded so hosted builds cannot hang.');

console.log('[agent-reach-research-smoke] ok', {
  provider: 'agent-reach',
  executionPolicy: 'read_only_local_command_queue',
  channels: ['twitter', 'reddit', 'youtube', 'bilibili', 'xiaohongshu', 'linkedin', 'github', 'webpage', 'web_search'],
});
