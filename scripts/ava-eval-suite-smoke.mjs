import assert from 'node:assert/strict';
import {
  AVA_CANONICAL_EVAL_SCENARIOS,
  runAvaCanonicalEvalSuite,
} from './ava-eval-suite.mjs';

assert(AVA_CANONICAL_EVAL_SCENARIOS.length >= 20, 'Ava eval suite should include at least 20 canonical seller scenarios.');

const report = runAvaCanonicalEvalSuite();

assert.equal(report.ok, true, 'Canonical Ava eval suite should pass.');
assert.equal(report.failed, 0, 'Canonical Ava eval suite should have zero failures.');
assert(report.coverage.requiredCapabilities.includes('yes_progression'), 'Eval suite should cover simple yes/ack progression.');
assert(report.coverage.requiredCapabilities.includes('no_repeat'), 'Eval suite should cover no-repeat behavior.');
assert(report.coverage.requiredCapabilities.includes('path_discipline'), 'Eval suite should cover path discipline.');
assert(report.coverage.requiredCapabilities.includes('safety_boundary'), 'Eval suite should cover safety boundaries.');

const probateScenario = report.results.find((item) => item.id === 'owner_probate_trust');
assert(probateScenario?.passed, 'Probate trust scenario should pass.');
assert(probateScenario.detected.path === 'cash_offer', 'Probate owner scenario should stay owner-safe cash/RBP, not creative finance.');

const agentScenario = report.results.find((item) => item.id === 'agent_listing_creative_finance');
assert(agentScenario?.passed, 'Agent creative finance scenario should pass.');
assert(agentScenario.detected.callerRole === 'agent', 'Agent scenario should detect caller role.');

console.log('ava-eval-suite smoke passed', {
  scenarios: report.total,
  failed: report.failed,
  coverage: report.coverage.requiredCapabilities.length,
});
