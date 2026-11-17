import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, jest, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';

const END = '2026-11-16T12:00:00.000Z';
const START = '2026-11-15T12:00:00.000Z';
const NOW = Date.parse(END);
const IDS = ['runtime_archive', 'provider_dispatch', 'dead_letters', 'conversation_projection',
  'safety_qa', 'database_security', 'runtime_health', 'monitoring_continuity'];
const HEALTH = Object.freeze({ authenticationConfigured: true, approvalMode: 'approval',
  bootstrapReady: true, archiveReady: true, providerCircuitsReady: true,
  observabilityReady: true, eventBusConnected: true });
const TABLES = ['activity_log', 'provider_action_dispatches', 'event_dead_letters',
  'conversation_events', 'approvals', 'pbk_qa_audit', 'pbk_safety_audit', 'bridge_state',
  'lead_profiles', 'lead_imports', 'calls', 'contracts', 'unified_messages', 'pbk_memories',
  'pbk_knowledge', 'pbk_feedback', 'pbk_intent_events', 'pbk_local_commands', 'pbk_eval_runs',
  'conversation_threads', 'conversation_thread_identities', 'communication_sender_identities'];
let db;
let module;
let queries;
let releases;

// A single disposable PG engine executes the actual aggregates, never a live database.
beforeAll(async () => {
  module = await import('./operational-audit-collector.mjs').catch(error => {
    if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) return {};
    throw error;
  });
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE activity_log(id text, workspace_id text DEFAULT 'pbk', source text,
      status text, metadata jsonb DEFAULT '{}', created_at timestamptz);
    CREATE TABLE provider_action_dispatches(approval_id text PRIMARY KEY,
      workspace_id text DEFAULT 'pbk', tool_name text DEFAULT 'sendSms', status text,
      dispatch_started_at timestamptz, completed_at timestamptz,
      reconciliation_required_at timestamptz, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE event_dead_letters(id text, tenant_id text DEFAULT 'pbk', source text,
      payload jsonb DEFAULT '{}', error text DEFAULT '', created_at timestamptz);
    CREATE TABLE conversation_events(id text, workspace_id text DEFAULT 'pbk',
      source_table text, source_id text, event_type text, payload jsonb DEFAULT '{}',
      occurred_at timestamptz, created_at timestamptz);
    CREATE TABLE approvals(id text, workspace_id text DEFAULT 'pbk', lead_id text,
      payload jsonb DEFAULT '{}', created_at timestamptz, updated_at timestamptz);
    CREATE TABLE pbk_qa_audit(id text, tenant_id text DEFAULT 'pbk', source text,
      passed boolean, skipped boolean, params jsonb DEFAULT '{}', result jsonb DEFAULT '{}',
      created_at timestamptz);
    CREATE TABLE pbk_safety_audit(id text, tenant_id text DEFAULT 'pbk', source text,
      blocked boolean, approval_required boolean, params jsonb DEFAULT '{}',
      validation jsonb DEFAULT '{}', created_at timestamptz);
  `);
  for (const name of TABLES.slice(7)) await db.exec(`CREATE TABLE public.${name}(id text)`);
  for (const name of TABLES) await db.exec(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY`);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`TRUNCATE ${TABLES.map(name => `public.${name}`).join(', ')}`);
  queries = [];
  releases = [];
});

