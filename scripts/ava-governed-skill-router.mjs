function normalize(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function list(value) {
  if (Array.isArray(value)) return value.map(normalize).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,|\n]/)
      .map(normalize)
      .filter(Boolean);
  }
  return [];
}

function stableBucket(value = '') {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function equalsOne(actual = '', expected = []) {
  const normalizedActual = normalize(actual);
  return Boolean(normalizedActual && list(expected).includes(normalizedActual));
}

function scopeValues(...values) {
  return values.flatMap((value) => list(value));
}

function scopeMatches(skill = {}, context = {}) {
  const scope = skill.scope && typeof skill.scope === 'object' ? skill.scope : {};
  const type = normalize(scope.type || 'global');
  if (!type || type === 'global') return true;

  const matchers = {
    workspace: () =>
      equalsOne(
        context.workspaceId || context.workspace_id || 'pbk',
        scopeValues(scope.workspaceId, scope.workspace_id, scope.workspaceIds)
      ),
    lead: () =>
      equalsOne(
        context.leadId || context.lead_id,
        scopeValues(scope.leadId, scope.lead_id, scope.leadIds)
      ),
    call: () =>
      equalsOne(
        context.callId || context.call_id,
        scopeValues(scope.callId, scope.call_id, scope.callIds)
      ),
    campaign: () =>
      equalsOne(
        context.campaignId || context.campaign_id,
        scopeValues(scope.campaignId, scope.campaign_id, scope.campaignIds)
      ),
    path: () =>
      equalsOne(
        context.path || context.pathKey || context.selectedPath,
        scopeValues(scope.path, scope.pathKey, scope.paths)
      ),
    stage: () =>
      equalsOne(
        context.stage || context.leadStage,
        scopeValues(scope.stage, scope.leadStage, scope.stages)
      ),
  };
  return typeof matchers[type] === 'function' ? matchers[type]() : false;
}

function rolloutMatches(skill = {}, context = {}) {
  const status = normalize(skill.status || skill.activationStatus);
  if (status === 'active') return true;
  if (status !== 'canary') return false;

  const rolloutPercent = Math.max(0, Math.min(100, Number(skill.rolloutPercent || 0)));
  if (rolloutPercent <= 0) return false;
  if (rolloutPercent >= 100) return true;
  const rolloutKey = String(
    context.rolloutKey ||
      context.leadId ||
      context.lead_id ||
      context.callId ||
      context.call_id ||
      context.sessionId ||
      context.session_id ||
      ''
  ).trim();
  if (!rolloutKey) return false;
  return stableBucket(`${skill.versionId || skill.id || skill.name || ''}:${rolloutKey}`) <
    rolloutPercent;
}

function isEligible(skill = {}, context = {}) {
  return (
    normalize(skill.source) === 'skill_governance' &&
    rolloutMatches(skill, context) &&
    scopeMatches(skill, context)
  );
}

function policyValues(policy = {}, keys = []) {
  return [
    ...new Set(
      keys.flatMap((key) => list(policy[key] ?? policy.when?.[key] ?? policy.conditions?.[key]))
    ),
  ];
}

function textIncludes(haystack = '', value = '') {
  const normalizedHaystack = normalize(haystack).replace(/_/g, ' ');
  const normalizedValue = normalize(value).replace(/_/g, ' ');
  return Boolean(normalizedValue && normalizedHaystack.includes(normalizedValue));
}

function scoreSkill(skill = {}, context = {}) {
  const policy =
    skill.triggerPolicy && typeof skill.triggerPolicy === 'object' ? skill.triggerPolicy : {};
  const transcript = String(context.transcript || context.query || context.text || '');
  const lastObjection = normalize(context.lastObjection || context.objection || '');
  const emotion = normalize(context.emotion || context.sellerEmotion || '');
  const stage = normalize(context.stage || context.leadStage || '');
  const path = normalize(context.path || context.pathKey || context.selectedPath || '');
  const intent = normalize(context.intent || context.sellerIntent || '');
  const reasons = [];
  const matchedTriggers = [];
  let score = 0;

  const objections = policyValues(policy, ['objections', 'objectionTags', 'lastObjections']);
  if (lastObjection && objections.includes(lastObjection)) {
    score += 48;
    reasons.push('objection_match');
    matchedTriggers.push(lastObjection);
  }

  const emotions = policyValues(policy, ['emotions', 'sellerEmotions']);
  if (emotion && emotions.includes(emotion)) {
    score += 34;
    reasons.push('emotion_match');
    matchedTriggers.push(emotion);
  }

  const stages = policyValues(policy, ['stages', 'leadStages']);
  if (stage && stages.includes(stage)) {
    score += 24;
    reasons.push('stage_match');
    matchedTriggers.push(stage);
  }

  const paths = policyValues(policy, ['paths', 'dealPaths']);
  if (path && paths.includes(path)) {
    score += 28;
    reasons.push('path_match');
    matchedTriggers.push(path);
  }

  const intents = policyValues(policy, ['intents', 'sellerIntents']);
  if (intent && intents.includes(intent)) {
    score += 30;
    reasons.push('intent_match');
    matchedTriggers.push(intent);
  }

  const keywords = policyValues(policy, [
    'keywords',
    'phrases',
    'transcriptKeywords',
    'triggerPhrases',
  ]);
  const keywordMatches = keywords.filter((keyword) => textIncludes(transcript, keyword));
  if (keywordMatches.length) {
    score += Math.min(36, 18 + keywordMatches.length * 6);
    reasons.push('keyword_match');
    matchedTriggers.push(...keywordMatches);
  }

  const searchable = `${skill.name || ''} ${skill.instructions || skill.evidence || ''}`;
  if (!reasons.length && transcript) {
    const significantWords = normalize(transcript)
      .split('_')
      .filter((word) => word.length >= 5)
      .slice(0, 18);
    const overlap = significantWords.filter((word) => textIncludes(searchable, word));
    if (overlap.length >= 2) {
      score += Math.min(18, overlap.length * 4);
      reasons.push('instruction_overlap');
      matchedTriggers.push(...overlap);
    }
  }

  const priority = Number(skill.priority);
  if (Number.isFinite(priority)) score += Math.max(0, Math.min(8, (120 - priority) / 15));

  return {
    id: String(skill.id || skill.versionId || skill.name || ''),
    versionId: String(skill.versionId || ''),
    name: String(skill.name || ''),
    score: Number(score.toFixed(3)),
    reasons,
    matchedTriggers: [...new Set(matchedTriggers)],
    skill,
  };
}

export function isGovernedSkillToolAllowed(selection = {}, toolName = '') {
  const selectedSkill = selection.selectedSkill || selection.skill || null;
  if (!selectedSkill) return true;
  const allowlist = Array.isArray(selectedSkill.toolAllowlist)
    ? selectedSkill.toolAllowlist.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  return allowlist.includes(String(toolName || '').trim());
}

export function buildGovernedSkillNextMove(selection = {}) {
  const skill = selection.selectedSkill || null;
  const action = normalize(selection.action);
  const text = String(skill?.instructions || skill?.evidence || '').trim();
  if (!skill || !text || !['cue', 'jump'].includes(action)) return null;
  return {
    type: 'governed_skill',
    source: 'skill-governance',
    reason: `${action}:${skill.id || skill.versionId || skill.name || 'approved_skill'}`,
    text,
    exactNextMove: text,
    governedSkill: {
      id: skill.id || '',
      versionId: skill.versionId || '',
      name: skill.name || '',
      action,
      reasonCodes: Array.isArray(selection.reasonCodes) ? selection.reasonCodes : [],
      toolAllowlist: Array.isArray(skill.toolAllowlist) ? skill.toolAllowlist : [],
    },
  };
}

export function selectGovernedAvaSkill(params = {}) {
  const currentSkillId = String(params.currentSkillId || params.activeSkillId || '').trim();
  const eligible = (Array.isArray(params.skills) ? params.skills : []).filter((skill) =>
    isEligible(skill, params)
  );
  const scored = eligible
    .map((skill) => scoreSkill(skill, params))
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(left.skill.priority || 100) - Number(right.skill.priority || 100) ||
        left.name.localeCompare(right.name)
    );
  const current = scored.find(
    (candidate) =>
      candidate.id === currentSkillId ||
      candidate.versionId === currentSkillId ||
      candidate.skill.activationId === currentSkillId
  );
  const best = scored[0] || null;
  const switchThreshold = Math.max(1, Number(params.switchThreshold || 18));
  const switchMargin = Math.max(0, Number(params.switchMargin || 8));

  let selected = best && best.score >= switchThreshold ? best : null;
  let action = selected ? 'cue' : currentSkillId ? 'clear' : 'none';
  const reasonCodes = [...(selected?.reasons || [])];

  if (current) {
    const strongerCandidate =
      best &&
      best.id !== current.id &&
      best.score >= switchThreshold &&
      best.score >= current.score + switchMargin;
    if (strongerCandidate) {
      selected = best;
      action = 'jump';
      reasonCodes.push('skill_switch');
    } else if (current.score < switchThreshold) {
      selected = null;
      action = 'clear';
      reasonCodes.push('trigger_expired');
    } else {
      selected = current;
      action = 'cue';
    }
  } else if (currentSkillId && !selected) {
    reasonCodes.push('trigger_expired');
  }

  return {
    ok: true,
    result: selected ? 'governed_skill_selected' : 'no_governed_skill_triggered',
    action,
    previousSkillId: currentSkillId,
    selectedSkill: selected?.skill || null,
    score: selected?.score || 0,
    reasonCodes: [...new Set(reasonCodes)],
    matchedTriggers: selected?.matchedTriggers || [],
    candidates: scored.slice(0, 8).map((candidate) => ({
      id: candidate.id,
      versionId: candidate.versionId,
      name: candidate.name,
      score: candidate.score,
      reasons: candidate.reasons,
      matchedTriggers: candidate.matchedTriggers,
    })),
    cue: selected
      ? `${action === 'jump' ? 'Switch to' : 'Cue'} ${
          selected.name
        } because ${[...new Set(reasonCodes)].join(', ') || 'it is the approved active skill'}.`
      : action === 'clear'
        ? 'Clear the prior governed skill because its approved trigger is no longer active.'
        : 'No approved governed skill matched this turn.',
  };
}
