const PROVIDER_PROOF_REQUIREMENTS = {
  sms: ['PBK_LIVE_PROOF_SMS_TO', 'PBK_TELNYX_FROM_NUMBER'],
  email: ['PBK_LIVE_PROOF_EMAIL_TO', 'PBK_INSTANTLY_DEFAULT_FROM_EMAIL'],
  docusign: ['PBK_LIVE_PROOF_EMAIL_TO', 'PBK_DOCUSIGN_ACCOUNT_ID'],
  slack: ['PBK_SLACK_APPROVAL_CHANNEL_ID'],
};

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase();
}

function hasEnvValue(env, key) {
  return String(env?.[key] || '').trim().length > 0;
}

function isKnownProvider(provider) {
  return Object.hasOwn(PROVIDER_PROOF_REQUIREMENTS, normalizeProvider(provider));
}

export function getProviderProofRequirements(provider) {
  return [...(PROVIDER_PROOF_REQUIREMENTS[normalizeProvider(provider)] || [])];
}

export function assertLiveProofSafe({ provider, env = process.env } = {}) {
  const normalizedProvider = normalizeProvider(provider);
  if (!isKnownProvider(normalizedProvider)) {
    return {
      ok: false,
      provider: normalizedProvider,
      required: [],
      missing: [],
      proofStatus: 'unknown_provider',
    };
  }

  const required = getProviderProofRequirements(provider);
  const missing = required.filter((key) => !hasEnvValue(env, key));

  if (missing.length > 0) {
    return {
      ok: false,
      provider: normalizedProvider,
      required,
      missing,
      proofStatus: 'missing_env',
    };
  }

  return {
    ok: true,
    provider: normalizedProvider,
    required,
    missing: [],
  };
}

export async function runProviderLiveProof({
  provider,
  dryRun = true,
  env = process.env,
} = {}) {
  const safety = assertLiveProofSafe({ provider, env });
  if (!safety.ok) {
    return safety;
  }

  if (dryRun) {
    return {
      ...safety,
      dryRun: true,
      proofStatus: 'dry_run_ready',
    };
  }

  return {
    ...safety,
    ok: false,
    dryRun: false,
    proofStatus: 'not_implemented',
    status: 'not_implemented',
    error: 'Live provider proof adapters have not been selected.',
  };
}
