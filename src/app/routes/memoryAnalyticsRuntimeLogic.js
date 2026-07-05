import { numberOr, percentValue } from './analyticsRuntimeLogic.js';

function arrayOr(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeConfidence(value) {
  const numeric = numberOr(value, 0);
  return Math.max(0, Math.min(100, Math.round(Math.abs(numeric) <= 1 ? numeric * 100 : numeric)));
}

function normalizeTrend(response = {}, fallbackRate = 0) {
  const points = arrayOr(response.points || response.trend || response.history)
    .map((point) =>
      numberOr(point.successRate ?? point.success_rate ?? point.rate ?? point.value, Number.NaN)
    )
    .filter((value) => Number.isFinite(value))
    .map((value) => percentValue(value, 1));
  return points.length ? points : [percentValue(fallbackRate, 1)];
}

function warningText(value) {
  if (typeof value === 'string') return value.trim();
  if (value instanceof Error) return value.message.trim();
  return '';
}

function collectWarnings(...values) {
  const seen = new Set();
  return values
    .flat()
    .map(warningText)
    .filter((warning) => {
      if (!warning || seen.has(warning)) return false;
      seen.add(warning);
      return true;
    })
    .join(' ');
}

export function normalizeSkillMetric(skill = {}, trendResponse = {}) {
  const uses = Math.max(0, Math.round(numberOr(skill.uses ?? skill.usage ?? skill.attempts, 0)));
  const wins = Math.max(0, Math.round(numberOr(skill.wins ?? skill.successes, 0)));
  const losses = Math.max(0, Math.round(numberOr(skill.losses ?? skill.failures, 0)));
  const successRate =
    skill.successRate !== undefined || skill.success_rate !== undefined
      ? percentValue(skill.successRate ?? skill.success_rate, 1)
      : uses
        ? Number(((wins / uses) * 100).toFixed(1))
        : 0;
  const id = String(skill.id || skill.skillId || skill.skill_id || skill.name || '').trim();
  return {
    id,
    name: String(skill.name || skill.skillName || skill.skill_name || 'Unnamed skill').trim(),
    agentName: String(skill.agentName || skill.agent_name || '').trim(),
    usage: uses,
    wins,
    losses,
    successRate,
    confidence: normalizeConfidence(skill.confidence),
    status: String(skill.status || skill.level || '').trim(),
    source: String(skill.source || '').trim(),
    trend: normalizeTrend(trendResponse, successRate),
  };
}

export function buildMemoryAnalyticsViewModel({
  outcomesResponse = {},
  trendsBySkillId = {},
  experimentsResponse = {},
  memoryEventsResponse = {},
} = {}) {
  const skills = arrayOr(outcomesResponse.skills).map((skill) => {
    const id = String(skill.id || skill.skillId || skill.skill_id || skill.name || '').trim();
    const trend = trendsBySkillId[id] || trendsBySkillId[skill.name] || {};
    return normalizeSkillMetric(skill, trend);
  });
  const trendWarnings = Object.values(trendsBySkillId || {}).map((trend) =>
    trend && typeof trend === 'object' ? trend.warning : ''
  );
  const events = arrayOr(memoryEventsResponse.events).map((event) => ({
    ...(() => {
      const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
      const score = numberOr(event.score ?? metadata.score, Number.NaN);
      return {
        id: String(
          event.id || event.eventId || event.event_id || event.createdAt || event.created_at || ''
        ).trim(),
        type: String(
          event.type || event.eventType || event.event_type || event.category || 'memory_event'
        ).trim(),
        title: String(
          event.title ||
            event.summary ||
            event.text ||
            event.skillName ||
            event.skill_name ||
            'Memory event'
        ).trim(),
        detail: String(
          event.detail || event.description || event.reason || event.outcome || ''
        ).trim(),
        agentName: String(event.agentName || event.agent_name || event.agent || '').trim(),
        createdAt: String(
          event.createdAt || event.created_at || event.at || event.timestamp || ''
        ).trim(),
        source: String(event.source || metadata.source || memoryEventsResponse.source || '').trim(),
        sourceHref: String(
          event.sourceHref ||
            event.source_href ||
            event.sourceUrl ||
            event.source_url ||
            metadata.sourceHref ||
            metadata.source_href ||
            metadata.sourceUrl ||
            metadata.source_url ||
            ''
        ).trim(),
        skillName: String(event.skillName || event.skill_name || metadata.skillName || '').trim(),
        leadId: String(event.leadId || event.lead_id || metadata.leadId || '').trim(),
        callId: String(event.callId || event.call_id || metadata.callId || '').trim(),
        chatId: String(event.chatId || event.chat_id || metadata.chatId || '').trim(),
        campaignId: String(
          event.campaignId || event.campaign_id || metadata.campaignId || ''
        ).trim(),
        confidence: normalizeConfidence(event.confidence ?? metadata.confidence ?? score),
        success:
          event.success === true || metadata.success === true
            ? true
            : event.success === false || metadata.success === false
              ? false
              : null,
        score: Number.isFinite(score) ? score : null,
        metadata,
      };
    })(),
  }));
  return {
    source: outcomesResponse.source || 'runtime',
    generatedAt: outcomesResponse.generatedAt || '',
    warning: collectWarnings(
      outcomesResponse.warning,
      memoryEventsResponse.warning,
      experimentsResponse.warning,
      trendWarnings
    ),
    skills,
    events,
    experiments: arrayOr(experimentsResponse.experiments || experimentsResponse.tests).map(
      (experiment) => {
        const stats =
          experiment.stats && typeof experiment.stats === 'object' ? experiment.stats : {};
        const statVariants = arrayOr(stats.variants);
        const statById = new Map(
          statVariants.map((variant) => [
            String(variant.variantId || variant.id || '').trim(),
            variant,
          ])
        );
        const variants = arrayOr(experiment.variants).map((variant) => {
          const id = String(variant.id || variant.variantId || variant.name || '').trim();
          const stat = statById.get(id) || {};
          const total = numberOr(stat.total ?? variant.attempts ?? variant.uses, 0);
          const wins = numberOr(stat.wins ?? variant.successes ?? variant.wins, 0);
          const successRate = stat.successRate ?? variant.successRate ?? variant.rate;
          return {
            ...variant,
            id,
            name: String(variant.name || variant.label || stat.label || id || 'Variant').trim(),
            attempts: total,
            successes: wins,
            rate:
              successRate !== null && successRate !== undefined
                ? percentValue(successRate, 1)
                : total
                  ? percentValue(wins / total, 1)
                  : 0,
          };
        });
        return {
          id: String(experiment.id || experiment.name || '').trim(),
          name: String(
            experiment.name ||
              experiment.policyName ||
              experiment.policy_name ||
              experiment.testName ||
              experiment.test_name ||
              'Experiment'
          ).trim(),
          status: String(stats.status || experiment.status || '').trim(),
          confidence: normalizeConfidence(experiment.confidence ?? stats.total),
          variants,
        };
      }
    ),
  };
}
