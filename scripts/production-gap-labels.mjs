const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function bool(value) {
  return value === true;
}

function normalizeId(value = '') {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isReady(value = {}) {
  return bool(value.ready) || value.status === 'live' || value.status === 'up' || value.status === 'ready';
}

function buildGap({
  id = '',
  label = '',
  category = 'production',
  severity = 'medium',
  status = 'not_live',
  source = '',
  endpoint = '',
  detail = '',
  operatorAction = '',
  optional = false,
  blocking = false,
  controlLive = false,
  metadata = {},
} = {}) {
  return {
    id: normalizeId(id || label),
    label: clean(label || id || 'Production control'),
    category: clean(category || 'production'),
    severity: SEVERITY_ORDER[severity] === undefined ? 'medium' : severity,
    status: clean(status || (controlLive ? 'live' : 'not_live')),
    source: clean(source),
    endpoint: clean(endpoint),
    detail: clean(detail),
    operatorAction: clean(operatorAction),
    optional: Boolean(optional),
    blocking: Boolean(blocking),
    controlLive: Boolean(controlLive),
    metadata,
  };
}

function releaseGap(component = {}) {
  const id = clean(component.id || component.label || 'release-component');
  const label = clean(component.label || id);
  const source = clean(component.source || 'GET /api/release/status');
  const detail = clean(component.detail || component.status || 'Control is not marked ready.');
  const criticalIds = new Set(['state-backend', 'migration-readiness', 'bridge-revision']);
  const severity = criticalIds.has(id) ? 'critical' : id === 'netlify' ? 'medium' : 'high';
  const blocking = criticalIds.has(id);
  const operatorAction =
    id === 'netlify'
      ? 'Expose Netlify deploy metadata to the bridge if operator launch evidence needs it. Netlify can still be live without this metadata.'
      : 'Complete this release-readiness dependency before calling production flawless.';
  return buildGap({
    id: `release-${id}`,
    label,
    category: 'release',
    severity,
    status: component.configured ? 'configured_not_ready' : 'missing',
    source,
    detail,
    operatorAction,
    optional: id === 'netlify',
    blocking,
    controlLive: false,
    metadata: component,
  });
}

function sourceGap(item = {}) {
  const status = clean(item.status || 'unknown');
  const readiness = clean(item.readiness || 'unknown');
  const dataState = clean(item.dataState || 'unknown');
  const fallbackReason = clean(item.fallbackReason || '');
  const degradedReason = clean(item.degradedReason || '');
  const endpoint = clean(item.endpoint || '');
  const isFallback = status === 'fallback';
  const isOffline = status === 'offline' || readiness === 'unavailable';
  const isDegraded = readiness === 'degraded';
  const isStale = dataState === 'stale';
  const isEmpty = dataState === 'empty';
  const isLiveReady = status === 'live' && readiness === 'ready';
  if (!isFallback && !isOffline && !isDegraded && !isStale && !isEmpty) return null;
  return buildGap({
    id: `source-${item.id || endpoint}`,
    label: item.label || endpoint || 'Runtime source',
    category: 'source_truth',
    severity: isOffline ? 'critical' : isFallback || isStale ? 'high' : isDegraded ? 'medium' : 'info',
    status: isOffline
      ? 'offline'
      : isFallback
        ? 'fallback'
        : isStale
          ? 'stale_data'
          : isDegraded
            ? 'degraded'
            : 'live_empty',
    source: item.source || 'GET /api/system/source-labels',
    endpoint,
    detail:
      fallbackReason ||
      degradedReason ||
      (isEmpty
        ? 'Endpoint is live, but no records exist yet.'
        : isStale && isLiveReady
          ? 'Endpoint is live and reachable, but its latest business record is older than the freshness window.'
        : item.note || 'Source needs operator attention.'),
    operatorAction: isEmpty
      ? 'No code action required. Create or ingest records when this surface is ready for real data.'
      : isStale && isLiveReady
        ? 'No wiring fix required. Create or receive a fresh event if the launch checklist needs recency proof for this surface.'
      : 'Fix the canonical endpoint or data source before relying on this control.',
    optional: isEmpty,
    blocking: isOffline || isFallback || (isStale && !isLiveReady),
    controlLive: status === 'live' && readiness === 'ready',
    metadata: item,
  });
}

function toolingGap(id = '', section = {}) {
  const optional = Boolean(section.optional);
  const configured = Boolean(section.configured || section.enabled || section.registryConfigured || section.endpointConfigured);
  const status = clean(section.status || (configured ? 'configured_not_live' : optional ? 'optional_not_live' : 'not_live'));
  return buildGap({
    id: `tooling-${id}`,
    label: clean(section.label || id).replace(/[-_]/g, ' '),
    category: 'tooling',
    severity: optional ? 'low' : 'high',
    status,
    source: 'GET /api/tooling/status',
    detail: clean(section.error || section.note || 'Tooling surface is not ready.'),
    operatorAction: optional
      ? 'Keep labeled as optional until this add-on is installed, smoke-tested, and intentionally promoted.'
      : 'Wire and verify this required tooling surface before launch.',
    optional,
    blocking: !optional,
    controlLive: false,
    metadata: section,
  });
}

function providerGap(id = '', provider = {}) {
  const optional = Boolean(provider.optional);
  const missing = asArray(provider.missing).map(clean).filter(Boolean);
  const status = clean(provider.status || (provider.configured ? 'configured_not_ready' : optional ? 'optional_missing' : 'missing'));
  const required = !optional;
  const severity = required ? (provider.configured ? 'high' : 'critical') : 'low';
  return buildGap({
    id: `provider-${id}`,
    label: provider.label || id,
    category: 'provider',
    severity,
    status,
    source: 'GET /health',
    detail: clean(provider.note || (missing.length ? `Missing ${missing.join(', ')}` : 'Provider is not ready.')),
    operatorAction: required
      ? 'Set the required provider env/config and rerun hosted smoke before launch.'
      : 'Optional provider is labeled non-live. Configure only if this add-on is part of launch.',
    optional,
    blocking: required,
    controlLive: false,
    metadata: provider,
  });
}

export function buildProductionGapLabelsReport({
  sourceLabels = [],
  releaseStatus = {},
  toolingStatus = {},
  runtimeMeta = {},
  checkedAt = new Date().toISOString(),
} = {}) {
  const gaps = [];

  for (const item of asArray(sourceLabels)) {
    const gap = sourceGap(item);
    if (gap) gaps.push(gap);
  }

  for (const component of asArray(releaseStatus.components)) {
    if (!component?.ready) gaps.push(releaseGap(component));
  }

  for (const [id, section] of Object.entries(toolingStatus || {})) {
    if (id === 'summary') continue;
    if (!section || typeof section !== 'object') continue;
    if (!isReady(section)) gaps.push(toolingGap(id, section));
  }

  const providers = runtimeMeta.providers || {};
  for (const [id, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object') continue;
    if (!isReady(provider)) gaps.push(providerGap(id, provider));
  }

  const unique = [];
  const seen = new Set();
  for (const gap of gaps) {
    const key = `${gap.category}:${gap.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(gap);
  }

  unique.sort((left, right) => {
    const severityDelta = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severityDelta) return severityDelta;
    return left.label.localeCompare(right.label);
  });

  const countBy = (key, value) => unique.filter((gap) => gap[key] === value).length;
  const blocking = unique.filter((gap) => gap.blocking);
  const notLive = unique.filter((gap) => !gap.controlLive);
  return {
    ok: true,
    result: blocking.length ? 'production_gaps_blocking' : unique.length ? 'production_gaps_labeled' : 'production_controls_live',
    generatedAt: checkedAt,
    summary: {
      total: unique.length,
      blocking: blocking.length,
      notLive: notLive.length,
      optional: unique.filter((gap) => gap.optional).length,
      bySeverity: {
        critical: countBy('severity', 'critical'),
        high: countBy('severity', 'high'),
        medium: countBy('severity', 'medium'),
        low: countBy('severity', 'low'),
        info: countBy('severity', 'info'),
      },
      byCategory: {
        sourceTruth: countBy('category', 'source_truth'),
        release: countBy('category', 'release'),
        tooling: countBy('category', 'tooling'),
        provider: countBy('category', 'provider'),
      },
    },
    gaps: unique,
  };
}
