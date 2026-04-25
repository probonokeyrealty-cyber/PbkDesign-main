import { DealData, PBKPath, QuickDocumentType } from '../types';
import { Eye, FileText, Printer, Send, X } from 'lucide-react';
import { formatCurrency } from '../utils/formatting';
import { getPathLabel, getPdfReadiness } from '../utils/pbk';

interface RightPanelProps {
  isOpen: boolean;
  onClose: () => void;
  deal: DealData;
  selectedPath: PBKPath;
  exportStatus: string;
  onGenerate: () => void;
  onPreview: () => void;
  onPrintPackage: () => void;
  onOpenDocument: (documentType: QuickDocumentType) => void;
}

export function RightPanel({
  isOpen,
  onClose,
  deal,
  selectedPath,
  exportStatus,
  onGenerate,
  onPreview,
  onPrintPackage,
  onOpenDocument,
}: RightPanelProps) {
  const readiness = getPdfReadiness(deal);
  const isLand = deal.type === 'land';
  const primaryValue = isLand ? deal.builderTotal : deal.mao60;
  const secondaryValue = isLand ? deal.offer : deal.maoRBP;

  return (
    <aside
      className={`
        fixed md:relative top-[54px] md:top-0 right-0 bottom-0 z-40
        w-[300px] bg-white/96 dark:bg-slate-900/96 border-l border-gray-200 dark:border-slate-700
        overflow-y-auto p-3 transition-transform duration-250 backdrop-blur-lg
        ${isOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
      `}
    >
      <div className="md:hidden flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Workflow
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mb-3.5 rounded-2xl border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-slate-950 to-slate-800 p-3.5 text-white shadow-sm">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55 mb-1.5">
          Actions
        </div>
        <div className="text-[15px] font-semibold tracking-tight mb-2">
          Deal Actions
        </div>
        <div className="space-y-2">
          <button
            onClick={onGenerate}
            disabled={!readiness.ready}
            className={`w-full rounded-xl px-3 py-2.5 text-left text-[12px] font-semibold transition-all flex items-center gap-2 ${
              readiness.ready
                ? 'bg-white text-slate-950 hover:bg-blue-50'
                : 'bg-white/10 text-white/55 cursor-not-allowed'
            }`}
          >
            <Send size={14} />
            Generate Premium PDF
          </button>
          <button
            onClick={onPreview}
            className="w-full rounded-xl border border-white/12 bg-white/8 px-3 py-2.5 text-left text-[12px] font-medium text-white/90 hover:bg-white/12 transition-all flex items-center gap-2"
          >
            <Eye size={14} />
            Preview Deal Package
          </button>
          <button
            onClick={onPrintPackage}
            className="w-full rounded-xl border border-white/12 bg-white/8 px-3 py-2.5 text-left text-[12px] font-medium text-white/90 hover:bg-white/12 transition-all flex items-center gap-2"
          >
            <Printer size={14} />
            Print Deal Package
          </button>
        </div>
        <div className="mt-2.5 rounded-xl bg-white/8 px-3 py-2 text-[10px] leading-4 text-white/72">
          {exportStatus}
        </div>
      </div>

      <div className="mb-3.5 rounded-2xl border border-gray-200 dark:border-slate-700 bg-gray-50/90 dark:bg-slate-800/70 p-3.5 shadow-sm">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400 mb-1.5">
          Quick Documents
        </div>
        <div className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100 mb-2">
          Templates
        </div>
        <div className="space-y-2">
          <button
            onClick={() => onOpenDocument('report')}
            className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-left text-[11.5px] font-medium text-gray-900 dark:text-gray-100 hover:border-blue-300 dark:hover:border-blue-700 transition-all flex items-center gap-2"
          >
            <FileText size={14} />
            Path Package
          </button>
          <button
            onClick={() => onOpenDocument('seller')}
            className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-left text-[11.5px] font-medium text-gray-900 dark:text-gray-100 hover:border-blue-300 dark:hover:border-blue-700 transition-all flex items-center gap-2"
          >
            <FileText size={14} />
            Seller Guide
          </button>
          <button
            onClick={() => onOpenDocument('loi')}
            className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-left text-[11.5px] font-medium text-gray-900 dark:text-gray-100 hover:border-blue-300 dark:hover:border-blue-700 transition-all flex items-center gap-2"
          >
            <FileText size={14} />
            LOI
          </button>
          <button
            onClick={() => onOpenDocument('email')}
            className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-left text-[11.5px] font-medium text-gray-900 dark:text-gray-100 hover:border-blue-300 dark:hover:border-blue-700 transition-all flex items-center gap-2"
          >
            <FileText size={14} />
            Next Steps / Note
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3.5 shadow-sm">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400 mb-1.5">
          Quick Stats
        </div>
        <div className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Deal Snapshot
        </div>
        <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 break-words">
          {deal.address || 'No property loaded'}
        </div>
        <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
          {getPathLabel(selectedPath)}
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-900">
            <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">ARV</span>
            <strong className="text-[12px] text-gray-900 dark:text-gray-100">{formatCurrency(deal.arv)}</strong>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-900">
            <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {isLand ? 'Builder Total' : 'MAO Cash'}
            </span>
            <strong className="text-[12px] text-gray-900 dark:text-gray-100">{formatCurrency(primaryValue)}</strong>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-900">
            <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {isLand ? 'Offer' : 'MAO RBP'}
            </span>
            <strong className="text-[12px] text-gray-900 dark:text-gray-100">{formatCurrency(secondaryValue)}</strong>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-900">
            <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Verdict</span>
            <strong
              className={`text-[12px] ${
                deal.verdict === 'green'
                  ? 'text-green-600 dark:text-green-400'
                  : deal.verdict === 'yellow'
                    ? 'text-amber-600 dark:text-amber-400'
                    : deal.verdict === 'red'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {deal.verdict === 'green' ? 'GO' : deal.verdict === 'yellow' ? 'MAYBE' : deal.verdict === 'red' ? 'STOP' : '—'}
            </strong>
          </div>
        </div>
      </div>
    </aside>
  );
}
