import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const shared = { phone: '+12025550123', address: '10 Sample Lane', leadName: 'Sample Seller' };
export const leads = ['sample-a', 'sample-b', 'sample-empty', 'sample-message', 'sample-context', 'sample-unavailable', 'sample/path%id'].map((leadId) => ({
  ...shared, id: leadId === 'sample-a' ? 'sample-row-alias' : leadId, leadId,
  seller: { name: shared.leadName, phone: shared.phone }, property: { address: shared.address },
  ...(leadId === 'sample-context' ? { callContext: { summary: 'Own saved context', last_offer: 42000 } } : {}),
}));
export const sampleState = {
  leadImports: leads, approvals: [], activity: [], contracts: [], analyzerRuns: [],
  calls: [
    { ...shared, id: 'foreign', leadId: 'sample-b', createdAt: '2026-01-05', transcript: [{ text: 'Foreign transcript' }], lastOffer: 99000 },
    { ...shared, id: 'missing-id', createdAt: '2026-01-06', lastOffer: 88000 },
    { ...shared, id: 'blank-id', leadId: '', createdAt: '2026-01-07', lastOffer: 77000 },
    { id: 'own-old', leadId: 'sample-a', createdAt: '2026-01-01', transcript: [{ text: 'Older own transcript' }] },
    { id: 'own-new', leadId: 'sample-a', createdAt: '2026-01-02', transcript: [{ text: 'Own transcript' }], sentiment: 0, lastOffer: 12000 },
    { id: 'encoded-own', leadId: 'sample/path%id', createdAt: '2026-01-01', transcript: [] },
    { id: 'durable-own', leadId: 'sample-durable-call', createdAt: '2026-01-01', lastOffer: 23000 },
  ],
  messages: [
    { ...shared, id: 'foreign-message', leadId: 'sample-b', channel: 'call', createdAt: '2026-01-09', body: 'Foreign call message' },
    { id: 'own-message', leadId: 'sample-message', channel: 'call', createdAt: '2026-01-01', body: 'Own call message' },
    { id: 'not-call', leadId: 'sample-empty', channel: 'sms', createdAt: '2026-01-10', body: 'Not a call' },
  ],
};

// Only the external DB read is substituted; the batch row adapter stays real.
export async function sampleQuery(sql, params) {
  assert.match(sql, /FROM public\.lead_profiles/);
  assert.match(sql, /AND id = \$1/);
  assert.equal(params.length, 1);
  const id = params[0];
  if (id === 'sample-unavailable') throw Object.assign(new Error('Sample DB unavailable'), { code: 'lead_roster_unavailable', status: 503 });
  return { ok: true, rows: ['sample-durable-empty', 'sample-durable-call'].includes(id)
    ? [{ id, raw: {}, source: 'batch-review', lead_name: shared.leadName, ...shared }] : [] };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  assert.ok(process.env.PBK_SMOKE_ISOLATION_NONCE, 'Use the bridge isolation harness');
  assert.ok(process.permission?.has('fs.write', process.env.PBK_OPENCLAW_STATE_DIR));
  await writeFile(path.join(process.env.PBK_OPENCLAW_STATE_DIR, 'openclaw-state.json'), JSON.stringify(sampleState));
  const server = new URL('../openclaw-local-server.mjs', import.meta.url).href;
  await import(server);
}
