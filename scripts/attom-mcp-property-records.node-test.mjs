import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttomMcpPropertyReader} from './attom-mcp-property-records.mjs';
const address={street:'101 Fiction Lane',city:'Example',state:'CA',zip:'90001'};
const addr={line1:address.street,city:address.city,state:address.state,postalCode:address.zip};
const fixture=()=>({structuredContent:{status:'partial',property:{attomId:'fiction-1',address:{...addr},identifiers:{apn:'APN-1',fips:'06037'}},results:[{dataset:'identity',status:'ok',data:{attomId:'fiction-1',address:{...addr},identifiers:{apn:'APN-1',fips:'06037'}}},{dataset:'comparables',status:'ok',data:{subject:{attomId:'fiction-1',address:'101 Fiction Lane, Example, CA 90001'},criteria:{maxDistanceMiles:5,saleDateFrom:'2025-01-01',saleDateTo:'2026-10-31'},results:[{attomId:'fiction-2',address:'102 Fiction Lane, Example, CA 90001',saleDate:'2026-02-03',salePrice:150000,distanceMiles:0.3,squareFootage:1000,bedrooms:2,fullBathrooms:1,partialBathrooms:1,propertyUse:'Single Family'}]}}]}});
const now=()=> '2026-11-18T00:00:00Z';
test('one exact MCP property response fills the core property record with validated facts', async () => {
  const sample = fixture();
  sample.structuredContent.results.push({
    dataset: 'overview', status: 'ok', data: {
      summary: { propertyType: 'Single family', ownerName: 'Sample Owner', assessedValue: 275000 },
      characteristics: { bedrooms: 3, bathrooms: 2, livingAreaSquareFeet: 1500, yearBuilt: 1990, lotSquareFeet: 8000, zoning: 'Residential' },
    },
  }, {
    dataset: 'tax-history', status: 'ok', data: [{ taxYear: 2024, tax: 3400 }, { taxYear: 2025, tax: 0 }],
  }, {
    dataset: 'sales-history', status: 'ok', data: [{ saleDate: '2025-01-03', recordedDate: '2025-01-09', price: 410000 }],
  });
  const result = await createAttomMcpPropertyReader({ now, client: { getPropertyData: async () => sample } })(address);
  assert.deepEqual(result.profile, {
    address: '101 Fiction Lane, Example, CA 90001', attomId: 'fiction-1', apn: 'APN-1', fips: '06037',
    propertyType: 'Single family', beds: 3, baths: 2, livingSqft: 1500, yearBuilt: 1990, lotSqft: 8000,
    zoning: 'Residential', ownerName: 'Sample Owner', assessedTotalValue: 275000,
    taxYear: 2025, taxAmount: 0, recordedSaleAmount: 410000, recordedSaleDate: '2025-01-09', saleTransactionDate: '2025-01-03',
  });
});
test('zero bedrooms and baths survive while unavailable measurements leave room for REST to fill them', async () => {
  const sample = fixture();
  sample.structuredContent.results.push({
    dataset: 'overview', status: 'ok', data: {
      characteristics: { bedrooms: 0, bathrooms: 0, livingAreaSquareFeet: 0, yearBuilt: 0, lotSquareFeet: 0, lotAcres: 0.25 },
    },
  });
  const result = await createAttomMcpPropertyReader({ now, client: { getPropertyData: async () => sample } })(address);
  assert.equal(result.profile.beds, 0);
  assert.equal(result.profile.baths, 0);
  assert.equal(result.profile.lotAcres, 0.25);
  for (const field of ['livingSqft', 'yearBuilt', 'lotSqft']) assert.equal(field in result.profile, false);
});
test('invalid address does not call provider; valid request selects all datasets exactly once',async()=>{
 const calls=[];const reader=createAttomMcpPropertyReader({now,client:{getPropertyData:async a=>{calls.push(a);return fixture();}}});
 assert.equal((await reader({street:'incomplete'})).status,'invalid_address');assert.equal(calls.length,0);
 const result=await reader(address,{radius:0.5});assert.equal(calls.length,1);assert.equal(calls[0].datasets.length,20);assert.deepEqual(calls[0].property,{lookupMode:'splitAddress',address1:'101 Fiction Lane',address2:'Example, CA 90001'});assert.equal(result.status,'matched');assert.equal(result.profile.attomId,'fiction-1');
 assert.equal(result.sales.windowStart,'2025-01-01');assert.equal(result.sales.windowEnd,'2026-10-31');assert.equal(result.sales.partial,true);assert.equal(result.sales.sales.length,1);assert.equal(result.sales.sales[0].baths,1.5);
});
test('conflicting canonical and dataset identity fails closed',async()=>{
 for(const mutate of [s=>s.property.address.line1='999 Wrong Rd',s=>s.results[0].data.attomId='other',s=>s.results[0].data.identifiers.apn='other',s=>s.results[0].data.identifiers.fips='other',s=>s.results.push({dataset:'valuation',status:'ok',data:{summary:{apn:'other'}}})]){const s=fixture();mutate(s.structuredContent);const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>s}})(address);assert.equal(r.status,'ambiguous');assert.equal(r.profile,undefined);}
});
test('comps reject subject invalid date negative measurements and outside radius',async()=>{
 const s=fixture();const c=s.structuredContent.results[1].data;const valid=c.results[0];c.results=[valid,{...valid,attomId:'fiction-1'},{...valid,attomId:'x',saleDate:'2026-02-30'},{...valid,attomId:'y',squareFootage:-1},{...valid,attomId:'z',distanceMiles:2}];
 const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>s}})(address,{radius:0.5});assert.equal(r.sales.sales.length,1);
});

