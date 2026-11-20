import { hydrateAttomMcpSections, type AttomMcpSection } from './attomMcpSections.mjs';
import {
  hydrateAttomExtraFields,
  strictAttomDate,
  boundedAttomIdentifier,
} from './attomRecordFields.mjs';
import type { PropertyListingSnapshot } from '../types';
import type { AttomPropertyFacts } from './runtimeBridge';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const cleanText = (value: unknown, limit = 500) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const recordDate = strictAttomDate;
const addressKey = (value: unknown) => {
  const address = typeof value === 'string' ? value.trim() : '';
  return address.length > 500
    ? ''
    : address.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
};
const sourceNames = new Map([
  ['realtor.com', 'Realtor.com'],
  ['redfin.com', 'Redfin'],
  ['zillow.com', 'Zillow'],
]);

export function listingSources(value: unknown): [string, string][] {
  const sources = new Map<string, string>();
  for (const link of Array.isArray(value) ? value.slice(0, 50) : []) {
    if (typeof link !== 'string' || link.length > 2048) continue;
    try {
      const url = new URL(link);
      const name = sourceNames.get(url.hostname.replace(/^www\./, ''));
      if (name && url.protocol === 'https:' && !url.username && !url.password && !url.port)
        sources.set(url.href, name);
    } catch {
      /* Ignore untrusted source URLs. */
    }
  }
  return [...sources].slice(0, 6);
}

export function photoLinks(value: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value.slice(0, 100) : []).filter(
        (url): url is string =>
          typeof url === 'string' &&
          /^https:\/\/ap\.rdcpix\.com\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url)
      )
    ),
  ].slice(0, 24);
}

// The same public CDN photo identity, requested at gallery size. Keep saved
// source URLs unchanged; the gallery falls back if this rendition is absent.
export function fullSizePhotoUrl(url: string): string {
  if (url.length > 2048) return url;
  const thumbnail = url.match(/^https:\/\/ap\.rdcpix\.com\/([a-z0-9_-]+-m\d+)s\.jpg$/i);
  return thumbnail ? `https://ap.rdcpix.com/${thumbnail[1]}od-w1920_h1440.webp` : url;
}

function listingSnapshot(value: unknown, address: string): PropertyListingSnapshot | null {
  const item = record(value);
  if (
    !addressKey(address) ||
    addressKey(item.address) !== addressKey(address) ||
    item.source !== 'apify-for-sale' ||
    !Number.isFinite(Date.parse(cleanText(item.retrievedAt)))
  )
    return null;
  const facts: Record<string, number> = {};
  for (const key of ['beds', 'baths', 'sqft', 'year', 'dom', 'lotSqft']) {
    const value = number(record(item.facts)[key]);
    if (value !== null) facts[key] = value;
  }
  return {
    source: 'apify-for-sale',
    address: cleanText(item.address),
    retrievedAt: cleanText(item.retrievedAt),
    askingPrice:
      number(item.askingPrice) && Number(item.askingPrice) > 0 ? Number(item.askingPrice) : null,
    photoUrls: photoLinks(item.photoUrls),
    sourceLinks: listingSources(item.sourceLinks).map(([url]) => url),
    facts,
  };
}

export function captureListingSnapshot(
  address: string,
  response: unknown,
  retrievedAt = new Date().toISOString()
) {
  const root = record(response),
    property = record(root.propertyData),
    data = record(property.data);
  if (record(root.cache).hit !== true) return null;
  return listingSnapshot(
    {
      source: property.source,
      address,
      retrievedAt,
      photoUrls: data.photoUrls,
      sourceLinks: data.sourceLinks,
      facts: data.listingFacts,
      askingPrice: data.priceBasis === 'asking_price' ? data.askingPriceUsd : null,
    },
    address
  );
}

