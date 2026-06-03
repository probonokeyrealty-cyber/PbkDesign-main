import assert from 'node:assert/strict';

import {
  assertSkillLearnerDatabaseConfigured,
  decayUnderperformingSkills,
  hasSkillLearnerLlmProvider,
  prepareSkillExtractionTranscript,
  runAutoSkillLearner,
} from './auto-skill-learner.mjs';

assert.throws(
  () => assertSkillLearnerDatabaseConfigured({}),
  /PBK_DATABASE_URL\/DATABASE_URL is required/i,
  'Skill learner should fail loudly when no database URL is configured.',
);

assert.equal(
  hasSkillLearnerLlmProvider({}),
  false,
  'Skill extraction should know when no LLM provider is configured.',
);
assert.equal(
  hasSkillLearnerLlmProvider({ OPENAI_API_KEY: 'sk-test' }),
  true,
  'OpenAI key should count as an available LLM provider.',
);

const longTranscript = prepareSkillExtractionTranscript(
  [{ speaker: 'Seller', text: 'x'.repeat(4600) }],
  { maxChars: 4000 },
);
assert.equal(longTranscript.text.length, 4000, 'Skill extraction transcript should be capped at 4000 chars.');
assert.equal(longTranscript.truncated, true, 'Long skill extraction transcripts should report truncation.');
assert.match(
  longTranscript.warning,
  /truncated/i,
  'Long skill extraction transcripts should include a truncation warning.',
);

const decayQueries = [];
const decayPool = {
  async query(sql, params = []) {
    decayQueries.push({ sql, params });
    if (/COUNT\(\*\).*failures/is.test(sql)) {
      return {
        rows: [
          {
            skill_id: 'skill-bad',
            skill_name: 'Bad Close',
            total_uses: 10,
            failures: 8,
            current_confidence: 0.7,
          },
        ],
      };
    }
    if (/UPDATE public\.skills/is.test(sql)) {
      return { rows: [{ id: params[0], name: 'Bad Close', confidence: 0.665 }] };
    }
    return { rows: [] };
  },
};
const decayed = await decayUnderperformingSkills(decayPool, {
  windowDays: 7,
  minFailureCount: 3,
  maxSuccessRateToKeep: 0.5,
  confidenceDecayRate: 0.05,
});
assert.equal(decayed.length, 1, 'One underperforming skill should decay.');
assert.equal(decayed[0].id, 'skill-bad');
assert.equal(decayed[0].confidence, 0.665);

const learnerQueries = [];
let reloadPayload = null;
const learnerPool = {
  async query(sql, params = []) {
    learnerQueries.push({ sql, params });
    if (/CREATE TABLE IF NOT EXISTS public\.skill_usage/is.test(sql)) return { rows: [] };
    if (/HAVING COUNT\(\*\) FILTER \(WHERE success IS TRUE\)/is.test(sql)) return { rows: [] };
    if (/COUNT\(\*\).*failures/is.test(sql)) return { rows: [] };
    if (/FROM public\.calls/is.test(sql)) {
      throw new Error('Skill extraction should be skipped when no LLM provider is configured.');
    }
    return { rows: [] };
  },
};
const learnerResult = await runAutoSkillLearner({
  pool: learnerPool,
  env: {},
  reloadActiveSkills: async (payload) => {
    reloadPayload = payload;
    return { ok: true, result: 'active_skills_reloaded' };
  },
});
assert.equal(learnerResult.ok, true);
assert.equal(learnerResult.extractionSkippedReason, 'llm_provider_unavailable');
assert.equal(learnerResult.createdCount, 0);
assert.equal(learnerResult.decayedCount, 0);
assert.equal(reloadPayload, null, 'No reload should happen when no skills changed.');
assert(
  learnerQueries.some((entry) => /HAVING COUNT\(\*\) FILTER \(WHERE success IS TRUE\)/is.test(entry.sql)),
  'Boost pass should still run when LLM extraction is unavailable.',
);
assert(
  learnerQueries.some((entry) => /COUNT\(\*\).*failures/is.test(entry.sql)),
  'Decay pass should still run when LLM extraction is unavailable.',
);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'auto_skill_learner_smoke_passed',
      decayed: decayed.length,
      extractionSkippedReason: learnerResult.extractionSkippedReason,
    },
    null,
    2,
  ),
);
