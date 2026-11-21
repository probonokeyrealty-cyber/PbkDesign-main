import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const text = readFileSync(new URL('../src/app/utils/leadQueueReturn.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { readLeadQueueReturn } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('the existing return adapter accepts a bounded Analytics handoff without inventing another system', () => {
  const input = { path: '/analytics', search: '?range=7d&focus=stage%3Aclosed',
    leadId: 'SYN-LEAD', scrollY: 120 };
  assert.deepEqual(readLeadQueueReturn(input), input);
  assert.equal(readLeadQueueReturn({ ...input, path: 'https://external.example' }), null);
  assert.equal(readLeadQueueReturn({ ...input, search: 'javascript:alert(1)' }), null);
  assert.equal(readLeadQueueReturn({ ...input, scrollY: Infinity }), null);
});
