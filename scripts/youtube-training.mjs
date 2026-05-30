import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_AGENT_ID = 'ava';
const DEFAULT_TENANT_ID = 'pbk';

const OBJECTION_PATTERNS = [
  {
    tag: 'spouse_approval',
    label: 'spouse approval',
    patterns: [/\b(wife|husband|spouse|partner)\b/i, /\btalk to (my|our)\b/i, /\bshow (it|this) to\b/i],
    fallback:
      'That makes sense. Most people want the decision maker involved. If the terms are clean, what would they need to feel comfortable moving forward?',
  },
  {
    tag: 'price_too_low',
    label: 'price objection',
    patterns: [/\bprice\b/i, /\btoo low\b/i, /\bgive it away\b/i, /\bworth\b/i, /\bnumber\b/i],
    fallback:
      'I hear you. Let us compare the net, not just the headline price: repairs, commissions, time, and certainty. What number would make this worth doing today?',
  },
  {
    tag: 'needs_time',
    label: 'needs time',
    patterns: [/\bthink about it\b/i, /\bnot ready\b/i, /\bneed time\b/i, /\bcall me back\b/i],
    fallback:
      'No pressure. To make this useful, what specific question should we answer before the next call: price, timing, repairs, or paperwork?',
  },
  {
    tag: 'trust_concern',
    label: 'trust concern',
    patterns: [/\bscam\b/i, /\btrust\b/i, /\blegit\b/i, /\bproof\b/i, /\bhow do I know\b/i],
    fallback:
      'Fair question. I can slow down, explain each step, and send everything in writing so you can verify it before deciding.',
  },
  {
    tag: 'repair_concern',
    label: 'repair concern',
    patterns: [/\brepair/i, /\broof\b/i, /\bfoundation\b/i, /\btenant\b/i, /\bdamage\b/i],
    fallback:
      'That is exactly where an as-is offer helps. You do not need to fix, clean, or manage contractors before closing.',
  },
];

const ASSERTION_RULES = [
  {
    capability: 'motivation_probe',
    expectedIntent: 'question',
    keywords: ['thinking', 'selling', 'property'],
    patterns: [/\bwhat (has|had).*selling\b/i, /\bwhy.*sell\b/i, /\bthinking about selling\b/i],
  },
  {
    capability: 'objection_handling',
    expectedIntent: 'objection',
    keywords: ['wife', 'spouse', 'comfortable'],
    patterns: [/\b(wife|husband|spouse|partner)\b/i, /\btalk to\b/i],
  },
  {
    capability: 'price_objection',
    expectedIntent: 'objection',
    keywords: ['price', 'number', 'net'],
    patterns: [/\bprice\b/i, /\btoo low\b/i, /\bnumber\b/i, /\bgive it away\b/i],
  },
  {
    capability: 'urgency_detection',
    expectedIntent: 'urgency',
    keywords: ['fast', 'deadline', 'taxes'],
    patterns: [/\bfast\b/i, /\basap\b/i, /\btax(es)?\b/i, /\bdeadline\b/i, /\bforeclosure\b/i],
  },
  {
    capability: 'as_is_solution',
    expectedIntent: 'solution',
    keywords: ['as-is', 'repairs', 'close'],
    patterns: [/\bas-is\b/i, /\bno repairs\b/i, /\bclose\b/i],
  },
  {
    capability: 'seller_goal_inference',
    expectedIntent: 'goal',
    keywords: ['inherited', 'probate', 'behind'],
    patterns: [/\binherited\b/i, /\bprobate\b/i, /\bbehind\b/i],
  },
];

function stableHash(value, length = 12) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function isYouTubeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'youtu.be'
      || host === 'youtube.com'
      || host === 'm.youtube.com'
      || host === 'music.youtube.com'
      || host === 'youtube-nocookie.com';
  } catch {
    return /(youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtube\.com\/embed\/|youtu\.be\/)/i.test(raw);
  }
}

export function extractYouTubeVideoId(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] || '';
    }
    const watchId = parsed.searchParams.get('v');
    if (watchId) return watchId.trim();
    const segments = parsed.pathname.split('/').filter(Boolean);
    const keyedSegment = ['embed', 'shorts', 'live'].find((segment) => segments.includes(segment));
    if (keyedSegment) {
      const index = segments.indexOf(keyedSegment);
      return segments[index + 1] || '';
    }
  } catch {
    // Fall through to regex parsing.
  }
  const match = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{6,})/i);
  return match?.[1] || '';
}