function poolFor(intercept) {
  return { async connect() {
    return { async query(config) {
      const text = typeof config === 'string' ? config : config.text;
      const values = typeof config === 'string' ? [] : config.values || [];
      queries.push({ text, values, timeout: config.query_timeout });
      const intercepted = await intercept?.(text, values);
      return intercepted ?? db.query(text, values);
    }, release(destroy) { releases.push(Boolean(destroy)); } };
  } };
}
async function collect(options = {}) {
  assert.equal(typeof module.collectOperationalAudit, 'function', 'Task 1 collector is not implemented');
  return module.collectOperationalAudit({ pool: poolFor(), now: NOW, runtime: HEALTH, ...options });
}
function check(report, id) { return report.checks.find(item => item.id === id); }
async function dispatch(id, status, at, workspace = 'pbk') {
  await db.query(`INSERT INTO provider_action_dispatches
    (approval_id,status,dispatch_started_at,completed_at,created_at,updated_at,workspace_id)
    VALUES ($1,$2,$3,CASE WHEN $2='completed' THEN $3::timestamptz END,$3,$3,$4)`,
  [id, status, at, workspace]);
}

test('exports frozen check IDs consumed by the signed store, in stable order', async () => {
  assert.deepEqual(module.OPERATIONAL_AUDIT_CHECK_IDS, IDS);
  assert(Object.isFrozen(module.OPERATIONAL_AUDIT_CHECK_IDS));
  const report = await collect();
  assert.deepEqual(report.checks.map(item => item.id), IDS);
});

test('trusted clock fixes exactly 24 hours; caller windows, reports and overrides are ignored', async () => {
  const report = await collect({ windowStart: '1900-01-01', windowEnd: '2999-01-01',
    reports: IDS.map(id => ({ id, status: 'passed' })), overrides: { coverage: true } });
  assert.equal(report.windowStart, START);
  assert.equal(report.windowEnd, END);
  assert.deepEqual(report.coverage, { verified: false });
  const dbQueries = queries.filter(item => /operational_audit:/.test(item.text));
  assert.equal(dbQueries.length, 6);
  for (const query of dbQueries.filter(item => !/database_security/.test(item.text))) {
    assert.deepEqual(query.values, [START, END]);
  }
});

test('empty durable sources and healthy zero SLO/archive counters never establish coverage', async () => {
  const report = await collect({ runtime: { ...HEALTH, archiveCount: 0, sloCount: 0 } });
  for (const id of IDS.slice(0, 5)) {
    assert.equal(check(report, id).status, 'unverified', id);
    assert.equal(check(report, id).reason, 'no_observations', id);
    assert.equal(check(report, id).firstObservedAt, null);
    assert.equal(check(report, id).lastObservedAt, null);
  }
  assert.equal(check(report, 'database_security').status, 'passed');
  assert.equal(check(report, 'runtime_health').status, 'passed');
  assert.equal(check(report, 'monitoring_continuity').status, 'unverified');
  assert.equal(check(report, 'monitoring_continuity').reason, 'authoritative_source_unavailable');
  assert.equal(report.coverage.verified, false);
});

test('runtime archive uses only PBK runtime-event activity_log and inclusive clock boundaries', async () => {
  await db.query(`INSERT INTO activity_log(id,workspace_id,source,status,created_at) VALUES
    ('start','pbk','runtime-event:pbk','success',$1),
    ('end','pbk','runtime-event:pbk','error',$2),
    ('old','pbk','runtime-event:pbk','error',$1::timestamptz - interval '1 millisecond'),
    ('other','other','runtime-event:pbk','error',$2),
    ('not-runtime','pbk','runtime','error',$2)`, [START, END]);
  const result = check(await collect(), 'runtime_archive');
  assert.equal(result.status, 'failed');
  assert.equal(result.counts.observations, 2);
  assert.equal(result.counts.errors, 1);
  assert.equal(result.firstObservedAt, START);
  assert.equal(result.lastObservedAt, END);
});

