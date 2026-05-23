import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const SMOKE_ID = `${process.pid}-${Date.now()}`;
const PORT = Number(process.env.PBK_X_FACTOR_SMOKE_PORT || (19920 + (process.pid % 700)));
const API_KEY = String(process.env.PBK_X_FACTOR_SMOKE_API_KEY || 'pbk-x-factor-smoke-key').trim();
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
      PBK_OPENCLAW_STATE_DIR: path.join(ROOT_DIR, '.pbk-local', `x-factor-smoke-${SMOKE_ID}`),
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

    const status = await jsonFetch('/api/intelligence/capabilities');
    assert(status.response.status === 200, `Expected intelligence capabilities 200, got ${status.response.status}: ${JSON.stringify(status.body)}`);
    assert(status.body.result === 'x_factor_capabilities', `Unexpected capability result: ${status.body.result}`);
    assert(Array.isArray(status.body.dimensions) && status.body.dimensions.length >= 8, 'Capabilities endpoint did not return the intelligence dimensions.');
    assert(status.body.dimensions.every((item) => item.id && item.readiness && item.endpoint), 'Every dimension must expose id/readiness/endpoint.');
    assert(status.body.dimensions.some((item) => item.id === 'emotional_learning_loop'), 'Capabilities endpoint did not expose the emotional learning loop.');

    const emotionAccuracy = await jsonFetch('/api/emotion/ser/predict', {
      method: 'POST',
      body: JSON.stringify({
        text: 'I am anxious about selling my mother\'s house.',
        acoustic: { pitchVariance: 0.44, speakingRate: 0.72 },
        emotion: { joy: 0.04, sadness: 0.74, anger: 0.03, fear: 0.19 },
      }),
    });
    assert(emotionAccuracy.response.status === 200, `Expected SER predict 200, got ${emotionAccuracy.response.status}`);
    assert(emotionAccuracy.body.result === 'speech_emotion_prediction', 'SER endpoint did not return speech_emotion_prediction.');
    assert(emotionAccuracy.body.prediction?.dominant === 'sadness', 'SER endpoint did not classify sadness from the supplied vector.');
    assert(emotionAccuracy.body.modelProvider, 'SER endpoint did not expose model provider readiness.');

    const outreach = await jsonFetch('/api/outreach/automations/propose', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Opened email then SMS follow-up',
        trigger: { event: 'email_opened', delayMinutes: 30 },
        action: { type: 'sms', template: 'Saw you had a chance to look this over. Want me to answer anything?' },
        riskLevel: 'low',
      }),
    });
    assert(outreach.response.status === 200, `Expected outreach automation 200, got ${outreach.response.status}`);
    assert(outreach.body.result === 'proactive_outreach_rule_created', `Unexpected outreach result: ${outreach.body.result}`);
    assert(outreach.body.rule?.status === 'approval_required', 'Outreach rule must stay approval-gated, not auto-send provider writes.');

    const selfImprovement = await jsonFetch('/api/self-improvement/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        skillName: 'probate_grief_opening',
        version: 'v2',
        baseline: { successRate: 0.62, latencyMs: 900 },
        candidate: { successRate: 0.7, latencyMs: 930 },
        riskLevel: 'low',
      }),
    });
    assert(selfImprovement.response.status === 200, `Expected self-improvement 200, got ${selfImprovement.response.status}`);
    assert(selfImprovement.body.result === 'self_improvement_decision_recorded', `Unexpected self-improvement result: ${selfImprovement.body.result}`);
    assert(['promote', 'hold', 'rollback'].includes(selfImprovement.body.decision?.action), 'Self-improvement endpoint did not return a promotion decision.');
    assert(selfImprovement.body.decision?.guardrails?.autoRollback === true, 'Self-improvement decision did not include auto-rollback guardrail.');

    const prosody = await jsonFetch('/api/voice/emotion-prosody', {
      method: 'POST',
      body: JSON.stringify({
        text: 'We can slow this down and make the next step simple.',
        emotion: { joy: 0.1, sadness: 0.68, anger: 0.04, fear: 0.18 },
      }),
    });
    assert(prosody.response.status === 200, `Expected emotion prosody 200, got ${prosody.response.status}`);
    assert(prosody.body.result === 'emotion_synchronized_prosody', 'Prosody endpoint did not return emotion_synchronized_prosody.');
    assert(prosody.body.tts?.fallbackProvider === 'ElevenLabs', 'Prosody endpoint must preserve ElevenLabs fallback.');

    const interruption = await jsonFetch('/api/interruption/classify', {
      method: 'POST',
      body: JSON.stringify({
        overlapMs: 840,
        speakerText: 'Wait, can you explain the closing date again?',
        agentWasSpeaking: true,
      }),
    });
    assert(interruption.response.status === 200, `Expected interruption classify 200, got ${interruption.response.status}`);
    assert(interruption.body.result === 'interruption_intent_classified', 'Interruption endpoint did not classify intent.');
    assert(interruption.body.classification?.intent === 'clarification', 'Interruption endpoint should classify the sample as clarification.');
    assert(interruption.body.handling?.strategy === 'yield_and_answer', 'Clarification interruptions should yield and answer.');

    const transfer = await jsonFetch('/api/skills/transfer/recommend', {
      method: 'POST',
      body: JSON.stringify({
        lead: { leadType: 'probate', state: 'OH', motivation: 'overwhelmed estate seller' },
        topK: 3,
      }),
    });
    assert(transfer.response.status === 200, `Expected skill transfer 200, got ${transfer.response.status}`);
    assert(transfer.body.result === 'cross_lead_skill_recommendations', 'Skill transfer endpoint did not return recommendations.');
    assert(Array.isArray(transfer.body.recommendations), 'Skill transfer endpoint did not expose a recommendations array.');
    assert(transfer.body.recommendations.length >= 1, 'Skill transfer endpoint should return at least one safe starter recommendation.');

    const coach = await jsonFetch('/api/post-call/coach', {
      method: 'POST',
      body: JSON.stringify({
        callId: 'x-factor-smoke-call',
        agentId: 'ava',
        transcript: [
          { speaker: 'seller', text: 'I am worried this is too fast.' },
          { speaker: 'ava', text: 'I hear you. We can slow this down and make sure you feel clear.' },
          { speaker: 'seller', text: 'That helps. I can talk tomorrow.' },
        ],
        outcome: { callbackScheduled: true, sellerStayedEngaged: true },
      }),
    });
    assert(coach.response.status === 200, `Expected post-call coach 200, got ${coach.response.status}`);
    assert(coach.body.result === 'post_call_coaching_report_created', `Unexpected coach result: ${coach.body.result}`);
    assert(coach.body.report?.scores?.empathy >= 70, 'Coaching report should score empathy from the transcript.');
    assert(Array.isArray(coach.body.report?.nextActions) && coach.body.report.nextActions.length, 'Coaching report needs next actions.');

    const goal = await jsonFetch('/api/goals/decompose', {
      method: 'POST',
      body: JSON.stringify({
        goal: 'Improve probate reply rate by 15 percent this month',
        owner: 'rex',
        riskTolerance: 'low',
      }),
    });
    assert(goal.response.status === 200, `Expected goal decompose 200, got ${goal.response.status}`);
    assert(goal.body.result === 'goal_plan_created', `Unexpected goal result: ${goal.body.result}`);
    assert(goal.body.plan?.levels?.strategic?.length >= 1, 'Goal plan did not include strategic level.');
    assert(goal.body.plan?.levels?.tactical?.length >= 1, 'Goal plan did not include tactical level.');
    assert(goal.body.plan?.levels?.operational?.length >= 1, 'Goal plan did not include operational level.');
    assert(goal.body.plan?.approvalMode === 'approval_first', 'Goal planner must remain approval-first.');

    const statusAfter = await jsonFetch('/api/intelligence/capabilities');
    assert(statusAfter.body.counts?.proactiveOutreachRules >= 1, 'Capability status did not count proactive outreach rule.');
    assert(statusAfter.body.counts?.postCallCoachingReports >= 1, 'Capability status did not count post-call coaching report.');
    assert(statusAfter.body.counts?.goalPlans >= 1, 'Capability status did not count goal plan.');

    console.log(JSON.stringify({
      ok: true,
      result: 'x_factor_dimensions_ready',
      dimensions: statusAfter.body.dimensions.map((item) => ({ id: item.id, readiness: item.readiness })),
      counts: statusAfter.body.counts,
      selfImprovementResult: selfImprovement.body.result,
      selfImprovement: selfImprovement.body.decision.action,
      interruption: interruption.body.classification.intent,
      goal: goal.body.plan.id,
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
