import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProductionGapLabelsReport } from './production-gap-labels.mjs';
import {
  buildPrimaryPathReliabilityReport,
  PRIMARY_PATH_RELIABILITY_REVISION,
} from './primary-path-reliability.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const gapReport = buildProductionGapLabelsReport({
  checkedAt: '2026-06-14T00:00:00.000Z',
  sourceLabels: [
    {
      id: 'campaigns',
      label: 'Campaigns',
      endpoint: 'GET /api/campaigns',
      status: 'live',
      readiness: 'ready',
      dataState: 'empty',
      recordCount: 0,
    },
    {
      id: 'runtime',
      label: 'Runtime snapshot',
      endpoint: 'GET /state',
      status: 'fallback',
      readiness: 'degraded',
      dataState: 'stale',
      fallbackReason: 'Postgres unavailable',
    },
  ],
  releaseStatus: {
    components: [{ id: 'state-backend', label: 'State backend', ready: true }],
  },
  toolingStatus: {
    agentReach: {
      ready: false,
      optional: true,
      configured: true,
      status: 'not_installed',
      error: 'spawnSync agent-reach ENOENT',
    },
  },
  runtimeMeta: {
    providers: {
      telnyx: { label: 'Telnyx phone/SMS', ready: true, status: 'up' },
      batchdata: {
        label: 'BatchData skip trace',
        ready: false,
        configured: false,
        optional: false,
        missing: ['PBK_BATCHDATA_API_KEY'],
        status: 'missing',
      },
    },
  },
});

const report = buildPrimaryPathReliabilityReport({
  gapReport,
  runtimeMeta: {
    providers: {
      telnyx: { label: 'Telnyx phone/SMS', ready: true, status: 'up' },
      batchdata: {
        label: 'BatchData skip trace',
        ready: false,
        configured: false,
        optional: false,
        missing: ['PBK_BATCHDATA_API_KEY'],
        status: 'missing',
      },
    },
  },
  checkedAt: '2026-06-14T00:00:00.000Z',
});

assert.equal(report.ok, true, 'Primary path report should be generated.');
assert.equal(report.revision, PRIMARY_PATH_RELIABILITY_REVISION, 'Report exposes revision.');
assert.equal(report.result, 'primary_path_gated', 'Blocking gaps must gate primary attempts.');
assert.equal(report.summary.primaryAllowed, false, 'Required blockers should prevent primary attempt.');
assert(report.summary.blocking >= 1, 'Report should count blocking controls.');
assert(report.summary.disabledOptional >= 1, 'Optional missing tooling should be disabled explicitly.');
assert(report.summary.retryBeforeFallback >= 0, 'Report should expose retry-before-fallback count.');
assert(report.summary.timeoutEventsRequired >= 1, 'Required paths must require timeout events.');

const batchControl = report.controls.find((control) => control.id === 'primary-provider-batchdata');
assert(batchControl, 'Required missing provider should be represented as a primary control.');
assert.equal(batchControl.primaryAttempt, 'blocked_until_ready');
assert.equal(batchControl.retryBeforeFallback, 0, 'Blocked providers should not burn retry budget.');
assert.equal(batchControl.fallbackPolicy, 'no_fallback_hide_blocker');

const runtimeControl = report.controls.find((control) => control.id === 'primary-source-runtime');
assert(runtimeControl, 'Fallback runtime source should be represented as a primary control.');
assert.equal(runtimeControl.primaryAttempt, 'blocked_until_ready');

const campaignControl = report.controls.find((control) => control.id === 'primary-source-campaigns');
assert(campaignControl, 'Live empty campaign source should be represented.');
assert.equal(campaignControl.primaryAttempt, 'disabled_optional');
assert.equal(campaignControl.optional, true, 'Live empty data stays labeled as optional.');

const telnyxPolicy = report.providerRetryPolicies.find((policy) => policy.id === 'telnyx');
assert(telnyxPolicy, 'Ready providers should expose retry policy.');
assert.equal(telnyxPolicy.allowPrimaryAttempt, true);
assert.equal(telnyxPolicy.retryBeforeFallback, 1);
assert.equal(telnyxPolicy.timeoutEventRequired, true);

const bridge = readFileSync(path.join(ROOT, 'scripts', 'openclaw-local-server.mjs'), 'utf8');
const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile.openclaw'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const commandCenter = readFileSync(path.join(ROOT, 'src', 'app', 'routes', 'CommandCenter.tsx'), 'utf8');
const runtimeBridge = readFileSync(path.join(ROOT, 'src', 'app', 'utils', 'runtimeBridge.ts'), 'utf8');

assert(
  /buildPrimaryPathReliabilityReport/.test(bridge) &&
    /\/api\/production\/primary-path/.test(bridge),
  'Bridge must expose the primary path reliability report.'
);
assert(
  dockerfile.includes('COPY scripts/primary-path-reliability.mjs'),
  'OpenClaw Docker image must include the primary path reliability module.'
);
assert.equal(
  packageJson.scripts?.['test:primary-path-reliability'],
  'node ./scripts/primary-path-reliability-smoke.mjs',
  'package.json must expose the primary path reliability smoke.'
);
assert(
  packageJson.scripts?.['test:production-hardening']?.includes('test:primary-path-reliability'),
  'Production hardening must include the primary path reliability smoke.'
);
assert(
  /primaryPath/.test(commandCenter) && /Primary path/.test(commandCenter),
  'Command Center must render primary path reliability from production gaps.'
);
assert(
  /PrimaryPathReliabilityReport/.test(runtimeBridge),
  'Runtime bridge must type the primary path reliability report.'
);

console.log('primary-path-reliability-smoke: ok');

