import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { test } from '@jest/globals';
import { parse } from 'yaml';
import { AGENT_LATENCY_PILOT_V2, getAgentLatencyPolicy, resolveAgentLatencyBudget } from './agent-latency-policy.mjs';

test('runtime image includes the complete reachable timing and coverage import closure', () => {
  const result = spawnSync(process.execPath, ['scripts/render-docker-imports-smoke.mjs'], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PBK_DATABASE_URL: '', DATABASE_URL: '', SUPABASE_DB_URL: '',
      PBK_MIGRATION_DATABASE_URL: '', PBK_TEST_DATABASE_URL: '', PBK_EVAL_DATABASE_URL: '' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('example policy parses as the complete approved pilot without enabling collection', () => {
  const env = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
  assert.equal(env.PBK_RUNTIME_COVERAGE_ENABLED, 'false');
  const policy = getAgentLatencyPolicy(env, { requireVersion2: true });
  assert.equal(policy.ready, true, JSON.stringify(policy.issues));
  assert.deepEqual(JSON.parse(env.PBK_AGENT_LATENCY_POLICY_V2), AGENT_LATENCY_PILOT_V2);
  for (const [channel, kind, extra, expected] of [
    ['chat', 'first_token', {}, 1800], ['phone', 'first_token', {}, 1800],
    ['chat', 'completion', { outputCodePoints: 100 }, 5000],
    ['phone', 'completion', { outputCodePoints: 100 }, 5000],
    ['phone', 'speech_start', {}, 2500],
    ['phone', 'speech_completion', { mediaDurationMs: 10000 }, 15500],
    ['research', 'completion', { outputCodePoints: 100 }, 122000],
    ['provider', 'completion', {}, 30000],
  ]) assert.deepEqual(resolveAgentLatencyBudget(policy, { channel, kind, ...extra }),
    { verified: true, budgetMs: expected, reason: 'verified' });
});

test('both guarded CI proof steps retain the existing credential fallback after harness child scrubbing', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/release-qualification.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs['release-qualification'].steps;
  for (const name of ['Run disposable Postgres tests', 'Run targeted schema and memory Postgres proof']) {
    const step = steps.find(item => item.name === name);
    assert.match(step.env.PBK_NEON_API_KEY || '', /^\$\{\{ secrets\.PBK_NEON_API_KEY \|\| secrets\.NEON_API_KEY \}\}$/,
      `${name}: guard must retain an existing credential when harness scrubs NEON_API_KEY`);
  }
});
