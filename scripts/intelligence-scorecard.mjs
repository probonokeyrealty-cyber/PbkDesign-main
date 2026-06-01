import { fileURLToPath } from 'node:url';
import { compactLongHorizonMemory } from './research-additives.mjs';

const BASE_URL = String(process.env.PBK_HOSTED_BRIDGE_URL || process.env.PBK_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com')
  .trim()
  .replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const STRICT = process.argv.includes('--strict');
const MEMORY_STATS = process.argv.includes('--memory-stats');
const TARGET_SCORE = Math.max(1, Math.min(100, Number(process.env.PBK_INTELLIGENCE_TARGET_SCORE || 90)));

export function clampScore(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(100, Number(value)));
}

export function scoreLinear(value, target, floor = 0) {
  const numericValue = Math.max(0, Number(value || 0));
  const numericTarget = Math.max(1, Number(target || 1));
  return Math.round(clampScore(floor + ((numericValue / numericTarget) * (100 - floor))));
}

export function gradeScore(score) {
  const value = clampScore(score);
  if (value >= 96) return 'A+';
  if (value >= 93) return 'A';
  if (value >= 90) return 'A-';
  if (value >= 87) return 'B+';
  if (value >= 83) return 'B';
  if (value >= 80) return 'B-';
  if (value >= 77) return 'C+';
  if (value >= 73) return 'C';
  if (value >= 70) return 'C-';
  if (value >= 60) return 'D';
  return 'F';
}

function readinessLabel(score) {
  const value = clampScore(score);
  if (value >= 97) return '10_candidate';
  if (value >= 90) return 'excellent';
  if (value >= 80) return 'production_strong';
  if (value >= 70) return 'usable_learning';
  if (value >= 50) return 'needs_data_or_instrumentation';
  return 'blocked';
}

function roundScore(value) {
  return Number(clampScore(value).toFixed(1));
}

function average(values) {
  const cleaned = values.map(Number).filter(Number.isFinite);
  if (!cleaned.length) return null;
  return cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
}

function weightedAverage(metrics = []) {
  const usable = metrics.filter((metric) => Number(metric.weight || 0) > 0);
  const totalWeight = usable.reduce((sum, metric) => sum + Number(metric.weight || 0), 0);
  if (!totalWeight) return 0;
  return roundScore(usable.reduce((sum, metric) => sum + (clampScore(metric.score) * Number(metric.weight || 0)), 0) / totalWeight);
}

function makeMetric({ id, owner, label, score, weight = 1, evidence = {}, target = '', action = '' }) {
  const normalizedScore = roundScore(score);
  return {
    id,
    owner,
    label,
    score: normalizedScore,
    grade: gradeScore(normalizedScore),
    readiness: readinessLabel(normalizedScore),
    weight,
    target,
    evidence,
    action,
  };
}

function providerReady(provider = {}) {
  return provider?.ready === true || provider?.voiceReady === true || provider?.messagingReady === true;
}

function getProvider(providers = {}, name = '') {
  const variants = {
    browservoice: ['browserVoice', 'browservoice'],
    deepseek: ['deepSeek', 'deepseek'],
    elevenlabs: ['elevenLabs', 'elevenlabs'],
    n8nworkflows: ['n8nWorkflows', 'n8nworkflows'],
    opensearch: ['openSearch', 'opensearch'],
    openaiwebsearch: ['openAiWebSearch', 'openaiwebsearch'],
    supabasestorage: ['supabaseStorage', 'supabasestorage'],
    websearch: ['webSearch', 'websearch'],
  };
  const normalized = String(name || '').toLowerCase();
  for (const key of [name, normalized, ...(variants[normalized] || [])]) {
    if (providers[key]) return providers[key];
  }
  return {};
}

function countReadyProviders(providers = {}, names = []) {
  return names.filter((name) => providerReady(getProvider(providers, name))).length;
}

function getPendingWork(state = {}) {
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const adminTasks = Array.isArray(state.adminTasks) ? state.adminTasks : [];
  return [
    ...approvals.filter((item) => String(item?.status || 'pending').toLowerCase() === 'pending'),
    ...adminTasks.filter((item) => String(item?.status || 'pending').toLowerCase() === 'pending'),
  ];
}

function getTranscriptionMessages(messages = {}) {
  return (Array.isArray(messages.messages) ? messages.messages : [])
    .filter((message) => {
      const haystack = `${message.channel || ''} ${message.direction || ''} ${message.provider || ''} ${message.status || ''} ${message.payload?.source || ''}`.toLowerCase();
      return haystack.includes('call') || haystack.includes('deepgram') || haystack.includes('transcription') || haystack.includes('telnyx-media-stream');
    })
    .filter((message) => String(message.body || '').trim().length || Array.isArray(message.payload?.transcript));
}

function getTranscriptConfidence(messages = []) {
  const confidences = messages.flatMap((message) => (
    Array.isArray(message.payload?.transcript)
      ? message.payload.transcript.map((item) => Number(item?.confidence)).filter(Number.isFinite)
      : []
  ));
  return average(confidences);
}

