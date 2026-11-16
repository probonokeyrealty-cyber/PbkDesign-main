import assert from 'node:assert/strict';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const child = await startIsolatedBridge();
const headers = { Authorization: `Bearer ${child.apiKey}`, 'Content-Type': 'application/json' };
async function request(path, body) {
  const response = await child.fetch(child.origin + path, {
    headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  return response.json();
}
try {
  const leadId = 'analyzer-input-safety';
  await request('/api/leads', {
    id: leadId, leadId, source: 'smoke', seller: { name: '[PBK QA] Incomplete analysis', phone: '', email: '' },
    property: { address: '100 Fixture Lane' }, tags: ['do-not-contact'],
  });
  const before = (await request(`/api/leads/${leadId}/full`)).lead;
  const emailContext = (await request(`/api/brain/email-context?leadId=${leadId}`)).context;
  assert.deepEqual(emailContext.recentComps, [], 'Missing analysis must not generate fake email comparables');
  assert.equal(emailContext.estimatedEquity, null, 'ARV minus offer is not verified homeowner equity');
  for (const [inputs, missing] of [
    [{}, ['arv', 'repairs']],
    [{ arv: 200000 }, ['repairs']],
    [{ repairs: 0 }, ['arv']],
    [{ arv: -1, repairs: 0 }, ['arv']],
    [{ arv: 'not-money', repairs: 0 }, ['arv']],
    [{ arv: 200000, repairs: -1 }, ['repairs']],
    [{ arv: 200000, repairs: ' ' }, ['repairs']],
    [{ arv: 200000, repairs: '$' }, ['repairs']],
    [{ arv: 200000, repairs: ',' }, ['repairs']],
    [{ arv: 200000, repairs: '1,,2' }, ['repairs']],
  ]) {
    const result = await request('/api/analyzeDeal', {
      leadId, address: '100 Fixture Lane', useBrowserOs: false, queueBrowserResearch: false, ...inputs,
    });
    assert.equal(result.ok, false, 'Incomplete inputs must fail closed');
    assert.equal(result.result, 'analysis_incomplete');
    assert.deepEqual(result.missingInputs, missing);
    assert.equal(result.mao, undefined, 'Incomplete analysis must not publish an offer');
    const after = (await request(`/api/leads/${leadId}/full`)).lead;
    assert.deepEqual(after.analyzer, before.analyzer, 'Incomplete analysis must not change canonical analysis');
    assert.deepEqual(after.deal, before.deal, 'Incomplete analysis must not change canonical deal');
  }
  const complete = await request('/api/analyzeDeal', {
    leadId, address: '100 Fixture Lane', arv: 200000, repairs: 0, fee: 0,
    useBrowserOs: false, queueBrowserResearch: false,
  });
  assert.equal(complete.status, 'complete');
  assert.equal(complete.repairsMid, 0, 'Explicit zero repairs must be preserved');
  assert.equal(complete.mao, 136000, 'Existing screening formula must preserve explicit zero fee');
  const missingAfterSuccess = await request('/api/analyzeDeal', {
    leadId, address: '100 Fixture Lane', arv: 200000,
    useBrowserOs: false, queueBrowserResearch: false,
  });
  assert.equal(missingAfterSuccess.result, 'analysis_incomplete', 'Missing repairs must not collide with cached zero repairs');
  const cachedAddress = '110 Fixture Lane';
  await request('/api/property-data', { address: cachedAddress, data: { arv: 200000, repairs: 30000 } });
  const cachedInput = { address: cachedAddress, useBrowserOs: false, queueBrowserResearch: false };
  assert.equal((await request('/api/analyzeDeal', cachedInput)).status, 'complete');
  await request('/api/property-data', { address: cachedAddress, data: { arv: 200000 } });
  assert.equal((await request('/api/analyzeDeal', cachedInput)).result, 'analysis_incomplete', 'Updated property evidence must invalidate cached analysis');
  const nested = { address: '120 Fixture Lane', useBrowserOs: false, queueBrowserResearch: false,
    deal: { propertyData: { arv: 220000, repairs: 20000 } } };
  assert.equal((await request('/api/analyzeDeal', nested)).status, 'complete');
  nested.deal.propertyData = { arv: 220000 };
  assert.equal((await request('/api/analyzeDeal', nested)).result, 'analysis_incomplete', 'Nested evidence must share the calculation cache identity');
  console.log('analyzer-input-safety-smoke: ok (isolated, no provider writes)');
} finally {
  await child.stop();
}
