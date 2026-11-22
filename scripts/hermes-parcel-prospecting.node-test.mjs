import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { CITY_BOUNDARY, COUNTY_PARCELS, createHermesParcelProspecting } from './hermes-parcel-prospecting.mjs';

const boundary = [[[-118.48, 34.16], [-118.42, 34.16], [-118.42, 34.22], [-118.48, 34.22], [-118.48, 34.16]]];
const records = [
  { AIN: '2201000001', SitusAddress: '100 TEST AVE', SitusCity: 'LOS ANGELES CA', SitusZIP: '91405-0001', UseDescription: 'Single', SQFTmain1: 1800, CENTER_LAT: 34.2, CENTER_LON: -118.45 },
  { AIN: '2201000002', SitusAddress: '102 TEST AVE', SitusCity: 'LOS ANGELES CA', SitusZIP: '91405', UseDescription: 'Single', SQFTmain1: 2400, CENTER_LAT: 34.2, CENTER_LON: -118.44 },
  { AIN: '2201000003', SitusAddress: '104 TEST AVE', SitusCity: 'LOS ANGELES CA', SitusZIP: '91405', UseDescription: 'Single', SQFTmain1: 5000, CENTER_LAT: 34.3, CENTER_LON: -118.45 },
];

function fixture(prioritize) {
  const approvals = [];
  const leads = [];
  const calls = [];
  const agent = createHermesParcelProspecting({
    fetchImpl: async (value) => {
      const url = new URL(value);
      calls.push(url);
      if (url.href.startsWith(CITY_BOUNDARY)) return Response.json({ features: [{ geometry: { rings: boundary } }] });
      assert.ok(url.href.startsWith(COUNTY_PARCELS));
      const ain = url.searchParams.get('where').match(/AIN = '(\d+)'/)?.[1];
      return Response.json({ features: records.filter(row => !ain || row.AIN === ain).map(attributes => ({ attributes })) });
    },
    prioritize,
    loadLeads: async () => leads,
    approvals: () => approvals,
    sign: (value) => createHmac('sha256', 'fixture only').update(value).digest('base64url'),
    createApproval: async (value) => {
      const approval = { ...value, status: 'pending' };
      approvals.push(approval);
      return { approval };
    },
    saveLead: async ({ properties }) => {
      const leadId = 'parcel-lead';
      leads.push({ leadId, property: { ...properties.situs, parcelId: properties.parcelId, county: properties.county } });
      return { ok: true, leadId, created: true };
    },
  });
  return { agent, approvals, leads, calls };
}

test('county evidence stays within the certified boundary and Hermes receives anonymized rows', async () => {
  const { agent, calls, leads, approvals } = fixture((evidence) => {
    assert.deepEqual(Object.keys(evidence[0]), ['index', 'use', 'sqft', 'units', 'yearBuilt']);
    return [1, 0];
  });
  const result = await agent.discover({ singleFamily: true, minSqft: 1500 });
  assert.equal(result.ranking, 'hermes');
  assert.deepEqual(result.records.map(row => row.parcelId), ['2201000001', '2201000002']);
  assert.deepEqual(result.records.map(({ longitude, latitude }) => [longitude, latitude]), [
    [-118.45, 34.2],
    [-118.44, 34.2],
  ]);
  assert.match(calls[1].searchParams.get('where'), /SQFTmain1 >= 1500/);
  assert.deepEqual(leads, []);
  assert.deepEqual(approvals, []);
  await assert.rejects(agent.discover({ minSqft: "0 OR 1=1" }), { status: 400 });
});

test('approval is exact and replay safe, and a later CRM match is reused', async () => {
  const { agent, approvals, leads } = fixture(() => [0, 0]);
  assert.equal((await agent.discover()).ranking, 'building_area');
  await assert.rejects(agent.match('2201000003'), { status: 409 });
  assert.equal((await agent.match('2201000001')).match.status, 'no_match');
  const [request, repeat] = await Promise.all([
    agent.requestApproval('2201000001'), agent.requestApproval('2201000001'),
  ]);
  assert.equal(request.approvalId, repeat.approvalId);
  assert.equal(approvals.length, 1);
  await assert.rejects(agent.save('2201000001', request.approvalId), { status: 409 });
  approvals[0].status = 'approved';
  await assert.rejects(agent.save('2201000002', request.approvalId), { status: 409 });
  approvals.push({ ...approvals[0], id: 'forged' });
  await assert.rejects(agent.save('2201000001', 'forged'), { status: 409 });
  const saved = await agent.save('2201000001', request.approvalId);
  const second = await agent.save('2201000001', request.approvalId);
  assert.equal(saved.leadId, second.leadId);
  assert.equal(second.created, false);
  assert.equal(leads.length, 1);
  assert.equal((await agent.match('2201000001')).match.leadId, saved.leadId);
});

test('a conflicting parcel ID at the same address blocks a new lead approval', async () => {
  const { agent, leads, approvals } = fixture();
  leads.push({
    leadId: 'conflicting-record',
    property: { line1: '100 Test Avenue', zip: '91405', state: 'CA', county: 'Los Angeles', parcelId: '2201000009' },
  });
  assert.equal((await agent.match('2201000001')).match.status, 'ambiguous');
  assert.equal((await agent.requestApproval('2201000001')).match.status, 'ambiguous');
  assert.equal(approvals.length, 0);
});
