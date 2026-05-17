import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const SMOKE_ID = `${process.pid}-${Date.now()}`;
const PORT = Number(process.env.PBK_AGENT_DECISION_SMOKE_PORT || (18808 + (process.pid % 1000)));
const API_KEY = String(process.env.PBK_AGENT_DECISION_SMOKE_API_KEY || 'pbk-agent-decision-smoke-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth(timeoutMs = 15000) {
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
    await delay(250);
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
      PBK_OPENCLAW_STATE_DIR: path.join(ROOT_DIR, '.pbk-local', `agent-decision-smoke-${SMOKE_ID}`),
      PBK_OPENCLAW_RESET: '1',
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
    const payload = {
      agentId: 'ava',
      agentName: 'Ava',
      actionType: 'script_turn',
      source: 'x-factor-smoke',
      leadId: 'smoke-world-model-lead',
      context: {
        stage: 'objection_handling',
        selectedPath: 'cash',
        sentimentBefore: 0.44,
        objectionType: 'price_too_low',
      },
      parameters: {
        scriptVariant: 'empathy_repair_anchor',
        offerAmount: 78000,
      },
      outcome: {
        sentimentDelta: 0.18,
        callbackScheduled: true,
        objectionRaised: 'price_too_low',
      },
      reward: 0.42,
    };

    const created = await jsonFetch('/api/agent-decisions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert(created.response.status === 200, `Expected agent decision POST 200, got ${created.response.status}: ${JSON.stringify(created.body)}`);
    assert(created.body.ok === true, 'Agent decision POST did not return ok=true.');
    assert(created.body.result === 'agent_decision_recorded', `Unexpected decision result: ${created.body.result}`);
    assert(created.body.decision?.trainingReady === true, 'Decision was not marked trainingReady.');
    assert(created.body.decision?.stateVector?.stage === 'objection_handling', 'State vector did not retain stage.');

    const listed = await jsonFetch('/api/agent-decisions?limit=5');
    assert(listed.response.status === 200, `Expected agent decision GET 200, got ${listed.response.status}`);
    assert(Array.isArray(listed.body.decisions), 'Agent decision GET did not return decisions array.');
    assert(listed.body.decisions.some((item) => item.id === created.body.decision.id), 'Created decision was not returned by GET.');
    assert(listed.body.summary?.totalDecisions >= 1, 'Decision summary did not count the replay-buffer record.');

    const state = await jsonFetch('/state');
    assert(Array.isArray(state.body.agentDecisions), 'State snapshot does not expose agentDecisions.');
    assert(state.body.status?.worldModel?.decisionCount >= 1, 'World model status did not count agent decisions.');

    console.log(JSON.stringify({
      ok: true,
      result: 'agent_decision_replay_buffer_ready',
      decisionId: created.body.decision.id,
      reward: created.body.decision.reward,
      totalDecisions: listed.body.summary.totalDecisions,
    }, null, 2));
  } finally {
    await cleanup();
    if (stderr && /Error|Unhandled|EADDRINUSE/i.test(stderr)) {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
