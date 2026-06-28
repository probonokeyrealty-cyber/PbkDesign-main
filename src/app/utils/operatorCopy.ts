export const operatorStatusCopy: Record<string, string> = {
  bridge_healthy: 'Connected',
  render_postgres_ready: 'Saved and ready',
  retry_gated: 'Waiting to retry',
  primary_path_gated: 'Needs setup',
  provider_policy: 'Sending rules',
  blocking: 'Needs attention',
  approval_required: 'Needs your review',
  dispatching: 'Working on it',
  reconciliation_required: 'Needs confirmation',
  delivered: 'Delivered',
  failed: 'Could not complete',
};

function normalizeOperatorCopyKey(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function toOperatorCopy(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalized = normalizeOperatorCopyKey(raw);
  if (operatorStatusCopy[normalized]) return operatorStatusCopy[normalized];

  return normalized
    .replace(/^pbk_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