export function normalizeTranscriptText(input) {
  if (Array.isArray(input)) {
    return normalizeWhitespace(
      input
        .map((item) => {
          if (typeof item === 'string') return item;
          return item?.text || item?.caption || item?.transcript || '';
        })
        .join(' '),
    );
  }
  return normalizeWhitespace(input);
}

function splitTranscriptTurns(transcript) {
  const normalized = normalizeTranscriptText(transcript);
  if (!normalized) return [];
  const lines = normalized
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sourceLines = lines.length > 1
    ? lines
    : normalized.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
  return sourceLines.map((line, index) => {
    const speakerMatch = line.match(/^([A-Za-z][A-Za-z0-9 _-]{0,30}):\s*(.+)$/);
    const speaker = speakerMatch ? speakerMatch[1].trim() : '';
    const text = speakerMatch ? speakerMatch[2].trim() : line;
    const speakerType = /seller|owner|prospect|lead/i.test(speaker)
      ? 'seller'
      : /ava|expert|agent|closer|rep|buyer/i.test(speaker)
        ? 'expert'
        : 'unknown';
    return { index, speaker, speakerType, text };
  });
}

function findNextExpertResponse(turns, startIndex, fallback) {
  for (const turn of turns.slice(startIndex + 1, startIndex + 5)) {
    if (turn.speakerType === 'expert' || turn.speakerType === 'unknown') {
      const text = normalizeWhitespace(turn.text);
      if (text.length >= 20) return text;
    }
  }
  return fallback;
}

function tagsForText(text) {
  return OBJECTION_PATTERNS
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.tag);
}

function ruleForTag(tag) {
  return OBJECTION_PATTERNS.find((rule) => rule.tag === tag) || null;
}

