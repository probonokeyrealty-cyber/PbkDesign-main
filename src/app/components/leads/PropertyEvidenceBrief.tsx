import { ArrowRight, ArrowUpRight, FileText, Images, ListChecks } from 'lucide-react';
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
  let next: { tab: PropertyEvidenceTab; action: string; detail: string } | undefined;
  if (!records) {
    next = { tab: 'record', action: 'Open property record', detail: 'There’s no saved property record for this lead.' };
  } else if (!reviewed && candidates.length) {
    next = { tab: 'comps', action: 'Compare saved comps', detail: 'Compare the saved sales and choose which ones to use in Analyzer.' };
  } else if (!candidates.length) {
    next = { tab: 'comps', action: 'Check comparable sales', detail: 'There are no recorded sales saved for comparison yet.' };
  } else if (!photoCount) {
    next = { tab: 'photos', action: 'Check photo sources', detail: 'There are no saved photos to verify property condition.' };
  } else if (retained || unavailable) {
    next = { tab: 'record', action: 'Check record coverage', detail: 'Review datasets kept from an earlier snapshot or marked unavailable.' };
  } else if (sales?.partial) {
    next = { tab: 'comps', action: 'Check comp coverage', detail: 'Saved search coverage is limited.' };
  }

  return <section className="pbk-evidence-brief" aria-labelledby="property-evidence-brief-heading">
    <header>
      <h3 id="property-evidence-brief-heading">Evidence <em>brief.</em></h3>
      <p>Review the evidence saved to this lead.</p>
    </header>
    {next && <div className="pbk-evidence-brief-next">
      <div>
        <h4>Next review</h4>
        <p>{next.detail}</p>
      </div>
      <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen(next.tab)}>
        {next.action} <ArrowRight size={16} aria-hidden />
      </button>
    </div>}
    <div className="pbk-evidence-brief-rows">
      <article>
        <FileText className="pbk-evidence-brief-icon" size={18} aria-hidden />
        <div>
          <h4>Property record</h4>
          <p>{records ? (sections.length ? counted(populated, 'populated dataset') : 'Saved property record') : 'No saved property record'}</p>
          {retained > 0 && <p className="pbk-evidence-brief-caution">{retained} retained after a later refresh</p>}
          {unavailable > 0 && <p className="pbk-evidence-brief-caution">{counted(unavailable, 'dataset')} unavailable</p>}
          {records && capture(records.retrievedAt, 'Snapshot captured')}
          {retained > 0 && (retainedCapture ? capture(retainedCapture, 'Oldest retained dataset captured') : <p className="pbk-evidence-brief-time">Retained dataset capture time unavailable.</p>)}
        </div>
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen('record')}>Review records <ArrowUpRight size={14} aria-hidden /></button>
      </article>
      <article>
        <Images className="pbk-evidence-brief-icon" size={18} aria-hidden />
        <div>
          <h4>Property photos</h4>
          <p>{photoCount ? counted(photoCount, 'saved photo') : 'No saved photos'}</p>
          {listing && capture(listing.retrievedAt)}
        </div>
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen('photos')}>Review photos <ArrowUpRight size={14} aria-hidden /></button>
      </article>
      <article>
        <ListChecks className="pbk-evidence-brief-icon" size={18} aria-hidden />
        <div>
          <h4>Comparable sales</h4>
          <div className="pbk-evidence-brief-counts">
            <p>{candidates.length ? counted(candidates.length, 'saved sale candidate') : 'No saved recorded sales'}</p>
            <p className={candidates.length > 0 && reviewed === 0 ? 'pbk-evidence-brief-caution' : undefined}>
              {counted(reviewed, 'reviewed selection')}
            </p>
          </div>
          {sales?.partial && <p className="pbk-evidence-brief-caution">Saved search coverage is limited.</p>}
          {candidates.length > 0 && capture(sales?.retrievedAt)}
        </div>
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen('comps')}>Review comps <ArrowUpRight size={14} aria-hidden /></button>
      </article>
    </div>
    <p className="pbk-evidence-brief-note">
      {next ? 'Use Refresh property intelligence to request new data for this lead.' : 'Verify condition, source dates, and comp fit before underwriting.'}
    </p>
  </section>;
}
