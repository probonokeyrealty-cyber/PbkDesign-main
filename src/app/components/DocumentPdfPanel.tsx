import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { DealData, PBKPath } from '../types';
import { PBKBranding, buildMasterPackageParams, buildPathPackageText, getPathLabel } from '../utils/pbk';
import { bridgeBlobRequest } from '../utils/runtimeBridge';

interface DocumentPdfPanelProps {
  deal: DealData;
  selectedPath: PBKPath;
  branding: PBKBranding;
  onPdfAction?: (action: 'refresh' | 'download' | 'open') => void;
}

type SyncStatus = 'queued' | 'syncing' | 'ready' | 'error';

function getDownloadName(address: string) {
  const safeAddress = address.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'Deal';
  return `PBK_Master_Deal_Package_${safeAddress}.pdf`;
}

export function DocumentPdfPanel({
  deal,
  selectedPath,
  branding,
  onPdfAction,
}: DocumentPdfPanelProps) {
  const [status, setStatus] = useState<SyncStatus>('queued');
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfKey, setPdfKey] = useState('');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef('');
  const requestKey = JSON.stringify({
    documentType: 'masterPackage',
    documentTitle: 'PBK Master Deal Package',
    propertyAddress: deal.address,
    selectedPathLabel: getPathLabel(selectedPath),
    companyName: branding.companyName,
    content: buildPathPackageText({ ...deal, selectedPath }, branding),
    masterPackageQuery: buildMasterPackageParams({ ...deal, selectedPath }, branding, false),
  });
  const currentPdfUrl = status === 'ready' && pdfKey === requestKey ? pdfUrl : '';
  const actionRef = useRef(onPdfAction);
  useEffect(() => { actionRef.current = onPdfAction; }, [onPdfAction]);

  const revokeCurrentUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
  }, []);

  const generatePdf = useCallback(
    async (source: 'auto' | 'refresh' = 'auto') => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      revokeCurrentUrl();
      setPdfUrl('');
      setStatus('syncing');
      setError('');

      try {
        const blob = await bridgeBlobRequest({
          method: 'POST',
          path: '/api/documents/pdf',
          accept: 'application/pdf',
          body: JSON.parse(requestKey),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;
        const nextUrl = URL.createObjectURL(blob);
        revokeCurrentUrl();
        objectUrlRef.current = nextUrl;
        setPdfUrl(nextUrl);
        setPdfKey(requestKey);
        setUpdatedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        setStatus('ready');
        if (source === 'refresh') {
          actionRef.current?.('refresh');
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'PDF generation failed');
      }
    },
    [requestKey, revokeCurrentUrl]
  );

  useEffect(() => {
    revokeCurrentUrl();
    setPdfUrl('');
    setError('');
    setStatus('queued');
    const timer = window.setTimeout(() => {
      void generatePdf();
    }, 1200);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [generatePdf, revokeCurrentUrl]);

  useEffect(() => () => revokeCurrentUrl(), [revokeCurrentUrl]);

  const downloadName = getDownloadName(deal.address);
  const statusText =
    status === 'ready'
      ? `PDF ready${updatedAt ? ` at ${updatedAt}` : ''}`
      : status === 'syncing'
        ? 'Generating PDF...'
        : status === 'error'
          ? 'PDF service offline'
          : 'Generating PDF...';

  return (
    <section
      aria-labelledby="docs-preview-heading"
      className="pbk-analyzer-card pbk-analyzer-workbench-section"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="docs-preview-heading" className="pbk-analyzer-section-title">
            Master PDF Preview
          </h2>
          <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            Path locked: {getPathLabel(selectedPath)}
          </div>
        </div>
        <div
          role="status"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            status === 'ready'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
              : status === 'error'
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
                : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
          }`}
        >
          {status === 'ready' ? (
            <CheckCircle2 size={12} />
          ) : status === 'error' ? (
            <AlertTriangle size={12} />
          ) : (
            <Loader2 size={12} className="animate-spin" />
          )}
          {statusText}
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10.5px] leading-5 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="pbk-doc-controls mt-3">
        <button
          type="button"
          onClick={() => void generatePdf('refresh')}
          className="pbk-btn pbk-btn-ghost"
        >
          <RefreshCw size={14} />
          Refresh PDF
        </button>
        <a
          href={currentPdfUrl || undefined}
          download={downloadName}
          onClick={(event) => {
            if (!currentPdfUrl) {
              event.preventDefault();
              return;
            }
            onPdfAction?.('download');
          }}
          aria-disabled={!currentPdfUrl}
          className="pbk-btn pbk-btn-primary"
        >
          <Download size={14} />
          Download PDF
        </a>
        <a
          href={currentPdfUrl || undefined}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            if (!currentPdfUrl) {
              event.preventDefault();
              return;
            }
            onPdfAction?.('open');
          }}
          aria-disabled={!currentPdfUrl}
          className="pbk-btn pbk-btn-ghost"
        >
          <ExternalLink size={14} />
          Open PDF
        </a>
      </div>

      <div className="mt-3 overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900">
        {currentPdfUrl ? (
          <iframe
            title="PBK Master Deal Package PDF preview"
            src={currentPdfUrl}
            className="h-[360px] w-full bg-white"
          />
        ) : (
          <div className="flex h-[220px] items-center justify-center px-4 text-center text-[11px] leading-5 text-gray-500 dark:text-gray-400">
            The PDF preview appears here after the Documents-tab sync finishes.
          </div>
        )}
      </div>
    </section>
  );
}
