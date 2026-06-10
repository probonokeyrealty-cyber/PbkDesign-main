import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SessionTimeoutWarning } from '../components/SessionTimeoutWarning';
import { ShortcutCheatSheet } from '../components/ShortcutCheatSheet';
import { TeamAccessGate } from '../components/TeamAccessGate';
import { UiToastHost } from '../components/UiToastHost';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import {
  applyPbkTheme,
  getSystemPbkTheme,
  hasStoredPbkThemePreference,
  type PbkPrefs,
  readPbkPrefs,
  savePbkPrefs,
} from '../utils/uiPrefs';
import { updateRuntimeSettingsRequest, type RuntimeSnapshot } from '../utils/runtimeBridge';
import { getPendingApprovalCount } from '../routes/inboxRuntimeLogic.js';
import { showUiToast } from '../utils/uiFeedback';
import { FavoritesBar } from './FavoritesBar';
import { MobileShellNavigation, Sidebar } from './Sidebar';
import { ShellTopbar } from './ShellTopbar';

const VALID_SHELL_PATHS = new Set([
  '/',
  '/command-center',
  '/dashboard',
  '/leads',
  '/deal',
  '/inbox',
  '/inbox/conversations',
  '/fleet',
  '/agents',
  '/memory',
  '/skills',
  '/skill-studio',
  '/analytics',
  '/campaigns',
  '/ava-chat',
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
  return /^\/deal\/[^/]+$/.test(pathname) || /^\/leads\/[^/]+$/.test(pathname);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getBridgeShellPrefs(
  snapshot?: RuntimeSnapshot | null
): Partial<Pick<PbkPrefs, 'theme' | 'railCollapsed'>> {
  const settings = asRecord(snapshot?.settings);
  const ui = asRecord(settings.ui);
  const theme = ui.theme === 'light' || ui.theme === 'dark' ? ui.theme : undefined;
  const railCollapsed = typeof ui.railCollapsed === 'boolean' ? ui.railCollapsed : undefined;
  return { theme, railCollapsed };
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
  const [prefs, setPrefs] = useState(() => readPbkPrefs());
  const [systemTheme, setSystemTheme] = useState(() => getSystemPbkTheme());
  const [prefsSource, setPrefsSource] = useState('Local fallback');
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [skeletonOn, setSkeletonOn] = useState(false);
  const bridgePrefsHydratedRef = useRef(false);
  const { snapshot, refresh } = useRuntimeSnapshot(10000);
  const pendingApprovalCount = getPendingApprovalCount(snapshot || {});

  const persistShellPrefs = useCallback(
    async (updates: Partial<Pick<PbkPrefs, 'theme' | 'railCollapsed'>>) => {
      const next = savePbkPrefs(updates);
      setPrefs(next);
      try {
        await updateRuntimeSettingsRequest({
          ui: updates,
          actor: 'ParadiseLayout',
        });
        setPrefsSource('Bridge settings');
        await refresh();
      } catch (error) {
        setPrefsSource('Local fallback');
        showUiToast({
          tone: 'warning',
          title: 'Shell preference saved locally',
          desc:
            error instanceof Error
              ? `${error.message}. Using localStorage:pbk:prefs:v1 fallback.`
              : 'Bridge settings were unavailable. Using localStorage:pbk:prefs:v1 fallback.',
        });
      }
      return next;
    },
    [refresh]
  );

  useEffect(() => {
    applyPbkTheme(prefs.theme);
  }, [prefs.theme]);

  useEffect(() => {
    const bridgePrefs = getBridgeShellPrefs(snapshot);
    const hasBridgePrefs = bridgePrefs.theme || typeof bridgePrefs.railCollapsed === 'boolean';
    if (!hasBridgePrefs) return;
    bridgePrefsHydratedRef.current = true;
    setPrefsSource('Bridge settings');
    setPrefs((current) => {
      const nextUpdates: Partial<PbkPrefs> = {};
      if (bridgePrefs.theme && bridgePrefs.theme !== current.theme) {
        nextUpdates.theme = bridgePrefs.theme;
      }
      if (
        typeof bridgePrefs.railCollapsed === 'boolean' &&
        bridgePrefs.railCollapsed !== current.railCollapsed
      ) {
        nextUpdates.railCollapsed = bridgePrefs.railCollapsed;
      }
      if (!Object.keys(nextUpdates).length) return current;
      return savePbkPrefs(nextUpdates);
    });
  }, [snapshot]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const nextSystemTheme = getSystemPbkTheme();
      setSystemTheme(nextSystemTheme);
      if (!bridgePrefsHydratedRef.current && !hasStoredPbkThemePreference()) {
        setPrefs((current) => ({ ...current, theme: nextSystemTheme }));
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const path = `${location.pathname}${location.search || ''}`;
    const savedPath = isValidShellPath(path) ? path : '/';
    savePbkPrefs({ lastPage: savedPath });
    setPrefs((current) => ({ ...current, lastPage: savedPath }));
    const routeTitle =
      location.pathname === '/'
        ? 'Command Center'
        : location.pathname
            .split('/')
            .filter(Boolean)
            .map((segment) => segment.replace(/-/g, ' '))
            .map((segment) => segment.replace(/\b\w/g, (letter) => letter.toUpperCase()))
            .join(' - ');
    document.title = `${routeTitle || 'Command Center'} | PBK`;
    setSkeletonOn(true);
    const timer = window.setTimeout(() => setSkeletonOn(false), 220);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.search]);

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
        const nextTheme = readPbkPrefs().theme === 'light' ? 'dark' : 'light';
        void persistShellPrefs({ theme: nextTheme });
      } else if (event.key === '[') {
        const railCollapsed = !readPbkPrefs().railCollapsed;
        void persistShellPrefs({ railCollapsed });
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
  }, [persistShellPrefs]);

  const updateTheme = () => {
    const nextTheme = prefs.theme === 'light' ? 'dark' : 'light';
    void persistShellPrefs({ theme: nextTheme });
  };

  const toggleRail = () => {
    void persistShellPrefs({ railCollapsed: !prefs.railCollapsed });
  };

  const isFullHeightChatRoute =
    location.pathname === '/inbox/conversations' || location.pathname === '/ava-chat';

  return (
    <TeamAccessGate
      onAuthenticated={async () => {
        await refresh();
      }}
    >
      <div
        className={[
          'pbk-shell-frame h-full w-full grid grid-cols-1 bg-slate-950 text-slate-100 overflow-hidden transition-[grid-template-columns]',
          prefs.railCollapsed ? 'md:grid-cols-[72px_1fr]' : 'md:grid-cols-[240px_1fr]',
        ].join(' ')}
      >
        <Sidebar
          collapsed={prefs.railCollapsed}
          pendingApprovals={pendingApprovalCount}
          prefsSource={prefsSource}
          onToggleRail={toggleRail}
        />
        <div
          className={[
            'pbk-shell-main-column grid grid-rows-[56px_auto_1fr] min-w-0 min-h-0',
            isFullHeightChatRoute ? 'pbk-shell-main-column-chat' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <ShellTopbar
            theme={prefs.theme}
            themeDataSource={prefsSource}
            onToggleTheme={updateTheme}
          />
          <FavoritesBar snapshot={snapshot} refresh={refresh} />
          <main
            className={[
              'pbk-shell-content relative overflow-auto bg-slate-900',
              isFullHeightChatRoute ? 'pbk-shell-content-chat' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
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
        <MobileShellNavigation pendingApprovals={pendingApprovalCount} />
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
    </TeamAccessGate>
  );
}
