import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildSilentErrorGovernanceReport,
  classifySilentErrorFinding,
  SILENT_ERROR_GOVERNANCE_REVISION,
} from './silent-error-governance.mjs';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const securityExposure = classifySilentErrorFinding({
  area: 'supabase',
  code: 'rls_disabled_public_dml',
  severity: 'critical',
  surfaced: false,
  launchCritical: true,
});
assert.equal(securityExposure.launchBlocker, true, 'Critical public database exposure must block launch.');
assert(securityExposure.requiredEvidence.includes('owner'), 'Critical findings must require an owner.');
assert(securityExposure.requiredEvidence.includes('remediation'), 'Critical findings must require remediation evidence.');

const providerUnknown = classifySilentErrorFinding({
  area: 'provider',
  code: 'provider_delivery_unknown',
  severity: 'high',
  surfaced: true,
  reconciliationRequired: true,
  timelineProjected: false,
});
assert.equal(providerUnknown.launchBlocker, true, 'Unknown provider delivery must block until projected/reconciled.');
assert(providerUnknown.requiredEvidence.includes('timeline_projection'), 'Provider ambiguity must require timeline projection.');
assert(providerUnknown.requiredEvidence.includes('reconciliation'), 'Provider ambiguity must require reconciliation evidence.');

const labeledPdfFallback = classifySilentErrorFinding({
  area: 'pdf',
  code: 'simple_pdf_renderer_fallback',
  severity: 'medium',
  surfaced: true,
  fallbackLabeled: true,
  retryAvailable: true,
  owner: 'documents',
});
assert.equal(labeledPdfFallback.launchBlocker, false, 'Labeled recoverable PDF fallback should not block launch.');
assert.equal(labeledPdfFallback.policy, 'allowed_labeled_fallback', 'Recoverable labeled fallback should remain allowed.');

const staleRuntime = classifySilentErrorFinding({
  area: 'runtime',
  code: 'state_stale',
  severity: 'high',
  surfaced: true,
  stalePercent: 34,
  fallbackLabeled: true,
});
assert.equal(staleRuntime.launchBlocker, true, 'High-staleness runtime truth must block high-stakes launch.');
assert(staleRuntime.requiredEvidence.includes('freshness_slo'), 'Stale runtime truth must require freshness SLO evidence.');

const report = buildSilentErrorGovernanceReport({
  findings: [
    securityExposure,
    providerUnknown,
    labeledPdfFallback,
    staleRuntime,
    {
      area: 'youtube',
      code: 'captions_disabled',
      severity: 'medium',
      surfaced: true,
      fallbackLabeled: true,
      manualFallbackAvailable: true,
    },
  ],
});

assert.equal(report.ok, true, 'Silent error governance report should be generated.');
assert.equal(report.revision, SILENT_ERROR_GOVERNANCE_REVISION, 'Report should expose revision.');
assert.equal(report.launchReady, false, 'Report should fail launch while blockers remain.');
assert.deepEqual(
  report.blockers.map((finding) => finding.code),
  ['rls_disabled_public_dml', 'provider_delivery_unknown', 'state_stale'],
  'Report should preserve blocker order.'
);
assert.equal(report.summary.total, 5, 'Report should count all findings.');
assert.equal(report.summary.blockers, 3, 'Report should count blockers.');
assert.equal(report.summary.allowedLabeledFallbacks, 2, 'Report should count allowed labeled fallbacks.');

assert.equal(
  packageJson.scripts?.['test:silent-error-governance'],
  'node ./scripts/silent-error-governance-smoke.mjs',
  'package.json must expose the silent error governance smoke.'
);
assert(
  packageJson.scripts?.['test:production-hardening']?.includes('test:silent-error-governance'),
  'Production hardening must include the silent error governance gate.'
);

console.log('silent-error-governance-smoke: ok');
