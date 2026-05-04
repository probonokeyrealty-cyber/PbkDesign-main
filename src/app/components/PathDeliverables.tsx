import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { DealData, PBKPath, QuickDocumentType } from '../types';
import { Clipboard, Copy, Eye, FileText, Printer, Send } from 'lucide-react';
import {
  PBKBranding,
  buildDocumentSet,
  getPathLabel,
  getPdfReadiness,
} from '../utils/pbk';
import { DocumentPdfPanel } from './DocumentPdfPanel';

interface PathDeliverablesProps {
  deal: DealData;
  selectedPath: PBKPath;
  activeDocument: QuickDocumentType;
  onDocumentChange: (documentType: QuickDocumentType) => void;
  branding: PBKBranding;
  onBrandingChange: (branding: PBKBranding) => void;
  exportStatus: string;
  documentDeliveryStatus: string;
  onPreview: () => void;
  onPrint: () => void;
  onGenerate: () => void;
  onEmailDocuments: (payload: {
    selectedDocuments: QuickDocumentType[];
    senderProfile: 'warm' | 'cold';
  }) => void | Promise<void>;
  onPdfAction?: (action: 'refresh' | 'download' | 'open') => void;
}

const documentLabels: Record<QuickDocumentType, string> = {
  report: 'Path Package',
  seller: 'Seller Guide',
  loi: 'LOI',
  email: 'Next Steps / Note',
  purchaseAgreement: 'Purchase Agreement',
  assignmentContract: 'Assignment Contract',
  sellerQuestionnaire: 'Seller Questionnaire',
};

const quickDocumentCards = [
  {
    type: 'purchaseAgreement' as QuickDocumentType,
    title: 'Purchase Agreement',
    subtitle: 'Standard PSA with seller',
    icon: FileText,
    tone: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300',
  },
  {
    type: 'assignmentContract' as QuickDocumentType,
    title: 'Assignment Contract',
    subtitle: 'Wholesale assignment to end buyer',
    icon: Copy,
    tone: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300',
  },
  {
    type: 'sellerQuestionnaire' as QuickDocumentType,
    title: 'Seller Questionnaire',
    subtitle: 'Property & motivation intake',
    icon: Clipboard,
    tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  },
];

