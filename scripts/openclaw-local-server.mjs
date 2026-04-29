import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createPrivateKey, createSign as __dsCreateSign, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import pg from 'pg';
const { Pool: PgPool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_REVISION = '2026-04-26-providers-live-v8';

const IS_RESET = process.argv.includes('--reset') || /^(1|true|yes)$/i.test(String(process.env.PBK_OPENCLAW_RESET || '').trim());
const IS_LAN = process.argv.includes('--lan');
const IS_PUBLIC = process.argv.includes('--public');
const IS_HOSTED =
  IS_PUBLIC ||
  Boolean(process.env.RENDER) ||
  Boolean(process.env.FLY_APP_NAME) ||
  process.env.NODE_ENV === 'production';

const STATE_DIR_ENV = String(process.env.PBK_OPENCLAW_STATE_DIR || '').trim();
const RUNTIME_DIR = STATE_DIR_ENV
  ? path.isAbsolute(STATE_DIR_ENV)
    ? STATE_DIR_ENV
    : path.resolve(ROOT_DIR, STATE_DIR_ENV)
  : path.join(ROOT_DIR, '.pbk-local');
const STATE_FILE = path.join(RUNTIME_DIR, 'openclaw-state.json');

const HOST =
  process.env.PBK_OPENCLAW_HOST ||
  process.env.HOST ||
  (IS_HOSTED || IS_LAN ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PBK_OPENCLAW_PORT || process.env.PORT || 8788);

function looksLikeTruncatedPemStub(value = '') {
  const normalized = String(value || '').replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim();
  return normalized === '-----BEGIN RSA PRIVATE KEY-----' || normalized.length < 64;
}

function hydrateWindowsUserEnv(keys = []) {
  if (process.platform !== 'win32' || !Array.isArray(keys) || !keys.length) return;
  try {
    const quotedKeys = keys.map((key) => `'${String(key).replace(/'/g, "''")}'`).join(', ');
    const psScript = [
      `$names = @(${quotedKeys})`,
      '$result = @{}',
      'foreach ($name in $names) {',
      "  $value = [Environment]::GetEnvironmentVariable($name, 'User')",
      '  if ($null -ne $value -and $value -ne "") {',
      '    $result[$name] = $value',
      '  }',
      '}',
      '$result | ConvertTo-Json -Compress',
    ].join('; ');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    if (!output) return;
    const values = JSON.parse(output);
    for (const key of keys) {
      const candidate = typeof values?.[key] === 'string' ? values[key] : '';
      if (!candidate) continue;
      const current = String(process.env[key] || '');
      const shouldHydrate = !current || (key === 'PBK_DOCUSIGN_PRIVATE_KEY' && looksLikeTruncatedPemStub(current));
      if (shouldHydrate) {
        process.env[key] = candidate;
      }
    }
  } catch {
    // Founder-local convenience only. Runtime should continue even if user-env hydration fails.
  }
}

hydrateWindowsUserEnv([
  'PBK_DOCUSIGN_INTEGRATION_KEY',
  'PBK_DOCUSIGN_USER_ID',
  'PBK_DOCUSIGN_ACCOUNT_ID',
  'PBK_DOCUSIGN_AUTH_HOST',
  'PBK_DOCUSIGN_REST_BASE',
  'PBK_DOCUSIGN_PRIVATE_KEY',
]);

const APPROVAL_WEBHOOK_URL = String(process.env.PBK_N8N_APPROVAL_WEBHOOK || '').trim();
const LEAD_WEBHOOK_URL = String(process.env.PBK_N8N_LEAD_WEBHOOK || '').trim();
const PUBLIC_BASE_URL = String(process.env.PBK_PUBLIC_BASE_URL || process.env.PBK_BRIDGE_PUBLIC_URL || '')
  .trim()
  .replace(/\/+$/g, '');
const TELNYX_API_KEY = String(process.env.PBK_TELNYX_API_KEY || process.env.TELNYX_API_KEY || '').trim();
const TELNYX_CONNECTION_ID = String(process.env.PBK_TELNYX_CONNECTION_ID || '').trim();
const TELNYX_FROM_NUMBER = String(process.env.PBK_TELNYX_FROM_NUMBER || '').trim();
const TELNYX_MESSAGING_PROFILE_ID = String(process.env.PBK_TELNYX_MESSAGING_PROFILE_ID || '').trim();
const TELNYX_WEBHOOK_URL = String(
  process.env.PBK_TELNYX_WEBHOOK_URL || (PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/api/webhooks/telnyx` : ''),
)
  .trim()
  .replace(/\/+$/g, '');

// ── DocuSign JWT auth ───────────────────────────────────────────────────────
const DOCUSIGN_INTEGRATION_KEY = String(process.env.PBK_DOCUSIGN_INTEGRATION_KEY || process.env.DOCUSIGN_INTEGRATION_KEY || '').trim();
const DOCUSIGN_USER_ID = String(process.env.PBK_DOCUSIGN_USER_ID || process.env.DOCUSIGN_USER_ID || '').trim();
const DOCUSIGN_ACCOUNT_ID = String(process.env.PBK_DOCUSIGN_ACCOUNT_ID || process.env.DOCUSIGN_ACCOUNT_ID || '').trim();
const DOCUSIGN_AUTH_HOST = String(process.env.PBK_DOCUSIGN_AUTH_HOST || 'account-d.docusign.com').trim();
let DOCUSIGN_REST_BASE = String(process.env.PBK_DOCUSIGN_REST_BASE || 'https://demo.docusign.net/restapi').trim().replace(/\/+$/g, '');
const DOCUSIGN_PRIVATE_KEY = String(process.env.PBK_DOCUSIGN_PRIVATE_KEY || process.env.DOCUSIGN_PRIVATE_KEY || '');
const DOCUSIGN_PRIVATE_KEY_B64 = String(
  process.env.PBK_DOCUSIGN_PRIVATE_KEY_B64
    || process.env.PBK_DOCUSIGN_PRIVATE_KEY_BASE64
    || process.env.DOCUSIGN_PRIVATE_KEY_B64
    || process.env.DOCUSIGN_PRIVATE_KEY_BASE64
    || '',
).trim();
const DOCUSIGN_PRIVATE_KEY_PATH = String(
  process.env.PBK_DOCUSIGN_PRIVATE_KEY_PATH
    || process.env.DOCUSIGN_PRIVATE_KEY_PATH
    || '',
).trim();

// ── BatchData skip-trace ────────────────────────────────────────────────────
const BATCHDATA_API_KEY = String(process.env.PBK_BATCHDATA_API_KEY || process.env.BATCHDATA_API_KEY || '').trim();
const BATCHDATA_BASE_URL = String(process.env.PBK_BATCHDATA_BASE_URL || 'https://api.batchdata.com').trim().replace(/\/+$/g, '');

// ── Slack incoming webhook ──────────────────────────────────────────────────
const SLACK_WEBHOOK_URL = String(process.env.PBK_SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || '').trim();
const RESEND_API_KEY = String(process.env.PBK_RESEND_API_KEY || process.env.RESEND_API_KEY || '').trim();
const MAIN_BUSINESS_EMAIL = String(process.env.PBK_MAIN_BUSINESS_EMAIL || process.env.MAIN_BUSINESS_EMAIL || 'jordan@pbk.capital').trim();
const COLD_CAMPAIGN_EMAIL = String(process.env.PBK_COLD_CAMPAIGN_EMAIL || process.env.COLD_CAMPAIGN_EMAIL || 'offers@pbkoutreach.local').trim();
const INSTANTLY_API_KEY = String(process.env.PBK_INSTANTLY_API_KEY || process.env.INSTANTLY_API_KEY || '').trim();
const INSTANTLY_BASE_URL = String(process.env.PBK_INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2').trim().replace(/\/+$/g, '');
const INSTANTLY_WARMUP_ENABLE_ENDPOINT = String(process.env.PBK_INSTANTLY_WARMUP_ENABLE_ENDPOINT || '/accounts/warmup/enable').trim();
const INSTANTLY_DOMAIN_ORDER_ENDPOINT = String(process.env.PBK_INSTANTLY_DOMAIN_ORDER_ENDPOINT || '/dfy-email-account-orders').trim();
const INSTANTLY_DOMAIN_SETUP_WEBHOOK_URL = String(process.env.PBK_INSTANTLY_DOMAIN_SETUP_WEBHOOK || '').trim();
const RENDER_API_KEY = String(process.env.PBK_RENDER_API_KEY || process.env.RENDER_API_KEY || '').trim();
const RENDER_SERVICE_ID = String(process.env.PBK_RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID || '').trim();
const RENDER_BASE_URL = String(process.env.PBK_RENDER_BASE_URL || 'https://api.render.com/v1').trim().replace(/\/+$/g, '');
const BROWSEROS_MCP_URL = String(process.env.PBK_BROWSEROS_MCP_URL || 'http://127.0.0.1:9000/mcp').trim();
const DEFAULT_BOOKING_LINK = String(process.env.PBK_BOOKING_LINK || process.env.PBK_CALENDAR_BOOKING_URL || 'https://cal.com/pbk-capital/intro-call').trim();
const DEFAULT_LEAD_TIMEZONE = String(process.env.PBK_DEFAULT_LEAD_TIMEZONE || 'America/New_York').trim();
const AUTO_DIAL_IMMEDIATE_REPLIES = !/^(0|false|no)$/i.test(String(process.env.PBK_REPLY_AUTO_DIAL_IMMEDIATE || 'true').trim());
const AUTO_SEND_REPLY_FOLLOWUPS = /^(1|true|yes)$/i.test(String(process.env.PBK_REPLY_AUTO_SEND_FOLLOWUPS || '').trim());
const GOOGLE_CALENDAR_ACCESS_TOKEN = String(process.env.PBK_GOOGLE_CALENDAR_ACCESS_TOKEN || '').trim();
const GOOGLE_CALENDAR_ID = String(process.env.PBK_GOOGLE_CALENDAR_ID || 'primary').trim();
const CALENDAR_SYNC_WEBHOOK_URL = String(process.env.PBK_CALENDAR_SYNC_WEBHOOK || '').trim();
const STREAK_API_KEY = String(process.env.PBK_STREAK_API_KEY || process.env.STREAK_API_KEY || '').trim();
const STREAK_BASE_URL = String(process.env.PBK_STREAK_BASE_URL || 'https://api.streak.com/api').trim().replace(/\/+$/g, '');
const STREAK_PIPELINE_KEY = String(process.env.PBK_STREAK_PIPELINE_KEY || '').trim();
const STREAK_STAGE_MAP_RAW = String(process.env.PBK_STREAK_STAGE_MAP || '').trim();
const STREAK_FIELD_MAP_RAW = String(process.env.PBK_STREAK_FIELD_MAP || '').trim();
const STREAK_AUTO_CREATE_BOX = !/^(0|false|no)$/i.test(String(process.env.PBK_STREAK_AUTO_CREATE_BOX || 'true').trim());
const CRM_SYNC_WEBHOOK_URL = String(process.env.PBK_CRM_SYNC_WEBHOOK || '').trim();

// Bearer token required on mutating endpoints when set. Leave unset for local
// dev so the bridge stays open on 127.0.0.1. Set on hosted deploys.
const BRIDGE_API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();

// Endpoints that stay open even when PBK_BRIDGE_API_KEY is set, so external
// healthchecks (Render, uptime monitors) can still reach the bridge.
const PUBLIC_PATHS = new Set(['/', '/health', '/status', '/api/health', '/api/status']);

// Postgres state backend. When PBK_DATABASE_URL is set the bridge persists
// state to a 'bridge_state' table (single row, JSONB column) instead of the
// .pbk-local/openclaw-state.json file. Survives Render free-tier cold starts.
const DATABASE_URL = String(process.env.PBK_DATABASE_URL || '').trim();
const STATE_BACKEND = DATABASE_URL ? 'postgres' : 'file';

const SHOULD_RESET = IS_RESET;

const TOOL_NAMES = [
  'analyzeDeal',
  'classifyParticipant',
  'getParticipantProfile',
  'getBrainEmailContext',
  'getReplyTemplates',
  'getAdminPersistenceStatus',
  'getDocuSignProviderStatus',
  'inspectStreakPipeline',
  'getStreakBootstrapPlan',
  'bootstrapStreakPipeline',
  'routeAdminCommand',
  'createApproval',
  'handleReplyIntent',
  'updateCRM',
  'ingestResearchDoc',
  'getBrainState',
  'checkDNC',
  'sendColdEmail',
  'scheduleAppointment',
  'telnyx_call',
  'telnyx_sms',
  'sendDocuSign',
  'sendContract',
  'skipTrace',
  'detectYelling',
  'slackNotify',
  'sendSellerDocs',
  'prepareContract',
  'contractLawyerReview',
  'requestAdminAction',
  'launchBrowserResearch',
  'runAgentCommand',
];

const LIMITS = {
  approvals: 60,
  activity: 160,
  brainDocs: 90,
  leadImports: 90,
  analyzerRuns: 90,
  dncEntries: 120,
  calls: 90,
  messages: 140,
  appointments: 120,
  leadStageTransitions: 180,
  contracts: 90,
  documentDeliveries: 120,
  adminTasks: 90,
  adminAudit: 160,
};

const DEFAULT_PREVIEW_ORIGIN = String(process.env.PBK_DOCUMENTS_ORIGIN || 'https://pbkcommandcenter.netlify.app').trim();
const RUNTIME_MODE = IS_HOSTED ? 'hosted' : IS_LAN ? 'lan' : 'local';
const CONTRACTS_DIR = path.join(ROOT_DIR, 'contracts');
const META_AGENT_SCENARIO_FILE = path.join(ROOT_DIR, 'labs', 'meta-agent', 'generated', 'latest-scenario.json');
const BROWSER_RESEARCH_JOBS_FILE = path.join(ROOT_DIR, 'ops', 'browser-research', 'generated-jobs.json');
const BROWSER_RESEARCH_TARGETS_FILE = path.join(ROOT_DIR, 'ops', 'browser-research', 'targets.example.json');
const MCP_REGISTRY_FILE = path.join(ROOT_DIR, 'mcp-servers', 'registry.example.json');
const N8N_TOOLING_WORKFLOW_FILE = path.join(ROOT_DIR, 'n8n-lite', 'tooling-health-check.json');
const OBSERVABILITY_COMPOSE_FILE = path.join(ROOT_DIR, 'ops', 'monitoring', 'docker-compose.observability.yml');
const OBSERVABILITY_DASHBOARD_FILE = path.join(ROOT_DIR, 'ops', 'monitoring', 'grafana', 'dashboards', 'pbk-runtime.json');
const OBSERVABILITY_PROM_FILE = path.join(ROOT_DIR, 'ops', 'monitoring', 'prometheus', 'generated.prometheus.yml');
const TOOLING_VERIFY_WORKFLOW_FILE = path.join(ROOT_DIR, '.github', 'workflows', 'tooling-verify.yml');

function isoNow() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trimArray(items = [], limit = 25) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizePhone(value = '') {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

function getRuntimeWarnings() {
  const warnings = [];
  if (IS_HOSTED && !BRIDGE_API_KEY) {
    warnings.push('PBK_BRIDGE_API_KEY is not set.');
  }
  if (IS_HOSTED && STATE_BACKEND !== 'postgres') {
    warnings.push('Hosted bridge is still using file-backed state. Set PBK_DATABASE_URL.');
  }
  if (IS_HOSTED && !APPROVAL_WEBHOOK_URL) {
    warnings.push('PBK_N8N_APPROVAL_WEBHOOK is not set.');
  }
  if (IS_HOSTED && !LEAD_WEBHOOK_URL) {
    warnings.push('PBK_N8N_LEAD_WEBHOOK is not set.');
  }
  return warnings;
}

function getEffectiveTelnyxFromNumber() {
  return normalizePhone(state?.status?.defaultTelnyxFromNumber || TELNYX_FROM_NUMBER);
}

function normalizePrivateKeyPem(value = '') {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
}

function looksLikeBase64Blob(value = '') {
  const trimmed = String(value || '').replace(/\s+/g, '');
  return Boolean(trimmed)
    && trimmed.length >= 64
    && trimmed.length % 4 === 0
    && /^[A-Za-z0-9+/=]+$/.test(trimmed);
}

function resolveDocuSignPrivateKeyMaterial() {
  const discoveryIssues = [];
  const issues = [];
  const candidates = [];
  const normalizedPath = DOCUSIGN_PRIVATE_KEY_PATH
    ? (path.isAbsolute(DOCUSIGN_PRIVATE_KEY_PATH)
      ? DOCUSIGN_PRIVATE_KEY_PATH
      : path.resolve(ROOT_DIR, DOCUSIGN_PRIVATE_KEY_PATH))
    : '';

  if (normalizedPath) {
    if (existsSync(normalizedPath)) {
      candidates.push({
        source: 'path',
        path: normalizedPath,
        raw: readFileSync(normalizedPath, 'utf8'),
      });
    } else {
      discoveryIssues.push(`PBK_DOCUSIGN_PRIVATE_KEY_PATH does not exist: ${normalizedPath}`);
    }
  }

  if (DOCUSIGN_PRIVATE_KEY) {
    candidates.push({
      source: 'env',
      path: '',
      raw: DOCUSIGN_PRIVATE_KEY,
    });
  }

  if (DOCUSIGN_PRIVATE_KEY_B64) {
    try {
      candidates.push({
        source: 'env-b64',
        path: '',
        raw: Buffer.from(DOCUSIGN_PRIVATE_KEY_B64, 'base64').toString('utf8'),
      });
    } catch (error) {
      discoveryIssues.push(`PBK_DOCUSIGN_PRIVATE_KEY_B64 could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let chosen = candidates.find((candidate) => /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(candidate.raw || ''));
  if (!chosen) {
    chosen = candidates.find((candidate) => looksLikeBase64Blob(candidate.raw || ''));
    if (chosen) {
      try {
        chosen = {
          ...chosen,
          source: `${chosen.source}-decoded`,
          raw: Buffer.from(String(chosen.raw || '').replace(/\s+/g, ''), 'base64').toString('utf8'),
        };
      } catch (error) {
        discoveryIssues.push(`DocuSign private key base64 payload could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (!chosen && discoveryIssues.length) {
    issues.push(...discoveryIssues);
  }

  const raw = String(chosen?.raw || '');
  const normalized = normalizePrivateKeyPem(raw);
  const lineCount = normalized ? normalized.split('\n').filter(Boolean).length : 0;
  const headerPresent = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(normalized);
  const footerPresent = /-----END [A-Z0-9 ]*PRIVATE KEY-----/i.test(normalized);
  const looksTruncated = Boolean(normalized) && normalized.length < 128;

  if (normalized && looksTruncated) {
    issues.push('DocuSign private key looks truncated. PBK needs the full PEM body, not just the BEGIN header.');
  }
  if (normalized && headerPresent && !footerPresent) {
    issues.push('DocuSign private key is missing the END PRIVATE KEY footer.');
  }
  if (normalized && !headerPresent) {
    issues.push('DocuSign private key does not look like PEM text. Use the full PEM, PBK_DOCUSIGN_PRIVATE_KEY_B64, or PBK_DOCUSIGN_PRIVATE_KEY_PATH.');
  }

  let keyObject = null;
  let parseError = '';
  if (normalized && headerPresent && footerPresent && !looksTruncated) {
    try {
      keyObject = createPrivateKey({ key: normalized, format: 'pem' });
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
      issues.push(`DocuSign private key could not be parsed: ${parseError}`);
    }
  }

  return {
    source: chosen?.source || (normalizedPath ? 'path-missing' : DOCUSIGN_PRIVATE_KEY_B64 ? 'env-b64-missing' : DOCUSIGN_PRIVATE_KEY ? 'env-invalid' : 'missing'),
    path: chosen?.path || normalizedPath || '',
    normalized,
    rawLength: raw.length,
    lineCount,
    headerPresent,
    footerPresent,
    looksTruncated,
    parsed: Boolean(keyObject),
    parseError,
    issues,
    keyObject,
  };
}

const DOCUSIGN_PRIVATE_KEY_MATERIAL = resolveDocuSignPrivateKeyMaterial();

function buildDocuSignProviderStatus() {
  const missing = [];
  if (!DOCUSIGN_INTEGRATION_KEY) missing.push('PBK_DOCUSIGN_INTEGRATION_KEY');
  if (!DOCUSIGN_USER_ID) missing.push('PBK_DOCUSIGN_USER_ID');
  if (!DOCUSIGN_ACCOUNT_ID) missing.push('PBK_DOCUSIGN_ACCOUNT_ID');
  if (!DOCUSIGN_PRIVATE_KEY_MATERIAL.normalized) {
    missing.push(DOCUSIGN_PRIVATE_KEY_PATH ? 'PBK_DOCUSIGN_PRIVATE_KEY_PATH' : 'PBK_DOCUSIGN_PRIVATE_KEY');
  }

  const issues = [...DOCUSIGN_PRIVATE_KEY_MATERIAL.issues];
  const configured = missing.length === 0;
  const ready = configured && issues.length === 0 && DOCUSIGN_PRIVATE_KEY_MATERIAL.parsed;

  let summary = 'DocuSign provider is ready for JWT auth and envelope sends.';
  if (missing.length) {
    summary = `DocuSign is missing required configuration: ${missing.join(', ')}.`;
  } else if (issues.length) {
    summary = issues[0];
  }

  return {
    ok: true,
    configured,
    ready,
    authHost: DOCUSIGN_AUTH_HOST,
    restBase: DOCUSIGN_REST_BASE,
    missing,
    issues,
    summary,
    privateKey: {
      source: DOCUSIGN_PRIVATE_KEY_MATERIAL.source,
      path: DOCUSIGN_PRIVATE_KEY_MATERIAL.path || '',
      rawLength: DOCUSIGN_PRIVATE_KEY_MATERIAL.rawLength,
      lineCount: DOCUSIGN_PRIVATE_KEY_MATERIAL.lineCount,
      headerPresent: DOCUSIGN_PRIVATE_KEY_MATERIAL.headerPresent,
      footerPresent: DOCUSIGN_PRIVATE_KEY_MATERIAL.footerPresent,
      looksTruncated: DOCUSIGN_PRIVATE_KEY_MATERIAL.looksTruncated,
      parsed: DOCUSIGN_PRIVATE_KEY_MATERIAL.parsed,
      parseError: DOCUSIGN_PRIVATE_KEY_MATERIAL.parseError || '',
    },
  };
}

function buildAdminPersistenceStatus() {
  const effectiveCallerId = getEffectiveTelnyxFromNumber();
  const renderConfigured = Boolean(RENDER_API_KEY && RENDER_SERVICE_ID);
  const renderMirrorStatus = state?.status?.telnyxCallerIdRenderSyncStatus || (renderConfigured ? 'unknown' : 'not-configured');
  const renderMirrored = renderMirrorStatus === 'synced';
  return {
    ok: true,
    telnyxCallerId: {
      value: effectiveCallerId || '',
      bridgeDefaultUpdated: Boolean(state?.status?.defaultTelnyxFromNumber),
      persistedToStateBackend: Boolean(effectiveCallerId),
      stateBackend: STATE_BACKEND,
      lastChangedAt: state?.status?.telnyxCallerIdLastChangeAt || null,
      lastValidatedAt: state?.status?.telnyxCallerIdLastValidatedAt || null,
      render: {
        configured: renderConfigured,
        serviceId: RENDER_SERVICE_ID || '',
        mirrored: renderMirrored,
        syncStatus: renderMirrorStatus,
        lastSyncedAt: state?.status?.telnyxCallerIdRenderLastSyncAt || null,
        lastError: state?.status?.telnyxCallerIdRenderLastError || '',
      },
      summary: renderMirrored
        ? 'Caller ID is persisted in PBK state and mirrored to Render.'
        : renderConfigured
          ? 'Caller ID is persisted in PBK state, but Render mirroring has not completed for the current value.'
          : 'Caller ID is persisted in PBK state only because Render mirroring is not configured.',
    },
    docusign: buildDocuSignProviderStatus(),
  };
}

function getTelnyxProviderMeta() {
  const effectiveFromNumber = getEffectiveTelnyxFromNumber();
  const fromNumberConfigured = Boolean(effectiveFromNumber);
  const webhookConfigured = Boolean(TELNYX_WEBHOOK_URL);
  const messagingReady = Boolean(TELNYX_API_KEY && fromNumberConfigured);
  const voiceReady = Boolean(messagingReady && TELNYX_CONNECTION_ID);

  const messagingMissing = [];
  const voiceMissing = [];

  if (!TELNYX_API_KEY) {
    messagingMissing.push('PBK_TELNYX_API_KEY');
    voiceMissing.push('PBK_TELNYX_API_KEY');
  }
  if (!fromNumberConfigured) {
    messagingMissing.push('PBK_TELNYX_FROM_NUMBER');
    voiceMissing.push('PBK_TELNYX_FROM_NUMBER');
  }
  if (!TELNYX_CONNECTION_ID) {
    voiceMissing.push('PBK_TELNYX_CONNECTION_ID');
  }

  return {
    configured: Boolean(TELNYX_API_KEY),
    fromNumberConfigured,
    effectiveFromNumber,
    connectionIdConfigured: Boolean(TELNYX_CONNECTION_ID),
    messagingProfileConfigured: Boolean(TELNYX_MESSAGING_PROFILE_ID),
    webhookConfigured,
    publicBaseUrlConfigured: Boolean(PUBLIC_BASE_URL),
    messagingReady,
    voiceReady,
    stateSyncReady: webhookConfigured,
    messagingMissing,
    voiceMissing,
    warnings:
      messagingReady && !webhookConfigured
        ? ['PBK_TELNYX_WEBHOOK_URL or PBK_PUBLIC_BASE_URL is not set; Telnyx state updates rely on provider-side defaults.']
        : [],
  };
}

function getRuntimeMeta() {
  const warnings = getRuntimeWarnings();
  return {
    mode: RUNTIME_MODE,
    hosted: IS_HOSTED,
    authRequired: Boolean(BRIDGE_API_KEY),
    stateBackend: STATE_BACKEND,
    productionReady: !IS_HOSTED || warnings.length === 0,
    providers: {
      telnyx: getTelnyxProviderMeta(),
      instantly: getInstantlyProviderMeta(),
      googleCalendar: getGoogleCalendarProviderMeta(),
      streak: getStreakProviderMeta(),
      crmSync: getCrmSyncProviderMeta(),
      render: getRenderProviderMeta(),
    },
    warnings,
  };
}

function hashString(value = '') {
  let hash = 0;
  const normalized = String(value || 'pbk').trim();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash || 1);
}

function jsonStringify(value) {
  return JSON.stringify(value, null, 2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJsonObjectEnv(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeStageToken(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function toReadableStageName(value = '') {
  const normalized = normalizeStageToken(value);
  if (!normalized) return '';
  const special = {
    dnc: 'DNC',
  };
  if (special[normalized]) return special[normalized];
  return normalized
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function safeFilename(value = '') {
  return String(value || 'PBK_Document')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

function getLocalChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  return candidates.find((candidate) => {
    try {
      return Boolean(candidate && existsSync(candidate));
    } catch {
      return false;
    }
  });
}

async function launchPdfBrowserWithRetry() {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const localChromePath = getLocalChromePath();
      return await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: localChromePath || (await chromium.executablePath()),
        headless: 'new',
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await sleep(800);
      }
    }
  }

  throw lastError;
}

function renderPdfFallbackHtml(payload = {}) {
  const title = payload.documentTitle || 'PBK Document';
  const company = payload.companyName || 'Probono Key Realty';
  const address = payload.propertyAddress || 'No property loaded';
  const pathLabel = payload.selectedPathLabel || 'Selected Path';
  const body = payload.content || 'No document content available.';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: Letter; margin: 0.5in; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #111827;
        background: #f8fafc;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
      }
      .page {
        min-height: 10in;
        border: 1px solid #dbe3ef;
        border-radius: 22px;
        background: rgba(255,255,255,0.94);
        padding: 28px;
        box-shadow: 0 20px 45px rgba(15,23,42,0.08);
      }
      .eyebrow {
        color: #2563eb;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      h1 {
        margin: 8px 0 6px;
        font-size: 26px;
        line-height: 1.15;
        letter-spacing: -0.03em;
      }
      .meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 14px 0 20px;
      }
      .pill {
        border: 1px solid #dbeafe;
        border-radius: 999px;
        background: #eff6ff;
        color: #1d4ed8;
        padding: 6px 10px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 11.5px;
        line-height: 1.65;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="eyebrow">${escapeHtml(company)}</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        <span class="pill">${escapeHtml(pathLabel)}</span>
        <span class="pill">${escapeHtml(address)}</span>
        <span class="pill">${escapeHtml(new Date().toLocaleDateString('en-US'))}</span>
      </div>
      <pre>${escapeHtml(body)}</pre>
    </main>
  </body>
</html>`;
}

function buildPdfPreviewUrl(payload = {}) {
  if (payload.previewUrl) return String(payload.previewUrl).trim();
  if (!payload.masterPackageQuery) return '';

  const origin = String(payload.previewOrigin || DEFAULT_PREVIEW_ORIGIN || '').trim();
  if (!origin) return '';

  const url = new URL('/PBK_Master_Deal_Package.html', origin);
  url.search = String(payload.masterPackageQuery).startsWith('?')
    ? String(payload.masterPackageQuery)
    : `?${payload.masterPackageQuery}`;
  url.searchParams.set('pbk_preview', '1');
  url.searchParams.delete('pbk_print');
  return url.toString();
}

async function generatePdfDocument(payload = {}) {
  let browser;

  try {
    browser = await launchPdfBrowserWithRetry();
    const page = await browser.newPage();
    const previewUrl = buildPdfPreviewUrl(payload);

    if (previewUrl) {
      await page.goto(previewUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      await page.emulateMediaType('print');
      await page.evaluate(() => document.fonts?.ready);
      await sleep(400);
    } else {
      await page.setContent(renderPdfFallbackHtml(payload), { waitUntil: 'networkidle0' });
    }

    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.6in',
        left: '0.5in',
      },
      headerTemplate:
        '<div style="width:100%;font-size:9px;color:#64748b;padding:0 0.5in;font-family:Inter,Arial,sans-serif;">PBK Deal Package</div>',
      footerTemplate:
        '<div style="width:100%;font-size:9px;color:#64748b;padding:0 0.5in;font-family:Inter,Arial,sans-serif;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function getItemTimestamp(item = {}) {
  return (
    item.updatedAt ||
    item.actedAt ||
    item.completedAt ||
    item.startedAt ||
    item.createdAt ||
    item.at ||
    item.addedAt ||
    ''
  );
}

function sortNewest(items = []) {
  return [...items].sort((left, right) => String(getItemTimestamp(right)).localeCompare(String(getItemTimestamp(left))));
}

function currency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(toNumber(value, 0));
}

function averagePrices(deal = {}) {
  const prices = ['A', 'B', 'C']
    .map((key) => toNumber(deal?.comps?.[key]?.price, 0))
    .filter((value) => value > 0);
  if (!prices.length) return 0;
  return Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
}

function buildToolUsageSeed() {
  return Object.fromEntries(TOOL_NAMES.map((toolName) => [toolName, 0]));
}

function makeActivity({
  actor = 'System',
  category = 'INFO',
  status = 'success',
  text = '',
  target = '',
  at = isoNow(),
}) {
  return {
    id: randomUUID(),
    at,
    actor,
    category,
    status,
    text,
    target,
  };
}

function buildDefaultBrainDocs() {
  return [
    {
      id: 'brain-70-rule',
      kind: 'pdf',
      topic: 'Wholesaling',
      title: 'The 70% Rule: When to Break It and When to Obey It',
      source: 'PBK memo',
      excerpt:
        'Use the 70% rule as a speed filter, not as theology. Thin-comp markets need stronger downside protection and narrative-based comp review.',
      summary:
        'Use the 70% rule as a speed filter. In thin-comp markets, protect the downside with stronger repair buffers and better comp notes.',
      citation: 'PBK memo - 12 pages',
      createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      tags: ['Wholesaling', 'Analyzer', 'MAO'],
    },
    {
      id: 'brain-probate-2026',
      kind: 'article',
      topic: 'Probate',
      title: 'Why Probate Is Still a Great Lead Source',
      source: 'REtipster',
      excerpt:
        'Executor fatigue, equity, and urgency still combine into one of the highest-signal direct-to-seller profiles.',
      summary:
        'Probate leads remain high-signal when outreach is empathetic and executor authority is confirmed before price talk.',
      citation: 'REtipster - 8 min read',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      tags: ['Probate', 'Wholesaling', 'Negotiation'],
    },
    {
      id: 'brain-subto-case',
      kind: 'case',
      topic: 'Subject-To',
      title: '$47k Assignment Fee on a Subject-To Deal',
      source: 'PBK case file',
      excerpt:
        'A 3.2% mortgage stayed in place, the buyer stepped into the payments, and the seller got relief without listing.',
      summary:
        'Use subject-to when the debt is attractive, the seller wants speed, and the buyer can absorb payment risk with clear disclosure.',
      citation: 'PBK case CF-0412',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
      tags: ['Subject-To', 'Creative Finance', 'Case Study'],
    },
    {
      id: 'brain-tcpa-consent',
      kind: 'legal',
      topic: 'Legal & TCPA',
      title: 'TCPA One-to-One Consent for Wholesalers',
      source: 'FCC.gov',
      excerpt:
        'Each lead form must name your company specifically. Shared blanket consent no longer protects AI-led telemarketing.',
      summary:
        'Keep one-to-one consent language on every lead form, store consent timestamps, and start every AI call with clear disclosure.',
      citation: 'FCC ruling summary',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
      tags: ['Compliance', 'Legal & TCPA', 'Voice'],
    },
    {
      id: 'brain-akron-notes',
      kind: 'note',
      topic: 'Market Reports',
      title: "Jordan's notes: Akron vs Columbus seller psychology",
      source: 'Voice memo',
      excerpt:
        'Akron responds to urgency and burden removal. Columbus responds better to empathy and clean-process language.',
      summary:
        'Route scripts by sub-market. Akron can take firmer anchors sooner. Columbus needs more relationship framing first.',
      citation: 'Voice memo - Apr 10',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString(),
      tags: ['Negotiation', 'Market Reports', 'Wholesaling'],
    },
  ];
}

function buildDefaultActivity() {
  return [
    makeActivity({
      actor: 'Ava',
      category: 'APPROVAL',
      status: 'pending',
      text: 'Requested approval for $78,000 offer - MAO $91,500',
      target: 'Diane Kowalski - 202 Cherry Ln',
      at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    }),
    makeActivity({
      actor: 'System',
      category: 'ANALYZE',
      status: 'success',
      text: 'Analyzer ran - ARV $185k - repairs $38k - MAO $91,500',
      target: '202 Cherry Ln',
      at: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
    }),
    makeActivity({
      actor: 'n8n',
      category: 'IMPORT',
      status: 'complete',
      text: 'Lead intake flow normalized 47 fresh probate rows',
      target: 'daily_probate_import.csv',
      at: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    }),
    makeActivity({
      actor: 'Rex',
      category: 'RESEARCH',
      status: 'indexed',
      text: 'Indexed 3 new sources and updated negotiation guidance',
      target: 'Brain library',
      at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    }),
  ];
}

function buildDefaultApprovals() {
  return [
    {
      id: 'approval-offer-202-cherry',
      type: 'offer',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      offerPrice: 78000,
      mao: 91500,
      notes: 'Quick-close empathy anchor after probate rapport.',
      status: 'pending',
      createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    },
    {
      id: 'approval-contract-robert-chen',
      type: 'contract',
      leadId: 'lead-robert-chen',
      leadName: 'Robert Chen',
      address: '55 Birch Rd, Columbus OH',
      offerPrice: 98500,
      mao: 112000,
      notes: 'Send DocuSign at verbal yes price.',
      status: 'pending',
      createdAt: new Date(Date.now() - 1000 * 60 * 62).toISOString(),
    },
    {
      id: 'approval-batch-akron',
      type: 'outbound',
      leadId: 'batch-akron-probate-20260425',
      leadName: 'Akron Probate Batch',
      address: 'Akron list',
      offerPrice: 0,
      mao: 0,
      notes: 'Start outbound campaign on 47 fresh probate leads using approval-first mode.',
      status: 'pending',
      createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    },
  ];
}

function buildDefaultAnalyzerRuns() {
  return [
    {
      id: 'run-cherry-ln',
      leadId: 'lead-diane-kowalski',
      address: '202 Cherry Ln, Columbus OH',
      arv: 185000,
      repairsMid: 38000,
      mao: 91500,
      targetOffer: 78000,
      estProfit: 13500,
      status: 'complete',
      createdAt: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
    },
  ];
}

function buildDefaultLeadImports() {
  return [
    {
      id: 'leadimport-daily-probate',
      leadId: 'lead-diane-kowalski',
      source: 'daily_probate_import.csv',
      seller: {
        name: 'Diane Kowalski',
        phone: '+1 (614) 555-0142',
      },
      property: {
        address: '202 Cherry Ln, Columbus OH',
      },
      tags: ['probate', 'high-equity', 'ohio'],
      createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    },
  ];
}

function buildDefaultDncEntries() {
  return [
    {
      id: 'dnc-2165550401',
      phone: '+12165550401',
      name: 'Manual DNC',
      reason: 'Yelling detected and explicit stop request.',
      source: 'auto-detect',
      addedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    },
    {
      id: 'dnc-4405550622',
      phone: '+14405550622',
      name: 'SMS STOP',
      reason: 'Requested removal via SMS STOP.',
      source: 'sms',
      addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    },
    {
      id: 'dnc-6145550914',
      phone: '+16145550914',
      name: 'Manual add',
      reason: 'Prior client requested no more calls.',
      source: 'manual',
      addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    },
  ];
}

function buildDefaultCalls() {
  return [
    {
      id: 'call-diane-live',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      phone: '+16145550142',
      direction: 'outbound',
      status: 'live',
      assistantId: 'ava-acquisition-v3',
      script: 'grief-aware, repair-anchored',
      sentiment: 0.72,
      yellRisk: 0.04,
      startedAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 45).toISOString(),
      transcript: [
        { speaker: 'AI', text: 'I am so sorry for your loss. I know that is a lot to carry.' },
        { speaker: 'Seller', text: 'Honestly I just want this house gone.' },
      ],
    },
    {
      id: 'call-john-live',
      leadId: 'lead-john-smith',
      leadName: 'John Smith',
      address: '123 Main St, Akron OH',
      phone: '+13305550119',
      direction: 'outbound',
      status: 'live',
      assistantId: 'ava-acquisition-v3',
      script: 'firm comps and close speed',
      sentiment: 0.55,
      yellRisk: 0.08,
      startedAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 30).toISOString(),
      transcript: [
        { speaker: 'AI', text: 'I hear you on the $150k, but that is a stretch for us with repairs.' },
      ],
    },
  ];
}

function buildDefaultMessages() {
  return [
    {
      id: 'sms-diane-1',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      phone: '+16145550142',
      direction: 'inbound',
      channel: 'sms',
      body: 'Can you call me after 5pm tomorrow? Working a double shift today.',
      status: 'received',
      createdAt: new Date(Date.now() - 1000 * 60 * 70).toISOString(),
    },
  ];
}

function buildDefaultAppointments() {
  return [
    {
      id: 'appt-diane-review',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      email: 'diane@example.com',
      phone: '+16145550142',
      startTime: new Date(Date.now() + 1000 * 60 * 60 * 22).toISOString(),
      timezone: 'America/New_York',
      status: 'scheduled',
      source: 'cal.com',
      notes: 'Warm probate follow-up after evening shift.',
      createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    },
  ];
}

function buildDefaultLeadStageTransitions() {
  return [
    {
      id: 'transition-diane-warm',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      fromStage: 'cold',
      toStage: 'warm',
      changed: true,
      intent: 'warm_interest',
      temperature: 'warm',
      source: 'email-reply',
      channel: 'email',
      reason: 'Seller replied and asked for a time after work.',
      requestedWindow: 'tomorrow after 5pm',
      createdAt: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
    },
  ];
}

function buildDefaultContracts() {
  return [
    {
      id: 'contract-robert-chen',
      leadId: 'lead-robert-chen',
      leadName: 'Robert Chen',
      address: '55 Birch Rd, Columbus OH',
      email: 'robert@example.com',
      amount: 98500,
      status: 'sent',
      provider: 'DocuSign',
      envelopeId: 'env-robert-4821',
      createdAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 48).toISOString(),
    },
  ];
}

function buildDefaultDocumentDeliveries() {
  return [
    {
      id: 'delivery-diane-guide',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      email: 'diane@example.com',
      senderProfile: 'warm',
      documents: ['seller', 'loi'],
      status: 'sent',
      subject: 'Your PBK seller packet and next steps',
      createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    },
  ];
}

function buildDefaultAdminTasks() {
  return [
    {
      id: 'admin-task-warmup-domain',
      command: 'Add pbkoffersnorth.com to Instantly and start warmup.',
      provider: 'instantly',
      action: 'create_email_domain',
      dryRun: true,
      status: 'pending',
      requestedBy: 'Rex',
      requiresApproval: true,
      risk: 'medium',
      summary: 'Dry run prepared for a new Instantly sending domain and warmup kickoff.',
      costEstimate: '$0 now · inbox warmup only',
      createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    },
  ];
}

function buildDefaultAdminAudit() {
  return [
    {
      id: 'admin-audit-render-sync',
      action: 'restart_service',
      provider: 'render',
      actor: 'System',
      status: 'complete',
      summary: 'Bridge restarted after config sync.',
      createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 119).toISOString(),
    },
  ];
}

function buildDefaultState() {
  return {
    status: {
      agent: 'pbk-local-openclaw',
      mode: 'approval',
      connectedAt: isoNow(),
      lastUpdatedAt: isoNow(),
      queryCountToday: 42,
      sourcesIndexed: 247,
      weeklySources: 47,
      scriptUpdates7d: 8,
      brainSizeMb: 18.4,
      tokenCount: '3.2M',
      defaultTelnyxFromNumber: normalizePhone(TELNYX_FROM_NUMBER),
      pendingAdminTasks: 0,
      appointmentsScheduled: 0,
      pendingBookingRequests: 0,
      leadStageTransitionsToday: 0,
      documentDeliveries: 0,
      lastDocumentDeliveryAt: null,
      lastAppointmentAt: null,
      lastLeadTransitionAt: null,
      lastAdminTaskAt: null,
      lastStreakBootstrapAt: null,
      streakStageMap: {},
      streakFieldMap: {},
      marketPulse: [
        { source: 'Redfin', age: '8m', title: 'Columbus median DOM fell to 18 days.' },
        { source: 'FRED', age: '1h', title: '30-year fixed at 6.42%; seller financing still attractive.' },
        { source: 'ATTOM', age: '3h', title: 'Ohio foreclosure starts up 11% QoQ.' },
        { source: 'FCC', age: '1d', title: 'No new TCPA changes this week.' },
      ],
      suggestedReading: [
        {
          why: 'Because Diane K. is live right now',
          title: 'Handling grief-bereaved sellers without sounding predatory - 4 min',
        },
        {
          why: 'Because probate leads are queued',
          title: 'Ohio probate executor authority checklist - 2026',
        },
        {
          why: 'Because repair costs shifted',
          title: 'Updating your repair ballpark by quarter - 5 min',
        },
      ],
      topics: {
        Wholesaling: 82,
        'Creative Finance': 47,
        'Cash Deals': 34,
        'Subject-To': 18,
        'Seller Financing': 22,
        Novation: 9,
        'Legal & TCPA': 28,
        'Market Reports': 41,
        Negotiation: 31,
        Probate: 19,
      },
      tools: [...TOOL_NAMES],
      toolUsage: buildToolUsageSeed(),
      n8n: {
        approvalWebhookConfigured: Boolean(APPROVAL_WEBHOOK_URL),
        leadWebhookConfigured: Boolean(LEAD_WEBHOOK_URL),
      },
    },
    approvals: buildDefaultApprovals(),
    activity: buildDefaultActivity(),
    brainDocs: buildDefaultBrainDocs(),
    leadImports: buildDefaultLeadImports(),
    analyzerRuns: buildDefaultAnalyzerRuns(),
    dncEntries: buildDefaultDncEntries(),
    calls: buildDefaultCalls(),
    messages: buildDefaultMessages(),
    appointments: buildDefaultAppointments(),
    leadStageTransitions: buildDefaultLeadStageTransitions(),
    contracts: buildDefaultContracts(),
    documentDeliveries: buildDefaultDocumentDeliveries(),
    adminTasks: buildDefaultAdminTasks(),
    adminAudit: buildDefaultAdminAudit(),
  };
}

let __pgPool = null;
function getPgPool() {
  if (__pgPool) return __pgPool;
  if (!DATABASE_URL) return null;
  __pgPool = new PgPool({
    connectionString: DATABASE_URL,
    max: 2,
    // Render Postgres requires TLS but uses a self-signed cert chain.
    // Disable cert validation for managed-DB hostnames; keep it on for localhost.
    ssl: /(localhost|127\.0\.0\.1)/.test(DATABASE_URL)
      ? false
      : { rejectUnauthorized: false },
  });
  __pgPool.on('error', (err) => {
    console.error('[pbk-local-openclaw] pg pool error:', err && err.message ? err.message : err);
  });
  return __pgPool;
}

async function ensurePgSchema() {
  const pool = getPgPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bridge_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function loadStateFromDb() {
  const pool = getPgPool();
  if (!pool) return null;
  const result = await pool.query("SELECT data FROM bridge_state WHERE id = 'singleton' LIMIT 1");
  return result.rows[0]?.data || null;
}

async function persistStateToDb(nextState) {
  const pool = getPgPool();
  if (!pool) return false;
  await pool.query(
    `INSERT INTO bridge_state (id, data, updated_at)
     VALUES ('singleton', $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(nextState)],
  );
  return true;
}

async function ensureRuntimeDir() {
  await mkdir(RUNTIME_DIR, { recursive: true });
}

async function persistState(nextState) {
  nextState.status.lastUpdatedAt = isoNow();
  updateDerivedStatus(nextState);
  if (DATABASE_URL) {
    await persistStateToDb(nextState);
    return;
  }
  await ensureRuntimeDir();
  await writeFile(STATE_FILE, jsonStringify(nextState), 'utf8');
}

function limitStateArrays(nextState) {
  nextState.approvals = sortNewest(nextState.approvals).slice(0, LIMITS.approvals);
  nextState.activity = sortNewest(nextState.activity).slice(0, LIMITS.activity);
  nextState.brainDocs = sortNewest(nextState.brainDocs).slice(0, LIMITS.brainDocs);
  nextState.leadImports = sortNewest(nextState.leadImports).slice(0, LIMITS.leadImports);
  nextState.analyzerRuns = sortNewest(nextState.analyzerRuns).slice(0, LIMITS.analyzerRuns);
  nextState.dncEntries = sortNewest(nextState.dncEntries).slice(0, LIMITS.dncEntries);
  nextState.calls = sortNewest(nextState.calls).slice(0, LIMITS.calls);
  nextState.messages = sortNewest(nextState.messages).slice(0, LIMITS.messages);
  nextState.appointments = sortNewest(nextState.appointments).slice(0, LIMITS.appointments);
  nextState.leadStageTransitions = sortNewest(nextState.leadStageTransitions).slice(0, LIMITS.leadStageTransitions);
  nextState.contracts = sortNewest(nextState.contracts).slice(0, LIMITS.contracts);
  nextState.documentDeliveries = sortNewest(nextState.documentDeliveries).slice(0, LIMITS.documentDeliveries);
  nextState.adminTasks = sortNewest(nextState.adminTasks).slice(0, LIMITS.adminTasks);
  nextState.adminAudit = sortNewest(nextState.adminAudit).slice(0, LIMITS.adminAudit);
}

function updateDerivedStatus(nextState) {
  nextState.status.sourcesIndexed = nextState.brainDocs.length;
  nextState.status.pendingApprovals = nextState.approvals.filter((approval) => approval.status === 'pending').length;
  nextState.status.pendingAdminTasks = nextState.adminTasks.filter((task) => task.status === 'pending').length;
  nextState.status.activeCalls = nextState.calls.filter((call) => call.status === 'live').length;
  nextState.status.appointmentsScheduled = nextState.appointments.filter((appointment) => ['scheduled', 'confirmed'].includes(String(appointment.status || '').toLowerCase())).length;
  nextState.status.pendingBookingRequests = nextState.appointments.filter((appointment) => ['requested', 'call-now', 'pending-confirmation'].includes(String(appointment.status || '').toLowerCase())).length;
  nextState.status.leadStageTransitionsToday = nextState.leadStageTransitions.filter((transition) => String(transition.createdAt || '').slice(0, 10) === isoNow().slice(0, 10)).length;
  nextState.status.dncCount = nextState.dncEntries.length;
  nextState.status.contractsOpen = nextState.contracts.filter((contract) => !['completed', 'void', 'rejected'].includes(String(contract.status || '').toLowerCase())).length;
  nextState.status.documentDeliveries = nextState.documentDeliveries.length;
  nextState.status.lastApprovalAt = nextState.approvals[0]?.createdAt || null;
  nextState.status.lastAdminTaskAt = getItemTimestamp(nextState.adminTasks[0] || {}) || null;
  nextState.status.lastImportAt = nextState.leadImports[0]?.createdAt || null;
  nextState.status.lastAnalyzerAt = nextState.analyzerRuns[0]?.createdAt || null;
  nextState.status.lastCallAt = getItemTimestamp(nextState.calls[0] || {}) || null;
  nextState.status.lastMessageAt = getItemTimestamp(nextState.messages[0] || {}) || null;
  nextState.status.lastAppointmentAt = getItemTimestamp(nextState.appointments[0] || {}) || null;
  nextState.status.lastLeadTransitionAt = getItemTimestamp(nextState.leadStageTransitions[0] || {}) || null;
  nextState.status.lastContractAt = getItemTimestamp(nextState.contracts[0] || {}) || null;
  nextState.status.lastDocumentDeliveryAt = getItemTimestamp(nextState.documentDeliveries[0] || {}) || null;
  nextState.status.tools = [...TOOL_NAMES];
  nextState.status.toolUsage = {
    ...buildToolUsageSeed(),
    ...(nextState.status.toolUsage || {}),
  };
  nextState.status.n8n = {
    approvalWebhookConfigured: Boolean(APPROVAL_WEBHOOK_URL),
    leadWebhookConfigured: Boolean(LEAD_WEBHOOK_URL),
  };
}

function hydrateState(raw = {}) {
  const defaults = buildDefaultState();
  const hydrated = {
    ...defaults,
    ...raw,
    status: {
      ...defaults.status,
      ...(raw.status || {}),
      toolUsage: {
        ...defaults.status.toolUsage,
        ...(raw.status?.toolUsage || {}),
      },
    },
    approvals: trimArray(raw.approvals || defaults.approvals, LIMITS.approvals),
    activity: trimArray(raw.activity || defaults.activity, LIMITS.activity),
    brainDocs: trimArray(raw.brainDocs || defaults.brainDocs, LIMITS.brainDocs),
    leadImports: trimArray(raw.leadImports || defaults.leadImports, LIMITS.leadImports),
    analyzerRuns: trimArray(raw.analyzerRuns || defaults.analyzerRuns, LIMITS.analyzerRuns),
    dncEntries: trimArray(raw.dncEntries || defaults.dncEntries, LIMITS.dncEntries),
    calls: trimArray(raw.calls || defaults.calls, LIMITS.calls),
    messages: trimArray(raw.messages || defaults.messages, LIMITS.messages),
    appointments: trimArray(raw.appointments || defaults.appointments, LIMITS.appointments),
    leadStageTransitions: trimArray(raw.leadStageTransitions || defaults.leadStageTransitions, LIMITS.leadStageTransitions),
    contracts: trimArray(raw.contracts || defaults.contracts, LIMITS.contracts),
    documentDeliveries: trimArray(raw.documentDeliveries || defaults.documentDeliveries, LIMITS.documentDeliveries),
    adminTasks: trimArray(raw.adminTasks || defaults.adminTasks, LIMITS.adminTasks),
    adminAudit: trimArray(raw.adminAudit || defaults.adminAudit, LIMITS.adminAudit),
  };
  limitStateArrays(hydrated);
  updateDerivedStatus(hydrated);
  return hydrated;
}

async function loadState() {
  if (DATABASE_URL) {
    await ensurePgSchema();
  } else {
    await ensureRuntimeDir();
  }
  if (SHOULD_RESET) {
    const fresh = buildDefaultState();
    await persistState(fresh);
    return fresh;
  }

  if (DATABASE_URL) {
    const dbState = await loadStateFromDb();
    if (dbState) return hydrateState(dbState);
    const fresh = buildDefaultState();
    await persistState(fresh);
    return fresh;
  }

  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    return hydrateState(JSON.parse(raw));
  } catch {
    const fresh = buildDefaultState();
    await persistState(fresh);
    return fresh;
  }
}

function recordToolUse(toolName) {
  state.status.toolUsage[toolName] = toNumber(state.status.toolUsage[toolName], 0) + 1;
}

function addActivity(stateRef, entry) {
  stateRef.activity.unshift(entry);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addApproval(stateRef, approval) {
  stateRef.approvals.unshift(approval);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addBrainDoc(stateRef, doc) {
  stateRef.brainDocs.unshift(doc);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addLeadImport(stateRef, leadImport) {
  stateRef.leadImports.unshift(leadImport);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function patchLeadImport(stateRef, matcher = {}, patch = {}) {
  const normalizedEmail = String(matcher.email || '').trim().toLowerCase();
  const normalizedAddress = String(matcher.address || '').trim().toLowerCase();
  const normalizedLeadId = String(matcher.leadId || '').trim();
  const normalizedName = String(matcher.leadName || '').trim().toLowerCase();
  const existingIndex = stateRef.leadImports.findIndex((item) => {
    if (normalizedLeadId && String(item.leadId || '').trim() === normalizedLeadId) return true;
    if (normalizedEmail && String(item?.seller?.email || '').trim().toLowerCase() === normalizedEmail) return true;
    if (normalizedAddress && String(item?.property?.address || '').trim().toLowerCase() === normalizedAddress) return true;
    if (normalizedName && String(item?.seller?.name || '').trim().toLowerCase() === normalizedName) return true;
    return false;
  });

  if (existingIndex < 0) return null;

  const current = stateRef.leadImports[existingIndex];
  const next = {
    ...current,
    ...patch,
    seller: {
      ...(current.seller || {}),
      ...(patch.seller || {}),
    },
    property: {
      ...(current.property || {}),
      ...(patch.property || {}),
    },
    updatedAt: isoNow(),
  };
  stateRef.leadImports.splice(existingIndex, 1, next);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
  return next;
}

function addAnalyzerRun(stateRef, run) {
  stateRef.analyzerRuns.unshift(run);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addDocumentDelivery(stateRef, delivery) {
  stateRef.documentDeliveries.unshift(delivery);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addLeadStageTransition(stateRef, transition) {
  stateRef.leadStageTransitions.unshift(transition);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addAdminTask(stateRef, task) {
  stateRef.adminTasks.unshift(task);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addAdminAudit(stateRef, entry) {
  stateRef.adminAudit.unshift(entry);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function recordAdminExecution(task, execution, meta = {}) {
  const snapshot = {
    id: meta.id || `exec-${task.id}-${Date.now()}`,
    statusBefore: meta.statusBefore || task.status || '',
    statusAfter: meta.statusAfter || task.status || '',
    requestedBy: meta.requestedBy || task.actor || task.requestedBy || 'system',
    executedAt: execution?.executedAt || isoNow(),
    ok: Boolean(execution?.ok),
    live: Boolean(execution?.live),
    simulated: Boolean(execution?.simulated),
    provider: execution?.provider || task.provider,
    action: execution?.action || task.action,
    details: execution?.details || '',
    result: execution || null,
  };

  task.execution = execution;
  task.lastExecutedAt = snapshot.executedAt;
  task.lastExecutionStatus = snapshot.statusAfter;
  task.executionHistory = Array.isArray(task.executionHistory) ? task.executionHistory : [];
  task.executionHistory.unshift(snapshot);
  task.executionHistory = task.executionHistory.slice(0, 12);
}

function addDncEntry(stateRef, entry) {
  stateRef.dncEntries.unshift(entry);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertAppointment(stateRef, appointment) {
  const existingIndex = stateRef.appointments.findIndex((item) => item.id === appointment.id);
  if (existingIndex >= 0) {
    stateRef.appointments.splice(existingIndex, 1, { ...stateRef.appointments[existingIndex], ...appointment, updatedAt: isoNow() });
  } else {
    stateRef.appointments.unshift(appointment);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertCall(stateRef, call) {
  const existingIndex = stateRef.calls.findIndex((item) => item.id === call.id);
  if (existingIndex >= 0) {
    stateRef.calls.splice(existingIndex, 1, { ...stateRef.calls[existingIndex], ...call, updatedAt: isoNow() });
  } else {
    stateRef.calls.unshift(call);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertMessage(stateRef, message) {
  const existingIndex = stateRef.messages.findIndex((item) => item.id === message.id);
  if (existingIndex >= 0) {
    stateRef.messages.splice(existingIndex, 1, { ...stateRef.messages[existingIndex], ...message });
  } else {
    stateRef.messages.unshift(message);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertContract(stateRef, contract) {
  const existingIndex = stateRef.contracts.findIndex((item) => item.id === contract.id);
  if (existingIndex >= 0) {
    stateRef.contracts.splice(existingIndex, 1, { ...stateRef.contracts[existingIndex], ...contract, updatedAt: isoNow() });
  } else {
    stateRef.contracts.unshift(contract);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function findLeadContext(params = {}) {
  const fallbackImport = state.leadImports[0] || {};
  const fallbackApproval = state.approvals[0] || {};
  const fallbackCall = state.calls.find((call) => call.status === 'live') || state.calls[0] || {};
  const explicitPhone = normalizePhone(params.phone || params.to || params.number);
  const explicitLeadName = params.leadName || params.name || '';
  const explicitAddress = params.address || '';
  const hasExplicitContext = Boolean(explicitPhone || explicitLeadName || explicitAddress);
  const derivedLeadId = hasExplicitContext
    ? `lead-${slugify(`${explicitLeadName || 'seller'}-${explicitAddress || explicitPhone || 'manual'}`)}`
    : '';
  const fallback = {
    leadId: params.leadId || derivedLeadId || fallbackApproval.leadId || fallbackImport.leadId || fallbackCall.leadId || randomUUID(),
    leadName: explicitLeadName || fallbackApproval.leadName || fallbackImport?.seller?.name || fallbackCall.leadName || 'Unknown seller',
    address: explicitAddress || fallbackApproval.address || fallbackImport?.property?.address || fallbackCall.address || 'Unknown property',
    phone: explicitPhone || (hasExplicitContext ? '' : normalizePhone(fallbackCall.phone) || normalizePhone(fallbackImport?.seller?.phone) || ''),
    email: params.email || fallbackImport?.seller?.email || '',
  };
  return fallback;
}

function extractCommandContext(command = '') {
  const raw = String(command || '').trim();
  if (!raw) return {};

  const phoneMatch = raw.match(/(\+?1?[\s.(+-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{4})/);
  const analyzeMatch = raw.match(/\b(?:analyze|run analyzer on|mao on)\s+(.+)$/i);
  const addressMatch =
    analyzeMatch ||
    raw.match(/\bat\s+(.+?)(?:\s+(?:now|today|tomorrow|asap|please|right now)\b|$)/i) ||
    raw.match(/\bfor\s+(\d{1,5}[^,]+,\s*[A-Za-z .'-]+(?:,\s*[A-Z]{2})?)/i);
  const nameMatch = raw.match(/\b(?:call|text|sms|message|send(?: a)?(?: contract| docusign)? to|work this lead and report back on)\s+(.+?)(?:\s+at\s+|\s+for\s+|$)/i);

  const leadName = nameMatch?.[1]?.trim() || '';
  const address = addressMatch?.[1]?.trim().replace(/[.?!]+$/, '') || '';
  const phone = phoneMatch?.[1] ? normalizePhone(phoneMatch[1]) : '';

  return {
    ...(leadName ? { leadName } : {}),
    ...(address ? { address } : {}),
    ...(phone ? { phone } : {}),
  };
}

function buildAnalyzerSummary(params = {}) {
  const deal = params.deal || {};
  const address = params.address || deal.address || 'Unknown address';
  const seed = hashString(address);
  const fallbackArv = Math.round((120000 + (seed % 150000)) / 5000) * 5000;
  const fallbackRepairs = Math.round((16000 + (seed % 42000)) / 500) * 500;
  const arv = toNumber(params.arv, 0) || toNumber(deal.arv, 0) || averagePrices(deal) || fallbackArv;
  const repairsMid = toNumber(params.repairsMid, 0) || toNumber(deal?.repairs?.mid, 0) || fallbackRepairs;
  const fee = toNumber(params.fee, 0) || toNumber(deal.fee, 9000) || 9000;
  const mao =
    toNumber(params.mao, 0) ||
    toNumber(deal.mao60, 0) ||
    Math.max(0, Math.round((arv - repairsMid) * 0.68 - fee));
  const targetOffer =
    toNumber(params.offerPrice, 0) ||
    toNumber(deal.offer, 0) ||
    toNumber(deal.agreedPrice, 0) ||
    Math.max(0, Math.round(mao * 0.85));
  const estProfit = Math.max(0, mao - targetOffer);

  return {
    id: params.id || `run-${slugify(address) || randomUUID()}`,
    leadId: params.leadId || deal.leadId || '',
    address,
    arv,
    repairsMid,
    mao,
    targetOffer,
    estProfit,
    status: 'complete',
    createdAt: isoNow(),
  };
}

function scoreBrainDocMatch(doc, query) {
  const haystack = [
    doc.title,
    doc.excerpt,
    doc.summary,
    doc.topic,
    ...(doc.tags || []),
  ]
    .join(' ')
    .toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function answerBrainQuery(stateRef, query = '') {
  const trimmed = String(query || '').trim();
  const matches = stateRef.brainDocs
    .map((doc) => ({
      ...doc,
      score: scoreBrainDocMatch(doc, trimmed || doc.title),
    }))
    .filter((doc) => doc.score > 0 || !trimmed)
    .sort((left, right) => right.score - left.score || String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 3);

  const top = matches[0];
  const answer = top
    ? `Best match: ${top.title}. ${top.summary}`
    : 'No direct match yet. Ingest a new source or try a narrower query like "probate Ohio" or "subject-to".';

  return {
    query: trimmed,
    answer,
    matches: matches.map(({ score, ...doc }) => doc),
    citations: matches.map((doc) => doc.citation || `${doc.source} - ${doc.title}`),
  };
}

function normalizeLeadIntake(payload = {}) {
  const createdAt = payload.createdAt || isoNow();
  return {
    id: payload.id || randomUUID(),
    leadId: payload.leadId || payload.id || randomUUID(),
    source: payload.source || 'manual',
    seller: {
      name: payload?.seller?.name || payload.name || 'Unknown seller',
      phone: payload?.seller?.phone || payload.phone || '',
      email: payload?.seller?.email || payload.email || '',
    },
    property: {
      address: payload?.property?.address || payload.address || '',
      city: payload?.property?.city || payload.city || '',
      state: payload?.property?.state || payload.state || '',
    },
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    createdAt,
  };
}

function buildDncEntry(payload = {}) {
  return {
    id: payload.id || `dnc-${slugify(normalizePhone(payload.phone || payload.number || randomUUID()))}`,
    phone: normalizePhone(payload.phone || payload.number || ''),
    name: payload.name || payload.leadName || '',
    reason: payload.reason || 'Manual DNC add',
    source: payload.source || 'manual',
    addedAt: payload.addedAt || isoNow(),
  };
}

function inferSkipTraceContact(params = {}) {
  const context = findLeadContext(params);
  const seed = hashString(context.address || context.leadName || randomUUID());
  const phone = context.phone || `+1${String(2000000000 + (seed % 7000000000)).slice(0, 10)}`;
  const emailName = slugify(context.leadName || 'seller') || 'seller';
  return {
    leadId: context.leadId,
    leadName: context.leadName,
    address: context.address,
    phone,
    email: `${emailName}@skiptrace.pbk.local`,
    confidence: 0.82,
  };
}

function findLatestLeadImport(params = {}) {
  const context = findLeadContext(params);
  return state.leadImports.find((item) => {
    if (params.leadId && item.leadId === params.leadId) return true;
    if (context.leadId && item.leadId === context.leadId) return true;
    if (context.address && String(item?.property?.address || '').toLowerCase() === String(context.address || '').toLowerCase()) return true;
    return false;
  }) || null;
}

function findLatestAnalyzerRun(params = {}) {
  const context = findLeadContext(params);
  return state.analyzerRuns.find((item) => {
    if (params.leadId && item.leadId === params.leadId) return true;
    if (context.leadId && item.leadId === context.leadId) return true;
    if (context.address && String(item.address || '').toLowerCase() === String(context.address || '').toLowerCase()) return true;
    return false;
  }) || null;
}

function buildBrainEmailContext(params = {}) {
  const context = findLeadContext(params);
  const leadImport = findLatestLeadImport(params);
  const participantProfile = leadImport?.participantProfile || null;
  const analyzer = findLatestAnalyzerRun(params) || buildAnalyzerSummary({
    leadId: context.leadId,
    address: context.address,
  });
  const tags = Array.isArray(leadImport?.tags) ? leadImport.tags.map((item) => String(item || '').toLowerCase()) : [];
  const propertyCity = leadImport?.property?.city || '';
  const propertyState = leadImport?.property?.state || '';
  const propertyType = /multi|duplex|triplex|fourplex/i.test(context.address) ? 'Small multifamily' : 'Single family';
  const estimatedEquity = Math.max(0, analyzer.arv - analyzer.targetOffer);
  const probateStatus = tags.includes('probate') || /probate|inherited|estate/i.test(params.templateId || '');
  const absenteeOwner = tags.includes('absentee') || /absentee|out[- ]of[- ]state/i.test(context.address);
  const taxDelinquent = tags.includes('tax-delinquent') || tags.includes('delinquent');
  const recentComps = [
    `${currency(Math.max(0, analyzer.arv - 7000))} nearby comp`,
    `${currency(analyzer.arv)} stretch comp`,
    `${currency(analyzer.arv + 9000)} renovated comp`,
  ];
  const motivationSignals = [];
  if (probateStatus) motivationSignals.push('inherited property');
  if (absenteeOwner) motivationSignals.push('absentee ownership');
  if (taxDelinquent) motivationSignals.push('tax pressure');
  if (!motivationSignals.length) motivationSignals.push('off-market seller opportunity');

  return {
    leadId: context.leadId,
    ownerName: context.leadName,
    propertyAddress: context.address,
    propertyCity,
    propertyState,
    propertyType,
    estimatedEquity,
    marketValue: analyzer.arv,
    targetOffer: analyzer.targetOffer,
    mao: analyzer.mao,
    estimatedProfit: analyzer.estProfit,
    repairsMid: analyzer.repairsMid,
    lastSaleDate: params.lastSaleDate || leadImport?.createdAt?.slice(0, 10) || '',
    recentComps,
    taxDelinquent,
    probateStatus,
    absenteeOwner,
    participantRole: participantProfile?.role || '',
    participantExpertise: participantProfile?.expertise || '',
    participantProfile,
    motivationSignals,
    sourceTags: tags,
  };
}

function buildColdEmailContent(templateId = 'generic', lead = {}, brainInfo = {}) {
  const safeTemplate = String(templateId || 'generic').toLowerCase();
  const firstName = String(lead.firstName || lead.name || brainInfo.ownerName || 'there').split(/\s+/)[0];
  const address = brainInfo.propertyAddress || lead.address || 'your property';
  const equityText = brainInfo.estimatedEquity ? currency(brainInfo.estimatedEquity) : 'strong equity';
  const compText = Array.isArray(brainInfo.recentComps) && brainInfo.recentComps.length ? brainInfo.recentComps[0] : 'recent nearby sales';
  const motivationText = Array.isArray(brainInfo.motivationSignals) && brainInfo.motivationSignals.length
    ? brainInfo.motivationSignals.join(', ')
    : 'an off-market sale path';

  let subject = `Quick question about ${address}`;
  let intro = `I came across ${address} and wanted to reach out directly.`;

  if (safeTemplate === 'probate') {
    subject = `A respectful option for ${address}`;
    intro = `I know inherited property situations can feel heavy, so I wanted to reach out carefully about ${address}.`;
  } else if (safeTemplate === 'absentee') {
    subject = `Off-market option for ${address}`;
    intro = `I noticed ${address} may be an absentee-owned property and wanted to see if a simple off-market sale would help.`;
  } else if (safeTemplate === 'high-equity' || safeTemplate === 'high_equity') {
    subject = `Equity options for ${address}`;
    intro = `With properties like ${compText} trading nearby, ${address} looks like it may have solid equity to work with.`;
  }

  const html = `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>${escapeHtml(intro)}</p>
    <p>From our side it looks like there may be about <strong>${escapeHtml(equityText)}</strong> in equity, and we are seeing comps around <strong>${escapeHtml(compText)}</strong>. We buy as-is and can move quickly if that would make life easier.</p>
    <p>If ${escapeHtml(motivationText)} is relevant for you, would you be open to a quick 10-15 minute conversation this week?</p>
    <p>Best,<br />PBK Capital</p>
  `.trim();

  const text = [
    `Hi ${firstName},`,
    '',
    intro,
    `It looks like there may be about ${equityText} in equity, and we are seeing comps around ${compText}. We buy as-is and can move quickly if that helps.`,
    `If ${motivationText} is relevant for you, would you be open to a quick 10-15 minute conversation this week?`,
    '',
    'Best,',
    'PBK Capital',
  ].join('\n');

  return {
    templateId: safeTemplate,
    subject,
    html,
    text,
  };
}

function extractReplyTimeHint(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  const matches = [];
  const dayMatch = normalized.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week)\b/i);
  const timeMatch = normalized.match(/\b(?:after\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i);
  if (dayMatch) matches.push(dayMatch[0]);
  if (timeMatch) matches.push(timeMatch[0]);
  return matches.join(' ').trim();
}

function classifyReplyIntent(params = {}) {
  const body = String(params.body || params.message || params.text || '').trim();
  const normalized = body.toLowerCase();
  const explicitStop = /(?:^|\b)(stop|unsubscribe|do not contact|remove me|take me off|quit)(?:\b|$)/i.test(body);
  const hostile = /(scam|spam|lawyer|attorney|report you|leave me alone|fuck off|go away)/i.test(body);
  const notInterested = /(not interested|no thanks|no thank you|already sold|working with someone else|pass on this|please stop reaching out)/i.test(body);
  const immediateCall = /(call me now|call now|you can call me now|reach me now|ring me now)/i.test(body);
  const bookingLanguage = /(book|schedule|calendar|available|tomorrow|next week|this week|after\s+\d{1,2}|at\s+\d{1,2}(?::\d{2})?\s*(am|pm))/i.test(body);
  const offerLanguage = /(what(?:'s| is) your offer|how much|cash offer|offer amount|price are you thinking|what can you pay)/i.test(body);
  const interestLanguage = /(interested|open to talk|open to discussing|let's talk|would like to talk|sounds good|yes[,.! ]|sure[,.! ]|okay[,.! ]|ok[,.! ])/i.test(body);
  const empathySignals = /(passed away|lost my|inherited|estate|probate|overwhelmed|a lot right now|stressful)/i.test(body);
  const questionLanguage = /\?/.test(body) || /\b(how|what|when|why|can you|could you)\b/i.test(body);
  const timeHint = extractReplyTimeHint(body);

  let intent = 'neutral';
  let temperature = 'cold';
  let nextAction = 'log';

  if (explicitStop) {
    intent = 'opt_out';
    temperature = 'do-not-contact';
    nextAction = 'dnc';
  } else if (hostile) {
    intent = 'hostile';
    temperature = 'cold';
    nextAction = 'manual-review';
  } else if (notInterested) {
    intent = 'not_interested';
    temperature = 'cool';
    nextAction = 'archive';
  } else if (immediateCall) {
    intent = 'immediate_call';
    temperature = 'hot';
    nextAction = 'call-now';
  } else if (bookingLanguage) {
    intent = 'book_meeting';
    temperature = 'hot';
    nextAction = 'booking';
  } else if (offerLanguage) {
    intent = 'offer_request';
    temperature = 'warm';
    nextAction = 'booking';
  } else if (interestLanguage || (questionLanguage && !hostile)) {
    intent = questionLanguage ? 'warm_question' : 'warm_interest';
    temperature = 'warm';
    nextAction = 'booking';
  }

  return {
    body,
    normalized,
    explicitStop,
    hostile,
    notInterested,
    immediateCall,
    bookingLanguage,
    offerLanguage,
    interestLanguage,
    empathySignals,
    questionLanguage,
    requestedWindow: timeHint,
    intent,
    temperature,
    nextAction,
    shouldEscalateToBooking: ['booking', 'call-now'].includes(nextAction),
    shouldNotify: ['booking', 'call-now', 'manual-review'].includes(nextAction),
  };
}

function getTimeZoneOffsetMinutes(timeZone = DEFAULT_LEAD_TIMEZONE, date = new Date()) {
  try {
    const token = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT+0';
    const match = token.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    return sign * (hours * 60 + minutes);
  } catch {
    return 0;
  }
}

function getZonedTodayParts(timeZone = DEFAULT_LEAD_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const weekdayName = String(lookup.weekday || '').toLowerCase();
  const weekdayIndexMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    weekdayName,
    weekdayIndex: weekdayIndexMap[weekdayName] ?? 0,
  };
}

function buildIsoForTimeZoneLocal({ year, month, day, hour, minute, timeZone = DEFAULT_LEAD_TIMEZONE }) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, guess);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60 * 1000).toISOString();
}

function parseReplyRequestedSlot(text = '', timeZone = DEFAULT_LEAD_TIMEZONE) {
  const normalized = String(text || '').trim().toLowerCase();
  const timeMatch = normalized.match(/\b(after\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[2] || 0);
  const minute = Number(timeMatch[3] || 0);
  const meridiem = String(timeMatch[4] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const weekdayMatch = normalized.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const weekdayIndexMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const today = getZonedTodayParts(timeZone);
  let dayOffset = 0;
  if (normalized.includes('tomorrow')) {
    dayOffset = 1;
  } else if (weekdayMatch) {
    const targetIndex = weekdayIndexMap[String(weekdayMatch[1]).toLowerCase()] ?? today.weekdayIndex;
    dayOffset = (targetIndex - today.weekdayIndex + 7) % 7;
    if (dayOffset === 0) dayOffset = 7;
    if (normalized.includes(`next ${String(weekdayMatch[1]).toLowerCase()}`)) dayOffset += 7;
  } else if (normalized.includes('next week')) {
    dayOffset = 7;
  }

  const base = new Date(Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const day = base.getUTCDate();
  const startTime = buildIsoForTimeZoneLocal({ year, month, day, hour, minute, timeZone });
  const endTime = new Date(Date.parse(startTime) + 30 * 60 * 1000).toISOString();
  const hour12 = hour % 12 || 12;
  const labelDay = weekdayMatch ? String(weekdayMatch[1]).toLowerCase() : normalized.includes('tomorrow') ? 'tomorrow' : normalized.includes('today') ? 'today' : 'soon';
  return {
    startTime,
    endTime,
    timezone: timeZone,
    approximate: Boolean(timeMatch[1]),
    label: `${labelDay} ${hour12}:${String(minute).padStart(2, '0')}${meridiem}`,
    confidence: timeMatch[1] ? 0.71 : 0.88,
  };
}

function buildReplyTemplateCatalog(params = {}) {
  const context = findLeadContext(params);
  const reply = params.reply || classifyReplyIntent(params);
  const bookingLink = params.bookingLink || DEFAULT_BOOKING_LINK;
  const firstName = String(context.leadName || 'there').split(/\s+/)[0];
  const brainInfo = params.brainInfo || buildBrainEmailContext(params);
  const participantProfile = params.participantProfile || brainInfo.participantProfile || resolveParticipantProfile(params) || null;
  const empathyIntro =
    participantProfile?.role === 'agent'
      ? 'Thanks for getting back to me. We can keep this tight and centered on your seller’s timing, price, and net.'
      : reply.empathySignals || participantProfile?.expertise === 'novice'
        ? 'I appreciate you sharing that, and we will keep this simple on our side.'
        : participantProfile?.expertise === 'expert'
          ? 'Thanks for getting back to me. We will keep this direct and numbers-first on our side.'
          : 'Thanks for getting back to me.';
  const address = context.address || 'your property';
  const calendarLabel = params.calendarEvent?.label || 'the requested time';
  const equityLine = participantProfile?.role === 'agent'
    ? 'If it helps, we can walk through pricing, timing, and what your seller needs before locking the call.'
    : brainInfo.estimatedEquity
      ? `From our side it looks like there may be about ${currency(brainInfo.estimatedEquity)} in equity to work with.`
      : 'We can keep this simple and walk through the property without any pressure.';

  return {
    call_now_ack: {
      templateKey: 'call_now_ack',
      templateVersion: 'reply-v2',
      channel: 'email',
      subject: `We are calling about ${address}`,
      text: [
        `Hi ${firstName},`,
        '',
        `${empathyIntro} We are routing your request now and will call ${reply.requestedWindow || 'shortly'}.`,
        '',
        'Best,',
        'PBK Capital',
      ].join('\n'),
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(empathyIntro)} We are routing your request now and will call ${escapeHtml(reply.requestedWindow || 'shortly')}.</p><p>Best,<br />PBK Capital</p>`,
    },
    booking_hold_confirmation: {
      templateKey: 'booking_hold_confirmation',
      templateVersion: 'reply-v2',
      channel: 'email',
      subject: `Tentative call hold for ${address}`,
      bookingLink,
      text: [
        `Hi ${firstName},`,
        '',
        `${empathyIntro} I penciled in ${calendarLabel} for ${address} and we will confirm it on our side.`,
        `If that changes, you can also grab a different slot here: ${bookingLink}`,
        '',
        'Best,',
        'PBK Capital',
      ].join('\n'),
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(empathyIntro)} I penciled in <strong>${escapeHtml(calendarLabel)}</strong> for ${escapeHtml(address)} and we will confirm it on our side.</p><p>If that changes, you can also grab a different slot here: <a href="${escapeHtml(bookingLink)}">${escapeHtml(bookingLink)}</a></p><p>Best,<br />PBK Capital</p>`,
    },
    booking_link_prompt: {
      templateKey: 'booking_link_prompt',
      templateVersion: 'reply-v2',
      channel: 'email',
      subject: `Pick a time for ${address}`,
      bookingLink,
      text: [
        `Hi ${firstName},`,
        '',
        empathyIntro,
        equityLine,
        `Here is the quickest way to lock a time with us: ${bookingLink}`,
        '',
        'Best,',
        'PBK Capital',
      ].join('\n'),
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(empathyIntro)}</p><p>${escapeHtml(equityLine)}</p><p>Here is the quickest way to lock a time with us: <a href="${escapeHtml(bookingLink)}">${escapeHtml(bookingLink)}</a></p><p>Best,<br />PBK Capital</p>`,
    },
    opt_out_confirm: {
      templateKey: 'opt_out_confirm',
      templateVersion: 'reply-v2',
      channel: 'email',
      subject: 'You have been removed from our outreach',
      text: `Hi ${firstName},\n\nUnderstood. We removed you from future outreach.\n\nPBK Capital`,
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>Understood. We removed you from future outreach.</p><p>PBK Capital</p>`,
    },
    not_interested_close: {
      templateKey: 'not_interested_close',
      templateVersion: 'reply-v2',
      channel: 'email',
      subject: `Thanks for the update on ${address}`,
      text: `Hi ${firstName},\n\nThanks for letting us know. We will close out this follow-up on our side.\n\nPBK Capital`,
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>Thanks for letting us know. We will close out this follow-up on our side.</p><p>PBK Capital</p>`,
    },
    manual_review_ack: {
      templateKey: 'manual_review_ack',
      templateVersion: 'reply-v2',
      channel: 'email',
      subject: `We received your message about ${address}`,
      text: `Hi ${firstName},\n\nThanks for the note. A member of our team is reviewing it and will follow up directly.\n\nPBK Capital`,
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>Thanks for the note. A member of our team is reviewing it and will follow up directly.</p><p>PBK Capital</p>`,
    },
    generic_ack: {
      templateKey: 'generic_ack',
      templateVersion: 'reply-v2',
      channel: 'email',
      subject: `Thanks for the reply on ${address}`,
      text: `Hi ${firstName},\n\n${empathyIntro}\n\nPBK Capital`,
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(empathyIntro)}</p><p>PBK Capital</p>`,
    },
  };
}

function buildReplyResponseDraft(params = {}) {
  const reply = params.reply || classifyReplyIntent(params);
  const templates = buildReplyTemplateCatalog(params);

  let templateKey = 'generic_ack';
  if (reply.nextAction === 'call-now') {
    templateKey = 'call_now_ack';
  } else if (reply.nextAction === 'booking') {
    templateKey = params.calendarEvent?.startTime ? 'booking_hold_confirmation' : 'booking_link_prompt';
  } else if (reply.nextAction === 'dnc') {
    templateKey = 'opt_out_confirm';
  } else if (reply.nextAction === 'archive') {
    templateKey = 'not_interested_close';
  } else if (reply.nextAction === 'manual-review') {
    templateKey = 'manual_review_ack';
  }

  return {
    ...templates[templateKey],
    templateKey,
    availableTemplateKeys: Object.keys(templates),
  };
}

function createLeadStageTransitionRecord(params = {}) {
  const context = findLeadContext(params);
  return {
    id: params.id || `transition-${slugify(context.leadName || context.address || randomUUID())}-${Date.now()}`,
    leadId: params.leadId || context.leadId,
    leadName: context.leadName,
    address: context.address,
    fromStage: params.fromStage || 'unknown',
    toStage: params.toStage || params.stage || 'unknown',
    changed: params.changed !== false,
    intent: params.intent || '',
    temperature: params.temperature || '',
    source: params.source || params.provider || params.channel || 'runtime',
    channel: params.channel || 'email',
    reason: params.reason || '',
    participantRole: params.participantRole || '',
    participantExpertise: params.participantExpertise || '',
    requestedWindow: params.requestedWindow || '',
    replyPreview: String(params.replyPreview || params.body || '').trim().slice(0, 240),
    appointmentId: params.appointmentId || '',
    approvalId: params.approvalId || '',
    callId: params.callId || '',
    followUpTemplateKey: params.followUpTemplateKey || '',
    followUpStatus: params.followUpStatus || '',
    calendarEventId: params.calendarEventId || '',
    calendarSyncStatus: params.calendarSyncStatus || '',
    crmProvider: params.crmProvider || '',
    crmEntityId: params.crmEntityId || '',
    crmPipelineKey: params.crmPipelineKey || '',
    crmStageKey: params.crmStageKey || '',
    crmSyncStatus: params.crmSyncStatus || '',
    createdAt: params.createdAt || isoNow(),
  };
}

function createCallRecord(params = {}) {
  const context = findLeadContext(params);
  return {
    id: params.id || `call-${slugify(context.leadName || context.address || randomUUID())}-${Date.now()}`,
    leadId: params.leadId || context.leadId,
    leadName: context.leadName,
    address: context.address,
    phone: normalizePhone(params.phone || params.to || context.phone),
    from: normalizePhone(params.from || params.fromNumber || ''),
    direction: params.direction || 'outbound',
    status: params.status || 'live',
    assistantId: params.assistantId || 'ava-acquisition-v3',
    provider: params.provider || 'PBK',
    commandId: params.commandId || '',
    participantRole: params.participantRole || '',
    participantExpertise: params.participantExpertise || '',
    participantConfidence: toNumber(params.participantConfidence, 0),
    telnyxCallControlId: params.telnyxCallControlId || params.call_control_id || '',
    telnyxCallLegId: params.telnyxCallLegId || params.call_leg_id || '',
    telnyxCallSessionId: params.telnyxCallSessionId || params.call_session_id || '',
    script: params.script || params.notes || '',
    sentiment: toNumber(params.sentiment, 0.66),
    yellRisk: toNumber(params.yellRisk, 0.05),
    humanJoined: Boolean(params.humanJoined),
    aiMuted: Boolean(params.aiMuted),
    startedAt: params.startedAt || isoNow(),
    updatedAt: params.updatedAt || isoNow(),
    transcript: Array.isArray(params.transcript) ? params.transcript : [],
  };
}

function createMessageRecord(params = {}) {
  const context = findLeadContext(params);
  return {
    id: params.id || `msg-${Date.now()}-${slugify(context.leadName || 'lead')}`,
    leadId: params.leadId || context.leadId,
    leadName: context.leadName,
    address: context.address,
    phone: normalizePhone(params.phone || params.to || context.phone),
    from: normalizePhone(params.from || params.fromNumber || ''),
    email: params.email || context.email || '',
    channel: params.channel || 'sms',
    direction: params.direction || 'outbound',
    body: String(params.body || params.message || '').trim(),
    status: params.status || (params.direction === 'inbound' ? 'received' : 'sent'),
    provider: params.provider || 'PBK',
    messagingProfileId: params.messagingProfileId || params.messaging_profile_id || '',
    createdAt: params.createdAt || isoNow(),
  };
}

function createAppointmentRecord(params = {}) {
  const context = findLeadContext(params);
  const startTime = params.startTime || params.scheduledFor || params.startsAt || params.bookingTime || '';
  return {
    id: params.id || params.bookingId || `appt-${slugify(context.leadName || context.address || randomUUID())}-${Date.now()}`,
    leadId: params.leadId || context.leadId,
    leadName: context.leadName,
    address: context.address,
    email: params.email || context.email || '',
    phone: normalizePhone(params.phone || params.to || context.phone),
    startTime,
    endTime: params.endTime || '',
    timezone: params.timezone || 'America/New_York',
    source: params.source || params.provider || 'manual',
    status: params.status || 'scheduled',
    notes: params.notes || params.summary || '',
    bookingUrl: params.bookingUrl || params.calendarUrl || '',
    calendarEventStatus: params.calendarEventStatus || '',
    calendarProvider: params.calendarProvider || '',
    calendarEventId: params.calendarEventId || '',
    calendarJoinUrl: params.calendarJoinUrl || '',
    createdAt: params.createdAt || isoNow(),
    updatedAt: params.updatedAt || isoNow(),
  };
}

function createContractRecord(params = {}) {
  const context = findLeadContext(params);
  return {
    id: params.id || `contract-${slugify(context.leadName || context.address || randomUUID())}`,
    leadId: params.leadId || context.leadId,
    leadName: context.leadName,
    address: context.address,
    email: params.email || context.email || '',
    phone: normalizePhone(params.phone || context.phone),
    amount: toNumber(params.amount || params.offerPrice, 0),
    selectedPath: params.selectedPath || '',
    selectedPathLabel: params.selectedPathLabel || '',
    timeline: params.timeline || '',
    earnestDeposit: params.earnestDeposit || '',
    status: params.status || 'sent',
    provider: params.provider || 'DocuSign',
    envelopeId: params.envelopeId || `env-${slugify(context.leadName || 'lead')}-${Date.now()}`,
    documentTitle: params.documentTitle || 'PBK Master Deal Package',
    previewUrl: params.previewUrl || '',
    pdfUrl: params.pdfUrl || '',
    masterPackageQuery: params.masterPackageQuery || '',
    pdfGeneratedAt: params.pdfGeneratedAt || '',
    notes: params.notes || '',
    approvalId: params.approvalId || '',
    templateId: params.templateId || '',
    underwritingStatus: params.underwritingStatus || '',
    underwritingReviewerEmail: params.underwritingReviewerEmail || '',
    underwritingReviewerName: params.underwritingReviewerName || '',
    sellerNotice: params.sellerNotice || '',
    createdAt: params.createdAt || isoNow(),
    updatedAt: params.updatedAt || isoNow(),
  };
}

function findDncEntryByPhone(phone = '') {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return state.dncEntries.find((entry) => normalizePhone(entry.phone) === normalized) || null;
}

function inferSenderProfile(profile = '') {
  return String(profile || '').trim().toLowerCase() === 'cold' ? 'cold' : 'warm';
}

function getSenderAddress(profile = '') {
  return inferSenderProfile(profile) === 'cold' ? COLD_CAMPAIGN_EMAIL : MAIN_BUSINESS_EMAIL;
}

function looksLikeAdminIntent(text = '') {
  const normalized = String(text || '').toLowerCase();
  return [
    'instantly',
    'domain',
    'warmup',
    'telnyx',
    'number',
    'caller id',
    'call routing',
    'template',
    'agreement',
    'contract',
    'render',
    'env var',
    'restart service',
    'rollback',
    'supabase',
    'migration',
    'schema',
    'column',
    'streak',
    'pipeline',
    'crm schema',
    'bootstrap schema',
    'admin update',
    'docusign',
    'docu sign',
  ].some((token) => normalized.includes(token));
}

function looksLikeDocuSignStatusIntent(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;
  const mentionsDocuSign = normalized.includes('docusign') || normalized.includes('docu sign');
  const asksForStatus = [
    'status',
    'auth',
    'credential',
    'credentials',
    'key',
    'private key',
    'provider',
    'diagnostic',
    'diagnostics',
    'ready',
    'health',
  ].some((token) => normalized.includes(token));
  return mentionsDocuSign && asksForStatus;
}

function looksLikeBrowserResearchIntent(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;
  if (/(https?:\/\/|www\.)/i.test(normalized)) return true;
  return [
    'browseros',
    'browser os',
    'browser research',
    'use browser',
    'use the browser',
    'scrape',
    'crawl',
    'fetch this page',
    'check zillow',
    'check redfin',
    'open zillow',
    'open redfin',
    'property page',
    'listing page',
    'public record site',
  ].some((token) => normalized.includes(token));
}

function detectAdminIntent(command = '') {
  const normalized = String(command || '').trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes('instantly') || normalized.includes('domain') || normalized.includes('warmup') || normalized.includes('campaign')) {
    const action = normalized.includes('pause')
      ? 'pause_campaign'
      : normalized.includes('limit')
        ? 'rotate_sending_limits'
        : normalized.includes('warmup') || normalized.includes('warm up')
          ? 'warmup_email'
          : 'create_email_domain';
    return {
      provider: 'instantly',
      action,
      risk: action === 'create_email_domain' ? 'high' : normalized.includes('limit') ? 'medium' : 'low',
      summary: action === 'warmup_email'
        ? 'Prepare an Instantly warmup action for the requested sending accounts.'
        : normalized.includes('warmup')
          ? 'Prepare a new Instantly sender domain and warmup plan.'
        : 'Prepare an Instantly outreach infrastructure update.',
    };
  }

  if (normalized.includes('telnyx') || normalized.includes('number') || normalized.includes('caller id') || normalized.includes('routing')) {
    return {
      provider: 'telnyx',
      action: normalized.includes('routing') ? 'configure_call_routing' : normalized.includes('caller id') ? 'update_outbound_caller_id' : 'purchase_number',
      risk: normalized.includes('purchase') || normalized.includes('buy') || normalized.includes('numbers') ? 'high' : 'medium',
      summary: 'Prepare a Telnyx voice or messaging infrastructure change.',
    };
  }

  if (normalized.includes('template') || normalized.includes('agreement') || normalized.includes('contract')) {
    return {
      provider: 'contract-admin',
      action: normalized.includes('retire') ? 'retire_template' : normalized.includes('update') ? 'update_template' : 'add_template',
      risk: normalized.includes('retire') ? 'medium' : 'low',
      summary: 'Prepare a contract template library update.',
    };
  }

  if (normalized.includes('render') || normalized.includes('env var') || normalized.includes('restart') || normalized.includes('rollback')) {
    return {
      provider: 'render',
      action: normalized.includes('rollback') ? 'rollback_deploy' : normalized.includes('restart') ? 'restart_service' : 'update_env_var',
      risk: normalized.includes('rollback') || normalized.includes('update') ? 'high' : 'medium',
      summary: 'Prepare a hosted bridge infrastructure change on Render.',
    };
  }

  if (normalized.includes('supabase') || normalized.includes('migration') || normalized.includes('schema') || normalized.includes('column') || normalized.includes('database')) {
    return {
      provider: 'supabase',
      action: normalized.includes('backup') ? 'backup_table' : normalized.includes('column') ? 'add_column' : 'run_migration',
      risk: normalized.includes('backup') ? 'low' : 'high',
      summary: 'Prepare a database schema or backup action for approval.',
    };
  }

  if (normalized.includes('streak') || normalized.includes('pipeline') || normalized.includes('crm schema') || normalized.includes('bootstrap schema')) {
    return {
      provider: 'streak',
      action: normalized.includes('inspect') || normalized.includes('status') ? 'inspect_schema' : 'bootstrap_schema',
      risk: normalized.includes('inspect') || normalized.includes('status') ? 'low' : 'medium',
      summary: normalized.includes('inspect') || normalized.includes('status')
        ? 'Inspect the Streak pipeline schema for PBK readiness.'
        : 'Prepare a Streak pipeline schema bootstrap for PBK transitions.',
    };
  }

  return null;
}

