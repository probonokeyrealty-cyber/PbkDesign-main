import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { controlledExecution } from './controlled-execution-scope.mjs';
import { evaluateStoppingAgent, induceWorkflowMemory } from './research-additives.mjs';
import { consultNurtureAgentCore } from './nurture-agent.mjs';
import { controlledWorkflowInput } from './controlled-agent-workflow.mjs';
import { workflowTestOutputs } from './controlled-workflow-test-fixtures.mjs';

const monolith = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = monolith.indexOf('function getLocalAgentRegistryHandlers(');
const registrySource = monolith.slice(start, monolith.indexOf('\n}', start) + 2);
const fixture = { leadId: 'fixture', callId: 'fixture-call' };

test('actual Rex retrieval keeps QA-derived quoted PBK data out of operator doctrine routing', async () => {
  const actualFunction = name => {
    const index = monolith.indexOf(`function ${name}(`);
    assert(index >= 0);
    return monolith.slice(index, monolith.indexOf('\n}', index) + 2);
  };
  const state = { status: {}, brainBlogPosts: [], approvals: [], brainDocs: [{ id: 'fixture-source',
    title: 'Controlled seller relocation deadline', summary: 'Seller needs to sell within thirty days because of relocation.',
    citation: 'controlled-qualification:fixture-run', createdAt: new Date().toISOString() }] };
  const sandbox = vm.createContext({ controlledExecution, state,
    recordToolUse() {}, makeActivity: value => value, normalizeConversationMessages: () => [], getLastUserMessage: (_messages, query) => query,
    looksLikeBrowserResearchIntent: () => false, mentionsTelnyxNumberAdminIntent: () => false,
    getPendingRuntimeApprovals: () => [], getPbkCoreDoctrineText: () => 'Five PBK paths.', PBK_CORE_DEAL_PATHS: [],
    brainBlogPostToDoc: value => value,
    buildRexConversationalBrainResponse: async (_state, params) => params.baseResponse,
  });
  for (const name of ['scoreBrainDocMatch', 'looksLikePbkDoctrineQuery', 'buildRexDoctrineAnswer', 'answerBrainQuery',
    'looksLikeReadableSummaryQuery', 'looksLikeRexTroubleshootingQuery', 'looksLikeOpenAiWebSearchIntent', 'looksLikeAdminIntent'])
    vm.runInContext(actualFunction(name), sandbox);
  const methodStart = monolith.indexOf('  async getBrainState(params = {}) {');
  const methodEnd = monolith.indexOf('\n  async launchBrowserResearch(', methodStart);
  vm.runInContext(`var toolHandlers = {${monolith.slice(methodStart, methodEnd)}}`, sandbox);
  const qa = workflowTestOutputs(fixture)['qa-agent'];
  qa.result = { ok: true, result: 'recommendation', lead: { id: fixture.leadId, name: 'PBK Controlled Qualification', score: 50, stage: 'cold' },
    recommendation: { channel: 'email', urgency: 'later', reason: 'Lead is warm but not urgent; start with a low-friction email.' } };
  const input = { ...controlledWorkflowInput('rex', fixture, { agentId: 'qa-agent', output: qa }), readOnly: true };
  const organic = await sandbox.toolHandlers.getBrainState(input);
  assert(organic.citations.includes('PBK runtime doctrine'), 'normal operator doctrine routing must stay unchanged');
  await controlledExecution.run({}, async () => {
    const result = await sandbox.toolHandlers.getBrainState(input);
    assert.equal(result.query, input.query, 'the actual QA-derived query must remain intact');
    assert(result.citations.includes(state.brainDocs[0].citation), 'Rex must cite the actual retrieved source');
    assert.equal(result.matches[0].id, 'fixture-source');
    assert(result.answer.includes(state.brainDocs[0].summary));
    state.brainDocs = [];
    const missing = await sandbox.toolHandlers.getBrainState(input);
    assert.equal(missing.citations.length, 0, 'no source must not fabricate a fixture citation');
  });
});

