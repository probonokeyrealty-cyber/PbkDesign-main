#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { runProviderLiveProof } from './provider-live-proof-harness.mjs';

const DEFAULT_PROVIDERS = ['sms', 'email', 'slack', 'docusign'];
const HYDRATE_KEYS = [
  'PBK_BRIDGE_API_KEY',
  'PBK_HOSTED_BRIDGE_URL',
  'PBK_BRIDGE_URL',
  'PBK_PUBLIC_BASE_URL',
  'PBK_LIVE_PROOF_BRIDGE_URL',
  'PBK_LIVE_PROOF_CONFIRM',
  'PBK_LIVE_PROOF_SMS_TO',
  'PBK_LIVE_PROOF_EMAIL_TO',
  'PBK_LIVE_PROOF_DOCUSIGN_SEND',
  'PBK_TELNYX_FROM_NUMBER',
  'PBK_INSTANTLY_DEFAULT_FROM_EMAIL',
  'PBK_DOCUSIGN_ACCOUNT_ID',
  'PBK_SLACK_APPROVAL_CHANNEL_ID',
];

function readWindowsStoredEnv(key) {
  if (process.platform !== 'win32' || !key) return '';
  const escapedKey = key.replace(/'/g, "''");
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$v=[Environment]::GetEnvironmentVariable('${escapedKey}','User'); if(-not $v){$v=[Environment]::GetEnvironmentVariable('${escapedKey}','Machine')}; [Console]::Out.Write($v)`,
    ],
    { encoding: 'utf8', timeout: 5000, windowsHide: true }
  );
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function buildHydratedEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of HYDRATE_KEYS) {
    if (!String(env[key] || '').trim()) {
      const value = readWindowsStoredEnv(key);
      if (value) env[key] = value;
    }
  }
  return env;
}

function parseArgs(argv = process.argv.slice(2)) {
  const providers = [];
  let dryRun = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--live') {
      dryRun = false;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--provider' || arg === '-p') {
      const value = argv[index + 1] || '';
      index += 1;
      providers.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
      continue;
    }
    if (arg.startsWith('--provider=')) {
      providers.push(
        ...arg
          .slice('--provider='.length)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      );
    }
  }
  return {
    dryRun,
    providers: providers.length ? providers : DEFAULT_PROVIDERS,
  };
}

function publicResult(result = {}) {
  return {
    ok: result.ok === true,
    provider: result.provider,
    dryRun: result.dryRun,
    proofStatus: result.proofStatus || result.status || '',
    status: result.status || result.proofStatus || '',
    httpStatus: result.httpStatus,
    missing: result.missing || [],
    required: result.required || [],
    providerAttemptId: result.providerAttemptId ? '[present]' : '',
    canary: result.canary || '',
    posted: result.posted,
    clearedFromPending: result.clearedFromPending,
    sentEnvelope: result.sentEnvelope,
    bridgeResult: result.bridgeResult
      ? {
          ok: result.bridgeResult.ok,
          status: result.bridgeResult.status,
          result: result.bridgeResult.result,
          verbiage: result.bridgeResult.verbiage,
        }
      : undefined,
  };
}

const args = parseArgs();
const env = buildHydratedEnv();
const results = [];

for (const provider of args.providers) {
  const result = await runProviderLiveProof({
    provider,
    dryRun: args.dryRun,
    env,
  });
  results.push(publicResult(result));
}

const ok = results.every((result) => result.ok);
console.log(
  JSON.stringify(
    {
      ok,
      result: args.dryRun ? 'provider_live_proof_dry_run_complete' : 'provider_live_proof_live_complete',
      dryRun: args.dryRun,
      providers: results,
    },
    null,
    2
  )
);

if (!ok) process.exitCode = 1;
