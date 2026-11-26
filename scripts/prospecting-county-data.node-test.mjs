import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findCounties,
  getCountySource,
  makeCountyResearchBrief,
  parseCountyParcelCsv,
  searchCountyParcels,
} from '../src/app/utils/prospectingCountyData.mjs';

test('the Census directory resolves names, county equivalents, state filters and exact FIPS', () => {
  assert.equal(findCounties('Los Angeles County, CA').items[0].fips, '06037');
  assert.equal(findCounties('06037').items[0].name, 'Los Angeles County');
  assert.equal(findCounties('Orleans Parish', 'LA').items[0].fips, '22071');
  assert.equal(findCounties('Lincoln', 'OR').items[0].state, 'OR');
  assert.equal(findCounties('99999').total, 0);
  assert.equal(findCounties('').items.length, 0);
});

test('only the reviewed county has a file reader and fixed publisher links', () => {
  const source = getCountySource('06037');
  assert.equal(source.localCsv, true);
  assert.ok(source.links.every(link => new URL(link.href).protocol === 'https:'));
  assert.equal(getCountySource('22071'), null);
  assert.match(makeCountyResearchBrief(findCounties('22071').items[0]), /Orleans Parish, LA \(FIPS 22071\)/);
  assert.match(makeCountyResearchBrief(findCounties('22071').items[0]), /commercial use/i);
  assert.match(makeCountyResearchBrief(findCounties('22071').items[0]), /do not bypass/i);
});

test('the parcel preview parses quoted addresses, preserves zeroes, and discards contact columns', () => {
  const rows = parseCountyParcelCsv(
    '\uFEFFAIN,Property Location,Roll Year,Property Use Type,Owner Name,Phone\r\n' +
    '0123-456-789,"14 Example Lane, Van Nuys, CA",2025,Residential,Private Name,5550100\r\n' +
    '2243016029,"15 Example Lane, Van Nuys, CA",2024,Residential,Private Name,5550101\r\n',
    '06037',
  );
  assert.deepEqual(rows[0], {
    ain: '0123456789', address: '14 Example Lane, Van Nuys, CA', rollYear: '2025', use: 'Residential',
  });
  assert.equal(searchCountyParcels(rows, '0123-456-789').total, 1);
  assert.equal(searchCountyParcels(rows, 'example lane van nuys').total, 2);
  assert.equal(searchCountyParcels(rows, 'Private Name').total, 0);
  assert.equal(searchCountyParcels(rows, '').total, 0);
});

test('the preview refuses unreviewed counties, unsupported headers, and malformed rows', () => {
  const csv = 'AIN,SitusAddress\n2243016029,Example Lane\n';
  assert.throws(() => parseCountyParcelCsv(csv, '22071'), /not available/i);
  assert.throws(() => parseCountyParcelCsv('owner,phone\nc,d\n', '06037'), /column/i);
  assert.throws(() => parseCountyParcelCsv('AIN,SitusAddress\n2243016029,"unfinished\n', '06037'), /valid CSV/i);
  assert.throws(() => parseCountyParcelCsv('AIN,AIN,SitusAddress\n1,2,x\n', '06037'), /column/i);
  assert.throws(() => parseCountyParcelCsv('AIN,SitusAddress\nnot-an-AIN,Example Lane\n', '06037'), /no usable/i);
});

test('parcel filters work alone and intersect with address or AIN search', () => {
  const rows = parseCountyParcelCsv(
    'AIN,SitusAddress,Roll Year,Use Type\n' +
    '0123456789,14 Example Lane,2025,Residential\n' +
    '0123456790,15 Example Lane,2024,Residential\n' +
    '0123456791,16 Example Lane,2025,Commercial\n', '06037');
  assert.deepEqual(searchCountyParcels(rows, '', { use: 'Residential', rollYear: '2025' }).items.map(row => row.ain), ['0123456789']);
  assert.equal(searchCountyParcels(rows, 'example lane', { rollYear: '2025' }).total, 2);
  assert.equal(searchCountyParcels(rows, '0123-456-789', { use: 'Commercial' }).total, 0);
  assert.equal(searchCountyParcels(rows, 'ex', { rollYear: '2025' }).total, 0);
});