test('old unresolved dispatches cannot age out, unknown statuses cannot pass, other tenants cannot fail PBK', async () => {
  await dispatch('old-dispatch', 'dispatching', '2026-01-01T00:00:00Z');
  await dispatch('old-reconcile', 'reconciliation_required', '2026-01-01T00:00:00Z');
  await dispatch('old-unknown', 'unexpected', '2026-01-01T00:00:00Z');
  await dispatch('recent', 'completed', END);
  await dispatch('other', 'reconciliation_required', END, 'other');
  const result = check(await collect(), 'provider_dispatch');
  assert.equal(result.status, 'failed');
  assert.equal(result.counts.observations, 1);
  assert.equal(result.counts.dispatching, 1);
  assert.equal(result.counts.reconciliationRequired, 1);
  assert.equal(result.counts.unknownStatuses, 1);
  assert.equal(result.counts.completed, 1);
  assert.equal(result.firstObservedAt, '2026-01-01T00:00:00.000Z');
});

test('unknown dispatch status alone fails even outside the observation window', async () => {
  await dispatch('unknown', 'mystery', '2026-01-01T00:00:00Z');
  assert.equal(check(await collect(), 'provider_dispatch').status, 'failed');
});

test('completed dispatch without a completion clock is explicitly unverified', async () => {
  await dispatch('incomplete-clock', 'completed', END);
  await db.query('UPDATE provider_action_dispatches SET completed_at = NULL WHERE approval_id = $1', ['incomplete-clock']);
  const result = check(await collect(), 'provider_dispatch');
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'invalid_timestamps');
  assert.equal(result.counts.missingTimestamps, 1);
  assert.equal(result.counts.observations, 1);
  assert.equal(result.firstObservedAt, END);
  assert.equal(result.lastObservedAt, END);
});

test.each([
  ['dispatching', 'dispatching'],
  ['reconciliation_required', 'reconciliationRequired'],
  ['unexpected', 'unknownStatuses'],
  [null, 'unknownStatuses'],
])('post-cutoff dispatches with status %s do not create findings; older unresolved rows still do', async (status, key) => {
  const clock = (await db.query('SELECT transaction_timestamp() AS at')).rows[0].at;
  const cutoffMs = new Date(clock).getTime() - 1000;
  const cutoff = new Date(cutoffMs).toISOString();
  await dispatch('before', 'completed', cutoff);
  await dispatch('after', status, clock);
  const result = check(await collect({ now: cutoffMs }), 'provider_dispatch');
  assert.equal(result.counts.dispatching, 0);
  assert.equal(result.counts.reconciliationRequired, 0);
  assert.equal(result.counts.unknownStatuses, 0);
  assert.equal(result.counts.futureTimestamps, 0);
  assert.equal(result.counts.observations, 1);
  assert.equal(result.counts.completed, 1);
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'contamination_unverified');
  assert.equal(result.firstObservedAt, cutoff);
  assert.equal(result.lastObservedAt, cutoff);

  const older = new Date(cutoffMs - 86400001).toISOString();
  await dispatch('older', status, older);
  const backlog = check(await collect({ now: cutoffMs }), 'provider_dispatch');
  assert.equal(backlog.status, 'failed');
  assert.equal(backlog.reason, 'findings_detected');
  assert.equal(backlog.counts[key], 1);
  assert.equal(backlog.counts.observations, 1);
  assert.equal(backlog.firstObservedAt, older);
  assert.equal(backlog.lastObservedAt, cutoff);
});

test('dead letters retain old PBK failures because the schema has no resolved flag', async () => {
  await db.query(`INSERT INTO event_dead_letters(id,tenant_id,created_at) VALUES
    ('old','pbk','2026-01-01'),('other','other',$1)`, [END]);
  const result = check(await collect(), 'dead_letters');
  assert.equal(result.status, 'failed');
  assert.equal(result.counts.outstanding, 1);
});

