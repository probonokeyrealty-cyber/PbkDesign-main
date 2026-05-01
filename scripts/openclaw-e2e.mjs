import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const PORT = Number(process.env.PBK_E2E_PORT || 19789);
const API_KEY = String(process.env.PBK_E2E_API_KEY || process.env.PBK_BRIDGE_API_KEY || 'pbk-e2e-test-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function authHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
  };
}

async function request(pathname, options = {}) {
  return fetch(`${BASE_URL}${pathname}`, options);
}

async function requestJson(pathname, options = {}) {
  const response = await request(pathname, options);
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, parsed };
}

async function waitForHealth(timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await request('/health');
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }

  throw lastError || new Error('Timed out waiting for bridge health.');
}

async function main() {
  const child = spawn(process.execPath, [SERVER_ENTRY, '--reset'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PBK_OPENCLAW_PORT: String(PORT),
      PBK_BRIDGE_API_KEY: API_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  const cleanup = async () => {
    if (!child.killed) {
      child.kill();
      await delay(150);
    }
  };

  try {
    const health = await waitForHealth();
    assert(health?.ok === true, 'Bridge health did not report ok: true.');

    const leadId = 'e2e-lead-1';
    const leadName = 'E2E Seller';
    const address = '111 E2E Loop Ave, Columbus OH';
    const email = 'e2e-seller@example.com';
    const phone = '+16145550111';
    const noviceTranscript = 'Hi, I have never done this before. Can you explain how this works? Tomorrow at 5pm works for me.';

    const leadIntake = await requestJson('/events', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventType: 'lead-intake',
        payload: {
          eventId: 'e2e-lead-event-1',
          leadId,
          source: 'e2e-test',
          seller: {
            name: leadName,
            phone,
            email,
          },
          property: {
            address,
            city: 'Columbus',
            state: 'OH',
          },
          tags: ['probate', 'e2e'],
        },
      }),
    });
    assert(leadIntake.response.ok && leadIntake.parsed?.ok === true, 'Lead intake failed.');

    const coldEmail = await requestJson('/api/cold-email/send', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        leadId,
        leadName,
        address,
        email,
        templateId: 'probate',
      }),
    });
    const coldEmailOutcome = coldEmail.parsed?.result || coldEmail.parsed?.delivery?.result || '';
    const coldEmailIsLive = coldEmail.response.ok && coldEmail.parsed?.ok === true && coldEmail.parsed?.delivery?.ok === true;
    assert(coldEmailIsLive || coldEmailOutcome === 'provider_missing', 'Cold email send neither delivered nor reported provider_missing.');

    const classification = await requestJson('/api/participants/classify', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        leadId,
        leadName,
        address,
        email,
        transcriptStart: noviceTranscript,
      }),
    });
    assert(classification.response.ok && classification.parsed?.ok === true, 'Participant classification failed.');
    assert(classification.parsed?.role === 'seller', `Expected seller role, got ${classification.parsed?.role || 'missing'}.`);
    assert(classification.parsed?.expertise === 'novice', `Expected novice expertise, got ${classification.parsed?.expertise || 'missing'}.`);

    const participantProfile = await requestJson(`/api/participants/profile?leadId=${encodeURIComponent(leadId)}`, {
      headers: authHeaders(),
    });
    assert(participantProfile.response.ok && participantProfile.parsed?.ok === true, 'Participant profile lookup failed.');
    assert(participantProfile.parsed?.profile?.role === 'seller', 'Persisted participant role was not seller.');
    assert(participantProfile.parsed?.profile?.expertise === 'novice', 'Persisted participant expertise was not novice.');

    const replyTemplates = await requestJson(
      `/api/replies/templates?leadId=${encodeURIComponent(leadId)}&leadName=${encodeURIComponent(leadName)}&address=${encodeURIComponent(address)}&email=${encodeURIComponent(email)}&body=${encodeURIComponent(noviceTranscript)}&channel=email`,
      { headers: authHeaders() },
    );
    assert(replyTemplates.response.ok && replyTemplates.parsed?.ok === true, 'Reply template preview failed.');
    assert(Array.isArray(replyTemplates.parsed?.templates) || replyTemplates.parsed?.templates, 'Reply templates were not returned.');

    const handledReply = await requestJson('/api/replies/handle', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        leadId,
        leadName,
        address,
        email,
        phone,
        body: noviceTranscript,
        channel: 'email',
        provider: 'e2e-reply',
      }),
    });
    assert(handledReply.response.ok && handledReply.parsed?.ok === true, 'Reply handling failed.');
    assert(['booked', 'booking-requested', 'warm'].includes(String(handledReply.parsed?.leadStage || '')), 'Reply handling did not move the lead into a warm/booking stage.');
    assert(handledReply.parsed?.appointment?.id, 'Reply handling did not create an appointment record.');
    assert(handledReply.parsed?.participantProfile?.expertise === 'novice', 'Reply handling did not keep the participant profile.');

    const transitions = await requestJson(`/api/lead-transitions?leadId=${encodeURIComponent(leadId)}`, {
      headers: authHeaders(),
    });
    assert(transitions.response.ok && transitions.parsed?.ok === true, 'Lead transition lookup failed.');
    assert(Array.isArray(transitions.parsed?.transitions) && transitions.parsed.transitions.length > 0, 'No lead transitions were recorded.');

    const call = await requestJson('/api/calls', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        leadId,
        leadName,
        address,
        email,
        phone,
        notes: 'Scheduled acquisition follow-up after reply handling.',
      }),
    });
    assert(call.response.ok && call.parsed?.ok === true, 'Call routing failed.');
    assert(call.parsed?.callStrategy?.script === 'novice-guided-walkthrough', `Expected novice-guided-walkthrough script, got ${call.parsed?.callStrategy?.script || 'missing'}.`);

    const lawyerReview = await requestJson('/api/contracts/lawyer-review', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        leadId,
        leadName,
        address,
        email,
        amount: 78000,
        templateId: 'standard-purchase',
        selectedPath: 'standard-purchase',
        selectedPathLabel: 'Cash Offer',
        reviewerEmail: 'underwriting@example.com',
        reviewerName: 'PBK Underwriting Supervisor',
      }),
    });
    assert(lawyerReview.response.ok && lawyerReview.parsed?.ok === true, 'Contract lawyer review failed.');
    assert(lawyerReview.parsed?.template?.id === 'standard-purchase', 'Contract lawyer review did not pick the standard purchase template.');
    assert(lawyerReview.parsed?.approval?.id, 'Contract lawyer review did not queue an approval.');
    assert(lawyerReview.parsed?.contract?.underwritingStatus === 'approval-requested', 'Contract underwriting status did not move to approval-requested.');

    const contractApprovalId = lawyerReview.parsed.approval.id;
    const approvalActedAt = '2026-04-29T18:00:00.000Z';
    const contractApproval = await requestJson(`/api/approvals/${encodeURIComponent(contractApprovalId)}`, {
      method: 'PUT',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'approved',
        actor: 'e2e-test',
        actedAt: approvalActedAt,
      }),
    });
    assert(contractApproval.response.ok && contractApproval.parsed?.ok === true, 'Contract approval callback failed.');
    assert(contractApproval.parsed?.contractResult, 'Approved contract did not reach the DocuSign handoff path.');
    assert(
      contractApproval.parsed?.contractResult?.ok === true
      || Boolean(contractApproval.parsed?.contractResult?.docusign?.error),
      'Approved contract did not produce a DocuSign result or a provider error.',
    );

    const replayedApproval = await requestJson(`/api/approvals/${encodeURIComponent(contractApprovalId)}`, {
      method: 'PUT',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'approved',
        actor: 'e2e-test',
        actedAt: approvalActedAt,
      }),
    });
    assert(replayedApproval.response.ok && replayedApproval.parsed?.replayed === true, 'Identical contract approval was not treated as a replay.');

    const contractId = lawyerReview.parsed.contract.id;
    const docusignCallback = await requestJson('/api/docusign/callback', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: contractId,
        status: 'completed',
        actor: 'DocuSign',
        leadName,
        address,
        amount: 78000,
      }),
    });
    assert(docusignCallback.response.ok && docusignCallback.parsed?.ok === true, 'DocuSign callback failed.');

    const contracts = await requestJson('/api/contracts', {
      headers: authHeaders(),
    });
    assert(contracts.response.ok && contracts.parsed?.ok === true, 'Contract list lookup failed.');
    const finalContract = Array.isArray(contracts.parsed?.contracts)
      ? contracts.parsed.contracts.find((item) => item.id === contractId)
      : null;
    assert(finalContract, 'Final contract record was not found.');
    assert(String(finalContract.status || '').toLowerCase() === 'completed', `Expected final contract status completed, got ${finalContract?.status || 'missing'}.`);
    assert(String(finalContract.underwritingStatus || '').toLowerCase() === 'completed', `Expected underwritingStatus completed, got ${finalContract?.underwritingStatus || 'missing'}.`);

    console.log(JSON.stringify({
      ok: true,
      revision: health.revision,
      stateBackend: health.features?.stateBackend || 'unknown',
      leadId,
      coldEmailProvider: coldEmail.parsed?.provider || 'unknown',
      coldEmailOutcome,
      coldEmailDelivered: coldEmailIsLive,
      coldEmailSimulated: Boolean(coldEmail.parsed?.delivery?.simulated),
      participantRole: participantProfile.parsed?.profile?.role || 'unknown',
      participantExpertise: participantProfile.parsed?.profile?.expertise || 'unknown',
      leadStage: handledReply.parsed?.leadStage || 'unknown',
      appointmentStatus: handledReply.parsed?.appointment?.status || 'unknown',
      callScript: call.parsed?.callStrategy?.script || 'unknown',
      contractTemplate: lawyerReview.parsed?.template?.id || 'unknown',
      underwritingApprovalId: contractApprovalId,
      docusignFlowOk: Boolean(contractApproval.parsed?.contractResult?.ok),
      docusignProviderError: contractApproval.parsed?.contractResult?.docusign?.error || '',
      contractStatus: finalContract.status,
      underwritingStatus: finalContract.underwritingStatus,
      approvalReplaySafe: Boolean(replayedApproval.parsed?.replayed),
      transitionsRecorded: Array.isArray(transitions.parsed?.transitions) ? transitions.parsed.transitions.length : 0,
    }, null, 2));
  } catch (error) {
    await cleanup();
    const message = error instanceof Error ? error.message : 'Unknown E2E failure';
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    console.error(message);
    process.exitCode = 1;
    return;
  }

  await cleanup();
}

main();