function looksLikePersistenceStatusIntent(command = '') {
  const normalized = String(command || '').trim().toLowerCase();
  if (!normalized) return false;
  const asksAboutPersistence =
    normalized.includes('persist')
    || normalized.includes('mirrored')
    || normalized.includes('mirror')
    || normalized.includes('bridge state')
    || normalized.includes('state backend')
    || normalized.includes('render env')
    || normalized.includes('render sync')
    || normalized.includes('where is');
  const aboutCallerId =
    normalized.includes('caller id')
    || normalized.includes('from number')
    || normalized.includes('default number')
    || normalized.includes('telnyx from');
  return asksAboutPersistence && aboutCallerId;
}

function classifyStreakAdminCommand(command = '') {
  const normalized = String(command || '').trim().toLowerCase();
  if (!normalized) return null;
  const mentionsStreak = normalized.includes('streak') || normalized.includes('pipeline') || normalized.includes('crm schema');
  if (!mentionsStreak) return null;

  if (
    normalized.includes('inspect')
    || normalized.includes('status')
    || normalized.includes('readiness')
    || normalized.includes('check streak')
  ) {
    return { route: 'inspectStreakPipeline', mode: 'inspect' };
  }

  if (
    normalized.includes('queue')
    || normalized.includes('approval')
    || normalized.includes('approve later')
    || normalized.includes('for approval')
  ) {
    return { route: 'bootstrapStreakPipeline', mode: 'request_approval' };
  }

  if (
    normalized.includes('apply')
    || normalized.includes('bootstrap streak now')
    || normalized.includes('fix streak now')
    || normalized.includes('do it now')
    || normalized.includes('go ahead')
    || normalized.includes('run it now')
  ) {
    return { route: 'bootstrapStreakPipeline', mode: 'apply' };
  }

  if (
    normalized.includes('plan')
    || normalized.includes('what is missing')
    || normalized.includes('schema fix')
    || normalized.includes('bootstrap')
  ) {
    return { route: 'getStreakBootstrapPlan', mode: 'plan' };
  }

  return { route: 'requestAdminAction', mode: 'generic' };
}

