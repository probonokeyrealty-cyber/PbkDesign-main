import { ClipboardList, Loader2 } from 'lucide-react';
import type { ParcelBrief } from '../utils/phoneDialerApi';

const matchLabels = { matched: 'Exact CRM match', no_match: 'No CRM match', ambiguous: 'Multiple CRM matches' };

export function ParcelProspectingBrief({ parcelLabel, brief, loading, disabled, error, onPrepare }: {
  parcelLabel: string;
  brief: ParcelBrief | null;
  loading: boolean;
  disabled: boolean;
  error: string;
  onPrepare: () => void;
}) {
  return (
    <section className="pbk-parcel-quick-view pbk-prospecting-brief" aria-labelledby="pbk-prospecting-brief-heading">
      <div className="pbk-dialer-section-head">
        <div>
          <h2 id="pbk-prospecting-brief-heading"><ClipboardList size={16} aria-hidden="true" /> Prospecting brief</h2>
          <p className="pbk-prospecting-brief-parcel">{parcelLabel}</p>
        </div>
        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={disabled} onClick={onPrepare}>
          {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {loading ? 'Preparing…' : brief ? 'Refresh brief' : 'Prepare brief'}
        </button>
      </div>
      {loading && <p role="status">Checking parcel and CRM facts…</p>}
      {error && <p className="pbk-phone-error" role="alert">{error}</p>}
      {brief ? (
        <>
          <div className="pbk-phone-actions" aria-label="Verified status">
            <span className="pbk-phone-tag sky">{matchLabels[brief.facts.match]}</span>
            {brief.facts.outreachHeld && <span className="pbk-phone-tag bad">Outreach on hold</span>}
            {!brief.facts.hasLotSize && <span className="pbk-phone-tag warn">Lot size missing</span>}
          </div>
          <ol className="pbk-prospecting-checks">
            {brief.steps.map(step => (
              <li key={step.id} data-outreach-hold={step.id === 'hold-outreach'}><strong>{step.title}</strong><p>{step.detail}</p></li>
            ))}
          </ol>
          <p className="pbk-phone-note" role="status">
            {brief.providers.deepSeek === 'used' ? 'DeepSeek prioritized the checks.' : 'PBK supplied the checks from saved facts.'}{' '}
            {brief.providers.claude === 'used' ? 'Claude reviewed the order.' : 'Claude review unavailable.'}
          </p>
        </>
      ) : !loading && <p>Get a prioritized checklist for this parcel and its current CRM match.</p>}
    </section>
  );
}
