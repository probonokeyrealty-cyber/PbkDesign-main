import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const SMOKE_ID = `${process.pid}-${Date.now()}`;
const PORT = Number(process.env.PBK_EMOTIONAL_LEARNING_SMOKE_PORT || (20880 + (process.pid % 1000)));
const API_KEY = String(process.env.PBK_EMOTIONAL_LEARNING_SMOKE_API_KEY || 'pbk-emotional-learning-smoke-key').trim();
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
      PBK_OPENCLAW_STATE_DIR: path.join(ROOT_DIR, '.pbk-local', `emotional-learning-smoke-${SMOKE_ID}`),
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

    const firstInference = await jsonFetch('/api/emotion/infer-tags', {
      method: 'POST',
      body: JSON.stringify({
        leadId: 'emotional-loop-lead',
        callId: 'emotional-loop-call',
        transcript: "I don't know if I trust this. How do I know this isn't a scam?",
        emotion: { joy: 0.05, sadness: 0.1, anger: 0.08, fear: 0.55 },
      }),
    });
    assert(firstInference.response.status === 200, `Expected infer-tags 200, got ${firstInference.response.status}: ${JSON.stringify(firstInference.body)}`);
    assert(firstInference.body.result === 'emotional_tags_inferred', `Unexpected infer result: ${firstInference.body.result}`);
    assert(firstInference.body.tags.some((tag) => tag.tag === 'skeptical' && tag.intensity >= 0.6), 'Skeptical seller text should infer a strong skeptical tag.');
    assert(firstInference.body.strategy?.promptInstruction?.includes('proof'), 'Skeptical tag should produce proof/process guidance.');

    const logged = await jsonFetch('/api/emotion/learning/interactions', {
      method: 'POST',
      body: JSON.stringify({
        leadId: 'emotional-loop-lead',
        callId: 'emotional-loop-call',
        sellerUtterance: "I don't know if I trust this. How do I know this isn't a scam?",
        inferredTags: firstInference.body.tags,
        avaResponse: 'That is a fair question. I can walk you through who we are, how closing works, and what you can verify before anything is signed.',
        avaProsody: { speed: 0.9, stability: 0.74, emotionPrompt: 'calm, transparent, grounded' },
        outcome: 'objection_handled',
        tagsAfter: [{ tag: 'trust_rising', intensity: 0.76 }, { tag: 'calm', intensity: 0.6 }],
      }),
    });
    assert(logged.response.status === 200, `Expected interaction log 200, got ${logged.response.status}: ${JSON.stringify(logged.body)}`);
    assert(logged.body.result === 'emotional_learning_interaction_recorded', `Unexpected log result: ${logged.body.result}`);
    assert(logged.body.interaction?.successWeight >= 0.7, 'Handled objection should create a high success weight.');
    assert(logged.body.agentDecision?.trainingReady === true, 'Emotional learning should feed the world-model replay buffer.');

    const improved = await jsonFetch('/api/emotion/learning/improve', {
      method: 'POST',
      body: JSON.stringify({ minWeight: 0.65 }),
    });
    assert(improved.response.status === 200, `Expected improve 200, got ${improved.response.status}: ${JSON.stringify(improved.body)}`);
    assert(improved.body.result === 'emotional_memory_improved', `Unexpected improve result: ${improved.body.result}`);
    assert(improved.body.promoted >= 1, 'Successful interaction should be promoted into emotional memory.');

    const secondInference = await jsonFetch('/api/emotion/infer-tags', {
      method: 'POST',
      body: JSON.stringify({
        leadId: 'emotional-loop-lead-2',
        callId: 'emotional-loop-call-2',
        transcript: 'I am worried this might be a scam and I need proof before I keep talking.',
        emotion: { joy: 0.04, sadness: 0.08, anger: 0.06, fear: 0.58 },
      }),
    });
    assert(secondInference.response.status === 200, `Expected second infer 200, got ${secondInference.response.status}: ${JSON.stringify(secondInference.body)}`);
    assert(secondInference.body.source === 'emotional_memory', 'Similar skeptical seller text should retrieve the successful emotional memory.');
    assert(secondInference.body.memory?.successWeight >= 0.7, 'Retrieved emotional memory should carry success weight.');
    assert(/walk you through|verify/i.test(secondInference.body.strategy?.winningResponse || ''), 'Retrieved emotional memory should expose Ava winning response pattern.');

    const prompt = await jsonFetch('/api/v1/ava/conversation-intelligence', {
      method: 'POST',
      body: JSON.stringify({
        leadId: 'emotional-loop-lead-2',
        sessionId: 'emotional-loop-call-2',
        query: 'I am worried this might be a scam and I need proof before I keep talking.',
      }),
    });
    assert(prompt.response.status === 200, `Expected conversation intelligence 200, got ${prompt.response.status}: ${JSON.stringify(prompt.body)}`);
    assert(prompt.body.promptFrame?.emotionalTags?.tags?.some((tag) => tag.tag === 'skeptical'), 'Ava prompt frame should include inferred emotional tags.');
    assert(prompt.body.promptFrame?.emotionalTags?.source === 'emotional_memory', 'Ava prompt frame should include memory-backed tag source.');

    const state = await jsonFetch('/state');
    assert(state.body.status?.emotionalIntelligence?.learningInteractionCount >= 1, 'State should expose emotional learning interaction count.');
    assert(state.body.status?.emotionalIntelligence?.learningMemoryCount >= 1, 'State should expose emotional learning memory count.');

    console.log(JSON.stringify({
      ok: true,
      result: 'emotional_learning_loop_ready',
      firstSource: firstInference.body.source,
      secondSource: secondInference.body.source,
      promoted: improved.body.promoted,
      successWeight: logged.body.interaction.successWeight,
      promptTags: prompt.body.promptFrame.emotionalTags.tags.map((tag) => tag.tag),
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
