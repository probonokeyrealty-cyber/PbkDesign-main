import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { ShellTopbar } from './ShellTopbar';

/**
 * ParadiseLayout — outer chrome of the Paradise shell.
 *
 * Grid: [sidebar 240px] [main 1fr]. Sidebar is fixed-width, main flexes.
 * Top of `main` is `ShellTopbar` (56px), rest is the routed content (`<Outlet />`).
 *
 * The engine (App.tsx + 22 components + locked dealCalculations) is mounted
 * inside the `<Outlet />` via `routes/DealView.tsx`. Nothing in the engine
 * is touched — it's a pure wrap.
 */
export function ParadiseLayout() {
  return (
    <div className="h-full w-full grid grid-cols-[240px_1fr] bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="grid grid-rows-[56px_1fr] min-w-0 min-h-0">
        <ShellTopbar />
        <main className="overflow-auto bg-slate-900">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
