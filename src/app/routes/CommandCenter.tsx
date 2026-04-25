/**
 * CommandCenter — landing route for the Paradise shell.
 *
 * Layout (Bloomberg-terminal style, 12-col grid):
 *   row 1: KPI tiles (4 across)
 *   row 2: LiveCallWidget (cols 1–5) + ActivityFeed placeholder (cols 6–12)
 *
 * KPI values + ActivityFeed are still placeholders; OpenClaw WS / Supabase
 * wiring lands in a follow-up step. The LiveCallWidget itself ships with a
 * realistic stub state so the page demos end-to-end.
 *
 * Take Over routes to `/deal/:id` when the live call has a linked dealId,
 * else to `/deal` (the engine workspace, mounted via routes/DealView.tsx).
 */
import { useNavigate } from 'react-router';
import { LiveCallWidget } from '../components/shell/LiveCallWidget';

const KPI = [
  { label: 'Active Leads', value: '—', hint: 'awaiting Supabase wiring' },
  { label: 'Calls Today', value: '—', hint: 'awaiting OpenClaw WS' },
  { label: 'Approvals Pending', value: '—', hint: 'awaiting agent stream' },
  { label: 'Deals in Pipeline', value: '—', hint: 'awaiting Supabase wiring' },
];

export function CommandCenter() {
  const navigate = useNavigate();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Command Center</h1>
        <p className="text-sm text-slate-400">
          Daily snapshot · live agent activity · approvals queue
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI.map((k) => (
          <div
            key={k.label}
            className="rounded-lg border border-slate-800 bg-slate-950 p-4"
          >
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {k.label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-100">
              {k.value}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">{k.hint}</div>
          </div>
        ))}
      </div>

      {/* Live call + activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5">
          <LiveCallWidget
            onTakeOver={(state) => {
              navigate(state.dealId ? `/deal/${state.dealId}` : '/deal');
            }}
            onMute={(state) => {
              // Placeholder — Phase 2 will call OpenClaw WS to mute Ava's
              // outbound audio while keeping the transcript stream alive.
              console.info('[LiveCallWidget] mute requested for', state.callId);
            }}
            onEnd={(state) => {
              // Placeholder — Phase 2 will issue Telnyx hangup via edge fn.
              console.info('[LiveCallWidget] end requested for', state.callId);
            }}
          />
        </div>

        <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-slate-950 p-4 min-h-[440px]">
          <div className="text-sm font-medium text-slate-200 mb-2">
            Activity Feed
          </div>
          <div className="text-xs text-slate-500">
            Placeholder · will stream from OpenClaw WebSocket in step (c).
          </div>
        </div>
      </div>
    </div>
  );
}
