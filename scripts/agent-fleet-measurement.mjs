import { normalizeAgentRegistryId } from './agent-registry.mjs';
import { isAgentTimingPlainData, verifyAgentTimingProof } from './agent-timing-proof.mjs';

export function isNonOperationalAgentEvidence(record = {}) {
  const metadata = record.metadata || {};
  const payload = metadata.workOrder?.payload || {};
  const substantiveBant = metadata.outputResult === 'bant_enforcer_status'
    && metadata.executionEvidence?.handlerCompletionVerified === true;
  return [record, metadata, payload, metadata.executionEvidence || {}].some((item) =>
    item.operational === false || ['controlled', 'synthetic'].includes(item.provenance) || ['synthetic', 'smoke', 'dryRun', 'dry_run', 'preview', 'diagnostic', 'qualification', 'controlledQualification'].some((key) => item[key] === true)
  ) || /(?:^|[_\s-])(synthetic|smoke|preview|heartbeat|diagnostic|health|status|qualification)(?:$|[_\s-])/i.test(
    [record.taskType, record.source, metadata.source, substantiveBant ? '' : metadata.outputResult].filter(Boolean).join(' ')
  ) || metadata.operational === false;
}

const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const citations = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => nonempty(item) || nonempty(item?.title) || nonempty(item?.url));
const closingAdvice = (output) => output?.ok === true && output.result === 'closing_intelligence' && nonempty(output.nextBestPhrase);

export function isAgentHandlerCompletion(agentId, output = {}) {
  if (!output || output.ok === false || output.skipped === true || output.preview === true || output.dryRun === true) return false;
  switch (normalizeAgentRegistryId(agentId)) {
    case 'ava':
      return output.ok === true && ['agent_brain', 'ava_conversation_intelligence'].includes(output.routedTo)
        && output.response?.ok === true && nonempty(output.response.answer || output.response.response || output.response.text);
    case 'rex':
      return nonempty(output.answer) && citations(output.citations) && !output.webSearch?.fallback;
    case 'hermes':
      if (output.result === 'hermes_pattern_analysis') {
        const workflow = output.pattern?.workflow;
        return output.ok === true && output.provider === 'pbk-local-pattern-analysis'
          && nonempty(workflow?.trigger) && Array.isArray(workflow.steps) && workflow.steps.length > 0
          && workflow.steps.every(nonempty) && nonempty(output.strategy)
          && workflow.steps.every((step) => output.strategy.includes(step))
          && output.safety?.suggestOnly === true && output.safety.providerWrites === 'blocked';
      }
      return output.ok === true && nonempty(output.result) && !/(status|ready|started|fallback|unavailable|timeout|pending)/i.test(output.result)
        && nonempty(output.provider) && (nonempty(output.strategy) || nonempty(output.strategy?.answer) || nonempty(output.strategy?.immediateScript));
    case 'max':
      return output.ok === true && output.result === 'max_contract_handoff_ready'
        && closingAdvice(output.closing) && output.safety?.approvalGate === true;
    case 'script-rotator':
      return closingAdvice(output) && citations(output.citations);
    case 'call-analyzer':
      return output.ok === true && output.result === 'call_analysis_complete'
        && Number.isInteger(output.analyzed) && output.analyzed > 0
        && Array.isArray(output.analyses) && output.analyses.length === output.analyzed
        && output.analyses.every((item) => nonempty(item.id) && nonempty(item.callId)
          && item.status === 'analyzed' && typeof item.score === 'number' && Number.isFinite(item.score) && item.score >= 0 && item.score <= 100);
    case 'prosody-tuner':
      return output.ok === true && output.result === 'prosody_advice' && nonempty(output.prosody?.emotion)
        && ['speed', 'stability', 'similarityBoost'].every((key) => typeof output.prosody[key] === 'number' && Number.isFinite(output.prosody[key]))
        && output.prosody.speed > 0 && output.prosody.stability >= 0 && output.prosody.stability <= 1
        && output.prosody.similarityBoost >= 0 && output.prosody.similarityBoost <= 1;
    case 'bant-enforcer':
      return output.ok === true && output.result === 'bant_enforcer_status' && output.complete === true
        && Array.isArray(output.missing) && output.missing.length === 0
        && ['budget', 'authority', 'need', 'timeline', 'urgency'].every((key) => nonempty(output.bant?.[key])
          || (typeof output.bant?.[key] === 'number' && Number.isFinite(output.bant[key]) && output.bant[key] > 0));
    case 'qa-agent':
      return output.ok === true && output.qa?.ok === true && output.qa.skipped !== true
        && nonempty(output.qa.validator) && nonempty(output.auditRecord?.id) && !output.auditFallback;
    case 'nurture-agent':
      return output.ok === true && output.result === 'recommendation' && nonempty(output.lead?.id)
        && ['sms', 'call', 'email'].includes(output.recommendation?.channel)
        && nonempty(output.recommendation.urgency) && nonempty(output.recommendation.reason);
    case 'research-orchestrator':
      return output.ok === true && ['halt', 'handoff_or_pause', 'slow_down', 'continue'].includes(output.result)
        && Array.isArray(output.flags) && nonempty(output.intervention)
        && output.safety?.providerWrites === 'blocked_without_approval'
        && (output.result !== 'halt' || (output.safety.canOverrideAva === true && output.flags.length > 0));
    default: return false;
  }
}