export function readPropertyEvidence(deal: unknown, address: string) {
  const root = record(deal),
    item = record(root.propertyRecordSnapshot),
    facts = record(item.facts);
  let records: {
    source: 'attom';
    address: string;
    retrievedAt: string;
    facts: AttomPropertyFacts;
    fieldRetrievedAt?: Record<string, string>;
    sections?: AttomMcpSection[];
  } | null = null;
  if (
    addressKey(address) &&
    addressKey(item.address) === addressKey(address) &&
    item.source === 'attom' &&
    Number.isFinite(Date.parse(cleanText(item.retrievedAt)))
  ) {
    records = {
      source: 'attom',
      address: cleanText(item.address),
      retrievedAt: cleanText(item.retrievedAt),
      facts: {
        ...hydrateAttomExtraFields(facts),
        address: cleanText(facts.address) || cleanText(item.address),
        apn: boundedAttomIdentifier(facts.apn),
        attomId: boundedAttomIdentifier(facts.attomId),
        fips: boundedAttomIdentifier(facts.fips),
        county: cleanText(facts.county, 500) || null,
        subdivision: cleanText(facts.subdivision, 500) || null,
        zoning: cleanText(facts.zoning, 500) || null,
        propertyClass: cleanText(facts.propertyClass, 500) || null,
        condition: cleanText(facts.condition, 500) || null,
        constructionType: cleanText(facts.constructionType, 500) || null,
        ownerName: cleanText(facts.ownerName, 500) || null,
        owner2Name: cleanText(facts.owner2Name, 500) || null,
        owner3Name: cleanText(facts.owner3Name, 500) || null,
        owner4Name: cleanText(facts.owner4Name, 500) || null,
        ownerMailingAddress: cleanText(facts.ownerMailingAddress, 500) || null,
        absenteeOwnerStatus: cleanText(facts.absenteeOwnerStatus, 500) || null,
        corporateOwnerIndicator: cleanText(facts.corporateOwnerIndicator, 500) || null,
        saleDocumentNumber: cleanText(facts.saleDocumentNumber, 500) || null,
        saleDocumentType: cleanText(facts.saleDocumentType, 500) || null,
        saleTransactionType: cleanText(facts.saleTransactionType, 500) || null,
        originalMortgageLender: cleanText(facts.originalMortgageLender, 500) || null,
        originalMortgageDocumentNumber:
          cleanText(facts.originalMortgageDocumentNumber, 500) || null,
        secondOriginalMortgageLender: cleanText(facts.secondOriginalMortgageLender, 500) || null,
        secondOriginalMortgageDocumentNumber:
          cleanText(facts.secondOriginalMortgageDocumentNumber, 500) || null,
        buildingSqft: number(facts.buildingSqft),
        levels: number(facts.levels),
        unitsCount: number(facts.unitsCount),
        assessedLandValue: number(facts.assessedLandValue),
        assessedImprovementValue: number(facts.assessedImprovementValue),
        assessedTotalValue: number(facts.assessedTotalValue),
        assessmentMarketTotalValue: number(facts.assessmentMarketTotalValue),
        taxDelinquentYear: number(facts.taxDelinquentYear),
        originalMortgageAmount: number(facts.originalMortgageAmount),
        secondOriginalMortgageAmount: number(facts.secondOriginalMortgageAmount),
        saleTransactionDate: recordDate(facts.saleTransactionDate),
        sourcePublishedDate: recordDate(facts.sourcePublishedDate),
        sourceLastModified: recordDate(facts.sourceLastModified),
        propertyType: cleanText(facts.propertyType, 100) || null,
        lotSqft: number(facts.lotSqft),
        lotAcres: number(facts.lotAcres),
        livingSqft: number(facts.livingSqft),
        beds: number(facts.beds),
        baths: number(facts.baths),
        yearBuilt: number(facts.yearBuilt),
        taxAmount: number(facts.taxAmount),
        taxYear: number(facts.taxYear),
        recordedSaleAmount: number(facts.recordedSaleAmount),
        recordedSaleDate: recordDate(facts.recordedSaleDate),
      },
    };
  }
  if (records) {
    const sections = hydrateAttomMcpSections(item.sections);
    if (sections.length) records.sections = sections;
    const dates: Record<string, string> = {};
    for (const key of Object.keys(records.facts)) {
      const value = record(item.fieldRetrievedAt)[key];
      if (Number.isFinite(Date.parse(cleanText(value)))) dates[key] = cleanText(value);
    }
    if (Object.keys(dates).length) records.fieldRetrievedAt = dates;
  }
  return { listing: listingSnapshot(root.listingSnapshot, address), records };
}
