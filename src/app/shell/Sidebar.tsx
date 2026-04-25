import { NavLink } from 'react-router';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Inbox as InboxIcon,
  Settings as SettingsIcon,
} from 'lucide-react';

const NAV: Array<{ to: string; label: string; icon: typeof LayoutDashboard }> = [
  { to: '/', label: 'Command Center', icon: LayoutDashboard },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/deal', label: 'Deal', icon: Briefcase },
  { to: '/inbox', label: 'Inbox', icon: InboxIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * Sidebar — left nav rail for the Paradise shell.
 * Uses react-router's NavLink for active-state styling.
 * Order matches the planned IA: Command Center → Leads → Deal → Inbox → Settings.
 */
export function Sidebar() {
  return (
    <aside className="h-full bg-slate-950 border-r border-slate-800 flex flex-col">
      <div className="h-14 flex items-center px-4 border-b border-slate-800">
        <span className="font-semibold tracking-wide text-slate-100">PBK</span>
        <span className="ml-2 text-xs uppercase tracking-widest text-slate-400">
          Paradise
        </span>
      </div>

      <nav className="flex-1 py-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-slate-800 text-white border-l-2 border-emerald-500'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900 border-l-2 border-transparent',
              ].join(' ')
            }
          >
            <Icon size={16} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-3 text-[11px] text-slate-500 border-t border-slate-800">
        v0.1 shell · engine intact
      </div>
    </aside>
  );
}
