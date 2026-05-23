import {
  buildIntelligenceScorecard,
  gradeScore,
  scoreLinear,
} from './intelligence-scorecard.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const readyHealth = {
  ok: true,
  status: 'ok',
  providers: {
    telnyx: { ready: true, voiceReady: true, messagingReady: true },
    deepgram: { ready: true },
    browserVoice: { ready: true },
    elevenLabs: { ready: true, streamingReady: true },
    tavily: { ready: true },
    webSearch: { ready: true },
    deepSeek: { ready: true },
    instantly: { ready: true },
    slack: { ready: true },
    n8nWorkflows: { ready: true },
    render: { ready: true },
  },
  components: {
    agentOrchestration: { status: 'up', ready: true },
  },
  features: {
    stateBackend: 'postgres',
  },
};

const strongState = {
  status: {
    mode: 'autopilot',
    avaResponseLatencyMs: 650,
    sourcesIndexed: 250,
    brainBlogPosts: 80,
    queryCountToday: 120,
    activeNurturePlans: 30,
    providerKillSwitch: { active: false },
    toolUsage: {
      pbk_ava_conversation_intelligence: 80,
    },
    avaActiveMemories: 120,
    avaLearningSessions: 250,
    pendingAvaLearningRequests: 0,
    worldModel: {
      enabled: true,
      decisionCount: 600,
      trainingReadyCount: 580,
      averageReward: 0.82,
    },
    emotionalIntelligence: {
      enabled: true,
      worldModelProvider: 'external_world_model',
      worldModelConfigured: true,
      callEmotionCount: 600,
      memoryCount: 520,
      policyExperimentCount: 12,
      policyOutcomeCount: 240,
    },
    xFactorDimensions: {
      emotionSerPredictions: 220,
      proactiveOutreachRules: 8,
      selfImprovementDecisions: 42,
      voiceProsodyPlans: 40,
      interruptionEvents: 80,
      skillTransferRecommendations: 30,
      postCallCoachingReports: 140,
      goalPlans: 20,
    },
  },
  approvals: [],
  adminTasks: [],
};

const strongMessages = {
  messages: Array.from({ length: 4 }, (_, index) => ({
      channel: 'call',
      direction: 'transcription',
      provider: 'Deepgram',
      status: 'transcribed',
      body: 'I am the owner and I need to sell this house in the next month. I need speed, certainty, and a clear process before I decide who to work with.',
      sentiment: 0.71,
      payload: {
        frameCount: 1200 + index,
        audioBytes: 188000 + index,
        transcriptFinal: true,
        deepgram: { model: 'nova-2-phonecall', lastError: '' },
        transcript: [
          { confidence: 0.94, transcript: 'I am the owner.' },
          { confidence: 0.92, transcript: 'I need to sell.' },
        ],
      },
    })),
};

const strongSkills = {
  skills: Array.from({ length: 14 }, (_, index) => ({
    id: `skill-${index}`,
    agentId: index % 2 === 0 ? 'ava' : 'rex',
    confidence: index % 2 === 0 ? 96 : 94,
    uses: 32,
    wins: 26,
    losses: 6,
    successRate: 0.81,
    status: 'active',
  })),
};

const strongRex = {
  decisions: [
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `rex-transfer-${index}`,
      status: 'applied',
      success: true,
      tool: 'transfer_skill',
    })),
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `rex-experiment-${index}`,
      status: 'applied',
      success: index < 24,
      tool: 'ab_test_skill',
    })),
  ],
};

const strongScorecard = buildIntelligenceScorecard({
  health: readyHealth,
  state: strongState,
  messages: strongMessages,
  calls: { calls: [{ status: 'ended', durationSeconds: 360 }] },
  agentDecisions: { summary: { totalDecisions: 600, trainingReadyCount: 580, averageReward: 0.82 }, decisions: [] },
  emotionPolicies: { experiments: Array(12).fill({}), outcomes: Array(240).fill({}) },
  skills: strongSkills,
  rexDecisions: strongRex,
  capabilities: {
    dimensions: [
      { id: 'emotion_accuracy', readiness: 'external_world_model', blocking: [] },
      { id: 'goal_decomposition', readiness: 'planner_ready', blocking: [] },
    ],
    counts: strongState.status.xFactorDimensions,
  },
  slackHealth: { slack: { interactiveReady: true, notifyReady: true } },
}, { now: new Date('2026-05-23T12:00:00Z') });

assert(gradeScore(96) === 'A+', '96 should grade A+.');
assert(scoreLinear(50, 100) === 50, 'scoreLinear should map half target to 50.');
assert(strongScorecard.ok === true, 'Strong fixture should be ok.');
assert(strongScorecard.overall.score >= 90, `Strong fixture should be 90+, got ${strongScorecard.overall.score}.`);
assert(strongScorecard.agents.ava.score >= 90, `Ava should be 90+, got ${strongScorecard.agents.ava.score}.`);
assert(strongScorecard.agents.rex.score >= 90, `Rex should be 90+, got ${strongScorecard.agents.rex.score}.`);
assert(strongScorecard.metrics.some((metric) => metric.id === 'ava_live_hearing_proof'), 'Ava hearing metric missing.');
assert(strongScorecard.metrics.some((metric) => metric.id === 'rex_experiment_quality'), 'Rex experiment metric missing.');
assert(
  strongScorecard.metrics.find((metric) => metric.id === 'ava_voice_provider_readiness')?.score === 100,
  'Voice readiness should recognize camelCase ElevenLabs provider metadata.',
);

const sparseScorecard = buildIntelligenceScorecard({
  health: readyHealth,
  state: {
    status: {
      mode: 'approval',
      providerKillSwitch: { active: false },
      worldModel: { enabled: true, decisionCount: 1, trainingReadyCount: 1, averageReward: 0.61 },
      emotionalIntelligence: {
        enabled: true,
        worldModelProvider: 'heuristic_fallback',
        worldModelConfigured: false,
        callEmotionCount: 1,
        memoryCount: 1,
        policyExperimentCount: 0,
        policyOutcomeCount: 0,
      },
    },
    approvals: Array(51).fill({ status: 'pending' }),
    adminTasks: [],
  },
  messages: { messages: [] },
  calls: { calls: [] },
  agentDecisions: { summary: { totalDecisions: 1, trainingReadyCount: 1, averageReward: 0.61 }, decisions: [] },
  emotionPolicies: { experiments: [], outcomes: [] },
  skills: { skills: [] },
  rexDecisions: { decisions: [] },
  capabilities: { dimensions: [{ id: 'emotion_accuracy', readiness: 'heuristic_fallback', blocking: ['needs ONNX'] }], counts: {} },
  slackHealth: { slack: { interactiveReady: true, notifyReady: true } },
}, { now: new Date('2026-05-23T12:00:00Z') });

assert(sparseScorecard.overall.score < 90, 'Sparse real-world fixture should not claim 10/10.');
assert(sparseScorecard.actions.some((item) => item.id === 'collect_real_call_outcomes'), 'Sparse fixture should ask for real call outcomes.');
assert(sparseScorecard.actions.some((item) => item.id === 'clear_approval_backlog'), 'Sparse fixture should flag approval backlog.');

console.log(JSON.stringify({
  ok: true,
  result: 'intelligence_scorecard_smoke_ready',
  strongOverall: strongScorecard.overall.score,
  sparseOverall: sparseScorecard.overall.score,
  metricCount: strongScorecard.metrics.length,
}, null, 2));
