import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse, toSql } from 'pgsql-ast-parser';
import { remapControlledSql } from './controlled-execution-scope.mjs';
import { isAgentHandlerCompletion } from './agent-fleet-measurement.mjs';
import { controlledWorkflowOrder, verifyControlledWorkflowLink } from './controlled-agent-workflow.mjs';

const TABLES = ['bridge_state', 'pbk_tasks', 'agent_ops', 'pbk_agent_decisions', 'pbk_qa_audit', 'pbk_call_analyses', 'lead_profiles', 'pbk_knowledge', 'pbk_memories', 'pbk_tool_usage', 'pbk_research_additive_runs', 'pbk_feedback', 'pbk_intent_events', 'calls'];
const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('controlled_identifier_invalid');
  return `"${value}"`;
};
export function controlledSchemaForRun(runId) {
  if (!/^pbk-q-[a-f0-9]{24}$/.test(runId)) throw new Error('controlled_run_invalid');
  return `pbk_q_${runId.slice(6)}`;
}

export async function createControlledAgentStorage(pool, { tables = TABLES, revision = '' } = {}) {
  const runId = `pbk-q-${randomBytes(12).toString('hex')}`;
  const schema = controlledSchemaForRun(runId);
  const available = await pool.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
  const found = new Set(available.rows.map(row => row.tablename));
  const selected = tables.filter(table => found.has(table));
  for (const required of ['bridge_state', 'pbk_tasks', 'lead_profiles']) if (!selected.includes(required)) throw new Error('controlled_storage_schema_missing');
  const tableSet = new Set(selected);
  const columnTypes = await pool.query(`SELECT t.typtype, n.nspname AS namespace, t.typname
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace cn ON cn.oid=c.relnamespace JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE cn.nspname='public' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped`, [selected]);
  if (columnTypes.rows.some(type => type.namespace !== 'pg_catalog' || !['b', 'p'].includes(type.typtype))) throw new Error('controlled_custom_column_type_blocked');
  await pool.query(`CREATE SCHEMA ${identifier(schema)}`);
  for (const table of selected) {
    // No copied defaults, generated expressions, triggers, FKs or expression indexes.
    await pool.query(`CREATE TABLE ${identifier(schema)}.${identifier(table)} (LIKE public.${identifier(table)})`);
    const defaults = await pool.query(`SELECT a.attname AS name, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS expression
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1::regclass AND a.attgenerated = ''`, [`public.${table}`]);
    for (const column of defaults.rows) {
      // Only parser-validated builtin expressions may become isolated defaults.
      const statement = parse(remapControlledSql(`SELECT ${column.expression}`, schema, tableSet))[0];
      const expression = toSql.expr(statement.columns[0].expr);
      await pool.query(`ALTER TABLE ${identifier(schema)}.${identifier(table)} ALTER COLUMN ${identifier(column.name)} SET DEFAULT ${expression}`);
    }
    const keys = await pool.query(`SELECT c.contype, array_agg(a.attname::text ORDER BY k.ordinality) AS columns
      FROM pg_catalog.pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ordinality)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = $1::regclass AND c.contype IN ('p','u') GROUP BY c.oid, c.contype`, [`public.${table}`]);
    for (const key of keys.rows) await pool.query(`ALTER TABLE ${identifier(schema)}.${identifier(table)} ADD ${key.contype === 'p' ? 'PRIMARY KEY' : 'UNIQUE'} (${key.columns.map(identifier).join(',')})`);
  }
  await pool.query(`CREATE TABLE ${identifier(schema)}.qualification_fixture (id text PRIMARY KEY, data jsonb NOT NULL, source_at timestamptz NOT NULL DEFAULT now(), revision text NOT NULL)`);
  await pool.query(`CREATE TABLE ${identifier(schema)}.qualification_results (agent_id text PRIMARY KEY, data jsonb NOT NULL, output jsonb NOT NULL, context jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT now())`);
  const fixture = {
    leadId: `${runId}-lead`, callId: `${runId}-call`, runId,
    leadName: 'PBK Controlled Qualification',
    transcript: 'Seller: I own the property and make the decision. I need to sell in thirty days because I am moving. My budget is 100000. Please explain the process without contacting anyone.',
    bant: { budget: '100000', authority: 'sole owner', need: 'moving', timeline: '30 days', urgency: 'relocation deadline' },
    diagnostic: true, operational: false, noContact: true,
  };
  await pool.query(`INSERT INTO ${identifier(schema)}.qualification_fixture(id,data,revision) VALUES ($1,$2::jsonb,$3)`, [runId, JSON.stringify(fixture), revision]);
  const stored = (await pool.query(`SELECT data, source_at FROM ${identifier(schema)}.qualification_fixture WHERE id=$1`, [runId])).rows[0];
  return { runId, schema, tables: tableSet, fixture: { ...stored.data, sourceUpdatedAt: new Date(stored.source_at).toISOString() } };
}

