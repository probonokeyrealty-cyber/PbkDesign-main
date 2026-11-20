import { useState, type FormEvent } from 'react';
import { normalizeOutlookReceiptUrl, type OutlookDelivery } from '../utils/outlookDelivery.mjs';
import { confirmOutlookDeliveryRequest } from '../utils/runtimeBridge';

const deliveryCopy: Record<string, [string, string]> = {
  pending: ['Awaiting approval', 'Ava will send after approval.'],
  approved: ['Approved', 'Waiting for a provider result.'],
  dispatching: ['Sending via Outlook', 'Waiting for Outlook to respond.'],
  accepted: ['Accepted by Outlook', 'Inbox delivery has not been confirmed here.'],
  delivered: ['Delivered', 'Delivery was confirmed by the provider.'],
  recovery: [
    'Needs reconciliation',
    'Outlook may have accepted this email. Check Sent Items or message trace before sending again. Ava will not retry automatically.',
  ],
  failed: [
    'Send failed',
    'Check the Outlook connection and lead email before requesting a new approval.',
  ],
  closed: ['Approval closed', 'This approval did not dispatch an email.'],
};

export function OutlookDeliveryStatus({
  record,
  showSubject = false,
  showLead = false,
}: {
  record: OutlookDelivery | null;
  showSubject?: boolean;
  showLead?: boolean;
}) {
  if (!record) return null;
  return (
    <OutlookDeliveryCard
      key={record.id}
      record={record}
      showSubject={showSubject}
      showLead={showLead}
    />
  );
}

function OutlookDeliveryCard({
  record: initial,
  showSubject,
  showLead,
}: {
  record: OutlookDelivery;
  showSubject: boolean;
  showLead: boolean;
}) {
  const [confirmed, setConfirmed] = useState<OutlookDelivery | null>(null);
  const [editing, setEditing] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [matched, setMatched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const record = initial.confirmation ? initial : confirmed || initial;
  const [label, detail] = deliveryCopy[record.state] || deliveryCopy.approved;
  const at = new Date(record.at);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !matched) return;
    const receiptUrl = normalizeOutlookReceiptUrl(receipt);
    if (!receiptUrl) {
      setError('Paste a direct Gmail or Outlook link to the received message.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      setConfirmed(await confirmOutlookDeliveryRequest(record.id, receiptUrl));
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save delivery confirmation.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="mt-2 min-w-0 rounded-md border border-slate-700/70 px-3 py-2 text-xs text-slate-400"
      data-outlook-delivery={record.state}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <strong
          className={
            record.state === 'recovery' || record.state === 'failed'
              ? 'text-amber-300'
              : 'text-slate-100'
          }
        >
          {record.confirmation ? 'Delivery confirmed' : label}
        </strong>
        {showSubject && Number.isFinite(at.getTime()) && (
          <time dateTime={record.at}>
            {at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
        )}
      </div>
      {showSubject && record.subject && (
        <p className="mt-1 break-words text-slate-200">{record.subject}</p>
      )}
      {showLead && record.leadName && <p className="mt-1 break-words">{record.leadName}</p>}
      <p className="mt-1">
        {record.confirmation ? (
          <>
            Inbox receipt checked by {record.confirmation.confirmedBy} on{' '}
            <time dateTime={record.confirmation.confirmedAt}>
              {new Date(record.confirmation.confirmedAt).toLocaleString()}
            </time>
            .
          </>
        ) : (
          detail
        )}
      </p>
      {record.confirmation && (
        <a
          href={record.confirmation.receiptUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-sky-400 underline"
        >
          Open inbox receipt
        </a>
      )}
      {record.receiptId && (
        <p className="mt-1 break-all font-mono">Outlook receipt {record.receiptId}</p>
      )}
      {record.canConfirm && !editing && (
        <button
          type="button"
          className="mt-2 rounded-md border border-slate-600 px-2 py-1 text-sky-400"
          onClick={() => setEditing(true)}
        >
          Confirm delivery
        </button>
      )}
      {record.canConfirm && editing && (
        <form className="mt-3 grid gap-2" onSubmit={save}>
          <label className="grid gap-1">
            Inbox receipt link
            <input
              type="url"
              autoFocus
              required
              maxLength={2048}
              value={receipt}
              onChange={(event) => setReceipt(event.target.value)}
              className="min-w-0 rounded-md border border-slate-600 bg-transparent px-2 py-1.5 text-slate-100"
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={matched}
              onChange={(event) => setMatched(event.target.checked)}
            />
            I checked that the received message matches this email.
          </label>
          {error && (
            <p role="alert" className="text-amber-300">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving || !matched}
              className="rounded-md border border-slate-600 px-2 py-1 text-sky-400 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save confirmation'}
            </button>
            <button
              type="button"
              disabled={saving}
              className="px-2 py-1"
              onClick={() => {
                setEditing(false);
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
