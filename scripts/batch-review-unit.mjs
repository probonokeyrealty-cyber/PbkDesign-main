import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReviewedBatch, buildBatchReview, parseBatchFile } from '../src/app/utils/batchReview.ts';
import { loadBatchReviewRoster } from './batch-review-roster.mjs';

test('batch phone plan holds shared numbers to one row and lets any DNC flag veto all rows', () => {
  const rows = parseBatchFile('sample.json', JSON.stringify([
    { address: '10 Test St', 'Phone 1': '2025550101', 'Phone 1 DNC': 'No', 'Phone 2': '2025550102', 'Phone 2 DNC': 'No' },
    { address: '20 Test St', 'Phone 1': '+1 (202) 555-0101', 'Phone 1 DNC': 'No', 'Phone 4': '2025550103', 'Phone 4 DNC': 'No' },
    { 'Phone 2': '+1 (202) 555-0102', 'Phone 2 DNC': 'Yes' },
    { address: '30 Test St', 'Phone 3': '2025550104', 'Phone 3 DNC': 'No' },
    { address: '40 Test St', 'Phone 1': '2025550105' },
    { address: '50 Test St', 'Phone 1': '2025550106', 'Phone 1 DNC': 'No' },
  ]));
  const roster = [{ id: 'saved', phones: [{ slot: 4, number: '2025550104', dnc: 'dnc' }] }];
  const result = applyReviewedBatch(rows, roster, [2, 1, 4, 5], (row) => `test-${row}`, ['+12025550103']);
  const byPhone = new Map(result.contactPlan.map((entry) => [entry.phone, entry]));
  assert.deepEqual(byPhone.get('2025550101'), { phone: '2025550101', rows: [1, 2], status: 'candidate', row: 1 });
  assert.equal(byPhone.get('2025550102').status, 'dnc');
  assert.equal(byPhone.get('2025550103').status, 'dnc');
  assert.equal(byPhone.get('2025550104').status, 'dnc');
  assert.equal(byPhone.get('2025550105').status, 'unknown');
  assert.equal(byPhone.get('2025550106').status, 'not-reviewed');
  assert.equal(result.summary.created, 4);
  assert.equal(result.leads.find(({ id }) => id === 'test-1').phones[1].dnc, 'not-dnc');
  assert.equal(result.leads.find(({ id }) => id === 'test-2').phones[0].number, '+1 (202) 555-0101');
});

test('batch contact reservation is shared by callers and texters and checks current DNC first', async () => {
  const { createBatchContactGuard } = await import('../src/app/utils/batchReview.ts');
  const rows = parseBatchFile('sample.csv', 'Address,Phone 1,Phone 1 DNC\n10 Test St,2025550101,No\n20 Test St,+1 202-555-0101,No\n30 Test St,2025550102,No');
  const { contactPlan } = applyReviewedBatch(rows, [], [1, 2, 3], (row) => `test-${row}`);
  const stopped = new Set();
  const guard = createBatchContactGuard(contactPlan, async (phone) => stopped.has(phone));
  assert.equal(await guard.reserve(2, '2025550101'), 'wrong-row');
  const attempts = await Promise.all([guard.reserve(1, '+1 202-555-0101'), guard.reserve(1, '2025550101')]);
  assert.deepEqual(attempts.sort(), ['already-reserved', 'reserved']);
  stopped.add('2025550101');
  stopped.add('2025550102');
  assert.equal(await guard.reserve(1, '2025550101'), 'dnc');
  assert.equal(await guard.reserve(3, '2025550102'), 'dnc');
  assert.equal(await guard.reserve(3, '2025550199'), 'not-in-plan');
  const unavailable = createBatchContactGuard(contactPlan, async () => { throw new Error('unavailable'); });
  assert.equal(await unavailable.reserve(1, '2025550101'), 'dnc-unavailable');
});