export function extractCoachMemoryEntriesFromTranscript(transcript, options = {}) {
  const sourceUrl = String(options.sourceUrl || options.url || '').trim();
  const agentId = String(options.agentId || options.agent_id || DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;
  const turns = splitTranscriptTurns(transcript);
  const entries = [];
  const seen = new Set();

  for (const turn of turns) {
    const tags = tagsForText(turn.text);
    for (const tag of tags) {
      const rule = ruleForTag(tag);
      const key = `${tag}:${normalizeWhitespace(turn.text).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const response = findNextExpertResponse(turns, turn.index, rule?.fallback || '');
      entries.push({
        id: `yt_${agentId}_${stableHash(`${sourceUrl}:${tag}:${turn.index}:${turn.text}`)}`,
        workspaceId: options.tenantId || options.tenant_id || DEFAULT_TENANT_ID,
        memoryType: 'objection',
        objectionTag: tag,
        objection_tag: tag,
        pathKey: options.pathKey || options.path_key || '',
        prompt: normalizeWhitespace(turn.text),
        response,
        source: 'youtube_training',
        sourceUrl,
        source_url: sourceUrl,
        outcome: 'training_observed',
        score: 0.82,
        metadata: {
          agentId,
          label: rule?.label || tag,
          extractedBy: 'youtube-training-heuristic',
          turnIndex: turn.index,
          speaker: turn.speaker || '',
        },
      });
    }
  }

  return entries;
}

export function buildYouTubeAssertions(transcript, options = {}) {
  const turns = splitTranscriptTurns(transcript);
  const assertions = [];
  const seenCapabilities = new Set();

  for (const turn of turns) {
    for (const rule of ASSERTION_RULES) {
      if (seenCapabilities.has(rule.capability)) continue;
      if (!rule.patterns.some((pattern) => pattern.test(turn.text))) continue;
      seenCapabilities.add(rule.capability);
      assertions.push({
        id: `assert_${rule.capability}_${turn.index}`,
        turnIndex: turn.index,
        expectedIntent: rule.expectedIntent,
        expectedKeywords: rule.keywords,
        requiredCapability: rule.capability,
        evidence: normalizeWhitespace(turn.text).slice(0, 500),
      });
    }
  }

  const transcriptText = normalizeTranscriptText(transcript);
  if (!seenCapabilities.has('conversation_continuity') && transcriptText) {
    assertions.push({
      id: 'assert_conversation_continuity',
      turnIndex: Math.max(0, Math.min(turns.length - 1, 1)),
      expectedIntent: 'contextual_reply',
      expectedKeywords: ['context', 'next step'],
      requiredCapability: 'conversation_continuity',
      evidence: transcriptText.slice(0, 500),
    });
  }

  return assertions.slice(0, Math.max(6, Number(options.limit || 16)));
}

export function buildYouTubeTrainingArtifacts(params = {}) {
  const url = String(params.url || params.sourceUrl || params.source_url || '').trim();
  const transcript = normalizeTranscriptText(params.transcript || params.text || params.content || '');
  const agentId = String(params.agentId || params.agent_id || DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;
  const tenantId = String(params.tenantId || params.tenant_id || DEFAULT_TENANT_ID).trim() || DEFAULT_TENANT_ID;
  const videoId = extractYouTubeVideoId(url);

  if (!isYouTubeUrl(url) || !videoId) {
    return {
      ok: false,
      result: 'invalid_youtube_url',
      error: 'A valid YouTube URL is required.',
      url,
    };
  }
  if (!transcript) {
    return {
      ok: false,
      result: 'missing_transcript',
      error: 'A transcript is required to build training artifacts.',
      url,
      videoId,
    };
  }

  const title = normalizeWhitespace(params.title || `YouTube Training ${videoId}`);
  const assertions = buildYouTubeAssertions(transcript, params);
  const coachMemoryEntries = extractCoachMemoryEntriesFromTranscript(transcript, {
    ...params,
    sourceUrl: url,
    agentId,
    tenantId,
  });
  const generatedAt = new Date().toISOString();
  const hash = stableHash(`${url}\n${agentId}`);
  const transcriptHash = stableHash(transcript);
  const testCase = {
    id: params.id || `yt_case_${videoId}_${hash}`,
    tenantId,
    source: 'youtube',
    sourceUrl: url,
    videoId,
    agentId,
    title,
    transcript,
    assertions,
    coachMemoryEntries,
    status: assertions.length ? 'ready' : 'needs_review',
    metadata: {
      generatedAt,
      transcriptHash,
      assertionSource: 'heuristic',
      coachMemoryCount: coachMemoryEntries.length,
    },
  };
  const brainDoc = {
    id: `yt_brain_${videoId}_${hash}`,
    kind: 'youtube-training',
    topic: params.topic || 'Ava Sales Training',
    title,
    source: params.source || 'youtube',
    sourceUrl: url,
    excerpt: transcript.slice(0, 1200),
    summary: [
      `YouTube training source for ${agentId}.`,
      `Generated ${assertions.length} eval assertions and ${coachMemoryEntries.length} coach memory entries.`,
      transcript.slice(0, 900),
    ].join('\n\n').trim(),
    tags: uniqueStrings([...(params.tags || []), 'youtube-training', agentId, 'eval', 'coach-memory']),
    metadata: {
      videoId,
      agentId,
      tenantId,
      generatedAt,
      testCaseId: testCase.id,
      assertions: assertions.length,
      coachMemoryEntries: coachMemoryEntries.length,
    },
  };

  return {
    ok: true,
    result: 'youtube_training_ready',
    url,
    videoId,
    transcript,
    assertions,
    coachMemoryEntries,
    testCase,
    brainDoc,
  };
}

export async function fetchYouTubeTranscript(url, options = {}) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return { ok: false, result: 'invalid_youtube_url', error: 'Could not parse YouTube video id.', videoId: '' };
  }
  try {
    const mod = await import('youtube-transcript');
    const fetchTranscript = mod.fetchTranscript || mod.default?.fetchTranscript || mod.default;
    if (typeof fetchTranscript !== 'function') {
      return {
        ok: false,
        result: 'transcript_provider_unavailable',
        error: 'youtube-transcript did not expose fetchTranscript.',
        videoId,
      };
    }
    const segments = await fetchTranscript(url, options.transcriptOptions || {});
    const transcript = normalizeTranscriptText(segments);
    return {
      ok: Boolean(transcript),
      result: transcript ? 'transcript_ready' : 'transcript_empty',
      videoId,
      transcript,
      segments,
    };
  } catch (error) {
    return {
      ok: false,
      result: 'transcript_fetch_failed',
      error: error?.message || String(error),
      videoId,
    };
  }
}

export async function processYouTubeTraining(params = {}, hooks = {}) {
  const url = String(params.url || params.sourceUrl || params.source_url || '').trim();
  const agentId = String(params.agentId || params.agent_id || DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;
  if (!isYouTubeUrl(url)) {
    return { ok: false, result: 'invalid_youtube_url', error: 'A YouTube URL is required.', url };
  }

  await hooks.publishEvent?.('youtube.training.started', {
    url,
    agentId,
    requestedBy: params.requestedBy || params.actor || '',
  });

  let transcript = normalizeTranscriptText(params.transcript || params.text || params.content || '');
  let transcriptFetch = null;
  if (!transcript) {
    transcriptFetch = await fetchYouTubeTranscript(url, params);
    if (!transcriptFetch.ok) {
      return {
        ok: false,
        result: 'transcript_unavailable',
        error: transcriptFetch.error || 'YouTube transcript was unavailable.',
        url,
        videoId: transcriptFetch.videoId || extractYouTubeVideoId(url),
        transcriptFetch,
      };
    }
    transcript = transcriptFetch.transcript;
  }

  const artifact = buildYouTubeTrainingArtifacts({
    ...params,
    url,
    transcript,
    agentId,
  });
  if (!artifact.ok) return artifact;

  const stored = hooks.storeTestCase ? await hooks.storeTestCase(artifact.testCase, artifact) : { ok: true, skipped: true };
  const coachStored = hooks.storeCoachMemory
    ? await hooks.storeCoachMemory(artifact.coachMemoryEntries, artifact)
    : { ok: true, skipped: true, count: artifact.coachMemoryEntries.length };
  const brainStored = hooks.storeBrainDoc ? await hooks.storeBrainDoc(artifact.brainDoc, artifact) : { ok: true, skipped: true };

  await hooks.publishEvent?.('youtube.training.ready', {
    url,
    videoId: artifact.videoId,
    agentId,
    testCaseId: artifact.testCase.id,
    assertions: artifact.assertions.length,
    coachMemoryEntries: artifact.coachMemoryEntries.length,
  });

  return {
    ...artifact,
    transcriptFetch,
    stored,
    coachStored,
    brainStored,
  };
}

export function runYouTubeTrainingEvalSuite(testCases = [], options = {}) {
  const readyCases = testCases.filter((testCase) => String(testCase?.status || 'ready') === 'ready');
  const results = readyCases.map((testCase) => {
    const assertions = Array.isArray(testCase.assertions) ? testCase.assertions : [];
    const failedAssertions = assertions.filter((assertion) => {
      return !assertion.expectedIntent
        || !Array.isArray(assertion.expectedKeywords)
        || assertion.expectedKeywords.length === 0
        || !assertion.requiredCapability;
    });
    return {
      id: testCase.id || randomUUID(),
      sourceUrl: testCase.sourceUrl || testCase.source_url || '',
      passed: failedAssertions.length === 0 && assertions.length > 0,
      totalAssertions: assertions.length,
      failedAssertions,
      capabilities: uniqueStrings(assertions.map((assertion) => assertion.requiredCapability)),
    };
  });
  const failed = results.filter((result) => !result.passed).length;
  const coverage = {
    requiredCapabilities: uniqueStrings(results.flatMap((result) => result.capabilities)),
  };
  return {
    ok: failed === 0,
    result: failed === 0 ? 'youtube_eval_passed' : 'youtube_eval_failed',
    suiteName: options.suiteName || 'youtube_training',
    total: results.length,
    passed: results.length - failed,
    failed,
    coverage,
    results,
  };
}

async function readCliTranscript(args) {
  const transcriptArg = args.find((arg) => arg.startsWith('--transcript='));
  if (transcriptArg) return transcriptArg.slice('--transcript='.length);
  const fileArg = args.find((arg) => arg.startsWith('--transcript-file='));
  if (!fileArg) return '';
  return readFile(fileArg.slice('--transcript-file='.length), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const url = (args.find((arg) => arg.startsWith('--url=')) || '').slice('--url='.length);
  const title = (args.find((arg) => arg.startsWith('--title=')) || '').slice('--title='.length);
  const transcript = await readCliTranscript(args);
  const result = await processYouTubeTraining({ url, title, transcript });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
