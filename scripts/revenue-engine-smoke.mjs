import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const SMOKE_ID = `${process.pid}-${Date.now()}`;
const PORT = Number(process.env.PBK_REVENUE_ENGINE_SMOKE_PORT || (21740 + (process.pid % 900)));
const API_KEY = String(process.env.PBK_REVENUE_ENGINE_SMOKE_API_KEY || 'pbk-revenue-engine-smoke-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth(timeoutMs = 18000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw lastError || new Error('Timed out waiting for bridge health.');
}

async function jsonFetch(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  const child = spawn(process.execPath, [SERVER_ENTRY, '--reset'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PBK_OPENCLAW_PORT: String(PORT),
      PBK_BRIDGE_API_KEY: API_KEY,
      PBK_OPENCLAW_STATE_DIR: path.join(ROOT_DIR, '.pbk-local', `revenue-engine-smoke-${SMOKE_ID}`),
      PBK_OPENCLAW_RESET: '1',
      PBK_COMMAND_CENTER_CLOSED_LOOP_ENABLED: 'true',
      PBK_AUTOPILOT_LOW_RISK: 'true',
      PBK_REVENUE_TARGET_MONTHLY: '1000000',
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
    await waitForHealth();

    const firstStatus = await jsonFetch('/api/revenue/engine/status');
    assert(firstStatus.response.status === 200, `Expected revenue status 200, got ${firstStatus.response.status}: ${JSON.stringify(firstStatus.body)}`);
    assert(firstStatus.body.result === 'revenue_engine_status', `Unexpected revenue status result: ${firstStatus.body.result}`);
    assert(Number.isFinite(firstStatus.body.readinessScore), 'Revenue status must expose a numeric readinessScore.');
    assert(firstStatus.body.approvalMode === 'approval_first', 'Revenue Engine must stay approval-first by default.');
    assert(firstStatus.body.providerWritesBlocked === true, 'Revenue Engine status must not perform provider writes.');
    assert(firstStatus.body.nextBestAction?.id, 'Revenue status must expose a next-best action.');
    assert(Array.isArray(firstStatus.body.actions) && firstStatus.body.actions.length >= 3, 'Revenue status must expose prioritized action options.');
    assert(firstStatus.body.sevenFigureModel?.dealsRequired > 0, 'Revenue status must expose seven-figure deal math.');

    const proposed = await jsonFetch('/api/revenue/engine/propose', {
      method: 'POST',
      body: JSON.stringify({
        requestedBy: 'smoke-test',
        actionId: firstStatus.body.nextBestAction.id,
      }),
    });
    assert(proposed.response.status === 200, `Expected revenue proposal 200, got ${proposed.response.status}: ${JSON.stringify(proposed.body)}`);
    assert(proposed.body.result === 'revenue_engine_proposal_queued', `Unexpected proposal result: ${proposed.body.result}`);
    assert(proposed.body.approvalMode === 'approval_first', 'Revenue proposal must remain approval-first.');
    assert(proposed.body.providerWritesBlocked === true, 'Revenue proposal must not directly write to providers.');
    assert(proposed.body.decision?.source === 'rex-revenue-engine', 'Revenue proposal must be queued as a Rex revenue decision.');
    assert(proposed.body.decision?.status === 'queued_for_approval', 'Revenue proposal must queue founder approval.');
    assert(proposed.body.approval?.id, 'Revenue proposal must create a founder approval item.');

    const callAnalysis = await jsonFetch('/api/v1/call-analysis/run', {
      method: 'POST',
      body: JSON.stringify({ actor: 'smoke-test', limit: 5 }),
    });
    assert(callAnalysis.response.status === 200, `Expected call analysis 200, got ${callAnalysis.response.status}: ${JSON.stringify(callAnalysis.body)}`);
    assert(callAnalysis.body.providerWritesBlocked === true, 'Call analysis must not perform provider writes.');

    const rexAlignment = await jsonFetch('/api/v1/rex/align-goal', {
      method: 'POST',
      body: JSON.stringify({ actor: 'smoke-test', targetMonthlyRevenue: 1000000 }),
    });
    assert(rexAlignment.response.status === 200, `Expected Rex alignment 200, got ${rexAlignment.response.status}: ${JSON.stringify(rexAlignment.body)}`);
    assert(rexAlignment.body.providerWritesBlocked === true, 'Rex alignment must not perform provider writes.');
    assert(rexAlignment.body.targetMonthlyRevenue === 1000000, 'Rex alignment must track the $1M/month target.');
    assert(Array.isArray(rexAlignment.body.actions), 'Rex alignment must emit measurable revenue actions.');

    const activation = await jsonFetch('/api/v1/command-center/activate', {
      method: 'POST',
      body: JSON.stringify({ requestedBy: 'smoke-test', runNow: false, targetMonthlyRevenue: 1000000 }),
    });
    assert(activation.response.status === 200, `Expected activation 200, got ${activation.response.status}: ${JSON.stringify(activation.body)}`);
    assert(activation.body.result === 'command_center_closed_loop_activated', `Unexpected activation result: ${activation.body.result}`);
    assert(activation.body.providerWritesBlocked === true, 'Activation must keep provider writes blocked.');
    assert(activation.body.approvalMode === 'high_risk_approval_required', 'Activation must keep high-risk actions approval-gated.');

    const closedLoopStatus = await jsonFetch('/api/v1/command-center/closed-loop/status');
    assert(closedLoopStatus.response.status === 200, `Expected closed-loop status 200, got ${closedLoopStatus.response.status}: ${JSON.stringify(closedLoopStatus.body)}`);
    assert(closedLoopStatus.body.enabled === true, 'Closed-loop status must be enabled after activation.');
    assert(closedLoopStatus.body.lowRiskAutopilot === true, 'Closed-loop status must expose low-risk autopilot.');
    assert(closedLoopStatus.body.highRiskApprovalRequired === true, 'Closed-loop status must keep high-risk actions approval-gated.');

    const capabilities = await jsonFetch('/api/intelligence/capabilities');
    assert(capabilities.response.status === 200, `Expected capabilities 200, got ${capabilities.response.status}`);
    assert(
      capabilities.body.dimensions?.some((item) => item.id === 'seven_figure_revenue_engine'),
      'Capabilities endpoint must include the seven-figure Revenue Engine lane.',
    );

    const toolInvoke = await jsonFetch('/invoke', {
      method: 'POST',
      body: JSON.stringify({
        toolName: 'getRevenueEngineStatus',
        params: { requestedBy: 'smoke-test' },
      }),
    });
    assert(toolInvoke.response.status === 200, `Expected tool invoke 200, got ${toolInvoke.response.status}: ${JSON.stringify(toolInvoke.body)}`);
    assert(toolInvoke.body.result?.result === 'revenue_engine_status' || toolInvoke.body.result === 'revenue_engine_status', 'Tool invoke must expose Revenue Engine status.');

    console.log(JSON.stringify({
      ok: true,
      result: 'revenue_engine_ready',
      readinessScore: firstStatus.body.readinessScore,
      nextBestAction: firstStatus.body.nextBestAction.id,
      approvalId: proposed.body.approval.id,
      actionCount: firstStatus.body.actions.length,
      closedLoopEnabled: closedLoopStatus.body.enabled,
      revenueAlignmentActions: rexAlignment.body.actions.length,
    }, null, 2));
  } finally {
    await cleanup();
    if (stderr && process.env.PBK_SHOW_SMOKE_STDERR === '1') {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
