import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Download, Send } from 'lucide-react';
import { DealData, PBKPath } from '../types';
import { buildPbkPathScripts, PbkLegacyScriptPath } from '../templates/pbkPathScripts';
import { sanitizeLegacyCopy } from '../utils/formatting';
import { downloadTextFile } from '../utils/fileExport';
import {
  buildAgentDealContext,
  type AgentDealContext,
} from '../utils/agentDealContext';
import { fetchCurrentScriptRequest, type RuntimeScriptCandidate } from '../utils/runtimeBridge';
import { showUiToast } from '../utils/uiFeedback';

type ScriptVariant = 'owner' | 'agent';
type ScriptTab = 'opening' | 'acquisition' | 'objections';

interface ScriptPanelProps {
  deal: DealData;
  activePath: PBKPath;
  scriptVariant: ScriptVariant;
  forcedVariant: ScriptVariant | null;
  onScriptVariantChange: (variant: ScriptVariant) => void;
  onPushScriptToAgent?: (context: AgentDealContext) => void | Promise<void>;
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
  if (tone === 'green')
    return 'text-emerald-600 dark:text-emerald-300 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-800/60';
  if (tone === 'amber')
    return 'text-amber-700 dark:text-amber-300 bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800/60';
  if (tone === 'blue')
    return 'text-blue-700 dark:text-blue-300 bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800/60';
  if (tone === 'purple')
    return 'text-purple-700 dark:text-purple-300 bg-purple-50 border-purple-200 dark:bg-purple-900/10 dark:border-purple-800/60';
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

function buildActiveScriptBody(
  currentScripts: ReturnType<typeof buildPbkPathScripts>[PbkLegacyScriptPath][ScriptVariant],
  activeTab: ScriptTab
) {
  return activeTab === 'acquisition'
    ? `${currentScripts.acquisition}\n\n[NEXT-STEP CLOSE]\n${currentScripts.closing}`
    : currentScripts[activeTab];
}

function buildScriptCandidate({
  content,
  scriptPath,
  scriptVariant,
  activeTab,
  title,
}: {
  content: string;
  scriptPath: PbkLegacyScriptPath;
  scriptVariant: ScriptVariant;
  activeTab: ScriptTab;
  title: string;
}): RuntimeScriptCandidate {
  return {
    id: `${scriptPath}-${scriptVariant}-${activeTab}`,
    title,
    content,
    pathKey: scriptPath,
    tags: [scriptPath, scriptVariant, activeTab],
    allowedRoles: [scriptVariant],
    metadata: {
      source: 'script_panel',
      activeTab,
      scriptVariant,
      pathKey: scriptPath,
    },
  };
}

export function ScriptPanel({
  deal,
  activePath,
  scriptVariant,
  forcedVariant,
  onScriptVariantChange,
  onPushScriptToAgent,
}: ScriptPanelProps) {
  const [activeTab, setActiveTab] = useState<ScriptTab>('opening');
  const [openObjectionIndex, setOpenObjectionIndex] = useState(0);
  const [copiedBody, setCopiedBody] = useState('');
  const pathScripts = useMemo(() => buildPbkPathScripts(deal), [deal]);
  const scriptPath = getScriptPath(activePath);
  const currentPath = pathScripts[scriptPath];
  const currentScripts = currentPath[scriptVariant];
  const activeBody = buildActiveScriptBody(currentScripts, activeTab);
  const accentClasses = getAccentClasses(currentPath.color);
  const objections = useMemo(
    () => parseObjections(currentScripts.objections),
    [currentScripts.objections]
  );

  const request = useMemo(
    () => ({
      pathKey: scriptPath,
      selectedPath: activePath,
      callerRole: scriptVariant,
      sentiment: 0,
      leadId: deal.leadId || deal.sellerPhone || deal.address || '',
      address: deal.address || '',
      leadName: deal.sellerName || '',
      persistExposure: false,
      scripts: [buildScriptCandidate({
        content: activeBody,
        scriptPath,
        scriptVariant,
        activeTab,
        title: `${currentPath.name} ${TAB_LABELS[activeTab]}`,
      })],
    }),
    [
      activeBody, activePath, activeTab, currentPath.name, deal.address,
      deal.leadId, deal.sellerName, deal.sellerPhone, scriptPath, scriptVariant,
    ]
  );
  const [selection, setSelection] = useState<{
    request: typeof request;
    script: RuntimeScriptCandidate | null;
    reasonCodes: string[];
  } | null>(null);
  const currentSelection = selection?.request === request ? selection : null;
  const bridgeScript = currentSelection?.script;
  const safeBody = sanitizeLegacyCopy(bridgeScript?.content || activeBody);
  const showObjectionCards = activeTab === 'objections' && safeBody === sanitizeLegacyCopy(activeBody);
  const copied = Boolean(safeBody && copiedBody === safeBody);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentScriptRequest(request)
      .then((response) => {
        if (cancelled) return;
        const script = response.ok ? response.selectedScript || response.selected : null;
        setSelection({
          request,
          script: script?.content?.trim() ? script : null,
          reasonCodes: Array.isArray(response.reasonCodes) ? response.reasonCodes : [],
        });
      })
      .catch(() => {
        if (!cancelled) setSelection({ request, script: null, reasonCodes: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    if (!copiedBody) return;
    const timeout = window.setTimeout(() => setCopiedBody(''), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedBody]);

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(safeBody);
      setCopiedBody(safeBody);
    } catch {
      showUiToast({
        tone: 'error',
        title: 'Script could not be copied',
        desc: 'Use Download to save the script.',
      });
    }
  };

  const downloadScript = () => {
    downloadTextFile(safeBody, `${scriptPath}_${activeTab}_${scriptVariant}.txt`);
  };

  const pushScriptToAgent = async () => {
    const context = buildAgentDealContext(deal, {
      activePath,
      scriptVariant,
      activeScriptTab: activeTab,
      requestedBy: 'Call Mode Script Panel',
      runtimeSelectedScript: bridgeScript
        ? {
            id: bridgeScript.id,
            title: bridgeScript.title,
            content: safeBody,
            reasonCodes: currentSelection?.reasonCodes,
          }
        : undefined,
    });
    await onPushScriptToAgent?.({ ...context, activeScript: safeBody });
  };

  return (
    <section
      aria-labelledby="call-script-heading"
      className="pbk-analyzer-card pbk-analyzer-workbench-section"
    >
      <div className="pbk-call-script-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="call-script-heading" className="pbk-analyzer-section-title">
              Call Mode Script Panel
            </h2>
            <h3 className="mt-2 text-base font-semibold leading-tight text-gray-950 dark:text-gray-100">
              {currentPath.name}
            </h3>
          </div>
          <div
            className={`rounded border px-2 py-1 font-mono text-[11px] font-semibold uppercase ${accentClasses}`}
          >
            {scriptVariant === 'agent' ? 'Agent Partnership' : 'Owner Direct'}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="pbk-call-script-segments" role="group" aria-label="Script section">
            {(Object.keys(TAB_LABELS) as ScriptTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className="pbk-btn pbk-btn-ghost"
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          <div className="pbk-call-script-segments" role="group" aria-label="Script audience">
            <button
              type="button"
              aria-pressed={scriptVariant === 'owner'}
              disabled={forcedVariant === 'agent'}
              title={
                forcedVariant === 'agent'
                  ? 'Script variant is locked to Agent for this lead type'
                  : undefined
              }
              onClick={() => onScriptVariantChange('owner')}
              className="pbk-btn pbk-btn-ghost"
            >
              Owner
            </button>
            <button
              type="button"
              aria-pressed={scriptVariant === 'agent'}
              disabled={forcedVariant === 'owner'}
              title={
                forcedVariant === 'owner'
                  ? 'Script variant is locked to Owner/FSBO for this lead type'
                  : undefined
              }
              onClick={() => onScriptVariantChange('agent')}
              className="pbk-btn pbk-btn-ghost"
            >
              Agent
            </button>
          </div>
        </div>
      </div>

      <div className="pt-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="pbk-call-active-path">{TAB_LABELS[activeTab]} Script</div>
            <div role="status" className="mt-1 break-words text-xs text-gray-600 dark:text-gray-300">
              {bridgeScript
                ? `Runtime script · ${sanitizeLegacyCopy(bridgeScript.title || TAB_LABELS[activeTab])}`
                : currentSelection
                  ? 'Script library'
                  : 'Script library · checking for an Ava recommendation'}
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <button
              type="button"
              onClick={copyScript}
              className="pbk-btn pbk-btn-ghost flex-1 sm:flex-none"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={downloadScript}
              className="pbk-btn pbk-btn-ghost flex-1 sm:flex-none"
            >
              <Download size={13} />
              Download
            </button>
            {onPushScriptToAgent ? (
              <button
                type="button"
                onClick={pushScriptToAgent}
                className="pbk-btn pbk-btn-primary flex-1 sm:flex-none"
              >
                <Send size={13} aria-hidden="true" />
                Push to Ava
              </button>
            ) : null}
          </div>
        </div>

        {showObjectionCards ? (
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
                    aria-expanded={isOpen}
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
                      <div className="whitespace-pre-wrap">
                        {sanitizeLegacyCopy(objection.body)}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="max-h-[58dvh] overflow-auto rounded-[20px] border border-gray-200 bg-gray-50 px-4 py-4 text-sm leading-7 text-gray-800 dark:border-slate-700 dark:bg-slate-950/70 dark:text-gray-100">
            <div className="whitespace-pre-wrap break-words">{safeBody}</div>
          </div>
        )}
      </div>
    </section>
  );
}
