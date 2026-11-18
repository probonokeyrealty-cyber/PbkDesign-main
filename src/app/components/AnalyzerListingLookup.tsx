import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Image as ImageIcon, RefreshCw, Search } from 'lucide-react';
import type { DealData } from '../types';
import { formatCurrency } from '../utils/formatting';
import { fetchApifyListingRequest, type AttomPreviewResult } from '../utils/runtimeBridge';

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

export type AnalyzerPhotoResult = {
  address: string;
  status: LookupState['status'];
  urls: string[];
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

function listingUpdates(
  deal: DealData,
  lookup: Extract<LookupState, { status: 'found' }>,
  protectedFields?: ReadonlySet<keyof DealData>
): Partial<DealData> {
  const updates: Partial<DealData> = {};
  if (!deal.price && !protectedFields?.has('price')) updates.price = lookup.price;
  for (const key of numericFields) {
    const value = lookup.facts[key];
    if (!deal[key] && !protectedFields?.has(key) && positiveNumber(value)) updates[key] = value;
  }
  const lot = lookup.facts.lotSqft;
  if (
    deal.type === 'land' &&
    positiveNumber(lot) &&
    !deal.landLotSizeSqFt &&
    !protectedFields?.has('lotSize') &&
    !protectedFields?.has('landLotSizeSqFt') &&
    !deal.lotSize.trim()
  ) {
    updates.landLotSizeSqFt = lot;
    updates.lotSize = (lot / 43560).toFixed(4);
  }
  return updates;
}

function recordUpdates(
  deal: DealData,
  records: AttomPreviewResult | undefined,
  protectedFields?: ReadonlySet<keyof DealData>
): Partial<DealData> {
  if (records?.status !== 'matched') return {};
  const facts = records.profile;
  return listingUpdates(
    deal,
    {
      status: 'found',
      price: 0,
      sources: [],
      photos: [],
      facts: {
        beds: facts.beds,
        baths: facts.baths,
        sqft: facts.livingSqft,
        year: facts.yearBuilt,
        lotSqft: facts.lotSqft,
      },
    },
    protectedFields
  );
}

export function AnalyzerListingLookup({
  deal,
  autoLookup = false,
  protectedFields,
  onFill,
  onPhotoResult,
}: {
  deal: DealData;
  autoLookup?: boolean;
  protectedFields?: ReadonlySet<keyof DealData>;
  onFill: (updates: Partial<DealData>) => void;
  onPhotoResult: (result: AnalyzerPhotoResult) => void;
}) {
  const address = deal.address.trim();
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [filledCount, setFilledCount] = useState(0);
  const [records, setRecords] = useState<AttomPreviewResult | null>(null);
  const current = useRef({ deal, onFill, protectedFields });
  current.current = { deal, onFill, protectedFields };
  const mounted = useRef(true);
  const pending = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    onPhotoResult({
      address,
      status: lookup.status,
      urls: lookup.status === 'found' ? lookup.photos : [],
    });
  }, [address, lookup, onPhotoResult]);

  const lookUp = useCallback(
    async (fill = false) => {
      if (pending.current) return;
      pending.current = true;
      started.current = true;
      setFilledCount(0);
      setLookup({ status: 'loading' });
      try {
        const response = await fetchApifyListingRequest(address, fill);
        if (!mounted.current || current.current.deal.address.trim() !== address) return;
        setRecords(response.records ?? null);
        const publicFields = recordUpdates(
          current.current.deal,
          response.records,
          current.current.protectedFields
        );
        if (response.records?.status === 'matched') {
          publicFields.propertyRecordSnapshot = {
            source: 'attom',
            address,
            retrievedAt: new Date().toISOString(),
            facts: { ...response.records.profile },
          };
        }
        // A recorded sale is historical evidence, never an asking price or ARV.
        delete publicFields.price;
        const record = response?.propertyData;
        const price = record?.data?.askingPriceUsd;
        if (
          !response?.cache?.hit ||
          record?.source !== 'apify-for-sale' ||
          record.data?.priceBasis !== 'asking_price' ||
          !positiveNumber(price)
        ) {
          setLookup({ status: 'missing' });
          if (fill && Object.keys(publicFields).length) {
            current.current.onFill(publicFields);
            setFilledCount(Object.keys(publicFields).length);
          }
          return;
        }
        const found: Extract<LookupState, { status: 'found' }> = {
          status: 'found',
          price,
          sources: listingSources(record.data.sourceLinks),
          facts: record.data.listingFacts ?? {},
          propertyType: record.data.propertyType,
          photos: photoLinks(record.data.photoUrls),
        };
        setLookup(found);
        if (fill) {
          const fields = {
            ...publicFields,
            ...listingUpdates(current.current.deal, found, current.current.protectedFields),
          };
          if (Object.keys(fields).length) current.current.onFill(fields);
          setFilledCount(
            Object.keys(fields).filter((key) => key !== 'propertyRecordSnapshot').length
          );
        }
      } catch {
        if (mounted.current) setLookup({ status: 'error' });
      } finally {
        pending.current = false;
      }
    },
    [address]
  );

  useEffect(() => {
    // Only an operator edit starts lookup; opening/reloading a saved deal is read-only.
    if (!autoLookup || !/^\d[^,]+,\s*[^,]+,\s*[a-z]{2}\s+\d{5}(?:-\d{4})?$/i.test(address)) return;
    const timer = window.setTimeout(() => {
      if (!started.current) void lookUp(true);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [address, autoLookup, lookUp]);

  const updates = lookup.status === 'found' ? listingUpdates(deal, lookup, protectedFields) : {};
  const fillableCount = Object.keys(updates).length;

  return (
    <div className="pbk-analyzer-listing">
      <p className="pbk-analyzer-lookup-hint">
        Enter a full address to load available listing facts and photos in one lookup. Review the
        numbers, then Save Deal for the CRM handoff.
      </p>
      <button
        type="button"
        disabled={!address || lookup.status === 'loading'}
        onClick={() => void lookUp()}
        className="pbk-btn pbk-btn-ghost pbk-btn-sm"
      >
        <Search size={14} aria-hidden="true" />
        Look up asking price
      </button>
      <div role="status">
        {lookup.status === 'loading' && <p className="mt-2">Looking up listing...</p>}
        {lookup.status === 'missing' && (
          <p className="mt-2">
            No current cached listing found. Enter any missing listing details manually.
          </p>
        )}
        {lookup.status === 'error' && (
          <p className="mt-2">Could not look up the listing. Try again.</p>
        )}
        {lookup.status === 'found' && (
          <div className="pbk-analyzer-listing-result">
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
              className="pbk-btn pbk-btn-ghost pbk-btn-sm mt-2"
            >
              Fill empty fields
            </button>
            {filledCount > 0 && (
              <p className="mt-1">
                Filled {filledCount} empty fields. Your existing values are preserved.
              </p>
            )}
          </div>
        )}
      </div>
      {records && (
        <details className="pbk-analyzer-records">
          <summary>
            ATTOM public records ·{' '}
            {records.status === 'matched' ? 'Matched parcel' : records.status.replaceAll('_', ' ')}
          </summary>
          {records.status === 'matched' ? (
            <>
              <p>{records.profile.address}</p>
              <dl>
                <div>
                  <dt>Parcel / APN</dt>
                  <dd>{records.profile.apn || 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Property type</dt>
                  <dd>{records.profile.propertyType || 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Lot size</dt>
                  <dd>{records.profile.lotSqft?.toLocaleString('en-US') ?? 'Unavailable'} sq ft</dd>
                </div>
                <div>
                  <dt>Recorded sale</dt>
                  <dd>
                    {records.profile.recordedSaleAmount
                      ? formatCurrency(records.profile.recordedSaleAmount)
                      : 'Unavailable'}
                  </dd>
                </div>
                <div>
                  <dt>Sale date</dt>
                  <dd>{records.profile.recordedSaleDate || 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Annual tax</dt>
                  <dd>
                    {records.profile.taxAmount !== null
                      ? formatCurrency(records.profile.taxAmount)
                      : 'Unavailable'}
                  </dd>
                </div>
                <div>
                  <dt>Tax year</dt>
                  <dd>{records.profile.taxYear ?? 'Unavailable'}</dd>
                </div>
              </dl>
              <p>
                Public records are separate from listing photos, sold comps and your underwriting.
              </p>
            </>
          ) : (
            <p>Public-record facts are unavailable for this lookup. Existing values stay intact.</p>
          )}
        </details>
      )}
    </div>
  );
}

function useApifyPhotos(address: string, automatic = false) {
  const generation = useRef(0);
  const [stored, setStored] = useState<AnalyzerPhotoResult>({ address, status: 'idle', urls: [] });
  const result: AnalyzerPhotoResult = useMemo(
    () => (stored.address === address ? stored : { address, status: 'idle', urls: [] }),
    [stored, address]
  );
  const lookup = useCallback(async () => {
    if (!address.trim()) return;
    const version = ++generation.current;
    setStored({ address, status: 'loading', urls: [] });
    try {
      const response = await fetchApifyListingRequest(address);
      if (generation.current !== version) return;
      const record = response.propertyData;
      const urls =
        response.cache?.hit && record?.source === 'apify-for-sale'
          ? photoLinks(record.data?.photoUrls)
          : [];
      setStored({ address, status: urls.length ? 'found' : 'missing', urls });
    } catch {
      if (generation.current === version) setStored({ address, status: 'error', urls: [] });
    }
  }, [address]);
  useEffect(() => {
    const requests = generation;
    if (automatic && address.trim()) void lookup();
    return () => {
      requests.current++;
    };
  }, [address, automatic, lookup]);
  return { result, lookup };
}

export function LeadListingPhotos({ address }: { address: string }) {
  const { result, lookup } = useApifyPhotos(address, true);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="pbk-property-label">Apify</span>
        <button
          type="button"
          className="pbk-btn pbk-btn-ghost pbk-btn-sm"
          aria-label="Refresh Apify photos"
          disabled={!address.trim() || result.status === 'loading'}
          onClick={() => void lookup()}
        >
          <RefreshCw size={16} aria-hidden />
        </button>
      </div>
      <AnalyzerListingPhotos key={address} result={result} />
    </div>
  );
}

export function AnalyzerListingPhotos({ result }: { result: AnalyzerPhotoResult | null }) {
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState('');
  const urls = result?.urls ?? [];
  const photos = urls.filter((url) => !failedPhotos.includes(url));
  const currentPhoto = photos.includes(selectedPhoto) ? selectedPhoto : photos[0];
  const status = result?.status ?? 'idle';
  return (
    <section className="pbk-analyzer-context-section" aria-label="Listing photos">
      <header>
        <ImageIcon size={16} aria-hidden />
        <h3>Listing photos</h3>
        {photos.length > 0 && (
          <span className="pbk-analyzer-context-meta">{photos.length} · Apify</span>
        )}
      </header>
      {currentPhoto ? (
        <>
          <div className="pbk-analyzer-photo-stage">
            <img
              src={currentPhoto}
              alt={`Listing photo ${urls.indexOf(currentPhoto) + 1}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailedPhotos((failed) => [...failed, currentPhoto])}
            />
          </div>
          {photos.length > 1 && (
            <ul className="pbk-analyzer-photo-strip" aria-label="Listing photo choices">
              {photos.map((url) => (
                <li key={url}>
                  <button
                    type="button"
                    aria-label={`View photo ${urls.indexOf(url) + 1}`}
                    aria-pressed={currentPhoto === url}
                    onClick={() => setSelectedPhoto(url)}
                  >
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() => setFailedPhotos((failed) => [...failed, url])}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <a
            className="pbk-analyzer-context-link"
            href={currentPhoto}
            target="_blank"
            rel="noopener noreferrer"
          >
            Full-size photo <ExternalLink size={13} aria-hidden />
          </a>
        </>
      ) : (
        <p className="pbk-analyzer-context-meta" role="status">
          {status === 'idle'
            ? 'No photos loaded.'
            : status === 'loading'
              ? 'Loading Apify photos...'
              : status === 'error'
                ? 'Photo lookup unavailable. Try refreshing.'
                : 'No saved Apify photos for this address.'}
        </p>
      )}
    </section>
  );
}
