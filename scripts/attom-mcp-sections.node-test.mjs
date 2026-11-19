import test from 'node:test';
import assert from 'node:assert/strict';
import {attomMcpDatasetDefinitions,projectAttomMcpSection,hydrateAttomMcpSections,mergeAttomMcpSections} from '../src/app/utils/attomMcpSections.mjs';
const time='2026-11-18T00:00:00.000Z';
test('twenty trusted definitions project only bounded typed evidence',()=>{
 assert.equal(attomMcpDatasetDefinitions.length,20);
 const s=projectAttomMcpSection('mortgage-history',Array.from({length:30},()=>({originalAmount:123000,lender:'Fictional Bank',documentNumber:{bad:1},secret:'ignore'})),'ok',time);
 assert.equal(s.rows.length,20);assert.equal(s.rows[0].originalAmount,123000);assert.equal(s.rows[0].secret,undefined);assert.equal(s.rows[0].documentNumber,undefined);assert.match(s.caveats.join(' '),/payoff/i);
});
test('strict hydration strips labels unknown keys unsafe dates and malformed scalars',()=>{
 const s=hydrateAttomMcpSections([{id:'equity',status:'ok',checkedAt:time,retrievedAt:time,facts:{estimatedValue:123,estimatedDebt:-2,availableEquity:Infinity,evil:'bad'},rows:[],caveats:['provider lie'],title:'bad'}, {id:'unknown',status:'ok',checkedAt:time}, {id:'identity',status:'ok',checkedAt:'not date'}]);
 assert.equal(s.length,1);assert.deepEqual(s[0].facts,{estimatedValue:123});assert.equal(s[0].title,undefined);assert.ok(!s[0].caveats.includes('provider lie'));
});
test('failed missing and empty refresh retain success and original time',()=>{
 const old=projectAttomMcpSection('equity',{estimatedValue:100},'ok',time);
 for(const next of [[],[projectAttomMcpSection('equity',{},'ok','2026-11-19T00:00:00Z')],[projectAttomMcpSection('equity',{},'timed_out','2026-11-19T00:00:00Z')]]){
 const s=mergeAttomMcpSections([old],next)[0];assert.equal(s.facts.estimatedValue,100);assert.equal(s.retrievedAt,time);if(next.length)assert.ok(s.refreshStatus);
 }
});
test('unknown foreclosure and permit shapes remain unsupported and empty is not proof',()=>{
 assert.equal(projectAttomMcpSection('permits',[{amount:1}],'ok',time).status,'unsupported');
 const s=projectAttomMcpSection('foreclosure-history',[],'ok',time);assert.equal(s.status,'not_available');assert.match(s.caveats.join(' '),/absence/i);
});
test('observed source timestamps normalize valid calendar dates without accepting rollovers',()=>{
 const s=projectAttomMcpSection('sales-history',[{saleDate:'2026-02-03T00:00:00',recordedDate:'2026-02-04T00:00:00.000',price:10},{saleDate:'2026-02-30T00:00:00',price:20}],'ok',time);
 assert.equal(s.rows[0].saleDate,'2026-02-03');assert.equal(s.rows[1].saleDate,undefined);
 const f=attomMcpDatasetDefinitions.find(d=>d.id==='equity').fields.find(f=>f.key==='estimatedValue');assert.equal(f.unit,'USD');assert.equal(f.label,'Estimated value');
 const b=attomMcpDatasetDefinitions.find(d=>d.id==='overview').fields.find(f=>f.key==='characteristics.bedrooms');assert.equal(b.label,'Bedrooms');
});
test('bounded history is latest first with honest coverage metadata',()=>{
 const s=projectAttomMcpSection('tax-history',Array.from({length:30},(_,i)=>({taxYear:1990+i,tax:100+i})),'ok',time);
 assert.equal(s.rows[0].taxYear,2019);assert.equal(s.rows[19].taxYear,2000);assert.equal(s.sourceRowCount,30);assert.equal(s.truncated,true);
 const hydrated=hydrateAttomMcpSections([s])[0];assert.equal(hydrated.sourceRowCount,30);assert.equal(hydrated.truncated,true);
});
test('partial successful refresh cannot erase captured facts or row values or falsely freshen',()=>{
 const old=projectAttomMcpSection('equity',{estimatedValue:100,estimatedDebt:50},'ok',time);
 const fresh=projectAttomMcpSection('equity',{estimatedValue:110},'ok','2026-11-19T00:00:00Z');
 const kept=mergeAttomMcpSections([old],[fresh])[0];assert.equal(kept.facts.estimatedDebt,50);assert.equal(kept.retrievedAt,time);assert.equal(kept.refreshStatus.status,'partial');
 const rows=projectAttomMcpSection('mortgage-history',[{recordingDate:'2026-01-01',originalAmount:100,lender:'Fictional Bank'}],'ok',time);
 const lost=projectAttomMcpSection('mortgage-history',[{recordingDate:'2026-01-01',originalAmount:120}],'ok','2026-11-19T00:00:00Z');
 assert.equal(mergeAttomMcpSections([rows],[lost])[0].rows[0].lender,'Fictional Bank');
});
test('unverified loan to value scale is reported without a normalized ratio or percent unit',()=>{
 const d=attomMcpDatasetDefinitions.find(d=>d.id==='equity');const f=d.fields.find(f=>f.key==='loanToValueRatio');assert.equal(f.unit,undefined);assert.equal(f.label,'Loan to value (provider reported)');assert.match(d.note,/scale|meaning/i);
 const s=projectAttomMcpSection('equity',{loanToValueRatio:56.2},'ok',time);assert.equal(s.facts.loanToValueRatio,56.2);
});