function getLatestTranscriptEvidence(messages = {}) {
  const transcriptionMessages = getTranscriptionMessages(messages);
  const latest = transcriptionMessages[0] || {};
  const confidence = getTranscriptConfidence(transcriptionMessages);
  const bodyLength = Math.max(0, ...transcriptionMessages.map((message) => String(message.body || '').trim().length));
  const maxFrames = Math.max(0, ...transcriptionMessages.map((message) => Number(message.payload?.frameCount || 0)));
  const maxAudioBytes = Math.max(0, ...transcriptionMessages.map((message) => Number(message.payload?.audioBytes || 0)));
  return {
    count: transcriptionMessages.length,
    bodyLength,
    confidence,
    maxFrames,
    maxAudioBytes,
    latestProvider: latest.provider || '',
    latestStatus: latest.status || '',
    deepgramModel: latest.payload?.deepgram?.model || latest.payload?.mediaFormat?.encoding || '',
    fallbackActive: Boolean(latest.payload?.deepgram?.fallbackActive),
  };
}

function pickLatestTranscriptMessage(messages = {}) {
  return getTranscriptionMessages(messages)[0] || {};
}

function extractBantFromDiagnosticPayload(payload = {}) {
  const candidates = [
    payload?.architecture?.bant?.known,
    payload?.bant?.known,
    payload?.bant,
    payload?.pipeline?.bant,
    payload?.callState?.bant,
    payload?.state?.bant,
  ];
  return candidates.find((item) => item && typeof item === 'object') || {};
}

