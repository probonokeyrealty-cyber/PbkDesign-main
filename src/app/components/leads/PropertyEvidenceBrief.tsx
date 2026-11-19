import { ArrowUpRight } from 'lucide-react';
import { compDate, compNumber, reviewedCompIds } from '../../utils/leadComps.mjs';
import type { readPropertyEvidence } from '../../utils/propertyEvidence';
import type { RecentSalesResult } from '../../utils/runtimeBridge';

type Evidence = ReturnType<typeof readPropertyEvidence>;
export type PropertyEvidenceTab = 'record' | 'photos' | 'comps';
const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
function capture(value?: string, label = 'Captured') {
  return value && Number.isFinite(Date.parse(value))
    ? <p className="pbk-evidence-brief-time">{label} <time dateTime={value}>{new Date(value).toLocaleString()}</time></p>
    : <p className="pbk-evidence-brief-time">Capture time unavailable</p>;
}

// Receives only the parent's address-validated, saved evidence. No provider or save actions.
export function PropertyEvidenceBrief({ records, listing, sales, onOpen }: Evidence & {
  sales: RecentSalesResult | null;
  onOpen: (tab: PropertyEvidenceTab) => void;
}) {
  const sections = records?.sections ?? [];
  const populated = sections.filter(section => section.status === 'ok' && (Object.keys(section.facts).length > 0 || section.rows.length > 0)).length;
  const retained = sections.filter(section => section.refreshStatus).length;
  const retainedCapture = sections.filter(section => section.refreshStatus && section.retrievedAt && Number.isFinite(Date.parse(section.retrievedAt))).map(section => section.retrievedAt!).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const unavailable = sections.filter(section => section.status !== 'ok').length;
  const photoCount = listing?.photoUrls.length ?? 0;
  const candidates = sales?.status === 'matched' && Array.isArray(sales.sales)
    ? [...new Map(sales.sales.slice(0, 20).filter(sale => sale && typeof sale.id === 'string' && sale.id.trim() && typeof sale.address === 'string' && sale.address.trim() && (compNumber(sale.price) ?? 0) > 0 && compDate(sale.soldDate)).map(sale => [sale.id, sale])).values()]
    : [];
  const reviewed = reviewedCompIds({ ...sales, sales: candidates }).length;
  return <section className="pbk-evidence-brief" aria-labelledby="property-evidence-brief-heading">
    <header>
      <div><p className="pbk-evidence-brief-eyebrow">Saved evidence / Lead review</p><h3 id="property-evidence-brief-heading">Evidence <em>brief.</em></h3></div>
      <p>See what is saved before your next decision.</p>
    </header>
    <div className="pbk-evidence-brief-grid">
      <article>
        <span className="pbk-evidence-brief-label">01 / Property record</span>
        <strong>{records ? 'Saved' : 'Not captured'}</strong>
        <p>{records ? (sections.length ? `${counted(populated, 'populated dataset')}` : 'Saved property record') : 'No saved property record'}</p>
        {retained > 0 && <p className="pbk-evidence-brief-caution">{retained} retained after a later refresh</p>}
        {unavailable > 0 && <p>{counted(unavailable, 'dataset')} unavailable</p>}
        {records && capture(records.retrievedAt, 'Snapshot captured')}
        {retained > 0 && (retainedCapture ? capture(retainedCapture, 'Oldest retained dataset captured') : <p className="pbk-evidence-brief-time">Retained dataset capture time unavailable.</p>)}
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen('record')}>Review records <ArrowUpRight size={14} aria-hidden /></button>
      </article>
      <article>
        <span className="pbk-evidence-brief-label">02 / Property photos</span>
        <strong>{photoCount || 'Not captured'}</strong>
        <p>{photoCount ? counted(photoCount, 'saved photo') : 'No saved photos'}</p>
        {listing && capture(listing.retrievedAt)}
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen('photos')}>Review photos <ArrowUpRight size={14} aria-hidden /></button>
      </article>
      <article>
        <span className="pbk-evidence-brief-label">03 / Comp review</span>
        <strong>{reviewed} / 3</strong>
        <p>{counted(reviewed, 'reviewed selection')}</p>
        <p>{candidates.length ? counted(candidates.length, 'saved sale candidate') : 'No saved recorded sales'}</p>
        {sales?.partial && <p className="pbk-evidence-brief-caution">Saved search coverage is limited.</p>}
        {candidates.length > 0 && capture(sales?.retrievedAt)}
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen('comps')}>Review comps <ArrowUpRight size={14} aria-hidden /></button>
      </article>
    </div>
    <div className="pbk-evidence-brief-follow-up">
      <h4>Still to review</h4>
      <ul>
        {!records && <li>Capture the property record with Refresh property intelligence when ready.</li>}
        {!photoCount && <li>Check listing sources for photos, or refresh when ready.</li>}
        {!reviewed && <li>{candidates.length ? 'Compare the saved sales and save your reviewed selections.' : 'Capture recorded sales when ready, then compare and save your selections.'}</li>}
        {(retained > 0 || unavailable > 0) && <li>Check retained or unavailable datasets in Property record.</li>}
        {records && photoCount > 0 && reviewed > 0 && !retained && !unavailable && <li>Verify condition, source dates, and comp fit before underwriting.</li>}
      </ul>
      <p>Saved evidence only. Sources run when you trigger Refresh or Analyze. Coverage is not an underwriting approval.</p>
    </div>
  </section>;
}
