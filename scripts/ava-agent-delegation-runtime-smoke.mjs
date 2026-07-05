import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const port = String(19600 + Math.floor(Math.random() * 2000));
const apiKey = 'ava-agent-delegation-runtime-smoke-key';

async function waitForBridge(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
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
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/openclaw-local-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: port,
      HOST: '127.0.0.1',
      PBK_OPENCLAW_STATE_DIR: stateDir,
      PBK_BRIDGE_API_KEY: apiKey,
      PBK_TEAM_PASSCODE: 'pbkway',
      PBK_SUPABASE_ENABLED: '0',
      PBK_DISABLE_POSTGRES: '1',
      PBK_ALLOW_UNAUTHENTICATED_HOSTED_BRIDGE: '1',
      PBK_DEEPSEEK_API_KEY: '',
      RESEND_API_KEY: '',
      TELNYX_API_KEY: '',
      INSTANTLY_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

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

    const state = await requestJson(baseUrl, '/state');
    assert.equal(state.status, 200, `state returned HTTP ${state.status}`);
    const stateText = JSON.stringify(state.json || {});
    assert.ok(
      stateText.includes(readOnlyWorkOrderId) && stateText.includes(providerWriteWorkOrderId),
      'Bridge state should include both Ava-fired work-order ids in the agent task ledger.'
    );

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
    if (!child.killed) child.kill();
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]).catch(() => {});
    await rm(stateDir, { recursive: true, force: true }).catch(() => {});
    if (child.exitCode && child.exitCode !== 0) {
      console.warn(stderr.join('').split('\n').slice(-8).join('\n'));
    }
  }
}

await main();
