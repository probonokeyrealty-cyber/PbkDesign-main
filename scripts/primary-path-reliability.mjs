export const PRIMARY_PATH_RELIABILITY_REVISION = '2026-06-14-primary-path-reliability-v1';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_BUDGET = 1;
const DEFAULT_BACKOFF_MS = 150;
const FALLBACK_SLO_TARGET_PERCENT = 0.1;

const PROVIDER_TIMEOUTS = {
  deepseek: 8000,
  deepSeek: 8000,
  telnyx: 7000,
  instantly: 7000,
  docusign: 10000,
  deepgram: 7000,
  elevenlabs: 7000,
  elevenLabs: 7000,
  supabase: 5000,
  postgres: 5000,
  batchdata: 9000,
};

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function normalizeId(value = '') {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isReady(value = {}) {
  return Boolean(
    value?.ready === true ||
      value?.status === 'live' ||
      value?.status === 'up' ||
      value?.status === 'ready' ||
      value?.ok === true
  );
}

function timeoutFor(id = '') {
  return PROVIDER_TIMEOUTS[id] || PROVIDER_TIMEOUTS[clean(id).toLowerCase()] || DEFAULT_TIMEOUT_MS;
}

function retryBudgetFor({ blocking = false, optional = false, category = '', status = '' } = {}) {
  if (optional || blocking) return 0;
  if (category === 'source_truth' && status === 'live_empty') return 0;
  return DEFAULT_RETRY_BUDGET;
}

function classifyPrimaryAttempt(gap = {}) {
  const optional = Boolean(gap.optional);
  const blocking = Boolean(gap.blocking);
  const category = clean(gap.category);
  const status = clean(gap.status);

  if (optional) return 'disabled_optional';
  if (blocking) return 'blocked_until_ready';
  if (category === 'source_truth' && status === 'live_empty') return 'allowed_empty_data';
  if (gap.controlLive === false) return 'preflight_required';
  return 'primary_allowed';
}

function buildControlFromGap(gap = {}) {
  const category = clean(gap.category || 'production');
  const status = clean(gap.status || 'not_live');
  const optional = Boolean(gap.optional);
  const blocking = Boolean(gap.blocking);
  const primaryAttempt = classifyPrimaryAttempt(gap);
  const retryBudget = retryBudgetFor({ blocking, optional, category, status });
  const allowPrimaryAttempt = !blocking && !optional;
  const providerId =
    category === 'provider'
      ? normalizeId(String(gap.id || '').replace(/^provider-/, ''))
      : normalizeId(gap.id || gap.label);

  return {
    id: normalizeId(`primary-${gap.id || gap.label}`),
    label: clean(gap.label || gap.id || 'Primary path control'),
    category,
    status,
    severity: gap.severity || 'medium',
    source: clean(gap.source),
    endpoint: clean(gap.endpoint),
    primaryAttempt,
    allowPrimaryAttempt,
    blocking,
    optional,
    preflightRequired: primaryAttempt === 'preflight_required' || blocking,
    retryBeforeFallback: retryBudget,
    retryBackoffMs: retryBudget ? DEFAULT_BACKOFF_MS : 0,
    timeoutMs: category === 'provider' ? timeoutFor(providerId) : DEFAULT_TIMEOUT_MS,
    timeoutEventRequired: !optional && primaryAttempt !== 'allowed_empty_data',
    fallbackPolicy: optional
      ? 'disabled_until_configured'
      : blocking
        ? 'no_fallback_hide_blocker'
        : retryBudget
          ? 'retry_then_label_fallback'
          : 'label_without_retry',
    reason: clean(gap.detail || gap.status || 'Primary path is not fully live.'),
    operatorAction: clean(gap.operatorAction || 'Fix this control before relying on the primary path.'),
    metadata: {
      gapId: gap.id,
      controlLive: gap.controlLive === true,
      original: gap.metadata || {},
    },
  };
}

function buildProviderRetryPolicy(id = '', provider = {}) {
  const optional = Boolean(provider.optional);
  const ready = isReady(provider);
  const missing = asArray(provider.missing).map(clean).filter(Boolean);
  return {
    id: normalizeId(id),
    label: clean(provider.label || id),
    ready,
    configured: Boolean(provider.configured || ready),
    optional,
    primaryAttempt: ready ? 'primary_allowed' : optional ? 'disabled_optional' : 'blocked_until_ready',
    allowPrimaryAttempt: ready,
    timeoutMs: timeoutFor(id),
    retryBeforeFallback: ready ? DEFAULT_RETRY_BUDGET : 0,
    retryBackoffMs: ready ? DEFAULT_BACKOFF_MS : 0,
    timeoutEventRequired: !optional,
    missing,
  };
}

function uniqueControls(controls = []) {
  const byId = new Map();
  for (const control of controls) {
    if (!control?.id) continue;
    const current = byId.get(control.id);
    if (!current || (control.blocking && !current.blocking)) byId.set(control.id, control);
  }
  return [...byId.values()];
}

export function buildPrimaryPathReliabilityReport({
  gapReport = {},
  runtimeMeta = {},
  checkedAt = new Date().toISOString(),
} = {}) {
  const controls = uniqueControls(asArray(gapReport.gaps).map(buildControlFromGap));
  const providerRetryPolicies = Object.entries(runtimeMeta.providers || {}).map(([id, provider]) =>
    buildProviderRetryPolicy(id, provider)
  );

  const blocking = controls.filter((control) => control.blocking);
  const disabledOptional = controls.filter((control) => control.optional);
  const retryBeforeFallback = controls.filter((control) => control.retryBeforeFallback > 0);
  const timeoutEventsRequired = controls.filter((control) => control.timeoutEventRequired);
  const allowedPrimary = controls.filter((control) => control.allowPrimaryAttempt);

  const primaryAllowed = blocking.length === 0;
  return {
    ok: true,
    result: primaryAllowed ? 'primary_path_attempts_allowed' : 'primary_path_gated',
    revision: PRIMARY_PATH_RELIABILITY_REVISION,
    generatedAt: checkedAt,
    fallbackSloTargetPercent: FALLBACK_SLO_TARGET_PERCENT,
    summary: {
      primaryAllowed,
      totalControls: controls.length,
      allowedPrimary: allowedPrimary.length,
      blocking: blocking.length,
      disabledOptional: disabledOptional.length,
      retryBeforeFallback: retryBeforeFallback.length,
      timeoutEventsRequired: timeoutEventsRequired.length,
      providerPolicies: providerRetryPolicies.length,
    },
    controls,
    providerRetryPolicies,
    nextActions: [
      ...blocking.map((control) => ({
        id: control.id,
        label: control.label,
        action: control.operatorAction,
      })),
      ...disabledOptional.map((control) => ({
        id: control.id,
        label: control.label,
        action: 'Leave disabled or configure intentionally; do not attempt this optional primary path.',
      })),
    ],
  };
}