test('projection links dispatch approval_id to approvals source_id, not invented dispatch IDs', async () => {
  await dispatch('linked', 'completed', END);
  await dispatch('missing', 'completed', END);
  await dispatch('no-seller', 'completed', END);
  await db.query(`INSERT INTO approvals(id,lead_id,created_at) VALUES
    ('linked','seller',$1),('missing','seller',$1),('no-seller',NULL,$1)`, [END]);
  await db.query(`INSERT INTO conversation_events
    (id,workspace_id,source_table,source_id,event_type,occurred_at,created_at) VALUES
    ('valid','pbk','approvals','linked','approval.decided',$1,$1),
    ('wrong-source','pbk','provider_action_dispatches','missing','approval.decided',$1,$1),
    ('wrong-tenant','other','approvals','missing','approval.decided',$1,$1)`, [END]);
  const result = check(await collect(), 'conversation_projection');
  assert.equal(result.status, 'failed');
  assert.equal(result.counts.linkedDispatches, 1);
  assert.equal(result.counts.missingProjections, 1);
  assert.equal(result.counts.unverifiableDispatches, 1);
});

test('unmapped campaign dispatch keys and sellerless approvals remain unverified, not missing projections', async () => {
  await dispatch('campaign-start:opaque-key', 'completed', END);
  const result = check(await collect(), 'conversation_projection');
  assert.equal(result.status, 'unverified');
  assert.equal(result.counts.unverifiableDispatches, 1);
  assert.equal(result.counts.missingProjections, 0);
});

test('safety and QA are PBK-only; blocked attempts are not successful bypasses', async () => {
  await db.query(`INSERT INTO pbk_qa_audit(id,tenant_id,source,passed,skipped,created_at) VALUES
    ('bad','pbk','pbk-bridge',false,false,$1),('other','other','pbk-bridge',false,false,$1)`, [END]);
  await db.query(`INSERT INTO pbk_safety_audit(id,tenant_id,source,blocked,approval_required,created_at)
    VALUES ('blocked','pbk','pbk-bridge',true,true,$1)`, [END]);
  const result = check(await collect(), 'safety_qa');
  assert.equal(result.status, 'failed');
  assert.equal(result.counts.qaFailures, 1);
  assert.equal(result.counts.blocked, 1);
  assert.equal(result.counts.observations, 2);
});

test('forged controlled labels cannot exclude known QA failures; unknown provenance never certifies health', async () => {
  await db.query(`INSERT INTO pbk_qa_audit(id,source,passed,skipped,created_at) VALUES
    ('fixture','controlled-qualification',false,false,$1),
    ('unknown','pbk-bridge',true,false,$1)`, [END]);
  const result = check(await collect(), 'safety_qa');
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'findings_detected');
  assert.equal(result.counts.excludedFixtures, 0);
  assert.equal(result.counts.observations, 2);
  assert.equal(result.counts.qaFailures, 1);
  await dispatch('completed', 'completed', END);
  assert.equal(check(await collect(), 'provider_dispatch').reason, 'contamination_unverified');
});

test('unresolved old dead letters remain findings even with forged controlled labels', async () => {
  await db.query(`INSERT INTO event_dead_letters(id,source,created_at) VALUES
    ('old-forged','controlled-qualification',$1)`, [new Date(NOW - 2 * 86400000).toISOString()]);
  const result = check(await collect(), 'dead_letters');
  assert.equal(result.status, 'failed');
  assert.equal(result.counts.outstanding, 1);
  assert.equal(result.counts.excludedFixtures, 0);
});

