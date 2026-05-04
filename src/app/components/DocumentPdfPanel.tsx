import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { DealData, PBKPath } from '../types';
import { PBKBranding, buildMasterPackageParams, getPathLabel } from '../utils/pbk';
import { buildRuntimeHeaders, buildRuntimeUrl } from '../utils/runtimeBridge';

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
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef('');

  const revokeCurrentUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
  }, []);

  const generatePdf = useCallback(async (source: 'auto' | 'refresh' = 'auto') => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('syncing');
    setError('');

    try {
      const response = await fetch(buildRuntimeUrl('/api/documents/pdf'), {
        method: 'POST',
        headers: buildRuntimeHeaders({ json: true, accept: 'application/pdf' }),
        body: JSON.stringify({
          documentType: 'masterPackage',
          documentTitle: 'PBK Master Deal Package',
          propertyAddress: deal.address,
          selectedPathLabel: getPathLabel(selectedPath),
          companyName: branding.companyName,
          masterPackageQuery: buildMasterPackageParams(
            {
              ...deal,
              selectedPath,
            },
            branding,
            false,
          ),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = `PDF service returned ${response.status}`;
        try {
          const payload = await response.json();
          message = payload.message || payload.error || message;
        } catch {
          // Keep the HTTP fallback message.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      revokeCurrentUrl();
      objectUrlRef.current = nextUrl;
      setPdfUrl(nextUrl);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      setStatus('ready');
      if (source === 'refresh') {
        onPdfAction?.('refresh');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'PDF generation failed');
    }
  }, [branding, deal, onPdfAction, revokeCurrentUrl, selectedPath]);

  useEffect(() => {
    setStatus('queued');
    const timer = window.setTimeout(() => {
      void generatePdf();
    }, 1200);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [generatePdf]);

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
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-500">
            PDF Sync
          </div>
          <div className="text-[16px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Master PDF Preview
          </div>
          <div className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
            Auto-regenerates the same PBK master package output used by the selected-path packet, without changing Preview or Print.
          </div>
          <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            Path locked: {getPathLabel(selectedPath)}
          </div>
        </div>
        <div
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void generatePdf('refresh')}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-700 transition-all hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          <RefreshCw size={14} />
          Refresh PDF
        </button>
        <a
          href={pdfUrl || undefined}
          download={downloadName}
          onClick={(event) => {
            if (!pdfUrl) {
              event.preventDefault();
              return;
            }
            onPdfAction?.('download');
          }}
          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold transition-all ${
            pdfUrl
              ? 'bg-emerald-500 text-white hover:bg-emerald-600'
              : 'pointer-events-none bg-gray-200 text-gray-400 dark:bg-slate-700 dark:text-slate-500'
          }`}
        >
          <Download size={14} />
          Download PDF
        </a>
        <a
          href={pdfUrl || undefined}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            if (!pdfUrl) {
              event.preventDefault();
              return;
            }
            onPdfAction?.('open');
          }}
          className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold transition-all ${
            pdfUrl
              ? 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
              : 'pointer-events-none border border-gray-200 bg-gray-50 text-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500'
          }`}
        >
          <ExternalLink size={14} />
          Open PDF
        </a>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900">
        {pdfUrl ? (
          <iframe title="PBK Master Deal Package PDF preview" src={pdfUrl} className="h-[360px] w-full bg-white" />
        ) : (
          <div className="flex h-[220px] items-center justify-center px-4 text-center text-[11px] leading-5 text-gray-500 dark:text-gray-400">
            The PDF preview appears here after the Documents-tab sync finishes.
          </div>
        )}
      </div>
    </div>
  );
}
