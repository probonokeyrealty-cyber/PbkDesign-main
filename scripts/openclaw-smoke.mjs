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
    assert(sellerDocs?.ok === true, 'Seller document endpoint did not succeed.');
    assert(typeof browserResearch?.answer === 'string', 'Browser research endpoint did not return a response.');
    assert(adminRequest?.ok === true, 'Admin request endpoint did not succeed.');
    assert(adminApproval?.ok === true, 'Admin approval endpoint did not succeed.');
    assert(preparedContract?.ok === true, 'Contract prepare endpoint did not succeed.');
    assert(instantlyWebhook?.ok === true, 'Instantly webhook endpoint did not succeed.');
    assert(emailWebhook?.ok === true, 'Email webhook endpoint did not succeed.');
    assert(pdfResponse.ok, `PDF endpoint returned ${pdfResponse.status}.`);
    assert((pdfResponse.headers.get('content-type') || '').includes('application/pdf'), 'PDF endpoint did not return application/pdf.');
    assert(pdfBuffer.subarray(0, 4).toString('utf8') === '%PDF', 'PDF endpoint did not return a valid PDF signature.');

    console.log(JSON.stringify({
      ok: true,
      revision: health.revision,
      authRequired: health.features.authRequired,
      stateBackend: health.features.stateBackend,
      mode: health.runtime.mode,
      approvals: Array.isArray(state?.approvals) ? state.approvals.length : 0,
      activity: Array.isArray(state?.activity) ? state.activity.length : 0,
      contractTemplates: Array.isArray(contractTemplates?.templates) ? contractTemplates.templates.length : 0,
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
