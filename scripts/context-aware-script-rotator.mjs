function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slug(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function hashString(value = '') {
  let hash = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function normalizeScript(raw = {}, index = 0) {
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  const tags = Array.isArray(raw.tags) ? raw.tags.map((tag) => slug(tag)).filter(Boolean) : [];
  const pathKey = slug(raw.pathKey || raw.path_key || metadata.pathKey || metadata.path_key || tags[0] || '');
  return {
    id: String(raw.id || raw.scriptId || raw.script_id || `script-${index}`).trim(),
    title: String(raw.title || raw.name || `Script ${index + 1}`).trim(),
    content: String(raw.content || raw.script || raw.text || raw.body || '').trim(),
    tags,
    pathKey,
    allowedRoles: Array.isArray(raw.allowedRoles || raw.allowed_roles) ? (raw.allowedRoles || raw.allowed_roles).map((role) => slug(role)) : [],
    metadata,
    embedding: normalizeEmbedding(raw.embedding || raw.vector || metadata.embedding || metadata.vector),
    learnedWeight: Math.max(-1, Math.min(1, numberOr(raw.learnedWeight ?? raw.learned_weight ?? metadata.learnedWeight ?? metadata.learned_weight, 0))),
    usageCount: Math.max(0, numberOr(raw.usageCount ?? raw.usage_count ?? metadata.usageCount ?? metadata.usage_count, 0)),
    conversionCount: Math.max(0, numberOr(raw.conversionCount ?? raw.conversion_count ?? metadata.conversionCount ?? metadata.conversion_count, 0)),
    dealValue: Math.max(0, numberOr(raw.dealValue ?? raw.deal_value ?? metadata.dealValue ?? metadata.deal_value, 0)),
  };
}

function normalizeEmbedding(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isFinite).slice(0, 1536);
}

function cosineSimilarity(left = [], right = []) {
  const length = Math.min(left.length, right.length);
  if (!length) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (!leftMagnitude || !rightMagnitude) return null;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function containsAny(haystack = '', needles = []) {
  const normalized = slug(haystack).replace(/_/g, ' ');
  return needles.some((needle) => normalized.includes(slug(needle).replace(/_/g, ' ')));
}

function scoreHistoricalPerformance(script = {}) {
  if (!script.usageCount) return 0;
  const conversionRate = script.conversionCount / Math.max(1, script.usageCount);
  const confidence = Math.min(1, script.usageCount / 30);
  return conversionRate * 24 * confidence;
}

function scoreScript(script = {}, context = {}) {
  let score = 0;
  const reasons = [];
  const pathKey = slug(context.pathKey || context.path_key || context.selectedPath || context.selected_path || '');
  const role = slug(context.callerRole || context.role || '');
  const sentiment = numberOr(context.sentiment ?? context.sellerSentiment ?? context.seller_sentiment, 0);
  const transcript = String(context.transcript || context.query || context.text || '').toLowerCase();
  const lastObjection = slug(context.lastObjection || context.last_objection || '');
  const contextEmbedding = normalizeEmbedding(context.contextEmbedding || context.context_embedding || context.queryEmbedding || context.query_embedding || context.embedding);
  const scriptText = `${script.title} ${script.content} ${script.tags.join(' ')} ${JSON.stringify(script.metadata || {})}`.toLowerCase();

  if (!pathKey || script.pathKey === pathKey || script.tags.includes(pathKey)) {
    score += 30;
    reasons.push('path_match');
  } else {
    score -= 25;
    reasons.push('path_mismatch');
  }

  if (!role || !script.allowedRoles.length || script.allowedRoles.includes(role)) {
    score += 4;
  }

  if (sentiment <= -0.25 && (script.tags.some((tag) => ['empathetic', 'empathy', 'trust', 'calm', 'proof'].includes(tag)) || containsAny(scriptText, ['hear you', 'slow down', 'safe', 'comfortable', 'trust']))) {
    score += 28;
    reasons.push('sentiment_low');
  }

  if (sentiment >= 0.35 && (script.tags.some((tag) => ['urgent', 'close', 'assumptive'].includes(tag)) || containsAny(scriptText, ['today', 'move forward', 'sign', 'close']))) {
    score += 12;
    reasons.push('sentiment_positive');
  }

  if (lastObjection && (script.tags.includes(lastObjection) || containsAny(scriptText, [lastObjection.replace(/_/g, ' ')]))) {
    score += 28;
    reasons.push('objection_match');
  } else if (lastObjection && /price|low|zillow|offer/.test(lastObjection) && containsAny(scriptText, ['price', 'number', 'net', 'offer'])) {
    score += 18;
    reasons.push('objection_family_match');
  }

  if (transcript && containsAny(scriptText, transcript.split(/\s+/).filter((word) => word.length > 4).slice(0, 12))) {
    score += 4;
    reasons.push('transcript_overlap');
  }

  const recentScriptIds = Array.isArray(context.recentScriptIds || context.recent_script_ids) ? (context.recentScriptIds || context.recent_script_ids).map(String) : [];
  const recentLines = Array.isArray(context.recentAvaLines || context.recent_ava_lines) ? (context.recentAvaLines || context.recent_ava_lines).map(String) : [];
  if (recentScriptIds.includes(script.id)) {
    score -= lastObjection ? 95 : 45;
    reasons.push('anti_repeat');
  }
  if (recentLines.some((line) => line && script.content.toLowerCase().slice(0, 90).includes(line.toLowerCase().slice(0, 60)))) {
    score -= 50;
    reasons.push('line_repeated');
  }

  const historical = scoreHistoricalPerformance(script);
  if (historical > 0) {
    score += historical;
    reasons.push('historical_performance');
  }

  const semanticSimilarity = cosineSimilarity(contextEmbedding, script.embedding);
  if (semanticSimilarity !== null) {
    score += Math.max(-20, Math.min(36, semanticSimilarity * 36));
    if (semanticSimilarity >= 0.62) reasons.push('embedding_similarity');
  }

  if (script.learnedWeight) {
    score += script.learnedWeight * 30;
    reasons.push('learned_weight');
  }

  return { script, score: Number(score.toFixed(3)), reasons };
}

export function selectContextAwareScript(params = {}) {
  const scripts = (Array.isArray(params.scripts) ? params.scripts : [])
    .map(normalizeScript)
    .filter((script) => script.content);
  if (!scripts.length) {
    return {
      ok: false,
      result: 'no_scripts',
      selectedScript: null,
      selected: null,
      scoredScripts: [],
      reasonCodes: ['no_scripts'],
    };
  }

  const scoredScripts = scripts
    .map((script) => scoreScript(script, params))
    .sort((left, right) => right.score - left.score || left.script.title.localeCompare(right.script.title));
  const identity = String(params.leadId || params.lead_id || params.callId || params.call_id || params.sessionId || params.session_id || 'anonymous');
  const explorationRate = Math.max(0, Math.min(1, numberOr(params.explorationRate ?? params.exploration_rate, 0.1)));
  const explore = explorationRate > 0 && (hashString(`${identity}:${params.pathKey || ''}`) % 1000) / 1000 < explorationRate;
  const selected = explore
    ? scoredScripts[Math.min(scoredScripts.length - 1, hashString(`${identity}:explore`) % Math.min(3, scoredScripts.length))]
    : scoredScripts[0];
  const reasonCodes = [...new Set([
    ...(selected?.reasons || []),
    ...(scoredScripts.some((item) => item.reasons.includes('anti_repeat')) ? ['anti_repeat'] : []),
    ...(explore ? ['exploration'] : []),
  ])];
  return {
    ok: true,
    result: 'context_aware_script_selected',
    selectedScript: selected?.script || null,
    selected: selected?.script || null,
    score: selected?.score || 0,
    scoredScripts: scoredScripts.slice(0, 8).map((item) => ({
      id: item.script.id,
      title: item.script.title,
      pathKey: item.script.pathKey,
      score: item.score,
      reasons: item.reasons,
      semantic: cosineSimilarity(normalizeEmbedding(params.contextEmbedding || params.context_embedding || params.queryEmbedding || params.query_embedding || params.embedding), item.script.embedding),
      learnedWeight: item.script.learnedWeight,
    })),
    reasonCodes,
    exploration: explore,
    rotationRule: 'Use the selected script only as strategy. Phrase it naturally, avoid repeating prior Ava lines, and keep path language clean.',
  };
}

export function recordScriptOutcomeStats(script = {}, outcome = {}) {
  const normalized = normalizeScript(script);
  const success = typeof outcome.success === 'boolean'
    ? outcome.success
    : /accepted|signed|closed|won|appointment/i.test(String(outcome.outcome || outcome.outcomeLabel || outcome.outcome_label || ''));
  return {
    usageCount: normalized.usageCount + 1,
    conversionCount: normalized.conversionCount + (success ? 1 : 0),
    dealValue: normalized.dealValue + Math.max(0, numberOr(outcome.dealValue ?? outcome.deal_value ?? outcome.assignmentFee ?? outcome.assignment_fee, 0)),
    lastOutcomeLabel: String(outcome.outcomeLabel || outcome.outcome_label || outcome.outcome || (success ? 'success' : 'reviewed')).trim(),
    lastSelectedAt: outcome.createdAt || outcome.created_at || new Date().toISOString(),
  };
}
