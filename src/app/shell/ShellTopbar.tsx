import { useState } from 'react';
import { Moon, Power, Search, Sun } from 'lucide-react';

interface ShellTopbarProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

/**
 * ShellTopbar — global topbar for the Paradise shell.
 *
 * Contains: global search input, Autopilot control, and account chip.
 * Distinct from the engine's own `TopBar.tsx` (which lives inside DealView).
 */
export function ShellTopbar({ theme, onToggleTheme }: ShellTopbarProps) {
  const [autopilot, setAutopilot] = useState(false);
  const [query, setQuery] = useState('');

  return (
    <header className="h-14 px-3 sm:px-4 flex items-center gap-2 sm:gap-4 bg-slate-950 border-b border-slate-800 min-w-0">
      <div className="flex-1 max-w-xl min-w-0 relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
        />
        <input
          id="pbk-global-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search leads, addresses, owners..."
          className="w-full h-9 pl-9 pr-3 rounded-md bg-slate-900 border border-slate-800
                     text-sm text-slate-100 placeholder-slate-500
                     focus:outline-none focus:border-slate-600"
        />
      </div>

      <button
        type="button"
        onClick={() => setAutopilot((v) => !v)}
        className={[
          'inline-flex items-center gap-2 px-3 h-9 rounded-md text-xs font-medium transition-colors',
          autopilot
            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
            : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200',
        ].join(' ')}
        aria-pressed={autopilot}
      >
        <Power size={14} />
        Autopilot {autopilot ? 'ON' : 'OFF'}
      </button>

      <button
        type="button"
        onClick={onToggleTheme}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-400 transition-colors hover:text-sky-200"
        aria-label="Toggle theme"
        title="Toggle theme (T)"
      >
        {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
      </button>

      <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-800 min-w-0">
        <div className="h-7 w-7 rounded-full bg-emerald-500/20 text-emerald-300 grid place-items-center text-xs font-semibold">
          PK
        </div>
        <div className="text-xs leading-tight">
          <div className="text-slate-100">Probono Key Realty</div>
          <div className="text-slate-500">probonokeyrealty@gmail.com</div>
        </div>
      </div>
    </header>
  );
}