function inferAdminRouteMode(command = '') {
  const normalized = String(command || '').trim().toLowerCase();
  if (!normalized) return 'preview';

  if (
    normalized.includes('queue')
    || normalized.includes('approval')
    || normalized.includes('approve later')
    || normalized.includes('for approval')
  ) {
    return 'request_approval';
  }

  if (
    normalized.includes('apply')
    || normalized.includes('do it now')
    || normalized.includes('go ahead')
    || normalized.includes('run it now')
    || normalized.includes('restart now')
    || normalized.includes('buy now')
    || normalized.includes('add now')
    || normalized.includes('update now')
    || normalized.includes('warmup now')
    || normalized.includes('warm up now')
  ) {
    return 'apply';
  }

  return 'preview';
}

function extractDomainNames(command = '') {
  const matches = String(command || '').match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi) || [];
  return Array.from(new Set(matches.map((item) => item.toLowerCase())));
}

function extractEmailAddresses(command = '') {
  const matches = String(command || '').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
  return Array.from(new Set(matches.map((item) => item.toLowerCase())));
}

function extractCountNearKeyword(command = '', keywordPattern = '(?:domains?|numbers?|lines?)') {
  const normalized = String(command || '').trim().toLowerCase();
  const match = normalized.match(new RegExp(`\\b(\\d{1,3})\\s+(?:more\\s+)?(?:new\\s+)?(?:email\\s+|phone\\s+)?${keywordPattern}\\b`, 'i'));
  return match ? Number.parseInt(match[1], 10) : null;
}

function extractAreaCode(command = '') {
  const normalized = String(command || '').trim().toLowerCase();
  const explicit = normalized.match(/\barea code\s*(\d{3})\b/i);
  if (explicit) return explicit[1];
  const contextual = normalized.match(/\b(\d{3})\s+(?:area code\s+)?(?:numbers?|lines?)\b/i);
  return contextual ? contextual[1] : '';
}

function extractPhoneNumbers(command = '') {
  const matches = String(command || '').match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) || [];
  return Array.from(new Set(matches.map((item) => normalizePhone(item)).filter(Boolean)));
}

function extractDailyLimit(command = '') {
  const normalized = String(command || '').trim().toLowerCase();
  const match = normalized.match(/\b(\d{2,6})\s*(?:emails?|sends?)\s*(?:per day|a day|daily)?\b/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function extractCampaignId(command = '') {
  const match = String(command || '').match(/\bcampaign\s+([a-z0-9._-]+)/i);
  return match ? match[1] : '';
}

function extractEnvVarNames(command = '') {
  const matches = String(command || '').match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || [];
  return Array.from(new Set(matches));
}

function stripWrappingQuotes(value = '') {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function extractEnvAssignments(command = '') {
  const source = String(command || '');
  const assignments = {};
  const patterns = [
    /\b([A-Z][A-Z0-9_]{2,})\s*=\s*("[^"]*"|'[^']*'|[^\s,;]+)/g,
    /\b(?:set|update|change)\s+([A-Z][A-Z0-9_]{2,})\s+(?:to|=)\s+("[^"]*"|'[^']*'|[^\s,;]+)/gi,
  ];

  patterns.forEach((pattern) => {
    let match = pattern.exec(source);
    while (match) {
      assignments[match[1]] = stripWrappingQuotes(match[2]);
      match = pattern.exec(source);
    }
  });

  return assignments;
}

function redactEnvAssignmentsInCommand(command = '') {
  return String(command || '')
    .replace(/\b([A-Z][A-Z0-9_]{2,})\s*=\s*("[^"]*"|'[^']*'|[^\s,;]+)/g, (_, key) => `${key}=[REDACTED]`)
    .replace(/\b(set|update|change)\s+([A-Z][A-Z0-9_]{2,})\s+(to|=)\s+("[^"]*"|'[^']*'|[^\s,;]+)/gi, (_, verb, key, joiner) => `${verb} ${key} ${joiner} [REDACTED]`);
}

function extractTemplateHint(command = '') {
  const quoted = String(command || '').match(/["']([^"']+)["']/);
  if (quoted?.[1]) return quoted[1].trim();

  const beforeKeyword = String(command || '').match(/\b(?:add|update|retire|replace|archive)\s+(?:the\s+)?([a-z0-9][a-z0-9\s-]{1,50}?)\s+(?:template|agreement|contract)\b/i);
  if (beforeKeyword?.[1]) return beforeKeyword[1].trim();

  const afterKeyword = String(command || '').match(/\b(?:template|agreement|contract)\s+([a-z0-9][a-z0-9\s-]{1,50})\b/i);
  return afterKeyword?.[1]?.trim() || '';
}

function extractServiceId(command = '') {
  const match = String(command || '').match(/\bservice\s+([a-z0-9-]{4,})\b/i);
  return match ? match[1] : '';
}

function buildAdminRoutePreview(route = {}) {
  const providerKey = String(route.provider || '').toLowerCase();
  const configured =
    providerKey === 'instantly'
      ? Boolean(INSTANTLY_API_KEY)
      : providerKey === 'telnyx'
        ? Boolean(TELNYX_API_KEY)
        : providerKey === 'render'
          ? Boolean(RENDER_API_KEY && RENDER_SERVICE_ID)
          : providerKey === 'contract-admin'
            ? true
            : providerKey === 'streak'
              ? Boolean(STREAK_API_KEY && STREAK_PIPELINE_KEY)
              : false;
  const requiresApproval = route.requiresApproval ?? normalizeApprovalRequired(route.provider, route.action);
  return {
    provider: route.provider,
    action: route.action,
    mode: route.mode || 'preview',
    risk: route.risk || (requiresApproval ? 'high' : 'low'),
    configured,
    requiresApproval,
    payload: route.payload || {},
    summary: route.summary || 'Prepared an admin routing preview.',
  };
}

function classifyExtendedAdminCommand(command = '', detected = null) {
  const normalized = String(command || '').trim().toLowerCase();
  const adminIntent = detected || detectAdminIntent(command);
  if (!adminIntent || adminIntent.provider === 'streak' || adminIntent.provider === 'supabase') {
    return null;
  }

  const mode = inferAdminRouteMode(command);

  if (adminIntent.provider === 'instantly') {
    const domains = extractDomainNames(command);
    const emails = extractEmailAddresses(command);
    const domainCount = extractCountNearKeyword(command, 'domains?') || (domains.length || null);
    const dailyLimit = extractDailyLimit(command);
    const campaignId = extractCampaignId(command);
    const warmup = normalized.includes('warmup') || normalized.includes('warm up');
    const descriptor = domains.length ? domains.join(', ') : domainCount ? `${domainCount} domain${domainCount === 1 ? '' : 's'}` : 'Instantly infrastructure';
    return {
      provider: 'instantly',
      action: adminIntent.action,
      mode,
      risk: adminIntent.risk,
      requiresApproval: normalizeApprovalRequired('instantly', adminIntent.action),
      payload: {
        domains,
        emails,
        domainCount,
        campaignId: campaignId || undefined,
        dailyLimit,
        warmup,
        search: domains[0] || '',
        includeAllEmails: emails.length === 0,
      },
      summary:
        adminIntent.action === 'warmup_email'
          ? `Prepare an Instantly warmup run${emails.length ? ` for ${emails.length} account${emails.length === 1 ? '' : 's'}` : domains[0] ? ` matching ${domains[0]}` : ''}.`
          : adminIntent.action === 'rotate_sending_limits'
          ? `Prepare an Instantly sending-limit update${dailyLimit ? ` to ${dailyLimit} sends/day` : ''}${campaignId ? ` for campaign ${campaignId}` : ''}.`
          : adminIntent.action === 'pause_campaign'
            ? `Prepare an Instantly campaign pause${campaignId ? ` for ${campaignId}` : ''}.`
            : `Prepare Instantly domain setup for ${descriptor}${warmup ? ' and kick off warmup' : ''}.`,
    };
  }

  if (adminIntent.provider === 'telnyx') {
    const quantity = extractCountNearKeyword(command, 'numbers?|lines?');
    const areaCode = extractAreaCode(command);
    const callerId = normalizePhone(String(command || '').match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] || '');
    const targetNumbers = extractPhoneNumbers(command);
    return {
      provider: 'telnyx',
      action: adminIntent.action,
      mode,
      risk: adminIntent.risk,
      requiresApproval: normalizeApprovalRequired('telnyx', adminIntent.action),
      payload: {
        quantity,
        areaCode: areaCode || undefined,
        callerId: callerId || undefined,
        targetNumbers,
        connectionId: TELNYX_CONNECTION_ID || undefined,
        messagingProfileId: TELNYX_MESSAGING_PROFILE_ID || undefined,
        persistToRender: normalized.includes('persist') || normalized.includes('save') || normalized.includes('default') || normalized.includes('main caller id')
          ? true
          : Boolean(RENDER_API_KEY && RENDER_SERVICE_ID),
      },
      summary:
        adminIntent.action === 'configure_call_routing'
          ? 'Prepare a Telnyx call-routing update.'
          : adminIntent.action === 'update_outbound_caller_id'
            ? `Prepare a Telnyx caller ID update${callerId ? ` to ${callerId}` : ''}.`
            : `Prepare a Telnyx number purchase${quantity ? ` for ${quantity}` : ''}${areaCode ? ` in area code ${areaCode}` : ''}.`,
    };
  }

  if (adminIntent.provider === 'render') {
    const envVars = extractEnvVarNames(command);
    const envAssignments = extractEnvAssignments(command);
    const serviceId = extractServiceId(command) || RENDER_SERVICE_ID || '';
    const restartAfterUpdate = normalized.includes('restart') || normalized.includes('bounce') || normalized.includes('redeploy');
    return {
      provider: 'render',
      action: adminIntent.action,
      mode,
      risk: adminIntent.risk,
      requiresApproval: normalizeApprovalRequired('render', adminIntent.action),
      payload: {
        envVars,
        envAssignments,
        serviceId: serviceId || undefined,
        restartAfterUpdate,
      },
      summary:
        adminIntent.action === 'rollback_deploy'
          ? `Prepare a Render rollback${serviceId ? ` for service ${serviceId}` : ''}.`
          : adminIntent.action === 'restart_service'
            ? `Prepare a Render service restart${serviceId ? ` for ${serviceId}` : ''}.`
            : `Prepare a Render environment update${Object.keys(envAssignments).length ? ` for ${Object.keys(envAssignments).join(', ')}` : envVars.length ? ` for ${envVars.join(', ')}` : ''}.`,
    };
  }

  if (adminIntent.provider === 'contract-admin') {
    const templateHint = extractTemplateHint(command);
    return {
      provider: 'contract-admin',
      action: adminIntent.action,
      mode,
      risk: adminIntent.risk,
      requiresApproval: normalizeApprovalRequired('contract-admin', adminIntent.action),
      payload: {
        templateHint: templateHint || undefined,
        templateId: templateHint ? slugify(templateHint) : undefined,
      },
      summary:
        adminIntent.action === 'retire_template'
          ? `Prepare a contract template retirement${templateHint ? ` for ${templateHint}` : ''}.`
          : adminIntent.action === 'update_template'
            ? `Prepare a contract template update${templateHint ? ` for ${templateHint}` : ''}.`
            : `Prepare a contract template add${templateHint ? ` for ${templateHint}` : ''}.`,
    };
  }

  return null;
}

function extractBrowserResearchRequest(command = '') {
  const normalized = String(command || '').trim();
  const lower = normalized.toLowerCase();
  const targetUrl = normalized.match(/https?:\/\/\S+/i)?.[0] || '';
  const propertyMatch = normalized.match(/\b\d{2,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,5}\b/i);
  const source =
    lower.includes('zillow') ? 'Zillow'
      : lower.includes('redfin') ? 'Redfin'
      : lower.includes('county') || lower.includes('public record') ? 'Public records'
      : lower.includes('mls') ? 'MLS'
      : targetUrl ? 'Direct URL'
      : 'Browser research';

  return {
    query: normalized,
    targetUrl,
    targetLabel: propertyMatch?.[0] || targetUrl || normalized,
    source,
  };
}

function classifyParticipantText(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  const agentSignals = [
    'listing',
    'mls',
    'commission',
    'broker',
    'realtor',
    'licensed agent',
    'my seller',
    'buyer client',
  ].filter((token) => normalized.includes(token));
  const expertSignals = [
    'arv',
    'mao',
    'novation',
    'subject-to',
    'subto',
    'assignment fee',
    'equity spread',
    'seller finance',
    'creative finance',
    'commission split',
  ].filter((token) => normalized.includes(token));
  const noviceSignals = [
    'how does this work',
    'never done this',
    'not sure',
    'can you explain',
    'new to this',
    'first time',
  ].filter((token) => normalized.includes(token));

  const role = agentSignals.length ? 'agent' : 'seller';
  const expertise = expertSignals.length >= 2 ? 'expert' : noviceSignals.length ? 'novice' : expertSignals.length ? 'intermediate' : 'intermediate';
  return {
    role,
    expertise,
    confidence: expertSignals.length || noviceSignals.length || agentSignals.length ? 0.81 : 0.54,
    signals: {
      agent: agentSignals,
      expert: expertSignals,
      novice: noviceSignals,
    },
  };
}

function resolveParticipantProfile(params = {}) {
  const leadImport = findLatestLeadImport(params);
  const existingProfile = leadImport?.participantProfile;
  const transcriptStart = String(params.transcriptStart || params.text || params.transcript || params.body || '').trim();
  if (!transcriptStart) {
    return existingProfile || null;
  }

  const classified = classifyParticipantText(transcriptStart);
  return {
    ...(existingProfile || {}),
    ...classified,
    transcriptStart: transcriptStart.slice(0, 240),
    source: params.source || params.provider || params.channel || existingProfile?.source || 'runtime',
    classifiedAt: params.classifiedAt || isoNow(),
  };
}

function persistParticipantProfile(params = {}) {
  const profile = resolveParticipantProfile(params);
  if (!profile) return { profile: null, leadImport: null };

  const patchedLeadImport = patchLeadImport(state, {
    leadId: params.leadId,
    leadName: params.leadName,
    address: params.address,
    email: params.email,
  }, {
    participantRole: profile.role || '',
    participantExpertise: profile.expertise || '',
    participantConfidence: toNumber(profile.confidence, 0),
    participantClassifiedAt: profile.classifiedAt || isoNow(),
    participantProfile: profile,
  });

  return {
    profile,
    leadImport: patchedLeadImport,
  };
}

function buildCallStrategyFromProfile(profile = null) {
  if (!profile?.role) {
    return {
      script: 'standard-acquisition',
      strategy: 'default seller discovery and qualification flow',
    };
  }

  if (profile.role === 'agent') {
    return {
      script: 'agent-net-sheet',
      strategy: 'speak in agent terms, stay concise, and focus on seller timeline, net, and coordination',
    };
  }

  if (profile.expertise === 'expert') {
    return {
      script: 'expert-numbers-first',
      strategy: 'assume familiarity, get to numbers quickly, and avoid over-explaining basic acquisition terms',
    };
  }

  if (profile.expertise === 'novice') {
    return {
      script: 'novice-guided-walkthrough',
      strategy: 'slow down, educate, remove jargon, and lead with clarity and reassurance',
    };
  }

  return {
    script: 'intermediate-acquisition',
    strategy: 'balance empathy with direct qualification and keep the process simple',
  };
}

function normalizeDocumentItems(payload = {}) {
  if (Array.isArray(payload.documents) && payload.documents.length && typeof payload.documents[0] === 'object') {
    return payload.documents
      .map((item) => ({
        type: item.type || slugify(item.title || 'document'),
        title: item.title || item.documentTitle || item.type || 'PBK Document',
        content: item.content || '',
      }))
      .filter((item) => item.content);
  }

  const source = payload.documentSet && typeof payload.documentSet === 'object' ? payload.documentSet : {};
  const requested = Array.isArray(payload.selectedDocuments) && payload.selectedDocuments.length
    ? payload.selectedDocuments
    : Array.isArray(payload.documents)
      ? payload.documents
      : ['seller', 'loi'];

  return requested
    .map((key) => ({
      type: key,
      title:
        key === 'seller'
          ? 'Seller Presentation Guide'
          : key === 'loi'
            ? 'Letter of Interest'
            : key === 'email'
              ? 'Next Steps'
              : String(key || 'PBK Document'),
      content: source[key] || '',
    }))
    .filter((item) => item.content);
}

function createDocumentDeliveryRecord(params = {}) {
  const context = findLeadContext(params);
  return {
    id: params.id || `delivery-${slugify(context.leadName || context.address || randomUUID())}-${Date.now()}`,
    leadId: params.leadId || context.leadId,
    leadName: params.leadName || context.leadName,
    address: params.address || context.address,
    email: params.email || context.email || '',
    senderProfile: inferSenderProfile(params.senderProfile),
    documents: Array.isArray(params.documents) ? params.documents : [],
    status: params.status || 'queued',
    subject: params.subject || '',
    provider: params.provider || 'resend',
    createdAt: params.createdAt || isoNow(),
    updatedAt: params.updatedAt || isoNow(),
  };
}

async function buildPdfAttachment(document, payload = {}) {
  const pdfBuffer = await generatePdfDocument({
    documentTitle: document.title,
    propertyAddress: payload.address || '',
    leadName: payload.leadName || '',
    selectedPathLabel: payload.selectedPathLabel || 'PBK',
    companyName: payload.companyName || 'Probono Key Realty',
    content: document.content || '',
  });

  return {
    filename: `${safeFilename(document.title || document.type || 'PBK_Document')}.pdf`,
    content: Buffer.from(pdfBuffer).toString('base64'),
  };
}

async function sendTransactionalEmail({
  from,
  to,
  subject,
  html,
  text,
  attachments = [],
}) {
  if (!to) {
    return {
      ok: false,
      live: false,
      error: 'Recipient email is required.',
    };
  }

  if (!RESEND_API_KEY) {
    return {
      ok: true,
      live: false,
      simulated: true,
      provider: 'simulated-email',
      from,
      to,
      subject,
      attachments: attachments.map((item) => item.filename),
    };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        attachments,
      }),
    });

    const bodyText = await response.text();
    let body = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = bodyText;
    }

    if (!response.ok) {
      return {
        ok: false,
        live: true,
        status: response.status,
        error: body?.message || body?.error || `Resend returned ${response.status}`,
        body,
      };
    }

    return {
      ok: true,
      live: true,
      status: response.status,
      id: body?.id || '',
      body,
    };
  } catch (error) {
    return {
      ok: false,
      live: true,
      error: error instanceof Error ? error.message : 'Email delivery failed.',
    };
  }
}

