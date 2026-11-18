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
const addressKey = (value: unknown) => {
  const address = typeof value === 'string' ? value.trim() : '';
  return address.length > 500 ? '' : address.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
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
        address: cleanText(facts.address) || cleanText(item.address),
        apn: cleanText(facts.apn, 100) || null,
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
        recordedSaleDate: cleanText(facts.recordedSaleDate, 30) || null,
      },
    };
  }
  return { listing: listingSnapshot(root.listingSnapshot, address), records };
}
