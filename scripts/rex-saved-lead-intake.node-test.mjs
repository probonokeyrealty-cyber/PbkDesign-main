import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';
import { buildRexLeadImportEvent, drainRexLeadImportEvent, ensureRexLeadImportEventSchema } from './rex-lead-import-events.mjs';
import { writePostgresStateSnapshot } from './postgres-state-snapshot.mjs';

test('the lead snapshot and Rex event commit together and delivery retries keep the event ID', async () => {
  const db = await PGlite.create();
  const query = async (sql, params) => {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.rows.length || result.affectedRows };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  try {
    await db.exec("CREATE TABLE bridge_state(id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ, CHECK (data ? 'leadImports'))");
    await ensureRexLeadImportEventSchema({ query: sql => db.exec(sql) });
    const lead = { leadId: 'fixture-lead' };
    const event = buildRexLeadImportEvent(lead, { source: 'manual', score: 92 });
    const options = { maxAttempts: 1, rexLeadImports: [event] };
    const count = async () => (await db.query('SELECT count(*)::int AS count FROM public.pbk_rex_lead_import_events')).rows[0].count;
    await assert.rejects(writePostgresStateSnapshot(pool, '{}', options));
    assert.equal(await count(), 0);
    const snapshot = JSON.stringify({ leadImports: [lead] });
    await writePostgresStateSnapshot(pool, snapshot, options);
    await writePostgresStateSnapshot(pool, snapshot, options);
    assert.equal(await count(), 1);
    await assert.rejects(drainRexLeadImportEvent(pool, async () => { throw new Error('temporary delivery failure'); }));
    await db.query('UPDATE public.pbk_rex_lead_import_events SET available_at = NOW()');
    assert.deepEqual(await drainRexLeadImportEvent(pool, async pending => {
      assert.equal(pending.id, event.id);
      assert.equal(pending.leadId, lead.leadId);
      return { action: 'needs_calling_time_review' };
    }), { eventId: event.id, action: 'needs_calling_time_review' });
    assert.equal(await drainRexLeadImportEvent(pool, async () => assert.fail('completed event delivered again')), false);
  } finally {
    await db.close();
  }
});

test('a saved intake has one durable Rex event and queues only eligible Ava tasks', async () => {
  const bridge = await startIsolatedBridge({ startupMs: 45000 });
  try {
    const request = async (path, body) => {
      const response = await bridge.fetch(bridge.origin + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${bridge.apiKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const input = (name, overrides = {}) => ({
      leadId: `fixture-rex-${name}`, eventId: `fixture-import-${name}`,
      address: `${name} Fixture Ave, Denver CO`, phone: '+12025550100',
      score: 95, nowLocalHour: 11, ...overrides,
    });
    const eligible = input('1');
    const first = await request('/api/leads', eligible);
    assert.match(first.leadImport.rexImportEventId, /^rex-lead-import-[a-f0-9]{64}$/);
    const replay = await request('/api/leads', eligible);
    assert.equal(replay.leadImport.rexImportEventId, first.leadImport.rexImportEventId);
    await request('/api/leads', input('2', { score: 30 }));
    await request('/api/leads', input('3', { dncStatus: 'requested' }));
    await request('/api/leads', input('4', { nowLocalHour: undefined }));
    await request('/events', { eventType: 'lead-intake', payload: input('5', { nowLocalHour: 21 }) });
    await request('/api/leads/import/property-data', { leads: [input('6', { score: 74 })] });

    const rexTasks = snapshot => snapshot.agentTasks.filter(task => task.fromAgent === 'Rex' && task.toAgent === 'Ava');
    let tasks;
    for (let attempt = 0; attempt < 75; attempt++) {
      tasks = rexTasks(await request('/state'));
      if (tasks.length === 3) break;
      await delay(200);
    }
    assert.deepEqual(tasks.map(task => [task.correlationId, task.status]).sort(), [
      ['fixture-rex-1', 'queued'], ['fixture-rex-5', 'pending'], ['fixture-rex-6', 'pending'],
    ]);
    const queued = tasks.find(task => task.correlationId === eligible.leadId);
    assert.equal(queued.metadata.importEventId, first.leadImport.rexImportEventId);
    assert(tasks.every(task => task.providerWrites === 'blocked'));
    await request('/api/leads', eligible);
    const after = rexTasks(await request('/state'));
    assert.deepEqual(after.map(task => task.id).sort(), tasks.map(task => task.id).sort());
    const attempted = await request('/invoke', { toolName: 'telnyx_call', params: {
      leadId: eligible.leadId, phone: eligible.phone, nowLocalHour: 11, approvalId: queued.id,
    } });
    assert.equal(attempted.result.result, 'approval_required');
    assert.equal(attempted.result.providerAttempted, false);
  } finally {
    await bridge.stop();
  }
});
