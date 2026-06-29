const PROVIDER_PROOF_REQUIREMENTS = {
  sms: ['PBK_LIVE_PROOF_SMS_TO', 'PBK_TELNYX_FROM_NUMBER'],
  email: ['PBK_LIVE_PROOF_EMAIL_TO', 'PBK_INSTANTLY_DEFAULT_FROM_EMAIL'],
  docusign: ['PBK_LIVE_PROOF_EMAIL_TO', 'PBK_DOCUSIGN_ACCOUNT_ID'],
  slack: ['PBK_SLACK_APPROVAL_CHANNEL_ID'],
};

const DEFAULT_BRIDGE_URL = 'https://pbk-openclaw-bridge.onrender.com';
const LIVE_CONFIRM_VALUE = 'send';

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase();
}

function hasEnvValue(env, key) {
  return String(env?.[key] || '').trim().length > 0;
}

function clean(value) {
  return String(value || '').trim();
}

function cleanBridgeUrl(env = process.env) {
  return clean(
    env.PBK_LIVE_PROOF_BRIDGE_URL ||
      env.PBK_HOSTED_BRIDGE_URL ||
      env.PBK_BRIDGE_URL ||
      env.PBK_PUBLIC_BASE_URL ||
      DEFAULT_BRIDGE_URL
  ).replace(/\/+$/, '');
}

function jsonHeaders(env = process.env, extra = {}) {
  const apiKey = clean(env.PBK_BRIDGE_API_KEY);
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...extra,
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function postBridgeJson(path, body, { env = process.env, fetchImpl = fetch } = {}) {
  const bridgeUrl = cleanBridgeUrl(env);
  const response = await fetchImpl(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: jsonHeaders(env, {
      'Idempotency-Key': clean(body?.idempotencyKey || body?.idempotency_key),
    }),
    body: JSON.stringify(body || {}),
  });
  const payload = await readJsonResponse(response);
  return {
    ok: response.ok && payload?.ok !== false,
    status: response.status,
    payload,
    bridgeUrl,
  };
}

async function getBridgeJson(path, { env = process.env, fetchImpl = fetch } = {}) {
  const bridgeUrl = cleanBridgeUrl(env);
  const response = await fetchImpl(`${bridgeUrl}${path}`, {
    method: 'GET',
    headers: jsonHeaders(env),
  });
  const payload = await readJsonResponse(response);
  return {
    ok: response.ok && payload?.ok !== false,
    status: response.status,
    payload,
    bridgeUrl,
  };
}

function isKnownProvider(provider) {
  return Object.hasOwn(PROVIDER_PROOF_REQUIREMENTS, normalizeProvider(provider));
}

export function getProviderProofRequirements(provider) {
  const normalizedProvider = normalizeProvider(provider);
  return [...(PROVIDER_PROOF_REQUIREMENTS[normalizedProvider] || [])];
}

