import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import type { DealData } from '../types';
import { fetchAddressSuggestions, fetchAttomPropertyPreview, type AttomPreviewAddress } from '../utils/runtimeBridge';
import '../../styles/property-intelligence.css';

export function AnalyzerAddressField({ deal, onChange }: { deal: DealData; onChange: (patch: Partial<DealData>) => void }) {
  const listId = useId();
  const latest = useRef(deal); latest.current = deal;
  const revision = useRef(0);
  const session = useRef('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [source, setSource] = useState<{ address: string; at: string; fields: string[] } | null>(null);
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => {
    let current = true;
    setSuggestions([]); setActive(-1);
    if (!focused || deal.address.trim().length < 4) return;
    const timer = setTimeout(() => {
      if (!session.current) session.current = crypto.randomUUID();
      void fetchAddressSuggestions({ query: deal.address, sessionToken: session.current }).then(result => {
        if (!current) return;
        setSuggestions(result.suggestions || []);
        setOpen(result.status === 'matched' && Boolean(result.suggestions?.length));
      }).catch(() => { if (current) setOpen(false); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [deal.address, focused]);

  async function hydrate(address: AttomPreviewAddress, expected: string, version: number) {
    const before = latest.current;
    const result = await fetchAttomPropertyPreview(address);
    if (revision.current !== version || latest.current.address.trim() !== expected.trim()) return;
    if (result.status !== 'matched') {
      setNotice(result.status === 'not_configured' ? 'Property facts are not connected.' : 'No verified property facts returned. Your entries are unchanged.'); return;
    }
    const fields = { beds: result.profile.beds, baths: result.profile.baths, sqft: result.profile.livingSqft, year: result.profile.yearBuilt };
    const patch: Partial<DealData> = {};
    const added: string[] = [];
    for (const field of ['beds', 'baths', 'sqft', 'year'] as const) {
      if (!latest.current[field] && latest.current[field] === before[field] && fields[field] != null) {
        patch[field] = fields[field]!; added.push(field);
      }
    }
    if (!latest.current.zipCode && latest.current.zipCode === before.zipCode) { patch.zipCode = address.zip; added.push('ZIP'); }
    if (latest.current.type === 'land' && !latest.current.landLotSizeSqFt && latest.current.landLotSizeSqFt === before.landLotSizeSqFt && result.profile.lotSqft) {
      patch.landLotSizeSqFt = result.profile.lotSqft; added.push('lot square feet');
    }
    if (latest.current.type === 'land' && !latest.current.lotSize && latest.current.lotSize === before.lotSize && result.profile.lotAcres) {
      patch.lotSize = String(result.profile.lotAcres); added.push('lot acres');
    }
    onChange(patch);
    setSource({ address: expected, at: new Date().toISOString(), fields: added });
    setNotice(added.length ? `${added.length} property facts added. Existing entries kept.` : 'Property verified. Existing entries kept.');
  }

  async function select(id: string) {
    const version = ++revision.current;
    setOpen(false); setFocused(false); setBusy(true); setNotice('');
    try {
      const result = await fetchAddressSuggestions({ placeId: id, sessionToken: session.current });
      if (revision.current !== version) return;
      if (result.status !== 'matched' || !result.address) { setNotice('Choose a complete US property address, including unit and ZIP.'); return; }
      const a = result.address;
      const full = `${a.street}, ${a.city}, ${a.state} ${a.zip}`;
      onChange({ address: full, isAnalyzed: false });
      // The parent rerenders before the provider completes; hydration rechecks the exact address.
      await hydrate(a, full, version);
    } catch { if (revision.current === version) setNotice('Property lookup failed. Your entries are unchanged.'); }
    finally { if (revision.current === version) setBusy(false); session.current = ''; }
  }
  async function verifyTyped() {
    const match = deal.address.trim().match(/^(.+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
    if (!match) { setNotice('Enter street, city, state and ZIP.'); return; }
    const version = ++revision.current; setBusy(true); setNotice('');
    try { await hydrate({ street: match[1], city: match[2], state: match[3], zip: match[4] }, deal.address, version); }
    catch { if (revision.current === version) setNotice('Property lookup failed. Your entries are unchanged.'); }
    finally { if (revision.current === version) setBusy(false); }
  }
  return <Popover.Root open={open} onOpenChange={setOpen}><div className="pbk-address-picker" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setOpen(false); setFocused(false); } }}>
    <Popover.Anchor asChild><div className="pbk-address-input-row">
      <input id="deal-property-address" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off" value={deal.address} placeholder="123 Main St, City, ST 12345"
        onFocus={() => setFocused(true)}
        onChange={e => { revision.current++; setBusy(false); setNotice(''); setSource(null); setFocused(true); onChange({ address: e.target.value, isAnalyzed: false }); }}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); return; }
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, suggestions.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
          if (e.key === 'Enter' && active >= 0) { e.preventDefault(); void select(suggestions[active].id); }
        }} />
      <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" title="Look up ATTOM property facts" aria-label="Look up ATTOM property facts" disabled={busy || !deal.address.trim()} onClick={() => void verifyTyped()}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}</button>
    </div></Popover.Anchor>
    {open && <Popover.Content className="pbk-address-suggestions" role="presentation" align="start" sideOffset={4}
      collisionPadding={{ top: 12, right: 12, bottom: 104, left: 12 }}
      onOpenAutoFocus={e => e.preventDefault()} onCloseAutoFocus={e => e.preventDefault()}>
      <ul id={listId} role="listbox" aria-label="Suggested addresses">
      {suggestions.map((s, i) => <li id={`${listId}-${i}`} role="option" aria-selected={i === active} key={s.id}>
        <button type="button" tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => void select(s.id)}>{s.label}</button>
      </li>)}
    </ul><div className="pbk-places-attribution" translate="no">Google Maps</div></Popover.Content>}
    <p role="status" aria-live="polite" className="pbk-address-notice">{busy ? 'Looking up property facts...' : notice}</p>
    {source?.address === deal.address && <small className="pbk-address-source">ATTOM · {new Date(source.at).toLocaleDateString()} · {source.fields.join(', ') || 'Address verified'}</small>}
  </div></Popover.Root>;
}
