import { ListChecks, X } from 'lucide-react';
import type { ParcelProspect } from '../utils/parcelProspecting';

type Props = {
  items: ParcelProspect[];
  selectedId: string;
  disabled: boolean;
  onReview: (item: ParcelProspect) => void;
  onToggle: (item: ParcelProspect) => void;
  onRemove: (item: ParcelProspect) => void;
};

export function ParcelProspectingList({ items, selectedId, disabled, onReview, onToggle, onRemove }: Props) {
  const remaining = items.filter(item => !item.reviewed);
  const next = remaining.find(item => item.parcelId !== selectedId);
  return (
    <section className="pbk-parcel-quick-view pbk-prospecting-list" id="prospecting-list" aria-labelledby="pbk-prospecting-heading" tabIndex={-1}>
      <div className="pbk-dialer-section-head">
        <h2 id="pbk-prospecting-heading"><ListChecks size={16} aria-hidden="true" /> Prospecting shortlist</h2>
        <span className="pbk-phone-tag sky" role="status">{remaining.length} to review</span>
      </div>
      <p>Kept in this tab. Opening a parcel checks its current CRM match.</p>
      {items.length ? (
        <>
          {next && <div><button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={disabled} onClick={() => onReview(next)}>Review next parcel</button></div>}
          <ul className="pbk-prospecting-items">
            {items.map(item => (
              <li key={item.parcelId}>
                <div>
                  <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm pbk-prospecting-parcel" disabled={disabled}
                    aria-current={item.parcelId === selectedId ? 'true' : undefined} onClick={() => onReview(item)}>{item.label}</button>
                  <span className="pbk-phone-note">{item.parcelId} · {item.reviewed ? 'Reviewed' : 'To review'}</span>
                </div>
                <div className="pbk-phone-actions">
                  <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={disabled}
                    aria-label={`${item.reviewed ? 'Return to review' : 'Mark reviewed'}: ${item.label}`}
                    onClick={() => onToggle(item)}>{item.reviewed ? 'Reopen review' : 'Mark reviewed'}</button>
                  <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={disabled} aria-label={`Remove ${item.label} from shortlist`}
                    onClick={() => onRemove(item)}><X size={14} aria-hidden="true" /></button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : <p>Select a verified parcel to add it for review.</p>}
    </section>
  );
}
