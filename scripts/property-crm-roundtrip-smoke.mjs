import assert from 'node:assert/strict';
import { selectedCompPatch } from '../src/app/utils/leadComps.mjs';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const live = process.argv.includes('--live');
if (live && process.env.PBK_PROPERTY_QA_LIVE !== '1') throw Error('Live writes require PBK_PROPERTY_QA_LIVE=1 and explicit operator authorization.');
const child = live ? null : await startIsolatedBridge();
const origin = live ? 'https://pbk-openclaw-bridge.onrender.com' : child.origin;
const key = live ? process.env.PBK_BRIDGE_API_KEY : child.apiKey;
if (!key) throw Error('Bridge authorization is required.');
const subjectId = 'pbk-qa-property-workflow-subject-v1';
const controlId = 'pbk-qa-property-workflow-control-v1';
const address = { street: '4529 Winona Court', city: 'Denver', state: 'CO', zip: '80212' };
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
async function request(path, method = 'GET', body) {
  const start = performance.now();
  const options = { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) };
  const response = await (child ? child.fetch(origin + path, options) : fetch(origin + path, options));
  return { status: response.status, data: await response.json(), ms: Math.round(performance.now() - start) };
}
function assertFixture(lead, id) {
  assert.equal(lead?.leadId || lead?.id, id);
  assert.equal(lead?.source, 'pbk-internal-qa');
  assert.ok(lead?.seller?.name?.startsWith('[PBK QA]'));
  assert.ok(!lead?.seller?.phone && !lead?.seller?.email && !lead?.phone && !lead?.email, 'Never write a contactable record.');
}
try {
  const roster = await request('/api/leads');
  assert.equal(roster.status, 200);
  assert.equal(roster.data.complete, true, 'Require a complete roster before duplicate checks.');
  const leads = roster.data.leads || roster.data.leadImports || [];
  assert.ok(!leads.some(lead => /4529.*winona/i.test(lead.property?.address || lead.address || '') && (lead.leadId || lead.id) !== subjectId), 'The sample address belongs to another record; stop without writes.');
  for (const id of [subjectId, controlId]) {
    const existing = leads.find(lead => (lead.leadId || lead.id) === id);
    if (existing) { assertFixture(existing, id); continue; }
    const result = await request('/api/leads', 'POST', {
      id, leadId: id, eventId: id, source: 'pbk-internal-qa', actor: 'PBK controlled QA',
      status: 'internal-qa', stage: 'internal-qa', tags: ['internal-qa', 'do-not-contact'],
      seller: { name: `[PBK QA] Property workflow ${id === subjectId ? 'subject' : 'control'}`, phone: '', email: '' },
      property: id === subjectId ? { address: address.street, city: address.city, state: address.state, zip: address.zip } : {},
      compliance: { dncStatus: 'dnc', tcpaConsent: 'denied', consentStatus: 'denied' },
      assignment: { assignedAgent: 'none', campaign: '' },
      notes: 'Controlled property workflow verification only. No customer contact. Keep for audit.',
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assertFixture(result.data.lead, id);
  }
  const beforeSubject = await request(`/api/leads/${subjectId}/full`);
  const beforeControl = await request(`/api/leads/${controlId}/full`);
  assertFixture(beforeSubject.data.lead, subjectId); assertFixture(beforeControl.data.lead, controlId);
  const sales = live ? await request('/api/property-data/attom-sales', 'POST', { ...address, radius: 1 }) : {
    status: 200, data: { status: 'matched', source: 'ATTOM', retrievedAt: new Date().toISOString(), radiusMiles: 1,
      sales: [{ id: 'qa-sale', address: 'QA Comparable Address', price: 400000, soldDate: '2026-11-15' }] },
  };
  assert.equal(sales.status, 200); assert.equal(sales.data.status, 'matched');
  assert.ok(sales.data.sales?.length > 0, 'No sales available; do not fabricate a live comp.');
  const selected = sales.data.sales.slice(0, 3).map(sale => sale.id);
  const patch = selectedCompPatch(sales.data, selected, address);
  const denied = await request(`/api/leads/${controlId}`, 'PATCH', patch);
  assert.equal(denied.status, 409, 'A mismatched property must not accept comps.');
  const saved = await request(`/api/leads/${subjectId}`, 'PATCH', patch);
  assert.equal(saved.status, 200); assert.equal(saved.data.ok, true);
  const afterSubject = await request(`/api/leads/${subjectId}/full`);
  const afterControl = await request(`/api/leads/${controlId}/full`);
  assertFixture(afterSubject.data.lead, subjectId); assertFixture(afterControl.data.lead, controlId);
  assert.deepEqual(afterSubject.data.lead.analyzer.comps, patch.analyzer.comps);
  assert.deepEqual(afterSubject.data.lead.deal.comps, patch.deal.comps);
  assert.deepEqual(afterSubject.data.lead.analyzer.recordedSales.selectedIds, selected);
  assert.equal(afterSubject.data.lead.deal.isAnalyzed, false);
  assert.deepEqual(afterControl.data.lead.analyzer, beforeControl.data.lead.analyzer);
  assert.deepEqual(afterControl.data.lead.deal, beforeControl.data.lead.deal);
  console.log(JSON.stringify({ ok: true, mode: live ? 'live' : 'isolated', subjectId, controlId,
    selectedCount: selected.length, wrongLeadStatus: denied.status, saveMs: saved.ms,
    confirmedReadBack: true, controlUnchanged: true, customerContacts: 0 }));
} finally { await child?.stop(); }
