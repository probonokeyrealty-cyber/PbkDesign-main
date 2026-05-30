export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export type UiToastPayload = {
  title: string;
  desc?: string;
  tone?: ToastTone;
  actionLabel?: string;
  retryId?: string;
};

const retryHandlers = new Map<string, () => void | Promise<void>>();

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

export async function runToastRetry(retryId: string) {
  const handler = retryHandlers.get(retryId);
  if (!handler) return;
  await handler();
}
