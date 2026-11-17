import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { validateTargetedEvalTarget } from './targeted-readiness-eval-guard.mjs';
import { readProtectedFixtureFingerprints } from './readiness-timing-postgres-fixture.mjs';

const expected = [
  'backlog-reconciliation-integration.test.mjs',
  'backlog-reconciliation-store.test.mjs',
  'conversation-store.test.mjs',
  'operational-audit-store.test.mjs',
  'provider-action-dispatch.test.mjs',
  'release-qualification.test.mjs',
];
export async function runPostgresQualification({
  args = process.argv.slice(2),
  env = process.env,
  validateTarget = validateTargetedEvalTarget,
  createPool = (config) => new pg.Pool(config),
} = {}) {
  assert.deepEqual(
    args.filter((arg) => arg.endsWith('.test.mjs')).sort(),
    expected.map((file) => `scripts/${file}`),
    'The mandatory six qualification suites must remain exact'
  );
  const flags = new Set([
    '--config',
    'jest.config.mjs',
    '--runInBand',
    '--maxWorkers=2',
    '--workerIdleMemoryLimit=128MB',
    '--runTestsByPath',
    '--json',
    ...expected.map((file) => `scripts/${file}`),
  ]);
  assert(
    args.every((arg) => flags.has(arg) || arg.startsWith('--outputFile=')),
    'Unsupported qualification selector/override'
  );
  assert(
    args.includes('--runTestsByPath') &&
      args.includes('--config') &&
      args[args.indexOf('--config') + 1] === 'jest.config.mjs',
    'Fixed qualification config required'
  );
  const reportPath = args.find((arg) => arg.startsWith('--outputFile='))?.slice('--outputFile='.length);
  assert(reportPath && args.includes('--json'), 'A machine-readable qualification report is mandatory');
  const { connectionConfig } = await validateTarget({ env });
  const pool = createPool({
    ...connectionConfig,
    max: 1,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  const schemas = Object.fromEntries(
    expected.map((file) => [file, `pbk_proof_${randomUUID().replaceAll('-', '')}`])
  );
  const created = [];
  async function guardSnapshot() {
    return readProtectedFixtureFingerprints(pool);
  }
  let before;
  try {
    before = await guardSnapshot();
    for (const schema of Object.values(schemas)) {
      assert.match(schema, /^pbk_proof_[a-f0-9]{32}$/);
      await pool.query(`CREATE SCHEMA ${schema}`);
      created.push(schema);
    }
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--experimental-vm-modules',
          'node_modules/jest/bin/jest.js',
          '--setupFilesAfterEnv',
          './scripts/readiness-postgres-schema.jest-fixture.mjs',
          ...args,
        ],
        {
          env: { ...env, PBK_QUALIFICATION_SCHEMA_MAP: JSON.stringify(schemas) },
          stdio: 'inherit',
          windowsHide: true,
        }
      );
      child.once('error', reject);
      child.once('close', (value) => resolve(value));
    });
    assert.equal(code, 0, 'Actual six-suite qualification failed');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.success, true);
    for (const key of [
      'numFailedTests',
      'numPendingTests',
      'numTodoTests',
      'numFailedTestSuites',
      'numPendingTestSuites',
      'numRuntimeErrorTestSuites',
    ])
      assert.equal(report[key], 0, key);
    assert.equal(report.numTotalTestSuites, 6);
    assert.equal(report.numPassedTestSuites, 6);
    assert.ok(report.numTotalTests > 0);
    assert.equal(report.numPassedTests, report.numTotalTests);
    assert.equal(report.testResults.length, 6);
    assert.deepEqual(report.testResults.map((suite) => basename(suite.name)).sort(), expected);
    let assertions = 0;
    for (const suite of report.testResults) {
      assert.equal(suite.status, 'passed');
      assert.ok(suite.assertionResults.length > 0);
      for (const assertion of suite.assertionResults) assert.equal(assertion.status, 'passed');
      assertions += suite.assertionResults.length;
    }
    assert.equal(assertions, report.numTotalTests);
    console.log(`Postgres qualification: ${assertions} passed, zero skipped or failed (exact six suites).`);
  } finally {
    try {
      if (before)
        assert.deepEqual(
          await guardSnapshot(),
          before,
          'Inherited approvals/dispatches/dead letters/calls changed'
        );
    } finally {
      try {
        for (const schema of created) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
        const remaining = (
          await pool.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=ANY($1::text[])', [
            created,
          ])
        ).rows[0].n;
        assert.equal(remaining, 0);
        console.log(
          'Qualification schema cleanup verified; inherited approval/dispatch/dead-letter/call snapshots unchanged.'
        );
      } finally {
        await pool.end();
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runPostgresQualification();
}
