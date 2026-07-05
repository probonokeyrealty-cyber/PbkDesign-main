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

function assertYamlValue(source, key, expected) {
  assert.equal(yamlEnvValue(source, key), expected, `${key} must be ${expected}.`);
}

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

const render = readText('render.yaml');
const bridge = readText('scripts/openclaw-local-server.mjs');
const researchAdditives = readText('scripts/research-additives.mjs');
const scorecard = readText('scripts/intelligence-scorecard.mjs');
const packageJson = JSON.parse(readText('package.json'));

const deprecatedDeepSeekModels = render.match(/\bdeepseek-(?:chat|reasoner)\b/g) || [];
assert.deepEqual(
  deprecatedDeepSeekModels,
  [],
  'Render must not pin deprecated DeepSeek aliases; use deepseek-v4-flash/pro.',
);

assertYamlValue(render, 'PBK_DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
assertYamlValue(render, 'PBK_DEEPSEEK_MODEL', 'deepseek-v4-pro');
assertYamlValue(render, 'PBK_DEEPSEEK_FALLBACK_MODEL', 'deepseek-v4-flash');
assertYamlValue(render, 'PBK_DEEPSEEK_LIVE_MODEL', 'deepseek-v4-flash');
assertYamlValue(render, 'PBK_DEEPSEEK_LIVE_RETRY_MODELS', 'deepseek-v4-flash,deepseek-v4-pro');
assertYamlValue(render, 'PBK_GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta');
assertYamlValue(render, 'PBK_GEMINI_LIVE_MODEL', 'gemini-3.5-flash');
assertYamlValue(render, 'PBK_LIVE_LLM_PROVIDER', 'gemini');
assertYamlValue(render, 'PBK_STRATEGIST_PROVIDER', 'gemini');

const deepSeekAttemptBudget = Number(yamlEnvValue(render, 'PBK_DEEPSEEK_LIVE_ATTEMPT_TIMEOUT_MS'));
const geminiAttemptBudget = Number(yamlEnvValue(render, 'PBK_GEMINI_LIVE_ATTEMPT_TIMEOUT_MS'));
const strategistBudget = Number(yamlEnvValue(render, 'PBK_TELNYX_LIVE_REPLY_STRATEGIST_TIMEOUT_MS'));
assert(
  Number.isFinite(deepSeekAttemptBudget) && deepSeekAttemptBudget <= 1800,
  'DeepSeek fallback attempt budget must stay below phone-call latency tolerance.',
);
assert(
  Number.isFinite(geminiAttemptBudget) && geminiAttemptBudget <= 1500,
  'Gemini Flash live attempt budget must stay below phone-call latency tolerance.',
);
assert(
  Number.isFinite(strategistBudget) && strategistBudget <= 3000,
  'Ava live strategist budget must stay short enough to preserve conversation flow.',
);

assertContains(
  bridge,
  /const DEEPSEEK_MODEL = String\(process\.env\.PBK_DEEPSEEK_MODEL \|\| 'deepseek-v4-pro'\)/,
  'OpenClaw bridge default strategist model must match the current DeepSeek v4 pro lane.',
);
assertContains(
  bridge,
  /const DEEPSEEK_FALLBACK_MODEL = String\(process\.env\.PBK_DEEPSEEK_FALLBACK_MODEL \|\| 'deepseek-v4-flash'\)/,
  'OpenClaw bridge default fallback model must match the current DeepSeek v4 flash lane.',
);
assertContains(
  bridge,
  /const GEMINI_LIVE_MODEL = String\(process\.env\.PBK_GEMINI_LIVE_MODEL \|\| process\.env\.PBK_GEMINI_MODEL \|\| 'gemini-3\.5-flash'\)/,
  'OpenClaw bridge must default Ava live calls to a currently available Gemini Flash model.',
);
assertContains(
  bridge,
  /PBK_LIVE_LLM_PROVIDER/,
  'OpenClaw bridge must expose an explicit live LLM provider selector.',
);
assertContains(
  bridge,
  /responseMimeType:\s*'application\/json'/,
  'Gemini Flash live calls must request structured JSON responses.',
);
assertContains(
  bridge,
  /buildGeminiStrategistResponseSchema/,
  'Gemini Flash live calls must use a strict strategist decision schema.',
);
assertContains(
  bridge,
  /runGeminiGenerateContent/,
  'OpenClaw bridge must route Ava live calls through the Gemini Flash provider shim.',
);
assertContains(
  bridge,
  /response_format:\s*\{\s*type:\s*'json_object'\s*\}/,
  'DeepSeek fallback structured responses must request JSON mode when the strategist expects JSON.',
);
assertContains(
  bridge,
  /provider_empty_response/,
  'DeepSeek JSON-mode empty responses must be detected and routed to retry or deterministic fallback.',
);
assertContains(
  bridge,
  /provider_reasoning_only/,
  'DeepSeek reasoning-only responses must be treated as non-speakable for live calls.',
);
assertContains(
  bridge,
  /isRetryableDeepSeekResult/,
  'DeepSeek calls must keep bounded retry/fallback classification.',
);

assertYamlValue(render, 'PBK_HERMES_ENABLED', 'true');
assertYamlValue(render, 'PBK_HERMES_SUGGEST_ONLY', 'true');
assertContains(
  bridge,
  /writeMode:\s*'suggest-only'/,
  'Hermes provider metadata must expose suggest-only mode.',
);
assertContains(
  bridge,
  /providerWrites:\s*'blocked'/,
  'Hermes status must tell operators that provider writes are blocked.',
);
assertContains(
  bridge,
  /PBK bridge approval gates still own calls, SMS, contracts, deletes, admin env updates, and offer increases/,
  'Hermes must stay advisory unless explicit PBK approval gates release execution.',
);

assertContains(
  render,
  /key:\s*PBK_DATABASE_URL\s*\r?\n\s*fromDatabase:\s*\r?\n\s*name:\s*pbk-openclaw-db\s*\r?\n\s*property:\s*connectionString/,
  'Bridge must receive PBK_DATABASE_URL from the Render Postgres database reference.',
);
assertContains(
  render,
  /key:\s*PBK_REDIS_URL\s*\r?\n\s*fromService:\s*\r?\n\s*type:\s*keyvalue\s*\r?\n\s*name:\s*pbk-openclaw-redis\s*\r?\n\s*property:\s*connectionString/,
  'Bridge must receive PBK_REDIS_URL from the Render Key Value/Redis service reference.',
);
assertContains(render, /name:\s*pbk-event-worker/, 'Render blueprint must keep the Redis event worker declared.');
assertContains(render, /name:\s*pbk-coworker-heartbeat/, 'Render blueprint must keep the coworker heartbeat worker declared.');
assertContains(render, /name:\s*pbk-nightly-learning/, 'Render blueprint must keep the nightly learning cron declared.');
assertContains(
  bridge,
  /stateBackend:\s*DATABASE_URL \? \(ready \? 'postgres' : 'postgres_unavailable'\) : 'file'/,
  'Bridge health must make Postgres availability visible instead of silently falling back.',
);

for (const actionId of [
  'collect_real_call_outcomes',
  'record_emotional_policy_outcomes',
  'strengthen_emotional_learning_loop',
  'clear_approval_backlog',
]) {
  assertContains(scorecard, new RegExp(`id:\\s*'${actionId}'`), `Intelligence scorecard must keep action ${actionId}.`);
}
assertContains(
  scorecard,
  /Run connected Telnyx calls and make sure each call writes transcript, emotion, action, outcome, and reward rows\./,
  'Ava learning loop must require real outcome rows, not just provider readiness.',
);

assertContains(
  researchAdditives,
  /providerWritesAllowed:\s*false/,
  'Research/provider augmentation must remain advisory-only by default.',
);
assertContains(
  researchAdditives,
  /humanStateFeedsTone:\s*true/,
  'Unified intelligence must feed human-state/emotional signals into tone selection.',
);
assertContains(
  researchAdditives,
  /toolDiscoveryFeedsNextAction:\s*true/,
  'Unified intelligence must collapse tooling into one next action for operator flow.',
);
assertContains(
  researchAdditives,
  /guiAndL4RemainApprovalGated:\s*true/,
  'Desktop automation and L4 mission plans must remain approval gated.',
);

assert(packageJson.scripts['test:hosted'], 'package.json must keep hosted bridge smoke coverage.');
assert(packageJson.scripts['render:status'], 'package.json must keep Render CLI status coverage.');
assert(packageJson.scripts['hermes:smoke'], 'package.json must keep Hermes smoke coverage.');
assert(packageJson.scripts['debug:intelligence:strict'], 'package.json must keep strict intelligence scorecard coverage.');

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'command_center_agi_architecture_guard_ready',
      gemini: {
        provider: yamlEnvValue(render, 'PBK_LIVE_LLM_PROVIDER'),
        live: yamlEnvValue(render, 'PBK_GEMINI_LIVE_MODEL'),
        attemptBudgetMs: geminiAttemptBudget,
      },
      deepSeek: {
        strategist: yamlEnvValue(render, 'PBK_DEEPSEEK_MODEL'),
        live: yamlEnvValue(render, 'PBK_DEEPSEEK_LIVE_MODEL'),
        retry: yamlEnvValue(render, 'PBK_DEEPSEEK_LIVE_RETRY_MODELS'),
        attemptBudgetMs: deepSeekAttemptBudget,
      },
      hermes: {
        enabled: yamlEnvValue(render, 'PBK_HERMES_ENABLED'),
        writeMode: 'suggest-only',
      },
      infrastructure: {
        postgres: 'fromDatabase:pbk-openclaw-db',
        redis: 'fromService:pbk-openclaw-redis',
        workers: ['pbk-event-worker', 'pbk-coworker-heartbeat', 'pbk-nightly-learning'],
      },
    },
    null,
    2,
  ),
);
