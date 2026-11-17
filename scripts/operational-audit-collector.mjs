import { readRuntimeCoverage } from './runtime-coverage-store.mjs';
import { operationalAuditSourceStatus } from './operational-audit-store.mjs';

export const OPERATIONAL_AUDIT_CHECK_IDS = Object.freeze([
  'runtime_archive', 'provider_dispatch', 'dead_letters', 'conversation_projection',
  'safety_qa', 'database_security', 'runtime_health', 'monitoring_continuity',
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const DEADLINE_MS = 15000;
const QUERY_MS = 2000;
const within = 'at BETWEEN $1::timestamptz AND $2::timestamptz';
const observed = `NOT fixture AND (${within})`;
// A concurrent write after capture is outside the window, not ahead of the DB read clock.
const bounds = `
  COUNT(*) FILTER (WHERE NOT fixture AND at > pg_catalog.clock_timestamp()) AS "futureTimestamps",
  COUNT(*) FILTER (WHERE NOT fixture AND at IS NULL) AS "missingTimestamps",
  COUNT(*) FILTER (WHERE fixture AND (${within})) AS "excludedFixtures"`;
const times = (predicate = observed) => `
  MIN(at) FILTER (WHERE ${predicate}) AS "firstObservedAt",
  MAX(at) FILTER (WHERE ${predicate}) AS "lastObservedAt"`;

// SQL is fixed at module initialization; only trusted server-clock bounds are parameters.
const SOURCES = Object.freeze([
  {
    id: 'runtime_archive',
    counts: ['observations', 'errors', 'warnings', 'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    failures: ['errors'],
    sql: `WITH evidence AS (
      SELECT created_at AS at, FALSE AS fixture,
        status = 'error' AS error, status = 'warning' AS warning
      FROM public.activity_log
      WHERE workspace_id = 'pbk' AND source LIKE 'runtime-event:%'
        AND (created_at >= $1::timestamptz OR created_at IS NULL)
    ) SELECT /* operational_audit:runtime_archive */
      COUNT(*) FILTER (WHERE ${observed}) AS observations,
      COUNT(*) FILTER (WHERE ${observed} AND error) AS errors,
      COUNT(*) FILTER (WHERE ${observed} AND warning) AS warnings,
      ${bounds}, ${times()} FROM evidence`,
  },
  {
    id: 'provider_dispatch',
    counts: ['observations', 'completed', 'dispatching', 'reconciliationRequired', 'unknownStatuses',
      'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    failures: ['dispatching', 'reconciliationRequired', 'unknownStatuses'],
    sql: `WITH evidence AS (
      SELECT GREATEST(created_at, updated_at, dispatch_started_at, completed_at,
        reconciliation_required_at) AS at, FALSE AS fixture, status,
        created_at IS NULL OR dispatch_started_at IS NULL OR updated_at IS NULL
          OR (status = 'completed' AND completed_at IS NULL) AS missing_clock
      FROM public.provider_action_dispatches WHERE workspace_id = 'pbk'
    ) SELECT /* operational_audit:provider_dispatch */
      COUNT(*) FILTER (WHERE ${within}) AS observations,
      COUNT(*) FILTER (WHERE (${within}) AND status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE at <= $2::timestamptz AND status = 'dispatching') AS dispatching,
      COUNT(*) FILTER (WHERE at <= $2::timestamptz AND status = 'reconciliation_required') AS "reconciliationRequired",
      COUNT(*) FILTER (WHERE at <= $2::timestamptz AND (status IS NULL OR status NOT IN
        ('dispatching', 'completed', 'reconciliation_required'))) AS "unknownStatuses",
      0 AS "excludedFixtures",
      COUNT(*) FILTER (WHERE at > pg_catalog.clock_timestamp()) AS "futureTimestamps",
      COUNT(*) FILTER (WHERE missing_clock AND (at >= $1::timestamptz OR at IS NULL
        OR status IS DISTINCT FROM 'completed')) AS "missingTimestamps",
      ${times(`at <= $2::timestamptz AND (at >= $1::timestamptz OR status IS DISTINCT FROM 'completed')`)}
      FROM evidence`,
  },
  {
    id: 'dead_letters',
    counts: ['observations', 'outstanding', 'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    failures: ['outstanding'],
    // There is no resolution column: old rows remain outstanding rather than aging into a pass.
    sql: `WITH evidence AS (
      SELECT created_at AS at, FALSE AS fixture
      FROM public.event_dead_letters WHERE tenant_id = 'pbk'
    ) SELECT /* operational_audit:dead_letters */
      COUNT(*) FILTER (WHERE ${observed}) AS observations,
      COUNT(*) FILTER (WHERE NOT fixture AND at <= $2::timestamptz) AS outstanding,
      ${bounds}, ${times('NOT fixture AND at <= $2::timestamptz')} FROM evidence`,
  },
  {
    id: 'conversation_projection',
    counts: ['observations', 'events', 'dispatches', 'linkedDispatches', 'missingProjections',
      'unverifiableDispatches', 'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    failures: ['missingProjections'],
    // The projector uses source_table='approvals', source_id=approval.id. Campaign composite
    // dispatch keys and approvals without seller identity cannot establish a missing projection.
    sql: `WITH events AS (
      SELECT occurred_at AS at FROM public.conversation_events
      WHERE workspace_id = 'pbk' AND (occurred_at >= $1::timestamptz OR occurred_at IS NULL)
    ), dispatches AS (
      SELECT GREATEST(d.created_at, d.updated_at, d.dispatch_started_at, d.completed_at) AS at,
        a.id IS NOT NULL AND NULLIF(a.lead_id, '') IS NOT NULL AS eligible,
        EXISTS (SELECT 1 FROM public.conversation_events e
          WHERE e.workspace_id = 'pbk' AND e.source_table = 'approvals'
            AND e.source_id = d.approval_id AND e.occurred_at <= $2::timestamptz
            AND e.event_type IN ('approval.created', 'approval.decided', 'system')) AS linked
      FROM public.provider_action_dispatches d
      LEFT JOIN public.approvals a ON a.id = d.approval_id AND a.workspace_id = 'pbk'
      WHERE d.workspace_id = 'pbk' AND d.status = 'completed'
    ), evidence AS (
      SELECT at FROM events UNION ALL SELECT at FROM dispatches
        WHERE at >= $1::timestamptz OR at IS NULL
    ) SELECT /* operational_audit:conversation_projection */
      COUNT(*) FILTER (WHERE ${within}) AS observations,
      (SELECT COUNT(*) FROM events WHERE ${within}) AS events,
      (SELECT COUNT(*) FROM dispatches WHERE ${within}) AS dispatches,
      (SELECT COUNT(*) FROM dispatches WHERE (${within}) AND eligible AND linked) AS "linkedDispatches",
      (SELECT COUNT(*) FROM dispatches WHERE (${within}) AND eligible AND NOT linked) AS "missingProjections",
      (SELECT COUNT(*) FROM dispatches WHERE (${within}) AND NOT eligible) AS "unverifiableDispatches",
      0 AS "excludedFixtures",
      COUNT(*) FILTER (WHERE at > pg_catalog.clock_timestamp()) AS "futureTimestamps",
      COUNT(*) FILTER (WHERE at IS NULL) AS "missingTimestamps",
      ${times(within)} FROM evidence`,
  },
  {
    id: 'safety_qa',
    counts: ['observations', 'qaObservations', 'safetyObservations', 'qaFailures', 'qaSkipped',
      'blocked', 'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    failures: ['qaFailures'],
    // blocked=true describes a working guard, not an unsafe execution. These tables do not
    // authoritatively link validation denial to an actually allowed provider execution.
    sql: `WITH evidence AS (
      SELECT created_at AS at, FALSE AS fixture,
        TRUE AS qa, NOT passed AND NOT skipped AS failure, skipped, FALSE AS blocked
      FROM public.pbk_qa_audit WHERE tenant_id = 'pbk'
        AND (created_at >= $1::timestamptz OR created_at IS NULL)
      UNION ALL
      SELECT created_at, FALSE,
        FALSE, FALSE, FALSE, blocked
      FROM public.pbk_safety_audit WHERE tenant_id = 'pbk'
        AND (created_at >= $1::timestamptz OR created_at IS NULL)
    ) SELECT /* operational_audit:safety_qa */
      COUNT(*) FILTER (WHERE ${observed}) AS observations,
      COUNT(*) FILTER (WHERE ${observed} AND qa) AS "qaObservations",
      COUNT(*) FILTER (WHERE ${observed} AND NOT qa) AS "safetyObservations",
      COUNT(*) FILTER (WHERE ${observed} AND failure) AS "qaFailures",
      COUNT(*) FILTER (WHERE ${observed} AND skipped) AS "qaSkipped",
      COUNT(*) FILTER (WHERE ${observed} AND blocked) AS blocked,
      ${bounds}, ${times()} FROM evidence`,
  },
  {
    id: 'database_security',
    counts: ['requiredTables', 'presentTables', 'missingTables', 'rlsDisabled', 'publicRoleGrants'],
    failures: ['rlsDisabled', 'publicRoleGrants'],
    sql: `WITH required(name) AS (VALUES
      ('activity_log'), ('provider_action_dispatches'), ('event_dead_letters'),
      ('conversation_events'), ('approvals'), ('pbk_qa_audit'), ('pbk_safety_audit'),
      ('bridge_state'), ('lead_profiles'), ('lead_imports'), ('calls'), ('contracts'),
      ('unified_messages'), ('pbk_memories'), ('pbk_knowledge'), ('pbk_feedback'),
      ('pbk_intent_events'), ('pbk_local_commands'), ('pbk_eval_runs'),
      ('conversation_threads'), ('conversation_thread_identities'), ('communication_sender_identities')
    ), tables AS (
      SELECT c.oid, c.relrowsecurity, c.relacl, c.relowner
      FROM required r LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
      LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = r.name
        AND c.relkind IN ('r', 'p')
    ) SELECT /* operational_audit:database_security */
      COUNT(*) AS "requiredTables", COUNT(oid) AS "presentTables",
      COUNT(*) FILTER (WHERE oid IS NULL) AS "missingTables",
      COUNT(*) FILTER (WHERE oid IS NOT NULL AND NOT relrowsecurity) AS "rlsDisabled",
      COUNT(*) FILTER (WHERE oid IS NOT NULL AND (
        EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(relacl,
          pg_catalog.acldefault('r', relowner))) acl WHERE acl.grantee = 0)
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a,
          LATERAL pg_catalog.aclexplode(a.attacl) acl
          WHERE a.attrelid = tables.oid AND a.attnum > 0 AND NOT a.attisdropped AND acl.grantee = 0)
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles role
          WHERE role.rolname IN ('anon', 'authenticated') AND (
            pg_catalog.has_table_privilege(role.oid, tables.oid,
              'select,insert,update,delete,truncate,references,trigger')
            OR pg_catalog.has_any_column_privilege(role.oid, tables.oid,
              'select,insert,update,references')))
      )) AS "publicRoleGrants",
      NULL::timestamptz AS "firstObservedAt", NULL::timestamptz AS "lastObservedAt"
      FROM tables`,
  },
]);

function result(id, status, reason, counts = {}, firstObservedAt = null, lastObservedAt = null) {
  return { id, status, reason, counts, firstObservedAt, lastObservedAt };
}

function safeCount(value) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function timestamp(value) {
  if (value === null) return null;
  if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]/.test(value))) {
    throw new Error('invalid_aggregate');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_aggregate');
  return date.toISOString();
}

function summarize(source, rows, windowEnd, coverage) {
  try {
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('invalid_aggregate');
    const row = rows[0];
    const counts = {};
    for (const key of source.counts) {
      const count = safeCount(row[key]);
      if (count === null) throw new Error('invalid_aggregate');
      counts[key] = count;
    }
    const first = timestamp(row.firstObservedAt);
    const last = timestamp(row.lastObservedAt);
    if ((first === null) !== (last === null) || (first !== null && (first > last || last > windowEnd))) {
      throw new Error('invalid_aggregate');
    }
    if (source.id !== 'database_security' && counts.observations > 0 && first === null) {
      throw new Error('invalid_aggregate');
    }
    const finish = (status, reason) => result(source.id, status, reason, counts, first, last);
    if (counts.futureTimestamps || counts.missingTimestamps) return finish('unverified', 'invalid_timestamps');
    if (source.failures.some(key => counts[key] > 0)) return finish('failed', 'findings_detected');
    // Monitoring provenance cannot establish approval/seller business linkage.
    if (source.id === 'conversation_projection' && counts.unverifiableDispatches > 0) {
      return finish('unverified', 'contamination_unverified');
    }
    if (source.id === 'database_security') {
      if (counts.missingTables || counts.requiredTables !== 22 || counts.presentTables !== 22) {
        return finish('unverified', 'source_unavailable');
      }
      return finish('passed', 'no_findings');
    }
    if (coverage?.verified) {
      const mapping = { runtime_archive: ['runtime_archive'], conversation_projection: ['conversation_projection'],
        safety_qa: ['qa', 'safety'] };
      const status = mapping[source.id] ? operationalAuditSourceStatus(coverage.sources, mapping[source.id]) : 'passed';
      return finish(status, status === 'passed' ? 'no_findings'
        : status === 'failed' ? 'findings_detected' : 'contamination_unverified');
    }
    if (counts.observations === 0) return finish('unverified', 'no_observations');
    // Existing sources cannot prove universal fixture exclusion or retrospective coverage.
    return finish('unverified', 'contamination_unverified');
  } catch {
    return result(source.id, 'unverified', 'invalid_aggregate');
  }
}

function timeoutError() { return Object.assign(new Error('audit_timeout'), { code: 'AUDIT_TIMEOUT' }); }

async function bounded(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError()), Math.max(1, milliseconds));
    })]);
  } finally { clearTimeout(timer); }
}

