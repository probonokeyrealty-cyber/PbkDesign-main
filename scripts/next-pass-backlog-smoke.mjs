import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
assert.equal(
  packageJson.scripts['learning:nightly'],
  'node ./scripts/nightly-learning-cron.mjs',
  'package.json should expose a nightly skill-decay + ONNX training cron command.'
);
assert.equal(
  packageJson.scripts['test:next-pass-backlog'],
  'node ./scripts/next-pass-backlog-smoke.mjs',
  'package.json should expose the next-pass backlog smoke gate.'
);

const nightlyCronPath = 'scripts/nightly-learning-cron.mjs';
assert.equal(existsSync(path.join(repoRoot, nightlyCronPath)), true, 'nightly learning cron script should exist.');
const nightlyCron = read(nightlyCronPath);
assert.match(nightlyCron, /runAutoSkillLearner/, 'nightly cron should run skill boost/decay/extraction.');
assert.match(nightlyCron, /train-emotion-world-model\.mjs/, 'nightly cron should trigger emotion world model training when data is ready.');
assert.match(nightlyCron, /PBK_NIGHTLY_EMOTION_MIN_SAMPLES/, 'nightly cron should have a configurable ONNX training sample floor.');
assert.match(nightlyCron, /PBK_NIGHTLY_LEARNING_DRY_RUN/, 'nightly cron should support a dry-run mode for safe deploy verification.');

const renderYaml = read('render.yaml');
assert.match(renderYaml, /type:\s*cron[\s\S]*name:\s*pbk-nightly-learning/, 'Render blueprint should include a nightly learning cron.');
assert.match(renderYaml, /startCommand:\s*npm run learning:nightly/, 'Render nightly cron should execute the package script.');
assert.match(renderYaml, /PBK_LOCAL_CALLBACK_URL/, 'Render blueprint should expose permanent local callback URL configuration.');
assert.match(renderYaml, /PBK_LOCAL_CALLBACK_TOKEN/, 'Render blueprint should expose permanent local callback token configuration.');
assert.match(renderYaml, /PBK_LOCAL_CALLBACK_TIMEOUT_MS/, 'Render blueprint should expose local callback timeout configuration.');

const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const fuzzyMigrationName = readdirSync(migrationsDir).find((fileName) => /pbk_pg_trgm_fuzzy_lead_lookup\.sql$/.test(fileName));
assert.ok(fuzzyMigrationName, 'Supabase migrations should include a pg_trgm fuzzy lead lookup migration.');
const fuzzyMigration = read(path.join('supabase', 'migrations', fuzzyMigrationName));
assert.match(fuzzyMigration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/i, 'Fuzzy lookup migration should enable pg_trgm.');
assert.match(fuzzyMigration, /pbk_fuzzy_lead_lookup/i, 'Fuzzy lookup migration should create a reusable lookup function.');
assert.match(fuzzyMigration, /similarity\s*\(/i, 'Fuzzy lookup should use pg_trgm similarity.');
assert.match(fuzzyMigration, /lead_profiles/i, 'Fuzzy lookup should search normalized lead profiles.');
assert.match(fuzzyMigration, /lead_imports/i, 'Fuzzy lookup should include imported leads as a fallback source.');

const bridge = read('scripts/openclaw-local-server.mjs');
assert.match(bridge, /runFuzzyLeadLookupFromDb/, 'Bridge should expose a Postgres-backed fuzzy lead lookup helper.');
assert.match(bridge, /pbk_fuzzy_lead_lookup/, 'Bridge fuzzy lookup helper should call the pg_trgm database function.');
assert.match(bridge, /\/api\/leads\/search/, 'Bridge should expose an HTTP lead search endpoint for UI and assistant use.');
assert.match(bridge, /async function executeRouteToolHandler/, 'Bridge should expose a traced route tool helper for direct HTTP routes.');
assert.match(
  bridge,
  /executeRouteToolHandler\('telnyx_sms'[\s\S]*executeRouteToolHandler\('sendColdEmail'/,
  'Lead message send route should use traced tool execution for SMS and email sends.'
);

const assistant = read('scripts/ava-assistant-chat.mjs');
assert.match(assistant, /PBK_ASSISTANT_INTENT_CLASSIFIER/, 'Assistant should expose a local intent classifier feature flag.');
assert.match(assistant, /classifyAssistantIntentLocally/, 'Assistant should have a local classifier hook before regex fallback.');
assert.match(assistant, /classifierSource/, 'Assistant intent results should report whether regex or local classifier selected the route.');

console.log('[next-pass-backlog-smoke] ok');
