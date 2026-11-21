import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const NativeDate = Date;
const now = NativeDate.parse('2026-01-04T12:00:00Z');
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const contracts = [
  { id: 'older-fixture', status: 'closed', amount: 900000, payload: { revenue: 4000 }, createdAt: '2025-12-31T23:59:59Z' },
  { id: 'boundary-fixture', status: 'closed', amount: 900000, payload: { revenue: 6000 }, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'recent-fixture', status: 'funded', amount: 900000, payload: { revenue: 7000 }, createdAt: '2026-01-02T15:00:00Z' },
  { id: 'not-closed', status: 'signed', amount: 900000, payload: { estimatedProfit: 25000 }, createdAt: '2026-01-02T15:00:00Z' },
];
await writeFile(path.join(process.env.PBK_OPENCLAW_STATE_DIR, 'openclaw-state.json'),
  JSON.stringify({ contracts, analyzerRuns: [], calls: [{ id: 'SYN-CALL', status: 'ended' }],
    approvals: [{ id: 'SYN-APPROVAL', status: 'pending' }] }));
await import('../openclaw-local-server.mjs');
