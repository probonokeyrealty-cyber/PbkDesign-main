import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAvaChatScope } from '../src/app/utils/avaChatScope.mjs';

test('general chat retains its legacy storage keys without an explicit lead', () => {
  const expected = {
    valid: true,
    identity: 'general',
    leadId: '',
    storageKeys: {
      operatorMemory: 'pbk:ava-chat:operator-memory',
      assistantSession: 'pbk:ava-chat:assistant-session',
      assistantExchanges: 'pbk:ava-chat:assistant-exchanges',
    },
  };
  for (const search of ['', '?', '?threadId=general&prompt=%ZZ', '?leadid=ignored', '?lead%2549d=ignored', '?leadId%20=ignored', '?&&theme&=ignored']) {
    assert.deepEqual(resolveAvaChatScope(search), expected, search);
  }
});

test('raw and once-decoded aliases preserve the same exact lead identity and slots', () => {
  const expected = {
    valid: true,
    identity: 'lead:PBK%20%C3%A9%2B%3D%3A',
    leadId: 'PBK é+=:',
    storageKeys: {
      operatorMemory: 'pbk:ava-chat:lead:PBK%20%C3%A9%2B%3D%3A:operator-memory',
      assistantSession: 'pbk:ava-chat:lead:PBK%20%C3%A9%2B%3D%3A:assistant-session',
      assistantExchanges: 'pbk:ava-chat:lead:PBK%20%C3%A9%2B%3D%3A:assistant-exchanges',
    },
  };
  for (const search of [
    '?leadId=PBK+%C3%A9%2B%3D%3A',
    '?lead_id=PBK%20é%2b=:',
    '?%6Cead%49d=PBK+é%2B=:&unrelated=%C0%AF',
    '?prompt=%ZZ&le%61d%5Fid=PBK+é%2B=:&theme',
  ]) {
    assert.deepEqual(resolveAvaChatScope(search), expected, search);
  }
});

test('explicit ambiguous, empty, malformed or unsafe lead context fails closed', () => {
  for (const search of [
    'leadId=missing-question-mark',
    '?leadId',
    '?lead_id=',
    '?lead_id=&leadId=sample',
    '?leadId=sample&leadId=sample',
    '?lead_id=sample&lead_id=other',
    '?leadId=sample&%6cead%49d=other',
    '?%6cead%5fid=sample&leadId=sample',
    '?leadId=+sample',
    '?lead_id=sample%20',
    '?leadId=%C2%A0sample',
    '?leadId=sample%E3%80%80',
    '?leadId=some%00thing',
    '?leadId=some%09thing',
    '?leadId=some%7Fthing',
    '?leadId=some%C2%85thing',
    '?leadId=some\u001fthing',
    '?leadId=%',
    '?leadId=%2',
    '?leadId=%GG',
    '?leadId=%C0%AF',
    '?leadId=%F0%9F%92',
    '?leadId=%ED%A0%80',
    '?leadId=\uD800',
    '?leadId=\uDFFF',
    '?lead%ZZId=sample',
    '?%C0%AF=unrelated&leadId=sample',
    '?unrelated\uD800=value&leadId=sample',
    '?leadId=sample&%FF=unrelated',
  ]) {
    assert.deepEqual(resolveAvaChatScope(search), { valid: false }, JSON.stringify(search));
  }
});

test('lead and raw search limits count UTF-16 code units including the question mark', () => {
  const lead = '😀'.repeat(128);
  const limitQuery = '?leadId=valid&other=' + 'a'.repeat(3980);
  assert.equal(limitQuery.length, 4000);
  assert.equal(resolveAvaChatScope(`?leadId=${lead}`).leadId, lead);
  assert.equal(resolveAvaChatScope(`?leadId=${encodeURIComponent(lead)}`).leadId, lead);
  assert.deepEqual(resolveAvaChatScope(`?leadId=${lead}a`), { valid: false });
  assert.equal(resolveAvaChatScope(limitQuery).leadId, 'valid');
  assert.deepEqual(resolveAvaChatScope(limitQuery + 'a'), { valid: false });
});

test('general, separators, literal escapes, case and normalization cannot collide', () => {
  const scopes = [
    ['', 'general'],
    ['?leadId=general', 'lead:general'],
    ['?leadId=%3A', 'lead:%3A'],
    ['?leadId=%253A', 'lead:%253A'],
    ['?leadId=a%3Aassistant-exchanges', 'lead:a%3Aassistant-exchanges'],
    ['?leadId=a%20b', 'lead:a%20b'],
    ['?leadId=a%2Bb', 'lead:a%2Bb'],
    ['?leadId=CASE', 'lead:CASE'],
    ['?leadId=case', 'lead:case'],
    ['?leadId=%C3%A9', 'lead:%C3%A9'],
    ['?leadId=e%CC%81', 'lead:e%CC%81'],
  ].map(([search, identity]) => {
    const scope = resolveAvaChatScope(search);
    assert.equal(scope.identity, identity);
    assert.equal(Object.keys(scope.storageKeys).length, 3);
    return scope;
  });
  const keys = scopes.flatMap((scope) => Object.values(scope.storageKeys));
  assert.equal(new Set(keys).size, keys.length);
});
