import { fileURLToPath } from 'node:url';

const DEFAULT_STALE_CONTRACT_HOURS = 36;
const DEFAULT_LOW_CALL_SCORE = 75;
const DEFAULT_HOT_LEAD_SCORE = 80;
const DEFAULT_EVENT_BACKLOG = 1000;
const DEFAULT_QA_FAILURE_RATE = 0.05;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|y|dnc|blocked)$/i.test(String(value || '').trim());
}

function ts(value, fallback = Date.now()) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function label(value, fallback = 'Unknown') {
  return String(value || fallback).trim();
}

function addAction(actions, action = {}) {
  actions.push({
    id: action.id || `heartbeat-${action.type || 'action'}-${actions.length + 1}`,
    priority: action.priority || 'medium',
    type: action.type || 'review',
    title: action.title || 'Review PBK item',
    reason: action.reason || '',
    toolName: action.toolName || '',
    params: action.params || {},
    ...action,
  });
}

export function buildCoworkerHeartbeatPlan(snapshot = {}, options = {}) {
  const nowMs = ts(options.now || snapshot.now, Date.now());
  const actions = [];
  const staleContractHours = numberOr(options.staleContractHours, DEFAULT_STALE_CONTRACT_HOURS);
  const lowCallScore = numberOr(options.lowCallScore, DEFAULT_LOW_CALL_SCORE);
  const hotLeadScore = numberOr(options.hotLeadScore, DEFAULT_HOT_LEAD_SCORE);
  const eventBacklogThreshold = numberOr(options.eventBacklogThreshold, DEFAULT_EVENT_BACKLOG);
  const qaFailureRateThreshold = Number.isFinite(Number(options.qaFailureRateThreshold))
    ? Number(options.qaFailureRateThreshold)
    : DEFAULT_QA_FAILURE_RATE;

  const pendingApprovals = asArray(snapshot.approvals).filter((approval) =>
    /pending|needs_review|queued/i.test(String(approval.status || 'pending')),
  );
  if (pendingApprovals.length) {
    addAction(actions, {
      type: 'review_pending_approvals',
      priority: pendingApprovals.length >= 3 ? 'high' : 'medium',
      title: `Review pending approvals (${pendingApprovals.length})`,
      reason: 'PBK approval-first safety works only when the board stays visible and cleared.',
      count: pendingApprovals.length,
      items: pendingApprovals.slice(0, 5).map((approval) => ({
        id: approval.id,
        type: approval.type || approval.approvalAction || 'approval',
        leadName: approval.leadName || approval.name || approval.address || '',
      })),
    });
  }

  for (const contract of asArray(snapshot.contracts)) {
    const status = String(contract.status || '').toLowerCase();
    if (!/sent|pending|draft|awaiting/i.test(status)) continue;
    const ageHours = (nowMs - ts(contract.updatedAt || contract.updated_at || contract.createdAt || contract.created_at, nowMs)) / 36e5;
    if (ageHours < staleContractHours) continue;
    addAction(actions, {
      type: 'follow_up_stale_contract',
      priority: 'high',
      title: `Follow up stale ${status || 'contract'} for ${label(contract.leadName || contract.name || contract.address, 'seller')}`,
      reason: `Contract has been ${status || 'open'} for ${Math.round(ageHours)} hours.`,
      contractId: contract.id || contract.contractId || '',
      leadId: contract.leadId || contract.lead_id || '',
      toolName: 'routeAdminCommand',
      params: {
        command: `Check stale contract ${contract.id || ''} and prepare the next safe follow-up.`,
        source: 'coworker-heartbeat',
      },
    });
  }

  for (const lead of asArray(snapshot.leads)) {
    const motivation = numberOr(lead.motivationScore ?? lead.motivation_score ?? lead.score, 0);
    if (motivation < hotLeadScore || bool(lead.dnc || lead.doNotCall || lead.do_not_call)) continue;
    addAction(actions, {
      type: 'queue_hot_lead',
      priority: 'high',
      title: `Queue high-motivation lead: ${label(lead.name || lead.leadName || lead.address, lead.id || 'lead')}`,
      reason: `Motivation score ${motivation} is above ${hotLeadScore}; DNC is clear.`,
      leadId: lead.id || lead.leadId || '',
      toolName: 'handleRexLeadImported',
      params: {
        ...lead,
        motivationScore: motivation,
        source: 'coworker-heartbeat',
      },
    });
  }

  for (const call of asArray(snapshot.calls)) {
    const score = numberOr(call.qualityScore ?? call.qaScore ?? call.callQaScore ?? call.score, 100);
    if (score >= lowCallScore) continue;
    addAction(actions, {
      type: 'review_low_quality_call',
      priority: 'medium',
      title: `Review low-quality Ava call: ${label(call.leadName || call.name || call.phone, call.id || 'call')}`,
      reason: `Call quality score ${score} is below ${lowCallScore}.`,
      callId: call.id || call.callId || '',
      toolName: 'scoreCallQuality',
      params: {
        callId: call.id || call.callId || '',
        source: 'coworker-heartbeat',
        createRexDecision: true,
      },
    });
  }

  const backlog = numberOr(snapshot.eventBus?.backlog ?? snapshot.eventBus?.streamLength, 0);
  if (backlog > eventBacklogThreshold) {
    addAction(actions, {
      type: 'investigate_event_bus_backlog',
      priority: 'high',
      title: `Investigate event bus backlog (${backlog})`,
      reason: `Backlog is above ${eventBacklogThreshold}; async agent work may lag.`,
      backlog,
      toolName: 'getEventBusStatus',
      params: { source: 'coworker-heartbeat' },
    });
  }

  const qaFailureRate = Number(snapshot.qa?.failureRate ?? snapshot.qa?.failure_rate ?? 0);
  if (Number.isFinite(qaFailureRate) && qaFailureRate > qaFailureRateThreshold) {
    addAction(actions, {
      type: 'investigate_qa_failure_rate',
      priority: 'high',
      title: `Investigate QA failure rate (${Math.round(qaFailureRate * 100)}%)`,
      reason: `QA failures are above ${Math.round(qaFailureRateThreshold * 100)}%; provider results may be unreliable.`,
      qaFailureRate,
      toolName: 'getObservabilityStatus',
      params: { source: 'coworker-heartbeat' },
    });
  }

  return {
    ok: true,
    result: 'coworker_heartbeat_plan',
    generatedAt: new Date(nowMs).toISOString(),
    actions,
    counts: {
      actions: actions.length,
      highPriority: actions.filter((action) => action.priority === 'high').length,
      pendingApprovals: pendingApprovals.length,
    },
  };
}

