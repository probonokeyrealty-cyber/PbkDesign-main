#!/usr/bin/env node

const BRIDGE_URL = String(process.env.PBK_BRIDGE_URL || process.env.PBK_PUBLIC_BASE_URL || 'https://pbk-openclaw-bridge.onrender.com').replace(/\/+$/, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();

function requireEnv(value, name) {
  if (!value) {
    throw new Error(`${name} is required. Set it in your shell or Render environment before activation.`);
  }
}

async function bridgeFetch(pathname, options = {}) {
  const response = await fetch(`${BRIDGE_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  requireEnv(API_KEY, 'PBK_BRIDGE_API_KEY');
  const targetMonthlyRevenue = Math.max(1, Number(process.env.PBK_REVENUE_TARGET_MONTHLY || 1_000_000));
  const activate = await bridgeFetch('/api/v1/command-center/activate', {
    method: 'POST',
    body: JSON.stringify({
      requestedBy: 'command-center-activation-script',
      targetMonthlyRevenue,
      lowRiskAutopilot: true,
      runNow: true,
    }),
  });
  const status = await bridgeFetch('/api/v1/command-center/closed-loop/status');
  console.log(JSON.stringify({
    ok: true,
    bridgeUrl: BRIDGE_URL,
    activation: {
      result: activate.result,
      id: activate.activation?.id || '',
      providerWritesBlocked: activate.providerWritesBlocked,
      approvalMode: activate.approvalMode,
      runSummary: activate.activation?.runSummary || {},
    },
    status: {
      enabled: status.enabled,
      lowRiskAutopilot: status.lowRiskAutopilot,
      providerWritesBlocked: status.providerWritesBlocked,
      highRiskApprovalRequired: status.highRiskApprovalRequired,
      targetMonthlyRevenue: status.targetMonthlyRevenue,
      recentRevenueActions: (status.recentRevenueActions || []).length,
      recentCallAnalyses: (status.recentCallAnalyses || []).length,
      gaps: status.gaps || [],
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
