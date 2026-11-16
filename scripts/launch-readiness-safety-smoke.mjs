import assert from 'node:assert/strict';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge();
try {
  const response = await child.fetch(child.origin + '/api/production/maturity', {
    headers: { Authorization: `Bearer ${child.apiKey}` },
  });
  const result = await response.json();
  assert.equal(result.failedCallEvalGate.ready, false, 'Packaged scenario names are not executed evaluation proof');
  assert.equal(result.shadowCanaryComparison.ready, false, 'Default same-version metrics are not a live comparison');
  assert.equal(result.canaryPromotionGate.ready, false);
  assert.equal(result.ready, false);
  assert.equal(result.executionEvidence.source, 'not_configured');
  console.log('launch-readiness-safety-smoke: ok (missing evidence remains not ready)');
} finally {
  await child.stop();
}
