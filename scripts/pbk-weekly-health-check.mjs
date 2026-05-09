const BRIDGE_URL = String(process.env.PBK_BRIDGE_URL || process.env.PBK_HOSTED_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com')
  .trim()
  .replace(/\/+$/g, '');
const FRONTEND_URL = String(process.env.PBK_COMMAND_CENTER_URL || 'https://pbkcommandcenter.netlify.app')
  .trim()
  .replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const SLACK_WEBHOOK_URL = String(process.env.PBK_SLACK_ALERT_WEBHOOK || '').trim();
const STRICT = process.argv.includes('--strict') || /^(1|true|yes)$/i.test(String(process.env.PBK_HEALTH_STRICT || ''));
const JSON_ONLY = process.argv.includes('--json');
const NOTIFY = process.argv.includes('--notify') || /^(1|true|yes)$/i.test(String(process.env.PBK_HEALTH_NOTIFY_SLACK || ''));
const OPTIONAL_COMPONENTS = new Set(['batchdata', 'browseros', 'bytebot', 'supabaseStorage']);

function authHeaders(extra = {}) {
  return {
    ...extra,
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      parsed,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHead(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeComponentRows(components = {}) {
  return Object.entries(components).map(([key, value]) => ({
    key,
    label: value?.label || key,
    status: value?.status || 'unknown',
    ready: Boolean(value?.ready),
    optional: Boolean(value?.optional || OPTIONAL_COMPONENTS.has(key)),
    missing: Array.isArray(value?.missing) ? value.missing : [],
    note: value?.note || '',
  }));
}

function isComponentHealthy(row) {
  if (row.optional) return !['degraded'].includes(String(row.status || ''));
  return String(row.status || '') === 'up';
}

function summarizeRows(rows = []) {
  const requiredRows = rows.filter((row) => !row.optional);
  const failedRequired = requiredRows.filter((row) => !isComponentHealthy(row));
  const warnings = rows.filter((row) => !isComponentHealthy(row) || ['optional_missing', 'optional'].includes(String(row.status || '')));
  return {
    ok: failedRequired.length === 0,
    total: rows.length,
    required: requiredRows.length,
    failedRequired: failedRequired.map((row) => row.key),
    warnings: warnings.map((row) => ({
      key: row.key,
      status: row.status,
      missing: row.missing,
      note: row.note,
    })),
  };
}

function printTable(rows = []) {
  const widths = {
    component: Math.max(9, ...rows.map((row) => row.label.length)),
    status: Math.max(6, ...rows.map((row) => String(row.status || '').length)),
  };
  console.log('');
  console.log('PBK Command Center Health');
  console.log(`Bridge: ${BRIDGE_URL}`);
  console.log(`Frontend: ${FRONTEND_URL}`);
  console.log('');
  console.log(`${'Component'.padEnd(widths.component)}  ${'Status'.padEnd(widths.status)}  Notes`);
  console.log(`${'-'.repeat(widths.component)}  ${'-'.repeat(widths.status)}  -----`);
  rows.forEach((row) => {
    const missing = row.missing.length ? ` Missing: ${row.missing.join(', ')}` : '';
    const marker = row.optional ? 'optional' : 'required';
    console.log(`${row.label.padEnd(widths.component)}  ${String(row.status).padEnd(widths.status)}  ${marker}. ${row.note || ''}${missing}`);
  });
}

async function maybeNotifySlack(summary, rows) {
  if (!NOTIFY || !SLACK_WEBHOOK_URL || summary.ok) return;
  const text = [
    '*PBK health check needs attention*',
    `Bridge: ${BRIDGE_URL}`,
    `Failed required components: ${summary.failedRequired.join(', ') || 'none'}`,
    ...rows
      .filter((row) => !isComponentHealthy(row) && !row.optional)
      .map((row) => `- ${row.label}: ${row.status}${row.missing.length ? ` (${row.missing.join(', ')})` : ''}`),
  ].join('\n');
  await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch((error) => {
    console.warn(`Slack health alert failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function main() {
  const checkedAt = new Date().toISOString();
  const health = await fetchJson(`${BRIDGE_URL}/health`);
  const frontend = await fetchHead(`${FRONTEND_URL}/`);
  const voiceHealth = await fetchJson(`${BRIDGE_URL}/api/voice/browser/health`, {
    headers: authHeaders(),
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  const deepgramHealth = await fetchJson(`${BRIDGE_URL}/api/deepgram/health`, {
    headers: authHeaders(),
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  const totpStatus = await fetchJson(`${BRIDGE_URL}/api/security/totp/status`, {
    headers: authHeaders(),
  }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  if (!health.ok || health.parsed?.ok !== true) {
    const result = {
      ok: false,
      checkedAt,
      bridge: {
        ok: health.ok,
        status: health.status,
        error: health.parsed?.error || health.statusText || 'Bridge health endpoint failed.',
      },
      frontend,
    };
    if (JSON_ONLY) console.log(JSON.stringify(result, null, 2));
    else console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  const rows = normalizeComponentRows(health.parsed?.components || {});
  const summary = summarizeRows(rows);
  const result = {
    ok: rows.length > 0 && summary.ok && frontend.ok && (!STRICT || summary.warnings.length === 0),
    checkedAt,
    bridge: {
      ok: true,
      revision: health.parsed?.revision,
      status: health.parsed?.status,
      stateBackend: health.parsed?.features?.stateBackend || health.parsed?.stateBackend,
      hosted: health.parsed?.runtime?.hosted,
      authRequired: health.parsed?.features?.authRequired,
    },
    frontend,
    voiceHealth: {
      ok: Boolean(voiceHealth.ok),
      status: voiceHealth.status || null,
    },
    deepgramHealth: {
      ok: Boolean(deepgramHealth.ok),
      status: deepgramHealth.status || null,
    },
    totp: {
      ok: Boolean(totpStatus.ok),
      required: Boolean(totpStatus.parsed?.security?.totpRequired),
      configured: Boolean(totpStatus.parsed?.security?.totpConfigured),
    },
    summary,
    components: rows,
  };

  await maybeNotifySlack(summary, rows);

  if (JSON_ONLY) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTable(rows);
    console.log('');
    console.log(`Frontend: ${frontend.ok ? 'up' : `down (${frontend.status || 'no status'})`}`);
    console.log(`Browser voice health: ${voiceHealth.ok ? 'up' : 'needs attention'}`);
    console.log(`Deepgram health: ${deepgramHealth.ok ? 'up' : 'needs attention'}`);
    console.log(`TOTP: ${result.totp.required ? 'required' : 'not enforced'} / ${result.totp.configured ? 'configured' : 'not configured'}`);
    console.log('');
    console.log(result.ok ? 'PBK weekly health check passed.' : 'PBK weekly health check needs attention.');
    if (!rows.length) {
      console.log('Health components are missing. Redeploy the bridge so /health exposes the production component summary.');
    }
    if (summary.warnings.length) {
      console.log('Warnings:');
      summary.warnings.forEach((warning) => {
        console.log(`- ${warning.key}: ${warning.status}${warning.missing.length ? ` (${warning.missing.join(', ')})` : ''}`);
      });
    }
  }

  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
