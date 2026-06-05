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
} = {}) {
  const skills = arrayOr(outcomesResponse.skills).map((skill) => {
    const id = String(skill.id || skill.skillId || skill.skill_id || skill.name || '').trim();
    const trend = trendsBySkillId[id] || trendsBySkillId[skill.name] || {};
    return normalizeSkillMetric(skill, trend);
  });
  return {
    source: outcomesResponse.source || 'runtime',
    generatedAt: outcomesResponse.generatedAt || '',
    warning: outcomesResponse.warning || '',
    skills,
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
