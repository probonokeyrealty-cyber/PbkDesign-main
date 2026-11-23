import { useState } from 'react';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { fetchAvaLeadReviewRequest, type AvaLeadReview } from '../../utils/runtimeBridge';

const CONTACT_LABELS = {
  restricted: 'Contact blocked',
  recorded: 'Consent and DNC status on file',
  needs_review: 'Needs verification',
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
          </>
        )}
      </div>
    </section>
  );
}
