import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Moon, Power, Search, Sun } from 'lucide-react';
import { useRuntimeSnapshot } from '../hooks/useRuntimeSnapshot';
import { AGENT_REGISTRY } from '../utils/agentRegistry';
import { updateRuntimeSettingsRequest } from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

interface ShellTopbarProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

type SearchResult = {
  id: string;
  label: string;
  meta: string;
  to: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function getLeadId(lead: Record<string, unknown>) {
  const property = asRecord(lead.property);
  return text(lead.leadId || lead.id || lead.phone || lead.address || property.address, 'lead');
}

function getLeadName(lead: Record<string, unknown>) {
  const seller = asRecord(lead.seller);
  return text(lead.leadName || lead.name || seller.name, 'Unknown seller');
}

function getLeadAddress(lead: Record<string, unknown>) {
  const property = asRecord(lead.property);
  return text(lead.address || property.address, 'Unknown property');
}

function initials(label: string) {
  const letters = label
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .replace(/[^a-z]/gi, '')
    .slice(0, 2);
  return (letters || 'PB').toUpperCase();
}

export function ShellTopbar({ theme, onToggleTheme }: ShellTopbarProps) {
  const navigate = useNavigate();
  const { snapshot, refresh } = useRuntimeSnapshot(10000);
  const [autopilot, setAutopilot] = useState(false);
  const [autopilotPending, setAutopilotPending] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const settings = asRecord(snapshot?.settings);
  const settingsUi = asRecord(settings.ui);
  const status = asRecord(snapshot?.status);
  const account = asRecord(settings.account || status.account || status.profile);
  const companyName = text(
    account.companyName ||
      account.company ||
      status.companyName ||
      import.meta.env.VITE_PBK_COMPANY_NAME,
    'PBK Operator'
  );
  const accountEmail = text(
    account.email || status.email || import.meta.env.VITE_PBK_ACCOUNT_EMAIL,
    'Set account in bridge settings'
  );

  useEffect(() => {
    const mode = text(
      settingsUi.operatingMode || settings.operatingMode || status.mode,
      'approval'
    ).toLowerCase();
    setAutopilot(mode === 'autopilot');
  }, [settings.operatingMode, settingsUi.operatingMode, status.mode]);

  const searchResults = useMemo<SearchResult[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const leadResults = (Array.isArray(snapshot?.leadImports) ? snapshot.leadImports : [])
      .map((lead) => {
        const record = lead as Record<string, unknown>;
        const label = getLeadName(record);
        const meta = getLeadAddress(record);
        return {
          id: `lead:${getLeadId(record)}`,
          label,
          meta,
          to: `/leads?lead=${encodeURIComponent(getLeadId(record))}`,
        };
      })
      .filter((item) => `${item.label} ${item.meta}`.toLowerCase().includes(needle));
    const agentResults = AGENT_REGISTRY.map((agent) => ({
      id: `agent:${agent.id}`,
      label: agent.name,
      meta: agent.role,
      to: `/fleet?agent=${encodeURIComponent(agent.id)}`,
    })).filter((item) => `${item.label} ${item.meta}`.toLowerCase().includes(needle));
    return [...leadResults, ...agentResults].slice(0, 6);
  }, [query, snapshot?.leadImports]);

  const openSearchResult = (result: SearchResult) => {
    setSearchOpen(false);
    setQuery('');
    navigate(result.to);
  };

  const handleAutopilotToggle = async () => {
    const nextAutopilot = !autopilot;
    setAutopilot(nextAutopilot);
    setAutopilotPending(true);
    try {
      const operatingMode = nextAutopilot ? 'autopilot' : 'approval';
      await updateRuntimeSettingsRequest({
        operatingMode,
        ui: { operatingMode },
        actor: 'ShellTopbar',
      });
      await refresh();
      showUiToast({
        tone: 'success',
        title: nextAutopilot ? 'Autopilot enabled' : 'Autopilot disabled',
        desc:
          operatingMode === 'autopilot'
            ? 'Low-risk runtime actions can follow bridge autopilot policy.'
            : 'Runtime actions are back in approval-first mode.',
      });
    } catch (error) {
      setAutopilot(!nextAutopilot);
      showUiToast({
        tone: 'error',
        title: 'Autopilot update failed',
        desc:
          error instanceof Error ? error.message : 'The bridge did not save the operating mode.',
      });
    } finally {
      setAutopilotPending(false);
    }
  };

  return (
    <header className="h-14 px-3 sm:px-4 flex items-center gap-2 sm:gap-4 bg-slate-950 border-b border-slate-800 min-w-0">
      <div className="flex-1 max-w-xl min-w-0 relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          id="pbk-global-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && searchResults[0]) {
              event.preventDefault();
              openSearchResult(searchResults[0]);
            }
          }}
          placeholder="Search leads, addresses, owners..."
          className="w-full h-9 pl-9 pr-3 rounded-md bg-slate-900 border border-slate-800
                     text-sm text-slate-100 placeholder-slate-500
                     focus:outline-none focus:border-slate-600"
          aria-expanded={searchOpen && Boolean(query.trim())}
          aria-controls="pbk-global-search-results"
        />
        {searchOpen && query.trim() && (
          <div
            id="pbk-global-search-results"
            role="listbox"
            className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl"
          >
            {searchResults.map((result) => (
              <button
                key={result.id}
                type="button"
                role="option"
                className="block w-full px-3 py-2 text-left hover:bg-slate-900"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => openSearchResult(result)}
              >
                <span className="block text-sm font-semibold text-slate-100">{result.label}</span>
                <span className="block truncate text-xs text-slate-500">{result.meta}</span>
              </button>
            ))}
            {!searchResults.length && (
              <div className="px-3 py-3 text-xs text-slate-500">No results</div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => void handleAutopilotToggle()}
        disabled={autopilotPending}
        className={[
          'inline-flex items-center gap-2 px-3 h-9 rounded-md text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60',
          autopilot
            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
            : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200',
        ].join(' ')}
        aria-pressed={autopilot}
      >
        <Power size={14} />
        {autopilotPending ? 'Saving...' : `Autopilot ${autopilot ? 'ON' : 'OFF'}`}
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
          {initials(companyName)}
        </div>
        <div className="min-w-0 text-xs leading-tight">
          <div className="truncate text-slate-100">{companyName}</div>
          <div className="truncate text-slate-500">{accountEmail}</div>
        </div>
      </div>
    </header>
  );
}
