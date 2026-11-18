import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { RecordedSale } from '../../utils/runtimeBridge';
import { compDate, compNumber, compPhotoEvidence } from '../../utils/leadComps.mjs';
import { fullSizePhotoUrl } from '../../utils/propertyEvidence';
import { PropertyPhotoViewer } from '../PropertyPhotoViewer';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const compMoney = (value: unknown) => compNumber(value) === null ? 'Not reported' : money.format(value as number);
export const compMetric = (value: unknown) => compNumber(value)?.toLocaleString('en-US') ?? 'Not reported';
export const compDistance = (value: unknown) => compNumber(value) === null ? 'Not reported' : `${(value as number).toFixed(2)} mi`;

function ComparisonPhoto({ sale }: { sale: RecordedSale }) {
  const evidence = compPhotoEvidence(sale);
  const [chosen, setChosen] = useState('');
  const [failed, setFailed] = useState<string[]>([]);
  const [fallback, setFallback] = useState<string[]>([]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const photos = (evidence?.photoUrls ?? []).filter(url => !failed.includes(url));
  const photo = photos.includes(chosen) ? chosen : photos[0];
  const source = photo && !fallback.includes(photo) ? fullSizePhotoUrl(photo) : photo;
  const onError = (url: string, rendition: string) => {
    if (url !== rendition) setFallback(values => values.includes(url) ? values : [...values, url]);
    else setFailed(values => values.includes(url) ? values : [...values, url]);
  };
  const onLoad = (url: string, width: number) => setWidths(values => values[url] === width ? values : { ...values, [url]: width });
  return <>
    {photo ? <PropertyPhotoViewer photos={photos} photo={photo} imageSrc={source} preview={widths[source] !== undefined && widths[source] < 480} onSelect={setChosen} onLoad={onLoad} onError={onError}
      trigger={<button type="button" className="pbk-comp-photo pbk-photo-viewer-trigger" aria-label={`View photos for ${sale.address}`}>
        <img key={source} src={source} alt={`Comparable property at ${sale.address}`} referrerPolicy="no-referrer" onLoad={event => onLoad(source, event.currentTarget.naturalWidth)} onError={() => onError(photo, source)} />
        <span>{photos.length} {photos.length === 1 ? 'photo' : 'photos'} · View</span>
      </button>} /> : <div className="pbk-comp-photo pbk-comp-photo-empty"><ImageIcon size={24} aria-hidden /><span>Photos unavailable</span></div>}
    {evidence && <p className="pbk-comps-source">Listing photos · Captured {new Date(evidence.retrievedAt).toLocaleDateString()}{evidence.sourceLinks[0] && <> · <a href={evidence.sourceLinks[0]} target="_blank" rel="noopener noreferrer">Listing source</a></>}</p>}
  </>;
}

export function CompComparison({ sales, onRemove, disabled = false }: { sales: RecordedSale[]; onRemove: (id: string) => void; disabled?: boolean }) {
  if (!sales.length) return <p className="pbk-comps-source">Select up to three recorded sales to compare photos and sale details.</p>;
  return <section className="pbk-comp-comparison" aria-label="Selected comp comparison">
    <h4>Compare selected sales</h4>
    <div className="pbk-comp-comparison-grid" style={{ gridTemplateColumns: `repeat(${sales.length}, minmax(0, 1fr))` }}>
      {sales.map((sale, index) => <article key={sale.id} className="pbk-comp-comparison-card">
        <div className="pbk-comp-card-heading"><span>Comp {['A', 'B', 'C'][index]}</span><button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={disabled} onClick={() => onRemove(sale.id)} aria-label={`Remove comp ${sale.address}`}>Remove</button></div>
        <h5>{sale.address}</h5>
        <ComparisonPhoto key={`${sale.id}:${JSON.stringify(sale.photoEvidence)}`} sale={sale} />
        <dl className="pbk-comp-metrics">
          <div><dt>Sale price</dt><dd>{compMoney(sale.price)}</dd></div>
          <div><dt>Sq ft</dt><dd>{compMetric(sale.sqft)}</dd></div>
          <div><dt>Distance</dt><dd>{compDistance(sale.distanceMiles)}</dd></div>
          <div><dt>Sold</dt><dd>{compDate(sale.soldDate) || 'Not reported'}</dd></div>
          <div><dt>Beds / baths</dt><dd>{compMetric(sale.beds)} / {compMetric(sale.baths)}</dd></div>
          <div><dt>$/sq ft</dt><dd>{compMoney(sale.pricePerSqft)}</dd></div>
        </dl>
      </article>)}
    </div>
  </section>;
}
