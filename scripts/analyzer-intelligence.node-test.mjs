import test from 'node:test';
import assert from 'node:assert/strict';
import { intelligenceRequest, mergeAnalyzerIntelligence } from '../src/app/utils/analyzerIntelligence.mjs';
const address = '24 Sample Oak Lane, Example City, CA 90210';
const blank = { address, leadId: 'lead-a', beds: 0, price: 0, comps: { A: {address:'',price:0}, B: {address:'Manual',price:42}, C: {address:'',price:0} } };
test('captures exact linked identity and complete address without creating an unlinked lead', () => {
  assert.deepEqual(intelligenceRequest(blank).expectedPropertyAddress, {street:'24 Sample Oak Lane',city:'Example City',state:'CA',zip:'90210'});
  assert.equal(intelligenceRequest({...blank,leadId:undefined}).leadId, undefined);
  assert.throws(()=>intelligenceRequest({...blank,address:'Incomplete'}));
});
const response = {address, records:{status:'matched',profile:{beds:4,livingSqft:1800}}, listing:{cache:{hit:true},propertyData:{data:{askingPriceUsd:250000,priceBasis:'asking_price'}}}, patch:{deal:{comps:{A:{address:'Suggested',price:100}, B:{address:'Replacement',price:200}}, propertyRecordSnapshot:{address}}}};
test('fills missing facts and suggested slots while preserving manual values and protected clears', () => {
  const next = mergeAnalyzerIntelligence(blank,response,new Set(['beds']));
  assert.equal(next.beds, undefined);
  assert.equal(next.sqft, 1800);
  assert.equal(next.price,250000);
  assert.equal(next.comps.B.address,'Manual');
  assert.equal(next.comps.A.address,'Suggested');
  assert.equal(mergeAnalyzerIntelligence(blank,response,new Set(['comps'])).comps,undefined);
});
test('rejects another address and keeps evidence on a failed or empty lane', () => {
  assert.deepEqual(mergeAnalyzerIntelligence({...blank,address:'Other'},response),{});
  const next=mergeAnalyzerIntelligence({...blank,listingSnapshot:{photoUrls:['saved']}},{address,patch:{deal:{}},records:{status:'unavailable'},listing:{cache:{hit:false}}});
  assert.equal(next.listingSnapshot,undefined);
  assert.equal(next.price,undefined);
});
test('retains structured-address sales provenance and respects intentionally cleared comp slots', () => {
  const sales={address:{street:'24 Sample Oak Lane',city:'Example City',state:'CA',zip:'90210'},review:'suggested-unreviewed',sales:[]};
  const next=mergeAnalyzerIntelligence({...blank,compManualSlots:['A']},{...response,patch:{...response.patch,analyzer:{recordedSales:sales}}});
  assert.equal(next.recordedSales,sales);
  assert.equal(next.comps,undefined);
});