export async function saveControlledAgentResult(pool, storage, agentId, data, output, context) {
  await pool.query(`INSERT INTO ${identifier(storage.schema)}.qualification_results(agent_id,data,output,context) VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb)`,
    [agentId, JSON.stringify(data), JSON.stringify(output), JSON.stringify(context)]);
}

export async function readControlledWorkflowPredecessor(pool, storage, agentId) {
  const report = await readControlledAgentQualification(pool, storage.runId);
  const evidence = report.agents.find(agent => agent.agentId === agentId);
  const prefix = controlledWorkflowOrder.slice(0, controlledWorkflowOrder.indexOf(agentId) + 1);
  if (!evidence || !prefix.every(id => {
    const agent = report.agents.find(item => item.agentId === id);
    return agent?.completed && agent.durable && agent.workflowLinkVerified && Object.values(agent.criteria).every(value => value === true);
  })) throw new Error('controlled_workflow_predecessor_unverified');
  const result = (await pool.query(`SELECT data,output FROM ${identifier(storage.schema)}.qualification_results WHERE agent_id=$1`, [agentId])).rows[0];
  if (!result || result.data.runId !== storage.runId || result.data.agentId !== agentId) throw new Error('controlled_workflow_predecessor_missing');
  return { agentId, workOrderId: result.data.workOrderId, output: result.output };
}