const TIMING_KINDS = { firstTokenMs: 'first_token', completionMs: 'completion', speechStartMs: 'speech_start', speechCompletionMs: 'speech_completion' };
const CHANNELS = ['chat', 'phone', 'research', 'provider'];
const latencyNumber = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim()))
  && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function buildAgentExecutionEvidence({ agentId, payload = {}, output = {}, durationMs, completedAt, workOrderId, channel, timings = {} } = {}) {
  const handlerComplete = isAgentHandlerCompletion(agentId, output);
  const nonOperational = isNonOperationalAgentEvidence({ ...payload, metadata: { ...payload.metadata, outputResult: handlerComplete ? '' : output.result } })
    || output.skipped === true || output.dryRun === true || output.preview === true
    || /(?:handler_ready|registered|pending|queued|approval_required)/i.test(String(output.result || output.status || ''));
  return {
    source: 'registry_execution',
    workOrderId,
    handlerCompletionVerified: handlerComplete,
    operational: !nonOperational,
    // A returned handler or a readiness response is not completed business work.
    success: !nonOperational && handlerComplete,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
    latencyKind: 'completion',
    channel: CHANNELS.includes(channel) ? channel : 'unknown',
    timings: Object.fromEntries(Object.keys(TIMING_KINDS).filter((key) => Object.hasOwn(timings, key)).map((key) => [key, latencyNumber(timings[key])])),
    completedAt,
  };
}