test('apply creates and fills only reviewed eligible rows without replacing saved fields or DNC', () => {
  const saved = [
    { id: 'lead-1', address: '10 Fixture St', seller: { name: 'Manual Owner' }, beds: 0,
      phones: [{ slot: 2, number: '2025550102', dnc: 'dnc', type: 'Mobile' }] },
    { id: 'conflict', address: '20 Fixture St', beds: 3 },
  ];
  const rows = parseBatchFile('sample.json', JSON.stringify([
    { leadId: 'lead-1', 'Property Address': '10 Fixture St', 'Owner Name': 'Manual Owner', 'Bedroom Count': 0,
      'Lot Size Square Feet': 100, 'Phone 1': '+1 202-555-0102', 'Phone 1 DNC': 'Yes' },
    { 'Property Address': '30 Fixture St', 'Phone 1': '2025550103', 'Phone 1 DNC': 'No',
      'Phone 2': '2025550104', 'Phone 2 DNC': 'Yes' },
    { leadId: 'conflict', 'Bedroom Count': 5 },
    { 'Property Address': '40 Fixture St', 'Phone 1 DNC': 'Yes' },
    { 'Property Address': '50 Fixture St' },
  ]));
  const baseline = structuredClone(saved);
  const result = applyReviewedBatch(rows, saved, [1, 2, 3, 4], (number) => `sample-${number}`);
  assert.deepEqual(result.summary, { created: 1, updated: 1, unchanged: 0, conflicts: 1, invalid: 1, unreviewed: 1 });
  assert.deepEqual(saved, baseline);
  assert.equal(result.leads[0].seller.name, 'Manual Owner');
  assert.equal(result.leads[0].beds, 0);
  assert.equal(result.leads[0].lotSqft, '100');
  assert.deepEqual(result.leads[0].phones, saved[0].phones);
  assert.deepEqual(result.leads[1], saved[1]);
  assert.deepEqual(result.leads[2].phones.map(({ number, dnc }) => [number, dnc]), [
    ['2025550103', 'not-dnc'], ['2025550104', 'dnc'],
  ]);
  const replay = applyReviewedBatch(rows, result.leads, [1, 2, 3, 4], (number) => `sample-${number}`);
  assert.equal(replay.summary.created + replay.summary.updated, 0);
  assert.equal(replay.leads.length, 3);
});

test('apply reclassifies against current saved data and refuses a DNC reversal', () => {
  const rows = parseBatchFile('sample.json', '[{"leadId":"lead-1","Phone 1":"2025550102","Phone 1 DNC":"No","Bedroom Count":2}]');
  const saved = [{ id: 'lead-1', phones: [{ slot: 2, number: '2025550102', dnc: 'dnc' }] }];
  const result = applyReviewedBatch(rows, saved, [1], () => 'sample-1');
  assert.equal(result.summary.conflicts, 1);
  assert.deepEqual(result.leads, saved);
});

const roster = [
  {
    id: 'lead-1',
    seller: { name: 'Manual Name' },
    property: { address: '10 Test St', city: 'Reno', state: 'NV', zip: '89501' },
    askingPrice: 200000,
  },
  { leadId: 'lead-2', address: '20 Test St, Reno, NV 89501', beds: 0 },
  { id: 'lead-3', address: '30 Test St, Reno, NV 89501' },
];

test('compares source fields without mutating the roster or confusing listing and valuation data', () => {
  const before = structuredClone(roster);
  const rows = parseBatchFile(
    'batch.csv',
    [
      'Lead ID,Property Address,Owner Name,Asking Price,Bedrooms,ARV',
      'lead-1,10 Test St,New Name,"$200,000",3,350000',
      'lead-2,"20 Test St, Reno, NV 89501",,,,',
      ',40 Test St,New Seller,180000,,',
      ',,Missing Address,180000,,',
    ].join('\n')
  );
  const review = buildBatchReview(rows, roster);
  assert.deepEqual(
    review.map(({ status }) => status),
    ['conflict', 'match', 'new', 'invalid']
  );
  const fields = review[0].fields;
  assert.deepEqual(
    fields.find(({ label }) => label === 'Owner name'),
    { label: 'Owner name', existing: 'Manual Name', incoming: 'New Name', disposition: 'preserved' }
  );
  assert.equal(fields.find(({ label }) => label === 'Asking price').disposition, 'same');
  assert.equal(fields.find(({ label }) => label === 'Bedrooms').disposition, 'empty');
  assert.equal(fields.find(({ label }) => label === 'ARV').disposition, 'unmapped');
  assert.deepEqual(roster, before);
});

