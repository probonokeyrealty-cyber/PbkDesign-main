import { useEffect, useState } from 'react';
import { DealData, PBKPath } from '../types';
import { LiveCallInputs } from './LiveCallInputs';
import { LiveDealTrackerPanel } from './LiveDealTrackerPanel';
import { ScriptPanel } from './ScriptPanel';
import { InvestorYield } from './InvestorYield';
import { getLiveInputPath, getPathLabel, getPathOptions } from '../utils/pbk';

type ScriptVariant = 'owner' | 'agent';

interface CallModeTabProps {
  deal: DealData;
  onDealChange: (updates: Partial<DealData>) => void;
  selectedPath: PBKPath;
  onSelectPath: (path: PBKPath) => void;
}

function getForcedVariant(path: PBKPath): ScriptVariant | null {
  if (path === 'cf' || path === 'mt') return 'agent';
  if (path === 'rbp') return 'owner';
  if (path === 'land-agent') return 'agent';
  if (path === 'land-owner' || path === 'rbp-land') return 'owner';
  return null;
}

function isYieldPath(path: PBKPath): path is 'cf' | 'mt' {
  return path === 'cf' || path === 'mt';
}

export function CallModeTab({
  deal,
  onDealChange,
  selectedPath: activePath,
  onSelectPath,
}: CallModeTabProps) {
  const [callNotes, setCallNotes] = useState('');
  const [scriptVariant, setScriptVariant] = useState<ScriptVariant>(
    deal.contact === 'realtor' ? 'agent' : 'owner',
  );
  const pathOptions = getPathOptions({ type: deal.type, contact: deal.contact });
  const forcedVariant = getForcedVariant(activePath);

  useEffect(() => {
    setScriptVariant(deal.contact === 'realtor' ? 'agent' : 'owner');
  }, [deal.contact]);

  useEffect(() => {
    if (forcedVariant) {
      setScriptVariant(forcedVariant);
    }
  }, [forcedVariant]);

  return (
    <div className="p-3.5">
      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-1 h-3 bg-purple-500 rounded-sm"></div>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-purple-500">
              Path Selector
            </h3>
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            Active packet path: <strong className="text-purple-600 dark:text-purple-300">{getPathLabel(activePath)}</strong>
          </div>
        </div>

        <div className="mb-3 rounded-2xl border border-purple-200 bg-purple-50 px-3 py-2 text-[11px] leading-5 text-purple-800 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300">
          Tap a path and the scripts, tracker, live inputs, and Documents/PDF packet all follow this same selected path.
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {pathOptions.map((option) => {
            const isActive = option.id === activePath;
            const toneClasses =
              option.tone === 'green'
                ? isActive
                  ? 'border-green-500 bg-green-500 text-white shadow-green-500/25'
                  : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300'
                : option.tone === 'blue'
                  ? isActive
                    ? 'border-blue-500 bg-blue-500 text-white shadow-blue-500/25'
                    : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300'
                  : option.tone === 'purple'
                    ? isActive
                      ? 'border-purple-500 bg-purple-500 text-white shadow-purple-500/25'
                      : 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300'
                    : option.tone === 'amber'
                      ? isActive
                        ? 'border-amber-500 bg-amber-500 text-white shadow-amber-500/25'
                        : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                      : isActive
                        ? 'border-slate-600 bg-slate-700 text-white shadow-slate-900/20'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300';

            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => onSelectPath(option.id)}
                className={`min-w-fit rounded-full border px-4 py-2 text-left transition-all shadow-sm ${toneClasses}`}
              >
                <div className="text-[9px] font-semibold uppercase tracking-[0.2em] opacity-80">
                  Path
                </div>
                <div className="text-[12px] font-semibold leading-tight">{option.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      <ScriptPanel
        deal={deal}
        activePath={activePath}
        scriptVariant={scriptVariant}
        forcedVariant={forcedVariant}
        onScriptVariantChange={setScriptVariant}
      />

      {isYieldPath(activePath) ? (
        <div className="mb-3">
          <InvestorYield deal={deal} onDealChange={onDealChange} activePath={activePath} />
        </div>
      ) : null}

      <LiveDealTrackerPanel deal={deal} activePath={activePath} />

      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Call Notes
          </h3>
        </div>

        <textarea
          value={callNotes}
          onChange={(event) => setCallNotes(event.target.value)}
          placeholder="Take notes during your call..."
          className="w-full h-32 px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-gray-100 text-[12.5px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all resize-vertical"
        />
      </div>

      <LiveCallInputs
        deal={deal}
        onDealChange={onDealChange}
        selectedPath={getLiveInputPath(activePath)}
        canonicalPath={activePath}
      />

      <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 mb-3 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500 rounded-sm"></div>
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue-500">
            Post-Call Actions
          </h3>
        </div>

        <div className="space-y-2">
          <button className="w-full px-4 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300 text-[12px] font-medium text-left hover:bg-green-100 dark:hover:bg-green-900/30 transition-all">
            Schedule Follow-up Call
          </button>
          <button className="w-full px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300 text-[12px] font-medium text-left hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all">
            Send Offer Email
          </button>
          <button className="w-full px-4 py-2 rounded-lg bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-gray-300 text-[12px] font-medium text-left hover:bg-gray-100 dark:hover:bg-slate-800 transition-all">
            Add to CRM
          </button>
        </div>
      </div>
    </div>
  );
}
