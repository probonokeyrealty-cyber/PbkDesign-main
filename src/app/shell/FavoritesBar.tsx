import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Star } from 'lucide-react';

const FAVORITES_KEY = 'pbk:favorites:v1';

const PAGE_LABELS: Record<string, string> = {
  '/': 'Command Center',
  '/leads': 'Leads',
  '/deal': 'Deal',
  '/inbox': 'Inbox',
  '/fleet': 'Agent Fleet',
  '/memory': 'Memory',
  '/analytics': 'Analytics',
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

function saveFavorites(next: string[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }
  return next;
}

function normalizePath(pathname: string) {
  if (pathname.startsWith('/deal')) return '/deal';
  return PAGE_LABELS[pathname] ? pathname : '/';
}

export function FavoritesBar() {
  const location = useLocation();
  const [favorites, setFavorites] = useState(() => readFavorites());
  const currentPath = normalizePath(location.pathname);
  const currentPinned = favorites.includes(currentPath);

  useEffect(() => {
    setFavorites((current) => current.filter((path) => PAGE_LABELS[path]));
  }, []);

  const visibleFavorites = useMemo(
    () => favorites.filter((path) => PAGE_LABELS[path]).slice(0, 6),
    [favorites]
  );

  const toggleCurrent = () => {
    setFavorites((current) => {
      const next = current.includes(currentPath)
        ? current.filter((path) => path !== currentPath)
        : [currentPath, ...current]
            .filter((path, index, array) => array.indexOf(path) === index)
            .slice(0, 6);
      return saveFavorites(next);
    });
  };

  return (
    <div className="pbk-shell-favorites favorites-bar" data-source="localStorage:pbk:favorites:v1">
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
      <button type="button" className="pbk-shell-favorite-pin favorite-pin" onClick={toggleCurrent}>
        <Star size={13} fill={currentPinned ? 'currentColor' : 'none'} />
        {currentPinned ? 'Pinned' : 'Pin page'}
      </button>
    </div>
  );
}
