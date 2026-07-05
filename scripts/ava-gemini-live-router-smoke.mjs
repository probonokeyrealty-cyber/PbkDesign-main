import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function readText(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function yamlEnvValue(source, key) {
  const pattern = new RegExp(`- key:\\s*${key}\\s*\\r?\\n\\s*value:\\s*([^\\r\\n#]+)`, 'm');
  const match = source.match(pattern);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

const bridge = readText('scripts/openclaw-local-server.mjs');
const render = readText('render.yaml');
const packageJson = JSON.parse(readText('package.json'));

assert.match(
  bridge,
  /const GEMINI_API_KEY = String\(process\.env\.PBK_GEMINI_API_KEY \|\| process\.env\.GEMINI_API_KEY \|\| process\.env\.GOOGLE_API_KEY \|\| ''\)\.trim\(\)/,
  'Bridge must read PBK_GEMINI_API_KEY/GEMINI_API_KEY/GOOGLE_API_KEY for the live Gemini lane.'
);
assert.match(
  bridge,
  /const LIVE_LLM_PROVIDER = String\(process\.env\.PBK_LIVE_LLM_PROVIDER \|\| process\.env\.PBK_STRATEGIST_PROVIDER \|\| 'gemini'\)/,
  'Bridge must make Gemini the explicit default live LLM provider.'
);
assert.match(
  bridge,
  /function buildGeminiStrategistResponseSchema\(\)[\s\S]*seller_intent[\s\S]*risk_score[\s\S]*handoff_needed/,
  'Gemini strategist schema must include intent, risk, CRM, and handoff fields.'
);
assert.match(
  bridge,
  /function normalizeGeminiLiveModelName\(model = ''\)[\s\S]*!\s*\/\^deepseek/,
  'Gemini model normalization must reject accidental DeepSeek model ids.'
);
assert.match(
  bridge,
  /async function runGeminiGenerateContent\([\s\S]*responseMimeType:\s*'application\/json'[\s\S]*responseSchema:\s*buildGeminiStrategistResponseSchema\(\)/,
  'Gemini provider shim must request structured JSON using the strategist schema.'
);
assert.match(
  bridge,
  /executeProviderCircuitGuard\(\s*'gemini'/,
  'Gemini live requests must be protected by the provider circuit guard.'
);
assert.match(
  bridge,
  /recordLatencyMetric\('llm_gemini_latency_ms'/,
  'Gemini live requests must emit latency metrics.'
);
assert.match(
  bridge,
  /if \(!strategist && \(STRATEGIST_PROVIDER === 'deepseek' \|\| STRATEGIST_PROVIDER === 'gemini'\)\)/,
  'DeepSeek must remain a fallback when Gemini does not produce a strategist decision.'
);
assert.match(
  bridge,
  /model:\s*STRATEGIST_PROVIDER === 'gemini' \? GEMINI_LIVE_MODEL : DEEPSEEK_LIVE_MODEL[\s\S]*attemptTimeoutMs:\s*STRATEGIST_PROVIDER === 'gemini' \? GEMINI_LIVE_ATTEMPT_TIMEOUT_MS : DEEPSEEK_LIVE_ATTEMPT_TIMEOUT_MS/,
  'Telnyx live strategist calls must pass Gemini model and timeout settings when Gemini is selected.'
);
assert.equal(yamlEnvValue(render, 'PBK_LIVE_LLM_PROVIDER'), 'gemini', 'Render must select Gemini as the live LLM provider.');
assert.equal(yamlEnvValue(render, 'PBK_GEMINI_LIVE_MODEL'), 'gemini-1.5-flash', 'Render must pin Gemini Flash for live calls.');
assert.equal(yamlEnvValue(render, 'PBK_STRATEGIST_PROVIDER'), 'gemini', 'Legacy strategist provider env must agree with the live provider.');
assert.equal(
  packageJson.scripts['test:ava-gemini-live-router'],
  'node ./scripts/ava-gemini-live-router-smoke.mjs',
  'package.json must expose the Gemini live-router smoke.'
);
assert.match(
  packageJson.scripts['test:production-hardening'],
  /test:ava-gemini-live-router/,
  'Production hardening must include the Gemini live-router smoke.'
);

console.log(
  JSON.stringify({
    ok: true,
    result: 'ava_gemini_live_router_ready',
    liveProvider: yamlEnvValue(render, 'PBK_LIVE_LLM_PROVIDER'),
    liveModel: yamlEnvValue(render, 'PBK_GEMINI_LIVE_MODEL'),
  })
);
