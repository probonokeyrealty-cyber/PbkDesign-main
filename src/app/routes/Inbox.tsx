import { useState } from 'react';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import { updateApprovalDecision } from '../utils/runtimeBridge';

export function Inbox() {
  const { snapshot, loading, error, refresh } = useRuntimeSnapshot();
  const [pendingAction, setPendingAction] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const approvals = Array.isArray(snapshot?.approvals) ? snapshot.approvals.filter((item) => item.status === 'pending') : [];
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages.slice(0, 12) : [];

  const decideApproval = async (approval: Record<string, unknown>, status: string) => {
    const approvalId = String(approval.id || '');
    if (!approvalId) return;
    const key = `approval:${approvalId}:${status}`;
    setPendingAction(key);
    setActionStatus('');
    try {
      await updateApprovalDecision(approvalId, status);
      await refresh().catch(() => null);
      setActionStatus(status === 'approved' ? 'Approval sent to Ava.' : 'Decision sent to Ava.');
    } catch (nextError) {
      setActionStatus(nextError instanceof Error ? nextError.message : 'Approval update failed.');
    } finally {
      setPendingAction('');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Inbox</h1>
          <p className="text-sm text-slate-400">
            Approvals, seller replies, and agent handoffs from the runtime.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          {loading ? 'Loading inbox…' : error || `${messages.length} recent messages`}
        </div>
      </div>

      {actionStatus && (
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          {actionStatus}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Approval Queue</h2>
          <p className="mt-1 text-xs text-slate-500">Manual review items from Ava and Rex.</p>
          <div className="mt-3 space-y-2">
            {approvals.map((approval) => (
              <div
                key={String(approval.id)}
                className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3"
              >
                <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
                  {String(approval.type || 'approval')}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-100">
                  {String(approval.leadName || 'Pending lead')}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {String(approval.address || 'No address recorded')}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pendingAction === `approval:${String(approval.id)}:approved`}
                    onClick={() => void decideApproval(approval, 'approved')}
                    className="rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={pendingAction === `approval:${String(approval.id)}:rejected`}
                    onClick={() => {
                      const status = String(approval.type || '').toLowerCase() === 'contract' ? 'needs-revision' : 'rejected';
                      void decideApproval(approval, status);
                    }}
                    className="rounded-full border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
                  >
                    {String(approval.type || '').toLowerCase() === 'contract' ? 'Needs Revision' : 'Reject'}
                  </button>
                </div>
              </div>
            ))}
            {!approvals.length && (
              <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-xs text-slate-500">
                Nothing is waiting on human approval.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto] gap-3 border-b border-slate-800 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-slate-500">
            <span>Channel</span>
            <span>Message</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-slate-800">
            {messages.map((message) => (
              <div
                key={String(message.id)}
                className="grid grid-cols-1 gap-2 px-4 py-4 text-sm text-slate-200 md:grid-cols-[auto_1fr_auto]"
              >
                <div className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                  {String(message.channel || 'sms')}
                </div>
                <div>
                  <div className="font-medium text-slate-100">{String(message.leadName || message.address || 'Message')}</div>
                  <div className="mt-1 text-xs text-slate-400">{String(message.body || '(empty message)')}</div>
                </div>
                <div className="text-xs text-slate-500 md:text-right">
                  {String(message.status || 'sent')}
                </div>
              </div>
            ))}
            {!messages.length && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                No runtime messages yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
