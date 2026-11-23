import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const snapshot = JSON.parse(
  readFileSync(new URL('../src/app/data/public-zip-housing.json', import.meta.url), 'utf8'),
);

test('bundled housing observations preserve published sample values and suppressed estimates', () => {
  assert.deepEqual(snapshot['91401'].slice(0, 2), [[1881, 43], [1047700, 48091]]);
  assert.deepEqual(snapshot['00601'].slice(0, 2), [[427, 24], [94200, 9190]]);
  assert.equal(snapshot['90210'][1], null, 'A top-coded Census median is not an exact value');
  assert.equal(snapshot['00000'], undefined, 'No nearby geography substitutes for a missing code');
  assert.deepEqual(snapshot['01001'][2], [2025, -344]);
  assert.deepEqual(snapshot['91401'][2], [2025, -26]);
});

test('snapshot uses only compact, valid observations keyed by five-digit string codes', () => {
  const entries = Object.entries(snapshot);
  assert.ok(entries.length > 25_000, 'Postal and Census coverage should not collapse silently');
  const valid = (value) => Array.isArray(value) && value.length === 2
    && Number.isSafeInteger(value[0]) && value[0] > 0
    && Number.isSafeInteger(value[1]) && value[1] >= 0;
  for (const [code, row] of entries) {
    assert.match(code, /^[0-9]{5}$/);
    assert.equal(row.length, 3);
    assert.ok(row.some(value => value !== null));
    assert.ok(row[0] === null || valid(row[0]));
    assert.ok(row[1] === null || valid(row[1]));
    assert.ok(row[2] === null || (row[2].length === 2 && [2024, 2025].includes(row[2][0])
      && Number.isSafeInteger(row[2][1]) && row[2][1] > -10000));
  }
  assert.ok(entries.some(([, row]) => row[2]?.[1] === 0));
  assert.ok(entries.some(([, row]) => row[2]?.[1] < 0));
  assert.ok(entries.filter(([, row]) => row[2] !== null).length > 15_000);
});
