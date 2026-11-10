import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { DealData, PBKPath, QuickDocumentType } from '../types';
import { Clipboard, Copy, Eye, FilePlus, FileText, Printer, Send } from 'lucide-react';
import { PBKBranding, buildDocumentSet, getPdfReadiness } from '../utils/pbk';
import {
  fetchSenderIdentitiesRequest,
  type CommunicationSenderIdentity,
} from '../utils/runtimeBridge';
import { DocumentPdfPanel } from './DocumentPdfPanel';
import { SenderIdentitySelect } from './inbox/SenderIdentitySelect';

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
    fromEmail?: string;
    senderIdentityId?: string;
    documentSet: Partial<Record<QuickDocumentType, string>>;
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
    [deal, selectedPath]
  );
  const generatedDocuments = useMemo(
    () => buildDocumentSet(documentDeal, branding),
    [documentDeal, branding]
  );
  const [editableDocuments, setEditableDocuments] =
    useState<Record<QuickDocumentType, string>>(generatedDocuments);
  const [selectedDocuments, setSelectedDocuments] = useState<QuickDocumentType[]>([
    'seller',
    'loi',
  ]);
  const [senderProfile, setSenderProfile] = useState<'warm' | 'cold'>('warm');
  const [fromEmail, setFromEmail] = useState('');
  const [senderIdentities, setSenderIdentities] = useState<CommunicationSenderIdentity[]>([]);
  const [senderIdentityId, setSenderIdentityId] = useState('');
  const [senderIdentitiesLoading, setSenderIdentitiesLoading] = useState(false);
  const [senderIdentityError, setSenderIdentityError] = useState('');
  const readiness = getPdfReadiness(documentDeal);
  const selectedSenderIdentity =
    senderIdentities.find((identity) => identity.id === senderIdentityId) || null;
  const eligibleSenderIdentities = useMemo(
    () =>
      senderIdentities.filter(
        (identity) =>
          String(identity.lifecycleStatus || '').toLowerCase() === 'active' &&
          !/(blocked|error|failed|retired|disabled|quarantined)/i.test(
            String(identity.healthStatus || '')
          )
      ),
    [senderIdentities]
  );
  const recommendedSenderIdentity =
    eligibleSenderIdentities.find((identity) => identity.isWorkspaceDefault) ||
    eligibleSenderIdentities[0] ||
    null;

  useEffect(() => {
    setEditableDocuments(generatedDocuments);
  }, [generatedDocuments]);

  useEffect(() => {
    let cancelled = false;
    setSenderIdentitiesLoading(true);
    fetchSenderIdentitiesRequest({ channel: 'email' })
      .then((response) => {
        if (cancelled) return;
        const items = Array.isArray(response.items) ? response.items : [];
        setSenderIdentities(items);
        setSenderIdentityError('');
        setSenderIdentityId((current) => {
          if (current && items.some((identity) => identity.id === current)) return current;
          const usable = items.filter(
            (identity) =>
              String(identity.lifecycleStatus || '').toLowerCase() === 'active' &&
              !/(blocked|error|failed|retired|disabled|quarantined)/i.test(
                String(identity.healthStatus || '')
              )
          );
          const workspaceDefault = usable.find((identity) => identity.isWorkspaceDefault);
          return workspaceDefault?.id || usable[0]?.id || '';
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setSenderIdentities([]);
        setSenderIdentityError(
          error instanceof Error ? error.message : 'Unable to load sender identities.'
        );
      })
      .finally(() => {
        if (!cancelled) setSenderIdentitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        : [...prev, documentType]
    );
  };

  return (
    <div className="pbk-analyzer-main pbk-doc-workbench">
      <section aria-labelledby="docs-export-heading" className="pbk-analyzer-card pbk-analyzer-workbench-section">
        <h2 id="docs-export-heading" className="pbk-analyzer-section-title mb-3">Master Deal PDF</h2>
        <div className="pbk-doc-controls">
          <button type="button" onClick={onPreview} className="pbk-btn pbk-btn-ghost">
            <Eye size={14} aria-hidden="true" />
            Preview Package
          </button>
          <button type="button" onClick={onPrint} className="pbk-btn pbk-btn-ghost">
            <Printer size={14} aria-hidden="true" />
            Print Package
          </button>
          <button type="button" onClick={onGenerate} disabled={!readiness.ready} className="pbk-btn pbk-btn-primary">
            <FilePlus size={14} aria-hidden="true" />
            Generate Master PDF
          </button>
        </div>
        <p className="pbk-doc-status" role="status">{exportStatus}</p>
        {!readiness.ready && (
          <p className="pbk-doc-status">Missing: {readiness.missing.join(', ')}</p>
        )}
      </section>

      <div className="pbk-doc-grid">
        <div className="min-w-0">
          <section aria-labelledby="docs-quick-heading" className="pbk-analyzer-card pbk-analyzer-workbench-section">
            <h2 id="docs-quick-heading" className="pbk-analyzer-section-title mb-3">Quick Documents</h2>
            <div className="pbk-doc-quick-grid">
              {quickDocumentCards.map((card) => {
                const Icon = card.icon;
                const isActive = activeDocument === card.type;

                return (
                  <button
                    key={card.type}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onDocumentChange(card.type)}
                    className={`min-w-0 rounded-md border px-3 py-2 text-left ${card.tone}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold">{card.title}</div>
                        <div className="mt-1 text-[10.5px] leading-5 opacity-80">
                          {card.subtitle}
                        </div>
                      </div>
                      <Icon size={16} className="shrink-0" aria-hidden="true" />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="docs-templates-heading" className="pbk-analyzer-card pbk-analyzer-workbench-section">
            <h2 id="docs-templates-heading" className="pbk-analyzer-section-title mb-3">Document Templates</h2>
            <div className="pbk-doc-controls mb-3" role="group" aria-label="Document template">
                {(Object.keys(documentLabels) as QuickDocumentType[]).map((documentType) => (
                  <button
                    key={documentType}
                    type="button"
                    aria-pressed={activeDocument === documentType}
                    onClick={() => onDocumentChange(documentType)}
                    className="pbk-btn pbk-btn-ghost"
                  >
                    {documentLabels[documentType]}
                  </button>
                ))}
            </div>
            <textarea
              aria-label={`Edit ${activeDocument} document`}
              value={editableDocuments[activeDocument]}
              onChange={(event) => handleDocumentEdit(activeDocument, event.target.value)}
              className="pbk-doc-editor"
            />
          </section>
        </div>

        <div className="min-w-0">
          <DocumentPdfPanel
            deal={documentDeal}
            selectedPath={selectedPath}
            branding={branding}
            onPdfAction={onPdfAction}
          />
          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-blue-500 mb-2">
              Email Delivery
            </div>
            <div className="text-[16px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              Send Seller Documents
            </div>
            <div className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
              Choose the exact docs to send and whether this should come from the warm business
              inbox or the cold outreach profile.
            </div>

            <div className="mt-3 grid gap-2">
              {(
                [
                  'seller',
                  'loi',
                  'email',
                  'purchaseAgreement',
                  'assignmentContract',
                  'sellerQuestionnaire',
                ] as QuickDocumentType[]
              ).map((documentType) => (
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

            {(senderIdentitiesLoading || senderIdentities.length > 0) && (
              <div className="mt-3">
                <SenderIdentitySelect
                  identities={senderIdentities}
                  selectedId={senderIdentityId}
                  recommendedId={recommendedSenderIdentity?.id || ''}
                  loading={senderIdentitiesLoading}
                  onChange={(identityId) => {
                    setSenderIdentityId(identityId);
                    const identity = senderIdentities.find((item) => item.id === identityId);
                    if (identity?.address) setFromEmail(identity.address);
                  }}
                />
              </div>
            )}

            <label className="mt-3 block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                {selectedSenderIdentity ? 'Selected from email' : 'Fallback from email'}
              </span>
              <input
                type="email"
                value={selectedSenderIdentity?.address || fromEmail}
                onChange={(event) => setFromEmail(event.target.value)}
                disabled={Boolean(selectedSenderIdentity)}
                placeholder={
                  senderProfile === 'cold'
                    ? 'Optional cold sender override'
                    : 'Optional warm sender override'
                }
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-700 dark:bg-slate-950 dark:text-gray-100 dark:disabled:bg-slate-900 dark:disabled:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-900/40"
              />
              <span className="mt-1 block text-[10.5px] leading-4 text-gray-500 dark:text-gray-400">
                {selectedSenderIdentity
                  ? `${selectedSenderIdentity.provider} identity selected from the connected sender inventory.`
                  : senderIdentityError
                    ? `Sender inventory unavailable: ${senderIdentityError}. The profile fallback will be used.`
                    : 'Leave blank to use the selected sender profile default.'}
              </span>
            </label>

            <button
              type="button"
              onClick={() =>
                onEmailDocuments({
                  selectedDocuments,
                  senderProfile,
                  fromEmail: fromEmail.trim() || undefined,
                  senderIdentityId: senderIdentityId || undefined,
                  documentSet: editableDocuments,
                })
              }
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
                    <img
                      src={branding.logoDataUrl}
                      alt="Company logo"
                      className="max-h-10 max-w-20 object-contain"
                    />
                  ) : (
                    <span className="text-[10px] text-gray-400">No logo</span>
                  )}
                </div>
                <label className="inline-flex cursor-pointer items-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-700 transition-all hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800">
                  Upload Logo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
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
                onChange={(event) =>
                  onBrandingChange({ ...branding, companyName: event.target.value })
                }
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
              The editor updates live from PBK deal state. Preview and print still run through the
              locked master package flow, so the numbers and path logic stay consistent with the
              original system.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