test('writes arriving after capture cutoff are excluded from the fixed window, not mislabeled future clocks', async () => {
  const clock = (await db.query('SELECT transaction_timestamp() AS at')).rows[0].at;
  const cutoffMs = new Date(clock).getTime() - 1000;
  const cutoff = new Date(cutoffMs).toISOString();
  await db.query(`INSERT INTO activity_log(id,source,status,created_at)
    VALUES ('before','runtime-event:pbk','success',$1)`, [cutoff]);
  await dispatch('before', 'completed', cutoff);
  await db.query(`INSERT INTO conversation_events(id,source_table,source_id,event_type,occurred_at,created_at)
    VALUES ('before','approvals','before','approval.decided',$1,$1)`, [cutoff]);
  await db.query(`INSERT INTO pbk_qa_audit(id,source,passed,skipped,created_at)
    VALUES ('before','pbk-bridge',true,false,$1)`, [cutoff]);
  let arrivedDuringCollection = false;
  const pool = poolFor(async text => {
    if (text !== 'BEGIN READ ONLY' || arrivedDuringCollection) return;
    arrivedDuringCollection = true;
    // An independent writer commits after capture, before the first audit read transaction.
    await db.exec(`
      INSERT INTO activity_log(id,source,status,created_at)
        VALUES ('after','runtime-event:pbk','error',transaction_timestamp());
      INSERT INTO provider_action_dispatches
        (approval_id,status,dispatch_started_at,completed_at,created_at,updated_at)
        VALUES ('after','completed',transaction_timestamp(),transaction_timestamp(),transaction_timestamp(),transaction_timestamp());
      INSERT INTO event_dead_letters(id,created_at) VALUES ('after',transaction_timestamp());
      INSERT INTO conversation_events(id,source_table,source_id,event_type,occurred_at,created_at)
        VALUES ('after','approvals','after','approval.decided',transaction_timestamp(),transaction_timestamp());
      INSERT INTO pbk_qa_audit(id,source,passed,skipped,created_at)
        VALUES ('after','pbk-bridge',false,false,transaction_timestamp());
      INSERT INTO pbk_safety_audit(id,source,blocked,approval_required,created_at)
        VALUES ('after','pbk-bridge',true,true,transaction_timestamp());
    `);
  });
  const report = await collect({ now: cutoffMs, pool });
  assert(arrivedDuringCollection);
  assert.equal(report.windowEnd, cutoff);
  assert.equal(new Date(report.windowStart).getTime(), cutoffMs - 86400000);
  for (const id of IDS.slice(0, 5)) {
    const result = check(report, id);
    assert.equal(result.counts.futureTimestamps, 0, id);
    assert.notEqual(result.reason, 'invalid_timestamps', id);
    assert(result.lastObservedAt === null || result.lastObservedAt <= cutoff, id);
  }
  assert.equal(check(report, 'runtime_archive').counts.observations, 1);
  assert.equal(check(report, 'runtime_archive').counts.errors, 0);
  assert.equal(check(report, 'provider_dispatch').counts.observations, 1);
  assert.equal(check(report, 'provider_dispatch').counts.completed, 1);
  assert.equal(check(report, 'dead_letters').counts.observations, 0);
  assert.equal(check(report, 'dead_letters').counts.outstanding, 0);
  assert.equal(check(report, 'conversation_projection').counts.observations, 2);
  assert.equal(check(report, 'safety_qa').counts.observations, 1);
  assert.equal(check(report, 'safety_qa').counts.qaFailures, 0);
});

test.each(['runtime_archive', 'provider_dispatch', 'conversation_projection'])(
  'writer timestamp after BEGIN but before the SQL read clock is not future: %s', async id => {
    const clock = (await db.query(`SELECT clock_timestamp() AS cutoff,
      clock_timestamp() + interval '1 second' AS arrival`)).rows[0];
    if (id === 'runtime_archive') {
      await db.query(`INSERT INTO activity_log(id,source,status,created_at)
        VALUES ('after-begin','runtime-event:pbk','success',$1)`, [clock.arrival]);
    } else {
      await dispatch('after-begin', 'completed', clock.arrival);
    }
    let checkedAfterBegin = false;
    const pool = poolFor(async text => {
      if (!text.includes(`operational_audit:${id}`)) return;
      // Pre-seeding models a concurrent writer in the single-session engine. Delay the
      // real SQL read after BEGIN, and prove the fixture lies between these two clocks.
      const began = (await db.query('SELECT transaction_timestamp() < $1::timestamptz AS before_arrival',
        [clock.arrival])).rows[0];
      assert.equal(began.before_arrival, true);
      await db.query('SELECT pg_sleep(1)');
      const read = (await db.query('SELECT clock_timestamp() >= $1::timestamptz AS after_arrival',
        [clock.arrival])).rows[0];
      assert.equal(read.after_arrival, true);
      checkedAfterBegin = true;
    });
    const report = await collect({ pool, now: new Date(clock.cutoff).getTime() });
    assert(checkedAfterBegin);
    const result = check(report, id);
    assert.equal(result.counts.futureTimestamps, 0);
    assert.equal(result.counts.observations, 0);
    assert.equal(result.reason, 'no_observations');
    assert.equal(result.firstObservedAt, null);
    assert.equal(result.lastObservedAt, null);
    assert.equal(report.windowEnd, new Date(clock.cutoff).toISOString());
  });

