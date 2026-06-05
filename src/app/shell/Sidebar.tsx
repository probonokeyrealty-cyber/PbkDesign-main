import { useState } from 'react';
import { NavLink } from 'react-router';
import {
  BarChart3,
  Bot,
  BrainCircuit,
  Briefcase,
  Inbox as InboxIcon,
  LayoutDashboard,
  Menu,
  Megaphone,
  Settings as SettingsIcon,
  Users,
  X,
} from 'lucide-react';

export const SHELL_NAV_ITEMS: Array<{ to: string; label: string; icon: typeof LayoutDashboard }> = [
  { to: '/', label: 'Command Center', icon: LayoutDashboard },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/deal', label: 'Deal', icon: Briefcase },
  { to: '/inbox', label: 'Inbox', icon: InboxIcon },
  { to: '/fleet', label: 'Agent Fleet', icon: Bot },
  { to: '/memory', label: 'Memory', icon: BrainCircuit },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

function buildReleaseLabel(collapsed: boolean) {
  const commit = String(
    import.meta.env.VITE_COMMIT_SHA || import.meta.env.VITE_GIT_SHA || ''
  ).slice(0, 7);
  const release = String(
    import.meta.env.VITE_PBK_RELEASE ||
      import.meta.env.VITE_APP_VERSION ||
      import.meta.env.VITE_RELEASE_ID ||
      commit ||
      'dev'
  );
  const buildDate = String(
    import.meta.env.VITE_BUILD_DATE || import.meta.env.VITE_BUILD_TIME || ''
  ).trim();
  if (collapsed) return release;
  return [release, buildDate || 'local build'].filter(Boolean).join(' shell - ');
}

interface SidebarProps {
  collapsed: boolean;
  pendingApprovals?: number;
  prefsSource?: string;
  onToggleRail: () => void;
}

export function Sidebar({
  collapsed,
  pendingApprovals = 0,
  prefsSource = 'Local fallback',
  onToggleRail,
}: SidebarProps) {
  return (
    <aside className="pbk-shell-sidebar hidden h-full bg-slate-950 border-r border-slate-800 md:flex md:flex-col">
      <div className="pbk-shell-sidebar-head h-14 flex items-center justify-between gap-2 px-4 border-b border-slate-800">
        <div className="pbk-shell-brand min-w-0">
          <span className="pbk-shell-brand-mark">PBK</span>
          {!collapsed && <span className="pbk-shell-brand-word">Paradise</span>}
        </div>
        <button
          type="button"
          onClick={onToggleRail}
          data-source="PATCH /api/settings ui.railCollapsed"
          data-fallback="localStorage:pbk:prefs:v1"
          className="pbk-shell-rail-toggle grid h-8 w-8 place-items-center rounded-lg border border-slate-800 text-slate-500 transition hover:border-sky-500/40 hover:text-sky-200"
          aria-label={collapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
          title={`Collapse/expand rail ([) - ${prefsSource}`}
        >
          [
        </button>
      </div>

      <nav className="pbk-shell-nav flex-1 py-3">
        {SHELL_NAV_ITEMS.map(({ to, label, icon: Icon }) => {
          const showBadge = to === '/inbox' && pendingApprovals > 0;
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'pbk-shell-nav-link flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                  collapsed ? 'justify-center' : '',
                  isActive
                    ? 'active bg-slate-800 text-white border-l-2 border-emerald-500'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900 border-l-2 border-transparent',
                ].join(' ')
              }
              title={collapsed ? label : undefined}
            >
              <span className="relative grid place-items-center">
                <Icon size={16} />
                {showBadge && collapsed && (
                  <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-amber-300 px-1 text-center text-[10px] font-bold leading-4 text-slate-950">
                    {pendingApprovals > 9 ? '9+' : pendingApprovals}
                  </span>
                )}
              </span>
              {!collapsed && (
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span>{label}</span>
                  {showBadge && (
                    <span className="min-w-5 rounded-full bg-amber-300 px-1.5 text-center text-[10px] font-bold leading-5 text-slate-950">
                      {pendingApprovals > 99 ? '99+' : pendingApprovals}
                    </span>
                  )}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div
        className="pbk-shell-release p-3 text-[11px] text-slate-500 border-t border-slate-800"
        data-source="build env"
      >
        {buildReleaseLabel(collapsed)}
      </div>
    </aside>
  );
}

export function MobileShellNavigation({ pendingApprovals = 0 }: { pendingApprovals?: number }) {
  const [open, setOpen] = useState(false);
  const primaryItems = SHELL_NAV_ITEMS.slice(0, 4);
  const overflowItems = SHELL_NAV_ITEMS.slice(4);

  return (
    <>
      <nav className="pbk-mobile-shell-nav md:hidden" aria-label="Mobile shell navigation">
        {primaryItems.map(({ to, label, icon: Icon }) => {
          const showBadge = to === '/inbox' && pendingApprovals > 0;
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `pbk-mobile-shell-nav-item ${isActive ? 'active' : ''}`.trim()
              }
              aria-label={label}
            >
              <span className="pbk-mobile-shell-nav-icon">
                <Icon size={17} />
                {showBadge && (
                  <span className="pbk-mobile-shell-nav-badge">
                    {pendingApprovals > 9 ? '9+' : pendingApprovals}
                  </span>
                )}
              </span>
              <span>{label === 'Command Center' ? 'Command' : label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className="pbk-mobile-shell-nav-item"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="pbk-mobile-shell-menu"
          aria-label="Open all dashboard pages"
        >
          <span className="pbk-mobile-shell-nav-icon">
            <Menu size={18} />
          </span>
          <span>More</span>
        </button>
      </nav>

      {open && (
        <div
          className="pbk-mobile-shell-menu-backdrop md:hidden"
          role="presentation"
          onMouseDown={() => setOpen(false)}
        >
          <section
            id="pbk-mobile-shell-menu"
            className="pbk-mobile-shell-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pbk-mobile-shell-menu-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="pbk-mobile-shell-menu-head">
              <div>
                <div className="pbk-mobile-shell-menu-kicker">PBK navigation</div>
                <h2 id="pbk-mobile-shell-menu-title">All dashboard pages</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation">
                <X size={18} />
              </button>
            </div>
            <div className="pbk-mobile-shell-menu-grid">
              {overflowItems.map(({ to, label, icon: Icon }) => {
                const showBadge = to === '/inbox' && pendingApprovals > 0;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `pbk-mobile-shell-menu-link ${isActive ? 'active' : ''}`.trim()
                    }
                    onClick={() => setOpen(false)}
                  >
                    <Icon size={17} />
                    <span>{label}</span>
                    {showBadge && (
                      <strong>{pendingApprovals > 99 ? '99+' : pendingApprovals}</strong>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
