import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SessionTimeoutWarning } from '../components/SessionTimeoutWarning';
import { ShortcutCheatSheet } from '../components/ShortcutCheatSheet';
import { UiToastHost } from '../components/UiToastHost';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  applyPbkTheme,
  getSystemPbkTheme,
  hasStoredPbkThemePreference,
  readPbkPrefs,
  savePbkPrefs,
} from '../utils/uiPrefs';
import { getPendingApprovalCount } from '../routes/inboxRuntimeLogic.js';
import { showUiToast } from '../utils/uiFeedback';
import { FavoritesBar } from './FavoritesBar';
import { Sidebar } from './Sidebar';
import { ShellTopbar } from './ShellTopbar';

const VALID_SHELL_PATHS = new Set([
  '/',
  '/leads',
  '/deal',
  '/inbox',
  '/fleet',
  '/memory',
  '/analytics',
  '/campaigns',
  '/settings',
]);

function getPathnameOnly(path = '') {
  const trimmed = String(path || '').trim();
  if (!trimmed.startsWith('/')) return '';
  return trimmed.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
}

function isValidShellPath(path = '') {
  const pathname = getPathnameOnly(path);
  if (!pathname) return false;
  if (VALID_SHELL_PATHS.has(pathname)) return true;
  return /^\/deal\/[^/]+$/.test(pathname);
}

function dispatchShortcutEvent(eventName: string, label: string) {
  const detail = {
    handled: false,
    source: 'ParadiseLayout',
    shortcut: label,
  };
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
  window.setTimeout(() => {
    if (detail.handled) return;
    showUiToast({
      tone: 'info',
      title: 'Shortcut not handled',
      desc: `${label} has no active panel on this page.`,
    });
  }, 0);
}

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
  const [systemTheme, setSystemTheme] = useState(() => getSystemPbkTheme());
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [skeletonOn, setSkeletonOn] = useState(false);
  const lastPageRestoredRef = useRef(false);
  const { snapshot } = useRuntimeSnapshot(10000);
  const pendingApprovalCount = getPendingApprovalCount(snapshot || {});

  useEffect(() => {
    applyPbkTheme(prefs.theme);
  }, [prefs.theme]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const nextSystemTheme = getSystemPbkTheme();
      setSystemTheme(nextSystemTheme);
      if (!hasStoredPbkThemePreference()) {
        setPrefs((current) => ({ ...current, theme: nextSystemTheme }));
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const path = `${location.pathname}${location.search || ''}`;
    savePbkPrefs({ lastPage: path });
    setPrefs((current) => ({ ...current, lastPage: path }));
    setSkeletonOn(true);
    const timer = window.setTimeout(() => setSkeletonOn(false), 220);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (lastPageRestoredRef.current) return;
    lastPageRestoredRef.current = true;
    if (location.pathname !== '/' || prefs.lastPage === '/' || !prefs.lastPage) return;
    if (!isValidShellPath(prefs.lastPage)) {
      savePbkPrefs({ lastPage: '/' });
      showUiToast({
        tone: 'warning',
        title: 'Saved page unavailable',
        desc: 'The previous shell route no longer exists, so Command Center opened instead.',
      });
      return;
    }
    navigate(prefs.lastPage, { replace: true });
  }, [location.pathname, navigate, prefs.lastPage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const typing = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;
      const modalOpen = Boolean(document.querySelector('[role="dialog"], .modal-backdrop'));

      if (event.key === 'Escape') {
        setShortcutOpen(false);
        dispatchShortcutEvent('pbk:escape-ui', 'Escape');
        return;
      }

      if (event.key === '?' && !typing) {
        if (modalOpen) return;
        event.preventDefault();
        setShortcutOpen(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dispatchShortcutEvent('pbk:open-command-palette', 'Command palette');
        return;
      }

      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        dispatchShortcutEvent('pbk:call-now', 'Call now');
        return;
      }

      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        (
          document.querySelector('[data-approval-primary="true"]') as HTMLButtonElement | null
        )?.click();
        return;
      }

      if (typing) return;
      if (modalOpen) return;

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
        dispatchShortcutEvent('pbk:open-compose', 'Compose');
      } else if (event.key.toLowerCase() === 'a') {
        event.preventDefault();
        (
          document.querySelector('[data-approval-primary="true"]') as HTMLButtonElement | null
        )?.click();
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        (
          document.querySelector('[data-approval-secondary="true"]') as HTMLButtonElement | null
        )?.click();
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
        'pbk-shell-frame h-full w-full grid grid-cols-1 bg-slate-950 text-slate-100 overflow-hidden transition-[grid-template-columns]',
        prefs.railCollapsed ? 'md:grid-cols-[72px_1fr]' : 'md:grid-cols-[240px_1fr]',
      ].join(' ')}
    >
      <Sidebar
        collapsed={prefs.railCollapsed}
        pendingApprovals={pendingApprovalCount}
        onToggleRail={toggleRail}
      />
      <div className="pbk-shell-main-column grid grid-rows-[56px_auto_1fr] min-w-0 min-h-0">
        <ShellTopbar theme={prefs.theme} onToggleTheme={updateTheme} />
        <FavoritesBar />
        <main className="pbk-shell-content relative overflow-auto bg-slate-900">
          {skeletonOn && <div className="page-switch-skeleton" aria-hidden="true" />}
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="grid min-h-[280px] place-items-center text-sm text-slate-400">
                  Loading...
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <ShortcutCheatSheet open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <SessionTimeoutWarning
        onStayActive={() =>
          showUiToast({
            tone: 'success',
            title: 'Session kept active',
            desc: `Dashboard stays in ${systemTheme} system-aware mode.`,
          })
        }
      />
      <UiToastHost />
    </div>
  );
}
