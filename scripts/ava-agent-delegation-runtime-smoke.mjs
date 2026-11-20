import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { buildAgentRuntimeSmokeEnv } from './agent-runtime-smoke-isolation.mjs';

const repoRoot = process.cwd();
const port = String(19600 + Math.floor(Math.random() * 2000));
const apiKey = 'ava-agent-delegation-runtime-smoke-key';

async function waitForBridge(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // Keep polling until the local bridge is reachable.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('OpenClaw bridge did not become ready for Ava agent delegation smoke.');
}

async function requestJson(baseUrl, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, text };
}

function assertWorkOrderProof(label, payload, { agentId, providerWriteIntent }) {
  assert.equal(payload.status, 200, `${label} returned HTTP ${payload.status}: ${payload.text}`);
  assert.equal(payload.json?.ok, true, `${label} should return ok.`);
  assert.equal(payload.json?.assistantAction, 'tool_plan', `${label} should execute as a tool plan.`);
  assert.equal(
    payload.json?.toolPlan?.toolName,
    'invokeRegisteredAgent',
    `${label} should route through the registered-agent dispatcher.`
  );
  assert.equal(
    payload.json?.toolResult?.result,
    'agent_invoked',
    `${label} should invoke the agent registry.`
  );
  const workOrder = payload.json?.toolResult?.workOrder || {};
  assert.equal(workOrder.schema, 'pbk.agent.work_order.v1', `${label} should return a durable work-order envelope.`);
  assert.equal(workOrder.agentId, agentId, `${label} should preserve the delegated agent id.`);
  assert.equal(
    workOrder.approvalPolicy?.providerWriteIntent,
    providerWriteIntent,
    `${label} should mark provider-write intent correctly.`
  );
  assert.equal(
    workOrder.approvalPolicy?.approvalRequired,
    providerWriteIntent,
    `${label} should only require approval for provider-write work orders.`
  );
  assert.equal(
    workOrder.autonomyMode,
    providerWriteIntent ? 'approval_gated' : 'supervised_autonomous',
    `${label} should expose the right autonomy mode.`
  );
  assert.ok(
    Array.isArray(workOrder.successCriteria) && workOrder.successCriteria.length >= 3,
    `${label} should include success criteria for the agent.`
  );
  assert.ok(
    workOrder.proofRequirements?.includes('work_order_envelope') &&
      workOrder.proofRequirements?.includes('agent_task_ledger') &&
      workOrder.proofRequirements?.includes('agent_result') &&
      workOrder.proofRequirements?.includes('mission_trace'),
    `${label} should require work-order, ledger, result, and mission proof.`
  );
  if (providerWriteIntent) {
    assert.ok(
      workOrder.proofRequirements?.includes('approval_policy') &&
        workOrder.proofRequirements?.includes('approval_receipt') &&
        workOrder.proofRequirements?.includes('provider_result_after_approval'),
      `${label} should require approval proof before provider execution.`
    );
  }

  const agentTask = payload.json?.toolResult?.agentTask || {};
  assert.equal(agentTask.id, workOrder.id, `${label} should ledger the same work-order id.`);
  assert.equal(agentTask.taskType, 'agent_invocation', `${label} should create an agent-invocation task.`);
  assert.ok(
    ['complete', 'warning', 'running'].includes(String(agentTask.status || '')),
    `${label} should return a known agent-task status.`
  );
  assert.equal(
    agentTask.metadata?.workOrder?.id,
    workOrder.id,
    `${label} should preserve work-order proof inside task metadata.`
  );
  assert.ok(
    payload.json?.missionLedger?.schema === 'pbk.ava.mission_ledger.v1',
    `${label} should return Ava mission-ledger proof.`
  );
  assert.ok(
    /work order/i.test(payload.json?.answer || ''),
    `${label} should explain the work-order handoff in plain language.`
  );
  return workOrder.id;
}

