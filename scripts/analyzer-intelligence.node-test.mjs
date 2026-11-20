import test from 'node:test';
import assert from 'node:assert/strict';
import { intelligenceRequest, mergeAnalyzerIntelligence, resetChangedProperty } from '../src/app/utils/analyzerIntelligence.mjs';
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
test('changing a linked property releases inherited subject facts and comps without mutating the saved lead', () => {
  const prior=structuredClone(blank);
  const reset=resetChangedProperty(blank,'99 Different Lane, Example City, CA 90210');
  assert.equal(reset.comps.B.address,''); assert.equal(reset.price,0);
  assert.equal(reset.repairs.mid,0); assert.equal(reset.rent,0); assert.equal(reset.zipCode,''); assert.deepEqual(reset.confirmedTerms,{}); assert.equal(reset.agreedPrice,0);
  assert.deepEqual(blank,prior);
  assert.deepEqual(resetChangedProperty(blank,address),{});
  assert.deepEqual(resetChangedProperty({...blank,leadId:undefined},'New typing'),{});
});
test('protects a manually edited slot while filling other empty slots and preserving an ARV override', () => {
  const deal={...blank,arv:600000,compManualSlots:['A'],comps:{A:{address:'Manual',price:499999},B:{address:'',price:0},C:{address:'',price:0}}};
  const evidence={...response,patch:{deal:{comps:{A:{address:'Replacement',price:440000},B:{address:'New candidate',price:460000,date:'2026-11-01',link:''}}}}};
  const next=mergeAnalyzerIntelligence(deal,evidence,new Set(['comps','arv']));
  assert.equal(next.comps.A.price,499999);
  assert.equal(next.comps.B.price,460000);
  assert.deepEqual(next.compManualSlots,['A']);
  assert.equal(next.arv,undefined);
});