function getTranscriptTextForMemory(message = {}) {
  if (String(message.body || '').trim()) return String(message.body || '').trim();
  if (Array.isArray(message.payload?.transcript)) {
    return message.payload.transcript
      .map((item) => item?.text || item?.transcript || '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

export function buildMemoryStats(data = {}) {
  const messages = data.messages || {};
  const latest = pickLatestTranscriptMessage(messages);
  const transcriptMessages = getTranscriptionMessages(messages);
  const transcript = getTranscriptTextForMemory(latest);
  const compact = compactLongHorizonMemory({
    transcript,
    bant: extractBantFromDiagnosticPayload(latest.payload || {}),
    emotion: latest.payload?.emotion || latest.payload?.emotionState || latest.payload?.sentiment || {},
    turnCount: latest.payload?.turnCount || latest.payload?.transcript?.length || transcriptMessages.length,
    env: process.env,
  });
  return {
    ok: true,
    result: 'memory_stats_ready',
    baseUrl: BASE_URL,
    transcriptCount: transcriptMessages.length,
    latestMessageId: latest.id || latest.messageId || '',
    latestTranscriptChars: transcript.length,
    compact: compact.compactState,
    model: compact.model,
    requestStatus: data.requestStatus || {},
    missingCritical: compact.compactState?.openLoops || [],
    diagnosticQuestions: [
      'What exact fact did Ava forget?',
      'How many turns into the call did the miss happen?',
      'Was it a BANT item, objection, personal detail, or callback/open loop?',
    ],
    recommendation: compact.compactState?.shouldCompact
      ? 'Compaction is active. Review protectedFields and openLoops; if Ava still forgets BANT/emotion facts after 50-100 calls, train the gated local MEM1 model.'
      : 'Current transcript is under compaction threshold. Keep collecting call turns; BANT/emotion/open loops are still explicitly protected.',
  };
}

function getSkillOutcomeEvidence(skills = {}) {
  const rows = Array.isArray(skills.skills) ? skills.skills : [];
  const uses = rows.reduce((sum, item) => sum + Number(item.uses || 0), 0);
  const wins = rows.reduce((sum, item) => sum + Number(item.wins || 0), 0);
  const losses = rows.reduce((sum, item) => sum + Number(item.losses || 0), 0);
  const confidence = average(rows.map((item) => Number(item.confidence)).filter(Number.isFinite));
  const active = rows.filter((item) => String(item.status || 'active').toLowerCase() === 'active').length;
  return {
    rows: rows.length,
    active,
    uses,
    wins,
    losses,
    confidence,
    successRate: uses > 0 ? wins / uses : null,
  };
}

function getRexDecisionEvidence(rexDecisions = {}) {
  const rows = Array.isArray(rexDecisions.decisions) ? rexDecisions.decisions : [];
  const applied = rows.filter((item) => String(item.status || '').toLowerCase() === 'applied').length;
  const successful = rows.filter((item) => item.success === true || item.outcome?.success === true).length;
  const transferCount = rows.filter((item) => String(item.tool || '').includes('transfer')).length;
  const experimentCount = rows.filter((item) => /ab|experiment|improve|skill|campaign/i.test(`${item.tool || ''} ${item.type || ''}`)).length;
  return {
    rows: rows.length,
    applied,
    successful,
    transferCount,
    experimentCount,
  };
}

function buildProviderEvidence(health = {}, state = {}) {
  return {
    ...(health.providers || {}),
    ...(state.status?.providers || {}),
  };
}

function getCapabilityCounts(capabilities = {}, state = {}) {
  return {
    ...(capabilities.counts || {}),
    ...(state.status?.xFactorDimensions || {}),
  };
}

function hasExternalWorldModel(state = {}, capabilities = {}) {
  const provider = String(state.status?.emotionalIntelligence?.worldModelProvider || '').toLowerCase();
  const dimensions = Array.isArray(capabilities.dimensions) ? capabilities.dimensions : [];
  return provider.includes('external') || dimensions.some((item) => (
    item.id === 'emotion_accuracy' && /onnx|external|transformer/i.test(`${item.readiness || ''} ${item.provider || ''}`)
  ));
}

function buildActions({ state, agentDecisions, emotionPolicies, messages, metrics }) {
  const actions = [];
  const decisionCount = Number(state.status?.worldModel?.decisionCount ?? agentDecisions.summary?.totalDecisions ?? 0);
  const callEmotionCount = Number(state.status?.emotionalIntelligence?.callEmotionCount || 0);
  const emotionalLearningInteractions = Number(state.status?.emotionalIntelligence?.learningInteractionCount || 0);
  const emotionalLearningMemory = Number(state.status?.emotionalIntelligence?.learningMemoryCount || 0);
  const policyOutcomeCount = Number(state.status?.emotionalIntelligence?.policyOutcomeCount ?? emotionPolicies.outcomes?.length ?? 0);
  const pendingWork = getPendingWork(state);
  const transcriptEvidence = getLatestTranscriptEvidence(messages);

  if (decisionCount < 100 || callEmotionCount < 100) {
    actions.push({
      id: 'collect_real_call_outcomes',
      priority: 'high',
      title: 'Collect real call outcome data',
      evidence: { decisionCount, callEmotionCount, target: '100 first, 500 strong, 1000 competitive advantage' },
      action: 'Run connected Telnyx calls and make sure each call writes transcript, emotion, action, outcome, and reward rows.',
    });
  }
  if (policyOutcomeCount < 25) {
    actions.push({
      id: 'record_emotional_policy_outcomes',
      priority: 'high',
      title: 'Close the emotion policy learning loop',
      evidence: { policyOutcomeCount, target: 25 },
      action: 'Start assigning emotional policy variants and recording seller outcome movement after each call.',
    });
  }
  if (emotionalLearningInteractions < 25 || emotionalLearningMemory < 10) {
    actions.push({
      id: 'strengthen_emotional_learning_loop',
      priority: 'high',
      title: 'Feed Ava emotional learning outcomes',
      evidence: { emotionalLearningInteractions, emotionalLearningMemory, target: '25 interactions and 10 promoted memories first' },
      action: 'Log seller emotional tags, Ava response/prosody, outcome, and success weight on every call turn; promote high-weight patterns into memory.',
    });
  }
  if (pendingWork.length) {
    actions.push({
      id: 'clear_approval_backlog',
      priority: pendingWork.length > 10 ? 'high' : 'medium',
      title: 'Clear pending approvals/admin work',
      evidence: { pending: pendingWork.length },
      action: 'Review, approve, reject, or archive stale Founder Approval Board items so real blockers are visible.',
    });
  }
  if (!transcriptEvidence.count) {
    actions.push({
      id: 'prove_live_hearing',
      priority: 'high',
      title: 'Prove Ava can hear callers with a fresh transcript',
      evidence: transcriptEvidence,
      action: 'Run npm run debug:telnyx-live -- --minutes 8 during an answered inbound call and verify transcript rows land.',
    });
  }
  if (metrics.some((metric) => metric.id === 'ava_response_latency' && metric.score < 80)) {
    actions.push({
      id: 'instrument_ava_latency',
      priority: 'medium',
      title: 'Instrument end-to-end Ava response latency',
      evidence: metrics.find((metric) => metric.id === 'ava_response_latency')?.evidence || {},
      action: 'Store caller speech-final timestamp, Ava reply-start timestamp, and TTS playback-start timestamp on every call turn.',
    });
  }

  return actions;
}

export function buildIntelligenceScorecard(data = {}, options = {}) {
  const health = data.health || {};
  const state = data.state || {};
  const agentDecisions = data.agentDecisions || {};
  const messages = data.messages || {};
  const emotionPolicies = data.emotionPolicies || {};
  const skills = data.skills || {};
  const rexDecisions = data.rexDecisions || {};
  const capabilities = data.capabilities || {};
  const slackHealth = data.slackHealth || {};
  const providers = buildProviderEvidence(health, state);
  const capabilityCounts = getCapabilityCounts(capabilities, state);
  const transcriptEvidence = getLatestTranscriptEvidence(messages);
  const skillEvidence = getSkillOutcomeEvidence(skills);
  const rexEvidence = getRexDecisionEvidence(rexDecisions);
  const pendingWork = getPendingWork(state);
  const decisionCount = Number(state.status?.worldModel?.decisionCount ?? agentDecisions.summary?.totalDecisions ?? 0);
  const trainingReadyCount = Number(state.status?.worldModel?.trainingReadyCount ?? agentDecisions.summary?.trainingReadyCount ?? 0);
  const averageReward = Number(state.status?.worldModel?.averageReward ?? agentDecisions.summary?.averageReward ?? 0);
  const emotional = state.status?.emotionalIntelligence || {};
  const callEmotionCount = Number(emotional.callEmotionCount || 0);
  const memoryCount = Number(emotional.memoryCount || 0);
  const emotionalLearningInteractions = Number(emotional.learningInteractionCount || 0);
  const emotionalLearningMemory = Number(emotional.learningMemoryCount || 0);
  const policyOutcomeCount = Number(emotional.policyOutcomeCount ?? emotionPolicies.outcomes?.length ?? 0);
  const mode = String(state.status?.mode || state.settings?.ui?.operatingMode || 'unknown').toLowerCase();
  const killSwitchActive = state.status?.providerKillSwitch?.active === true;
  const providerNames = ['telnyx', 'deepgram', 'browserVoice', 'elevenlabs', 'webSearch', 'deepSeek', 'slack'];
  const readyProviders = countReadyProviders(providers, providerNames);
  const voiceReadyCount = countReadyProviders(providers, ['telnyx', 'deepgram', 'browserVoice', 'elevenlabs']);
  const hasWorldModel = hasExternalWorldModel(state, capabilities);
  const confidenceScore = transcriptEvidence.confidence == null
    ? (transcriptEvidence.count ? 70 : 0)
    : Math.round(clampScore(transcriptEvidence.confidence * 100));
  const transcriptQualityScore = transcriptEvidence.count
    ? Math.min(96, Math.round(
      (scoreLinear(transcriptEvidence.count, 3) * 0.2)
      + (scoreLinear(transcriptEvidence.bodyLength, 220) * 0.25)
      + (confidenceScore * 0.35)
      + (scoreLinear(transcriptEvidence.maxFrames, 800) * 0.1)
      + (scoreLinear(transcriptEvidence.maxAudioBytes, 120000) * 0.1),
    ))
    : 0;
  const responseLatencyInstrumented = Number.isFinite(Number(state.status?.avaResponseLatencyMs || state.status?.lastAvaResponseLatencyMs));
  const responseLatencyMs = Number(state.status?.avaResponseLatencyMs || state.status?.lastAvaResponseLatencyMs || 0);
  const responseLatencyScore = responseLatencyInstrumented
    ? clampScore(100 - Math.max(0, responseLatencyMs - 850) / 18)
    : (providerReady(providers.elevenLabs || providers.elevenlabs) && transcriptEvidence.count ? 66 : 45);
  const emotionScore = roundScore(
    (hasWorldModel ? 42 : 24)
    + (scoreLinear(Math.min(decisionCount, callEmotionCount), 500) * 0.28)
    + (scoreLinear(policyOutcomeCount, 150) * 0.14)
    + (scoreLinear(memoryCount, 500) * 0.1)
    + (scoreLinear(emotionalLearningInteractions, 500) * 0.08),
  );
  const memoryScore = roundScore(
    (Number(state.status?.avaActiveMemories || 0) ? 22 : 0)
    + (scoreLinear(Number(state.status?.avaActiveMemories || 0), 75) * 0.24)
    + (scoreLinear(Number(state.status?.avaLearningSessions || 0), 200) * 0.22)
    + (scoreLinear(decisionCount, 500) * 0.18)
    + (scoreLinear(memoryCount, 500) * 0.1)
    + (scoreLinear(emotionalLearningMemory, 300) * 0.08),
  );
  const toolScore = roundScore(
    (health.components?.agentOrchestration?.ready || health.components?.agentOrchestration?.status === 'up' ? 25 : 0)
    + (scoreLinear(readyProviders, providerNames.length) * 0.45)
    + (Number(state.status?.toolUsage?.pbk_ava_conversation_intelligence || 0) ? 15 : 0)
    + (providerReady(providers.render) ? 15 : 0),
  );
  const safetyScore = roundScore(
    (killSwitchActive ? 0 : 24)
    + (['approval', 'manual'].includes(mode) ? 22 : mode === 'autopilot' ? 18 : 10)
    + (slackHealth.slack?.interactiveReady ? 16 : 8)
    + (scoreLinear(Math.max(0, 25 - pendingWork.length), 25) * 0.18)
    + (health.features?.stateBackend === 'postgres' ? 20 : 8),
  );
  const closedLoopScore = roundScore(
    (scoreLinear(trainingReadyCount, 500) * 0.24)
    + (scoreLinear(policyOutcomeCount, 150) * 0.2)
    + (scoreLinear(skillEvidence.uses, 100) * 0.14)
    + (scoreLinear(Number(capabilityCounts.selfImprovementDecisions || 0), 25) * 0.12)
    + (scoreLinear(emotionalLearningInteractions, 500) * 0.12)
    + (scoreLinear(emotionalLearningMemory, 300) * 0.08)
    + (Number.isFinite(averageReward) ? clampScore(averageReward * 100) * 0.1 : 0),
  );
  const voiceNaturalnessScore = roundScore(
    (scoreLinear(voiceReadyCount, 4) * 0.56)
    + (scoreLinear(Number(capabilityCounts.voiceProsodyPlans || 0), 30) * 0.22)
    + (/emotion|prosody|stream/i.test(`${providers.elevenLabs?.mode || providers.elevenlabs?.mode || ''} ${providers.elevenLabs?.streamingReady || providers.elevenlabs?.streamingReady || ''}`) ? 12 : 6)
    + (providerReady(providers.elevenLabs || providers.elevenlabs) ? 10 : 0),
  );
  const autonomyScore = roundScore(
    (mode === 'autopilot' ? 38 : mode === 'approval' ? 24 : 12)
    + (scoreLinear(Number(capabilityCounts.selfImprovementDecisions || 0), 25) * 0.2)
    + (scoreLinear(skillEvidence.uses, 100) * 0.16)
    + (killSwitchActive ? 0 : 14)
    + (pendingWork.length ? Math.max(0, 12 - pendingWork.length * 0.5) : 12),
  );

  const rexResearchScore = roundScore(
    (scoreLinear(Number(state.status?.sourcesIndexed || 0), 200) * 0.28)
    + (scoreLinear(Number(state.status?.brainBlogPosts || 0), 50) * 0.18)
    + (providerReady(providers.webSearch) || providerReady(providers.tavily) ? 22 : 0)
    + (providerReady(providers.deepSeek) ? 22 : 0)
    + (Number(state.status?.queryCountToday || 0) ? 10 : 0),
  );
  const rexPlanningScore = roundScore(
    (scoreLinear(Number(capabilityCounts.goalPlans || 0), 20) * 0.38)
    + (scoreLinear(rexEvidence.applied, 25) * 0.26)
    + (health.components?.agentOrchestration?.ready || health.components?.agentOrchestration?.status === 'up' ? 18 : 0)
    + (scoreLinear(Number(capabilityCounts.postCallCoachingReports || 0), 100) * 0.18),
  );
  const rexExperimentScore = roundScore(
    (scoreLinear(Number(capabilityCounts.selfImprovementDecisions || 0), 50) * 0.26)
    + (scoreLinear(skillEvidence.uses, 150) * 0.24)
    + (scoreLinear(rexEvidence.experimentCount, 30) * 0.2)
    + (scoreLinear(policyOutcomeCount, 150) * 0.2)
    + ((skillEvidence.confidence || 0) * 0.1),
  );
  const rexTransferScore = roundScore(
    (scoreLinear(Number(capabilityCounts.skillTransferRecommendations || 0), 30) * 0.42)
    + (scoreLinear(rexEvidence.transferCount, 15) * 0.24)
    + (scoreLinear(skillEvidence.active, 12) * 0.18)
    + ((skillEvidence.confidence || 0) * 0.16),
  );
  const rexOutreachScore = roundScore(
    (providerReady(providers.n8nWorkflows) ? 34 : 0)
    + (scoreLinear(Number(capabilityCounts.proactiveOutreachRules || 0), 10) * 0.42)
    + (scoreLinear(Number(state.status?.activeNurturePlans || 0), 25) * 0.12)
    + (providerReady(providers.instantly) ? 12 : 0),
  );
  const rexRollbackScore = roundScore(
    (providerReady(providers.render) ? 18 : 0)
    + (providerReady(providers.slack) || slackHealth.slack?.interactiveReady ? 18 : 0)
    + (scoreLinear(Number(capabilityCounts.selfImprovementDecisions || 0), 50) * 0.2)
    + (scoreLinear(policyOutcomeCount, 150) * 0.18)
    + (killSwitchActive ? 0 : 14)
    + (pendingWork.length ? 6 : 12),
  );

  const metrics = [
    makeMetric({
      id: 'ava_voice_provider_readiness',
      owner: 'ava',
      label: 'Voice provider readiness',
      score: scoreLinear(voiceReadyCount, 4),
      weight: 10,
      target: 'Telnyx, Deepgram, browser voice, and ElevenLabs all ready',
      evidence: { voiceReadyCount, required: 4 },
      action: voiceReadyCount === 4 ? 'Keep live voice probes running.' : 'Fix missing voice provider env/config.',
    }),
    makeMetric({
      id: 'ava_live_hearing_proof',
      owner: 'ava',
      label: 'Caller hearing and transcript proof',
      score: transcriptQualityScore,
      weight: 14,
      target: 'Recent answered calls produce high-confidence Deepgram transcript rows',
      evidence: transcriptEvidence,
      action: transcriptEvidence.count ? 'Add ground-truth WER labels to make this an accuracy metric.' : 'Run an answered inbound call with debug:telnyx-live.',
    }),
    makeMetric({
      id: 'ava_response_latency',
      owner: 'ava',
      label: 'Ava response latency',
      score: responseLatencyScore,
      weight: 10,
      target: 'Under 1 second from seller stop to Ava speech start',
      evidence: responseLatencyInstrumented ? { responseLatencyMs } : { instrumented: false, proxy: 'voice ready + transcript evidence only' },
      action: responseLatencyInstrumented ? 'Track p50/p95 by call turn.' : 'Instrument speech-final to reply-start and TTS playback-start timestamps.',
    }),
    makeMetric({
      id: 'ava_emotion_detection',
      owner: 'ava',
      label: 'Emotion detection and transition model',
      score: emotionScore,
      weight: 13,
      target: 'External/ONNX world model with 500+ real decisions and emotion rows',
      evidence: { hasWorldModel, decisionCount, callEmotionCount, memoryCount, emotionalLearningInteractions, emotionalLearningMemory, policyOutcomeCount, provider: emotional.worldModelProvider || 'unknown' },
      action: hasWorldModel && decisionCount >= 500 ? 'Keep validating drift.' : 'Collect real call transitions, then train/export ONNX.',
    }),
    makeMetric({
      id: 'ava_memory_recall',
      owner: 'ava',
      label: 'Conversation memory and recall',
      score: memoryScore,
      weight: 12,
      target: 'Durable memories, learning sessions, and replay-buffer decisions',
      evidence: {
        activeMemories: Number(state.status?.avaActiveMemories || 0),
        learningSessions: Number(state.status?.avaLearningSessions || 0),
        decisionCount,
        memoryCount,
        emotionalLearningMemory,
      },
      action: memoryScore >= 90 ? 'Start periodic recall audits.' : 'Tie every live call transcript to lead memory and decision rows.',
    }),
    makeMetric({
      id: 'ava_tool_use_correctness',
      owner: 'ava',
      label: 'Tool use and orchestration correctness',
      score: toolScore,
      weight: 12,
      target: 'Agent orchestration up, providers ready, and tool usage recorded',
      evidence: {
        readyProviders,
        providerTarget: providerNames.length,
        agentOrchestration: health.components?.agentOrchestration?.status || 'unknown',
        conversationToolUse: Number(state.status?.toolUsage?.pbk_ava_conversation_intelligence || 0),
      },
      action: toolScore >= 90 ? 'Keep smoke tests on every deploy.' : 'Fix provider readiness or missing tool-use persistence.',
    }),
    makeMetric({
      id: 'ava_safety_guardrails',
      owner: 'ava',
      label: 'Offer/contract safety guardrails',
      score: safetyScore,
      weight: 14,
      target: 'Approval-gated high-risk actions, active Slack approvals, no kill switch',
      evidence: { mode, killSwitchActive, pendingWork: pendingWork.length, slackInteractiveReady: Boolean(slackHealth.slack?.interactiveReady), stateBackend: health.features?.stateBackend || 'unknown' },
      action: pendingWork.length ? 'Clear backlog so safety signals are visible.' : 'Add safety critic scoring before any full-autopilot provider write.',
    }),
    makeMetric({
      id: 'ava_closed_loop_learning',
      owner: 'ava',
      label: 'Closed-loop learning from outcomes',
      score: closedLoopScore,
      weight: 13,
      target: 'Training-ready decisions, policy outcomes, skill outcomes, and reward trend',
      evidence: { trainingReadyCount, policyOutcomeCount, skillOutcomeUses: skillEvidence.uses, selfImprovementDecisions: Number(capabilityCounts.selfImprovementDecisions || 0), emotionalLearningInteractions, emotionalLearningMemory, averageReward },
      action: closedLoopScore >= 90 ? 'Enable stricter auto-promotion thresholds.' : 'Record outcome/reward after every call and campaign action.',
    }),
    makeMetric({
      id: 'ava_voice_naturalness',
      owner: 'ava',
      label: 'Emotion-synchronized voice naturalness',
      score: voiceNaturalnessScore,
      weight: 8,
      target: 'Streaming TTS plus emotion prosody plans grounded in real emotion state',
      evidence: { voiceReadyCount, voiceProsodyPlans: Number(capabilityCounts.voiceProsodyPlans || 0), elevenLabsReady: providerReady(providers.elevenLabs || providers.elevenlabs) },
      action: voiceNaturalnessScore >= 90 ? 'Start MOS/rating capture after calls.' : 'Use emotion prosody plans on live replies and capture seller reaction.',
    }),
    makeMetric({
      id: 'ava_controlled_autonomy',
      owner: 'ava',
      label: 'Controlled autonomy',
      score: autonomyScore,
      weight: 9,
      target: 'Autopilot for low-risk actions with approval gates for high-risk writes',
      evidence: { mode, selfImprovementDecisions: Number(capabilityCounts.selfImprovementDecisions || 0), skillOutcomeUses: skillEvidence.uses, pendingWork: pendingWork.length },
      action: autonomyScore >= 90 ? 'Graduate one medium-risk workflow behind safety critic.' : 'Auto-apply only low-risk script improvements with rollback monitoring.',
    }),
    makeMetric({
      id: 'rex_brain_research',
      owner: 'rex',
      label: 'Brain research and current-data reasoning',
      score: rexResearchScore,
      weight: 15,
      target: 'Indexed Brain, Brain Blog, live web search, and DeepSeek strategist ready',
      evidence: {
        sourcesIndexed: Number(state.status?.sourcesIndexed || 0),
        brainBlogPosts: Number(state.status?.brainBlogPosts || 0),
        webSearchReady: providerReady(providers.webSearch) || providerReady(providers.tavily),
        deepSeekReady: providerReady(providers.deepSeek),
      },
      action: rexResearchScore >= 90 ? 'Run citation/factuality evals.' : 'Increase indexed sources and verify web-search fallback.',
    }),
    makeMetric({
      id: 'rex_goal_planning',
      owner: 'rex',
      label: 'Goal planning and post-call coaching',
      score: rexPlanningScore,
      weight: 14,
      target: 'Goal plans and coaching reports produce applied decisions',
      evidence: { goalPlans: Number(capabilityCounts.goalPlans || 0), postCallCoachingReports: Number(capabilityCounts.postCallCoachingReports || 0), appliedRexDecisions: rexEvidence.applied },
      action: rexPlanningScore >= 90 ? 'Schedule daily KPI replanning.' : 'Have Rex decompose one business goal daily and track applied outcomes.',
    }),
    makeMetric({
      id: 'rex_experiment_quality',
      owner: 'rex',
      label: 'Experiment quality and self-improvement',
      score: rexExperimentScore,
      weight: 16,
      target: 'Self-improvement decisions tied to skill and policy outcomes',
      evidence: { selfImprovementDecisions: Number(capabilityCounts.selfImprovementDecisions || 0), skillOutcomeUses: skillEvidence.uses, rexExperiments: rexEvidence.experimentCount, policyOutcomeCount, skillConfidence: skillEvidence.confidence },
      action: rexExperimentScore >= 90 ? 'Raise statistical confidence thresholds.' : 'Record wins/losses for every Rex experiment and low-risk skill change.',
    }),
    makeMetric({
      id: 'rex_cross_lead_transfer',
      owner: 'rex',
      label: 'Cross-lead skill transfer',
      score: rexTransferScore,
      weight: 12,
      target: 'Skill transfer recommendations are applied and measured',
      evidence: { recommendations: Number(capabilityCounts.skillTransferRecommendations || 0), transferCount: rexEvidence.transferCount, activeSkills: skillEvidence.active, skillConfidence: skillEvidence.confidence },
      action: rexTransferScore >= 90 ? 'Expand to lead-segment-specific transfer thresholds.' : 'Apply and measure more transferred skills across similar leads.',
    }),
    makeMetric({
      id: 'rex_proactive_outreach',
      owner: 'rex',
      label: 'Proactive outreach automation',
      score: rexOutreachScore,
      weight: 12,
      target: 'Event-driven outreach rules with n8n/Instantly ready',
      evidence: { n8nReady: providerReady(providers.n8nWorkflows), instantlyReady: providerReady(providers.instantly), proactiveRules: Number(capabilityCounts.proactiveOutreachRules || 0), activeNurturePlans: Number(state.status?.activeNurturePlans || 0) },
      action: rexOutreachScore >= 90 ? 'Connect rule outcomes to profit KPIs.' : 'Create more event-triggered follow-up rules and track conversion.',
    }),
    makeMetric({
      id: 'rex_rollback_safety',
      owner: 'rex',
      label: 'Rollback and self-healing safety',
      score: rexRollbackScore,
      weight: 13,
      target: 'Render/Slack ready, kill switch clear, and experiments have rollback evidence',
      evidence: { renderReady: providerReady(providers.render), slackReady: providerReady(providers.slack) || Boolean(slackHealth.slack?.interactiveReady), selfImprovementDecisions: Number(capabilityCounts.selfImprovementDecisions || 0), policyOutcomeCount, killSwitchActive, pendingWork: pendingWork.length },
      action: rexRollbackScore >= 90 ? 'Require rollback proof on every promoted experiment.' : 'Add rollback records to every auto-applied low-risk experiment.',
    }),
  ];

  const avaMetrics = metrics.filter((metric) => metric.owner === 'ava');
  const rexMetrics = metrics.filter((metric) => metric.owner === 'rex');
  const avaScore = weightedAverage(avaMetrics);
  const rexScore = weightedAverage(rexMetrics);
  const overallScore = weightedAverage(metrics);
  const actions = buildActions({ state, agentDecisions, emotionPolicies, messages, metrics });

  return {
    ok: Boolean(health.ok) && metrics.every((metric) => metric.score >= 40),
    generatedAt: (options.now || new Date()).toISOString(),
    baseUrl: options.baseUrl || BASE_URL,
    targetScore: TARGET_SCORE,
    overall: {
      score: overallScore,
      grade: gradeScore(overallScore),
      readiness: readinessLabel(overallScore),
      verdict: overallScore >= 97
        ? 'Ava/Rex are operating at 10-candidate level with measured proof.'
        : overallScore >= 90
          ? 'Ava/Rex are excellent, with a short path to 10/10 proof.'
          : overallScore >= 80
            ? 'Ava/Rex are production-strong, but not yet a measured 10/10.'
            : 'Ava/Rex are useful but still need data, instrumentation, or safety closure before 10/10.',
    },
    agents: {
      ava: {
        score: avaScore,
        grade: gradeScore(avaScore),
        readiness: readinessLabel(avaScore),
      },
      rex: {
        score: rexScore,
        grade: gradeScore(rexScore),
        readiness: readinessLabel(rexScore),
      },
    },
    dataTargets: {
      realCallOutcomes: {
        current: decisionCount,
        firstLearning: 100,
        strongModel: 500,
        competitiveAdvantage: 1000,
      },
      callEmotionRows: {
        current: callEmotionCount,
        firstLearning: 100,
        strongModel: 500,
        competitiveAdvantage: 1000,
      },
      emotionalPolicyOutcomes: {
        current: policyOutcomeCount,
        firstLearning: 25,
        strongModel: 150,
      },
      emotionalLearningInteractions: {
        current: emotionalLearningInteractions,
        firstLearning: 25,
        strongModel: 500,
        competitiveAdvantage: 1000,
      },
      emotionalLearningMemories: {
        current: emotionalLearningMemory,
        firstLearning: 10,
        strongModel: 300,
      },
    },
    metrics,
    actions,
    evidence: {
      healthStatus: health.status || 'unknown',
      stateBackend: health.features?.stateBackend || 'unknown',
      mode,
      pendingWork: pendingWork.length,
      providersReady: readyProviders,
      providerTarget: providerNames.length,
      transcriptEvidence,
      skillEvidence,
      rexEvidence,
    },
  };
}

async function requestJson(pathname, { auth = true } = {}) {
  if (auth && !API_KEY) {
    return {
      ok: false,
      status: 0,
      parsed: null,
      error: 'PBK_BRIDGE_API_KEY is not set in this shell.',
    };
  }
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${API_KEY}`;
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, { headers });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 800) };
    }
    return { ok: response.ok, status: response.status, parsed };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      parsed: null,
      error: error?.message || String(error),
    };
  }
}

async function collectProductionInputs() {
  const requests = await Promise.all([
    requestJson('/health', { auth: false }),
    requestJson('/state'),
    requestJson('/api/messages?limit=25'),
    requestJson('/api/calls?limit=25'),
    requestJson('/api/agent-decisions?limit=100'),
    requestJson('/api/emotion/policies/experiments'),
    requestJson('/api/skills/outcomes'),
    requestJson('/api/rex/decisions?limit=100'),
    requestJson('/api/intelligence/capabilities'),
    requestJson('/api/slack/health?force=1'),
  ]);
  const [
    health,
    state,
    messages,
    calls,
    agentDecisions,
    emotionPolicies,
    skills,
    rexDecisions,
    capabilities,
    slackHealth,
  ] = requests;

  return {
    health: health.parsed || {},
    state: state.parsed || {},
    messages: messages.parsed || {},
    calls: calls.parsed || {},
    agentDecisions: agentDecisions.parsed || {},
    emotionPolicies: emotionPolicies.parsed || {},
    skills: skills.parsed || {},
    rexDecisions: rexDecisions.parsed || {},
    capabilities: capabilities.parsed || {},
    slackHealth: slackHealth.parsed || {},
    requestStatus: {
      health: { ok: health.ok, status: health.status, error: health.error || '' },
      state: { ok: state.ok, status: state.status, error: state.error || '' },
      messages: { ok: messages.ok, status: messages.status, error: messages.error || '' },
      calls: { ok: calls.ok, status: calls.status, error: calls.error || '' },
      agentDecisions: { ok: agentDecisions.ok, status: agentDecisions.status, error: agentDecisions.error || '' },
      emotionPolicies: { ok: emotionPolicies.ok, status: emotionPolicies.status, error: emotionPolicies.error || '' },
      skills: { ok: skills.ok, status: skills.status, error: skills.error || '' },
      rexDecisions: { ok: rexDecisions.ok, status: rexDecisions.status, error: rexDecisions.error || '' },
      capabilities: { ok: capabilities.ok, status: capabilities.status, error: capabilities.error || '' },
      slackHealth: { ok: slackHealth.ok, status: slackHealth.status, error: slackHealth.error || '' },
    },
  };
}

async function main() {
  const inputs = await collectProductionInputs();
  if (MEMORY_STATS) {
    const output = buildMemoryStats(inputs);
    console.log(JSON.stringify(output, null, 2));
    if (STRICT && (!output.ok || Object.values(inputs.requestStatus).some((status) => status.ok === false))) {
      process.exit(1);
    }
    return;
  }
  const scorecard = buildIntelligenceScorecard(inputs, { baseUrl: BASE_URL });
  const privateFailures = Object.entries(inputs.requestStatus)
    .filter(([, status]) => status.ok === false)
    .map(([name, status]) => ({ name, ...status }));
  const output = {
    ...scorecard,
    ok: scorecard.ok && privateFailures.length === 0,
    requestStatus: inputs.requestStatus,
    privateFailures,
  };
  console.log(JSON.stringify(output, null, 2));
  if (STRICT && (output.overall.score < TARGET_SCORE || privateFailures.length)) {
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
