import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { lookupAttomPropertyPreview } from './attom-property-preview.mjs';

const input = {
  street: '123 Fixture Avenue Apt 2',
  city: 'Example City',
  state: 'CA',
  zip: '90210',
};
const parcel = {
  identifier: { attomId: 12345, fips: '06037', apn: '001-02' },
  address: {
    line1: '123 FIXTURE AVE #2',
    locality: 'EXAMPLE CITY',
    countrySubd: 'CA',
    postal1: '90210',
  },
  lot: { lotSize1: 0.2, lotSize2: 8712 },
  summary: { propType: 'Condominium', yearBuilt: 1986 },
  building: { size: { livingSize: 1200, bldgSize: 1700 }, rooms: { beds: 2, bathsTotal: 1.5 } },
  assessment: {
    tax: { taxAmt: 3600, taxYear: 2025 },
    owner: { owner1: { firstnameandmi: 'Fixture', lastname: 'Owner' } },
  },
  sale: { saleAmountData: { saleAmt: 430000, saleRecDate: '2024-01-02' } },
  photoUrls: ['https://example.invalid/private.jpg'],
};
const reply = (property) => Response.json({ status: { code: 0 }, property });
const config = (request) => ({ enabled: true, apiKey: 'fixture-only', request });

const originalKeys =
  'address attomId fips apn propertyType lotSqft lotAcres livingSqft beds baths yearBuilt taxAmount taxYear recordedSaleAmount recordedSaleDate'.split(
    ' '
  );

test('sends only the structured address to ATTOM and projects an allowlisted preview', async () => {
  const result = await lookupAttomPropertyPreview(
    { ...input, email: 'not-for-attom@example.invalid' },
    config(async (url, options) => {
      assert.equal(
        url.origin + url.pathname,
        'https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile'
      );
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        address1: input.street,
        address2: 'Example City, CA 90210',
      });
      assert.equal(options.headers.apikey, 'fixture-only');
      assert.equal(options.redirect, 'error');
      return reply([parcel]);
    })
  );
  assert.equal(result.status, 'matched');
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result.profile).filter(([key]) => originalKeys.includes(key))
    ),
    {
      address: '123 FIXTURE AVE #2, EXAMPLE CITY, CA 90210',
      attomId: '12345',
      fips: '06037',
      apn: '001-02',
      propertyType: 'Condominium',
      lotSqft: 8712,
      lotAcres: 0.2,
      livingSqft: 1200,
      beds: 2,
      baths: 1.5,
      yearBuilt: 1986,
      taxAmount: 3600,
      taxYear: 2025,
      recordedSaleAmount: 430000,
      recordedSaleDate: '2024-01-02',
    }
  );
});

test('never chooses the wrong unit or a duplicate exact parcel', async () => {
  const wrong = { ...parcel, address: { ...parcel.address, line1: '123 FIXTURE AVE #3' } };
  assert.equal(
    (
      await lookupAttomPropertyPreview(
        input,
        config(async () => reply([wrong]))
      )
    ).status,
    'ambiguous'
  );
  assert.equal(
    (
      await lookupAttomPropertyPreview(
        input,
        config(async () => reply([parcel, parcel]))
      )
    ).status,
    'ambiguous'
  );
});

test('accepts a comma-separated address, but refuses incomplete or conflicting input before fetching', async () => {
  const full = { street: '123 Fixture Avenue Apt 2, Example City, CA 90210' };
  assert.equal(
    (
      await lookupAttomPropertyPreview(
        full,
        config(async () => reply([parcel]))
      )
    ).status,
    'matched'
  );
  const noRequest = config(async () => assert.fail('No upstream request expected'));
  assert.equal(
    (await lookupAttomPropertyPreview({ street: input.street }, noRequest)).status,
    'invalid_address'
  );
  assert.equal(
    (await lookupAttomPropertyPreview({ ...full, city: 'Different City' }, noRequest)).status,
    'invalid_address'
  );
});

test('keeps disabled, no results, and provider failure separate', async () => {
  assert.equal(
    (
      await lookupAttomPropertyPreview(input, {
        ...config(async () => assert.fail('No upstream request expected')),
        enabled: false,
      })
    ).status,
    'not_configured'
  );
  assert.equal(
    (
      await lookupAttomPropertyPreview(
        input,
        config(async () => Response.json({ status: { code: 400 } }, { status: 400 }))
      )
    ).status,
    'not_found'
  );
  assert.equal(
    (
      await lookupAttomPropertyPreview(
        input,
        config(async () => Response.json({ status: { code: 0 } }))
      )
    ).status,
    'unavailable'
  );
});

