import { normalizeAgentRegistryId } from './agent-registry.mjs';

export function isNonOperationalAgentEvidence(record = {}) {
  const metadata = record.metadata || {};
  const payload = metadata.workOrder?.payload || {};
  return [record, metadata, payload].some((item) =>
    ['synthetic', 'smoke', 'dryRun', 'dry_run', 'preview', 'diagnostic'].some((key) => item[key] === true)
  ) || /(?:^|[_\s-])(synthetic|smoke|preview|heartbeat|diagnostic|health|status)(?:$|[_\s-])/i.test(
    [record.taskType, record.source, metadata.source, metadata.outputResult].filter(Boolean).join(' ')
  ) || metadata.operational === false;
}

export function buildAgentExecutionEvidence({ payload = {}, output = {}, durationMs, completedAt, workOrderId } = {}) {
  const nonOperational = isNonOperationalAgentEvidence({ ...payload, metadata: { ...payload.metadata, outputResult: output.result } })
    || output.skipped === true || output.dryRun === true || output.preview === true
    || /(?:handler_ready|registered|pending|queued|approval_required)/i.test(String(output.result || output.status || ''));
  return {
    source: 'registry_execution',
    workOrderId,
    operational: !nonOperational,
    // A returned handler or a readiness response is not completed business work.
    success: !nonOperational && output.ok === true && /^(success|succeeded|complete|completed)$/.test(String(output.status || output.result || '').toLowerCase()),
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
    completedAt,
  };
}

export function collectAgentFleetEvidence(state = {}, { now = Date.now() } = {}) {
  const lastActions = {};
  const latencySamples = {};
  const unverifiedLatencySamples = {};
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
  return { lastActions, latencySamples, unverifiedLatencySamples, diagnostics };
}