export async function readControlledAgentQualification(pool, runId) {
  const schema = controlledSchemaForRun(runId);
  const source = (await pool.query(`SELECT data,source_at,revision FROM ${identifier(schema)}.qualification_fixture WHERE id=$1`, [runId])).rows[0];
  if (!source) throw new Error('controlled_fixture_missing');
  const sourceUpdatedAt = new Date(source.source_at).toISOString();
  const results = (await pool.query(`SELECT agent_id,data,output,context,completed_at FROM ${identifier(schema)}.qualification_results ORDER BY agent_id`)).rows;
  const fixture = { leadId: source.data.leadId, callId: source.data.callId, sourceUpdatedAt };
  const agents = [];
  for (const result of results) {
    const data = result.data;
    const output = result.output || {};
    const task = (await pool.query(`SELECT * FROM ${identifier(schema)}.pbk_tasks WHERE id=$1`, [data.workOrderId])).rows[0];
    const qualification = task?.metadata?.qualification || {};
    const execution = task?.metadata?.executionEvidence || {};
    const context = result.context || {};
    const completedAt = execution.completedAt || '';
    const correlated = Boolean(task && task.metadata?.workOrder?.id === task.id && task.status === 'complete'
      && task.metadata.workOrder.agentId === result.agent_id && task.metadata.workOrder.source === 'controlled-qualification'
      && task.metadata.operational === false && execution.operational === false && execution.handlerCompletionVerified === true
      && data.agentId === result.agent_id && data.runId === runId && data.operational === false
      && ['leadId','callId','sourceUpdatedAt'].every(key => data[key] === fixture[key] && qualification[key] === fixture[key])
      && qualification.runId === runId && qualification.agentId === result.agent_id
      && data.contextId && qualification.contextId === data.contextId && context.contextId === data.contextId
      && task.metadata.pbkIntelligenceContext?.contextId === data.contextId
      && context.identity?.leadId === fixture.leadId && context.identity?.callId === fixture.callId
      && task.metadata.workOrder.payload?.leadId === fixture.leadId && task.metadata.workOrder.payload?.callId === fixture.callId
      && data.completedAt === completedAt && Number.isFinite(Date.parse(completedAt))
      && Date.parse(completedAt) >= Date.parse(sourceUpdatedAt) && Date.parse(completedAt) <= new Date(result.completed_at).getTime());
    const semantic = isAgentHandlerCompletion(result.agent_id, output);
    const sequence = controlledWorkflowOrder.indexOf(result.agent_id);
    const predecessor = sequence > 0 ? results.find(item => item.agent_id === controlledWorkflowOrder[sequence - 1]) : null;
    const workflowLinkVerified = (!predecessor || new Date(predecessor.completed_at).getTime() <= new Date(task?.created_at).getTime()) && verifyControlledWorkflowLink(result.agent_id, source.data,
      predecessor ? { agentId: predecessor.agent_id, workOrderId: predecessor.data.workOrderId, output: predecessor.output } : null,
      data.workflowLink, task?.metadata?.workOrder?.payload);
    const evidenceRecordIds = correlated ? [task.id, `${runId}:${result.agent_id}`] : [];
    const row = async (table, id) => (await pool.query(`SELECT * FROM ${identifier(schema)}.${identifier(table)} WHERE id=$1`, [id])).rows[0];
    let criteria = {};
    switch (result.agent_id) {
      case 'ava': criteria = { conversationalResponse: semantic }; break;
      case 'rex': criteria = { strategyAnswer: semantic, sourceEvidence: semantic && output.citations.includes(`controlled-qualification:${runId}`) }; break;
      case 'hermes': criteria = { patternAnalysisExecuted: semantic, suggestOnly: output.safety?.suggestOnly === true,
        stoppingInterventionLearned: Boolean(predecessor?.output.result === 'halt'
          && output.pattern?.workflow?.steps?.includes(predecessor.output.intervention)) }; break;
      case 'bant-enforcer': criteria = { allFieldsComplete: semantic }; break;
      case 'max': criteria = { closingAdvice: semantic, approvalGatePreserved: output.safety?.approvalGate === true }; break;
      case 'prosody-tuner': {
        const decision = output.fixtureDecisionId ? await row('pbk_agent_decisions', output.fixtureDecisionId) : null;
        const persisted = Boolean(decision?.agent_id === 'prosody-tuner' && decision.source === 'controlled-qualification'
          && decision.lead_id === fixture.leadId && decision.call_id === fixture.callId && decision.metadata?.runId === runId
          && decision.context?.contextId === data.contextId && isDeepStrictEqual(decision.parameters, output.prosody));
        if (persisted) evidenceRecordIds.push(decision.id);
        criteria = { finiteProsody: semantic, fixtureDecisionPersisted: persisted };
        break;
      }
      case 'research-orchestrator': criteria = { stopDetected: semantic && output.result === 'halt' && output.flags.includes('dnc_or_stop_request'), contactHalted: output.safety?.providerWrites === 'blocked_without_approval' }; break;
      case 'script-rotator': {
        const memory = output.fixtureMemoryId ? await row('pbk_memories', output.fixtureMemoryId) : null;
        const isolated = Boolean(memory?.lead_id === fixture.leadId && memory.source_id === fixture.callId && memory.metadata?.runId === runId && memory.content === output.nextBestPhrase);
        if (isolated) evidenceRecordIds.push(memory.id);
        criteria = { closingPhrase: semantic, fixtureMemoryIsolated: isolated };
        break;
      }
      case 'call-analyzer': {
        const analysis = output.analyses?.length === 1 ? await row('pbk_call_analyses', output.analyses[0].id) : null;
        const persisted = Boolean(analysis?.call_id === fixture.callId && analysis.lead_id === fixture.leadId && analysis.status === 'analyzed'
          && Number(analysis.score) === output.analyses?.[0]?.score
          && analysis.transcript === output.analyses?.[0]?.transcript
          && typeof analysis.transcript === 'string' && analysis.transcript.includes(JSON.stringify(predecessor?.output.prosody)));
        if (persisted) evidenceRecordIds.push(analysis.id);
        criteria = { fixtureOnlyAnalysis: semantic && output.analyses.length === 1 && output.analyses[0].callId === fixture.callId, analysisPersisted: persisted };
        break;
      }
      case 'nurture-agent': {
        const profile = await row('lead_profiles', fixture.leadId);
        const scheduled = (await pool.query(`SELECT count(*)::int AS n FROM ${identifier(schema)}.lead_profiles WHERE phone<>'' OR email<>''`)).rows[0].n;
        const persisted = Boolean(profile?.id === fixture.leadId && profile.source === 'controlled-qualification' && !profile.phone && !profile.email
          && Number(profile.engagement_score) === predecessor?.output.analyses?.[0]?.score
          && output.lead?.score === predecessor?.output.analyses?.[0]?.score);
        if (persisted) evidenceRecordIds.push(profile.id);
        criteria = { fixtureProfilePersisted: persisted, recommendationProduced: semantic, noSendScheduled: scheduled === 0 && data.blockedNetwork === 0 };
        break;
      }
      case 'qa-agent': {
        const audit = output.auditRecord?.id ? await row('pbk_qa_audit', output.auditRecord.id) : null;
        const nurture = results.find(item => item.agent_id === 'nurture-agent');
        const persisted = Boolean(audit?.passed && !audit.skipped && audit.source === 'controlled-qualification'
          && audit.tool_name === 'consultNurtureAgent' && audit.params?.leadId === fixture.leadId
          && audit.result?.lead?.id === fixture.leadId && isDeepStrictEqual(nurture?.output, audit.result));
        if (persisted) evidenceRecordIds.push(audit.id);
        criteria = { validatorExecuted: semantic, auditPersisted: persisted };
        break;
      }
    }
    const correlationChecks = {
      taskPresent: Boolean(task), taskComplete: task?.status === 'complete',
      workOrderAgentMatch: task?.metadata?.workOrder?.agentId === result.agent_id,
      workOrderSourceMatch: task?.metadata?.workOrder?.source === 'controlled-qualification',
      executionNonOperational: execution.operational === false,
      handlerCompletionVerified: execution.handlerCompletionVerified === true,
      actualContextIdentityMatch: context.contextId === data.contextId && task?.metadata?.pbkIntelligenceContext?.contextId === data.contextId,
      fixtureIdentityMatch: ['leadId','callId','sourceUpdatedAt'].every(key => data[key] === fixture[key] && qualification[key] === fixture[key]),
      completionTimeMatch: data.completedAt === completedAt && Number.isFinite(Date.parse(completedAt))
        && Date.parse(completedAt) >= Date.parse(sourceUpdatedAt) && Date.parse(completedAt) <= new Date(result.completed_at).getTime(),
    };
    agents.push({ ...data, agentId: result.agent_id, completed: correlated && semantic, durable: correlated,
      workflowLinkVerified, criteria, evidenceRecordIds, correlationChecks });
  }
  return {
    schemaVersion: 'pbk-controlled-qualification-v1', source: 'controlled-qualification', runId,
    revision: source.revision, productionReadinessVerified: false, organicReadinessPromoted: false,
    guard: { atomic: true, noContact: true, externalWritesBlocked: true, fixtureOnly: true },
    storage: { backend: 'postgres', readbackVerified: true, schema, handlerTablesIsolated: true },
    fixture, agents,
    workflow: { order: [...controlledWorkflowOrder], linkedAgentCount: agents.filter(agent => agent.workflowLinkVerified && agent.completed && agent.durable).length,
      crossAgentWorkflowVerified: agents.length === controlledWorkflowOrder.length && agents.every(agent => agent.workflowLinkVerified && agent.completed && agent.durable && Object.values(agent.criteria).every(value => value === true)) },
    sourceAgeMs: Math.max(0, Date.now() - Date.parse(sourceUpdatedAt)),
    sourceExpired: Date.now() - Date.parse(sourceUpdatedAt) > 60000,
  };
}