test('treats address hints, unknown IDs and duplicate rows as conflicts', () => {
  const rows = parseBatchFile(
    'batch.json',
    JSON.stringify([
      { 'Property Address': '30 Test St' },
      { leadId: 'missing', address: '60 Test St' },
      { source_record_id: '001', address: '71 Test St' },
      { source_record_id: '001', address: '72 Test St' },
      { address: '80 Test St', city: 'Reno' },
      { address: '80 test st.', city: 'Reno' },
      { leadId: 'lead-2', bedrooms: 2 },
    ])
  );
  const review = buildBatchReview(rows, roster);
  assert.deepEqual(
    review.map(({ status }) => status),
    Array(7).fill('conflict')
  );
  assert.equal(review[0].candidates[0].id, 'lead-3');
  assert.equal(review[6].fields.find(({ label }) => label === 'Bedrooms').existing, '0');
});

test('keeps malformed rows visible and rejects ambiguous headers or malformed files', () => {
  const rows = parseBatchFile(
    'batch.csv',
    'address,zip,owner_name\n1 Test St,09A12,"O\nOwner"\n2 Test St,00123\n3 Test St,00124,Owner\n'
  );
  const review = buildBatchReview(rows, []);
  assert.deepEqual(
    review.map(({ status }) => status),
    ['invalid', 'invalid', 'new']
  );
  assert.equal(review[0].fields.find(({ label }) => label === 'Owner name').incoming, 'O\nOwner');
  assert.equal(review[2].fields.find(({ label }) => label === 'ZIP').incoming, '00124');
  assert.throws(() => parseBatchFile('bad.csv', 'address,Address\nOne,Two'), /unique/i);
  assert.throws(() => parseBatchFile('bad.csv', 'address,name\nOne,"Two'), /quot/i);
  assert.throws(() => parseBatchFile('bad.json', '{"address":"One"}'), /array/i);
  assert.throws(() => parseBatchFile('bad.csv', 'address'), /no data rows/i);
});

test('never chooses one of several address candidates or colliding lead IDs', () => {
  const rows = parseBatchFile(
    'batch.json',
    '[{"address":"40 Main St"},{"leadId":"same","owner":"Owner"}]'
  );
  const review = buildBatchReview(rows, [
    { id: 'same', address: '40 Main St, Reno, NV 89501' },
    { id: 'same', address: '40 Main St, Sparks, NV 89431' },
  ]);
  assert.deepEqual(
    review.map(({ status }) => status),
    ['conflict', 'conflict']
  );
  assert.equal(review[0].candidates.length, 2);
  assert.equal(review[1].fields.find(({ label }) => label === 'Owner name').existing, '');
});

test('reads every saved profile plus bridge-only leads without a write or a partial fallback', async () => {
  const bridge = [
    { id: 'both', address: 'Edited St', property: { beds: 0 } },
    { id: 'bridge-only', address: 'Bridge St' },
  ];
  const response = await loadBatchReviewRoster({
    bridgeLeads: bridge,
    query: async (sql, params) => {
      assert.match(sql, /^\s*SELECT\b/i);
      assert.match(sql, /public\.lead_profiles/);
      assert.equal(params[0], 'pbk');
      return {
        ok: true,
        rows: [
          { id: 'both', address: 'Old St', raw: { property: { beds: 4, baths: 2 } } },
          { id: 'database-only', address: 'Saved St' },
        ],
      };
    },
  });
  assert.equal(response.complete, true);
  assert.deepEqual(
    response.leads.map(({ id }) => id),
    ['both', 'database-only', 'bridge-only']
  );
  assert.equal(response.leads[0].address, 'Edited St');
  assert.deepEqual(response.leads[0].property, { beds: 0, baths: 2 });
  for (const result of [{ ok: false }, { ok: true, rows: [{ address: 'Missing identity' }] }]) {
    const unavailable = await loadBatchReviewRoster({
      bridgeLeads: bridge,
      query: async () => result,
    });
    assert.equal(unavailable.complete, false);
    assert.equal(unavailable.leads, undefined);
  }
  const partial = await loadBatchReviewRoster({
    bridgeLeads: [],
    query: async (_sql, [, limit]) => ({
      ok: true,
      rows: Array.from({ length: limit }, (_, i) => ({ id: String(i) })),
    }),
  });
  assert.equal(partial.complete, false);
});

