import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { ShortcutCheatSheet } from '../components/ShortcutCheatSheet';
import { UiToastHost } from '../components/UiToastHost';
import { applyPbkTheme, readPbkPrefs, savePbkPrefs } from '../utils/uiPrefs';
import { FavoritesBar } from './FavoritesBar';
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
  const location = useLocation();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState(() => readPbkPrefs());
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [skeletonOn, setSkeletonOn] = useState(false);

  useEffect(() => {
    applyPbkTheme(prefs.theme);
  }, [prefs.theme]);

  useEffect(() => {
    const path = `${location.pathname}${location.search || ''}`;
    savePbkPrefs({ lastPage: path });
    setPrefs((current) => ({ ...current, lastPage: path }));
    setSkeletonOn(true);
    const timer = window.setTimeout(() => setSkeletonOn(false), 220);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (location.pathname !== '/' || prefs.lastPage === '/' || !prefs.lastPage) return;
    navigate(prefs.lastPage, { replace: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const typing = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;

      if (event.key === 'Escape') {
        setShortcutOpen(false);
        window.dispatchEvent(new CustomEvent('pbk:escape-ui'));
        return;
      }

      if (event.key === '?' && !typing) {
        event.preventDefault();
        setShortcutOpen(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('pbk:open-command-palette'));
        return;
      }

      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('pbk:call-now'));
        return;
      }

      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        (document.querySelector('[data-approval-primary="true"]') as HTMLButtonElement | null)?.click();
        return;
      }

      if (typing) return;

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        document.getElementById('pbk-global-search')?.focus();
      } else if (event.key.toLowerCase() === 't') {
        setPrefs((current) => {
          const nextTheme = current.theme === 'light' ? 'dark' : 'light';
          return savePbkPrefs({ theme: nextTheme });
        });
      } else if (event.key === '[') {
        setPrefs((current) => {
          const nextCollapsed = !current.railCollapsed;
          return savePbkPrefs({ railCollapsed: nextCollapsed });
        });
      } else if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('pbk:open-compose'));
      } else if (event.key.toLowerCase() === 'a') {
        event.preventDefault();
        (document.querySelector('[data-approval-primary="true"]') as HTMLButtonElement | null)?.click();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        (document.querySelector('[data-approval-secondary="true"]') as HTMLButtonElement | null)?.click();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const updateTheme = () => {
    setPrefs((current) => {
      const nextTheme = current.theme === 'light' ? 'dark' : 'light';
      return savePbkPrefs({ theme: nextTheme });
    });
  };

  const toggleRail = () => {
    setPrefs((current) => {
      const railCollapsed = !current.railCollapsed;
      return savePbkPrefs({ railCollapsed });
    });
  };

  return (
    <div
      className={[
        'h-full w-full grid grid-cols-1 bg-slate-950 text-slate-100 overflow-hidden transition-[grid-template-columns]',
        prefs.railCollapsed ? 'md:grid-cols-[72px_1fr]' : 'md:grid-cols-[240px_1fr]',
      ].join(' ')}
    >
      <Sidebar collapsed={prefs.railCollapsed} onToggleRail={toggleRail} />
      <div className="grid grid-rows-[56px_auto_1fr] min-w-0 min-h-0">
        <ShellTopbar theme={prefs.theme} onToggleTheme={updateTheme} />
        <FavoritesBar />
        <main className="relative overflow-auto bg-slate-900">
          {skeletonOn && <div className="page-switch-skeleton" aria-hidden="true" />}
          <Outlet />
        </main>
      </div>
      <ShortcutCheatSheet open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <UiToastHost />
    </div>
  );
}
