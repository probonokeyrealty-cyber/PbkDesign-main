import { Activity, CheckCircle2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

type CallQualityReviewDialogProps = {
  open: boolean;
  leadName: string;
  score?: number | null;
  scoreScale?: 100;
  outcome?: string;
  sentiment?: number | null;
  transcriptCount?: number;
  leadHref?: string;
  onClose: () => void;
  onMarkReviewed?: () => void;
};

function formatScore(score?: number | null, scale?: 100) {
  if (score == null || !Number.isFinite(Number(score))) return 'Not scored';
  const normalized = Number(score);
  return scale === 100 || normalized > 10
    ? `${Math.round(normalized)}/100`
    : `${normalized.toFixed(1)}/10`;
}

/** Summarizes a completed call from bridge state without inventing QA data. */
export function CallQualityReviewDialog({
  open,
  leadName,
  score = null,
  scoreScale,
  outcome = 'No disposition reported',
  sentiment = null,
  transcriptCount = 0,
  leadHref,
  onClose,
  onMarkReviewed,
}: CallQualityReviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [open]);

  if (!open) return null;
  const dismiss = () => {
    dialogRef.current?.close();
    onClose();
  };
  const sentimentLabel =
    sentiment == null
      ? 'Not reported'
      : `${Math.round(Number(sentiment) <= 1 ? Number(sentiment) * 100 : Number(sentiment))}/100`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="call-quality-review-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop:bg-slate-950/80 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300">
            Call quality review
          </div>
          <h3 id="call-quality-review-title" className="mt-2 text-lg font-semibold text-slate-100">
            {leadName || 'Completed call'}
          </h3>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="grid h-8 w-8 place-items-center rounded-full border border-slate-800 text-slate-400 transition hover:border-slate-600 hover:text-slate-100"
          aria-label="Close call quality review"
        >
          <X size={15} />
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <CheckCircle2 size={12} />
            QA score
          </div>
          <div role="status" className="mt-2 text-lg font-semibold text-slate-100">
            {formatScore(score, scoreScale)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <Activity size={12} />
            Sentiment
          </div>
          <div className="mt-2 text-lg font-semibold text-slate-100">{sentimentLabel}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Transcript</div>
          <div className="mt-2 text-lg font-semibold text-slate-100">{transcriptCount} lines</div>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-300">
        {outcome || 'No disposition reported'}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {leadHref && (
          <Link
            to={leadHref}
            className="inline-flex min-h-11 items-center rounded-full border border-sky-500/60 px-4 text-sm font-semibold text-sky-200 hover:bg-slate-800"
          >
            Open lead
          </Link>
        )}
        <button
          type="button"
          onClick={() => {
            dialogRef.current?.close();
            (onMarkReviewed || onClose)();
          }}
          className="min-h-11 rounded-full bg-sky-400 px-4 text-sm font-bold text-slate-950 transition hover:bg-sky-300"
        >
          {onMarkReviewed ? 'Mark reviewed' : 'Done'}
        </button>
      </div>
    </dialog>
  );
}