async function main() {
  const stateDir = await mkdtemp(join(tmpdir(), 'pbk-ava-agent-delegation-'));
  await writeFile(join(stateDir, 'openclaw-state.json'), JSON.stringify({
    approvals: [{
      id: 'approval-previous-outlook', leadId: 'lead-morgan', status: 'approved', type: 'provider-action',
      approvalAction: 'sendColdEmail', createdAt: '2026-11-20T10:00:00Z',
      metadata: {
        executionParams: { provider: 'outlook', subject: 'Previous fixture email' },
        providerActionDispatch: { status: 'reconciliation_required' },
      },
    }, {
      id: 'approval-other-outlook', leadId: 'lead-other', status: 'approved', type: 'provider-action',
      approvalAction: 'sendColdEmail', metadata: { executionParams: { provider: 'outlook' } },
    }],
    appointments: [],
    leadImports: [{ id: 'lead-morgan', leadName: 'Morgan Test', address: '12 Test Street', email: 'test@example.net' }],
    calls: [
      { id: 'call-other', leadId: 'lead-other', leadName: 'Other Seller', status: 'ended',
        createdAt: '2026-11-20T10:01:00Z', transcript: [{ text: 'Other seller private note' }] },
      { id: 'call-morgan', leadId: 'lead-morgan', leadName: 'Morgan Test', status: 'ended',
        createdAt: '2026-11-20T10:00:00Z', transcript: [{ text: 'Needs repairs before deciding.' }] },
    ],
    callQaScores: [
      { id: 'qa-other', callId: 'call-other', leadId: 'lead-other', score: 92 },
      { id: 'qa-morgan', callId: 'call-morgan', leadId: 'lead-morgan', score: 76 },
    ],
  }));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    '--import',
    new URL('./agent-runtime-smoke-isolation.mjs', import.meta.url).href,
    'scripts/openclaw-local-server.mjs',
  ], {
    cwd: repoRoot,
    env: {
      ...buildAgentRuntimeSmokeEnv(),
      PBK_AGENT_SMOKE_ISOLATED: '1',
      PORT: port,
      HOST: '127.0.0.1',
      PBK_OPENCLAW_STATE_DIR: stateDir,
      PBK_BRIDGE_API_KEY: apiKey,
      PBK_TEAM_PASSCODE: 'pbkway',
      PBK_SUPABASE_ENABLED: '0',
      PBK_DISABLE_POSTGRES: '1',
      PBK_REDIS_ENABLED: '0',
      PBK_ALLOW_UNAUTHENTICATED_HOSTED_BRIDGE: '1',
      PBK_DEEPSEEK_API_KEY: '',
      RESEND_API_KEY: '',
      TELNYX_API_KEY: '',
      INSTANTLY_API_KEY: '',
      PBK_AGENT_SMOKE_OUTLOOK_FIXTURE: '1',
      PBK_AVA_OUTLOOK_LEAD_EMAIL_ENABLED: '1',
      PBK_AVA_OUTLOOK_COMPOSIO_API_KEY: 'fixture-only',
      PBK_AVA_OUTLOOK_ACCOUNT_ID: 'fixture-account',
      PBK_AVA_OUTLOOK_USER_ID: 'fixture-user',
      PBK_AVA_OUTLOOK_SENDER: 'acquisition@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  child.stdout.resume();

  try {
    await waitForBridge(baseUrl);

    const readOnlyDelegation = await requestJson(baseUrl, '/api/assistant/chat', {
      method: 'POST',
      body: {
        sessionId: 'ava-agent-runtime-readonly',
        leadId: 'lead-agent-runtime-readonly',
        source: 'ava-agent-delegation-runtime-smoke',
        dryRun: true,
        smoke: true,
        message: 'Ask the Nurture Agent to recommend the next follow-up for this lead.',
      },
    });
    const readOnlyWorkOrderId = assertWorkOrderProof('read-only Nurture Agent delegation', readOnlyDelegation, {
      agentId: 'nurture-agent',
      providerWriteIntent: false,
    });

    const providerWriteDelegation = await requestJson(baseUrl, '/api/assistant/chat', {
      method: 'POST',
      body: {
        sessionId: 'ava-agent-runtime-provider-write',
        leadId: 'lead-agent-runtime-provider-write',
        source: 'ava-agent-delegation-runtime-smoke',
        dryRun: true,
        smoke: true,
        message: 'Fire Max to send the DocuSign contract for this seller.',
      },
    });
    const providerWriteWorkOrderId = assertWorkOrderProof('provider-write Max delegation', providerWriteDelegation, {
      agentId: 'max',
      providerWriteIntent: true,
    });

    const chat = async (sessionId, message, leadId) => {
      const response = await requestJson(baseUrl, '/api/assistant/chat', {
        method: 'POST', body: { sessionId, message, ...(leadId ? { leadId } : {}) },
      });
      assert.equal(response.status, 200, message);
      return response.json;
    };
    const review = await chat('ava-runtime-review', 'Review the latest call.', 'lead-morgan');
    assert.equal(review.toolResult?.call?.id, 'call-morgan');
    assert.equal(review.toolResult?.qaScore, 76);
    assert.match(review.answer, /Needs repairs before deciding/);
    assert.doesNotMatch(review.answer, /Other seller private note|\[object Object\]/);
    const noCall = await chat('ava-runtime-no-call', 'Review the latest call.', 'lead-unrecorded');
    assert.equal(noCall.toolResult?.result, 'no_call_available');
    assert.doesNotMatch(noCall.answer, /Morgan|Other Seller/);

    const nurtureUnavailable = await chat(
      'ava-runtime-nurture', 'Send a text to this lead saying we can talk tomorrow.', 'lead-morgan'
    );
    assert.equal(nurtureUnavailable.toolPlan?.toolName, 'consultNurtureAgent');
    assert.match(nurtureUnavailable.answer, /could not recommend a channel or time/);

    const scheduleSession = 'ava-runtime-follow-up';
    const followUp = await chat(scheduleSession, 'Schedule a follow-up for Morgan Test on 2099-04-03T14:00:00-07:00.');
    assert.equal(followUp.toolPlan?.toolName, 'confirmLeadMatch');
    assert.equal(followUp.toolPlan?.params?.leadId, 'lead-morgan');
    const confirmed = await chat(scheduleSession, 'Yes.');
    assert.equal(confirmed.toolPlan?.toolName, 'scheduleAppointment');
    assert.equal(confirmed.toolPlan?.params?.leadId, 'lead-morgan');
    assert.equal(confirmed.toolPlan?.params?.startTime, '2099-04-03T21:00:00.000Z');
    const followUpApprovalId = confirmed.toolResult?.approval?.id || confirmed.toolResult?.approvalId;
    assert.ok(followUpApprovalId, JSON.stringify(confirmed.toolResult));
    const repeated = await chat(scheduleSession, 'Yes.');
    assert.equal(repeated.toolPlan, null, 'A confirmed request should not be queued again on another yes.');

    const state = await requestJson(baseUrl, '/state');
    assert.equal(state.status, 200, `state returned HTTP ${state.status}`);
    const stateText = JSON.stringify(state.json || {});
    assert.ok(
      stateText.includes(readOnlyWorkOrderId) && stateText.includes(providerWriteWorkOrderId),
      'Bridge state should include both Ava-fired work-order ids in the agent task ledger.'
    );
    const followUpApprovals = state.json.approvals.filter((item) =>
      item.metadata?.requestedTool === 'scheduleAppointment');
    assert.deepEqual(followUpApprovals.map((item) => item.id), [followUpApprovalId]);
    assert.equal(followUpApprovals[0].status, 'pending');
    assert.equal(state.json.appointments.length, 0, 'The follow-up remains pending approval.');

    const approveFollowUp = () => requestJson(baseUrl, `/api/approvals/${followUpApprovalId}/approve`, {
      method: 'POST', body: { actor: 'QA operator' },
    });
    const decisions = await Promise.all([approveFollowUp(), approveFollowUp()]);
    assert.ok(decisions.some(({ json }) => json.providerActionResult?.ok === true),
      JSON.stringify(decisions.map(({ status, json }) => ({
        status, result: json.providerActionResult, error: json.error,
      }))));
    const finalState = await requestJson(baseUrl, '/state');
    assert.equal(finalState.status, 200);
    assert.equal(finalState.json.appointments.length, 1);
    const [appointment] = finalState.json.appointments;
    assert.equal(appointment.leadId, 'lead-morgan');
    assert.equal(appointment.startTime, '2099-04-03T21:00:00.000Z');
    const persisted = JSON.parse(await readFile(join(stateDir, 'openclaw-state.json'), 'utf8'));
    assert.equal(persisted.appointments.length, 1);
    assert.equal(persisted.appointments[0].id, appointment.id);
    const persistedApproval = persisted.approvals.find((item) => item.id === followUpApprovalId);
    assert.equal(persistedApproval?.status, 'approved');
    assert.equal(persistedApproval?.metadata?.providerActionResult?.ok, true);
    assert.equal(persistedApproval?.metadata?.providerActionResult?.appointmentId, appointment.id);
    assert.equal(persistedApproval?.metadata?.providerActionResult?.appointmentStatus, 'scheduled');

    const outlook = await chat('ava-runtime-outlook', 'Send an email saying "Fixture only."', 'lead-morgan');
    assert.equal(outlook.assistantAction, 'approval_required', outlook.answer);
    assert.equal(outlook.toolPlan?.params?.provider, 'outlook');
    assert.equal(outlook.toolResult?.approval?.metadata?.executionParams?.email, 'test@example.net');
    const outlookApprovalId = outlook.toolResult?.approval?.id || outlook.toolResult?.approvalId;
    assert.ok(outlookApprovalId, JSON.stringify(outlook.toolResult));
    const outlookDecision = await requestJson(baseUrl, `/api/approvals/${outlookApprovalId}`, {
      method: 'PUT', body: { status: 'approved', actor: 'QA operator' },
    });
    assert.equal(outlookDecision.json.approval?.status, 'approved');
    assert.equal(outlookDecision.json.providerActionResult?.provider, 'Outlook');
    assert.equal(outlookDecision.json.providerActionResult?.result, 'live');
    assert.equal(outlookDecision.json.approval?.metadata?.providerActionResult?.deliveryStatus, 'accepted');
    assert.equal(outlookDecision.json.approval?.metadata?.providerActionResult?.providerRequestId, 'fixture-outlook-1');
    const repeatedOutlook = await requestJson(baseUrl, `/api/approvals/${outlookApprovalId}`, {
      method: 'PUT', body: { status: 'approved', actor: 'QA operator' },
    });
    assert.ok(repeatedOutlook.status === 200 || repeatedOutlook.status === 409, repeatedOutlook.text);
    const outlookState = JSON.parse(await readFile(join(stateDir, 'openclaw-state.json'), 'utf8'));
    const outlookMessages = outlookState.messages.filter((item) => item.provider === 'Outlook');
    assert.equal(outlookMessages.length, 1);
    assert.equal(outlookMessages[0].providerAttemptId, 'fixture-outlook-1');
    assert.equal(outlookMessages[0].deliveryStatus, 'accepted');
    const outlookLead = await requestJson(baseUrl, '/api/leads/lead-morgan/full');
    assert.equal(outlookLead.status, 200);
    assert.deepEqual(outlookLead.json.outlookDelivery.map(({ state }) => state), ['accepted', 'recovery']);
    assert.equal(outlookLead.json.outlookDelivery[0].receiptId, 'fixture-outlook-1');
    const receiptUrl = 'https://mail.google.com/mail/u/0/#inbox/1234567890abcdef';
    const confirmationPath = `/api/approvals/${outlookApprovalId}/outlook-delivery`;
    const noAttestation = await requestJson(baseUrl, confirmationPath, { method: 'PUT', body: { receiptUrl } });
    assert.equal(noAttestation.status, 400);
    const confirm = () => requestJson(baseUrl, confirmationPath, { method: 'PUT', body: { receiptUrl, matchedReceipt: true } });
    const confirmedDelivery = await confirm();
    assert.equal(confirmedDelivery.status, 200, confirmedDelivery.text);
    assert.equal(confirmedDelivery.json.record.state, 'delivered');
    assert.equal((await confirm()).json.record.confirmation.confirmedAt, confirmedDelivery.json.record.confirmation.confirmedAt);
    const otherReceipt = await requestJson(baseUrl, confirmationPath, {
      method: 'PUT', body: { matchedReceipt: true, receiptUrl: 'https://mail.google.com/mail/u/0/#inbox/abcdef1234567890' },
    });
    assert.equal(otherReceipt.status, 409);
    const confirmedLead = await requestJson(baseUrl, '/api/leads/lead-morgan/full');
    assert.equal(confirmedLead.json.outlookDelivery[0].confirmation.receiptUrl, receiptUrl);
    const confirmedState = JSON.parse(await readFile(join(stateDir, 'openclaw-state.json'), 'utf8'));
    assert.equal(confirmedState.messages.filter((item) => item.provider === 'Outlook').length, 1);
    assert.equal(confirmedState.approvals.find((item) => item.id === outlookApprovalId).metadata.providerActionDispatch.status, 'completed');

    console.log(
      JSON.stringify(
        {
          ok: true,
          result: 'ava_agent_delegation_runtime_ready',
          workOrders: {
            readOnly: readOnlyWorkOrderId,
            providerWrite: providerWriteWorkOrderId,
          },
        },
        null,
        2
      )
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    const relativeStateDir = relative(tmpdir(), stateDir);
    assert(!isAbsolute(relativeStateDir) && relativeStateDir.startsWith('pbk-ava-agent-delegation-'));
    await rm(stateDir, { recursive: true, force: true });
    if (child.exitCode && child.exitCode !== 0) {
      console.warn(stderr.join('').split('\n').slice(-8).join('\n'));
    }
  }
}

await main();
