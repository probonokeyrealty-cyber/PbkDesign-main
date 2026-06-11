const HOUR_MS = 60 * 60 * 1000;

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function clampCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function classifySourceDataState({
  recordCount = 0,
  lastDataAt = '',
  checkedAt = new Date().toISOString(),
} = {}) {
  if (clampCount(recordCount) === 0) return 'empty';
  const checkedAtMs = parseTimestamp(checkedAt) ?? Date.now();
  const lastDataAtMs = parseTimestamp(lastDataAt);
  if (lastDataAtMs == null) return 'unknown';
  const ageMs = Math.max(0, checkedAtMs - lastDataAtMs);
  if (ageMs <= 6 * HOUR_MS) return 'fresh';
  if (ageMs <= 24 * HOUR_MS) return 'aging';
  return 'stale';
}

export function buildSourceTruthLabel({
  id = '',
  label = '',
  endpoint = '',
  category = 'runtime',
  source = 'bridge',
  endpointReady = true,
  fallbackReason = '',
  degradedReason = '',
  recordCount = 0,
  lastDataAt = '',
  checkedAt = new Date().toISOString(),
  note = '',
} = {}) {
  const safeRecordCount = clampCount(recordCount);
  const checkedAtMs = parseTimestamp(checkedAt) ?? Date.now();
  const lastDataAtMs = parseTimestamp(lastDataAt);
  const status = !endpointReady ? 'offline' : fallbackReason ? 'fallback' : 'live';
  const readiness = !endpointReady ? 'unavailable' : degradedReason ? 'degraded' : 'ready';

  return {
    id,
    label,
    endpoint,
    category,
    status,
    readiness,
    source,
    dataState: classifySourceDataState({
      recordCount: safeRecordCount,
      lastDataAt,
      checkedAt,
    }),
    stalenessMs: lastDataAtMs == null ? null : Math.max(0, checkedAtMs - lastDataAtMs),
    lastCheckedAt: new Date(checkedAtMs).toISOString(),
    lastDataAt: lastDataAtMs == null ? '' : new Date(lastDataAtMs).toISOString(),
    lastUpdatedAt: lastDataAtMs == null ? '' : new Date(lastDataAtMs).toISOString(),
    fallbackReason,
    degradedReason,
    recordCount: safeRecordCount,
    note,
  };
}

export function summarizeSourceTruthLabels(items = []) {
  const labels = Array.isArray(items) ? items : [];
  const count = (key, value) => labels.filter((item) => item?.[key] === value).length;
  return {
    live: count('status', 'live'),
    fallback: count('status', 'fallback'),
    stale: count('status', 'stale'),
    offline: count('status', 'offline'),
    needsWiring: count('status', 'needs-wiring'),
    readiness: {
      ready: count('readiness', 'ready'),
      degraded: count('readiness', 'degraded'),
      unavailable: count('readiness', 'unavailable'),
    },
    data: {
      fresh: count('dataState', 'fresh'),
      aging: count('dataState', 'aging'),
      stale: count('dataState', 'stale'),
      empty: count('dataState', 'empty'),
      unknown: count('dataState', 'unknown'),
    },
  };
}