test('observed comparable timestamp dates produce canonical saved date-only sales',async()=>{
 const s=fixture();s.structuredContent.results[1].data.results[0].saleDate='2026-02-03T00:00:00';
 const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>s}})(address);assert.equal(r.sales?.sales[0].soldDate,'2026-02-03');
});
test('all subject identity positions including nested arrays reject conflicts; alternate address spellings must agree',async()=>{
 for(const mutate of [s=>s.property.address.oneLine='999 Wrong Road, Example, CA 90001',s=>s.results.push({dataset:'ownership-periods',status:'ok',data:{ownershipPeriods:[{attomId:'other'}]}}),s=>s.results.push({dataset:'valuation',status:'ok',data:{address:{...addr,oneLine:'999 Wrong Road, Example, CA 90001'}}})]) {
 const s=fixture();mutate(s.structuredContent);const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>s}})(address);assert.equal(r.status,'ambiguous');assert.equal(r.sections.some(s=>Object.keys(s.facts).length||s.rows.length),false);
 }
});
test('top errors timeouts unavailable and duplicates never project provider evidence',async()=>{
 const fail=fixture();fail.structuredContent.status='error';
 const dup=fixture();dup.structuredContent.results.push(dup.structuredContent.results[0]);
 for(const sample of [fail,dup,{isError:true,...fixture()}]) {const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>sample}})(address);assert.notEqual(r.status,'matched');assert.equal(r.sections.length,20);assert.equal(r.sections.some(s=>Object.keys(s.facts).length||s.rows.length),false);}
 const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>{throw Object.assign(new Error('private'),{code:'attom_mcp_timed_out'})}}})(address);assert.equal(r.status,'timed_out');assert.ok(r.sections.every(s=>s.status==='timed_out'));
});
test('parcelId is the observed APN alias and cannot conflict with canonical identifiers',async()=>{
 for(const extra of [{parcelId:'OTHER'}, {summary:{parcelId:'OTHER'}}]) {
 const s=fixture();s.structuredContent.results.push({dataset:'valuation',status:'ok',data:{attomId:'fiction-1',...extra}});
 const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>s}})(address);assert.equal(r.status,'ambiguous');
 }
});
test('comparable coverage never exceeds the verified source radius',async()=>{
 const s=fixture();const c=s.structuredContent.results[1].data;c.criteria.maxDistanceMiles=1;c.results.push({...c.results[0],attomId:'fiction-3',address:'103 Fiction Lane, Example, CA 90001',distanceMiles:2});
 const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>s}})(address,{radius:5});assert.equal(r.sales?.radiusMiles,1);assert.equal(r.sales?.sales.length,1);
 for(const invalid of [undefined,0,-1,Infinity,10001]) {c.criteria.maxDistanceMiles=invalid;const r=await createAttomMcpPropertyReader({now,client:{getPropertyData:async()=>s}})(address,{radius:5});assert.equal(r.sales,undefined);}
});
