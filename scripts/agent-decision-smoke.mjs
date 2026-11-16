import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const child = await startIsolatedBridge({ startupMs: 60000 });
  async function jsonFetch(pathname, options = {}) {
    const response = await child.fetch(`${child.origin}${pathname}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${child.apiKey}`,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }

  try {
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
    await child.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
