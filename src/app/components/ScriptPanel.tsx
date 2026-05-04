import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Download } from 'lucide-react';
import { DealData, PBKPath } from '../types';
import { buildPbkPathScripts, PbkLegacyScriptPath } from '../templates/pbkPathScripts';
import { sanitizeLegacyCopy } from '../utils/formatting';
import { downloadTextFile } from '../utils/fileExport';

type ScriptVariant = 'owner' | 'agent';
type ScriptTab = 'opening' | 'acquisition' | 'objections';

interface ScriptPanelProps {
  deal: DealData;
  activePath: PBKPath;
  scriptVariant: ScriptVariant;
  forcedVariant: ScriptVariant | null;
  onScriptVariantChange: (variant: ScriptVariant) => void;
}

const TAB_LABELS: Record<ScriptTab, string> = {
  opening: 'Opening',
  acquisition: 'Acquisition',
  objections: 'Objection Engine',
};

function getScriptPath(path: PBKPath): PbkLegacyScriptPath {
  if (path === 'cf') return 'creative';
  if (path === 'mt') return 'subto';
  if (path === 'land-owner' || path === 'land-agent' || path === 'rbp-land') return 'land';
  return path;
}

function getAccentClasses(tone: string) {
  if (tone === 'green') return 'text-emerald-600 dark:text-emerald-300 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800/60';
  if (tone === 'amber') return 'text-amber-700 dark:text-amber-300 bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800/60';
  if (tone === 'blue') return 'text-blue-700 dark:text-blue-300 bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800/60';
  if (tone === 'purple') return 'text-purple-700 dark:text-purple-300 bg-purple-50 border-purple-200 dark:bg-purple-900/10 dark:border-purple-800/60';
  return 'text-slate-700 dark:text-slate-300 bg-slate-50 border-slate-200 dark:bg-slate-900/70 dark:border-slate-700';
}

function parseObjections(script: string) {
  return script
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [title, ...lines] = block.split('\n');
      return {
        title: title.replace(/^["']|["']$/g, ''),
        body: lines.join('\n').trim(),
      };
    });
}

export function ScriptPanel({
  deal,
  activePath,
  scriptVariant,
  forcedVariant,
  onScriptVariantChange,
}: ScriptPanelProps) {
  const [activeTab, setActiveTab] = useState<ScriptTab>('opening');
  const [openObjectionIndex, setOpenObjectionIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const pathScripts = useMemo(() => buildPbkPathScripts(deal), [deal]);
  const scriptPath = getScriptPath(activePath);
  const currentPath = pathScripts[scriptPath];
  const currentScripts = currentPath[scriptVariant];
  const activeBody =
    activeTab === 'acquisition'
      ? `${currentScripts.acquisition}\n\n[NEXT-STEP CLOSE]\n${currentScripts.closing}`
      : currentScripts[activeTab];
  const safeBody = sanitizeLegacyCopy(activeBody);
  const accentClasses = getAccentClasses(currentPath.color);
  const objections = useMemo(() => parseObjections(currentScripts.objections), [currentScripts.objections]);

  useEffect(() => {
    setActiveTab('opening');
    setOpenObjectionIndex(0);
  }, [activePath, scriptVariant]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copyScript = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(safeBody);
      }
      setCopied(true);
    } catch (error) {
      console.error('Copy failed', error);
    }
  };

  const downloadScript = () => {
    downloadTextFile(safeBody, `${scriptPath}_${activeTab}_${scriptVariant}.txt`);
  };

  return (
    <section className="mb-3 overflow-hidden rounded-[24px] border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/90">
      <div className="border-b border-gray-200 bg-gradient-to-br from-white via-slate-50 to-blue-50/50 p-4 dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-1 rounded-sm bg-orange-500"></div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-500">
                Call Mode Script Panel
              </div>
            </div>
            <h3 className="mt-2 text-xl font-semibold leading-tight text-gray-950 dark:text-gray-100">
              {currentPath.name}
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              Canonical PBK script flow: opener, acquisition pitch, then objection control.
            </p>
          </div>
          <div className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] ${accentClasses}`}>
            {scriptVariant === 'agent' ? 'Agent Partnership' : 'Owner Direct'}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-gray-200 bg-white/85 p-1.5 dark:border-slate-700 dark:bg-slate-950/60">
            {(Object.keys(TAB_LABELS) as ScriptTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`min-h-10 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                  activeTab === tab
                    ? 'bg-slate-950 text-white shadow-sm dark:bg-blue-500'
                    : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-white/85 p-1.5 dark:border-slate-700 dark:bg-slate-950/60">
            <button
              type="button"
              disabled={forcedVariant === 'agent'}
              onClick={() => onScriptVariantChange('owner')}
              className={`min-h-10 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                scriptVariant === 'owner'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800'
              } ${forcedVariant === 'agent' ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              Owner
            </button>
            <button
              type="button"
              disabled={forcedVariant === 'owner'}
              onClick={() => onScriptVariantChange('agent')}
              className={`min-h-10 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                scriptVariant === 'agent'
                  ? 'bg-purple-500 text-white shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800'
              } ${forcedVariant === 'owner' ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              Agent
            </button>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
            {TAB_LABELS[activeTab]} Script
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <button
              type="button"
              onClick={copyScript}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[11px] font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-950 dark:text-gray-200 dark:hover:bg-slate-800 sm:flex-none"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={downloadScript}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[11px] font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-950 dark:text-gray-200 dark:hover:bg-slate-800 sm:flex-none"
            >
              <Download size={13} />
              Download
            </button>
          </div>
        </div>

        {activeTab === 'objections' ? (
          <div className="space-y-2">
            {objections.map((objection, index) => {
              const isOpen = openObjectionIndex === index;
              return (
                <div
                  key={`${objection.title}-${index}`}
                  className="overflow-hidden rounded-[18px] border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-950/70"
                >
                  <button
                    type="button"
                    onClick={() => setOpenObjectionIndex(isOpen ? -1 : index)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white dark:hover:bg-slate-900"
                  >
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {sanitizeLegacyCopy(objection.title)}
                    </span>
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-gray-500 transition-transform dark:text-gray-400 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {isOpen ? (
                    <div className="border-t border-gray-200 bg-white px-4 py-4 text-sm leading-7 text-gray-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-gray-200">
                      <div className="whitespace-pre-wrap">{sanitizeLegacyCopy(objection.body)}</div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="max-h-[58dvh] overflow-auto rounded-[20px] border border-gray-200 bg-gray-50 px-4 py-4 text-sm leading-7 text-gray-800 dark:border-slate-700 dark:bg-slate-950/70 dark:text-gray-100">
            <div className="whitespace-pre-wrap">{safeBody}</div>
          </div>
        )}

        <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] leading-5 text-sky-800 dark:border-sky-800/60 dark:bg-sky-900/10 dark:text-sky-200">
          Ava doctrine: these five paths are the PBK sales engine. Do not blend scripts; qualify the lead, choose the path, handle the objection, and secure the contract.
        </div>
      </div>
    </section>
  );
}
