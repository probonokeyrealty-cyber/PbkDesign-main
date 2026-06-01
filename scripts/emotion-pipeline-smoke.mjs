import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const SMOKE_ID = `${process.pid}-${Date.now()}`;
const PORT = Number(process.env.PBK_EMOTION_SMOKE_PORT || (19808 + (process.pid % 1000)));
const API_KEY = String(process.env.PBK_EMOTION_SMOKE_API_KEY || 'pbk-emotion-smoke-key').trim();
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
      PBK_OPENCLAW_STATE_DIR: path.join(ROOT_DIR, '.pbk-local', `emotion-smoke-${SMOKE_ID}`),
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
    const emotionPayload = {
      leadId: 'smoke-emotion-lead',
      callId: 'smoke-emotion-call',
      sessionId: 'smoke-session-1',
      utteranceIndex: 2,
      text: 'I am overwhelmed because this was my mother’s house and I do not know what to do.',
      sentiment: 'negative',
      emotion: {
        joy: 0.03,
        sadness: 0.78,
        anger: 0.04,
        fear: 0.15,
      },
      context: 'seller described estate grief and overwhelm',
      source: 'deepgram-emotion-smoke',
    };

    const recorded = await jsonFetch('/api/emotions/call', {
      method: 'POST',
      body: JSON.stringify(emotionPayload),
    });
    assert(recorded.response.status === 200, `Expected emotion POST 200, got ${recorded.response.status}: ${JSON.stringify(recorded.body)}`);
    assert(recorded.body.ok === true, 'Emotion POST did not return ok=true.');
    assert(recorded.body.result === 'call_emotion_recorded', `Unexpected emotion result: ${recorded.body.result}`);
    assert(recorded.body.emotion?.emotionState?.dominant === 'sadness', 'Emotion state did not classify sadness as dominant.');
    assert(recorded.body.memory?.emotionState?.sadness > 0.7, 'Emotional memory did not retain the sadness signal.');

    const memory = await jsonFetch('/api/leads/smoke-emotion-lead/emotional-state');
    assert(memory.response.status === 200, `Expected emotional-state GET 200, got ${memory.response.status}`);
    assert(memory.body.memory?.emotionState?.dominant === 'sadness', 'Lead emotional-state endpoint did not return latest sadness memory.');

    const intelligence = await jsonFetch('/api/v1/ava/conversation-intelligence', {
      method: 'POST',
      body: JSON.stringify({
        leadId: 'smoke-emotion-lead',
        sessionId: 'smoke-session-1',
        stage: 'discovery',
        selectedPath: 'cash',
        query: 'I am still overwhelmed and worried about making the wrong choice.',
      }),
    });
    assert(intelligence.response.status === 200, `Expected Ava conversation intelligence 200, got ${intelligence.response.status}`);
    assert(intelligence.body.promptFrame?.emotionalMemory?.dominantEmotion === 'sadness', 'Ava prompt frame did not include dominant emotional memory.');
    assert(/estate grief|overwhelm/i.test(intelligence.body.promptFrame?.emotionalMemory?.context || ''), 'Ava prompt frame did not include the emotional memory context.');
    assert(/de-escalate before offer/i.test(intelligence.body.promptFrame?.emotionalMemory?.promptInstruction || ''), 'Ava prompt frame did not include emotion-aware prompt instruction.');

    const predicted = await jsonFetch('/api/emotion/predict', {
      method: 'POST',
      body: JSON.stringify({
        leadId: 'smoke-emotion-lead',
        actionType: 'empathy_statement',
        message: 'That sounds like a lot to carry. We can slow this down and just focus on what would make this easier for you.',
        currentEmotion: memory.body.memory.emotionState,
      }),
    });
    assert(predicted.response.status === 200, `Expected emotion predict 200, got ${predicted.response.status}`);
    assert(predicted.body.ok === true, 'Emotion prediction did not return ok=true.');
    assert(predicted.body.prediction?.nextEmotion?.sadness < memory.body.memory.emotionState.sadness, 'Empathy prediction did not reduce sadness.');
    assert(predicted.body.prediction?.policyHint === 'de_escalate_before_offer', 'Emotion prediction did not recommend de-escalation before offer.');
    assert(
      ['native_trained_model', 'heuristic_fallback'].includes(predicted.body.prediction?.modelProvider),
      'Emotion prediction did not expose native or fallback provider metadata.',
    );
    if (predicted.body.prediction?.modelProvider === 'heuristic_fallback') {
      assert(predicted.body.prediction?.fallbackReason, 'Emotion prediction did not expose why the fallback was used.');
    } else {
      assert(predicted.body.prediction?.matchedProfile, 'Native emotion prediction did not expose the matched model profile.');
    }

    const experiment = await jsonFetch('/api/emotion/policies/experiments', {
      method: 'POST',
      body: JSON.stringify({
        policyName: 'grief_deescalation_opening',
        metric: 'sadness_delta',
        variants: [
          {
            id: 'control',
            label: 'Tactical empathy control',
            promptInstruction: 'Acknowledge the grief, ask one gentle question, and avoid price.',
          },
          {
            id: 'treatment',
            label: 'Burden relief treatment',
            promptInstruction: 'Name the burden, offer to slow the process down, then ask what would make the next step easier.',
          },
        ],
        riskLevel: 'low',
        autoApprove: true,
      }),
    });
    assert(experiment.response.status === 200, `Expected emotional policy experiment POST 200, got ${experiment.response.status}`);
    assert(experiment.body.result === 'emotional_policy_experiment_created', `Unexpected emotional policy experiment result: ${experiment.body.result}`);
    assert(experiment.body.experiment?.status === 'running', 'Low-risk emotional policy experiment was not auto-started.');
    assert(experiment.body.experiment?.variants?.length === 2, 'Emotional policy experiment did not retain both variants.');

    const assignment = await jsonFetch('/api/emotion/policies/assign', {
      method: 'POST',
      body: JSON.stringify({
        experimentId: experiment.body.experiment.id,
        leadId: 'smoke-emotion-lead',
        sessionId: 'smoke-session-1',
      }),
    });
    assert(assignment.response.status === 200, `Expected emotional policy assignment 200, got ${assignment.response.status}`);
    assert(assignment.body.assignment?.variantId, 'Emotional policy assignment did not choose a variant.');
    assert(assignment.body.assignment?.promptInstruction, 'Emotional policy assignment did not include prompt instruction.');

    const assignmentAgain = await jsonFetch('/api/emotion/policies/assign', {
      method: 'POST',
      body: JSON.stringify({
        experimentId: experiment.body.experiment.id,
        leadId: 'smoke-emotion-lead',
        sessionId: 'smoke-session-1',
      }),
    });
    assert(assignmentAgain.body.assignment?.variantId === assignment.body.assignment.variantId, 'Emotional policy assignment was not deterministic for the same lead/session.');

    const outcome = await jsonFetch('/api/emotion/policies/outcome', {
      method: 'POST',
      body: JSON.stringify({
        experimentId: experiment.body.experiment.id,
        variantId: assignment.body.assignment.variantId,
        leadId: 'smoke-emotion-lead',
        sessionId: 'smoke-session-1',
        success: true,
        sentimentBefore: 0.22,
        sentimentAfter: 0.48,
        emotionBefore: memory.body.memory.emotionState,
        emotionAfter: predicted.body.prediction.nextEmotion,
        reward: 0.26,
      }),
    });
    assert(outcome.response.status === 200, `Expected emotional policy outcome 200, got ${outcome.response.status}`);
    assert(outcome.body.result === 'emotional_policy_outcome_recorded', `Unexpected emotional policy outcome result: ${outcome.body.result}`);
    assert(outcome.body.summary?.total >= 1, 'Emotional policy outcome summary did not count the result.');

    const decision = await jsonFetch('/api/agent-decisions', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'ava',
        actionType: 'empathy_statement',
        leadId: 'smoke-emotion-lead',
        context: {
          stage: 'discovery',
          selectedPath: 'cash',
          emotionState: memory.body.memory.emotionState,
        },
        parameters: {
          message: 'We can slow this down.',
        },
        outcome: {
          nextEmotion: predicted.body.prediction.nextEmotion,
          sellerStayedEngaged: true,
        },
        emotionState: memory.body.memory.emotionState,
        reward: 0.61,
      }),
    });
    assert(decision.response.status === 200, `Expected emotional agent decision POST 200, got ${decision.response.status}`);
    assert(decision.body.decision?.emotionState?.dominant === 'sadness', 'Agent decision did not preserve emotionState.');
    assert(decision.body.decision?.stateVector?.dominantEmotion === 'sadness', 'State vector did not include dominantEmotion.');

    const state = await jsonFetch('/state');
    assert(state.body.status?.emotionalIntelligence?.memoryCount >= 1, 'State status did not expose emotional intelligence memory count.');
    assert(Array.isArray(state.body.callEmotions), 'State snapshot does not expose callEmotions.');
    assert(Array.isArray(state.body.emotionalMemory), 'State snapshot does not expose emotionalMemory.');

    console.log(JSON.stringify({
      ok: true,
      result: 'emotion_pipeline_ready',
      dominantEmotion: memory.body.memory.emotionState.dominant,
      promptEmotion: intelligence.body.promptFrame.emotionalMemory.dominantEmotion,
      emotionalPolicyVariant: assignment.body.assignment.variantId,
      modelProvider: predicted.body.prediction.modelProvider,
      predictedSadness: predicted.body.prediction.nextEmotion.sadness,
      memoryCount: state.body.status.emotionalIntelligence.memoryCount,
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