test('reports actionable failure categories without exposing upstream content or retrying', async () => {
  for (const [http, expected] of [
    [401, 'authorization_failed'],
    [403, 'authorization_failed'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ]) {
    let attempts = 0;
    const result = await lookupAttomPropertyPreview(
      input,
      config(async () => {
        attempts += 1;
        return Response.json({ diagnostic: 'sensitive upstream payload' }, { status: http });
      })
    );
    assert.deepEqual(result, { status: expected });
    assert.equal(attempts, 1);
  }
  assert.deepEqual(
    await lookupAttomPropertyPreview(
      input,
      config(async () => {
        throw new DOMException('sensitive error message', 'TimeoutError');
      })
    ),
    { status: 'timed_out' }
  );
});

test('projects documented basicprofile ownership, assessment, transfer and original mortgages without inventing payoff', async () => {
  const row = structuredClone(parcel);
  row.area = { countrySecSubd: 'Fixture County', subdName: 'Sample Acres' };
  row.lot.zoningType = 'R1';
  row.building.summary = { unitsCount: 2, levels: 1 };
  row.assessment.owner = {
    owner1: { firstnameandmi: 'Fixture', lastname: 'Owner' },
    owner2: { lastname: 'Coowner' },
    mailingAddressOneLine: 'PO Box Fixture',
    absenteeOwnerStatus: 'A',
    secret: 'discard',
  };
  row.assessment.assessed = { assdLandValue: 100000, assdImprValue: 150000, assdTtlValue: 250000 };
  row.assessment.market = { mktTtlValue: 400000 };
  row.assessment.mortgage = {
    FirstConcurrent: {
      amount: '210000',
      LenderFirstName: 'Fixture Bank',
      trustDeedDocumentNumber: 'DOC-1',
      currentBalance: 123,
    },
  };
  row.sale.saleTransDate = '2023-12-29';
  row.sale.saleAmountData.saleDocNum = 'TRANSFER-1';
  row.sale.saleAmountData.saleTransType = 'S';
  const { profile } = await lookupAttomPropertyPreview(
    input,
    config(async () => reply([row]))
  );
  assert.equal(profile.ownerName, 'Fixture Owner');
  assert.equal(profile.owner2Name, 'Coowner');
  assert.equal(profile.ownerMailingAddress, 'PO Box Fixture');
  assert.equal(profile.assessedTotalValue, 250000);
  assert.equal(profile.assessmentMarketTotalValue, 400000);
  assert.equal(profile.originalMortgageAmount, 210000);
  assert.equal(profile.originalMortgageLender, 'Fixture Bank');
  assert.equal(profile.originalMortgageDocumentNumber, 'DOC-1');
  assert.equal(profile.saleTransactionDate, '2023-12-29');
  assert.equal(profile.saleTransactionType, 'S');
  assert.equal(profile.secondOriginalMortgageAmount, null);
  assert.equal(profile.currentBalance, undefined);
  assert.equal(profile.arv, undefined);
  assert.equal(profile.photoUrls, undefined);
  assert.equal(profile.secret, undefined);
});

test('missing or malformed new records remain unknown rather than zero or inferred facts', async () => {
  const row = structuredClone(parcel);
  row.assessment.assessed = { assdTtlValue: -1 };
  row.assessment.mortgage = { FirstConcurrent: { amount: 0 } };
  row.vintage = { pubDate: 'not a date' };
  const { profile } = await lookupAttomPropertyPreview(
    input,
    config(async () => reply([row]))
  );
  assert.equal(profile.assessedTotalValue, null);
  assert.equal(profile.originalMortgageAmount, null);
  assert.equal(profile.sourcePublishedDate, null);
  assert.equal(profile.buildingSqft, 1700);
});

test('projects additional documented BasicProfile paths with signed geography and string identifiers', async () => {
  const row = structuredClone(parcel);
  row.lot = { ...row.lot, depth: '125.5', frontage: '60', lotNum: '0007' };
  row.area = { subdTractNum: '00123', censusTractIdent: '000101', censusBlockGroup: '02' };
  row.location = { latitude: '-33.8', longitude: '-118.4', accuracy: 'Rooftop', elevation: '-12' };
  row.summary = { ...row.summary, propSubType: 'Detached', dateOfLastQuitClaim: '2024-02-29' };
  row.building.interior = {
    bsmtSize: '400',
    bsmttype: 'Partial',
    bsmtFinishedPercent: '50',
    fplcCount: 0,
  };
  row.building.rooms = { ...row.building.rooms, bathsFull: '2', roomsTotal: '7' };
  row.assessment.market = { mktLandValue: '100000', mktImprValue: '120000' };
  row.assessment.tax.taxPerSizeUnit = '2.5';
  row.assessment.improvementPercent = '60';
  const { profile } = await lookupAttomPropertyPreview(
    input,
    config(async () => reply([row]))
  );
  for (const [key, value] of Object.entries({
    lotDepth: 125.5,
    lotFrontage: 60,
    lotNumber: '0007',
    subdivisionTractNumber: '00123',
    censusTractIdentifier: '000101',
    censusBlockGroup: '02',
    latitude: -33.8,
    longitude: -118.4,
    elevation: -12,
    locationAccuracy: 'Rooftop',
    propertySubType: 'Detached',
    lastQuitClaimDate: '2024-02-29',
    basementSqft: 400,
    basementType: 'Partial',
    basementFinishedPercent: 50,
    fireplaceCount: 0,
    fullBaths: 2,
    totalRooms: 7,
    assessmentMarketLandValue: 100000,
    assessmentMarketImprovementValue: 120000,
    taxPerSizeUnit: 2.5,
    assessmentImprovementPercent: 60,
  }))
    assert.equal(profile[key], value, key);
});

test('rejects invalid ranges, malformed scalars and impossible dates', async () => {
  const row = structuredClone(parcel);
  row.location = { latitude: 91, longitude: -181, elevation: Infinity };
  row.lot.lotNum = 'x'.repeat(101);
  row.building.interior = { bsmtFinishedPercent: 101, fplcCount: -1 };
  row.summary.dateOfLastQuitClaim = '2025-02-29';
  row.sale.saleAmountData.saleRecDate = '2024-02-31';
  const { profile } = await lookupAttomPropertyPreview(
    input,
    config(async () => reply([row]))
  );
  for (const key of [
    'latitude',
    'longitude',
    'elevation',
    'lotNumber',
    'basementFinishedPercent',
    'fireplaceCount',
    'lastQuitClaimDate',
    'recordedSaleDate',
  ])
    assert.equal(profile[key], null, key);
});

test('projects the remaining documented utilities, construction, room, area and sale fields', async () => {
  const row = structuredClone(parcel);
  row.summary = { ...row.summary, propLandUse: 'SFR', propIndicator: '10', legal1: 'LOT 7' };
  row.utilities = {
    coolingType: 'Central',
    heatingType: 'Forced air',
    heatingFuel: 'Gas',
    energyType: 'Electric',
    sewerType: 'Public',
    wallType: 'Brick',
  };
  row.building.size = {
    ...row.building.size,
    grossSize: 2100,
    grossSizeAdjusted: 2000,
    groundFloorSize: 1200,
    atticSize: 300,
    sizeInd: 'Living',
  };
  row.building.rooms = { ...row.building.rooms, bathsPartial: 1, bathFixtures: 7 };
  row.building.interior = { floors: 'Carpet', fplcInd: 'Y', fplcType: 'Masonry' };
  row.building.construction = {
    foundationType: 'Slab',
    frameType: 'Wood',
    buildingShapeType: 'R',
    buildingShapeDescription: 'Rectangle',
  };
  row.building.parking = { garageType: 'Attached', prkgSize: 400, prkgType: 'Garage' };
  row.building.summary = { storyDesc: 'Two story', view: 'Valley', viewCode: '001' };
  row.sale.saleAmountData = {
    ...row.sale.saleAmountData,
    saleCode: '001',
    saleDisclosureType: 'Full',
  };
  row.currentBalance = 1;
  row.waterType = 'invented';
  let calls = 0;
  const { profile } = await lookupAttomPropertyPreview(
    input,
    config(async () => {
      calls++;
      return reply([row]);
    })
  );
  assert.equal(calls, 1);
  const expected = {
    propertyLandUse: 'SFR',
    propertyIndicator: '10',
    legalDescription: 'LOT 7',
    coolingType: 'Central',
    heatingType: 'Forced air',
    heatingFuel: 'Gas',
    energyType: 'Electric',
    sewerType: 'Public',
    wallType: 'Brick',
    grossSqft: 2100,
    adjustedGrossSqft: 2000,
    groundFloorSqft: 1200,
    atticSqft: 300,
    sizeIndicator: 'Living',
    partialBaths: 1,
    bathFixtures: 7,
    floors: 'Carpet',
    fireplaceIndicator: 'Y',
    fireplaceType: 'Masonry',
    foundationType: 'Slab',
    frameType: 'Wood',
    buildingShapeType: 'R',
    buildingShapeDescription: 'Rectangle',
    garageType: 'Attached',
    parkingSqft: 400,
    parkingType: 'Garage',
    storyDescription: 'Two story',
    view: 'Valley',
    viewCode: '001',
    saleCode: '001',
    saleDisclosureType: 'Full',
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(profile[key], value, key);
  assert.equal(profile.waterType, undefined);
  assert.equal(profile.currentBalance, undefined);
});
