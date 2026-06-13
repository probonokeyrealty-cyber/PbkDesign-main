import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = readFileSync('scripts/openclaw-local-server.mjs', 'utf8');
const additives = readFileSync('scripts/research-additives.mjs', 'utf8');

assert.match(bridge, /AGENT_REACH_COMMAND/, 'bridge should define a configurable Agent Reach command.');
assert.match(bridge, /detectAgentReachStatus/, 'bridge should expose a cached Agent Reach status detector.');
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

console.log('[agent-reach-research-smoke] ok', {
  provider: 'agent-reach',
  executionPolicy: 'read_only_local_command_queue',
  channels: ['twitter', 'reddit', 'youtube', 'bilibili', 'xiaohongshu', 'linkedin', 'github', 'webpage', 'web_search'],
});