async function readSource(pool, source, values, deadline) {
  if (!pool || typeof pool.connect !== 'function' || pool.controlled === true) {
    return { reason: 'source_unavailable' };
  }
  let client;
  let abandoned = false;
  let destroy = false;
  let outcome;
  const remaining = () => Math.max(1, Math.min(QUERY_MS, Math.floor(deadline - performance.now())));
  try {
    if (performance.now() >= deadline) return { reason: 'query_failed' };
    // A late pool checkout must not leak a client after the acquisition deadline.
    const connection = Promise.resolve().then(() => pool.connect()).then(acquired => {
      if (abandoned) { acquired.release(true); return null; }
      return acquired;
    });
    try { client = await bounded(() => connection, remaining()); }
    catch (error) { abandoned = true; throw error; }
    const query = (text, params = []) => bounded(() => client.query({
      text, values: params, query_timeout: remaining(),
    }), remaining());
    await query('BEGIN READ ONLY');
    await query("SET LOCAL statement_timeout = '1500ms'");
    await query("SET LOCAL lock_timeout = '500ms'");
    await query("SET LOCAL idle_in_transaction_session_timeout = '3000ms'");
    outcome = { rows: (await query(source.sql, values)).rows };
  } catch (error) {
    destroy = true;
    const code = error?.code;
    outcome = { reason: ['42P01', '42703', '3F000'].includes(code) ? 'source_unavailable' : 'query_failed' };
  } finally {
    if (client) {
      try {
        await bounded(() => client.query({ text: 'ROLLBACK', values: [], query_timeout: 500 }), 500);
      } catch {
        destroy = true;
        outcome = { reason: 'query_failed' };
      } finally {
        try { client.release(destroy); }
        catch { outcome = { reason: 'query_failed' }; }
      }
    }
  }
  return outcome;
}

