import { useState } from 'react';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { fetchAvaLeadReviewRequest, type AvaLeadReview } from '../../utils/runtimeBridge';

const CONTACT_LABELS = {
  restricted: 'Contact blocked',
  recorded: 'Consent and DNC status on file',
  needs_review: 'Needs verification',
} as const;

const CONSULTATION_REASONS = {
  contact_restricted: 'Skipped because the lead had a contact restriction.',
  property_address_missing: 'Skipped because the property address was missing.',
  elevated_score: 'Consulted because the lead score met the review threshold.',
  score_below_threshold: 'Skipped because the lead score was below the review threshold.',
  score_unavailable: 'Skipped because no lead score was available.',
  no_recognized_signal: 'Skipped because intake found no recognized risk signal.',
  probate_or_estate: 'Consulted because intake flagged an estate issue.',
  tenant_pressure: 'Consulted because intake flagged a tenancy issue.',
  debt_deadline: 'Consulted because intake flagged a possible debt deadline.',
} as const;

export function AvaLeadReviewCard({ leadId }: { leadId: string }) {
  const [review, setReview] = useState<AvaLeadReview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function runReview() {
    setReview(undefined);
    setError(false);
    setLoading(true);
    try {
      setReview(await fetchAvaLeadReviewRequest(leadId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const evidence = review?.evidence;
  const decisions = review?.consultationDecisions;
  const analysisDate = evidence?.underwriting.recordedAt
    ? new Date(evidence.underwriting.recordedAt)
    : null;

  return (
    <section className="pbk-lead-portal-card space-y-3" aria-labelledby="ava-lead-review-heading">
      <header>
        <h2 id="ava-lead-review-heading">Ava lead review</h2>
        <ClipboardCheck size={19} aria-hidden="true" />
      </header>
      <p className="text-sm text-[var(--text-secondary)]">
        Review saved lead evidence and get a recommended next step. Calls, texts, and other provider
        actions require approval.
      </p>
      <button
        type="button"
        className="pbk-btn pbk-btn-ghost min-h-11"
        disabled={loading}
        onClick={runReview}
      >
        <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
        {loading
          ? 'Reviewing lead…'
          : error
            ? 'Retry review'
            : review
              ? 'Run review again'
              : 'Run read-only review'}
      </button>
      <div aria-live="polite" aria-busy={loading}>
        {error && <p role="alert">The review couldn’t load for this lead. Try again.</p>}
        {review && evidence && (
          <>
            <div
              className="pbk-contact-record-status"
              data-blocked={evidence.contact.status === 'restricted'}
            >
              <strong>{review.nextStep.title}</strong>
              <span>{review.nextStep.detail}</span>
            </div>
            <dl className="grid gap-2 text-sm [overflow-wrap:anywhere]">
              <div>
                <dt className="text-[var(--text-secondary)]">CRM property address</dt>
                <dd>{evidence.property.recorded ? 'On file' : 'Missing'}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-secondary)]">Contact records</dt>
                <dd>{CONTACT_LABELS[evidence.contact.status]}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-secondary)]">Seller qualification</dt>
                <dd>
                  {evidence.qualification.missing.length
                    ? `Missing ${evidence.qualification.missing.join(', ')}`
                    : 'Details on file'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-secondary)]">Saved underwriting</dt>
                <dd>
                  {evidence.underwriting.recorded
                    ? 'ARV and MAO on file'
                    : 'Complete numbers unavailable'}
                  {analysisDate && Number.isFinite(analysisDate.getTime()) && (
                    <span> · {analysisDate.toLocaleDateString()}</span>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-3 space-y-2 text-sm [overflow-wrap:anywhere]">
              <h3 className="font-semibold">Specialist decisions at intake</h3>
              {decisions?.version === 1 ? (
                <dl className="grid gap-2">
                  <div>
                    <dt className="text-[var(--text-secondary)]">Rex</dt>
                    <dd>{CONSULTATION_REASONS[decisions.rex] || 'Reason unavailable.'}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-secondary)]">Hermes</dt>
                    <dd>{CONSULTATION_REASONS[decisions.hermes] || 'Reason unavailable.'}</dd>
                  </div>
                </dl>
              ) : (
                <p>{decisions === null ? 'Reasons weren’t recorded at intake.' : 'Intake reasons are unavailable.'}</p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