export function collectAgentFleetEvidence(state = {}, { now = Date.now(), policy, secret, revision, requireTimingV2 = false } = {}) {
  if (requireTimingV2 || policy?.version === 2) return collectTimingV2(state, { now, policy, secret, revision });
  const lastActions = {};
  const latencySamples = {};
  const unverifiedLatencySamples = {};
  const latencyObservations = {};
  const diagnostics = {};
  const seen = new Set();
  for (const collection of ['agentTasks', 'agentDecisions', 'rexDecisions']) {
    for (const record of Array.isArray(state[collection]) ? state[collection] : []) {
      const id = normalizeAgentRegistryId(record.agentId || record.agent_id || record.toAgent || record.to_agent || record.agentName || record.agent_name || record.agent || record.fromAgent || record.from_agent);
      if (!id) continue;
      const diagnostic = diagnostics[id] ||= { observedRecords: 0, excludedRecords: 0, unverifiedRecords: 0, missingLatencyRecords: 0, operationalRecords: 0 };
      const key = record.id ? `${id}:${record.id}` : null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      diagnostic.observedRecords++;
      if (isNonOperationalAgentEvidence(record) || record.metadata?.executionEvidence?.operational === false) { diagnostic.excludedRecords++; continue; }
      const metadata = record.metadata || {};
      const evidence = metadata.executionEvidence || metadata;
      const at = record.completedAt || record.completed_at || evidence.completedAt || record.updatedAt || record.updated_at || record.createdAt || record.created_at;
      const atMs = typeof at === 'string' ? Date.parse(at) : NaN;
      const sourceVerified = Boolean(record.id && Number.isFinite(atMs) && atMs <= now
        && ['agent_ops', 'registry_execution'].includes(evidence.source)
        && (evidence.source !== 'registry_execution' || (evidence.workOrderId === record.id && evidence.workOrderId === metadata.workOrder?.id && evidence.operational === true)));
      if (!sourceVerified) diagnostic.unverifiedRecords++;
      else diagnostic.operationalRecords++;
      if (evidence.operational === false) { diagnostic.excludedRecords++; continue; }
      const duration = record.latencyMs ?? record.latency_ms ?? record.durationMs ?? record.duration_ms
        ?? evidence.latencyMs ?? evidence.durationMs;
      // Preserve slow legacy observations, but never turn absent values into zero.
      if ((typeof duration === 'number' || (typeof duration === 'string' && duration.trim())) && Number.isFinite(Number(duration)) && Number(duration) >= 0) {
        const target = sourceVerified ? latencySamples : unverifiedLatencySamples;
        (target[id] ||= []).push(Number(duration));
      } else diagnostic.missingLatencyRecords++;
      const channel = record.channel || evidence.channel || metadata.channel;
      const rawKind = record.latencyKind || evidence.latencyKind || metadata.latencyKind;
      const kind = Object.values(TIMING_KINDS).includes(rawKind) ? rawKind : 'unknown';
      const observation = (timingKind, value) => ({
        kind: timingKind, channel: CHANNELS.includes(channel) ? channel : 'unknown', valueMs: latencyNumber(value),
        at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : '', recordId: record.id || '',
        source: evidence.source || '', verified: sourceVerified,
      });
      const observations = latencyObservations[id] ||= [];
      observations.push(observation(kind, duration));
      const timings = evidence.timings || metadata.timings || {};
      for (const [field, timingKind] of Object.entries(TIMING_KINDS)) {
        if (Object.hasOwn(timings, field)) observations.push(observation(timingKind, timings[field]));
      }
      const status = String(record.status || record.result || '').toLowerCase();
      const success = sourceVerified && evidence.success === true && /^(success|succeeded|complete|completed)$/.test(status);
      const action = { status: success ? 'success' : status === 'failed' ? 'failure' : 'unverified', at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : '', source: sourceVerified ? evidence.source : '', recordId: record.id || '' };
      if (!lastActions[id] || (Number.isFinite(atMs) && atMs >= Date.parse(lastActions[id].at || '')) || !lastActions[id].at) lastActions[id] = action;
    }
  }
  for (const diagnostic of Object.values(diagnostics)) {
    diagnostic.state = diagnostic.operationalRecords ? (diagnostic.missingLatencyRecords ? 'instrumentation_gap' : 'observed')
      : diagnostic.unverifiedRecords ? 'provenance_missing' : 'no_operational_use_observed';
  }
  return { lastActions, latencySamples, unverifiedLatencySamples, latencyObservations, diagnostics };
}

