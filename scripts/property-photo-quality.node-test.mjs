import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('src/app/utils/propertyEvidence.ts','utf8').replace("'./attomRecordFields.mjs'", JSON.stringify(new URL('../src/app/utils/attomRecordFields.mjs', import.meta.url).href)).replace("'./attomMcpSections.mjs'", JSON.stringify(new URL('../src/app/utils/attomMcpSections.mjs', import.meta.url).href)),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {fullSizePhotoUrl}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('request a larger rendition of the same trusted listing photo',()=>{
 assert.equal(fullSizePhotoUrl('https://ap.rdcpix.com/fixture-m101s.jpg'),'https://ap.rdcpix.com/fixture-m101od-w1920_h1440.webp');
});
test('leave original/full-size and unknown photo URLs intact without guessing another property or host',()=>{
 for(const url of ['https://ap.rdcpix.com/fixture-m101o.jpg','https://ap.rdcpix.com/fixture-m101od-w1280_h960.webp','https://ap.rdcpix.com/fixture-front.jpg','https://other.example/fixture-m101s.jpg','https://ap.rdcpix.com.evil.example/fixture-m101s.jpg','https://user:pass@ap.rdcpix.com/fixture-m101s.jpg','http://ap.rdcpix.com/fixture-m101s.jpg','https://ap.rdcpix.com/'+'a'.repeat(2200)+'-m101s.jpg'])assert.equal(fullSizePhotoUrl(url),url);
});
