import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import pg from 'pg';
let guard = {};
try { guard = await import('./targeted-readiness-eval-guard.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const now = Date.parse('2026-11-16T12:00:00Z');
const env = {
  PBK_TEST_DATABASE_URL: 'postgresql://fixture:private@ep-fixture.us-east-2.aws.neon.tech/neondb',
  PBK_EVAL_DATABASE_URL: 'postgresql://fixture:private@ep-fixture.us-east-2.aws.neon.tech/neondb',
  NEON_PROJECT_ID: 'fixture-project', PBK_NEON_API_KEY: 'fixture-authority',
  PBK_NEON_EVAL_BRANCH_ID: 'br-fixture', PBK_NEON_EVAL_BRANCH_NAME: 'pbk-eval-targeted-readiness-fixture',
};
function run({ branch = {}, endpoints, overrides = {}, status = 200 } = {}) {
  assert.equal(typeof guard.validateTargetedEvalTarget, 'function');
  return guard.validateTargetedEvalTarget({ env: { ...env, ...overrides }, now,
    fetchImpl: async url => ({ ok: status === 200, status,
      json: async () => url.endsWith('/endpoints') ? { endpoints: endpoints ?? [{
        host: 'ep-fixture.us-east-2.aws.neon.tech', branch_id: 'br-fixture', type: 'read_write',
      }] } : { branch: { id: 'br-fixture', name: env.PBK_NEON_EVAL_BRANCH_NAME,
        parent_id: 'br-parent', default: false, protected: false,
        created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 3600000).toISOString(), ...branch } },
    }) });
}
test('validates the actual disposable branch endpoint before destructive fixture setup', async () => {
  const result = await run();
  assert.equal(result.databaseUrl, env.PBK_TEST_DATABASE_URL);
  assert.equal(result.branchId, 'br-fixture');
});
for (const branch of [{ default: true }, { protected: true }, { parent_id: null },
  { name: 'main' }, { id: 'br-other' }, { created_at: new Date(now - 3600000).toISOString() },
  { expires_at: null }, { expires_at: new Date(now - 1).toISOString() }]) {
  test(`rejects a non-disposable branch ${JSON.stringify(branch)}`, async () => {
    await assert.rejects(run({ branch }), /disposable|target|branch/i);
  });
}
test('rejects a parent endpoint even with forged disposable environment labels', async () => {
  await assert.rejects(run({ endpoints: [{ host: 'ep-parent.us-east-2.aws.neon.tech',
    branch_id: 'br-parent', type: 'read_write' }] }), /endpoint/i);
});
for (const overrides of [{ PBK_DATABASE_URL: 'runtime-target' }, { DATABASE_URL: 'runtime-target' },
  { PBK_EVAL_DATABASE_URL: 'different' }, { PBK_NEON_API_KEY: '' }, { PBK_NEON_EVAL_BRANCH_NAME: 'main' }]) {
  test(`rejects unsafe harness inputs ${Object.keys(overrides).join(',')}`, async () => {
    await assert.rejects(run({ overrides }), /disposable|target|authority|harness/i);
  });
}
test('API failures do not permit fixture setup', async () => {
  await assert.rejects(run({ status: 401 }), /verification/i);
});

for (const query of ['host=ep-parent.us-east-2.aws.neon.tech', 'hostaddr=127.0.0.1',
  'port=5433', 'user=owner', 'password=other', 'options=endpoint%3Dep-parent',
  'sslmode=no-verify', 'sslrootcert=local.pem', 'sslmode=require&sslmode=disable',
  'channel_binding=disable', '%68ost=ep-parent.us-east-2.aws.neon.tech']) {
  test(`rejects driver connection overrides: ${query}`, async () => {
    const url = `${env.PBK_TEST_DATABASE_URL}?${query}`;
    await assert.rejects(run({ overrides: { PBK_TEST_DATABASE_URL: url, PBK_EVAL_DATABASE_URL: url } }),
      /target|override|parameter/i);
  });
}

test('returns explicit verified driver fields instead of reparsing the original URI', async () => {
  const url = `${env.PBK_TEST_DATABASE_URL}?sslmode=require&channel_binding=require`;
  const result = await run({ overrides: { PBK_TEST_DATABASE_URL: url, PBK_EVAL_DATABASE_URL: url } });
  assert.equal(result.connectionConfig.connectionString, undefined);
  const client = new pg.Client(result.connectionConfig);
  assert.equal(client.connectionParameters.host, 'ep-fixture.us-east-2.aws.neon.tech');
  assert.equal(client.connectionParameters.port, 5432);
  assert.equal(client.connectionParameters.database, 'neondb');
  assert.equal(client.connectionParameters.user, 'fixture');
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
});
