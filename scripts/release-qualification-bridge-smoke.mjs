import assert from 'node:assert/strict';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge({ startupMs: 60_000 });
const founder = { Authorization: `Bearer ${child.apiKey}`, 'Content-Type': 'application/json' };
async function request(path, body, headers = founder) {
  const response = await child.fetch(child.origin + path, {
    headers, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

try {
  const before = (await request('/state')).data;
  assert.equal((await request('/api/admin/qualification/run', {}, {})).status, 401);
  for (const path of ['/api/admin/qualification/run', '/api/agents/controlled-qualification']) {
    for (const delegated of [{ 'X-PBK-Team-Token': 'isolated-team-session' }, { 'X-PBK-Netlify-Proxy': 'pbk-bridge-proxy' }]) {
      const result = await request(path, {}, { ...founder, ...delegated });
      assert.equal(result.status, 403, `${path} cannot inherit founder authority from a proxy or team session`);
    }
  }
  assert.equal((await request('/api/admin/qualification/run', { passed: true })).status, 400);
  assert.equal((await request('/api/admin/qualification/run?revision=submitted', {})).status, 400);
  const noDatabase = await request('/api/admin/qualification/run', {});
  assert.equal(noDatabase.status, 503);
  assert.equal(noDatabase.data.verified, false);
  const maturity = (await request('/api/production/maturity?passed=true')).data;
  assert.equal(maturity.ready, false);
  assert.equal(maturity.executionEvidence.verified, false);
  assert.equal(maturity.executionEvidence.source, 'postgres_unavailable');
  assert.equal(maturity.failedCallEvalGate.ready, false);
  assert.equal(maturity.canaryPromotionGate.ready, false);
  const after = (await request('/state')).data;
  assert.equal(after.status.mode, before.status.mode);
  assert.equal(after.approvals.length, before.approvals.length);
  assert.equal(after.leadImports.length, before.leadImports.length);
  console.log('release-qualification-bridge-smoke: ok (isolated, founder-only, no provider writes)');
} finally {
  await child.stop();
}
