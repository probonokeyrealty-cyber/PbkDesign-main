import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';

export function Leads() {
  const { snapshot, loading, error } = useRuntimeSnapshot();
  const leads = Array.isArray(snapshot?.leadImports) ? snapshot.leadImports : [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Leads</h1>
          <p className="text-sm text-slate-400">
            Imported prospects, seller context, and address-level intake.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          {loading ? 'Loading leads…' : error || `${leads.length} lead records in the bridge`}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-3 border-b border-slate-800 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-slate-500">
          <span>Seller</span>
          <span>Address</span>
          <span>Source</span>
          <span>When</span>
        </div>

        <div className="divide-y divide-slate-800">
          {leads.slice(0, 12).map((lead) => (
            <div
              key={String(lead.id || lead.leadId)}
              className="grid grid-cols-1 gap-2 px-4 py-4 text-sm text-slate-200 md:grid-cols-[1.4fr_1fr_1fr_auto]"
            >
              <div>
                <div className="font-medium text-slate-100">{String(lead?.seller?.name || 'Unknown seller')}</div>
                <div className="text-xs text-slate-500">{String(lead?.seller?.phone || lead?.seller?.email || 'No contact captured')}</div>
              </div>
              <div className="text-slate-300">{String(lead?.property?.address || 'No property')}</div>
              <div className="text-slate-400">{String(lead?.source || 'manual')}</div>
              <div className="text-xs text-slate-500">{String(lead?.createdAt || '—').slice(0, 16).replace('T', ' ')}</div>
            </div>
          ))}

          {!leads.length && (
            <div className="px-4 py-10 text-center text-xs text-slate-500">
              No bridge leads loaded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
