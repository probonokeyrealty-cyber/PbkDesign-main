import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import * as fixtures from './readiness-timing-postgres-fixture.mjs';
import { createAuditFixture } from './operational-audit-test-fixture.mjs';
import { readRuntimeCoverage } from './runtime-coverage-store.mjs';

const schema = `pbk_proof_${'a'.repeat(32)}`;
let runner = {};
try { runner = await import('./readiness-postgres-qualification.mjs'); }
catch (error) { if (!String(error.message).includes('mandatory six qualification')) throw error; }
const args = ['--config', 'jest.config.mjs', '--runInBand', '--runTestsByPath',
  'scripts/conversation-store.test.mjs', 'scripts/provider-action-dispatch.test.mjs',
  'scripts/release-qualification.test.mjs', 'scripts/operational-audit-store.test.mjs',
  'scripts/backlog-reconciliation-store.test.mjs', 'scripts/backlog-reconciliation-integration.test.mjs',
  '--json', '--outputFile=.pbk-local/guard-test-not-written.json'];

test('mapper rejects arbitrary identifiers and does not rewrite another schema with a public suffix', () => {
  for (const value of ['public', 'pbk_proof_short', `pbk_proof_${'A'.repeat(32)}`, `${schema};DROP SCHEMA public`,
    `${schema}.public`, '', undefined]) assert.throws(() => fixtures.mapReadinessFixtureSql('SELECT 1', value));
  assert.equal(fixtures.mapReadinessFixtureSql('SELECT * FROM notpublic.calls', schema),
    'SELECT * FROM notpublic.calls');
  assert.equal(fixtures.mapReadinessFixtureSql("SELECT to_regclass('public.calls') FROM public.calls WHERE nspname='public'", schema),
    `SELECT to_regclass('${schema}.calls') FROM ${schema}.calls WHERE nspname='${schema}'`);
});

test('query adapter forwards exact parameters, receiver, callback and result without overrides', () => {
  assert.equal(typeof fixtures.createReadinessFixtureQuery, 'function');
  const parameters = ["public.calls'", { namespace: 'public', value: 'unchanged' }];
  const receiver = {}, callback = () => {}, result = Promise.resolve({ rows: [{ untouched: true }] });
  let received;
  const query = fixtures.createReadinessFixtureQuery(function (...values) {
    received = { receiver: this, values }; return result;
  }, schema);
  const config = { text: 'SELECT $1 FROM public.calls', values: parameters, query_timeout: 1234, rowMode: 'array' };
  assert.equal(query.call(receiver, config, callback), result);
  assert.equal(received.receiver, receiver);
  assert.equal(received.values[0].values, parameters);
  assert.equal(received.values[1], callback);
  assert.deepEqual(received.values[0], { ...config, text: `SELECT $1 FROM ${schema}.calls` });
  assert.equal(config.text, 'SELECT $1 FROM public.calls');
  assert.equal(query.call(receiver, 'SELECT $1 FROM public.calls', parameters, callback), result);
  assert.equal(received.values[1], parameters);
  assert.equal(received.values[2], callback);
});

