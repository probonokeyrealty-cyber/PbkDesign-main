import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildAnalyzerLeadPatch } from '../src/app/utils/analyzerLeadPersistence.mjs';
const source = readFileSync(
  new URL('../src/app/utils/propertyEvidence.ts', import.meta.url),
  'utf8'
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { captureListingSnapshot, readPropertyEvidence, photoLinks } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const address = '24 Sample Oak Lane, Example City, CA 90210';
const photo = 'https://ap.rdcpix.com/fixture-front.jpg';
const response = {
  cache: { hit: true },
  propertyData: {
    source: 'apify-for-sale',
    data: {
      askingPriceUsd: 450000,
      priceBasis: 'asking_price',
      photoUrls: [photo, photo, 'javascript:alert(1)', 'https://evil.example/photo.jpg'],
      sourceLinks: [
        'https://www.realtor.com/realestateandhomes-detail/fixture',
        'https://user:pass@zillow.com/unsafe',
      ],
      listingFacts: { beds: 3, dom: 12, sqft: 1800, privateField: 'discard' },
    },
  },
};

test('capture keeps bounded listing evidence, safe photos and source links without changing underwriting', () => {
  const snapshot = captureListingSnapshot(address, response, '2026-11-17T12:00:00Z');
  assert.deepEqual(snapshot.photoUrls, [photo]);
  assert.equal(snapshot.askingPrice, 450000);
  assert.deepEqual(snapshot.facts, { beds: 3, sqft: 1800, dom: 12 });
  assert.deepEqual(snapshot.sourceLinks, [
    'https://www.realtor.com/realestateandhomes-detail/fixture',
  ]);
  assert.equal(
    photoLinks(Array.from({ length: 50 }, (_, i) => `https://ap.rdcpix.com/fixture-${i}.jpg`))
      .length,
    24
  );
  const deal = {
    leadId: 'fixture',
    address,
    arv: 0,
    comps: { A: { price: 0 } },
    listingSnapshot: snapshot,
  };
  const reopened = readPropertyEvidence(buildAnalyzerLeadPatch(deal).deal, address);
  assert.deepEqual(reopened.listing, snapshot);
  assert.equal(deal.arv, 0);
  assert.equal(deal.comps.A.price, 0);
});

test('ignore evidence from another address or unknown sources and reject malformed capture times', () => {
  const listingSnapshot = captureListingSnapshot(address, response);
  assert.equal(
    readPropertyEvidence({ listingSnapshot }, '86 Other Street, Example City, CA 90210').listing,
    null
  );
  assert.equal(
    readPropertyEvidence({ listingSnapshot: { ...listingSnapshot, source: 'unverified' } }, address)
      .listing,
    null
  );
  assert.equal(
    readPropertyEvidence(
      { listingSnapshot: { ...listingSnapshot, retrievedAt: 'invalid' } },
      address
    ).listing,
    null
  );
  assert.equal(
    readPropertyEvidence(
      { listingSnapshot: { ...listingSnapshot, address: 'x'.repeat(501) + 'A' } },
      'x'.repeat(501) + 'B'
    ).listing,
    null
  );
  assert.equal(captureListingSnapshot(address, { ...response, cache: { hit: false } }), null);
  assert.equal(
    captureListingSnapshot(address, { cache: { hit: true }, propertyData: { source: 'unknown' } }),
    null
  );
});

test('photos survive missing asking price, while unsupported price basis cannot become an asking price', () => {
  const noPrice = captureListingSnapshot(address, {
    ...response,
    propertyData: {
      ...response.propertyData,
      data: { ...response.propertyData.data, askingPriceUsd: 0, priceBasis: 'recorded_sale' },
    },
  });
  assert.deepEqual(noPrice.photoUrls, [photo]);
  assert.equal(noPrice.askingPrice, null);
});

test('saved parcel facts are allowlisted and must belong to the current address', () => {
  const propertyRecordSnapshot = {
    source: 'attom',
    address,
    retrievedAt: '2026-11-17T12:00:00Z',
    facts: {
      address,
      apn: 'FIXTURE-24',
      beds: 4,
      livingSqft: 1700,
      taxAmount: 2500,
      taxYear: 2025,
      privateField: 'discard',
    },
  };
  const evidence = readPropertyEvidence({ propertyRecordSnapshot }, address);
  assert.equal(evidence.records.facts.apn, 'FIXTURE-24');
  assert.equal(evidence.records.facts.privateField, undefined);
  assert.equal(evidence.records.facts.baths, null);
  assert.equal(
    readPropertyEvidence({ propertyRecordSnapshot }, '86 Other Street, Example City, CA 90210')
      .records,
    null
  );
});

test('expanded parcel evidence retains identities and field timestamps through strict hydration', () => {
  const old = '2026-10-01T12:00:00Z',
    recent = '2026-11-18T12:00:00Z';
  const propertyRecordSnapshot = {
    source: 'attom',
    address,
    retrievedAt: recent,
    fieldRetrievedAt: {
      ownerName: old,
      assessedTotalValue: recent,
      unsafe: recent,
      originalMortgageAmount: 'invalid',
    },
    facts: {
      address,
      attomId: '123456',
      fips: '06037',
      ownerName: 'Fixture Owner',
      ownerMailingAddress: 'PO Box Fixture',
      assessedTotalValue: 225000,
      originalMortgageAmount: 160000,
      saleDocumentNumber: 'FIX-1',
      saleTransactionDate: 'invalid',
      sourcePublishedDate: '2026-10-01',
      currentBalance: 140000,
      arv: 900000,
      secret: 'discard',
      unitsCount: -1,
    },
  };
  const { records } = readPropertyEvidence({ propertyRecordSnapshot }, address);
  assert.equal(records.facts.attomId, '123456');
  assert.equal(records.facts.fips, '06037');
  assert.equal(records.facts.ownerName, 'Fixture Owner');
  assert.equal(records.facts.assessedTotalValue, 225000);
  assert.equal(records.facts.originalMortgageAmount, 160000);
  assert.equal(records.facts.saleDocumentNumber, 'FIX-1');
  assert.equal(records.facts.saleTransactionDate, null);
  assert.equal(records.facts.sourcePublishedDate, '2026-10-01');
  assert.equal(records.facts.unitsCount, null);
  assert.equal(records.facts.currentBalance, undefined);
  assert.equal(records.facts.arv, undefined);
  assert.equal(records.facts.secret, undefined);
  assert.deepEqual(records.fieldRetrievedAt, { ownerName: old, assessedTotalValue: recent });
});