test('maps BatchLeads facts and binds DNC and type to each numbered phone', () => {
  const rows = parseBatchFile(
    'batch.json',
    JSON.stringify([
      {
        'Property Address': '10 Fixture St',
        'Mailing City': 'Reno',
        'Bedroom Count': '3',
        'Bathroom Count': '2',
        'Total Building Area Square Feet': '1320',
        'Lot Size Square Feet': '5100',
        'Estimated Value': '220000',
        'Last Sale Price': '170000',
        'Equity Current Estimated Balance': '-2000',
        'Foreclosure Recording Date': '05-01-2025',
        'Phone 1': '(202) 555-0101',
        'Phone 1 DNC': 'No',
        'Phone 1 TYPE': 'Mobile',
        'Phone 2': '(202) 555-0102',
        'Phone 2 DNC': 'Yes',
        'Phone 2 TYPE': 'Landline',
        'Phone 3': '(202) 555-0103',
      },
      { 'Property Address': '11 Fixture St', 'Phone 2 DNC': 'Yes' },
      { 'Property Address': '12 Fixture St', 'Phone 1': 'bad', 'Phone 1 DNC': 'Yes' },
      { 'Property Address': '13 Fixture St', 'Phone 1': '2025550101', 'Phone 1 DNC': 'Maybe' },
      {
        'Property Address': '14 Fixture St',
        'Phone 1': '2025550101',
        'Phone 1 DNC': 'Yes',
        'Phone 2': '+12025550101',
        'Phone 2 DNC': 'No',
      },
    ])
  );
  const [row, ...invalid] = buildBatchReview(rows, []);
  assert.equal(row.status, 'new');
  assert.deepEqual(
    row.phones.map(({ slot, number, dnc, type }) => [slot, number, dnc, type]),
    [
      [1, '(202) 555-0101', 'not-dnc', 'Mobile'],
      [2, '(202) 555-0102', 'dnc', 'Landline'],
      [3, '(202) 555-0103', 'unknown', ''],
    ]
  );
  assert.ok(row.fields.some(({ label, incoming }) => label === 'Bedrooms' && incoming === '3'));
  assert.ok(row.fields.some(({ label }) => label === 'Estimated value'));
  assert.ok(row.fields.some(({ label }) => label === 'Last sale price'));
  assert.ok(
    row.fields.every(
      ({ disposition, label }) => disposition !== 'unmapped' && label !== 'ARV' && label !== 'City'
    )
  );
  assert.ok(invalid.every(({ status }) => status === 'invalid'));
});

test('compares saved phone flags by phone number rather than their original slot', () => {
  const rows = parseBatchFile(
    'batch.json',
    JSON.stringify([{ leadId: 'lead-1', 'Phone 1': '2025550102', 'Phone 1 DNC': 'No' }])
  );
  const [row] = buildBatchReview(rows, [
    {
      id: 'lead-1',
      'Phone 1': '2025550101',
      'Phone 1 DNC': 'No',
      'Phone 2': '+1 202 555 0102',
      'Phone 2 DNC': 'Yes',
    },
  ]);
  assert.equal(row.status, 'conflict');
  const comparison = row.fields.find(({ label }) => label === 'Phone 1');
  assert.match(comparison.existing, /0102.*\nDNC: Yes/);
  assert.match(comparison.incoming, /0102.*\nDNC: No/);
  assert.equal(comparison.disposition, 'preserved');
});
