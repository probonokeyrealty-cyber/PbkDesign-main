export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export type UiToastPayload = {
  title: string;
  desc?: string;
  tone?: ToastTone;
  actionLabel?: string;
  retryId?: string;
  undoId?: string;
  critical?: boolean;
};

const retryHandlers = new Map<string, () => void | Promise<void>>();
const undoHandlers = new Map<string, () => void | Promise<void>>();

export function showUiToast(payload: UiToastPayload) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<UiToastPayload>('pbk:ui-toast', { detail: payload }));
}

export function toastRetry(title: string, desc: string, retryFn: () => void | Promise<void>) {
  const retryId = `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  retryHandlers.set(retryId, retryFn);
  showUiToast({
    title,
    desc,
    tone: 'warning',
    actionLabel: 'Retry',
    retryId,
  });
}

/** Show a toast with an undo callback for reversible destructive actions. */
export function toastUndo({
  title,
  desc,
  undoLabel = 'Undo',
  undo,
  tone = 'info',
}: {
  title: string;
  desc: string;
  undoLabel?: string;
  undo: () => void | Promise<void>;
  tone?: ToastTone;
}) {
  const undoId = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  undoHandlers.set(undoId, undo);
  showUiToast({
    title,
    desc,
    tone,
    actionLabel: undoLabel,
    undoId,
  });
}

export async function runToastRetry(retryId: string) {
  const handler = retryHandlers.get(retryId);
  if (!handler) return;
  await handler();
  retryHandlers.delete(retryId);
}

export async function runToastUndo(undoId: string) {
  const handler = undoHandlers.get(undoId);
  if (!handler) return;
  await handler();
  undoHandlers.delete(undoId);
}
