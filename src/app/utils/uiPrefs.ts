export type PbkPrefs = {
  theme: 'dark' | 'light';
  railCollapsed: boolean;
  lastPage: string;
  tourCompleted: boolean;
};

export const PBK_PREFS_KEY = 'pbk:prefs:v1';

export const DEFAULT_PBK_PREFS: PbkPrefs = {
  theme: 'dark',
  railCollapsed: false,
  lastPage: '/',
  tourCompleted: false,
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Resolve the browser/system color preference for PBK shell startup. */
export function getSystemPbkTheme(): PbkPrefs['theme'] {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function hasStoredPbkThemePreference() {
  if (!canUseStorage()) return false;
  try {
    const raw = window.localStorage.getItem(PBK_PREFS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<PbkPrefs>;
    return parsed.theme === 'light' || parsed.theme === 'dark';
  } catch {
    return false;
  }
}

export function readLegacyPbkDarkModePreference(): boolean | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem('pbk-dark-mode');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    return null;
  }
  return null;
}

export function writeLegacyPbkDarkModePreference(theme: PbkPrefs['theme']) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem('pbk-dark-mode', String(theme !== 'light'));
  } catch {
    // Legacy compatibility is best-effort; pbk:prefs:v1 remains canonical.
  }
}

function getDefaultPbkPrefs(): PbkPrefs {
  return {
    ...DEFAULT_PBK_PREFS,
    theme: getSystemPbkTheme(),
  };
}

export function readPbkPrefs(): PbkPrefs {
  const defaults = getDefaultPbkPrefs();
  if (!canUseStorage()) return defaults;
  try {
    const raw = window.localStorage.getItem(PBK_PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PbkPrefs>;
    return {
      ...defaults,
      ...parsed,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      railCollapsed: Boolean(parsed.railCollapsed),
      lastPage: typeof parsed.lastPage === 'string' && parsed.lastPage ? parsed.lastPage : '/',
      tourCompleted: Boolean(parsed.tourCompleted),
    };
  } catch {
    return defaults;
  }
}

export function savePbkPrefs(updates: Partial<PbkPrefs>) {
  if (!canUseStorage()) return DEFAULT_PBK_PREFS;
  const next = {
    ...readPbkPrefs(),
    ...updates,
  };
  try {
    window.localStorage.setItem(PBK_PREFS_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

export function applyPbkTheme(theme: PbkPrefs['theme']) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme !== 'light');
}

export function hydratePbkPrefsBeforeRender() {
  const prefs = readPbkPrefs();
  applyPbkTheme(prefs.theme);
  writeLegacyPbkDarkModePreference(prefs.theme);
  return prefs;
}