test('timestamps beyond the database read clock and missing source clocks remain unverified', async () => {
  const clock = (await db.query(`SELECT transaction_timestamp() AS at,
    transaction_timestamp() + interval '1 day' AS future`)).rows[0];
  await db.query(`INSERT INTO activity_log(id,source,status,created_at) VALUES
    ('future','runtime-event:pbk','success',$1),
    ('missing','runtime-event:pbk','success',NULL)`, [clock.future]);
  const result = check(await collect({ now: new Date(clock.at).getTime() }), 'runtime_archive');
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'invalid_timestamps');
  assert.equal(result.counts.observations, 0);
  assert.equal(result.counts.futureTimestamps, 1);
  assert.equal(result.counts.missingTimestamps, 1);
  assert.equal(result.lastObservedAt, null);
  await dispatch('future', 'dispatching', clock.future);
  const provider = check(await collect({ now: new Date(clock.at).getTime() }), 'provider_dispatch');
  assert.equal(provider.status, 'unverified');
  assert.equal(provider.reason, 'invalid_timestamps');
  assert.equal(provider.counts.futureTimestamps, 1);
  assert.equal(provider.counts.dispatching, 0);
  assert.equal(provider.counts.observations, 0);
  assert.equal(provider.firstObservedAt, null);
  assert.equal(provider.lastObservedAt, null);
});

test('each missing table fails closed without aborting later independent checks', async () => {
  const pool = poolFor(text => {
    if (/operational_audit:(runtime_archive|safety_qa)/.test(text)) {
      throw Object.assign(new Error('private SQL contact secret'), { code: '42P01' });
    }
  });
  const report = await collect({ pool });
  assert.equal(report.checks.length, 8);
  assert.equal(check(report, 'runtime_archive').reason, 'source_unavailable');
  assert.equal(check(report, 'safety_qa').reason, 'source_unavailable');
  assert.equal(check(report, 'database_security').status, 'passed');
  assert.equal(releases.length, 6);
  assert.equal(queries.filter(q => q.text === 'ROLLBACK').length, 6);
  assert(!JSON.stringify(report).includes('private'));
});

test('real missing source tables and SQL errors are unverified rather than zero passes', async () => {
  await db.exec('ALTER TABLE public.pbk_safety_audit RENAME TO missing_safety');
  try {
    const report = await collect();
    assert.equal(check(report, 'safety_qa').reason, 'source_unavailable');
    assert.equal(check(report, 'database_security').status, 'unverified');
  } finally { await db.exec('ALTER TABLE public.missing_safety RENAME TO pbk_safety_audit'); }
});

test('database security detects disabled RLS and PUBLIC, anon, authenticated and column grants', async () => {
  for (const grant of ['GRANT SELECT ON public.activity_log TO PUBLIC',
    'GRANT SELECT ON public.activity_log TO anon',
    'GRANT SELECT(id) ON public.activity_log TO authenticated']) {
    await db.exec(grant);
    assert.equal(check(await collect(), 'database_security').status, 'failed', grant);
    await db.exec('REVOKE ALL ON public.activity_log FROM PUBLIC, anon, authenticated');
    await db.exec('REVOKE SELECT(id) ON public.activity_log FROM authenticated');
  }
  await db.exec('ALTER TABLE public.activity_log DISABLE ROW LEVEL SECURITY');
  try { assert.equal(check(await collect(), 'database_security').status, 'failed'); }
  finally { await db.exec('ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY'); }
});

