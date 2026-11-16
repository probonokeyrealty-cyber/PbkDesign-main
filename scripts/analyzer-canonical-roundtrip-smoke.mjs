import assert from 'node:assert/strict';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';
import { buildAnalyzerLeadPatch } from '../src/app/utils/analyzerLeadPersistence.mjs';
const child = await startIsolatedBridge();
const id = 'qa-analyzer-roundtrip';
async function request(path, method = 'GET', body) {
  const response = await child.fetch(child.origin + path, { method, headers: { Authorization: `Bearer ${child.apiKey}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
try {
  await request('/api/leads', 'POST', { id, leadId: id, source: 'pbk-internal-qa', seller: { name: '[PBK QA] Analyzer', email: 'fixture@example.invalid' }, property: { address: '24 Sample Ave' } });
  const patch = buildAnalyzerLeadPatch({ leadId: id, address: '24 Sample Ave', sellerName: '[PBK QA] Edited', sellerEmail: '', sellerPhone: '', beds: 0, baths: 1, sqft: 800, year: 1950, price: 200000, arv: 300000, mao60: 150000, maoRBP: 250000, rent: 1500, balance: 80000, rate: 3.5, repairs: { mid: 15000, condition: 'C3' }, comps: { A: { address: 'QA comp', price: 300000 } } });
  await request('/api/leads/' + id, 'PATCH', patch);
  const { lead } = await request('/api/leads/' + id + '/full');
  for (const field of ['address', 'beds', 'sqft', 'arv', 'maoRbp', 'rent', 'mortgageRate', 'mortgageBalance', 'estimatedRepairs']) assert.equal(lead.property[field], patch.property[field], field);
  assert.equal(lead.seller.email, '', 'Explicit clearing must not restore old aliases');
  assert.equal(lead.email, '');
  assert.equal(lead.source, 'pbk-internal-qa');
  assert.deepEqual(lead.analyzer.comps, patch.analyzer.comps);
  console.log('Canonical bridge PATCH/fresh GET: facts, underwriting, comps and contact clearing passed (isolated, no provider contact).');
} finally { await child.stop(); }
