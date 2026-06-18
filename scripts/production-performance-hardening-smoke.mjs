import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  PERFORMANCE_HARDENING_REVISION,
  REQUIRED_PROVIDER_CIRCUITS,
  REQUIRED_POSTGRES_HOT_INDEXES,
  buildLoadScenarioPlan,
  buildManualSendOutboxEnvelope,
  buildPostgresPerformanceReadiness,
  buildProviderCircuitCoverage,
  deriveManualSendIdempotencyKey,
} from './production-performance-hardening.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

assert.match(PERFORMANCE_HARDENING_REVISION, /production-performance-hardening/);

const closedCircuitStatus = {
  statuses: REQUIRED_PROVIDER_CIRCUITS.map((provider) => ({
    provider,
    state: 'closed',
    failures: 0,
  })),
};
const circuitCoverage = buildProviderCircuitCoverage({ circuitStatus: closedCircuitStatus });
assert.equal(circuitCoverage.ready, true);
assert.deepEqual(circuitCoverage.missingProviders, []);
assert.ok(circuitCoverage.requiredProviders.includes('slack'));

const missingSlackCoverage = buildProviderCircuitCoverage({
  circuitStatus: {
    statuses: closedCircuitStatus.statuses.filter((status) => status.provider !== 'slack'),
  },
});
assert.equal(missingSlackCoverage.ready, false);
assert.deepEqual(missingSlackCoverage.missingProviders, ['slack']);

const readiness = buildPostgresPerformanceReadiness({
  connection: {
    ok: true,
    databaseUrl: 'postgres://pbk:secret@pbk-openclaw-db.internal:5432/pbk',
  },
  requiredTables: [
    'conversation_threads',
    'conversation_thread_identities',
    'conversation_events',
    'communication_sender_identities',
    'lead_profiles',
    'provider_action_dispatches',
  ],
  tableRows: [
    { table_name: 'conversation_threads', exists: true },
    { table_name: 'conversation_thread_identities', exists: true },
    { table_name: 'conversation_events', exists: true },
    { table_name: 'communication_sender_identities', exists: true },
    { table_name: 'lead_profiles', exists: true },
    { table_name: 'provider_action_dispatches', exists: true },
  ],
  indexRows: REQUIRED_POSTGRES_HOT_INDEXES.map((indexName) => ({ index_name: indexName })),
});
assert.equal(readiness.ready, true);
assert.equal(readiness.usesRawPrivateIp, false);

const rawIpReadiness = buildPostgresPerformanceReadiness({
  connection: {
    ok: true,
    databaseUrl: 'postgres://pbk:secret@10.208.245.134:5432/pbk',
  },
  requiredTables: ['conversation_threads'],
  tableRows: [{ table_name: 'conversation_threads', exists: true }],
  indexRows: REQUIRED_POSTGRES_HOT_INDEXES.map((indexName) => ({ index_name: indexName })),
});
assert.equal(rawIpReadiness.ready, false);
assert.equal(rawIpReadiness.usesRawPrivateIp, true);
assert.ok(rawIpReadiness.blockers.includes('postgres_url_raw_private_ip'));

const firstKey = deriveManualSendIdempotencyKey({
  channel: 'sms',
  leadId: 'lead-123',
  recipient: '+16145550142',
  body: 'Can we talk today?',
  requestedBy: 'operator',
});
const secondKey = deriveManualSendIdempotencyKey({
  channel: 'sms',
  leadId: 'lead-123',
  recipient: '+1 (614) 555-0142',
  body: 'Can we talk today?',
  requestedBy: 'operator',
});
assert.equal(firstKey, secondKey);
assert.match(firstKey, /^manual-send:sms:/);

const failedOutbox = buildManualSendOutboxEnvelope({
  channel: 'sms',
  provider: 'telnyx',
  status: 'failed',
  idempotencyKey: firstKey,
  recipient: '+16145550142',
  error: 'Telnyx 409 conflict',
});
assert.equal(failedOutbox.ok, false);
assert.equal(failedOutbox.retryable, true);
assert.equal(failedOutbox.operatorVisible, true);
assert.equal(failedOutbox.timelineStatus, 'failed');

const plan = buildLoadScenarioPlan({
  baseUrl: 'https://pbk-openclaw-bridge.onrender.com',
  concurrency: 50,
});
assert.equal(plan.ready, true);
assert.equal(plan.concurrency, 50);
for (const pathName of ['/health', '/api/conversations?limit=5', '/api/leads/search?q=test&limit=5', '/api/circuit/status']) {
  assert.ok(
    plan.scenarios.some((scenario) => scenario.path === pathName),
    `missing load scenario ${pathName}`
  );
}

const bridgeSource = readFileSync(path.join(rootDir, 'scripts', 'openclaw-local-server.mjs'), 'utf8');
assert.ok(
  bridgeSource.includes("from './production-performance-hardening.mjs'"),
  'bridge must import production performance hardening helpers'
);
assert.ok(
  bridgeSource.includes('/api/performance/status'),
  'bridge must expose a production performance status endpoint'
);
assert.ok(
  bridgeSource.includes('buildManualSendOutboxEnvelope'),
  'manual send path must expose outbox envelopes'
);

console.log(
  JSON.stringify(
    {
      ok: true,
      revision: PERFORMANCE_HARDENING_REVISION,
      circuitCoverage: circuitCoverage.result,
      postgresReadiness: readiness.result,
      outbox: failedOutbox.result,
      loadScenarios: plan.scenarios.length,
    },
    null,
    2
  )
);
