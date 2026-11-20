import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge();
const stateFile = path.join(child.stateDir, 'openclaw-state.json');
const backup = path.join(child.stateDir, 'qa-state-backup.json');
let blocked = false;
const body = { id: 'qa-failed-save-replay', leadId: 'qa-failed-save-replay', eventId: 'qa-failed-save-replay',
  source: 'pbk-internal-qa', seller: { name: '[PBK QA] Failed-save replay' } };
async function create() {
  const response = await child.fetch(child.origin + '/api/leads', { method: 'POST',
    headers: { Authorization: `Bearer ${child.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
try {
  await rename(stateFile, backup);
  await mkdir(stateFile); blocked = true;
  const first = await create();
  assert.ok(first.status >= 400, 'The injected persistence failure must be visible.');
  const replay = await create();
  assert.ok(replay.status >= 400, 'An in-memory replay must not claim success while persistence is unavailable.');
  await rmdir(stateFile); blocked = false;
  await rename(backup, stateFile);
  const recovered = await create();
  assert.equal(recovered.status, 200); assert.equal(recovered.data.ok, true);
  const durable = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.ok(durable.leadImports.some(lead => lead.eventId === body.eventId), 'Success must mean the lead reached durable storage.');
  console.log('Manual lead replay: persistence failure exposed, no false success, durable retry confirmed (isolated).');
} finally {
  if (blocked) { await rmdir(stateFile); await rename(backup, stateFile); }
  await child.stop();
}
