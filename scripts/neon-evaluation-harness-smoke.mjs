import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const harness = readFileSync('scripts/neon-evaluation-harness.mjs', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const runbook = readFileSync('docs/NEON_EVALUATION_HARNESS.md', 'utf8');
const releaseChecklist = readFileSync('RELEASE_CHECKLIST.md', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');

assert.equal(
  packageJson.scripts?.['neon:evaluation'],
  'node ./scripts/neon-evaluation-harness.mjs',
  'package.json must expose neon:evaluation.'
);

assert.equal(
  packageJson.scripts?.['neon:evaluation:dry-run'],
  'node ./scripts/neon-evaluation-harness.mjs --dry-run -- npm run test:ava-eval-suite',
  'package.json must expose a default dry-run command for local validation.'
);

assert.equal(
  packageJson.scripts?.['test:neon-evaluation-harness'],
  'node ./scripts/neon-evaluation-harness-smoke.mjs',
  'package.json must expose test:neon-evaluation-harness.'
);

assert.equal(
  packageJson.scripts?.['test:neon-evaluation-dry-run'],
  'npm run neon:evaluation:dry-run',
  'package.json must expose an executable Neon evaluation dry-run gate.'
);

assert.match(
  packageJson.scripts?.['test:production-hardening'] || '',
  /npm run test:neon-evaluation-harness/,
  'Production hardening must include the Neon evaluation harness guard.'
);

assert.match(
  packageJson.scripts?.['test:production-hardening'] || '',
  /npm run test:neon-evaluation-dry-run/,
  'Production hardening must execute the Neon evaluation dry-run gate.'
);

assert.match(
  runbook,
  /npm run neon:evaluation:dry-run/,
  'Neon evaluation runbook must document the dry-run command.'
);

assert.match(
  runbook,
  /--inject-runtime-db/,
  'Neon evaluation runbook must document the explicit runtime DB opt-in.'
);

assert.match(
  releaseChecklist,
  /npm run test:neon-evaluation-harness/,
  'Release checklist must include the Neon evaluation harness guard.'
);

assert.match(
  envExample,
  /NEON_API_KEY=/,
  '.env.example must document NEON_API_KEY for live disposable branch evals.'
);

assert.match(
  envExample,
  /NEON_PROJECT_ID=/,
  '.env.example must document NEON_PROJECT_ID for live disposable branch evals.'
);

assert.match(
  envExample,
  /PBK_NEON_API_KEY=/,
  '.env.example must document the PBK-scoped Neon API key alias.'
);

assert.match(
  envExample,
  /PBK_NEON_PROJECT_ID=/,
  '.env.example must document the PBK-scoped Neon project id alias.'
);

assert.match(
  harness,
  /NEON_API_KEY/,
  'Harness must require NEON_API_KEY instead of embedding credentials.'
);

assert.match(
  harness,
  /NEON_PROJECT_ID/,
  'Harness must require NEON_PROJECT_ID so branch creation is explicit.'
);

assert.match(
  harness,
  /PBK_NEON_API_KEY/,
  'Harness must accept PBK_NEON_API_KEY as a PBK-scoped API key alias.'
);

assert.match(
  harness,
  /PBK_NEON_PROJECT_ID/,
  'Harness must accept PBK_NEON_PROJECT_ID as a PBK-scoped project id alias.'
);

assert.match(
  harness,
  /\/projects\/\$\{encodeURIComponent\(projectId\)\}\/branches/,
  'Harness must create branches through the Neon branch API.'
);

assert.match(
  harness,
  /type:\s*'read_write'/,
  'Harness must request a read-write compute endpoint for branch test commands.'
);

assert.match(
  harness,
  /expires_at:\s*expiresAt/,
  'Harness-created branches must have an expiry safety net.'
);

assert.match(
  harness,
  /PBK_TEST_DATABASE_URL:\s*connectionUri/,
  'Harness must inject PBK_TEST_DATABASE_URL into eval commands.'
);

assert.match(
  harness,
  /PBK_EVAL_DATABASE_URL:\s*connectionUri/,
  'Harness must inject PBK_EVAL_DATABASE_URL into eval commands.'
);

assert.match(
  harness,
  /PBK_DATABASE_URL:\s*''/,
  'Harness must scrub PBK_DATABASE_URL by default so evals do not inherit production.'
);

assert.match(
  harness,
  /DATABASE_URL:\s*''/,
  'Harness must scrub DATABASE_URL by default so evals do not inherit production.'
);

assert.match(
  harness,
  /PBK_MIGRATION_DATABASE_URL:\s*''/,
  'Harness must not let migration commands inherit a production migration URL.'
);

assert.match(
  harness,
  /injectRuntimeDb/,
  'Harness must require an explicit opt-in before aliasing the Neon branch as PBK_DATABASE_URL.'
);

assert.match(
  harness,
  /finally\s*\{[\s\S]*deleteNeonBranch/,
  'Harness must delete the disposable Neon branch in a finally block.'
);

assert.match(
  harness,
  /--dry-run/,
  'Harness must support dry-run validation without calling the Neon API.'
);

console.log('[neon-evaluation-harness-smoke] ok');
