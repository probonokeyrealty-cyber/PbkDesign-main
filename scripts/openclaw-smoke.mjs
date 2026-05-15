import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const PORT = Number(process.env.PBK_SMOKE_PORT || 18788);
const API_KEY = String(process.env.PBK_SMOKE_API_KEY || process.env.PBK_BRIDGE_API_KEY || 'pbk-smoke-test-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth(timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
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
    const unauthorizedState = await fetch(`${BASE_URL}/state`);
    const state = await fetch(`${BASE_URL}/state`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const quotas = await fetch(`${BASE_URL}/api/quotas`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const tooling = await fetch(`${BASE_URL}/api/tooling/status`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const contractTemplates = await fetch(`${BASE_URL}/api/contracts/templates`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const leadEventPayload = {
      eventType: 'lead-intake',
      payload: {
        eventId: 'smoke-lead-event-1',
        leadId: 'smoke-lead-1',
        source: 'smoke-test',
        seller: {
          name: 'Smoke Test Seller',
          phone: '+1 (614) 555-0199',
          email: 'smoke@example.com',
        },
        property: {
          address: '808 Smoke Test Ave, Columbus OH',
          city: 'Columbus',
          state: 'OH',
        },
        tags: ['smoke', 'qa'],
      },
    };
    const firstLeadEvent = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(leadEventPayload),
    }).then((response) => response.json());
    const secondLeadEvent = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(leadEventPayload),
    }).then((response) => response.json());
    const approvalId = state?.approvals?.[0]?.id;
    assert(approvalId, 'Seed state did not provide an approval to replay-test.');
    const approvalDecisionPayload = {
      eventType: 'approval-callback',
      payload: {
        id: approvalId,
        status: 'approved',
        actor: 'smoke-test',
        actedAt: '2026-04-26T18:00:00.000Z',
      },
    };
    const firstApprovalDecision = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(approvalDecisionPayload),
    }).then((response) => response.json());
    const secondApprovalDecision = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(approvalDecisionPayload),
    }).then((response) => response.json());
    const invoke = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'getBrainState',
        params: {
          query: 'What is the current bridge state?',
        },
      }),
    }).then((response) => response.json());
    const avaCommand = await fetch(`${BASE_URL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        toolName: 'runAgentCommand',
        params: {
          command: 'Ava masterclass: explain the subject-to due-on-sale guardrail in one conversational answer.',
          source: 'smoke-test',
        },
      }),
    }).then((response) => response.json());
    const brainIngest = await fetch(`${BASE_URL}/brain/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        kind: 'note',
        topic: 'Smoke Test Memory',
        title: 'Smoke Test Brain Ingest',
        source: 'bridge-smoke',
        excerpt: 'Smoke brain memory for recording and workflow endpoint coverage.',
        tags: ['smoke', 'brain'],
      }),
    }).then((response) => response.json());
    const brainQuery = await fetch(`${BASE_URL}/brain/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'Smoke Test Brain Ingest recording workflow',
      }),
    }).then((response) => response.json());
    const rexDecisions = await fetch(`${BASE_URL}/api/rex/decisions`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const rexProposal = await fetch(`${BASE_URL}/api/rex/strategist/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        requestApproval: true,
        actor: 'Rex Smoke Test',
        source: 'smoke-test',
        proposals: [{
          tool: 'update_campaign_script',
          params: { campaignId: 'smoke-campaign', change: 'Add one tactical empathy opener.' },
          rationale: 'Rex should queue strategist proposals through approval, not mutate providers directly.',
          outcomeExpected: 'Smoke test proves Rex proposal lane is alive.',
        }],
      }),
    }).then((response) => response.json());
    const agentOrchestration = await fetch(`${BASE_URL}/api/agents/orchestration`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const agentOrchestrationSmoke = await fetch(`${BASE_URL}/api/agents/orchestration/smoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
        command: 'What is the MAO on 202 Cherry Lane?',
      }),
    }).then((response) => response.json());
    const workflowSave = await fetch(`${BASE_URL}/api/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        workflow: {
          name: 'PBK Smoke Workflow',
          nodes: [],
          connections: {},
          settings: { timezone: 'America/New_York' },
          tags: ['smoke'],
        },
      }),
    }).then((response) => response.json());
    const workflows = await fetch(`${BASE_URL}/api/workflows`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    }).then((response) => response.json());
    const recordingSave = await fetch(`${BASE_URL}/api/recordings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        messageId: 'smoke-recording-msg-1',
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        storagePath: 'smoke/smoke-recording-msg-1.mp3',
        contentType: 'audio/mpeg',
        durationSeconds: 42,
      }),
    }).then((response) => response.json());
    const recordingLookupResponse = await fetch(`${BASE_URL}/api/recordings/smoke-recording-msg-1`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    const recordingLookup = await recordingLookupResponse.json();
    const sellerDocs = await fetch(`${BASE_URL}/api/send-seller-docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        email: 'smoke@example.com',
        senderProfile: 'warm',
        selectedDocuments: ['seller', 'loi'],
        documentSet: {
          seller: 'Smoke seller guide content.',
          loi: 'Smoke letter of interest content.',
        },
      }),
    }).then((response) => response.json());
    const browserResearch = await fetch(`${BASE_URL}/api/browser-research/launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query: 'Use BrowserOS to inspect https://pbkcommandcenter.netlify.app and report the page title.',
        requestedBy: 'smoke-test',
        source: 'smoke',
      }),
    }).then((response) => response.json());
    const adminRequest = await fetch(`${BASE_URL}/api/admin/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        command: 'Add pbk-smoke-domain.com to Instantly and start warmup.',
        requestedBy: 'smoke-test',
        requiresApproval: true,
      }),
    }).then((response) => response.json());
    const adminTaskId = adminRequest?.task?.id;
    assert(adminTaskId, 'Admin request did not create a task.');
    const adminApproval = await fetch(`${BASE_URL}/api/admin/tasks/${encodeURIComponent(adminTaskId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        status: 'approved',
        actor: 'smoke-test',
      }),
    }).then((response) => response.json());
    const preparedContract = await fetch(`${BASE_URL}/api/contracts/prepare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        email: 'smoke@example.com',
        amount: 91500,
        selectedPath: 'cash',
        selectedPathLabel: 'Cash Offer',
      }),
    }).then((response) => response.json());
    const canonicalDraftContract = await fetch(`${BASE_URL}/api/contracts/draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        email: 'smoke@example.com',
        amount: 91500,
        selectedPath: 'cash',
        selectedPathLabel: 'Cash Offer',
      }),
    }).then((response) => response.json());
    const canonicalAnalyzeDeal = await fetch(`${BASE_URL}/api/analyzeDeal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        address: '808 Smoke Test Ave, Columbus OH',
        condition: 'needs roof work',
        sellerFacing: false,
      }),
    }).then((response) => response.json());
    const canonicalApproveRequest = await fetch(`${BASE_URL}/api/approvals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        id: 'smoke-approval-route-approve',
        type: 'offer',
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        offerPrice: 91500,
      }),
    }).then((response) => response.json());
    const canonicalApprove = await fetch(`${BASE_URL}/api/approvals/smoke-approval-route-approve/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
        actedAt: '2026-04-26T18:05:00.000Z',
      }),
    }).then((response) => response.json());
    const canonicalDenyRequest = await fetch(`${BASE_URL}/api/approvals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        id: 'smoke-approval-route-deny',
        type: 'offer',
        leadId: 'smoke-lead-1',
        leadName: 'Smoke Test Seller',
        address: '808 Smoke Test Ave, Columbus OH',
        offerPrice: 95000,
      }),
    }).then((response) => response.json());
    const canonicalDeny = await fetch(`${BASE_URL}/api/approvals/smoke-approval-route-deny/deny`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
        actedAt: '2026-04-26T18:06:00.000Z',
      }),
    }).then((response) => response.json());
    const preparedContractId = preparedContract?.contract?.id || '';
    const canonicalContractSend = await fetch(`${BASE_URL}/api/contracts/${encodeURIComponent(preparedContractId)}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
      }),
    }).then((response) => response.json());
    const canonicalContractRemind = await fetch(`${BASE_URL}/api/contracts/${encodeURIComponent(preparedContractId)}/remind`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
      }),
    }).then((response) => response.json());
    const canonicalContractPdfResponse = await fetch(`${BASE_URL}/api/contracts/${encodeURIComponent(preparedContractId)}/pdf`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });
    const canonicalContractPdfBuffer = Buffer.from(await canonicalContractPdfResponse.arrayBuffer());
    const canonicalContractVoid = await fetch(`${BASE_URL}/api/contracts/${encodeURIComponent(preparedContractId)}/void`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        actor: 'smoke-test',
      }),
    }).then((response) => response.json());
    const instantlyWebhook = await fetch(`${BASE_URL}/api/webhooks/instantly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        event: 'reply.received',
        leadId: 'smoke-lead-1',
        name: 'Smoke Test Seller',
        email: 'smoke@example.com',
        address: '808 Smoke Test Ave, Columbus OH',
        body: 'Yes, tell me more.',
      }),
    }).then((response) => response.json());
    const emailWebhook = await fetch(`${BASE_URL}/api/webhooks/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        type: 'reply',
        leadId: 'smoke-lead-1',
        name: 'Smoke Test Seller',
        email: 'smoke@example.com',
        address: '808 Smoke Test Ave, Columbus OH',
        subject: 'Re: Seller packet',
        text: 'I am interested and ready for a call.',
      }),
    }).then((response) => response.json());
    const pdfResponse = await fetch(`${BASE_URL}/api/documents/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        documentType: 'masterPackage',
        documentTitle: 'PBK Smoke Test Package',
        propertyAddress: '808 Smoke Test Ave, Columbus OH',
        selectedPathLabel: 'Cash Offer',
        companyName: 'Probono Key Realty',
        previewOrigin: 'https://pbkcommandcenter.netlify.app',
        content: 'Smoke test document payload.',
      }),
    });
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    assert(health?.ok === true, 'Bridge health did not report ok: true.');
    assert(typeof health?.revision === 'string' && health.revision.length > 0, 'Bridge health did not return a revision.');
    assert(health?.features?.authRequired === true, 'Bridge health did not report authRequired: true.');
    assert(typeof health?.features?.stateBackend === 'string' && health.features.stateBackend.length > 0, 'Bridge health did not report stateBackend.');
    assert(health?.runtime?.mode === 'local', `Expected local smoke runtime mode, got ${health?.runtime?.mode || 'missing'}.`);
    assert(health?.runtime?.hosted === false, 'Expected local smoke runtime hosted flag to be false.');
    assert(Array.isArray(health?.runtime?.warnings), 'Bridge health did not expose runtime warnings array.');
    assert(health?.components?.bridge?.status === 'up', 'Bridge health did not expose command-center components.');
    assert(health?.components?.postgres?.status, 'Bridge health did not expose state backend component.');
    assert(health?.componentSummary?.total >= 10, 'Bridge health component summary is incomplete.');
    assert(unauthorizedState.status === 401, `Expected unauthenticated /state to return 401, got ${unauthorizedState.status}.`);
    assert(Array.isArray(state?.approvals), 'Authenticated /state did not return approvals.');
    assert(quotas?.ok === true, 'Quota endpoint did not return ok: true.');
    assert(typeof quotas?.quotas?.docs?.deliveredToday === 'number', 'Quota endpoint did not return docs counters.');
    assert(tooling?.ok === true, 'Tooling status endpoint did not return ok: true.');
    assert(Number(tooling?.tooling?.summary?.totalCount || 0) >= 5, 'Tooling status did not report the advanced stack.');
    assert(typeof tooling?.tooling?.browserOs?.note === 'string', 'Tooling status did not return BrowserOS metadata.');
    assert(Array.isArray(contractTemplates?.templates), 'Contract template endpoint did not return templates.');
    assert(firstLeadEvent?.ok === true, 'First lead-intake event did not succeed.');
    assert(secondLeadEvent?.replayed === true, 'Second identical lead-intake event was not treated as a replay.');
    assert(firstApprovalDecision?.ok === true, 'First approval callback did not succeed.');
    assert(secondApprovalDecision?.replayed === true, 'Second identical approval callback was not treated as a replay.');
    assert(invoke?.ok === true, 'Authenticated /invoke getBrainState did not succeed.');
    assert(avaCommand?.ok === true, 'Ava runAgentCommand smoke did not succeed.');
    assert(avaCommand?.result?.routedTo === 'agent_brain', `Ava masterclass command routed to ${avaCommand?.result?.routedTo || 'missing'} instead of agent_brain.`);
    assert(/due[- ]on[- ]sale|attorney|loan/i.test(String(avaCommand?.result?.response?.answer || avaCommand?.result?.response?.verbiage || '')), 'Ava masterclass command did not return subject-to guardrail language.');
    assert(brainIngest?.ok === true, 'Brain ingest endpoint did not succeed.');
    assert(Array.isArray(brainQuery?.brainDocs), 'Brain query endpoint did not return brainDocs.');
    assert(rexDecisions?.ok === true && Array.isArray(rexDecisions?.decisions), 'Rex decisions endpoint did not return decisions.');
    assert(rexProposal?.ok === true, 'Rex strategist proposal endpoint did not queue a proposal.');
    assert(rexProposal?.approval || rexProposal?.decision || rexProposal?.state, 'Rex strategist proposal did not return approval/decision state.');
    assert(agentOrchestration?.ok === true, 'Agent orchestration endpoint did not report ok.');
    assert(agentOrchestration?.orchestration?.topology === 'supervisor-worker', 'Agent orchestration did not report supervisor-worker topology.');
    assert(agentOrchestration?.orchestration?.supervisor?.id === 'ava', 'Agent orchestration did not report Ava as supervisor.');
    assert((agentOrchestration?.orchestration?.workers || []).some((agent) => agent.id === 'rex'), 'Agent orchestration did not include Rex as a worker.');
    assert((agentOrchestration?.orchestration?.workers || []).some((agent) => agent.id === 'hermes'), 'Agent orchestration did not include Hermes as a worker.');
    assert(agentOrchestrationSmoke?.ok === true, 'Agent orchestration smoke endpoint did not pass.');
    assert(agentOrchestrationSmoke?.probes?.ava?.routedTo === 'tool_first:analyze_deal', 'Agent orchestration smoke did not force Ava through analyze_deal.');
    assert(agentOrchestrationSmoke?.probes?.rex?.ok === true, 'Agent orchestration smoke did not verify Rex handoff.');
    assert(Array.isArray(agentOrchestrationSmoke?.tasks) && agentOrchestrationSmoke.tasks.length >= 3, 'Agent orchestration smoke did not create a full task trail.');
    assert(workflowSave?.ok === true, 'Workflow persistence endpoint did not save a draft.');
    assert(Array.isArray(workflows?.workflows), 'Workflow list endpoint did not return workflows.');
    assert(recordingSave?.ok === true, 'Recording metadata endpoint did not save.');
    assert([200, 501].includes(recordingLookupResponse.status), `Recording signed URL endpoint returned ${recordingLookupResponse.status}.`);
    assert(recordingLookup?.messageId === 'smoke-recording-msg-1', 'Recording signed URL endpoint did not echo the messageId.');
    assert(sellerDocs?.ok === true, 'Seller document endpoint did not succeed.');
    assert(typeof browserResearch?.answer === 'string', 'Browser research endpoint did not return a response.');
    assert(adminRequest?.ok === true, 'Admin request endpoint did not succeed.');
    assert(adminApproval?.ok === true, 'Admin approval endpoint did not succeed.');
    assert(preparedContract?.ok === true, 'Contract prepare endpoint did not succeed.');
    assert(canonicalDraftContract?.ok === true, 'Canonical contract draft endpoint did not succeed.');
    assert(canonicalAnalyzeDeal?.ok === true && typeof canonicalAnalyzeDeal?.mao === 'number', 'Canonical analyzeDeal endpoint did not return analysis.');
    assert(canonicalApproveRequest?.ok === true, 'Canonical approval setup for approve endpoint did not succeed.');
    assert(canonicalApprove?.ok === true && canonicalApprove?.approval?.status === 'approved', 'Canonical approval approve endpoint did not approve.');
    assert(canonicalDenyRequest?.ok === true, 'Canonical approval setup for deny endpoint did not succeed.');
    assert(canonicalDeny?.ok === true && canonicalDeny?.approval?.status === 'rejected', 'Canonical approval deny endpoint did not reject.');
    assert(canonicalContractSend?.ok === true, 'Canonical contract send endpoint did not succeed.');
    assert(canonicalContractRemind?.ok === true, 'Canonical contract remind endpoint did not succeed.');
    assert(canonicalContractPdfResponse.ok, `Canonical contract PDF endpoint returned ${canonicalContractPdfResponse.status}.`);
    assert((canonicalContractPdfResponse.headers.get('content-type') || '').includes('application/pdf'), 'Canonical contract PDF endpoint did not return application/pdf.');
    assert(canonicalContractPdfBuffer.subarray(0, 4).toString('utf8') === '%PDF', 'Canonical contract PDF endpoint did not return a valid PDF signature.');
    assert(canonicalContractVoid?.ok === true && String(canonicalContractVoid?.contract?.status || '').includes('void'), 'Canonical contract void endpoint did not void the contract.');
    assert(instantlyWebhook?.ok === true, 'Instantly webhook endpoint did not succeed.');
    assert(emailWebhook?.ok === true, 'Email webhook endpoint did not succeed.');
    assert(pdfResponse.ok, `PDF endpoint returned ${pdfResponse.status}.`);
    assert((pdfResponse.headers.get('content-type') || '').includes('application/pdf'), 'PDF endpoint did not return application/pdf.');
    assert(pdfBuffer.subarray(0, 4).toString('utf8') === '%PDF', 'PDF endpoint did not return a valid PDF signature.');

    console.log(JSON.stringify({
      ok: true,
      revision: health.revision,
      healthStatus: health.status,
      authRequired: health.features.authRequired,
      stateBackend: health.features.stateBackend,
      healthComponents: Number(health?.componentSummary?.total || 0),
      mode: health.runtime.mode,
      approvals: Array.isArray(state?.approvals) ? state.approvals.length : 0,
      activity: Array.isArray(state?.activity) ? state.activity.length : 0,
      contractTemplates: Array.isArray(contractTemplates?.templates) ? contractTemplates.templates.length : 0,
      avaRoutedTo: avaCommand?.result?.routedTo || '',
      rexDecisions: Array.isArray(rexDecisions?.decisions) ? rexDecisions.decisions.length : 0,
      agentOrchestration: agentOrchestration?.orchestration?.result || '',
      agentOrchestrationTasks: Array.isArray(agentOrchestrationSmoke?.tasks) ? agentOrchestrationSmoke.tasks.length : 0,
      toolingReady: Number(tooling?.tooling?.summary?.readyCount || 0),
      browserOsReady: Boolean(tooling?.tooling?.browserOs?.ready),
      docsDeliveredToday: Number(quotas?.quotas?.docs?.deliveredToday || 0),
      adminQueue: Number(quotas?.quotas?.docs?.queuedAdminTasks || 0),
      leadReplaySafe: Boolean(secondLeadEvent?.replayed),
      approvalReplaySafe: Boolean(secondApprovalDecision?.replayed),
      pdfBytes: pdfBuffer.length,
    }, null, 2));
  } catch (error) {
    await cleanup();
    const message = error instanceof Error ? error.message : 'Unknown smoke test failure';
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