function collectTimingV2(state, { now, policy, secret, revision }) {
  const result = { lastActions: {}, latencySamples: {}, unverifiedLatencySamples: {}, latencyObservations: {}, latencyDiagnostics: {}, diagnostics: {} };
  const runs = new Map();
  for (const collection of ['agentTasks', 'agentDecisions', 'rexDecisions']) {
    for (const record of Array.isArray(state[collection]) ? state[collection] : []) {
      const safe = isAgentTimingPlainData(record);
      const ownAgent = Object.getOwnPropertyDescriptor(record || {}, 'agentId')?.value;
      const candidate = safe ? record?.agentId || record?.agent_id || record?.toAgent || record?.to_agent
        || record?.agentName || record?.agent_name || record?.agent || record?.fromAgent || record?.from_agent : ownAgent;
      const id = typeof candidate === 'string' ? normalizeAgentRegistryId(candidate) : '';
      if (!id || ['__proto__', 'constructor', 'prototype'].includes(id)) continue;
      const diagnostic = result.diagnostics[id] ||= { observedRecords: 0, excludedRecords: 0, unverifiedRecords: 0, missingLatencyRecords: 0, operationalRecords: 0 };
      diagnostic.observedRecords++;
      if (safe && isNonOperationalAgentEvidence(record)) { diagnostic.excludedRecords++; continue; }
      const metadata = safe ? record.metadata || {} : {};
      const proof = metadata.timingProof ?? metadata.executionEvidence?.timingProof;
      const runId = safe && typeof record.id === 'string' ? record.id : '';
      const check = verifyAgentTimingProof(proof, { secret, revision, policy, agentId: id, runId, now });
      const signedExpired = check.reason === 'time_expired';
      const valid = check.verified;
      const data = valid ? check.data : null;
      const at = data?.completedAt || (signedExpired ? proof.completedAt : safe ? record.completedAt || record.completed_at
        || metadata.executionEvidence?.completedAt || record.updatedAt || record.updated_at || record.createdAt || record.created_at : '');
      const atMs = typeof at === 'string' ? Date.parse(at) : NaN;
      const rawStatus = safe ? record.status || record.result : null;
      const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
      const success = valid && /^(success|succeeded|complete|completed)$/.test(status);
      const observations = result.latencyObservations[id] ||= [];
      const diagnostics = result.latencyDiagnostics[id] ||= [];
      const key = `${id}:${runId}`;
      const previous = runs.get(key);
      const signature = valid ? proof.signature : null;
      const duplicate = Boolean(previous && signature && previous === signature);
      const conflict = Boolean(previous && signature && previous !== signature);
      if (valid) runs.set(key, signature);
      if (valid && success && !conflict && !duplicate) {
        diagnostic.operationalRecords++;
        const signedProof = { ...data, signature };
        for (const [field, kind] of Object.entries(TIMING_KINDS)) {
          if (!Object.hasOwn(data.timings, field)) continue;
          observations.push({ kind, channel: data.channel, valueMs: data.timings[field], at: data.completedAt,
            recordId: runId, source: 'signed_timing_v2', verified: true, proof: signedProof, binding: { agentId: id, runId } });
        }
        if (Object.hasOwn(data.timings, 'completionMs')) (result.latencySamples[id] ||= []).push(data.timings.completionMs);
        else diagnostic.missingLatencyRecords++;
      } else if (!duplicate || !success) {
        diagnostic.unverifiedRecords++;
        diagnostics.push({ recordId: runId, reason: conflict ? 'run_conflict' : valid && !success ? 'business_result_unverified' : check.reason, at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : '' });
        const duration = safe ? record.latencyMs ?? record.latency_ms ?? record.durationMs ?? metadata.executionEvidence?.durationMs : null;
        if (latencyNumber(duration) !== null) (result.unverifiedLatencySamples[id] ||= []).push(latencyNumber(duration));
        if (conflict || (valid && !success) || (!signedExpired && (proof !== undefined || !safe))) {
          // Invalid signed claims stay blocking; never use an untrusted timestamp to age them out.
          observations.push({ timingV2: true, verified: false, recordId: runId, reason: conflict ? 'run_conflict' : 'proof_invalid' });
        }
      }
      const action = { status: success && !conflict ? 'success' : status === 'failed' ? 'failure' : 'unverified',
        at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : '', recordId: runId,
        source: valid ? 'signed_timing_v2' : '', ...(valid ? { proof: { ...data, signature }, binding: { agentId: id, runId } } : {}) };
      const latest = result.lastActions[id];
      // Invalid/unknown/future latest actions cannot restore an older successful action.
      if (!latest || !Number.isFinite(atMs) || (latest.at && atMs > Date.parse(latest.at))
        || (atMs === Date.parse(latest.at) && action.status !== 'success')) result.lastActions[id] = action;
    }
  }
  for (const diagnostic of Object.values(result.diagnostics)) diagnostic.state = diagnostic.operationalRecords
    ? diagnostic.missingLatencyRecords ? 'instrumentation_gap' : 'observed'
    : diagnostic.unverifiedRecords ? 'provenance_missing' : 'no_operational_use_observed';
  return result;
}