function normalizeApprovalRequired(provider = '', action = '') {
  const key = `${provider}:${action}`.toLowerCase();
  return [
    'instantly:create_email_domain',
    'instantly:rotate_sending_limits',
    'telnyx:purchase_number',
    'render:update_env_var',
    'render:rollback_deploy',
    'supabase:add_column',
    'supabase:run_migration',
    'contract-admin:update_template',
    'streak:bootstrap_schema',
  ].includes(key);
}

function createAdminTaskRecord(params = {}) {
  const detected = params.detected || detectAdminIntent(params.command || '') || {};
  const provider = params.provider || detected.provider || 'system';
  const action = params.action || detected.action || 'review';
  const requiresApproval = params.requiresApproval ?? normalizeApprovalRequired(provider, action) ?? true;
  const risk = params.risk || detected.risk || (requiresApproval ? 'high' : 'low');

  return {
    id: params.id || `admin-${slugify(`${provider}-${action}`)}-${Date.now()}`,
    provider,
    action,
    command: params.command || '',
    summary: params.summary || detected.summary || 'Administrative action queued for review.',
    status: params.status || 'pending',
    requestedBy: params.requestedBy || 'Rex',
    requiresApproval,
    dryRun: params.dryRun !== false,
    risk,
    costEstimate:
      params.costEstimate
      || (provider === 'telnyx' && action === 'purchase_number'
        ? 'Usage-based spend'
        : provider === 'instantly' && action === 'create_email_domain'
          ? 'Potential provider/domain purchase cost'
          : '$0 immediate cost'),
    payload: params.payload || {},
    executionHistory: Array.isArray(params.executionHistory) ? params.executionHistory : [],
    createdAt: params.createdAt || isoNow(),
    updatedAt: params.updatedAt || isoNow(),
  };
}

