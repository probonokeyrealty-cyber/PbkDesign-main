#!/usr/bin/env node

const baseUrl = String(process.env.PBK_BRIDGE_URL || process.env.PBK_OPENCLAW_BRIDGE_URL || 'http://127.0.0.1:8788').replace(/\/+$/g, '');
const apiKey = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const dryRun = /^(1|true|yes)$/i.test(String(process.env.PBK_CAMPAIGN_WORKER_DRY_RUN ?? 'true'));
const confirmProviderWrites = /^(1|true|yes)$/i.test(String(process.env.PBK_CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES || ''));
const limit = Math.max(1, Math.min(250, Number(process.env.PBK_CAMPAIGN_WORKER_MAX_STEPS || 25)));

const headers = {
  'Content-Type': 'application/json',
};
if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

const response = await fetch(`${baseUrl}/api/campaigns/run-due`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    dryRun,
    confirmProviderWrites,
    limit,
    actor: 'Campaign cron worker',
  }),
});

const text = await response.text();
let payload = null;
try {
  payload = text ? JSON.parse(text) : null;
} catch {
  payload = { raw: text };
}

if (!response.ok) {
  console.error(JSON.stringify({
    ok: false,
    status: response.status,
    payload,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  status: response.status,
  result: payload?.result || '',
  dryRun: payload?.run?.dryRun,
  processed: payload?.run?.processedCount || 0,
  skipped: payload?.run?.skippedCount || 0,
  verbiage: payload?.verbiage || '',
}, null, 2));
