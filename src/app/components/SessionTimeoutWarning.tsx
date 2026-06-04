import { useEffect, useMemo, useState } from 'react';
import { Clock3, RotateCcw, ShieldCheck } from 'lucide-react';

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'mousemove', 'scroll', 'visibilitychange'];

interface SessionTimeoutWarningProps {
  warningAfterMs?: number;
  timeoutAfterMs?: number;
  onStayActive?: () => void;
}

/** Shows a non-destructive inactivity warning before the operator loses context. */
export function SessionTimeoutWarning({
  warningAfterMs = 25 * 60 * 1000,
  timeoutAfterMs = 30 * 60 * 1000,
  onStayActive,
}: SessionTimeoutWarningProps) {
  const [lastActivityAt, setLastActivityAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const markActivity = () => setLastActivityAt(Date.now());
    ACTIVITY_EVENTS.forEach((eventName) =>
      window.addEventListener(eventName, markActivity, { passive: true })
    );
    return () =>
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, markActivity));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = Math.max(0, timeoutAfterMs - (now - lastActivityAt));
  const visible = now - lastActivityAt >= warningAfterMs;
  const minutes = Math.max(0, Math.ceil(remaining / 60000));

  const statusCopy = useMemo(() => {
    if (remaining <= 0) return 'Session review needed';
    return `${minutes} minute${minutes === 1 ? '' : 's'} before safety refresh`;
  }, [minutes, remaining]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-amber-400/30 bg-slate-950/95 p-4 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-300">
          <Clock3 size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-100">Still working?</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {statusCopy}. Keep the dashboard active so drafts, approvals, and call context stay
            visible while you work.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500"
          onClick={() => {
            setLastActivityAt(Date.now());
            onStayActive?.();
          }}
        >
          <ShieldCheck size={13} />
          Stay active
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-amber-200"
          onClick={() => window.location.reload()}
        >
          <RotateCcw size={13} />
          Refresh
        </button>
      </div>
    </div>
  );
}