test('health accepts only the exact internal booleans and approval mode; absent means unverified', async () => {
  assert.equal(check(await collect(), 'runtime_health').status, 'passed');
  for (const key of Object.keys(HEALTH).filter(key => key !== 'approvalMode')) {
    assert.equal(check(await collect({ runtime: { ...HEALTH, [key]: false } }), 'runtime_health').status, 'failed');
    assert.equal(check(await collect({ runtime: { ...HEALTH, [key]: 'true' } }), 'runtime_health').status, 'unverified');
    const missing = { ...HEALTH };
    delete missing[key];
    assert.equal(check(await collect({ runtime: missing }), 'runtime_health').status, 'unverified');
  }
  assert.equal(check(await collect({ runtime: {} }), 'runtime_health').status, 'unverified');
  assert.equal(check(await collect({ runtime: { ...HEALTH, approvalMode: 'autonomous' } }), 'runtime_health').status, 'failed');
});

test('query failures, unexpected rows and unsafe counts cannot leak payloads or impersonate passes', async () => {
  for (const unsafe of ['9007199254740992', '-1', '1.5', 'NaN', null, true, 'contact@example.invalid']) {
    const report = await collect({ pool: poolFor(text => {
      if (text.includes('operational_audit:runtime_archive')) return { rows: [{ observations: unsafe,
        errors: '0', warnings: '0', excludedFixtures: '0', futureTimestamps: '0', missingTimestamps: '0',
        firstObservedAt: END, lastObservedAt: END, payload: 'private payload' }] };
    }) });
    const result = check(report, 'runtime_archive');
    assert.equal(result.status, 'unverified');
    assert.equal(result.reason, 'invalid_aggregate');
    assert.deepEqual(result.counts, {});
    assert(!JSON.stringify(report).includes('private'));
    assert(!JSON.stringify(report).includes('contact@'));
  }
  const report = await collect({ pool: poolFor(text => {
    if (text.includes('operational_audit:runtime_archive')) return { rows: [] };
    if (text.includes('operational_audit:dead_letters')) throw new Error('raw SQL and seller contact');
  }) });
  assert.equal(check(report, 'runtime_archive').reason, 'invalid_aggregate');
  assert.equal(check(report, 'dead_letters').reason, 'query_failed');
  assert(!JSON.stringify(report).includes('seller'));
});

test('all output is an allowlisted aggregate shape, with safe integers and normalized times only', async () => {
  const report = await collect();
  assert.deepEqual(Object.keys(report).sort(), ['checks', 'coverage', 'windowEnd', 'windowStart']);
  for (const item of report.checks) {
    assert.deepEqual(Object.keys(item).sort(), ['counts', 'firstObservedAt', 'id', 'lastObservedAt', 'reason', 'status']);
    assert.match(item.reason, /^[a-z_]+$/);
    assert(['passed', 'failed', 'unverified'].includes(item.status));
    for (const value of Object.values(item.counts)) assert(Number.isSafeInteger(value) && value >= 0);
    for (const at of [item.firstObservedAt, item.lastObservedAt]) {
      assert(at === null || new Date(at).toISOString() === at);
    }
  }
});