export function summarizeHeartbeatPlan(plan = {}) {
  const actions = asArray(plan.actions);
  const high = actions.filter((action) => action.priority === 'high');
  const lines = [
    `PBK coworker heartbeat: ${actions.length || 0} action${actions.length === 1 ? '' : 's'} found, ${high.length} high priority.`,
  ];
  if (!actions.length) {
    lines.push('No urgent gaps found. Ava/Rex lanes look clear from the available snapshot.');
  } else {
    for (const action of actions.slice(0, 6)) {
      lines.push(`- [${String(action.priority || 'medium').toUpperCase()}] ${action.title}${action.reason ? ` - ${action.reason}` : ''}`);
    }
  }
  return lines.join('\n');
}

async function bridgeJson(path, options = {}) {
  const bridgeUrl = String(options.bridgeUrl || process.env.PBK_HEARTBEAT_BRIDGE_URL || process.env.PBK_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = String(options.apiKey || process.env.PBK_BRIDGE_API_KEY || '').trim();
  if (!bridgeUrl || !apiKey) return null;
  const response = await fetch(`${bridgeUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { ok: response.ok, text };
  }
}

export async function collectCoworkerHeartbeatSnapshot(options = {}) {
  const state = await bridgeJson('/state', options);
  const eventBus = await bridgeJson('/api/event-bus/status', options);
  const observability = await bridgeJson('/api/observability/status', options);
  const source = state?.state || state || {};
  return {
    approvals: source.approvals || state?.approvals || [],
    calls: source.calls || state?.calls || source.liveCalls || [],
    contracts: source.contracts || state?.contracts || source.contractDrafts || [],
    leads: source.leads || state?.leads || source.leadImports || [],
    eventBus: eventBus || {},
    qa: {
      failureRate: observability?.metrics?.qaFailureRate || observability?.qaFailureRate || 0,
    },
  };
}

export async function runCoworkerHeartbeat(options = {}) {
  const snapshot = options.snapshot || await collectCoworkerHeartbeatSnapshot(options);
  const plan = buildCoworkerHeartbeatPlan(snapshot, options);
  const summary = summarizeHeartbeatPlan(plan);
  if (options.postSlack !== false) {
    await bridgeJson('/invoke', {
      ...options,
      method: 'POST',
      body: {
        toolName: 'slackNotify',
        params: {
          text: summary,
          source: 'coworker-heartbeat-worker',
        },
      },
    }).catch(() => null);
  }
  return { ...plan, summary };
}

export async function startCoworkerHeartbeatLoop(options = {}) {
  const intervalMs = Math.max(60_000, numberOr(options.intervalMs || process.env.PBK_COWORKER_HEARTBEAT_INTERVAL_MS, 21_600_000));
  const runOnce = async () => {
    const result = await runCoworkerHeartbeat(options);
    console.log('[pbk-coworker-heartbeat]', JSON.stringify({
      ok: result.ok,
      actions: result.counts?.actions || 0,
      highPriority: result.counts?.highPriority || 0,
      generatedAt: result.generatedAt,
    }));
    return result;
  };
  await runOnce();
  const timer = setInterval(() => {
    runOnce().catch((error) => console.warn('[pbk-coworker-heartbeat] run failed:', error?.message || error));
  }, intervalMs);
  return { ok: true, result: 'coworker_heartbeat_loop_started', intervalMs, timer };
}

async function main() {
  const loop = process.argv.includes('--loop');
  if (loop) {
    await startCoworkerHeartbeatLoop();
  } else {
    const result = await runCoworkerHeartbeat({ postSlack: !process.argv.includes('--no-slack') });
    console.log(JSON.stringify(result, null, 2));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[pbk-coworker-heartbeat] failed:', error);
    process.exit(1);
  });
}
