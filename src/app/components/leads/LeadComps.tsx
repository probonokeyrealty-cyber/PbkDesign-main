import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { patchLeadRequest, type AttomPreviewAddress, type RecentSalesResult } from '../../utils/runtimeBridge';
import { compDate, compNumber, reviewedCompIds, selectedCompPatch } from '../../utils/leadComps.mjs';
import { CompComparison, compMoney, compMetric, compDistance } from './CompComparison';
import { hasLookupAddress } from './AttomPropertyPreview';
import '../../../styles/property-intelligence.css';

const messages: Record<string, string> = {
  invalid_address: 'Complete the property address, city, state and ZIP to find sales.',
  invalid_radius: 'Choose a supported search radius.',
  not_configured: 'ATTOM recent sales is not connected. Your saved lead is unchanged.',
  authorization_failed: 'ATTOM did not authorize this search. Check the provider connection.',
  rate_limited: 'ATTOM is limiting requests. Wait before retrying.',
  timed_out: 'The recorded-sales search timed out. Your lead is unchanged.',
  unavailable: 'Could not reach the record source. Your lead is unchanged.',
};

export function LeadComps({ address, leadId = '', savedSales, onRefresh, refreshing = false, onSaved, onSavingChange }: {
  address: AttomPreviewAddress;
  leadId?: string;
  savedSales?: RecentSalesResult | null;
  onRefresh?: (radiusMiles: number) => void | Promise<void>;
  refreshing?: boolean;
  onSaved?: (leadId: string) => Promise<void>;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [radius, setRadius] = useState(savedSales?.radiusMiles || 1);
  const [sort, setSort] = useState('date');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const queryKey = JSON.stringify([address.street, address.city, address.state, address.zip]);
  const scope = useRef(''); scope.current = leadId + queryKey;
  const complete = hasLookupAddress(address) || /^.+,\s*[^,]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i.test(address.street);
  useEffect(() => {
    scope.current = leadId + queryKey;
    setSelected([]); setSaveStatus(''); setSaving(false);
  }, [queryKey, leadId]);
  useEffect(() => { setSelected(reviewedCompIds(savedSales)); }, [savedSales]);
  useEffect(() => () => { scope.current = ''; }, []);
  const data = savedSales;
  const loading = refreshing;
  const rows = useMemo(() => [...(data?.sales || [])].sort((a, b) => sort === 'price'
    ? (compNumber(b.price) ?? -1) - (compNumber(a.price) ?? -1) : sort === 'distance' ? (compNumber(a.distanceMiles) ?? Infinity) - (compNumber(b.distanceMiles) ?? Infinity) : compDate(b.soldDate).localeCompare(compDate(a.soldDate))), [data, sort]);
  async function saveSelection() {
    if (!leadId || !data || saving || refreshing) return;
    const current = scope.current;
    setSaving(true); setSaveStatus(''); onSavingChange?.(true);
    try {
      const patch = selectedCompPatch(data, selected, address);
      const response = await patchLeadRequest(leadId, patch);
      if (response.ok === false) throw Error('The bridge did not save the selected comps.');
      if (scope.current === current) {
        setSaveStatus('Selected comps saved to this lead.');
        try { await onSaved?.(leadId); } catch {
          if (scope.current === current) setSaveStatus('Selected comps saved. Reopen the lead to reload the saved view.');
        }
      }
    } catch (error) {
      if (scope.current === current) setSaveStatus(error instanceof Error ? error.message : 'Unable to save comps. Retry when the bridge is available.');
    } finally { onSavingChange?.(false); if (scope.current === current) setSaving(false); }
  }
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
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" title="Refresh property intelligence with selected radius" aria-label="Refresh property intelligence with selected radius" disabled={loading || saving || !complete || !onRefresh} onClick={() => void onRefresh?.(radius)}><RefreshCw size={16} /></button>
      </div>
    </header>
    {!complete ? <p role="status">Complete the property address to find nearby sales.</p>
      : loading ? <div role="status" className="pbk-comps-loading"><Loader2 size={18} className="animate-spin" /> Looking up recorded sales...</div>
      : !data ? <p role="status">No saved recorded sales. Refresh property intelligence to find nearby sales.</p>
      : data.status !== 'matched' ? <div role="alert" className="pbk-comps-error"><AlertCircle size={18} /><p>{messages[data.status] || messages.unavailable}</p><button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={!onRefresh || saving} onClick={() => void onRefresh?.(radius)}>Retry property intelligence</button></div>
      : <>
        <p role="status">{rows.length ? `${rows.length} saved sales · Suggestions requiring review` : `No recorded sales within ${data.radiusMiles ?? radius} miles in the saved search window.`}</p>
        {data.radiusMiles !== radius && <p className="pbk-comps-source">Choose refresh to search the selected radius. The saved results remain visible until then.</p>}
        <CompComparison sales={selected.flatMap(id => data.sales?.find(sale => sale.id === id) ?? [])} disabled={saving || refreshing} onRemove={id => { setSaveStatus(''); setSelected(ids => ids.filter(value => value !== id)); }} />
        {rows.length > 0 && <div className="pbk-comps-table-scroll"><table>
          <caption className="sr-only">Recent sales from {data.windowStart} to {data.windowEnd}</caption>
          <thead><tr><th scope="col">Property</th><th scope="col">Sold</th><th scope="col">Price</th><th scope="col">Distance</th><th scope="col">Beds / baths</th><th scope="col">Sq ft</th><th scope="col">$/sq ft</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{leadId && <input type="checkbox" aria-label={`Select comp ${row.address}`} checked={selected.includes(row.id)} disabled={saving || (!selected.includes(row.id) && selected.length >= 3)} onChange={e => { setSaveStatus(''); setSelected(ids => e.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id)); }} />} {row.address}<small>{row.propertyType || 'Type not reported'}</small></th><td data-label="Sold">{compDate(row.soldDate) || 'Not reported'}</td><td data-label="Price">{compMoney(row.price)}</td><td data-label="Distance">{compDistance(row.distanceMiles)}</td><td data-label="Beds / baths">{compMetric(row.beds)} / {compMetric(row.baths)}</td><td data-label="Sq ft">{compMetric(row.sqft)}</td><td data-label="$/sq ft">{compMoney(row.pricePerSqft)}</td></tr>)}</tbody>
        </table></div>}
        {!rows.length && radius < 5 && <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => setRadius(radius < 2 ? 2 : 5)}>Widen to {radius < 2 ? 2 : 5} miles</button>}
        <p className="pbk-comps-source">{data.windowStart} - {data.windowEnd} · Retrieved {data.retrievedAt && Number.isFinite(Date.parse(data.retrievedAt)) ? new Date(data.retrievedAt).toLocaleString() : 'time unavailable'}{data.partial ? ' · Provider result window limited' : ''}</p>
        {leadId && <div className="pbk-comps-selection">
          <span>{selected.length}/3 selected{selected.length ? ' · replaces saved comp set' : ''}</span>
          <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={!selected.length || saving} onClick={() => void saveSelection()}>{saving ? 'Saving...' : 'Save selected comps'}</button>
          <Link className="pbk-btn pbk-btn-ghost pbk-btn-sm" to={`/deal/${encodeURIComponent(leadId)}`}>Open analyzer</Link>
          {saveStatus && <p role="status">{saveStatus}</p>}
        </div>}
      </>}
  </section>;
}
