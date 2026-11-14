import { Check, CircleAlert, CircleDot, Clock3 } from 'lucide-react';

export type DecisionPhase = 'idle' | 'unavailable' | 'review' | 'checking' | 'submitting' | 'cancelled' | 'changed' | 'unconfirmed' | 'recorded';
export type DecisionProgress = {
  phase: DecisionPhase;
  subject?: string;
  approvalId?: string;
  decision?: 'approved' | 'rejected' | 'needs-revision';
  acknowledgedAt?: string;
};
type StepState = 'done' | 'current' | 'waiting' | 'blocked';

const notes: Record<DecisionPhase, string> = {
  idle: 'Select a request to inspect its details before deciding.',
  unavailable: 'Queue unavailable. No decision can be submitted.',
  review: 'Review the exact request and recipient. Confirmation is still required.',
  checking: 'Checking the latest request before submitting your decision.',
  submitting: 'Decision in progress. Wait for an acknowledgement before acting again.',
  cancelled: 'Review cancelled. Nothing submitted.',
  changed: 'Request not verified. Review the latest queue before deciding.',
  unconfirmed: 'Outcome unknown. Check approval history before retrying.',
  recorded: 'The bridge acknowledged the decision. This is not proof of delivery.',
};

export function DecisionRail({ progress, available, showReceipt = true }: {
  progress: DecisionProgress;
  available: boolean;
  showReceipt?: boolean;
}) {
  const phase = !available && ['idle', 'review', 'cancelled', 'changed'].includes(progress.phase) ? 'unavailable' : progress.phase;
  const selected = !['idle', 'unavailable'].includes(phase);
  const steps: Array<{ label: string; detail: string; state: StepState }> = [
    { label: 'Action', detail: selected ? 'Request selected' : 'Select a request', state: selected ? 'done' : phase === 'unavailable' ? 'blocked' : 'current' },
    { label: 'Evidence', detail: phase === 'changed' ? 'Recheck required' : phase === 'checking' ? 'Checking latest' : selected ? 'Request details' : 'Not checked',
      state: phase === 'changed' ? 'blocked' : phase === 'checking' || phase === 'cancelled' ? 'current' : selected ? 'done' : 'waiting' },
    { label: 'Review', detail: phase === 'submitting' ? 'Submitting' : phase === 'unconfirmed' ? 'Outcome unknown' : phase === 'recorded' ? 'Decision acknowledged' : phase === 'review' ? 'Confirm or cancel' : 'Not submitted',
      state: phase === 'review' || phase === 'submitting' ? 'current' : phase === 'recorded' ? 'done' : 'waiting' },
    { label: 'Receipt', detail: phase === 'recorded' ? 'Decision recorded' : phase === 'unconfirmed' ? 'Not confirmed' : 'Awaiting acknowledgement',
      state: phase === 'recorded' ? 'done' : phase === 'unconfirmed' ? 'blocked' : 'waiting' },
  ];
  const hasReceipt = phase === 'recorded' && progress.approvalId && progress.acknowledgedAt && progress.decision;
  return (
    <div className="pbk-decision-rail" data-phase={phase}>
      {progress.subject && <p className="pbk-decision-subject">{progress.subject}</p>}
      <ol aria-label="Decision Rail">
        {steps.map(({ label, detail, state }, index) => {
          const Icon = state === 'done' ? Check : state === 'blocked' ? CircleAlert : state === 'current' ? CircleDot : Clock3;
          return <li key={label} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="pbk-decision-step-name"><Icon size={15} aria-hidden="true" /><span>{label}</span><small aria-hidden="true">0{index + 1}</small></span>
            <span className="pbk-decision-step-detail">{detail}</span>
          </li>;
        })}
      </ol>
      <p className="pbk-decision-note" role="status" aria-live="polite">{notes[phase]}</p>
      {showReceipt && hasReceipt && (
        <section className="pbk-decision-receipt" aria-label="Decision receipt">
          <div className="pbk-decision-receipt-heading"><Check size={16} aria-hidden="true" /><strong>Decision recorded</strong><span>Bridge acknowledgement</span></div>
          <dl>
            <div><dt>Request</dt><dd>{progress.approvalId}</dd></div>
            <div><dt>Decision</dt><dd>{progress.decision === 'approved' ? 'Approved' : progress.decision === 'rejected' ? 'Declined' : 'Revisions requested'}</dd></div>
            <div><dt>Acknowledged</dt><dd><time dateTime={progress.acknowledgedAt}>{new Date(progress.acknowledgedAt!).toLocaleString()}</time></dd></div>
            <div><dt>Delivery</dt><dd>Delivery not confirmed</dd></div>
          </dl>
        </section>
      )}
    </div>
  );
}
