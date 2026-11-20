import type { OutlookDelivery } from '../utils/outlookDelivery.mjs';

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
  const [label, detail] = deliveryCopy[record.state] || deliveryCopy.approved;
  const at = new Date(record.at);

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
          {label}
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
      <p className="mt-1">{detail}</p>
      {record.receiptId && (
        <p className="mt-1 break-all font-mono">Outlook receipt {record.receiptId}</p>
      )}
    </div>
  );
}