function runtimeHealth(runtime, at) {
  const keys = ['authenticationConfigured', 'bootstrapReady', 'archiveReady',
    'providerCircuitsReady', 'observabilityReady', 'eventBusConnected'];
  if (!runtime || keys.some(key => typeof runtime[key] !== 'boolean') || typeof runtime.approvalMode !== 'string') {
    return result('runtime_health', 'unverified', 'source_unavailable');
  }
  const unhealthy = keys.filter(key => runtime[key] !== true).length + Number(runtime.approvalMode !== 'approval');
  return result('runtime_health', unhealthy ? 'failed' : 'passed',
    unhealthy ? 'findings_detected' : 'no_findings', { checked: 7, unhealthy }, at, at);
}

// now and runtime are internal dependencies, never request fields or caller evidence.
export async function collectOperationalAudit({ pool, now = Date.now(), observationNow = Date.now,
  runtime = {}, secret, revision, sampler, fence } = {}) {
  if (!Number.isSafeInteger(now) || now < DAY_MS || !Number.isFinite(new Date(now).getTime())) {
    throw new TypeError('invalid_audit_clock');
  }
  const windowStart = new Date(now - DAY_MS).toISOString();
  const windowEnd = new Date(now).toISOString();
  const deadline = Math.min(performance.now() + DEADLINE_MS, fence?.deadlineAt ?? Infinity);
  // Close only the actual current pending boundary. A zero-age head already closes this cutoff.
  let sampled = Boolean(sampler);
  if (sampler && sampler.status().cutoff !== windowEnd) {
    sampled = (await sampler.sample({ cutoff: now })).verified === true;
  }
  fence?.check();
  const coverage = sampled ? await readRuntimeCoverage({ pool, secret, revision, now: observationNow, cutoff: now }) : null;
  fence?.check();
  const checks = [];
  for (const source of SOURCES) {
    const read = await readSource(pool, source, source.id === 'database_security' ? [] : [windowStart, windowEnd], deadline);
    checks.push(read.reason ? result(source.id, 'unverified', read.reason) : summarize(source, read.rows, windowEnd, coverage));
  }
  checks.push(runtimeHealth(runtime, windowEnd));
  checks.push(result('monitoring_continuity', coverage?.verified ? 'passed' : 'unverified',
    coverage?.verified ? 'no_findings' : 'authoritative_source_unavailable'));
  const reference = coverage?.proof?.reference;
  return { windowStart, windowEnd, checks, coverage: reference ? { verified: true,
    schemaVersion: coverage.proof.schemaVersion, policyVersion: coverage.proof.policy.version, policyHash: reference.policyHash,
    instrumentation: reference.instrumentation, segmentRef: reference.segmentRef, cutoff: reference.cutoff, reference }
    : { verified: false } };
}
