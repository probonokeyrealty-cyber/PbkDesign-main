import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { recordRuntimeSourceEvidence } from './runtime-source-evidence.mjs';
import { withRuntimeEvidenceContext } from './runtime-evidence-context.mjs';

let store = {}, samplerModule = {};
try { store = await import('./runtime-coverage-store.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
try { samplerModule = await import('./runtime-coverage-sampler.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const api = (module, name) => {
  assert.equal(typeof module[name], 'function', `${name} must implement forward-only coverage`);
  return module[name];
};
const DAY = 86400000, START = Date.parse('2026-11-17T12:00:00.000Z');
const revision = 'a'.repeat(40);
const health = () => ({ authenticationConfigured: true, bootstrapReady: true, archiveReady: true,
  providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true, approvalMode: 'approval' });
let db, wall, mono, secret, serial = 0, statements, releases, fail, dbOffset, loadedCheckpoints;
const pool = { connect: async () => ({
  async query(config, values) {
    const text = typeof config === 'string' ? config : config.text;
    values = typeof config === 'string' ? values : config.values;
    statements.push({ text, values, timeout: config.query_timeout });
    if (fail?.(text, values)) throw Error('private database failure');
    if (text.includes('clock_timestamp() AS coverage_now')) {
      return { rows: [{ coverage_now: new Date(wall + dbOffset) }] };
    }
    const result = await db.query(text, values);
    loadedCheckpoints += result.rows?.filter(row => row.suite_name === 'runtime_coverage_v1').length || 0;
    return result;
  }, release: destroy => {
    releases.push(destroy);
    if (destroy) void db.exec('ROLLBACK').catch(() => {});
  },
}) };
const makeSampler = (options = {}) => api(samplerModule, 'createRuntimeCoverageSampler')({
  pool, secret, revision, enabled: true, hosted: true, health, now: () => wall,
  monotonicNow: () => mono, bootId: 'local-fixture-boot', ...options,
});
const read = (options = {}) => api(store, 'readRuntimeCoverage')({ pool, secret, revision, now: () => wall, ...options });
const verifySaved = (reference, options = {}) => api(store, 'verifyRuntimeCoverageReference')({
  pool, secret, revision, now: () => wall, reference, ...options,
});
const advance = (ms = 60000) => { wall += ms; mono += ms; };
const chain = async (duration = DAY) => {
  const sampler = makeSampler();
  assert.equal((await sampler.sample()).verified, true);
  for (let elapsed = 0; elapsed < duration; elapsed += 60000) {
    advance();
    const result = await sampler.sample();
    assert.equal(result.verified, true, `${elapsed}: ${JSON.stringify(result)}`);
  }
  return sampler;
};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE activity_log(id text PRIMARY KEY,workspace_id text DEFAULT 'pbk',source text DEFAULT 'runtime-event:pbk',
      status text DEFAULT 'success',category text DEFAULT 'EVENT',text text DEFAULT '',metadata jsonb DEFAULT '{}',
      created_at timestamptz,updated_at timestamptz);
    CREATE TABLE conversation_events(id uuid PRIMARY KEY,workspace_id text DEFAULT 'pbk',source_table text,source_id text,
      event_type text,channel text,direction text,status text,body text,payload jsonb,created_at timestamptz,
      updated_at timestamptz,occurred_at timestamptz);
    CREATE TABLE pbk_qa_audit(id text PRIMARY KEY,tenant_id text DEFAULT 'pbk',tool_name text,passed boolean,skipped boolean,
      reason text,validator text,retry_count int,params jsonb,result jsonb,qa jsonb,source text,created_at timestamptz);
    CREATE TABLE pbk_safety_audit(id text PRIMARY KEY,tenant_id text DEFAULT 'pbk',tool_name text,blocked boolean,
      approval_required boolean,params jsonb,validation jsonb,source text,created_at timestamptz);
    CREATE TABLE pbk_eval_runs(id text PRIMARY KEY,tenant_id text,suite_name text,ok boolean,total int,passed int,
      failed int,report jsonb,source text,created_at timestamptz);
  `);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('TRUNCATE activity_log,conversation_events,pbk_qa_audit,pbk_safety_audit,pbk_eval_runs');
  wall = START; mono = 100; dbOffset = 0; fail = null; statements = []; releases = [];
  loadedCheckpoints = 0;
  secret = `explicit-local-coverage-fixture-material-${++serial}`;
});

test('first observation and short chain never cover preceding time; exact cutoff is required', async () => {
  const sampler = await chain(120000);
  const result = await read();
  assert.equal(result.verified, false);
  assert.equal(result.result, 'coverage_window_incomplete');
  const rows = (await db.query("SELECT * FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1' ORDER BY created_at")).rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].report.intervalStart, rows[0].report.cutoff);
  assert.equal(rows[0].report.sequence, 1);
  assert.equal(rows[1].report.previous, rows[0].report.signature);
  assert.equal(rows.every(row => !row.ok && row.total === 0 && row.passed === 0 && row.failed === 0), true);
  assert.equal((await read({ cutoff: wall - 1 })).verified, false);
  assert.equal((await sampler.sample({ cutoff: wall - 60000 })).verified, false);
});

test('genuine quiet 24h chain verifies compact ordered proof with one fresh census and no organic work', async () => {
  const sampler = await chain();
  statements = [];
  const result = await read();
  assert.equal(result.verified, true, JSON.stringify(result));
  assert.equal(result.proof.windowStart, new Date(START).toISOString());
  assert.equal(result.proof.cutoff, new Date(wall).toISOString());
  assert.equal(result.proof.checkpointCount, 1441);
  assert.match(result.proof.orderedRoot, /^[a-f0-9]{64}$/);
  assert.equal(result.diagnostics.organicCompletions, 0);
  assert.equal(result.diagnostics.quiet, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result.proof)) < 8192);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
  assert.equal(statements.filter(s => s.text.includes('SELECT to_jsonb(p) AS row FROM (SELECT id, workspace_id, source,')).length, 1);
  assert.equal(statements.every(s => s.timeout <= 2000), true);
  assert.equal(JSON.stringify(result).includes(secret), false);
  const checkpoints = (await db.query("SELECT report FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows;
  assert.equal(checkpoints.every(row => Buffer.byteLength(JSON.stringify(row.report)) <= 8192), true);
  advance(30001);
  assert.equal((await sampler.sample()).verified, true);
  const rolling = await read();
  assert.equal(rolling.verified, true, 'non-aligned rolling cutoff still has a genuine left endpoint');
  assert.equal(rolling.proof.windowStart, new Date(START + 30001).toISOString());

  const savedReference = result.proof.reference;
  const rollingReference = rolling.proof.reference;
  for (let i = 0; i < 2; i++) { advance(); assert.equal((await sampler.sample()).verified, true); }
  assert.equal((await read({ cutoff: Date.parse(result.proof.cutoff) })).verified, false,
    'ordinary latest mode must retain its current-cutoff/freshness contract');
  loadedCheckpoints = 0;
  const reverified = await verifySaved(savedReference);
  assert.equal(reverified.verified, true, JSON.stringify(reverified));
  assert.deepEqual(reverified.proof.reference, savedReference);
  assert.equal(loadedCheckpoints, 1442, 'load only saved window+left endpoint+one current head, not the intervening tail');
  assert.equal((await verifySaved(rollingReference)).verified, true, 'saved non-aligned window retains its actual left endpoint');
  assert.equal((await verifySaved(savedReference, { now: () => Date.parse(savedReference.cutoff) + DAY + 1 })).result,
    'coverage_reference_expired');
  assert.equal((await verifySaved(savedReference, { now: () => Date.parse(savedReference.cutoff) + DAY })).result,
    'coverage_reference_expired');
  for (const field of ['orderedRoot', 'bootRef', 'segmentRef', 'revision', 'windowStart', 'cutoff', 'signature']) {
    const changed = { ...savedReference, [field]: field === 'revision' ? 'b'.repeat(40) : '0'.repeat(64) };
    assert.equal((await verifySaved(changed)).verified, false, field);
  }
  for (const changed of [{ ...savedReference, verified: true }, { ...savedReference, first: { ...savedReference.first, id: 'wrong-reference' } },
    { ...savedReference, last: { ...savedReference.last, sequence: 9999 } }, { ...savedReference, checkpointCount: 2001 }]) {
    assert.equal((await verifySaved(changed)).verified, false);
  }
  assert.equal((await verifySaved(savedReference, { revision: 'b'.repeat(40) })).verified, false);
  assert.equal((await verifySaved(savedReference, { cutoff: wall })).verified, false, 'reference mode has no caller range override');
  await db.query(`INSERT INTO pbk_eval_runs(id,tenant_id,suite_name,ok,total,passed,failed,report,source,created_at)
    SELECT 'post-cutoff-junk-' || n,'pbk','runtime_coverage_v1',false,0,0,0,'{}','server:runtime-coverage:v1',$1
    FROM generate_series(1,2001) n`, [new Date(Date.parse(savedReference.cutoff) + 1).toISOString()]);
  loadedCheckpoints = 0;
  assert.equal((await verifySaved(savedReference)).verified, true, 'unrelated post-cutoff rows are not loaded as two days of proof');
  assert.equal(loadedCheckpoints, 1442);
  await db.exec("DELETE FROM pbk_eval_runs WHERE id LIKE 'post-cutoff-junk-%'");
  await db.query(`INSERT INTO pbk_eval_runs(id,tenant_id,suite_name,ok,total,passed,failed,report,source,created_at)
    SELECT 'in-window-junk-' || n,'pbk','runtime_coverage_v1',false,0,0,0,'{}','server:runtime-coverage:v1',$1
    FROM generate_series(1,559) n`, [new Date(Date.parse(savedReference.cutoff) - 1).toISOString()]);
  loadedCheckpoints = 0;
  assert.equal((await verifySaved(savedReference)).result, 'coverage_census_unverified', 'the extra current head counts toward the 2000 total');
  assert.equal(loadedCheckpoints, 0, 'over-bound metadata rejects before loading reports');
  await db.exec("DELETE FROM pbk_eval_runs WHERE id LIKE 'in-window-junk-%'");
  const oldRow = (await db.query('SELECT * FROM pbk_eval_runs WHERE id=$1', [savedReference.first.id])).rows[0];
  await db.query("UPDATE pbk_eval_runs SET report=report || '{\"sequence\":9999}'::jsonb WHERE id=$1", [oldRow.id]);
  assert.equal((await verifySaved(savedReference)).verified, false, 'tampered historical row must block saved proof');
  await db.query('UPDATE pbk_eval_runs SET report=$2::jsonb WHERE id=$1', [oldRow.id, JSON.stringify(oldRow.report)]);
  await db.query('DELETE FROM pbk_eval_runs WHERE id=$1', [oldRow.id]);
  assert.equal((await verifySaved(savedReference)).verified, false, 'deleted historical endpoint must block saved proof');
  await db.query(`INSERT INTO pbk_eval_runs SELECT * FROM jsonb_populate_record(NULL::pbk_eval_runs,$1::jsonb)`, [JSON.stringify(oldRow)]);
  const controlRow = (await db.query("SELECT * FROM pbk_eval_runs WHERE suite_name='runtime_coverage_control_v1'")).rows[0];
  await db.query("UPDATE pbk_eval_runs SET report=report || '{\"phase\":\"pending\"}'::jsonb WHERE id=$1", [controlRow.id]);
  assert.equal((await verifySaved(savedReference)).verified, false, 'invalid current control cannot fall back to a saved proof');
  await db.query('UPDATE pbk_eval_runs SET report=$2::jsonb WHERE id=$1', [controlRow.id, JSON.stringify(controlRow.report)]);

  // New, genuinely recorded source transitions must not alter already-closed interval bindings.
  advance(1);
  await db.query('INSERT INTO activity_log(id,text,created_at,updated_at) VALUES ($1,$2,$3,$3)',
    ['private-active-source', 'private answer', new Date(wall).toISOString()]);
  assert.equal((await withRuntimeEvidenceContext('operator_chat', () => recordRuntimeSourceEvidence({
    pool, secret, revision, sourceKind: 'runtime_archive', sourceId: 'private-active-source', now: () => wall,
  }))).verified, true);
  const historical = await read({ cutoff: wall - 1 });
  assert.equal(historical.verified, true, 'fresh legitimate transition after exact audit cutoff is not old-snapshot equality');
  advance();
  assert.equal((await sampler.sample()).verified, true);
  const active = await read();
  assert.equal(active.verified, true, JSON.stringify(active));
  assert.equal(active.diagnostics.organicCompletions, 1);
  assert.equal(active.diagnostics.fleetQualified, false);
  const afterSourceChange = await verifySaved(savedReference);
  assert.equal(afterSourceChange.verified, true, JSON.stringify(afterSourceChange));
  assert.deepEqual(afterSourceChange.proof.reference, savedReference);
  assert.notDeepEqual(afterSourceChange.proof.census.inventory, result.proof.census.inventory,
    'dynamic census metadata is not part of immutable saved-reference equality');

  advance(1);
  await db.exec("UPDATE activity_log SET text='unattributed mutation'");
  const unknown = await read({ cutoff: wall - 1 });
  assert.equal(unknown.verified, true, 'unknown provenance is a readiness diagnostic, not failed monitoring');
  assert.equal(unknown.diagnostics.sourceProvenanceVerified, false);
  assert.equal(unknown.diagnostics.organicCompletions, 0);
  assert.equal(unknown.sources[0].counts.lateUnknown, 1);
  advance();
  assert.equal((await sampler.sample()).verified, true);
  const unknownInterval = await read();
  assert.equal(unknownInterval.verified, true, JSON.stringify(unknownInterval));
  assert.equal(unknownInterval.sources[0].counts.unknown, 1);
  await db.exec('DELETE FROM activity_log');
  advance();
  assert.equal((await sampler.sample()).verified, true);
  const tombstone = await read();
  assert.equal(tombstone.verified, true, JSON.stringify(tombstone));
  assert.equal(tombstone.sources[0].counts.deleted, 1);
  assert.equal(tombstone.diagnostics.sourceProvenanceVerified, false);
  assert.equal((await verifySaved(savedReference)).verified, true, 'post-cutoff unknown/tombstone transitions preserve old interval bindings');

  const saved = (await db.query("SELECT * FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1' ORDER BY created_at DESC LIMIT 1")).rows[0];
  await db.query("UPDATE pbk_eval_runs SET report=report || '{\"sequence\":9999}'::jsonb WHERE id=$1", [saved.id]);
  assert.equal((await read()).result, 'coverage_record_unverified');
  assert.equal((await verifySaved(savedReference)).verified, false, 'invalid current head cannot certify a saved historical window');
  await db.query('UPDATE pbk_eval_runs SET report=$2::jsonb WHERE id=$1', [saved.id, JSON.stringify(saved.report)]);
  await db.query('DELETE FROM pbk_eval_runs WHERE id=$1', [saved.id]);
  assert.equal((await verifySaved(savedReference)).verified, false, 'missing current head cannot certify a saved historical window');
  await db.query(`INSERT INTO pbk_eval_runs SELECT * FROM jsonb_populate_record(NULL::pbk_eval_runs,$1::jsonb)`, [JSON.stringify(saved)]);
  assert.equal((await read()).verified, true);

  const endpoint = (await db.query("SELECT * FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1' AND created_at <= $1 ORDER BY created_at DESC LIMIT 1",
    [new Date(wall - DAY).toISOString()])).rows[0];
  await db.query('DELETE FROM pbk_eval_runs WHERE id=$1', [endpoint.id]);
  assert.equal((await read()).verified, false, 'deleting the actual left endpoint cannot be hidden by min/max bounds');
  await db.query(`INSERT INTO pbk_eval_runs SELECT * FROM jsonb_populate_record(NULL::pbk_eval_runs,$1::jsonb)`, [JSON.stringify(endpoint)]);
  advance(); fail = text => text.includes('FROM public.activity_log');
  assert.equal((await sampler.sample()).verified, false);
  fail = null;
  assert.equal((await verifySaved(savedReference)).verified, false, 'a real signed pending current control blocks saved proof');
  advance(16000);
  const afterGap = await sampler.sample();
  assert.equal(afterGap.verified, true);
  assert.notEqual(afterGap.report.segmentRef, savedReference.segmentRef);
  assert.equal((await verifySaved(savedReference)).verified, false, 'new healthy segment after a source gap cannot certify the old proof');
  advance(120001);
  const replacement = makeSampler({ bootId: 'replacement-historical-boot', revision: 'b'.repeat(40) });
  assert.equal((await replacement.sample()).verified, true);
  assert.equal((await verifySaved(savedReference)).verified, false, 'new boot/revision cannot certify saved prior-boot proof');
}, 240000);

test('active trusted transitions do not invalidate old intervals or fabricate organic results', async () => {
  const sampler = await chain(60000);
  await db.query('INSERT INTO activity_log(id,text,created_at,updated_at) VALUES ($1,$2,$3,$3)',
    ['private-source', 'private seller text', new Date(wall).toISOString()]);
  const record = () => withRuntimeEvidenceContext('operator_chat', () => recordRuntimeSourceEvidence({
    pool, secret, revision, sourceKind: 'runtime_archive', sourceId: 'private-source', now: () => wall,
  }));
  advance();
  assert.equal((await record()).verified, true);
  assert.equal((await sampler.sample()).verified, true);
  advance();
  await db.query("UPDATE activity_log SET text='new private text',updated_at=$1", [new Date(wall).toISOString()]);
  assert.equal((await record()).verified, true);
  assert.equal((await sampler.sample()).verified, true);
  const result = await read();
  assert.equal(result.result, 'coverage_window_incomplete', 'old bindings must survive legitimate new transitions');
  assert.equal(JSON.stringify(result).includes('private seller'), false);
});

test.each(['gap', 'restart', 'revision', 'wall', 'monotonic', 'database'])('%s breaks the forward segment', async mode => {
  let sampler = await chain(60000);
  const before = sampler.status().segmentRef;
  advance(mode === 'gap' ? 90001 : ['restart', 'revision'].includes(mode) ? 120001 : 60000);
  if (mode === 'restart') sampler = makeSampler({ bootId: 'replacement-boot' });
  if (mode === 'revision') sampler = makeSampler({ revision: 'b'.repeat(40), bootId: 'replacement-boot' });
  if (mode === 'wall') wall += 5000;
  if (mode === 'monotonic') mono += 5000;
  if (mode === 'database') dbOffset = 5000;
  const result = await sampler.sample();
  if (['wall', 'monotonic', 'database'].includes(mode)) assert.equal(result.verified, false);
  else {
    assert.equal(result.verified, true);
    assert.notEqual(sampler.status().segmentRef, before);
  }
  assert.equal((await read()).verified, false);
});

test.each(['deleted', 'tampered', 'duplicate', 'control', 'pending', 'failed', 'oversized'])('latest %s evidence blocks proof', async mode => {
  const sampler = await chain(60000);
  if (mode === 'deleted') await db.exec("DELETE FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1' AND report->>'sequence'='1'");
  if (mode === 'tampered') await db.exec("UPDATE pbk_eval_runs SET report=report || '{\"sequence\":99}'::jsonb WHERE suite_name='runtime_coverage_v1'");
  if (mode === 'duplicate') await db.exec("INSERT INTO pbk_eval_runs SELECT id || '-duplicate',tenant_id,suite_name,ok,total,passed,failed,report,source,created_at FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1' LIMIT 1");
  if (mode === 'control') await db.exec("DELETE FROM pbk_eval_runs WHERE suite_name='runtime_coverage_control_v1'");
  if (mode === 'pending' || mode === 'failed') {
    advance(); fail = text => text.includes(mode === 'pending' ? 'FROM public.activity_log' : 'INSERT INTO public.pbk_eval_runs') &&
      (mode === 'pending' || text.includes('coverage-checkpoint'));
    assert.equal((await sampler.sample()).verified, false); fail = null;
  }
  if (mode === 'oversized') await db.exec("UPDATE pbk_eval_runs SET report=report || jsonb_build_object('extra',repeat('x',8193)) WHERE suite_name='runtime_coverage_v1'");
  assert.equal((await read()).verified, false);
});

test('competing replica cannot append, lease expiry transfers generation and stale owner cannot continue', async () => {
  const first = await chain(60000), second = makeSampler({ bootId: 'replica-b' });
  const n = (await db.query("SELECT count(*) FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].count;
  assert.equal((await second.sample()).result, 'coverage_lease_busy');
  assert.equal((await db.query("SELECT count(*) FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].count, n);
  advance(120001);
  assert.equal((await second.sample()).verified, true);
  assert.equal((await first.sample()).result, 'coverage_lease_busy');
  assert.equal((await read()).verified, false);
});

test('source failure leaves durable pending control and source admission, never a late checkpoint commit', async () => {
  const sampler = await chain(60000);
  advance(); statements = []; fail = text => text.includes('FROM public.activity_log');
  assert.equal((await sampler.sample()).verified, false);
  fail = null;
  const control = (await db.query("SELECT report FROM pbk_eval_runs WHERE suite_name='runtime_coverage_control_v1'")).rows[0].report;
  assert.equal(control.phase, 'pending');
  assert.equal(statements.filter(s => s.text === 'COMMIT').length, 2, 'only coverage admission and source admission commit');
  advance(16000);
  const recovered = await sampler.sample();
  assert.equal(recovered.verified, true);
  assert.equal(recovered.report.previous, null);
  assert.equal(recovered.report.intervalStart, recovered.report.cutoff);
  assert.equal(recovered.report.source.coverage.continuous, false);
  assert.equal(recovered.report.source.sources.every(s => s.counts.failed === 0), true);
  assert.equal((await read()).verified, false);
  assert.equal(releases.every(value => typeof value === 'boolean'), true);
});

test('mutating a returned receipt cannot change the samplers private next-interval start', async () => {
  const sampler = makeSampler();
  const first = await sampler.sample();
  assert.equal(first.verified, true);
  first.report.cutoff = new Date(wall - 30000).toISOString();
  first.report.dbObservedAt = first.report.cutoff;
  first.report.monotonicAt -= 30000;
  advance();
  const second = await sampler.sample();
  assert.equal(second.verified, true);
  assert.equal(second.report.intervalStart, new Date(START).toISOString());
});

test('coverage census rejects row and byte overflow before loading checkpoints or scanning sources', async () => {
  await chain(60000);
  await db.exec(`INSERT INTO pbk_eval_runs(id,tenant_id,suite_name,ok,total,passed,failed,report,source,created_at)
    SELECT 'junk-' || n,'pbk','runtime_coverage_v1',false,0,0,0,'{}','server:runtime-coverage:v1',
      '${new Date(START).toISOString()}'::timestamptz FROM generate_series(1,2001) n`);
  statements = [];
  assert.equal((await read()).result, 'coverage_census_unverified');
  assert.equal(statements.some(s => s.text.includes('FROM public.activity_log')), false);
  await db.exec("DELETE FROM pbk_eval_runs WHERE id LIKE 'junk-%'");
  await db.exec("UPDATE pbk_eval_runs SET report=jsonb_build_object('large',repeat('x',16777217)) WHERE suite_name='runtime_coverage_v1'");
  assert.equal((await read()).result, 'coverage_census_unverified');
}, 30000);

test('an unhealthy internal observation persists pending denial without source work or raw error text', async () => {
  let healthy = true;
  const sampler = makeSampler({ health: () => ({ ...health(), eventBusConnected: healthy }) });
  assert.equal((await sampler.sample()).verified, true);
  healthy = false; advance(); statements = [];
  assert.equal((await sampler.sample()).result, 'coverage_health_unready');
  assert.equal(statements.some(s => s.text.includes('FROM public.activity_log')), false);
  const control = (await db.query("SELECT report FROM pbk_eval_runs WHERE suite_name='runtime_coverage_control_v1'")).rows[0].report;
  assert.equal(control.phase, 'pending');
  assert.equal((await read()).result, 'coverage_latest_unverified');
});

test('wall-clock jumps during source collection poison the shared fence before checkpoint writes', async () => {
  let jumped = false;
  fail = text => {
    if (!jumped && text.includes('SELECT to_jsonb(p)') && text.includes('FROM public.activity_log')) {
      jumped = true; wall += 5000;
    }
    return false;
  };
  const result = await makeSampler().sample();
  assert.equal(result.verified, false);
  assert.equal(statements.some(s => s.text.includes('coverage-checkpoint')), false);
  assert.equal(JSON.stringify(result).includes('private database failure'), false);
});

test.each(['write', 'readback', 'commit'])('failed checkpoint %s cannot settle durable admission', async mode => {
  let commits = 0;
  fail = (text, values) => mode === 'write' ? text.includes('coverage-checkpoint')
    : mode === 'readback' ? text.includes('WHERE id=$1') && values?.[0]?.startsWith('runtime-coverage-') && !values[0].includes('control')
      : text === 'COMMIT' && ++commits === 3;
  assert.equal((await makeSampler().sample()).verified, false);
  fail = null;
  assert.equal((await db.query("SELECT count(*) FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].count, 0);
  const control = (await db.query("SELECT report FROM pbk_eval_runs WHERE suite_name='runtime_coverage_control_v1'")).rows[0].report;
  assert.equal(control.phase, 'pending');
  assert.equal((await read()).result, 'coverage_latest_unverified');
});

test('a moving server clock establishes the first anchor after source admission, not before it', async () => {
  const sampler = makeSampler({ now: () => wall++ });
  const first = await sampler.sample();
  assert.equal(first.verified, true, JSON.stringify(first));
  assert.equal(first.report.intervalStart, first.report.cutoff);
  assert.ok(Date.parse(first.report.cutoff) >= Date.parse(first.report.source.coverage.forwardOnlyFrom));
  advance();
  const second = await sampler.sample({ cutoff: wall - 2 });
  assert.equal(second.verified, true, JSON.stringify(second));
  assert.equal(second.report.intervalStart, first.report.cutoff);
});

test('an audit cutoff cannot disguise an actual observation gap longer than 90 seconds', async () => {
  const sampler = makeSampler();
  assert.equal((await sampler.sample()).verified, true);
  advance(100000);
  const result = await sampler.sample({ cutoff: wall - 15000 });
  assert.equal(result.verified, false);
  assert.equal((await db.query("SELECT count(*) FROM pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].count, 1);
});
