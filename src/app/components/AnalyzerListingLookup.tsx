import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Image as ImageIcon, RefreshCw, Search } from 'lucide-react';
import type { DealData } from '../types';
import { fetchApifyListingRequest } from '../utils/runtimeBridge';

export type AnalyzerPhotoResult = {
  address: string;
  status: 'idle' | 'loading' | 'missing' | 'error' | 'found';
  urls: string[];
};

function photoLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((url): url is string => typeof url === 'string'
    && /^https:\/\/ap\.rdcpix\.com\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url)))].slice(0, 6);
}

function useApifyPhotos(address: string, automatic = false) {
  const generation = useRef(0);
  const [stored, setStored] = useState<AnalyzerPhotoResult>({ address, status: 'idle', urls: [] });
  const result: AnalyzerPhotoResult = useMemo(() => stored.address === address ? stored : { address, status: 'idle', urls: [] }, [stored, address]);
  const lookup = useCallback(async () => {
    if (!address.trim()) return;
    const version = ++generation.current;
    setStored({ address, status: 'loading', urls: [] });
    try {
      const response = await fetchApifyListingRequest(address);
      if (generation.current !== version) return;
      const record = response.propertyData;
      const urls = response.cache?.hit && record?.source === 'apify-for-sale' ? photoLinks(record.data?.photoUrls) : [];
      setStored({ address, status: urls.length ? 'found' : 'missing', urls });
    } catch {
      if (generation.current === version) setStored({ address, status: 'error', urls: [] });
    }
  }, [address]);
  useEffect(() => {
    const requests = generation;
    if (automatic && address.trim()) void lookup();
    return () => { requests.current++; };
  }, [address, automatic, lookup]);
  return { result, lookup };
}

export function AnalyzerListingLookup({ deal, onPhotoResult }: {
  deal: DealData; onPhotoResult: (result: AnalyzerPhotoResult) => void;
}) {
  const { result, lookup } = useApifyPhotos(deal.address.trim());
  useEffect(() => { onPhotoResult(result); }, [result, onPhotoResult]);
  return <div className="pbk-analyzer-listing">
    <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm"
      disabled={!deal.address.trim() || result.status === 'loading'} onClick={() => void lookup()}>
      <Search size={14} aria-hidden /> Find listing photos
    </button>
    <div role="status">
      {result.status === 'loading' && <p>Loading Apify photos...</p>}
      {result.status === 'missing' && <p>No saved Apify photos for this address.</p>}
      {result.status === 'error' && <p>Photo lookup failed. Retry when the bridge is available.</p>}
      {result.status === 'found' && <p>Apify · {result.urls.length} listing photos</p>}
    </div>
  </div>;
}

export function LeadListingPhotos({ address }: { address: string }) {
  const { result, lookup } = useApifyPhotos(address, true);
  return <div>
    <div className="flex items-center justify-between gap-3 mb-3">
      <span className="pbk-property-label">Apify</span>
      <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" aria-label="Refresh Apify photos"
        disabled={!address.trim() || result.status === 'loading'} onClick={() => void lookup()}><RefreshCw size={16} aria-hidden /></button>
    </div>
    <AnalyzerListingPhotos key={address} result={result} />
  </div>;
}

export function AnalyzerListingPhotos({ result }: { result: AnalyzerPhotoResult | null }) {
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState('');
  const urls = result?.urls ?? [];
  const photos = urls.filter(url => !failedPhotos.includes(url));
  const currentPhoto = photos.includes(selectedPhoto) ? selectedPhoto : photos[0];
  const status = result?.status ?? 'idle';
  return <section className="pbk-analyzer-context-section" aria-label="Listing photos">
    <header><ImageIcon size={16} aria-hidden /><h3>Listing photos</h3>
      {photos.length > 0 && <span className="pbk-analyzer-context-meta">{photos.length} · Apify</span>}
    </header>
    {currentPhoto ? <>
      <div className="pbk-analyzer-photo-stage"><img src={currentPhoto} alt={`Listing photo ${urls.indexOf(currentPhoto) + 1}`}
        loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedPhotos(failed => [...failed, currentPhoto])} /></div>
      {photos.length > 1 && <ul className="pbk-analyzer-photo-strip" aria-label="Listing photo choices">
        {photos.map(url => <li key={url}><button type="button" aria-label={`View photo ${urls.indexOf(url) + 1}`}
          aria-pressed={currentPhoto === url} onClick={() => setSelectedPhoto(url)}>
          <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedPhotos(failed => [...failed, url])} />
        </button></li>)}
      </ul>}
      <a className="pbk-analyzer-context-link" href={currentPhoto} target="_blank" rel="noopener noreferrer">
        Full-size photo <ExternalLink size={13} aria-hidden />
      </a>
    </> : <p className="pbk-analyzer-context-meta" role="status">
      {status === 'idle' ? 'No photos loaded.' : status === 'loading' ? 'Loading Apify photos...'
        : status === 'error' ? 'Photo lookup unavailable. Try refreshing.' : 'No saved Apify photos for this address.'}
    </p>}
  </section>;
}
