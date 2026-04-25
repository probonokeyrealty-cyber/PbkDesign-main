/**
 * Leads — placeholder list route.
 * Will be wired to Supabase via `useLeads()` in the next step.
 */
export function Leads() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Leads</h1>
        <p className="text-sm text-slate-400">
          Inbound leads · CSV uploads · scored by Ava
        </p>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950 p-6 text-center">
        <div className="text-sm text-slate-300">No leads loaded yet</div>
        <div className="text-xs text-slate-500 mt-1">
          Placeholder · awaiting Supabase `useLeads()` hook.
        </div>
      </div>
    </div>
  );
}
