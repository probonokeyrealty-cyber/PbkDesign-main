import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Image as ImageIcon, Maximize2, RefreshCw, Search } from 'lucide-react';
import { PropertyPhotoViewer } from './PropertyPhotoViewer';
import type { DealData, PropertyListingSnapshot } from '../types';
import { formatCurrency } from '../utils/formatting';
import { fetchApifyListingRequest, fetchPropertyIntelligenceRequest, type AttomPreviewResult } from '../utils/runtimeBridge';
import {
  fullSizePhotoUrl,
  listingSources,
  photoLinks,
  readPropertyEvidence,
} from '../utils/propertyEvidence';

import { intelligenceRequest, mergeAnalyzerIntelligence } from '../utils/analyzerIntelligence.mjs';

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

export function AnalyzerListingLookup({
  deal,
  protectedFields,
  onFill,
  onPhotoResult,
}: {
  deal: DealData;
  protectedFields?: ReadonlySet<keyof DealData>;
  onFill: (updates: Partial<DealData>) => void;
  onPhotoResult: (result: AnalyzerPhotoResult) => void;
}) {
  const address = deal.address.trim();
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [filledCount, setFilledCount] = useState(0);
  const [records, setRecords] = useState<AttomPreviewResult | null>(null);
  const [capturedListing, setCapturedListing] = useState<PropertyListingSnapshot | null>(null);
  const { listingSnapshot, propertyRecordSnapshot } = deal;
  const { listing: savedListing, records: savedRecords } = useMemo(
    () => readPropertyEvidence({ listingSnapshot, propertyRecordSnapshot }, address),
    [listingSnapshot, propertyRecordSnapshot, address]
  );
  const photoEvidence = capturedListing?.address === address ? capturedListing : savedListing;
  const recordFacts = savedRecords?.facts ?? (records?.status === 'matched' ? records.profile : null);
  const recordLabel = records?.status === 'matched' ? 'Matched parcel'
    : savedRecords ? 'Saved record' : records?.status.replaceAll('_', ' ');
  const current = useRef({ deal, onFill, protectedFields });
  current.current = { deal, onFill, protectedFields };
  const mounted = useRef(true);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    onPhotoResult({
      address,
      status: photoEvidence?.photoUrls.length ? 'found' : lookup.status,
      urls: photoEvidence?.photoUrls ?? (lookup.status === 'found' ? lookup.photos : []),
    });
  }, [address, lookup, onPhotoResult, photoEvidence]);

  const lookUp = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const before = current.current.deal;
    setLookup({ status: 'loading' });
    try {
      const response = await fetchPropertyIntelligenceRequest(intelligenceRequest(before));
      if (!mounted.current || current.current.deal.address.trim() !== address || current.current.deal.leadId !== before.leadId) return;
      const protectedNow = new Set(current.current.protectedFields);
      for (const field of Object.keys(current.current.deal) as (keyof DealData)[]) {
        if (JSON.stringify(current.current.deal[field]) !== JSON.stringify(before[field])) protectedNow.add(field);
      }
      const updates = mergeAnalyzerIntelligence(current.current.deal, response, protectedNow);
      current.current.onFill(updates);
      setFilledCount(Object.keys(updates).filter(key => !/Snapshot|recordedSales/.test(key)).length);
      setRecords(response.records);
      const listing = response.listing;
      const snapshot = readPropertyEvidence(response.patch.deal, address).listing;
      if (snapshot) setCapturedListing(snapshot);
      const data = listing?.propertyData?.data;
      setLookup(listing?.cache?.hit && data?.priceBasis === 'asking_price' && positiveNumber(data.askingPriceUsd)
        ? { status:'found',price:data.askingPriceUsd,sources:listingSources(data.sourceLinks),facts:data.listingFacts || {},photos:photoLinks(data.photoUrls),propertyType:data.propertyType }
        : {status:'missing'});
      if (response.saved && response.leadId) window.dispatchEvent(new CustomEvent('pbk:lead-updated', {detail:{leadId:response.leadId}}));
    } catch { if (mounted.current) setLookup({status:'error'}); }
    finally { pending.current=false; }
  }, [address]);

  const updates = lookup.status === 'found' ? listingUpdates(deal, lookup, protectedFields) : {};
  const fillableCount = Object.keys(updates).length;

  return (
    <div className="pbk-analyzer-listing">
      <p className="pbk-analyzer-lookup-hint">
        Analysis uses the data in this deal. Refresh property intelligence to update records, photos
        and sale candidates.
      </p>
      <button
        type="button"
        disabled={!address || lookup.status === 'loading'}
        onClick={() => void lookUp()}
        className="pbk-btn pbk-btn-ghost pbk-btn-sm"
      >
        <Search size={14} aria-hidden="true" />
        Refresh property intelligence
      </button>
      <div role="status">
        {lookup.status === 'loading' && <p className="mt-2">Looking up listing...</p>}
        {lookup.status === 'missing' && (
          <p className="mt-2">
            No current cached asking price found. Available records and sale candidates were kept; enter missing details manually.
          </p>
        )}
        {lookup.status === 'error' && (
          <p className="mt-2">Could not look up the listing. Try again.</p>
        )}
        {lookup.status === 'found' && (
          <div className="pbk-analyzer-listing-result">
            <p>
              Listing asking price <strong>{formatCurrency(lookup.price)}</strong>
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
      {recordLabel && (
        <details className="pbk-analyzer-records">
          <summary>ATTOM public records · {recordLabel}</summary>
          {recordFacts ? (
            <>
              <p>{recordFacts.address}</p>
              <dl>
                <div>
                  <dt>Parcel / APN</dt>
                  <dd>{recordFacts.apn || 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Property type</dt>
                  <dd>{recordFacts.propertyType || 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Lot size</dt>
                  <dd>{recordFacts.lotSqft?.toLocaleString('en-US') ?? 'Unavailable'} sq ft</dd>
                </div>
                <div>
                  <dt>Recorded sale</dt>
                  <dd>
                    {recordFacts.recordedSaleAmount
                      ? formatCurrency(recordFacts.recordedSaleAmount)
                      : 'Unavailable'}
                  </dd>
                </div>
                <div>
                  <dt>Sale date</dt>
                  <dd>{recordFacts.recordedSaleDate || 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Annual tax</dt>
                  <dd>
                    {recordFacts.taxAmount !== null
                      ? formatCurrency(recordFacts.taxAmount)
                      : 'Unavailable'}
                  </dd>
                </div>
                <div>
                  <dt>Tax year</dt>
                  <dd>{recordFacts.taxYear ?? 'Unavailable'}</dd>
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

function useApifyPhotos(address: string) {
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
    return () => {
      requests.current++;
    };
  }, [address]);
  return { result, lookup };
}

export function LeadListingPhotos({
  address,
  snapshot,
  onRefresh,
  refreshing = false,
}: {
  address: string;
  snapshot?: PropertyListingSnapshot | null;
  onRefresh?: () => void | Promise<void>;
  refreshing?: boolean;
}) {
  const saved = snapshot?.photoUrls ?? [];
  const { result: localResult, lookup } = useApifyPhotos(address);
  const result: AnalyzerPhotoResult = onRefresh ? { address, status: refreshing ? 'loading' : 'idle', urls: [] } : localResult;
  const showingSaved = saved.length > 0 && (Boolean(onRefresh) || result.status !== 'found');
  const display = showingSaved ? { address, status: 'found' as const, urls: saved } : result;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="pbk-property-label">
          {showingSaved ? 'Saved listing snapshot' : 'Listing photos · Apify'}
        </span>
        <button
          type="button"
          className="pbk-btn pbk-btn-ghost pbk-btn-sm"
          aria-label={onRefresh ? 'Refresh property intelligence' : 'Refresh listing photos'}
          disabled={!address.trim() || refreshing || result.status === 'loading'}
          onClick={() => void (onRefresh ? onRefresh() : lookup())}
        >
          <RefreshCw size={16} aria-hidden />
        </button>
      </div>
      {snapshot && showingSaved && (
        <p className="pbk-property-evidence-note">
          Captured{' '}
          <time dateTime={snapshot.retrievedAt}>
            {new Date(snapshot.retrievedAt).toLocaleString()}
          </time>
          . Listing photography; condition and availability may have changed.
        </p>
      )}
      {!showingSaved && result.status === 'found' && (
        <p className="pbk-property-evidence-note">
          Latest cached listing photos. Refresh does not replace the saved snapshot.
        </p>
      )}
      {showingSaved && ['missing', 'error'].includes(result.status) && (
        <p className="pbk-property-evidence-note" role="status">
          Showing saved photos. No newer photos were returned.
        </p>
      )}
      <AnalyzerListingPhotos key={address} result={display} />
    </div>
  );
}

export function AnalyzerListingPhotos({ result }: { result: AnalyzerPhotoResult | null }) {
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState('');
  const [failedRenditions, setFailedRenditions] = useState<string[]>([]);
  const [failedThumbnails, setFailedThumbnails] = useState<string[]>([]);
  const [loadedWidths, setLoadedWidths] = useState<Record<string, number>>({});
  const urls = result?.urls ?? [];
  const photos = urls.filter((url) => !failedPhotos.includes(url));
  const currentPhoto = photos.includes(selectedPhoto) ? selectedPhoto : photos[0];
  const displayPhoto =
    currentPhoto && !failedRenditions.includes(currentPhoto)
      ? fullSizePhotoUrl(currentPhoto)
      : currentPhoto;
  const loadedWidth = loadedWidths[displayPhoto];
  const handleLoad = (source: string, width: number) => {
    setLoadedWidths((loaded) =>
      loaded[source] === width ? loaded : { ...loaded, [source]: width }
    );
  };
  const handleError = (photo: string, source: string) => {
    if (source !== photo)
      setFailedRenditions((failed) => (failed.includes(photo) ? failed : [...failed, photo]));
    else setFailedPhotos((failed) => (failed.includes(photo) ? failed : [...failed, photo]));
  };
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
          <PropertyPhotoViewer
            photos={photos}
            photo={currentPhoto}
            imageSrc={displayPhoto}
            preview={loadedWidth !== undefined && loadedWidth < 480}
            onSelect={setSelectedPhoto}
            onLoad={handleLoad}
            onError={handleError}
            trigger={
              <button
                type="button"
                className="pbk-analyzer-photo-stage pbk-photo-viewer-trigger"
                aria-label="Open photo viewer"
              >
                <img
                  key={displayPhoto}
                  src={displayPhoto}
                  alt={`Listing photo ${urls.indexOf(currentPhoto) + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onLoad={(event) => {
                    handleLoad(displayPhoto, event.currentTarget.naturalWidth);
                  }}
                  onError={() => {
                    handleError(currentPhoto, displayPhoto);
                  }}
                />
                <span className="pbk-photo-viewer-open">
                  <Maximize2 size={14} aria-hidden />
                  View full screen
                </span>
              </button>
            }
          />
          {loadedWidth !== undefined && loadedWidth < 480 && (
            <p className="pbk-property-evidence-note" role="status">
              Low-resolution source preview. Open the listing for more detail.
            </p>
          )}
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
                    {failedThumbnails.includes(url) ? (
                      <ImageIcon size={16} aria-hidden />
                    ) : (
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedThumbnails((failed) =>
                            failed.includes(url) ? failed : [...failed, url]
                          )
                        }
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <a
            className="pbk-analyzer-context-link"
            href={displayPhoto}
            target="_blank"
            rel="noopener noreferrer"
          >
            {loadedWidth >= 480 ? 'Open full-size photo' : 'Open source photo'}{' '}
            <ExternalLink size={13} aria-hidden />
          </a>
        </>
      ) : (
        <p className="pbk-analyzer-context-meta" role="status">
          {urls.length && !photos.length
            ? 'Listing photos could not be displayed. Check the source listing.'
            : status === 'idle'
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