test('collector performs only bounded SELECTs inside read-only transactions, always rolls back/releases and has no provider path', async () => {
  let providerCalls = 0;
  await collect({ sendSms: () => { providerCalls++; }, runtime: { ...HEALTH,
    provider: () => { providerCalls++; } } });
  assert.equal(providerCalls, 0);
  assert.equal(releases.length, 6);
  assert.equal(queries.filter(q => q.text === 'BEGIN READ ONLY').length, 6);
  assert.equal(queries.filter(q => q.text === 'ROLLBACK').length, 6);
  for (const q of queries) {
    assert(/^(?:BEGIN READ ONLY$|ROLLBACK$|SET LOCAL (statement_timeout|lock_timeout|idle_in_transaction_session_timeout) = |(?:SELECT|WITH)\b)/.test(q.text.trim()));
    assert(Number.isSafeInteger(q.timeout) && q.timeout > 0 && q.timeout <= 2000);
    assert(!/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMIT|NOTIFY|CALL)\b/.test(q.text));
  }
  assert(queries.some(q => /SET LOCAL statement_timeout/.test(q.text)));
});

test('connection and rollback errors are sanitized and connections are discarded', async () => {
  let connects = 0;
  const pool = { async connect() {
    if (++connects === 1) throw new Error('secret connection string');
    return { async query(config) {
      if (config.text === 'ROLLBACK') throw new Error('secret rollback');
      return db.query(config.text, config.values || []);
    }, release(destroy) { releases.push(Boolean(destroy)); } };
  } };
  const report = await collect({ pool });
  // A pg pool destroys this connection; the shared disposable engine needs explicit cleanup.
  await db.exec('ROLLBACK');
  assert(report.checks.slice(0, 6).every(item => item.status === 'unverified'));
  assert(releases.every(Boolean));
  assert.equal(releases.length, 5);
  assert(!JSON.stringify(report).includes('secret'));
});

test('no pool keeps all checks and does not fabricate database evidence', async () => {
  const report = await collect({ pool: null });
  assert.equal(report.checks.length, 8);
  assert(report.checks.slice(0, 6).every(item => item.status === 'unverified'));
  assert.deepEqual(report.coverage, { verified: false });
});

test('a working safety guard alone is not an unsafe execution finding', async () => {
  await db.query(`INSERT INTO pbk_safety_audit(id,source,blocked,approval_required,created_at)
    VALUES ('blocked-only','pbk-bridge',true,true,$1)`, [END]);
  const result = check(await collect(), 'safety_qa');
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'contamination_unverified');
  assert.equal(result.counts.blocked, 1);
  assert.equal(result.counts.qaFailures, 0);
});

test('stalled aggregate and rollback are bounded and the poisoned connection is released', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let connects = 0;
  let rollbackAttempted = false;
  let destroyed = false;
  const never = new Promise(() => {});
  try {
    const pool = { async connect() {
      if (++connects > 1) throw new Error('unavailable');
      return { query({ text }) {
        if (text === 'ROLLBACK') { rollbackAttempted = true; return never; }
        if (text.includes('operational_audit:')) return never;
        return Promise.resolve({ rows: [] });
      }, release(value) { destroyed = value === true; } };
    } };
    const pending = collect({ pool });
    await jest.advanceTimersByTimeAsync(2600);
    const report = await pending;
    assert.equal(check(report, 'runtime_archive').reason, 'query_failed');
    assert.equal(report.checks.length, 8);
    assert(rollbackAttempted);
    assert(destroyed);
    assert.equal(connects, 6);
  } finally { jest.useRealTimers(); }
});

test('checkout deadlines retain all checks and release clients which arrive after abandonment', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let connectCount = 0;
  let deliver;
  let lateReleased = false;
  try {
    const pool = { connect() {
      if (++connectCount > 1) return Promise.reject(new Error('unavailable'));
      return new Promise(resolve => { deliver = resolve; });
    } };
    const pending = collect({ pool });
    await jest.advanceTimersByTimeAsync(2100);
    const report = await pending;
    assert.equal(report.checks.length, 8);
    assert.equal(check(report, 'runtime_archive').status, 'unverified');
    deliver({ release(destroy) { lateReleased = destroy === true; } });
    await jest.advanceTimersByTimeAsync(0);
    assert(lateReleased);
  } finally { jest.useRealTimers(); }
});
