import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { createControlledAgentStorage, saveControlledAgentResult, readControlledAgentQualification,
  readControlledWorkflowPredecessor } from './controlled-agent-storage.mjs';
import { controlledWorkflowOrder, runControlledAgentWorkflow } from './controlled-agent-workflow.mjs';
import { workflowTestOutputs } from './controlled-workflow-test-fixtures.mjs';

// Real SQL correlation test with injected unit outputs, not live handler qualification.
test('PG stores all eleven linked inputs and rejects corrupted dependencies before downstream dispatch', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.bridge_state(id text PRIMARY KEY, data jsonb);
      CREATE TABLE public.pbk_tasks(id text PRIMARY KEY, metadata jsonb, status text, created_at timestamptz);
      CREATE TABLE public.lead_profiles(id text PRIMARY KEY, source text, phone text, email text, engagement_score numeric);
      INSERT INTO public.lead_profiles VALUES ('customer-sentinel','organic','555','sentinel',0);
      CREATE TABLE public.pbk_agent_decisions(id text PRIMARY KEY, agent_id text, source text, lead_id text, call_id text, metadata jsonb, context jsonb, parameters jsonb);
      CREATE TABLE public.pbk_memories(id text PRIMARY KEY, lead_id text, source_id text, metadata jsonb, content text);
      CREATE TABLE public.pbk_call_analyses(id text PRIMARY KEY, call_id text, lead_id text, status text, score numeric, transcript text);
      CREATE TABLE public.pbk_qa_audit(id text PRIMARY KEY, passed boolean, skipped boolean, source text, tool_name text, params jsonb, result jsonb);`);
    const storage = await createControlledAgentStorage(db);
    const { fixture, runId, schema } = storage;
    const outputs = workflowTestOutputs(fixture);
    outputs.rex.citations = [`controlled-qualification:${runId}`];
    outputs['prosody-tuner'].fixtureDecisionId = 'decision';
    outputs['script-rotator'].fixtureMemoryId = 'memory';
    outputs['qa-agent'].result = outputs['nurture-agent'];
    const invoked = [];
    await runControlledAgentWorkflow({ fixture,
      readPrevious: id => readControlledWorkflowPredecessor(db, storage, id),
      execute: async (agentId, input, workflowLink) => {
        invoked.push(agentId);
        const workOrderId = `task-${agentId}`;
        const contextId = `context-${agentId}`;
        const at = new Date().toISOString();
        const output = outputs[agentId];
        if (agentId === 'call-analyzer') output.analyses[0].transcript = input.transcript;
        const data = { agentId, runId, leadId: fixture.leadId, callId: fixture.callId, sourceUpdatedAt: fixture.sourceUpdatedAt,
          operational: false, contextId, workOrderId, completedAt: at, blockedNetwork: 0, workflowLink };
        const context = { contextId, identity: { leadId: fixture.leadId, callId: fixture.callId } };
        const metadata = { operational: false,
          workOrder: { id: workOrderId, agentId, source: 'controlled-qualification', payload: { ...input, leadId: fixture.leadId, callId: fixture.callId } },
          executionEvidence: { operational: false, handlerCompletionVerified: true, completedAt: at },
          qualification: { ...data }, pbkIntelligenceContext: { contextId } };
        await db.query(`INSERT INTO ${schema}.pbk_tasks VALUES ($1,$2::jsonb,'complete',$3)`, [workOrderId, JSON.stringify(metadata), at]);
        if (agentId === 'prosody-tuner') await db.query(`INSERT INTO ${schema}.pbk_agent_decisions VALUES ('decision',$1,'controlled-qualification',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
          [agentId, fixture.leadId, fixture.callId, JSON.stringify({ runId }), JSON.stringify({ contextId }), JSON.stringify(output.prosody)]);
        if (agentId === 'script-rotator') await db.query(`INSERT INTO ${schema}.pbk_memories VALUES ('memory',$1,$2,$3::jsonb,$4)`,
          [fixture.leadId, fixture.callId, JSON.stringify({ runId }), output.nextBestPhrase]);
        if (agentId === 'call-analyzer') await db.query(`INSERT INTO ${schema}.pbk_call_analyses VALUES ('analysis',$1,$2,'analyzed',$3,$4)`,
          [fixture.callId, fixture.leadId, output.analyses[0].score, input.transcript]);
        if (agentId === 'nurture-agent') await db.query(`INSERT INTO ${schema}.lead_profiles VALUES ($1,'controlled-qualification','','',$2)`, [fixture.leadId, input.score]);
        if (agentId === 'qa-agent') await db.query(`INSERT INTO ${schema}.pbk_qa_audit VALUES ('audit',true,false,'controlled-qualification','consultNurtureAgent',$1::jsonb,$2::jsonb)`,
          [JSON.stringify({ leadId: fixture.leadId }), JSON.stringify(input.result)]);
        await saveControlledAgentResult(db, storage, agentId, data, output, context);
        return { output, workOrderId };
      } });
    assert.deepEqual(invoked, [...controlledWorkflowOrder]);
    const report = await readControlledAgentQualification(db, runId);
    assert.equal(report.workflow.crossAgentWorkflowVerified, true);
    assert.equal(report.workflow.linkedAgentCount, 11);
    assert.equal(report.organicReadinessPromoted, false);
    const before = (await db.query('SELECT * FROM public.lead_profiles')).rows;
    assert.equal(before.length, 1);
    assert.equal(before[0].id, 'customer-sentinel');
    await db.query(`UPDATE ${schema}.qualification_results SET output=jsonb_set(output,'{closing,nextBestPhrase}','"tampered"') WHERE agent_id='max'`);
    const corrupt = await readControlledAgentQualification(db, runId);
    assert.equal(corrupt.workflow.crossAgentWorkflowVerified, false);
    assert.equal(corrupt.agents.find(agent => agent.agentId === 'script-rotator').workflowLinkVerified, false);
    await assert.rejects(readControlledWorkflowPredecessor(db, storage, 'qa-agent'), error => {
      assert(error.message.includes(`controlled_workflow_predecessor_unverified:${runId}:script-rotator:`));
      assert(error.message.includes('consumedPredecessorVerified'));
      assert.equal(error.message.includes('tampered'), false, 'diagnostic must not contain output text');
      return true;
    });
    await db.query(`UPDATE ${schema}.qualification_results SET output=$1::jsonb WHERE agent_id='max'`, [JSON.stringify(outputs.max)]);
    await db.query(`UPDATE ${schema}.pbk_tasks SET metadata=jsonb_set(metadata,'{workOrder,payload,score}','99') WHERE id='task-nurture-agent'`);
    assert.equal((await readControlledAgentQualification(db, runId)).workflow.crossAgentWorkflowVerified, false);
    await assert.rejects(readControlledWorkflowPredecessor(db, storage, 'nurture-agent'), /predecessor_unverified/);
  } finally { await db.close(); }
}, 30000);
