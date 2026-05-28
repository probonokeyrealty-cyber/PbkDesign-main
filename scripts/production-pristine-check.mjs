const BASE_URL = String(process.env.PBK_HOSTED_BRIDGE_URL || process.env.PBK_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com')
  .trim()
  .replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const STRICT = process.argv.includes('--strict');
const JSON_ONLY = process.argv.includes('--json') || STRICT;
const OPTIONAL_PROVIDER_GAPS = new Set(
  String(process.env.PBK_OPTIONAL_PROVIDER_GAPS || 'batchdata,openclawgateway')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
const CHECK_TOTP_GAP = /^(1|true|yes)$/i.test(String(process.env.PBK_CHECK_TOTP_GAP || '').trim());
const CHECK_OPENCLAW_GATEWAY_GAP = /^(1|true|yes)$/i.test(String(process.env.PBK_CHECK_OPENCLAW_GATEWAY_GAP || '').trim());

function makeIssue(id, severity, title, evidence, action) {
  return { id, severity, title, evidence, action };
}

function normalizeStatus(value = '') {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function ageHours(value = '') {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Number(((Date.now() - timestamp) / 3600000).toFixed(1));
}

function redactPreview(value = '') {
  return String(value || '')
    .replace(/\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/g, '[phone]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .slice(0, 120);
}

function isDemoRuntimeApproval(approval = {}) {
  const source = String(approval.source || approval.fixture || approval.kind || approval.importSource || '').toLowerCase();
  const text = [
    approval.id,
    approval.taskId,
    approval.leadId,
    approval.leadName,
    approval.address,
    approval.title,
    approval.description,
    approval.notes,
    approval.fileName,
    approval.templateName,
    approval.type,
  ].filter(Boolean).join(' ');
  return source.includes('demo')
    || source.includes('fixture')
    || /approval-offer-202-cherry|approval-contract-robert-chen|approval-batch-akron|lead-diane-kowalski|lead-robert-chen|daily_probate_import\.csv|Diane Kowalski|Robert Chen|Akron Probate Batch|202 Cherry Ln|55 Birch Rd/i.test(text);
}

async function requestJson(pathname, { method = 'GET', auth = true, body = null } = {}) {
  if (auth && !API_KEY) {
    return {
      ok: false,
      status: 0,
      parsed: null,
      error: 'PBK_BRIDGE_API_KEY is not set in the local shell.',
    };
  }
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${API_KEY}`;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }
    return { ok: response.ok, status: response.status, parsed };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      parsed: null,
      error: error?.message || String(error),
    };
  }
}

function summarizeProviders(health = {}) {
  return Object.fromEntries(
    Object.entries(health.providers || {}).map(([name, meta = {}]) => {
      const missing = Array.isArray(meta.missing) ? meta.missing : [];
      const ready = meta.ready === true || meta.messagingReady === true || meta.voiceReady === true;
      return [
        name,
        {
          ready,
          configured: meta.configured === true,
          status: ready ? 'ready' : missing.length ? 'missing_env' : meta.status || 'not_ready',
          missing,
        },
      ];
    }),
  );
}

function collectPendingWork(state = {}) {
  const approvals = Array.isArray(state.approvals) ? state.approvals : [];
  const adminTasks = Array.isArray(state.adminTasks) ? state.adminTasks : [];
  return [
    ...approvals
      .filter((item) => normalizeStatus(item.status || 'pending') === 'pending')
      .filter((item) => !isDemoRuntimeApproval(item))
      .map((item) => ({
        id: item.id || '',
        lane: 'approval',
        type: item.type || item.approvalAction || 'approval',
        createdAt: item.createdAt || item.created_at || '',
        ageHours: ageHours(item.createdAt || item.created_at || ''),
        preview: redactPreview(item.summary || item.title || item.notes || item.description || item.reason || ''),
      })),
    ...adminTasks
      .filter((item) => normalizeStatus(item.status || 'pending') === 'pending')
      .map((item) => ({
        id: item.id || '',
        lane: 'admin_task',
        type: `${item.provider || 'system'}:${item.action || 'review'}`,
        createdAt: item.createdAt || item.created_at || '',
        ageHours: ageHours(item.createdAt || item.created_at || ''),
        preview: redactPreview(item.summary || item.command || ''),
      })),
  ].sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
}

function classifyIssues({ health, state, agents, manual, team, security, experiments, emotionPredict, slackHealth }) {
  const issues = [];
  if (!API_KEY) {
    issues.push(makeIssue(
      'local_bridge_key_missing',
      'critical',
      'Local shell is missing PBK_BRIDGE_API_KEY, so private production checks cannot run from CLI.',
      'Authenticated endpoints need the bridge bearer key.',
      'Set PBK_BRIDGE_API_KEY in this shell/session, then rerun npm run debug:production.',
    ));
  }
  if (!health?.ok) {
    issues.push(makeIssue(
      'bridge_health_not_ok',
      'critical',
      'Hosted bridge health is not OK.',
      health?.error || health?.status || 'No healthy /health response.',
      'Check Render deploy/logs and restart the pbk-openclaw-bridge service.',
    ));
  }
  if (health?.features?.stateBackend !== 'postgres') {
    issues.push(makeIssue(
      'state_backend_not_postgres',
      'high',
      'Hosted bridge is not using Postgres state.',
      `stateBackend=${health?.features?.stateBackend || 'missing'}`,
      'Verify PBK_DATABASE_URL/PBK_DATABASE_URL and Render Postgres wiring.',
    ));
  }

  const providerSummary = summarizeProviders(health);
  for (const [name, meta] of Object.entries(providerSummary)) {
    if (meta.ready) continue;
    if (OPTIONAL_PROVIDER_GAPS.has(name.toLowerCase())) continue;
    const severity = name === 'batchdata' ? 'medium' : 'high';
    issues.push(makeIssue(
      `provider_${name}_not_ready`,
      severity,
      `${name} provider is not ready.`,
      meta.missing.length ? `Missing: ${meta.missing.join(', ')}` : `Status: ${meta.status}`,
      name === 'batchdata'
        ? 'Add PBK_BATCHDATA_API_KEY if skip-trace should be live; otherwise track as optional.'
        : `Fix ${name} provider configuration in Render env, then redeploy/restart.`,
    ));
  }

  if (slackHealth?.slack?.notifyReady && slackHealth.slack.interactiveReady === false) {
    issues.push(makeIssue(
      'slack_interactive_bot_auth_invalid',
      'medium',
      'Slack alerts deliver, but interactive Slack buttons/thread replies are not ready.',
      {
        notifyReady: slackHealth.slack.notifyReady,
        webhookReady: slackHealth.slack.webhookReady,
        botAuthOk: slackHealth.botAuth?.ok,
        botAuthError: slackHealth.botAuth?.error || slackHealth.slack.botAuthError || 'unknown',
      },
      'Rotate/update PBK_SLACK_BOT_TOKEN in Render, then rerun npm run debug:production and /api/slack/health.',
    ));
  }

  const pendingWork = collectPendingWork(state);
  if (pendingWork.length) {
    issues.push(makeIssue(
      'pending_approvals_not_cleared',
      pendingWork.length > 10 ? 'high' : 'medium',
      `${pendingWork.length} pending approval/admin item${pendingWork.length === 1 ? '' : 's'} remain.`,
      pendingWork.slice(0, 8),
      'Review and approve/reject stale items. Do not bulk-close without founder/business decision.',
    ));
  }

  const openclawGateway = state?.status?.providers?.openclawGateway || health?.providers?.openclawGateway || {};
  const gatewayStatus = normalizeStatus(openclawGateway.status || openclawGateway.state || '');
  if (CHECK_OPENCLAW_GATEWAY_GAP && !['ready', 'up', 'connected', 'live'].includes(gatewayStatus)) {
    issues.push(makeIssue(
      'openclaw_gateway_not_live',
      'medium',
      'Optional OpenClaw local desktop gateway is not continuously connected.',
      `status=${openclawGateway.status || openclawGateway.state || 'unknown'}`,
      'Run npm run openclaw:heartbeat:status, then install/start the heartbeat service only if local desktop/file/terminal automation is required.',
    ));
  }

  const worldModel = state?.status?.worldModel || {};
  const emotional = state?.status?.emotionalIntelligence || {};
  const decisionCount = Number(worldModel.decisionCount || 0);
  const trainingReadyCount = Number(worldModel.trainingReadyCount || 0);
  const callEmotionCount = Number(emotional.callEmotionCount || 0);
  const memoryCount = Number(emotional.memoryCount || 0);
  if (decisionCount < 50 || callEmotionCount < 50) {
    issues.push(makeIssue(
      'emotion_transition_samples_low',
      'high',
      'Emotion world-model dataset is still too small.',
      { decisionCount, trainingReadyCount, callEmotionCount, memoryCount, target: '50-100 transition samples' },
      'Run live/test Telnyx calls until agent decisions and call emotions are populated, then retrain/export ONNX.',
    ));
  }
  if (emotional.worldModelProvider !== 'external_world_model' && emotionPredict?.modelProvider !== 'external_world_model') {
    issues.push(makeIssue(
      'onnx_world_model_inactive',
      'medium',
      'Emotion world model is still using heuristic fallback.',
      {
        stateProvider: emotional.worldModelProvider || 'missing',
        predictProvider: emotionPredict?.modelProvider || 'missing',
        fallbackReason: emotionPredict?.fallbackReason || null,
      },
      'After enough samples, run npm run emotion-world-model:export-onnx and configure PBK_EMOTION_WORLD_MODEL_ENDPOINT.',
    ));
  }

  const experimentCount = Array.isArray(experiments?.experiments) ? experiments.experiments.length : 0;
  const outcomeCount = Array.isArray(experiments?.outcomes) ? experiments.outcomes.length : 0;
  if (!experimentCount || !outcomeCount) {
    issues.push(makeIssue(
      'emotion_policy_experiments_empty',
      'medium',
      'Emotional policy A/B loop has no live experiment outcomes yet.',
      { experiments: experimentCount, outcomes: outcomeCount },
      'Start low-risk emotional policy experiments after real call samples exist.',
    ));
  }

  const securityMeta = security?.security || {};
  if ((CHECK_TOTP_GAP || securityMeta.totpRequired) && securityMeta.totpConfigured && !securityMeta.totpEnrolled) {
    issues.push(makeIssue(
      'totp_not_enrolled',
      'medium',
      'TOTP is configured but not enrolled, so enforcement is unsafe.',
      { totpRequired: securityMeta.totpRequired, safeToEnforce: security?.enrollment?.safeToEnforce },
      'Enroll and verify authenticator before setting PBK_TOTP_REQUIRED=true.',
    ));
  }

  if (manual?.manualControl?.notAiOnly !== true || !Array.isArray(manual?.manualControl?.manualActions)) {
    issues.push(makeIssue(
      'manual_control_contract_missing',
      'high',
      'Manual-control contract is not available.',
      manual || null,
      'Verify /api/manual/status and do not let AI-only flows block human team execution.',
    ));
  }
  if (!team?.configured) {
    issues.push(makeIssue(
      'team_passcode_missing',
      'medium',
      'Team passcode is not configured for routine manual approvals.',
      team || null,
      'Set PBK_TEAM_PASSCODE if staff should handle routine approval actions.',
    ));
  }
  if (agents?.result !== 'agent_status') {
    issues.push(makeIssue(
      'agent_debug_unavailable',
      'high',
      'Ava/Rex debug status endpoint is not available.',
      agents || null,
      'Redeploy bridge and verify /api/agents/status.',
    ));
  }
  return issues;
}

async function main() {
  const healthResult = await requestJson('/health', { auth: false });
  const stateResult = await requestJson('/state');
  const agentsResult = await requestJson('/api/agents/status');
  const manualResult = await requestJson('/api/manual/status');
  const teamResult = await requestJson('/api/auth/team/status');
  const securityResult = await requestJson('/api/security/totp/status');
  const experimentsResult = await requestJson('/api/emotion/policies/experiments');
  const slackHealthResult = await requestJson('/api/slack/health?force=1');
  const emotionPredictResult = await requestJson('/api/emotion/predict', {
    method: 'POST',
    body: {
      currentEmotion: { joy: 0.2, sadness: 0.6, anger: 0.1, fear: 0.1 },
      actionType: 'empathy_statement',
      candidateResponse: 'I hear you. Let us slow down and make sure this feels clear.',
      context: { source: 'production_pristine_check' },
    },
  });

  const health = healthResult.parsed || {};
  const state = stateResult.parsed || {};
  const agents = agentsResult.parsed || {};
  const manual = manualResult.parsed || {};
  const team = teamResult.parsed || {};
  const security = securityResult.parsed || {};
  const experiments = experimentsResult.parsed || {};
  const slackHealth = slackHealthResult.parsed || {};
  const emotionPredict = emotionPredictResult.parsed || {};
  const pendingWork = collectPendingWork(state);
  const ignoredDemoApprovalCount = (Array.isArray(state.approvals) ? state.approvals : [])
    .filter((item) => normalizeStatus(item.status || 'pending') === 'pending')
    .filter((item) => isDemoRuntimeApproval(item)).length;
  const providerSummary = summarizeProviders(health);
  const optionalIgnored = Object.entries(providerSummary)
    .filter(([name, meta]) => !meta.ready && OPTIONAL_PROVIDER_GAPS.has(name.toLowerCase()))
    .map(([name, meta]) => ({
      provider: name,
      status: meta.status,
      missing: meta.missing,
      note: 'Optional provider ignored for production readiness. Set PBK_OPTIONAL_PROVIDER_GAPS without this provider to enforce it.',
    }));
  const issues = classifyIssues({
    health,
    state,
    agents,
    manual,
    team,
    security,
    experiments,
    emotionPredict,
    slackHealth,
  });
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  issues.sort((left, right) => (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0));
  const report = {
    ok: issues.filter((issue) => ['critical', 'high'].includes(issue.severity)).length === 0,
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    authAvailable: Boolean(API_KEY),
    health: {
      status: health.status,
      revision: health.revision,
      stateBackend: health.features?.stateBackend,
      providerSummary,
    },
    production: {
      pendingWorkCount: pendingWork.length,
      pendingWorkPreview: pendingWork.slice(0, 12),
      ignoredDemoApprovalCount,
      webSearchMode: state.status?.providers?.webSearch?.mode || state.status?.webSearchMode || null,
      openclawGateway: state.status?.providers?.openclawGateway || null,
      worldModel: state.status?.worldModel || null,
      emotionalIntelligence: state.status?.emotionalIntelligence || null,
      agentDebug: {
        result: agents.result || null,
        agents: Array.isArray(agents.agents) ? agents.agents.length : 0,
      },
      manualControl: manual.manualControl || null,
      team: {
        configured: team.configured,
        permissions: team.permissions || null,
      },
      totp: security.security || null,
      experiments: {
        experiments: Array.isArray(experiments.experiments) ? experiments.experiments.length : 0,
        outcomes: Array.isArray(experiments.outcomes) ? experiments.outcomes.length : 0,
      },
      slack: slackHealth.slack || null,
      emotionPredict: {
        modelProvider: emotionPredict.modelProvider || null,
        model: emotionPredict.model || null,
        fallbackReason: emotionPredict.fallbackReason || null,
      },
      optionalIgnored,
    },
    issues,
  };

  if (JSON_ONLY) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(JSON.stringify({
      ok: report.ok,
      checkedAt: report.checkedAt,
      pendingWorkCount: report.production.pendingWorkCount,
      ignoredDemoApprovalCount: report.production.ignoredDemoApprovalCount,
      webSearchMode: report.production.webSearchMode,
      agentDebug: report.production.agentDebug,
      manualActions: report.production.manualControl?.manualActions?.length || 0,
      optionalIgnored: report.production.optionalIgnored,
      issues: report.issues.map((issue) => ({
        severity: issue.severity,
        id: issue.id,
        title: issue.title,
        action: issue.action,
      })),
    }, null, 2));
  }

  if (STRICT && !report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    result: 'production_pristine_check_failed',
    error: error?.message || String(error),
  }, null, 2));
  process.exit(1);
});
