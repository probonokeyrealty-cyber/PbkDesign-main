import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { applyReviewedBatch, parseBatchFile } from '../src/app/utils/batchReview.ts';

const bridge = new URL('./openclaw-local-server.mjs', import.meta.url);

test('both outbound provider operations go through the batch phone safeguard', async () => {
  const source = await readFile(bridge, 'utf8');
  assert.ok(/executeProviderCircuitGuard\(\s*'telnyx',\s*\(\) =>\s*dispatchTelnyxWithBatchPhoneGuard\(/.test(source));
  for (const endpoint of ['calls', 'messages']) {
    assert.ok(source.includes(`fireTelnyxRequest('POST', '/${endpoint}', requestPayload, { leadId: context.leadId })`));
  }
});

test('guard fails closed without shared storage and rejects multi-recipient dispatch', async () => {
  const { dispatchTelnyxWithBatchPhoneGuard } = await import('./batch-phone-dispatch.mjs');
  const dispatch = () => assert.fail('provider callback must not run');
  const run = (endpoint, to) => dispatchTelnyxWithBatchPhoneGuard({
    pool: null, method: 'POST', endpoint, payload: { to }, dispatch, isLocallyDnc: () => false,
  });
  for (const endpoint of ['/calls', '/messages']) {
    assert.equal((await (await run(endpoint, '+12025550101')).json()).batchPhoneGuard, 'unavailable');
    assert.equal((await (await run(endpoint, ['+12025550101', '+12025550102'])).json()).batchPhoneGuard, 'invalid-recipient');
  }
});

test('blocked phone operations do not count as Telnyx failures or reset the circuit', async () => {
  const { createProviderCircuitBreaker } = await import('./production-maturity-loop.mjs');
  const { dispatchTelnyxWithBatchPhoneGuard } = await import('./batch-phone-dispatch.mjs');
  const circuit = createProviderCircuitBreaker();
  circuit.recordFailure('telnyx', new Error('sample failure'));
  const before = circuit.getStatus('telnyx');
  const result = await circuit.execute('telnyx', () => dispatchTelnyxWithBatchPhoneGuard({
    pool: { connect: async () => { throw new Error('fixture database unavailable'); } },
    method: 'POST', endpoint: '/calls', payload: { to: '+12025550101' },
    dispatch: () => assert.fail('provider callback must not run'),
  }));
  assert.equal(result.providerAttempted, false);
  assert.equal((await result.fallback.json()).batchPhoneGuard, 'unavailable');
  assert.deepEqual(circuit.getStatus('telnyx'), before);
});

test('Postgres persists shared reservations and suppression using synthetic data', async () => {
  const dbUrl = process.env.PBK_BATCH_TEST_DATABASE_URL;
  const embeddedModule = process.env.PBK_BATCH_TEST_PGLITE_MODULE;
  const {
    ensureBatchPhoneSchema, registerBatchPhonePlan, setWorkspacePhoneDnc, dispatchTelnyxWithBatchPhoneGuard,
  } = await import('./batch-phone-dispatch.mjs');
  const { randomUUID } = await import('node:crypto');
  const workspace = `sample-${randomUUID()}`;
  let close;
  let pool;
  let reopen;
  if (!dbUrl) {
    const { PGlite } = await import(embeddedModule || '@electric-sql/pglite');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'pbk-batch-phone-test-'));
    reopen = async () => {
      const db = await PGlite.create(directory);
      const query = (sql, params) => params ? db.query(sql, params) : db.exec(sql);
      // PGlite runs one SQL connection. Queue whole transactions like a one-client pool.
      let tail = Promise.resolve();
      pool = {
        query,
        async connect() {
          const previous = tail;
          let release;
          tail = new Promise((resolve) => { release = resolve; });
          await previous;
          return { query, release };
        },
      };
      close = () => db.close();
    };
  } else {
    const url = new URL(dbUrl);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/pbk_batch_phone_test');
    const { default: pg } = await import('pg');
    reopen = async () => {
      pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
      close = () => pool.end();
    };
  }
  await reopen();
  try {
    await ensureBatchPhoneSchema(pool);
    const rows = parseBatchFile('sample.csv', [
      'Address,Phone 1,Phone 1 DNC,Phone 2,Phone 2 DNC',
      '10 Sample St,2025550101,No,2025550102,No',
      '20 Sample St,+1 202-555-0101,No,2025550103,No',
      '30 Sample St,2025550102,Yes,2025550104,No',
      '40 Sample St,2025550105,,2025550106,No',
      '50 Sample St,2025550107,No,,',
    ].join('\n'));
    const id = row => `sample-lead-${row}`;
    const { contactPlan } = applyReviewedBatch(rows, [], [1, 2, 3, 4, 5], id);
    const enroll = batchId => registerBatchPhonePlan(pool, { workspace, batchId, entries: contactPlan, leadIdForRow: id });
    await enroll('sample-batch');
    const attempts = [];
    const run = async (endpoint, to, leadId, overrides = {}) => {
      const response = await dispatchTelnyxWithBatchPhoneGuard({
        pool, workspace, endpoint, method: 'POST', payload: { to }, leadId,
        isLocallyDnc: () => false,
        dispatch: () => { attempts.push(endpoint); return Response.json({ stub: true }); },
        ...overrides,
      });
      return (await response.json()).batchPhoneGuard ?? 'dispatched';
    };
    assert.equal(await run('/calls', '+12025550101', id(2)), 'wrong-lead');
    assert.equal(await run('/messages', '+12025550102', id(1)), 'dnc');
    assert.equal(await run('/calls', '+12025550105', id(4)), 'not-eligible');
    assert.equal(await run('/messages', '+12025550103', id(2), { isLocallyDnc: () => true }), 'dnc');
    assert.equal(await run('/messages', '+12025550103', id(2), { isPersistedDnc: async () => true }), 'dnc');
    await setWorkspacePhoneDnc(pool, { workspace, phone: '+12025550103', blocked: true });
    assert.equal(await run('/calls', '+12025550103', id(2)), 'dnc');
    await setWorkspacePhoneDnc(pool, { workspace, phone: '+12025550103', blocked: false });
    assert.equal(await run('/calls', '+12025550103', id(2)), 'dnc');

    const contenders = await Promise.all([
      run('/calls', '+12025550101', id(1)),
      run('/messages', '(202) 555-0101', id(1)),
    ]);
    assert.deepEqual(contenders.sort(), ['already-reserved', 'dispatched']);
    assert.equal(attempts.length, 1);
    await assert.rejects(run('/calls', '+12025550104', id(3), {
      dispatch: async () => { throw new Error('provider status unknown'); },
    }), /provider status unknown/);

    // An opt-out observed between claim and dispatch still wins.
    let lookups = 0;
    assert.equal(await run('/calls', '+12025550106', id(4), {
      isLocallyDnc: () => ++lookups >= 2,
    }), 'dnc');
    const actualPool = pool;
    let connections = 0;
    const racePool = {
      async connect() {
        if (++connections === 2) {
          await setWorkspacePhoneDnc(actualPool, { workspace, phone: '+12025550107', blocked: true });
        }
        return actualPool.connect();
      },
    };
    assert.equal(await run('/messages', '+12025550107', id(5), { pool: racePool }), 'dnc');
    assert.equal(connections, 2);
    assert.equal(attempts.length, 1);
    await close();
    await reopen();
    await enroll('sample-batch');
    await assert.rejects(enroll('overlapping-batch'), /another batch/);
    assert.equal(await run('/messages', '+12025550101', id(1)), 'already-reserved');
    assert.equal(await run('/messages', '+12025550104', id(3)), 'already-reserved');
    assert.equal(await run('/messages', '+12025550103', id(2)), 'dnc');
    assert.equal(await run('/calls', '+12025550107', id(5)), 'dnc');
    assert.equal(attempts.length, 1);
    const nonBatchPhone = '+12025550199';
    assert.equal(await run('/calls', nonBatchPhone, 'existing-lead'), 'dispatched');
    assert.equal(await run('/messages', nonBatchPhone, 'existing-lead'), 'dispatched');
  } finally {
    await close();
  }
});
