import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { controlledExecution } from './controlled-execution-scope.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function recordAgentHandoffTask(');
const end = source.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start);

for (const existing of [false, true]) {
  test(`controlled ${existing ? 'updated' : 'new'} task waits for its actual SQL persistence before returning`, async () => {
    let release;
    const gate = new Promise((done) => { release = done; });
    let submitted = false;
    let settled = false;
    const state = { agentTasks: existing ? [{ id: 'task', metadata: {} }] : [] };
    const sandbox = vm.createContext({ controlledExecution, state,
      ensureAgentFleetCollections() {}, normalizeTenantId: (value) => value, normalizeAgentName: (value) => value,
      isoNow: () => '2026-11-14T20:00:00.000Z', randomUUID: () => 'unit-id', LIMITS: { agentTasks: 100 },
      upsertById: (_state, _collection, record) => { if (!existing) state.agentTasks.push(record); }, sortNewest: (rows) => rows,
      persistPbkTaskRecord: async () => { submitted = true; await gate; return { ok: true }; },
      publishPbkEvent: async () => ({}), EventTypes: { AGENT_TASK_CREATED: 'agent_task_created' },
    });
    vm.runInContext(source.slice(start, end), sandbox);
    const scope = { runId: 'unit-run', agentId: 'bant-enforcer', fixture: { leadId: 'fixture', callId: 'call', sourceUpdatedAt: '2026-11-14T20:00:00.000Z' } };
    const pending = controlledExecution.run(scope, () => sandbox.recordAgentHandoffTask({ id: 'task', status: 'complete', metadata: {} }));
    pending.then(() => { settled = true; });
    try {
      await new Promise((done) => setImmediate(done));
      assert.equal(submitted, true);
      assert.equal(settled, false, 'Controlled task returned before its persistence; running/final SQL can race');
    } finally { release(); await pending; }
  });
}