export function PathDeliverables({
  deal,
  selectedPath,
  activeDocument,
  onDocumentChange,
  branding,
  onBrandingChange,
  exportStatus,
  documentDeliveryStatus,
  onPreview,
  onPrint,
  onGenerate,
  onEmailDocuments,
  onPdfAction,
}: PathDeliverablesProps) {
  const documentDeal = useMemo(
    () => ({
      ...deal,
      selectedPath,
    }),
    [deal, selectedPath],
  );
  const generatedDocuments = useMemo(
    () => buildDocumentSet(documentDeal, branding),
    [documentDeal, branding],
  );
  const [editableDocuments, setEditableDocuments] = useState<Record<QuickDocumentType, string>>(generatedDocuments);
  const [selectedDocuments, setSelectedDocuments] = useState<QuickDocumentType[]>(['seller', 'loi']);
  const [senderProfile, setSenderProfile] = useState<'warm' | 'cold'>('warm');
  const readiness = getPdfReadiness(documentDeal);

  useEffect(() => {
    setEditableDocuments(generatedDocuments);
  }, [generatedDocuments]);

  const handleDocumentEdit = (documentType: QuickDocumentType, value: string) => {
    setEditableDocuments((prev) => ({
      ...prev,
      [documentType]: value,
    }));
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      onBrandingChange({
        ...branding,
        logoDataUrl: typeof reader.result === 'string' ? reader.result : '',
      });
    };
    reader.readAsDataURL(file);
  };

  const toggleDocumentSelection = (documentType: QuickDocumentType) => {
    setSelectedDocuments((prev) =>
      prev.includes(documentType)
        ? prev.filter((item) => item !== documentType)
        : [...prev, documentType],
    );
  };

  return (
    <div className="p-3.5">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3.5">
        <div className="space-y-3">
          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-500 mb-2">
              Documents
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  Path Deliverables Workspace
                </div>
                <div className="mt-1 max-w-3xl text-[12px] leading-5 text-gray-500 dark:text-gray-400">
                  The Figma shell stays intact here, but the content is now driven by the PBK path, live call inputs,
                  and the master package export adapter instead of the old demo templates.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
                  {getPathLabel(selectedPath)}
                </div>
                <div className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[10px] font-medium text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
                  {deal.address || 'No property loaded'}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-500 mb-2">
                  Quick Documents
                </div>
                <div className="text-[16px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  Operational Templates
                </div>
                <div className="mt-1 text-[11.5px] leading-5 text-gray-500 dark:text-gray-400">
                  These are add-on prep docs for your team. They live alongside the existing PBK package editor and do not change the locked PDF pipeline.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {quickDocumentCards.map((card) => {
                const Icon = card.icon;
                const isActive = activeDocument === card.type;

                return (
                  <button
                    key={card.type}
                    type="button"
                    onClick={() => onDocumentChange(card.type)}
                    className={`text-left rounded-2xl border px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-md ${card.tone} ${
                      isActive ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-blue-400' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold">{card.title}</div>
                        <div className="mt-1 text-[10.5px] leading-5 opacity-80">{card.subtitle}</div>
                      </div>
                      <div className="rounded-xl bg-white/70 dark:bg-slate-900/60 p-2">
                        <Icon size={16} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-gray-200 dark:border-slate-700 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                  Document Templates
                </div>
                <div className="text-[11.5px] text-gray-500 dark:text-gray-400">
                  Review or edit the live PBK documents below before previewing or printing the premium package.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={onPreview}
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-semibold text-blue-700 transition-all hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                >
                  <Eye size={14} />
                  Preview Package
                </button>
                <button
                  onClick={onPrint}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-700 transition-all hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200"
                >
                  <Printer size={14} />
                  Print Package
                </button>
              </div>
            </div>

            <div className="border-b border-gray-200 dark:border-slate-700 px-4 py-3">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(documentLabels) as QuickDocumentType[]).map((documentType) => (
                  <button
                    key={documentType}
                    onClick={() => onDocumentChange(documentType)}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                      activeDocument === documentType
                        ? 'bg-slate-950 text-white dark:bg-blue-500'
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-slate-900 dark:text-gray-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    {documentLabels[documentType]}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[10.5px] text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
                Click inside the document below to refine wording before you export. The Master PDF still uses the locked PBK
                path logic and master template.
              </div>
            </div>

            <div className="p-4">
              <textarea
                value={editableDocuments[activeDocument]}
                onChange={(event) => handleDocumentEdit(activeDocument, event.target.value)}
                className="min-h-[520px] w-full resize-y rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-[11.5px] leading-6 text-gray-800 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-slate-950 to-slate-800 p-4 text-white shadow-sm">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55 mb-2">
              Export
            </div>
            <div className="text-[16px] font-semibold tracking-tight mb-2">
              Master Deal PDF
            </div>
            <div className="rounded-xl bg-white/8 px-3 py-2 text-[10.5px] leading-5 text-white/76">
              {exportStatus}
            </div>
            {!readiness.ready && (
              <div className="mt-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[10.5px] leading-5 text-amber-100">
                Missing: {readiness.missing.join(', ')}
              </div>
            )}
            <button
              onClick={onGenerate}
              disabled={!readiness.ready}
              className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-[12px] font-semibold transition-all ${
                readiness.ready
                  ? 'bg-white text-slate-950 hover:bg-blue-50'
                  : 'bg-white/10 text-white/55 cursor-not-allowed'
              }`}
            >
              <Send size={14} />
              Generate Master PDF
            </button>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-500 mb-2">
              Email Delivery
            </div>
            <div className="text-[16px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              Send Seller Documents
            </div>
            <div className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
              Choose the exact docs to send and whether this should come from the warm business inbox or the cold outreach profile.
            </div>

            <div className="mt-3 grid gap-2">
              {(['seller', 'loi', 'email', 'purchaseAgreement', 'assignmentContract', 'sellerQuestionnaire'] as QuickDocumentType[]).map((documentType) => (
                <label
                  key={documentType}
                  className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200"
                >
                  <input
                    type="checkbox"
                    checked={selectedDocuments.includes(documentType)}
                    onChange={() => toggleDocumentSelection(documentType)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{documentLabels[documentType]}</span>
                </label>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSenderProfile('warm')}
                className={`rounded-xl border px-3 py-2 text-[11px] font-semibold transition-all ${
                  senderProfile === 'warm'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-300'
                }`}
              >
                Main Business Email
              </button>
              <button
                type="button"
                onClick={() => setSenderProfile('cold')}
                className={`rounded-xl border px-3 py-2 text-[11px] font-semibold transition-all ${
                  senderProfile === 'cold'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-300'
                }`}
              >
                Cold Campaign Sender
              </button>
            </div>

            <button
              type="button"
              onClick={() => onEmailDocuments({ selectedDocuments, senderProfile })}
              disabled={!selectedDocuments.length}
              className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-[12px] font-semibold transition-all ${
                selectedDocuments.length
                  ? 'bg-slate-950 text-white hover:bg-slate-800 dark:bg-blue-500 dark:hover:bg-blue-400'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-slate-900 dark:text-slate-600'
              }`}
            >
              <Send size={14} />
              Email Selected Documents
            </button>

            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[10.5px] leading-5 text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
              {documentDeliveryStatus}
            </div>
          </div>

          <DocumentPdfPanel
            deal={documentDeal}
            selectedPath={selectedPath}
            branding={branding}
            onPdfAction={onPdfAction}
          />

          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400 mb-2">
              Branding
            </div>
            <div className="text-[16px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              Package Identity
            </div>
            <div className="mt-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                Company Logo
              </div>
              <div className="flex items-center gap-3">
                <div className="h-12 w-24 overflow-hidden rounded-xl border border-gray-200 bg-white flex items-center justify-center dark:border-slate-700 dark:bg-slate-950">
                  {branding.logoDataUrl ? (
                    <img src={branding.logoDataUrl} alt="Company logo" className="max-h-10 max-w-20 object-contain" />
                  ) : (
                    <span className="text-[10px] text-gray-400">No logo</span>
                  )}
                </div>
                <label className="inline-flex cursor-pointer items-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-700 transition-all hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800">
                  Upload Logo
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </label>
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Company Name in PDF
              </label>
              <input
                type="text"
                value={branding.companyName}
                onChange={(event) => onBrandingChange({ ...branding, companyName: event.target.value })}
                placeholder="Your Company Name"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-900 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400 mb-2">
              Active Document
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
              <FileText size={12} />
              {documentLabels[activeDocument]}
            </div>
            <div className="mt-3 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
              The editor updates live from PBK deal state. Preview and print still run through the locked master package
              flow, so the numbers and path logic stay consistent with the original system.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
