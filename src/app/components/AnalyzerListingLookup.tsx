import { useState } from 'react';
import { Search } from 'lucide-react';
import type { DealData } from '../types';
import { formatCurrency } from '../utils/formatting';
import { fetchApifyListingRequest } from '../utils/runtimeBridge';

const sourceNames = new Map([
  ['realtor.com', 'Realtor.com'],
  ['redfin.com', 'Redfin'],
  ['zillow.com', 'Zillow'],
]);

function listingSources(links: unknown) {
  const sources = new Map<string, string>();
  for (const link of Array.isArray(links) ? links : []) {
    if (typeof link !== 'string') continue;
    try {
      const url = new URL(link);
      const name = sourceNames.get(url.hostname.replace(/^www\./, ''));
      if (name && url.protocol === 'https:' && !url.username && !url.password && !url.port) {
        sources.set(url.href, name);
      }
    } catch {
      // Ignore malformed source URLs.
    }
  }
  return [...sources];
}

type LookupState =
  | { status: 'idle' | 'loading' | 'missing' | 'error' }
  | {
      status: 'found';
      price: number;
      sources: [string, string][];
      facts: Record<string, unknown>;
      propertyType?: string;
      photos: string[];
    };

const numericFields = ['beds', 'baths', 'sqft', 'year', 'dom'] as const;

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function photoLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (url): url is string =>
          typeof url === 'string' &&
          /^https:\/\/ap\.rdcpix\.com\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url)
      )
    ),
  ].slice(0, 6);
}

export function AnalyzerListingLookup({
  deal,
  onFill,
}: {
  deal: DealData;
  onFill: (updates: Partial<DealData>) => void;
}) {
  const address = deal.address.trim();
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [filledCount, setFilledCount] = useState(0);

  async function lookUp() {
    setFilledCount(0);
    setFailedPhotos([]);
    setLookup({ status: 'loading' });
    try {
      const response = await fetchApifyListingRequest(address);
      const record = response?.propertyData;
      const price = record?.data?.askingPriceUsd;
      if (
        !response?.cache?.hit ||
        record?.source !== 'apify-for-sale' ||
        record.data?.priceBasis !== 'asking_price' ||
        !positiveNumber(price)
      ) {
        setLookup({ status: 'missing' });
        return;
      }
      setLookup({
        status: 'found',
        price,
        sources: listingSources(record.data.sourceLinks),
        facts: record.data.listingFacts ?? {},
        propertyType: record.data.propertyType,
        photos: photoLinks(record.data.photoUrls),
      });
    } catch {
      setLookup({ status: 'error' });
    }
  }

  const updates: Partial<DealData> = {};
  if (lookup.status === 'found') {
    if (!deal.price) updates.price = lookup.price;
    for (const key of numericFields) {
      const value = lookup.facts[key];
      if (!deal[key] && positiveNumber(value)) updates[key] = value;
    }
    const lot = lookup.facts.lotSqft;
    if (deal.type === 'land' && positiveNumber(lot)) {
      // Keep the two lot-size inputs in agreement without replacing operator data.
      if (!deal.landLotSizeSqFt && !deal.lotSize.trim()) {
        updates.landLotSizeSqFt = lot;
        updates.lotSize = (lot / 43560).toFixed(4);
      }
    }
  }
  const fillableCount = Object.keys(updates).length;
  const photos =
    lookup.status === 'found' ? lookup.photos.filter((url) => !failedPhotos.includes(url)) : [];

  return (
    <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
      <button
        type="button"
        disabled={!address || lookup.status === 'loading'}
        onClick={() => void lookUp()}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-gray-200 px-2.5 font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-900"
      >
        <Search size={14} aria-hidden="true" />
        Look up asking price
      </button>
      <div role="status">
        {lookup.status === 'loading' && <p className="mt-2">Looking up listing...</p>}
        {lookup.status === 'missing' && (
          <p className="mt-2">No current Apify listing found for this address.</p>
        )}
        {lookup.status === 'error' && (
          <p className="mt-2">Could not look up the listing. Try again.</p>
        )}
        {lookup.status === 'found' && (
          <div className="mt-2 border-l-2 border-blue-500 pl-3">
            <p>
              Apify asking price <strong>{formatCurrency(lookup.price)}</strong>
            </p>
            {(lookup.propertyType || positiveNumber(lookup.facts.lotSqft)) && (
              <p className="mt-1">
                {lookup.propertyType && <span className="capitalize">{lookup.propertyType}</span>}
                {lookup.propertyType && positiveNumber(lookup.facts.lotSqft) && ' | '}
                {positiveNumber(lookup.facts.lotSqft) &&
                  `Lot: ${lookup.facts.lotSqft.toLocaleString('en-US')} sq ft`}
              </p>
            )}
            {lookup.sources.length > 0 && (
              <ul aria-label="Listing sources" className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {lookup.sources.map(([url, name]) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 underline dark:text-blue-300"
                    >
                      {name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1">For sale, not a sold comp or ARV.</p>
            <button
              type="button"
              disabled={!fillableCount}
              onClick={() => {
                onFill(updates);
                setFilledCount(fillableCount);
              }}
              className="mt-2 inline-flex min-h-9 items-center rounded-md border border-gray-200 px-2.5 font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-900"
            >
              Fill empty fields
            </button>
            {filledCount > 0 && <p className="mt-1">Filled {filledCount} empty fields.</p>}
            {photos.length > 0 ? (
              <ul
                aria-label="Listing photos"
                className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"
              >
                {photos.map((url) => (
                  <li key={url} className="min-w-0">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={url}
                        alt={`Listing photo ${lookup.photos.indexOf(url) + 1}`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() => setFailedPhotos((failed) => [...failed, url])}
                        className="aspect-video w-full rounded-md object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2">No listing photos available.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
