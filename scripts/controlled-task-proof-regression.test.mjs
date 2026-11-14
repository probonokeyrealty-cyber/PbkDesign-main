import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { buildQaAuditRecord } from './qa-agent.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const actual = (name) => {
  const start = source.indexOf(`async function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};

test('controlled task start awaits actual persistence before a synchronous handler can complete', async () => {
  let release;
  const gate = new Promise(done => { release = done; });
  const scope = { runId: 'run', agentId: 'hermes', fixture: { leadId: 'lead', callId: 'call', sourceUpdatedAt: '2026-11-14T12:00:00Z' } };
  const context = vm.createContext({
    controlledExecution: { getStore: () => scope }, ensureAgentFleetCollections() {},
    state: { agentTasks: [] }, normalizeTenantId: x => x, normalizeAgentName: x => x,
    isoNow: () => '2026-11-14T12:00:00Z', LIMITS: { agentTasks: 100 }, sortNewest: x => x,
    upsertById(state, key, row) { if (!state[key].some(x => x.id === row.id)) state[key].push(row); },
    persistPbkTaskRecord: async () => { await gate; return { ok: true }; },
    publishPbkEvent: async () => ({}), EventTypes: { AGENT_TASK_CREATED: 'created' },
  });
  vm.runInContext(actual('recordAgentHandoffTask'), context);
  let settled = false;
  const write = context.recordAgentHandoffTask({ id: 'task', status: 'running' }).then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  release(); await write;
  context.persistPbkTaskRecord = async () => ({ ok: false });
  await assert.rejects(context.recordAgentHandoffTask({ id: 'task', status: 'complete' }), /controlled_task_persistence_failed/);
});

test('QA record carries the actual audit identifier before persistence and returned validation', () => {
  const record = buildQaAuditRecord({ toolName: 'consultNurtureAgent', qa: { ok: true } });
  assert.match(record.id || '', /^pbk-qa-/);
});
