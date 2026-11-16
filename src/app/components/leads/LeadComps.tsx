import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { fetchAttomRecentSales, type AttomPreviewAddress, type RecentSalesResult } from '../../utils/runtimeBridge';
import { hasLookupAddress } from './AttomPropertyPreview';
import '../../../styles/property-intelligence.css';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const messages: Record<string, string> = {
  invalid_address: 'Complete the property address, city, state and ZIP to find sales.',
  invalid_radius: 'Choose a supported search radius.',
  not_configured: 'ATTOM recent sales is not connected. Your saved lead is unchanged.',
  authorization_failed: 'ATTOM did not authorize this search. Check the provider connection.',
  rate_limited: 'ATTOM is limiting requests. Wait before retrying.',
  timed_out: 'The recorded-sales search timed out. Your lead is unchanged.',
  unavailable: 'Could not reach the record source. Your lead is unchanged.',
};

export function LeadComps({ address }: { address: AttomPreviewAddress }) {
  const [radius, setRadius] = useState(1);
  const [sort, setSort] = useState('date');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; data: RecentSalesResult } | null>(null);
  const queryKey = JSON.stringify([address.street, address.city, address.state, address.zip, radius, refresh]);
  const complete = hasLookupAddress(address) || /^.+,\s*[^,]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i.test(address.street);
  useEffect(() => {
    let current = true;
    if (complete) {
      void fetchAttomRecentSales(address, radius).then(
        data => { if (current) setResult({ key: queryKey, data }); },
        () => { if (current) setResult({ key: queryKey, data: { status: 'unavailable' } }); },
      );
    }
    return () => { current = false; };
  }, [queryKey, complete]);
  const data = result?.key === queryKey ? result.data : null;
  const loading = complete && !data;
  const rows = useMemo(() => [...(data?.sales || [])].sort((a, b) => sort === 'price'
    ? b.price - a.price : sort === 'distance' ? a.distanceMiles - b.distanceMiles : b.soldDate.localeCompare(a.soldDate)), [data, sort]);
  return <section className="pbk-lead-comps" aria-label="Recent comparable sales" aria-busy={loading}>
    <header>
      <div><h3>Recorded sales</h3><p>ATTOM public records · Last 30 days · Not MLS listings</p></div>
      <div className="pbk-comps-controls">
        <label>Radius <select value={radius} onChange={e => setRadius(Number(e.target.value))}>
          {[0.5, 1, 2, 5].map(r => <option key={r} value={r}>{r} {r === 1 ? 'mile' : 'miles'}</option>)}
        </select></label>
        <label>Sort <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="date">Newest sold</option><option value="distance">Nearest</option><option value="price">Highest price</option>
        </select></label>
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" title="Refresh recorded sales" aria-label="Refresh recorded sales" disabled={loading || !complete} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={16} /></button>
      </div>
    </header>
    {!complete ? <p role="status">Complete the property address to find nearby sales.</p>
      : loading ? <div role="status" className="pbk-comps-loading"><Loader2 size={18} className="animate-spin" /> Looking up recorded sales...</div>
      : data?.status !== 'matched' ? <div role="alert" className="pbk-comps-error"><AlertCircle size={18} /><p>{messages[data?.status || 'unavailable'] || messages.unavailable}</p><button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => setRefresh(n => n + 1)}>Retry</button></div>
      : <>
        <p role="status">{rows.length ? `${rows.length} sales` : `No recorded sales within ${radius} ${radius === 1 ? 'mile' : 'miles'} in the last 30 days.`}</p>
        {rows.length > 0 && <div className="pbk-comps-table-scroll"><table>
          <caption className="sr-only">Recent sales from {data.windowStart} to {data.windowEnd}</caption>
          <thead><tr><th scope="col">Property</th><th scope="col">Sold</th><th scope="col">Price</th><th scope="col">Distance</th><th scope="col">Beds / baths</th><th scope="col">Sq ft</th><th scope="col">$/sq ft</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.address}<small>{row.propertyType || 'Type not reported'}</small></th><td data-label="Sold">{row.soldDate}</td><td data-label="Price">{money.format(row.price)}</td><td data-label="Distance">{row.distanceMiles.toFixed(2)} mi</td><td data-label="Beds / baths">{row.beds ?? '-'} / {row.baths ?? '-'}</td><td data-label="Sq ft">{row.sqft?.toLocaleString() ?? '-'}</td><td data-label="$/sq ft">{row.pricePerSqft == null ? '-' : money.format(row.pricePerSqft)}</td></tr>)}</tbody>
        </table></div>}
        {!rows.length && radius < 5 && <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => setRadius(radius < 2 ? 2 : 5)}>Widen to {radius < 2 ? 2 : 5} miles</button>}
        <p className="pbk-comps-source">{data.windowStart} - {data.windowEnd} · Retrieved {data.retrievedAt ? new Date(data.retrievedAt).toLocaleString() : 'just now'}{data.partial ? ' · Provider result window limited' : ''}</p>
      </>}
  </section>;
}
