export const SILENT_ERROR_GOVERNANCE_REVISION =
  '2026-06-13-silent-error-governance-v1';

const SEVERITY_RANK = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCode(value = '') {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeSeverity(value = '') {
  const normalized = normalizeCode(value || 'medium');
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, normalized) ? normalized : 'medium';
}

function severityAtLeast(value = '', threshold = 'medium') {
  return SEVERITY_RANK[normalizeSeverity(value)] >= SEVERITY_RANK[normalizeSeverity(threshold)];
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function addEvidence(evidence, value) {
  const normalized = normalizeCode(value);
  if (normalized && !evidence.includes(normalized)) evidence.push(normalized);
}

function hasRecoverableVisibleFallback(finding = {}) {
  return Boolean(
    finding.surfaced === true &&
      finding.fallbackLabeled === true &&
      (finding.retryAvailable === true || finding.manualFallbackAvailable === true)
  );
}

function isProviderAmbiguity(finding = {}) {
  const code = normalizeCode(finding.code || finding.result || finding.status);
  return Boolean(
    code === 'provider_delivery_unknown' ||
      code === 'delivery_unknown' ||
      code === 'reconciliation_required' ||
      finding.reconciliationRequired === true ||
      normalizeCode(finding.status) === 'reconciliation_required'
  );
}

function isRuntimeTruthDrift(finding = {}) {
  const code = normalizeCode(finding.code);
  return Boolean(
    code.includes('stale') ||
      code.includes('source_truth') ||
      code.includes('fallback_truth') ||
      Number(finding.stalePercent || 0) >= 10
  );
}

function isIdentityRisk(finding = {}) {
  const code = normalizeCode(finding.code);
  return Boolean(
    code.includes('duplicate_lead') ||
      code.includes('identity_split') ||
      code.includes('timeline_split') ||
      code.includes('canonical_identity_missing')
  );
}

function isSecurityRisk(finding = {}) {
  const code = normalizeCode(finding.code);
  return Boolean(
    code.includes('rls_disabled') ||
      code.includes('public_dml') ||
      code.includes('anon_grant') ||
      code.includes('service_role_exposed') ||
      code.includes('hmac_missing')
  );
}

function isSilentSwallow(finding = {}) {
  const code = normalizeCode(finding.code);
  return Boolean(
    finding.surfaced === false ||
      code.includes('swallowed') ||
      code.includes('silent_catch') ||
      code.includes('unlabeled_fallback')
  );
}

export function classifySilentErrorFinding(input = {}) {
  const finding = input && typeof input === 'object' ? input : {};
  const code = normalizeCode(finding.code || finding.result || finding.status || 'unknown');
  const area = normalizeCode(finding.area || finding.system || 'unknown');
  const severity = normalizeSeverity(finding.severity);
  const requiredEvidence = unique(finding.requiredEvidence || []);
  const launchCritical = finding.launchCritical === true || severity === 'critical';
  const recoverableVisibleFallback = hasRecoverableVisibleFallback(finding);

  let policy = 'observe';
  let launchBlocker = false;

  if (recoverableVisibleFallback) {
    policy = 'allowed_labeled_fallback';
  }

  if (isSecurityRisk({ ...finding, code }) || launchCritical) {
    policy = 'fail_closed';
    launchBlocker = true;
    addEvidence(requiredEvidence, 'owner');
    addEvidence(requiredEvidence, 'remediation');
    addEvidence(requiredEvidence, 'verification');
  }

  if (isProviderAmbiguity(finding)) {
    policy = 'reconcile_before_done';
    addEvidence(requiredEvidence, 'timeline_projection');
    addEvidence(requiredEvidence, 'reconciliation');
    if (finding.timelineProjected !== true || finding.reconciled !== true) launchBlocker = true;
  }

  if (isRuntimeTruthDrift(finding)) {
    addEvidence(requiredEvidence, 'freshness_slo');
    addEvidence(requiredEvidence, 'source_label');
    if (severityAtLeast(severity, 'high') || Number(finding.stalePercent || 0) >= 10) {
      policy = 'truth_gate_required';
      launchBlocker = true;
    } else if (!recoverableVisibleFallback) {
      policy = 'label_and_monitor';
    }
  }

  if (isIdentityRisk(finding)) {
    policy = 'canonical_identity_required';
    addEvidence(requiredEvidence, 'identity_merge');
    addEvidence(requiredEvidence, 'audit_log');
    launchBlocker = true;
  }

  if (isSilentSwallow(finding) && severityAtLeast(severity, 'medium') && !recoverableVisibleFallback) {
    policy = 'surface_or_block';
    addEvidence(requiredEvidence, 'operator_visible_error');
    launchBlocker = true;
  }

  if (!launchBlocker && severityAtLeast(severity, 'high') && !recoverableVisibleFallback) {
    policy = 'owner_review_required';
    addEvidence(requiredEvidence, 'owner');
    addEvidence(requiredEvidence, 'verification');
  }

  return {
    ...finding,
    area,
    code,
    severity,
    revision: SILENT_ERROR_GOVERNANCE_REVISION,
    policy,
    launchBlocker,
    surfaced: finding.surfaced === true,
    fallbackLabeled: finding.fallbackLabeled === true,
    requiredEvidence: unique(requiredEvidence),
    checkedAt: new Date().toISOString(),
  };
}

export function buildSilentErrorGovernanceReport({ findings = [] } = {}) {
  const normalizedFindings = findings.map(classifySilentErrorFinding);
  const blockers = normalizedFindings.filter((finding) => finding.launchBlocker);
  const allowedLabeledFallbacks = normalizedFindings.filter(
    (finding) => finding.policy === 'allowed_labeled_fallback'
  );
  const unsurfaced = normalizedFindings.filter((finding) => finding.surfaced !== true);
  const highRisk = normalizedFindings.filter((finding) => severityAtLeast(finding.severity, 'high'));

  return {
    ok: true,
    launchReady: blockers.length === 0,
    result: blockers.length ? 'silent_error_blockers_present' : 'silent_error_governance_ready',
    revision: SILENT_ERROR_GOVERNANCE_REVISION,
    generatedAt: new Date().toISOString(),
    summary: {
      total: normalizedFindings.length,
      blockers: blockers.length,
      highRisk: highRisk.length,
      unsurfaced: unsurfaced.length,
      allowedLabeledFallbacks: allowedLabeledFallbacks.length,
    },
    blockers,
    allowedLabeledFallbacks,
    findings: normalizedFindings,
  };
}
