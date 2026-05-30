import { NavLink } from 'react-router';
import {
  BarChart3,
  Bot,
  BrainCircuit,
  Briefcase,
  Inbox as InboxIcon,
  LayoutDashboard,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';

const NAV: Array<{ to: string; label: string; icon: typeof LayoutDashboard }> = [
  { to: '/', label: 'Command Center', icon: LayoutDashboard },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/deal', label: 'Deal', icon: Briefcase },
  { to: '/inbox', label: 'Inbox', icon: InboxIcon },
  { to: '/fleet', label: 'Agent Fleet', icon: Bot },
  { to: '/memory', label: 'Memory', icon: BrainCircuit },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleRail: () => void;
}

export function Sidebar({ collapsed, onToggleRail }: SidebarProps) {
  return (
    <aside className="hidden h-full bg-slate-950 border-r border-slate-800 md:flex md:flex-col">
      <div className="h-14 flex items-center justify-between gap-2 px-4 border-b border-slate-800">
        <div className="min-w-0">
          <span className="font-semibold tracking-wide text-slate-100">PBK</span>
          {!collapsed && (
            <span className="ml-2 text-xs uppercase tracking-widest text-slate-400">
              Paradise
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleRail}
          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-800 text-slate-500 transition hover:border-sky-500/40 hover:text-sky-200"
          aria-label={collapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
          title="Collapse/expand rail ([)"
        >
          [
        </button>
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
                collapsed ? 'justify-center' : '',
                isActive
                  ? 'bg-slate-800 text-white border-l-2 border-emerald-500'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900 border-l-2 border-transparent',
              ].join(' ')
            }
            title={collapsed ? label : undefined}
          >
            <Icon size={16} />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 text-[11px] text-slate-500 border-t border-slate-800">
        {collapsed ? 'v0.1' : 'v0.1 shell - engine intact'}
      </div>
    </aside>
  );
}
