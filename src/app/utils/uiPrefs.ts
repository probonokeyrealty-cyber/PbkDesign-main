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

export function readPbkPrefs(): PbkPrefs {
  if (!canUseStorage()) return DEFAULT_PBK_PREFS;
  try {
    const raw = window.localStorage.getItem(PBK_PREFS_KEY);
    if (!raw) return DEFAULT_PBK_PREFS;
    const parsed = JSON.parse(raw) as Partial<PbkPrefs>;
    return {
      ...DEFAULT_PBK_PREFS,
      ...parsed,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      railCollapsed: Boolean(parsed.railCollapsed),
      lastPage: typeof parsed.lastPage === 'string' && parsed.lastPage ? parsed.lastPage : '/',
      tourCompleted: Boolean(parsed.tourCompleted),
    };
  } catch {
    return DEFAULT_PBK_PREFS;
  }
}

export function savePbkPrefs(updates: Partial<PbkPrefs>) {
  if (!canUseStorage()) return DEFAULT_PBK_PREFS;
  const next = {
    ...readPbkPrefs(),
    ...updates,
  };
  window.localStorage.setItem(PBK_PREFS_KEY, JSON.stringify(next));
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
  return prefs;
}
