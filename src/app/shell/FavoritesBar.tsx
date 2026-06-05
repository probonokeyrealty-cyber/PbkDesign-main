import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Star } from 'lucide-react';
import { updateRuntimeSettingsRequest, type RuntimeSnapshot } from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

const FAVORITES_KEY = 'pbk:favorites:v1';

const PAGE_LABELS: Record<string, string> = {
  '/': 'Command Center',
  '/leads': 'Leads',
  '/deal': 'Deal',
  '/inbox': 'Inbox',
  '/fleet': 'Agent Fleet',
  '/memory': 'Memory',
  '/analytics': 'Analytics',
  '/campaigns': 'Campaigns',
  '/settings': 'Settings',
};

const DEFAULT_FAVORITES = ['/', '/inbox', '/leads'];

function readFavorites() {
  if (typeof window === 'undefined') return DEFAULT_FAVORITES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(parsed) && parsed.length
      ? parsed.filter((item) => PAGE_LABELS[item])
      : DEFAULT_FAVORITES;
  } catch {
    return DEFAULT_FAVORITES;
  }
}

function normalizeFavorites(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item || '').trim()).filter((item) => PAGE_LABELS[item]);
}

function saveLocalFavorites(next: string[]) {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    }
  } catch {
    // Bridge-backed settings remain the primary persistence path.
  }
  return next;
}

function normalizePath(pathname: string) {
  if (pathname.startsWith('/deal')) return '/deal';
  return PAGE_LABELS[pathname] ? pathname : '/';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getSnapshotFavorites(snapshot?: RuntimeSnapshot | null) {
  const settings = asRecord(snapshot?.settings);
  const ui = asRecord(settings.ui);
  return normalizeFavorites(ui.favorites) ?? normalizeFavorites(settings.favorites);
}

type FavoritesBarProps = {
  snapshot?: RuntimeSnapshot | null;
  refresh?: () => Promise<RuntimeSnapshot | null | undefined>;
};

export function FavoritesBar({ snapshot, refresh }: FavoritesBarProps = {}) {
  const location = useLocation();
  const [favorites, setFavorites] = useState(() => readFavorites());
  const [favoriteSource, setFavoriteSource] = useState('Local fallback');
  const [favoritePending, setFavoritePending] = useState(false);
  const currentPath = normalizePath(location.pathname);
  const currentPinned = favorites.includes(currentPath);

  useEffect(() => {
    setFavorites((current) => current.filter((path) => PAGE_LABELS[path]));
  }, []);

  useEffect(() => {
    const bridgeFavorites = getSnapshotFavorites(snapshot);
    if (!bridgeFavorites) return;
    setFavorites(bridgeFavorites);
    saveLocalFavorites(bridgeFavorites);
    setFavoriteSource('Bridge settings');
  }, [snapshot]);

  const visibleFavorites = useMemo(
    () => favorites.filter((path) => PAGE_LABELS[path]).slice(0, 6),
    [favorites]
  );

  const persistFavorites = async (next: string[]) => {
    setFavorites(saveLocalFavorites(next));
    setFavoritePending(true);
    try {
      await updateRuntimeSettingsRequest({
        ui: { favorites: next },
        actor: 'FavoritesBar',
      });
      setFavoriteSource('Bridge settings');
      await refresh?.();
    } catch (error) {
      setFavoriteSource('Local fallback');
      showUiToast({
        tone: 'warning',
        title: 'Favorites saved locally',
        desc:
          error instanceof Error
            ? error.message
            : 'Bridge unavailable; favorites remain on this browser.',
      });
    } finally {
      setFavoritePending(false);
    }
  };

  const toggleCurrent = () => {
    const next = currentPinned
      ? favorites.filter((path) => path !== currentPath)
      : [currentPath, ...favorites]
          .filter((path, index, array) => array.indexOf(path) === index)
          .slice(0, 6);
    void persistFavorites(next);
  };

  return (
    <div
      className="pbk-shell-favorites favorites-bar"
      data-source="PATCH /api/settings ui.favorites"
      data-fallback="localStorage:pbk:favorites:v1"
    >
      <div className="favorites-scroll" aria-label="Favorite pages">
        {visibleFavorites.map((path) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className="pbk-shell-favorite-link favorite-link"
          >
            {PAGE_LABELS[path]}
          </NavLink>
        ))}
      </div>
      <span className="pbk-shell-favorites-source" title={favoriteSource}>
        {favoritePending ? 'Syncing' : favoriteSource}
      </span>
      <button
        type="button"
        className="pbk-shell-favorite-pin favorite-pin"
        onClick={toggleCurrent}
        disabled={favoritePending}
      >
        <Star size={13} fill={currentPinned ? 'currentColor' : 'none'} />
        {favoritePending ? 'Saving' : currentPinned ? 'Pinned' : 'Pin page'}
      </button>
    </div>
  );
}
