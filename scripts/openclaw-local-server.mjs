import { execFileSync } from 'node:child_process';
import { createServer, globalAgent as httpGlobalAgent } from 'node:http';
import { globalAgent as httpsGlobalAgent } from 'node:https';
import { createHmac, createPrivateKey, createSign as __dsCreateSign, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, watch } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import chromium from '@sparticuz/chromium';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer-core';
import pg from 'pg';
import {
  DEEPGRAM_SAMPLE_URL,
  createDeepgramLiveConnection,
  getDeepgramProviderMeta,
  sendDeepgramAudio,
  transcribeDeepgramFile,
  transcribeDeepgramUrl,
} from './pbk-deepgram-client.mjs';
const { Pool: PgPool } = pg;

httpGlobalAgent.keepAlive = true;
httpGlobalAgent.keepAliveMsecs = 1000;
httpGlobalAgent.maxSockets = 80;
httpsGlobalAgent.keepAlive = true;
httpsGlobalAgent.keepAliveMsecs = 1000;
httpsGlobalAgent.maxSockets = 80;

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

function hydrateLocalRuntimeEnv() {
  const envPath = path.join(RUNTIME_DIR, 'pbk-runtime.env');
  if (!existsSync(envPath)) return;
  try {
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn('[pbk-local-openclaw] local runtime env hydration skipped:', error?.message || error);
  }
}

hydrateLocalRuntimeEnv();

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
  'PBK_SUPABASE_URL',
  'PBK_SUPABASE_SERVICE_ROLE_KEY',
  'PBK_N8N_API_BASE_URL',
  'PBK_N8N_API_KEY',
  'PBK_SUPERMEMORY_API_KEY',
  'PBK_SUPERMEMORY_API_URL',
  'PBK_SUPERMEMORY_SYNC',
  'PBK_DEEPGRAM_API_KEY',
  'DEEPGRAM_API_KEY',
  'PBK_HUMAN_AGENT_PHONE',
  'PBK_UNDERWRITING_AGENT_PHONE',
  'PBK_INBOUND_QUALIFY_BEFORE_TRANSFER',
  'PBK_INBOUND_AFTER_HOURS_START',
  'PBK_INBOUND_AFTER_HOURS_END',
  'PBK_INBOUND_TIMEZONE',
  'PBK_TELNYX_AI_ASSISTANT_ID',
  'TELNYX_AI_ASSISTANT_ID',
  'PBK_AVA_MEMORY_DAILY_MINUTES',
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
const TELNYX_MEDIA_STREAM_TOKEN = String(process.env.PBK_TELNYX_MEDIA_STREAM_TOKEN || '').trim();
const DEEPGRAM_STREAM_CALLS_ENABLED = /^(1|true|yes)$/i.test(String(process.env.PBK_DEEPGRAM_STREAM_CALLS || '').trim());
const DEEPGRAM_STREAM_TRACK = String(process.env.PBK_DEEPGRAM_STREAM_TRACK || 'inbound_track').trim();
const DEEPGRAM_STREAM_CODEC = String(process.env.PBK_DEEPGRAM_STREAM_CODEC || 'PCMU').trim();
const TELNYX_AI_ASSISTANT_ID = String(process.env.PBK_TELNYX_AI_ASSISTANT_ID || process.env.TELNYX_AI_ASSISTANT_ID || '').trim();
const TELNYX_AI_ASSISTANT_ACTION_ENABLED = /^(1|true|yes)$/i.test(String(process.env.PBK_TELNYX_AI_ASSISTANT_ACTION_ENABLED || '').trim());
const HUMAN_AGENT_PHONE = normalizePhone(process.env.PBK_HUMAN_AGENT_PHONE || process.env.HUMAN_AGENT_PHONE || '');
const UNDERWRITING_AGENT_PHONE = normalizePhone(process.env.PBK_UNDERWRITING_AGENT_PHONE || process.env.UNDERWRITING_AGENT_PHONE || HUMAN_AGENT_PHONE || '');
const INBOUND_QUALIFY_BEFORE_TRANSFER = /^(1|true|yes)$/i.test(String(process.env.PBK_INBOUND_QUALIFY_BEFORE_TRANSFER || '').trim());
const INBOUND_AFTER_HOURS_START = Math.max(0, Math.min(23, Number(process.env.PBK_INBOUND_AFTER_HOURS_START || 18)));
const INBOUND_AFTER_HOURS_END = Math.max(0, Math.min(23, Number(process.env.PBK_INBOUND_AFTER_HOURS_END || 8)));
const INBOUND_TIMEZONE = String(process.env.PBK_INBOUND_TIMEZONE || 'America/New_York').trim();
const AVA_MEMORY_DAILY_MINUTES = Math.max(1, Math.min(240, Number(process.env.PBK_AVA_MEMORY_DAILY_MINUTES || 60)));
const AVA_MEMORY_WORKER_LIMIT = Math.max(1, Math.min(200, Number(process.env.PBK_AVA_MEMORY_WORKER_LIMIT || 40)));

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
const SLACK_BOT_TOKEN = String(process.env.PBK_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN || '').trim();
const SLACK_APPROVAL_CHANNEL_ID = String(
  process.env.PBK_SLACK_APPROVAL_CHANNEL_ID
    || process.env.PBK_SLACK_APPROVAL_CHANNEL
    || process.env.SLACK_APPROVAL_CHANNEL_ID
    || '',
).trim();
const SLACK_SIGNING_SECRET = String(process.env.PBK_SLACK_SIGNING_SECRET || process.env.SLACK_SIGNING_SECRET || '').trim();
const RESEND_API_KEY = String(process.env.PBK_RESEND_API_KEY || process.env.RESEND_API_KEY || '').trim();
const MAIN_BUSINESS_EMAIL = String(process.env.PBK_MAIN_BUSINESS_EMAIL || process.env.MAIN_BUSINESS_EMAIL || 'jordan@pbk.capital').trim();
const COLD_CAMPAIGN_EMAIL = String(process.env.PBK_COLD_CAMPAIGN_EMAIL || process.env.COLD_CAMPAIGN_EMAIL || 'offers@pbkoutreach.local').trim();
const INSTANTLY_API_KEY = String(process.env.PBK_INSTANTLY_API_KEY || process.env.INSTANTLY_API_KEY || '').trim();
const INSTANTLY_BASE_URL = String(process.env.PBK_INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2').trim().replace(/\/+$/g, '');
const INSTANTLY_CAMPAIGN_CREATE_ENDPOINT = String(process.env.PBK_INSTANTLY_CAMPAIGN_CREATE_ENDPOINT || '/campaigns').trim();
const INSTANTLY_SENDERS_ENDPOINT = String(process.env.PBK_INSTANTLY_SENDERS_ENDPOINT || '/inboxes').trim();
const INSTANTLY_DEFAULT_FROM_EMAIL = String(
  process.env.PBK_INSTANTLY_DEFAULT_FROM_EMAIL
    || process.env.INSTANTLY_DEFAULT_FROM_EMAIL
    || COLD_CAMPAIGN_EMAIL
    || '',
).trim();
const INSTANTLY_WARMUP_ENABLE_ENDPOINT = String(process.env.PBK_INSTANTLY_WARMUP_ENABLE_ENDPOINT || '/accounts/warmup/enable').trim();
const INSTANTLY_DOMAIN_ORDER_ENDPOINT = String(process.env.PBK_INSTANTLY_DOMAIN_ORDER_ENDPOINT || '/dfy-email-account-orders').trim();
const INSTANTLY_DOMAIN_SETUP_WEBHOOK_URL = String(process.env.PBK_INSTANTLY_DOMAIN_SETUP_WEBHOOK || '').trim();
const RENDER_API_KEY = String(process.env.PBK_RENDER_API_KEY || process.env.RENDER_API_KEY || '').trim();
const RENDER_SERVICE_ID = String(process.env.PBK_RENDER_SERVICE_ID || process.env.RENDER_SERVICE_ID || '').trim();
const RENDER_BASE_URL = String(process.env.PBK_RENDER_BASE_URL || 'https://api.render.com/v1').trim().replace(/\/+$/g, '');
const BROWSEROS_MCP_URL = String(process.env.PBK_BROWSEROS_MCP_URL || 'http://127.0.0.1:9000/mcp').trim();
const PROPERTY_CACHE_TTL_DAYS = Math.max(1, Number(process.env.PBK_PROPERTY_CACHE_TTL_DAYS || 30));
const PROPERTY_CACHE_TTL_MS = PROPERTY_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
const ANALYZER_RESULT_CACHE_TTL_MS = Math.max(30000, Number(process.env.PBK_ANALYZER_RESULT_CACHE_TTL_MS || 5 * 60 * 1000));
const DEFAULT_BOOKING_LINK = String(process.env.PBK_BOOKING_LINK || process.env.PBK_CALENDAR_BOOKING_URL || 'https://cal.com/pbk-capital/intro-call').trim();
const DEFAULT_LEAD_TIMEZONE = String(process.env.PBK_DEFAULT_LEAD_TIMEZONE || 'America/New_York').trim();
const CAMPAIGN_WORKER_ENABLED = /^(1|true|yes)$/i.test(String(process.env.PBK_CAMPAIGN_WORKER_ENABLED || '').trim());
const CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES = /^(1|true|yes)$/i.test(String(process.env.PBK_CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES || '').trim());
const CAMPAIGN_WORKER_MAX_STEPS = Math.max(1, Number(process.env.PBK_CAMPAIGN_WORKER_MAX_STEPS || 25));
const CAMPAIGN_WORKER_RETRY_PROVIDER_MISSING = /^(1|true|yes)$/i.test(String(process.env.PBK_CAMPAIGN_RETRY_PROVIDER_MISSING || '').trim());
const AUTO_DIAL_IMMEDIATE_REPLIES = !/^(0|false|no)$/i.test(String(process.env.PBK_REPLY_AUTO_DIAL_IMMEDIATE || 'true').trim());
const AUTO_SEND_REPLY_FOLLOWUPS = /^(1|true|yes)$/i.test(String(process.env.PBK_REPLY_AUTO_SEND_FOLLOWUPS || '').trim());
const GOOGLE_CALENDAR_ACCESS_TOKEN = String(process.env.PBK_GOOGLE_CALENDAR_ACCESS_TOKEN || '').trim();
const GOOGLE_CALENDAR_ID = String(process.env.PBK_GOOGLE_CALENDAR_ID || 'primary').trim();
const CALENDAR_SYNC_WEBHOOK_URL = String(process.env.PBK_CALENDAR_SYNC_WEBHOOK || '').trim();
const SUPABASE_URL = String(process.env.PBK_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/g, '');
const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.PBK_SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || '',
).trim();
const SUPABASE_CALL_RECORDINGS_BUCKET = String(process.env.PBK_CALL_RECORDINGS_BUCKET || 'call_recordings').trim();
const SUPABASE_ATTACHMENTS_BUCKET = String(process.env.PBK_ATTACHMENTS_BUCKET || 'attachments').trim();
const SUPABASE_RECORDING_SIGNED_URL_TTL_SECONDS = Math.max(
  60,
  Number(process.env.PBK_RECORDING_SIGNED_URL_TTL_SECONDS || 3600),
);
const RECORDING_RETENTION_DEFAULT_DAYS = Math.max(
  1,
  Number(process.env.PBK_RECORDING_RETENTION_DAYS || 365),
);
const PROMPT_FILE_PATCH_ENABLED = /^(1|true|yes)$/i.test(String(process.env.PBK_ALLOW_PROMPT_FILE_PATCH || '').trim());
const SUPABASE_ATTACHMENT_SIGNED_URL_TTL_SECONDS = Math.max(
  60,
  Number(process.env.PBK_ATTACHMENT_SIGNED_URL_TTL_SECONDS || 3600),
);
const STREAK_API_KEY = String(process.env.PBK_STREAK_API_KEY || process.env.STREAK_API_KEY || '').trim();
const STREAK_BASE_URL = String(process.env.PBK_STREAK_BASE_URL || 'https://api.streak.com/api').trim().replace(/\/+$/g, '');
const STREAK_PIPELINE_KEY = String(process.env.PBK_STREAK_PIPELINE_KEY || '').trim();
const STREAK_STAGE_MAP_RAW = String(process.env.PBK_STREAK_STAGE_MAP || '').trim();
const STREAK_FIELD_MAP_RAW = String(process.env.PBK_STREAK_FIELD_MAP || '').trim();
const STREAK_AUTO_CREATE_BOX = !/^(0|false|no)$/i.test(String(process.env.PBK_STREAK_AUTO_CREATE_BOX || 'true').trim());
const CRM_SYNC_WEBHOOK_URL = String(process.env.PBK_CRM_SYNC_WEBHOOK || '').trim();
const N8N_API_BASE_URL = String(
  process.env.PBK_N8N_API_BASE_URL
    || process.env.PBK_N8N_BASE_URL
    || process.env.N8N_API_BASE_URL
    || '',
)
  .trim()
  .replace(/\/api\/v1\/?$/i, '')
  .replace(/\/+$/g, '');
const N8N_API_KEY = String(process.env.PBK_N8N_API_KEY || process.env.N8N_API_KEY || '').trim();
const SUPERMEMORY_API_KEY = String(process.env.PBK_SUPERMEMORY_API_KEY || process.env.SUPERMEMORY_API_KEY || '').trim();
const SUPERMEMORY_API_URL = String(process.env.PBK_SUPERMEMORY_API_URL || process.env.SUPERMEMORY_API_URL || '').trim().replace(/\/+$/g, '');
const SUPERMEMORY_SYNC_ENABLED = /^(1|true|yes)$/i.test(String(process.env.PBK_SUPERMEMORY_SYNC || process.env.SUPERMEMORY_SYNC || '').trim());
const BRAIN_BLOG_FEEDS_RAW = String(process.env.PBK_BRAIN_BLOG_FEEDS || '').trim();
const BRAIN_BLOG_DEFAULT_FEEDS = [
  {
    url: 'https://www.biggerpockets.com/blog/feed',
    name: 'BiggerPockets',
    sourceType: 'rss',
    revenueStreams: ['Wholesaling', 'Market Reports'],
  },
];

// Bearer token required on mutating endpoints when set. Leave unset for local
// dev so the bridge stays open on 127.0.0.1. Set on hosted deploys.
const BRIDGE_API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();

// Endpoints that stay open even when PBK_BRIDGE_API_KEY is set, so external
// healthchecks (Render, uptime monitors) can still reach the bridge.
const PUBLIC_PATHS = new Set([
  '/',
  '/health',
  '/status',
  '/api/health',
  '/api/status',
  // Provider webhooks cannot attach the PBK bridge bearer token. Keep these
  // open while each handler validates and maps only the expected payload shape.
  '/api/webhooks/telnyx',
  '/api/webhooks/telnyx/inbound',
  '/webhooks/telnyx/inbound',
  '/api/webhooks/telnyx/recording',
  '/webhooks/telnyx/recording',
  '/api/webhooks/docusign',
]);

// Postgres state backend. When PBK_DATABASE_URL is set the bridge persists
// state to a 'bridge_state' table (single row, JSONB column) instead of the
// .pbk-local/openclaw-state.json file. Survives Render free-tier cold starts.
const DATABASE_URL = String(process.env.PBK_DATABASE_URL || '').trim();
const STATE_BACKEND = DATABASE_URL ? 'postgres' : 'file';

const SHOULD_RESET = IS_RESET;

const TOOL_NAMES = [
  'analyzeDeal',
  'getPropertyData',
  'cachePropertyData',
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
  'admin_check_health',
  'admin_restart_openclaw',
  'admin_run_away_worker',
  'admin_update_env_var',
  'createApproval',
  'handleReplyIntent',
  'updateCRM',
  'ingestResearchDoc',
  'createBrainBlogPost',
  'trainBrainBlogPost',
  'harvestBrainBlog',
  'recordMarketIntel',
  'planLeadNurture',
  'simulateDealConfidence',
  'matchBuyers',
  'runSystemAudit',
  'getBrainState',
  'checkDNC',
  'sendColdEmail',
  'scheduleAppointment',
  'telnyx_call',
  'telnyx_sms',
  'routeInboundCall',
  'runAvaMemoryLearning',
  'sendDocuSign',
  'sendContract',
  'skipTrace',
  'detectYelling',
  'slackNotify',
  'sendSellerDocs',
  'prepareContract',
  'contractLawyerReview',
  'reloadContractTemplates',
  'requestAdminAction',
  'launchBrowserResearch',
  'runAgentCommand',
];

const LIMITS = {
  approvals: 60,
  activity: 160,
  brainDocs: 90,
  brainBlogPosts: 160,
  marketIntel: 180,
  leadNurturePlans: 180,
  dealSimulations: 120,
  buyers: 240,
  buyerMatches: 180,
  systemAuditReports: 120,
  leadImports: 90,
  analyzerRuns: 90,
  propertyCache: 320,
  dncEntries: 120,
  calls: 90,
  messages: 140,
  appointments: 120,
  leadStageTransitions: 180,
  contracts: 90,
  documentDeliveries: 120,
  attachments: 160,
  browserResearchJobs: 160,
  campaigns: 160,
  campaignLeads: 1200,
  campaignEvents: 1600,
  campaignSuppressions: 400,
  campaignExecutions: 120,
  rexDecisions: 240,
  avaActiveMemories: 120,
  avaLearningSessions: 180,
  inboundCallRoutes: 180,
  promptPatchApplications: 90,
  recordingRetentionRuns: 90,
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
const N8N_WORKFLOW_DRAFTS_FILE = path.join(RUNTIME_DIR, 'n8n-workflow-drafts.json');
const OBSERVABILITY_COMPOSE_FILE = path.join(ROOT_DIR, 'ops', 'monitoring', 'docker-compose.observability.yml');
const OBSERVABILITY_DASHBOARD_FILE = path.join(ROOT_DIR, 'ops', 'monitoring', 'grafana', 'dashboards', 'pbk-runtime.json');
const OBSERVABILITY_PROM_FILE = path.join(ROOT_DIR, 'ops', 'monitoring', 'prometheus', 'generated.prometheus.yml');
const TOOLING_VERIFY_WORKFLOW_FILE = path.join(ROOT_DIR, '.github', 'workflows', 'tooling-verify.yml');
const WHOLESALE_AGENT_PROMPT_FILE = path.join(ROOT_DIR, 'wholesale.agent.md');

function isoNow() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMoneyNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  const normalized = raw.replace(/[$,\s]/g, '');
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)(k|m)?$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallback;
  const suffix = String(match[2] || '').toLowerCase();
  if (suffix === 'm') return Math.round(amount * 1_000_000);
  if (suffix === 'k') return Math.round(amount * 1_000);
  return Math.round(amount);
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

function normalizeStringList(value = []) {
  const items = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[,|]/g);
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
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
      deepgram: getDeepgramProviderMeta(process.env),
      instantly: getInstantlyProviderMeta(),
      googleCalendar: getGoogleCalendarProviderMeta(),
      supabaseStorage: getSupabaseStorageProviderMeta(),
      n8nWorkflows: getN8nWorkflowProviderMeta(),
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

function formatMoneyCompact(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(toNumber(value, 0));
}

function averagePrices(deal = {}) {
  const prices = ['A', 'B', 'C']
    .map((key) => toMoneyNumber(deal?.comps?.[key]?.price, 0))
    .filter((value) => value > 0);
  if (!prices.length) return 0;
  return Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
}

function normalizeAddressKey(address = '') {
  return slugify(String(address || '').replace(/\b(usa|united states)\b/ig, '').trim());
}

function firstMoneyValue(...values) {
  for (const value of values) {
    const parsed = toMoneyNumber(value, 0);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function normalizeComparablePrices(value) {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value)
      : [];
  const normalized = items
    .map((item, index) => {
      const price = firstMoneyValue(item?.price, item?.soldPrice, item?.salePrice, item?.value, item);
      if (!price) return null;
      return {
        label: item?.label || item?.address || item?.description || `Comp ${index + 1}`,
        price,
        date: item?.date || item?.soldDate || item?.saleDate || '',
        distance: item?.distance || '',
        source: item?.source || '',
      };
    })
    .filter(Boolean)
    .slice(0, 8);
  return normalized;
}

function getPropertyAnalysisValues(input = {}) {
  const raw = input?.values || input?.data || input || {};
  const comps = normalizeComparablePrices(raw.recentComps || raw.comps || raw.comparables || raw.soldComps);
  const compObject = Object.fromEntries(
    comps.slice(0, 3).map((comp, index) => [String.fromCharCode(65 + index), { price: comp.price }]),
  );
  return {
    arv: firstMoneyValue(
      raw.arv,
      raw.afterRepairValue,
      raw.estimatedValue,
      raw.marketValue,
      raw.zestimate,
      raw.redfinEstimate,
      raw.listPrice,
      raw.price,
    ),
    repairsMid: firstMoneyValue(raw.repairsMid, raw.estimatedRepairs, raw.repairs, raw.rehabEstimate),
    mao: firstMoneyValue(raw.mao, raw.maxAllowableOffer),
    targetOffer: firstMoneyValue(raw.targetOffer, raw.offerPrice, raw.recommendedOffer),
    beds: toNumber(raw.beds || raw.bedrooms, 0),
    baths: toNumber(raw.baths || raw.bathrooms, 0),
    sqft: toNumber(raw.sqft || raw.squareFeet || raw.livingArea, 0),
    yearBuilt: toNumber(raw.yearBuilt || raw.year, 0),
    comps,
    compObject,
  };
}

function findPropertyCacheEntry(address = '') {
  const key = normalizeAddressKey(address);
  if (!key) return { hit: false, key, entry: null, expired: false, ageMs: null };
  const entry = (state.propertyCache || []).find((item) => item.key === key || normalizeAddressKey(item.address) === key) || null;
  if (!entry) return { hit: false, key, entry: null, expired: false, ageMs: null };
  const updatedAtMs = Date.parse(entry.updatedAt || entry.createdAt || '');
  const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Number.POSITIVE_INFINITY;
  const expired = ageMs > PROPERTY_CACHE_TTL_MS;
  return { hit: !expired, key, entry, expired, ageMs };
}

function upsertPropertyCacheEntry(params = {}) {
  const data = params.data || params.propertyData || params.browserData || params.values || {};
  const address = params.address || data.address || data.propertyAddress || '';
  const key = normalizeAddressKey(address);
  if (!key) return null;
  const now = isoNow();
  const values = getPropertyAnalysisValues(data);
  const entry = {
    id: `property-cache-${key}`,
    key,
    address,
    source: params.source || data.source || 'manual',
    provider: params.provider || data.provider || params.source || 'browseros',
    status: params.status || 'ready',
    data,
    values,
    createdAt: params.createdAt || now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + PROPERTY_CACHE_TTL_MS).toISOString(),
  };
  const existingIndex = (state.propertyCache || []).findIndex((item) => item.key === key || normalizeAddressKey(item.address) === key);
  if (!Array.isArray(state.propertyCache)) state.propertyCache = [];
  if (existingIndex >= 0) {
    state.propertyCache[existingIndex] = {
      ...state.propertyCache[existingIndex],
      ...entry,
      createdAt: state.propertyCache[existingIndex].createdAt || entry.createdAt,
    };
  } else {
    state.propertyCache.unshift(entry);
  }
  state.propertyCache = sortNewest(state.propertyCache).slice(0, LIMITS.propertyCache);
  return entry;
}

async function queueBrowserPropertyResearch({ address = '', requestedBy = 'Analyzer', source = 'analyzer' } = {}) {
  const toolingStatus = await buildToolingStatus();
  const browserOs = toolingStatus.browserOs || {};
  const ready = Boolean(browserOs.ready);
  const targetLabel = address || 'Unknown property';
  const query = [
    `Use BrowserOS to enrich analyzer data for ${targetLabel}.`,
    'Capture property value estimate, list price, recent sold comps, beds, baths, sqft, year built, tax info, listing status, and source URLs.',
    'Return JSON that can be posted back to /api/property-data.',
  ].join(' ');
  const job = {
    id: `browser-property-${normalizeAddressKey(targetLabel) || randomUUID().slice(0, 8)}`,
    createdAt: isoNow(),
    requestedBy,
    source,
    provider: 'browseros',
    status: ready ? 'queued' : 'setup-required',
    query,
    targetUrl: '',
    targetLabel,
    site: 'property-enrichment',
    endpoint: browserOs.endpoint || BROWSEROS_MCP_URL,
    cacheKey: normalizeAddressKey(targetLabel),
  };
  upsertBrowserResearchJob(state, job);
  addActivity(
    state,
    makeActivity({
      actor: requestedBy,
      category: 'RESEARCH',
      status: ready ? 'queued' : 'warning',
      text: ready
        ? `Queued BrowserOS property enrichment for ${targetLabel}. Analyzer returned immediately from cache/fallback.`
        : `Analyzer requested BrowserOS enrichment for ${targetLabel}, but BrowserOS is not registered yet.`,
      target: targetLabel,
    }),
  );
  state.status.lastBrowserResearchAt = job.createdAt;
  return {
    ready,
    job,
    browserOs,
  };
}

async function resolvePropertyDataForAnalyzer(params = {}) {
  const address = params.address || params.deal?.address || params.propertyAddress || '';
  const incomingData = params.propertyData || params.browserData || params.enrichmentData || null;
  if (incomingData && address) {
    const entry = upsertPropertyCacheEntry({
      address,
      data: incomingData,
      source: params.propertyDataSource || params.source || 'browseros',
      provider: params.provider || 'browseros',
    });
    return {
      propertyData: entry,
      enrichment: {
        source: entry?.source || 'browseros',
        cache: 'write-through',
        cacheKey: entry?.key || normalizeAddressKey(address),
        ttlDays: PROPERTY_CACHE_TTL_DAYS,
      },
    };
  }

  const cache = findPropertyCacheEntry(address);
  if (cache.hit) {
    return {
      propertyData: cache.entry,
      enrichment: {
        source: cache.entry.source || cache.entry.provider || 'cache',
        cache: 'hit',
        cacheKey: cache.key,
        ageMs: cache.ageMs,
        ttlDays: PROPERTY_CACHE_TTL_DAYS,
      },
    };
  }

  let browserResearch = null;
  if (address && params.useBrowserOs !== false && params.queueBrowserResearch !== false) {
    browserResearch = await queueBrowserPropertyResearch({
      address,
      requestedBy: params.requestedBy || 'Analyzer',
      source: params.source || 'analyzer-cache-miss',
    });
  }

  return {
    propertyData: null,
    enrichment: {
      source: 'fallback',
      cache: cache.expired ? 'expired' : 'miss',
      cacheKey: cache.key || normalizeAddressKey(address),
      ttlDays: PROPERTY_CACHE_TTL_DAYS,
      browserResearch: browserResearch
        ? {
          ready: browserResearch.ready,
          status: browserResearch.job.status,
          jobId: browserResearch.job.id,
          endpoint: browserResearch.job.endpoint,
        }
        : null,
    },
  };
}

function buildToolUsageSeed() {
  return Object.fromEntries(TOOL_NAMES.map((toolName) => [toolName, 0]));
}

function buildAvaNegotiationPersona() {
  return {
    id: 'ava-closer-v1',
    name: 'Ava',
    role: 'PBK acquisitions closer',
    hometown: 'Columbus, Ohio',
    voice: 'Midwest-warm, direct, emotionally intelligent, and never pushy.',
    backstory: 'Ava learned negotiation helping her family work through a small-business sale and now uses that same calm, practical style with sellers who need clarity more than pressure.',
    principles: [
      'Tactical empathy: label the emotion before solving the problem.',
      'Mirroring: repeat the last meaningful phrase when the seller is guarded.',
      'Calibrated questions: use how/what questions to let the seller explain the path.',
      'Ethical influence: use trust, clarity, proof, and scarcity without manipulation.',
      'Wholesale discipline: never exceed MAO or hide repair/downside risk.'
    ],
  };
}

function buildDefaultNegotiationTactics() {
  return [
    {
      id: 'tactic-opening-accusation-audit',
      scenario: 'opening',
      tacticName: 'Accusation audit',
      principle: 'Name the seller fear first so the conversation starts honest.',
      scriptExample: "You may be getting a lot of investor calls, and I would not blame you for wondering if this is just another lowball. I can keep this simple and transparent.",
      emotionTarget: 'distrust',
      rank: 10,
    },
    {
      id: 'tactic-price-labeling',
      scenario: 'objection_price',
      tacticName: 'Price labeling',
      principle: 'Label the tension between speed, certainty, and price.',
      scriptExample: "It sounds like you want the best number possible, but you also do not want repairs, showings, or a long listing process hanging over you.",
      emotionTarget: 'hesitation',
      rank: 10,
    },
    {
      id: 'tactic-ackerman-counter',
      scenario: 'counter_offer',
      tacticName: 'Ackerman step-up',
      principle: 'Move in small, justified increments and explain what each concession buys.',
      scriptExample: "I cannot responsibly get to that number as-is. What I can do is improve the cash offer if we keep the close clean and avoid repair credits.",
      emotionTarget: 'greed',
      rank: 9,
    },
    {
      id: 'tactic-close-small-yes',
      scenario: 'closing_hesitation',
      tacticName: 'Smaller yes',
      principle: 'When the seller hesitates, ask for the next low-pressure commitment instead of forcing the close.',
      scriptExample: "What would need to be true for you to feel comfortable saying yes today, even if that yes is just letting me send the paperwork for review?",
      emotionTarget: 'fear',
      rank: 9,
    },
    {
      id: 'tactic-probate-empathy',
      scenario: 'probate',
      tacticName: 'Executor empathy',
      principle: 'Probate sellers often need burden removal and dignity before numbers.',
      scriptExample: "If you are handling this for the family, I know it can feel like one more heavy thing on top of everything else. We can move at your pace.",
      emotionTarget: 'grief',
      rank: 10,
    },
    {
      id: 'tactic-angry-dnc',
      scenario: 'anger',
      tacticName: 'Graceful exit',
      principle: 'Protect trust and compliance when a seller is angry.',
      scriptExample: "I hear you. I am sorry we bothered you. I can remove this number now so you do not get another outreach from us.",
      emotionTarget: 'anger',
      rank: 10,
    },
  ];
}

function buildDefaultEmotionalIntelligenceRules() {
  return [
    {
      id: 'ei-angry',
      emotion: 'angry',
      triggerPhrase: 'stop calling, mad, upset, leave me alone',
      recommendedResponse: 'Slow down, apologize without defensiveness, offer DNC, and end cleanly if requested.',
      scriptFragment: 'I hear you, and I am sorry. I can remove you from our list right now.',
    },
    {
      id: 'ei-hesitant',
      emotion: 'hesitant',
      triggerPhrase: "I don't know, let me think, maybe, not sure",
      recommendedResponse: 'Label the uncertainty and ask what information would make the decision easier.',
      scriptFragment: 'It sounds like you are not quite comfortable yet. What would you need to see before this feels safe?',
    },
    {
      id: 'ei-distrustful',
      emotion: 'distrustful',
      triggerPhrase: 'how do I know, scam, are you real',
      recommendedResponse: 'Use proof, process clarity, and transparency. Do not over-defend.',
      scriptFragment: 'Fair question. I can walk you through exactly who we are, how closing works, and what happens before anything is signed.',
    },
    {
      id: 'ei-urgent',
      emotion: 'urgent',
      triggerPhrase: 'need this done, behind, deadline, foreclosure',
      recommendedResponse: 'Move to clarity, timeline, and immediate next step. Keep tone steady.',
      scriptFragment: 'Let us focus on the fastest clean path. What date are you trying to solve this before?',
    },
  ];
}

function buildDefaultCityKnowledge() {
  return [
    {
      id: 'city-columbus',
      city: 'Columbus',
      state: 'OH',
      zipPrefixes: ['432'],
      rapportLine: 'Columbus sellers usually appreciate a clean, no-drama process, especially around probate and older homes.',
      localStory: 'Ava knows the Short North, German Village brick streets, and the way older Columbus houses can hide repair surprises behind charm.',
    },
    {
      id: 'city-akron',
      city: 'Akron',
      state: 'OH',
      zipPrefixes: ['443'],
      rapportLine: 'Akron sellers often respond well to practical burden removal: repairs, tenants, taxes, or a timeline that is getting tight.',
      localStory: 'Ava can reference Akron as a working town where people value straight talk and a buyer who does what they say.',
    },
    {
      id: 'city-cleveland',
      city: 'Cleveland',
      state: 'OH',
      zipPrefixes: ['441'],
      rapportLine: 'Cleveland conversations should be direct about winter repairs, older mechanicals, and buyer certainty.',
      localStory: 'Ava can use Cleveland neighborhood familiarity without pretending to be from the exact block.',
    },
    {
      id: 'city-cincinnati',
      city: 'Cincinnati',
      state: 'OH',
      zipPrefixes: ['452'],
      rapportLine: 'Cincinnati sellers often care about certainty, timing, and whether the buyer understands hillside/older-home repair risks.',
      localStory: 'Ava can mention that Cincinnati houses can be beautiful but quirky, especially older homes with steps, basements, and deferred maintenance.',
    },
    {
      id: 'city-dayton',
      city: 'Dayton',
      state: 'OH',
      zipPrefixes: ['454'],
      rapportLine: 'Dayton sellers usually respond to respect, speed, and a realistic as-is number more than flashy investor language.',
      localStory: 'Ava can connect around Dayton as a practical market where a clean close can matter more than squeezing every last dollar.',
    },
  ];
}

function makeActivity({
  actor = 'System',
  category = 'INFO',
  status = 'success',
  text = '',
  target = '',
  source = 'runtime',
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
    source,
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
      id: 'brain-ava-closer-framework',
      kind: 'note',
      topic: 'Negotiation',
      title: 'Ava 7-Figure Closer Framework',
      source: 'PBK closer playbook',
      excerpt:
        'Use tactical empathy, ethical influence, emotional intelligence, and MAO discipline to help sellers feel understood while protecting PBK profit.',
      summary:
        'Ava should label emotion, ask calibrated how/what questions, use local rapport sparingly, anchor with repair/certainty logic, and never exceed the walk-away number.',
      citation: 'PBK closer playbook - v1',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      tags: ['Negotiation', 'Emotional Intelligence', 'Ava', 'Closing'],
    },
    {
      id: 'brain-emotional-intelligence-objections',
      kind: 'note',
      topic: 'Negotiation',
      title: 'Emotional Intelligence Map for Seller Objections',
      source: 'PBK psychology notes',
      excerpt:
        'Anger needs apology and exit safety. Hesitation needs a smaller yes. Distrust needs proof and process clarity. Urgency needs a calm next step.',
      summary:
        'Map seller emotion before choosing a tactic: frustration means slow down, hesitation means reduce commitment size, distrust means show process, urgency means clarify dates.',
      citation: 'PBK EI notes - seller calls',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      tags: ['Emotional Intelligence', 'Objection Handling', 'Voice'],
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

function buildDefaultBrainBlogPosts() {
  const now = Date.now();
  return [
    {
      id: 'brain-blog-straight-line-wholesaling',
      title: 'Straight-Line Persuasion, Adapted for Seller Calls',
      sourceUrl: 'https://www.jordanbelfort.com/',
      sourceType: 'manual',
      sourceName: 'PBK mentor note',
      salesMentor: 'Jordan Belfort',
      techniqueType: 'objection_handling',
      revenueStreams: ['Cash Deals', 'Wholesaling'],
      content:
        'Use certainty loops without sounding like a boiler room. Keep the seller certain about three things: PBK is legitimate, the process is simple, and the number is based on the real property math. If the seller says they want to think about it, loop back to the main uncertainty instead of repeating the same offer.',
      summary:
        'Apply Straight-Line certainty loops to cash-offer calls: legitimacy, simple process, and math-based offer confidence.',
      keyTakeaways: [
        'Do not push price harder until you know which certainty is missing.',
        'Loop back with a question, not a repeated pitch.',
        'Use the analyzer math as the calm anchor for the offer.',
      ],
      tags: ['Jordan Belfort', 'Objection Handling', 'Cash Deals', 'Wholesaling'],
      status: 'ready',
      contentHash: 'seed-straight-line-wholesaling',
      publishedAt: new Date(now - 1000 * 60 * 75).toISOString(),
      createdAt: new Date(now - 1000 * 60 * 75).toISOString(),
      updatedAt: new Date(now - 1000 * 60 * 75).toISOString(),
    },
    {
      id: 'brain-blog-subto-low-rate-seller',
      title: 'Low-Rate Mortgage Sellers Need Relief, Not a Hard Cash Pitch',
      sourceUrl: '',
      sourceType: 'manual',
      sourceName: 'PBK creative finance playbook',
      salesMentor: 'Cory Boatright',
      techniqueType: 'creative_finance',
      revenueStreams: ['Subject-To', 'Creative Finance'],
      content:
        'When a seller has a low mortgage rate and decent payment history, lead with payment relief and certainty of close. Subject-to should be positioned as a way to solve timing, cash-flow, and listing fatigue while preserving clear disclosure and underwriting approval.',
      summary:
        'For low-rate sellers, present subject-to as a relief structure after confirming payment, equity, and risk disclosures.',
      keyTakeaways: [
        'Ask about payment stress before pitching terms.',
        'Explain that underwriting must approve the structure.',
        'Do not frame subject-to as a trick; frame it as a transparent relief path.',
      ],
      tags: ['Cory Boatright', 'Subject-To', 'Creative Finance', 'Seller Relief'],
      status: 'ready',
      contentHash: 'seed-subto-low-rate-seller',
      publishedAt: new Date(now - 1000 * 60 * 60 * 22).toISOString(),
      createdAt: new Date(now - 1000 * 60 * 60 * 22).toISOString(),
      updatedAt: new Date(now - 1000 * 60 * 60 * 22).toISOString(),
    },
  ];
}

function buildDefaultBuyers() {
  return [
    {
      id: 'buyer-columbus-light-flips',
      name: 'Columbus Light Flip Buyers',
      status: 'active',
      zipCodes: ['43205', '43206', '43207', '43211'],
      markets: ['Columbus OH'],
      propertyTypes: ['single-family', 'duplex'],
      priceMin: 65000,
      priceMax: 190000,
      desiredRoi: 0.14,
      maxRepairs: 55000,
      notes: 'Likes cosmetic-to-medium rehab near downtown Columbus; avoids full foundation projects.',
      tags: ['cash-buyer', 'columbus', 'light-flip'],
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    },
    {
      id: 'buyer-akron-rentals',
      name: 'Akron Rental Hold Group',
      status: 'active',
      zipCodes: ['44305', '44306', '44310', '44314'],
      markets: ['Akron OH'],
      propertyTypes: ['single-family'],
      priceMin: 35000,
      priceMax: 125000,
      desiredRoi: 0.11,
      maxRepairs: 45000,
      notes: 'Prefers rentals with simple turns and conservative all-in basis.',
      tags: ['cash-buyer', 'akron', 'rental'],
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    },
  ];
}

function buildDefaultMarketIntel() {
  return [
    {
      id: 'market-intel-columbus-43205',
      market: 'Columbus OH',
      zipCode: '43205',
      propertyType: 'single-family',
      competitiveOfferIndex: 0.74,
      buyerDemand: 'high',
      medianInvestorMaoPct: 0.68,
      daysOnMarketSignal: 18,
      confidence: 0.62,
      source: 'PBK seed',
      notes: 'Seed benchmark until BrowserOS market scrape produces live public data.',
      status: 'seed',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
    },
  ];
}

function buildDefaultLeadNurturePlans() {
  return [];
}

function buildDefaultDealSimulations() {
  return [];
}

function buildDefaultBuyerMatches() {
  return [];
}

function buildDefaultSystemAuditReports() {
  return [];
}

function buildDefaultActivity() {
  return [
    makeActivity({
      actor: 'Ava',
      category: 'APPROVAL',
      status: 'pending',
      text: 'Requested approval for $78,000 offer - MAO $91,500',
      target: 'Diane Kowalski - 202 Cherry Ln',
      source: 'demo',
      at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    }),
    makeActivity({
      actor: 'System',
      category: 'ANALYZE',
      status: 'success',
      text: 'Analyzer ran - ARV $185k - repairs $38k - MAO $91,500',
      target: '202 Cherry Ln',
      source: 'demo',
      at: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
    }),
    makeActivity({
      actor: 'n8n',
      category: 'IMPORT',
      status: 'complete',
      text: 'Lead intake flow normalized 47 fresh probate rows',
      target: 'daily_probate_import.csv',
      source: 'demo',
      at: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    }),
    makeActivity({
      actor: 'Rex',
      category: 'RESEARCH',
      status: 'indexed',
      text: 'Indexed 3 new sources and updated negotiation guidance',
      target: 'Brain library',
      source: 'demo',
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

function buildDefaultAgentFleet() {
  const now = Date.now();
  return [
    {
      id: 'ava',
      name: 'Ava',
      avatar: 'A',
      role: 'Acquisitions',
      version: 'v2.1',
      target: 'production',
      status: 'on_call',
      activity: 'On call with Diane Kowalski - probate seller - Columbus',
      lastSeen: new Date(now - 12000).toISOString(),
      style: 'Empathetic closer',
      hometown: 'Akron, OH',
      campaigns: 2,
      sentiment: 72,
      skillsTotal: 47,
      skillSource: '12 audiobook, 18 call outcomes',
      skills: [
        { name: 'Tactical empathy opener', level: 'proven', confidence: 94, evidence: 'Lifted verbal yes rate by 18% on probate calls.' },
        { name: 'Ackerman price walk', level: 'proven', confidence: 88, evidence: 'Protected MAO on 23 live negotiations.' },
        { name: 'Grief-safe probate framing', level: 'evolving', confidence: 79, evidence: 'Positive sentiment trend on bereavement calls.' },
      ],
    },
    {
      id: 'max',
      name: 'Max',
      avatar: 'M',
      tone: 'amber',
      role: 'Closer',
      version: 'v1.4',
      target: 'production',
      status: 'running_campaign',
      activity: 'Running campaign: Probate Warm-up Q2 - 241 leads',
      lastSeen: new Date(now - 45000).toISOString(),
      style: 'Direct closer',
      hometown: 'Cleveland, OH',
      campaigns: 3,
      sentiment: 66,
      skillsTotal: 31,
      skillSource: '8 audiobook, 11 campaign outcomes',
      skills: [
        { name: 'Numbers-first counter', level: 'proven', confidence: 91, evidence: 'Raised assignment spread on counter-offer calls.' },
        { name: 'Urgency without pressure', level: 'proven', confidence: 86, evidence: 'Reduced ghosting after verbal yes.' },
        { name: 'Walk-away line discipline', level: 'evolving', confidence: 81, evidence: 'Needs more data on high-equity sellers.' },
      ],
    },
    {
      id: 'rex',
      name: 'Rex',
      avatar: 'R',
      tone: 'purple',
      role: 'Research and strategist',
      version: 'v3.0',
      target: 'production',
      status: 'learning',
      activity: 'Learning from campaign analytics, Brain Blog posts, and Deepgram sentiment',
      lastSeen: new Date(now - 7000).toISOString(),
      style: 'Analytical strategist',
      hometown: 'Boston, MA',
      campaigns: 0,
      sentiment: 80,
      skillsTotal: 218,
      skillSource: 'Brain Blog, Rex decisions, outcome evaluator',
      skills: [
        { name: 'Skill discovery from analytics', level: 'proven', confidence: 93, evidence: 'Creates Rex proposals with measurable outcome targets.' },
        { name: 'Campaign script diagnosis', level: 'proven', confidence: 89, evidence: 'Finds low reply-rate patterns and proposes copy changes.' },
        { name: 'Local market story mining', level: 'evolving', confidence: 76, evidence: 'Needs more city-specific source material.' },
      ],
    },
    {
      id: 'nora',
      name: 'Nora',
      avatar: 'N',
      tone: 'lime',
      role: 'Spanish acquisitions',
      version: 'v0.3',
      target: 'local',
      status: 'building',
      activity: 'Inheriting 38 proven Ava skills - Spanish seller empathy pack',
      lastSeen: new Date(now - 1000 * 60 * 6).toISOString(),
      style: 'Empathetic bilingual',
      hometown: 'San Antonio, TX',
      campaigns: 0,
      sentiment: 62,
      skillsTotal: 0,
      skillSource: 'Building from Ava blueprint',
      skills: [
        { name: 'Spanish warm opener', level: 'candidate', confidence: 61, evidence: 'Needs sandbox calls before promotion.' },
        { name: 'Ava skill inheritance', level: 'evolving', confidence: 74, evidence: '38 proven Ava skills queued for approval-backed transfer.' },
      ],
    },
    {
      id: 'zed',
      name: 'Zed',
      avatar: 'Z',
      tone: 'gray',
      role: 'Outbound SMS',
      version: 'v1.0',
      target: 'production',
      status: 'idle',
      activity: 'Idle - waiting for approved SMS nurture campaign',
      lastSeen: new Date(now - 1000 * 60 * 12).toISOString(),
      style: 'Concise follow-up',
      hometown: 'Phoenix, AZ',
      campaigns: 0,
      sentiment: 55,
      skillsTotal: 18,
      skillSource: 'SMS campaign outcomes',
      skills: [
        { name: 'One-line reactivation', level: 'proven', confidence: 87, evidence: 'Increased reply rate on 14-day nurture.' },
        { name: 'STOP-safe compliance copy', level: 'proven', confidence: 96, evidence: 'Maintains opt-out handling in every SMS script.' },
      ],
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
      brainBlogPosts: 2,
      lastBrainBlogPostAt: null,
      marketIntelCount: 1,
      activeNurturePlans: 0,
      dealSimulations: 0,
      activeBuyers: 2,
      buyerMatches: 0,
      systemAuditReports: 0,
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
      propertyCacheCount: 0,
      propertyCacheTtlDays: PROPERTY_CACHE_TTL_DAYS,
      lastDocumentDeliveryAt: null,
      lastPropertyCacheAt: null,
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
        workflowApiConfigured: getN8nWorkflowProviderMeta().ready,
        workflowDraftStore: true,
      },
    },
    approvals: buildDefaultApprovals(),
    activity: buildDefaultActivity(),
    brainDocs: buildDefaultBrainDocs(),
    brainBlogPosts: buildDefaultBrainBlogPosts(),
    marketIntel: buildDefaultMarketIntel(),
    leadNurturePlans: buildDefaultLeadNurturePlans(),
    dealSimulations: buildDefaultDealSimulations(),
    buyers: buildDefaultBuyers(),
    buyerMatches: buildDefaultBuyerMatches(),
    systemAuditReports: buildDefaultSystemAuditReports(),
    leadImports: buildDefaultLeadImports(),
    analyzerRuns: buildDefaultAnalyzerRuns(),
    propertyCache: [],
    dncEntries: buildDefaultDncEntries(),
    calls: buildDefaultCalls(),
    messages: buildDefaultMessages(),
    appointments: buildDefaultAppointments(),
    leadStageTransitions: buildDefaultLeadStageTransitions(),
    contracts: buildDefaultContracts(),
    documentDeliveries: buildDefaultDocumentDeliveries(),
    attachments: [],
    browserResearchJobs: [],
    campaigns: [],
    campaignLeads: [],
    campaignEvents: [],
    campaignSuppressions: [],
    campaignExecutions: [],
    agents: buildDefaultAgentFleet(),
    agentSkillTransfers: [],
    agentSkillExperiments: [],
    rexDecisions: [],
    avaActiveMemories: [],
    avaLearningSessions: [],
    inboundCallRoutes: [],
    promptPatchApplications: [],
    recordingRetentionRuns: [],
    settings: {
      ui: {
        operatingMode: 'approval',
        approvalGatedProduction: true,
        recordingRetention: {
          days: RECORDING_RETENTION_DEFAULT_DAYS,
          enforcement: 'approval-gated',
        },
      },
      updatedAt: isoNow(),
      updatedBy: 'system',
    },
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
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE OR REPLACE FUNCTION public.pbk_set_updated_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;

    CREATE TABLE IF NOT EXISTS bridge_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.coach_memory (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      memory_type TEXT NOT NULL DEFAULT 'general',
      objection_tag TEXT NOT NULL DEFAULT '',
      path_key TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      response TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'bridge',
      source_url TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'observed',
      score NUMERIC NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.coach_memory
      ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'pbk',
      ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'general',
      ADD COLUMN IF NOT EXISTS objection_tag TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS path_key TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS prompt TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS response TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'bridge',
      ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'observed',
      ADD COLUMN IF NOT EXISTS score NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS public.skills (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      agent_id TEXT NOT NULL DEFAULT '',
      agent_name TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'self-learned',
      level TEXT NOT NULL DEFAULT 'candidate',
      status TEXT NOT NULL DEFAULT 'active',
      confidence NUMERIC NOT NULL DEFAULT 0,
      evidence TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, agent_id, name)
    );

    CREATE TABLE IF NOT EXISTS public.skill_usage (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      skill_id TEXT REFERENCES public.skills(id) ON DELETE SET NULL,
      skill_name TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      agent_name TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'unknown',
      success BOOLEAN,
      confidence NUMERIC,
      profit_margin NUMERIC,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ava_learning_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      minutes_budget INTEGER NOT NULL DEFAULT 60,
      candidates_processed INTEGER NOT NULL DEFAULT 0,
      lessons_extracted INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'complete',
      summary TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ava_active_memories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      memory_type TEXT NOT NULL DEFAULT 'ava-call-lesson',
      objection_tag TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      response TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      score NUMERIC NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'observed',
      source TEXT NOT NULL DEFAULT 'ava-self-learning',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.inbound_call_routes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      call_control_id TEXT NOT NULL DEFAULT '',
      from_phone TEXT NOT NULL DEFAULT '',
      to_phone TEXT NOT NULL DEFAULT '',
      lead_id TEXT NOT NULL DEFAULT '',
      route TEXT NOT NULL DEFAULT 'ava_qualify',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'received',
      prompt_context TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.agent_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      requested_by TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'pbk-bridge',
      status TEXT NOT NULL DEFAULT 'complete',
      summary TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.rex_decisions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'rex-strategist',
      tool TEXT NOT NULL DEFAULT '',
      params JSONB NOT NULL DEFAULT '{}'::jsonb,
      rationale TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'proposed',
      target_type TEXT,
      target_id TEXT,
      approval_id TEXT,
      baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
      outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      success BOOLEAN,
      proposed_by TEXT NOT NULL DEFAULT 'Rex Strategist',
      approved_by TEXT,
      applied_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_at TIMESTAMPTZ,
      evaluated_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS coach_memory_workspace_idx
      ON public.coach_memory (workspace_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS coach_memory_objection_idx
      ON public.coach_memory (workspace_id, objection_tag, score DESC);

    CREATE INDEX IF NOT EXISTS skills_workspace_agent_idx
      ON public.skills (workspace_id, agent_id, status);

    CREATE INDEX IF NOT EXISTS skills_workspace_confidence_idx
      ON public.skills (workspace_id, confidence DESC);

    CREATE INDEX IF NOT EXISTS skill_usage_workspace_agent_idx
      ON public.skill_usage (workspace_id, agent_id, used_at DESC);

    CREATE INDEX IF NOT EXISTS skill_usage_skill_idx
      ON public.skill_usage (skill_id, used_at DESC);

    CREATE INDEX IF NOT EXISTS skill_usage_success_idx
      ON public.skill_usage (workspace_id, success, used_at DESC);

    CREATE INDEX IF NOT EXISTS ava_learning_sessions_workspace_idx
      ON public.ava_learning_sessions (workspace_id, processed_at DESC);

    CREATE INDEX IF NOT EXISTS ava_active_memories_lookup_idx
      ON public.ava_active_memories (workspace_id, objection_tag, score DESC);

    CREATE INDEX IF NOT EXISTS inbound_call_routes_workspace_idx
      ON public.inbound_call_routes (workspace_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS inbound_call_routes_call_control_idx
      ON public.inbound_call_routes (workspace_id, call_control_id)
      WHERE call_control_id <> '';

    CREATE INDEX IF NOT EXISTS agent_tasks_memory_idx
      ON public.agent_tasks (workspace_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS rex_decisions_created_idx
      ON public.rex_decisions (created_at DESC);

    DROP TRIGGER IF EXISTS coach_memory_set_updated_at ON public.coach_memory;
    CREATE TRIGGER coach_memory_set_updated_at
      BEFORE UPDATE ON public.coach_memory
      FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

    DROP TRIGGER IF EXISTS skills_set_updated_at ON public.skills;
    CREATE TRIGGER skills_set_updated_at
      BEFORE UPDATE ON public.skills
      FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

    DROP TRIGGER IF EXISTS ava_learning_sessions_set_updated_at ON public.ava_learning_sessions;
    CREATE TRIGGER ava_learning_sessions_set_updated_at
      BEFORE UPDATE ON public.ava_learning_sessions
      FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

    DROP TRIGGER IF EXISTS ava_active_memories_set_updated_at ON public.ava_active_memories;
    CREATE TRIGGER ava_active_memories_set_updated_at
      BEFORE UPDATE ON public.ava_active_memories
      FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

    DROP TRIGGER IF EXISTS inbound_call_routes_set_updated_at ON public.inbound_call_routes;
    CREATE TRIGGER inbound_call_routes_set_updated_at
      BEFORE UPDATE ON public.inbound_call_routes
      FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

    DROP TRIGGER IF EXISTS agent_tasks_set_updated_at ON public.agent_tasks;
    CREATE TRIGGER agent_tasks_set_updated_at
      BEFORE UPDATE ON public.agent_tasks
      FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();
  `);
}

async function seedMemoryAnalyticsStateToPg() {
  const pool = getPgPool();
  if (!pool) return false;
  try {
    const skills = flattenBridgeSkills();
    for (const skill of skills) {
      await pool.query(
        `INSERT INTO public.skills (
          id, workspace_id, agent_id, agent_name, name, source, level, status,
          confidence, evidence, metadata, created_at, updated_at
        )
        VALUES ($1,'pbk',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
        ON CONFLICT (workspace_id, agent_id, name) DO UPDATE SET
          source = EXCLUDED.source,
          level = EXCLUDED.level,
          status = EXCLUDED.status,
          confidence = EXCLUDED.confidence,
          evidence = EXCLUDED.evidence,
          metadata = public.skills.metadata || EXCLUDED.metadata,
          updated_at = NOW()`,
        [
          skill.id || `${skill.agentId || 'agent'}:${slugify(skill.name || 'skill')}`,
          skill.agentId || '',
          skill.agentName || skill.agentId || 'Agent',
          skill.name || 'Unnamed skill',
          skill.source || 'bridge-state',
          skill.level || 'candidate',
          skill.status || 'active',
          Number(skill.confidence || 0),
          skill.evidence || '',
          JSON.stringify({ seededFrom: 'bridge-state', seededAt: isoNow() }),
        ],
      );
    }

    const history = buildFallbackAgentHistory(50).history || [];
    for (const item of history) {
      await pool.query(
        `INSERT INTO public.agent_tasks (
          id, workspace_id, requested_by, action, provider, status, summary, payload, created_at, updated_at
        )
        VALUES ($1,'pbk',$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
        ON CONFLICT (id) DO UPDATE SET
          requested_by = EXCLUDED.requested_by,
          action = EXCLUDED.action,
          provider = EXCLUDED.provider,
          status = EXCLUDED.status,
          summary = EXCLUDED.summary,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at`,
        [
          item.id || `memory-history-${hashString(JSON.stringify(item)).slice(0, 12)}`,
          item.actor || item.agentName || 'PBK bridge',
          item.action || item.verb || 'agent_memory_event',
          item.source || item.provider || 'pbk-bridge',
          item.status || 'complete',
          item.summary || item.description || item.title || '',
          JSON.stringify({
            ...item,
            agentId: item.agentId || item.targetAgentId || item.target || '',
            agentName: item.agentName || item.actor || '',
          }),
          item.createdAt || item.updatedAt || isoNow(),
          item.updatedAt || item.createdAt || isoNow(),
        ],
      );
    }
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] memory analytics seed skipped:', error?.message || error);
    return false;
  }
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

async function persistCampaignRecord(campaign = {}) {
  const pool = getPgPool();
  if (!pool || !campaign.id) return false;
  const channel = normalizeCampaignChannel(campaign.channel || 'email');
  const dbChannel = ['email', 'call', 'sms', 'mixed'].includes(channel) ? channel : 'mixed';
  try {
    await pool.query(
      `INSERT INTO public.campaigns (
        id, name, channel, provider, status, template_id, lead_source, lead_filter,
        schedule, sequence, metrics, approval_id, approval_status, pending_action,
        execution_id, provider_campaign_id, last_worker_run_at, suppression_mode,
        conflict_count, notes, created_by, created_at, updated_at, archived_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8::jsonb,
        $9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,
        $15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        channel = EXCLUDED.channel,
        provider = EXCLUDED.provider,
        status = EXCLUDED.status,
        template_id = EXCLUDED.template_id,
        lead_source = EXCLUDED.lead_source,
        lead_filter = EXCLUDED.lead_filter,
        schedule = EXCLUDED.schedule,
        sequence = EXCLUDED.sequence,
        metrics = EXCLUDED.metrics,
        approval_id = EXCLUDED.approval_id,
        approval_status = EXCLUDED.approval_status,
        pending_action = EXCLUDED.pending_action,
        execution_id = EXCLUDED.execution_id,
        provider_campaign_id = EXCLUDED.provider_campaign_id,
        last_worker_run_at = EXCLUDED.last_worker_run_at,
        suppression_mode = EXCLUDED.suppression_mode,
        conflict_count = EXCLUDED.conflict_count,
        notes = EXCLUDED.notes,
        created_by = EXCLUDED.created_by,
        updated_at = EXCLUDED.updated_at,
        archived_at = EXCLUDED.archived_at`,
      [
        campaign.id,
        campaign.name || 'Untitled campaign',
        dbChannel,
        campaign.provider || getCampaignProvider(channel),
        normalizeCampaignStatus(campaign.status || 'draft'),
        campaign.templateId || campaign.template_id || null,
        campaign.leadSource || campaign.lead_source || null,
        JSON.stringify(campaign.leadFilter || campaign.lead_filter || {}),
        JSON.stringify(campaign.schedule || {}),
        JSON.stringify(campaign.sequence || {}),
        JSON.stringify(campaign.metrics || {}),
        campaign.approvalId || campaign.approval_id || null,
        campaign.approvalStatus || campaign.approval_status || null,
        campaign.pendingAction || campaign.pending_action || null,
        campaign.executionId || campaign.execution_id || null,
        campaign.providerCampaignId || campaign.provider_campaign_id || null,
        campaign.lastWorkerRunAt || campaign.last_worker_run_at || null,
        campaign.suppressionMode || campaign.suppression_mode || 'same_channel_active_campaigns',
        toNumber(campaign.conflictCount ?? campaign.conflict_count, 0),
        campaign.notes || null,
        campaign.createdBy || campaign.created_by || 'PBK Command Center',
        campaign.createdAt || campaign.created_at || isoNow(),
        campaign.updatedAt || campaign.updated_at || isoNow(),
        campaign.archivedAt || campaign.archived_at || null,
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] campaign persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistCampaignLeadRecord(lead = {}) {
  const pool = getPgPool();
  if (!pool || !lead.id || !lead.campaignId) return false;
  try {
    await pool.query(
      `INSERT INTO public.campaign_leads (
        id, campaign_id, lead_id, lead_name, address, email, phone, tags,
        status, touch_index, last_touch_at, metadata, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12::jsonb,$13,$14)
      ON CONFLICT (id) DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id,
        lead_id = EXCLUDED.lead_id,
        lead_name = EXCLUDED.lead_name,
        address = EXCLUDED.address,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        tags = EXCLUDED.tags,
        status = EXCLUDED.status,
        touch_index = EXCLUDED.touch_index,
        last_touch_at = EXCLUDED.last_touch_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        lead.id,
        lead.campaignId,
        lead.leadId || null,
        lead.leadName || 'Unknown seller',
        lead.address || null,
        lead.email || null,
        lead.phone || null,
        normalizeStringList(lead.tags || []),
        lead.status || 'pending',
        toNumber(lead.touchIndex, 0),
        lead.lastTouchAt || null,
        JSON.stringify(lead.metadata || {}),
        lead.createdAt || isoNow(),
        lead.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] campaign lead persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistCampaignEventRecord(event = {}) {
  const pool = getPgPool();
  if (!pool || !event.id || !event.campaignId) return false;
  try {
    await pool.query(
      `INSERT INTO public.campaign_events (
        id, campaign_id, campaign_lead_id, lead_id, event_type, channel, provider,
        provider_event_id, provider_status, payload, occurred_at, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id,
        campaign_lead_id = EXCLUDED.campaign_lead_id,
        lead_id = EXCLUDED.lead_id,
        event_type = EXCLUDED.event_type,
        channel = EXCLUDED.channel,
        provider = EXCLUDED.provider,
        provider_event_id = EXCLUDED.provider_event_id,
        provider_status = EXCLUDED.provider_status,
        payload = EXCLUDED.payload,
        occurred_at = EXCLUDED.occurred_at`,
      [
        event.id,
        event.campaignId,
        event.campaignLeadId || null,
        event.leadId || null,
        event.eventType || 'note',
        normalizeCampaignChannel(event.channel || 'email'),
        event.provider || null,
        event.providerEventId || null,
        event.providerStatus || null,
        JSON.stringify(event.payload || {}),
        event.occurredAt || isoNow(),
        event.createdAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] campaign event persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistCampaignSuppressionRecord(suppression = {}) {
  const pool = getPgPool();
  if (!pool || !suppression.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.campaign_suppressions (
        id, lead_id, email, phone, address, channel, reason, source, metadata, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
      ON CONFLICT (id) DO UPDATE SET
        lead_id = EXCLUDED.lead_id,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        channel = EXCLUDED.channel,
        reason = EXCLUDED.reason,
        source = EXCLUDED.source,
        metadata = EXCLUDED.metadata`,
      [
        suppression.id,
        suppression.leadId || suppression.lead_id || null,
        suppression.email || null,
        suppression.phone || null,
        suppression.address || null,
        suppression.channel || null,
        suppression.reason || 'suppressed',
        suppression.source || null,
        JSON.stringify(suppression.metadata || {}),
        suppression.createdAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] campaign suppression persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistCampaignExecutionRecord(execution = {}) {
  const pool = getPgPool();
  if (!pool || !execution.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.campaign_executions (
        id, campaign_id, approval_id, provider, provider_campaign_id, status,
        result, lead_count, request, response, error, actor, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14)
      ON CONFLICT (id) DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id,
        approval_id = EXCLUDED.approval_id,
        provider = EXCLUDED.provider,
        provider_campaign_id = EXCLUDED.provider_campaign_id,
        status = EXCLUDED.status,
        result = EXCLUDED.result,
        lead_count = EXCLUDED.lead_count,
        request = EXCLUDED.request,
        response = EXCLUDED.response,
        error = EXCLUDED.error,
        actor = EXCLUDED.actor,
        updated_at = EXCLUDED.updated_at`,
      [
        execution.id,
        execution.campaignId || execution.campaign_id || null,
        execution.approvalId || execution.approval_id || null,
        execution.provider || execution.instantly?.provider || 'instantly',
        execution.providerCampaignId || execution.provider_campaign_id || null,
        execution.status || 'queued',
        execution.result || null,
        toNumber(execution.leadCount, 0),
        JSON.stringify(execution.instantly?.request || execution.request || {}),
        JSON.stringify(execution.instantly?.response || execution.response || {}),
        execution.error || execution.instantly?.error || null,
        execution.actor || null,
        execution.createdAt || isoNow(),
        execution.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] campaign execution persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistCampaignWorkerRunRecord(run = {}) {
  const pool = getPgPool();
  if (!pool || !run.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.campaign_worker_runs (
        id, status, result, dry_run, allow_provider_writes, processed_count,
        skipped_count, processed, skipped, actor, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        result = EXCLUDED.result,
        dry_run = EXCLUDED.dry_run,
        allow_provider_writes = EXCLUDED.allow_provider_writes,
        processed_count = EXCLUDED.processed_count,
        skipped_count = EXCLUDED.skipped_count,
        processed = EXCLUDED.processed,
        skipped = EXCLUDED.skipped,
        actor = EXCLUDED.actor`,
      [
        run.id,
        run.status || 'complete',
        run.result || 'local_view_only',
        Boolean(run.dryRun),
        Boolean(run.allowProviderWrites),
        toNumber(run.processedCount, 0),
        toNumber(run.skippedCount, 0),
        JSON.stringify(run.processed || []),
        JSON.stringify(run.skipped || []),
        run.actor || 'Campaign worker',
        run.createdAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] campaign worker run persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistAgentConfigRecord(key = '', value = {}, actor = 'Rex Strategist') {
  const pool = getPgPool();
  const normalizedKey = String(key || '').trim();
  if (!pool || !normalizedKey) return false;
  try {
    await pool.query(
      `INSERT INTO public.pbk_agent_config (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [normalizedKey, JSON.stringify(value || {}), actor || 'Rex Strategist'],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] agent config persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistRexDecisionRecord(decision = {}) {
  const pool = getPgPool();
  if (!pool || !decision.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.rex_decisions (
        id, source, tool, params, rationale, status, target_type, target_id,
        approval_id, baseline, outcome, result, success, proposed_by, approved_by,
        applied_by, created_at, updated_at, applied_at, evaluated_at
      )
      VALUES (
        $1,$2,$3,$4::jsonb,$5,$6,$7,$8,
        $9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,
        $16,$17,$18,$19,$20
      )
      ON CONFLICT (id) DO UPDATE SET
        source = EXCLUDED.source,
        tool = EXCLUDED.tool,
        params = EXCLUDED.params,
        rationale = EXCLUDED.rationale,
        status = EXCLUDED.status,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        approval_id = EXCLUDED.approval_id,
        baseline = EXCLUDED.baseline,
        outcome = EXCLUDED.outcome,
        result = EXCLUDED.result,
        success = EXCLUDED.success,
        proposed_by = EXCLUDED.proposed_by,
        approved_by = EXCLUDED.approved_by,
        applied_by = EXCLUDED.applied_by,
        updated_at = EXCLUDED.updated_at,
        applied_at = EXCLUDED.applied_at,
        evaluated_at = EXCLUDED.evaluated_at`,
      [
        decision.id,
        decision.source || 'rex-strategist',
        decision.tool || '',
        JSON.stringify(decision.params || {}),
        decision.rationale || '',
        decision.status || 'proposed',
        decision.targetType || decision.target_type || null,
        decision.targetId || decision.target_id || null,
        decision.approvalId || decision.approval_id || null,
        JSON.stringify(decision.baseline || {}),
        JSON.stringify(decision.outcome || {}),
        JSON.stringify(decision.result || {}),
        typeof decision.success === 'boolean' ? decision.success : null,
        decision.proposedBy || decision.proposed_by || 'Rex Strategist',
        decision.approvedBy || decision.approved_by || null,
        decision.appliedBy || decision.applied_by || null,
        decision.createdAt || decision.created_at || isoNow(),
        decision.updatedAt || decision.updated_at || isoNow(),
        decision.appliedAt || decision.applied_at || null,
        decision.evaluatedAt || decision.evaluated_at || null,
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] Rex decision persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistAttachmentMetadata(attachment = {}) {
  const pool = getPgPool();
  if (!pool || !attachment.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.attachments (
        id, workspace_id, lead_id, lead_name, address, filename, content_type, size_bytes,
        storage_bucket, storage_path, topic, tags, status, extraction_status, extraction_parser,
        extraction_error, text_characters, brain_doc_id, metadata, created_at, updated_at
      )
      VALUES (
        $1, 'pbk', $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11::jsonb, $12, $13, $14,
        $15, $16, $17, $18::jsonb, $19, $20
      )
      ON CONFLICT (id) DO UPDATE SET
        lead_id = EXCLUDED.lead_id,
        lead_name = EXCLUDED.lead_name,
        address = EXCLUDED.address,
        filename = EXCLUDED.filename,
        content_type = EXCLUDED.content_type,
        size_bytes = EXCLUDED.size_bytes,
        storage_bucket = EXCLUDED.storage_bucket,
        storage_path = EXCLUDED.storage_path,
        topic = EXCLUDED.topic,
        tags = EXCLUDED.tags,
        status = EXCLUDED.status,
        extraction_status = EXCLUDED.extraction_status,
        extraction_parser = EXCLUDED.extraction_parser,
        extraction_error = EXCLUDED.extraction_error,
        text_characters = EXCLUDED.text_characters,
        brain_doc_id = EXCLUDED.brain_doc_id,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        attachment.id,
        attachment.leadId || '',
        attachment.leadName || '',
        attachment.address || '',
        attachment.filename || 'attachment',
        attachment.contentType || 'application/octet-stream',
        Math.max(0, Number(attachment.size || attachment.sizeBytes || 0)),
        attachment.bucket || SUPABASE_ATTACHMENTS_BUCKET,
        attachment.storagePath || '',
        attachment.topic || '',
        JSON.stringify(attachment.tags || []),
        attachment.status || 'stored',
        attachment.extractionStatus || 'stored-only',
        attachment.extractionParser || '',
        attachment.extractionError || '',
        Math.max(0, Number(attachment.textCharacters || 0)),
        attachment.brainDocId || '',
        JSON.stringify({
          signedUrlExpiresIn: attachment.signedUrlExpiresIn || 0,
        }),
        attachment.createdAt || isoNow(),
        attachment.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] attachment metadata persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistEmailLogRecord(record = {}) {
  const pool = getPgPool();
  if (!pool || !record.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.email_log (
        id, workspace_id, lead_id, lead_name, message_id, email_type, provider,
        recipient_email, subject, status, live, storage_path, signed_url_expires_in,
        metadata, sent_at, created_at, updated_at
      )
      VALUES (
        $1, 'pbk', $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13::jsonb, $14, $15, $16
      )
      ON CONFLICT (id) DO UPDATE SET
        lead_id = EXCLUDED.lead_id,
        lead_name = EXCLUDED.lead_name,
        message_id = EXCLUDED.message_id,
        email_type = EXCLUDED.email_type,
        provider = EXCLUDED.provider,
        recipient_email = EXCLUDED.recipient_email,
        subject = EXCLUDED.subject,
        status = EXCLUDED.status,
        live = EXCLUDED.live,
        storage_path = EXCLUDED.storage_path,
        signed_url_expires_in = EXCLUDED.signed_url_expires_in,
        metadata = EXCLUDED.metadata,
        sent_at = EXCLUDED.sent_at,
        updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.leadId || '',
        record.leadName || '',
        record.messageId || '',
        record.type || 'transactional',
        record.provider || '',
        record.to || record.recipientEmail || '',
        record.subject || '',
        record.status || 'queued',
        Boolean(record.live),
        record.storagePath || '',
        Math.max(0, Number(record.signedUrlExpiresIn || 0)),
        JSON.stringify(record.metadata || {}),
        record.ok ? isoNow() : null,
        record.createdAt || isoNow(),
        record.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] email log persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistUnifiedMessageRecord(message = {}) {
  const pool = getPgPool();
  if (!pool || !message.id) return false;
  const payload = {
    ...(message.payload && typeof message.payload === 'object' ? message.payload : {}),
    leadName: message.leadName || '',
    address: message.address || '',
    phone: message.phone || '',
    email: message.email || '',
    callId: message.callId || '',
    storagePath: message.storagePath || '',
    storageBucket: message.storageBucket || '',
    audioContentType: message.audioContentType || '',
    durationSeconds: message.durationSeconds ?? null,
    recordingUrl: message.recordingUrl || '',
  };
  const baseValues = [
    message.id,
    message.leadProfileId || null,
    message.workspaceId || 'pbk',
    message.channel || 'call',
    message.direction || 'recording',
    message.status || 'recorded',
    message.provider || '',
    message.fromEmail || '',
    message.toEmail || message.email || '',
    message.fromPhone || message.from || '',
    message.toPhone || message.phone || '',
    message.subject || '',
    message.body || '',
    message.intent || '',
    message.sentiment ?? null,
    JSON.stringify(payload),
    message.createdAt || isoNow(),
    message.updatedAt || isoNow(),
  ];
  const recordingValues = [
    message.storagePath || '',
    message.storageBucket || '',
    message.audioContentType || '',
    message.durationSeconds ?? null,
    message.recordingUrl || '',
  ];
  const fullSql = `INSERT INTO public.unified_messages (
      id, lead_id, workspace_id, channel, direction, status, provider,
      from_email, to_email, from_phone, to_phone, subject, body, intent,
      sentiment, payload, created_at, updated_at,
      storage_path, storage_bucket, audio_content_type, duration_seconds, recording_url
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT (id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      channel = EXCLUDED.channel,
      direction = EXCLUDED.direction,
      status = EXCLUDED.status,
      provider = EXCLUDED.provider,
      from_email = EXCLUDED.from_email,
      to_email = EXCLUDED.to_email,
      from_phone = EXCLUDED.from_phone,
      to_phone = EXCLUDED.to_phone,
      subject = EXCLUDED.subject,
      body = EXCLUDED.body,
      intent = EXCLUDED.intent,
      sentiment = EXCLUDED.sentiment,
      payload = EXCLUDED.payload,
      storage_path = EXCLUDED.storage_path,
      storage_bucket = EXCLUDED.storage_bucket,
      audio_content_type = EXCLUDED.audio_content_type,
      duration_seconds = EXCLUDED.duration_seconds,
      recording_url = EXCLUDED.recording_url,
      updated_at = EXCLUDED.updated_at`;
  const baseSql = `INSERT INTO public.unified_messages (
      id, lead_id, workspace_id, channel, direction, status, provider,
      from_email, to_email, from_phone, to_phone, subject, body, intent,
      sentiment, payload, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)
    ON CONFLICT (id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      channel = EXCLUDED.channel,
      direction = EXCLUDED.direction,
      status = EXCLUDED.status,
      provider = EXCLUDED.provider,
      from_email = EXCLUDED.from_email,
      to_email = EXCLUDED.to_email,
      from_phone = EXCLUDED.from_phone,
      to_phone = EXCLUDED.to_phone,
      subject = EXCLUDED.subject,
      body = EXCLUDED.body,
      intent = EXCLUDED.intent,
      sentiment = EXCLUDED.sentiment,
      payload = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at`;
  try {
    await pool.query(fullSql, [...baseValues, ...recordingValues]);
    return true;
  } catch (error) {
    const messageText = String(error?.message || error || '');
    if (!/column .* does not exist|violates foreign key constraint/i.test(messageText)) {
      console.warn('[pbk-local-openclaw] unified message persistence skipped:', messageText);
      return false;
    }
    try {
      const retryValues = [...baseValues];
      retryValues[1] = null;
      await pool.query(baseSql, retryValues);
      return true;
    } catch (fallbackError) {
      console.warn('[pbk-local-openclaw] unified message fallback persistence skipped:', fallbackError?.message || fallbackError);
      return false;
    }
  }
}

async function persistBrainBlogPostRecord(post = {}) {
  const pool = getPgPool();
  if (!pool || !post.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.brain_blog_posts (
        id, title, source_url, source_type, source_name, published_at,
        content, summary, key_takeaways, tags, revenue_streams, sales_mentor,
        technique_type, content_hash, status, trained_at, metadata, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9::text[], $10::text[], $11::text[], $12,
        $13, $14, $15, $16, $17::jsonb, $18, $19
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        source_url = EXCLUDED.source_url,
        source_type = EXCLUDED.source_type,
        source_name = EXCLUDED.source_name,
        published_at = EXCLUDED.published_at,
        content = EXCLUDED.content,
        summary = EXCLUDED.summary,
        key_takeaways = EXCLUDED.key_takeaways,
        tags = EXCLUDED.tags,
        revenue_streams = EXCLUDED.revenue_streams,
        sales_mentor = EXCLUDED.sales_mentor,
        technique_type = EXCLUDED.technique_type,
        content_hash = EXCLUDED.content_hash,
        status = EXCLUDED.status,
        trained_at = EXCLUDED.trained_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        post.id,
        post.title || 'Untitled Brain post',
        post.sourceUrl || '',
        post.sourceType || 'manual',
        post.sourceName || post.source || '',
        post.publishedAt || null,
        post.content || '',
        post.summary || '',
        normalizeStringList(post.keyTakeaways || []),
        normalizeStringList(post.tags || []),
        normalizeStringList(post.revenueStreams || []),
        post.salesMentor || '',
        post.techniqueType || '',
        post.contentHash || '',
        post.status || 'ready',
        post.trainedAt || null,
        JSON.stringify(post.metadata || {}),
        post.createdAt || isoNow(),
        post.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] brain blog persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistMarketIntelRecord(entry = {}) {
  const pool = getPgPool();
  if (!pool || !entry.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.market_intel (
        id, market, zip_code, property_type, competitive_offer_index, buyer_demand,
        median_investor_mao_pct, days_on_market_signal, confidence, source,
        status, notes, metadata, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        market = EXCLUDED.market,
        zip_code = EXCLUDED.zip_code,
        property_type = EXCLUDED.property_type,
        competitive_offer_index = EXCLUDED.competitive_offer_index,
        buyer_demand = EXCLUDED.buyer_demand,
        median_investor_mao_pct = EXCLUDED.median_investor_mao_pct,
        days_on_market_signal = EXCLUDED.days_on_market_signal,
        confidence = EXCLUDED.confidence,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        entry.id,
        entry.market || '',
        entry.zipCode || '',
        entry.propertyType || '',
        entry.competitiveOfferIndex ?? null,
        entry.buyerDemand || '',
        entry.medianInvestorMaoPct ?? null,
        entry.daysOnMarketSignal ?? null,
        entry.confidence ?? null,
        entry.source || '',
        entry.status || 'live',
        entry.notes || '',
        JSON.stringify(entry.metadata || {}),
        entry.createdAt || isoNow(),
        entry.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] market intel persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistLeadNurturePlanRecord(plan = {}) {
  const pool = getPgPool();
  if (!pool || !plan.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.lead_nurture_plans (
        id, lead_id, lead_name, address, status, cadence_days, channels,
        steps, approval_id, metadata, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::text[],$8::jsonb,$9,$10::jsonb,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        lead_id = EXCLUDED.lead_id,
        lead_name = EXCLUDED.lead_name,
        address = EXCLUDED.address,
        status = EXCLUDED.status,
        cadence_days = EXCLUDED.cadence_days,
        channels = EXCLUDED.channels,
        steps = EXCLUDED.steps,
        approval_id = EXCLUDED.approval_id,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        plan.id,
        plan.leadId || '',
        plan.leadName || '',
        plan.address || '',
        plan.status || 'approval_required',
        JSON.stringify(plan.cadenceDays || []),
        normalizeStringList(plan.channels || []),
        JSON.stringify(plan.steps || []),
        plan.approvalId || '',
        JSON.stringify(plan.metadata || {}),
        plan.createdAt || isoNow(),
        plan.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] nurture plan persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistDealSimulationRecord(simulation = {}) {
  const pool = getPgPool();
  if (!pool || !simulation.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.deal_simulations (
        id, lead_id, lead_name, address, path_type, base_arv, base_repairs,
        offer_price, expected_profit, probability_of_loss, profit_range,
        recommendation, scenarios, assumptions, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        lead_id = EXCLUDED.lead_id,
        lead_name = EXCLUDED.lead_name,
        address = EXCLUDED.address,
        path_type = EXCLUDED.path_type,
        base_arv = EXCLUDED.base_arv,
        base_repairs = EXCLUDED.base_repairs,
        offer_price = EXCLUDED.offer_price,
        expected_profit = EXCLUDED.expected_profit,
        probability_of_loss = EXCLUDED.probability_of_loss,
        profit_range = EXCLUDED.profit_range,
        recommendation = EXCLUDED.recommendation,
        scenarios = EXCLUDED.scenarios,
        assumptions = EXCLUDED.assumptions,
        updated_at = EXCLUDED.updated_at`,
      [
        simulation.id,
        simulation.leadId || '',
        simulation.leadName || '',
        simulation.address || '',
        simulation.pathType || '',
        simulation.arv ?? null,
        simulation.repairs ?? null,
        simulation.offer ?? null,
        simulation.expectedProfit ?? null,
        simulation.probabilityOfLoss ?? null,
        JSON.stringify(simulation.profitRange || {}),
        simulation.recommendation || '',
        JSON.stringify(simulation.scenarios || []),
        JSON.stringify(simulation.assumptions || {}),
        simulation.createdAt || isoNow(),
        simulation.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] deal simulation persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistBuyerRecord(buyer = {}) {
  const pool = getPgPool();
  if (!pool || !buyer.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.buyers (
        id, name, status, zip_codes, markets, property_types, price_min,
        price_max, desired_roi, max_repairs, notes, tags, metadata, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4::text[],$5::text[],$6::text[],$7,$8,$9,$10,$11,$12::text[],$13::jsonb,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        zip_codes = EXCLUDED.zip_codes,
        markets = EXCLUDED.markets,
        property_types = EXCLUDED.property_types,
        price_min = EXCLUDED.price_min,
        price_max = EXCLUDED.price_max,
        desired_roi = EXCLUDED.desired_roi,
        max_repairs = EXCLUDED.max_repairs,
        notes = EXCLUDED.notes,
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        buyer.id,
        buyer.name || 'Buyer',
        buyer.status || 'active',
        normalizeStringList(buyer.zipCodes || []),
        normalizeStringList(buyer.markets || []),
        normalizeStringList(buyer.propertyTypes || []),
        buyer.priceMin ?? null,
        buyer.priceMax ?? null,
        buyer.desiredRoi ?? null,
        buyer.maxRepairs ?? null,
        buyer.notes || '',
        normalizeStringList(buyer.tags || []),
        JSON.stringify(buyer.metadata || {}),
        buyer.createdAt || isoNow(),
        buyer.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] buyer persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistBuyerMatchRecord(match = {}) {
  const pool = getPgPool();
  if (!pool || !match.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.buyer_matches (
        id, deal, matches, top_buyer, status, created_at, updated_at
      )
      VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        deal = EXCLUDED.deal,
        matches = EXCLUDED.matches,
        top_buyer = EXCLUDED.top_buyer,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at`,
      [
        match.id,
        JSON.stringify(match.deal || {}),
        JSON.stringify(match.matches || []),
        JSON.stringify(match.topBuyer || null),
        match.status || '',
        match.createdAt || isoNow(),
        match.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] buyer match persistence skipped:', error?.message || error);
    return false;
  }
}

async function persistSystemAuditReportRecord(report = {}) {
  const pool = getPgPool();
  if (!pool || !report.id) return false;
  try {
    await pool.query(
      `INSERT INTO public.system_audit_reports (
        id, status, estimated_monthly_ai_cost, cost_per_lead, error_rate,
        avg_latency_ms, recommendations, metadata, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8::jsonb,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        estimated_monthly_ai_cost = EXCLUDED.estimated_monthly_ai_cost,
        cost_per_lead = EXCLUDED.cost_per_lead,
        error_rate = EXCLUDED.error_rate,
        avg_latency_ms = EXCLUDED.avg_latency_ms,
        recommendations = EXCLUDED.recommendations,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        report.id,
        report.status || 'healthy',
        report.estimatedMonthlyAiCost ?? null,
        report.costPerLead ?? null,
        report.errorRate ?? null,
        report.avgLatencyMs ?? null,
        normalizeStringList(report.recommendations || []),
        JSON.stringify(report.metadata || {}),
        report.createdAt || isoNow(),
        report.updatedAt || isoNow(),
      ],
    );
    return true;
  } catch (error) {
    console.warn('[pbk-local-openclaw] system audit persistence skipped:', error?.message || error);
    return false;
  }
}

function limitStateArrays(nextState) {
  nextState.approvals = sortNewest(nextState.approvals).slice(0, LIMITS.approvals);
  nextState.activity = sortNewest(nextState.activity).slice(0, LIMITS.activity);
  nextState.brainDocs = sortNewest(nextState.brainDocs).slice(0, LIMITS.brainDocs);
  nextState.brainBlogPosts = sortNewest(nextState.brainBlogPosts || []).slice(0, LIMITS.brainBlogPosts);
  nextState.marketIntel = sortNewest(nextState.marketIntel || []).slice(0, LIMITS.marketIntel);
  nextState.leadNurturePlans = sortNewest(nextState.leadNurturePlans || []).slice(0, LIMITS.leadNurturePlans);
  nextState.dealSimulations = sortNewest(nextState.dealSimulations || []).slice(0, LIMITS.dealSimulations);
  nextState.buyers = sortNewest(nextState.buyers || []).slice(0, LIMITS.buyers);
  nextState.buyerMatches = sortNewest(nextState.buyerMatches || []).slice(0, LIMITS.buyerMatches);
  nextState.systemAuditReports = sortNewest(nextState.systemAuditReports || []).slice(0, LIMITS.systemAuditReports);
  nextState.leadImports = sortNewest(nextState.leadImports).slice(0, LIMITS.leadImports);
  nextState.analyzerRuns = sortNewest(nextState.analyzerRuns).slice(0, LIMITS.analyzerRuns);
  nextState.propertyCache = sortNewest(nextState.propertyCache || []).slice(0, LIMITS.propertyCache);
  nextState.dncEntries = sortNewest(nextState.dncEntries).slice(0, LIMITS.dncEntries);
  nextState.calls = sortNewest(nextState.calls).slice(0, LIMITS.calls);
  nextState.messages = sortNewest(nextState.messages).slice(0, LIMITS.messages);
  nextState.appointments = sortNewest(nextState.appointments).slice(0, LIMITS.appointments);
  nextState.leadStageTransitions = sortNewest(nextState.leadStageTransitions).slice(0, LIMITS.leadStageTransitions);
  nextState.contracts = sortNewest(nextState.contracts).slice(0, LIMITS.contracts);
  nextState.documentDeliveries = sortNewest(nextState.documentDeliveries).slice(0, LIMITS.documentDeliveries);
  nextState.attachments = sortNewest(nextState.attachments || []).slice(0, LIMITS.attachments);
  nextState.browserResearchJobs = sortNewest(nextState.browserResearchJobs || []).slice(0, LIMITS.browserResearchJobs);
  nextState.campaigns = sortNewest(nextState.campaigns || []).slice(0, LIMITS.campaigns);
  nextState.campaignLeads = sortNewest(nextState.campaignLeads || []).slice(0, LIMITS.campaignLeads);
  nextState.campaignEvents = sortNewest(nextState.campaignEvents || []).slice(0, LIMITS.campaignEvents);
  nextState.campaignSuppressions = sortNewest(nextState.campaignSuppressions || []).slice(0, LIMITS.campaignSuppressions);
  nextState.campaignExecutions = sortNewest(nextState.campaignExecutions || []).slice(0, LIMITS.campaignExecutions);
  nextState.rexDecisions = sortNewest(nextState.rexDecisions || []).slice(0, LIMITS.rexDecisions);
  nextState.avaActiveMemories = sortNewest(nextState.avaActiveMemories || []).slice(0, LIMITS.avaActiveMemories);
  nextState.avaLearningSessions = sortNewest(nextState.avaLearningSessions || []).slice(0, LIMITS.avaLearningSessions);
  nextState.inboundCallRoutes = sortNewest(nextState.inboundCallRoutes || []).slice(0, LIMITS.inboundCallRoutes);
  nextState.promptPatchApplications = sortNewest(nextState.promptPatchApplications || []).slice(0, LIMITS.promptPatchApplications);
  nextState.recordingRetentionRuns = sortNewest(nextState.recordingRetentionRuns || []).slice(0, LIMITS.recordingRetentionRuns);
  nextState.adminTasks = sortNewest(nextState.adminTasks).slice(0, LIMITS.adminTasks);
  nextState.adminAudit = sortNewest(nextState.adminAudit).slice(0, LIMITS.adminAudit);
}

function updateDerivedStatus(nextState) {
  const settings = nextState.settings && typeof nextState.settings === 'object' ? nextState.settings : {};
  const operatingMode = String(settings.operatingMode || settings.ui?.operatingMode || nextState.status.mode || 'approval').trim();
  nextState.status.mode = ['autopilot', 'approval', 'manual'].includes(operatingMode) ? operatingMode : 'approval';
  nextState.status.sourcesIndexed = nextState.brainDocs.length + (nextState.brainBlogPosts || []).length;
  nextState.status.brainBlogPosts = (nextState.brainBlogPosts || []).length;
  nextState.status.marketIntelCount = (nextState.marketIntel || []).length;
  nextState.status.activeNurturePlans = (nextState.leadNurturePlans || []).filter((plan) => ['active', 'queued', 'approval_required'].includes(String(plan.status || '').toLowerCase())).length;
  nextState.status.dealSimulations = (nextState.dealSimulations || []).length;
  nextState.status.activeBuyers = (nextState.buyers || []).filter((buyer) => String(buyer.status || 'active').toLowerCase() === 'active').length;
  nextState.status.buyerMatches = (nextState.buyerMatches || []).length;
  nextState.status.systemAuditReports = (nextState.systemAuditReports || []).length;
  nextState.status.pendingApprovals = nextState.approvals.filter((approval) => approval.status === 'pending').length;
  nextState.status.pendingAdminTasks = nextState.adminTasks.filter((task) => task.status === 'pending').length;
  nextState.status.activeCalls = nextState.calls.filter((call) => call.status === 'live').length;
  nextState.status.appointmentsScheduled = nextState.appointments.filter((appointment) => ['scheduled', 'confirmed'].includes(String(appointment.status || '').toLowerCase())).length;
  nextState.status.pendingBookingRequests = nextState.appointments.filter((appointment) => ['requested', 'call-now', 'pending-confirmation'].includes(String(appointment.status || '').toLowerCase())).length;
  nextState.status.leadStageTransitionsToday = nextState.leadStageTransitions.filter((transition) => String(transition.createdAt || '').slice(0, 10) === isoNow().slice(0, 10)).length;
  nextState.status.dncCount = nextState.dncEntries.length;
  nextState.status.contractsOpen = nextState.contracts.filter((contract) => !['completed', 'void', 'rejected'].includes(String(contract.status || '').toLowerCase())).length;
  nextState.status.documentDeliveries = nextState.documentDeliveries.length;
  nextState.status.attachmentsStored = (nextState.attachments || []).length;
  nextState.status.browserResearchJobs = (nextState.browserResearchJobs || []).length;
  nextState.status.pendingBrowserResearchJobs = (nextState.browserResearchJobs || []).filter((job) => ['queued', 'running', 'setup-required'].includes(String(job.status || '').toLowerCase())).length;
  nextState.status.campaigns = (nextState.campaigns || []).length;
  nextState.status.activeCampaigns = (nextState.campaigns || []).filter((campaign) => String(campaign.status || '').toLowerCase() === 'active').length;
  nextState.status.pendingCampaigns = (nextState.campaigns || []).filter((campaign) => ['pending', 'approval_required'].includes(String(campaign.status || '').toLowerCase())).length;
  nextState.status.campaignEvents = (nextState.campaignEvents || []).length;
  nextState.status.avaActiveMemories = (nextState.avaActiveMemories || []).length;
  nextState.status.avaLearningSessions = (nextState.avaLearningSessions || []).length;
  nextState.status.inboundCallRoutes = (nextState.inboundCallRoutes || []).length;
  nextState.status.propertyCacheCount = (nextState.propertyCache || []).length;
  nextState.status.propertyCacheTtlDays = PROPERTY_CACHE_TTL_DAYS;
  nextState.status.lastApprovalAt = nextState.approvals[0]?.createdAt || null;
  nextState.status.lastAdminTaskAt = getItemTimestamp(nextState.adminTasks[0] || {}) || null;
  nextState.status.lastImportAt = nextState.leadImports[0]?.createdAt || null;
  nextState.status.lastAnalyzerAt = nextState.analyzerRuns[0]?.createdAt || null;
  nextState.status.lastPropertyCacheAt = getItemTimestamp((nextState.propertyCache || [])[0] || {}) || null;
  nextState.status.lastCallAt = getItemTimestamp(nextState.calls[0] || {}) || null;
  nextState.status.lastMessageAt = getItemTimestamp(nextState.messages[0] || {}) || null;
  nextState.status.lastAppointmentAt = getItemTimestamp(nextState.appointments[0] || {}) || null;
  nextState.status.lastLeadTransitionAt = getItemTimestamp(nextState.leadStageTransitions[0] || {}) || null;
  nextState.status.lastContractAt = getItemTimestamp(nextState.contracts[0] || {}) || null;
  nextState.status.lastDocumentDeliveryAt = getItemTimestamp(nextState.documentDeliveries[0] || {}) || null;
  nextState.status.lastAttachmentAt = getItemTimestamp((nextState.attachments || [])[0] || {}) || null;
  nextState.status.lastBrowserResearchAt = getItemTimestamp((nextState.browserResearchJobs || [])[0] || {}) || nextState.status.lastBrowserResearchAt || null;
  nextState.status.lastCampaignAt = getItemTimestamp((nextState.campaigns || [])[0] || {}) || null;
  nextState.status.lastCampaignEventAt = getItemTimestamp((nextState.campaignEvents || [])[0] || {}) || null;
  nextState.status.lastAvaLearningAt = getItemTimestamp((nextState.avaLearningSessions || [])[0] || {}) || nextState.status.lastAvaLearningAt || null;
  nextState.status.lastInboundRouteAt = getItemTimestamp((nextState.inboundCallRoutes || [])[0] || {}) || nextState.status.lastInboundRouteAt || null;
  nextState.status.lastBrainBlogPostAt = getItemTimestamp((nextState.brainBlogPosts || [])[0] || {}) || null;
  nextState.status.lastMarketIntelAt = getItemTimestamp((nextState.marketIntel || [])[0] || {}) || null;
  nextState.status.lastDealSimulationAt = getItemTimestamp((nextState.dealSimulations || [])[0] || {}) || null;
  nextState.status.lastSystemAuditAt = getItemTimestamp((nextState.systemAuditReports || [])[0] || {}) || null;
  nextState.status.tools = [...TOOL_NAMES];
  nextState.status.toolUsage = {
    ...buildToolUsageSeed(),
    ...(nextState.status.toolUsage || {}),
  };
  nextState.status.n8n = {
    approvalWebhookConfigured: Boolean(APPROVAL_WEBHOOK_URL),
    leadWebhookConfigured: Boolean(LEAD_WEBHOOK_URL),
    workflowApiConfigured: getN8nWorkflowProviderMeta().ready,
    workflowDraftStore: true,
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
    brainBlogPosts: trimArray(raw.brainBlogPosts || defaults.brainBlogPosts, LIMITS.brainBlogPosts),
    marketIntel: trimArray(raw.marketIntel || defaults.marketIntel, LIMITS.marketIntel),
    leadNurturePlans: trimArray(raw.leadNurturePlans || defaults.leadNurturePlans, LIMITS.leadNurturePlans),
    dealSimulations: trimArray(raw.dealSimulations || defaults.dealSimulations, LIMITS.dealSimulations),
    buyers: trimArray(raw.buyers || defaults.buyers, LIMITS.buyers),
    buyerMatches: trimArray(raw.buyerMatches || defaults.buyerMatches, LIMITS.buyerMatches),
    systemAuditReports: trimArray(raw.systemAuditReports || defaults.systemAuditReports, LIMITS.systemAuditReports),
    leadImports: trimArray(raw.leadImports || defaults.leadImports, LIMITS.leadImports),
    analyzerRuns: trimArray(raw.analyzerRuns || defaults.analyzerRuns, LIMITS.analyzerRuns),
    propertyCache: trimArray(raw.propertyCache || defaults.propertyCache, LIMITS.propertyCache),
    dncEntries: trimArray(raw.dncEntries || defaults.dncEntries, LIMITS.dncEntries),
    calls: trimArray(raw.calls || defaults.calls, LIMITS.calls),
    messages: trimArray(raw.messages || defaults.messages, LIMITS.messages),
    appointments: trimArray(raw.appointments || defaults.appointments, LIMITS.appointments),
    leadStageTransitions: trimArray(raw.leadStageTransitions || defaults.leadStageTransitions, LIMITS.leadStageTransitions),
    contracts: trimArray(raw.contracts || defaults.contracts, LIMITS.contracts),
    documentDeliveries: trimArray(raw.documentDeliveries || defaults.documentDeliveries, LIMITS.documentDeliveries),
    attachments: trimArray(raw.attachments || defaults.attachments, LIMITS.attachments),
    browserResearchJobs: trimArray(raw.browserResearchJobs || defaults.browserResearchJobs, LIMITS.browserResearchJobs),
    campaigns: trimArray(raw.campaigns || defaults.campaigns, LIMITS.campaigns),
    campaignLeads: trimArray(raw.campaignLeads || defaults.campaignLeads, LIMITS.campaignLeads),
    campaignEvents: trimArray(raw.campaignEvents || defaults.campaignEvents, LIMITS.campaignEvents),
    campaignSuppressions: trimArray(raw.campaignSuppressions || defaults.campaignSuppressions, LIMITS.campaignSuppressions),
    campaignExecutions: trimArray(raw.campaignExecutions || defaults.campaignExecutions, LIMITS.campaignExecutions),
    rexDecisions: trimArray(raw.rexDecisions || defaults.rexDecisions, LIMITS.rexDecisions),
    avaActiveMemories: trimArray(raw.avaActiveMemories || defaults.avaActiveMemories, LIMITS.avaActiveMemories),
    avaLearningSessions: trimArray(raw.avaLearningSessions || defaults.avaLearningSessions, LIMITS.avaLearningSessions),
    inboundCallRoutes: trimArray(raw.inboundCallRoutes || defaults.inboundCallRoutes, LIMITS.inboundCallRoutes),
    promptPatchApplications: trimArray(raw.promptPatchApplications || defaults.promptPatchApplications, LIMITS.promptPatchApplications),
    recordingRetentionRuns: trimArray(raw.recordingRetentionRuns || defaults.recordingRetentionRuns, LIMITS.recordingRetentionRuns),
    settings: {
      ...defaults.settings,
      ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
      ui: {
        ...(defaults.settings?.ui || {}),
        ...(raw.settings?.ui && typeof raw.settings.ui === 'object' ? raw.settings.ui : {}),
      },
    },
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

function addBrainBlogPost(stateRef, post) {
  if (!Array.isArray(stateRef.brainBlogPosts)) stateRef.brainBlogPosts = [];
  const existingIndex = stateRef.brainBlogPosts.findIndex((item) =>
    item.id === post.id
    || (post.sourceUrl && item.sourceUrl === post.sourceUrl)
    || (post.contentHash && item.contentHash === post.contentHash),
  );
  if (existingIndex >= 0) {
    stateRef.brainBlogPosts.splice(existingIndex, 1, {
      ...stateRef.brainBlogPosts[existingIndex],
      ...post,
      updatedAt: post.updatedAt || isoNow(),
    });
  } else {
    stateRef.brainBlogPosts.unshift(post);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertById(stateRef, collectionName, item) {
  if (!Array.isArray(stateRef[collectionName])) stateRef[collectionName] = [];
  const existingIndex = stateRef[collectionName].findIndex((entry) => entry.id === item.id);
  if (existingIndex >= 0) {
    stateRef[collectionName].splice(existingIndex, 1, {
      ...stateRef[collectionName][existingIndex],
      ...item,
      updatedAt: item.updatedAt || isoNow(),
    });
  } else {
    stateRef[collectionName].unshift(item);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
  return item;
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

function addAttachmentRecord(stateRef, attachment) {
  if (!Array.isArray(stateRef.attachments)) stateRef.attachments = [];
  stateRef.attachments.unshift(attachment);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertBrowserResearchJob(stateRef, job) {
  if (!job?.id) return null;
  if (!Array.isArray(stateRef.browserResearchJobs)) stateRef.browserResearchJobs = [];
  const existingIndex = stateRef.browserResearchJobs.findIndex((item) => item.id === job.id);
  const next = {
    ...job,
    updatedAt: isoNow(),
  };
  if (existingIndex >= 0) {
    stateRef.browserResearchJobs.splice(existingIndex, 1, {
      ...stateRef.browserResearchJobs[existingIndex],
      ...next,
    });
  } else {
    stateRef.browserResearchJobs.unshift(next);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
  return next;
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
  const propertyValues = getPropertyAnalysisValues(params.propertyData || deal.propertyData || {});
  const fallbackArv = Math.round((120000 + (seed % 150000)) / 5000) * 5000;
  const fallbackRepairs = Math.round((16000 + (seed % 42000)) / 500) * 500;
  const arv =
    toMoneyNumber(params.arv, 0) ||
    toMoneyNumber(deal.arv, 0) ||
    propertyValues.arv ||
    averagePrices({ comps: propertyValues.compObject }) ||
    averagePrices(deal) ||
    fallbackArv;
  const repairsMid =
    toMoneyNumber(params.repairsMid, 0) ||
    toMoneyNumber(params.repairs, 0) ||
    toMoneyNumber(deal?.repairs?.mid, 0) ||
    propertyValues.repairsMid ||
    fallbackRepairs;
  const fee = toNumber(params.fee, 0) || toNumber(deal.fee, 9000) || 9000;
  const mao =
    toMoneyNumber(params.mao, 0) ||
    toMoneyNumber(deal.mao60, 0) ||
    propertyValues.mao ||
    Math.max(0, Math.round((arv - repairsMid) * 0.68 - fee));
  const targetOffer =
    toMoneyNumber(params.offerPrice, 0) ||
    toMoneyNumber(deal.offer, 0) ||
    toMoneyNumber(deal.agreedPrice, 0) ||
    propertyValues.targetOffer ||
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
    comps: propertyValues.comps,
    enrichment: params.enrichment || null,
    status: params.status || 'complete',
    createdAt: isoNow(),
  };
}

function scoreBrainDocMatch(doc, query) {
  const haystack = [
    doc.title,
    doc.excerpt,
    doc.summary,
    doc.topic,
    doc.salesMentor,
    doc.techniqueType,
    ...(doc.revenueStreams || []),
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

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXmlEntities(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function inferBrainBlogTags(text = '') {
  const normalized = String(text || '').toLowerCase();
  const tags = [];
  if (/\bprobate|executor|estate\b/.test(normalized)) tags.push('Probate');
  if (/\bsubject[-\s]?to|subto|mortgage|payment\b/.test(normalized)) tags.push('Subject-To', 'Creative Finance');
  if (/\bseller finance|owner finance|terms\b/.test(normalized)) tags.push('Seller Financing');
  if (/\bmao|arv|repair|comp|assignment|cash offer\b/.test(normalized)) tags.push('Cash Deals', 'Analyzer');
  if (/\bobjection|think about|wife|price|more money|follow up\b/.test(normalized)) tags.push('Objection Handling', 'Negotiation');
  if (/\btcpa|consent|dnc|compliance|legal\b/.test(normalized)) tags.push('Legal & TCPA');
  if (/\bmarket|inventory|rates|foreclosure|dom\b/.test(normalized)) tags.push('Market Reports');
  return normalizeStringList(tags.length ? tags : ['Wholesaling']);
}

function inferSalesMentor(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (normalized.includes('jordan belfort') || normalized.includes('straight line')) return 'Jordan Belfort';
  if (normalized.includes('alex mineo')) return 'Alex Mineo';
  if (normalized.includes('cory boatright')) return 'Cory Boatright';
  if (normalized.includes('brent daniels') || normalized.includes('talk to people') || normalized.includes('ttp')) return 'Brent Daniels';
  return 'PBK Research';
}

function inferTechniqueType(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (/\bobjection|rebuttal|think about|wife|more money\b/.test(normalized)) return 'objection_handling';
  if (/\bscript|pitch|talk track|opening\b/.test(normalized)) return 'closing_script';
  if (/\bfollow up|nurture|sequence\b/.test(normalized)) return 'follow_up';
  if (/\bsubject[-\s]?to|seller finance|creative finance|terms\b/.test(normalized)) return 'creative_finance';
  if (/\btcpa|dnc|consent|legal|compliance\b/.test(normalized)) return 'compliance';
  if (/\bmarket|inventory|rates|dom|foreclosure\b/.test(normalized)) return 'market_research';
  if (/\bmao|arv|comp|repair|analyzer\b/.test(normalized)) return 'deal_analysis';
  return 'sales_knowledge';
}

function inferRevenueStreams(text = '', tags = []) {
  const normalized = `${String(text || '').toLowerCase()} ${normalizeStringList(tags).join(' ').toLowerCase()}`;
  const streams = [];
  if (/\bsubject[-\s]?to|subto\b/.test(normalized)) streams.push('Subject-To');
  if (/\bseller financing|seller finance|creative finance|terms\b/.test(normalized)) streams.push('Creative Finance', 'Seller Financing');
  if (/\bcash|mao|arv|repair|assignment|wholesale\b/.test(normalized)) streams.push('Cash Deals', 'Wholesaling');
  if (/\bnovation\b/.test(normalized)) streams.push('Novation');
  if (/\bprobate\b/.test(normalized)) streams.push('Probate');
  if (/\btcpa|compliance|dnc\b/.test(normalized)) streams.push('Legal & TCPA');
  return normalizeStringList(streams.length ? streams : ['Wholesaling']);
}

function buildBrainBlogSummary(content = '') {
  const text = stripHtml(content).slice(0, 900);
  if (!text) return 'No summary generated yet.';
  const sentence = text.split(/(?<=[.!?])\s+/).find((item) => item.length > 40) || text;
  return sentence.slice(0, 320);
}

function buildBrainBlogTakeaways(content = '', tags = []) {
  const normalizedTags = normalizeStringList(tags);
  const takeaways = [];
  if (normalizedTags.includes('Objection Handling')) takeaways.push('Identify the hidden uncertainty before repeating the offer.');
  if (normalizedTags.includes('Creative Finance') || normalizedTags.includes('Subject-To')) takeaways.push('Frame terms around relief, risk disclosure, and underwriting approval.');
  if (normalizedTags.includes('Cash Deals')) takeaways.push('Anchor the offer in ARV, repairs, and exit risk rather than ego or pressure.');
  if (normalizedTags.includes('Legal & TCPA')) takeaways.push('Keep compliance language explicit before any outreach or AI-assisted call.');
  if (!takeaways.length) takeaways.push(stripHtml(content).slice(0, 160) || 'Review the full source before applying this tactic.');
  return takeaways.slice(0, 4);
}

function normalizeBrainBlogPost(input = {}) {
  const now = isoNow();
  const title = String(input.title || input.name || 'Untitled Brain post').trim().slice(0, 180);
  const rawContent = String(input.content || input.transcript || input.body || input.summary || '').trim();
  const content = stripHtml(rawContent || input.description || input.excerpt || '');
  const sourceUrl = String(input.sourceUrl || input.url || input.link || '').trim();
  const sourceType = String(input.sourceType || input.kind || 'manual').trim().toLowerCase();
  const sourceName = String(input.sourceName || input.source || input.feedName || 'Brain Blog').trim();
  const tags = normalizeStringList([
    ...inferBrainBlogTags(`${title} ${sourceName} ${content}`),
    ...normalizeStringList(input.tags || []),
  ]);
  const salesMentor = String(input.salesMentor || input.mentor || '').trim() || inferSalesMentor(`${title} ${sourceName} ${content}`);
  const techniqueType = String(input.techniqueType || '').trim() || inferTechniqueType(`${title} ${content}`);
  const revenueStreams = normalizeStringList(input.revenueStreams || input.revenue_streams || inferRevenueStreams(`${title} ${content}`, tags));
  const summary = String(input.summary || '').trim() || buildBrainBlogSummary(content);
  const keyTakeaways = normalizeStringList(input.keyTakeaways || input.key_takeaways || buildBrainBlogTakeaways(content || summary, tags));
  const contentHash = String(input.contentHash || '').trim()
    || `blog-${Math.abs(hashString(`${sourceUrl}\n${title}\n${content || summary}`))}`;
  return {
    id: String(input.id || `brain-blog-${contentHash.replace(/^blog-/, '')}`).trim(),
    title,
    sourceUrl,
    sourceType,
    sourceName,
    salesMentor,
    techniqueType,
    revenueStreams,
    content,
    summary,
    keyTakeaways,
    tags,
    status: input.status || 'ready',
    contentHash,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    publishedAt: input.publishedAt || input.published_at || input.pubDate || input.createdAt || now,
    createdAt: input.createdAt || now,
    updatedAt: now,
    trainedAt: input.trainedAt || input.trained_at || null,
  };
}

function brainBlogPostToDoc(post = {}) {
  return {
    id: post.id,
    kind: 'brain-blog',
    topic: (post.revenueStreams || [])[0] || 'Wholesaling',
    title: post.title,
    source: post.sourceName || post.sourceUrl || 'Brain Blog',
    excerpt: post.summary || post.content || '',
    summary: post.summary || post.content || '',
    citation: `${post.salesMentor || 'PBK Research'} - ${post.sourceName || post.sourceUrl || 'Brain Blog'}`,
    tags: normalizeStringList([...(post.tags || []), ...(post.revenueStreams || []), post.salesMentor, post.techniqueType]),
    createdAt: post.publishedAt || post.createdAt,
    salesMentor: post.salesMentor,
    techniqueType: post.techniqueType,
    revenueStreams: post.revenueStreams || [],
    blogPost: true,
  };
}

function filterBrainBlogPosts(posts = [], filters = {}) {
  const tag = String(filters.tag || '').trim().toLowerCase();
  const mentor = String(filters.mentor || filters.salesMentor || '').trim().toLowerCase();
  const revenueStream = String(filters.revenueStream || filters.stream || '').trim().toLowerCase();
  const type = String(filters.techniqueType || filters.type || '').trim().toLowerCase();
  return sortNewest(posts || []).filter((post) => {
    const tagHaystack = normalizeStringList([...(post.tags || []), ...(post.revenueStreams || [])]).join(' ').toLowerCase();
    if (tag && !tagHaystack.includes(tag)) return false;
    if (mentor && !String(post.salesMentor || '').toLowerCase().includes(mentor)) return false;
    if (revenueStream && !normalizeStringList(post.revenueStreams || []).join(' ').toLowerCase().includes(revenueStream)) return false;
    if (type && !String(post.techniqueType || '').toLowerCase().includes(type)) return false;
    return true;
  });
}

function extractXmlText(block = '', tagNames = []) {
  for (const tagName of tagNames) {
    const match = String(block).match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
    if (match) return decodeXmlEntities(match[1]);
  }
  return '';
}

function extractXmlLink(block = '') {
  const atom = String(block).match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (atom) return decodeXmlEntities(atom[1]);
  return stripHtml(extractXmlText(block, ['link']));
}

function parseRssItems(xml = '', feed = {}) {
  const blocks = [
    ...(String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) || []),
  ];
  return blocks.slice(0, 16).map((block) => {
    const title = stripHtml(extractXmlText(block, ['title']));
    const sourceUrl = extractXmlLink(block);
    const publishedAt = stripHtml(extractXmlText(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const description = extractXmlText(block, ['content:encoded', 'summary', 'description']);
    return normalizeBrainBlogPost({
      title,
      sourceUrl,
      sourceType: feed.sourceType || 'rss',
      sourceName: feed.name || feed.sourceName || feed.url || 'RSS feed',
      publishedAt,
      content: stripHtml(description),
      tags: feed.tags || [],
      revenueStreams: feed.revenueStreams || [],
      metadata: { feedUrl: feed.url },
    });
  }).filter((post) => post.title && (post.content || post.summary));
}

function getBrainBlogFeeds(overrideFeeds = null) {
  if (Array.isArray(overrideFeeds) && overrideFeeds.length) return overrideFeeds;
  if (BRAIN_BLOG_FEEDS_RAW) {
    try {
      const parsed = JSON.parse(BRAIN_BLOG_FEEDS_RAW);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return BRAIN_BLOG_FEEDS_RAW
        .split(/\n|,/g)
        .map((url) => ({ url: url.trim(), name: url.trim(), sourceType: 'rss' }))
        .filter((feed) => feed.url);
    }
  }
  return BRAIN_BLOG_DEFAULT_FEEDS;
}

async function harvestBrainBlogFeeds({ feeds = null, limit = 8 } = {}) {
  const feedList = getBrainBlogFeeds(feeds).slice(0, Math.max(1, Number(limit || 8)));
  const posts = [];
  const errors = [];
  for (const feed of feedList) {
    const url = String(feed.url || '').trim();
    if (!url) continue;
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'PBK-Brain-Harvester/1.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      posts.push(...parseRssItems(xml, feed));
    } catch (error) {
      errors.push({ url, error: error?.message || 'Feed fetch failed.' });
    }
  }
  return { posts: posts.slice(0, Math.max(1, Number(limit || 8))), errors, feeds: feedList };
}

function extractZipCode(value = '') {
  const match = String(value || '').match(/\b\d{5}(?:-\d{4})?\b/);
  return match ? match[0].slice(0, 5) : '';
}

function normalizePropertyType(value = '') {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('duplex')) return 'duplex';
  if (raw.includes('multi')) return 'multifamily';
  if (raw.includes('condo')) return 'condo';
  if (raw.includes('land')) return 'land';
  return 'single-family';
}

function buildDealScenarioSet(input = {}) {
  const arv = Math.max(0, toMoneyNumber(input.arv || input.ARV, 185000));
  const repairs = Math.max(0, toMoneyNumber(input.repairs || input.repairEstimate || input.repairsMid, 38000));
  const offer = Math.max(0, toMoneyNumber(input.offer || input.offerPrice || input.targetOffer || input.price, 78000));
  const assignmentFee = Math.max(0, toMoneyNumber(input.assignmentFee || input.fee, 10000));
  const holdingCost = Math.max(1000, toMoneyNumber(input.holdingCost, Math.round(arv * 0.015)));
  const exitCostRate = Math.max(0.04, Math.min(0.12, Number(input.exitCostRate || 0.08)));
  const scenarios = [
    { name: 'Pessimistic', arvMultiplier: 0.92, repairsMultiplier: 1.22, probability: 0.25 },
    { name: 'Most likely', arvMultiplier: 1, repairsMultiplier: 1, probability: 0.55 },
    { name: 'Optimistic', arvMultiplier: 1.07, repairsMultiplier: 0.86, probability: 0.20 },
  ].map((scenario) => {
    const scenarioArv = Math.round(arv * scenario.arvMultiplier);
    const scenarioRepairs = Math.round(repairs * scenario.repairsMultiplier);
    const exitCost = Math.round(scenarioArv * exitCostRate);
    const totalCost = offer + scenarioRepairs + holdingCost + exitCost + assignmentFee;
    const profit = scenarioArv - totalCost;
    const roi = totalCost > 0 ? profit / totalCost : 0;
    return {
      ...scenario,
      arv: scenarioArv,
      repairs: scenarioRepairs,
      holdingCost,
      exitCost,
      assignmentFee,
      offer,
      totalCost,
      profit,
      roi,
      verdict: profit < 0 ? 'loss-risk' : roi >= 0.14 ? 'strong' : roi >= 0.08 ? 'thin' : 'counter',
    };
  });
  const profits = scenarios.map((scenario) => scenario.profit);
  const probabilityOfLoss = scenarios
    .filter((scenario) => scenario.profit < 0)
    .reduce((sum, scenario) => sum + scenario.probability, 0);
  const expectedProfit = Math.round(scenarios.reduce((sum, scenario) => sum + scenario.profit * scenario.probability, 0));
  const recommendation = probabilityOfLoss > 0.35
    ? 'walk_or_restructure'
    : expectedProfit >= 15000
      ? 'offer'
      : expectedProfit >= 6000
        ? 'counter_or_terms'
        : 'counter_lower';
  return {
    arv,
    repairs,
    offer,
    assignmentFee,
    holdingCost,
    exitCostRate,
    scenarios,
    expectedProfit,
    profitRange: { low: Math.min(...profits), high: Math.max(...profits) },
    probabilityOfLoss,
    recommendation,
  };
}

function scoreBuyerMatch(buyer = {}, deal = {}) {
  const zip = extractZipCode(deal.address || deal.zipCode || '');
  const propertyType = normalizePropertyType(deal.propertyType || '');
  const price = toMoneyNumber(deal.offer || deal.offerPrice || deal.price || deal.targetOffer, 0);
  const repairs = toMoneyNumber(deal.repairs || deal.repairsMid || deal.repairEstimate, 0);
  let score = 0;
  const reasons = [];
  if (!zip || normalizeStringList(buyer.zipCodes || []).includes(zip)) {
    score += zip ? 30 : 12;
    reasons.push(zip ? `Zip ${zip} fits criteria.` : 'No zip provided; market criteria not disqualified.');
  }
  if (!buyer.propertyTypes?.length || normalizeStringList(buyer.propertyTypes).includes(propertyType)) {
    score += 20;
    reasons.push(`${propertyType} fits property type.`);
  }
  if (!price || (price >= toNumber(buyer.priceMin, 0) && price <= toNumber(buyer.priceMax, Number.MAX_SAFE_INTEGER))) {
    score += 25;
    reasons.push('Offer price fits buyer range.');
  }
  if (!repairs || repairs <= toNumber(buyer.maxRepairs, Number.MAX_SAFE_INTEGER)) {
    score += 15;
    reasons.push('Repair load fits buyer appetite.');
  }
  const roi = Number(deal.roi || deal.expectedRoi || 0);
  if (!roi || roi >= toNumber(buyer.desiredRoi, 0.1) * 0.85) {
    score += 10;
    reasons.push('ROI appears close to target.');
  }
  return {
    buyerId: buyer.id,
    buyerName: buyer.name,
    score: Math.min(100, score),
    status: score >= 70 ? 'strong' : score >= 45 ? 'possible' : 'weak',
    reasons,
    buyer,
  };
}

function buildSystemAuditReport(stateRef = {}) {
  const totalLeads = Math.max(1, (stateRef.leadImports || []).length);
  const activity = stateRef.activity || [];
  const warnings = activity.filter((item) => ['warning', 'failed', 'error'].includes(String(item.status || '').toLowerCase()));
  const avgLatencyMs = Math.round(toNumber(stateRef.status?.avgLatencyMs, 420));
  const estimatedMonthlyAiCost = Math.round((toNumber(stateRef.status?.queryCountToday, 0) * 0.0025 + (stateRef.brainDocs || []).length * 0.0006) * 30 * 100) / 100;
  const costPerLead = Math.round((estimatedMonthlyAiCost / totalLeads) * 100) / 100;
  const errorRate = Math.round((warnings.length / Math.max(1, activity.length)) * 1000) / 10;
  const recommendations = [];
  if (errorRate > 10) recommendations.push('Error rate is elevated. Check provider auth and fallback routing before scaling outreach.');
  if (avgLatencyMs > 900) recommendations.push('Latency is high. Prefer cached analyzer results and shorter Rex context for call-time actions.');
  if (costPerLead > 1.25) recommendations.push('Cost per lead is climbing. Route classification and summary tasks to the cheaper default model.');
  if (!recommendations.length) recommendations.push('Runtime looks stable. Keep dangerous provider writes approval-gated and continue weekly cost reviews.');
  return {
    id: `system-audit-${Date.now()}`,
    status: errorRate > 10 || avgLatencyMs > 900 ? 'watch' : 'healthy',
    estimatedMonthlyAiCost,
    costPerLead,
    errorRate,
    avgLatencyMs,
    recommendations,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
}

function answerBrainQuery(stateRef, query = '') {
  const trimmed = String(query || '').trim();
  const blogDocs = (stateRef.brainBlogPosts || []).map(brainBlogPostToDoc);
  const matches = [...(stateRef.brainDocs || []), ...blogDocs]
    .map((doc) => ({
      ...doc,
      score: scoreBrainDocMatch(doc, trimmed || doc.title) + (doc.blogPost ? 0.25 : 0),
    }))
    .filter((doc) => doc.score > 0 || !trimmed)
    .sort((left, right) => right.score - left.score || String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 3);

  const top = matches[0];
  const answer = top
    ? top.blogPost
      ? `Best Brain Blog match: ${top.title}. ${top.summary} Source lens: ${top.salesMentor || 'PBK Research'}${top.revenueStreams?.length ? ` for ${top.revenueStreams.join(', ')}` : ''}.`
      : `Best match: ${top.title}. ${top.summary}`
    : 'No direct match yet. Ingest a new source or try a narrower query like "probate Ohio" or "subject-to".';

  return {
    query: trimmed,
    answer,
    matches: matches.map(({ score, ...doc }) => doc),
    citations: matches.map((doc) => doc.citation || `${doc.source} - ${doc.title}`),
  };
}

function normalizeConversationMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => ({
      role: ['user', 'assistant', 'system'].includes(String(message?.role || '').toLowerCase())
        ? String(message.role).toLowerCase()
        : 'user',
      content: String(message?.content || '').trim().slice(0, 4000),
      at: message?.at || message?.createdAt || null,
    }))
    .filter((message) => message.content)
    .slice(-18);
}

function getLastUserMessage(messages = [], fallback = '') {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user' && messages[index]?.content) {
      return messages[index].content;
    }
  }
  return String(fallback || '').trim();
}

function redactMemoryText(text = '') {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g, '[redacted-phone]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9._-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/g, '[redacted-secret]');
}

function buildRexConversationMemoryDoc({ query = '', answer = '', messages = [], sessionId = '', source = 'brain-chat' } = {}) {
  const cleanedQuery = redactMemoryText(query).slice(0, 2400);
  const cleanedAnswer = redactMemoryText(answer).slice(0, 3600);
  const turnCount = normalizeConversationMessages(messages).length;
  const createdAt = isoNow();
  const hash = Math.abs(hashString(`${cleanedQuery}\n${cleanedAnswer}`));
  return {
    id: `rex-memory-${hash}-${Date.now()}`,
    kind: 'conversation-memory',
    topic: 'Rex Conversation Memory',
    title: cleanedQuery ? `Rex Q&A: ${cleanedQuery.slice(0, 88)}` : 'Rex Q&A memory',
    source,
    excerpt: cleanedQuery,
    summary: `Q: ${cleanedQuery}\nA: ${cleanedAnswer}`,
    citation: sessionId ? `Rex session ${sessionId}` : 'Rex Brain chat',
    tags: ['pbk-wholesale', 'pbk-rex-admin', 'conversation-memory'],
    status: 'indexed',
    turnCount,
    createdAt,
    updatedAt: createdAt,
  };
}

async function syncRexMemoryToSupermemory(doc = {}) {
  if (!SUPERMEMORY_SYNC_ENABLED || !SUPERMEMORY_API_KEY || !SUPERMEMORY_API_URL) {
    return {
      ok: false,
      skipped: true,
      reason: 'Supermemory sync is disabled or not configured.',
    };
  }

  try {
    const response = await fetch(SUPERMEMORY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPERMEMORY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: doc.summary,
        metadata: {
          id: doc.id,
          namespace: 'pbk-wholesale',
          topic: doc.topic,
          source: doc.source,
          tags: doc.tags,
          createdAt: doc.createdAt,
        },
      }),
    });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      payload,
      skipped: false,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error?.message || 'Supermemory sync failed.',
    };
  }
}

async function storeRexConversationMemory(stateRef, params = {}, result = {}) {
  const query = String(params.query || '').trim();
  const answer = String(result.answer || '').trim();
  if (!query || !answer || params.remember === false) {
    return {
      stored: false,
      supermemory: { skipped: true, reason: 'No durable Q&A memory was created.' },
    };
  }

  const doc = buildRexConversationMemoryDoc({
    query,
    answer,
    messages: params.messages,
    sessionId: params.sessionId,
    source: params.source || 'brain-chat',
  });
  addBrainDoc(stateRef, doc);
  const supermemory = await syncRexMemoryToSupermemory(doc);
  return {
    stored: true,
    docId: doc.id,
    localBrain: true,
    supermemory,
  };
}

function normalizeLeadIntake(payload = {}) {
  const createdAt = payload.createdAt || isoNow();
  const seller = payload.seller || {};
  const property = payload.property || {};
  const motivation = payload.motivation || {};
  const compliance = payload.compliance || {};
  const assignment = payload.assignment || {};
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
    : String(payload.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
  return {
    id: payload.id || randomUUID(),
    leadId: payload.leadId || payload.id || randomUUID(),
    source: payload.source || payload.leadSource || 'manual',
    leadSource: payload.leadSource || payload.source || 'manual',
    status: payload.status || payload.stage || 'new',
    stage: payload.stage || payload.status || 'new',
    score: payload.score === undefined ? null : toNumber(payload.score, null),
    seller: {
      name: seller.name || payload.name || payload.sellerName || 'Unknown seller',
      phone: seller.phone || payload.phone || '',
      email: seller.email || payload.email || '',
      preferredChannel: seller.preferredChannel || payload.preferredChannel || 'unknown',
      bestTimeToCall: seller.bestTimeToCall || payload.bestTimeToCall || '',
      relationshipToProperty: seller.relationshipToProperty || payload.relationshipToProperty || '',
      notes: seller.notes || payload.sellerNotes || '',
    },
    property: {
      address: property.address || payload.address || '',
      city: property.city || payload.city || '',
      state: property.state || payload.state || '',
      zip: property.zip || payload.zip || '',
      occupancy: property.occupancy || payload.occupancy || 'unknown',
      condition: property.condition || payload.condition || 'unknown',
      beds: property.beds ?? payload.beds ?? null,
      baths: property.baths ?? payload.baths ?? null,
      sqft: property.sqft ?? payload.sqft ?? null,
      yearBuilt: property.yearBuilt ?? payload.yearBuilt ?? null,
      estimatedRepairs: property.estimatedRepairs ?? payload.estimatedRepairs ?? null,
      arv: property.arv ?? payload.arv ?? null,
      mao: property.mao ?? payload.mao ?? null,
      mortgageBalance: property.mortgageBalance ?? payload.mortgageBalance ?? null,
      askingPrice: property.askingPrice ?? payload.askingPrice ?? motivation.askingPrice ?? null,
    },
    motivation: {
      summary: motivation.summary || payload.motivation || '',
      timeline: motivation.timeline || payload.timeline || 'unknown',
      askingPrice: motivation.askingPrice ?? property.askingPrice ?? payload.askingPrice ?? null,
    },
    compliance: {
      consentStatus: compliance.consentStatus || payload.consentStatus || 'unknown',
      dncStatus: compliance.dncStatus || payload.dncStatus || 'needs_review',
    },
    assignment: {
      assignedAgent: assignment.assignedAgent || payload.assignedAgent || 'Ava',
      campaign: assignment.campaign || payload.campaign || '',
    },
    notes: payload.notes || payload.internalNotes || '',
    tags,
    createdAt,
    updatedAt: payload.updatedAt || createdAt,
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
    storagePath: params.storagePath || params.storage_path || params.recordingStoragePath || '',
    storageBucket: params.storageBucket || params.storage_bucket || '',
    audioContentType: params.audioContentType || params.contentType || params.content_type || '',
    durationSeconds: toNumber(params.durationSeconds || params.duration_seconds, 0),
    recordingUrl: params.recordingUrl || params.audioUrl || params.url || '',
    recordingMessageId: params.recordingMessageId || params.messageId || '',
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
    subject: params.subject || '',
    body: String(params.body || params.message || '').trim(),
    status: params.status || (params.direction === 'inbound' ? 'received' : 'sent'),
    provider: params.provider || 'PBK',
    intent: params.intent || '',
    sentiment: params.sentiment ?? null,
    storagePath: params.storagePath || params.storage_path || params.recordingStoragePath || '',
    storageBucket: params.storageBucket || params.storage_bucket || '',
    audioContentType: params.audioContentType || params.contentType || params.content_type || '',
    durationSeconds: toNumber(params.durationSeconds || params.duration_seconds, 0),
    recordingUrl: params.recordingUrl || params.audioUrl || params.url || '',
    callId: params.callId || params.telnyxCallControlId || params.call_control_id || '',
    messagingProfileId: params.messagingProfileId || params.messaging_profile_id || '',
    payload: params.payload && typeof params.payload === 'object' ? params.payload : {},
    createdAt: params.createdAt || isoNow(),
    updatedAt: params.updatedAt || isoNow(),
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
    templateFields: params.templateFields || {},
    templateFieldMap: params.templateFieldMap || {},
    contractPath: params.contractPath || params.selectedPath || '',
    contractType: params.contractType || params.templateId || '',
    templatePath: params.templatePath || '',
    templateFile: params.templateFile || '',
    negotiationFile: params.negotiationFile || '',
    negotiationPrompt: params.negotiationPrompt || '',
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

function getSenderAddress(profile = '', override = '') {
  const selected = String(override || '').trim();
  if (selected) return selected;
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
    'openclaw',
    'gateway',
    'away worker',
    'away-mode',
    'system health',
    'health check',
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

  if (normalized.includes('health check') || normalized.includes('system health') || normalized.includes('check health')) {
    return {
      provider: 'system',
      action: 'check_health',
      risk: 'low',
      summary: 'Inspect PBK bridge, provider, and runtime health.',
    };
  }

  if (normalized.includes('openclaw') || normalized.includes('gateway')) {
    return {
      provider: 'openclaw',
      action: normalized.includes('restart') ? 'restart_gateway' : 'inspect_gateway',
      risk: normalized.includes('restart') ? 'medium' : 'low',
      summary: normalized.includes('restart')
        ? 'Prepare an OpenClaw gateway restart request.'
        : 'Inspect OpenClaw gateway status.',
    };
  }

  if (normalized.includes('away worker') || normalized.includes('away-mode') || normalized.includes('scheduled task') || normalized.includes('run worker')) {
    return {
      provider: 'worker',
      action: 'run_away_worker',
      risk: 'medium',
      summary: 'Prepare an away-mode worker run request.',
    };
  }

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
          : ['contract-admin', 'system', 'openclaw', 'worker'].includes(providerKey)
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

  if (['system', 'openclaw', 'worker'].includes(adminIntent.provider)) {
    return {
      provider: adminIntent.provider,
      action: adminIntent.action,
      mode: adminIntent.action === 'check_health' ? 'inspect' : mode,
      risk: adminIntent.risk,
      requiresApproval: normalizeApprovalRequired(adminIntent.provider, adminIntent.action),
      payload: {
        localOnly: true,
        source: 'rex-admin',
      },
      summary: adminIntent.summary,
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

function inferNegotiationScenario(params = {}, context = {}) {
  const text = String([
    params.scenario,
    params.intent,
    params.script,
    params.notes,
    params.body,
    params.transcriptStart,
    context.tags,
    context.address,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (text.includes('probate') || text.includes('estate') || text.includes('executor')) return 'probate';
  if (text.includes('price') || text.includes('too low') || text.includes('offer') || text.includes('counter')) return 'objection_price';
  if (text.includes('think') || text.includes('not sure') || text.includes('maybe')) return 'closing_hesitation';
  if (text.includes('angry') || text.includes('stop calling') || text.includes('mad')) return 'anger';
  return 'opening';
}

function inferSellerEmotion(params = {}) {
  const explicit = String(params.emotion || params.sentimentLabel || '').trim().toLowerCase();
  if (explicit) return explicit;
  const sentiment = toNumber(params.sentiment, 0.66);
  const text = String([params.transcriptStart, params.text, params.body, params.notes].filter(Boolean).join(' ')).toLowerCase();
  if (text.includes('stop calling') || text.includes('mad') || text.includes('angry')) return 'angry';
  if (text.includes('scam') || text.includes('how do i know') || text.includes('are you real')) return 'distrustful';
  if (text.includes("don't know") || text.includes('not sure') || text.includes('think about')) return 'hesitant';
  if (text.includes('foreclosure') || text.includes('deadline') || text.includes('behind')) return 'urgent';
  if (sentiment < 0.35) return 'frustrated';
  if (sentiment < 0.55) return 'hesitant';
  return 'neutral';
}

function findCityKnowledgeForContext(context = {}) {
  const address = String(context.address || '').toLowerCase();
  const zip = String(context.zip || context.zipCode || '').trim();
  return buildDefaultCityKnowledge().find((item) => {
    if (item.city && address.includes(String(item.city).toLowerCase())) return true;
    if (item.state && address.includes(String(item.state).toLowerCase())) {
      return item.zipPrefixes?.some((prefix) => zip.startsWith(prefix) || address.includes(prefix));
    }
    return item.zipPrefixes?.some((prefix) => zip.startsWith(prefix) || address.includes(prefix));
  }) || null;
}

function selectNegotiationGuidance(params = {}, context = {}, profile = null) {
  const scenario = inferNegotiationScenario(params, context);
  const emotion = inferSellerEmotion(params);
  const tactics = buildDefaultNegotiationTactics()
    .filter((tactic) => tactic.scenario === scenario || tactic.emotionTarget === emotion || (scenario === 'opening' && tactic.scenario === 'opening'))
    .sort((left, right) => toNumber(right.rank, 0) - toNumber(left.rank, 0))
    .slice(0, 3);
  const emotionalRule = buildDefaultEmotionalIntelligenceRules()
    .find((rule) => rule.emotion === emotion || String(rule.triggerPhrase || '').toLowerCase().split(',').some((phrase) => phrase.trim() && String(params.transcriptStart || params.body || params.notes || '').toLowerCase().includes(phrase.trim())));
  const city = findCityKnowledgeForContext(context);
  return {
    persona: buildAvaNegotiationPersona(),
    scenario,
    emotion,
    city,
    tactics,
    emotionalRule: emotionalRule || null,
    guardrails: [
      'Never lie about being local; use city context as familiarity, not false identity.',
      'Never exceed MAO, hide assignment intent, or pressure a distressed seller.',
      'If the seller requests no contact, stop and mark DNC.',
      'Use stories only when they help the seller feel understood; keep them short.'
    ],
    promptBrief: [
      `Ava persona: ${buildAvaNegotiationPersona().voice}`,
      city?.rapportLine ? `Local rapport: ${city.rapportLine}` : '',
      emotionalRule?.recommendedResponse ? `Emotion read: ${emotion}. ${emotionalRule.recommendedResponse}` : `Emotion read: ${emotion}. Stay calm and curious.`,
      ...tactics.map((tactic) => `${tactic.tacticName}: ${tactic.scriptExample}`),
      profile?.strategy ? `Participant strategy: ${profile.strategy}` : '',
    ].filter(Boolean).join('\n'),
  };
}

function buildCallStrategyFromProfile(profile = null, params = {}, context = {}) {
  const negotiationGuidance = selectNegotiationGuidance(params, context, profile);
  if (!profile?.role) {
    return {
      script: 'standard-acquisition',
      strategy: 'default seller discovery and qualification flow',
      negotiationGuidance,
    };
  }

  if (profile.role === 'agent') {
    return {
      script: 'agent-net-sheet',
      strategy: 'speak in agent terms, stay concise, and focus on seller timeline, net, and coordination',
      negotiationGuidance,
    };
  }

  if (profile.expertise === 'expert') {
    return {
      script: 'expert-numbers-first',
      strategy: 'assume familiarity, get to numbers quickly, and avoid over-explaining basic acquisition terms',
      negotiationGuidance,
    };
  }

  if (profile.expertise === 'novice') {
    return {
      script: 'novice-guided-walkthrough',
      strategy: 'slow down, educate, remove jargon, and lead with clarity and reassurance',
      negotiationGuidance,
    };
  }

  return {
    script: 'intermediate-acquisition',
    strategy: 'balance empathy with direct qualification and keep the process simple',
    negotiationGuidance,
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
      ok: false,
      live: false,
      result: 'provider_missing',
      provider: 'resend',
      error: 'Email provider not configured - add RESEND_API_KEY in Render/OpenClaw.',
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
    'openclaw:restart_gateway',
    'worker:run_away_worker',
    'system:update_env_var',
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

const CONTRACT_SCRIPT_FILENAMES = ['negotiation.md', 'script.md', 'prompt.md'];
const CONTRACT_TEMPLATE_FILENAMES = ['template.pdf', 'agreement.pdf', 'contract.pdf', 'template.docx', 'agreement.docx', 'template.html'];
const DEFAULT_CONTRACT_PATH = 'standard-purchase';
let contractTemplateCache = {
  loadedAt: '',
  reason: 'not-loaded',
  templates: [],
  errors: [],
};
let contractTemplateWatcherStarted = false;
let contractTemplateReloadTimer = null;

function contractRelativePath(filePath = '') {
  if (!filePath) return '';
  return path.relative(CONTRACTS_DIR, filePath).replace(/\\/g, '/');
}

function resolveContractLibraryPath(relativePath = '') {
  if (!relativePath) return '';
  const resolved = path.resolve(CONTRACTS_DIR, relativePath);
  const relative = path.relative(CONTRACTS_DIR, resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : '';
}

async function readTextIfExists(filePath = '') {
  if (!filePath) return '';
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function statIsoIfExists(filePath = '') {
  if (!filePath) return '';
  try {
    return (await stat(filePath)).mtime.toISOString();
  } catch {
    return '';
  }
}

function sortContractTemplates(templates = []) {
  return [...templates].sort((left, right) => {
    if (left.id === DEFAULT_CONTRACT_PATH) return -1;
    if (right.id === DEFAULT_CONTRACT_PATH) return 1;
    return String(left.name || left.id).localeCompare(String(right.name || right.id));
  });
}

async function loadContractTemplateLibrary(reason = 'load') {
  const templates = [];
  const errors = [];
  try {
    const directories = await readdir(CONTRACTS_DIR, { withFileTypes: true });
    for (const entry of directories) {
      if (!entry.isDirectory()) continue;
      const templateDir = path.join(CONTRACTS_DIR, entry.name);
      const fieldsPath = path.join(templateDir, 'fields.json');
      let fields = {};
      try {
        fields = JSON.parse(await readFile(fieldsPath, 'utf8'));
      } catch (error) {
        errors.push({
          id: entry.name,
          file: contractRelativePath(fieldsPath),
          error: error instanceof Error ? error.message : 'Unable to read fields.json',
        });
        fields = {};
      }

      let folderFiles = [];
      try {
        folderFiles = await readdir(templateDir, { withFileTypes: true });
      } catch {
        folderFiles = [];
      }

      const existingFiles = folderFiles.filter((item) => item.isFile()).map((item) => item.name);
      const scriptFile = CONTRACT_SCRIPT_FILENAMES.find((fileName) => existingFiles.includes(fileName)) || '';
      const templateFile =
        CONTRACT_TEMPLATE_FILENAMES.find((fileName) => existingFiles.includes(fileName)) ||
        existingFiles.find((fileName) => /\.(pdf|docx|html)$/i.test(fileName)) ||
        '';
      const scriptPath = scriptFile ? path.join(templateDir, scriptFile) : '';
      const templatePath = templateFile ? path.join(templateDir, templateFile) : '';
      const negotiationScript = await readTextIfExists(scriptPath);
      const updatedAtCandidates = await Promise.all([
        statIsoIfExists(fieldsPath),
        statIsoIfExists(scriptPath),
        statIsoIfExists(templatePath),
      ]);
      const updatedAt = updatedAtCandidates.filter(Boolean).sort().at(-1) || '';

      templates.push({
        id: entry.name,
        pathId: entry.name,
        name: fields.name || entry.name,
        type: fields.type || entry.name,
        aliases: Array.isArray(fields.aliases) ? fields.aliases : [],
        version: fields.version || '',
        description: fields.description || '',
        fields,
        fieldMap: fields.fields || fields,
        folder: entry.name,
        hasTemplate: Boolean(templateFile),
        templateFile,
        templatePath: templatePath ? contractRelativePath(templatePath) : '',
        hasNegotiation: Boolean(negotiationScript),
        negotiationFile: scriptFile,
        negotiationPath: scriptPath ? contractRelativePath(scriptPath) : '',
        negotiationScript,
        updatedAt,
      });
    }
  } catch (error) {
    errors.push({
      id: 'contracts',
      file: contractRelativePath(CONTRACTS_DIR),
      error: error instanceof Error ? error.message : 'Unable to read contracts directory',
    });
  }

  return {
    loadedAt: isoNow(),
    reason,
    templates: sortContractTemplates(templates),
    errors,
  };
}

async function reloadContractTemplateLibrary(reason = 'manual') {
  contractTemplateCache = await loadContractTemplateLibrary(reason);
  return {
    ok: contractTemplateCache.errors.length === 0,
    ...contractTemplateCache,
  };
}

async function getContractTemplateLibrary(options = {}) {
  if (options.force || !contractTemplateCache.loadedAt) {
    await reloadContractTemplateLibrary(options.reason || 'lazy-load');
  }
  return contractTemplateCache.templates;
}

function normalizeContractPathKey(value = '') {
  return slugify(String(value || '').trim())
    .replace(/subject-to/g, 'subto')
    .replace(/sub-to/g, 'subto');
}

function inferContractPathFromParams(params = {}) {
  const fragments = [
    params.contractPath,
    params.pathId,
    params.path,
    params.selectedPath,
    params.selectedPathLabel,
    params.templateId,
    params.template,
    params.dealType,
    params.contractType,
    params.leadType,
    params.source,
    params.notes,
    params.body,
    params.reply,
    params.motivationSignals,
    params.tags,
  ]
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(subto|sub-to|subject to|subject-to|creative finance|mortgage|loan balance|take over payments)\b/.test(fragments)) {
    if (/\b(creative finance|seller carry|seller finance|wrap|promissory note|deed of trust|beneficial interest|cf)\b/.test(fragments)) {
      return 'creative-finance-agent';
    }
    return 'mortgage-takeover-agent';
  }
  if (/\b(retail buyer program|retail buyer|rbp|seller net sheet|double close|double-close)\b/.test(fragments)) {
    return 'retail-buyer-program';
  }
  if (/\b(vacant land|land contract|land due diligence|land due-diligence|parcel|acreage)\b/.test(fragments)) {
    return 'land';
  }
  if (/\b(probate|estate|executor|administrator|inherited|letters testamentary)\b/.test(fragments)) {
    return 'probate-addendum';
  }
  if (/\b(assign|assignment|assignor|assignee|end buyer|buyer lined up|wholesale fee)\b/.test(fragments)) {
    return 'assignment';
  }
  if (/\b(cash|standard|purchase|as-is|quick close|direct to seller)\b/.test(fragments)) {
    return 'cash-offer';
  }
  return DEFAULT_CONTRACT_PATH;
}

function selectContractTemplate(templates = [], params = {}) {
  const keys = [
    params.contractPath,
    params.pathId,
    params.path,
    params.selectedPath,
    params.templateId,
    params.template,
    params.contractType,
    inferContractPathFromParams(params),
    DEFAULT_CONTRACT_PATH,
  ].map(normalizeContractPathKey).filter(Boolean);

  for (const key of keys) {
    const match = templates.find((item) => {
      const itemKeys = [
        item.id,
        item.pathId,
        item.type,
        item.name,
        item.folder,
        item.aliases,
      ].flat().map(normalizeContractPathKey);
      return itemKeys.includes(key) || itemKeys.some((itemKey) => itemKey && (itemKey.includes(key) || key.includes(itemKey)));
    });
    if (match) return match;
  }

  return templates[0] || {
    id: DEFAULT_CONTRACT_PATH,
    pathId: DEFAULT_CONTRACT_PATH,
    name: 'Standard Purchase Agreement',
    type: DEFAULT_CONTRACT_PATH,
    fields: {},
    fieldMap: {},
    folder: DEFAULT_CONTRACT_PATH,
    hasTemplate: false,
    hasNegotiation: false,
    negotiationScript: '',
  };
}

function startContractTemplateWatcher() {
  if (contractTemplateWatcherStarted || IS_HOSTED) return;
  contractTemplateWatcherStarted = true;
  try {
    watch(CONTRACTS_DIR, { recursive: true }, () => {
      clearTimeout(contractTemplateReloadTimer);
      contractTemplateReloadTimer = setTimeout(() => {
        reloadContractTemplateLibrary('file-watch').catch((error) => {
          console.warn('[pbk-local-openclaw] contract template reload failed:', error instanceof Error ? error.message : error);
        });
      }, 200);
    });
  } catch (error) {
    console.warn('[pbk-local-openclaw] contract template watcher unavailable:', error instanceof Error ? error.message : error);
  }
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
  const sourcesIndexed = state.brainDocs.length + (state.brainBlogPosts || []).length;
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
      campaignWorker: getCampaignWorkerMeta(),
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
  return normalizePhone(params.from || params.fromNumber || params.selectedFromNumber || params.selected_from_number || getEffectiveTelnyxFromNumber());
}

function getTelnyxWebhookUrl(params = {}) {
  return String(params.webhookUrl || TELNYX_WEBHOOK_URL || '').trim();
}

function getTelnyxDeepgramStreamUrl(params = {}) {
  const explicit = String(params.streamUrl || params.deepgramStreamUrl || '').trim();
  if (explicit) return explicit;
  if (!PUBLIC_BASE_URL) return '';
  const base = PUBLIC_BASE_URL.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  const url = new URL(`${base}/api/webhooks/telnyx/media`);
  if (TELNYX_MEDIA_STREAM_TOKEN) url.searchParams.set('token', TELNYX_MEDIA_STREAM_TOKEN);
  return url.toString();
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

function normalizeTelnyxNumberRecord(record = {}) {
  const phoneNumber = record.phone_number || record.phoneNumber || record.number || '';
  return {
    id: record.id || phoneNumber,
    phone_number: phoneNumber,
    phoneNumber,
    label: record.name || record.label || record.customer_reference || '',
    region: record.region_code || record.region || record.country_iso_alpha2 || '',
    status: record.status || '',
  };
}

async function getTelnyxNumberOptions() {
  const defaultNumber = getEffectiveTelnyxFromNumber();
  const fallbackNumbers = defaultNumber
    ? [normalizeTelnyxNumberRecord({ id: 'env-default', phone_number: defaultNumber, label: 'Bridge default', region: 'env' })]
    : [];
  if (!TELNYX_API_KEY) {
    return {
      ok: false,
      result: 'provider_missing',
      verbiage: 'Phone provider not configured - add Telnyx API key before loading live numbers.',
      numbers: fallbackNumbers,
      defaultNumber,
      missing: ['PBK_TELNYX_API_KEY'],
    };
  }
  const telnyxResult = await listTelnyxPhoneNumbers();
  if (!telnyxResult.ok) {
    return {
      ok: false,
      result: 'provider_missing',
      verbiage: telnyxResult.error || 'Telnyx numbers could not be loaded.',
      numbers: fallbackNumbers,
      defaultNumber,
      telnyx: telnyxResult,
    };
  }
  const rawNumbers = Array.isArray(telnyxResult.body?.data) ? telnyxResult.body.data : [];
  const numbers = rawNumbers.map(normalizeTelnyxNumberRecord).filter((number) => number.phone_number);
  if (defaultNumber && !numbers.some((number) => normalizePhone(number.phone_number) === normalizePhone(defaultNumber))) {
    numbers.unshift(fallbackNumbers[0]);
  }
  return {
    ok: true,
    result: 'live',
    verbiage: numbers.length ? 'Telnyx numbers loaded' : 'Telnyx is configured but no phone numbers were returned.',
    numbers,
    defaultNumber,
  };
}

function normalizeInstantlySenderRecord(record = {}) {
  const email = String(
    record.email
      || record.email_address
      || record.address
      || record.username
      || record.smtp_username
      || '',
  ).trim();
  return {
    id: record.id || record.uuid || email,
    email,
    provider: record.provider || record.provider_name || record.type || record.smtp_provider || 'instantly',
    status: record.status || record.warmup_status || '',
  };
}

async function getInstantlySenderOptions() {
  const defaultEmail = INSTANTLY_DEFAULT_FROM_EMAIL || getSenderAddress('cold');
  const fallbackSenders = defaultEmail
    ? [normalizeInstantlySenderRecord({ id: 'env-default', email: defaultEmail, provider: 'bridge default', status: 'default' })]
    : [];
  if (!INSTANTLY_API_KEY) {
    return {
      ok: false,
      result: 'provider_missing',
      verbiage: 'Email provider not configured - add PBK_INSTANTLY_API_KEY before loading live senders.',
      senders: fallbackSenders,
      defaultEmail,
      missing: ['PBK_INSTANTLY_API_KEY'],
    };
  }
  const instantlyResult = await fireInstantlyRequest(INSTANTLY_SENDERS_ENDPOINT, undefined, { method: 'GET' });
  if (!instantlyResult.ok) {
    return {
      ok: false,
      result: 'provider_missing',
      verbiage: instantlyResult.error || 'Instantly sender inboxes could not be loaded.',
      senders: fallbackSenders,
      defaultEmail,
      instantly: instantlyResult,
    };
  }
  const body = instantlyResult.body || {};
  const rawSenders = Array.isArray(body)
    ? body
    : Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.inboxes)
        ? body.inboxes
        : Array.isArray(body.items)
          ? body.items
          : [];
  const senders = rawSenders.map(normalizeInstantlySenderRecord).filter((sender) => sender.email);
  if (defaultEmail && !senders.some((sender) => sender.email.toLowerCase() === defaultEmail.toLowerCase())) {
    senders.unshift(fallbackSenders[0]);
  }
  return {
    ok: true,
    result: 'live',
    verbiage: senders.length ? 'Instantly senders loaded' : 'Instantly is configured but no sender inboxes were returned.',
    senders,
    defaultEmail,
  };
}

async function updateTelnyxPhoneNumber(phoneNumberId, payload = {}) {
  return fireTelnyxRequest('PATCH', `/phone_numbers/${encodeURIComponent(phoneNumberId)}`, payload);
}

// ── Slack incoming webhook ──────────────────────────────────────────────────
async function answerTelnyxCall(callControlId = '') {
  if (!callControlId) return { ok: false, skipped: true, error: 'Missing Telnyx call_control_id.' };
  return fireTelnyxRequest('POST', `/calls/${encodeURIComponent(callControlId)}/actions/answer`, {});
}

async function speakTelnyxCall(callControlId = '', text = '') {
  if (!callControlId) return { ok: false, skipped: true, error: 'Missing Telnyx call_control_id.' };
  return fireTelnyxRequest('POST', `/calls/${encodeURIComponent(callControlId)}/actions/speak`, {
    payload: String(text || '').slice(0, 1500),
    voice: process.env.PBK_TELNYX_TTS_VOICE || 'female',
    language: process.env.PBK_TELNYX_TTS_LANGUAGE || 'en-US',
  });
}

async function transferTelnyxCall(callControlId = '', to = '') {
  const target = normalizePhone(to);
  if (!callControlId) return { ok: false, skipped: true, error: 'Missing Telnyx call_control_id.' };
  if (!target) return { ok: false, skipped: true, error: 'Missing transfer target phone number.' };
  return fireTelnyxRequest('POST', `/calls/${encodeURIComponent(callControlId)}/actions/transfer`, { to: target });
}

async function recordTelnyxCall(callControlId = '') {
  if (!callControlId) return { ok: false, skipped: true, error: 'Missing Telnyx call_control_id.' };
  return fireTelnyxRequest('POST', `/calls/${encodeURIComponent(callControlId)}/actions/record_start`, {
    format: 'mp3',
    channels: 'single',
  });
}

async function startTelnyxAiAssistant(callControlId = '', promptOverride = '') {
  if (!callControlId) return { ok: false, skipped: true, result: 'unavailable', error: 'Missing Telnyx call_control_id.' };
  if (!TELNYX_AI_ASSISTANT_ID) {
    return {
      ok: false,
      skipped: true,
      result: 'provider_missing',
      error: 'TELNYX_AI_ASSISTANT_ID is not configured.',
      promptOverride,
    };
  }
  if (!TELNYX_AI_ASSISTANT_ACTION_ENABLED) {
    return {
      ok: false,
      skipped: true,
      result: 'queued_for_approval',
      error: 'Telnyx hosted AI Assistant prompt is prepared but provider-side start is disabled. Set PBK_TELNYX_AI_ASSISTANT_ACTION_ENABLED=true after portal verification.',
      assistantId: TELNYX_AI_ASSISTANT_ID,
      promptOverride,
    };
  }
  return fireTelnyxRequest('POST', `/calls/${encodeURIComponent(callControlId)}/actions/ai_assistant_start`, {
    assistant_id: TELNYX_AI_ASSISTANT_ID,
    prompt: promptOverride,
  });
}

function getLocalDateParts(date = new Date(), timeZone = INBOUND_TIMEZONE) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(date);
    return {
      weekday: parts.find((part) => part.type === 'weekday')?.value || '',
      hour: Number(parts.find((part) => part.type === 'hour')?.value || date.getHours()),
    };
  } catch {
    return {
      weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
      hour: date.getHours(),
    };
  }
}

function isInboundAfterHours(date = new Date()) {
  const { weekday, hour } = getLocalDateParts(date, INBOUND_TIMEZONE);
  if (['Sat', 'Sun'].includes(weekday)) return true;
  if (INBOUND_AFTER_HOURS_START === INBOUND_AFTER_HOURS_END) return false;
  if (INBOUND_AFTER_HOURS_START > INBOUND_AFTER_HOURS_END) {
    return hour >= INBOUND_AFTER_HOURS_START || hour < INBOUND_AFTER_HOURS_END;
  }
  return hour < INBOUND_AFTER_HOURS_END || hour >= INBOUND_AFTER_HOURS_START;
}

function parseTelnyxCallPayload(body = {}) {
  const payload = body.data?.payload || body.payload || body.data || body;
  const from = Array.isArray(payload.from)
    ? payload.from[0]?.phone_number || payload.from[0]
    : payload.from?.phone_number || payload.from || payload.from_phone_number || payload.caller_id_number || '';
  const to = Array.isArray(payload.to)
    ? payload.to[0]?.phone_number || payload.to[0]
    : payload.to?.phone_number || payload.to || payload.to_phone_number || payload.called_party_number || '';
  return {
    eventType: String(body.data?.event_type || body.event_type || body.type || '').toLowerCase(),
    payload,
    callControlId: payload.call_control_id || payload.callControlId || payload.id || '',
    callLegId: payload.call_leg_id || payload.callLegId || '',
    callSessionId: payload.call_session_id || payload.callSessionId || '',
    from: normalizePhone(from),
    to: normalizePhone(to),
    direction: String(payload.direction || payload.call_direction || payload.direction_type || '').toLowerCase(),
    state: payload.state || payload.status || '',
  };
}

function isTelnyxInboundCallWebhook(body = {}) {
  const parsed = parseTelnyxCallPayload(body);
  if (!parsed.eventType.includes('call')) return false;
  if (/(inbound|incoming|terminating)/i.test(parsed.direction)) return true;
  return Boolean(parsed.from && parsed.to && parsed.eventType.includes('initiated') && normalizePhone(parsed.to) === normalizePhone(TELNYX_FROM_NUMBER));
}

async function findInboundLeadContext(phone = '') {
  const normalizedPhone = normalizePhone(phone);
  const localLead = (state.leadImports || []).find((lead) => {
    const seller = lead?.seller || {};
    return normalizePhone(lead.phone || seller.phone || lead.sellerPhone) === normalizedPhone;
  });
  if (localLead) {
    return {
      found: true,
      source: 'bridge-state',
      leadId: localLead.leadId || localLead.id || '',
      leadName: localLead.seller?.name || localLead.name || 'Returning seller',
      address: localLead.property?.address || localLead.address || '',
      phone: normalizedPhone,
      email: localLead.seller?.email || localLead.email || '',
      status: localLead.status || localLead.stage || '',
      motivationScore: toNumber(localLead.motivation_score ?? localLead.motivationScore ?? localLead.score, 0),
      lastContactAt: localLead.lastContactAt || localLead.updatedAt || localLead.createdAt || '',
      raw: localLead,
    };
  }

  const dbResult = await queryPgRows(
    `SELECT id, name, full_name, lead_name, address, property_address, phone, email, status, motivation_score, score, updated_at, created_at
     FROM public.leads
     WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 1`,
    [normalizedPhone],
  );
  if (dbResult.ok && dbResult.rows[0]) {
    const row = dbResult.rows[0];
    return {
      found: true,
      source: 'supabase-leads',
      leadId: row.id || '',
      leadName: row.name || row.full_name || row.lead_name || 'Returning seller',
      address: row.address || row.property_address || '',
      phone: normalizedPhone,
      email: row.email || '',
      status: row.status || '',
      motivationScore: toNumber(row.motivation_score ?? row.score, 0),
      lastContactAt: row.updated_at || row.created_at || '',
      raw: row,
    };
  }

  return {
    found: false,
    source: 'new-caller',
    leadId: `lead-inbound-${slugify(normalizedPhone || randomUUID())}`,
    leadName: 'New inbound caller',
    address: '',
    phone: normalizedPhone,
    email: '',
    status: 'new',
    motivationScore: 0,
    lastContactAt: '',
  };
}

function getAvaActiveMemorySummary(limit = 5) {
  return sortNewest(state.avaActiveMemories || [])
    .slice(0, limit)
    .map((memory) => `- ${memory.objectionTag || memory.memoryType || 'lesson'}: ${memory.response || memory.summary || memory.prompt || ''}`.trim())
    .filter(Boolean)
    .join('\n');
}

function buildAvaInboundPromptContext({ lead = {}, route = 'ava_qualify', from = '', to = '' } = {}) {
  const guidance = selectNegotiationGuidance({
    scenario: route === 'transfer_jordan' ? 'closing_hesitation' : 'opening',
    emotion: lead.motivationScore >= 8 ? 'urgent' : '',
    sentiment: lead.motivationScore >= 8 ? 'urgent' : 'neutral',
    transcriptStart: lead.status || '',
  }, {
    leadName: lead.leadName,
    address: lead.address,
    phone: lead.phone || from,
  });
  const memories = getAvaActiveMemorySummary(6);
  const guidanceLines = [
    guidance?.promptBrief || '',
    ...((guidance?.tactics || []).map((item) => `- ${item.principle || item.tacticName || 'Guidance'}: ${item.scriptExample || item.scriptFragment || item.recommendedResponse || ''}`)),
    guidance?.emotionalRule?.recommendedResponse ? `- Emotional read: ${guidance.emotionalRule.recommendedResponse}` : '',
  ].filter(Boolean);
  return [
    '## Inbound Call Mode - Probono Key Realty',
    'You are Ava, the acquisition specialist for Probono Key Realty. Sound warm, confident, tactful, and human. Never pretend to be a licensed attorney, never pressure, and transfer immediately when the caller asks for a human.',
    lead.found
      ? `Caller context: ${lead.leadName || 'Returning seller'}${lead.address ? ` at ${lead.address}` : ''}. Status: ${lead.status || 'unknown'}. Motivation score: ${lead.motivationScore || 0}.`
      : `Caller context: new caller from ${from || 'unknown number'} calling ${to || 'PBK'}. Start by asking for the property address and situation.`,
    route === 'transfer_jordan'
      ? 'Routing decision: high-intent caller. Explain briefly that you are connecting them to Jordan, then transfer.'
      : route === 'transfer_underwriting'
        ? 'Routing decision: contract/underwriting caller. Offer a concise status recap and transfer to underwriting.'
        : route === 'after_hours_voicemail'
          ? 'Routing decision: after-hours. Collect name, number, property address, and promise next-business-day callback.'
          : 'Routing decision: Ava qualifies first. Ask address, timeline, condition, motivation, and whether they want a quick cash analysis or Jordan handoff.',
    'Negotiation guidance for this moment:',
    ...guidanceLines,
    memories ? `Recent self-learned memories:\n${memories}` : 'Recent self-learned memories: none loaded yet.',
  ].filter(Boolean).join('\n');
}

async function persistInboundCallRoute(route = {}) {
  const result = await queryPgRows(
    `INSERT INTO public.inbound_call_routes (
      id, workspace_id, call_control_id, from_phone, to_phone, lead_id, route,
      reason, status, prompt_context, payload, created_at, updated_at
    )
    VALUES ($1,'pbk',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
    ON CONFLICT (id) DO UPDATE SET
      route = EXCLUDED.route,
      reason = EXCLUDED.reason,
      status = EXCLUDED.status,
      prompt_context = EXCLUDED.prompt_context,
      payload = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at`,
    [
      route.id,
      route.callControlId || '',
      route.from || '',
      route.to || '',
      route.leadId || '',
      route.route || '',
      route.reason || '',
      route.status || '',
      route.promptContext || '',
      JSON.stringify(route.payload || {}),
      route.createdAt || isoNow(),
      route.updatedAt || isoNow(),
    ],
  );
  return result.ok;
}

async function handleAvaInboundRoute(body = {}, options = {}) {
  recordToolUse('routeInboundCall');
  const parsed = parseTelnyxCallPayload(body);
  const callControlId = parsed.callControlId || body.call_control_id || body.callControlId || '';
  const lead = await findInboundLeadContext(parsed.from || body.from || body.phone || '');
  const afterHours = options.forceAfterHours === true || (options.forceAfterHours !== false && isInboundAfterHours());
  let route = 'ava_qualify';
  let reason = lead.found ? 'Returning caller routed to Ava qualification.' : 'New caller routed to Ava qualification.';
  if (afterHours) {
    route = 'after_hours_voicemail';
    reason = `After-hours routing in ${INBOUND_TIMEZONE}.`;
  } else if (lead.found && String(lead.status || '').toLowerCase() === 'contract_sent') {
    route = 'transfer_underwriting';
    reason = 'Contract sent lead routed to underwriting.';
  } else if (lead.found && lead.motivationScore >= 8 && !INBOUND_QUALIFY_BEFORE_TRANSFER) {
    route = 'transfer_jordan';
    reason = 'High-motivation returning lead routed directly to Jordan.';
  }

  const promptContext = buildAvaInboundPromptContext({ lead, route, from: parsed.from, to: parsed.to });
  const routeRecord = {
    id: `inbound-route-${slugify(callControlId || parsed.from || randomUUID())}-${Date.now()}`,
    callControlId,
    from: parsed.from,
    to: parsed.to,
    leadId: lead.leadId,
    route,
    reason,
    status: 'received',
    promptContext,
    payload: body,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };

  if (!lead.found && parsed.from) {
    addLeadImport(state, {
      id: lead.leadId,
      leadId: lead.leadId,
      status: 'callback_requested',
      source: 'inbound-call',
      seller: { name: 'New inbound caller', phone: parsed.from, email: '' },
      property: { address: '' },
      motivationScore: 0,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    });
  }

  const callRecord = createCallRecord({
    id: callControlId || undefined,
    leadId: lead.leadId,
    leadName: lead.leadName,
    address: lead.address,
    phone: parsed.from,
    from: parsed.to,
    direction: 'inbound',
    provider: 'Telnyx',
    status: route.startsWith('transfer_') ? 'transferring' : route === 'after_hours_voicemail' ? 'voicemail' : 'live',
    telnyxCallControlId: callControlId,
    telnyxCallLegId: parsed.callLegId,
    telnyxCallSessionId: parsed.callSessionId,
    script: promptContext,
    participantRole: lead.found ? 'returning-seller' : 'new-caller',
    participantConfidence: lead.found ? 0.78 : 0.52,
  });
  upsertCall(state, callRecord);

  const actions = [];
  if (callControlId) {
    actions.push({ action: 'answer', result: await answerTelnyxCall(callControlId) });
    if (route === 'transfer_jordan' || route === 'transfer_underwriting') {
      const target = route === 'transfer_underwriting' ? UNDERWRITING_AGENT_PHONE : HUMAN_AGENT_PHONE;
      actions.push({
        action: 'speak',
        result: await speakTelnyxCall(callControlId, route === 'transfer_underwriting'
          ? 'Thanks for calling. I am connecting you to underwriting now. Please hold.'
          : 'I see you are ready to move fast. I am connecting you to Jordan, our lead acquisition manager. Please hold.'),
      });
      actions.push({ action: 'transfer', result: await transferTelnyxCall(callControlId, target) });
    } else if (route === 'after_hours_voicemail') {
      actions.push({ action: 'speak', result: await speakTelnyxCall(callControlId, 'You have reached Probono Key Realty after hours. Please leave your name, number, property address, and what you need help with. We will call you back first thing next business day.') });
      actions.push({ action: 'record', result: await recordTelnyxCall(callControlId) });
    } else {
      actions.push({ action: 'start_ai_assistant', result: await startTelnyxAiAssistant(callControlId, promptContext) });
    }
  }

  const liveAction = actions.some((item) => item.result?.ok);
  const missingProvider = actions.some((item) => item.result?.skipped || item.result?.result === 'provider_missing');
  const result = liveAction ? 'live' : missingProvider ? 'provider_missing' : callControlId ? 'queued_for_approval' : 'local_view_only';
  routeRecord.status = result;
  routeRecord.payload = { ...routeRecord.payload, actions };
  if (!Array.isArray(state.inboundCallRoutes)) state.inboundCallRoutes = [];
  state.inboundCallRoutes.unshift(routeRecord);
  await persistInboundCallRoute(routeRecord);
  addActivity(state, makeActivity({
    actor: 'Ava',
    category: 'INBOUND',
    status: result === 'live' ? 'live' : result === 'provider_missing' ? 'warning' : 'queued',
    text: `${route.replace(/_/g, ' ')} for ${lead.leadName || parsed.from || 'inbound caller'}: ${reason}`,
    target: lead.address || parsed.from || callControlId || 'inbound call',
  }));
  addAdminAudit(state, {
    id: `audit-${routeRecord.id}`,
    actor: options.actor || 'Telnyx inbound webhook',
    action: 'route_inbound_call',
    status: result,
    target: lead.leadName || parsed.from || '',
    details: reason,
    metadata: { route, callControlId, from: parsed.from, to: parsed.to },
    createdAt: isoNow(),
  });
  if (['transfer_jordan', 'transfer_underwriting', 'after_hours_voicemail'].includes(route)) {
    await toolHandlers.slackNotify({
      channel: route === 'after_hours_voicemail' ? '#voicemails' : '#alerts',
      text: route === 'after_hours_voicemail'
        ? `After-hours voicemail flow started for ${parsed.from || 'unknown caller'}.`
        : `Inbound call routed to ${route === 'transfer_underwriting' ? 'underwriting' : 'Jordan'}: ${lead.leadName || parsed.from || 'caller'}${lead.motivationScore ? ` - score ${lead.motivationScore}` : ''}.`,
    });
  }
  await persistState(state);
  return {
    ok: true,
    result,
    verbiage: result === 'live' ? 'Inbound route executed' : result === 'provider_missing' ? 'Inbound route recorded - provider missing or disabled' : 'Inbound route prepared',
    route,
    reason,
    lead,
    call: callRecord,
    promptContext,
    actions,
  };
}

function classifyAvaObjection(text = '') {
  const raw = String(text || '').toLowerCase();
  if (/\b(too low|lowball|worth more|more money|price|offer)\b/.test(raw)) return 'price-too-low';
  if (/\b(think about|sleep on|not sure|call you back|later)\b/.test(raw)) return 'need-to-think';
  if (/\b(wife|husband|spouse|partner|kids|family)\b/.test(raw)) return 'spouse-or-family';
  if (/\b(scared|scam|trust|legit|real company|proof)\b/.test(raw)) return 'trust-issue';
  if (/\b(foreclosure|auction|eviction|deadline|behind|urgent|asap)\b/.test(raw)) return 'urgency';
  if (/\b(stop calling|do not call|remove me|unsubscribe)\b/.test(raw)) return 'dnc-request';
  if (/\b(repairs|condition|roof|foundation|mold|vacant)\b/.test(raw)) return 'repair-risk';
  if (/\b(probate|inherited|estate|passed away)\b/.test(raw)) return 'probate-empathy';
  return 'qualification-pattern';
}

function buildAvaLessonForObjection(objectionTag = '', transcript = '') {
  const templates = {
    'price-too-low': {
      prompt: 'Seller objects that the offer is too low.',
      response: 'Label the concern, anchor in repairs and speed, then ask what number would make the problem go away without exceeding MAO.',
      tactic: 'labeling + calibrated question',
    },
    'need-to-think': {
      prompt: 'Seller wants to think about it.',
      response: 'Give a smaller yes: offer to text the numbers, set a short follow-up, and ask what part they want to think through.',
      tactic: 'small commitment close',
    },
    'spouse-or-family': {
      prompt: 'Seller needs to talk to spouse or family.',
      response: 'Respect the decision team, ask who else needs the facts, and offer a summary that makes the math easy to share.',
      tactic: 'decision-map empathy',
    },
    'trust-issue': {
      prompt: 'Seller questions trust or legitimacy.',
      response: 'Slow down, explain the process plainly, offer references or a written summary, and never push for a signature.',
      tactic: 'authority without pressure',
    },
    urgency: {
      prompt: 'Seller signals urgency or deadline.',
      response: 'Confirm the date first, remove nonessential steps, and route to Jordan when score is high or timeline is under 14 days.',
      tactic: 'timeline-first qualification',
    },
    'dnc-request': {
      prompt: 'Seller requests no further calls.',
      response: 'Apologize, confirm opt-out, add DNC immediately, and end gracefully.',
      tactic: 'compliance-first de-escalation',
    },
    'repair-risk': {
      prompt: 'Seller describes repair or condition problems.',
      response: 'Ask for the worst known issue, explain that repairs affect risk not judgment, and frame the offer around as-is certainty.',
      tactic: 'condition-to-risk framing',
    },
    'probate-empathy': {
      prompt: 'Seller mentions inheritance, probate, or family loss.',
      response: 'Lead with patience and dignity, avoid aggressive urgency, and offer to simplify the next step.',
      tactic: 'tactical empathy',
    },
    'qualification-pattern': {
      prompt: 'Ava needs to qualify an inbound seller.',
      response: 'Ask address, condition, timeline, mortgage status, motivation, and decision-makers before discussing a cash range.',
      tactic: 'structured qualification',
    },
  };
  const selected = templates[objectionTag] || templates['qualification-pattern'];
  const excerpt = String(transcript || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  return { ...selected, objectionTag, excerpt };
}

function extractAvaLessonsFromTranscript(candidate = {}) {
  const transcript = String(candidate.body || candidate.transcript || candidate.text || '').trim();
  const objectionTag = classifyAvaObjection(transcript);
  const base = buildAvaLessonForObjection(objectionTag, transcript);
  const sentiment = Number(candidate.sentiment ?? candidate.payload?.sentiment?.pbkScore ?? 0.5);
  const success = /(yes|sounds good|send me|book|schedule|call me|interested|let's talk|accepted|signed)/i.test(transcript);
  return [{
    id: `ava-memory-${slugify(candidate.id || randomUUID())}-${objectionTag}`,
    memoryType: 'ava-call-lesson',
    objectionTag,
    pathKey: `${objectionTag}:${success ? 'positive' : sentiment < 0.35 ? 'negative' : 'neutral'}`,
    prompt: base.prompt,
    response: base.response,
    source: 'ava-self-learning',
    sourceUrl: '',
    outcome: success ? 'positive_signal' : sentiment < 0.35 ? 'needs_improvement' : 'observed',
    score: Math.max(0.35, Math.min(0.98, success ? 0.86 : sentiment || 0.55)),
    summary: `${base.tactic}: ${base.response}`,
    metadata: {
      tactic: base.tactic,
      excerpt: base.excerpt,
      candidateId: candidate.id || '',
      leadId: candidate.leadId || '',
      leadName: candidate.leadName || '',
      callId: candidate.callId || '',
      sentiment,
      success,
    },
    createdAt: isoNow(),
    updatedAt: isoNow(),
  }];
}

async function collectAvaLearningCandidates(limit = AVA_MEMORY_WORKER_LIMIT) {
  const candidates = [];
  const dbResult = await queryPgRows(
    `SELECT id, lead_id, channel, direction, status, provider, body, sentiment, payload, created_at, updated_at
     FROM public.unified_messages
     WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
       AND channel IN ('call', 'voice', 'recording')
       AND COALESCE(processed_for_learning, false) = false
       AND COALESCE(body, '') <> ''
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  if (dbResult.ok) {
    for (const row of dbResult.rows || []) {
      candidates.push({
        source: 'supabase',
        id: row.id,
        leadId: row.lead_id || '',
        channel: row.channel,
        direction: row.direction,
        status: row.status,
        provider: row.provider,
        body: row.body,
        sentiment: row.sentiment,
        payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  for (const message of sortNewest(state.messages || [])) {
    if (candidates.length >= limit) break;
    const channel = String(message.channel || '').toLowerCase();
    if (!['call', 'voice', 'recording'].includes(channel)) continue;
    if (message.payload?.processedForLearning || message.processedForLearning) continue;
    if (!String(message.body || '').trim()) continue;
    if (candidates.some((candidate) => candidate.id === message.id)) continue;
    candidates.push({ ...message, source: 'bridge-state' });
  }
  return candidates.slice(0, limit);
}

async function persistAvaMemoryLesson(lesson = {}) {
  const result = await queryPgRows(
    `INSERT INTO public.coach_memory (
      id, workspace_id, memory_type, objection_tag, path_key, prompt, response,
      source, source_url, outcome, score, metadata, created_at, updated_at
    )
    VALUES ($1,'pbk',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
    ON CONFLICT (id) DO UPDATE SET
      memory_type = EXCLUDED.memory_type,
      objection_tag = EXCLUDED.objection_tag,
      path_key = EXCLUDED.path_key,
      prompt = EXCLUDED.prompt,
      response = EXCLUDED.response,
      source = EXCLUDED.source,
      outcome = EXCLUDED.outcome,
      score = EXCLUDED.score,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at`,
    [
      lesson.id,
      lesson.memoryType || 'ava-call-lesson',
      lesson.objectionTag || '',
      lesson.pathKey || '',
      lesson.prompt || '',
      lesson.response || '',
      lesson.source || 'ava-self-learning',
      lesson.sourceUrl || '',
      lesson.outcome || 'observed',
      lesson.score ?? 0.5,
      JSON.stringify(lesson.metadata || {}),
      lesson.createdAt || isoNow(),
      lesson.updatedAt || isoNow(),
    ],
  );
  return result.ok;
}

async function persistAvaLearningSession(session = {}) {
  const result = await queryPgRows(
    `INSERT INTO public.ava_learning_sessions (
      id, workspace_id, processed_at, minutes_budget, candidates_processed,
      lessons_extracted, status, summary, metadata, created_at, updated_at
    )
    VALUES ($1,'pbk',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
    ON CONFLICT (id) DO UPDATE SET
      processed_at = EXCLUDED.processed_at,
      candidates_processed = EXCLUDED.candidates_processed,
      lessons_extracted = EXCLUDED.lessons_extracted,
      status = EXCLUDED.status,
      summary = EXCLUDED.summary,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at`,
    [
      session.id,
      session.processedAt || isoNow(),
      session.minutesBudget ?? AVA_MEMORY_DAILY_MINUTES,
      session.candidatesProcessed ?? 0,
      session.lessonsExtracted ?? 0,
      session.status || 'complete',
      session.summary || '',
      JSON.stringify(session.metadata || {}),
      session.createdAt || isoNow(),
      session.updatedAt || isoNow(),
    ],
  );
  return result.ok;
}

async function markAvaLearningCandidateProcessed(candidate = {}, sessionId = '') {
  if (candidate.source === 'supabase') {
    await queryPgRows(
      `UPDATE public.unified_messages
       SET processed_for_learning = true,
           learning_processed_at = NOW(),
           learning_session_id = $2,
           learning_metadata = COALESCE(learning_metadata, '{}'::jsonb) || $3::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [candidate.id, sessionId, JSON.stringify({ processedBy: 'ava-self-learning', processedAt: isoNow() })],
    );
  }
  const localMessage = (state.messages || []).find((message) => message.id === candidate.id);
  if (localMessage) {
    upsertMessage(state, {
      ...localMessage,
      payload: {
        ...(localMessage.payload || {}),
        processedForLearning: true,
        learningSessionId: sessionId,
        learningProcessedAt: isoNow(),
      },
      updatedAt: isoNow(),
    });
  }
}

function upsertAvaActiveMemory(lesson = {}) {
  if (!Array.isArray(state.avaActiveMemories)) state.avaActiveMemories = [];
  const existingIndex = state.avaActiveMemories.findIndex((memory) => memory.id === lesson.id);
  const memory = {
    id: lesson.id,
    memoryType: lesson.memoryType || 'ava-call-lesson',
    objectionTag: lesson.objectionTag || '',
    prompt: lesson.prompt || '',
    response: lesson.response || '',
    summary: lesson.summary || lesson.response || '',
    score: lesson.score ?? 0.5,
    outcome: lesson.outcome || 'observed',
    source: lesson.source || 'ava-self-learning',
    metadata: lesson.metadata || {},
    createdAt: lesson.createdAt || isoNow(),
    updatedAt: isoNow(),
  };
  if (existingIndex >= 0) {
    state.avaActiveMemories.splice(existingIndex, 1, { ...state.avaActiveMemories[existingIndex], ...memory });
  } else {
    state.avaActiveMemories.unshift(memory);
  }
  limitStateArrays(state);
}

async function runAvaMemoryLearning(params = {}) {
  recordToolUse('runAvaMemoryLearning');
  const sessionId = params.sessionId || `ava-learning-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const limit = Math.max(1, Math.min(200, Number(params.limit || AVA_MEMORY_WORKER_LIMIT)));
  const minutesBudget = Math.max(1, Math.min(240, Number(params.minutesBudget || AVA_MEMORY_DAILY_MINUTES)));
  const candidates = await collectAvaLearningCandidates(limit);
  const lessons = [];
  for (const candidate of candidates) {
    const extracted = extractAvaLessonsFromTranscript(candidate);
    for (const lesson of extracted) {
      await persistAvaMemoryLesson(lesson);
      upsertAvaActiveMemory(lesson);
      lessons.push(lesson);
    }
    await markAvaLearningCandidateProcessed(candidate, sessionId);
  }
  const topTags = [...lessons.reduce((map, lesson) => {
    const key = lesson.objectionTag || 'lesson';
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));
  const session = {
    id: sessionId,
    processedAt: isoNow(),
    minutesBudget,
    candidatesProcessed: candidates.length,
    lessonsExtracted: lessons.length,
    status: 'complete',
    summary: `Ava processed ${candidates.length} call transcript${candidates.length === 1 ? '' : 's'} and learned ${lessons.length} tactic${lessons.length === 1 ? '' : 's'}.`,
    metadata: {
      actor: params.actor || 'Ava memory worker',
      topTags,
      candidateIds: candidates.map((candidate) => candidate.id).filter(Boolean),
    },
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
  if (!Array.isArray(state.avaLearningSessions)) state.avaLearningSessions = [];
  state.avaLearningSessions.unshift(session);
  await persistAvaLearningSession(session);
  addActivity(state, makeActivity({
    actor: 'Ava',
    category: 'LEARNING',
    status: lessons.length ? 'complete' : 'idle',
    text: session.summary,
    target: topTags[0]?.tag || 'call memory',
  }));
  addAdminAudit(state, {
    id: `audit-${session.id}`,
    actor: params.actor || 'Ava memory worker',
    action: 'ava_memory_learning',
    status: lessons.length ? 'complete' : 'idle',
    target: topTags[0]?.tag || 'call memory',
    details: session.summary,
    metadata: session.metadata,
    createdAt: isoNow(),
  });
  await persistState(state);
  return {
    ok: true,
    result: DATABASE_URL ? 'live' : 'local_view_only',
    verbiage: 'Ava memory learning run complete',
    session,
    lessons,
    activeMemories: sortNewest(state.avaActiveMemories || []).slice(0, 12),
    warning: DATABASE_URL ? '' : 'PBK_DATABASE_URL is not configured; lessons were stored in bridge state only.',
  };
}

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
    const endpointPath = String(endpoint || '').trim();
    const url = /^https?:\/\//i.test(endpointPath)
      ? endpointPath
      : `${INSTANTLY_BASE_URL}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
    const response = await fetch(url, {
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
  const missing = [];
  if (!SLACK_WEBHOOK_URL && !SLACK_BOT_TOKEN) missing.push('PBK_SLACK_WEBHOOK_URL or PBK_SLACK_BOT_TOKEN');
  if (SLACK_BOT_TOKEN && !SLACK_APPROVAL_CHANNEL_ID) missing.push('PBK_SLACK_APPROVAL_CHANNEL_ID');
  return {
    configured: Boolean(SLACK_WEBHOOK_URL || SLACK_BOT_TOKEN),
    ready: missing.length === 0,
    webhookReady: Boolean(SLACK_WEBHOOK_URL),
    interactiveReady: Boolean(SLACK_BOT_TOKEN && SLACK_APPROVAL_CHANNEL_ID),
    signingSecretConfigured: Boolean(SLACK_SIGNING_SECRET),
    approvalChannelId: SLACK_APPROVAL_CHANNEL_ID || '',
    missing,
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

function getSupabaseStorageProviderMeta() {
  const missing = [];
  if (!SUPABASE_URL) missing.push('PBK_SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('PBK_SUPABASE_SERVICE_ROLE_KEY');
  return {
    configured: Boolean(SUPABASE_URL || SUPABASE_SERVICE_ROLE_KEY),
    ready: missing.length === 0,
    mode: 'supabase-storage',
    bucket: SUPABASE_CALL_RECORDINGS_BUCKET,
    signedUrlTtlSeconds: SUPABASE_RECORDING_SIGNED_URL_TTL_SECONDS,
    missing,
  };
}

function getN8nWorkflowProviderMeta() {
  const missing = [];
  if (!N8N_API_BASE_URL) missing.push('PBK_N8N_API_BASE_URL');
  if (!N8N_API_KEY) missing.push('PBK_N8N_API_KEY');
  return {
    configured: Boolean(N8N_API_BASE_URL || N8N_API_KEY),
    ready: missing.length === 0,
    mode: missing.length === 0 ? 'n8n-api' : 'local-draft-store',
    localDraftStore: true,
    missing,
  };
}

function encodePathSegments(value = '') {
  return String(value || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function normalizeStoragePath(value = '') {
  const trimmed = String(value || '').trim().replace(/^\/+/g, '');
  const bucketPrefix = `${SUPABASE_CALL_RECORDINGS_BUCKET}/`;
  return trimmed.startsWith(bucketPrefix) ? trimmed.slice(bucketPrefix.length) : trimmed;
}

function buildRecordingStoragePath(params = {}) {
  const explicit = normalizeStoragePath(
    params.storagePath
      || params.storage_path
      || params.recordingStoragePath
      || params.path
      || '',
  );
  if (explicit) return explicit;
  const context = findLeadContext(params);
  const leadKey = slugify(context.leadId || context.leadName || context.address || 'lead') || 'lead';
  const messageKey = slugify(params.messageId || params.id || params.callId || randomUUID()) || randomUUID();
  const extension = String(params.extension || params.ext || 'mp3').replace(/^\./, '') || 'mp3';
  return `${leadKey}/${messageKey}.${extension}`;
}

function findMessageById(messageId = '') {
  const id = String(messageId || '').trim();
  if (!id) return null;
  return state.messages.find((message) => {
    return message?.id === id
      || message?.messageId === id
      || message?.callId === id
      || message?.telnyxCallControlId === id
      || message?.telnyxCallSessionId === id;
  }) || null;
}

function getMessageRecordingPath(message = {}) {
  return normalizeStoragePath(
    message.storagePath
      || message.storage_path
      || message.recordingStoragePath
      || message.recording_storage_path
      || message.payload?.storagePath
      || message.payload?.storage_path
      || '',
  );
}

function getMessageRecordingUrl(message = {}) {
  return String(
    message.recordingUrl
      || message.audioUrl
      || message.playbackUrl
      || message.url
      || message.payload?.recordingUrl
      || message.payload?.audioUrl
      || '',
  ).trim();
}

function getSupabaseStorageHeaders(contentType = 'application/json') {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

async function createSupabaseRecordingSignedUrl(storagePath, expiresIn = SUPABASE_RECORDING_SIGNED_URL_TTL_SECONDS) {
  const meta = getSupabaseStorageProviderMeta();
  if (!meta.ready) {
    return {
      ok: false,
      configured: meta.configured,
      missing: meta.missing,
      error: `Supabase Storage is not configured (${meta.missing.join(', ') || 'missing credentials'}).`,
    };
  }
  const normalizedPath = normalizeStoragePath(storagePath);
  if (!normalizedPath) {
    return { ok: false, error: 'Recording storage_path is missing.' };
  }
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(SUPABASE_CALL_RECORDINGS_BUCKET)}/${encodePathSegments(normalizedPath)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getSupabaseStorageHeaders(),
    body: JSON.stringify({ expiresIn }),
  });
  const payload = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.message || payload?.error || `Supabase signed URL request failed with ${response.status}.`,
    };
  }
  const signedUrl = payload.signedURL || payload.signedUrl || payload.url || '';
  const normalizedSignedUrl = String(signedUrl || '');
  const absoluteSignedUrl = normalizedSignedUrl && /^https?:\/\//i.test(normalizedSignedUrl)
    ? normalizedSignedUrl
    : `${SUPABASE_URL}${normalizedSignedUrl.startsWith('/storage/v1') ? '' : '/storage/v1'}${normalizedSignedUrl.startsWith('/') ? '' : '/'}${normalizedSignedUrl}`;
  return {
    ok: true,
    bucket: SUPABASE_CALL_RECORDINGS_BUCKET,
    storagePath: normalizedPath,
    expiresIn,
    signedUrl: absoluteSignedUrl,
  };
}

async function uploadSupabaseRecording({ storagePath, contentType = 'audio/mpeg', bytes }) {
  const meta = getSupabaseStorageProviderMeta();
  if (!meta.ready) {
    return {
      ok: false,
      configured: meta.configured,
      missing: meta.missing,
      error: `Supabase Storage is not configured (${meta.missing.join(', ') || 'missing credentials'}).`,
    };
  }
  const normalizedPath = normalizeStoragePath(storagePath);
  if (!normalizedPath) return { ok: false, error: 'Recording storage_path is missing.' };
  if (!bytes?.length) return { ok: false, error: 'Recording bytes are missing.' };
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_CALL_RECORDINGS_BUCKET)}/${encodePathSegments(normalizedPath)}`,
    {
      method: 'PUT',
      headers: {
        ...getSupabaseStorageHeaders(contentType),
        'x-upsert': 'true',
      },
      body: bytes,
    },
  );
  const responseText = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: responseText || `Supabase recording upload failed with ${response.status}.`,
    };
  }
  return {
    ok: true,
    bucket: SUPABASE_CALL_RECORDINGS_BUCKET,
    storagePath: normalizedPath,
    response: responseText ? safeJsonParse(responseText, responseText) : {},
  };
}

async function deleteSupabaseRecording(storagePath = '') {
  const meta = getSupabaseStorageProviderMeta();
  if (!meta.ready) {
    return {
      ok: false,
      configured: meta.configured,
      missing: meta.missing,
      error: `Supabase Storage is not configured (${meta.missing.join(', ') || 'missing credentials'}).`,
    };
  }
  const normalizedPath = normalizeStoragePath(storagePath);
  if (!normalizedPath) return { ok: false, error: 'Recording storage_path is missing.' };
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_CALL_RECORDINGS_BUCKET)}/${encodePathSegments(normalizedPath)}`,
    {
      method: 'DELETE',
      headers: getSupabaseStorageHeaders(''),
    },
  );
  const responseText = await response.text().catch(() => '');
  if (!response.ok && response.status !== 404) {
    return {
      ok: false,
      status: response.status,
      error: responseText || `Supabase recording delete failed with ${response.status}.`,
    };
  }
  return {
    ok: true,
    deleted: response.status !== 404,
    bucket: SUPABASE_CALL_RECORDINGS_BUCKET,
    storagePath: normalizedPath,
  };
}

async function fetchRecordingBytes(recordingUrl = '') {
  const url = String(recordingUrl || '').trim();
  if (!url) return { ok: false, error: 'Recording URL is missing.' };
  const headers = {};
  if (TELNYX_API_KEY && /telnyx/i.test(url)) {
    headers.Authorization = `Bearer ${TELNYX_API_KEY}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      error: errorText || `Recording download failed with ${response.status}.`,
    };
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    ok: true,
    bytes: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'audio/mpeg',
  };
}

function getCallById(callId = '') {
  const id = String(callId || '').trim();
  if (!id) return null;
  return (state.calls || []).find((call) =>
    call.id === id
    || call.callId === id
    || call.telnyxCallControlId === id
    || call.telnyxCallLegId === id
    || call.telnyxCallSessionId === id,
  ) || null;
}

function normalizeRecordingCapturePayload(input = {}) {
  const payload = input.data?.payload || input.payload || input.data || input;
  const recordingUrls = [
    payload.recording_url,
    payload.recordingUrl,
    payload.audio_url,
    payload.audioUrl,
    payload.url,
    payload.download_url,
    payload.downloadUrl,
    payload.recording_urls?.[0],
    payload.recordingUrls?.[0],
  ].filter(Boolean);
  const callId = payload.call_control_id
    || payload.callControlId
    || payload.call_leg_id
    || payload.callLegId
    || payload.call_session_id
    || payload.callSessionId
    || payload.call_id
    || payload.callId
    || payload.id
    || '';
  return {
    ...payload,
    eventType: input.data?.event_type || input.event_type || input.type || input.eventType || '',
    callId,
    call_control_id: payload.call_control_id || payload.callControlId || '',
    call_leg_id: payload.call_leg_id || payload.callLegId || '',
    call_session_id: payload.call_session_id || payload.callSessionId || '',
    recordingUrl: recordingUrls[0] || '',
    audioBase64: payload.audioBase64 || payload.audio_base64 || payload.recordingBase64 || '',
    contentType: payload.content_type || payload.contentType || payload.media_type || '',
    durationSeconds: payload.duration_secs || payload.duration_seconds || payload.duration || 0,
  };
}

async function captureRecordingFromPayload(input = {}) {
  const params = normalizeRecordingCapturePayload(input);
  const existingCall = getCallById(params.callId);
  const messageId = params.messageId
    || params.recording_id
    || params.recordingId
    || `msg-recording-${slugify(params.callId || existingCall?.leadName || 'call')}-${Date.now()}`;
  const storagePath = buildRecordingStoragePath({
    ...params,
    messageId,
    leadId: params.leadId || existingCall?.leadId || '',
    leadName: params.leadName || existingCall?.leadName || '',
    address: params.address || existingCall?.address || '',
    extension: params.extension || (/wav/i.test(params.contentType) ? 'wav' : 'mp3'),
  });

  let bytes = null;
  let download = null;
  let contentType = params.contentType || 'audio/mpeg';
  if (params.audioBase64) {
    bytes = Buffer.from(String(params.audioBase64).replace(/^data:[^;]+;base64,/i, ''), 'base64');
  } else if (params.recordingUrl) {
    download = await fetchRecordingBytes(params.recordingUrl);
    if (download.ok) {
      bytes = download.bytes;
      contentType = download.contentType || contentType;
    }
  }

  if (!bytes?.length) {
    return {
      ok: false,
      result: 'provider_missing',
      error: download?.error || 'Telnyx webhook did not include downloadable recording audio.',
      callId: params.callId,
      recordingUrl: params.recordingUrl,
    };
  }

  const upload = await uploadSupabaseRecording({ storagePath, contentType, bytes });
  if (upload.ok === false) {
    return {
      ...upload,
      result: 'provider_missing',
      callId: params.callId,
      messageId,
      storagePath,
    };
  }
  const deepgramMeta = getDeepgramProviderMeta(process.env);
  const deepgram = deepgramMeta.ready && deepgramMeta.analyzeRecordings
    ? await transcribeDeepgramFile({
      bytes,
      contentType,
      sentiment: true,
      utterances: true,
      paragraphs: true,
    })
    : null;
  const deepgramSummary = deepgram?.ok ? deepgram.summary : null;

  const message = {
    ...(findMessageById(messageId) || createMessageRecord({
      ...params,
      id: messageId,
      leadId: params.leadId || existingCall?.leadId || '',
      leadName: params.leadName || existingCall?.leadName || '',
      address: params.address || existingCall?.address || '',
      channel: 'call',
      direction: 'recording',
      provider: 'Telnyx',
      status: 'recorded',
      body: deepgramSummary?.transcript || 'Production call recording captured and stored.',
    })),
    ...params,
    id: messageId,
    leadId: params.leadId || existingCall?.leadId || '',
    leadName: params.leadName || existingCall?.leadName || 'Unknown seller',
    address: params.address || existingCall?.address || '',
    channel: 'call',
    direction: 'recording',
    provider: params.provider || 'Telnyx',
    status: 'recorded',
    storagePath,
    storageBucket: SUPABASE_CALL_RECORDINGS_BUCKET,
    audioContentType: contentType,
    durationSeconds: toNumber(params.durationSeconds, 0),
    recordingUrl: '',
    callId: params.callId || existingCall?.id || '',
    body: deepgramSummary?.transcript || params.body || 'Production call recording captured and stored.',
    sentiment: deepgramSummary?.sentiment?.pbkScore ?? params.sentiment ?? null,
    payload: {
      ...(params.payload && typeof params.payload === 'object' ? params.payload : {}),
      sourceEventType: params.eventType,
      storagePath,
      storageBucket: SUPABASE_CALL_RECORDINGS_BUCKET,
      contentType,
      upload,
      deepgram: deepgram
        ? {
          ok: deepgram.ok,
          result: deepgram.result,
          model: deepgram.model,
          error: deepgram.error || '',
          summary: deepgramSummary,
        }
        : {
          ok: false,
          skipped: true,
          reason: deepgramMeta.ready
            ? 'PBK_DEEPGRAM_ANALYZE_RECORDINGS is not enabled.'
            : `Deepgram not configured (${deepgramMeta.missing.join(', ') || 'missing credentials'}).`,
        },
    },
    updatedAt: isoNow(),
  };
  upsertMessage(state, message);
  await persistUnifiedMessageRecord(message);

  if (existingCall) {
    upsertCall(state, {
      ...existingCall,
      status: existingCall.status === 'live' ? 'ended' : existingCall.status,
      storagePath,
      storageBucket: SUPABASE_CALL_RECORDINGS_BUCKET,
      audioContentType: contentType,
      durationSeconds: message.durationSeconds,
      recordingMessageId: message.id,
      updatedAt: isoNow(),
    });
  }

  addActivity(
    state,
    makeActivity({
      actor: 'Telnyx',
      category: 'CALL',
      status: 'uploaded',
      text: `Call audio captured and stored for ${message.leadName || message.callId || message.id}.`,
      target: storagePath,
    }),
  );
  await persistState(state);
  return {
    ok: true,
    result: 'live',
    message,
    upload,
    deepgram,
    storagePath,
    callId: params.callId,
  };
}

const ensuredSupabaseBuckets = new Set();

function normalizeStoragePathForBucket(value = '', bucket = '') {
  const trimmed = String(value || '').trim().replace(/^\/+/g, '');
  const bucketPrefix = bucket ? `${bucket}/` : '';
  return bucketPrefix && trimmed.startsWith(bucketPrefix) ? trimmed.slice(bucketPrefix.length) : trimmed;
}

async function ensureSupabaseBucket(bucket = '') {
  const bucketName = String(bucket || '').trim();
  const meta = getSupabaseStorageProviderMeta();
  if (!bucketName || !meta.ready || ensuredSupabaseBuckets.has(bucketName)) {
    return { ok: Boolean(bucketName), skipped: !bucketName || !meta.ready };
  }

  const bucketUrl = `${SUPABASE_URL}/storage/v1/bucket/${encodeURIComponent(bucketName)}`;
  const existing = await fetch(bucketUrl, {
    method: 'GET',
    headers: getSupabaseStorageHeaders(),
  }).catch((error) => ({ ok: false, status: 0, error }));

  if (existing.ok) {
    ensuredSupabaseBuckets.add(bucketName);
    return { ok: true, bucket: bucketName, existing: true };
  }

  const create = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: getSupabaseStorageHeaders(),
    body: JSON.stringify({ id: bucketName, name: bucketName, public: false }),
  }).catch((error) => ({ ok: false, status: 0, error }));

  if (create.ok || create.status === 409) {
    ensuredSupabaseBuckets.add(bucketName);
    return { ok: true, bucket: bucketName, existing: create.status === 409 };
  }

  const text = typeof create.text === 'function' ? await create.text().catch(() => '') : '';
  return {
    ok: false,
    bucket: bucketName,
    status: create.status || 0,
    error: text || create.error?.message || `Could not create Supabase Storage bucket ${bucketName}.`,
  };
}

async function uploadSupabaseObject({ bucket, storagePath, contentType = 'application/octet-stream', bytes }) {
  const meta = getSupabaseStorageProviderMeta();
  if (!meta.ready) {
    return {
      ok: false,
      configured: meta.configured,
      missing: meta.missing,
      error: `Supabase Storage is not configured (${meta.missing.join(', ') || 'missing credentials'}).`,
    };
  }
  const bucketName = String(bucket || '').trim();
  const normalizedPath = normalizeStoragePathForBucket(storagePath, bucketName);
  if (!bucketName) return { ok: false, error: 'Supabase Storage bucket is missing.' };
  if (!normalizedPath) return { ok: false, error: 'Storage path is missing.' };
  if (!bytes?.length) return { ok: false, error: 'Upload bytes are missing.' };

  const ensured = await ensureSupabaseBucket(bucketName);
  if (ensured.ok === false) return ensured;

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodePathSegments(normalizedPath)}`,
    {
      method: 'PUT',
      headers: {
        ...getSupabaseStorageHeaders(contentType),
        'x-upsert': 'true',
      },
      body: bytes,
    },
  );
  const responseText = await response.text().catch(() => '');
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: responseText || `Supabase upload failed with ${response.status}.`,
    };
  }
  return {
    ok: true,
    bucket: bucketName,
    storagePath: normalizedPath,
    response: responseText ? safeJsonParse(responseText, responseText) : {},
  };
}

async function createSupabaseObjectSignedUrl(bucket, storagePath, expiresIn = SUPABASE_ATTACHMENT_SIGNED_URL_TTL_SECONDS) {
  const meta = getSupabaseStorageProviderMeta();
  if (!meta.ready) {
    return {
      ok: false,
      configured: meta.configured,
      missing: meta.missing,
      error: `Supabase Storage is not configured (${meta.missing.join(', ') || 'missing credentials'}).`,
    };
  }
  const bucketName = String(bucket || '').trim();
  const normalizedPath = normalizeStoragePathForBucket(storagePath, bucketName);
  if (!bucketName) return { ok: false, error: 'Supabase Storage bucket is missing.' };
  if (!normalizedPath) return { ok: false, error: 'Storage path is missing.' };
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucketName)}/${encodePathSegments(normalizedPath)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getSupabaseStorageHeaders(),
    body: JSON.stringify({ expiresIn }),
  });
  const payload = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.message || payload?.error || `Supabase signed URL request failed with ${response.status}.`,
    };
  }
  const signedUrl = payload.signedURL || payload.signedUrl || payload.url || '';
  const normalizedSignedUrl = String(signedUrl || '');
  const absoluteSignedUrl = normalizedSignedUrl && /^https?:\/\//i.test(normalizedSignedUrl)
    ? normalizedSignedUrl
    : `${SUPABASE_URL}${normalizedSignedUrl.startsWith('/storage/v1') ? '' : '/storage/v1'}${normalizedSignedUrl.startsWith('/') ? '' : '/'}${normalizedSignedUrl}`;
  return {
    ok: true,
    bucket: bucketName,
    storagePath: normalizedPath,
    expiresIn,
    signedUrl: absoluteSignedUrl,
  };
}

function getSafeFileName(filename = 'attachment') {
  const cleaned = String(filename || 'attachment')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'attachment';
}

function buildAttachmentStoragePath(params = {}) {
  const explicit = normalizeStoragePathForBucket(
    params.storagePath || params.storage_path || params.path || '',
    SUPABASE_ATTACHMENTS_BUCKET,
  );
  if (explicit) return explicit;
  const context = findLeadContext(params);
  const leadKey = slugify(context.leadId || context.leadName || context.address || params.topic || 'general') || 'general';
  const safeName = getSafeFileName(params.filename || params.fileName || 'attachment');
  const extension = safeName.includes('.') ? safeName.split('.').pop() : 'bin';
  const stem = slugify(safeName.replace(/\.[^.]+$/g, '')) || 'attachment';
  return `${leadKey}/${Date.now()}-${randomUUID().slice(0, 8)}-${stem}.${extension}`;
}

async function extractAttachmentText({ filename = '', contentType = '', bytes }) {
  const fileName = String(filename || 'attachment');
  const mime = String(contentType || '').toLowerCase();
  const extension = fileName.toLowerCase().split('.').pop() || '';
  const textLike = /^(text\/|application\/json|application\/csv|application\/xml)/i.test(mime)
    || ['txt', 'md', 'csv', 'json', 'html', 'htm', 'xml'].includes(extension);

  if (!bytes?.length) return { ok: false, text: '', error: 'No attachment bytes were available for extraction.' };

  if (textLike) {
    const text = Buffer.from(bytes).toString('utf8');
    return { ok: true, parser: 'text', text, characters: text.length };
  }

  if (mime.includes('pdf') || extension === 'pdf') {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: Buffer.from(bytes) });
      const result = await parser.getText();
      await Promise.resolve(parser.destroy?.()).catch(() => {});
      const text = String(result?.text || '').trim();
      return { ok: Boolean(text), parser: 'pdf-parse', text, characters: text.length };
    } catch (error) {
      return { ok: false, parser: 'pdf-parse', text: '', error: error?.message || 'PDF extraction failed.' };
    }
  }

  if (mime.includes('word') || ['docx', 'doc'].includes(extension)) {
    try {
      const mammoth = await import('mammoth');
      const extractor = mammoth.extractRawText || mammoth.default?.extractRawText;
      if (typeof extractor !== 'function') throw new Error('mammoth.extractRawText is unavailable.');
      const result = await extractor({ buffer: Buffer.from(bytes) });
      const text = String(result?.value || '').trim();
      return {
        ok: Boolean(text),
        parser: 'mammoth',
        text,
        characters: text.length,
        warnings: result?.messages || [],
      };
    } catch (error) {
      return { ok: false, parser: 'mammoth', text: '', error: error?.message || 'DOCX extraction failed.' };
    }
  }

  return {
    ok: false,
    parser: 'unsupported',
    text: '',
    error: `No text extractor is configured for ${mime || extension || 'this file type'}.`,
  };
}

function parseTags(value = '') {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,\n|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function handleAttachmentUpload({ file = {}, fields = {} } = {}) {
  const filename = getSafeFileName(file.filename || file.name || fields.filename || 'attachment');
  const contentType = String(file.contentType || file.type || fields.contentType || 'application/octet-stream').trim();
  const bytes = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || []);
  if (!bytes.length) return { ok: false, error: 'Attachment file is empty.' };

  const topic = fields.topic || 'Uploaded Documents';
  const tags = [
    ...parseTags(fields.tags),
    topic,
    'attachment',
    filename.split('.').pop(),
  ].filter(Boolean);
  const attachmentId = fields.id || `att-${randomUUID()}`;
  const storagePath = buildAttachmentStoragePath({ ...fields, filename });
  const upload = await uploadSupabaseObject({
    bucket: SUPABASE_ATTACHMENTS_BUCKET,
    storagePath,
    contentType,
    bytes,
  });
  if (upload.ok === false) return upload;

  const signed = await createSupabaseObjectSignedUrl(
    SUPABASE_ATTACHMENTS_BUCKET,
    storagePath,
    Number(fields.expiresIn || SUPABASE_ATTACHMENT_SIGNED_URL_TTL_SECONDS),
  );
  const extraction = await extractAttachmentText({ filename, contentType, bytes });
  const searchableText = extraction.text
    || `Uploaded attachment ${filename}. Type: ${contentType || 'unknown'}. Size: ${bytes.length} bytes.`;
  let brain = null;
  try {
    brain = await toolHandlers.ingestResearchDoc({
      title: fields.title || filename,
      source: fields.source || `Supabase attachment: ${filename}`,
      topic,
      summary: searchableText.slice(0, 2400),
      excerpt: searchableText,
      kind: 'attachment',
      tags,
      metadata: {
        attachmentId,
        filename,
        contentType,
        size: bytes.length,
        bucket: SUPABASE_ATTACHMENTS_BUCKET,
        storagePath,
        signedUrlExpiresIn: signed.expiresIn,
        extraction: {
          ok: extraction.ok,
          parser: extraction.parser,
          characters: extraction.characters || 0,
          error: extraction.error || '',
        },
        leadId: fields.leadId || '',
        leadName: fields.leadName || '',
        address: fields.address || '',
      },
    });
  } catch (error) {
    brain = { ok: false, error: error?.message || 'Brain ingest failed after attachment upload.' };
  }

  const attachment = {
    id: attachmentId,
    leadId: fields.leadId || '',
    leadName: fields.leadName || '',
    address: fields.address || '',
    filename,
    contentType,
    size: bytes.length,
    bucket: SUPABASE_ATTACHMENTS_BUCKET,
    storagePath,
    topic,
    tags,
    status: upload.ok ? 'stored' : 'failed',
    extractionStatus: extraction.ok ? 'indexed' : 'stored-only',
    extractionParser: extraction.parser || '',
    extractionError: extraction.error || '',
    textCharacters: extraction.characters || 0,
    brainDocId: brain?.doc?.id || brain?.result?.doc?.id || '',
    signedUrlExpiresIn: signed.expiresIn || 0,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };

  addAttachmentRecord(state, attachment);
  await persistAttachmentMetadata(attachment);
  addActivity(
    state,
    makeActivity({
      actor: fields.actor || 'Command Center',
      category: 'BRAIN',
      status: extraction.ok ? 'indexed' : 'uploaded',
      text: `${filename} uploaded to Supabase Storage${extraction.ok ? ' and indexed for Rex' : '; text extraction needs review'}.`,
      target: storagePath,
    }),
  );
  await persistState(state);

  return {
    ok: true,
    attachment,
    upload,
    signed,
    signedUrl: signed.ok ? signed.signedUrl : '',
    extraction: {
      ok: extraction.ok,
      parser: extraction.parser,
      characters: extraction.characters || 0,
      error: extraction.error || '',
      warnings: extraction.warnings || [],
    },
    brain,
  };
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function loadWorkflowDrafts() {
  await ensureRuntimeDir();
  try {
    const raw = await readFile(N8N_WORKFLOW_DRAFTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.drafts) ? parsed.drafts : [];
  } catch {
    return [];
  }
}

async function saveWorkflowDrafts(drafts = []) {
  await ensureRuntimeDir();
  await writeFile(N8N_WORKFLOW_DRAFTS_FILE, jsonStringify({ drafts, updatedAt: isoNow() }), 'utf8');
}

function normalizeWorkflowDraft(params = {}) {
  const workflow = params.workflow && typeof params.workflow === 'object' ? params.workflow : params;
  const name = workflow.name || params.name || 'PBK Workflow Draft';
  return {
    id: workflow.id || params.id || `workflow-${slugify(name) || randomUUID()}-${Date.now()}`,
    name,
    active: Boolean(workflow.active ?? params.active),
    nodes: Array.isArray(workflow.nodes) ? workflow.nodes : [],
    connections: workflow.connections && typeof workflow.connections === 'object' ? workflow.connections : {},
    settings: workflow.settings && typeof workflow.settings === 'object' ? workflow.settings : {},
    tags: Array.isArray(workflow.tags) ? workflow.tags : [],
    metadata: {
      ...(workflow.metadata && typeof workflow.metadata === 'object' ? workflow.metadata : {}),
      ...(params.metadata && typeof params.metadata === 'object' ? params.metadata : {}),
    },
    updatedAt: isoNow(),
  };
}

function materializeN8nWorkflow(draft = {}) {
  if (Array.isArray(draft.nodes) && draft.nodes.length) {
    return {
      nodes: draft.nodes,
      connections: draft.connections && typeof draft.connections === 'object' ? draft.connections : {},
    };
  }

  const triggerType = String(draft.settings?.triggerType || draft.triggerType || '').toLowerCase();
  const table = String(draft.settings?.table || draft.table || 'leads_import').trim();
  const event = String(draft.settings?.event || draft.event || 'INSERT').trim();
  const filter = String(draft.settings?.filter || draft.filter || '').trim();
  const pathKey = slugify(`${draft.name || 'pbk-workflow'}-${table}-${event}`) || `pbk-workflow-${randomUUID().slice(0, 8)}`;
  const triggerNode = triggerType.includes('schedule')
    ? {
        parameters: { rule: { interval: [{ minutes: 15 }] } },
        id: `trigger-${pathKey}`,
        name: 'PBK Schedule Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [240, 300],
      }
    : triggerType.includes('manual')
      ? {
          parameters: {},
          id: `trigger-${pathKey}`,
          name: 'PBK Manual Trigger',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [240, 300],
        }
      : {
          parameters: {
            httpMethod: 'POST',
            path: pathKey,
            responseMode: 'onReceived',
            options: {},
          },
          id: `trigger-${pathKey}`,
          name: 'PBK Webhook Trigger',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [240, 300],
        };

  const actionNode = {
    parameters: {},
    id: `pbk-handoff-${pathKey}`,
    name: 'PBK Approval Handoff',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [520, 300],
    notesInFlow: true,
    notes: [
      `PBK workflow draft: ${draft.name || 'Command Center draft'}`,
      `Trigger: ${draft.settings?.triggerType || draft.triggerType || 'unspecified'}`,
      `Table/Event: ${table} / ${event}`,
      filter ? `Filter: ${filter}` : 'Filter: none',
      'Next production step: replace this no-op with the live PBK bridge action after approval.',
    ].join('\n'),
  };

  return {
    nodes: [triggerNode, actionNode],
    connections: {
      [triggerNode.name]: {
        main: [[{ node: actionNode.name, type: 'main', index: 0 }]],
      },
    },
  };
}

async function n8nApiRequest(method, pathname, body = null) {
  const meta = getN8nWorkflowProviderMeta();
  if (!meta.ready) {
    return {
      ok: false,
      configured: meta.configured,
      missing: meta.missing,
      error: `n8n workflow API is not configured (${meta.missing.join(', ') || 'missing credentials'}).`,
    };
  }
  const response = await fetch(`${N8N_API_BASE_URL}/api/v1/${String(pathname || '').replace(/^\/+/g, '')}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': N8N_API_KEY,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text().catch(() => '');
  const payload = text ? safeJsonParse(text, { raw: text }) : {};
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.message || payload?.error || `n8n API request failed with ${response.status}.`,
      payload,
    };
  }
  return { ok: true, status: response.status, payload };
}

async function listWorkflowPersistence() {
  const drafts = await loadWorkflowDrafts();
  const meta = getN8nWorkflowProviderMeta();
  if (!meta.ready) {
    return {
      ok: true,
      provider: 'local-draft-store',
      configured: false,
      workflows: drafts,
      drafts,
      n8n: meta,
    };
  }
  const apiResult = await n8nApiRequest('GET', 'workflows');
  return {
    ok: apiResult.ok,
    provider: apiResult.ok ? 'n8n-api' : 'local-draft-store',
    configured: true,
    workflows: apiResult.ok ? (apiResult.payload?.data || apiResult.payload || []) : drafts,
    drafts,
    n8n: meta,
    sync: apiResult,
  };
}

async function saveWorkflowPersistence(params = {}) {
  const draft = normalizeWorkflowDraft(params);
  const drafts = await loadWorkflowDrafts();
  const existingIndex = drafts.findIndex((item) => item.id === draft.id);
  if (existingIndex >= 0) {
    drafts.splice(existingIndex, 1, { ...drafts[existingIndex], ...draft });
  } else {
    drafts.unshift(draft);
  }
  await saveWorkflowDrafts(drafts.slice(0, 80));

  let sync = null;
  if (params.syncToN8n || params.applyToN8n) {
    const method = draft.id && !String(draft.id).startsWith('workflow-') ? 'PUT' : 'POST';
    const pathname = method === 'PUT' ? `workflows/${encodeURIComponent(draft.id)}` : 'workflows';
    const workflowPayload = materializeN8nWorkflow(draft);
    sync = await n8nApiRequest(method, pathname, {
      name: draft.name,
      nodes: workflowPayload.nodes,
      connections: workflowPayload.connections,
      settings: draft.settings,
      active: draft.active,
    });
  }

  return {
    ok: true,
    provider: sync?.ok ? 'n8n-api' : 'local-draft-store',
    draft,
    drafts: drafts.slice(0, 80),
    sync,
  };
}

function getN8nWorkflowIdFromDraft(draft = {}, params = {}) {
  return String(
    params.n8nWorkflowId
      || params.workflowId
      || draft.n8nWorkflowId
      || draft.metadata?.n8nWorkflowId
      || draft.metadata?.workflowId
      || '',
  ).trim();
}

async function publishWorkflowPersistence(params = {}) {
  const draft = normalizeWorkflowDraft(params);
  const drafts = await loadWorkflowDrafts();
  const existingDraftIndex = drafts.findIndex((item) => item.id === draft.id);
  const previousDraft = existingDraftIndex >= 0 ? drafts[existingDraftIndex] : null;
  const existingN8nId = getN8nWorkflowIdFromDraft(draft, params) || getN8nWorkflowIdFromDraft(previousDraft || {}, {});
  const shouldActivate = params.activate ?? params.active ?? draft.active ?? true;
  let sync = null;
  let activation = null;
  let verification = null;

  const meta = getN8nWorkflowProviderMeta();
  if (!meta.ready) {
    sync = {
      ok: false,
      configured: meta.configured,
      missing: meta.missing,
      error: `n8n workflow API is not configured (${meta.missing.join(', ') || 'missing credentials'}).`,
    };
  } else {
    const method = existingN8nId ? 'PUT' : 'POST';
    const pathname = existingN8nId ? `workflows/${encodeURIComponent(existingN8nId)}` : 'workflows';
    const workflowPayload = materializeN8nWorkflow(draft);
    verification = {
      ok: Array.isArray(workflowPayload.nodes) && workflowPayload.nodes.length >= 2 && Boolean(workflowPayload.connections),
      checkedAt: isoNow(),
      checks: {
        hasNodes: Array.isArray(workflowPayload.nodes) && workflowPayload.nodes.length >= 2,
        hasTrigger: workflowPayload.nodes.some((node) => /trigger/i.test(String(node.type || node.name || ''))),
        hasHandoff: workflowPayload.nodes.some((node) => /PBK Approval Handoff/i.test(String(node.name || ''))),
        hasConnections: Boolean(workflowPayload.connections && Object.keys(workflowPayload.connections).length),
      },
    };
    verification.ok = Object.values(verification.checks).every(Boolean);
    if (!verification.ok && params.forcePublish !== true) {
      sync = {
        ok: false,
        configured: true,
        error: 'Workflow failed PBK sandbox verification. Add a trigger, handoff node, and connection before publishing.',
        verification,
      };
    } else {
    sync = await n8nApiRequest(method, pathname, {
      name: draft.name,
      nodes: workflowPayload.nodes,
      connections: workflowPayload.connections,
      settings: draft.settings,
      active: false,
    });
    const workflowId = String(
      sync.payload?.id
        || sync.payload?.data?.id
        || sync.payload?.workflow?.id
        || existingN8nId
        || '',
    ).trim();

    if (sync.ok && workflowId && shouldActivate) {
      activation = await n8nApiRequest('POST', `workflows/${encodeURIComponent(workflowId)}/activate`);
    }

    if (sync.ok && workflowId) {
      const fetched = await n8nApiRequest('GET', `workflows/${encodeURIComponent(workflowId)}`);
      verification = {
        ...(verification || {}),
        ok: Boolean(verification?.ok && fetched.ok),
        checkedAt: isoNow(),
        workflowId,
        fetched: {
          ok: fetched.ok,
          status: fetched.status,
          active: Boolean(fetched.payload?.active ?? fetched.payload?.data?.active ?? draft.active),
          nodeCount: Number((fetched.payload?.nodes || fetched.payload?.data?.nodes || []).length || 0),
        },
      };
    }

    if (workflowId) {
      draft.metadata = {
        ...(draft.metadata || {}),
        n8nWorkflowId: workflowId,
        n8nPublishedAt: isoNow(),
        n8nActivationStatus: activation ? (activation.ok ? 'active' : 'activation-failed') : 'draft',
      };
      draft.n8nWorkflowId = workflowId;
      draft.active = Boolean(shouldActivate && (activation?.ok || !activation));
    }
    }
  }

  if (existingDraftIndex >= 0) {
    drafts.splice(existingDraftIndex, 1, { ...drafts[existingDraftIndex], ...draft });
  } else {
    drafts.unshift(draft);
  }
  await saveWorkflowDrafts(drafts.slice(0, 80));

  return {
    ok: Boolean(sync?.ok),
    provider: sync?.ok ? 'n8n-api' : 'local-draft-store',
    draft,
    drafts: drafts.slice(0, 80),
    sync,
    activation,
    verification,
  };
}

function ensureRuntimeSettings(stateRef = state) {
  if (!stateRef.settings || typeof stateRef.settings !== 'object') {
    stateRef.settings = {};
  }
  if (!stateRef.settings.ui || typeof stateRef.settings.ui !== 'object') {
    stateRef.settings.ui = {};
  }
  if (!stateRef.settings.updatedAt) {
    stateRef.settings.updatedAt = isoNow();
  }
  return stateRef.settings;
}

function normalizeSettingsPatch(params = {}) {
  const patch = {};
  const source = params.settings && typeof params.settings === 'object'
    ? params.settings
    : params.patch && typeof params.patch === 'object'
      ? params.patch
      : params;
  if (source.ui && typeof source.ui === 'object') {
    patch.ui = source.ui;
  }
  if (source.key) {
    patch.ui = {
      ...(patch.ui || {}),
      [String(source.key)]: source.value,
    };
  }
  for (const [key, value] of Object.entries(source || {})) {
    if (['settings', 'patch', 'key', 'value', 'actor', 'updatedBy'].includes(key)) continue;
    if (key === 'ui') continue;
    patch[key] = value;
  }
  return patch;
}

const OPERATING_MODE_GATED_TOOLS = new Set([
  'sendColdEmail',
  'telnyx_call',
  'telnyx_sms',
  'sendDocuSign',
  'sendContract',
  'sendSellerDocs',
  'skipTrace',
  'bootstrapStreakPipeline',
  'admin_restart_openclaw',
  'admin_run_away_worker',
  'admin_update_env_var',
]);

function getRuntimeOperatingMode() {
  const settings = ensureRuntimeSettings(state);
  const mode = String(settings.ui?.operatingMode || settings.operatingMode || state.status?.mode || 'approval').toLowerCase();
  return ['autopilot', 'approval', 'manual'].includes(mode) ? mode : 'approval';
}

async function enforceOperatingModeForTool(toolName, params = {}) {
  if (!OPERATING_MODE_GATED_TOOLS.has(toolName)) return null;
  const mode = getRuntimeOperatingMode();
  if (mode === 'autopilot') return null;

  const label = toolName.replace(/_/g, ' ');
  if (mode === 'manual') {
    const event = makeActivity({
      category: 'Guardrail',
      actor: 'PBK bridge',
      text: `Blocked ${label} because Manual mode is active.`,
      target: params.leadName || params.phone || params.email || params.address || 'provider action',
      status: 'blocked',
    }, 'runtime');
    addActivity(state, event);
    await persistState(state);
    return {
      ok: false,
      result: 'unavailable',
      outcome: 'unavailable',
      mode,
      toolName,
      message: `Manual mode blocks ${label}. Switch to Approval or Autopilot to continue.`,
    };
  }

  let paramPreview = '';
  try {
    paramPreview = JSON.stringify(params || {});
  } catch {
    paramPreview = '[unserializable params]';
  }

  const approval = await toolHandlers.createApproval({
    type: 'provider-action',
    leadName: params.leadName || params.name || params.sellerName || label,
    address: params.address || params.propertyAddress || params.target || '',
    phone: params.phone || params.to || '',
    email: params.email || '',
    notes: `Approval mode intercepted ${label}. Original params: ${paramPreview.slice(0, 900)}`,
    source: 'operating-mode-guard',
  });
  return {
    ok: true,
    result: 'queued_for_approval',
    outcome: 'queued_for_approval',
    mode,
    toolName,
    approval,
    message: `${label} was queued because Approval mode is active.`,
  };
}

function getRangeStart(range = '30d') {
  const normalized = String(range || '30d').trim().toLowerCase();
  const now = new Date();
  if (normalized === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = normalized === '7d' ? 7 : normalized === '90d' ? 90 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function getRecordTimestamp(item = {}) {
  const raw = item.createdAt
    || item.updatedAt
    || item.sentAt
    || item.startTime
    || item.completedAt
    || item.timestamp
    || item.date
    || '';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function filterByAnalyticsRange(items = [], range = '30d') {
  const startMs = getRangeStart(range).getTime();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const ms = getRecordTimestamp(item);
    return ms && ms >= startMs;
  });
}

function average(values = []) {
  const numeric = values.map((value) => toNumber(value, Number.NaN)).filter((value) => Number.isFinite(value));
  if (!numeric.length) return 0;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function buildAnalyticsSnapshot(range = '30d') {
  const normalizedRange = String(range || '30d').trim().toLowerCase();
  const leadImports = filterByAnalyticsRange(state.leadImports, normalizedRange);
  const calls = filterByAnalyticsRange(state.calls, normalizedRange);
  const messages = filterByAnalyticsRange(state.messages, normalizedRange);
  const approvals = filterByAnalyticsRange(state.approvals, normalizedRange);
  const contracts = filterByAnalyticsRange(state.contracts, normalizedRange);
  const transitions = filterByAnalyticsRange(state.leadStageTransitions, normalizedRange);
  const analyzerRuns = filterByAnalyticsRange(state.analyzerRuns, normalizedRange);
  const appointments = filterByAnalyticsRange(state.appointments, normalizedRange);
  const warmTransitions = transitions.filter((item) => /warm|negotiat|appointment|contract|closed|won/i.test(String(item.toStage || item.stage || item.status || '')));
  const completedContracts = contracts.filter((item) => /complete|signed|closed|won/i.test(String(item.status || '')));
  const avgOffer = average(analyzerRuns.map((run) => run.offer || run.targetOffer || run.mao || run.analysis?.targetOffer || run.analysis?.mao));
  const rows = [
    ['Range', normalizedRange],
    ['Lead imports', leadImports.length],
    ['Calls', calls.length],
    ['Messages', messages.length],
    ['Approvals', approvals.length],
    ['Appointments', appointments.length],
    ['Warm transitions', warmTransitions.length],
    ['Contracts', contracts.length],
    ['Completed contracts', completedContracts.length],
    ['Average offer', Math.round(avgOffer)],
  ];
  return {
    ok: true,
    range: normalizedRange,
    generatedAt: isoNow(),
    source: STATE_BACKEND === 'postgres' ? 'supabase-bridge-state' : 'local-bridge-state',
    summary: {
      leadImports: leadImports.length,
      calls: calls.length,
      messages: messages.length,
      approvals: approvals.length,
      appointments: appointments.length,
      warmTransitions: warmTransitions.length,
      contracts: contracts.length,
      completedContracts: completedContracts.length,
      averageOffer: Math.round(avgOffer),
      conversionRate: leadImports.length ? Number(((warmTransitions.length / leadImports.length) * 100).toFixed(1)) : 0,
      contractCloseRate: contracts.length ? Number(((completedContracts.length / contracts.length) * 100).toFixed(1)) : 0,
    },
    rows,
  };
}

function getCampaignLeadKey(lead = {}) {
  return String(lead.leadId || lead.id || lead.email || lead.phone || lead.address || lead.leadName || '')
    .trim()
    .toLowerCase();
}

function findLeadImportForCampaignLead(campaignLead = {}) {
  const leadKey = getCampaignLeadKey(campaignLead);
  return (state.leadImports || []).find((lead) => {
    const normalized = normalizeCampaignLead(lead);
    return leadKey && getCampaignLeadKey(normalized) === leadKey;
  }) || null;
}

function getLeadSourceLabel(lead = {}, fallback = 'unknown') {
  const source = lead.source
    || lead.leadSource
    || lead.metadata?.source
    || lead.payload?.source
    || lead.seller?.source
    || lead.property?.source
    || lead.importSource
    || '';
  if (source) return compactSearchText(source).toLowerCase();
  const tags = normalizeStringList(lead.tags || []);
  if (tags.some((tag) => /probate|estate|executor/i.test(tag))) return 'probate';
  if (tags.some((tag) => /absentee|landlord/i.test(tag))) return 'absentee';
  return fallback;
}

function summarizeCampaignLeadEvents(campaign = {}, campaignLead = {}, range = '30d') {
  const events = filterByAnalyticsRange(getCampaignEvents(campaign.id), range).filter((event) => {
    const eventLeadKey = getCampaignLeadKey({
      leadId: event.leadId || event.payload?.leadId || '',
      id: event.campaignLeadId || '',
      email: event.payload?.email || '',
      phone: event.payload?.phone || '',
      address: event.payload?.address || '',
      leadName: event.payload?.leadName || '',
    });
    return (event.campaignLeadId && event.campaignLeadId === campaignLead.id)
      || (event.leadId && campaignLead.leadId && event.leadId === campaignLead.leadId)
      || (eventLeadKey && eventLeadKey === getCampaignLeadKey(campaignLead));
  });
  const has = (pattern) => events.some((event) => pattern.test([
    event.eventType,
    event.status,
    event.providerStatus,
    event.payload?.status,
  ].filter(Boolean).join(' ').toLowerCase()));
  return {
    events,
    sent: has(/sent|scheduled|delivered|attempted|dialed/),
    opened: has(/open/),
    replied: has(/reply|responded|interested/),
    connected: has(/connected|answered|live_answer/),
    dnc: has(/dnc|unsubscribe|\bstop\b|opt_out/),
    lastEvent: events[0] || null,
  };
}

function buildCampaignAnalyticsDrilldown(searchParams = new URLSearchParams()) {
  ensureCampaignCollections();
  const range = String(searchParams.get('range') || '30d').trim().toLowerCase();
  const campaignId = String(searchParams.get('campaignId') || searchParams.get('campaign') || 'all').trim();
  const source = String(searchParams.get('source') || 'all').trim().toLowerCase();
  const channelRaw = String(searchParams.get('channel') || 'all').trim().toLowerCase();
  const statusRaw = String(searchParams.get('status') || 'all').trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 120)));
  const campaigns = queryCampaignRecords(new URLSearchParams({
    channel: channelRaw,
    status: statusRaw,
  })).filter((campaign) => campaignId === 'all' || campaign.id === campaignId);
  const campaignIds = new Set(campaigns.map((campaign) => campaign.id));
  const rows = [];
  for (const lead of state.campaignLeads || []) {
    if (!campaignIds.has(lead.campaignId)) continue;
    const campaign = campaigns.find((item) => item.id === lead.campaignId);
    if (!campaign) continue;
    const importedLead = findLeadImportForCampaignLead(lead);
    const leadSource = getLeadSourceLabel(importedLead || lead, campaign.leadSource || 'campaign');
    if (source !== 'all' && leadSource !== source) continue;
    const eventSummary = summarizeCampaignLeadEvents(campaign, lead, range);
    rows.push({
      id: lead.id,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: normalizeCampaignStatus(campaign.status),
      channel: normalizeCampaignChannel(campaign.channel),
      provider: campaign.provider || getCampaignProvider(campaign.channel),
      leadId: lead.leadId || importedLead?.leadId || importedLead?.id || '',
      leadName: lead.leadName || importedLead?.leadName || importedLead?.seller?.name || 'Unknown seller',
      address: lead.address || importedLead?.address || importedLead?.property?.address || '',
      source: leadSource,
      email: lead.email || importedLead?.email || importedLead?.seller?.email || '',
      phone: lead.phone || importedLead?.phone || importedLead?.seller?.phone || '',
      leadStatus: lead.status || importedLead?.status || 'pending',
      tags: Array.from(new Set([
        ...normalizeStringList(lead.tags || []),
        ...normalizeStringList(importedLead?.tags || []),
      ])).slice(0, 8),
      events: eventSummary.events.length,
      sent: eventSummary.sent,
      opened: eventSummary.opened,
      replied: eventSummary.replied,
      connected: eventSummary.connected,
      dnc: eventSummary.dnc,
      lastEventType: eventSummary.lastEvent?.eventType || '',
      lastEventAt: eventSummary.lastEvent?.occurredAt || eventSummary.lastEvent?.createdAt || lead.updatedAt || '',
      updatedAt: eventSummary.lastEvent?.occurredAt || eventSummary.lastEvent?.createdAt || lead.updatedAt || lead.createdAt || '',
      routeContext: `campaign:${campaign.id}:lead:${lead.id}`,
    });
  }
  const sortedRows = sortNewest(rows, 'lastEventAt').slice(0, limit);
  const sourceOptions = Array.from(new Set(rows.map((row) => row.source).filter(Boolean))).sort();
  const rowCost = rows.reduce((sum, row) => {
    if (row.channel === 'email') return sum + (5 * 0.002);
    if (row.channel === 'sms') return sum + (3 * 0.007);
    if (row.channel === 'call') return sum + 0.014;
    return sum + 0.01;
  }, 0);
  return {
    ok: true,
    result: 'live',
    range,
    generatedAt: isoNow(),
    source: STATE_BACKEND === 'postgres' ? 'supabase-bridge-state' : 'local-bridge-state',
    filters: { campaignId, source, channel: channelRaw, status: statusRaw, limit },
    summary: {
      campaigns: campaigns.length,
      leads: rows.length,
      sent: rows.filter((row) => row.sent).length,
      opened: rows.filter((row) => row.opened).length,
      replied: rows.filter((row) => row.replied).length,
      connected: rows.filter((row) => row.connected).length,
      dnc: rows.filter((row) => row.dnc).length,
      estimatedCost: Number(rowCost.toFixed(2)),
      replyRate: rows.length ? Number(((rows.filter((row) => row.replied).length / rows.length) * 100).toFixed(1)) : 0,
      connectRate: rows.length ? Number(((rows.filter((row) => row.connected).length / rows.length) * 100).toFixed(1)) : 0,
    },
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      channel: normalizeCampaignChannel(campaign.channel),
      status: normalizeCampaignStatus(campaign.status),
      provider: campaign.provider || getCampaignProvider(campaign.channel),
      leadCount: getCampaignLeads(campaign.id).length || campaign.leadCount || 0,
    })),
    sources: sourceOptions,
    rows: sortedRows,
  };
}

function ensureRexCollections() {
  if (!Array.isArray(state.rexDecisions)) state.rexDecisions = [];
}

function ensureAgentFleetCollections() {
  if (!Array.isArray(state.agents)) state.agents = buildDefaultAgentFleet();
  if (!Array.isArray(state.agentSkillTransfers)) state.agentSkillTransfers = [];
  if (!Array.isArray(state.agentSkillExperiments)) state.agentSkillExperiments = [];
}

function normalizeRexTool(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['adjust_lead_weight', 'adjust_lead_weights', 'adjust_lead_scoring', 'lead_scoring_weights', 'update_lead_scoring_weights'].includes(raw)) return 'adjust_lead_weight';
  if (['update_campaign_script', 'campaign_script', 'update_script', 'edit_campaign_script'].includes(raw)) return 'update_campaign_script';
  if (['change_follow_up_delay', 'update_campaign_sequence', 'campaign_sequence', 'sequence_delay', 'update_sequence'].includes(raw)) return 'change_follow_up_delay';
  if (['pause_campaign', 'campaign_pause'].includes(raw)) return 'pause_campaign';
  if (['agent_pause', 'pause_agent'].includes(raw)) return 'agent_pause';
  if (['agent_configure', 'configure_agent', 'update_agent_config'].includes(raw)) return 'agent_configure';
  if (['agent_takeover', 'takeover_agent', 'take_over_agent'].includes(raw)) return 'agent_takeover';
  if (['agent_mute', 'mute_agent'].includes(raw)) return 'agent_mute';
  if (['agent_end_call', 'end_agent_call'].includes(raw)) return 'agent_end_call';
  if (['deploy_agent', 'create_agent', 'new_agent'].includes(raw)) return 'deploy_agent';
  if (['transfer_skill', 'pass_skill', 'agent_skill_transfer'].includes(raw)) return 'transfer_skill';
  if (['promote_skill', 'agent_skill_promote'].includes(raw)) return 'promote_skill';
  if (['ab_test_skill', 'a_b_test_skill', 'agent_skill_ab_test'].includes(raw)) return 'ab_test_skill';
  return raw || 'unknown';
}

function getLeadScoringWeights() {
  const settings = ensureRuntimeSettings(state);
  const weights = settings.leadScoring?.weights || settings.leadScoringWeights || {};
  return weights && typeof weights === 'object' ? weights : {};
}

function normalizeLeadScoringWeights(input = {}) {
  const source = input.weights && typeof input.weights === 'object' ? input.weights : input;
  const skip = new Set(['actor', 'reason', 'rationale', 'metadata', 'requestApproval', 'baseline', 'decisionId']);
  return Object.fromEntries(Object.entries(source || {})
    .filter(([key, value]) => key && !skip.has(key) && Number.isFinite(Number(value)))
    .map(([key, value]) => [String(key).trim().toLowerCase().replace(/\s+/g, '_'), Number(Number(value).toFixed(3))]));
}

function buildRexDecisionBaseline(tool = '', params = {}) {
  const campaignId = String(params.campaignId || params.campaign_id || params.id || '').trim();
  const campaign = campaignId ? (state.campaigns || []).find((item) => item.id === campaignId) : null;
  if (!campaign) {
    return {
      capturedAt: isoNow(),
      leadScoringWeights: getLeadScoringWeights(),
    };
  }
  const metrics = calculateCampaignMetrics(campaign);
  const leads = getCampaignLeads(campaign.id);
  return {
    capturedAt: isoNow(),
    campaignId: campaign.id,
    campaignName: campaign.name,
    status: campaign.status,
    channel: normalizeCampaignChannel(campaign.channel),
    leadCount: leads.length || campaign.leadCount || 0,
    metrics,
    replyRate: metrics.leads ? Number(((metrics.replied / metrics.leads) * 100).toFixed(2)) : 0,
    connectRate: metrics.leads ? Number(((metrics.connected / metrics.leads) * 100).toFixed(2)) : 0,
    tool,
  };
}

function summarizeRexDecisionTarget(tool = '', params = {}) {
  const campaignId = String(params.campaignId || params.campaign_id || params.id || '').trim();
  const campaign = campaignId ? (state.campaigns || []).find((item) => item.id === campaignId) : null;
  if (campaign) {
    return {
      targetType: 'campaign',
      targetId: campaign.id,
      targetLabel: campaign.name || campaign.id,
    };
  }
  if (tool === 'adjust_lead_weight') {
    return {
      targetType: 'lead_scoring',
      targetId: 'lead_scoring_weights',
      targetLabel: 'Lead scoring weights',
    };
  }
  if (String(tool || '').startsWith('agent_') || ['deploy_agent', 'transfer_skill', 'promote_skill', 'ab_test_skill'].includes(tool)) {
    return {
      targetType: 'agent_fleet',
      targetId: params.agentId || params.sourceAgentId || params.name || '',
      targetLabel: params.agentName || params.sourceAgentName || params.name || 'Agent Fleet',
    };
  }
  return {
    targetType: 'pbk_runtime',
    targetId: '',
    targetLabel: 'PBK runtime',
  };
}

async function updateLeadScoringWeights(params = {}, options = {}) {
  const incoming = normalizeLeadScoringWeights(params);
  if (!Object.keys(incoming).length) {
    return {
      ok: false,
      result: 'unavailable',
      verbiage: 'Lead scoring weights unchanged',
      error: 'At least one numeric lead-scoring weight is required.',
    };
  }
  const actor = options.actor || params.actor || 'Rex Strategist';
  const settings = ensureRuntimeSettings(state);
  const previous = getLeadScoringWeights();
  const nextWeights = {
    ...previous,
    ...incoming,
  };
  state.settings = {
    ...settings,
    leadScoring: {
      ...(settings.leadScoring || {}),
      weights: nextWeights,
      updatedAt: isoNow(),
      updatedBy: actor,
      reason: params.reason || params.rationale || options.rationale || '',
    },
    updatedAt: isoNow(),
    updatedBy: actor,
  };
  await persistAgentConfigRecord('lead_scoring_weights', state.settings.leadScoring, actor);
  addActivity(state, makeActivity({
    actor,
    category: 'REX',
    status: 'saved',
    text: `Updated lead scoring weights: ${Object.keys(incoming).join(', ')}`,
    target: 'lead_scoring_weights',
  }));
  await persistState(state);
  return {
    ok: true,
    result: 'live',
    verbiage: 'Lead scoring weights updated',
    previous,
    weights: nextWeights,
    changed: incoming,
  };
}

async function updateCampaignScript(campaignId = '', params = {}, options = {}) {
  ensureCampaignCollections();
  const campaign = (state.campaigns || []).find((item) => item.id === campaignId);
  if (!campaign) {
    return { ok: false, result: 'unavailable', verbiage: 'Campaign not found', error: `Campaign ${campaignId} was not found.` };
  }
  const actor = options.actor || params.actor || 'Rex Strategist';
  const script = String(params.script || params.body || params.copy || params.message || '').trim();
  const subject = String(params.subject || params.emailSubject || '').trim();
  if (!script && !subject) {
    return { ok: false, result: 'unavailable', verbiage: 'Campaign script unchanged', error: 'Script body or subject is required.' };
  }
  const sequence = {
    ...(campaign.sequence || {}),
    ...(params.sequence && typeof params.sequence === 'object' ? params.sequence : {}),
    script: script || campaign.sequence?.script || '',
    subject: subject || campaign.sequence?.subject || '',
    updatedBy: actor,
    updatedAt: isoNow(),
    rationale: params.rationale || options.rationale || '',
  };
  const nextCampaign = {
    ...campaign,
    sequence,
    pendingAction: '',
    updatedAt: isoNow(),
  };
  upsertById(state, 'campaigns', nextCampaign);
  await persistCampaignRecord(nextCampaign);
  recordCampaignEvent({
    campaignId,
    eventType: 'script_updated',
    channel: campaign.channel,
    provider: campaign.provider || getCampaignProvider(campaign.channel),
    providerStatus: 'bridge_state_updated',
    payload: { subject, scriptPreview: script.slice(0, 180), actor },
  });
  addActivity(state, makeActivity({
    actor,
    category: 'REX',
    status: 'saved',
    text: `Updated campaign script for ${campaign.name}.`,
    target: campaign.name,
  }));
  await persistState(state);
  return {
    ok: true,
    result: 'live',
    verbiage: 'Campaign script updated',
    campaign: nextCampaign,
  };
}

async function updateCampaignSequence(campaignId = '', params = {}, options = {}) {
  ensureCampaignCollections();
  const campaign = (state.campaigns || []).find((item) => item.id === campaignId);
  if (!campaign) {
    return { ok: false, result: 'unavailable', verbiage: 'Campaign not found', error: `Campaign ${campaignId} was not found.` };
  }
  const actor = options.actor || params.actor || 'Rex Strategist';
  const currentSequence = campaign.sequence || {};
  const delayHours = params.delayHours ?? params.delay_hours ?? params.followUpDelayHours ?? params.follow_up_delay_hours;
  const sequencePatch = params.sequence && typeof params.sequence === 'object' ? params.sequence : {};
  let steps = Array.isArray(sequencePatch.steps)
    ? sequencePatch.steps
    : Array.isArray(currentSequence.steps)
      ? [...currentSequence.steps]
      : [];
  if (delayHours !== undefined) {
    if (!steps.length) {
      steps = [{ step: 1, delayHours: Number(delayHours) }];
    } else {
      const stepId = params.stepId || params.step || params.index || 1;
      steps = steps.map((step, index) => {
        const isMatch = String(step.id || step.step || index + 1) === String(stepId);
        return isMatch ? { ...step, delayHours: Number(delayHours) } : step;
      });
    }
  }
  const nextSequence = {
    ...currentSequence,
    ...sequencePatch,
    ...(steps.length ? { steps } : {}),
    ...(delayHours !== undefined ? { delayHours: Number(delayHours) } : {}),
    updatedBy: actor,
    updatedAt: isoNow(),
    rationale: params.rationale || options.rationale || '',
  };
  const nextCampaign = {
    ...campaign,
    sequence: nextSequence,
    updatedAt: isoNow(),
  };
  upsertById(state, 'campaigns', nextCampaign);
  await persistCampaignRecord(nextCampaign);
  recordCampaignEvent({
    campaignId,
    eventType: 'sequence_updated',
    channel: campaign.channel,
    provider: campaign.provider || getCampaignProvider(campaign.channel),
    providerStatus: 'bridge_state_updated',
    payload: { delayHours, actor, sequenceKeys: Object.keys(sequencePatch) },
  });
  addActivity(state, makeActivity({
    actor,
    category: 'REX',
    status: 'saved',
    text: `Updated campaign sequence for ${campaign.name}.`,
    target: campaign.name,
  }));
  await persistState(state);
  return {
    ok: true,
    result: 'live',
    verbiage: 'Campaign sequence updated',
    campaign: nextCampaign,
  };
}

async function pauseCampaignFromRex(campaignId = '', params = {}, options = {}) {
  const patch = await patchCampaignRecord(campaignId, {
    status: 'paused',
    pendingAction: '',
    approvalStatus: 'approved',
    notes: params.reason || params.rationale || 'Paused by Rex Strategist after approval.',
    actor: options.actor || params.actor || 'Rex Strategist',
  });
  return {
    ...patch,
    verbiage: patch.ok ? 'Campaign paused' : patch.verbiage,
  };
}

function normalizeAgentId(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function findAgentRecord(agentId = '') {
  ensureAgentFleetCollections();
  const normalized = normalizeAgentId(agentId);
  return state.agents.find((agent) => normalizeAgentId(agent.id) === normalized || normalizeAgentId(agent.name) === normalized);
}

async function applyAgentRuntimeAction(tool = '', params = {}, options = {}) {
  ensureAgentFleetCollections();
  const actor = options.actor || params.actor || 'Rex Strategist';
  const agentId = params.agentId || params.sourceAgentId || params.id || params.name || '';
  const agent = findAgentRecord(agentId);
  if (!agent) {
    return { ok: false, result: 'unavailable', verbiage: 'Agent not found', error: `Agent ${agentId || 'unknown'} was not found.` };
  }
  const now = isoNow();
  const actionLabel = tool.replace(/^agent_/, '').replace(/_/g, ' ');
  const statusMap = {
    agent_pause: 'paused',
    agent_configure: 'configuring',
    agent_takeover: 'human_takeover',
    agent_mute: 'muted',
    agent_end_call: 'idle',
  };
  const nextAgent = {
    ...agent,
    status: statusMap[tool] || agent.status || 'idle',
    activity: params.activity || `${actionLabel} applied by ${actor}`,
    lastSeen: now,
    updatedAt: now,
    updatedBy: actor,
    config: {
      ...(agent.config || {}),
      ...(params.config && typeof params.config === 'object' ? params.config : {}),
      lastAction: tool,
      lastRationale: params.rationale || options.rationale || '',
    },
  };
  upsertById(state, 'agents', nextAgent);
  addActivity(state, makeActivity({
    actor,
    category: 'AGENT_FLEET',
    status: 'success',
    text: `${nextAgent.name} ${actionLabel} applied.`,
    target: nextAgent.name,
  }));
  await persistState(state);
  return {
    ok: true,
    result: 'live',
    verbiage: `Agent ${actionLabel} applied`,
    agent: nextAgent,
  };
}

async function deployAgentFromRex(params = {}, options = {}) {
  ensureAgentFleetCollections();
  const actor = options.actor || params.actor || 'Rex Strategist';
  const name = String(params.name || params.agentName || '').trim();
  if (!name) {
    return { ok: false, result: 'unavailable', verbiage: 'Agent name required', error: 'A new agent needs a name before deployment can be staged.' };
  }
  const id = normalizeAgentId(params.id || name);
  const existing = findAgentRecord(id);
  const now = isoNow();
  const nextAgent = {
    ...(existing || {}),
    id,
    name,
    avatar: String(name[0] || 'A').toUpperCase(),
    role: params.role || existing?.role || 'Acquisitions',
    version: existing?.version || 'v0.1',
    target: params.target || existing?.target || 'local',
    status: 'building',
    activity: `Deployment staged from ${params.base || 'approved blueprint'}`,
    lastSeen: now,
    style: params.style || existing?.style || 'Empathetic',
    hometown: params.hometown || existing?.hometown || '',
    campaigns: existing?.campaigns || 0,
    sentiment: existing?.sentiment || 50,
    skillsTotal: existing?.skillsTotal || 0,
    skillSource: params.base || existing?.skillSource || 'New agent blueprint',
    skills: Array.isArray(existing?.skills) ? existing.skills : [],
    backstory: params.story || existing?.backstory || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: actor,
  };
  upsertById(state, 'agents', nextAgent);
  addActivity(state, makeActivity({
    actor,
    category: 'AGENT_FLEET',
    status: 'queued',
    text: `Staged new agent ${nextAgent.name}.`,
    target: nextAgent.name,
  }));
  await persistState(state);
  return {
    ok: true,
    result: 'live',
    verbiage: 'Agent deployment staged',
    agent: nextAgent,
  };
}

function findAgentSkill(agent = {}, skillName = '') {
  const normalized = String(skillName || '').trim().toLowerCase();
  return (agent.skills || []).find((skill) => String(skill.name || '').trim().toLowerCase() === normalized);
}

async function applyAgentSkillAction(tool = '', params = {}, options = {}) {
  ensureAgentFleetCollections();
  const actor = options.actor || params.actor || 'Rex Strategist';
  const source = findAgentRecord(params.sourceAgentId || params.agentId || params.id || '');
  if (!source) {
    return { ok: false, result: 'unavailable', verbiage: 'Source agent not found', error: 'PBK could not find the source agent for that skill.' };
  }
  const skillName = String(params.skill || params.skillName || '').trim();
  if (!skillName) {
    return { ok: false, result: 'unavailable', verbiage: 'Skill missing', error: 'A skill name is required.' };
  }
  const now = isoNow();
  const existingSkill = findAgentSkill(source, skillName) || {
    name: skillName,
    level: 'candidate',
    confidence: 50,
    evidence: 'Created from approved Agent Fleet action.',
  };

  if (tool === 'promote_skill') {
    const nextSkill = {
      ...existingSkill,
      level: 'proven',
      confidence: Math.max(Number(existingSkill.confidence || 0), 86),
      promotedAt: now,
      promotedBy: actor,
    };
    const nextSource = {
      ...source,
      skills: [...(source.skills || []).filter((skill) => skill.name !== existingSkill.name), nextSkill],
      skillsTotal: Math.max(Number(source.skillsTotal || 0), (source.skills || []).length),
      updatedAt: now,
      updatedBy: actor,
    };
    upsertById(state, 'agents', nextSource);
    addActivity(state, makeActivity({
      actor,
      category: 'AGENT_FLEET',
      status: 'success',
      text: `Promoted ${skillName} for ${source.name}.`,
      target: source.name,
    }));
    await persistState(state);
    return { ok: true, result: 'live', verbiage: 'Skill promoted', skill: nextSkill, agent: nextSource };
  }

  if (tool === 'transfer_skill') {
    const target = findAgentRecord(params.targetAgentId || params.targetAgentName || '')
      || state.agents.find((agent) => agent.id !== source.id && agent.status !== 'on_call')
      || source;
    const transferredSkill = {
      ...existingSkill,
      level: existingSkill.level === 'proven' ? 'evolving' : existingSkill.level,
      transferredFrom: source.id,
      transferredAt: now,
      confidence: Math.min(Number(existingSkill.confidence || 50), 82),
    };
    const nextTarget = {
      ...target,
      skills: [...(target.skills || []).filter((skill) => skill.name !== transferredSkill.name), transferredSkill],
      skillsTotal: Math.max(Number(target.skillsTotal || 0), (target.skills || []).length + 1),
      skillSource: `${target.skillSource || 'Agent Fleet'}, inherited from ${source.name}`,
      updatedAt: now,
      updatedBy: actor,
    };
    upsertById(state, 'agents', nextTarget);
    const transfer = {
      id: `skill-transfer-${Date.now()}-${randomUUID().slice(0, 8)}`,
      sourceAgentId: source.id,
      targetAgentId: target.id,
      skill: transferredSkill,
      status: 'transferred',
      actor,
      createdAt: now,
    };
    state.agentSkillTransfers.unshift(transfer);
    addActivity(state, makeActivity({
      actor,
      category: 'AGENT_FLEET',
      status: 'success',
      text: `Transferred ${skillName} from ${source.name} to ${target.name}.`,
      target: `${source.name} -> ${target.name}`,
    }));
    await persistState(state);
    return { ok: true, result: 'live', verbiage: 'Skill transferred', transfer, agent: nextTarget };
  }

  const experiment = {
    id: `skill-experiment-${Date.now()}-${randomUUID().slice(0, 8)}`,
    agentId: source.id,
    skill: existingSkill,
    status: 'staged',
    sample: params.sample || '5% sandbox traffic',
    actor,
    createdAt: now,
  };
  state.agentSkillExperiments.unshift(experiment);
  addActivity(state, makeActivity({
    actor,
    category: 'AGENT_FLEET',
    status: 'queued',
    text: `Staged A/B test for ${skillName}.`,
    target: source.name,
  }));
  await persistState(state);
  return { ok: true, result: 'live', verbiage: 'Skill A/B test staged', experiment };
}

async function applyRexDecision(decisionOrId = {}, options = {}) {
  ensureRexCollections();
  const decision = typeof decisionOrId === 'string'
    ? state.rexDecisions.find((item) => item.id === decisionOrId)
    : decisionOrId;
  if (!decision?.id) {
    return { ok: false, result: 'unavailable', verbiage: 'Rex decision not found', error: 'No Rex decision was found.' };
  }
  if (decision.status === 'applied' && decision.result?.ok) {
    return { ok: true, result: 'live', verbiage: 'Rex decision already applied', decision, replayed: true };
  }
  const actor = options.actor || decision.approvedBy || decision.proposedBy || 'Rex Strategist';
  const tool = normalizeRexTool(decision.tool);
  let result = null;
  if (tool === 'adjust_lead_weight') {
    result = await updateLeadScoringWeights(decision.params || {}, { actor, rationale: decision.rationale });
  } else if (tool === 'update_campaign_script') {
    result = await updateCampaignScript(decision.params?.campaignId || decision.targetId || '', decision.params || {}, { actor, rationale: decision.rationale });
  } else if (tool === 'change_follow_up_delay') {
    result = await updateCampaignSequence(decision.params?.campaignId || decision.targetId || '', decision.params || {}, { actor, rationale: decision.rationale });
  } else if (tool === 'pause_campaign') {
    result = await pauseCampaignFromRex(decision.params?.campaignId || decision.targetId || '', decision.params || {}, { actor, rationale: decision.rationale });
  } else if (['agent_pause', 'agent_configure', 'agent_takeover', 'agent_mute', 'agent_end_call'].includes(tool)) {
    result = await applyAgentRuntimeAction(tool, decision.params || {}, { actor, rationale: decision.rationale });
  } else if (tool === 'deploy_agent') {
    result = await deployAgentFromRex(decision.params || {}, { actor, rationale: decision.rationale });
  } else if (['transfer_skill', 'promote_skill', 'ab_test_skill'].includes(tool)) {
    result = await applyAgentSkillAction(tool, decision.params || {}, { actor, rationale: decision.rationale });
  } else {
    result = { ok: false, result: 'unavailable', verbiage: 'Rex tool unavailable', error: `Unsupported Rex tool: ${decision.tool}` };
  }
  const nextDecision = {
    ...decision,
    tool,
    status: result.ok ? 'applied' : 'failed',
    result,
    appliedAt: result.ok ? isoNow() : decision.appliedAt || null,
    appliedBy: actor,
    updatedAt: isoNow(),
  };
  upsertById(state, 'rexDecisions', nextDecision);
  await persistRexDecisionRecord(nextDecision);
  addActivity(state, makeActivity({
    actor,
    category: 'REX',
    status: result.ok ? 'success' : 'warning',
    text: result.ok ? `Applied Rex decision: ${tool}` : `Rex decision failed: ${tool}`,
    target: nextDecision.targetLabel || nextDecision.targetId || tool,
  }));
  await persistState(state);
  return {
    ok: result.ok,
    result: result.ok ? 'live' : result.result || 'unavailable',
    verbiage: result.verbiage || (result.ok ? 'Rex decision applied' : 'Rex decision failed'),
    decision: nextDecision,
    appliedResult: result,
  };
}

async function createRexDecision(payload = {}, options = {}) {
  ensureRexCollections();
  const tool = normalizeRexTool(payload.tool || payload.action);
  const params = payload.params && typeof payload.params === 'object' ? payload.params : {};
  const target = summarizeRexDecisionTarget(tool, params);
  const decision = {
    id: payload.id || `rex-decision-${slugify(tool)}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    source: payload.source || options.source || 'rex-strategist',
    tool,
    params,
    rationale: String(payload.rationale || payload.reason || '').trim(),
    status: payload.status || 'proposed',
    targetType: payload.targetType || target.targetType,
    targetId: payload.targetId || target.targetId,
    targetLabel: payload.targetLabel || target.targetLabel,
    baseline: payload.baseline && typeof payload.baseline === 'object'
      ? payload.baseline
      : buildRexDecisionBaseline(tool, params),
    outcome: payload.outcome && typeof payload.outcome === 'object' ? payload.outcome : {},
    result: payload.result && typeof payload.result === 'object' ? payload.result : {},
    success: typeof payload.success === 'boolean' ? payload.success : null,
    proposedBy: payload.proposedBy || payload.actor || options.actor || 'Rex Strategist',
    createdAt: payload.createdAt || isoNow(),
    updatedAt: isoNow(),
  };
  upsertById(state, 'rexDecisions', decision);
  await persistRexDecisionRecord(decision);
  let approvalResult = null;
  if (payload.requestApproval !== false && options.requestApproval !== false) {
    approvalResult = await toolHandlers.createApproval({
      type: 'rex-decision',
      leadName: 'Rex Strategist',
      address: decision.targetLabel || decision.targetId || 'PBK runtime',
      approvalAction: 'rex_apply',
      notes: decision.rationale || `Rex proposes ${tool}.`,
      metadata: {
        decisionId: decision.id,
        tool,
        params,
        rationale: decision.rationale,
        baseline: decision.baseline,
        statusMessage: `Rex proposes ${tool}`,
      },
    });
    decision.approvalId = approvalResult?.approval?.id || '';
    decision.status = approvalResult?.approval?.id ? 'queued_for_approval' : decision.status;
    decision.updatedAt = isoNow();
    upsertById(state, 'rexDecisions', decision);
    await persistRexDecisionRecord(decision);
  }
  addActivity(state, makeActivity({
    actor: decision.proposedBy,
    category: 'REX',
    status: decision.status === 'queued_for_approval' ? 'pending' : 'proposed',
    text: `Rex proposed ${tool}: ${decision.rationale || 'No rationale provided.'}`,
    target: decision.targetLabel || decision.targetId || tool,
  }));
  await persistState(state);
  return {
    ok: true,
    result: decision.status === 'queued_for_approval' ? 'queued_for_approval' : 'live',
    verbiage: decision.status === 'queued_for_approval' ? 'Rex proposal queued for approval' : 'Rex decision recorded',
    decision,
    approval: approvalResult?.approval || null,
    approvalResult,
  };
}

async function handleRexDecisionApproval(approval = {}, options = {}) {
  ensureRexCollections();
  const decisionId = approval.metadata?.decisionId || '';
  const decision = state.rexDecisions.find((item) => item.id === decisionId || item.approvalId === approval.id);
  if (!decision) {
    return { ok: false, result: 'unavailable', verbiage: 'Rex decision not found', error: 'Approved Rex decision could not be found.' };
  }
  if (String(approval.status || '').toLowerCase() !== 'approved') {
    const nextDecision = {
      ...decision,
      status: 'rejected',
      approvedBy: approval.actor || options.actor || '',
      updatedAt: isoNow(),
    };
    upsertById(state, 'rexDecisions', nextDecision);
    await persistRexDecisionRecord(nextDecision);
    return { ok: true, result: 'queued_for_approval', verbiage: 'Rex decision rejected', decision: nextDecision };
  }
  const approvedDecision = {
    ...decision,
    status: 'approved',
    approvedBy: approval.actor || options.actor || 'Slack',
    approvalId: approval.id || decision.approvalId || '',
    updatedAt: isoNow(),
  };
  upsertById(state, 'rexDecisions', approvedDecision);
  await persistRexDecisionRecord(approvedDecision);
  return applyRexDecision(approvedDecision, { actor: approval.actor || options.actor || 'Slack' });
}

async function updateRexDecisionOutcome(decisionId = '', payload = {}) {
  ensureRexCollections();
  const decision = state.rexDecisions.find((item) => item.id === decisionId);
  if (!decision) {
    return { ok: false, result: 'unavailable', verbiage: 'Rex decision not found', error: `Decision ${decisionId} was not found.` };
  }
  const outcome = payload.outcome && typeof payload.outcome === 'object' ? payload.outcome : payload;
  const nextDecision = {
    ...decision,
    outcome,
    success: typeof payload.success === 'boolean' ? payload.success : decision.success,
    status: 'measured',
    evaluatedAt: payload.evaluatedAt || isoNow(),
    updatedAt: isoNow(),
  };
  upsertById(state, 'rexDecisions', nextDecision);
  await persistRexDecisionRecord(nextDecision);
  addActivity(state, makeActivity({
    actor: payload.actor || 'Rex Evaluator',
    category: 'REX',
    status: nextDecision.success === true ? 'success' : nextDecision.success === false ? 'warning' : 'measured',
    text: `Measured Rex decision ${decision.tool}: ${nextDecision.success === true ? 'improved' : nextDecision.success === false ? 'did not improve' : 'outcome recorded'}.`,
    target: decision.targetLabel || decision.targetId || decision.tool,
  }));
  await persistState(state);
  return {
    ok: true,
    result: 'live',
    verbiage: 'Rex decision outcome recorded',
    decision: nextDecision,
  };
}

async function queryPgRows(sql = '', params = []) {
  const pool = getPgPool();
  if (!pool) {
    return {
      ok: false,
      reason: 'no_database',
      rows: [],
      error: 'PBK_DATABASE_URL is not configured.',
    };
  }
  try {
    const result = await pool.query(sql, params);
    return { ok: true, reason: 'live', rows: result.rows || [] };
  } catch (error) {
    return {
      ok: false,
      reason: 'query_failed',
      rows: [],
      error: error?.message || String(error),
      code: error?.code || '',
    };
  }
}

function withinDays(value = '', days = 7) {
  const ts = Date.parse(value || '');
  if (!Number.isFinite(ts)) return false;
  return ts >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function flattenBridgeSkills() {
  ensureAgentFleetCollections();
  return (state.agents || []).flatMap((agent) => (agent.skills || []).map((skill) => ({
    id: `${normalizeAgentId(agent.id || agent.name)}:${slugify(skill.name || 'skill')}`,
    name: skill.name || 'Unnamed skill',
    agentId: agent.id || normalizeAgentId(agent.name || ''),
    agentName: agent.name || agent.id || 'Agent',
    role: agent.role || '',
    source: skill.source || skill.skillSource || agent.skillSource || 'bridge-state',
    level: skill.level || 'candidate',
    status: skill.status || 'active',
    confidence: Math.max(0, Math.min(100, Number(skill.confidence || 0))),
    uses: Number(skill.uses || skill.usage || skill.used || 0),
    wins: Number(skill.wins || skill.successes || 0),
    losses: Number(skill.losses || skill.failures || 0),
    successRate: Number(skill.successRate || skill.winRate || skill.rate || 0),
    evidence: skill.evidence || '',
    lastUsedAt: skill.lastUsedAt || skill.updatedAt || agent.updatedAt || '',
  })));
}

function buildFallbackMemoryStats() {
  const docs = [
    ...(Array.isArray(state.brainDocs) ? state.brainDocs : []),
    ...(Array.isArray(state.brainBlogPosts) ? state.brainBlogPosts : []),
  ];
  const decisions = Array.isArray(state.rexDecisions) ? state.rexDecisions : [];
  const skills = flattenBridgeSkills();
  const tagCounts = new Map();
  for (const doc of docs) {
    for (const tag of normalizeStringList(doc.tags || doc.revenueStreams || [doc.topic].filter(Boolean))) {
      const key = String(tag || '').trim();
      if (key) tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
    }
  }
  for (const skill of skills) {
    const key = skill.level || 'candidate';
    tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
  }
  return {
    ok: true,
    result: 'local_view_only',
    source: 'bridge-state-fallback',
    generatedAt: isoNow(),
    total: docs.length + decisions.length,
    newLastWeek: docs.filter((item) => withinDays(item.createdAt || item.publishedAt || item.updatedAt, 7)).length
      + decisions.filter((item) => withinDays(item.createdAt || item.updatedAt, 7)).length,
    vectorQueriesDay: Number(state.status?.toolUsage?.brainQuery || state.status?.toolUsage?.queryBrain || 0),
    activeSkills: skills.filter((skill) => !/retired|disabled/i.test(skill.status || skill.level || '')).length,
    avgRelevanceScore: skills.length
      ? Number((skills.reduce((sum, skill) => sum + Number(skill.confidence || 0), 0) / skills.length / 100).toFixed(2))
      : 0,
    topTags: Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    warning: 'Supabase memory tables were unavailable, so this is bridge-state fallback data.',
  };
}

async function buildMemoryStats() {
  const statsResult = await queryPgRows(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_last_week,
      COALESCE(AVG(score), 0)::float AS avg_score
    FROM public.coach_memory
    WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
  `);
  if (!statsResult.ok) return buildFallbackMemoryStats();
  const tagsResult = await queryPgRows(`
    SELECT objection_tag AS tag, COUNT(*)::int AS count
    FROM public.coach_memory
    WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
      AND objection_tag IS NOT NULL
      AND objection_tag <> ''
    GROUP BY objection_tag
    ORDER BY count DESC, objection_tag ASC
    LIMIT 12
  `);
  const skillsResult = await queryPgRows(`
    SELECT COUNT(*)::int AS active_skills
    FROM public.skills
    WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
      AND COALESCE(status, 'active') NOT IN ('retired', 'disabled')
  `);
  const row = statsResult.rows[0] || {};
  const fallbackSkills = flattenBridgeSkills();
  const dbActiveSkills = skillsResult.ok ? Number(skillsResult.rows[0]?.active_skills || 0) : 0;
  return {
    ok: true,
    result: 'live',
    source: 'supabase',
    generatedAt: isoNow(),
    total: Number(row.total || 0),
    newLastWeek: Number(row.new_last_week || 0),
    vectorQueriesDay: Number(state.status?.toolUsage?.brainQuery || state.status?.toolUsage?.queryBrain || 0),
    activeSkills: dbActiveSkills || fallbackSkills.length,
    avgRelevanceScore: Number(Number(row.avg_score || 0).toFixed(2)),
    topTags: (tagsResult.ok ? tagsResult.rows : []).map((item) => ({
      tag: item.tag || 'untagged',
      count: Number(item.count || 0),
    })),
    warnings: [
      ...(skillsResult.ok ? [] : ['skills table unavailable; active skill count came from bridge state']),
      ...(tagsResult.ok ? [] : ['coach_memory objection tags unavailable']),
    ],
  };
}

function mapHistoryRecord(record = {}, source = 'bridge') {
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
  const action = normalizeRexTool(record.action || record.tool || record.category || '');
  const status = String(record.status || '').toLowerCase();
  const success = typeof record.success === 'boolean'
    ? record.success
    : /success|approved|applied|executed|complete|saved|promoted|transferred/i.test(status);
  return {
    id: record.id || `history-${Date.now()}-${randomUUID().slice(0, 6)}`,
    source,
    actor: record.actor || record.requested_by || record.proposed_by || record.requestedBy || record.proposedBy || 'PBK',
    action: action || 'activity',
    verb: action || 'activity',
    status: record.status || 'recorded',
    summary: record.summary || record.rationale || record.text || payload.statusMessage || 'Agent action recorded.',
    target: record.target || record.target_label || record.targetLabel || record.target_id || record.targetId || payload.agentName || payload.sourceAgentName || payload.skill || '',
    payload,
    outcome: record.outcome || record.result || {},
    success,
    createdAt: record.created_at || record.createdAt || record.at || isoNow(),
    updatedAt: record.updated_at || record.updatedAt || '',
  };
}

function buildFallbackAgentHistory(limit = 50) {
  ensureRexCollections();
  ensureAgentFleetCollections();
  const history = [
    ...(state.rexDecisions || []).map((item) => mapHistoryRecord(item, 'rex_decisions')),
    ...(state.agentSkillTransfers || []).map((item) => mapHistoryRecord({
      ...item,
      actor: item.actor || 'Agent Fleet',
      action: 'transfer_skill',
      summary: `Transferred ${item.skill?.name || item.skill || 'skill'} between agents.`,
      target: `${item.sourceAgentId || ''} -> ${item.targetAgentId || ''}`,
    }, 'agent_skill_transfers')),
    ...(state.agentSkillExperiments || []).map((item) => mapHistoryRecord({
      ...item,
      actor: item.actor || 'Agent Fleet',
      action: 'ab_test_skill',
      summary: `Staged A/B test for ${item.skill?.name || item.skill || 'skill'}.`,
      target: item.agentId || '',
    }, 'agent_skill_experiments')),
    ...(state.activity || [])
      .filter((item) => /rex|agent|fleet|skill|campaign/i.test(`${item.category || ''} ${item.text || ''}`))
      .map((item) => mapHistoryRecord(item, 'activity')),
  ];
  return {
    ok: true,
    result: 'local_view_only',
    source: 'bridge-state-fallback',
    generatedAt: isoNow(),
    history: sortNewest(history).slice(0, limit),
    warning: 'Supabase agent history tables were unavailable, so this is bridge-state fallback data.',
  };
}

async function buildAgentHistory(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  const taskResult = await queryPgRows(`
    SELECT id, requested_by AS actor, action, provider, status, summary, payload, created_at, updated_at
    FROM public.agent_tasks
    WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
      AND (
        action ILIKE '%agent%'
        OR action ILIKE '%skill%'
        OR action ILIKE '%campaign%'
        OR action ILIKE '%deploy%'
        OR action ILIKE '%pause%'
        OR provider ILIKE '%rex%'
      )
    ORDER BY created_at DESC
    LIMIT $1
  `, [safeLimit]);
  const rexResult = await queryPgRows(`
    SELECT id, proposed_by AS actor, tool AS action, status, rationale AS summary,
      params AS payload, target_type, target_id, result, outcome, success, created_at, updated_at
    FROM public.rex_decisions
    ORDER BY created_at DESC
    LIMIT $1
  `, [safeLimit]);
  if (!taskResult.ok && !rexResult.ok) return buildFallbackAgentHistory(safeLimit);
  const history = [
    ...(taskResult.ok ? taskResult.rows.map((row) => mapHistoryRecord(row, 'agent_tasks')) : []),
    ...(rexResult.ok ? rexResult.rows.map((row) => mapHistoryRecord({
      ...row,
      target: row.target_id || row.target_type || '',
    }, 'rex_decisions')) : []),
  ];
  const fallback = buildFallbackAgentHistory(safeLimit).history;
  const merged = [...history, ...fallback.filter((item) => !history.some((existing) => existing.id === item.id))];
  return {
    ok: true,
    result: 'live',
    source: 'supabase',
    generatedAt: isoNow(),
    history: sortNewest(merged).slice(0, safeLimit),
    warnings: [
      ...(taskResult.ok ? [] : ['agent_tasks unavailable']),
      ...(rexResult.ok ? [] : ['rex_decisions unavailable']),
    ],
  };
}

function normalizeSkillOutcome(row = {}) {
  const uses = Number(row.uses || 0);
  const wins = Number(row.wins || 0);
  const losses = Number(row.losses || 0);
  const successRate = uses ? Number(((wins / uses) * 100).toFixed(1)) : Number(row.successRate || 0);
  const confidence = Math.max(0, Math.min(100, Number(row.confidence || (successRate ? successRate : 0))));
  return {
    id: row.id || `${row.agentId || row.agent_id || 'agent'}:${slugify(row.name || 'skill')}`,
    name: row.name || row.skill_name || 'Unnamed skill',
    agentId: row.agentId || row.agent_id || '',
    agentName: row.agentName || row.agent_name || row.agentId || row.agent_id || 'Agent',
    source: row.source || 'self-learned',
    level: row.level || 'candidate',
    status: row.status || 'active',
    confidence,
    uses,
    wins,
    losses,
    successRate,
    evidence: row.evidence || '',
    lastUsedAt: row.lastUsedAt || row.last_used_at || '',
    updatedAt: row.updatedAt || row.updated_at || '',
  };
}

async function buildSkillOutcomes() {
  const result = await queryPgRows(`
    SELECT
      s.id,
      s.agent_id AS "agentId",
      s.agent_name AS "agentName",
      s.name,
      s.source,
      s.level,
      s.status,
      COALESCE(s.confidence, 0)::float AS confidence,
      COUNT(u.id)::int AS uses,
      COUNT(u.id) FILTER (WHERE u.success IS TRUE)::int AS wins,
      COUNT(u.id) FILTER (WHERE u.success IS FALSE)::int AS losses,
      MAX(u.used_at) AS "lastUsedAt",
      s.evidence,
      s.updated_at AS "updatedAt"
    FROM public.skills s
    LEFT JOIN public.skill_usage u
      ON u.workspace_id = s.workspace_id
      AND (u.skill_id = s.id OR (u.skill_name = s.name AND u.agent_id = s.agent_id))
    WHERE COALESCE(s.workspace_id, 'pbk') = 'pbk'
    GROUP BY s.id, s.agent_id, s.agent_name, s.name, s.source, s.level, s.status, s.confidence, s.evidence, s.updated_at
    ORDER BY s.confidence DESC, uses DESC, s.updated_at DESC
    LIMIT 50
  `);
  const fallback = flattenBridgeSkills().map(normalizeSkillOutcome);
  if (!result.ok || !result.rows.length) {
    return {
      ok: true,
      result: result.ok ? 'local_view_only' : 'local_view_only',
      source: result.ok ? 'supabase-empty+bridge-state' : 'bridge-state-fallback',
      generatedAt: isoNow(),
      skills: fallback,
      warning: result.ok
        ? 'Supabase skills table is empty; showing bridge-state agent skills.'
        : 'Supabase skills table was unavailable; showing bridge-state agent skills.',
    };
  }
  const skills = result.rows.map(normalizeSkillOutcome);
  return {
    ok: true,
    result: 'live',
    source: 'supabase',
    generatedAt: isoNow(),
    skills,
  };
}

function buildFallbackFleetOutcomes() {
  ensureAgentFleetCollections();
  const skills = flattenBridgeSkills();
  const decisions = Array.isArray(state.rexDecisions) ? state.rexDecisions : [];
  const outcomes = (state.agents || []).map((agent) => {
    const agentId = agent.id || normalizeAgentId(agent.name || '');
    const agentSkills = skills.filter((skill) => normalizeAgentId(skill.agentId) === normalizeAgentId(agentId));
    const agentDecisions = decisions.filter((decision) => {
      const params = decision.params || {};
      return normalizeAgentId(params.agentId || params.sourceAgentId || decision.targetId || '') === normalizeAgentId(agentId);
    });
    const applied = agentDecisions.filter((decision) => /applied|approved|measured|success/i.test(decision.status || '')).length;
    return {
      agentId,
      agentName: agent.name || agentId,
      role: agent.role || '',
      status: agent.status || '',
      stats: [
        { label: 'Decisions', value: agentDecisions.length || Number(agent.decisions || 0) },
        { label: 'Applied', value: applied, tone: applied ? 'lime' : '' },
        { label: 'Skills active', value: agentSkills.length || Number(agent.skillsTotal || 0), tone: 'lime' },
        { label: 'Last seen', value: agent.lastSeen ? 'live' : 'idle' },
      ],
      metrics: {
        decisions: agentDecisions.length,
        successes: applied,
        failures: agentDecisions.filter((decision) => /failed|rejected|error/i.test(decision.status || '')).length,
        pending: agentDecisions.filter((decision) => /pending|queued|proposed/i.test(decision.status || '')).length,
        skillsActive: agentSkills.length || Number(agent.skillsTotal || 0),
      },
      lastActionAt: agent.updatedAt || agent.lastSeen || '',
    };
  });
  const totals = outcomes.reduce((acc, item) => {
    acc.decisions += Number(item.metrics.decisions || 0);
    acc.successes += Number(item.metrics.successes || 0);
    acc.failures += Number(item.metrics.failures || 0);
    acc.pending += Number(item.metrics.pending || 0);
    acc.skillsActive += Number(item.metrics.skillsActive || 0);
    return acc;
  }, { decisions: 0, successes: 0, failures: 0, pending: 0, skillsActive: 0 });
  outcomes.push({
    agentId: 'fleet',
    agentName: 'Fleet total',
    role: 'all agents',
    status: 'aggregate',
    stats: [
      { label: 'Decisions', value: totals.decisions },
      { label: 'Applied', value: totals.successes, tone: 'lime' },
      { label: 'Pending', value: totals.pending, tone: 'amber' },
      { label: 'Skills active', value: totals.skillsActive, tone: 'lime' },
    ],
    metrics: totals,
    lastActionAt: isoNow(),
  });
  return {
    ok: true,
    result: 'local_view_only',
    source: 'bridge-state-fallback',
    generatedAt: isoNow(),
    outcomes,
    warning: 'Supabase fleet outcome tables were unavailable, so this is bridge-state fallback data.',
  };
}

async function buildFleetOutcomes() {
  const result = await queryPgRows(`
    WITH task_rollups AS (
      SELECT
        COALESCE(
          NULLIF(payload->>'agentId', ''),
          NULLIF(payload->>'sourceAgentId', ''),
          NULLIF(payload->>'agentName', ''),
          NULLIF(requested_by, ''),
          'fleet'
        ) AS agent_id,
        COUNT(*)::int AS decisions,
        COUNT(*) FILTER (WHERE status IN ('approved', 'applied', 'executed', 'complete', 'success', 'saved'))::int AS successes,
        COUNT(*) FILTER (WHERE status IN ('pending', 'queued', 'queued_for_approval', 'proposed'))::int AS pending,
        COUNT(*) FILTER (WHERE status IN ('rejected', 'failed', 'error'))::int AS failures,
        MAX(created_at) AS last_action_at
      FROM public.agent_tasks
      WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
        AND (
          action ILIKE '%agent%'
          OR action ILIKE '%skill%'
          OR action ILIKE '%deploy%'
          OR action ILIKE '%pause%'
          OR provider ILIKE '%rex%'
        )
      GROUP BY agent_id
    ),
    skill_rollups AS (
      SELECT
        COALESCE(NULLIF(agent_id, ''), NULLIF(agent_name, ''), 'fleet') AS agent_id,
        COUNT(*) FILTER (WHERE status NOT IN ('retired', 'disabled'))::int AS skills_active,
        MAX(updated_at) AS last_skill_at
      FROM public.skills
      WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
      GROUP BY COALESCE(NULLIF(agent_id, ''), NULLIF(agent_name, ''), 'fleet')
    ),
    agent_ids AS (
      SELECT agent_id FROM task_rollups
      UNION
      SELECT agent_id FROM skill_rollups
    )
    SELECT
      agent_ids.agent_id,
      COALESCE(task_rollups.decisions, 0)::int AS decisions,
      COALESCE(task_rollups.successes, 0)::int AS successes,
      COALESCE(task_rollups.pending, 0)::int AS pending,
      COALESCE(task_rollups.failures, 0)::int AS failures,
      COALESCE(skill_rollups.skills_active, 0)::int AS skills_active,
      COALESCE(task_rollups.last_action_at, skill_rollups.last_skill_at) AS last_action_at
    FROM agent_ids
    LEFT JOIN task_rollups ON task_rollups.agent_id = agent_ids.agent_id
    LEFT JOIN skill_rollups ON skill_rollups.agent_id = agent_ids.agent_id
    ORDER BY last_action_at DESC NULLS LAST, agent_ids.agent_id ASC
    LIMIT 25
  `);
  const fallback = buildFallbackFleetOutcomes();
  if (!result.ok || !result.rows.length) return fallback;
  ensureAgentFleetCollections();
  const skills = flattenBridgeSkills();
  const outcomes = result.rows.map((row) => {
    const agent = findAgentRecord(row.agent_id) || {};
    const agentId = agent.id || normalizeAgentId(row.agent_id || 'fleet');
    const agentName = agent.name || row.agent_id || 'Fleet';
    const skillsActive = skills.filter((skill) => normalizeAgentId(skill.agentId) === normalizeAgentId(agentId)).length || Number(agent.skillsTotal || 0);
    const metrics = {
      decisions: Number(row.decisions || 0),
      successes: Number(row.successes || 0),
      failures: Number(row.failures || 0),
      pending: Number(row.pending || 0),
      skillsActive: Number(row.skills_active || 0) || skillsActive,
    };
    return {
      agentId,
      agentName,
      role: agent.role || 'Agent',
      status: agent.status || '',
      stats: [
        { label: 'Decisions', value: metrics.decisions },
        { label: 'Applied', value: metrics.successes, tone: metrics.successes ? 'lime' : '' },
        { label: 'Pending', value: metrics.pending, tone: metrics.pending ? 'amber' : '' },
        { label: 'Skills active', value: metrics.skillsActive, tone: 'lime' },
      ],
      metrics,
      lastActionAt: row.last_action_at || '',
    };
  });
  return {
    ok: true,
    result: 'live',
    source: 'supabase',
    generatedAt: isoNow(),
    outcomes,
  };
}

function defaultObjectionPlaybooks() {
  return [
    {
      tag: 'price-too-low',
      count: 0,
      title: 'Rex note - price-too-low playbook',
      note: 'No live objection memories were found yet. Starter guidance: empathy-label first, then walk through repair math. Do not hard-close before the seller feels heard.',
    },
    {
      tag: 'need-to-think',
      count: 0,
      title: 'Rex note - need-to-think playbook',
      note: 'Starter guidance: lower the commitment size, ask what would need to be true, and schedule a precise follow-up.',
    },
  ];
}

async function buildObjectionPlaybooks() {
  const result = await queryPgRows(`
    SELECT objection_tag, prompt, response, source, outcome, score, updated_at, created_at
    FROM public.coach_memory
    WHERE COALESCE(workspace_id, 'pbk') = 'pbk'
      AND objection_tag IS NOT NULL
      AND objection_tag <> ''
    ORDER BY COALESCE(score, 0) DESC, updated_at DESC, created_at DESC
    LIMIT 240
  `);
  if (!result.ok) {
    return {
      ok: true,
      result: 'local_view_only',
      source: 'bridge-state-fallback',
      generatedAt: isoNow(),
      playbooks: defaultObjectionPlaybooks(),
      warning: 'coach_memory was unavailable, so starter playbooks are shown.',
    };
  }
  const groups = new Map();
  for (const row of result.rows) {
    const tag = String(row.objection_tag || '').trim();
    if (!tag) continue;
    const current = groups.get(tag) || {
      tag,
      count: 0,
      title: `Rex note - ${tag} playbook`,
      note: '',
      prompt: '',
      source: '',
      outcome: '',
      lastSeenAt: '',
    };
    current.count += 1;
    if (!current.note && row.response) current.note = String(row.response);
    if (!current.prompt && row.prompt) current.prompt = String(row.prompt);
    if (!current.source && row.source) current.source = String(row.source);
    if (!current.outcome && row.outcome) current.outcome = String(row.outcome);
    current.lastSeenAt = current.lastSeenAt || row.updated_at || row.created_at || '';
    groups.set(tag, current);
  }
  const playbooks = Array.from(groups.values())
    .map((item) => ({
      ...item,
      note: item.note || item.prompt || `Rex has ${item.count} memories for ${item.tag}, but no response summary yet.`,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return {
    ok: true,
    result: 'live',
    source: 'supabase',
    generatedAt: isoNow(),
    playbooks: playbooks.length ? playbooks : defaultObjectionPlaybooks(),
  };
}

async function buildMemoryAnalyticsBundle(limit = 50) {
  const [stats, history, skills, fleet, playbooks] = await Promise.all([
    buildMemoryStats(),
    buildAgentHistory(limit),
    buildSkillOutcomes(),
    buildFleetOutcomes(),
    buildObjectionPlaybooks(),
  ]);
  const liveCount = [stats, history, skills, fleet, playbooks].filter((item) => item.result === 'live').length;
  return {
    ok: true,
    result: liveCount ? 'live' : 'local_view_only',
    source: liveCount ? 'mixed' : 'bridge-state-fallback',
    generatedAt: isoNow(),
    stats,
    history: history.history || [],
    skills: skills.skills || [],
    fleet: fleet.outcomes || [],
    playbooks: playbooks.playbooks || [],
    warnings: [stats, history, skills, fleet, playbooks]
      .flatMap((item) => [item.warning, ...(Array.isArray(item.warnings) ? item.warnings : [])])
      .filter(Boolean),
  };
}

async function requestRexDecisionModificationFromApproval(approval = {}, options = {}) {
  ensureRexCollections();
  const decisionId = approval.metadata?.decisionId || '';
  const decision = state.rexDecisions.find((item) => item.id === decisionId || item.approvalId === approval.id);
  if (!decision) {
    return {
      ok: false,
      result: 'unavailable',
      verbiage: 'Rex decision not found',
      error: 'Rex proposal could not be found for modification.',
    };
  }
  const actor = approval.actor || options.actor || 'Slack';
  const nextDecision = {
    ...decision,
    status: 'needs_modification',
    modifiedBy: actor,
    modificationNotes: approval.notes || 'Slack requested changes before approval.',
    updatedAt: isoNow(),
  };
  upsertById(state, 'rexDecisions', nextDecision);
  await persistRexDecisionRecord(nextDecision);
  addActivity(state, makeActivity({
    actor,
    category: 'REX',
    status: 'warning',
    text: `Rex proposal needs modification: ${decision.tool}`,
    target: decision.targetLabel || decision.targetId || decision.tool,
  }));
  await persistState(state);
  return {
    ok: true,
    result: 'queued_for_approval',
    verbiage: 'Rex proposal sent back for modification',
    decision: nextDecision,
  };
}

function compactSearchText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function collectGlobalSearchRecords(query = '', limit = 12) {
  const needle = compactSearchText(query).toLowerCase();
  const records = [];
  const add = (record) => {
    const haystack = compactSearchText([
      record.title,
      record.subtitle,
      record.body,
      record.kind,
      record.target,
      ...(Array.isArray(record.tags) ? record.tags : []),
    ].filter(Boolean).join(' ')).toLowerCase();
    if (needle && !haystack.includes(needle)) return;
    records.push({
      id: record.id || `${record.kind}-${records.length}`,
      recordId: record.recordId || record.leadId || record.callId || record.messageId || record.contractId || record.id || '',
      recordKind: record.recordKind || record.kind || 'result',
      routeContext: record.routeContext || '',
      kind: record.kind || 'result',
      title: compactSearchText(record.title || 'Untitled result'),
      subtitle: compactSearchText(record.subtitle || ''),
      body: compactSearchText(record.body || ''),
      target: record.target || '',
      page: record.page || 'dashboard',
      createdAt: record.createdAt || record.at || '',
      tags: Array.isArray(record.tags) ? record.tags.slice(0, 6) : [],
    });
  };

  (state.leadImports || []).forEach((lead) => add({
    kind: 'lead',
    id: lead.leadId || lead.id,
    title: lead.seller?.name || lead.leadName || 'Imported lead',
    subtitle: lead.property?.address || lead.address || '',
    body: [lead.seller?.phone, lead.seller?.email, lead.status, lead.source].filter(Boolean).join(' '),
    page: 'lead-detail',
    recordId: lead.leadId || lead.id,
    routeContext: `lead:${lead.leadId || lead.id || ''}`,
    createdAt: lead.createdAt,
    tags: lead.tags || [],
  }));
  (state.calls || []).forEach((call) => add({
    kind: 'call',
    id: call.id,
    title: call.leadName || call.phone || 'Call',
    subtitle: call.address || call.status || '',
    body: [call.phone, call.script, call.status, ...(call.transcript || []).map((line) => line.text)].join(' '),
    page: 'calls',
    recordId: call.id,
    routeContext: `call:${call.id || ''}`,
    createdAt: call.createdAt || call.startedAt,
  }));
  (state.messages || []).forEach((message) => add({
    kind: 'message',
    id: message.id,
    title: message.leadName || message.channel || 'Message',
    subtitle: `${message.channel || 'message'} - ${message.status || ''}`,
    body: [message.address, message.phone, message.email, message.body].filter(Boolean).join(' '),
    page: 'inbox',
    recordId: message.id,
    routeContext: `message:${message.id || ''}`,
    createdAt: message.createdAt,
  }));
  (state.contracts || []).forEach((contract) => add({
    kind: 'contract',
    id: contract.id,
    title: contract.leadName || contract.pathLabel || 'Contract',
    subtitle: contract.address || contract.status || '',
    body: [contract.envelopeId, contract.status, contract.pathType, contract.notes].filter(Boolean).join(' '),
    page: 'contracts',
    recordId: contract.id,
    routeContext: `contract:${contract.id || ''}`,
    createdAt: contract.createdAt || contract.updatedAt,
  }));
  (state.brainDocs || []).forEach((doc) => add({
    kind: 'brain',
    id: doc.id,
    title: doc.title,
    subtitle: doc.topic || doc.source || '',
    body: [doc.summary, doc.excerpt, doc.source].filter(Boolean).join(' '),
    page: 'brain',
    recordId: doc.id,
    routeContext: `brain:${doc.id || ''}`,
    createdAt: doc.createdAt,
    tags: doc.tags || [doc.topic].filter(Boolean),
  }));
  (state.brainBlogPosts || []).forEach((post) => add({
    kind: 'brain',
    id: post.id,
    title: post.title,
    subtitle: [post.salesMentor, post.techniqueType].filter(Boolean).join(' - '),
    body: [post.summary, post.content].filter(Boolean).join(' '),
    page: 'brain',
    recordId: post.id,
    routeContext: `brain-blog:${post.id || ''}`,
    createdAt: post.publishedAt || post.createdAt,
    tags: [...(post.revenueStreams || []), ...(post.tags || [])],
  }));
  (state.activity || []).forEach((item) => {
    if (isDemoActivity(item)) return;
    add({
      kind: 'activity',
      id: item.id,
      title: item.text || item.category || 'Activity',
      subtitle: [item.actor, item.status].filter(Boolean).join(' - '),
      body: item.target || '',
      page: 'activity-log',
      recordId: item.id,
      routeContext: `activity:${item.id || ''}`,
      createdAt: item.at || item.createdAt,
    });
  });

  return sortNewest(records).slice(0, Math.max(1, Math.min(40, Number(limit || 12))));
}

function getMessageCounts() {
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const channel = (name) => messages.filter((message) => String(message.channel || '').toLowerCase() === name).length;
  return {
    all: messages.length,
    unread: messages.filter((message) => ['received', 'unread', 'new'].includes(String(message.status || '').toLowerCase())).length,
    calls: (state.calls || []).length,
    sms: channel('sms'),
    email: channel('email'),
    approvals: (state.approvals || []).filter((approval) => String(approval.status || '').toLowerCase() === 'pending').length
      + (state.adminTasks || []).filter((task) => String(task.status || '').toLowerCase() === 'pending').length,
    hot: (state.leadImports || []).filter((lead) => {
      const tags = Array.isArray(lead.tags) ? lead.tags.join(' ') : '';
      return /hot|urgent|probate|high-equity/i.test(`${tags} ${lead.status || ''}`);
    }).length,
  };
}

function findBrowserResearchJob(jobId = '') {
  const id = String(jobId || '').trim();
  if (!id) return null;
  return (state.browserResearchJobs || []).find((job) => job.id === id || job.jobId === id) || null;
}

async function updateBrowserResearchJobFromPayload(payload = {}) {
  const jobId = String(payload.jobId || payload.id || payload.job_id || '').trim();
  if (!jobId) {
    return {
      ok: false,
      result: 'unavailable',
      error: 'BrowserOS research job id is required.',
    };
  }
  const existing = findBrowserResearchJob(jobId) || {
    id: jobId,
    createdAt: isoNow(),
    provider: 'browseros',
    source: payload.source || 'browseros-callback',
  };
  const status = String(payload.status || payload.state || 'complete').trim().toLowerCase();
  const resultData = payload.resultData || payload.result_data || payload.data || payload.results || {};
  const resultSummary = String(
    payload.resultSummary
      || payload.result_summary
      || payload.summary
      || payload.answer
      || resultData.summary
      || '',
  ).trim();
  const updated = upsertBrowserResearchJob(state, {
    ...existing,
    status,
    result: status,
    resultSummary,
    resultData,
    sources: Array.isArray(payload.sources) ? payload.sources : Array.isArray(resultData.sources) ? resultData.sources : existing.sources || [],
    screenshots: Array.isArray(payload.screenshots) ? payload.screenshots : Array.isArray(resultData.screenshots) ? resultData.screenshots : existing.screenshots || [],
    tags: normalizeStringList(payload.tags || resultData.tags || existing.tags || []),
    completedAt: /complete|done|indexed|success|failed|error/i.test(status) ? (payload.completedAt || payload.completed_at || isoNow()) : existing.completedAt || '',
    updatedAt: isoNow(),
  });
  addActivity(
    state,
    makeActivity({
      actor: payload.actor || 'BrowserOS',
      category: 'RESEARCH',
      status: /fail|error/i.test(status) ? 'warning' : /complete|done|indexed|success/i.test(status) ? 'complete' : 'queued',
      text: resultSummary
        ? `BrowserOS research ${status}: ${resultSummary.slice(0, 160)}`
        : `BrowserOS research job ${status}.`,
      target: updated.targetLabel || updated.targetUrl || updated.id,
    }),
  );
  await persistState(state);
  return {
    ok: true,
    result: /fail|error/i.test(status) ? 'unavailable' : 'live',
    verbiage: /complete|done|indexed|success/i.test(status) ? 'Research results saved' : 'Research job updated',
    job: updated,
    state: buildStateSnapshot(),
  };
}

function getRecordingRetentionPolicy() {
  const settings = ensureRuntimeSettings(state);
  const policy = settings?.ui?.recordingRetention || {};
  return {
    days: Math.max(1, Number(policy.days || RECORDING_RETENTION_DEFAULT_DAYS)),
    enforcement: policy.enforcement || 'approval-gated',
  };
}

async function runRecordingRetentionCleanup({ dryRun = true, days = 0, actor = 'Retention worker' } = {}) {
  const policy = getRecordingRetentionPolicy();
  const retentionDays = Math.max(1, Number(days || policy.days || RECORDING_RETENTION_DEFAULT_DAYS));
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const candidates = (state.messages || []).filter((message) => {
    const storagePath = getMessageRecordingPath(message);
    if (!storagePath) return false;
    const created = Date.parse(message.createdAt || message.updatedAt || '');
    return Number.isFinite(created) && created < cutoffMs;
  });

  const deletions = [];
  if (!dryRun) {
    for (const message of candidates) {
      const storagePath = getMessageRecordingPath(message);
      const deletion = await deleteSupabaseRecording(storagePath);
      deletions.push({ messageId: message.id, storagePath, ...deletion });
      if (deletion.ok) {
        message.retentionStatus = 'deleted';
        message.deletedAt = isoNow();
        message.storagePath = '';
        message.recordingUrl = '';
        message.updatedAt = isoNow();
      }
    }
  }

  const run = {
    id: `retention-${Date.now()}-${randomUUID().slice(0, 8)}`,
    result: dryRun ? 'local_view_only' : 'live',
    status: dryRun ? 'dry-run' : 'complete',
    dryRun: Boolean(dryRun),
    days: retentionDays,
    cutoffAt: new Date(cutoffMs).toISOString(),
    candidateCount: candidates.length,
    deletedCount: deletions.filter((item) => item.ok).length,
    candidates: candidates.map((message) => ({
      messageId: message.id,
      leadName: message.leadName || '',
      storagePath: getMessageRecordingPath(message),
      createdAt: message.createdAt || message.updatedAt || '',
    })),
    deletions,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    actor,
  };
  upsertById(state, 'recordingRetentionRuns', run);
  addActivity(
    state,
    makeActivity({
      actor,
      category: 'RETENTION',
      status: dryRun ? 'preview' : 'complete',
      text: dryRun
        ? `Recording retention preview found ${candidates.length} expired file${candidates.length === 1 ? '' : 's'}.`
        : `Recording retention cleanup deleted ${run.deletedCount} expired file${run.deletedCount === 1 ? '' : 's'}.`,
      target: `${retentionDays}d policy`,
    }),
  );
  await persistState(state);
  return {
    ok: true,
    result: run.result,
    verbiage: dryRun ? 'Retention preview ready' : 'Retention cleanup completed',
    run,
    state: buildStateSnapshot(),
  };
}

function normalizeCampaignLead(input = {}) {
  const seller = input.seller || {};
  const property = input.property || {};
  return {
    leadId: input.leadId || input.id || '',
    leadName: input.leadName || input.name || seller.name || 'Unknown seller',
    address: input.address || property.address || '',
    email: input.email || seller.email || '',
    phone: normalizePhone(input.phone || seller.phone || ''),
    tags: normalizeStringList(input.tags || []),
  };
}

function getApprovalCampaignLeads(approval = {}) {
  const selected = approval.metadata?.selectedLeads;
  if (Array.isArray(selected) && selected.length) {
    return selected.map(normalizeCampaignLead);
  }
  const note = String(approval.notes || '').toLowerCase();
  const matching = (state.leadImports || []).filter((lead) => {
    const normalized = normalizeCampaignLead(lead);
    return note.includes(String(normalized.leadName || '').toLowerCase())
      || note.includes(String(normalized.address || '').toLowerCase());
  });
  return matching.length ? matching.map(normalizeCampaignLead) : (state.leadImports || []).slice(0, 5).map(normalizeCampaignLead);
}

function ensureCampaignCollections() {
  if (!Array.isArray(state.campaigns)) state.campaigns = [];
  if (!Array.isArray(state.campaignLeads)) state.campaignLeads = [];
  if (!Array.isArray(state.campaignEvents)) state.campaignEvents = [];
  if (!Array.isArray(state.campaignSuppressions)) state.campaignSuppressions = [];
}

function normalizeCampaignChannel(value = 'email') {
  const raw = String(value || '').trim().toLowerCase();
  if (['call', 'calls', 'voice', 'phone', 'dialer'].includes(raw)) return 'call';
  if (['sms', 'text', 'texts', 'messaging'].includes(raw)) return 'sms';
  if (['contract', 'contracts', 'docusign', 'envelope'].includes(raw)) return 'contract';
  if (['mixed', 'multi', 'omni', 'omnichannel'].includes(raw)) return 'mixed';
  return 'email';
}

function normalizeCampaignStatus(value = 'draft') {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (['active', 'paused', 'pending', 'draft', 'completed', 'archived', 'provider_missing'].includes(raw)) return raw;
  if (['approval', 'approval_required', 'queued_for_approval'].includes(raw)) return 'pending';
  if (['done', 'complete'].includes(raw)) return 'completed';
  if (['provider', 'missing_provider'].includes(raw)) return 'provider_missing';
  return 'draft';
}

function getCampaignProvider(channel = 'email') {
  const normalized = normalizeCampaignChannel(channel);
  if (normalized === 'email') return 'Instantly';
  if (normalized === 'call' || normalized === 'sms') return 'Telnyx';
  if (normalized === 'contract') return 'DocuSign';
  return 'Instantly + Telnyx';
}

function getCampaignProviderConfig(input = {}) {
  const providerConfig = input.providerConfig || input.provider_config || {};
  const sequenceConfig = input.sequence?.providerConfig || input.sequence?.provider_config || {};
  const scheduleConfig = input.schedule?.providerConfig || input.schedule?.provider_config || {};
  const telnyxConfig = providerConfig.telnyx || sequenceConfig.telnyx || scheduleConfig.telnyx || {};
  const instantlyConfig = providerConfig.instantly || sequenceConfig.instantly || scheduleConfig.instantly || {};
  const selectedFromNumber = normalizePhone(
    input.selectedFromNumber
      || input.selected_from_number
      || input.telnyxNumber
      || input.fromNumber
      || input.from
      || providerConfig.selectedFromNumber
      || providerConfig.fromNumber
      || sequenceConfig.selectedFromNumber
      || scheduleConfig.selectedFromNumber
      || telnyxConfig.selectedFromNumber
      || telnyxConfig.fromNumber
      || '',
  );
  const fromEmail = String(
    input.fromEmail
      || input.from_email
      || input.instantlySender
      || input.senderEmail
      || providerConfig.fromEmail
      || providerConfig.from_email
      || sequenceConfig.fromEmail
      || scheduleConfig.fromEmail
      || instantlyConfig.fromEmail
      || instantlyConfig.from_email
      || '',
  ).trim();
  return {
    selectedFromNumber,
    fromNumber: selectedFromNumber,
    fromEmail,
    from_email: fromEmail,
    telnyx: {
      selectedFromNumber,
      fromNumber: selectedFromNumber,
    },
    instantly: {
      fromEmail,
      from_email: fromEmail,
    },
  };
}

function getLeadImportSearchText(lead = {}) {
  return [
    lead.leadId,
    lead.id,
    lead.leadName,
    lead.name,
    lead.seller?.name,
    lead.seller?.email,
    lead.seller?.phone,
    lead.address,
    lead.property?.address,
    lead.property?.city,
    lead.property?.state,
    lead.status,
    ...(Array.isArray(lead.tags) ? lead.tags : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function getCampaignLeadSourceOptions() {
  const imported = Array.isArray(state?.leadImports) ? state.leadImports : [];
  const countMatching = (predicate) => imported.filter(predicate).length;
  return [
    {
      id: 'selected',
      label: 'Selected leads',
      count: 0,
      source: 'frontend-selection',
      note: 'Uses leads selected in the PBK Leads table.',
    },
    {
      id: 'all-imports',
      label: 'All imported leads',
      count: imported.length,
      source: 'leadImports',
      note: 'Bridge-backed lead imports currently in PBK runtime state.',
    },
    {
      id: 'probate-ohio',
      label: 'Probate - Ohio',
      count: countMatching((lead) => /probate|executor|estate|ohio|\boh\b/i.test(getLeadImportSearchText(lead))),
      source: 'leadImports',
      note: 'Dynamic saved filter from imported lead tags, notes, and addresses.',
    },
    {
      id: 'absentee-akron',
      label: 'Absentee - Akron',
      count: countMatching((lead) => /absentee|akron|landlord|tenant/i.test(getLeadImportSearchText(lead))),
      source: 'leadImports',
      note: 'Dynamic saved filter from imported lead tags, notes, and addresses.',
    },
    {
      id: 'csv-upload',
      label: 'CSV upload',
      count: 0,
      source: 'client-csv',
      note: 'Parsed in the browser, then sent to the bridge with the campaign draft.',
    },
  ];
}

function selectCampaignLeadsBySource(source = 'all-imports', limit = 500) {
  const imported = Array.isArray(state.leadImports) ? state.leadImports : [];
  const normalizedSource = String(source || '').trim().toLowerCase();
  let candidates = imported;
  if (normalizedSource === 'probate-ohio') {
    candidates = imported.filter((lead) => /probate|executor|estate|ohio|\boh\b/i.test(getLeadImportSearchText(lead)));
  } else if (normalizedSource === 'absentee-akron') {
    candidates = imported.filter((lead) => /absentee|akron|landlord|tenant/i.test(getLeadImportSearchText(lead)));
  } else if (normalizedSource === 'selected' || normalizedSource === 'csv-upload') {
    candidates = [];
  }
  return candidates.slice(0, Math.max(1, Math.min(limit, 1000))).map(normalizeCampaignLead);
}

function dedupeCampaignLeads(leads = []) {
  const seen = new Set();
  return leads.map(normalizeCampaignLead).filter((lead) => {
    const key = String(lead.leadId || lead.email || lead.phone || lead.address || lead.leadName || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCampaignLeads(campaignId = '') {
  return (state.campaignLeads || []).filter((lead) => String(lead.campaignId || '') === String(campaignId || ''));
}

function getCampaignEvents(campaignId = '') {
  return sortNewest((state.campaignEvents || []).filter((event) => String(event.campaignId || '') === String(campaignId || '')));
}

function calculateCampaignMetrics(campaign = {}) {
  const leads = getCampaignLeads(campaign.id);
  const events = getCampaignEvents(campaign.id);
  const count = (patterns = []) => events.filter((event) => {
    const text = [event.eventType, event.status, event.providerStatus].filter(Boolean).join(' ').toLowerCase();
    return patterns.some((pattern) => pattern.test(text));
  }).length;
  const leadCount = leads.length || toNumber(campaign.leadCount, 0);
  const channel = normalizeCampaignChannel(campaign.channel);
  const touches = channel === 'email' ? leadCount * 5 : channel === 'sms' ? leadCount * 3 : leadCount;
  const unit = channel === 'email' ? 0.002 : channel === 'sms' ? 0.007 : channel === 'call' ? 0.014 : 0.01;
  return {
    leads: leadCount,
    events: events.length,
    sent: count([/sent/, /scheduled/, /delivered/, /attempted/, /dialed/]),
    opened: count([/open/]),
    clicked: count([/click/]),
    replied: count([/reply/, /responded/, /interested/]),
    bounced: count([/bounce/, /failed/, /carrier_error/]),
    connected: count([/connected/, /answered/, /live_answer/]),
    dnc: count([/dnc/, /unsubscribe/, /\bstop\b/, /opt_out/]),
    estimatedTouches: touches,
    estimatedCost: Number((touches * unit).toFixed(2)),
  };
}

function findCampaignConflicts(leads = [], channel = 'email', campaignId = '') {
  const normalizedChannel = normalizeCampaignChannel(channel);
  const activeCampaignIds = new Set((state.campaigns || [])
    .filter((campaign) =>
      campaign.id !== campaignId
      && ['active', 'pending'].includes(normalizeCampaignStatus(campaign.status))
      && normalizeCampaignChannel(campaign.channel) === normalizedChannel)
    .map((campaign) => campaign.id));
  if (!activeCampaignIds.size) return [];
  const keys = new Set(leads.map((lead) => String(lead.leadId || lead.email || lead.phone || lead.address || '').trim().toLowerCase()).filter(Boolean));
  return (state.campaignLeads || []).filter((lead) => {
    if (!activeCampaignIds.has(lead.campaignId)) return false;
    const key = String(lead.leadId || lead.email || lead.phone || lead.address || '').trim().toLowerCase();
    return key && keys.has(key);
  });
}

function recordCampaignEvent(payload = {}) {
  ensureCampaignCollections();
  const event = {
    id: payload.id || payload.providerEventId || `campaign-event-${Date.now()}-${randomUUID().slice(0, 8)}`,
    campaignId: payload.campaignId || '',
    campaignLeadId: payload.campaignLeadId || '',
    leadId: payload.leadId || '',
    eventType: payload.eventType || payload.type || 'note',
    channel: normalizeCampaignChannel(payload.channel || payload.payload?.channel || 'email'),
    provider: payload.provider || '',
    providerEventId: payload.providerEventId || '',
    providerStatus: payload.providerStatus || payload.status || '',
    payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {},
    occurredAt: payload.occurredAt || isoNow(),
    createdAt: payload.createdAt || isoNow(),
  };
  upsertById(state, 'campaignEvents', event);
  void persistCampaignEventRecord(event);
  return event;
}

function buildCampaignFromPayload(payload = {}) {
  const now = isoNow();
  const channel = normalizeCampaignChannel(payload.channel);
  const source = String(payload.leadSource || payload.lead_filter?.source || payload.leadFilter?.source || 'selected').trim();
  const providedLeads = Array.isArray(payload.selectedLeads)
    ? payload.selectedLeads
    : Array.isArray(payload.leads)
      ? payload.leads
      : Array.isArray(payload.csvLeads)
        ? payload.csvLeads
        : [];
  const fallbackLeads = providedLeads.length ? [] : selectCampaignLeadsBySource(source, toNumber(payload.limit, 500));
  const leads = dedupeCampaignLeads(providedLeads.length ? providedLeads : fallbackLeads);
  const id = payload.id || `campaign-${slugify(payload.name || `${channel}-${Date.now()}`) || randomUUID().slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const conflicts = findCampaignConflicts(leads, channel, id);
  const status = normalizeCampaignStatus(payload.status || 'draft');
  const providerConfig = getCampaignProviderConfig(payload);
  const schedule = payload.schedule && typeof payload.schedule === 'object' ? payload.schedule : {};
  const sequence = payload.sequence && typeof payload.sequence === 'object' ? payload.sequence : {};
  const campaign = {
    id,
    name: String(payload.name || 'Untitled campaign').trim() || 'Untitled campaign',
    channel,
    provider: payload.provider || getCampaignProvider(channel),
    status,
    templateId: payload.templateId || payload.template_id || '',
    leadSource: source,
    leadFilter: payload.leadFilter || payload.lead_filter || { source },
    schedule: {
      ...schedule,
      providerConfig,
    },
    sequence: {
      ...sequence,
      providerConfig,
    },
    providerConfig,
    selectedFromNumber: providerConfig.selectedFromNumber,
    fromNumber: providerConfig.fromNumber,
    fromEmail: providerConfig.fromEmail,
    from_email: providerConfig.from_email,
    metrics: payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : {},
    approvalId: payload.approvalId || '',
    approvalStatus: payload.approvalStatus || '',
    pendingAction: payload.pendingAction || '',
    conflictCount: conflicts.length,
    suppressionMode: payload.suppressionMode || 'same_channel_active_campaigns',
    notes: payload.notes || payload.customNotes || '',
    createdAt: payload.createdAt || now,
    updatedAt: payload.updatedAt || now,
    createdBy: payload.actor || payload.createdBy || 'PBK Command Center',
  };
  return { campaign, leads, conflicts };
}

async function createCampaignRecord(payload = {}) {
  ensureCampaignCollections();
  const { campaign, leads, conflicts } = buildCampaignFromPayload(payload);
  upsertById(state, 'campaigns', campaign);
  state.campaignLeads = (state.campaignLeads || []).filter((lead) => lead.campaignId !== campaign.id);
  leads.forEach((lead, index) => {
    upsertById(state, 'campaignLeads', {
      id: `campaign-lead-${campaign.id}-${slugify(lead.leadId || lead.email || lead.phone || lead.address || index) || index}`,
      campaignId: campaign.id,
      leadId: lead.leadId || '',
      leadName: lead.leadName || 'Unknown seller',
      address: lead.address || '',
      email: lead.email || '',
      phone: lead.phone || '',
      tags: lead.tags || [],
      status: conflicts.some((conflict) =>
        String(conflict.leadId || conflict.email || conflict.phone || conflict.address || '').trim().toLowerCase()
        === String(lead.leadId || lead.email || lead.phone || lead.address || '').trim().toLowerCase())
        ? 'conflict_review'
        : 'pending',
      touchIndex: 0,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    });
  });
  const metrics = calculateCampaignMetrics(campaign);
  upsertById(state, 'campaigns', {
    ...campaign,
    leadCount: leads.length,
    metrics: {
      ...metrics,
      ...(campaign.metrics || {}),
    },
  });
  recordCampaignEvent({
    campaignId: campaign.id,
    eventType: 'campaign_created',
    channel: campaign.channel,
    provider: campaign.provider,
    providerStatus: 'draft',
    payload: {
      leadSource: campaign.leadSource,
      leadCount: leads.length,
      conflictCount: conflicts.length,
    },
  });
  addActivity(
    state,
    makeActivity({
      actor: payload.actor || 'PBK Command Center',
      category: 'CAMPAIGN',
      status: campaign.status,
      text: `Created ${getCampaignProvider(campaign.channel)} campaign "${campaign.name}" with ${leads.length} lead${leads.length === 1 ? '' : 's'}.`,
      target: campaign.id,
    }),
  );
  await persistState(state);
  const savedCampaign = state.campaigns.find((item) => item.id === campaign.id) || campaign;
  const savedLeads = getCampaignLeads(campaign.id);
  await persistCampaignRecord(savedCampaign);
  await Promise.all(savedLeads.map((lead) => persistCampaignLeadRecord(lead)));
  return {
    ok: true,
    result: 'live',
    verbiage: 'Campaign draft saved',
    campaign: savedCampaign,
    leads: savedLeads,
    conflicts,
  };
}

async function patchCampaignRecord(campaignId = '', patch = {}) {
  ensureCampaignCollections();
  const current = (state.campaigns || []).find((campaign) => campaign.id === campaignId);
  if (!current) {
    return { ok: false, result: 'unavailable', verbiage: 'Campaign not found', error: 'Campaign record not found.' };
  }
  const next = {
    ...current,
    ...patch,
    channel: normalizeCampaignChannel(patch.channel || current.channel),
    status: normalizeCampaignStatus(patch.status || current.status),
    updatedAt: isoNow(),
  };
  upsertById(state, 'campaigns', next);
  recordCampaignEvent({
    campaignId,
    eventType: 'campaign_updated',
    channel: next.channel,
    provider: next.provider,
    providerStatus: next.status,
    payload: patch,
  });
  addActivity(
    state,
    makeActivity({
      actor: patch.actor || 'PBK Command Center',
      category: 'CAMPAIGN',
      status: 'updated',
      text: `Updated campaign "${next.name}".`,
      target: campaignId,
    }),
  );
  await persistState(state);
  await persistCampaignRecord(next);
  return { ok: true, result: 'live', verbiage: 'Campaign updated', campaign: next, leads: getCampaignLeads(campaignId) };
}

async function requestCampaignApproval(campaignId = '', params = {}) {
  ensureCampaignCollections();
  const campaign = (state.campaigns || []).find((item) => item.id === campaignId);
  if (!campaign) {
    return { ok: false, result: 'unavailable', verbiage: 'Campaign not found', error: 'Campaign record not found.' };
  }
  const selectedLeads = getCampaignLeads(campaignId).map(normalizeCampaignLead);
  const action = params.requestedAction || params.approvalAction || 'start_campaign';
  const providerConfig = getCampaignProviderConfig({
    ...campaign,
    ...params,
    providerConfig: params.providerConfig || campaign.providerConfig,
  });
  const { approval, fanout } = await toolHandlers.createApproval({
    type: 'campaign',
    leadName: campaign.name,
    address: `${selectedLeads.length || campaign.leadCount || 0} campaign leads`,
    templateId: campaign.templateId || '',
    approvalAction: action,
    notes: params.notes || `${String(action).replace(/_/g, ' ')} for ${campaign.name}`,
    metadata: {
      selectedLeads,
      requestedAction: action,
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignChannel: campaign.channel,
      campaignProvider: campaign.provider || getCampaignProvider(campaign.channel),
      templateId: campaign.templateId || '',
      leadFilter: campaign.leadSource || '',
      schedule: campaign.schedule || {},
      sequence: campaign.sequence || {},
      providerConfig,
      selectedFromNumber: providerConfig.selectedFromNumber,
      fromNumber: providerConfig.fromNumber,
      fromEmail: providerConfig.fromEmail,
      from_email: providerConfig.from_email,
      statusMessage: `${String(action).replace(/_/g, ' ')} queued for approval`,
    },
  });
  const nextCampaign = {
    ...campaign,
    status: normalizeCampaignStatus(params.status || 'pending'),
    approvalId: approval.id,
    approvalStatus: 'pending',
    pendingAction: action,
    updatedAt: isoNow(),
  };
  upsertById(state, 'campaigns', nextCampaign);
  recordCampaignEvent({
    campaignId,
    eventType: 'approval_requested',
    channel: campaign.channel,
    provider: campaign.provider,
    providerStatus: 'queued_for_approval',
    payload: { approvalId: approval.id, action, fanout },
  });
  addActivity(
    state,
    makeActivity({
      actor: params.actor || 'PBK Command Center',
      category: 'CAMPAIGN',
      status: 'pending',
      text: `Campaign "${campaign.name}" queued for approval before provider execution.`,
      target: campaign.id,
    }),
  );
  await persistState(state);
  return {
    ok: true,
    result: 'queued_for_approval',
    verbiage: 'Campaign queued for approval',
    campaign: nextCampaign,
    approval,
    fanout,
  };
}

async function runCampaignAction(campaignId = '', payload = {}) {
  const action = String(payload.action || payload.requestedAction || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!action) {
    return { ok: false, result: 'unavailable', verbiage: 'Campaign action missing', error: 'No action supplied.' };
  }
  if (['start', 'start_campaign', 'pause', 'resume', 'archive', 'cancel', 'delete', 'add_leads', 'edit_template', 'campaign_pause', 'campaign_resume', 'campaign_archive', 'campaign_cancel'].includes(action)) {
    return requestCampaignApproval(campaignId, {
      ...payload,
      requestedAction: action.startsWith('campaign_') ? action : `campaign_${action}`,
    });
  }
  if (action === 'save_draft') {
    return patchCampaignRecord(campaignId, payload.patch || {});
  }
  return {
    ok: false,
    result: 'unavailable',
    verbiage: 'Campaign action unavailable',
    error: `Unsupported campaign action: ${action}`,
  };
}

function queryCampaignRecords(searchParams = new URLSearchParams()) {
  ensureCampaignCollections();
  const search = String(searchParams.get('search') || searchParams.get('q') || '').trim().toLowerCase();
  const status = String(searchParams.get('status') || 'all').trim().toLowerCase();
  const channel = normalizeCampaignChannel(searchParams.get('channel') || 'all');
  const channelRaw = String(searchParams.get('channel') || 'all').trim().toLowerCase();
  return sortNewest(state.campaigns || []).filter((campaign) => {
    const statusMatch = status === 'all' || normalizeCampaignStatus(campaign.status) === status;
    const channelMatch = channelRaw === 'all' || normalizeCampaignChannel(campaign.channel) === channel;
    const queryMatch = !search || [
      campaign.name,
      campaign.channel,
      campaign.status,
      campaign.provider,
      campaign.templateId,
      campaign.notes,
      campaign.leadSource,
    ].filter(Boolean).join(' ').toLowerCase().includes(search);
    return statusMatch && channelMatch && queryMatch;
  }).map((campaign) => ({
    ...campaign,
    metrics: {
      ...calculateCampaignMetrics(campaign),
      ...(campaign.metrics || {}),
    },
    leadCount: getCampaignLeads(campaign.id).length || campaign.leadCount || 0,
    eventCount: getCampaignEvents(campaign.id).length,
  }));
}

function getZonedDatePartsForCampaign(timeZone = DEFAULT_LEAD_TIMEZONE, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || DEFAULT_LEAD_TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    weekday: pick('weekday').toLowerCase(),
    hour: toNumber(pick('hour'), 0),
    minute: toNumber(pick('minute'), 0),
  };
}

function parseCampaignWindow(windowValue = '') {
  const normalized = String(windowValue || '').trim().toLowerCase();
  if (/10.*4/.test(normalized)) return { startHour: 10, endHour: 16, weekdaysOnly: true };
  if (/8.*9/.test(normalized)) return { startHour: 8, endHour: 21, weekdaysOnly: false };
  if (/weekdays/.test(normalized)) return { startHour: 9, endHour: 17, weekdaysOnly: true };
  return { startHour: 9, endHour: 17, weekdaysOnly: true };
}

function isWithinCampaignWindow(campaign = {}, lead = {}, now = new Date()) {
  const schedule = campaign.schedule || {};
  const timezone = lead.timezone || lead.metadata?.timezone || schedule.timezone || schedule.leadTimezone || DEFAULT_LEAD_TIMEZONE;
  const windowRule = parseCampaignWindow(schedule.window || schedule.callWindow || schedule.sendWindow || '9-5-est');
  const zoned = getZonedDatePartsForCampaign(timezone, now);
  const isWeekend = zoned.weekday === 'sat' || zoned.weekday === 'sun';
  if (windowRule.weekdaysOnly && isWeekend) {
    return {
      ok: false,
      result: 'local_view_only',
      reason: `Outside campaign days in ${timezone}.`,
      timezone,
      zoned,
    };
  }
  const ok = zoned.hour >= windowRule.startHour && zoned.hour < windowRule.endHour;
  return {
    ok,
    result: ok ? 'live' : 'local_view_only',
    reason: ok ? 'Inside campaign send window.' : `Outside campaign send window (${windowRule.startHour}:00-${windowRule.endHour}:00 ${timezone}).`,
    timezone,
    zoned,
  };
}

function getCampaignDailyCap(campaign = {}) {
  return Math.max(1, Math.min(1000, toNumber(campaign.schedule?.dailyCap || campaign.schedule?.cap || 50, 50)));
}

function getCampaignEventDay(event = {}) {
  return String(event.occurredAt || event.createdAt || '').slice(0, 10);
}

function countCampaignEventsToday(campaignId = '', now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return getCampaignEvents(campaignId).filter((event) => {
    const status = String(event.providerStatus || event.status || event.eventType || '').toLowerCase();
    return getCampaignEventDay(event) === today && /sent|scheduled|queued|delivered|attempted|dialed|provider_managed/i.test(status);
  }).length;
}

function findCampaignSuppressionForLead(lead = {}, channel = '') {
  const leadKeys = [
    lead.leadId,
    lead.email,
    lead.phone,
    lead.address,
  ].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  return (state.campaignSuppressions || []).find((suppression) => {
    if (channel && suppression.channel && normalizeCampaignChannel(suppression.channel) !== normalizeCampaignChannel(channel)) return false;
    const suppressionKey = String(suppression.leadId || suppression.email || suppression.phone || suppression.address || '').trim().toLowerCase();
    return suppressionKey && leadKeys.includes(suppressionKey);
  }) || null;
}

function isCampaignLeadContactable(campaign = {}, lead = {}, channel = '') {
  const suppression = findCampaignSuppressionForLead(lead, channel);
  if (suppression) {
    return {
      ok: false,
      result: 'unavailable',
      status: 'suppressed',
      reason: suppression.reason || 'Lead is suppressed for this channel.',
      suppression,
    };
  }
  const dnc = findDncEntryByPhone(lead.phone);
  if (dnc) {
    return {
      ok: false,
      result: 'unavailable',
      status: 'dnc_blocked',
      reason: dnc.reason || 'Lead phone is on DNC.',
      dnc,
    };
  }
  const windowCheck = isWithinCampaignWindow(campaign, lead);
  if (!windowCheck.ok) {
    return {
      ok: false,
      result: 'local_view_only',
      status: 'outside_window',
      reason: windowCheck.reason,
      window: windowCheck,
    };
  }
  return { ok: true, result: 'live', status: 'contactable' };
}

function getCampaignStepChannels(campaign = {}) {
  const sequenceSteps = Array.isArray(campaign.sequence?.steps) ? campaign.sequence.steps : [];
  const channels = sequenceSteps.map((step) => normalizeCampaignChannel(step.channel || step.type)).filter(Boolean);
  if (channels.length) return channels;
  const channel = normalizeCampaignChannel(campaign.channel || 'email');
  if (channel === 'mixed') return ['email', 'sms', 'call'];
  return [channel];
}

function getNextCampaignChannelForLead(campaign = {}, lead = {}) {
  const channels = getCampaignStepChannels(campaign);
  const index = Math.max(0, toNumber(lead.touchIndex, 0));
  return channels[Math.min(index, channels.length - 1)] || normalizeCampaignChannel(campaign.channel || 'email');
}

function isCampaignLeadTerminal(lead = {}) {
  const status = String(lead.status || '').toLowerCase();
  if (CAMPAIGN_WORKER_RETRY_PROVIDER_MISSING && status === 'provider_missing') return false;
  return ['sent', 'queued', 'scheduled', 'completed', 'blocked', 'dnc_blocked', 'suppressed', 'provider_managed', 'conflict_review'].includes(status)
    || /delivered|answered|connected|archived/.test(status);
}

function buildCampaignOutboundText(campaign = {}, lead = {}, channel = 'email') {
  const firstName = String(lead.leadName || '').trim().split(/\s+/)[0] || 'there';
  const address = lead.address || 'your property';
  if (channel === 'sms') {
    return `Hi ${firstName}, this is PBK. Are you still open to a simple as-is offer for ${address}? Reply STOP to opt out.`;
  }
  if (channel === 'call') {
    return campaign.sequence?.script || campaign.notes || `Warm, direct campaign opener for ${lead.leadName || 'seller'} at ${address}.`;
  }
  return campaign.notes || `Hi ${firstName}, PBK can make a simple as-is offer for ${address}.`;
}

function patchCampaignLead(leadId = '', patch = {}) {
  const existing = (state.campaignLeads || []).find((lead) => lead.id === leadId);
  if (!existing) return null;
  const next = {
    ...existing,
    ...patch,
    updatedAt: isoNow(),
  };
  upsertById(state, 'campaignLeads', next);
  void persistCampaignLeadRecord(next);
  return next;
}

async function processCampaignLeadStep(campaign = {}, lead = {}, options = {}) {
  const channel = getNextCampaignChannelForLead(campaign, lead);
  const now = options.now || new Date();
  const dryRun = Boolean(options.dryRun);
  const allowProviderWrites = Boolean(options.allowProviderWrites);
  const providerConfig = getCampaignProviderConfig(campaign);
  const targetLabel = lead.address || lead.leadName || lead.email || lead.phone || lead.id;
  const contactable = isCampaignLeadContactable(campaign, lead, channel);

  if (!contactable.ok) {
    patchCampaignLead(lead.id, {
      status: contactable.status,
      lastTouchAt: now.toISOString(),
      metadata: {
        ...(lead.metadata || {}),
        lastBlockReason: contactable.reason,
      },
    });
    const event = recordCampaignEvent({
      campaignId: campaign.id,
      campaignLeadId: lead.id,
      leadId: lead.leadId,
      eventType: contactable.status,
      channel,
      provider: campaign.provider || getCampaignProvider(channel),
      providerStatus: contactable.result,
      payload: {
        reason: contactable.reason,
        target: targetLabel,
      },
    });
    addActivity(
      state,
      makeActivity({
        actor: 'Campaign guardrail',
        category: 'CAMPAIGN',
        status: contactable.status,
        text: `Campaign "${campaign.name}" skipped ${targetLabel}: ${contactable.reason}`,
        target: campaign.id,
      }),
    );
    return { ok: false, result: contactable.result, lead, event, reason: contactable.reason };
  }

  if (dryRun || !allowProviderWrites) {
    const event = recordCampaignEvent({
      campaignId: campaign.id,
      campaignLeadId: lead.id,
      leadId: lead.leadId,
      eventType: 'dry_run_due',
      channel,
      provider: campaign.provider || getCampaignProvider(channel),
      providerStatus: 'dry_run',
      payload: {
        target: targetLabel,
        workerEnabled: CAMPAIGN_WORKER_ENABLED,
        providerWritesConfirmed: CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES,
      },
    });
    return {
      ok: true,
      result: 'local_view_only',
      dryRun: true,
      lead,
      event,
      verbiage: 'Campaign step due - dry run only',
    };
  }

  let delivery = null;
  if (channel === 'email') {
    if (campaign.providerCampaignId) {
      patchCampaignLead(lead.id, {
        status: 'provider_managed',
        touchIndex: toNumber(lead.touchIndex, 0) + 1,
        lastTouchAt: now.toISOString(),
      });
      const event = recordCampaignEvent({
        campaignId: campaign.id,
        campaignLeadId: lead.id,
        leadId: lead.leadId,
        eventType: 'provider_managed',
        channel,
        provider: 'Instantly',
        providerStatus: 'provider_managed',
        payload: {
          providerCampaignId: campaign.providerCampaignId,
          target: targetLabel,
        },
      });
      return { ok: true, result: 'live', lead, event, verbiage: 'Lead is managed by Instantly campaign.' };
    }
    delivery = await toolHandlers.sendColdEmail({
      leadId: lead.leadId,
      leadName: lead.leadName,
      address: lead.address,
      email: lead.email,
      phone: lead.phone,
      campaignId: campaign.id,
      templateId: campaign.templateId,
      fromEmail: providerConfig.fromEmail,
      from_email: providerConfig.fromEmail,
      body: buildCampaignOutboundText(campaign, lead, channel),
      actor: 'Campaign worker',
    });
  } else if (channel === 'sms') {
    delivery = await toolHandlers.telnyx_sms({
      leadId: lead.leadId,
      leadName: lead.leadName,
      address: lead.address,
      phone: lead.phone,
      from: providerConfig.selectedFromNumber,
      fromNumber: providerConfig.selectedFromNumber,
      body: buildCampaignOutboundText(campaign, lead, channel),
      campaignId: campaign.id,
      actor: 'Campaign worker',
    });
  } else if (channel === 'call') {
    delivery = await toolHandlers.telnyx_call({
      leadId: lead.leadId,
      leadName: lead.leadName,
      address: lead.address,
      phone: lead.phone,
      from: providerConfig.selectedFromNumber,
      fromNumber: providerConfig.selectedFromNumber,
      script: buildCampaignOutboundText(campaign, lead, channel),
      campaignId: campaign.id,
      record: true,
      transcription: true,
      actor: 'Campaign worker',
    });
  } else if (channel === 'contract') {
    delivery = await toolHandlers.sendDocuSign({
      leadId: lead.leadId,
      leadName: lead.leadName,
      address: lead.address,
      email: lead.email,
      campaignId: campaign.id,
      actor: 'Campaign worker',
    });
  }

  const live = Boolean(delivery?.telnyx?.live || delivery?.docusign?.live || delivery?.delivery?.live || delivery?.result === 'live');
  const simulated = Boolean(delivery?.telnyx?.simulated || delivery?.delivery?.live === false || delivery?.docusign?.configured === false);
  const providerStatus = live && !simulated
    ? 'sent'
    : delivery?.blocked
      ? 'blocked'
      : delivery?.result === 'provider_missing' || simulated
        ? 'provider_missing'
        : delivery?.ok
          ? 'queued'
          : 'failed';
  const nextLead = patchCampaignLead(lead.id, {
    status: providerStatus,
    touchIndex: providerStatus === 'sent' || providerStatus === 'queued' ? toNumber(lead.touchIndex, 0) + 1 : toNumber(lead.touchIndex, 0),
    lastTouchAt: now.toISOString(),
    metadata: {
      ...(lead.metadata || {}),
      lastDelivery: delivery || null,
    },
  });
  const event = recordCampaignEvent({
    campaignId: campaign.id,
    campaignLeadId: lead.id,
    leadId: lead.leadId,
    eventType: providerStatus === 'provider_missing' ? 'provider_missing' : channel === 'call' ? 'call_attempted' : `${channel}_sent`,
    channel,
    provider: campaign.provider || getCampaignProvider(channel),
    providerStatus,
    payload: {
      target: targetLabel,
      delivery,
    },
  });
  addActivity(
    state,
    makeActivity({
      actor: 'Campaign worker',
      category: 'CAMPAIGN',
      status: providerStatus,
      text: `Campaign "${campaign.name}" ${providerStatus} for ${targetLabel}.`,
      target: campaign.id,
    }),
  );
  return {
    ok: providerStatus === 'sent' || providerStatus === 'queued',
    result: providerStatus === 'sent' || providerStatus === 'queued' ? 'live' : providerStatus === 'provider_missing' ? 'provider_missing' : 'unavailable',
    delivery,
    lead: nextLead || lead,
    event,
  };
}

async function runCampaignScheduler(options = {}) {
  ensureCampaignCollections();
  const now = options.now instanceof Date ? options.now : new Date();
  const dryRun = options.dryRun ?? !(CAMPAIGN_WORKER_ENABLED && CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES);
  const allowProviderWrites = Boolean(!dryRun && CAMPAIGN_WORKER_ENABLED && (options.confirmProviderWrites || CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES));
  const limit = Math.max(1, Math.min(250, toNumber(options.limit, CAMPAIGN_WORKER_MAX_STEPS)));
  const processed = [];
  const skipped = [];

  for (const campaign of sortNewest(state.campaigns || [])) {
    if (processed.length >= limit) break;
    const status = normalizeCampaignStatus(campaign.status);
    if (status !== 'active') {
      skipped.push({ campaignId: campaign.id, status, reason: 'Campaign is not active.' });
      continue;
    }
    const dailyCap = getCampaignDailyCap(campaign);
    const usedToday = countCampaignEventsToday(campaign.id, now);
    if (usedToday >= dailyCap) {
      skipped.push({ campaignId: campaign.id, status, reason: `Daily cap reached (${usedToday}/${dailyCap}).` });
      continue;
    }
    const leads = getCampaignLeads(campaign.id).filter((lead) => !isCampaignLeadTerminal(lead));
    for (const lead of leads) {
      if (processed.length >= limit) break;
      if (countCampaignEventsToday(campaign.id, now) >= dailyCap) {
        skipped.push({ campaignId: campaign.id, leadId: lead.leadId, reason: 'Daily cap reached during run.' });
        break;
      }
      const result = await processCampaignLeadStep(campaign, lead, {
        now,
        dryRun,
        allowProviderWrites,
      });
      processed.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        leadId: lead.leadId || lead.id,
        leadName: lead.leadName,
        result: result.result,
        dryRun: Boolean(result.dryRun),
        eventId: result.event?.id || '',
        reason: result.reason || result.verbiage || '',
      });
    }
    const latestCampaign = (state.campaigns || []).find((item) => item.id === campaign.id) || campaign;
    const campaignPatch = {
      ...latestCampaign,
      metrics: calculateCampaignMetrics(latestCampaign),
      lastWorkerRunAt: now.toISOString(),
      updatedAt: isoNow(),
    };
    upsertById(state, 'campaigns', campaignPatch);
    await persistCampaignRecord(campaignPatch);
  }

  const run = {
    id: `campaign-worker-${Date.now()}-${randomUUID().slice(0, 8)}`,
    status: dryRun ? 'dry-run' : 'complete',
    result: dryRun ? 'local_view_only' : processed.some((item) => item.result === 'provider_missing') ? 'provider_missing' : 'live',
    dryRun,
    allowProviderWrites,
    processedCount: processed.length,
    skippedCount: skipped.length,
    processed,
    skipped: skipped.slice(0, 40),
    createdAt: isoNow(),
    actor: options.actor || 'Campaign worker',
  };
  addAdminAudit(state, {
    id: `audit-${run.id}`,
    action: 'campaign_worker_run',
    provider: 'pbk-bridge',
    actor: run.actor,
    status: run.status,
    summary: `Campaign worker ${run.status}: ${processed.length} processed, ${skipped.length} skipped.`,
    details: run,
    createdAt: run.createdAt,
    updatedAt: run.createdAt,
  });
  addActivity(
    state,
    makeActivity({
      actor: run.actor,
      category: 'CAMPAIGN',
      status: run.status,
      text: `Campaign worker ${run.status}: ${processed.length} due step${processed.length === 1 ? '' : 's'} processed.`,
      target: 'campaign-runner',
    }),
  );
  await persistCampaignWorkerRunRecord(run);
  await persistState(state);
  return {
    ok: true,
    result: run.result,
    verbiage: dryRun ? 'Campaign worker dry run complete' : 'Campaign worker run complete',
    run,
    state: buildStateSnapshot(),
  };
}

function findCampaignByProviderReference(payload = {}) {
  ensureCampaignCollections();
  const campaignId = String(payload.campaignId || payload.campaign_id || payload.metadata?.campaignId || payload.data?.campaign_id || '').trim();
  if (campaignId) {
    const direct = (state.campaigns || []).find((campaign) => campaign.id === campaignId);
    if (direct) return direct;
  }
  const providerCampaignId = String(
    payload.providerCampaignId
      || payload.provider_campaign_id
      || payload.campaign_id
      || payload.campaignId
      || payload.data?.campaign_id
      || payload.data?.campaignId
      || '',
  ).trim();
  if (!providerCampaignId) return null;
  return (state.campaigns || []).find((campaign) =>
    String(campaign.providerCampaignId || '').trim() === providerCampaignId
    || String(campaign.approvalId || '').trim() === providerCampaignId);
}

function recordCampaignWebhookFromPayload(provider = '', payload = {}, eventType = '') {
  const campaign = findCampaignByProviderReference(payload);
  if (!campaign) return null;
  const leadId = String(payload.leadId || payload.lead_id || payload.contact?.leadId || payload.contact?.id || payload.data?.lead_id || '').trim();
  const email = String(payload.email || payload.contact?.email || payload.data?.email || '').trim().toLowerCase();
  const phone = normalizePhone(payload.phone || payload.to || payload.from || payload.contact?.phone || payload.data?.phone || '');
  const campaignLead = getCampaignLeads(campaign.id).find((lead) =>
    (leadId && String(lead.leadId || '') === leadId)
    || (email && String(lead.email || '').trim().toLowerCase() === email)
    || (phone && normalizePhone(lead.phone) === phone));
  const normalizedType = String(eventType || payload.event || payload.type || payload.status || payload.data?.event_type || 'provider_event').toLowerCase();
  const event = recordCampaignEvent({
    campaignId: campaign.id,
    campaignLeadId: campaignLead?.id || '',
    leadId: campaignLead?.leadId || leadId,
    eventType: normalizedType,
    channel: payload.channel || campaign.channel,
    provider,
    providerEventId: payload.id || payload.eventId || payload.event_id || payload.data?.id || '',
    providerStatus: payload.status || payload.data?.status || normalizedType,
    payload,
    occurredAt: payload.occurredAt || payload.timestamp || payload.data?.occurred_at || isoNow(),
  });
  if (campaignLead) {
    const status = /reply|open|click|delivered|answered|completed|failed|bounce|unsubscribe|stop|opt_out/.test(normalizedType)
      ? normalizedType.replace(/[^a-z0-9]+/g, '_')
      : campaignLead.status;
    patchCampaignLead(campaignLead.id, {
      status,
      lastTouchAt: isoNow(),
      metadata: {
        ...(campaignLead.metadata || {}),
        lastProviderEvent: normalizedType,
      },
    });
  }
  const updatedCampaign = {
    ...campaign,
    metrics: calculateCampaignMetrics(campaign),
    updatedAt: isoNow(),
  };
  upsertById(state, 'campaigns', updatedCampaign);
  void persistCampaignRecord(updatedCampaign);
  if (/unsubscribe|stop|opt_out/.test(normalizedType)) {
    const suppression = {
      id: `campaign-suppression-${campaign.id}-${campaignLead?.leadId || leadId || email || phone || Date.now()}`,
      leadId: campaignLead?.leadId || leadId || email || phone || '',
      email,
      phone,
      address: campaignLead?.address || payload.address || payload.contact?.address || '',
      channel: campaign.channel,
      reason: normalizedType,
      source: provider,
      metadata: { campaignId: campaign.id, eventId: event.id },
      createdAt: isoNow(),
    };
    upsertById(state, 'campaignSuppressions', suppression);
    void persistCampaignSuppressionRecord(suppression);
  }
  return { campaign, campaignLead, event };
}

function splitLeadName(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

function buildInstantlyCampaignPayload({ approval = {}, leads = [] } = {}) {
  const metadata = approval.metadata || {};
  const providerConfig = getCampaignProviderConfig(metadata);
  const fromEmail = providerConfig.fromEmail || INSTANTLY_DEFAULT_FROM_EMAIL || getSenderAddress('cold');
  const templateId = metadata.templateId || metadata.campaignTemplateId || approval.templateId || '';
  const campaignName = metadata.campaignName
    || approval.campaignName
    || `PBK approved campaign ${approval.id || new Date().toISOString().slice(0, 10)}`;
  const contacts = leads
    .filter((lead) => lead.email)
    .map((lead) => {
      const nameParts = splitLeadName(lead.leadName);
      return {
        email: lead.email,
        first_name: nameParts.firstName,
        last_name: nameParts.lastName,
        phone: lead.phone || '',
        company_name: '',
        personalization: {
          leadId: lead.leadId || '',
          address: lead.address || '',
          tags: lead.tags || [],
        },
        custom_variables: {
          lead_id: lead.leadId || '',
          seller_name: lead.leadName || '',
          property_address: lead.address || '',
          phone: lead.phone || '',
        },
      };
    });
  return {
    name: campaignName,
    campaign_name: campaignName,
    template_id: templateId,
    templateId,
    from: fromEmail,
    from_email: fromEmail,
    sender_email: fromEmail,
    senderEmail: fromEmail,
    leads: contacts,
    contacts,
    metadata: {
      approvalId: approval.id || '',
      source: 'pbk-approval-worker',
      leadCount: leads.length,
      emailLeadCount: contacts.length,
      fromEmail,
    },
  };
}

async function createInstantlyCampaignForApproval({ approval = {}, leads = [] } = {}) {
  if (!INSTANTLY_API_KEY) {
    return {
      ok: false,
      result: 'provider_missing',
      provider: 'instantly',
      error: 'Email provider not configured - add PBK_INSTANTLY_API_KEY in Render/OpenClaw.',
    };
  }
  const emailLeads = leads.filter((lead) => lead.email);
  if (!emailLeads.length) {
    return {
      ok: false,
      result: 'unavailable',
      provider: 'instantly',
      error: 'No campaign leads have email addresses, so Instantly campaign creation was skipped.',
    };
  }
  const payload = buildInstantlyCampaignPayload({ approval, leads: emailLeads });
  const response = await fireInstantlyRequest(INSTANTLY_CAMPAIGN_CREATE_ENDPOINT, payload);
  const providerCampaignId =
    response?.body?.id
    || response?.body?.campaign_id
    || response?.body?.campaignId
    || response?.body?.data?.id
    || '';
  return {
    ok: Boolean(response.ok),
    result: response.ok ? 'live' : 'provider_missing',
    provider: 'instantly',
    endpoint: INSTANTLY_CAMPAIGN_CREATE_ENDPOINT,
    providerCampaignId,
    request: {
      name: payload.name,
      leadCount: payload.metadata.emailLeadCount,
      templateId: payload.template_id || '',
      fromEmail: payload.from_email || '',
    },
    response,
    error: response.ok ? '' : response.error || 'Instantly campaign create request failed.',
  };
}

async function executeApprovedCampaign(approval = {}, options = {}) {
  if (String(approval.status || '').toLowerCase() !== 'approved') {
    return {
      ok: false,
      result: 'queued_for_approval',
      verbiage: 'Campaign queued for approval',
      error: 'Campaign execution waits until the approval status is approved.',
    };
  }

  const existing = (state.campaignExecutions || []).find((item) => item.approvalId === approval.id);
  if (existing) {
    return {
      ok: true,
      result: 'live',
      verbiage: 'Campaign execution already started',
      execution: existing,
    };
  }

  const leads = getApprovalCampaignLeads(approval);
  const instantlyResult = await createInstantlyCampaignForApproval({ approval, leads });
  const startAt = Date.now();
  const steps = leads.flatMap((lead, leadIndex) => {
    const baseOffset = leadIndex * 60 * 60 * 1000;
    return [
      {
        id: `step-${lead.leadId || leadIndex}-email`,
        leadId: lead.leadId,
        leadName: lead.leadName,
        channel: 'email',
        status: instantlyResult.ok && lead.email ? 'sent_to_provider' : INSTANTLY_API_KEY && lead.email ? 'provider_error' : 'provider_missing',
        scheduledAt: new Date(startAt + baseOffset).toISOString(),
        providerCampaignId: instantlyResult.providerCampaignId || '',
        verbiage: instantlyResult.ok && lead.email
          ? 'Email campaign sent to Instantly'
          : lead.email
            ? instantlyResult.error || 'Instantly campaign create failed'
            : 'Lead has no email address for campaign enrollment',
      },
      {
        id: `step-${lead.leadId || leadIndex}-sms`,
        leadId: lead.leadId,
        leadName: lead.leadName,
        channel: 'sms',
        status: getTelnyxProviderMeta().messagingReady ? 'scheduled' : 'provider_missing',
        scheduledAt: new Date(startAt + baseOffset + 24 * 60 * 60 * 1000).toISOString(),
        verbiage: getTelnyxProviderMeta().messagingReady ? 'SMS scheduled' : 'Phone provider not configured - add Telnyx API key and number',
      },
      {
        id: `step-${lead.leadId || leadIndex}-call`,
        leadId: lead.leadId,
        leadName: lead.leadName,
        channel: 'voice',
        status: getTelnyxProviderMeta().voiceReady ? 'scheduled' : 'provider_missing',
        scheduledAt: new Date(startAt + baseOffset + 3 * 24 * 60 * 60 * 1000).toISOString(),
        verbiage: getTelnyxProviderMeta().voiceReady ? 'Call scheduled' : 'Phone provider not configured - add Telnyx API key and number',
      },
    ];
  });

  const execution = {
    id: `campaign-exec-${approval.id || Date.now()}`,
    campaignId: approval.metadata?.campaignId || '',
    approvalId: approval.id || '',
    result: 'live',
    status: instantlyResult.ok ? 'provider-started' : 'scheduled-with-provider-gaps',
    mode: 'approval-gated-production',
    providerCampaignId: instantlyResult.providerCampaignId || '',
    instantly: instantlyResult,
    leadCount: leads.length,
    stepCount: steps.length,
    providerMissingCount: steps.filter((step) => step.status === 'provider_missing').length,
    leads,
    steps,
    notes: approval.notes || '',
    createdAt: isoNow(),
    updatedAt: isoNow(),
    actor: options.actor || approval.actor || 'Approval worker',
  };
  upsertById(state, 'campaignExecutions', execution);
  await persistCampaignExecutionRecord(execution);
  const campaignId = approval.metadata?.campaignId || '';
  if (campaignId) {
    const campaign = (state.campaigns || []).find((item) => item.id === campaignId);
    if (campaign) {
      const nextCampaign = {
        ...campaign,
        status: instantlyResult.ok ? 'active' : 'provider_missing',
        approvalStatus: 'approved',
        pendingAction: '',
        executionId: execution.id,
        providerCampaignId: instantlyResult.providerCampaignId || campaign.providerCampaignId || '',
        metrics: {
          ...calculateCampaignMetrics(campaign),
          providerMissingCount: execution.providerMissingCount,
        },
        updatedAt: isoNow(),
      };
      upsertById(state, 'campaigns', nextCampaign);
      await persistCampaignRecord(nextCampaign);
      recordCampaignEvent({
        campaignId,
        eventType: 'execution_started',
        channel: campaign.channel,
        provider: campaign.provider,
        providerStatus: instantlyResult.ok ? 'live' : 'provider_missing',
        payload: {
          executionId: execution.id,
          providerCampaignId: instantlyResult.providerCampaignId || '',
          providerMissingCount: execution.providerMissingCount,
        },
      });
    }
  }
  addActivity(
    state,
    makeActivity({
      actor: execution.actor,
      category: 'CAMPAIGN',
      status: 'scheduled',
      text: instantlyResult.ok
        ? `Approved campaign sent to Instantly for ${instantlyResult.request.leadCount} email lead${instantlyResult.request.leadCount === 1 ? '' : 's'}.`
        : `Approved campaign execution started locally, but Instantly is not live: ${instantlyResult.error || 'provider missing'}.`,
      target: approval.leadName || approval.address || 'campaign',
    }),
  );
  addAdminAudit(state, {
    id: `audit-campaign-${approval.id || Date.now()}`,
    action: 'campaign_start',
    provider: 'instantly',
    actor: execution.actor,
    status: instantlyResult.ok ? 'complete' : 'provider_missing',
    summary: instantlyResult.ok
      ? `Instantly campaign ${instantlyResult.providerCampaignId || '(created)'} started for ${instantlyResult.request.leadCount} lead${instantlyResult.request.leadCount === 1 ? '' : 's'}.`
      : instantlyResult.error || 'Instantly campaign creation skipped.',
    createdAt: isoNow(),
    updatedAt: isoNow(),
  });
  return {
    ok: true,
    result: instantlyResult.ok ? 'live' : instantlyResult.result || 'provider_missing',
    verbiage: instantlyResult.ok ? 'Campaign execution started' : 'Campaign queued with provider gaps',
    execution,
  };
}

async function applyApprovedPromptPatch(approval = {}, options = {}) {
  if (String(approval.status || '').toLowerCase() !== 'approved') {
    return {
      ok: false,
      result: 'queued_for_approval',
      verbiage: 'Change requested - awaiting approval',
      error: 'Prompt changes are only applied after approval.',
    };
  }

  const requestedPatch = String(
    approval.metadata?.promptPatch
      || approval.metadata?.requestedPromptChange
      || approval.notes
      || '',
  ).trim();
  if (!requestedPatch) {
    return {
      ok: false,
      result: 'unavailable',
      verbiage: 'Prompt apply unavailable - no approved patch text',
      error: 'Approved prompt edit did not include patch text.',
    };
  }

  const targetFile = String(approval.metadata?.targetFile || approval.address || 'wholesale.agent.md').trim();
  const application = {
    id: `prompt-apply-${approval.id || Date.now()}`,
    approvalId: approval.id || '',
    result: 'live',
    status: 'applied-to-runtime-store',
    targetFile,
    promptPatch: requestedPatch,
    actor: options.actor || approval.actor || 'Rex',
    createdAt: isoNow(),
    updatedAt: isoNow(),
    fileWrite: {
      attempted: false,
      ok: false,
      reason: PROMPT_FILE_PATCH_ENABLED
        ? ''
        : 'PBK_ALLOW_PROMPT_FILE_PATCH is not enabled; approved change was stored in bridge settings.',
    },
  };

  const settings = ensureRuntimeSettings(state);
  state.settings = {
    ...settings,
    agentPrompts: {
      ...(settings.agentPrompts || {}),
      ava: {
        latestApprovedChange: requestedPatch,
        targetFile,
        approvalId: approval.id || '',
        appliedAt: application.createdAt,
        appliedBy: application.actor,
      },
    },
    updatedAt: isoNow(),
    updatedBy: application.actor,
  };

  if (PROMPT_FILE_PATCH_ENABLED) {
    application.fileWrite.attempted = true;
    const resolvedTarget = path.resolve(ROOT_DIR, targetFile);
    if (!resolvedTarget.startsWith(ROOT_DIR) || !existsSync(resolvedTarget)) {
      application.fileWrite.reason = 'Target prompt file is missing or outside the PBK repo.';
    } else {
      const current = await readFile(resolvedTarget, 'utf8');
      const block = [
        '',
        '<!-- PBK approved prompt change',
        `approvalId: ${approval.id || ''}`,
        `appliedAt: ${application.createdAt}`,
        requestedPatch,
        '-->',
        '',
      ].join('\n');
      await writeFile(resolvedTarget, `${current.replace(/\s*$/u, '')}${block}`, 'utf8');
      application.status = 'applied-to-file';
      application.fileWrite.ok = true;
      application.fileWrite.path = resolvedTarget;
    }
  }

  upsertById(state, 'promptPatchApplications', application);
  addActivity(
    state,
    makeActivity({
      actor: application.actor,
      category: 'PROMPT',
      status: 'applied',
      text: application.fileWrite.ok
        ? `Approved Ava prompt patch applied to ${targetFile}.`
        : `Approved Ava prompt patch applied to runtime prompt store.`,
      target: targetFile,
    }),
  );
  return {
    ok: true,
    result: 'live',
    verbiage: 'Prompt change applied',
    application,
  };
}

function isDemoActivity(item = {}) {
  const text = String(item.text || '');
  return item.source === 'demo'
    || /Requested approval for \$78,000 offer|Analyzer ran - ARV \$185k|daily_probate_import\.csv|Indexed 3 new sources/i.test(text);
}

function buildNotificationSnapshot() {
  const approvals = (state.approvals || [])
    .filter((approval) => String(approval.status || '').toLowerCase() === 'pending')
    .slice(0, 8)
    .map((approval) => ({
      id: approval.id,
      type: 'approval',
      title: `${approval.type || 'Approval'} needed${approval.offerPrice ? ` - ${formatMoneyCompact(approval.offerPrice)}` : ''}`,
      desc: [approval.leadName, approval.address, approval.notes].filter(Boolean).join(' - '),
      at: approval.createdAt,
      unread: true,
    }));
  const admin = (state.adminTasks || [])
    .filter((task) => String(task.status || '').toLowerCase() === 'pending')
    .slice(0, 6)
    .map((task) => ({
      id: task.id,
      type: 'system',
      title: `${task.kind || task.action || 'Admin'} approval queued`,
      desc: task.summary || task.reason || task.notes || 'Admin task waiting for review.',
      at: task.createdAt,
      unread: true,
    }));
  const calls = (state.calls || [])
    .slice(0, 5)
    .map((call) => ({
      id: call.id,
      type: 'call',
      title: `${call.status || 'Call'} - ${call.leadName || call.phone || 'Unknown lead'}`,
      desc: [call.address, call.phone].filter(Boolean).join(' - '),
      at: call.updatedAt || call.startedAt || call.createdAt,
      unread: String(call.status || '').toLowerCase() === 'live',
    }));
  const system = (state.activity || [])
    .filter((item) => !isDemoActivity(item))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      type: String(item.category || 'system').toLowerCase().includes('call') ? 'call' : 'system',
      title: item.text || item.category || 'Runtime event',
      desc: [item.actor, item.target].filter(Boolean).join(' - '),
      at: item.at || item.createdAt,
      unread: false,
    }));
  const notifications = sortNewest([...approvals, ...admin, ...calls, ...system]).slice(0, 16);
  return {
    ok: true,
    result: 'live',
    counts: {
      all: notifications.length,
      approvals: notifications.filter((item) => item.type === 'approval').length,
      calls: notifications.filter((item) => item.type === 'call').length,
      system: notifications.filter((item) => item.type === 'system').length,
      unread: notifications.filter((item) => item.unread).length,
    },
    notifications,
  };
}

function createSilentWavBuffer(durationSeconds = 0.6, sampleRate = 8000) {
  const samples = Math.max(1, Math.floor(Math.max(0.1, durationSeconds) * sampleRate));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
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
    sendersEndpoint: INSTANTLY_SENDERS_ENDPOINT,
    defaultFromEmail: INSTANTLY_DEFAULT_FROM_EMAIL,
    warmupEndpoint: INSTANTLY_WARMUP_ENABLE_ENDPOINT,
    domainOrderEndpoint: INSTANTLY_DOMAIN_ORDER_ENDPOINT,
    missing: INSTANTLY_API_KEY ? [] : ['PBK_INSTANTLY_API_KEY'],
  };
}

function getCampaignWorkerMeta() {
  const providerWritesReady = Boolean(CAMPAIGN_WORKER_ENABLED && CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES);
  return {
    configured: CAMPAIGN_WORKER_ENABLED,
    ready: providerWritesReady,
    dryRunDefault: !providerWritesReady,
    maxStepsPerRun: CAMPAIGN_WORKER_MAX_STEPS,
    retryProviderMissing: CAMPAIGN_WORKER_RETRY_PROVIDER_MISSING,
    missing: CAMPAIGN_WORKER_ENABLED
      ? (CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES ? [] : ['PBK_CAMPAIGN_WORKER_CONFIRM_PROVIDER_WRITES'])
      : ['PBK_CAMPAIGN_WORKER_ENABLED'],
    note: providerWritesReady
      ? 'Campaign runner can perform provider writes when scheduled.'
      : 'Campaign runner is dry-run/approval-safe until explicitly enabled.',
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
function compactSlackText(value = '', fallback = '') {
  return String(value || fallback || '').replace(/\s+/g, ' ').trim().slice(0, 2900);
}

async function fireSlackApi(method = '', payload = {}) {
  if (!SLACK_BOT_TOKEN) {
    return { ok: false, skipped: true, result: 'provider_missing', error: 'PBK_SLACK_BOT_TOKEN is not set.' };
  }
  try {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let body = {};
    try {
      body = JSON.parse(responseText || '{}');
    } catch {
      body = { raw: responseText };
    }
    return {
      ok: response.ok && body?.ok !== false,
      status: response.status,
      body,
      error: response.ok && body?.ok !== false ? '' : (body?.error || `Slack API returned ${response.status}`),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Slack API request failed.' };
  }
}

function buildSlackApprovalBlocks(approval = {}) {
  const approvalType = compactSlackText(approval.type || 'approval', 'approval');
  const actionLabel = compactSlackText(approval.approvalAction || approval.metadata?.requestedAction || 'approval_required');
  const amount = toNumber(approval.offerPrice, 0) ? currency(approval.offerPrice) : 'n/a';
  const campaignName = approval.metadata?.campaignName || approval.metadata?.campaignId || '';
  const summary = [
    `*Seller:* ${compactSlackText(approval.leadName, 'Unknown seller')}`,
    `*Property:* ${compactSlackText(approval.address, 'Unknown property')}`,
    `*Action:* ${actionLabel}`,
    campaignName ? `*Campaign:* ${compactSlackText(campaignName)}` : '',
    amount !== 'n/a' ? `*Offer:* ${amount}` : '',
  ].filter(Boolean).join('\n');
  const notes = compactSlackText(approval.notes || approval.metadata?.statusMessage || '');
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `PBK ${approvalType} approval`, emoji: false },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${summary}${notes ? `\n\n_${notes}_` : ''}` },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Approval ID \`${approval.id || 'pending'}\` - PBK will only execute after an approved callback.`,
        },
      ],
    },
    {
      type: 'actions',
      block_id: `pbk_approval_${String(approval.id || '').slice(0, 40) || 'pending'}`,
      elements: [
        {
          type: 'button',
          action_id: 'pbk_approval_approve',
          text: { type: 'plain_text', text: 'Approve', emoji: false },
          style: 'primary',
          value: approval.id || '',
        },
        {
          type: 'button',
          action_id: 'pbk_approval_reject',
          text: { type: 'plain_text', text: 'Reject', emoji: false },
          style: 'danger',
          value: approval.id || '',
        },
        {
          type: 'button',
          action_id: 'pbk_approval_modify',
          text: { type: 'plain_text', text: 'Modify', emoji: false },
          value: approval.id || '',
        },
      ],
    },
  ];
}

async function postSlackApproval(approval = {}) {
  if (!SLACK_BOT_TOKEN || !SLACK_APPROVAL_CHANNEL_ID) {
    return {
      ok: false,
      skipped: true,
      result: 'provider_missing',
      error: 'Slack interactive approvals need PBK_SLACK_BOT_TOKEN and PBK_SLACK_APPROVAL_CHANNEL_ID.',
    };
  }
  const result = await fireSlackApi('chat.postMessage', {
    channel: SLACK_APPROVAL_CHANNEL_ID,
    text: `PBK approval needed: ${approval.type || 'approval'} for ${approval.leadName || approval.address || approval.id}`,
    blocks: buildSlackApprovalBlocks(approval),
    metadata: {
      event_type: 'pbk_approval_request',
      event_payload: {
        approvalId: approval.id || '',
        approvalType: approval.type || '',
      },
    },
  });
  if (result.ok) {
    approval.slackMessage = {
      channel: result.body?.channel || SLACK_APPROVAL_CHANNEL_ID,
      ts: result.body?.ts || '',
      postedAt: isoNow(),
    };
  }
  return {
    ...result,
    result: result.ok ? 'queued_for_approval' : (result.result || 'provider_missing'),
    verbiage: result.ok ? 'Slack approval posted' : 'Slack approval not posted',
  };
}

async function updateSlackApprovalMessage({ channel = '', ts = '', approval = {}, status = '', actor = '' } = {}) {
  if (!SLACK_BOT_TOKEN || !channel || !ts) {
    return { ok: false, skipped: true, error: 'Slack message update skipped.' };
  }
  const normalizedStatus = String(status || approval.status || '').toLowerCase();
  const approved = normalizedStatus === 'approved';
  const rejected = normalizedStatus === 'rejected';
  const needsRevision = normalizedStatus === 'needs_revision' || normalizedStatus === 'needs_modification';
  const label = approved ? 'approved' : rejected ? 'rejected' : needsRevision ? 'sent back for modification' : normalizedStatus || 'updated';
  return fireSlackApi('chat.update', {
    channel,
    ts,
    text: `PBK approval ${label}: ${approval.leadName || approval.address || approval.id}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*PBK approval ${label}*\n${compactSlackText(approval.leadName || approval.address || approval.id)}\nActor: ${compactSlackText(actor || approval.actor || 'Slack')}`,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Approval ID \`${approval.id || ''}\` - ${isoNow()}` }],
      },
    ],
  });
}

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
  let documentName = params.documentName || 'PBK Master Deal Package.pdf';
  if (!documentBase64 && params.templatePath && /\.pdf$/i.test(String(params.templatePath))) {
    const resolvedTemplatePath = resolveContractLibraryPath(params.templatePath);
    if (resolvedTemplatePath) {
      try {
        documentBase64 = (await readFile(resolvedTemplatePath)).toString('base64');
        documentName = params.documentName || path.basename(resolvedTemplatePath);
      } catch {
        documentBase64 = '';
      }
    }
  }
  if (!documentBase64) {
    try {
      const contractLabel =
        params.selectedPathLabel ||
        params.contractType ||
        params.template ||
        params.templateId ||
        params.selectedPath ||
        'PBK Contract';
      const pdfBuffer = await generatePdfDocument({
        documentTitle: params.documentTitle || `${contractLabel} - ${params.address || params.leadName || 'PBK contract'}`,
        propertyAddress: params.address || '',
        leadName: params.leadName || '',
        amount: params.amount,
        selectedPathLabel: contractLabel,
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
    emailSubject: params.emailSubject || `${params.selectedPathLabel || params.contractType || params.template || params.templateId || 'PBK Contract'} - ${params.address || params.leadName || 'Probono Key Realty'}`,
    status: params.dryRun ? 'created' : 'sent',
    documents: [{
      documentBase64,
      name: documentName,
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
await seedMemoryAnalyticsStateToPg();
const analyzerResultCache = new Map();

function buildAnalyzerCacheKey(params = {}) {
  const deal = params.deal || {};
  const propertyData = params.propertyData || params.browserData || params.enrichmentData || deal.propertyData || {};
  const relevant = {
    address: normalizeAddressKey(params.address || deal.address || params.propertyAddress || ''),
    selectedPath: params.selectedPath || deal.selectedPath || deal.path || '',
    price: params.price || deal.price || deal.agreedPrice || '',
    arv: params.arv || deal.arv || '',
    mao: params.mao || deal.mao60 || '',
    repairs: params.repairs || params.repairsMid || deal?.repairs?.mid || '',
    beds: params.beds || deal.beds || '',
    baths: params.baths || deal.baths || '',
    sqft: params.sqft || deal.sqft || '',
    year: params.year || deal.year || '',
    dom: params.dom || deal.dom || '',
    propertyHash: propertyData && Object.keys(propertyData).length ? hashString(JSON.stringify(propertyData)) : '',
  };
  return hashString(JSON.stringify(relevant));
}

function getAnalyzerResultCache(params = {}) {
  if (params.force || params.noCache) return null;
  const key = buildAnalyzerCacheKey(params);
  const entry = analyzerResultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > ANALYZER_RESULT_CACHE_TTL_MS) {
    analyzerResultCache.delete(key);
    return null;
  }
  return {
    key,
    result: {
      ...entry.result,
      cache: {
        ...(entry.result.cache || {}),
        analyzer: 'hit',
        key,
        cachedAt: entry.cachedAt,
        ttlMs: ANALYZER_RESULT_CACHE_TTL_MS,
      },
    },
  };
}

function setAnalyzerResultCache(params = {}, result = {}) {
  const key = buildAnalyzerCacheKey(params);
  analyzerResultCache.set(key, {
    cachedAt: Date.now(),
    result: {
      ...result,
      cache: {
        ...(result.cache || {}),
        analyzer: 'write-through',
        key,
        ttlMs: ANALYZER_RESULT_CACHE_TTL_MS,
      },
    },
  });
  if (analyzerResultCache.size > 200) {
    const oldest = [...analyzerResultCache.entries()]
      .sort((left, right) => left[1].cachedAt - right[1].cachedAt)
      .slice(0, analyzerResultCache.size - 200);
    oldest.forEach(([oldKey]) => analyzerResultCache.delete(oldKey));
  }
}

const toolHandlers = {
  async analyzeDeal(params = {}) {
    recordToolUse('analyzeDeal');
    const cached = getAnalyzerResultCache(params);
    if (cached) return cached.result;

    const propertyResolution = await resolvePropertyDataForAnalyzer(params);
    const run = buildAnalyzerSummary({
      ...params,
      propertyData: propertyResolution.propertyData,
      enrichment: propertyResolution.enrichment,
    });
    addAnalyzerRun(state, run);
    addActivity(
      state,
      makeActivity({
        actor: 'System',
        category: 'ANALYZE',
        status: 'success',
        text: `Analyzer ran - ARV ${currency(run.arv)} - MAO ${currency(run.mao)} - target ${currency(run.targetOffer)} (${propertyResolution.enrichment.cache} property cache)`,
        target: run.address,
      }),
    );
    await persistState(state);
    setAnalyzerResultCache(params, run);
    return run;
  },

  async getPropertyData(params = {}) {
    recordToolUse('getPropertyData');
    const address = params.address || params.propertyAddress || params.deal?.address || '';
    const cache = findPropertyCacheEntry(address);
    let browserResearch = null;
    if (!cache.hit && params.queueBrowserResearch) {
      browserResearch = await queueBrowserPropertyResearch({
        address,
        requestedBy: params.requestedBy || 'Rex',
        source: params.source || 'property-cache-miss',
      });
      await persistState(state);
    }
    return {
      ok: Boolean(cache.hit),
      address,
      cache: {
        hit: cache.hit,
        expired: cache.expired,
        key: cache.key,
        ageMs: cache.ageMs,
        ttlDays: PROPERTY_CACHE_TTL_DAYS,
      },
      propertyData: cache.entry || null,
      browserResearch: browserResearch
        ? {
          ready: browserResearch.ready,
          job: browserResearch.job,
        }
        : null,
    };
  },

  async cachePropertyData(params = {}) {
    recordToolUse('cachePropertyData');
    const entry = upsertPropertyCacheEntry({
      address: params.address || params.propertyAddress,
      data: params.data || params.propertyData || params.browserData || params,
      source: params.source || 'browseros',
      provider: params.provider || 'browseros',
      status: params.status || 'ready',
    });
    if (!entry) {
      return {
        ok: false,
        error: 'cachePropertyData requires an address or data.address.',
      };
    }
    addActivity(
      state,
      makeActivity({
        actor: params.requestedBy || 'BrowserOS',
        category: 'CACHE',
        status: 'success',
        text: `Cached analyzer-ready property data for ${entry.address}.`,
        target: entry.address,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      propertyData: entry,
      cache: {
        key: entry.key,
        ttlDays: PROPERTY_CACHE_TTL_DAYS,
        expiresAt: entry.expiresAt,
      },
    };
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
    if (detected.provider === 'system' && detected.action === 'check_health') {
      const result = await toolHandlers.admin_check_health({
        ...params,
        requestedBy,
      });
      return {
        ok: true,
        routedTo: 'admin_check_health',
        provider: 'system',
        mode: 'inspect',
        answer: 'I checked PBK runtime health from the live bridge snapshot.',
        result,
      };
    }
    if (detected.provider === 'openclaw' && detected.action === 'inspect_gateway') {
      const result = await toolHandlers.admin_check_health({
        ...params,
        requestedBy,
      });
      return {
        ok: true,
        routedTo: 'admin_check_health',
        provider: 'openclaw',
        mode: 'inspect',
        answer: 'I checked the OpenClaw/PBK gateway health from the live bridge snapshot.',
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

  async admin_check_health(params = {}) {
    recordToolUse('admin_check_health');
    const snapshot = buildStateSnapshot();
    return {
      ok: true,
      outcome: 'live',
      checkedBy: params.requestedBy || 'Rex',
      checkedAt: isoNow(),
      service: 'pbk-local-openclaw',
      stateBackend: STATE_BACKEND,
      status: snapshot.status,
      providers: snapshot.status?.providers || {},
      supermemory: {
        configured: Boolean(SUPERMEMORY_API_KEY && SUPERMEMORY_API_URL),
        syncEnabled: SUPERMEMORY_SYNC_ENABLED,
      },
      summary: 'PBK bridge health snapshot returned from live runtime state.',
    };
  },

  async admin_restart_openclaw(params = {}) {
    recordToolUse('admin_restart_openclaw');
    const result = await toolHandlers.requestAdminAction({
      command: params.command || 'Restart OpenClaw gateway',
      requestedBy: params.requestedBy || 'Rex',
      provider: 'openclaw',
      action: 'restart_gateway',
      risk: 'medium',
      summary: 'Restart the OpenClaw gateway/container after approval.',
      requiresApproval: params.autoApprove === true || params.auto_approve === true ? false : true,
      dryRun: true,
      payload: {
        reason: params.reason || 'Rex admin request',
        requestedLiveRun: Boolean(params.autoApprove === true || params.auto_approve === true),
      },
      detected: {
        provider: 'openclaw',
        action: 'restart_gateway',
        risk: 'medium',
        summary: 'Restart the OpenClaw gateway/container after approval.',
      },
    });
    return {
      ...result,
      outcome: 'queued_for_approval',
      live: false,
      summary: 'OpenClaw restart was captured as an approval-gated admin task. No fake restart was claimed.',
    };
  },

  async admin_run_away_worker(params = {}) {
    recordToolUse('admin_run_away_worker');
    const result = await toolHandlers.requestAdminAction({
      command: params.command || 'Run PBK away-mode worker',
      requestedBy: params.requestedBy || 'Rex',
      provider: 'worker',
      action: 'run_away_worker',
      risk: 'medium',
      summary: 'Run the PBK away-mode worker after approval.',
      requiresApproval: params.autoApprove === true || params.auto_approve === true ? false : true,
      dryRun: true,
      payload: {
        reason: params.reason || 'Rex admin request',
        requestedLiveRun: Boolean(params.autoApprove === true || params.auto_approve === true),
      },
      detected: {
        provider: 'worker',
        action: 'run_away_worker',
        risk: 'medium',
        summary: 'Run the PBK away-mode worker after approval.',
      },
    });
    return {
      ...result,
      outcome: 'queued_for_approval',
      live: false,
      summary: 'Away-mode worker run was captured as an approval-gated admin task. No fake process execution was claimed.',
    };
  },

  async admin_update_env_var(params = {}) {
    recordToolUse('admin_update_env_var');
    const envVars = Array.isArray(params.envVars)
      ? params.envVars.map((key) => String(key || '').trim()).filter(Boolean)
      : params.key
        ? [String(params.key).trim()]
        : [];
    const result = await toolHandlers.requestAdminAction({
      command: params.command || `Update Render env ${envVars.join(', ') || 'variable'}`,
      requestedBy: params.requestedBy || 'Rex',
      provider: 'render',
      action: 'update_env_var',
      risk: 'high',
      summary: `Update Render/OpenClaw environment variable${envVars.length === 1 ? '' : 's'} after approval.`,
      requiresApproval: true,
      dryRun: true,
      payload: {
        envVars,
        envAssignments: Object.fromEntries(envVars.map((key) => [key, '[REDACTED]'])),
        hasSecretValue: Boolean(params.value),
      },
      detected: {
        provider: 'render',
        action: 'update_env_var',
        risk: 'high',
        summary: 'Update Render/OpenClaw environment variables after approval.',
      },
    });
    return {
      ...result,
      outcome: 'queued_for_approval',
      live: false,
      summary: 'Environment update was queued without storing secret values in browser-visible state.',
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
    const slack = await postSlackApproval(approval);
    if (slack.ok) {
      addActivity(
        state,
        makeActivity({
          actor: 'Slack',
          category: 'APPROVAL',
          status: 'queued',
          text: `Interactive approval posted for ${approval.leadName} at ${approval.address}`,
          target: approval.id,
        }),
      );
      await persistState(state);
    }
    return { approval, fanout, slack };
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
      ok: true,
      result: syncResult?.ok ? 'live' : syncResult?.skipped ? 'local_view_only' : 'provider_missing',
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

  async createBrainBlogPost(params = {}) {
    recordToolUse('createBrainBlogPost');
    const post = normalizeBrainBlogPost(params);
    addBrainBlogPost(state, post);
    await persistBrainBlogPostRecord(post);
    addActivity(
      state,
      makeActivity({
        actor: params.requestedBy || 'Rex',
        category: 'BRAIN_BLOG',
        status: 'indexed',
        text: `Published Brain Blog post: ${post.title}`,
        target: post.salesMentor || post.sourceName || 'Brain Blog',
      }),
    );
    state.status.weeklySources = toNumber(state.status.weeklySources, 0) + 1;
    await persistState(state);
    return {
      ok: true,
      result: 'live',
      post,
    };
  },

  async trainBrainBlogPost(params = {}) {
    recordToolUse('trainBrainBlogPost');
    const postId = String(params.id || params.postId || '').trim();
    const post = (state.brainBlogPosts || []).find((item) => item.id === postId);
    if (!post) {
      return {
        ok: false,
        result: 'unavailable',
        error: 'Brain Blog post not found.',
      };
    }

    const doc = {
      id: `rex-trained-${post.id}-${Date.now()}`,
      kind: 'coach-memory',
      topic: (post.revenueStreams || [])[0] || 'Wholesaling',
      title: `Train Rex: ${post.title}`,
      source: post.sourceName || 'Brain Blog',
      excerpt: post.summary,
      summary: [
        `Mentor: ${post.salesMentor || 'PBK Research'}`,
        `Technique: ${post.techniqueType || 'sales_knowledge'}`,
        `Revenue streams: ${(post.revenueStreams || []).join(', ') || 'Wholesaling'}`,
        '',
        post.summary || post.content || '',
        '',
        ...(post.keyTakeaways || []).map((item) => `- ${item}`),
      ].join('\n').trim(),
      citation: post.sourceUrl || `${post.sourceName || 'Brain Blog'} - ${post.title}`,
      createdAt: isoNow(),
      tags: normalizeStringList([...(post.tags || []), ...(post.revenueStreams || []), 'trained-rex', post.salesMentor]),
      trainedFromBlogPostId: post.id,
    };
    addBrainDoc(state, doc);
    post.trainedAt = isoNow();
    post.status = 'trained';
    post.updatedAt = post.trainedAt;
    addBrainBlogPost(state, post);
    await persistBrainBlogPostRecord(post);
    const supermemory = await syncRexMemoryToSupermemory(doc);
    addActivity(
      state,
      makeActivity({
        actor: params.requestedBy || 'Rex',
        category: 'BRAIN_BLOG',
        status: 'trained',
        text: `Rex trained on Brain Blog post: ${post.title}`,
        target: post.salesMentor || 'Brain Blog',
      }),
    );
    await persistState(state);
    return {
      ok: true,
      result: 'live',
      post,
      doc,
      supermemory,
    };
  },

  async harvestBrainBlog(params = {}) {
    recordToolUse('harvestBrainBlog');
    const harvest = await harvestBrainBlogFeeds({
      feeds: Array.isArray(params.feeds) ? params.feeds : null,
      limit: params.limit || 8,
    });
    const existingKeys = new Set((state.brainBlogPosts || []).flatMap((post) => [post.sourceUrl, post.contentHash, post.id].filter(Boolean)));
    const added = [];
    const skipped = [];
    for (const post of harvest.posts) {
      if (existingKeys.has(post.sourceUrl) || existingKeys.has(post.contentHash) || existingKeys.has(post.id)) {
        skipped.push(post);
        continue;
      }
      addBrainBlogPost(state, post);
      await persistBrainBlogPostRecord(post);
      existingKeys.add(post.sourceUrl);
      existingKeys.add(post.contentHash);
      existingKeys.add(post.id);
      added.push(post);
    }
    if (added.length) {
      addActivity(
        state,
        makeActivity({
          actor: params.requestedBy || 'Brain Harvester',
          category: 'BRAIN_BLOG',
          status: 'indexed',
          text: `Harvested ${added.length} new Brain Blog post${added.length === 1 ? '' : 's'}.`,
          target: 'Brain Blog',
        }),
      );
      state.status.weeklySources = toNumber(state.status.weeklySources, 0) + added.length;
    }
    await persistState(state);
    return {
      ok: harvest.errors.length === 0 || added.length > 0,
      result: added.length ? 'live' : harvest.errors.length ? 'provider_missing' : 'local_view_only',
      added,
      skipped: skipped.length,
      errors: harvest.errors,
      feeds: harvest.feeds,
    };
  },

  async recordMarketIntel(params = {}) {
    recordToolUse('recordMarketIntel');
    const entry = {
      id: params.id || `market-intel-${Date.now()}`,
      market: params.market || params.city || 'Unknown market',
      zipCode: extractZipCode(params.zipCode || params.address || ''),
      propertyType: normalizePropertyType(params.propertyType || ''),
      competitiveOfferIndex: Math.max(0, Math.min(1, Number(params.competitiveOfferIndex ?? params.offerIndex ?? 0.5))),
      buyerDemand: params.buyerDemand || params.demand || 'unknown',
      medianInvestorMaoPct: Math.max(0, Math.min(1, Number(params.medianInvestorMaoPct ?? params.maoPct ?? 0.65))),
      daysOnMarketSignal: Math.max(0, Number(params.daysOnMarketSignal ?? params.dom ?? 0)),
      confidence: Math.max(0, Math.min(1, Number(params.confidence ?? 0.55))),
      source: params.source || 'manual',
      status: params.status || 'live',
      notes: params.notes || 'Market intel captured for Competitive Offer Index.',
      metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {},
      createdAt: params.createdAt || isoNow(),
      updatedAt: isoNow(),
    };
    upsertById(state, 'marketIntel', entry);
    await persistMarketIntelRecord(entry);
    addActivity(state, makeActivity({
      actor: params.requestedBy || 'Market Intel',
      category: 'MARKET_INTEL',
      status: 'indexed',
      text: `Updated Competitive Offer Index for ${entry.zipCode || entry.market}.`,
      target: entry.market,
    }));
    await persistState(state);
    return { ok: true, result: 'live', entry, state: buildStateSnapshot() };
  },

  async planLeadNurture(params = {}) {
    recordToolUse('planLeadNurture');
    const context = findLeadContext(params);
    const leadId = params.leadId || context.leadId || `lead-${slugify(context.leadName || params.leadName || 'unknown')}`;
    const approval = await toolHandlers.createApproval({
      type: 'lead-nurture',
      leadId,
      leadName: context.leadName || params.leadName || 'Lead',
      address: context.address || params.address || '',
      notes: 'Lead nurture sequence requested. Email/SMS/voice touches stay approval-gated before provider sends.',
      source: params.source || 'lead-nurture-agent',
    });
    const plan = {
      id: params.id || `nurture-${leadId}-${Date.now()}`,
      leadId,
      leadName: context.leadName || params.leadName || 'Lead',
      address: context.address || params.address || '',
      status: 'approval_required',
      cadenceDays: params.cadenceDays || [7, 14, 30],
      channels: normalizeStringList(params.channels || ['email', 'sms', 'voice']),
      steps: params.steps || [
        { day: 7, channel: 'email', label: 'Market update follow-up', status: 'queued_for_approval' },
        { day: 14, channel: 'sms', label: 'Short seller check-in', status: 'queued_for_approval' },
        { day: 30, channel: 'task', label: 'Archive or human handoff review', status: 'queued_for_approval' },
      ],
      approvalId: approval?.approval?.id || approval?.id || '',
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    upsertById(state, 'leadNurturePlans', plan);
    await persistLeadNurturePlanRecord(plan);
    addActivity(state, makeActivity({
      actor: 'Lead Nurture',
      category: 'NURTURE',
      status: 'queued',
      text: `Queued approval-gated nurture plan for ${plan.leadName}.`,
      target: plan.address || plan.leadName,
    }));
    await persistState(state);
    return { ok: true, result: 'queued_for_approval', plan, approval, state: buildStateSnapshot() };
  },

  async simulateDealConfidence(params = {}) {
    recordToolUse('simulateDealConfidence');
    const simulation = {
      id: params.id || `deal-sim-${Date.now()}`,
      leadId: params.leadId || '',
      leadName: params.leadName || '',
      address: params.address || params.propertyAddress || '',
      pathType: params.pathType || params.path || 'cash',
      ...buildDealScenarioSet(params),
      assumptions: {
        source: params.source || 'deal-confidence-agent',
        propertyAge: params.propertyAge || '',
        condition: params.condition || '',
      },
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    upsertById(state, 'dealSimulations', simulation);
    await persistDealSimulationRecord(simulation);
    addActivity(state, makeActivity({
      actor: 'Deal Confidence',
      category: 'SIMULATION',
      status: simulation.probabilityOfLoss > 0.35 ? 'warning' : 'served',
      text: `Simulated ${simulation.address || 'deal'}: expected profit ${formatMoneyCompact(simulation.expectedProfit)}, loss risk ${Math.round(simulation.probabilityOfLoss * 100)}%.`,
      target: simulation.address || simulation.leadName || 'Analyzer',
    }));
    await persistState(state);
    return { ok: true, result: 'live', simulation, state: buildStateSnapshot() };
  },

  async matchBuyers(params = {}) {
    recordToolUse('matchBuyers');
    const deal = {
      address: params.address || params.propertyAddress || '',
      zipCode: params.zipCode || extractZipCode(params.address || ''),
      propertyType: normalizePropertyType(params.propertyType || ''),
      offer: params.offer || params.offerPrice || params.targetOffer || params.price,
      repairs: params.repairs || params.repairsMid || params.repairEstimate,
      roi: params.roi || params.expectedRoi || 0,
    };
    if (params.buyer && typeof params.buyer === 'object') {
      const buyer = {
        id: params.buyer.id || `buyer-${slugify(params.buyer.name || 'new')}-${Date.now()}`,
        status: 'active',
        createdAt: isoNow(),
        updatedAt: isoNow(),
        ...params.buyer,
      };
      upsertById(state, 'buyers', buyer);
      await persistBuyerRecord(buyer);
    }
    const matches = (state.buyers || [])
      .filter((buyer) => String(buyer.status || 'active').toLowerCase() === 'active')
      .map((buyer) => scoreBuyerMatch(buyer, deal))
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
    const record = {
      id: params.id || `buyer-match-${Date.now()}`,
      deal,
      matches,
      topBuyer: matches[0] || null,
      status: matches[0]?.score >= 70 ? 'strong_match' : matches[0]?.score >= 45 ? 'possible_match' : 'no_strong_match',
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    upsertById(state, 'buyerMatches', record);
    await persistBuyerMatchRecord(record);
    addActivity(state, makeActivity({
      actor: 'Buyer Pipeline',
      category: 'DISPO',
      status: record.status === 'strong_match' ? 'success' : 'served',
      text: record.topBuyer ? `Matched ${record.topBuyer.buyerName} at ${record.topBuyer.score}/100.` : 'No active buyer match found.',
      target: deal.address || deal.zipCode || 'Buyer Pipeline',
    }));
    await persistState(state);
    return { ok: true, result: 'live', match: record, state: buildStateSnapshot() };
  },

  async runSystemAudit(params = {}) {
    recordToolUse('runSystemAudit');
    const report = {
      ...buildSystemAuditReport(state),
      requestedBy: params.requestedBy || 'System Auditor',
    };
    upsertById(state, 'systemAuditReports', report);
    await persistSystemAuditReportRecord(report);
    addActivity(state, makeActivity({
      actor: 'System Auditor',
      category: 'AUDIT',
      status: report.status === 'healthy' ? 'success' : 'warning',
      text: `Cost/performance audit complete: ${report.status}, ${report.errorRate}% error rate, ${report.avgLatencyMs}ms avg latency.`,
      target: 'PBK runtime',
    }));
    await persistState(state);
    return { ok: true, result: 'live', report, state: buildStateSnapshot() };
  },

  async getBrainState(params = {}) {
    recordToolUse('getBrainState');
    const messages = normalizeConversationMessages(params.messages);
    const query = getLastUserMessage(messages, params.query || params.q || '');
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
      const result = {
        query,
        answer: researchResult?.answer || 'Browser research request queued.',
        citations: researchResult?.citations || [],
        browserResearch: researchResult?.job || null,
        brainDocs: state.brainDocs.slice(0, 8),
        brainBlogPosts: (state.brainBlogPosts || []).slice(0, 8),
        status: state.status,
      };
      result.memory = await storeRexConversationMemory(state, { ...params, query, messages }, result);
      await persistState(state);
      result.brainDocs = state.brainDocs.slice(0, 8);
      return result;
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
      const result = {
        query,
        answer: adminRoute?.answer || 'I treated that as an admin request and routed it through the bridge.',
        citations: ['PBK admin runtime', 'OpenClaw bridge'],
        admin: adminRoute,
        brainDocs: state.brainDocs.slice(0, 8),
        brainBlogPosts: (state.brainBlogPosts || []).slice(0, 8),
        status: state.status,
      };
      result.memory = await storeRexConversationMemory(state, { ...params, query, messages }, result);
      await persistState(state);
      result.brainDocs = state.brainDocs.slice(0, 8);
      return result;
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
    const memory = await storeRexConversationMemory(state, { ...params, query, messages }, response);
    await persistState(state);
    return {
      ...response,
      memory,
      brainDocs: state.brainDocs.slice(0, 8),
      brainBlogPosts: (state.brainBlogPosts || []).slice(0, 8),
      status: state.status,
    };
  },

  async launchBrowserResearch(params = {}) {
    recordToolUse('launchBrowserResearch');
    const structuredQuery = [params.goal, params.target ? `Target: ${params.target}` : ''].filter(Boolean).join('\n\n');
    const request = extractBrowserResearchRequest(params.query || params.command || params.prompt || structuredQuery || '');
    const toolingStatus = await buildToolingStatus();
    const browserOs = toolingStatus.browserOs || {};
    const ready = Boolean(browserOs.ready);
    const jobSlug = slugify(request.targetLabel || params.target || 'request') || randomUUID().slice(0, 8);
    const job = {
      id: `browser-research-${jobSlug}-${randomUUID().slice(0, 8)}`,
      createdAt: isoNow(),
      requestedBy: params.requestedBy || 'Rex',
      source: params.source || 'brain',
      provider: 'browseros',
      status: ready ? 'queued' : 'setup-required',
      query: request.query,
      goal: params.goal || '',
      targetUrl: request.targetUrl,
      targetLabel: request.targetLabel,
      target: params.target || request.targetUrl || request.targetLabel || '',
      site: request.source,
      endpoint: browserOs.endpoint || BROWSEROS_MCP_URL,
    };

    upsertBrowserResearchJob(state, job);
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
    const fromEmail = String(params.fromEmail || params.from_email || params.instantlySender || params.senderEmail || '').trim();
    const senderAddress = getSenderAddress('cold', fromEmail);

    if (INSTANTLY_API_KEY) {
      provider = 'Instantly';
      endpoint = instantlyEndpoint;
      delivery = await fireInstantlyRequest(instantlyEndpoint, {
        campaignId: params.campaignId || '',
        leadId: context.leadId,
        templateId,
        from: senderAddress,
        from_email: senderAddress,
        sender_email: senderAddress,
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
        from: senderAddress,
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

    const result = delivery?.ok ? 'live' : delivery?.result || 'provider_missing';
    return {
      ok: Boolean(delivery?.ok),
      result,
      verbiage: delivery?.ok
        ? 'Email sent'
        : delivery?.error || 'Email provider not configured - add Instantly or Resend credentials.',
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
    const callStrategy = buildCallStrategyFromProfile(participantProfile, params, context);
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
      const shouldStreamSentiment = Boolean(params.deepgramSentiment || params.streamSentiment || DEEPGRAM_STREAM_CALLS_ENABLED);
      const deepgramMeta = getDeepgramProviderMeta(process.env);
      const deepgramStreamUrl = shouldStreamSentiment && deepgramMeta.ready ? getTelnyxDeepgramStreamUrl(params) : '';
      if (deepgramStreamUrl) {
        requestPayload.stream_url = deepgramStreamUrl;
        requestPayload.stream_track = params.streamTrack || DEEPGRAM_STREAM_TRACK;
        requestPayload.stream_codec = params.streamCodec || DEEPGRAM_STREAM_CODEC;
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
    const templates = await getContractTemplateLibrary();
    const template = selectContractTemplate(templates, params);
    const selectedPath = template.pathId || template.id || inferContractPathFromParams(params);
    const contract = createContractRecord({
      ...params,
      selectedPath,
      selectedPathLabel: params.selectedPathLabel || template.name || selectedPath,
      templateId: params.templateId || template.id,
      templateFields: params.templateFields || template.fields || {},
      templateFieldMap: params.templateFieldMap || template.fieldMap || template.fields || {},
      contractPath: selectedPath,
      contractType: params.contractType || template.type || selectedPath,
      templatePath: params.templatePath || template.templatePath || '',
      templateFile: params.templateFile || template.templateFile || '',
      negotiationFile: params.negotiationFile || template.negotiationFile || '',
      negotiationPrompt: params.negotiationPrompt || template.negotiationScript || '',
    });

    let live = false;
    let envelope = null;
    let providerError = '';

    if (docusignMeta.ready) {
      const response = await fireDocuSignEnvelope({
        ...params,
        ...contract,
        signers: params.signers,
        documentBase64: params.documentBase64,
        documentName: params.documentName,
      });
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
      template,
      path: selectedPath,
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
      provider: emailResult.provider || 'resend',
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
      ok: true,
      result: emailResult.ok ? 'live' : 'provider_missing',
      verbiage: emailResult.ok ? 'Seller documents sent' : 'Email provider not configured - add Resend API key in Settings',
      delivery,
      email: emailResult,
      attachments: attachments.map((item) => item.filename),
    };
  },

  async prepareContract(params = {}) {
    recordToolUse('prepareContract');
    const templates = await getContractTemplateLibrary();
    const template = selectContractTemplate(templates, params);
    const selectedPath = template.pathId || template.id || inferContractPathFromParams(params);

    const contract = createContractRecord({
      ...params,
      status: 'prepared',
      provider: 'PBK Contract Prep',
      documentTitle: `${template.name} - ${params.address || params.leadName || 'PBK contract'}`,
      notes: params.notes || `Prepared from template ${template.name}.`,
      selectedPath,
      selectedPathLabel: params.selectedPathLabel || template.name || selectedPath,
    });
    contract.templateId = template.id;
    contract.templateFields = template.fields;
    contract.templateFieldMap = template.fieldMap || template.fields || {};
    contract.contractPath = selectedPath;
    contract.contractType = template.type || selectedPath;
    contract.templatePath = template.templatePath || '';
    contract.templateFile = template.templateFile || '';
    contract.negotiationFile = template.negotiationFile || '';
    contract.negotiationPrompt = template.negotiationScript || '';
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
      path: selectedPath,
      negotiationPrompt: template.negotiationScript || '',
      templatesAvailable: templates.map((item) => ({
        id: item.id,
        pathId: item.pathId,
        name: item.name,
        type: item.type,
        hasTemplate: item.hasTemplate,
        hasNegotiation: item.hasNegotiation,
      })),
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
        contractType: contract.contractType || '',
        negotiationFile: contract.negotiationFile || '',
        templatePath: contract.templatePath || '',
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

  async reloadContractTemplates(params = {}) {
    recordToolUse('reloadContractTemplates');
    const result = await reloadContractTemplateLibrary(params.reason || params.source || 'tool');
    addActivity(
      state,
      makeActivity({
        actor: params.actor || 'Rex',
        category: 'CONTRACT',
        status: result.ok ? 'synced' : 'warning',
        text: result.ok
          ? `Reloaded ${result.templates.length} contract path${result.templates.length === 1 ? '' : 's'} from the contracts folder.`
          : `Reloaded contract paths with ${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}.`,
        target: 'contracts',
      }),
    );
    await persistState(state);
    return result;
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
    let campaignResult = null;
    let promptResult = null;
    let rexDecisionResult = null;
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

    if (
      approval.status === 'approved'
      && String(approval.type || '').toLowerCase() === 'campaign'
    ) {
      campaignResult = await executeApprovedCampaign(approval, { actor: incomingActor });
    }

    if (
      approval.status === 'approved'
      && (
        String(approval.type || '').toLowerCase() === 'prompt-edit'
        || String(approval.approvalAction || '').toLowerCase() === 'prompt_patch'
      )
    ) {
      promptResult = await applyApprovedPromptPatch(approval, { actor: incomingActor });
    }

    if (
      String(approval.type || '').toLowerCase() === 'rex-decision'
      || String(approval.approvalAction || '').toLowerCase() === 'rex_apply'
    ) {
      rexDecisionResult = await handleRexDecisionApproval(approval, { actor: incomingActor });
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
      campaignResult,
      promptResult,
      rexDecisionResult,
    };
  }

  if (normalizedEvent === 'recording-capture' || normalizedEvent === 'call-recording') {
    return captureRecordingFromPayload(payload);
  }

  if (normalizedEvent === 'brain-doc') {
    return toolHandlers.ingestResearchDoc(payload);
  }

  if (normalizedEvent === 'lead-tag') {
    const tag = String(payload.tag || '').trim();
    const leads = Array.isArray(payload.leads) ? payload.leads : [payload];
    if (!tag) {
      return {
        ok: false,
        outcome: 'unavailable',
        error: 'Tag is required.',
      };
    }

    const updated = [];
    const missing = [];
    for (const lead of leads) {
      const matcher = {
        leadId: lead.leadId || lead.id || '',
        leadName: lead.leadName || lead.name || lead?.seller?.name || '',
        address: lead.address || lead?.property?.address || '',
        email: lead.email || lead?.seller?.email || '',
      };
      const existing = findLatestLeadImport(matcher);
      const nextTags = Array.from(new Set([
        ...((Array.isArray(existing?.tags) ? existing.tags : String(lead.tags || '').split(/[,\s]+/))
          .map((item) => String(item || '').trim())
          .filter(Boolean)),
        tag,
      ]));
      const patched = patchLeadImport(state, matcher, { tags: nextTags, lastTaggedAt: isoNow(), lastTaggedBy: payload.actor || 'Command Center' });
      if (patched) updated.push(patched);
      else missing.push(matcher.leadName || matcher.address || matcher.leadId || 'unknown lead');
    }

    addActivity(
      state,
      makeActivity({
        actor: payload.actor || 'Command Center',
        category: 'LEAD',
        status: updated.length ? 'success' : 'warning',
        text: updated.length
          ? `Applied lead tag "${tag}" to ${updated.length} lead${updated.length === 1 ? '' : 's'}.`
          : `Lead tag "${tag}" could not be applied because no matching lead imports were found.`,
        target: missing.length ? `Missing: ${missing.slice(0, 3).join(', ')}` : tag,
      }),
    );
    await persistState(state);
    return {
      ok: updated.length > 0,
      outcome: updated.length > 0 ? 'live' : 'unavailable',
      tag,
      updated,
      missing,
    };
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
        supabaseStorage: getSupabaseStorageProviderMeta(),
        n8nWorkflows: getN8nWorkflowProviderMeta(),
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
    brainBlogPosts: state.brainBlogPosts || [],
    marketIntel: state.marketIntel || [],
    leadNurturePlans: state.leadNurturePlans || [],
    dealSimulations: state.dealSimulations || [],
    buyers: state.buyers || [],
    buyerMatches: state.buyerMatches || [],
    systemAuditReports: state.systemAuditReports || [],
    leadImports: state.leadImports,
    analyzerRuns: state.analyzerRuns,
    propertyCache: state.propertyCache || [],
    dncEntries: state.dncEntries,
    calls: state.calls,
    messages: state.messages,
    messageCounts: getMessageCounts(),
    notifications: buildNotificationSnapshot(),
    appointments: state.appointments,
    leadStageTransitions: state.leadStageTransitions,
    contracts: state.contracts,
    contractTemplates: {
      loadedAt: contractTemplateCache.loadedAt,
      reason: contractTemplateCache.reason,
      errors: contractTemplateCache.errors,
      templates: contractTemplateCache.templates.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        version: item.version,
        hasTemplate: item.hasTemplate,
        hasNegotiation: item.hasNegotiation,
        updatedAt: item.updatedAt,
      })),
    },
    documentDeliveries: state.documentDeliveries,
    attachments: state.attachments || [],
    browserResearchJobs: state.browserResearchJobs || [],
    campaigns: state.campaigns || [],
    campaignLeads: state.campaignLeads || [],
    campaignEvents: state.campaignEvents || [],
    campaignSuppressions: state.campaignSuppressions || [],
    campaignLeadSources: getCampaignLeadSourceOptions(),
    campaignExecutions: state.campaignExecutions || [],
    agents: Array.isArray(state.agents) ? state.agents : buildDefaultAgentFleet(),
    agentSkillTransfers: state.agentSkillTransfers || [],
    agentSkillExperiments: state.agentSkillExperiments || [],
    rexDecisions: state.rexDecisions || [],
    avaActiveMemories: state.avaActiveMemories || [],
    avaLearningSessions: state.avaLearningSessions || [],
    inboundCallRoutes: state.inboundCallRoutes || [],
    leadScoringWeights: getLeadScoringWeights(),
    avaNegotiationProfile: {
      persona: buildAvaNegotiationPersona(),
      tactics: buildDefaultNegotiationTactics(),
      emotionalIntelligence: buildDefaultEmotionalIntelligenceRules(),
      cityKnowledge: buildDefaultCityKnowledge(),
    },
    promptPatchApplications: state.promptPatchApplications || [],
    recordingRetentionRuns: state.recordingRetentionRuns || [],
    settings: ensureRuntimeSettings(state),
    adminTasks: state.adminTasks,
    adminAudit: state.adminAudit,
  };
}

function json(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Accept-Encoding',
  };
  if (response.pbkAcceptsGzip && body.length >= 2048) {
    const compressed = gzipSync(body);
    response.writeHead(statusCode, {
      ...headers,
      'Content-Encoding': 'gzip',
      'Content-Length': String(compressed.length),
    });
    response.end(compressed);
    return;
  }
  response.writeHead(statusCode, {
    ...headers,
    'Content-Length': String(body.length),
  });
  response.end(body);
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

async function readRawBodyBuffer(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}

async function readBody(request) {
  const buffer = await readRawBodyBuffer(request);
  if (!buffer.length) return {};
  const raw = buffer.toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function verifySlackRequestSignature(headers = {}, rawBody = '') {
  if (!SLACK_SIGNING_SECRET) {
    return {
      ok: !IS_HOSTED,
      skipped: true,
      error: IS_HOSTED ? 'PBK_SLACK_SIGNING_SECRET is required for hosted Slack interactions.' : '',
    };
  }
  const timestamp = String(headers['x-slack-request-timestamp'] || '').trim();
  const signature = String(headers['x-slack-signature'] || '').trim();
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!timestamp || !signature) {
    return { ok: false, error: 'Slack signature headers are missing.' };
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > 60 * 5) {
    return { ok: false, error: 'Slack signature timestamp is too old.' };
  }
  const expected = `v0=${createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) {
    return { ok: false, error: 'Slack signature length mismatch.' };
  }
  const ok = timingSafeEqual(expectedBuffer, actualBuffer);
  return {
    ok,
    error: ok ? '' : 'Slack signature verification failed.',
  };
}

async function readSlackInteractionRequest(request) {
  const buffer = await readRawBodyBuffer(request);
  const raw = buffer.toString('utf8');
  const signature = verifySlackRequestSignature(request.headers || {}, raw);
  if (!signature.ok) {
    return { ok: false, status: 401, signature, payload: null };
  }
  let payload = null;
  const contentType = String(request.headers['content-type'] || '');
  try {
    if (/application\/x-www-form-urlencoded/i.test(contentType)) {
      const params = new URLSearchParams(raw);
      payload = JSON.parse(params.get('payload') || '{}');
    } else {
      payload = JSON.parse(raw || '{}');
    }
  } catch (error) {
    return {
      ok: false,
      status: 400,
      signature,
      payload: null,
      error: error instanceof Error ? error.message : 'Slack payload parse failed.',
    };
  }
  return { ok: true, status: 200, signature, payload };
}

async function handleSlackApprovalInteraction(payload = {}) {
  const action = Array.isArray(payload.actions) ? payload.actions[0] : null;
  const actionId = String(action?.action_id || '').trim();
  const approvalId = String(
    action?.value
      || payload.private_metadata
      || payload.message?.metadata?.event_payload?.approvalId
      || '',
  ).trim();
  if (!approvalId || !/^pbk_approval_(approve|reject|modify)$/i.test(actionId)) {
    return {
      ok: false,
      status: 400,
      text: 'PBK could not identify this approval action.',
      error: 'Unsupported Slack approval action.',
    };
  }
  const actor = payload.user?.username || payload.user?.name || payload.user?.id || 'slack';
  const isModify = /modify/i.test(actionId);
  const status = isModify ? 'needs_revision' : /reject/i.test(actionId) ? 'rejected' : 'approved';
  let result = null;
  if (isModify) {
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval) {
      result = { ok: false, error: `Approval ${approvalId} was not found.` };
    } else {
      approval.status = status;
      approval.actor = actor;
      approval.actedAt = isoNow();
      approval.notes = 'Slack requested changes before approval.';
      const rexDecisionResult = (
        String(approval.type || '').toLowerCase() === 'rex-decision'
        || String(approval.approvalAction || '').toLowerCase() === 'rex_apply'
      )
        ? await requestRexDecisionModificationFromApproval(approval, { actor })
        : null;
      addActivity(state, makeActivity({
        actor,
        category: 'APPROVAL',
        status: 'warning',
        text: `${approval.type || 'Approval'} sent back for modification`,
        target: approval.address || approval.leadName || approval.id,
      }));
      await persistState(state);
      result = { ok: true, approval, rexDecisionResult };
    }
  } else {
    result = await handleEvent('approval-callback', {
      id: approvalId,
      status,
      actor,
      actedAt: isoNow(),
      notes: `Slack interactive approval ${status}.`,
    });
  }
  const update = await updateSlackApprovalMessage({
    channel: payload.channel?.id || payload.container?.channel_id || payload.message?.channel || '',
    ts: payload.message?.ts || payload.container?.message_ts || '',
    approval: result.approval || { id: approvalId, status },
    status,
    actor,
  });
  const ok = result.ok !== false;
  return {
    ok,
    status: ok ? 200 : 404,
    text: ok
      ? `PBK approval ${status === 'needs_revision' ? 'sent back for modification' : status}.`
      : (result.error || 'PBK approval was not found.'),
    result,
    update,
  };
}

function parseMultipartContentDisposition(value = '') {
  const result = {};
  String(value || '').split(';').forEach((part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key || !rawValue.length) return;
    result[key] = rawValue.join('=').trim().replace(/^"|"$/g, '');
  });
  return result;
}

function parseMultipartFormDataBuffer(buffer, contentType = '') {
  const boundaryMatch = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundaryText = boundaryMatch?.[1] || boundaryMatch?.[2] || '';
  if (!boundaryText) return { fields: {}, files: [], error: 'Multipart boundary is missing.' };
  const boundary = Buffer.from(`--${boundaryText}`);
  const fields = {};
  const files = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    let start = buffer.indexOf(boundary, cursor);
    if (start < 0) break;
    start += boundary.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(boundary, start);
    if (next < 0) break;
    let part = buffer.slice(start, next);
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.slice(0, -2);
    }
    cursor = next;

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const data = part.slice(headerEnd + 4);
    const headers = {};
    headerText.split('\r\n').forEach((line) => {
      const splitAt = line.indexOf(':');
      if (splitAt < 0) return;
      headers[line.slice(0, splitAt).trim().toLowerCase()] = line.slice(splitAt + 1).trim();
    });
    const disposition = parseMultipartContentDisposition(headers['content-disposition']);
    const name = disposition.name || '';
    if (!name) continue;
    if (disposition.filename != null) {
      files.push({
        fieldName: name,
        filename: disposition.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        data,
      });
    } else {
      fields[name] = data.toString('utf8');
    }
  }

  return { fields, files };
}

async function readMultipartFormData(request) {
  const contentType = request.headers['content-type'] || '';
  const buffer = await readRawBodyBuffer(request);
  return parseMultipartFormDataBuffer(buffer, contentType);
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

  if (eventType.includes('recording')) {
    return {
      eventType: 'recording-capture',
      payload: normalizeRecordingCapturePayload(body),
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

function normalizeDeepgramLiveSentiment(data = {}) {
  const alt = data?.channel?.alternatives?.[0] || {};
  const words = Array.isArray(alt.words) ? alt.words : [];
  const scoredWord = words.find((word) => Number.isFinite(Number(word?.sentiment_score)));
  const score = Number(
    data?.results?.sentiments?.average?.sentiment_score
      ?? data?.sentiments?.average?.sentiment_score
      ?? scoredWord?.sentiment_score,
  );
  const label = data?.results?.sentiments?.average?.sentiment
    || data?.sentiments?.average?.sentiment
    || scoredWord?.sentiment
    || (Number.isFinite(score) ? (score >= 0.333333333 ? 'positive' : score <= -0.333333333 ? 'negative' : 'neutral') : 'unknown');
  return {
    label,
    score: Number.isFinite(score) ? Number(score.toFixed(4)) : null,
    pbkScore: Number.isFinite(score) ? Number(((Math.max(-1, Math.min(1, score)) + 1) / 2).toFixed(3)) : null,
  };
}

async function handleTelnyxDeepgramMediaSocket(socket, request) {
  const meta = getDeepgramProviderMeta(process.env);
  const session = {
    id: `dg-stream-${Date.now()}-${randomUUID().slice(0, 8)}`,
    callId: '',
    streamId: '',
    frameCount: 0,
    transcript: [],
    sentiment: null,
    startedAt: isoNow(),
  };

  if (!meta.ready) {
    socket.close(1011, 'Deepgram not configured');
    return;
  }

  let deepgramConnection = null;
  let finalized = false;

  const finalize = async (reason = 'closed') => {
    if (finalized) return;
    finalized = true;
    try {
      deepgramConnection?.close?.();
    } catch {
      // Closing best-effort; Telnyx already ended the stream.
    }

    const transcriptText = session.transcript
      .filter((item) => item.transcript && (item.isFinal || item.speechFinal))
      .map((item) => item.transcript)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const contextCall = getCallById(session.callId);
    const message = createMessageRecord({
      id: `msg-deepgram-live-${slugify(session.callId || session.streamId || session.id)}-${Date.now()}`,
      leadId: contextCall?.leadId || '',
      leadName: contextCall?.leadName || 'Unknown seller',
      address: contextCall?.address || '',
      phone: contextCall?.phone || '',
      channel: 'call',
      direction: 'transcription',
      provider: 'Deepgram',
      status: transcriptText ? 'transcribed' : 'no_transcript',
      body: transcriptText || `Deepgram live stream closed (${reason}) before a final transcript was available.`,
      sentiment: session.sentiment?.pbkScore ?? null,
      callId: session.callId || contextCall?.id || '',
      payload: {
        source: 'telnyx-media-stream',
        streamId: session.streamId,
        frameCount: session.frameCount,
        reason,
        startedAt: session.startedAt,
        endedAt: isoNow(),
        sentiment: session.sentiment,
        transcript: session.transcript.slice(-50),
      },
    });
    upsertMessage(state, message);
    await persistUnifiedMessageRecord(message);

    if (contextCall) {
      upsertCall(state, {
        ...contextCall,
        transcript: [
          ...(Array.isArray(contextCall.transcript) ? contextCall.transcript : []),
          ...session.transcript.slice(-25),
        ],
        sentiment: session.sentiment?.pbkScore ?? contextCall.sentiment,
        updatedAt: isoNow(),
      });
    }

    addActivity(
      state,
      makeActivity({
        actor: 'Deepgram',
        category: 'CALL',
        status: transcriptText ? 'transcribed' : 'warning',
        text: transcriptText
          ? `Live voice sentiment captured for ${message.leadName || session.callId || session.streamId}.`
          : `Deepgram media stream ended without a final transcript (${reason}).`,
        target: session.callId || session.streamId || session.id,
      }),
    );
    await persistState(state);
  };

  try {
    deepgramConnection = await createDeepgramLiveConnection({}, process.env);
    deepgramConnection.on('message', (data) => {
      if (data?.type !== 'Results') return;
      const alt = data.channel?.alternatives?.[0] || {};
      const transcript = String(alt.transcript || '').trim();
      if (!transcript) return;
      const sentiment = normalizeDeepgramLiveSentiment(data);
      if (sentiment.pbkScore !== null) session.sentiment = sentiment;
      session.transcript.push({
        transcript,
        confidence: Number.isFinite(Number(alt.confidence)) ? Number(alt.confidence) : null,
        isFinal: Boolean(data.is_final),
        speechFinal: Boolean(data.speech_final),
        start: data.start ?? null,
        duration: data.duration ?? null,
        sentiment,
        capturedAt: isoNow(),
      });
    });
    deepgramConnection.on('error', (error) => {
      console.warn('[pbk-local-openclaw] Deepgram live stream error:', error?.message || error);
    });
    deepgramConnection.connect();
    await deepgramConnection.waitForOpen();
  } catch (error) {
    console.warn('[pbk-local-openclaw] Deepgram live stream could not start:', error?.message || error);
    socket.close(1011, 'Deepgram connection failed');
    return;
  }

  socket.on('message', (raw) => {
    let event = {};
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    if (event.event === 'start') {
      session.streamId = event.stream_id || event.start?.stream_id || session.streamId;
      session.callId = event.start?.call_control_id
        || event.start?.callControlId
        || event.start?.call_session_id
        || event.start?.callSessionId
        || event.call_control_id
        || session.callId;
      return;
    }

    if (event.event === 'media' && event.media?.payload) {
      const frame = Buffer.from(String(event.media.payload), 'base64');
      session.frameCount += 1;
      sendDeepgramAudio(deepgramConnection, frame);
      return;
    }

    if (event.event === 'stop') {
      session.streamId = event.stream_id || event.stop?.stream_id || session.streamId;
      session.callId = event.stop?.call_control_id || event.stop?.callControlId || session.callId;
      void finalize('telnyx-stop');
    }
  });

  socket.on('close', () => {
    void finalize('websocket-close');
  });
  socket.on('error', (error) => {
    console.warn('[pbk-local-openclaw] Telnyx media socket error:', error?.message || error);
    void finalize('websocket-error');
  });
}

const server = createServer(async (request, response) => {
  response.pbkAcceptsGzip = /\bgzip\b/i.test(String(request.headers['accept-encoding'] || ''));
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
          deepgram: getDeepgramProviderMeta(process.env),
          instantly: getInstantlyProviderMeta(),
          googleCalendar: getGoogleCalendarProviderMeta(),
          supabaseStorage: getSupabaseStorageProviderMeta(),
          n8nWorkflows: getN8nWorkflowProviderMeta(),
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

    if (request.method === 'GET' && pathname === '/api/settings') {
      json(response, 200, {
        ok: true,
        source: STATE_BACKEND === 'postgres' ? 'supabase-bridge-state' : 'local-bridge-state',
        settings: ensureRuntimeSettings(state),
      });
      return;
    }

    if (['POST', 'PUT', 'PATCH'].includes(request.method) && pathname === '/api/settings') {
      const body = await readBody(request);
      const current = ensureRuntimeSettings(state);
      const patch = normalizeSettingsPatch(body);
      const next = {
        ...current,
        ...patch,
        ui: {
          ...(current.ui || {}),
          ...(patch.ui || {}),
        },
        updatedAt: isoNow(),
        updatedBy: body.actor || body.updatedBy || 'command-center',
      };
      state.settings = next;
      addActivity(
        state,
        makeActivity({
          actor: next.updatedBy,
          category: 'SETTINGS',
          status: 'saved',
          text: 'Command Center settings persisted to bridge state.',
          target: STATE_BACKEND === 'postgres' ? 'supabase' : 'local-state',
        }),
      );
      await persistState(state);
      json(response, 200, {
        ok: true,
        source: STATE_BACKEND === 'postgres' ? 'supabase-bridge-state' : 'local-bridge-state',
        settings: state.settings,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/analytics') {
      json(response, 200, buildAnalyticsSnapshot(url.searchParams.get('range') || '30d'));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/analytics/campaign-drilldown') {
      json(response, 200, buildCampaignAnalyticsDrilldown(url.searchParams));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/memory/stats') {
      json(response, 200, await buildMemoryStats());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/agent/history') {
      json(response, 200, await buildAgentHistory(url.searchParams.get('limit') || 50));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/skills/outcomes') {
      json(response, 200, await buildSkillOutcomes());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/fleet/outcomes') {
      json(response, 200, await buildFleetOutcomes());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/objection/playbooks') {
      json(response, 200, await buildObjectionPlaybooks());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/memory/analytics') {
      json(response, 200, await buildMemoryAnalyticsBundle(url.searchParams.get('limit') || 50));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/lead-scoring/weights') {
      json(response, 200, {
        ok: true,
        result: 'live',
        weights: getLeadScoringWeights(),
        source: STATE_BACKEND === 'postgres' ? 'supabase-bridge-state' : 'local-bridge-state',
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/lead-scoring/weights') {
      const body = await readBody(request);
      const result = await updateLeadScoringWeights(body, {
        actor: request.headers['x-rex-agent'] ? 'Rex Strategist' : body.actor || 'PBK Command Center',
      });
      json(response, result.ok ? 200 : 400, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/ava/negotiation-guidance') {
      const context = findLeadContext({
        leadName: url.searchParams.get('leadName') || '',
        address: url.searchParams.get('address') || '',
        phone: url.searchParams.get('phone') || '',
        email: url.searchParams.get('email') || '',
      });
      const guidance = selectNegotiationGuidance({
        scenario: url.searchParams.get('scenario') || '',
        emotion: url.searchParams.get('emotion') || '',
        sentiment: url.searchParams.get('sentiment') || '',
        transcriptStart: url.searchParams.get('text') || '',
      }, context);
      json(response, 200, {
        ok: true,
        result: 'live',
        guidance,
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/api/ava/active-memory', '/api/ava/memory'])) {
      json(response, 200, {
        ok: true,
        result: DATABASE_URL ? 'live' : 'local_view_only',
        activeMemories: sortNewest(state.avaActiveMemories || []).slice(0, Math.max(1, Math.min(120, Number(url.searchParams.get('limit') || 50)))),
        learningSessions: sortNewest(state.avaLearningSessions || []).slice(0, 20),
        summary: getAvaActiveMemorySummary(8),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/ava/active-memory', '/api/ava/memory'])) {
      const body = await readBody(request);
      const memories = Array.isArray(body.memories) ? body.memories : Array.isArray(body.lessons) ? body.lessons : [body];
      for (const item of memories.filter(Boolean)) {
        upsertAvaActiveMemory({
          id: item.id || `ava-memory-manual-${Date.now()}-${randomUUID().slice(0, 8)}`,
          memoryType: item.memoryType || item.type || 'manual-guidance',
          objectionTag: item.objectionTag || item.objection_tag || item.tag || '',
          prompt: item.prompt || item.trigger || '',
          response: item.response || item.guidance || item.summary || '',
          summary: item.summary || item.response || item.guidance || '',
          score: item.score ?? item.confidence ?? 0.72,
          outcome: item.outcome || 'approved_memory',
          source: item.source || 'manual',
          metadata: item.metadata || {},
          createdAt: item.createdAt || isoNow(),
        });
      }
      addActivity(state, makeActivity({
        actor: body.actor || 'Ava Memory',
        category: 'LEARNING',
        status: 'saved',
        text: `Updated Ava active memory with ${memories.length} item${memories.length === 1 ? '' : 's'}.`,
        target: 'ava-active-memory',
      }));
      await persistState(state);
      json(response, 200, {
        ok: true,
        result: DATABASE_URL ? 'live' : 'local_view_only',
        verbiage: 'Ava active memory updated',
        activeMemories: sortNewest(state.avaActiveMemories || []).slice(0, 50),
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/ava/learning/run', '/api/ava/memory/run'])) {
      const body = await readBody(request);
      const result = await runAvaMemoryLearning({
        ...body,
        actor: body.actor || (request.headers['x-rex-agent'] ? 'Rex Strategist' : 'Ava memory worker'),
      });
      json(response, 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/ava/inbound/route', '/webhooks/telnyx/inbound', '/api/webhooks/telnyx/inbound'])) {
      const body = await readBody(request);
      const result = await handleAvaInboundRoute(body, {
        actor: pathname.includes('webhooks') ? 'Telnyx inbound webhook' : body.actor || 'PBK Command Center',
        forceAfterHours: body.forceAfterHours,
      });
      json(response, result.result === 'provider_missing' ? 202 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/rex/decisions') {
      ensureRexCollections();
      const status = String(url.searchParams.get('status') || 'all').toLowerCase();
      const decisions = sortNewest(state.rexDecisions || []).filter((decision) => status === 'all' || String(decision.status || '').toLowerCase() === status);
      json(response, 200, {
        ok: true,
        result: 'live',
        decisions: decisions.slice(0, Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100)))),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/rex/decisions', '/api/rex/strategist/proposals'])) {
      const body = await readBody(request);
      const proposals = Array.isArray(body.proposals) ? body.proposals : Array.isArray(body.decisions) ? body.decisions : [body];
      const results = [];
      for (const proposal of proposals) {
        results.push(await createRexDecision({
          ...proposal,
          requestApproval: body.requestApproval ?? proposal.requestApproval,
          actor: proposal.actor || body.actor || 'Rex Strategist',
        }, {
          requestApproval: body.requestApproval !== false,
          actor: body.actor || 'Rex Strategist',
          source: body.source || 'rex-strategist',
        }));
      }
      json(response, 202, {
        ok: true,
        result: 'queued_for_approval',
        verbiage: 'Rex proposal recorded',
        decisions: results.map((item) => item.decision),
        results,
        state: buildStateSnapshot(),
      });
      return;
    }

    const rexDecisionMatch = matchPath(pathname, '/api/rex/decisions/:decisionId');
    if (rexDecisionMatch && request.method === 'GET') {
      const decisionId = decodeURIComponent(rexDecisionMatch.groups.decisionId || '');
      const decision = (state.rexDecisions || []).find((item) => item.id === decisionId);
      json(response, decision ? 200 : 404, {
        ok: Boolean(decision),
        result: decision ? 'live' : 'unavailable',
        decision,
        error: decision ? '' : 'Rex decision not found.',
      });
      return;
    }

    const rexDecisionApplyMatch = matchPath(pathname, '/api/rex/decisions/:decisionId/apply');
    if (rexDecisionApplyMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await applyRexDecision(decodeURIComponent(rexDecisionApplyMatch.groups.decisionId || ''), {
        actor: request.headers['x-rex-agent'] ? 'Rex Strategist' : body.actor || 'api',
      });
      json(response, result.ok ? 200 : 400, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const rexDecisionOutcomeMatch = matchPath(pathname, '/api/rex/decisions/:decisionId/outcome');
    if (rexDecisionOutcomeMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await updateRexDecisionOutcome(decodeURIComponent(rexDecisionOutcomeMatch.groups.decisionId || ''), body);
      json(response, result.ok ? 200 : 404, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/slack/interactions', '/api/webhooks/slack/interactive'])) {
      const slackRequest = await readSlackInteractionRequest(request);
      if (!slackRequest.ok) {
        json(response, slackRequest.status || 400, {
          ok: false,
          error: slackRequest.error || slackRequest.signature?.error || 'Slack interaction rejected.',
          signature: {
            verified: false,
            skipped: Boolean(slackRequest.signature?.skipped),
          },
        });
        return;
      }
      const result = await handleSlackApprovalInteraction(slackRequest.payload || {});
      json(response, result.status || (result.ok ? 200 : 400), {
        response_type: 'ephemeral',
        text: result.text || (result.ok ? 'PBK approval updated.' : 'PBK approval failed.'),
        ok: result.ok,
        result: result.result,
        update: result.update,
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/api/agents/fleet', '/api/agents'])) {
      ensureAgentFleetCollections();
      json(response, 200, {
        ok: true,
        result: 'live',
        agents: state.agents,
        transfers: state.agentSkillTransfers,
        experiments: state.agentSkillExperiments,
        status: state.status,
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/agents/deploy', '/api/agents/fleet/deploy'])) {
      const body = await readBody(request);
      const result = await createRexDecision({
        tool: 'deploy_agent',
        params: body,
        rationale: body.rationale || `Deploy ${body.name || 'new agent'} from Agent Fleet.`,
        actor: body.actor || 'Agent Fleet UI',
        source: 'agent-fleet',
        requestApproval: body.requestApproval !== false,
      }, {
        requestApproval: body.requestApproval !== false,
        actor: body.actor || 'Agent Fleet UI',
        source: 'agent-fleet',
      });
      json(response, 202, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const agentActionMatch = matchPath(pathname, '/api/agents/:agentId/actions');
    if (agentActionMatch && request.method === 'POST') {
      const body = await readBody(request);
      const action = normalizeRexTool(body.action || body.tool || '');
      const result = await createRexDecision({
        tool: action.startsWith('agent_') ? action : `agent_${action}`,
        params: {
          ...body,
          agentId: decodeURIComponent(agentActionMatch.groups.agentId || ''),
        },
        rationale: body.rationale || `Agent Fleet requested ${body.action || body.tool || 'action'}.`,
        actor: body.actor || 'Agent Fleet UI',
        source: 'agent-fleet',
        requestApproval: body.requestApproval !== false,
      }, {
        requestApproval: body.requestApproval !== false,
        actor: body.actor || 'Agent Fleet UI',
        source: 'agent-fleet',
      });
      json(response, 202, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const agentSkillActionMatch = matchPath(pathname, '/api/agents/:agentId/skills');
    if (agentSkillActionMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await createRexDecision({
        tool: body.action || body.tool || 'transfer_skill',
        params: {
          ...body,
          sourceAgentId: decodeURIComponent(agentSkillActionMatch.groups.agentId || ''),
        },
        rationale: body.rationale || `Agent Fleet requested skill action for ${body.skill || 'a skill'}.`,
        actor: body.actor || 'Agent Fleet UI',
        source: 'agent-fleet',
        requestApproval: body.requestApproval !== false,
      }, {
        requestApproval: body.requestApproval !== false,
        actor: body.actor || 'Agent Fleet UI',
        source: 'agent-fleet',
      });
      json(response, 202, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/api/deepgram/health', '/api/voice/deepgram/health'])) {
      json(response, 200, {
        ok: true,
        provider: 'deepgram',
        ...getDeepgramProviderMeta(process.env),
        telnyxMediaStreamPath: '/api/webhooks/telnyx/media',
        telnyxStreamCallsEnabled: DEEPGRAM_STREAM_CALLS_ENABLED,
        telnyxStreamTrack: DEEPGRAM_STREAM_TRACK,
        telnyxStreamCodec: DEEPGRAM_STREAM_CODEC,
        telnyxStreamTokenConfigured: Boolean(TELNYX_MEDIA_STREAM_TOKEN),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, [
      '/api/deepgram/transcribe-url',
      '/api/voice/deepgram/transcribe-url',
      '/api/voice/sentiment/test',
    ])) {
      const body = await readBody(request);
      const result = await transcribeDeepgramUrl({
        url: body.url || (body.sample ? DEEPGRAM_SAMPLE_URL : ''),
        model: body.model,
        language: body.language,
        smartFormat: body.smartFormat ?? body.smart_format,
        sentiment: body.sentiment ?? true,
        utterances: body.utterances ?? true,
        paragraphs: body.paragraphs ?? true,
        diarize: body.diarize ?? false,
        includeRaw: Boolean(body.includeRaw),
      }, process.env);
      json(response, result.ok ? 200 : result.result === 'unavailable' ? 400 : 503, result);
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/api/search', '/search'])) {
      const query = url.searchParams.get('q') || url.searchParams.get('query') || '';
      const limit = Math.max(1, Math.min(40, Number(url.searchParams.get('limit') || 12)));
      const results = collectGlobalSearchRecords(query, limit);
      json(response, 200, {
        ok: true,
        result: 'live',
        query,
        count: results.length,
        results,
        source: STATE_BACKEND === 'postgres' ? 'supabase-bridge-state' : 'local-bridge-state',
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/messages/counts') {
      json(response, 200, {
        ok: true,
        result: 'live',
        counts: getMessageCounts(),
        generatedAt: isoNow(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/notifications') {
      json(response, 200, buildNotificationSnapshot());
      return;
    }

    if (request.method === 'GET' && pathname === '/api/tooling/status') {
      json(response, 200, {
        ok: true,
        tooling: await buildToolingStatus(),
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/api/workflows', '/api/n8n/workflows'])) {
      json(response, 200, await listWorkflowPersistence());
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/workflows', '/api/n8n/workflows'])) {
      const body = await readBody(request);
      const result = await saveWorkflowPersistence(body);
      addActivity(
        state,
        makeActivity({
          actor: 'n8n',
          category: 'AUTOMATION',
          status: result.sync?.ok ? 'synced' : 'saved',
          text: `${result.draft.name} workflow ${result.sync?.ok ? 'synced to n8n' : 'saved as a local draft'}`,
          target: result.draft.id,
        }),
      );
      await persistState(state);
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/workflows/publish', '/api/n8n/workflows/publish'])) {
      const body = await readBody(request);
      const result = await publishWorkflowPersistence(body);
      addActivity(
        state,
        makeActivity({
          actor: 'n8n',
          category: 'AUTOMATION',
          status: result.sync?.ok ? (result.activation?.ok || !result.activation ? 'published' : 'activation-failed') : 'queued',
          text: `${result.draft.name} workflow ${result.sync?.ok ? 'published to n8n' : 'kept as a local draft'}`,
          target: result.draft.metadata?.n8nWorkflowId || result.draft.id,
        }),
      );
      await persistState(state);
      json(response, result.ok ? 200 : 202, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/property-data') {
      const result = await toolHandlers.getPropertyData({
        address: url.searchParams.get('address') || '',
        queueBrowserResearch: /^(1|true|yes)$/i.test(String(url.searchParams.get('queueBrowserResearch') || '').trim()),
        requestedBy: url.searchParams.get('requestedBy') || 'api',
        source: 'api',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/property-data') {
      const body = await readBody(request);
      const result = await toolHandlers.cachePropertyData({
        ...body,
        source: body.source || 'api',
      });
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
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

    if (request.method === 'GET' && pathname === '/api/attachments') {
      json(response, 200, {
        ok: true,
        bucket: SUPABASE_ATTACHMENTS_BUCKET,
        attachments: state.attachments || [],
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/attachments/status') {
      const attachments = sortNewest(state.attachments || []);
      json(response, 200, {
        ok: true,
        result: 'live',
        bucket: SUPABASE_ATTACHMENTS_BUCKET,
        counts: {
          total: attachments.length,
          indexed: attachments.filter((item) => item.extractionStatus === 'indexed' || item.extraction?.ok).length,
          storedOnly: attachments.filter((item) => item.extractionStatus === 'stored-only' || item.extractionStatus === 'stored').length,
          failed: attachments.filter((item) => /fail|error/i.test(String(item.extractionStatus || item.status || ''))).length,
        },
        attachments: attachments.slice(0, Math.max(1, Math.min(80, Number(url.searchParams.get('limit') || 20)))),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/attachments') {
      const contentType = String(request.headers['content-type'] || '');
      let file = null;
      let fields = {};

      if (/multipart\/form-data/i.test(contentType)) {
        const parsed = await readMultipartFormData(request);
        if (parsed.error) {
          json(response, 400, { ok: false, error: parsed.error });
          return;
        }
        fields = parsed.fields || {};
        file = parsed.files?.[0] || null;
      } else {
        const body = await readBody(request);
        fields = body;
        const base64 = String(body.fileBase64 || body.base64 || '').replace(/^data:[^;]+;base64,/i, '');
        if (base64) {
          file = {
            filename: body.filename || body.fileName || 'attachment',
            contentType: body.contentType || 'application/octet-stream',
            data: Buffer.from(base64, 'base64'),
          };
        }
      }

      if (!file) {
        json(response, 400, { ok: false, error: 'No attachment file was provided.' });
        return;
      }

      const result = await handleAttachmentUpload({ file, fields });
      json(response, result.ok === false ? 501 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/brain/ingest', '/api/brain/ingest'])) {
      const body = await readBody(request);
      const result = await toolHandlers.ingestResearchDoc({
        ...body,
        source: body.source || body.sourceUrl || body.url || 'brain-api',
      });
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/api/brain/blog', '/brain/blog'])) {
      const limit = Math.max(1, Math.min(60, Number(url.searchParams.get('limit') || 20)));
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      const posts = filterBrainBlogPosts(state.brainBlogPosts || [], {
        tag: url.searchParams.get('tag') || '',
        mentor: url.searchParams.get('mentor') || '',
        revenueStream: url.searchParams.get('revenueStream') || url.searchParams.get('stream') || '',
        techniqueType: url.searchParams.get('techniqueType') || url.searchParams.get('type') || '',
      });
      json(response, 200, {
        ok: true,
        result: 'live',
        total: posts.length,
        posts: posts.slice(offset, offset + limit),
        status: state.status,
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/brain/blog', '/brain/blog'])) {
      const body = await readBody(request);
      const result = await toolHandlers.createBrainBlogPost({
        ...body,
        requestedBy: body.requestedBy || 'api',
      });
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/brain/blog/harvest', '/brain/blog/harvest'])) {
      const body = await readBody(request);
      const result = await toolHandlers.harvestBrainBlog({
        ...body,
        requestedBy: body.requestedBy || 'api',
      });
      json(response, result.ok === false ? 502 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const trainBrainBlogMatch = pathname.match(/^\/(?:api\/)?brain\/blog\/([^/]+)\/train$/);
    if (request.method === 'POST' && trainBrainBlogMatch) {
      const body = await readBody(request);
      const result = await toolHandlers.trainBrainBlogPost({
        ...body,
        id: decodeURIComponent(trainBrainBlogMatch[1]),
        requestedBy: body.requestedBy || 'api',
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/brain/query', '/api/brain/query'])) {
      const result = await toolHandlers.getBrainState({
        query: url.searchParams.get('q') || url.searchParams.get('query') || '',
        requestedBy: url.searchParams.get('requestedBy') || 'api',
        source: 'brain-api',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/brain/query', '/api/brain/query'])) {
      const body = await readBody(request);
      const result = await toolHandlers.getBrainState({
        ...body,
        query: body.query || body.q || '',
        requestedBy: body.requestedBy || 'api',
        source: 'brain-api',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/market-intel') {
      const zip = String(url.searchParams.get('zip') || url.searchParams.get('zipCode') || '').trim();
      const market = String(url.searchParams.get('market') || '').trim().toLowerCase();
      const items = sortNewest(state.marketIntel || []).filter((item) => {
        if (zip && item.zipCode !== zip) return false;
        if (market && !String(item.market || '').toLowerCase().includes(market)) return false;
        return true;
      });
      json(response, 200, { ok: true, result: 'live', items, status: state.status });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/market-intel') {
      const body = await readBody(request);
      const result = await toolHandlers.recordMarketIntel({ ...body, requestedBy: body.requestedBy || 'api' });
      json(response, result.ok === false ? 400 : 200, result);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/leads/nurture') {
      const body = await readBody(request);
      const result = await toolHandlers.planLeadNurture({ ...body, requestedBy: body.requestedBy || 'api' });
      json(response, result.ok === false ? 400 : 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/leads/nurture') {
      json(response, 200, { ok: true, result: 'live', plans: sortNewest(state.leadNurturePlans || []), status: state.status });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/deals/simulate') {
      const body = await readBody(request);
      const result = await toolHandlers.simulateDealConfidence({ ...body, requestedBy: body.requestedBy || 'api' });
      json(response, result.ok === false ? 400 : 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/deals/simulations') {
      json(response, 200, { ok: true, result: 'live', simulations: sortNewest(state.dealSimulations || []), status: state.status });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/buyers') {
      json(response, 200, { ok: true, result: 'live', buyers: sortNewest(state.buyers || []), status: state.status });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/buyers') {
      const body = await readBody(request);
      const buyer = {
        id: body.id || `buyer-${slugify(body.name || 'new')}-${Date.now()}`,
        name: body.name || 'New buyer',
        status: body.status || 'active',
        zipCodes: normalizeStringList(body.zipCodes || body.zips || []),
        markets: normalizeStringList(body.markets || []),
        propertyTypes: normalizeStringList(body.propertyTypes || ['single-family']),
        priceMin: toMoneyNumber(body.priceMin, 0),
        priceMax: toMoneyNumber(body.priceMax, 250000),
        desiredRoi: Number(body.desiredRoi || 0.12),
        maxRepairs: toMoneyNumber(body.maxRepairs, 60000),
        notes: body.notes || '',
        tags: normalizeStringList(body.tags || []),
        createdAt: isoNow(),
        updatedAt: isoNow(),
      };
      upsertById(state, 'buyers', buyer);
      await persistBuyerRecord(buyer);
      await persistState(state);
      json(response, 200, { ok: true, result: 'live', buyer, state: buildStateSnapshot() });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/buyers/match') {
      const body = await readBody(request);
      const result = await toolHandlers.matchBuyers({ ...body, requestedBy: body.requestedBy || 'api' });
      json(response, result.ok === false ? 400 : 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/system/audit') {
      json(response, 200, { ok: true, result: 'live', reports: sortNewest(state.systemAuditReports || []), status: state.status });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/system/audit') {
      const body = await readBody(request);
      const result = await toolHandlers.runSystemAudit({ ...body, requestedBy: body.requestedBy || 'api' });
      json(response, result.ok === false ? 400 : 200, result);
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

    if (request.method === 'GET' && matchesPath(pathname, ['/api/contracts/templates', '/api/contracts/paths'])) {
      const templates = await getContractTemplateLibrary();
      json(response, 200, {
        ok: true,
        loadedAt: contractTemplateCache.loadedAt,
        reason: contractTemplateCache.reason,
        errors: contractTemplateCache.errors,
        templates,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/contracts/reload') {
      const body = await readBody(request);
      const result = await toolHandlers.reloadContractTemplates({
        ...body,
        source: body.source || 'api',
      });
      json(response, result.ok === false ? 400 : 200, {
        ...result,
        state: buildStateSnapshot(),
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

    if (request.method === 'GET' && pathname === '/api/browser-research/jobs') {
      const jobs = sortNewest(state.browserResearchJobs || []);
      json(response, 200, {
        ok: true,
        result: 'live',
        counts: {
          total: jobs.length,
          queued: jobs.filter((job) => String(job.status || '').toLowerCase() === 'queued').length,
          setupRequired: jobs.filter((job) => String(job.status || '').toLowerCase() === 'setup-required').length,
          complete: jobs.filter((job) => /complete|done|indexed/i.test(String(job.status || ''))).length,
        },
        jobs: jobs.slice(0, Math.max(1, Math.min(80, Number(url.searchParams.get('limit') || 20)))),
      });
      return;
    }

    const browserResearchJobMatch = matchPath(pathname, '/api/browser-research/jobs/:jobId');
    if (browserResearchJobMatch && request.method === 'GET') {
      const jobId = decodeURIComponent(browserResearchJobMatch.groups.jobId || '');
      const job = findBrowserResearchJob(jobId);
      json(response, job ? 200 : 404, {
        ok: Boolean(job),
        result: job ? 'live' : 'unavailable',
        jobId,
        job,
        error: job ? '' : 'BrowserOS research job not found.',
      });
      return;
    }

    if (browserResearchJobMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await updateBrowserResearchJobFromPayload({
        ...body,
        jobId: decodeURIComponent(browserResearchJobMatch.groups.jobId || ''),
      });
      json(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/browser-research/complete', '/api/browser-research/results'])) {
      const body = await readBody(request);
      const result = await updateBrowserResearchJobFromPayload(body);
      json(response, result.ok ? 200 : 400, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/telnyx/numbers') {
      const result = await getTelnyxNumberOptions();
      json(response, 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/instantly/senders') {
      const result = await getInstantlySenderOptions();
      json(response, 200, result);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/campaigns/lead-sources') {
      json(response, 200, {
        ok: true,
        result: 'live',
        sources: getCampaignLeadSourceOptions(),
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/campaigns') {
      const campaigns = queryCampaignRecords(url.searchParams);
      json(response, 200, {
        ok: true,
        result: 'live',
        campaigns,
        leads: state.campaignLeads || [],
        events: state.campaignEvents || [],
        sources: getCampaignLeadSourceOptions(),
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/campaigns') {
      const body = await readBody(request);
      const result = await createCampaignRecord(body);
      json(response, result.ok ? 201 : 400, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/campaigns/executions') {
      json(response, 200, {
        ok: true,
        result: 'live',
        executions: sortNewest(state.campaignExecutions || []),
        state: buildStateSnapshot(),
      });
      return;
    }

    const campaignApprovalMatch = matchPath(pathname, '/api/campaigns/:campaignId/approval');
    if (campaignApprovalMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await requestCampaignApproval(decodeURIComponent(campaignApprovalMatch.groups.campaignId || ''), body);
      json(response, result.ok ? 202 : 404, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const campaignActionMatch = matchPath(pathname, '/api/campaigns/:campaignId/actions');
    if (campaignActionMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await runCampaignAction(decodeURIComponent(campaignActionMatch.groups.campaignId || ''), body);
      json(response, result.ok ? 202 : 400, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const campaignScriptMatch = matchPath(pathname, '/api/campaigns/:campaignId/script');
    if (campaignScriptMatch && ['POST', 'PATCH'].includes(request.method)) {
      const body = await readBody(request);
      const result = await updateCampaignScript(decodeURIComponent(campaignScriptMatch.groups.campaignId || ''), body, {
        actor: request.headers['x-rex-agent'] ? 'Rex Strategist' : body.actor || 'PBK Command Center',
      });
      json(response, result.ok ? 200 : 400, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const campaignSequenceMatch = matchPath(pathname, '/api/campaigns/:campaignId/sequence');
    if (campaignSequenceMatch && ['POST', 'PATCH'].includes(request.method)) {
      const body = await readBody(request);
      const result = await updateCampaignSequence(decodeURIComponent(campaignSequenceMatch.groups.campaignId || ''), body, {
        actor: request.headers['x-rex-agent'] ? 'Rex Strategist' : body.actor || 'PBK Command Center',
      });
      json(response, result.ok ? 200 : 400, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const campaignEventsMatch = matchPath(pathname, '/api/campaigns/:campaignId/events');
    if (campaignEventsMatch && request.method === 'POST') {
      const body = await readBody(request);
      const campaignId = decodeURIComponent(campaignEventsMatch.groups.campaignId || '');
      const campaign = (state.campaigns || []).find((item) => item.id === campaignId);
      if (!campaign) {
        json(response, 404, {
          ok: false,
          result: 'unavailable',
          verbiage: 'Campaign not found',
          error: 'Cannot attach an event to a missing campaign.',
        });
        return;
      }
      const event = recordCampaignEvent({
        ...body,
        campaignId,
        channel: body.channel || campaign.channel,
        provider: body.provider || campaign.provider,
      });
      upsertById(state, 'campaigns', {
        ...campaign,
        metrics: calculateCampaignMetrics(campaign),
        updatedAt: isoNow(),
      });
      addActivity(
        state,
        makeActivity({
          actor: body.actor || body.provider || 'Campaign provider',
          category: 'CAMPAIGN',
          status: body.status || body.eventType || 'event',
          text: `Campaign "${campaign.name}" received event ${event.eventType}.`,
          target: campaignId,
        }),
      );
      await persistState(state);
      json(response, 200, {
        ok: true,
        result: 'live',
        verbiage: 'Campaign event recorded',
        event,
        state: buildStateSnapshot(),
      });
      return;
    }

    const campaignRecordMatch = matchPath(pathname, '/api/campaigns/:campaignId');
    if (campaignRecordMatch && request.method === 'GET') {
      const campaignId = decodeURIComponent(campaignRecordMatch.groups.campaignId || '');
      const campaign = (state.campaigns || []).find((item) => item.id === campaignId);
      json(response, campaign ? 200 : 404, {
        ok: Boolean(campaign),
        result: campaign ? 'live' : 'unavailable',
        verbiage: campaign ? 'Campaign loaded' : 'Campaign not found',
        campaign: campaign ? {
          ...campaign,
          metrics: calculateCampaignMetrics(campaign),
          leadCount: getCampaignLeads(campaignId).length || campaign.leadCount || 0,
        } : null,
        leads: getCampaignLeads(campaignId),
        events: getCampaignEvents(campaignId),
        state: buildStateSnapshot(),
      });
      return;
    }

    if (campaignRecordMatch && request.method === 'PATCH') {
      const body = await readBody(request);
      const result = await patchCampaignRecord(decodeURIComponent(campaignRecordMatch.groups.campaignId || ''), body);
      json(response, result.ok ? 200 : 404, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/campaigns/run-due', '/api/workers/campaigns/run-due'])) {
      const body = await readBody(request);
      const result = await runCampaignScheduler({
        dryRun: body.dryRun,
        confirmProviderWrites: Boolean(body.confirmProviderWrites),
        limit: body.limit,
        actor: body.actor || 'Campaign worker',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/campaigns/execute-approved', '/api/workers/campaigns/run'])) {
      const body = await readBody(request);
      const approvalId = String(body.approvalId || body.id || '').trim();
      const approval = approvalId
        ? state.approvals.find((item) => item.id === approvalId)
        : sortNewest(state.approvals || []).find((item) =>
          String(item.type || '').toLowerCase() === 'campaign'
          && String(item.status || '').toLowerCase() === 'approved',
        );
      if (!approval) {
        json(response, 404, {
          ok: false,
          result: 'unavailable',
          verbiage: 'Campaign execution unavailable - no approved campaign found',
          error: 'No approved campaign approval was found for execution.',
        });
        return;
      }
      const result = await executeApprovedCampaign(approval, { actor: body.actor || 'Campaign worker' });
      await persistState(state);
      json(response, result.ok ? 200 : 202, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/prompts/applications') {
      json(response, 200, {
        ok: true,
        result: 'live',
        applications: sortNewest(state.promptPatchApplications || []),
        settings: ensureRuntimeSettings(state).agentPrompts || {},
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/prompts/apply-approved', '/api/workers/prompts/apply'])) {
      const body = await readBody(request);
      const approvalId = String(body.approvalId || body.id || '').trim();
      const approval = approvalId
        ? state.approvals.find((item) => item.id === approvalId)
        : sortNewest(state.approvals || []).find((item) =>
          String(item.status || '').toLowerCase() === 'approved'
          && (
            String(item.type || '').toLowerCase() === 'prompt-edit'
            || String(item.approvalAction || '').toLowerCase() === 'prompt_patch'
          ),
        );
      if (!approval) {
        json(response, 404, {
          ok: false,
          result: 'unavailable',
          verbiage: 'Prompt apply unavailable - no approved prompt edit found',
          error: 'No approved prompt edit was found for application.',
        });
        return;
      }
      const result = await applyApprovedPromptPatch(approval, { actor: body.actor || 'Prompt worker' });
      await persistState(state);
      json(response, result.ok ? 200 : 202, {
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

      const guarded = await enforceOperatingModeForTool(toolName, params);
      if (guarded) {
        json(response, 200, {
          ok: Boolean(guarded.ok),
          toolName,
          result: guarded,
          state: buildStateSnapshot(),
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

    if (request.method === 'POST' && pathname === '/api/recordings/fixture') {
      const body = await readBody(request);
      const messageId = body.messageId || body.id || 'pbk-recording-fixture';
      const storagePath = buildRecordingStoragePath({
        ...body,
        messageId,
        leadName: body.leadName || 'PBK Sandbox Lead',
        extension: 'wav',
      });
      const audioBytes = createSilentWavBuffer(toNumber(body.durationSeconds || body.duration_seconds, 0.6));
      const upload = await uploadSupabaseRecording({
        storagePath,
        contentType: 'audio/wav',
        bytes: audioBytes,
      });
      if (upload.ok === false) {
        json(response, 501, {
          ...upload,
          messageId,
          storagePath,
          fixture: true,
        });
        return;
      }
      const existing = findMessageById(messageId);
      const message = {
        ...(existing || createMessageRecord({
          ...body,
          id: messageId,
          channel: 'call',
          direction: 'recording',
          provider: 'PBK Fixture',
          status: 'recorded',
          body: 'Sandbox call recording fixture.',
        })),
        ...body,
        id: messageId,
        leadId: body.leadId || existing?.leadId || 'sandbox-lead',
        leadName: body.leadName || existing?.leadName || 'PBK Sandbox Lead',
        address: body.address || existing?.address || 'Sandbox property',
        channel: 'call',
        direction: 'recording',
        provider: 'PBK Fixture',
        status: 'recorded',
        storagePath,
        storageBucket: SUPABASE_CALL_RECORDINGS_BUCKET,
        audioContentType: 'audio/wav',
        durationSeconds: toNumber(body.durationSeconds || body.duration_seconds, 0.6),
        recordingUrl: '',
        payload: {
          ...(existing?.payload && typeof existing.payload === 'object' ? existing.payload : {}),
          fixture: true,
          storagePath,
          storageBucket: SUPABASE_CALL_RECORDINGS_BUCKET,
          contentType: 'audio/wav',
          upload,
        },
        updatedAt: isoNow(),
      };
      upsertMessage(state, message);
      await persistUnifiedMessageRecord(message);
      addActivity(
        state,
        makeActivity({
          actor: body.actor || 'Command Center',
          category: 'CALL',
          status: 'uploaded',
          text: `Sandbox recording fixture uploaded for ${message.leadName}.`,
          target: storagePath,
        }),
      );
      await persistState(state);
      const signed = await createSupabaseRecordingSignedUrl(storagePath);
      json(response, 200, {
        ok: true,
        fixture: true,
        message,
        upload,
        signedUrl: signed.ok ? signed.signedUrl : '',
        signed,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/recordings/send-email') {
      const body = await readBody(request);
      const messageId = String(body.messageId || body.id || '').trim();
      const recipientEmail = String(body.email || body.to || body.recipientEmail || '').trim();
      if (!messageId) {
        json(response, 400, { ok: false, error: 'messageId is required.' });
        return;
      }
      if (!recipientEmail || !recipientEmail.includes('@')) {
        json(response, 400, { ok: false, error: 'A valid recipient email is required.' });
        return;
      }

      const message = findMessageById(messageId);
      if (!message) {
        json(response, 404, { ok: false, messageId, error: 'Recording message not found.' });
        return;
      }

      const directUrl = getMessageRecordingUrl(message);
      let signed = null;
      const storagePath = getMessageRecordingPath(message);
      if (!directUrl) {
        signed = await createSupabaseRecordingSignedUrl(
          storagePath,
          Number(body.expiresIn || body.expiresInSeconds || 7 * 24 * 60 * 60),
        );
        if (signed.ok === false) {
          json(response, 501, {
            ...signed,
            messageId,
            storagePath,
            error: signed.error || 'Could not create a signed recording URL.',
          });
          return;
        }
      }

      const recordingUrl = directUrl || signed?.signedUrl || '';
      const leadName = body.leadName || message.leadName || 'there';
      const note = String(body.message || body.note || 'Here is the secure call recording package we discussed.').trim();
      const subject = String(body.subject || `PBK call recording for ${leadName}`).trim();
      const delivery = await sendTransactionalEmail({
        from: getSenderAddress(body.senderProfile || 'warm'),
        to: recipientEmail,
        subject,
        text: `${note}\n\nSecure recording link: ${recordingUrl}\n\nThis link expires automatically for security.`,
        html: `
          <p>${escapeHtml(note)}</p>
          <p><a href="${escapeHtml(recordingUrl)}">Listen to the secure recording</a></p>
          <p style="color:#6b7280;font-size:12px;">This link expires automatically for security.</p>
        `,
      });

      const deliveryRecord = {
        id: `recording-email-${Date.now()}-${randomUUID().slice(0, 8)}`,
        type: 'recording-email',
        messageId,
        leadId: body.leadId || message.leadId || '',
        leadName,
        to: recipientEmail,
        subject,
        storagePath,
        signedUrlExpiresIn: signed?.expiresIn || 0,
        provider: delivery.provider || 'email',
        live: Boolean(delivery.live),
        ok: Boolean(delivery.ok),
        status: delivery.ok ? 'sent' : 'failed',
        createdAt: isoNow(),
        updatedAt: isoNow(),
      };
      addDocumentDelivery(state, deliveryRecord);
      await persistEmailLogRecord(deliveryRecord);
      upsertMessage(
        state,
        createMessageRecord({
          id: `msg-${deliveryRecord.id}`,
          leadId: deliveryRecord.leadId,
          leadName,
          address: body.address || message.address || '',
          channel: 'email',
          direction: 'outbound',
          provider: delivery.provider || 'Resend',
          status: delivery.ok ? 'sent' : 'failed',
          body: `Recording package sent to ${recipientEmail}.`,
          payload: {
            type: 'recording-email',
            messageId,
            delivery: deliveryRecord,
          },
        }),
      );
      addActivity(
        state,
        makeActivity({
          actor: body.actor || 'Command Center',
          category: 'EMAIL',
          status: delivery.ok ? 'sent' : 'failed',
          text: `Recording package ${delivery.ok ? 'sent' : 'attempted'} for ${leadName}.`,
          target: recipientEmail,
        }),
      );
      await persistState(state);
      json(response, delivery.ok ? 200 : 502, {
        ok: Boolean(delivery.ok),
        delivery,
        deliveryRecord,
        signed,
        signedUrl: recordingUrl,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/recordings/retention/preview') {
      const result = await runRecordingRetentionCleanup({
        dryRun: true,
        days: Number(url.searchParams.get('days') || 0),
        actor: url.searchParams.get('actor') || 'Command Center',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/recordings/retention/run') {
      const body = await readBody(request);
      const result = await runRecordingRetentionCleanup({
        dryRun: body.dryRun ?? true,
        days: Number(body.days || body.retentionDays || 0),
        actor: body.actor || 'Retention worker',
      });
      json(response, 200, result);
      return;
    }

    if (request.method === 'POST' && pathname === '/api/recordings/capture') {
      const body = await readBody(request);
      const result = await captureRecordingFromPayload(body);
      json(response, result.ok ? 200 : 501, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const recordingMatch = matchPath(pathname, '/api/recordings/:messageId');
    if (recordingMatch && request.method === 'GET') {
      const messageId = decodeURIComponent(recordingMatch.groups.messageId || '');
      const message = findMessageById(messageId);
      if (!message) {
        json(response, 404, { ok: false, messageId, error: 'Recording message not found.' });
        return;
      }
      const directUrl = getMessageRecordingUrl(message);
      if (directUrl) {
        json(response, 200, {
          ok: true,
          messageId,
          source: 'direct-url',
          url: directUrl,
          message,
        });
        return;
      }
      const storagePath = getMessageRecordingPath(message);
      const signed = await createSupabaseRecordingSignedUrl(
        storagePath,
        Number(url.searchParams.get('expiresIn') || SUPABASE_RECORDING_SIGNED_URL_TTL_SECONDS),
      );
      json(response, signed.ok ? 200 : 501, {
        ...signed,
        messageId,
        message,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/recordings') {
      const body = await readBody(request);
      const messageId = body.messageId || body.id || `msg-recording-${Date.now()}`;
      const existing = findMessageById(messageId);
      const storagePath = buildRecordingStoragePath({ ...body, messageId });
      const contentType = body.contentType || body.audioContentType || 'audio/mpeg';
      let upload = null;
      if (body.audioBase64) {
        const base64 = String(body.audioBase64).replace(/^data:[^;]+;base64,/i, '');
        upload = await uploadSupabaseRecording({
          storagePath,
          contentType,
          bytes: Buffer.from(base64, 'base64'),
        });
        if (upload.ok === false) {
          json(response, 501, { ...upload, messageId, storagePath });
          return;
        }
      }
      const message = {
        ...(existing || createMessageRecord({
          ...body,
          id: messageId,
          channel: body.channel || 'call',
          direction: body.direction || 'recording',
          provider: body.provider || 'Telnyx',
          status: body.status || 'recorded',
          body: body.body || 'Call recording captured.',
        })),
        ...body,
        id: messageId,
        channel: body.channel || existing?.channel || 'call',
        direction: body.direction || existing?.direction || 'recording',
        provider: body.provider || existing?.provider || 'Telnyx',
        status: body.status || existing?.status || 'recorded',
        storagePath,
        storageBucket: SUPABASE_CALL_RECORDINGS_BUCKET,
        audioContentType: contentType,
        durationSeconds: toNumber(body.durationSeconds || body.duration_seconds || existing?.durationSeconds, 0),
        recordingUrl: body.recordingUrl || body.audioUrl || existing?.recordingUrl || '',
        payload: {
          ...(existing?.payload && typeof existing.payload === 'object' ? existing.payload : {}),
          ...(body.payload && typeof body.payload === 'object' ? body.payload : {}),
          storagePath,
          storageBucket: SUPABASE_CALL_RECORDINGS_BUCKET,
          contentType,
          upload,
        },
        updatedAt: isoNow(),
      };
      upsertMessage(state, message);
      await persistUnifiedMessageRecord(message);
      addActivity(
        state,
        makeActivity({
          actor: body.actor || 'Telnyx',
          category: 'CALL',
          status: upload?.ok ? 'uploaded' : 'recorded',
          text: `Recording metadata saved for ${message.leadName || message.leadId || messageId}`,
          target: storagePath,
        }),
      );
      await persistState(state);
      json(response, 200, {
        ok: true,
        message,
        upload,
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

    if (request.method === 'GET' && matchesPath(pathname, ['/api/leads', '/api/leads/import'])) {
      json(response, 200, {
        ok: true,
        leadImports: state.leadImports,
        leads: state.leadImports,
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/api/leads', '/api/leads/import'])) {
      const body = await readBody(request);
      const result = await handleEvent('lead-intake', body);
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        outcome: result.forwarded ? 'queued_for_approval' : 'live',
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
      const campaignWebhook = recordCampaignWebhookFromPayload('Instantly', body, eventType);
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
        campaignWebhook,
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
      if (isTelnyxInboundCallWebhook(body)) {
        const result = await handleAvaInboundRoute(body, { actor: 'Telnyx inbound webhook' });
        json(response, result.result === 'provider_missing' ? 202 : 200, {
          ok: true,
          mappedEvent: 'inbound-call-route',
          result,
          state: buildStateSnapshot(),
        });
        return;
      }
      const mapped = mapTelnyxWebhook(body);
      const campaignWebhook = recordCampaignWebhookFromPayload('Telnyx', {
        ...body,
        ...(mapped.payload || {}),
      }, mapped.eventType);
      const result = await handleEvent(mapped.eventType, mapped.payload);
      json(response, result.ok === false ? 404 : 200, {
        ok: true,
        mappedEvent: mapped.eventType,
        campaignWebhook,
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/webhooks/telnyx/recording', '/api/webhooks/telnyx/recording'])) {
      const body = await readBody(request);
      const result = await captureRecordingFromPayload(body);
      json(response, result.ok ? 200 : 501, {
        ok: Boolean(result.ok),
        mappedEvent: 'recording-capture',
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/webhooks/docusign') {
      const body = await readBody(request);
      const mapped = mapDocuSignWebhook(body);
      const campaignWebhook = recordCampaignWebhookFromPayload('DocuSign', body, mapped.eventType);
      const result = await handleEvent(mapped.eventType, mapped.payload);
      json(response, result.ok === false ? 404 : 200, {
        ok: true,
        mappedEvent: mapped.eventType,
        campaignWebhook,
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
        'GET/POST /api/settings',
        'GET /api/analytics',
        'GET /api/analytics/campaign-drilldown',
        'GET /api/memory/analytics',
        'GET /api/memory/stats',
        'GET /api/agent/history',
        'GET /api/skills/outcomes',
        'GET /api/fleet/outcomes',
        'GET /api/objection/playbooks',
        'GET/POST /api/lead-scoring/weights',
        'GET/POST /api/rex/decisions',
        'POST /api/rex/strategist/proposals',
        'GET/POST /api/ava/active-memory',
        'POST /api/ava/learning/run',
        'POST /api/ava/inbound/route',
        'POST /api/campaigns/:id/script',
        'POST /api/campaigns/:id/sequence',
        'POST /api/slack/interactions',
        'GET /api/deepgram/health',
        'POST /api/deepgram/transcribe-url',
        'GET /api/tooling/status',
        'GET/POST /api/workflows',
        'GET/POST /api/property-data',
        'GET /api/brain/email-context',
        'POST /brain/ingest',
        'GET/POST /brain/query',
        'GET /api/participants/profile',
        'GET /api/crm/streak/status',
        'GET /api/crm/streak/bootstrap-plan',
        'GET /metrics',
        'GET /api/contracts/templates',
        'GET /api/contracts/paths',
        'POST /api/contracts/reload',
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
        'GET/POST /api/browser-research/jobs/:jobId',
        'POST /api/browser-research/complete',
        'GET /api/telnyx/numbers',
        'GET /api/instantly/senders',
        'GET/POST/PATCH /api/campaigns',
        'GET /api/campaigns/lead-sources',
        'POST /api/campaigns/:campaignId/approval',
        'POST /api/campaigns/:campaignId/actions',
        'POST /api/campaigns/:campaignId/events',
        'POST /api/campaigns/run-due',
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
        'GET /api/recordings/:messageId',
        'POST /api/recordings/fixture',
        'POST /api/recordings',
        'GET/POST /api/contracts',
        'POST /api/contracts/prepare',
        'POST /api/contracts/lawyer-review',
        'POST /api/underwriting/sign',
        'GET/POST /api/leads/import',
        'POST /api/webhooks/booking',
        'POST /api/webhooks/instantly',
        'POST /api/webhooks/email',
        'POST /api/webhooks/telnyx',
        'POST /api/webhooks/telnyx/inbound',
        'WS /api/webhooks/telnyx/media',
        'POST /webhooks/telnyx/recording',
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

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 120000;
server.maxRequestsPerSocket = 1000;

const telnyxDeepgramWss = new WebSocketServer({ noServer: true });
telnyxDeepgramWss.on('connection', (socket, request) => {
  void handleTelnyxDeepgramMediaSocket(socket, request);
});

server.on('upgrade', (request, socket, head) => {
  const upgradeUrl = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const upgradePath = upgradeUrl.pathname.replace(/\/+$/, '') || '/';
  if (!matchesPath(upgradePath, ['/api/webhooks/telnyx/media', '/webhooks/telnyx/media'])) {
    socket.destroy();
    return;
  }

  if (TELNYX_MEDIA_STREAM_TOKEN) {
    const providedToken = upgradeUrl.searchParams.get('token') || String(request.headers['x-pbk-stream-token'] || '').trim();
    if (providedToken !== TELNYX_MEDIA_STREAM_TOKEN) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  telnyxDeepgramWss.handleUpgrade(request, socket, head, (ws) => {
    telnyxDeepgramWss.emit('connection', ws, request);
  });
});

server.listen(PORT, HOST, () => {
  startContractTemplateWatcher();
  reloadContractTemplateLibrary('startup').catch((error) => {
    console.warn('[pbk-local-openclaw] contract template startup load failed:', error instanceof Error ? error.message : error);
  });
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