test('actual registry Ava passes Rex answer directly to conversation engine, not canned command routing', async () => {
  let consumed;
  const sandbox = vm.createContext({ controlledExecution, toolHandlers: {
    getAvaConversationIntelligence: async input => { consumed = input; return { ok: true, answer: input.query }; },
    runAgentCommand: async () => { throw new Error('canned_command_route_forbidden'); },
  } });
  vm.runInContext(registrySource, sandbox);
  await controlledExecution.run({}, async () => {
    for (const answer of ['Confirm the relocation deadline.', 'Clarify the estate executor authority.']) {
      const input = controlledWorkflowInput('ava', fixture, { agentId: 'rex', output: { answer, citations: ['fixture'] } });
      const result = await sandbox.getLocalAgentRegistryHandlers().ava(input);
      assert.equal(consumed.query, answer);
      assert.equal(consumed.transcript, answer);
      assert.equal(result.response.answer, answer);
    }
  });
});

test('actual research handler changes risk flags from preceding Ava output; actual Hermes learns intervention', async () => {
  const sandbox = vm.createContext({ controlledExecution, induceWorkflowMemoryCore: induceWorkflowMemory,
    toolHandlers: { evaluateStoppingAgent: async input => evaluateStoppingAgent(input) } });
  vm.runInContext(registrySource, sandbox);
  await controlledExecution.run({}, async () => {
    const outputs = workflowTestOutputs(fixture);
    const evaluate = async answer => {
      const previous = { agentId: 'ava', output: { ...outputs.ava, response: { ok: true, answer } } };
      return sandbox.getLocalAgentRegistryHandlers()['research-orchestrator'](controlledWorkflowInput('research-orchestrator', fixture, previous));
    };
    const baseline = await evaluate('Confirm the timeline.');
    const legal = await evaluate('The seller asked for an attorney.');
    assert.equal(baseline.flags.includes('legal_escalation'), false);
    assert.equal(legal.flags.includes('legal_escalation'), true);
    for (const intervention of [baseline.intervention, 'Honor the no-contact request and retain the stop reason.']) {
      const output = { ...baseline, intervention };
      const input = controlledWorkflowInput('hermes', fixture, { agentId: 'research-orchestrator', output });
      const learned = await sandbox.getLocalAgentRegistryHandlers().hermes(input);
      assert.equal(learned.pattern.workflow.steps[0], intervention);
      assert(learned.strategy.includes(intervention));
    }
  });
});

test('actual nurture engine persists analyzer-derived score and changes recommendation without fixture stage defaults', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.lead_profiles(id text PRIMARY KEY, workspace_id text, external_id text, source text,
      status text, stage text, temperature text, lead_name text, first_name text, last_name text, email text, phone text,
      address text, city text, state text, postal_code text, motivation_score numeric, engagement_score numeric,
      assigned_agent text, raw jsonb, created_at timestamptz, updated_at timestamptz);`);
    const pool = { controlled: true, query: (sql, args) => db.query(sql, args) };
    const outputs = workflowTestOutputs(fixture);
    for (const [score, channel] of [[25, 'email'], [65, 'sms'], [90, 'call']]) {
      const analysis = { ...outputs['call-analyzer'], analyses: [{ ...outputs['call-analyzer'].analyses[0], score }] };
      const input = controlledWorkflowInput('nurture-agent', fixture, { agentId: 'call-analyzer', output: analysis });
      const output = await consultNurtureAgentCore(pool, { ...input, leadId: `fixture-${score}`, phone: '', email: '' });
      assert.equal(output.lead.score, score);
      assert.equal(output.recommendation.channel, channel);
      const row = (await db.query('SELECT * FROM public.lead_profiles WHERE id=$1', [`fixture-${score}`])).rows[0];
      assert.equal(Number(row.engagement_score), score);
      assert.equal(row.phone, '');
      assert.equal(row.email, '');
    }
  } finally { await db.close(); }
}, 30000);
