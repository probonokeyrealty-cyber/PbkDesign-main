import assert from 'node:assert/strict';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge({ startupMs: 60_000 });
const path = '/api/admin/operational-audit/run';
const founder = { Authorization: `Bearer ${child.apiKey}`, 'Content-Type': 'application/json' };
async function request(url, body, headers = founder) {
  const response = await child.fetch(child.origin + url, {
    headers, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
try {
  const before = (await request('/state')).data;
  assert.equal((await request(path, {}, {})).status, 401);
  for (const delegated of [{ 'X-PBK-Team-Token': 'fixture' }, { 'X-PBK-Netlify-Proxy': 'fixture' },
    { 'X-PBK-Team-Token': '' }, { 'X-PBK-Netlify-Proxy': '' }]) {
    assert.equal((await request(path, {}, { ...founder, ...delegated })).status, 403);
  }
  for (const body of [{ passed: true }, { findings: [] }, { windowHours: 1 },
    { coverage: { verified: true } }, { reference: {} }, { cutoff: Date.now() }, { requireTimingV2: false }, []]) {
    assert.equal((await request(path, body)).status, 400);
  }
  assert.equal((await request(path + '?passed=true', {})).status, 400);
  assert.equal((await request(path)).status, 400);
  const missing = await request(path, {});
  assert.equal(missing.status, 503);
  assert.equal(missing.data.verified, false);
  const maturity = (await request('/api/production/maturity')).data;
  assert.equal(maturity.operationalAudit.verified, false);
  assert.equal(maturity.operationalAudit.ready, false);
  assert.equal(maturity.operationalAudit.coverage.verified, false);
  assert.deepEqual(maturity.operationalAudit.sourceDiagnostics, []);
  assert.equal(maturity.executionEvidence.silentErrorReport.launchReady, false);
  assert.equal(maturity.canaryPromotionGate.ready, false);
  assert.equal(maturity.ready, false);
  const after = (await request('/state')).data;
  assert.equal(after.status.mode, before.status.mode);
  assert.equal(after.approvals.length, before.approvals.length);
  assert.equal(after.leadImports.length, before.leadImports.length);
  console.log('operational-audit-bridge-smoke: ok (isolated; no seller contact)');
} finally {
  await child.stop();
}