export function getProviderLiveProofRequirements(provider) {
  const requirements = getProviderProofRequirements(provider);
  return requirements.length
    ? [...requirements, 'PBK_BRIDGE_API_KEY', 'PBK_LIVE_PROOF_CONFIRM']
    : [];
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

  const baseRequired = PROVIDER_PROOF_REQUIREMENTS[normalizedProvider] || [];
  const required = getProviderProofRequirements(provider);
  const missing = baseRequired.filter((key) => !hasEnvValue(env, key));

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

export function assertLiveProofCanSend({ provider, env = process.env } = {}) {
  const safety = assertLiveProofSafe({ provider, env });
  if (!safety.ok) return safety;

  const missing = [];
  if (!hasEnvValue(env, 'PBK_BRIDGE_API_KEY')) missing.push('PBK_BRIDGE_API_KEY');
  if (clean(env.PBK_LIVE_PROOF_CONFIRM).toLowerCase() !== LIVE_CONFIRM_VALUE) {
    missing.push('PBK_LIVE_PROOF_CONFIRM=send');
  }

  if (missing.length > 0) {
    return {
      ...safety,
      ok: false,
      required: getProviderLiveProofRequirements(provider),
      missing,
      proofStatus: 'confirmation_required',
    };
  }

  return {
    ...safety,
    required: getProviderLiveProofRequirements(provider),
  };
}

function proofId(provider, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `pbk-live-proof-${provider}-${stamp}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envNumber(env = process.env, key = '', fallback = 0) {
  const value = Number(env?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function findDocuSignProofContract(contracts = [], proofKey = '') {
  const key = clean(proofKey);
  return contracts.find((contract) => contractMatchesDocuSignProof(contract, key)) || null;
}

function contractMatchesDocuSignProof(contract = {}, proofKey = '') {
  const key = clean(proofKey);
  if (!key) return false;
  const strictCandidates = [
    contract.idempotencyKey,
    contract.idempotency_key,
    contract.docusignJobId,
    contract.documentTitle,
    contract.emailSubject,
  ].map(clean);
  if (strictCandidates.some(Boolean)) {
    return strictCandidates.some((candidate) => candidate === key || candidate.includes(key));
  }
  const fallbackCandidates = [
    contract.id,
    contract.contractId,
  ].map(clean);
  return fallbackCandidates.some((candidate) => candidate === key || candidate.includes(key));
}

async function pollDocuSignProofContract({ env, fetchImpl, id, sentEnvelope, contractId }) {
  const timeoutMs = envNumber(env, 'PBK_LIVE_PROOF_DOCUSIGN_POLL_MS', 90000);
  const intervalMs = envNumber(env, 'PBK_LIVE_PROOF_DOCUSIGN_POLL_INTERVAL_MS', 3000);
  const deadline = Date.now() + timeoutMs;
  let lastResult = null;
  while (Date.now() <= deadline) {
    const exactPath = clean(contractId) ? `/api/contracts/${encodeURIComponent(clean(contractId))}` : '';
    const result = exactPath
      ? await getBridgeJson(exactPath, { env, fetchImpl })
      : await getBridgeJson('/api/contracts?limit=500', { env, fetchImpl });
    lastResult = result;
    const contract = exactPath && result.payload?.contract
      ? result.payload.contract
      : findDocuSignProofContract(Array.isArray(result.payload?.contracts) ? result.payload.contracts : [], id);
    if (contract) {
      if (!contractMatchesDocuSignProof(contract, id)) {
        return {
          ok: false,
          proofStatus: 'stale_contract_receipt',
          status: 'stale_contract_receipt',
          error: 'DocuSign proof contract did not match the current proof idempotency key.',
          contract,
        };
      }
      const status = clean(contract.status).toLowerCase();
      const envelopeId = clean(contract.envelopeId || contract.envelope_id);
      const jobStatus = clean(contract.docusignJob?.status).toLowerCase();
      const providerConfirmed = jobStatus === 'completed' || Boolean(clean(contract.providerProofCompletedAt));
      if (status === 'provider-error') {
        return {
          ok: false,
          proofStatus: 'provider_error',
          status: 'provider_error',
          error: contract.providerError || contract.docusignJob?.error || 'DocuSign provider returned an error.',
          contract,
        };
      }
      if (envelopeId && (providerConfirmed || !contract.docusignAsync) && (sentEnvelope || status === 'draft' || status === 'created')) {
        return {
          ok: true,
          proofStatus: sentEnvelope ? 'provider_confirmed' : 'draft_envelope_created',
          status: sentEnvelope ? 'provider_confirmed' : 'draft_envelope_created',
          providerAttemptId: envelopeId,
          contract,
        };
      }
    }
    await sleep(intervalMs);
  }
  return {
    ok: false,
    proofStatus: 'provider_confirmation_timeout',
    status: 'provider_confirmation_timeout',
    error: `DocuSign did not confirm a provider envelope before ${timeoutMs}ms.`,
    bridgeResult: lastResult
      ? {
          ok: lastResult.ok,
          status: lastResult.status,
          result: lastResult.payload?.result || lastResult.payload?.status || '',
        }
      : null,
  };
}

function summarizeBridgeProof(provider, bridgeResult, extra = {}) {
  const payload = bridgeResult.payload || {};
  const ok = bridgeResult.ok;
  const providerAttemptId =
    clean(payload.outbox?.idempotencyKey) ||
    clean(payload.idempotencyKey) ||
    clean(payload.contract?.envelopeId) ||
    clean(payload.envelope?.envelopeId) ||
    clean(payload.approval?.slackMessage?.ts) ||
    clean(payload.approval?.id) ||
    clean(extra.providerAttemptId);

  return {
    ok,
    provider,
    dryRun: false,
    proofStatus: ok ? 'sent_waiting_for_receipt' : 'failed',
    status: ok ? 'sent_waiting_for_receipt' : 'failed',
    httpStatus: bridgeResult.status,
    providerAttemptId,
    bridgeResult: {
      ok: bridgeResult.ok,
      status: bridgeResult.status,
      result: payload.result || payload.status || '',
      verbiage: payload.verbiage || payload.error || '',
    },
    ...extra,
  };
}

async function runSmsLiveProof({ env, fetchImpl, now }) {
  const id = proofId('sms', now);
  const result = await postBridgeJson(
    '/api/messages',
    {
      channel: 'sms',
      phone: clean(env.PBK_LIVE_PROOF_SMS_TO),
      leadName: 'PBK Live Proof Canary',
      address: 'PBK controlled proof lane',
      message: `PBK live proof SMS ${id}. No action needed.`,
      requestedBy: 'PBK live proof harness',
      source: 'provider_live_proof',
      manual: true,
      manualSend: true,
      idempotencyKey: id,
    },
    { env, fetchImpl }
  );
  return summarizeBridgeProof('sms', result, {
    idempotencyKey: id,
    canary: 'PBK_LIVE_PROOF_SMS_TO',
  });
}

async function runEmailLiveProof({ env, fetchImpl, now }) {
  const id = proofId('email', now);
  const result = await postBridgeJson(
    '/api/messages',
    {
      channel: 'email',
      email: clean(env.PBK_LIVE_PROOF_EMAIL_TO),
      leadName: 'PBK Live Proof Canary',
      address: 'PBK controlled proof lane',
      subject: `PBK live proof email ${id}`,
      message: `Subject: PBK live proof email ${id}\n\nThis is a controlled PBK provider proof email. No action needed.`,
      requestedBy: 'PBK live proof harness',
      source: 'provider_live_proof',
      manual: true,
      manualSend: true,
      idempotencyKey: id,
    },
    { env, fetchImpl }
  );
  return summarizeBridgeProof('email', result, {
    idempotencyKey: id,
    canary: 'PBK_LIVE_PROOF_EMAIL_TO',
  });
}

async function runDocuSignLiveProof({ env, fetchImpl, now }) {
  const id = proofId('docusign', now);
  const contractId = `contract-${id}`;
  const sendEnvelope = clean(env.PBK_LIVE_PROOF_DOCUSIGN_SEND).toLowerCase() === 'true';
  const result = await postBridgeJson(
    '/api/contracts',
    {
      id: contractId,
      leadName: 'PBK Live Proof Canary',
      address: 'PBK controlled proof lane',
      email: clean(env.PBK_LIVE_PROOF_EMAIL_TO),
      amount: 1,
      offerPrice: 1,
      mao: 1,
      selectedPath: 'cash',
      selectedPathLabel: 'Controlled PBK live proof contract',
      contractType: 'provider-proof',
      documentTitle: `PBK live proof contract ${id}`,
      emailSubject: `PBK live proof DocuSign ${id}`,
      qualificationVerified: true,
      bantComplete: true,
      requestedBy: 'PBK live proof harness',
      source: 'provider_live_proof',
      manual: true,
      manualSend: true,
      idempotencyKey: id,
      dryRun: !sendEnvelope,
      status: sendEnvelope ? 'sent' : 'draft',
    },
    { env, fetchImpl }
  );
  const proof = summarizeBridgeProof('docusign', result, {
    idempotencyKey: id,
    canary: 'PBK_LIVE_PROOF_EMAIL_TO',
    sentEnvelope: sendEnvelope,
  });
  if (proof.ok && !proof.sentEnvelope) {
    proof.proofStatus = 'draft_envelope_created';
    proof.status = 'draft_envelope_created';
  }
  if (
    proof.ok &&
    (result.status === 202 || result.payload?.queued || result.payload?.accepted || result.payload?.result === 'docusign_queued')
  ) {
    const polled = await pollDocuSignProofContract({
      env,
      fetchImpl,
      id,
      sentEnvelope: sendEnvelope,
      contractId: result.payload?.contract?.id || contractId,
    });
    return {
      ...proof,
      ...polled,
      queued: true,
      jobId: result.payload?.jobId || result.payload?.contract?.docusignJobId || '',
      initialBridgeResult: proof.bridgeResult,
      bridgeResult: polled.bridgeResult || proof.bridgeResult,
      contract: polled.contract || result.payload?.contract || null,
      providerAttemptId: polled.providerAttemptId || proof.providerAttemptId,
    };
  }
  if (proof.ok && (!result.payload?.docusign?.live || !clean(result.payload?.envelope?.envelopeId))) {
    proof.ok = false;
    proof.proofStatus = 'provider_confirmation_missing';
    proof.status = 'provider_confirmation_missing';
    proof.error = result.payload?.docusign?.error || 'DocuSign did not return a provider envelope id.';
  }
  return proof;
}

async function runSlackLiveProof({ env, fetchImpl, now }) {
  const id = proofId('slack', now);
  const create = await postBridgeJson(
    '/api/approvals',
    {
      id,
      type: 'provider-live-proof',
      risk: 'low',
      leadName: 'PBK Live Proof Canary',
      address: 'PBK controlled proof lane',
      reason: 'Controlled Slack approval unison proof.',
      proposal: 'Approve this canary item to verify approval clearing.',
      requestedBy: 'PBK live proof harness',
      source: 'provider_live_proof',
    },
    { env, fetchImpl }
  );
  if (!create.ok) {
    return summarizeBridgeProof('slack', create, {
      idempotencyKey: id,
      canary: 'PBK_SLACK_APPROVAL_CHANNEL_ID',
      stage: 'create_approval',
    });
  }

  const decision = await postBridgeJson(
    `/api/approvals/${encodeURIComponent(id)}/approve`,
    {
      actor: 'PBK live proof harness',
      notes: 'Controlled canary approval proof.',
    },
    { env, fetchImpl }
  );
  const pending = await getBridgeJson('/api/approvals?status=pending&limit=200', {
    env,
    fetchImpl,
  });
  const pendingApprovals = Array.isArray(pending.payload?.approvals)
    ? pending.payload.approvals
    : [];
  const stillPending = pendingApprovals.some((approval) => approval?.id === id);
  const proof = summarizeBridgeProof('slack', decision, {
    idempotencyKey: id,
    providerAttemptId: create.payload?.approval?.slackMessage?.ts || id,
    canary: 'PBK_SLACK_APPROVAL_CHANNEL_ID',
    stage: 'approve_and_reconcile',
    posted: create.ok,
    clearedFromPending: pending.ok && !stillPending,
  });
  if (proof.ok && !proof.clearedFromPending) {
    proof.ok = false;
    proof.proofStatus = 'reconciliation_required';
    proof.status = 'reconciliation_required';
  }
  return proof;
}

const LIVE_PROOF_ADAPTERS = {
  sms: runSmsLiveProof,
  email: runEmailLiveProof,
  docusign: runDocuSignLiveProof,
  slack: runSlackLiveProof,
};

export async function runProviderLiveProof({
  provider,
  dryRun = true,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const safety = dryRun
    ? assertLiveProofSafe({ provider, env })
    : assertLiveProofCanSend({ provider, env });
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

  const adapter = LIVE_PROOF_ADAPTERS[safety.provider];
  if (!adapter) {
    return {
      ...safety,
      ok: false,
      dryRun: false,
      proofStatus: 'not_implemented',
      status: 'not_implemented',
      error: 'Live provider proof adapter is not available.',
    };
  }

  return adapter({ env, fetchImpl, now });
}
