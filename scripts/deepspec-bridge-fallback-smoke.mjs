import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bridgeSource = readFileSync(resolve('scripts/openclaw-local-server.mjs'), 'utf8');

function assertBridgePattern(pattern, message) {
  assert.match(bridgeSource, pattern, message);
}

assertBridgePattern(
  /import\s+\{\s*isDeepSpecConfigured,\s*readDeepSpecConfig,\s*requestSpeculativeChatCompletion\s*\}\s+from\s+'\.\/deepspec-speculative-client\.mjs';/,
  'bridge should import the isolated DeepSpec speculative client'
);
assertBridgePattern(
  /params\.speculative\s*!==\s*false\s*&&\s*isDeepSpecConfigured\(speculativeConfig\)/,
  'bridge should keep DeepSpec opt-in and per-call disableable'
);
assertBridgePattern(
  /requestSpeculativeChatCompletion\(requestBody,\s*\{\s*config:\s*speculativeConfig,\s*\}\)/,
  'bridge should send the same DeepSeek request body through the speculative endpoint'
);
assertBridgePattern(
  /recordTokenUsage\('deepspec',\s*model,\s*payload\?\.usage\s*\|\|\s*\{\}/,
  'speculative success should record token usage under the deepspec provider'
);
assertBridgePattern(
  /speculativeServed:\s*true/,
  'speculative success should be visible in provider metadata'
);
assertBridgePattern(
  /llm_deepspec_attempts/,
  'bridge should count speculative attempts'
);
assertBridgePattern(
  /llm_deepspec_accepts/,
  'bridge should count accepted speculative responses'
);
assertBridgePattern(
  /llm_deepspec_fallbacks/,
  'bridge should count speculative fallbacks'
);
assertBridgePattern(
  /llm_deepspec_skips/,
  'bridge should count skipped speculative attempts'
);
assertBridgePattern(
  /llm_deepspec_latency_ms/,
  'bridge should record speculative endpoint latency'
);
assertBridgePattern(
  /targetMatchesRequest/,
  'bridge should skip DeepSpec when the configured target model does not match the request model'
);
assertBridgePattern(
  /request_exception/,
  'unexpected speculative client exceptions should become fallback reasons, not bridge crashes'
);
assertBridgePattern(
  /speculativeMeta\.used\s*=\s*false;\s*\n\s*speculativeMeta\.reason\s*=\s*'reasoning_only';[\s\S]*if\s*\(!speculativeConfig\.fallbackEnabled\)/,
  'reasoning-only speculative responses should fall back unless fallback is disabled'
);
assertBridgePattern(
  /speculativeMeta\.used\s*=\s*false;\s*\n\s*speculativeMeta\.reason\s*=\s*'empty_response';[\s\S]*if\s*\(!speculativeConfig\.fallbackEnabled\)/,
  'empty speculative responses should fall back unless fallback is disabled'
);
assertBridgePattern(
  /if\s*\(!speculativeConfig\.fallbackEnabled\)\s*\{\s*\n\s*return\s*\{\s*\n\s*ok:\s*false,\s*\n\s*result:\s*'speculative_provider_error'/,
  'failed speculative endpoint should produce a deepspec error only when fallback is disabled'
);
assertBridgePattern(
  /executeProviderCircuitGuard\(\s*'deepseek'/,
  'bridge should fall through to the existing DeepSeek circuit-guarded path'
);

console.log('deepspec-bridge-fallback-smoke: ok');
