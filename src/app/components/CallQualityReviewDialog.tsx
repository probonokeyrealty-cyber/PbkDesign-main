import { Activity, CheckCircle2, X } from 'lucide-react';

type CallQualityReviewDialogProps = {
  open: boolean;
  leadName: string;
  score?: number | null;
  outcome?: string;
  sentiment?: number | null;
  transcriptCount?: number;
  onClose: () => void;
};

function formatScore(score?: number | null) {
  if (score == null || !Number.isFinite(Number(score))) return 'Not scored';
  const normalized = Number(score);
  return normalized <= 10 ? `${normalized.toFixed(1)}/10` : `${Math.round(normalized)}/100`;
}

/** Summarizes a completed call from bridge state without inventing QA data. */
export function CallQualityReviewDialog({
  open,
  leadName,
  score = null,
  outcome = 'No disposition reported',
  sentiment = null,
  transcriptCount = 0,
  onClose,
}: CallQualityReviewDialogProps) {
  if (!open) return null;
  const sentimentLabel =
    sentiment == null
      ? 'Not reported'
      : `${Math.round(Number(sentiment) <= 1 ? Number(sentiment) * 100 : Number(sentiment))}/100`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-quality-review-title"
        className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.55)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300">
              Call quality review
            </div>
            <h3
              id="call-quality-review-title"
              className="mt-2 text-lg font-semibold text-slate-100"
            >
              {leadName || 'Completed call'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            <div className="mt-2 text-lg font-semibold text-slate-100">{formatScore(score)}</div>
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
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-sky-300"
          >
            Reviewed
          </button>
        </div>
      </div>
    </div>
  );
}