test('schema remapping executes real SQL while preserving parameter data and genuine returned rows', async () => {
  assert.equal(typeof fixtures.createReadinessFixtureQuery, 'function');
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.fixture(id int, payload jsonb)`);
    const query = fixtures.createReadinessFixtureQuery((config, values) => typeof config === 'string'
      ? db.query(config, values) : db.query(config.text, config.values), schema);
    const payload = { source: 'public.calls', literal: 'public', nested: [false, 3] };
    const inserted = await query('INSERT INTO public.fixture VALUES ($1,$2) RETURNING *', [7, payload]);
    assert.deepEqual(inserted.rows, [{ id: 7, payload }]);
    assert.deepEqual((await query({ text: 'SELECT * FROM public.fixture WHERE id=$1', values: [7] })).rows,
      inserted.rows);
    assert.equal((await db.query("SELECT to_regclass('public.fixture') AS relation")).rows[0].relation, null);
  } finally { await db.close(); }
}, 30000);

test('runner rejects non-exact suites before target validation or database access', async () => {
  assert.equal(typeof runner.runPostgresQualification, 'function');
  let validation = 0, pools = 0;
  for (const invalid of [args.filter(arg => !arg.endsWith('conversation-store.test.mjs')),
    [...args, 'scripts/extra.test.mjs'], [...args, '--testNamePattern=only'], [...args, '--passWithNoTests']]) {
    await assert.rejects(runner.runPostgresQualification({ args: invalid,
      validateTarget: async () => { validation++; throw Error('should not validate'); },
      createPool: () => { pools++; throw Error('should not create a pool'); } }));
  }
  assert.equal(validation, 0);
  assert.equal(pools, 0);
});

test('runner refuses an unverified target before pool creation, snapshots or any DDL', async () => {
  assert.equal(typeof runner.runPostgresQualification, 'function');
  const events = [];
  await assert.rejects(runner.runPostgresQualification({ args,
    validateTarget: async () => { events.push('guard'); throw Error('target denied'); },
    createPool: () => { events.push('database'); throw Error('DDL must be unreachable'); } }), /target denied/);
  assert.deepEqual(events, ['guard']);
});

test('actual bridge runtime import graph cannot reach test schema, seed or qualification helpers', () => {
  const visited = new Set(), forbidden = /readiness-(?:postgres|timing-postgres)|operational-audit-test-fixture/;
  const visit = path => {
    if (visited.has(path)) return;
    visited.add(path);
    const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const inspect = node => {
      const value = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : null;
      if (value && ts.isStringLiteral(value) && value.text.startsWith('.')) {
        assert.doesNotMatch(value.text, forbidden, path);
        if (/\.(?:mjs|js)$/.test(value.text)) visit(resolve(dirname(path), value.text));
      }
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
  };
  visit(resolve('scripts/openclaw-local-server.mjs'));
  assert(visited.size > 100, 'walk the real runtime dependency closure');
});

test('quiet seed copies only API-generated bounded proof rows and re-verifies the durable chain', async () => {
  assert.equal(typeof fixtures.seedTimingPostgresDay, 'function');
  const end = Date.now(), revision = 'a'.repeat(40), secret = 'explicit-test-only-seed-material';
  const target = await createAuditFixture({ end, revision, secret, duration: 0 });
  try {
    await target.db.exec('DELETE FROM pbk_eval_runs');
    const seeded = await fixtures.seedTimingPostgresDay({ pool: target.pool, end, revision, secret });
    assert.equal(seeded.checkpointCount, 1441);
    assert.equal(seeded.rowCount, 1443);
    assert(seeded.bytes < 16 * 1024 * 1024);
    const read = await readRuntimeCoverage({ pool: target.pool, secret, revision, now: target.now });
    assert.equal(read.verified, true, read.result);
    assert.deepEqual(read.proof.reference, seeded.reference);
    assert.equal(read.diagnostics.organicCompletions, 0);
    assert.equal(read.diagnostics.fleetQualified, false);
  } finally { await target.close(); }
}, 180000);

test('fixture clock catch-up samples every forward step without crossing the real maximum gap', async () => {
  assert.equal(typeof fixtures.advanceAuditFixtureClock, 'function');
  const end = Date.now(), revision = 'a'.repeat(40), secret = 'isolated-fixture-catch-up-only';
  const fixture = await createAuditFixture({ end, revision, secret, duration: 0 });
  try {
    await fixtures.advanceAuditFixtureClock(fixture, end + 120001);
    assert.equal(fixture.now(), end + 120001);
    const checkpoints = (await fixture.db.query("SELECT report FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1' ORDER BY created_at")).rows;
    assert.equal(checkpoints.length, 4);
    assert.deepEqual(checkpoints.map(row => row.report.sequence), [1, 2, 3, 4]);
    for (let i = 1; i < checkpoints.length; i++) {
      assert.equal(checkpoints[i].report.previous, checkpoints[i - 1].report.signature);
      const step = Date.parse(checkpoints[i].report.cutoff) - Date.parse(checkpoints[i - 1].report.cutoff);
      assert(step > 0 && step <= 60000);
      assert.equal(checkpoints[i].report.segmentRef, checkpoints[0].report.segmentRef);
    }
    await assert.rejects(fixtures.advanceAuditFixtureClock(fixture, end), /clock/);
    assert.equal(fixture.now(), end + 120001);
  } finally { await fixture.close(); }
}, 30000);