async function executeAdminTask(task, overrides = {}) {
  const payload = {
    ...(task.payload || {}),
    ...(overrides.payload || {}),
  };
  const now = isoNow();
  const liveExecution = (overrides.dryRun ?? task.dryRun) === false;

  const response = {
    ok: true,
    live: false,
    provider: task.provider,
    action: task.action,
    summary: task.summary,
    executedAt: now,
    simulated: !liveExecution,
  };

  if (task.provider === 'instantly') {
    response.configured = Boolean(INSTANTLY_API_KEY);
    if (!INSTANTLY_API_KEY) {
      response.ok = !liveExecution ? response.ok : false;
      response.details = 'Instantly API key is not configured, so this admin action stayed in dry-run mode.';
    } else if (!liveExecution) {
      response.details = 'Instantly admin change recorded for approval-backed execution. Live API write remains guarded until the task runs live.';
    } else if (task.action === 'warmup_email') {
      const emails = Array.isArray(payload.emails) ? payload.emails.filter(Boolean) : [];
      const search = String(payload.search || payload.domain || '').trim();
      const warmupPayload = emails.length
        ? { emails }
        : {
          include_all_emails: payload.includeAllEmails !== false,
          ...(search ? { search } : {}),
        };

      if (!emails.length && !search && !warmupPayload.include_all_emails) {
        response.ok = false;
        response.details = 'Instantly warmup requires account emails, a domain search, or include_all_emails=true.';
      } else {
        const warmupResult = await fireInstantlyRequest(INSTANTLY_WARMUP_ENABLE_ENDPOINT, warmupPayload);
        response.ok = warmupResult.ok;
        response.live = true;
        response.simulated = false;
        response.warmupResult = warmupResult;
        response.details = warmupResult.ok
          ? `Instantly warmup job started${emails.length ? ` for ${emails.length} account${emails.length === 1 ? '' : 's'}` : search ? ` using search ${search}` : ' for the selected account set'}.`
          : warmupResult.error || 'Instantly warmup request failed.';
      }
    } else if (task.action === 'create_email_domain') {
      const domains = Array.isArray(payload.domains) ? payload.domains.filter(Boolean) : [];
      if (!domains.length) {
        response.ok = false;
        response.details = 'Instantly domain setup requires at least one domain in the admin payload.';
      } else if (INSTANTLY_DOMAIN_SETUP_WEBHOOK_URL) {
        const domainSetupResult = await fireWebhook(INSTANTLY_DOMAIN_SETUP_WEBHOOK_URL, {
          provider: 'instantly',
          action: 'create_email_domain',
          domains,
          requestedBy: task.requestedBy || overrides.actor || 'Rex',
          warmup: Boolean(payload.warmup),
          domainCount: payload.domainCount || domains.length,
        });
        response.ok = domainSetupResult.ok;
        response.live = true;
        response.simulated = false;
        response.domainSetupResult = domainSetupResult;
        response.details = domainSetupResult.ok
          ? `Sent ${domains.length} domain${domains.length === 1 ? '' : 's'} to the Instantly domain setup webhook.`
          : domainSetupResult.error || 'Instantly domain setup webhook failed.';
      } else {
        const orderPayload = {
          items: domains.map((domain) => ({ domain })),
          order_type: payload.orderType || 'dfy',
          simulation: false,
        };
        const orderResult = await fireInstantlyRequest(INSTANTLY_DOMAIN_ORDER_ENDPOINT, orderPayload);
        response.ok = orderResult.ok;
        response.live = true;
        response.simulated = false;
        response.domainOrderResult = orderResult;
        response.details = orderResult.ok
          ? `Placed an Instantly DFY domain order for ${domains.join(', ')}.`
          : orderResult.error || 'Instantly domain order failed.';
        if (orderResult.ok && payload.warmup) {
          response.nextStep = 'Warmup can be enabled after the ordered accounts become available in Instantly.';
        }
      }
    } else {
      response.details = 'Instantly admin request captured for approval-backed execution.';
    }
  } else if (task.provider === 'telnyx') {
    response.configured = Boolean(TELNYX_API_KEY);
    if (!TELNYX_API_KEY) {
      response.ok = !liveExecution ? response.ok : false;
      response.details = 'Telnyx API key is not configured, so this admin action stayed in dry-run mode.';
    } else if (!liveExecution) {
      response.details = 'Telnyx infrastructure request recorded and is waiting for live execution from the admin queue.';
    } else if (task.action === 'purchase_number') {
      const quantity = Math.max(1, Number(payload.quantity || 1));
      const searchResult = await searchAvailableTelnyxNumbers({
        quantity,
        areaCode: payload.areaCode,
      });
      response.searchResult = searchResult;

      if (!searchResult.ok) {
        response.ok = false;
        response.live = true;
        response.simulated = false;
        response.details = searchResult.error || 'Telnyx number search failed.';
      } else {
        const candidates = Array.isArray(searchResult.body?.data) ? searchResult.body.data : [];
        const selected = candidates
          .map((item) => item?.phone_number)
          .filter(Boolean)
          .slice(0, quantity);

        if (!selected.length) {
          response.ok = false;
          response.live = true;
          response.simulated = false;
          response.details = `Telnyx did not return purchasable numbers${payload.areaCode ? ` for area code ${payload.areaCode}` : ''}.`;
        } else {
          const orderResult = await orderTelnyxNumbers({
            phoneNumbers: selected,
            connectionId: payload.connectionId || TELNYX_CONNECTION_ID,
            messagingProfileId: payload.messagingProfileId || TELNYX_MESSAGING_PROFILE_ID,
            customerReference: `pbk-admin-${Date.now()}`,
          });
          response.ok = orderResult.ok;
          response.live = true;
          response.simulated = false;
          response.orderResult = orderResult;
          response.selectedPhoneNumbers = selected;
          response.details = orderResult.ok
            ? `Ordered ${selected.length} Telnyx number${selected.length === 1 ? '' : 's'}${payload.areaCode ? ` in area code ${payload.areaCode}` : ''}.`
            : orderResult.error || 'Telnyx number order failed.';
        }
      }
    } else if (task.action === 'configure_call_routing') {
      const targetNumbers = Array.isArray(payload.targetNumbers) ? payload.targetNumbers.filter(Boolean) : [];
      const connectionId = String(payload.connectionId || TELNYX_CONNECTION_ID || '').trim();
      if (!targetNumbers.length || !connectionId) {
        response.ok = false;
        response.live = true;
        response.simulated = false;
        response.details = 'Telnyx call routing updates require target numbers and a connection ID.';
      } else {
        const updates = [];
        let overallOk = true;
        for (const phoneNumber of targetNumbers) {
          const listResult = await listTelnyxPhoneNumbers({ phoneNumber });
          const telnyxNumber = Array.isArray(listResult.body?.data) ? listResult.body.data[0] : null;
          if (!listResult.ok || !telnyxNumber?.id) {
            overallOk = false;
            updates.push({
              phoneNumber,
              ok: false,
              error: listResult.error || 'Unable to resolve the Telnyx phone number ID.',
            });
            continue;
          }
          const updateResult = await updateTelnyxPhoneNumber(telnyxNumber.id, { connection_id: connectionId });
          updates.push({
            phoneNumber,
            ok: updateResult.ok,
            status: updateResult.status,
            error: updateResult.error || '',
          });
          if (!updateResult.ok) overallOk = false;
        }
        response.ok = overallOk;
        response.live = true;
        response.simulated = false;
        response.routingUpdates = updates;
        response.details = overallOk
          ? `Updated Telnyx call routing for ${updates.length} number${updates.length === 1 ? '' : 's'}.`
          : `Telnyx routing updated ${updates.filter((item) => item.ok).length} of ${updates.length} number${updates.length === 1 ? '' : 's'}.`;
      }
    } else if (task.action === 'update_outbound_caller_id') {
      const callerId = normalizePhone(payload.callerId || '');
      if (!callerId) {
        response.ok = false;
        response.live = true;
        response.simulated = false;
        response.details = 'Telnyx caller ID updates require a valid destination number in E.164 or US format.';
      } else {
        const listResult = await listTelnyxPhoneNumbers({ phoneNumber: callerId });
        const telnyxNumber = Array.isArray(listResult.body?.data) ? listResult.body.data[0] : null;
        response.validationResult = listResult;
        response.live = true;
        response.simulated = false;

        if (!listResult.ok || !telnyxNumber?.id) {
          response.ok = false;
          state.status.telnyxCallerIdLastValidatedAt = isoNow();
          state.status.telnyxCallerIdRenderSyncStatus = state.status.telnyxCallerIdRenderSyncStatus || 'unknown';
          response.details = listResult.error || `Telnyx could not validate ownership of ${callerId}.`;
        } else {
          state.status.defaultTelnyxFromNumber = callerId;
          state.status.telnyxCallerIdLastChangeAt = isoNow();
          state.status.telnyxCallerIdLastValidatedAt = isoNow();
          state.status.telnyxCallerIdRenderLastError = '';
          response.ok = true;
          response.callerId = callerId;
          response.bridgeDefaultUpdated = true;
          response.persistedToStateBackend = true;
          response.stateBackend = STATE_BACKEND;
          response.details = `Updated the PBK runtime default outbound caller ID to ${callerId} after validating it in Telnyx. The change is persisted in the PBK ${STATE_BACKEND} state backend and will survive a normal bridge restart.`;

          if (payload.persistToRender && RENDER_API_KEY && RENDER_SERVICE_ID) {
            const renderResult = await fireRenderRequest(
              'PUT',
              `/services/${encodeURIComponent(String(payload.serviceId || RENDER_SERVICE_ID))}/env-vars/${encodeURIComponent('PBK_TELNYX_FROM_NUMBER')}`,
              { value: callerId },
            );
            response.renderPersistResult = renderResult;
            if (renderResult.ok) {
              state.status.telnyxCallerIdRenderSyncStatus = 'synced';
              state.status.telnyxCallerIdRenderLastSyncAt = isoNow();
              state.status.telnyxCallerIdRenderLastError = '';
              response.details = `${response.details} Persisted the same caller ID to Render env.`;
              if (payload.restartAfterUpdate) {
                const restartResult = await fireRenderRequest(
                  'POST',
                  `/services/${encodeURIComponent(String(payload.serviceId || RENDER_SERVICE_ID))}/restart`,
                );
                response.restartResult = restartResult;
                if (!restartResult.ok) {
                  response.ok = false;
                  response.details = `${response.details} Render persistence worked, but restart failed.`;
                } else {
                  response.details = `${response.details} Restart requested afterward.`;
                }
              }
            } else {
              state.status.telnyxCallerIdRenderSyncStatus = 'failed';
              state.status.telnyxCallerIdRenderLastError = renderResult.error || 'unknown error';
              response.ok = false;
              response.details = `${response.details} Render persistence failed: ${renderResult.error || 'unknown error'}`;
            }
          } else {
            state.status.telnyxCallerIdRenderSyncStatus = renderConfigured ? 'skipped' : 'not-configured';
            response.details = `${response.details} Render sync was skipped, so the env var itself was not updated.`;
          }
        }
      }
    } else {
      response.ok = false;
      response.live = true;
      response.simulated = false;
      response.details = 'Telnyx admin action is not yet mapped to a provider-safe write path in the bridge.';
    }
  } else if (task.provider === 'render') {
    response.configured = Boolean(RENDER_API_KEY && RENDER_SERVICE_ID);
    if (!response.configured) {
      response.ok = !liveExecution ? response.ok : false;
      response.details = 'Render admin credentials are not configured, so this action stayed in dry-run mode.';
    } else if (!liveExecution) {
      response.details = 'Render admin request recorded. Live provider writes remain guarded until the task runs live.';
    } else if (task.action === 'restart_service') {
      const serviceId = String(payload.serviceId || RENDER_SERVICE_ID || '').trim();
      if (!serviceId) {
        response.ok = false;
        response.details = 'Render restart requires a service ID.';
      } else {
        const restartResult = await fireRenderRequest('POST', `/services/${encodeURIComponent(serviceId)}/restart`);
        response.ok = restartResult.ok;
        response.live = true;
        response.simulated = false;
        response.restartResult = restartResult;
        response.details = restartResult.ok
          ? `Render restart requested for service ${serviceId}.`
          : restartResult.error || `Render restart failed for service ${serviceId}.`;
      }
    } else if (task.action === 'update_env_var') {
      const serviceId = String(payload.serviceId || RENDER_SERVICE_ID || '').trim();
      const assignments = payload.envAssignments && typeof payload.envAssignments === 'object' ? payload.envAssignments : {};
      const envEntries = Object.entries(assignments).filter(([key, value]) => key && value !== undefined && value !== null && value !== '');
      if (!serviceId) {
        response.ok = false;
        response.details = 'Render env updates require a service ID.';
      } else if (!envEntries.length) {
        response.ok = false;
        response.details = 'Render env updates require at least one parsed KEY=value assignment.';
      } else {
        const updates = [];
        let overallOk = true;
        for (const [key, value] of envEntries) {
          const envResult = await fireRenderRequest(
            'PUT',
            `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,
            { value: String(value) },
          );
          updates.push({
            key,
            ok: envResult.ok,
            status: envResult.status,
            error: envResult.error || '',
          });
          if (!envResult.ok) overallOk = false;
        }

        response.ok = overallOk;
        response.live = true;
        response.simulated = false;
        response.envVarUpdates = updates;
        response.details = overallOk
          ? `Updated ${updates.length} Render environment variable${updates.length === 1 ? '' : 's'} for service ${serviceId}.`
          : `Render updated ${updates.filter((item) => item.ok).length} of ${updates.length} environment variables for service ${serviceId}.`;

        if (overallOk && payload.restartAfterUpdate) {
          const restartResult = await fireRenderRequest('POST', `/services/${encodeURIComponent(serviceId)}/restart`);
          response.restartResult = restartResult;
          if (!restartResult.ok) {
            response.ok = false;
            response.details = `${response.details} Restart request failed afterward.`;
          } else {
            response.details = `${response.details} Restart requested afterward.`;
          }
        }
      }
    } else {
      response.details = 'Render admin request captured for approval-backed execution.';
    }
  } else if (task.provider === 'supabase') {
    response.configured = Boolean(DATABASE_URL);
    response.details = 'Supabase/database admin requests are staged for approval-backed execution.';
  } else if (task.provider === 'streak') {
    response.configured = Boolean(STREAK_API_KEY && STREAK_PIPELINE_KEY);
    if (task.action === 'inspect_schema') {
      const report = await inspectStreakPipelineState(payload || {});
      response.ok = true;
      response.live = true;
      response.simulated = false;
      response.report = report;
      response.details = report.readiness?.readyForPbk
        ? 'Streak pipeline is ready for PBK transition sync.'
        : 'Streak pipeline inspection completed; schema work is still needed.';
    } else if (task.action === 'bootstrap_schema') {
      if (!liveExecution) {
        response.details = response.configured
          ? 'Streak bootstrap task is queued in dry-run mode pending explicit live apply.'
          : 'Streak credentials are incomplete, so bootstrap stayed in dry-run mode.';
      } else {
        const report = payload.report || (await inspectStreakPipelineState(payload || {}));
        const plan = payload.plan || buildStreakBootstrapPlan(report);
        const applyResult = await applyStreakBootstrapPlan(plan, payload || {});
        response.ok = applyResult.ok;
        response.live = true;
        response.simulated = false;
        response.applyResult = applyResult;
        response.details = applyResult.ok
          ? 'Streak bootstrap applied successfully.'
          : `Streak bootstrap applied with ${applyResult.errors.length} issues.`;
      }
    } else {
      response.details = 'Streak admin request captured for approval-backed execution.';
    }
  } else if (task.provider === 'contract-admin') {
    response.configured = true;
    response.details = liveExecution
      ? 'Contract template command ran through the bridge execution path and was staged in the audit system.'
      : 'Contract template library update has been staged in the bridge audit system.';
  } else {
    response.details = 'Admin task captured for audit and manual execution.';
  }

  return response;
}

async function getContractTemplateLibrary() {
  const templates = [];
  try {
    const directories = await readdir(CONTRACTS_DIR, { withFileTypes: true });
    for (const entry of directories) {
      if (!entry.isDirectory()) continue;
      const templateDir = path.join(CONTRACTS_DIR, entry.name);
      const fieldsPath = path.join(templateDir, 'fields.json');
      let fields = {};
      try {
        fields = JSON.parse(await readFile(fieldsPath, 'utf8'));
      } catch {
        fields = {};
      }
      templates.push({
        id: entry.name,
        name: fields.name || entry.name,
        type: fields.type || entry.name,
        fields,
      });
    }
  } catch {
    return [];
  }
  return templates;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function buildToolingStatus() {
  const [scenario, researchJobs, mcpRegistry, dashboard] = await Promise.all([
    readJsonIfExists(META_AGENT_SCENARIO_FILE),
    readJsonIfExists(BROWSER_RESEARCH_JOBS_FILE),
    readJsonIfExists(MCP_REGISTRY_FILE),
    readJsonIfExists(OBSERVABILITY_DASHBOARD_FILE),
  ]);

  const mcpServers = mcpRegistry?.mcpServers || {};
  const browserOsRegistry = mcpServers.browseros || mcpServers.browserOs || null;
  const metricsUrl = PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/metrics`
    : `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/metrics`;

  const sections = {
    metaAgent: {
      ready: existsSync(META_AGENT_SCENARIO_FILE),
      scenarioLeads: Array.isArray(scenario?.leads) ? scenario.leads.length : 0,
      rubricVersion: scenario?.rubricVersion || null,
      note: existsSync(META_AGENT_SCENARIO_FILE)
        ? 'Scenario export is ready for LangGraph or Pydantic AI labs.'
        : 'Run npm run agent:export-scenario after seeding runtime state.',
    },
    browserOs: {
      ready: Boolean(browserOsRegistry),
      registryConfigured: Boolean(browserOsRegistry),
      endpoint: browserOsRegistry?.url || browserOsRegistry?.endpoint || BROWSEROS_MCP_URL,
      note: Boolean(browserOsRegistry)
        ? 'BrowserOS is registered and can be launched from Rex inside the Brain lane.'
        : `Register BrowserOS at ${BROWSEROS_MCP_URL} to give Rex browser-native research without leaving PBK.`,
    },
    browserResearch: {
      ready: existsSync(BROWSER_RESEARCH_JOBS_FILE),
      jobsSeeded: Array.isArray(researchJobs?.jobs) ? researchJobs.jobs.length : 0,
      targetsConfigured: existsSync(BROWSER_RESEARCH_TARGETS_FILE),
      note: existsSync(BROWSER_RESEARCH_JOBS_FILE)
        ? 'Research jobs are ready for browser-native enrichment runs.'
        : 'Run npm run research:seed-browser-jobs to generate the first queue.',
    },
    context7: {
      ready: Boolean(mcpServers.context7),
      registryConfigured: existsSync(MCP_REGISTRY_FILE),
      note: Boolean(mcpServers.context7)
        ? 'Context7 is registered in the MCP registry example.'
        : 'Add Context7 to the MCP registry to expose live library docs.',
    },
    workflowOps: {
      ready: existsSync(N8N_TOOLING_WORKFLOW_FILE),
      workflowConfigured: existsSync(N8N_TOOLING_WORKFLOW_FILE),
      note: existsSync(N8N_TOOLING_WORKFLOW_FILE)
        ? 'n8n tooling health workflow is available for import.'
        : 'Add the tooling health workflow to monitor the automation layer.',
    },
    observability: {
      ready: existsSync(OBSERVABILITY_COMPOSE_FILE) && existsSync(OBSERVABILITY_DASHBOARD_FILE),
      composeReady: existsSync(OBSERVABILITY_COMPOSE_FILE),
      generatedConfig: existsSync(OBSERVABILITY_PROM_FILE),
      dashboardPanels: Array.isArray(dashboard?.panels) ? dashboard.panels.length : 0,
      metricsUrl,
      note:
        existsSync(OBSERVABILITY_COMPOSE_FILE) && existsSync(OBSERVABILITY_DASHBOARD_FILE)
          ? 'Prometheus and Grafana assets are ready for a local observability bring-up.'
          : 'Generate monitoring config and start the observability stack.',
    },
    github: {
      ready: existsSync(TOOLING_VERIFY_WORKFLOW_FILE),
      workflowReady: existsSync(TOOLING_VERIFY_WORKFLOW_FILE),
      note: existsSync(TOOLING_VERIFY_WORKFLOW_FILE)
        ? 'GitHub Actions can validate tooling and bridge observability on deploy.'
        : 'Add a GitHub Actions workflow to validate tooling on each push.',
    },
  };

  const toolingEntries = Object.entries(sections);
  const readyCount = toolingEntries.filter(([, value]) => Boolean(value.ready)).length;

  return {
    ...sections,
    summary: {
      readyCount,
      totalCount: toolingEntries.length,
      metricsUrl,
      note: `${readyCount}/${toolingEntries.length} advanced tooling surfaces are repo-ready.`,
    },
  };
}

function buildQuotasSnapshot() {
  const todaysDocumentDeliveries = state.documentDeliveries.filter((entry) => String(entry.createdAt || '').slice(0, 10) === isoNow().slice(0, 10)).length;
  return {
    instantly: {
      configured: Boolean(INSTANTLY_API_KEY),
      senderProfiles: 2,
      suggestedRemainingDaily: INSTANTLY_API_KEY ? Math.max(0, 5000 - state.messages.filter((item) => item.channel === 'email').length) : 0,
      note: INSTANTLY_API_KEY ? 'Bridge is ready for campaign admin actions.' : 'Add PBK_INSTANTLY_API_KEY to enable live quota visibility.',
    },
    telnyx: {
      configured: Boolean(TELNYX_API_KEY),
      phoneNumbersConfigured: getEffectiveTelnyxFromNumber() ? 1 : 0,
      defaultFromNumber: getEffectiveTelnyxFromNumber(),
      activeCalls: state.calls.filter((item) => item.status === 'live').length,
      note: TELNYX_API_KEY ? 'Voice and messaging runtime is reporting locally.' : 'Add PBK_TELNYX_API_KEY and PBK_TELNYX_FROM_NUMBER for live quota visibility.',
    },
    docs: {
      deliveredToday: todaysDocumentDeliveries,
      queuedAdminTasks: state.adminTasks.filter((task) => task.status === 'pending').length,
      openContracts: state.contracts.filter((contract) => !['completed', 'void', 'rejected'].includes(String(contract.status || '').toLowerCase())).length,
    },
  };
}

function buildPrometheusMetrics() {
  const runtime = getRuntimeMeta();
  const quotas = buildQuotasSnapshot();
  const pendingApprovals = state.approvals.filter((item) => item.status === 'pending').length;
  const pendingAdminTasks = state.adminTasks.filter((item) => item.status === 'pending').length;
  const liveCalls = state.calls.filter((item) => item.status === 'live').length;
  const openContracts = quotas.docs.openContracts;
  const documentDeliveriesToday = quotas.docs.deliveredToday;
  const totalMessages = state.messages.length;
  const sourcesIndexed = state.brainDocs.length;
  const analyzeRuns = state.analyzerRuns.length;
  const providerMap = {
    telnyx: getTelnyxProviderMeta(),
    instantly: getInstantlyProviderMeta(),
    googleCalendar: getGoogleCalendarProviderMeta(),
    streak: getStreakProviderMeta(),
    crmSync: getCrmSyncProviderMeta(),
    docusign: getDocuSignProviderMeta(),
    batchdata: getBatchDataProviderMeta(),
    slack: getSlackProviderMeta(),
    render: getRenderProviderMeta(),
  };

  const lines = [
    '# HELP pbk_runtime_hosted Whether the PBK bridge is running in hosted mode.',
    '# TYPE pbk_runtime_hosted gauge',
    `pbk_runtime_hosted ${runtime.hosted ? 1 : 0}`,
    '# HELP pbk_runtime_auth_required Whether the PBK bridge requires a bearer token.',
    '# TYPE pbk_runtime_auth_required gauge',
    `pbk_runtime_auth_required ${runtime.authRequired ? 1 : 0}`,
    '# HELP pbk_runtime_production_ready Whether the runtime reports itself as production ready.',
    '# TYPE pbk_runtime_production_ready gauge',
    `pbk_runtime_production_ready ${runtime.productionReady ? 1 : 0}`,
    '# HELP pbk_approvals_pending Number of pending approval items.',
    '# TYPE pbk_approvals_pending gauge',
    `pbk_approvals_pending ${pendingApprovals}`,
    '# HELP pbk_admin_tasks_pending Number of pending Rex admin tasks.',
    '# TYPE pbk_admin_tasks_pending gauge',
    `pbk_admin_tasks_pending ${pendingAdminTasks}`,
    '# HELP pbk_calls_live Number of currently live calls.',
    '# TYPE pbk_calls_live gauge',
    `pbk_calls_live ${liveCalls}`,
    '# HELP pbk_contracts_open Number of non-terminal contracts.',
    '# TYPE pbk_contracts_open gauge',
    `pbk_contracts_open ${openContracts}`,
    '# HELP pbk_documents_delivered_today Number of seller document deliveries recorded today.',
    '# TYPE pbk_documents_delivered_today counter',
    `pbk_documents_delivered_today ${documentDeliveriesToday}`,
    '# HELP pbk_messages_total Number of messages tracked in runtime state.',
    '# TYPE pbk_messages_total gauge',
    `pbk_messages_total ${totalMessages}`,
    '# HELP pbk_brain_sources_indexed Number of indexed brain sources.',
    '# TYPE pbk_brain_sources_indexed gauge',
    `pbk_brain_sources_indexed ${sourcesIndexed}`,
    '# HELP pbk_analyzer_runs_total Number of analyzer runs tracked in runtime state.',
    '# TYPE pbk_analyzer_runs_total gauge',
    `pbk_analyzer_runs_total ${analyzeRuns}`,
  ];

  Object.entries(providerMap).forEach(([provider, meta]) => {
    lines.push(`# HELP pbk_provider_ready Whether provider ${provider} is ready.`);
    lines.push('# TYPE pbk_provider_ready gauge');
    lines.push(`pbk_provider_ready{provider="${provider}"} ${meta?.ready ? 1 : 0}`);
    lines.push(`# HELP pbk_provider_configured Whether provider ${provider} is configured.`);
    lines.push('# TYPE pbk_provider_configured gauge');
    lines.push(`pbk_provider_configured{provider="${provider}"} ${meta?.configured ? 1 : 0}`);
  });

  return `${lines.join('\n')}\n`;
}

async function fireWebhook(url, payload) {
  if (!url) return { ok: false, skipped: true };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Webhook request failed',
    };
  }
}

function encodeClientState(payload = {}) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function getTelnyxFromNumber(params = {}) {
  return normalizePhone(params.from || params.fromNumber || getEffectiveTelnyxFromNumber());
}

function getTelnyxWebhookUrl(params = {}) {
  return String(params.webhookUrl || TELNYX_WEBHOOK_URL || '').trim();
}

function extractTelnyxError(body) {
  if (!body) return 'Telnyx request failed.';
  if (typeof body === 'string') return body;
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return body.errors
      .map((item) => item?.detail || item?.title || item?.code || 'Unknown Telnyx error')
      .filter(Boolean)
      .join('; ');
  }
  if (body.error) {
    return typeof body.error === 'string' ? body.error : body.error.message || 'Telnyx request failed.';
  }
  if (body.message) return body.message;
  if (body.detail) return body.detail;
  return 'Telnyx request failed.';
}

async function fireTelnyxRequest(method, endpoint, payload, options = {}) {
  if (!TELNYX_API_KEY) {
    return {
      ok: false,
      skipped: true,
      error: 'PBK_TELNYX_API_KEY is not set.',
    };
  }

  try {
    const url = new URL(`https://api.telnyx.com/v2${endpoint}`);
    if (options.query && typeof options.query === 'object') {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (Array.isArray(value)) {
          value.forEach((item) => url.searchParams.append(key, String(item)));
          return;
        }
        url.searchParams.set(key, String(value));
      });
    }

    const response = await fetch(url, {
      method: String(method || 'POST').toUpperCase(),
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        Accept: 'application/json',
        ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
      error: response.ok ? '' : extractTelnyxError(body),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Telnyx request failed.',
    };
  }
}

async function searchAvailableTelnyxNumbers(params = {}) {
  const quantity = Number(params.quantity || 1);
  const query = {
    'filter[country_code]': params.countryCode || 'US',
    'filter[phone_number_type]': params.phoneNumberType || 'local',
    'filter[limit]': Math.max(1, Math.min(quantity, 20)),
    'filter[best_effort]': params.bestEffort === false ? 'false' : 'true',
    'filter[features]': Array.isArray(params.features) && params.features.length ? params.features : ['sms', 'emergency'],
  };
  if (params.areaCode) query['filter[national_destination_code]'] = String(params.areaCode);
  if (params.locality) query['filter[locality]'] = String(params.locality);
  if (params.administrativeArea) query['filter[administrative_area]'] = String(params.administrativeArea);

  return fireTelnyxRequest('GET', '/available_phone_numbers', undefined, { query });
}

async function orderTelnyxNumbers(params = {}) {
  const phoneNumbers = Array.isArray(params.phoneNumbers) ? params.phoneNumbers.filter(Boolean) : [];
  if (!phoneNumbers.length) {
    return {
      ok: false,
      error: 'At least one phone number is required to create a Telnyx number order.',
    };
  }

  const payload = {
    phone_numbers: phoneNumbers.map((phoneNumber) => ({ phone_number: phoneNumber })),
    ...(params.connectionId ? { connection_id: params.connectionId } : {}),
    ...(params.messagingProfileId ? { messaging_profile_id: params.messagingProfileId } : {}),
    ...(params.customerReference ? { customer_reference: params.customerReference } : {}),
  };

  return fireTelnyxRequest('POST', '/number_orders', payload);
}

async function listTelnyxPhoneNumbers(params = {}) {
  const query = {
    ...(params.phoneNumber ? { 'filter[phone_number]': params.phoneNumber } : {}),
    ...(params.countryIso ? { 'filter[country_iso_alpha2]': params.countryIso } : {}),
  };
  return fireTelnyxRequest('GET', '/phone_numbers', undefined, { query });
}

async function updateTelnyxPhoneNumber(phoneNumberId, payload = {}) {
  return fireTelnyxRequest('PATCH', `/phone_numbers/${encodeURIComponent(phoneNumberId)}`, payload);
}

// ── Slack incoming webhook ──────────────────────────────────────────────────
async function fireInstantlyRequest(endpoint, payload, options = {}) {
  if (!INSTANTLY_API_KEY) {
    return {
      ok: false,
      skipped: true,
      error: 'PBK_INSTANTLY_API_KEY is not set.',
    };
  }

  try {
    const method = String(options.method || 'POST').toUpperCase();
    const response = await fetch(`${INSTANTLY_BASE_URL}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${INSTANTLY_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
      error: response.ok ? '' : body?.message || body?.error || `Instantly returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Instantly request failed.',
    };
  }
}

async function fireRenderRequest(method, endpoint, body) {
  const providerMeta = getRenderProviderMeta();
  if (!providerMeta.ready) {
    return {
      ok: false,
      skipped: true,
      error: `Render is not configured (${providerMeta.missing.join(', ') || 'missing credentials'}).`,
    };
  }

  try {
    const response = await fetch(`${RENDER_BASE_URL}${endpoint}`, {
      method: String(method || 'GET').toUpperCase(),
      headers: {
        Authorization: `Bearer ${RENDER_API_KEY}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body: parsed,
      error: response.ok ? '' : parsed?.message || parsed?.error || `Render returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Render request failed.',
    };
  }
}

const streakCache = {
  stages: { fetchedAt: 0, items: [] },
  fields: { fetchedAt: 0, items: [] },
};

function getStreakAuthHeader() {
  return `Basic ${Buffer.from(`${STREAK_API_KEY}:`, 'utf8').toString('base64')}`;
}

async function fireStreakRequest(method, endpoint, { body, form, query } = {}) {
  const providerMeta = getStreakProviderMeta();
  if (!providerMeta.ready) {
    return {
      ok: false,
      skipped: true,
      error: `Streak is not configured (${providerMeta.missing.join(', ') || 'missing credentials'}).`,
    };
  }

  const url = new URL(`${STREAK_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }

  try {
    const headers = {
      Authorization: getStreakAuthHeader(),
      Accept: 'application/json',
    };
    let requestBody = undefined;
    if (form && typeof form === 'object') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      Object.entries(form).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        params.append(key, String(value));
      });
      requestBody = params.toString();
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    const response = await fetch(url, {
      method,
      headers,
      ...(requestBody !== undefined ? { body: requestBody } : {}),
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body: parsed,
      error: response.ok ? '' : parsed?.message || parsed?.error || `Streak returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Streak request failed.',
    };
  }
}

function extractStreakCollection(body, keys = []) {
  for (const key of keys) {
    const value = body?.[key];
    if (Array.isArray(value)) return value;
  }
  if (Array.isArray(body)) return body;
  if (body?.results && typeof body.results === 'object') {
    for (const key of keys) {
      const value = body.results?.[key];
      if (Array.isArray(value)) return value;
    }
  }
  if (body?.data && typeof body.data === 'object') {
    for (const key of keys) {
      const value = body.data?.[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function getStreakBoxKey(box = {}) {
  return String(box.boxKey || box.key || box.id || '').trim();
}

function getStreakStageKey(stage = {}) {
  return String(stage.stageKey || stage.key || stage.id || '').trim();
}

function getStreakStageName(stage = {}) {
  return String(stage.name || stage.stageName || stage.label || '').trim();
}

async function listStreakPipelineStages({ force = false } = {}) {
  const now = Date.now();
  if (!force && streakCache.stages.items.length > 0 && now - streakCache.stages.fetchedAt < 5 * 60 * 1000) {
    return { ok: true, stages: streakCache.stages.items, cached: true };
  }
  const response = await fireStreakRequest('GET', `/v1/pipelines/${encodeURIComponent(STREAK_PIPELINE_KEY)}/stages`);
  if (!response.ok) {
    return {
      ...response,
      stages: [],
    };
  }
  const stages = extractStreakCollection(response.body, ['stages']);
  streakCache.stages = {
    fetchedAt: now,
    items: stages,
  };
  return {
    ...response,
    stages,
  };
}

async function listStreakPipelineFields({ force = false } = {}) {
  const now = Date.now();
  if (!force && streakCache.fields.items.length > 0 && now - streakCache.fields.fetchedAt < 5 * 60 * 1000) {
    return { ok: true, fields: streakCache.fields.items, cached: true };
  }
  const response = await fireStreakRequest('GET', `/v1/pipelines/${encodeURIComponent(STREAK_PIPELINE_KEY)}/fields`);
  if (!response.ok) {
    return {
      ...response,
      fields: [],
    };
  }
  const fields = extractStreakCollection(response.body, ['fields']);
  streakCache.fields = {
    fetchedAt: now,
    items: fields,
  };
  return {
    ...response,
    fields,
  };
}

function buildStreakStageCandidates(stage = '') {
  const normalized = normalizeStageToken(stage);
  const readable = toReadableStageName(stage);
  const candidates = [stage, normalized, readable];
  if (normalized === 'booking-requested') candidates.push('Booking Requested');
  if (normalized === 'manual-review') candidates.push('Manual Review');
  if (normalized === 'dnc') candidates.push('DNC');
  return [...new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean))];
}

function resolveStreakStagePreference(stage = '') {
  const map = getRuntimeStreakStageMap();
  const normalized = normalizeStageToken(stage);
  const entry = map[stage] ?? map[normalized] ?? map[toReadableStageName(stage)] ?? null;
  if (!entry) return { stageKey: '', stageName: '' };
  if (typeof entry === 'string') {
    if (/^[a-z0-9_-]{6,}$/i.test(entry) && !/\s/.test(entry)) {
      return { stageKey: entry, stageName: '' };
    }
    return { stageKey: '', stageName: String(entry).trim() };
  }
  if (entry && typeof entry === 'object') {
    return {
      stageKey: String(entry.stageKey || entry.key || '').trim(),
      stageName: String(entry.stageName || entry.name || '').trim(),
    };
  }
  return { stageKey: '', stageName: '' };
}

async function resolveStreakStage(stage = '') {
  const preferred = resolveStreakStagePreference(stage);
  const response = await listStreakPipelineStages();
  if (!response.ok) {
    return {
      ...response,
      stageKey: preferred.stageKey || '',
      stageName: preferred.stageName || '',
      matched: false,
    };
  }
  const stages = response.stages || [];
  if (preferred.stageKey) {
    const exact = stages.find((item) => getStreakStageKey(item) === preferred.stageKey);
    if (exact) {
      return {
        ok: true,
        stageKey: getStreakStageKey(exact),
        stageName: getStreakStageName(exact),
        matched: true,
      };
    }
  }
  const candidates = [...buildStreakStageCandidates(stage), preferred.stageName].filter(Boolean);
  const normalizedCandidates = candidates.map((item) => normalizeStageToken(item));
  const match = stages.find((item) => normalizedCandidates.includes(normalizeStageToken(getStreakStageName(item))));
  if (match) {
    return {
      ok: true,
      stageKey: getStreakStageKey(match),
      stageName: getStreakStageName(match),
      matched: true,
    };
  }
  return {
    ok: true,
    stageKey: preferred.stageKey || '',
    stageName: preferred.stageName || toReadableStageName(stage),
    matched: false,
    warning: `No Streak stage match found for ${stage}.`,
  };
}

function buildStreakBoxName(payload = {}) {
  const lead = payload.lead || {};
  const transition = payload.transition || {};
  return String(lead.address || transition.address || lead.leadName || transition.leadName || 'PBK Lead').trim();
}

function buildStreakTransitionNotes(payload = {}) {
  const lead = payload.lead || {};
  const transition = payload.transition || {};
  const reply = payload.reply || {};
  const lines = [
    `PBK lead sync`,
    `Lead: ${lead.leadName || transition.leadName || 'Unknown lead'}`,
    `Address: ${lead.address || transition.address || 'Unknown property'}`,
    `Stage: ${transition.fromStage || 'unknown'} -> ${transition.toStage || 'unknown'}`,
    `Intent: ${transition.intent || reply.intent || 'unknown'}`,
    transition.requestedWindow ? `Requested window: ${transition.requestedWindow}` : '',
    transition.replyPreview ? `Reply: ${transition.replyPreview}` : '',
    `Updated: ${transition.createdAt || isoNow()}`,
  ].filter(Boolean);
  return lines.join('\n');
}

function buildStreakLogicalFieldValues(payload = {}) {
  const lead = payload.lead || {};
  const transition = payload.transition || {};
  return {
    leadId: lead.leadId || transition.leadId || '',
    leadName: lead.leadName || transition.leadName || '',
    address: lead.address || transition.address || '',
    email: lead.email || '',
    phone: lead.phone || '',
    stage: transition.toStage || '',
    previousStage: transition.fromStage || '',
    intent: transition.intent || '',
    temperature: transition.temperature || '',
    requestedWindow: transition.requestedWindow || '',
    replyPreview: transition.replyPreview || '',
    appointmentId: transition.appointmentId || '',
    approvalId: transition.approvalId || '',
    callId: transition.callId || '',
    followUpTemplateKey: transition.followUpTemplateKey || '',
    followUpStatus: transition.followUpStatus || '',
    calendarEventId: transition.calendarEventId || '',
    calendarSyncStatus: transition.calendarSyncStatus || '',
    updatedAt: transition.createdAt || isoNow(),
  };
}

const EXPECTED_STREAK_STAGES = [
  'cold',
  'warm',
  'booking-requested',
  'booked',
  'hot',
  'manual-review',
  'archived',
  'dnc',
];

const EXPECTED_STREAK_FIELD_KEYS = Object.freeze([
  'leadId',
  'leadName',
  'address',
  'email',
  'phone',
  'stage',
  'previousStage',
  'intent',
  'temperature',
  'requestedWindow',
  'replyPreview',
  'appointmentId',
  'approvalId',
  'callId',
  'followUpTemplateKey',
  'followUpStatus',
  'calendarEventId',
  'calendarSyncStatus',
  'updatedAt',
]);

const STREAK_FIELD_BLUEPRINTS = Object.freeze({
  leadId: { name: 'PBK Lead ID', type: 'TEXT_INPUT' },
  leadName: { name: 'PBK Lead Name', type: 'TEXT_INPUT' },
  address: { name: 'PBK Property Address', type: 'TEXT_INPUT' },
  email: { name: 'PBK Seller Email', type: 'TEXT_INPUT' },
  phone: { name: 'PBK Seller Phone', type: 'TEXT_INPUT' },
  stage: { name: 'PBK Stage', type: 'TEXT_INPUT' },
  previousStage: { name: 'PBK Previous Stage', type: 'TEXT_INPUT' },
  intent: { name: 'PBK Reply Intent', type: 'TEXT_INPUT' },
  temperature: { name: 'PBK Reply Temperature', type: 'TEXT_INPUT' },
  requestedWindow: { name: 'PBK Requested Window', type: 'TEXT_INPUT' },
  replyPreview: { name: 'PBK Reply Preview', type: 'TEXT_INPUT' },
  appointmentId: { name: 'PBK Appointment ID', type: 'TEXT_INPUT' },
  approvalId: { name: 'PBK Approval ID', type: 'TEXT_INPUT' },
  callId: { name: 'PBK Call ID', type: 'TEXT_INPUT' },
  followUpTemplateKey: { name: 'PBK Follow-up Template', type: 'TEXT_INPUT' },
  followUpStatus: { name: 'PBK Follow-up Status', type: 'TEXT_INPUT' },
  calendarEventId: { name: 'PBK Calendar Event ID', type: 'TEXT_INPUT' },
  calendarSyncStatus: { name: 'PBK Calendar Sync Status', type: 'TEXT_INPUT' },
  updatedAt: { name: 'PBK Updated At', type: 'TEXT_INPUT' },
});

function getRuntimeStreakStageMap() {
  return {
    ...(state?.status?.streakStageMap || {}),
    ...parseJsonObjectEnv(STREAK_STAGE_MAP_RAW),
  };
}

function getRuntimeStreakFieldMap() {
  return {
    ...(state?.status?.streakFieldMap || {}),
    ...parseJsonObjectEnv(STREAK_FIELD_MAP_RAW),
  };
}

async function inspectStreakPipelineState(params = {}) {
  const provider = getStreakProviderMeta();
  const refresh = Boolean(params.refresh);
  const stageMap = getRuntimeStreakStageMap();
  const fieldMap = getRuntimeStreakFieldMap();
  const expectedStages = Array.isArray(params.expectedStages) && params.expectedStages.length
    ? params.expectedStages.map((item) => String(item || '').trim()).filter(Boolean)
    : EXPECTED_STREAK_STAGES;

  const stagesResponse = provider.ready ? await listStreakPipelineStages({ force: refresh }) : { ok: false, skipped: true, stages: [] };
  const fieldsResponse = provider.ready ? await listStreakPipelineFields({ force: refresh }) : { ok: false, skipped: true, fields: [] };
  const availableStages = Array.isArray(stagesResponse.stages) ? stagesResponse.stages : [];
  const availableFields = Array.isArray(fieldsResponse.fields) ? fieldsResponse.fields : [];
  const availableFieldKeys = availableFields.map((field) => String(field.fieldKey || field.key || '').trim()).filter(Boolean);

  const stageMappings = [];
  for (const stage of expectedStages) {
    const resolution = provider.ready
      ? await resolveStreakStage(stage)
      : {
        ok: false,
        stageKey: '',
        stageName: '',
        matched: false,
        warning: 'Streak provider is not fully configured.',
      };
    stageMappings.push({
      requestedStage: stage,
      requestedLabel: toReadableStageName(stage),
      matched: Boolean(resolution?.matched),
      stageKey: resolution?.stageKey || '',
      stageName: resolution?.stageName || '',
      warning: resolution?.warning || '',
    });
  }

  const fieldMappings = EXPECTED_STREAK_FIELD_KEYS.map((logicalKey) => {
    const config = fieldMap[logicalKey];
    const configuredFieldKey =
      typeof config === 'string'
        ? String(config).trim()
        : String(config?.fieldKey || config?.key || '').trim();
    const blueprint = STREAK_FIELD_BLUEPRINTS[logicalKey] || null;
    const matchedField = blueprint
      ? availableFields.find((field) => String(field.name || field.label || '').trim().toLowerCase() === String(blueprint.name || '').trim().toLowerCase())
      : null;
    const detectedFieldKey = String(matchedField?.fieldKey || matchedField?.key || '').trim();
    return {
      logicalKey,
      configuredFieldKey,
      detectedFieldKey,
      mapped: Boolean(configuredFieldKey),
      presentInPipeline: configuredFieldKey ? availableFieldKeys.includes(configuredFieldKey) : Boolean(detectedFieldKey),
    };
  });

  const missingStageMappings = stageMappings.filter((item) => !item.matched).map((item) => item.requestedStage);
  const missingFieldMappings = fieldMappings.filter((item) => !item.mapped || !item.presentInPipeline).map((item) => item.logicalKey);

  return {
    ok: provider.ready ? Boolean(stagesResponse.ok && fieldsResponse.ok) : false,
    provider,
    pipeline: {
      key: STREAK_PIPELINE_KEY,
      baseUrl: STREAK_BASE_URL,
      autoCreateBox: STREAK_AUTO_CREATE_BOX,
    },
    stageMap,
    fieldMap,
    stageMappings,
    fieldMappings,
    availableStages: availableStages.map((stage) => ({
      stageKey: getStreakStageKey(stage),
      name: getStreakStageName(stage),
    })),
    availableFields: availableFields.map((field) => ({
      fieldKey: String(field.fieldKey || field.key || '').trim(),
      name: String(field.name || field.label || '').trim(),
      type: String(field.type || field.dataType || '').trim(),
    })),
    readiness: {
      providerReady: provider.ready,
      stagesLoaded: Boolean(stagesResponse.ok),
      fieldsLoaded: Boolean(fieldsResponse.ok),
      missingStageMappings,
      missingFieldMappings,
      readyForPbk: provider.ready && missingStageMappings.length === 0 && missingFieldMappings.length === 0,
    },
    errors: {
      stages: stagesResponse.ok || stagesResponse.skipped ? '' : stagesResponse.error || '',
      fields: fieldsResponse.ok || fieldsResponse.skipped ? '' : fieldsResponse.error || '',
    },
  };
}

function buildStreakBootstrapPlan(report = {}) {
  const stageActions = (report.stageMappings || [])
    .filter((item) => !item.matched)
    .map((item) => ({
      type: 'create_stage',
      requestedStage: item.requestedStage,
      stageName: item.requestedLabel || toReadableStageName(item.requestedStage),
      description: `Create Streak stage "${item.requestedLabel || toReadableStageName(item.requestedStage)}".`,
    }));

  const fieldActions = (report.fieldMappings || [])
    .filter((item) => !item.mapped || !item.presentInPipeline)
    .map((item) => {
      const blueprint = STREAK_FIELD_BLUEPRINTS[item.logicalKey] || {
        name: `PBK ${item.logicalKey}`,
        type: 'TEXT_INPUT',
      };
      if (item.presentInPipeline && item.detectedFieldKey) {
        return {
          type: 'map_field',
          logicalKey: item.logicalKey,
          fieldName: blueprint.name,
          fieldType: blueprint.type,
          fieldKey: item.detectedFieldKey,
          description: `Map logical field "${item.logicalKey}" to existing Streak field "${blueprint.name}".`,
        };
      }
      return {
        type: 'create_field',
        logicalKey: item.logicalKey,
        fieldName: blueprint.name,
        fieldType: blueprint.type,
        configuredFieldKey: item.configuredFieldKey || '',
        description: `Create Streak field "${blueprint.name}" (${blueprint.type}).`,
      };
    });

  const suggestedStageMap = {};
  (report.stageMappings || []).forEach((item) => {
    if (item.stageKey) suggestedStageMap[item.requestedStage] = item.stageKey;
  });

  const suggestedFieldMap = {};
  (report.fieldMappings || []).forEach((item) => {
    if (item.configuredFieldKey && item.presentInPipeline) suggestedFieldMap[item.logicalKey] = item.configuredFieldKey;
    else if (item.detectedFieldKey && item.presentInPipeline) suggestedFieldMap[item.logicalKey] = item.detectedFieldKey;
  });
  fieldActions.forEach((item) => {
    if (item.type === 'map_field' && item.fieldKey) suggestedFieldMap[item.logicalKey] = item.fieldKey;
    else if (!suggestedFieldMap[item.logicalKey]) suggestedFieldMap[item.logicalKey] = { name: item.fieldName, type: item.fieldType };
  });

  return {
    ok: true,
    pipelineKey: report.pipeline?.key || '',
    stageActions,
    fieldActions,
    actions: [...stageActions, ...fieldActions],
    suggestedStageMap,
    suggestedFieldMap,
    readyToApply: Boolean(report.provider?.ready),
  };
}

async function createStreakStage(name = '') {
  return fireStreakRequest('PUT', `/v1/pipelines/${encodeURIComponent(STREAK_PIPELINE_KEY)}/stages`, {
    form: { name },
  });
}

async function createStreakField(name = '', type = 'TEXT_INPUT') {
  return fireStreakRequest('PUT', `/v1/pipelines/${encodeURIComponent(STREAK_PIPELINE_KEY)}/fields`, {
    form: { name, type },
  });
}

async function applyStreakBootstrapPlan(plan = {}, params = {}) {
  const stageMapPatch = {};
  const fieldMapPatch = {};
  const createdStages = [];
  const createdFields = [];
  const mappedFields = [];
  const errors = [];

  for (const action of plan.stageActions || []) {
    const result = await createStreakStage(action.stageName);
    if (!result.ok) {
      errors.push({
        action,
        error: result.error || `Failed to create stage ${action.stageName}.`,
      });
      continue;
    }
    const stageKey = getStreakStageKey(result.body);
    if (stageKey) {
      stageMapPatch[action.requestedStage] = stageKey;
    }
    createdStages.push({
      requestedStage: action.requestedStage,
      stageName: action.stageName,
      stageKey,
    });
  }

  for (const action of plan.fieldActions || []) {
    if (action.type === 'map_field') {
      if (action.fieldKey) {
        fieldMapPatch[action.logicalKey] = action.fieldKey;
        mappedFields.push({
          logicalKey: action.logicalKey,
          fieldName: action.fieldName,
          fieldKey: action.fieldKey,
        });
      }
      continue;
    }
    const result = await createStreakField(action.fieldName, action.fieldType);
    if (!result.ok) {
      errors.push({
        action,
        error: result.error || `Failed to create field ${action.fieldName}.`,
      });
      continue;
    }
    const fieldKey = String(result.body?.fieldKey || result.body?.key || '').trim();
    if (fieldKey) {
      fieldMapPatch[action.logicalKey] = fieldKey;
    }
    createdFields.push({
      logicalKey: action.logicalKey,
      fieldName: action.fieldName,
      fieldKey,
      fieldType: action.fieldType,
    });
  }

  state.status.streakStageMap = {
    ...(state.status.streakStageMap || {}),
    ...plan.suggestedStageMap,
    ...stageMapPatch,
  };
  state.status.streakFieldMap = {
    ...(state.status.streakFieldMap || {}),
    ...Object.fromEntries(
      Object.entries(plan.suggestedFieldMap || {}).filter(([, value]) => typeof value === 'string' && String(value).trim()),
    ),
    ...fieldMapPatch,
  };
  state.status.lastStreakBootstrapAt = isoNow();
  streakCache.stages = { fetchedAt: 0, items: [] };
  streakCache.fields = { fetchedAt: 0, items: [] };

  const inspection = await inspectStreakPipelineState({
    refresh: true,
    expectedStages: params.expectedStages,
  });

  return {
    ok: errors.length === 0,
    createdStages,
    createdFields,
    mappedFields,
    stageMapPatch,
    fieldMapPatch,
    errors,
    inspection,
  };
}

async function buildStreakFieldUpdates(payload = {}) {
  const fieldMap = getRuntimeStreakFieldMap();
  const logicalValues = buildStreakLogicalFieldValues(payload);
  if (!Object.keys(fieldMap).length) {
    return { ok: true, fields: {}, used: [] };
  }
  const response = await listStreakPipelineFields();
  if (!response.ok) {
    return {
      ...response,
      fields: {},
      used: [],
    };
  }
  const availableFields = response.fields || [];
  const fields = {};
  const used = [];
  for (const [logicalKey, config] of Object.entries(fieldMap)) {
    const rawValue = logicalValues[logicalKey];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const desiredFieldKey =
      typeof config === 'string'
        ? String(config).trim()
        : String(config?.fieldKey || config?.key || '').trim();
    if (!desiredFieldKey) continue;
    const exists = availableFields.find((item) => String(item.fieldKey || item.key || '').trim() === desiredFieldKey);
    if (!exists) continue;
    fields[desiredFieldKey] = rawValue;
    used.push(logicalKey);
  }
  return {
    ok: true,
    fields,
    used,
  };
}

function extractStreakSearchBoxes(body) {
  const candidates = [];
  const add = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => candidates.push(item));
  };
  add(body?.boxes);
  add(body?.results?.boxes);
  add(body?.data?.boxes);
  add(body?.results);
  add(Array.isArray(body) ? body : []);
  return candidates.filter((item) => getStreakBoxKey(item));
}

async function findStreakBoxByName(name = '') {
  if (!name) return { ok: true, box: null, searched: false };
  const response = await fireStreakRequest('GET', '/v1/search', {
    query: {
      name,
      pipelineKey: STREAK_PIPELINE_KEY,
    },
  });
  if (!response.ok) {
    return {
      ...response,
      box: null,
    };
  }
  const boxes = extractStreakSearchBoxes(response.body);
  return {
    ...response,
    box: boxes[0] || null,
    searched: true,
  };
}

async function createStreakBox(payload = {}) {
  const boxName = buildStreakBoxName(payload);
  const response = await fireStreakRequest('POST', `/v2/pipelines/${encodeURIComponent(STREAK_PIPELINE_KEY)}/boxes`, {
    body: {
      name: boxName,
    },
  });
  return {
    ...response,
    box: response.body,
    boxKey: getStreakBoxKey(response.body),
  };
}

async function syncTransitionToStreak(payload = {}) {
  const providerMeta = getStreakProviderMeta();
  if (!providerMeta.ready) {
    return {
      ok: false,
      skipped: true,
      provider: 'streak',
      error: `Streak is not configured (${providerMeta.missing.join(', ') || 'missing credentials'}).`,
    };
  }

  const transition = payload.transition || {};
  const lead = payload.lead || {};
  const leadImport = findLatestLeadImport({
    leadId: lead.leadId || transition.leadId || '',
    address: lead.address || transition.address || '',
    leadName: lead.leadName || transition.leadName || '',
    email: lead.email || '',
  });
  const desiredName = buildStreakBoxName(payload);
  const knownBoxKey = String(
    transition.crmEntityId ||
      lead.streakBoxKey ||
      leadImport?.streakBoxKey ||
      leadImport?.crmEntityId ||
      '',
  ).trim();
  const stageResolution = await resolveStreakStage(transition.toStage || '');
  const fieldResolution = await buildStreakFieldUpdates(payload);
  const notes = buildStreakTransitionNotes(payload);

  let boxKey = knownBoxKey;
  let created = false;
  let searched = false;

  if (!boxKey) {
    const searchResult = await findStreakBoxByName(desiredName);
    searched = Boolean(searchResult.searched);
    if (searchResult.ok && searchResult.box) {
      boxKey = getStreakBoxKey(searchResult.box);
    } else if (!searchResult.ok && !searchResult.skipped) {
      return {
        ...searchResult,
        provider: 'streak',
      };
    }
  }

  if (!boxKey && STREAK_AUTO_CREATE_BOX) {
    const createResult = await createStreakBox(payload);
    if (!createResult.ok) {
      return {
        ...createResult,
        provider: 'streak',
      };
    }
    boxKey = createResult.boxKey;
    created = true;
  }

  if (!boxKey) {
    return {
      ok: false,
      provider: 'streak',
      skipped: true,
      error: 'No Streak box could be resolved for this lead, and auto-create is disabled.',
    };
  }

  const updatePayload = {
    name: desiredName,
    notes,
    ...(stageResolution.stageKey ? { stageKey: stageResolution.stageKey } : {}),
    ...(Object.keys(fieldResolution.fields || {}).length ? { fields: fieldResolution.fields } : {}),
  };
  const updateResult = await fireStreakRequest('POST', `/v1/boxes/${encodeURIComponent(boxKey)}`, {
    body: updatePayload,
  });
  return {
    ...updateResult,
    provider: 'streak',
    boxKey,
    boxName: desiredName,
    pipelineKey: STREAK_PIPELINE_KEY,
    stageKey: stageResolution.stageKey || '',
    stageName: stageResolution.stageName || '',
    created,
    searched,
    fieldKeysUpdated: Object.keys(fieldResolution.fields || {}),
    fieldNamesUpdated: fieldResolution.used || [],
    warning: stageResolution.warning || '',
  };
}

function getSlackProviderMeta() {
  return {
    configured: Boolean(SLACK_WEBHOOK_URL),
    ready: Boolean(SLACK_WEBHOOK_URL),
    missing: SLACK_WEBHOOK_URL ? [] : ['PBK_SLACK_WEBHOOK_URL'],
  };
}

function getGoogleCalendarProviderMeta() {
  const missing = [];
  if (!GOOGLE_CALENDAR_ACCESS_TOKEN && !CALENDAR_SYNC_WEBHOOK_URL) {
    missing.push('PBK_GOOGLE_CALENDAR_ACCESS_TOKEN or PBK_CALENDAR_SYNC_WEBHOOK');
  }
  return {
    configured: Boolean(GOOGLE_CALENDAR_ACCESS_TOKEN || CALENDAR_SYNC_WEBHOOK_URL),
    ready: Boolean(GOOGLE_CALENDAR_ACCESS_TOKEN || CALENDAR_SYNC_WEBHOOK_URL),
    calendarId: GOOGLE_CALENDAR_ID,
    mode: GOOGLE_CALENDAR_ACCESS_TOKEN ? 'google-rest' : CALENDAR_SYNC_WEBHOOK_URL ? 'webhook' : 'disabled',
    missing,
  };
}

function getStreakProviderMeta() {
  const missing = [];
  if (!STREAK_API_KEY) missing.push('PBK_STREAK_API_KEY');
  if (!STREAK_PIPELINE_KEY) missing.push('PBK_STREAK_PIPELINE_KEY');
  return {
    configured: Boolean(STREAK_API_KEY || STREAK_PIPELINE_KEY),
    ready: missing.length === 0,
    baseUrl: STREAK_BASE_URL,
    pipelineKey: STREAK_PIPELINE_KEY,
    autoCreateBox: STREAK_AUTO_CREATE_BOX,
    missing,
  };
}

function getCrmSyncProviderMeta() {
  const streak = getStreakProviderMeta();
  if (streak.ready) {
    return {
      configured: true,
      ready: true,
      mode: 'streak',
      pipelineKey: streak.pipelineKey,
      missing: [],
    };
  }
  if (streak.configured) {
    return {
      configured: true,
      ready: false,
      mode: 'streak',
      pipelineKey: streak.pipelineKey,
      missing: streak.missing,
    };
  }
  return {
    configured: Boolean(CRM_SYNC_WEBHOOK_URL),
    ready: Boolean(CRM_SYNC_WEBHOOK_URL),
    mode: CRM_SYNC_WEBHOOK_URL ? 'webhook' : 'disabled',
    missing: CRM_SYNC_WEBHOOK_URL ? [] : ['PBK_CRM_SYNC_WEBHOOK'],
  };
}

function getInstantlyProviderMeta() {
  return {
    configured: Boolean(INSTANTLY_API_KEY),
    ready: Boolean(INSTANTLY_API_KEY),
    baseUrl: INSTANTLY_BASE_URL,
    warmupEndpoint: INSTANTLY_WARMUP_ENABLE_ENDPOINT,
    domainOrderEndpoint: INSTANTLY_DOMAIN_ORDER_ENDPOINT,
    missing: INSTANTLY_API_KEY ? [] : ['PBK_INSTANTLY_API_KEY'],
  };
}

function getRenderProviderMeta() {
  const missing = [];
  if (!RENDER_API_KEY) missing.push('PBK_RENDER_API_KEY');
  if (!RENDER_SERVICE_ID) missing.push('PBK_RENDER_SERVICE_ID');
  return {
    configured: missing.length === 0,
    ready: missing.length === 0,
    baseUrl: RENDER_BASE_URL,
    serviceId: RENDER_SERVICE_ID || '',
    missing,
  };
}

async function fireSlackWebhook(payload) {
  if (!SLACK_WEBHOOK_URL) {
    return { ok: false, skipped: true, error: 'PBK_SLACK_WEBHOOK_URL is not set.' };
  }
  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: text,
      error: response.ok ? '' : (text || `Slack webhook returned ${response.status}`),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Slack webhook failed.' };
  }
}

// ── BatchData skip-trace ────────────────────────────────────────────────────
async function syncCalendarEvent(event = {}) {
  const providerMeta = getGoogleCalendarProviderMeta();
  if (!providerMeta.ready) {
    return {
      ok: false,
      skipped: true,
      error: 'Google Calendar sync is not configured.',
      provider: providerMeta.mode,
    };
  }

  if (GOOGLE_CALENDAR_ACCESS_TOKEN) {
    try {
      const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GOOGLE_CALENDAR_ACCESS_TOKEN}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: event.title || event.summary || 'PBK seller call',
          description: event.description || event.notes || '',
          location: event.location || '',
          start: {
            dateTime: event.startTime,
            timeZone: event.timezone || DEFAULT_LEAD_TIMEZONE,
          },
          end: {
            dateTime: event.endTime,
            timeZone: event.timezone || DEFAULT_LEAD_TIMEZONE,
          },
          attendees: Array.isArray(event.attendees)
            ? event.attendees.filter(Boolean).map((email) => ({ email }))
            : [],
          transparency: event.transparency || 'opaque',
        }),
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!response.ok) {
        return {
          ok: false,
          provider: 'google-rest',
          status: response.status,
          error: body?.error?.message || body?.message || `Google Calendar returned ${response.status}`,
          body,
        };
      }
      return {
        ok: true,
        provider: 'google-rest',
        status: response.status,
        event: {
          id: body?.id || '',
          htmlLink: body?.htmlLink || '',
          status: body?.status || 'confirmed',
        },
        body,
      };
    } catch (error) {
      return {
        ok: false,
        provider: 'google-rest',
        error: error instanceof Error ? error.message : 'Google Calendar sync failed.',
      };
    }
  }

  try {
    const response = await fetch(CALENDAR_SYNC_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return {
      ok: response.ok,
      provider: 'webhook',
      status: response.status,
      event: body?.event || null,
      body,
      error: response.ok ? '' : body?.message || body?.error || `Calendar webhook returned ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'webhook',
      error: error instanceof Error ? error.message : 'Calendar webhook sync failed.',
    };
  }
}

async function syncCrmTransition(payload = {}) {
  const streakMeta = getStreakProviderMeta();
  if (streakMeta.ready) {
    const streakResult = await syncTransitionToStreak(payload);
    if (streakResult.ok || !CRM_SYNC_WEBHOOK_URL) {
      return streakResult;
    }
    const fallback = await fireWebhook(CRM_SYNC_WEBHOOK_URL, payload);
    return {
      ...fallback,
      provider: 'crm-webhook',
      fallbackFrom: 'streak',
      upstream: streakResult,
      error: fallback.ok ? '' : fallback.error || streakResult.error || 'CRM webhook fallback failed.',
    };
  }

  if (!CRM_SYNC_WEBHOOK_URL) {
    return {
      ok: false,
      skipped: true,
      provider: 'crm-webhook',
      error: 'PBK_CRM_SYNC_WEBHOOK is not set.',
    };
  }
  const response = await fireWebhook(CRM_SYNC_WEBHOOK_URL, payload);
  return {
    ...response,
    provider: 'crm-webhook',
  };
}

function getBatchDataProviderMeta() {
  return {
    configured: Boolean(BATCHDATA_API_KEY),
    ready: Boolean(BATCHDATA_API_KEY),
    missing: BATCHDATA_API_KEY ? [] : ['PBK_BATCHDATA_API_KEY'],
  };
}

async function fireBatchDataSkipTrace(params = {}) {
  if (!BATCHDATA_API_KEY) {
    return { ok: false, skipped: true, error: 'PBK_BATCHDATA_API_KEY is not set.' };
  }
  const requestPayload = {
    requests: [
      {
        propertyAddress: {
          street: params.address || params.street || '',
          city: params.city || '',
          state: params.state || '',
          zip: params.zip || params.zipCode || '',
        },
        ...(params.firstName ? { name: { first: params.firstName, last: params.lastName || '' } } : {}),
      },
    ],
  };
  try {
    const response = await fetch(`${BATCHDATA_BASE_URL}/api/v1/property/skip-trace`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BATCHDATA_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      return { ok: false, status: response.status, body, error: body?.error || body?.message || `BatchData returned ${response.status}` };
    }
    const persons = body?.results?.persons || body?.results?.[0]?.persons || [];
    const primary = persons[0] || {};
    const phones = (primary.phoneNumbers || []).map((p) => ({ phone: p.number || p.phone, type: p.type, score: p.score }));
    const emails = (primary.emails || []).map((e) => ({ email: e.email || e.value, score: e.score }));
    return {
      ok: true,
      status: response.status,
      body,
      contact: {
        name: [primary.firstName, primary.lastName].filter(Boolean).join(' ') || undefined,
        phone: phones[0]?.phone || '',
        email: emails[0]?.email || '',
        phones,
        emails,
        confidence: primary.confidence || phones[0]?.score || null,
        source: 'batchdata',
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'BatchData request failed.' };
  }
}

let __docusignAccessToken = null;
let __docusignAccessTokenExpiresAt = 0;

function getDocuSignProviderMeta() {
  return buildDocuSignProviderStatus();
}

function __dsBase64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function __dsBuildJwt() {
  const meta = getDocuSignProviderMeta();
  if (!meta.ready) {
    throw new Error(meta.summary || `DocuSign env not fully set: missing ${meta.missing.join(', ')}`);
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: DOCUSIGN_INTEGRATION_KEY,
    sub: DOCUSIGN_USER_ID,
    aud: DOCUSIGN_AUTH_HOST,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  };
  const headerB64 = __dsBase64UrlEncode(JSON.stringify(header));
  const payloadB64 = __dsBase64UrlEncode(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;
  const signer = __dsCreateSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const sigBuf = signer.sign(DOCUSIGN_PRIVATE_KEY_MATERIAL.keyObject);
  const sigB64 = sigBuf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sigB64}`;
}

async function __dsRefreshAccessToken() {
  const meta = getDocuSignProviderMeta();
  if (!meta.ready) {
    throw new Error(meta.summary || `DocuSign env not fully set: missing ${meta.missing.join(', ')}`);
  }
  const jwt = __dsBuildJwt();
  const response = await fetch(`https://${DOCUSIGN_AUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const reason = body?.error_description || body?.error || `DocuSign auth returned ${response.status}`;
    throw new Error(`DocuSign JWT auth failed: ${reason}`);
  }
  __docusignAccessToken = body.access_token;
  __docusignAccessTokenExpiresAt = Date.now() + (toNumber(body.expires_in, 3600) - 60) * 1000;
  return __docusignAccessToken;
}

async function __dsAccessToken() {
  if (__docusignAccessToken && Date.now() < __docusignAccessTokenExpiresAt) {
    return __docusignAccessToken;
  }
  return __dsRefreshAccessToken();
}

async function fireDocuSignEnvelope(params = {}) {
  const meta = getDocuSignProviderMeta();
  if (!meta.ready) {
    return { ok: false, skipped: true, error: meta.summary || `DocuSign env not fully set: missing ${meta.missing.join(', ')}` };
  }
  let token;
  try {
    token = await __dsAccessToken();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'DocuSign auth failed.' };
  }

  let documentBase64 = params.documentBase64 || '';
  if (!documentBase64) {
    try {
      const pdfBuffer = await generatePdfDocument({
        documentTitle: params.documentTitle || `${params.template || 'Assignment'} - ${params.address || params.leadName || 'PBK contract'}`,
        propertyAddress: params.address || '',
        leadName: params.leadName || '',
        amount: params.amount,
        selectedPathLabel: params.template || 'assignment',
        previewOrigin: params.previewOrigin || DEFAULT_PREVIEW_ORIGIN,
      });
      documentBase64 = Buffer.from(pdfBuffer).toString('base64');
    } catch (error) {
      return { ok: false, error: `PDF generation for envelope failed: ${error instanceof Error ? error.message : error}` };
    }
  }

  const signers = Array.isArray(params.signers) && params.signers.length
    ? params.signers
    : [{ name: params.leadName || 'Recipient', email: params.email || params.recipientEmail || '' }];
  if (!signers[0].email) {
    return { ok: false, error: 'DocuSign envelope requires a signer email (params.signers[0].email or params.email).' };
  }

  const envelopeBody = {
    emailSubject: params.emailSubject || `${params.template || 'Assignment Contract'} - ${params.address || params.leadName || 'Probono Key Realty'}`,
    status: params.dryRun ? 'created' : 'sent',
    documents: [{
      documentBase64,
      name: params.documentName || 'PBK Master Deal Package.pdf',
      fileExtension: 'pdf',
      documentId: '1',
    }],
    recipients: {
      signers: signers.map((signer, idx) => ({
        email: signer.email,
        name: signer.name || `Recipient ${idx + 1}`,
        recipientId: String(idx + 1),
        routingOrder: String(idx + 1),
        tabs: signer.tabs || {
          signHereTabs: [{
            documentId: '1',
            pageNumber: '1',
            xPosition: '100',
            yPosition: '650',
          }],
        },
      })),
    },
  };

  try {
    const response = await fetch(`${DOCUSIGN_REST_BASE}/v2.1/accounts/${DOCUSIGN_ACCOUNT_ID}/envelopes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(envelopeBody),
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      return { ok: false, status: response.status, body, error: body?.errorCode || body?.message || `DocuSign envelope create returned ${response.status}` };
    }
    return {
      ok: true,
      status: response.status,
      envelope: {
        envelopeId: body.envelopeId,
        uri: body.uri,
        statusDateTime: body.statusDateTime,
        status: body.status,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'DocuSign envelope create failed.' };
  }
}

let state = await loadState();

const toolHandlers = {
  async analyzeDeal(params = {}) {
    recordToolUse('analyzeDeal');
    const run = buildAnalyzerSummary(params);
    addAnalyzerRun(state, run);
    addActivity(
      state,
      makeActivity({
        actor: 'System',
        category: 'ANALYZE',
        status: 'success',
        text: `Analyzer ran - ARV ${currency(run.arv)} - MAO ${currency(run.mao)} - target ${currency(run.targetOffer)}`,
        target: run.address,
      }),
    );
    await persistState(state);
    return run;
  },

  async classifyParticipant(params = {}) {
    recordToolUse('classifyParticipant');
    const transcriptStart = String(params.transcriptStart || params.text || params.transcript || '').trim();
    const persisted = persistParticipantProfile({
      ...params,
      transcriptStart,
      source: params.source || params.provider || params.channel || 'participant-classifier',
    });
    const result = persisted.profile || classifyParticipantText(transcriptStart);
    addActivity(
      state,
      makeActivity({
        actor: 'Rex',
        category: 'CLASSIFY',
        status: 'served',
        text: transcriptStart
          ? `Classified counterparty as ${result.role} (${result.expertise})`
          : 'Participant classification requested without transcript text.',
        target: params.address || params.leadName || 'call opening',
      }),
    );
    await persistState(state);
    return {
      ok: true,
      transcriptStart,
      leadImport: persisted.leadImport,
      ...result,
    };
  },

  async getParticipantProfile(params = {}) {
    recordToolUse('getParticipantProfile');
    const profile = resolveParticipantProfile(params);
    return {
      ok: true,
      leadImport: findLatestLeadImport(params),
      profile,
    };
  },

  async getBrainEmailContext(params = {}) {
    recordToolUse('getBrainEmailContext');
    const context = buildBrainEmailContext(params);
    addActivity(
      state,
      makeActivity({
        actor: params.requestedBy || 'Rex',
        category: 'EMAIL',
        status: 'served',
        text: `Built email context for ${context.ownerName || 'lead'} at ${context.propertyAddress || 'unknown property'}.`,
        target: context.propertyAddress || context.ownerName,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      context,
    };
  },

  async getReplyTemplates(params = {}) {
    recordToolUse('getReplyTemplates');
    const reply = classifyReplyIntent(params);
    const brainInfo = buildBrainEmailContext(params);
    const resolvedTimeZone = params.timezone || DEFAULT_LEAD_TIMEZONE;
    const explicitStartTime = params.startTime || params.bookingTime || '';
    const parsedSlot = explicitStartTime
      ? {
        startTime: explicitStartTime,
        endTime: new Date(Date.parse(explicitStartTime) + 30 * 60 * 1000).toISOString(),
        timezone: resolvedTimeZone,
        approximate: false,
        label: params.requestedWindow || new Date(explicitStartTime).toLocaleString(),
        confidence: 0.99,
      }
      : parseReplyRequestedSlot(reply.body, resolvedTimeZone);
    const calendarEvent = parsedSlot
      ? {
        startTime: parsedSlot.startTime,
        endTime: parsedSlot.endTime,
        timezone: parsedSlot.timezone,
        label: parsedSlot.label,
      }
      : null;
    const templates = buildReplyTemplateCatalog({
      ...params,
      reply,
      brainInfo,
      calendarEvent,
    });
    const selected = buildReplyResponseDraft({
      ...params,
      reply,
      brainInfo,
      calendarEvent,
    });
    return {
      ok: true,
      reply,
      calendarEvent,
      selected,
      templates,
    };
  },

  async getAdminPersistenceStatus() {
    recordToolUse('getAdminPersistenceStatus');
    return buildAdminPersistenceStatus();
  },

  async getDocuSignProviderStatus() {
    recordToolUse('getDocuSignProviderStatus');
    return buildDocuSignProviderStatus();
  },

  async inspectStreakPipeline(params = {}) {
    recordToolUse('inspectStreakPipeline');
    const report = await inspectStreakPipelineState(params);
    addActivity(
      state,
      makeActivity({
        actor: params.requestedBy || 'Rex',
        category: 'CRM',
        status: report.readiness?.readyForPbk ? 'served' : report.provider?.configured ? 'warning' : 'pending',
        text: report.readiness?.readyForPbk
          ? `Streak pipeline ${report.pipeline?.key || 'unknown'} is ready for PBK transitions.`
          : report.provider?.configured
            ? `Streak pipeline ${report.pipeline?.key || 'unknown'} needs schema alignment before full PBK sync.`
            : 'Streak pipeline inspection requested before provider credentials were fully configured.',
        target: report.pipeline?.key || 'streak',
      }),
    );
    await persistState(state);
    return report;
  },

  async getStreakBootstrapPlan(params = {}) {
    recordToolUse('getStreakBootstrapPlan');
    const report = await inspectStreakPipelineState(params);
    const plan = buildStreakBootstrapPlan(report);
    addActivity(
      state,
      makeActivity({
        actor: params.requestedBy || 'Rex',
        category: 'CRM',
        status: plan.actions.length ? 'served' : 'ready',
        text: plan.actions.length
          ? `Prepared a Streak bootstrap plan with ${plan.actions.length} schema actions.`
          : 'Streak bootstrap plan requested; no missing schema actions were detected.',
        target: report.pipeline?.key || 'streak',
      }),
    );
    await persistState(state);
    return {
      ok: true,
      report,
      plan,
    };
  },

  async bootstrapStreakPipeline(params = {}) {
    recordToolUse('bootstrapStreakPipeline');
    const mode = String(params.mode || (params.apply ? 'apply' : params.requestApproval ? 'request_approval' : 'plan')).trim().toLowerCase();
    const requestedBy = params.requestedBy || 'Rex';
    const report = await inspectStreakPipelineState(params);
    const plan = buildStreakBootstrapPlan(report);

    if (!plan.actions.length) {
      addActivity(
        state,
        makeActivity({
          actor: requestedBy,
          category: 'CRM',
          status: 'ready',
          text: 'Streak bootstrap checked in with no missing schema actions.',
          target: report.pipeline?.key || 'streak',
        }),
      );
      await persistState(state);
      return {
        ok: true,
        mode,
        report,
        plan,
        applied: false,
      };
    }

    if (mode === 'request_approval') {
      const adminResult = await toolHandlers.requestAdminAction({
        provider: 'streak',
        action: 'bootstrap_schema',
        summary: `Prepare ${plan.actions.length} Streak schema changes for pipeline ${report.pipeline?.key || STREAK_PIPELINE_KEY}.`,
        command: params.command || `Bootstrap Streak schema for pipeline ${report.pipeline?.key || STREAK_PIPELINE_KEY}`,
        requestedBy,
        requiresApproval: params.requiresApproval ?? true,
        risk: params.risk || 'medium',
        dryRun: params.dryRun !== false,
        payload: {
          mode: 'apply',
          expectedStages: params.expectedStages || EXPECTED_STREAK_STAGES,
          plan,
          report,
        },
      });
      return {
        ok: true,
        mode,
        report,
        plan,
        approvalTask: adminResult.task,
        preview: adminResult.preview,
        applied: false,
      };
    }

    if (mode === 'apply') {
      const applyResult = await applyStreakBootstrapPlan(plan, params);
      addActivity(
        state,
        makeActivity({
          actor: requestedBy,
          category: 'CRM',
          status: applyResult.ok ? 'synced' : 'warning',
          text: applyResult.ok
            ? `Applied Streak bootstrap plan for pipeline ${report.pipeline?.key || STREAK_PIPELINE_KEY}.`
            : `Applied Streak bootstrap plan with ${applyResult.errors.length} issues.`,
          target: report.pipeline?.key || 'streak',
        }),
      );
      await persistState(state);
      return {
        ok: applyResult.ok,
        mode,
        report,
        plan,
        applyResult,
        applied: true,
      };
    }

    await persistState(state);
    return {
      ok: true,
      mode: 'plan',
      report,
      plan,
      applied: false,
    };
  },

  async routeAdminCommand(params = {}) {
    recordToolUse('routeAdminCommand');
    const command = String(params.command || params.query || '').trim();
    const requestedBy = params.requestedBy || params.actor || 'Rex';
    const detected = params.detected || detectAdminIntent(command) || {};
    if (looksLikeDocuSignStatusIntent(command)) {
      const result = await toolHandlers.getDocuSignProviderStatus();
      return {
        ok: true,
        routedTo: 'getDocuSignProviderStatus',
        provider: 'docusign',
        mode: 'inspect',
        answer: result.summary || 'I checked the DocuSign provider status.',
        result,
      };
    }
    if (looksLikePersistenceStatusIntent(command)) {
      const result = await toolHandlers.getAdminPersistenceStatus();
      return {
        ok: true,
        routedTo: 'getAdminPersistenceStatus',
        provider: 'telnyx',
        mode: 'inspect',
        answer: result.telnyxCallerId?.summary || 'I checked the caller-ID persistence status.',
        result,
      };
    }
    const streakRoute = classifyStreakAdminCommand(command);
    const extendedRoute = classifyExtendedAdminCommand(command, detected);

    if (streakRoute?.route === 'inspectStreakPipeline') {
      const result = await toolHandlers.inspectStreakPipeline({
        ...params,
        requestedBy,
      });
      return {
        ok: true,
        routedTo: 'inspectStreakPipeline',
        provider: 'streak',
        mode: 'inspect',
        answer: result.readiness?.readyForPbk
          ? `Streak pipeline ${result.pipeline?.key || STREAK_PIPELINE_KEY} is ready for PBK transition sync.`
          : `I inspected the Streak pipeline and found schema gaps that still need attention.`,
        result,
      };
    }

    if (streakRoute?.route === 'getStreakBootstrapPlan') {
      const result = await toolHandlers.getStreakBootstrapPlan({
        ...params,
        requestedBy,
      });
      return {
        ok: true,
        routedTo: 'getStreakBootstrapPlan',
        provider: 'streak',
        mode: 'plan',
        answer: result.plan?.actions?.length
          ? `I generated a Streak bootstrap plan with ${result.plan.actions.length} schema actions.`
          : 'I generated the Streak bootstrap plan and no missing schema actions were found.',
        result,
      };
    }

    if (streakRoute?.route === 'bootstrapStreakPipeline') {
      const result = await toolHandlers.bootstrapStreakPipeline({
        ...params,
        mode: streakRoute.mode,
        requestedBy,
        command,
        requiresApproval: streakRoute.mode === 'request_approval' ? true : params.requiresApproval,
        dryRun: streakRoute.mode === 'request_approval' ? (params.dryRun ?? true) : params.dryRun,
      });
      const answer =
        streakRoute.mode === 'apply'
          ? (result.applyResult?.ok
              ? `I applied the Streak bootstrap plan for pipeline ${result.report?.pipeline?.key || STREAK_PIPELINE_KEY}.`
              : `I tried to apply the Streak bootstrap plan, but some schema actions still need attention.`)
          : `I queued the Streak schema bootstrap for approval.`;
      return {
        ok: true,
        routedTo: 'bootstrapStreakPipeline',
        provider: 'streak',
        mode: streakRoute.mode,
        answer,
        result,
      };
    }

    if (extendedRoute) {
      const preview = buildAdminRoutePreview(extendedRoute);
      const auditCommand =
        extendedRoute.provider === 'render' && extendedRoute.action === 'update_env_var'
          ? redactEnvAssignmentsInCommand(command)
          : command;

      if (extendedRoute.mode === 'preview') {
        return {
          ok: true,
          routedTo: 'adminPreview',
          provider: extendedRoute.provider,
          mode: 'preview',
          answer: `I parsed the ${extendedRoute.provider} admin request and prepared the next action preview.`,
          result: {
            ok: true,
            preview,
          },
        };
      }

      const requiresApproval = params.requiresApproval ?? preview.requiresApproval;
      const shouldAttemptImmediateExecution = extendedRoute.mode === 'apply' && !requiresApproval;
      const adminResult = await toolHandlers.requestAdminAction({
        ...params,
        command: auditCommand,
        requestedBy,
        provider: extendedRoute.provider,
        action: extendedRoute.action,
        risk: extendedRoute.risk,
        summary: extendedRoute.summary,
        requiresApproval,
        dryRun: shouldAttemptImmediateExecution ? false : (params.dryRun ?? true),
        payload: {
          ...(params.payload || {}),
          ...(extendedRoute.payload || {}),
        },
        detected: {
          ...detected,
          provider: extendedRoute.provider,
          action: extendedRoute.action,
          risk: extendedRoute.risk,
          summary: extendedRoute.summary,
        },
      });

      if (shouldAttemptImmediateExecution && adminResult?.task) {
        const task = state.adminTasks.find((item) => item.id === adminResult.task.id) || adminResult.task;
        const statusBefore = task.status;
        const execution = await executeAdminTask(task, {
          dryRun: false,
          actor: requestedBy,
          payload: {
            ...(task.payload || {}),
            ...(extendedRoute.payload || {}),
          },
        });
        task.status = execution.ok ? 'complete' : 'warning';
        task.actor = requestedBy;
        task.notes = `Triggered by Rex admin command: ${auditCommand}`;
        task.updatedAt = isoNow();
        recordAdminExecution(task, execution, {
          statusBefore,
          statusAfter: task.status,
          requestedBy,
        });
        addAdminAudit(state, {
          id: `audit-${task.id}-${Date.now()}`,
          action: task.action,
          provider: task.provider,
          actor: requestedBy,
          status: task.status,
          summary: `${task.notes}${execution?.details ? ` · ${execution.details}` : ''}`,
          createdAt: isoNow(),
          updatedAt: isoNow(),
        });
        addActivity(
          state,
          makeActivity({
            actor: requestedBy,
            category: 'ADMIN',
            status: execution.ok ? 'complete' : 'warning',
            text: `Rex ran the ${task.provider} admin command through the direct execution path.`,
            target: `${task.provider}:${task.action}`,
          }),
        );
        await persistState(state);

        return {
          ok: execution.ok,
          routedTo: 'executeAdminTask',
          provider: task.provider,
          mode: 'apply',
          answer: execution.ok
            ? `I routed the ${task.provider} admin command into the immediate execution path.`
            : `I routed the ${task.provider} admin command into execution, but it still needs attention.`,
          result: {
            task,
            execution,
            preview,
          },
        };
      }

      return {
        ok: true,
        routedTo: 'requestAdminAction',
        provider: extendedRoute.provider,
        mode: extendedRoute.mode,
        answer: requiresApproval
          ? `I translated the ${extendedRoute.provider} admin request and queued it for approval.`
          : `I translated the ${extendedRoute.provider} admin request and staged it in the bridge.`,
        result: {
          ...adminResult,
          preview,
        },
      };
    }

    const result = await toolHandlers.requestAdminAction({
      ...params,
      command,
      requestedBy,
      detected,
    });
    return {
      ok: true,
      routedTo: 'requestAdminAction',
      provider: result?.task?.provider || detected.provider || 'system',
      mode: 'generic',
      answer: result?.task?.requiresApproval
        ? `I prepared a dry run for ${result.task.provider} (${result.task.action}) and queued it for approval.`
        : `I prepared the next admin step inside the bridge.`,
      result,
    };
  },

  async handleReplyIntent(params = {}) {
    recordToolUse('handleReplyIntent');
    const context = findLeadContext(params);
    const reply = classifyReplyIntent(params);
    const participantResult = persistParticipantProfile({
      ...params,
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      email: params.email || context.email,
      transcriptStart: params.transcriptStart || params.text || params.transcript || reply.body,
      source: params.source || params.provider || params.channel || 'reply-intent',
    });
    const participantProfile = participantResult.profile;
    const resolvedTimeZone = params.timezone || DEFAULT_LEAD_TIMEZONE;
    const explicitStartTime = params.startTime || params.bookingTime || '';
    const parsedSlot = explicitStartTime
      ? {
        startTime: explicitStartTime,
        endTime: new Date(Date.parse(explicitStartTime) + 30 * 60 * 1000).toISOString(),
        timezone: resolvedTimeZone,
        approximate: false,
        label: params.requestedWindow || new Date(explicitStartTime).toLocaleString(),
        confidence: 0.99,
      }
      : parseReplyRequestedSlot(reply.body, resolvedTimeZone);
    const brainInfo = buildBrainEmailContext({
      ...params,
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      email: params.email || context.email,
    });
    const matcher = {
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      email: params.email || context.email,
    };
    const existingLeadImport = findLatestLeadImport(matcher);
    const previousStage = String(existingLeadImport?.stage || existingLeadImport?.status || '').trim() || 'untracked';

    let leadStage = 'cold';
    let appointment = null;
    let approval = null;
    let notification = null;
    let dncEntry = null;
    let telnyxCall = null;
    let calendarEvent = null;
    let calendarSync = null;
    let crmSync = null;
    let responseDraft = null;
    let followUpMessage = null;
    let followUpDelivery = null;

    if (reply.nextAction === 'dnc') {
      dncEntry = buildDncEntry({
        phone: params.phone || context.phone || '',
        name: context.leadName,
        reason: 'Inbound reply requested no further contact.',
        source: params.provider || params.channel || 'email-reply',
      });
      if (dncEntry.phone && !findDncEntryByPhone(dncEntry.phone)) addDncEntry(state, dncEntry);
      leadStage = 'dnc';
    } else if (reply.nextAction === 'archive') {
      leadStage = 'archived';
    } else if (reply.nextAction === 'manual-review') {
      leadStage = 'manual-review';
    } else if (reply.nextAction === 'call-now') {
      leadStage = 'hot';
      if (params.autoDialImmediate ?? AUTO_DIAL_IMMEDIATE_REPLIES) {
        telnyxCall = await toolHandlers.telnyx_call({
          leadId: context.leadId,
          leadName: context.leadName,
          address: context.address,
          phone: params.phone || context.phone,
          email: params.email || context.email,
          notes: `Immediate inbound follow-up requested via ${params.provider || params.channel || 'reply automation'}: ${reply.body}`.slice(0, 500),
        });
      }
      if (!telnyxCall || telnyxCall.ok === false) {
        const approvalResult = await toolHandlers.createApproval({
          type: 'immediate_call',
          leadId: context.leadId,
          leadName: context.leadName,
          address: context.address,
          notes: `Immediate call requested from inbound ${params.channel || 'email'} reply: ${reply.body}`,
        });
        approval = approvalResult.approval || approvalResult;
      }
    } else if (reply.nextAction === 'booking') {
      leadStage = parsedSlot && !parsedSlot.approximate ? 'booked' : reply.temperature === 'hot' ? 'booking-requested' : 'warm';
      if (parsedSlot) {
        calendarEvent = {
          title: `PBK seller call · ${context.leadName}`,
          startTime: parsedSlot.startTime,
          endTime: parsedSlot.endTime,
          timezone: parsedSlot.timezone,
          label: parsedSlot.label,
          status: parsedSlot.approximate ? 'drafted' : 'created',
          source: params.provider || params.channel || 'reply-parser',
          attendees: [params.email || context.email].filter(Boolean),
          notes: reply.body,
        };
      }
      const appointmentResult = await toolHandlers.scheduleAppointment({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        email: params.email || context.email,
        phone: params.phone || context.phone,
        startTime: parsedSlot?.startTime || explicitStartTime || '',
        endTime: parsedSlot?.endTime || '',
        timezone: resolvedTimeZone,
        source: params.provider || params.channel || 'email-reply',
        status: parsedSlot ? (parsedSlot.approximate ? 'pending-confirmation' : 'scheduled') : 'requested',
        bookingUrl: params.bookingUrl || params.calendarUrl || DEFAULT_BOOKING_LINK,
        calendarEventStatus: parsedSlot ? (parsedSlot.approximate ? 'drafted' : 'created') : '',
        notes: `Reply intent: ${reply.intent}${reply.requestedWindow ? ` · requested window ${reply.requestedWindow}` : ''} · ${reply.body}`.slice(0, 500),
      });
      appointment = appointmentResult.appointment || appointmentResult;
    } else if (reply.temperature === 'warm') {
      leadStage = 'warm';
    }

    responseDraft = buildReplyResponseDraft({
      ...params,
      reply,
      context,
      brainInfo,
      participantProfile,
      bookingLink: params.bookingUrl || params.calendarUrl || DEFAULT_BOOKING_LINK,
      calendarEvent,
    });

    if (responseDraft) {
      followUpMessage = createMessageRecord({
        id: `draft-${Date.now()}-${slugify(context.leadName || 'lead')}`,
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        email: params.email || context.email,
        channel: responseDraft.channel || 'email',
        direction: 'outbound',
        body: responseDraft.text || '',
        status: 'drafted',
        provider: 'Reply automation',
      });
      upsertMessage(state, followUpMessage);
    }

    if (calendarEvent?.startTime && calendarEvent?.endTime && (params.syncCalendar ?? true)) {
      calendarSync = await syncCalendarEvent({
        ...calendarEvent,
        summary: calendarEvent.title,
        description: `${calendarEvent.notes || ''}${context.address ? `\n\nProperty: ${context.address}` : ''}`.trim(),
      });
      if (appointment) {
        appointment.calendarProvider = calendarSync?.provider || '';
        appointment.calendarEventId = calendarSync?.event?.id || appointment.calendarEventId || '';
        appointment.calendarJoinUrl = calendarSync?.event?.htmlLink || appointment.calendarJoinUrl || '';
        appointment.calendarEventStatus = calendarSync?.ok
          ? (calendarSync?.event?.status || appointment.calendarEventStatus || 'confirmed')
          : appointment.calendarEventStatus || 'drafted';
        appointment.updatedAt = isoNow();
        upsertAppointment(state, appointment);
      }
      addActivity(
        state,
        makeActivity({
          actor: 'Calendar sync',
          category: 'CALENDAR',
          status: calendarSync?.ok ? 'synced' : calendarSync?.skipped ? 'pending' : 'warning',
          text: calendarSync?.ok
            ? `Calendar event synced for ${context.leadName}.`
            : calendarSync?.skipped
              ? 'Calendar sync skipped because no provider is configured.'
              : `Calendar sync failed for ${context.leadName}: ${calendarSync?.error || 'unknown error'}`,
          target: context.address || context.leadName,
        }),
      );
    }

    if (responseDraft && followUpMessage && (params.autoSendFollowUp ?? AUTO_SEND_REPLY_FOLLOWUPS) && (params.email || context.email)) {
      const senderProfile = inferSenderProfile(params.senderProfile || 'warm');
      followUpDelivery = await sendTransactionalEmail({
        from: getSenderAddress(senderProfile),
        to: params.email || context.email,
        subject: responseDraft.subject,
        html: responseDraft.html,
        text: responseDraft.text,
      });
      followUpMessage.status = followUpDelivery?.ok ? (followUpDelivery.live === false ? 'prepared' : 'sent') : 'warning';
      followUpMessage.provider = senderProfile === 'cold' ? 'Cold follow-up' : 'Warm follow-up';
      followUpMessage.createdAt = followUpMessage.createdAt || isoNow();
      upsertMessage(state, followUpMessage);
      addActivity(
        state,
        makeActivity({
          actor: 'Reply automation',
          category: 'FOLLOW_UP',
          status: followUpDelivery?.ok ? (followUpDelivery.live === false ? 'prepared' : 'sent') : 'warning',
          text: followUpDelivery?.ok
            ? `Follow-up ${followUpDelivery.live === false ? 'prepared' : 'sent'} to ${context.leadName}.`
            : `Follow-up send failed for ${context.leadName}: ${followUpDelivery?.error || 'unknown error'}`,
          target: context.address || context.leadName,
        }),
      );
    }

    const leadImport = patchLeadImport(state, matcher, {
      stage: leadStage,
      stageUpdatedAt: isoNow(),
      lastStageTransitionAt: isoNow(),
      lastStageTransitionFrom: previousStage,
      lastStageTransitionTo: leadStage,
      lastReplyAt: isoNow(),
      lastReplyIntent: reply.intent,
      lastReplyChannel: params.channel || 'email',
      lastReplyRequestedWindow: reply.requestedWindow || '',
      lastReplyPreview: reply.body.slice(0, 240),
      replyTemperature: reply.temperature,
      participantRole: participantProfile?.role || '',
      participantExpertise: participantProfile?.expertise || '',
      participantConfidence: toNumber(participantProfile?.confidence, 0),
      participantClassifiedAt: participantProfile?.classifiedAt || '',
      participantProfile: participantProfile || undefined,
      lastReplyTemplateKey: responseDraft?.templateKey || '',
      lastFollowUpStatus: followUpDelivery?.ok ? (followUpDelivery.live === false ? 'prepared' : 'sent') : responseDraft ? 'drafted' : '',
      lastCalendarSyncStatus: calendarSync?.ok ? 'synced' : calendarSync?.skipped ? 'skipped' : calendarSync ? 'warning' : '',
    });

    const leadTransition = createLeadStageTransitionRecord({
      ...params,
      leadId: context.leadId || leadImport?.leadId || existingLeadImport?.leadId || '',
      leadName: context.leadName || leadImport?.seller?.name || existingLeadImport?.seller?.name || '',
      address: context.address || leadImport?.property?.address || existingLeadImport?.property?.address || '',
      fromStage: previousStage,
      toStage: leadStage,
      changed: previousStage !== leadStage,
      intent: reply.intent,
      temperature: reply.temperature,
      source: params.provider || params.channel || 'reply-automation',
      channel: params.channel || 'email',
      reason: `Reply classified as ${reply.intent}.`,
      participantRole: participantProfile?.role || '',
      participantExpertise: participantProfile?.expertise || '',
      requestedWindow: reply.requestedWindow || parsedSlot?.label || '',
      replyPreview: reply.body,
      appointmentId: appointment?.id || '',
      approvalId: approval?.id || '',
      callId: telnyxCall?.call?.id || telnyxCall?.id || '',
      followUpTemplateKey: responseDraft?.templateKey || '',
      followUpStatus: followUpDelivery?.ok ? (followUpDelivery.live === false ? 'prepared' : 'sent') : responseDraft ? 'drafted' : '',
      calendarEventId: calendarSync?.event?.id || appointment?.calendarEventId || '',
      calendarSyncStatus: calendarSync?.ok ? 'synced' : calendarSync?.skipped ? 'skipped' : calendarSync ? 'warning' : '',
      crmSyncStatus: (params.syncCrm ?? true) ? (getCrmSyncProviderMeta().ready ? 'pending' : 'skipped') : 'disabled',
    });

    if (params.syncCrm ?? true) {
      crmSync = await syncCrmTransition({
        ok: true,
        type: 'lead_stage_transition',
        transition: leadTransition,
        lead: {
          leadId: context.leadId || leadImport?.leadId || existingLeadImport?.leadId || '',
          leadName: context.leadName || leadImport?.seller?.name || existingLeadImport?.seller?.name || '',
          address: context.address || leadImport?.property?.address || existingLeadImport?.property?.address || '',
          email: params.email || context.email || leadImport?.seller?.email || existingLeadImport?.seller?.email || '',
          phone: params.phone || context.phone || leadImport?.seller?.phone || existingLeadImport?.seller?.phone || '',
        },
        reply,
        appointment,
        approval,
        participantProfile,
        telnyxCall,
        calendarEvent,
        calendarSync,
        responseDraft: responseDraft
          ? {
            templateKey: responseDraft.templateKey,
            templateVersion: responseDraft.templateVersion,
            subject: responseDraft.subject,
            bookingLink: responseDraft.bookingLink || '',
          }
          : null,
        followUpDelivery,
        source: params.provider || params.channel || 'reply-automation',
        occurredAt: leadTransition.createdAt,
      });
      leadTransition.crmSyncStatus = crmSync?.ok ? 'synced' : crmSync?.skipped ? 'skipped' : 'warning';
      leadTransition.crmProvider = crmSync?.provider || '';
      leadTransition.crmEntityId = crmSync?.boxKey || crmSync?.entityId || '';
      leadTransition.crmPipelineKey = crmSync?.pipelineKey || '';
      leadTransition.crmStageKey = crmSync?.stageKey || '';

      if (crmSync?.provider === 'streak' && crmSync?.boxKey) {
        patchLeadImport(state, matcher, {
          streakBoxKey: crmSync.boxKey,
          streakPipelineKey: crmSync.pipelineKey || '',
          streakStageKey: crmSync.stageKey || '',
          streakStageName: crmSync.stageName || '',
          lastCrmSyncProvider: crmSync.provider || 'streak',
          lastCrmSyncStatus: leadTransition.crmSyncStatus,
          lastCrmSyncAt: isoNow(),
        });
      }
    }

    addLeadStageTransition(state, leadTransition);

    addActivity(
      state,
      makeActivity({
        actor: params.provider || 'Reply automation',
        category: 'REPLY',
        status: reply.nextAction === 'dnc' ? 'blocked' : reply.nextAction === 'manual-review' ? 'warning' : reply.shouldEscalateToBooking ? 'queued' : 'received',
        text: `Reply intent parsed as ${reply.intent}${reply.requestedWindow ? ` (${reply.requestedWindow})` : ''}.`,
        target: context.address || context.leadName,
      }),
    );

    if (responseDraft) {
      addActivity(
        state,
        makeActivity({
          actor: 'Reply automation',
          category: 'FOLLOW_UP',
          status: 'drafted',
          text:
            reply.nextAction === 'booking'
              ? `Prepared booking follow-up draft${responseDraft.bookingLink ? ` with link ${responseDraft.bookingLink}` : ''}.`
              : reply.nextAction === 'call-now'
                ? 'Prepared immediate-call acknowledgment draft.'
                : 'Prepared follow-up response draft.',
          target: context.address || context.leadName,
        }),
      );
    }

    addActivity(
      state,
      makeActivity({
        actor: 'Lead stage',
        category: 'STAGE',
        status: leadTransition.changed ? 'updated' : 'received',
        text: leadTransition.changed
          ? `Lead stage moved from ${leadTransition.fromStage} to ${leadTransition.toStage}.`
          : `Lead stage remained ${leadTransition.toStage} after reply classification.`,
        target: context.address || context.leadName,
      }),
    );

    if (crmSync) {
      addActivity(
        state,
        makeActivity({
          actor: 'CRM sync',
          category: 'CRM',
          status: crmSync.ok ? 'synced' : crmSync.skipped ? 'pending' : 'warning',
          text: crmSync.ok
            ? `CRM transition synced for ${context.leadName}.`
            : crmSync.skipped
              ? 'CRM sync skipped because no CRM webhook is configured.'
              : `CRM sync failed for ${context.leadName}: ${crmSync.error || 'unknown error'}`,
          target: context.address || context.leadName,
        }),
      );
    }

    if (reply.shouldNotify) {
      notification = await toolHandlers.slackNotify({
        channel: '#deals',
        text:
          reply.nextAction === 'call-now'
            ? `Hot lead wants a call now: ${context.leadName} · ${context.address}${telnyxCall?.ok ? ' · Telnyx routed' : ' · approval queued'}`
            : reply.nextAction === 'manual-review'
              ? `Manual review needed for inbound reply from ${context.leadName}: ${reply.body.slice(0, 180)}`
              : `Warm lead moved to booking queue: ${context.leadName} · ${context.address}${parsedSlot?.label ? ` · ${parsedSlot.label}` : reply.requestedWindow ? ` · ${reply.requestedWindow}` : ''}`,
      });
    }

    await persistState(state);
    return {
      ok: true,
      context,
      reply,
      participantProfile,
      leadStage,
      leadImport,
      appointment,
      approval,
      telnyxCall,
      calendarEvent,
      calendarSync,
      responseDraft,
      followUpMessage,
      followUpDelivery,
      leadTransition,
      crmSync,
      notification,
      dncEntry,
    };
  },

  async createApproval(params = {}) {
    recordToolUse('createApproval');
    const approval = {
      id: params.id || randomUUID(),
      type: params.type || 'offer',
      leadId: params.leadId || randomUUID(),
      leadName: params.leadName || params.name || 'Unknown seller',
      address: params.address || 'Unknown property',
      offerPrice: toNumber(params.offerPrice, 0),
      mao: toNumber(params.mao, 0),
      contractId: params.contractId || '',
      templateId: params.templateId || '',
      approvalAction: params.approvalAction || '',
      reviewerEmail: params.reviewerEmail || '',
      reviewerName: params.reviewerName || '',
      sellerNotice: params.sellerNotice || '',
      metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {},
      notes: params.notes || '',
      status: 'pending',
      createdAt: params.createdAt || isoNow(),
    };

    addApproval(state, approval);
    addActivity(
      state,
      makeActivity({
        actor: 'Ava',
        category: 'APPROVAL',
        status: 'pending',
        text: `Queued ${approval.type} approval${approval.offerPrice ? ` for ${currency(approval.offerPrice)}` : ''}`,
        target: approval.address || approval.leadName,
      }),
    );

    await persistState(state);
    const fanout = await fireWebhook(APPROVAL_WEBHOOK_URL, approval);
    if (fanout.ok) {
      addActivity(
        state,
        makeActivity({
          actor: 'n8n',
          category: 'APPROVAL',
          status: 'queued',
          text: `Approval request ready for ${approval.leadName} at ${approval.address}`,
          target: approval.id,
        }),
      );
      await persistState(state);
    }
    return { approval, fanout };
  },

  async updateCRM(params = {}) {
    recordToolUse('updateCRM');
    const syncResult = await syncCrmTransition(params);
    if (syncResult?.provider === 'streak' && syncResult?.boxKey) {
      patchLeadImport(
        state,
        {
          leadId: params.leadId || params.lead?.leadId || params.transition?.leadId || '',
          leadName: params.leadName || params.lead?.leadName || params.transition?.leadName || '',
          address: params.address || params.lead?.address || params.transition?.address || '',
          email: params.email || params.lead?.email || '',
        },
        {
          streakBoxKey: syncResult.boxKey,
          streakPipelineKey: syncResult.pipelineKey || '',
          streakStageKey: syncResult.stageKey || '',
          streakStageName: syncResult.stageName || '',
          lastCrmSyncProvider: syncResult.provider || 'streak',
          lastCrmSyncStatus: syncResult.ok ? 'synced' : syncResult.skipped ? 'skipped' : 'warning',
          lastCrmSyncAt: isoNow(),
        },
      );
    }
    addActivity(
      state,
      makeActivity({
        actor: 'System',
        category: 'CRM',
        status: syncResult?.ok ? 'synced' : syncResult?.skipped ? 'pending' : 'warning',
        text: syncResult?.ok
          ? params.message || `CRM sync completed through ${syncResult.provider || 'crm'}.`
          : syncResult?.skipped
            ? params.message || `CRM sync skipped: ${syncResult.error || 'provider not configured'}.`
            : params.message || `CRM sync failed: ${syncResult.error || 'unknown error'}.`,
        target: params.target || params.leadId || 'crm',
      }),
    );
    await persistState(state);
    return {
      ok: Boolean(syncResult?.ok),
      updatedAt: isoNow(),
      target: params.target || params.leadId || 'crm',
      provider: syncResult?.provider || '',
      sync: syncResult,
    };
  },

  async ingestResearchDoc(params = {}) {
    recordToolUse('ingestResearchDoc');
    const doc = {
      id: params.id || randomUUID(),
      kind: params.kind || 'note',
      topic: params.topic || 'Wholesaling',
      title: params.title || 'Untitled source',
      source: params.source || 'Manual ingest',
      excerpt: params.excerpt || params.summary || 'No excerpt provided.',
      summary: params.summary || params.excerpt || 'No summary provided.',
      citation: params.citation || `${params.source || 'Manual ingest'} - ${new Date().toLocaleDateString()}`,
      createdAt: isoNow(),
      tags: Array.isArray(params.tags) ? params.tags : [params.topic || 'Wholesaling'],
    };

    addBrainDoc(state, doc);
    addActivity(
      state,
      makeActivity({
        actor: 'Rex',
        category: 'RESEARCH',
        status: 'indexed',
        text: `Indexed new ${doc.kind} source: ${doc.title}`,
        target: doc.topic,
      }),
    );
    state.status.weeklySources = toNumber(state.status.weeklySources, 0) + 1;
    await persistState(state);
    return { ok: true, doc };
  },

  async getBrainState(params = {}) {
    recordToolUse('getBrainState');
    const query = String(params.query || '').trim();
    const isBrowserResearchIntent = looksLikeBrowserResearchIntent(query);
    const isAdminIntent = !isBrowserResearchIntent && looksLikeAdminIntent(query);
    const response = isAdminIntent || isBrowserResearchIntent
      ? null
      : answerBrainQuery(state, query);
    state.status.queryCountToday = toNumber(state.status.queryCountToday, 0) + 1;

    if (isBrowserResearchIntent) {
      const researchResult = await toolHandlers.launchBrowserResearch({
        query,
        requestedBy: 'Rex',
        source: 'brain',
      });
      addActivity(
        state,
        makeActivity({
          actor: 'Rex',
          category: 'RESEARCH',
          status: researchResult?.ok ? 'queued' : 'warning',
          text: `Rex routed a browser research request: "${query}"`,
          target: researchResult?.job?.targetLabel || 'BrowserOS',
        }),
      );
      await persistState(state);
      return {
        query,
        answer: researchResult?.answer || 'Browser research request queued.',
        citations: researchResult?.citations || [],
        browserResearch: researchResult?.job || null,
        brainDocs: state.brainDocs.slice(0, 8),
        status: state.status,
      };
    }

    if (isAdminIntent) {
      const adminRoute = await toolHandlers.routeAdminCommand({
        command: query,
        requestedBy: 'Rex',
        source: 'brain',
      });
      addActivity(
        state,
        makeActivity({
          actor: 'Rex',
          category: 'ADMIN',
          status: adminRoute?.mode === 'apply' ? (adminRoute?.result?.applyResult?.ok ? 'success' : 'warning') : adminRoute?.mode === 'inspect' || adminRoute?.mode === 'plan' ? 'served' : 'pending',
          text: `Rex routed admin request via ${adminRoute?.routedTo || 'requestAdminAction'}: "${query}"`,
          target: adminRoute?.provider || 'admin',
        }),
      );
      await persistState(state);
      return {
        query,
        answer: adminRoute?.answer || 'I treated that as an admin request and routed it through the bridge.',
        citations: ['PBK admin runtime', 'OpenClaw bridge'],
        admin: adminRoute,
        brainDocs: state.brainDocs.slice(0, 8),
        status: state.status,
      };
    }

    addActivity(
      state,
      makeActivity({
        actor: 'Rex',
        category: 'QUERY',
        status: 'served',
        text: query ? `Answered research query: "${query}"` : 'Returned current Brain state',
        target: 'Brain',
      }),
    );
    await persistState(state);
    return {
      ...response,
      brainDocs: state.brainDocs.slice(0, 8),
      status: state.status,
    };
  },

  async launchBrowserResearch(params = {}) {
    recordToolUse('launchBrowserResearch');
    const request = extractBrowserResearchRequest(params.query || params.command || params.prompt || '');
    const toolingStatus = await buildToolingStatus();
    const browserOs = toolingStatus.browserOs || {};
    const ready = Boolean(browserOs.ready);
    const job = {
      id: `browser-research-${slugify(request.targetLabel || 'request') || randomUUID().slice(0, 8)}`,
      createdAt: isoNow(),
      requestedBy: params.requestedBy || 'Rex',
      source: params.source || 'brain',
      provider: 'browseros',
      status: ready ? 'queued' : 'setup-required',
      query: request.query,
      targetUrl: request.targetUrl,
      targetLabel: request.targetLabel,
      site: request.source,
      endpoint: browserOs.endpoint || BROWSEROS_MCP_URL,
    };

    addActivity(
      state,
      makeActivity({
        actor: params.requestedBy || 'Rex',
        category: 'RESEARCH',
        status: ready ? 'queued' : 'warning',
        text: ready
          ? `BrowserOS research queued for ${request.targetLabel || 'the requested page'}.`
          : `BrowserOS research requested for ${request.targetLabel || 'the requested page'}, but the MCP registry still needs BrowserOS configured.`,
        target: request.targetLabel || request.targetUrl || 'BrowserOS',
      }),
    );
    state.status.lastBrowserResearchAt = job.createdAt;
    await persistState(state);

    return {
      ok: ready,
      answer: ready
        ? `BrowserOS is registered. I queued browser research for ${request.targetLabel || request.source}. Keep results inside the Brain lane and the existing tooling cards.`
        : `BrowserOS is not registered yet. Add a browseros entry in mcp-servers/registry.example.json and point it at ${BROWSEROS_MCP_URL}, then retry from Rex.`,
      citations: ready ? ['BrowserOS MCP registry', 'PBK Browser Research Layer'] : ['mcp-servers/registry.example.json'],
      job,
      tooling: {
        browserOs,
      },
    };
  },

  async checkDNC(params = {}) {
    recordToolUse('checkDNC');
    const phone = normalizePhone(params.phone || params.to || params.number || '');
    const match = findDncEntryByPhone(phone);
    addActivity(
      state,
      makeActivity({
        actor: 'Guardrail',
        category: 'DNC',
        status: match ? 'blocked' : 'safe',
        text: match
          ? `Blocked outbound contact to ${phone || 'unknown number'}`
          : `DNC check clear for ${phone || 'unknown number'}`,
        target: params.leadName || params.address || phone || 'DNC',
      }),
    );
    await persistState(state);
    return {
      ok: !match,
      phone,
      blocked: Boolean(match),
      reason: match?.reason || '',
      match,
    };
  },

  async sendColdEmail(params = {}) {
    recordToolUse('sendColdEmail');
    const context = findLeadContext(params);
    const leadImport = findLatestLeadImport(params);
    const email = params.email || context.email || leadImport?.seller?.email || inferSkipTraceContact(context).email;
    const dnc = findDncEntryByPhone(context.phone);
    if (dnc) {
      addActivity(
        state,
        makeActivity({
          actor: 'Guardrail',
          category: 'EMAIL',
          status: 'blocked',
          text: `Blocked cold email for ${context.leadName} because the lead is marked DNC.`,
          target: context.address || context.leadName,
        }),
      );
      await persistState(state);
      return {
        ok: false,
        blocked: true,
        reason: dnc.reason,
        dnc,
      };
    }

    const brainInfo = buildBrainEmailContext({
      ...params,
      leadId: context.leadId,
      address: context.address,
      leadName: context.leadName,
    });
    const templateId =
      params.templateId ||
      (brainInfo.probateStatus ? 'probate' : brainInfo.absenteeOwner ? 'absentee' : brainInfo.estimatedEquity >= 100000 ? 'high-equity' : 'generic');
    const content = buildColdEmailContent(
      templateId,
      {
        firstName: context.leadName?.split(/\s+/)[0] || '',
        name: context.leadName,
        address: context.address,
        email,
      },
      brainInfo,
    );

    let delivery = null;
    let provider = 'Resend';
    let endpoint = '';
    const instantlyEndpoint = String(process.env.PBK_INSTANTLY_EMAIL_SEND_ENDPOINT || '/emails').trim();

    if (INSTANTLY_API_KEY) {
      provider = 'Instantly';
      endpoint = instantlyEndpoint;
      delivery = await fireInstantlyRequest(instantlyEndpoint, {
        campaignId: params.campaignId || '',
        leadId: context.leadId,
        templateId,
        from: getSenderAddress('cold'),
        to: email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        metadata: {
          address: context.address,
          ownerName: context.leadName,
        },
      });
    }

    if (!delivery || (!delivery.ok && params.allowResendFallback !== false)) {
      provider = 'Resend';
      endpoint = 'https://api.resend.com/emails';
      delivery = await sendTransactionalEmail({
        from: getSenderAddress('cold'),
        to: email,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
    }

    const message = createMessageRecord({
      id: delivery?.id || delivery?.body?.id || `msg-cold-email-${Date.now()}`,
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      email,
      channel: 'email',
      direction: 'outbound',
      body: content.text,
      status: delivery?.ok ? 'sent' : 'queued',
      provider,
    });
    upsertMessage(state, message);

    addActivity(
      state,
      makeActivity({
        actor: provider,
        category: 'EMAIL',
        status: delivery?.ok ? (delivery.live === false ? 'simulated' : 'sent') : 'warning',
        text: delivery?.ok
          ? `Cold email ${delivery.live === false ? 'prepared' : 'sent'} to ${context.leadName || email}.`
          : `Cold email failed for ${context.leadName || email}: ${delivery?.error || 'unknown error'}`,
        target: context.address || email || context.leadName,
      }),
    );
    await persistState(state);

    return {
      ok: Boolean(delivery?.ok),
      provider,
      endpoint,
      email,
      content,
      brainInfo,
      delivery,
      message,
    };
  },

  async scheduleAppointment(params = {}) {
    recordToolUse('scheduleAppointment');
    const appointment = createAppointmentRecord(params);
    const whenLabel = appointment.startTime
      ? new Date(appointment.startTime).toLocaleString()
      : appointment.notes || 'requested time pending confirmation';
    upsertAppointment(state, appointment);
    addActivity(
      state,
      makeActivity({
        actor: params.actor || 'Scheduler',
        category: 'BOOKING',
        status: appointment.status,
        text: `Appointment ${appointment.status} for ${appointment.leadName} at ${whenLabel}.`,
        target: appointment.address || appointment.leadName,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      appointment,
      nextStep: 'Schedule Telnyx voice follow-up at the appointment time.',
    };
  },

  async telnyx_call(params = {}) {
    recordToolUse('telnyx_call');
    const context = findLeadContext(params);
    const participantProfile = resolveParticipantProfile({
      ...params,
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      email: params.email || context.email,
    });
    const callStrategy = buildCallStrategyFromProfile(participantProfile);
    const phone = normalizePhone(params.phone || params.to || context.phone || inferSkipTraceContact(context).phone);
    const fromNumber = getTelnyxFromNumber(params);
    const telnyxMeta = getTelnyxProviderMeta();
    const dnc = findDncEntryByPhone(phone);

    if (dnc) {
      addActivity(
        state,
        makeActivity({
          actor: 'Guardrail',
          category: 'DNC',
          status: 'blocked',
          text: `Blocked call to ${context.leadName} because the number is on DNC`,
          target: phone || context.address,
        }),
      );
      await persistState(state);
      return {
        ok: false,
        blocked: true,
        reason: dnc.reason,
        dnc,
      };
    }

    if (!phone) {
      return {
        ok: false,
        error: 'No destination phone number was available for this call.',
        telnyx: {
          live: false,
          configured: telnyxMeta.voiceReady,
        },
      };
    }

    if (telnyxMeta.voiceReady && fromNumber) {
      const webhookUrl = getTelnyxWebhookUrl(params);
      const requestPayload = {
        connection_id: params.connectionId || TELNYX_CONNECTION_ID,
        from: fromNumber,
        to: Array.isArray(params.to) ? params.to : phone,
        command_id: params.commandId || `pbk-call-${randomUUID()}`,
        client_state: encodeClientState({
          leadId: context.leadId,
          leadName: context.leadName,
          address: context.address,
          phone,
          actor: params.actor || 'ava-acquisition-v3',
        }),
      };

      if (params.fromDisplayName) requestPayload.from_display_name = String(params.fromDisplayName).slice(0, 128);
      if (params.timeoutSecs) requestPayload.timeout_secs = toNumber(params.timeoutSecs, 30);
      if (params.timeLimitSecs) requestPayload.time_limit_secs = toNumber(params.timeLimitSecs, 14400);
      if (params.answeringMachineDetection) requestPayload.answering_machine_detection = params.answeringMachineDetection;
      if (params.record) requestPayload.record = params.record;
      if (params.recordTrack) requestPayload.record_track = params.recordTrack;
      if (params.audioUrl) requestPayload.audio_url = params.audioUrl;
      if (params.transcription === true) requestPayload.transcription = true;
      if (webhookUrl) {
        requestPayload.webhook_url = webhookUrl;
        requestPayload.webhook_url_method = 'POST';
      }

      const telnyxResponse = await fireTelnyxRequest('POST', '/calls', requestPayload);
      if (!telnyxResponse.ok) {
        addActivity(
          state,
          makeActivity({
            actor: 'Telnyx',
            category: 'CALL',
            status: 'warning',
            text: `Telnyx call failed for ${context.leadName}: ${telnyxResponse.error || 'unknown error'}`,
            target: context.address || phone,
          }),
        );
        await persistState(state);
        return {
          ok: false,
          error: telnyxResponse.error || 'Telnyx call failed.',
          telnyx: {
            live: true,
            configured: true,
            status: telnyxResponse.status || 0,
            response: telnyxResponse.body || null,
          },
        };
      }

      const providerCall = telnyxResponse.body?.data || {};
      const call = createCallRecord({
        ...params,
        id: providerCall.call_control_id || providerCall.call_leg_id || params.id,
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone,
        status: 'queued',
        startedAt: providerCall.start_time || isoNow(),
        updatedAt: isoNow(),
        provider: 'Telnyx',
        from: fromNumber,
        script: params.script || callStrategy.script,
        participantRole: participantProfile?.role || '',
        participantExpertise: participantProfile?.expertise || '',
        participantConfidence: toNumber(participantProfile?.confidence, 0),
        telnyxCallControlId: providerCall.call_control_id || '',
        telnyxCallLegId: providerCall.call_leg_id || '',
        telnyxCallSessionId: providerCall.call_session_id || '',
        commandId: requestPayload.command_id,
      });

      upsertCall(state, call);
      addActivity(
        state,
        makeActivity({
          actor: 'Ava',
          category: 'CALL',
          status: 'queued',
          text: `Outbound call queued via Telnyx to ${context.leadName} using ${callStrategy.script}.`,
          target: context.address || phone,
        }),
      );
      await persistState(state);
      return {
        ok: true,
        call,
        participantProfile,
        callStrategy,
        telnyx: {
          live: true,
          configured: true,
          status: telnyxResponse.status,
          response: providerCall,
        },
      };
    }

      const call = createCallRecord({
        ...params,
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone,
        status: 'live',
        provider: 'Simulated',
        from: fromNumber,
        script: params.script || callStrategy.script,
        participantRole: participantProfile?.role || '',
        participantExpertise: participantProfile?.expertise || '',
        participantConfidence: toNumber(participantProfile?.confidence, 0),
      });

    upsertCall(state, call);
    addActivity(
      state,
      makeActivity({
          actor: 'Ava',
          category: 'CALL',
          status: 'live',
          text: `Outbound call started to ${context.leadName} using ${callStrategy.script}${telnyxMeta.voiceReady ? '' : ' (simulated - add Telnyx voice keys to go live)'}`,
          target: context.address || phone,
        }),
    );
    await persistState(state);
      return {
        ok: true,
        call,
        participantProfile,
        callStrategy,
        telnyx: {
          live: false,
        configured: telnyxMeta.voiceReady,
        simulated: true,
        missing: telnyxMeta.voiceMissing,
      },
    };
  },

  async telnyx_sms(params = {}) {
    recordToolUse('telnyx_sms');
    const context = findLeadContext(params);
    const direction = params.direction || 'outbound';
    const phone = normalizePhone(params.phone || params.to || context.phone || inferSkipTraceContact(context).phone);
    const fromNumber = getTelnyxFromNumber(params);
    const telnyxMeta = getTelnyxProviderMeta();
    const fromWebhook = Boolean(params._fromTelnyxWebhook);
    const dnc = direction === 'outbound' && !fromWebhook ? findDncEntryByPhone(phone) : null;

    if (dnc) {
      addActivity(
        state,
        makeActivity({
          actor: 'Guardrail',
          category: 'DNC',
          status: 'blocked',
          text: `Blocked SMS to ${context.leadName} because the number is on DNC`,
          target: phone || context.address,
        }),
      );
      await persistState(state);
      return {
        ok: false,
        blocked: true,
        reason: dnc.reason,
        dnc,
      };
    }

    const bodyText = String(params.body || params.message || '').trim();

    if (params.id) {
      const existing = state.messages.find((item) => item.id === params.id);
      if (
        existing &&
        existing.status === (params.status || existing.status) &&
        existing.direction === direction &&
        String(existing.body || '').trim() === bodyText
      ) {
        return {
          ok: true,
          replayed: true,
          message: existing,
        };
      }
    }

    if (!phone) {
      return {
        ok: false,
        error: 'No destination phone number was available for this message.',
        telnyx: {
          live: false,
          configured: telnyxMeta.messagingReady,
        },
      };
    }

    if (direction === 'outbound' && !fromWebhook && telnyxMeta.messagingReady && fromNumber) {
      if (!bodyText) {
        return {
          ok: false,
          error: 'Message body is required for outbound SMS.',
          telnyx: {
            live: false,
            configured: telnyxMeta.messagingReady,
          },
        };
      }

      const requestPayload = {
        from: fromNumber,
        to: phone,
        text: bodyText,
      };
      const webhookUrl = getTelnyxWebhookUrl(params);
      if (webhookUrl) requestPayload.webhook_url = webhookUrl;
      if (TELNYX_MESSAGING_PROFILE_ID) requestPayload.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;

      const telnyxResponse = await fireTelnyxRequest('POST', '/messages', requestPayload);
      if (!telnyxResponse.ok) {
        addActivity(
          state,
          makeActivity({
            actor: 'Telnyx',
            category: 'SMS',
            status: 'warning',
            text: `Telnyx SMS failed for ${context.leadName}: ${telnyxResponse.error || 'unknown error'}`,
            target: context.address || phone,
          }),
        );
        await persistState(state);
        return {
          ok: false,
          error: telnyxResponse.error || 'Telnyx SMS failed.',
          telnyx: {
            live: true,
            configured: true,
            status: telnyxResponse.status || 0,
            response: telnyxResponse.body || null,
          },
        };
      }

      const providerMessage = telnyxResponse.body?.data || {};
      const message = createMessageRecord({
        ...params,
        id: providerMessage.id || params.id,
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone,
        direction,
        body: bodyText,
        status: providerMessage.status || 'queued',
        from: fromNumber,
        provider: 'Telnyx',
      });

      upsertMessage(state, message);
      addActivity(
        state,
        makeActivity({
          actor: 'Ava',
          category: 'SMS',
          status: 'queued',
          text: `Outbound SMS queued via Telnyx to ${context.leadName}`,
          target: context.address || phone,
        }),
      );
      await persistState(state);
      return {
        ok: true,
        message,
        telnyx: {
          live: true,
          configured: true,
          status: telnyxResponse.status,
          response: providerMessage,
        },
      };
    }

    const message = createMessageRecord({
      ...params,
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      phone,
      direction,
      body: bodyText,
      from: fromNumber,
      provider: fromWebhook ? 'Telnyx' : 'Simulated',
    });
    upsertMessage(state, message);
    addActivity(
      state,
      makeActivity({
        actor: direction === 'inbound' ? context.leadName || 'Seller' : 'Ava',
        category: 'SMS',
        status: message.status,
        text:
          direction === 'inbound'
            ? `Inbound SMS: ${message.body || '(empty message)'}`
            : fromWebhook
              ? `Outbound SMS status updated: ${message.body || '(empty message)'}`
              : `Outbound SMS: ${message.body || '(empty message)'}${telnyxMeta.messagingReady ? '' : ' (simulated - add Telnyx messaging keys to go live)'}`,
        target: context.address || phone,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      message,
      telnyx: {
        live: false,
        configured: telnyxMeta.messagingReady,
        simulated: !fromWebhook,
        missing: telnyxMeta.messagingMissing,
      },
    };
  },

  async sendDocuSign(params = {}) {
    recordToolUse('sendDocuSign');
    const docusignMeta = getDocuSignProviderMeta();
    const contract = createContractRecord(params);

    let live = false;
    let envelope = null;
    let providerError = '';

    if (docusignMeta.ready) {
      const response = await fireDocuSignEnvelope(params);
      if (response.ok) {
        live = true;
        envelope = response.envelope;
        contract.envelopeId = envelope?.envelopeId || contract.envelopeId;
        contract.status = envelope?.status === 'created' ? 'draft' : (envelope?.status || contract.status);
      } else {
        providerError = response.error || 'DocuSign envelope create failed.';
      }
    } else if (docusignMeta.configured) {
      providerError = docusignMeta.summary || 'DocuSign provider is configured but not ready.';
    }

    upsertContract(state, contract);
    const queueOnly = !docusignMeta.configured;
    addActivity(
      state,
      makeActivity({
        actor: 'DocuSign',
        category: 'CONTRACT',
        status: live ? contract.status : (queueOnly ? 'pending' : 'warning'),
        text: live
          ? `Sent contract to ${contract.leadName}${contract.amount ? ` for ${currency(contract.amount)}` : ''} (envelope ${envelope?.envelopeId?.slice(0, 12) || ''})`
          : (queueOnly
              ? `DocuSign queued for ${contract.leadName} - DocuSign env not configured.`
              : `DocuSign envelope failed for ${contract.leadName}: ${providerError}`),
        target: contract.address,
      }),
    );
    await persistState(state);
    return {
      ok: live || queueOnly,
      contract,
      envelope,
      docusign: {
        live,
        configured: docusignMeta.configured,
        ready: docusignMeta.ready,
        error: providerError || undefined,
        summary: docusignMeta.summary,
      },
    };
  },

  async sendContract(params = {}) {
    recordToolUse('sendContract');
    return toolHandlers.sendDocuSign(params);
  },

  async skipTrace(params = {}) {
    recordToolUse('skipTrace');
    const batchDataMeta = getBatchDataProviderMeta();

    let contact;
    let live = false;
    let providerError = '';

    if (batchDataMeta.ready) {
      const response = await fireBatchDataSkipTrace(params);
      if (response.ok && response.contact && (response.contact.phone || response.contact.email)) {
        contact = {
          ...inferSkipTraceContact(params),
          ...response.contact,
        };
        live = true;
      } else {
        providerError = response.error || 'BatchData returned no contacts.';
        contact = inferSkipTraceContact(params);
      }
    } else {
      contact = inferSkipTraceContact(params);
    }

    addActivity(
      state,
      makeActivity({
        actor: 'BatchData',
        category: 'SKIPTRACE',
        status: live ? 'complete' : (batchDataMeta.ready ? 'warning' : 'pending'),
        text: live
          ? `Skip trace found ${contact.phone}${contact.email ? ` and ${contact.email}` : ''}`
          : `Skip trace fallback (${providerError || 'BATCHDATA not configured'}) - using inferred contacts.`,
        target: contact.address || contact.leadName,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      contact,
      batchData: {
        live,
        configured: batchDataMeta.configured,
        error: providerError || undefined,
      },
    };
  },

  async detectYelling(params = {}) {
    recordToolUse('detectYelling');
    const transcript = String(params.transcript || params.text || '').trim();
    const normalized = transcript.toLowerCase();
    const explicitStop =
      normalized.includes('stop calling') ||
      normalized.includes('do not call') ||
      normalized.includes('leave me alone') ||
      normalized.includes('take me off');
    const angryWords = ['idiot', 'sue', 'lawsuit', 'angry', 'yell', 'scream', 'mad', 'furious'];
    const angryHits = angryWords.reduce((count, token) => count + (normalized.includes(token) ? 1 : 0), 0);
    const uppercaseHits = (transcript.match(/[A-Z]{4,}/g) || []).length;
    const score = Math.max(
      toNumber(params.score, 0),
      explicitStop ? 0.95 : 0,
      angryHits ? Math.min(0.4 + angryHits * 0.14, 0.92) : 0,
      uppercaseHits ? Math.min(0.35 + uppercaseHits * 0.12, 0.78) : 0,
    );
    const detected = score >= 0.6;

    let dncEntry = null;
    if (detected) {
      dncEntry = buildDncEntry({
        phone: params.phone || params.to || params.number,
        name: params.leadName || params.name,
        reason: explicitStop
          ? 'Seller requested removal during live conversation.'
          : 'Raised-voice / hostility detected during live conversation.',
        source: explicitStop ? 'call-opt-out' : 'anger-detection',
      });

      if (dncEntry.phone && !findDncEntryByPhone(dncEntry.phone)) {
        addDncEntry(state, dncEntry);
      }

      addActivity(
        state,
        makeActivity({
          actor: 'Guardrail',
          category: 'DNC',
          status: 'blocked',
          text: explicitStop
            ? 'Seller opted out during live conversation. Number added to DNC.'
            : 'Raised voice detected. Apology flow triggered and number added to DNC.',
          target: params.address || params.leadName || dncEntry.phone,
        }),
      );
    }

    await persistState(state);
    return {
      ok: true,
      detected,
      score,
      explicitStop,
      dncEntry,
    };
  },

  async slackNotify(params = {}) {
    recordToolUse('slackNotify');
    const slackMeta = getSlackProviderMeta();
    const text = params.text || params.message || 'Slack notification sent from PBK bridge.';

    let live = false;
    let providerStatus = 'sent';
    let providerError = '';

    if (slackMeta.ready) {
      const slackPayload = params.payload || (params.blocks ? { text, blocks: params.blocks } : { text });
      const response = await fireSlackWebhook(slackPayload);
      live = response.ok;
      if (!response.ok) {
        providerStatus = 'warning';
        providerError = response.error || `Slack webhook failed (${response.status || '?'})`;
      }
    } else {
      providerStatus = 'pending';
    }

    addActivity(
      state,
      makeActivity({
        actor: 'Slack',
        category: 'NOTIFY',
        status: providerStatus,
        text: live ? text : `${text}${providerError ? ` (${providerError})` : ' (Slack webhook not configured)'}`,
        target: params.channel || '#deals',
      }),
    );
    await persistState(state);
    return {
      ok: live,
      channel: params.channel || '#deals',
      sentAt: isoNow(),
      slack: {
        live,
        configured: slackMeta.configured,
        error: providerError || undefined,
      },
    };
  },

  async sendSellerDocs(params = {}) {
    recordToolUse('sendSellerDocs');
    const context = findLeadContext(params);
    const documents = normalizeDocumentItems(params);
    const recipientEmail = String(params.email || context.email || '').trim();
    const senderProfile = inferSenderProfile(params.senderProfile);
    const from = getSenderAddress(senderProfile);
    const subject =
      params.subject ||
      `Your property at ${context.address || 'PBK'} - ${documents.length > 1 ? 'seller packet' : 'document package'}`;

    if (!documents.length) {
      return {
        ok: false,
        error: 'No seller documents were provided for delivery.',
      };
    }

    const attachments = [];
    for (const document of documents) {
      attachments.push(
        await buildPdfAttachment(document, {
          ...params,
          leadName: context.leadName,
          address: context.address,
        }),
      );
    }

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#0f172a;line-height:1.6">
        <p>Hi ${escapeHtml(context.leadName || 'there')},</p>
        <p>Attached is the information package we discussed for <strong>${escapeHtml(context.address || 'your property')}</strong>.</p>
        <p>You will find ${documents.map((item) => escapeHtml(item.title)).join(', ')} attached for review. Reply directly to this email if you want us to adjust timing, offer structure, or contract terms.</p>
        <p>Thanks,<br/>${escapeHtml(String(from).split('@')[0] || 'PBK')}<br/>PBK Capital</p>
      </div>
    `;

    const emailResult = await sendTransactionalEmail({
      from,
      to: recipientEmail,
      subject,
      html,
      text: `Hi ${context.leadName || 'there'}, attached is the PBK document package for ${context.address || 'your property'}.`,
      attachments,
    });

    const delivery = createDocumentDeliveryRecord({
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      email: recipientEmail,
      senderProfile,
      documents: documents.map((item) => item.type),
      status: emailResult.ok ? 'sent' : 'failed',
      subject,
      provider: emailResult.provider || (emailResult.live ? 'resend' : 'simulated-email'),
    });

    addDocumentDelivery(state, delivery);
    upsertMessage(
      state,
      createMessageRecord({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        email: recipientEmail,
        channel: 'email',
        direction: 'outbound',
        body: subject,
        status: emailResult.ok ? 'sent' : 'failed',
        provider: delivery.provider,
      }),
    );
    addActivity(
      state,
      makeActivity({
        actor: 'PBK Docs',
        category: 'EMAIL',
        status: emailResult.ok ? 'sent' : 'warning',
        text: emailResult.ok
          ? `Sent ${documents.length} seller document${documents.length === 1 ? '' : 's'} from the ${senderProfile} sender profile.`
          : `Seller document send failed: ${emailResult.error || 'unknown email error'}`,
        target: context.address || recipientEmail || context.leadName,
      }),
    );
    await persistState(state);

    return {
      ok: emailResult.ok,
      delivery,
      email: emailResult,
      attachments: attachments.map((item) => item.filename),
    };
  },

  async prepareContract(params = {}) {
    recordToolUse('prepareContract');
    const templates = await getContractTemplateLibrary();
    const selectedPath = String(params.selectedPath || '').trim().toLowerCase();
    const requestedTemplate = String(params.templateId || params.template || '').trim().toLowerCase();
    const template =
      templates.find((item) => item.id === requestedTemplate || String(item.type || '').toLowerCase() === requestedTemplate) ||
      templates.find((item) => selectedPath && item.id.includes(selectedPath)) ||
      templates[0] || {
        id: 'standard-purchase',
        name: 'standard-purchase',
        type: 'standard-purchase',
        fields: {},
      };

    const contract = createContractRecord({
      ...params,
      status: 'prepared',
      provider: 'PBK Contract Prep',
      documentTitle: `${template.name} - ${params.address || params.leadName || 'PBK contract'}`,
      notes: params.notes || `Prepared from template ${template.name}.`,
      selectedPathLabel: params.selectedPathLabel || selectedPath || template.name,
    });
    contract.templateId = template.id;
    contract.templateFields = template.fields;
    contract.underwritingStatus = 'pending';

    upsertContract(state, contract);
    addActivity(
      state,
      makeActivity({
        actor: 'Underwriting',
        category: 'CONTRACT',
        status: 'queued',
        text: `Prepared ${template.name} for underwriting review.`,
        target: contract.address || contract.leadName,
      }),
    );
    await persistState(state);

    return {
      ok: true,
      contract,
      template,
      templatesAvailable: templates.map((item) => ({ id: item.id, name: item.name })),
    };
  },

  async contractLawyerReview(params = {}) {
    recordToolUse('contractLawyerReview');
    const prepared = await toolHandlers.prepareContract(params);
    const contract = prepared.contract;
    const reviewerEmail = String(params.reviewerEmail || params.underwriterEmail || MAIN_BUSINESS_EMAIL).trim();
    const reviewerName = String(params.reviewerName || params.underwriterName || 'PBK Underwriting Supervisor').trim();
    const sellerNotice = String(
      params.sellerNotice
      || 'Our underwriting department supervisor will make the final sign-off and send the agreement from our main business email for signature. If you have any questions, you can call your acquisitions agent or contact our underwriting department directly.',
    ).trim();
    const approvalNotes = String(
      params.notes
      || `Contract lawyer prepared ${prepared.template?.name || 'the agreement'} for underwriting review. ${sellerNotice}`,
    ).trim();

    const approvalResult = await toolHandlers.createApproval({
      type: 'contract',
      leadId: contract.leadId,
      leadName: contract.leadName,
      address: contract.address,
      offerPrice: contract.amount,
      contractId: contract.id,
      templateId: contract.templateId || prepared.template?.id || '',
      approvalAction: 'underwriting_sign',
      reviewerEmail,
      reviewerName,
      sellerNotice,
      metadata: {
        selectedPath: contract.selectedPath || '',
        selectedPathLabel: contract.selectedPathLabel || '',
      },
      notes: approvalNotes,
    });
    const approval = approvalResult.approval || approvalResult;

    contract.approvalId = approval?.id || contract.approvalId || '';
    contract.underwritingStatus = 'approval-requested';
    contract.underwritingReviewerEmail = reviewerEmail;
    contract.underwritingReviewerName = reviewerName;
    contract.sellerNotice = sellerNotice;
    contract.notes = approvalNotes;
    contract.updatedAt = isoNow();
    upsertContract(state, contract);

    addActivity(
      state,
      makeActivity({
        actor: 'Contract Lawyer',
        category: 'CONTRACT',
        status: 'queued',
        text: `Prepared ${prepared.template?.name || 'contract'} and queued underwriting approval.`,
        target: contract.address || contract.leadName,
      }),
    );
    await persistState(state);

    return {
      ok: true,
      contract,
      template: prepared.template,
      approval,
      sellerNotice,
      nextStep: 'Await underwriting approval callback before DocuSign is sent.',
    };
  },

  async requestAdminAction(params = {}) {
    recordToolUse('requestAdminAction');
    const command = String(params.command || params.query || '').trim();
    const detected = params.detected || detectAdminIntent(command) || {};
    const task = createAdminTaskRecord({
      ...params,
      command,
      detected,
    });

    addAdminTask(state, task);
    addAdminAudit(state, {
      id: `audit-${task.id}`,
      action: task.action,
      provider: task.provider,
      actor: params.requestedBy || 'Rex',
      status: task.status,
      summary: `${task.summary}${task.dryRun ? ' (dry run)' : ''}`,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    });
    addActivity(
      state,
      makeActivity({
        actor: params.requestedBy || 'Rex',
        category: 'ADMIN',
        status: task.requiresApproval ? 'pending' : 'queued',
        text: `${task.summary}${task.requiresApproval ? ' Approval required before execution.' : ''}`,
        target: `${task.provider}:${task.action}`,
      }),
    );
    await persistState(state);

    return {
      ok: true,
      task,
      preview: {
        provider: task.provider,
        action: task.action,
        risk: task.risk,
        requiresApproval: task.requiresApproval,
        costEstimate: task.costEstimate,
      },
    };
  },

  async runAgentCommand(params = {}) {
    recordToolUse('runAgentCommand');
    const command = String(params.command || params.text || '').trim();
    const parsedContext = extractCommandContext(command);
    const context = findLeadContext({
      ...parsedContext,
      ...params,
    });
    const lower = command.toLowerCase();

    addActivity(
      state,
      makeActivity({
        actor: 'Jordan',
        category: 'COMMAND',
        status: 'received',
        text: command ? `Command sent to Ava: ${command}` : 'Blank command received.',
        target: context.leadName || 'Agent console',
      }),
    );

    let routedTo = 'updateCRM';
    let response = null;

    if (looksLikeBrowserResearchIntent(command)) {
      routedTo = 'launchBrowserResearch';
      response = await toolHandlers.launchBrowserResearch({
        query: command,
        requestedBy: params.actor || 'Jordan',
        source: 'agent-console',
      });
    } else if (looksLikeAdminIntent(command)) {
      response = await toolHandlers.routeAdminCommand({
        command,
        requestedBy: params.actor || 'Jordan',
      });
      routedTo = response?.routedTo || 'routeAdminCommand';
    } else if (lower.includes('cold email') || lower.includes('send email') || lower.includes('follow-up email')) {
      routedTo = 'sendColdEmail';
      response = await toolHandlers.sendColdEmail({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        email: params.email || context.email,
        templateId: params.templateId || (lower.includes('probate') ? 'probate' : lower.includes('absentee') ? 'absentee' : 'generic'),
      });
    } else if (lower.includes('book call') || lower.includes('book appointment') || lower.includes('calendar') || lower.includes('schedule call')) {
      routedTo = 'scheduleAppointment';
      response = await toolHandlers.scheduleAppointment({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        email: params.email || context.email,
        phone: params.phone || context.phone,
        startTime: params.startTime || params.scheduledFor || new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        timezone: params.timezone || 'America/New_York',
        source: 'agent-console',
      });
    } else if (lower.includes('contract') || lower.includes('docusign') || lower.includes('docu sign')) {
      routedTo = 'sendDocuSign';
      response = await toolHandlers.sendDocuSign({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone: context.phone,
        amount: toNumber(params.amount || params.offerPrice, 98500),
        notes: command,
      });
    } else if (lower.includes('text') || lower.includes('sms')) {
      routedTo = 'telnyx_sms';
      response = await toolHandlers.telnyx_sms({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone: context.phone,
        body:
          params.body ||
          `Hi ${context.leadName.split(' ')[0] || 'there'}, this is Ava with PBK. Wanted to follow up on ${context.address}.`,
      });
    } else if (lower.includes('call') || lower.includes('dial')) {
      routedTo = 'telnyx_call';
      response = await toolHandlers.telnyx_call({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone: context.phone,
        script: command,
      });
    } else if (lower.includes('analy') || lower.includes('mao') || lower.includes('arv')) {
      routedTo = 'analyzeDeal';
      response = await toolHandlers.analyzeDeal({
        leadId: context.leadId,
        address: context.address,
        deal: params.deal || {},
      });
    } else if (lower.includes('approval')) {
      routedTo = 'createApproval';
      response = await toolHandlers.createApproval({
        type: params.type || 'offer',
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        offerPrice: toNumber(params.offerPrice, 78000),
        mao: toNumber(params.mao, 91500),
        notes: command,
      });
    } else {
      response = await toolHandlers.updateCRM({
        message: `Ava logged command: ${command || 'No command text provided.'}`,
        target: context.address || context.leadName,
      });
    }

    addActivity(
      state,
      makeActivity({
        actor: 'Ava',
        category: 'DECISION',
        status: 'queued',
        text: `Ava routed the command to ${routedTo}.`,
        target: context.address || context.leadName,
      }),
    );

    await persistState(state);
    return {
      ok: true,
      command,
      routedTo,
      response,
    };
  },
};

async function handleEvent(eventType, payload = {}) {
  const normalizedEvent = String(eventType || '').trim().toLowerCase();

  if (normalizedEvent === 'lead-intake' || normalizedEvent === 'lead-import') {
    const fromN8nLeadIntake = payload?._source === 'n8n-lead-intake';
    const eventId = payload?.eventId || payload?.event_id || null;

    // Replay short-circuit: if we've already processed this eventId, return
    // without mutating state or appending activity. Catches n8n retries.
    if (eventId) {
      const prior = state.leadImports.find((item) => item && item.eventId === eventId);
      if (prior) {
        return {
          ok: true,
          replayed: true,
          leadImport: prior,
          eventId,
        };
      }
    }

    if (LEAD_WEBHOOK_URL && !fromN8nLeadIntake) {
      addActivity(
        state,
        makeActivity({
          actor: 'System',
          category: 'IMPORT',
          status: 'queued',
          text: `Forwarded lead intake to n8n from ${payload.source || 'manual bridge event'}`,
          target: payload?.seller?.name || payload.name || payload.address || 'lead intake',
        }),
      );
      await persistState(state);
      const fanout = await fireWebhook(LEAD_WEBHOOK_URL, {
        ...payload,
        _source: payload?._source || 'openclaw-bridge',
      });
      return {
        ok: true,
        forwarded: true,
        fanout,
      };
    }

    const leadImport = normalizeLeadIntake(payload);
    if (eventId) leadImport.eventId = eventId;
    const dedupeKey = `${slugify(leadImport.property.address)}::${normalizePhone(leadImport.seller.phone)}`;
    const duplicate = state.leadImports.find((item) => {
      const itemKey = `${slugify(item?.property?.address || '')}::${normalizePhone(item?.seller?.phone || '')}`;
      return item.leadId === leadImport.leadId || itemKey === dedupeKey;
    });

    if (!duplicate) {
      addLeadImport(state, leadImport);
    }

    addActivity(
      state,
      makeActivity({
        actor: 'n8n',
        category: 'IMPORT',
        status: duplicate ? 'updated' : 'complete',
        text: `${duplicate ? 'Lead refreshed' : 'Lead intake normalized'} from ${leadImport.source}`,
        target: leadImport.seller.name,
      }),
    );

    let queuedAnalyzer = null;
    if (leadImport.property.address) {
      queuedAnalyzer = {
        id: randomUUID(),
        leadId: leadImport.leadId,
        address: leadImport.property.address,
        arv: 0,
        repairsMid: 0,
        mao: 0,
        targetOffer: 0,
        estProfit: 0,
        status: 'queued',
        createdAt: isoNow(),
      };
      addAnalyzerRun(state, queuedAnalyzer);
      addActivity(
        state,
        makeActivity({
          actor: 'System',
          category: 'ANALYZE',
          status: 'queued',
          text: 'Analyzer queued from lead intake workflow',
          target: leadImport.property.address,
        }),
      );
    }

    await persistState(state);
    return {
      ok: true,
      leadImport: duplicate || leadImport,
      duplicate: Boolean(duplicate),
      queuedAnalyzer,
    };
  }

  if (normalizedEvent === 'approval-callback') {
    const approval = state.approvals.find((item) => item.id === payload.id);
    if (!approval) {
      return {
        ok: false,
        error: `Approval ${payload.id} was not found.`,
      };
    }

    // Replay short-circuit: if status/actor/actedAt already match incoming
    // payload, n8n is just retrying. No mutation, no extra activity entry.
    const incomingStatus = payload.status || approval.status;
    const incomingActor = payload.actor || approval.actor || 'n8n';
    const incomingActedAt = payload.actedAt || approval.actedAt || null;
    if (
      approval.status === incomingStatus &&
      approval.actor === incomingActor &&
      incomingActedAt &&
      approval.actedAt === incomingActedAt
    ) {
      return {
        ok: true,
        replayed: true,
        approval,
      };
    }

    approval.status = incomingStatus;
    approval.actor = incomingActor;
    approval.actedAt = incomingActedAt || isoNow();
    approval.notes = payload.notes || approval.notes;
    let contractResult = null;
    if (approval.type === 'contract' && approval.contractId) {
      const contract = state.contracts.find((item) => item.id === approval.contractId);
      if (contract) {
        contract.approvalId = approval.id;
        if (
          approval.status === 'approved'
          && approval.approvalAction === 'underwriting_sign'
          && String(contract.underwritingStatus || '').toLowerCase() !== 'sent'
        ) {
          const signers = [];
          const reviewerEmail = String(approval.reviewerEmail || contract.underwritingReviewerEmail || MAIN_BUSINESS_EMAIL).trim();
          if (reviewerEmail) {
            signers.push({
              name: approval.reviewerName || contract.underwritingReviewerName || 'PBK Underwriting',
              email: reviewerEmail,
            });
          }
          if (contract.email) {
            signers.push({
              name: contract.leadName || 'Seller',
              email: contract.email,
            });
          }

          contractResult = await toolHandlers.sendDocuSign({
            ...contract,
            notes: approval.sellerNotice || contract.sellerNotice || contract.notes || 'Prepared for underwriting sign-off.',
            signers,
          });
          const deliveredContract = contractResult?.contract || contract;
          deliveredContract.approvalId = approval.id;
          deliveredContract.underwritingStatus = contractResult?.ok
            ? 'sent'
            : contractResult?.docusign?.configured
              ? 'provider-error'
              : 'pending';
          deliveredContract.underwritingReviewerEmail = reviewerEmail;
          deliveredContract.underwritingReviewerName = approval.reviewerName || contract.underwritingReviewerName || 'PBK Underwriting';
          deliveredContract.sellerNotice = approval.sellerNotice || contract.sellerNotice || '';
          deliveredContract.updatedAt = isoNow();
          upsertContract(state, deliveredContract);
        } else if (approval.status !== 'approved') {
          contract.underwritingStatus = 'needs-revision';
          contract.updatedAt = isoNow();
          upsertContract(state, contract);
        }
      }
    }

    addActivity(
      state,
      makeActivity({
        actor: approval.actor,
        category: approval.status === 'approved' ? 'APPROVED' : 'REJECTED',
        status: approval.status === 'approved' ? 'success' : 'warning',
        text: `${approval.type} ${approval.status}${approval.offerPrice ? ` for ${currency(approval.offerPrice)}` : ''}`,
        target: approval.address || approval.leadName,
      }),
    );

    await persistState(state);
    return {
      ok: true,
      approval,
      contractResult,
    };
  }

  if (normalizedEvent === 'brain-doc') {
    return toolHandlers.ingestResearchDoc(payload);
  }

  if (normalizedEvent === 'dnc-add') {
    const entry = buildDncEntry(payload);
    const existing = findDncEntryByPhone(entry.phone);
    if (!existing && entry.phone) {
      addDncEntry(state, entry);
    }
    addActivity(
      state,
      makeActivity({
        actor: 'Guardrail',
        category: 'DNC',
        status: 'blocked',
        text: `Added ${entry.phone || 'number'} to DNC`,
        target: entry.reason,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      entry: existing || entry,
      duplicate: Boolean(existing),
    };
  }

  if (normalizedEvent === 'dnc-remove') {
    const phone = normalizePhone(payload.phone || payload.number || '');
    const existingIndex = state.dncEntries.findIndex(
      (entry) => entry.id === payload.id || (phone && normalizePhone(entry.phone) === phone),
    );
    if (existingIndex === -1) {
      return {
        ok: false,
        error: 'DNC entry not found.',
      };
    }
    const [removed] = state.dncEntries.splice(existingIndex, 1);
    addActivity(
      state,
      makeActivity({
        actor: payload.actor || 'PBK dashboard',
        category: 'DNC',
        status: 'success',
        text: `Removed ${removed.phone} from DNC`,
        target: removed.reason,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      removed,
    };
  }

  if (normalizedEvent === 'call-control') {
    const call =
      state.calls.find((item) => item.id === payload.id) ||
      state.calls.find((item) => normalizePhone(item.phone) === normalizePhone(payload.phone || payload.to || '')) ||
      state.calls.find((item) => item.status === 'live');

    if (!call) {
      return {
        ok: false,
        error: 'No matching call found.',
      };
    }

    const action = String(payload.action || '').trim().toLowerCase();
    if (action === 'takeover' || action === 'take over') {
      call.humanJoined = true;
      call.status = 'live';
      call.updatedAt = isoNow();
      addActivity(
        state,
        makeActivity({
          actor: payload.actor || 'PBK dashboard',
          category: 'CALL',
          status: 'live',
          text: `Human takeover engaged for ${call.leadName}`,
          target: call.address || call.phone,
        }),
      );
    } else if (action === 'mute' || action === 'mute ai') {
      call.aiMuted = true;
      call.updatedAt = isoNow();
      addActivity(
        state,
        makeActivity({
          actor: payload.actor || 'PBK dashboard',
          category: 'CALL',
          status: 'queued',
          text: `AI muted on live call with ${call.leadName}`,
          target: call.address || call.phone,
        }),
      );
    } else if (action === 'transfer') {
      call.status = 'transferred';
      call.transferTarget = payload.target || 'human';
      call.updatedAt = isoNow();
      addActivity(
        state,
        makeActivity({
          actor: payload.actor || 'PBK dashboard',
          category: 'CALL',
          status: 'queued',
          text: `Transferred ${call.leadName} to ${call.transferTarget}`,
          target: call.address || call.phone,
        }),
      );
    } else if (action === 'end' || action === 'hangup' || action === 'hang up') {
      call.status = 'ended';
      call.endedAt = isoNow();
      call.updatedAt = isoNow();
      addActivity(
        state,
        makeActivity({
          actor: payload.actor || 'PBK dashboard',
          category: 'CALL',
          status: 'success',
          text: `Ended call with ${call.leadName}`,
          target: call.address || call.phone,
        }),
      );
    }

    upsertCall(state, call);
    await persistState(state);
    return {
      ok: true,
      call,
    };
  }

  if (normalizedEvent === 'call-status') {
    const existingCall = state.calls.find(
      (item) =>
        item.id === payload.id ||
        item.id === payload.callId ||
        item.id === payload.call_control_id ||
        (normalizePhone(item.phone) && normalizePhone(item.phone) === normalizePhone(payload.phone || payload.to || '')),
    );
    if (
      existingCall &&
      existingCall.status === (payload.status || existingCall.status) &&
      normalizePhone(existingCall.phone) === normalizePhone(payload.phone || payload.to || existingCall.phone || '')
    ) {
      return {
        ok: true,
        replayed: true,
        call: existingCall,
      };
    }

    const call = createCallRecord({
      ...payload,
      id: payload.id || payload.callId || payload.call_control_id || randomUUID(),
      status: payload.status || 'live',
    });
    upsertCall(state, call);
    addActivity(
      state,
      makeActivity({
        actor: payload.actor || 'Telnyx',
        category: 'CALL',
        status: payload.status || 'live',
        text: `Call status update: ${payload.status || 'live'} for ${call.leadName}`,
        target: call.address || call.phone,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      call,
    };
  }

  if (normalizedEvent === 'call-transcript') {
    const call =
      state.calls.find((item) => item.id === payload.id) ||
      state.calls.find((item) => normalizePhone(item.phone) === normalizePhone(payload.phone || '')) ||
      state.calls.find((item) => item.status === 'live');
    if (!call) {
      return {
        ok: false,
        error: 'No matching call found for transcript update.',
      };
    }

    call.transcript = Array.isArray(call.transcript) ? call.transcript : [];
    if (payload.text) {
      call.transcript.push({
        speaker: payload.speaker || 'Seller',
        text: payload.text,
      });
    }
    call.updatedAt = isoNow();
    upsertCall(state, call);

    let yelling = null;
    if (payload.text) {
      yelling = await toolHandlers.detectYelling({
        transcript: payload.text,
        phone: call.phone,
        leadName: call.leadName,
        address: call.address,
      });
    }

    await persistState(state);
    return {
      ok: true,
      call,
      yelling,
    };
  }

  if (normalizedEvent === 'sms-inbound' || normalizedEvent === 'sms-outbound') {
    return toolHandlers.telnyx_sms({
      ...payload,
      direction: normalizedEvent === 'sms-inbound' ? 'inbound' : 'outbound',
      _fromTelnyxWebhook: true,
    });
  }

  if (normalizedEvent === 'booking-confirmed' || normalizedEvent === 'appointment-booked') {
    const result = await toolHandlers.scheduleAppointment({
      ...payload,
      status: payload.status || 'scheduled',
      source: payload.source || payload.provider || 'booking-webhook',
    });
    addActivity(
      state,
      makeActivity({
        actor: payload.actor || 'Cal.com',
        category: 'BOOKING',
        status: 'queued',
        text: `Scheduled follow-up call prep for ${result.appointment.leadName}.`,
        target: result.appointment.address || result.appointment.leadName,
      }),
    );
    await persistState(state);
    return result;
  }

  if (normalizedEvent === 'contract-status' || normalizedEvent === 'contract-signed') {
    const nextStatus = normalizedEvent === 'contract-signed' ? 'completed' : payload.status || 'updated';
    const existingContract = state.contracts.find((item) =>
      item.id === payload.id
      || item.id === payload.contractId
      || item.envelopeId === payload.id
      || item.envelopeId === payload.envelopeId,
    ) || null;
    const contract = createContractRecord({
      ...(existingContract || {}),
      ...payload,
      id: existingContract?.id || payload.id || payload.contractId || payload.envelopeId || randomUUID(),
      status: nextStatus,
      approvalId: payload.approvalId || existingContract?.approvalId || '',
      templateId: payload.templateId || existingContract?.templateId || '',
      templateFields: payload.templateFields || existingContract?.templateFields || {},
      underwritingStatus:
        normalizedEvent === 'contract-signed'
          ? 'completed'
          : payload.underwritingStatus || existingContract?.underwritingStatus || '',
    });
    upsertContract(state, contract);
    addActivity(
      state,
      makeActivity({
        actor: payload.actor || 'DocuSign',
        category: 'CONTRACT',
        status: nextStatus,
        text: `Contract ${nextStatus} for ${contract.leadName}`,
        target: contract.address,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      contract,
    };
  }

  if (normalizedEvent === 'lead-command' || normalizedEvent === 'agent-command') {
    return toolHandlers.runAgentCommand(payload);
  }

  if (normalizedEvent === 'notification') {
    return toolHandlers.slackNotify(payload);
  }

  addActivity(
    state,
    makeActivity({
      actor: payload.actor || 'System',
      category: (normalizedEvent || 'EVENT').toUpperCase(),
      status: payload.status || 'received',
      text: payload.text || `Received event ${normalizedEvent}.`,
      target: payload.target || '',
    }),
  );
  await persistState(state);
  return {
    ok: true,
    received: normalizedEvent,
  };
}

function buildStateSnapshot() {
  updateDerivedStatus(state);
  const runtimeMeta = getRuntimeMeta();
  return {
    status: {
      ...state.status,
      providers: {
        telnyx: getTelnyxProviderMeta(),
        instantly: getInstantlyProviderMeta(),
        googleCalendar: getGoogleCalendarProviderMeta(),
        streak: getStreakProviderMeta(),
        crmSync: getCrmSyncProviderMeta(),
        docusign: getDocuSignProviderMeta(),
        batchdata: getBatchDataProviderMeta(),
        slack: getSlackProviderMeta(),
        render: getRenderProviderMeta(),
      },
      stateBackend: runtimeMeta.stateBackend,
      authRequired: runtimeMeta.authRequired,
      productionReady: runtimeMeta.productionReady,
    },
    approvals: state.approvals,
    activity: state.activity,
    brainDocs: state.brainDocs,
    leadImports: state.leadImports,
    analyzerRuns: state.analyzerRuns,
    dncEntries: state.dncEntries,
    calls: state.calls,
    messages: state.messages,
    appointments: state.appointments,
    leadStageTransitions: state.leadStageTransitions,
    contracts: state.contracts,
    documentDeliveries: state.documentDeliveries,
    adminTasks: state.adminTasks,
    adminAudit: state.adminAudit,
  };
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  response.end(body);
}

function sendBinary(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...headers,
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function matchesPath(pathname, pathnames) {
  return pathnames.includes(pathname);
}

function matchPath(pathname, pattern) {
  const regex = new RegExp(
    `^${pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-zA-Z0-9_]+)/g, '(?<$1>[^/]+)')}$`,
  );
  return pathname.match(regex);
}

function mapTelnyxWebhook(body = {}) {
  const eventType = String(body.data?.event_type || body.event_type || body.type || '').toLowerCase();
  const payload = body.data?.payload || body.payload || body.data || body;
  const payloadTo = Array.isArray(payload.to)
    ? payload.to[0]?.phone_number || payload.to[0]
    : payload.to?.phone_number || payload.to;
  const payloadFrom = Array.isArray(payload.from)
    ? payload.from[0]?.phone_number || payload.from[0]
    : payload.from?.phone_number || payload.from;

  if (eventType.includes('message')) {
    return {
      eventType: eventType.includes('received') ? 'sms-inbound' : 'sms-outbound',
      payload: {
        id: payload.id || payload.message_id,
        phone: payloadTo || payloadFrom || payload.phone_number,
        body: payload.text || payload.body || '',
        direction: eventType.includes('received') ? 'inbound' : 'outbound',
        status: payload.status || (eventType.includes('received') ? 'received' : 'sent'),
        leadName: payload.contact_name || '',
        actor: 'Telnyx',
      },
    };
  }

  if (eventType.includes('call')) {
    return {
      eventType: 'call-status',
      payload: {
        id: payload.call_control_id || payload.id || randomUUID(),
        phone: payloadTo || payloadFrom || payload.phone_number,
        status: eventType.includes('hangup')
          ? 'ended'
          : eventType.includes('answered')
            ? 'live'
            : eventType.includes('bridged')
              ? 'transferred'
              : 'queued',
        leadName: payload.contact_name || '',
        address: payload.address || '',
        actor: 'Telnyx',
        call_control_id: payload.call_control_id || payload.id || '',
      },
    };
  }

  return {
    eventType: 'notification',
    payload: {
      actor: 'Telnyx',
      text: `Unhandled Telnyx webhook ${eventType || 'unknown'}`,
      target: 'telnyx',
    },
  };
}

function mapDocuSignWebhook(body = {}) {
  const status = String(
    body.status ||
      body.event ||
      body.envelopeStatus ||
      body.data?.envelopeSummary?.status ||
      '',
  ).toLowerCase();

  return {
    eventType: ['completed', 'signed'].includes(status) ? 'contract-signed' : 'contract-status',
    payload: {
      id: body.id || body.envelopeId || body.data?.envelopeId || randomUUID(),
      envelopeId: body.envelopeId || body.data?.envelopeId || '',
      status: status || 'updated',
      leadName: body.leadName || body.signerName || '',
      address: body.address || '',
      amount: body.amount || body.offerPrice || 0,
    },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    response.end();
    return;
  }

  // Bearer-token gate. Skipped entirely when PBK_BRIDGE_API_KEY is unset
  // (local dev). Healthcheck endpoints stay open so Render's healthCheckPath
  // and external monitors keep working without credentials.
  if (BRIDGE_API_KEY && !PUBLIC_PATHS.has(pathname)) {
    const header = String(request.headers.authorization || '').trim();
    const expected = `Bearer ${BRIDGE_API_KEY}`;
    if (header !== expected) {
      json(response, 401, {
        ok: false,
        error: 'Unauthorized',
        hint: 'Send Authorization: Bearer <PBK_BRIDGE_API_KEY> on POST endpoints.',
      });
      return;
    }
  }

  try {
    if (request.method === 'GET' && matchesPath(pathname, ['/', '/health', '/status', '/api/health', '/api/status'])) {
      const runtimeMeta = getRuntimeMeta();
      json(response, 200, {
        ok: true,
        service: 'pbk-local-openclaw',
        revision: BUILD_REVISION,
        host: HOST,
        port: PORT,
        tools: state.status.tools,
        toolUsage: state.status.toolUsage,
        n8n: state.status.n8n,
        providers: {
          telnyx: getTelnyxProviderMeta(),
          instantly: getInstantlyProviderMeta(),
          googleCalendar: getGoogleCalendarProviderMeta(),
          streak: getStreakProviderMeta(),
          crmSync: getCrmSyncProviderMeta(),
          docusign: getDocuSignProviderMeta(),
          batchdata: getBatchDataProviderMeta(),
          slack: getSlackProviderMeta(),
          render: getRenderProviderMeta(),
        },
        features: {
          documentsPdf: true,
          approvals: true,
          contracts: true,
          analyzerBridge: true,
          sellerDocs: true,
          quotas: true,
          adminTasks: true,
          emailWebhooks: true,
          authRequired: runtimeMeta.authRequired,
          stateBackend: runtimeMeta.stateBackend,
          productionReady: runtimeMeta.productionReady,
          hosted: runtimeMeta.hosted,
          mode: runtimeMeta.mode,
        },
        runtime: runtimeMeta,
        warnings: runtimeMeta.warnings,
        lastUpdatedAt: state.status.lastUpdatedAt,
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/state', '/api/state'])) {
      json(response, 200, buildStateSnapshot());
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/api/tools'])) {
      const runtimeMeta = getRuntimeMeta();
      json(response, 200, {
        ok: true,
        revision: BUILD_REVISION,
        features: {
          documentsPdf: true,
          sellerDocs: true,
          quotas: true,
          adminTasks: true,
          authRequired: runtimeMeta.authRequired,
          stateBackend: runtimeMeta.stateBackend,
        },
        runtime: runtimeMeta,
        tools: TOOL_NAMES,
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/quotas') {
      json(response, 200, {
        ok: true,
        quotas: buildQuotasSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/tooling/status') {
      json(response, 200, {
        ok: true,
        tooling: await buildToolingStatus(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/brain/email-context') {
      const result = await toolHandlers.getBrainEmailContext({
        leadId: url.searchParams.get('leadId') || '',
        leadName: url.searchParams.get('leadName') || '',
        address: url.searchParams.get('address') || '',
        email: url.searchParams.get('email') || '',
        templateId: url.searchParams.get('templateId') || '',
        requestedBy: url.searchParams.get('requestedBy') || 'api',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/participants/profile') {
      const result = await toolHandlers.getParticipantProfile({
        leadId: url.searchParams.get('leadId') || '',
        leadName: url.searchParams.get('leadName') || '',
        address: url.searchParams.get('address') || '',
        email: url.searchParams.get('email') || '',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/crm/streak/status') {
      const expectedStages = url.searchParams.getAll('expectedStage');
      const result = await toolHandlers.inspectStreakPipeline({
        refresh: /^(1|true|yes)$/i.test(String(url.searchParams.get('refresh') || '').trim()),
        expectedStages,
        requestedBy: url.searchParams.get('requestedBy') || 'api',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/crm/streak/bootstrap-plan') {
      const expectedStages = url.searchParams.getAll('expectedStage');
      const result = await toolHandlers.getStreakBootstrapPlan({
        refresh: /^(1|true|yes)$/i.test(String(url.searchParams.get('refresh') || '').trim()),
        expectedStages,
        requestedBy: url.searchParams.get('requestedBy') || 'api',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/metrics') {
      sendText(response, 200, buildPrometheusMetrics(), 'text/plain; version=0.0.4; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && pathname === '/api/contracts/templates') {
      json(response, 200, {
        ok: true,
        templates: await getContractTemplateLibrary(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/appointments') {
      json(response, 200, {
        ok: true,
        appointments: state.appointments,
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/replies/templates') {
      const result = await toolHandlers.getReplyTemplates({
        leadId: url.searchParams.get('leadId') || '',
        leadName: url.searchParams.get('leadName') || '',
        address: url.searchParams.get('address') || '',
        email: url.searchParams.get('email') || '',
        phone: url.searchParams.get('phone') || '',
        body: url.searchParams.get('body') || '',
        channel: url.searchParams.get('channel') || 'email',
        provider: url.searchParams.get('provider') || 'api',
        startTime: url.searchParams.get('startTime') || '',
        timezone: url.searchParams.get('timezone') || '',
        bookingUrl: url.searchParams.get('bookingUrl') || '',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/participants/classify') {
      const body = await readBody(request);
      const result = await toolHandlers.classifyParticipant(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/lead-transitions') {
      const leadId = String(url.searchParams.get('leadId') || '').trim();
      const address = String(url.searchParams.get('address') || '').trim().toLowerCase();
      const toStage = String(url.searchParams.get('toStage') || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(200, toNumber(url.searchParams.get('limit') || '50', 50)));
      const transitions = state.leadStageTransitions.filter((transition) => {
        if (leadId && String(transition.leadId || '').trim() !== leadId) return false;
        if (address && String(transition.address || '').trim().toLowerCase() !== address) return false;
        if (toStage && String(transition.toStage || '').trim().toLowerCase() !== toStage) return false;
        return true;
      });
      json(response, 200, {
        ok: true,
        transitions: transitions.slice(0, limit),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/documents/pdf') {
      const body = await readBody(request);
      const pdf = await generatePdfDocument(body);
      const filename = `${safeFilename(body.documentTitle || body.documentType || 'PBK_Master_Deal_Package')}_${new Date()
        .toISOString()
        .replace(/[-:T.Z]/g, '')
        .slice(0, 14)}.pdf`;

      sendBinary(response, 200, pdf, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/send-seller-docs') {
      const body = await readBody(request);
      const result = await toolHandlers.sendSellerDocs(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/cold-email/send') {
      const body = await readBody(request);
      const result = await toolHandlers.sendColdEmail(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/replies/handle') {
      const body = await readBody(request);
      const result = await toolHandlers.handleReplyIntent(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/crm/streak/bootstrap') {
      const body = await readBody(request);
      const result = await toolHandlers.bootstrapStreakPipeline(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/browser-research/launch') {
      const body = await readBody(request);
      const result = await toolHandlers.launchBrowserResearch(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/invoke', '/api/invoke'])) {
      const body = await readBody(request);
      const toolName = body.toolName;
      const params = body.params || {};
      if (!toolHandlers[toolName]) {
        json(response, 404, {
          ok: false,
          error: `Unknown tool: ${toolName}`,
          tools: Object.keys(toolHandlers),
        });
        return;
      }

      const result = await toolHandlers[toolName](params);
      json(response, 200, {
        ok: true,
        toolName,
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/events', '/api/events'])) {
      const body = await readBody(request);
      const eventType = body.eventType || body.type || body.event || '';
      const payload = body.payload || body.data || body;

      if (!eventType) {
        json(response, 400, {
          ok: false,
          error: 'eventType is required',
        });
        return;
      }

      const result = await handleEvent(eventType, payload);
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/tasks') {
      json(response, 200, {
        ok: true,
        adminTasks: state.adminTasks,
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/audit') {
      json(response, 200, {
        ok: true,
        adminAudit: state.adminAudit,
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/persistence') {
      const result = await toolHandlers.getAdminPersistenceStatus();
      json(response, 200, {
        ...result,
        state: {
          status: buildStateSnapshot().status,
        },
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/docusign/status') {
      const result = await toolHandlers.getDocuSignProviderStatus();
      json(response, 200, {
        ...result,
        state: {
          status: buildStateSnapshot().status,
        },
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/route') {
      const body = await readBody(request);
      const result = await toolHandlers.routeAdminCommand(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/request') {
      const body = await readBody(request);
      const result = await toolHandlers.requestAdminAction(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const adminTaskMatch = matchPath(pathname, '/api/admin/tasks/:id');
    if (adminTaskMatch && request.method === 'PUT') {
      const body = await readBody(request);
      const task = state.adminTasks.find((item) => item.id === adminTaskMatch.groups.id);
      if (!task) {
        json(response, 404, {
          ok: false,
          error: `Admin task ${adminTaskMatch.groups.id} was not found.`,
        });
        return;
      }

      const requestedStatus = body.status || body.action || task.status;
      const statusBefore = task.status;
      task.status = requestedStatus;
      task.updatedAt = isoNow();
      task.actor = body.actor || 'api';
      task.notes = body.notes || task.notes || '';

      let execution = null;
      if (['approved', 'executing', 'complete'].includes(String(task.status).toLowerCase())) {
        const executionOverrides = {
          ...body,
          dryRun: body.dryRun ?? (String(requestedStatus).toLowerCase() === 'approved' ? false : task.dryRun),
        };
        execution = await executeAdminTask(task, executionOverrides);
        if (String(task.status).toLowerCase() === 'approved') task.status = execution.ok ? 'complete' : 'warning';
        recordAdminExecution(task, execution, {
          statusBefore,
          statusAfter: task.status,
          requestedBy: task.actor,
        });
      }

      addAdminAudit(state, {
        id: `audit-${task.id}-${Date.now()}`,
        action: task.action,
        provider: task.provider,
        actor: task.actor,
        status: task.status,
        summary: `${task.notes || `${task.provider}:${task.action} moved to ${task.status}`}${execution?.details ? ` · ${execution.details}` : ''}`,
        createdAt: isoNow(),
        updatedAt: isoNow(),
      });
      addActivity(
        state,
        makeActivity({
          actor: task.actor || 'api',
          category: 'ADMIN',
          status: task.status === 'complete' ? 'success' : task.status,
          text: `${task.provider}:${task.action} is now ${task.status}.`,
          target: task.command || `${task.provider}:${task.action}`,
        }),
      );
      await persistState(state);
      json(response, 200, {
        ok: true,
        task,
        execution,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/approvals') {
      json(response, 200, {
        ok: true,
        approvals: state.approvals,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/approvals') {
      const body = await readBody(request);
      const result = await toolHandlers.createApproval(body);
      json(response, 200, {
        ok: true,
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const approvalMatch = matchPath(pathname, '/api/approvals/:id');
    if (approvalMatch && request.method === 'PUT') {
      const body = await readBody(request);
      const result = await handleEvent('approval-callback', {
        id: approvalMatch.groups.id,
        status: body.status || body.action || 'approved',
        actor: body.actor || 'api',
        actedAt: body.actedAt || isoNow(),
        notes: body.notes || '',
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/dnc') {
      json(response, 200, {
        ok: true,
        dncEntries: state.dncEntries,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/dnc') {
      const body = await readBody(request);
      const result = await handleEvent('dnc-add', body);
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const dncMatch = matchPath(pathname, '/api/dnc/:id');
    if (dncMatch && request.method === 'DELETE') {
      const result = await handleEvent('dnc-remove', {
        id: dncMatch.groups.id,
        actor: 'api',
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/calls') {
      json(response, 200, {
        ok: true,
        calls: state.calls,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/calls') {
      const body = await readBody(request);
      const result = await toolHandlers.telnyx_call(body);
      json(response, result.ok === false ? 409 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const callActionMatch = matchPath(pathname, '/api/calls/:id/action');
    if (callActionMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await handleEvent('call-control', {
        id: callActionMatch.groups.id,
        action: body.action,
        target: body.target,
        actor: body.actor || 'api',
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/messages') {
      json(response, 200, {
        ok: true,
        messages: state.messages,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/messages') {
      const body = await readBody(request);
      const result = await toolHandlers.telnyx_sms(body);
      json(response, result.ok === false ? 409 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/contracts') {
      json(response, 200, {
        ok: true,
        contracts: state.contracts,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/contracts') {
      const body = await readBody(request);
      const result = await toolHandlers.sendDocuSign(body);
      json(response, 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/contracts/prepare') {
      const body = await readBody(request);
      const result = await toolHandlers.prepareContract(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/contracts/lawyer-review') {
      const body = await readBody(request);
      const result = await toolHandlers.contractLawyerReview(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const contractActionMatch = matchPath(pathname, '/api/contracts/:id/action');
    if (contractActionMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await handleEvent('contract-status', {
        id: contractActionMatch.groups.id,
        status: body.status || body.action || 'updated',
        actor: body.actor || 'api',
        leadName: body.leadName,
        address: body.address,
        amount: body.amount,
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/underwriting/sign') {
      const body = await readBody(request);
      const contractId = body.contractId || body.id;
      const contract = state.contracts.find((item) => item.id === contractId);
      if (!contract) {
        json(response, 404, {
          ok: false,
          error: 'Contract not found for underwriting sign-off.',
        });
        return;
      }

      const signers = [];
      const reviewerEmail = String(body.reviewerEmail || body.underwriterEmail || MAIN_BUSINESS_EMAIL).trim();
      if (reviewerEmail) {
        signers.push({
          name: body.reviewerName || body.underwriterName || 'PBK Underwriting',
          email: reviewerEmail,
        });
      }
      if (contract.email) {
        signers.push({
          name: contract.leadName || 'Seller',
          email: contract.email,
        });
      }

      const result = await toolHandlers.sendDocuSign({
        ...contract,
        ...body,
        id: contract.id,
        leadId: contract.leadId,
        leadName: contract.leadName,
        address: contract.address,
        email: contract.email,
        amount: contract.amount,
        notes: body.notes || contract.notes || 'Prepared for underwriting sign-off.',
        signers,
      });

      contract.underwritingStatus = result.ok ? 'sent' : 'pending';
      contract.updatedAt = isoNow();
      await persistState(state);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        contract,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/leads/import') {
      json(response, 200, {
        ok: true,
        leadImports: state.leadImports,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/leads/import') {
      const body = await readBody(request);
      const result = await handleEvent('lead-intake', body);
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/appointments') {
      const body = await readBody(request);
      const result = await toolHandlers.scheduleAppointment(body);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/webhooks/booking') {
      const body = await readBody(request);
      const result = await handleEvent('booking-confirmed', body);
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/webhooks/instantly') {
      const body = await readBody(request);
      const eventType = String(body.event || body.type || body.status || '').toLowerCase();
      const context = findLeadContext({
        leadId: body.leadId || body.contact?.leadId,
        leadName: body.name || body.contact?.name,
        email: body.email || body.contact?.email,
        address: body.address || body.contact?.address,
      });

      if (eventType.includes('reply')) {
        const replyBody = body.body || body.reply || body.message || '';
        upsertMessage(
          state,
          createMessageRecord({
            leadId: context.leadId,
            leadName: context.leadName,
            address: context.address,
            email: body.email || context.email,
            channel: 'email',
            direction: 'inbound',
            body: replyBody,
            status: 'received',
            provider: 'Instantly',
          }),
        );

        await toolHandlers.handleReplyIntent({
          leadId: context.leadId,
          leadName: context.leadName,
          address: context.address,
          email: body.email || context.email,
          phone: body.phone || body.contact?.phone || '',
          body: replyBody,
          channel: 'email',
          provider: 'Instantly',
          startTime: body.startTime || body.bookingTime || '',
          timezone: body.timezone || '',
          bookingUrl: body.bookingUrl || body.calendarUrl || '',
        });
      }

      addActivity(
        state,
        makeActivity({
          actor: 'Instantly',
          category: 'EMAIL',
          status: eventType.includes('reply') ? 'received' : eventType.includes('open') ? 'opened' : eventType.includes('click') ? 'clicked' : 'queued',
          text: eventType.includes('reply')
            ? `Cold email reply received from ${context.leadName || body.email || 'lead'}.`
            : `Instantly webhook: ${eventType || 'event'} for ${context.leadName || body.email || 'lead'}.`,
          target: context.address || body.email || context.leadName,
        }),
      );
      await persistState(state);
      json(response, 200, {
        ok: true,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/webhooks/email') {
      const body = await readBody(request);
      const context = findLeadContext({
        leadId: body.leadId,
        leadName: body.name || body.fromName,
        email: body.email || body.from,
        address: body.address,
      });
      const messageBody = String(body.body || body.text || body.message || '').trim();

      upsertMessage(
        state,
        createMessageRecord({
          leadId: context.leadId,
          leadName: context.leadName,
          address: context.address,
          email: body.email || context.email,
          channel: 'email',
          direction: 'inbound',
          body: messageBody,
          status: 'received',
          provider: body.provider || 'email-webhook',
        }),
      );

      const replyResult = await toolHandlers.handleReplyIntent({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        email: body.email || context.email,
        phone: body.phone || '',
        body: messageBody,
        channel: 'email',
        provider: body.provider || 'email-webhook',
        startTime: body.startTime || body.bookingTime || '',
        timezone: body.timezone || '',
        bookingUrl: body.bookingUrl || body.calendarUrl || '',
      });

      addActivity(
        state,
        makeActivity({
          actor: context.leadName || 'Seller',
          category: 'EMAIL',
          status: replyResult?.reply?.temperature === 'hot' ? 'queued' : 'received',
          text: `Warm email reply received: ${messageBody || '(empty email)'}`,
          target: context.address || body.email || context.leadName,
        }),
      );
      await persistState(state);
      json(response, 200, {
        ok: true,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/webhooks/telnyx') {
      const body = await readBody(request);
      const mapped = mapTelnyxWebhook(body);
      const result = await handleEvent(mapped.eventType, mapped.payload);
      json(response, result.ok === false ? 404 : 200, {
        ok: true,
        mappedEvent: mapped.eventType,
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/webhooks/docusign') {
      const body = await readBody(request);
      const mapped = mapDocuSignWebhook(body);
      const result = await handleEvent(mapped.eventType, mapped.payload);
      json(response, result.ok === false ? 404 : 200, {
        ok: true,
        mappedEvent: mapped.eventType,
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/docusign/callback') {
      const body = await readBody(request);
      const mapped = mapDocuSignWebhook(body);
      const result = await handleEvent(mapped.eventType, mapped.payload);
      json(response, result.ok === false ? 404 : 200, {
        ok: true,
        mappedEvent: mapped.eventType,
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    json(response, 404, {
      ok: false,
      error: `No route for ${request.method} ${pathname}`,
      available: [
        'GET /health',
        'GET /state',
        'GET /api/tools',
        'GET /api/quotas',
        'GET /api/tooling/status',
        'GET /api/brain/email-context',
        'GET /api/participants/profile',
        'GET /api/crm/streak/status',
        'GET /api/crm/streak/bootstrap-plan',
        'GET /metrics',
        'GET /api/contracts/templates',
        'GET/POST /api/appointments',
        'GET /api/replies/templates',
        'GET /api/lead-transitions',
        'POST /api/participants/classify',
        'POST /api/documents/pdf',
        'POST /api/cold-email/send',
        'POST /api/replies/handle',
        'POST /api/crm/streak/bootstrap',
        'POST /api/send-seller-docs',
        'POST /api/browser-research/launch',
        'POST /invoke',
        'POST /events',
        'GET/POST /api/admin/tasks',
        'GET /api/admin/audit',
        'GET /api/admin/persistence',
        'GET /api/admin/docusign/status',
        'POST /api/admin/route',
        'POST /api/admin/request',
        'GET/POST /api/approvals',
        'GET/POST/DELETE /api/dnc',
        'GET/POST /api/calls',
        'POST /api/calls/:id/action',
        'GET/POST /api/messages',
        'GET/POST /api/contracts',
        'POST /api/contracts/prepare',
        'POST /api/contracts/lawyer-review',
        'POST /api/underwriting/sign',
        'GET/POST /api/leads/import',
        'POST /api/webhooks/booking',
        'POST /api/webhooks/instantly',
        'POST /api/webhooks/email',
        'POST /api/webhooks/telnyx',
        'POST /api/webhooks/docusign',
        'POST /api/docusign/callback',
      ],
    });
  } catch (error) {
    json(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[pbk-local-openclaw] listening on http://${HOST}:${PORT}`);
  console.log(`[pbk-local-openclaw] state backend: ${STATE_BACKEND}${DATABASE_URL ? ' (postgres)' : ` (file: ${STATE_FILE})`}`);
  console.log(`[pbk-local-openclaw] state file: ${STATE_FILE}`);
  console.log(`[pbk-local-openclaw] tools: ${state.status.tools.join(', ')}`);
  if (APPROVAL_WEBHOOK_URL) {
    console.log(`[pbk-local-openclaw] approval webhook -> ${APPROVAL_WEBHOOK_URL}`);
  }
  if (LEAD_WEBHOOK_URL) {
    console.log(`[pbk-local-openclaw] lead webhook -> ${LEAD_WEBHOOK_URL}`);
  }
});
