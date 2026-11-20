import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSilentErrorGovernanceReport,
  classifySilentErrorFinding,
  SILENT_ERROR_GOVERNANCE_REVISION,
} from './silent-error-governance.mjs';

const policyFindings = [
  {
    area: 'supabase',
    code: 'rls_disabled_public_dml',
    severity: 'critical',
    surfaced: false,
    launchCritical: true,
  },
  {
    area: 'provider',
    code: 'provider_delivery_unknown',
    severity: 'high',
    surfaced: true,
    reconciliationRequired: true,
    timelineProjected: false,
  },
  {
    area: 'pdf',
    code: 'simple_pdf_renderer_fallback',
    severity: 'medium',
    surfaced: true,
    fallbackLabeled: true,
    retryAvailable: true,
    owner: 'documents',
  },
  {
    area: 'runtime',
    code: 'state_stale',
    severity: 'high',
    surfaced: true,
    stalePercent: 34,
    fallbackLabeled: true,
  },
  {
    area: 'youtube',
    code: 'captions_disabled',
    severity: 'medium',
    surfaced: true,
    fallbackLabeled: true,
    manualFallbackAvailable: true,
  },
];

function testSecurityExposure() {
  const securityExposure = classifySilentErrorFinding(policyFindings[0]);
  assert.equal(securityExposure.launchBlocker, true, 'Critical public database exposure must block launch.');
  assert(securityExposure.requiredEvidence.includes('owner'), 'Critical findings must require an owner.');
  assert(securityExposure.requiredEvidence.includes('remediation'), 'Critical findings must require remediation evidence.');
}

function testProviderUnknown() {
  const providerUnknown = classifySilentErrorFinding(policyFindings[1]);
  assert.equal(providerUnknown.launchBlocker, true, 'Unknown provider delivery must block until projected/reconciled.');
  assert(providerUnknown.requiredEvidence.includes('timeline_projection'), 'Provider ambiguity must require timeline projection.');
  assert(providerUnknown.requiredEvidence.includes('reconciliation'), 'Provider ambiguity must require reconciliation evidence.');
}

function testLabeledPdfFallback() {
  const labeledPdfFallback = classifySilentErrorFinding(policyFindings[2]);
  assert.equal(labeledPdfFallback.launchBlocker, false, 'Labeled recoverable PDF fallback should not block launch.');
  assert.equal(labeledPdfFallback.policy, 'allowed_labeled_fallback', 'Recoverable labeled fallback should remain allowed.');
}

function testStaleRuntime() {
  const staleRuntime = classifySilentErrorFinding(policyFindings[3]);
  assert.equal(staleRuntime.launchBlocker, true, 'High-staleness runtime truth must block high-stakes launch.');
  assert(staleRuntime.requiredEvidence.includes('freshness_slo'), 'Stale runtime truth must require freshness SLO evidence.');
}

function testGovernanceReport() {
  const report = buildSilentErrorGovernanceReport({
    findings: [
      ...policyFindings.slice(0, 4).map((finding) => classifySilentErrorFinding(finding)),
      policyFindings[4],
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
}

function testPolicyReleaseGate() {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.scripts?.['test:silent-error-governance'],
    'node ./scripts/silent-error-governance-smoke.mjs',
    'package.json must expose the silent error governance smoke.'
  );
  assert(
    packageJson.scripts?.['test:production-hardening']?.includes('test:silent-error-governance'),
    'Production hardening must include the silent error governance gate.'
  );
}

const policyChecks = [
  ['critical_public_database_exposure', testSecurityExposure],
  ['provider_delivery_unknown', testProviderUnknown],
  ['labeled_pdf_fallback', testLabeledPdfFallback],
  ['stale_runtime_truth', testStaleRuntime],
  ['governance_report_blockers', testGovernanceReport],
  ['silent_error_policy_release_gate', testPolicyReleaseGate],
];

export const SILENT_ERROR_POLICY_CASE_IDS = Object.freeze(policyChecks.map(([id]) => id));

export function runSilentErrorPolicyQualification() {
  const results = policyChecks.map(([id, check]) => {
    try {
      check();
      return { id, executed: true, passed: true, reason: 'Controlled policy assertions passed; not an operational audit.' };
    } catch {
      return { id, executed: true, passed: false, reason: `${id}: controlled policy check failed; not an operational audit.` };
    }
  });
  const passed = results.filter((row) => row.passed).length;
  return {
    ok: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    scope: 'controlled_policy_regression',
    operationalEvidence: false,
    reason: 'Controlled policy regression only; not evidence of operational absence of errors.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runSilentErrorPolicyQualification();
  if (report.ok) console.log('silent-error-governance-smoke: ok');
  else {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
}
