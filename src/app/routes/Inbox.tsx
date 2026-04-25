/** Inbox — placeholder route for messages / approvals queue. */
export function Inbox() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Inbox</h1>
        <p className="text-sm text-slate-400">
          Approvals · seller replies · agent handoffs
        </p>
      </div>
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-6 text-center text-xs text-slate-500">
        Placeholder · will surface ApprovalCards from the agent stream.
      </div>
    </div>
  );
}
