import { useEffect, useState } from 'react';
import { runToastRetry, type UiToastPayload } from '../utils/uiFeedback';

type ToastRecord = UiToastPayload & {
  id: string;
};

export function UiToastHost() {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<UiToastPayload>).detail;
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => [{ ...detail, id }, ...current].slice(0, 4));
      if (!detail.critical) {
        window.setTimeout(() => {
          setToasts((current) => current.filter((toast) => toast.id !== id));
        }, 6000);
      }
    };

    window.addEventListener('pbk:ui-toast', onToast);
    return () => window.removeEventListener('pbk:ui-toast', onToast);
  }, []);

  if (!toasts.length) return null;
  const hasCriticalToast = toasts.some((toast) => toast.critical);

  return (
    <div className="ui-toast-stack" aria-live={hasCriticalToast ? 'assertive' : 'polite'}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={[
            'ui-toast',
            `ui-toast-${toast.tone || 'info'}`,
            toast.critical ? 'ui-toast-critical' : '',
          ].join(' ')}
        >
          <div className="ui-toast-title">{toast.title}</div>
          {toast.desc && <div className="ui-toast-desc">{toast.desc}</div>}
          <div className="ui-toast-actions">
            {toast.retryId && toast.actionLabel && (
              <button
                type="button"
                className="ui-toast-action"
                onClick={() => {
                  void runToastRetry(toast.retryId || '');
                  setToasts((current) => current.filter((item) => item.id !== toast.id));
                }}
              >
                {toast.actionLabel}
              </button>
            )}
            {toast.critical && (
              <button
                type="button"
                className="ui-toast-action"
                onClick={() =>
                  setToasts((current) => current.filter((item) => item.id !== toast.id))
                }
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
