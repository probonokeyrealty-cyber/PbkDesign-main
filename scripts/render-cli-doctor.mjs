import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'yaml';

const ROOT = process.cwd();
const RENDER_YAML = resolve(ROOT, 'render.yaml');
const STRICT = process.argv.includes('--strict');
const JSON_OUTPUT = process.argv.includes('--json') || !process.stdout.isTTY;
const MODE = process.argv.includes('--validate-only')
  ? 'validate'
  : process.argv.includes('--status-only')
    ? 'status'
    : process.argv.includes('--logs-errors-only')
      ? 'logs-errors'
      : 'full';

const RENDER_ENV_KEYS = [
  'RENDER_API_KEY',
  'PBK_RENDER_API_KEY',
  'RENDER_SERVICE_ID',
  'PBK_RENDER_SERVICE_ID',
  'RENDER_WORKSPACE_ID',
  'PBK_RENDER_WORKSPACE_ID',
  'RENDER_CLI_BIN',
  'RENDER_CLI_PATH',
];

function readWindowsStoredEnv(key) {
  if (process.platform !== 'win32' || !key) return '';
  const escapedKey = key.replace(/'/g, "''");
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$v=[Environment]::GetEnvironmentVariable('${escapedKey}','User'); if(-not $v){$v=[Environment]::GetEnvironmentVariable('${escapedKey}','Machine')}; [Console]::Out.Write($v)`,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 5000, windowsHide: true }
  );
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function buildRenderEnv() {
  const env = {};
  for (const key of RENDER_ENV_KEYS) {
    const value = String(process.env[key] || readWindowsStoredEnv(key) || '').trim();
    if (value) env[key] = value;
  }
  if (!env.RENDER_API_KEY && env.PBK_RENDER_API_KEY) {
    env.RENDER_API_KEY = env.PBK_RENDER_API_KEY;
  }
  if (!env.RENDER_SERVICE_ID && env.PBK_RENDER_SERVICE_ID) {
    env.RENDER_SERVICE_ID = env.PBK_RENDER_SERVICE_ID;
  }
  if (!env.RENDER_WORKSPACE_ID && env.PBK_RENDER_WORKSPACE_ID) {
    env.RENDER_WORKSPACE_ID = env.PBK_RENDER_WORKSPACE_ID;
  }
  return env;
}

const HYDRATED_RENDER_ENV = buildRenderEnv();
const WORKSPACE_ID = String(
  HYDRATED_RENDER_ENV.PBK_RENDER_WORKSPACE_ID || HYDRATED_RENDER_ENV.RENDER_WORKSPACE_ID || ''
).trim();
const SERVICE_ID = String(
  HYDRATED_RENDER_ENV.PBK_RENDER_SERVICE_ID || HYDRATED_RENDER_ENV.RENDER_SERVICE_ID || ''
).trim();

function getRenderCommand() {
  const candidates = [
    HYDRATED_RENDER_ENV.RENDER_CLI_BIN,
    HYDRATED_RENDER_ENV.RENDER_CLI_PATH,
    process.env.USERPROFILE ? resolve(process.env.USERPROFILE, '.local/bin/render.exe') : '',
    process.env.USERPROFILE ? resolve(process.env.USERPROFILE, '.local/render-cli/render.exe') : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'render';
}

const RENDER_COMMAND = getRenderCommand();

function sanitize(value = '') {
  return String(value || '')
    .replace(/rnd_[A-Za-z0-9_-]+/g, 'rnd_[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://[redacted]@')
    .slice(0, 800);
}

function runRender(args = [], options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(RENDER_COMMAND, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...HYDRATED_RENDER_ENV,
      RENDER_OUTPUT: 'json',
      ...(options.env || {}),
    },
    timeout: options.timeoutMs || 30000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || '',
    rawStdout: result.stdout || '',
    rawStderr: result.stderr || '',
    stdout: sanitize(result.stdout),
    stderr: sanitize(result.stderr),
    latencyMs: Math.max(0, Date.now() - startedAt),
    error: sanitize(result.error?.message || ''),
  };
}

function parseJson(text = '') {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getBlueprintInventory() {
  const source = readFileSync(RENDER_YAML, 'utf8');
  const blueprint = parse(source);
  const services = Array.isArray(blueprint?.services) ? blueprint.services : [];
  const databases = Array.isArray(blueprint?.databases) ? blueprint.databases : [];
  const webServices = services
    .filter((service) => service?.type === 'web')
    .map((service) => service.name);
  const workers = services
    .filter((service) => service?.type === 'worker' || service?.type === 'cron')
    .map((service) => service.name);
  const keyvalues = services
    .filter((service) => service?.type === 'keyvalue')
    .map((service) => service.name);

  return {
    services: services.map((service) => ({
      name: service.name,
      type: service.type,
      plan: service.plan || '',
      region: service.region || '',
    })),
    databases: databases.map((database) => ({
      name: database.name,
      plan: database.plan || '',
      region: database.region || '',
      postgresMajorVersion: database.postgresMajorVersion || '',
    })),
    expectedNames: [
      ...services.map((service) => service.name),
      ...databases.map((database) => database.name),
    ].filter(Boolean),
    criticalNames: [
      'pbk-openclaw-bridge',
      'pbk-event-worker',
      'pbk-coworker-heartbeat',
      'pbk-nightly-learning',
      'pbk-openclaw-redis',
      'pbk-openclaw-db',
    ],
    webServices,
    workers,
    keyvalues,
  };
}

function collectRenderNames(value, names = new Set()) {
  if (!value || typeof value !== 'object') return names;
  if (Array.isArray(value)) {
    for (const item of value) collectRenderNames(item, names);
    return names;
  }

  for (const key of ['name', 'serviceName', 'resourceName']) {
    if (typeof value[key] === 'string' && value[key]) names.add(value[key]);
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') collectRenderNames(nested, names);
  }
  return names;
}

function collectRenderLogRecords(value, records = []) {
  if (!value || typeof value !== 'object') return records;
  if (Array.isArray(value)) {
    for (const item of value) collectRenderLogRecords(item, records);
    return records;
  }

  const looksLikeLogRecord = ['message', 'text', 'log', 'level', 'timestamp', 'statusCode'].some(
    (key) => Object.prototype.hasOwnProperty.call(value, key)
  );
  if (looksLikeLogRecord) {
    records.push(value);
    return records;
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') collectRenderLogRecords(nested, records);
  }
  return records;
}

function summarizeRenderLogRecord(record = {}) {
  return {
    level: sanitize(record.level || record.severity || ''),
    statusCode: sanitize(record.statusCode || record.status || ''),
    message: sanitize(record.message || record.text || record.log || '').slice(0, 300),
    timestamp: sanitize(record.timestamp || record.time || ''),
  };
}

function getMissingExpected(renderNames, expectedNames = []) {
  const normalized = new Set([...renderNames].map((name) => String(name || '').toLowerCase()));
  return expectedNames.filter((name) => !normalized.has(String(name || '').toLowerCase()));
}

function summarizeCommand(command, result) {
  return {
    command,
    ok: result.ok,
    status: result.status,
    signal: result.signal,
    latencyMs: result.latencyMs,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

const blockers = [];
const warnings = [];
const nextSteps = [];

let inventory;
try {
  inventory = getBlueprintInventory();
} catch (error) {
  blockers.push('render_yaml_unreadable');
  inventory = {
    services: [],
    databases: [],
    expectedNames: [],
    criticalNames: [],
    webServices: [],
    workers: [],
    keyvalues: [],
    error: sanitize(error?.message || error),
  };
}

const versionCheck = runRender(['--version'], { timeoutMs: 15000 });
if (!versionCheck.ok) {
  blockers.push('render_cli_missing');
  nextSteps.push('Install Render CLI and ensure render.exe is on PATH.');
}

const whoami = versionCheck.ok ? runRender(['whoami', '--confirm', '-o', 'json']) : null;
const authenticated = Boolean(whoami?.ok);
if (versionCheck.ok && !authenticated) {
  blockers.push('render_cli_auth_missing');
  nextSteps.push(
    'Run render login, then render workspace set, or export RENDER_API_KEY for non-interactive use.'
  );
}

const shouldValidateBlueprint = MODE === 'full' || MODE === 'validate';
const shouldCheckWorkspace = MODE === 'full' || MODE === 'status';
const shouldCheckLogs = MODE === 'full' || MODE === 'logs-errors';

const workspaceCurrent =
  versionCheck.ok && authenticated && shouldCheckWorkspace
    ? runRender(['workspace', 'current', '--confirm', '-o', 'json'])
    : null;

const blueprintArgs = ['blueprints', 'validate', './render.yaml', '--confirm', '-o', 'json'];
if (WORKSPACE_ID) blueprintArgs.push('--workspace', WORKSPACE_ID);
const blueprintValidation =
  versionCheck.ok && shouldValidateBlueprint
    ? runRender(blueprintArgs, { timeoutMs: 60000 })
    : null;
if (versionCheck.ok && shouldValidateBlueprint && !blueprintValidation?.ok) {
  const needsWorkspace = /no workspace specified|no default workspace/i.test(
    `${blueprintValidation?.stdout || ''}\n${blueprintValidation?.stderr || ''}`
  );
  if (needsWorkspace) {
    warnings.push(
      'Blueprint validation needs a Render workspace. Set PBK_RENDER_WORKSPACE_ID or run render workspace set.'
    );
  } else {
    blockers.push('render_blueprint_validation_failed');
  }
}

const services =
  authenticated && shouldCheckWorkspace
    ? runRender(['services', '--confirm', '-o', 'json'], { timeoutMs: 60000 })
    : null;
let renderNames = new Set();
let missingExpectedNames = [];
if (services?.ok) {
  const parsedServices = parseJson(services.rawStdout);
  renderNames = collectRenderNames(parsedServices);
  missingExpectedNames = getMissingExpected(renderNames, inventory.expectedNames);
  if (missingExpectedNames.length) {
    blockers.push('render_workspace_missing_blueprint_resources');
    nextSteps.push(
      `Sync the Blueprint or verify workspace selection. Missing: ${missingExpectedNames.join(', ')}`
    );
  }
} else if (authenticated && shouldCheckWorkspace) {
  blockers.push('render_services_unavailable');
}

const deploys =
  authenticated && SERVICE_ID && shouldCheckWorkspace
    ? runRender(['deploys', 'list', SERVICE_ID, '--confirm', '-o', 'json'], { timeoutMs: 60000 })
    : null;
if (authenticated && SERVICE_ID && shouldCheckWorkspace && !deploys?.ok) {
  blockers.push('render_deploys_unavailable');
}

const errorLogs =
  authenticated && SERVICE_ID && shouldCheckLogs
    ? runRender(
        [
          'logs',
          '--resources',
          SERVICE_ID,
          '--level',
          'error',
          '--limit',
          '50',
          '--confirm',
          '-o',
          'json',
        ],
        { timeoutMs: 60000 }
      )
    : null;
let renderErrorLogRecords = [];
if (authenticated && SERVICE_ID && shouldCheckLogs && !errorLogs?.ok) {
  const message =
    'Render error-log query failed; verify PBK_RENDER_SERVICE_ID and workspace selection.';
  if (MODE === 'logs-errors') blockers.push('render_error_logs_unavailable');
  else warnings.push(message);
} else if (authenticated && SERVICE_ID && shouldCheckLogs && errorLogs?.ok) {
  renderErrorLogRecords = collectRenderLogRecords(parseJson(errorLogs.rawStdout));
  if (renderErrorLogRecords.length) {
    const message = `Render returned ${renderErrorLogRecords.length} recent error log record(s).`;
    if (MODE === 'logs-errors') blockers.push('render_recent_error_logs_present');
    else warnings.push(message);
    nextSteps.push(
      'Inspect Render error logs and clear the underlying runtime errors before treating the bridge as healthy.'
    );
  }
}

if ((MODE === 'logs-errors' || MODE === 'status') && !SERVICE_ID) {
  blockers.push('render_service_id_missing');
  nextSteps.push(
    'Set PBK_RENDER_SERVICE_ID or RENDER_SERVICE_ID to query deploys/logs for the bridge service.'
  );
}

for (const criticalName of inventory.criticalNames) {
  if (!inventory.expectedNames.includes(criticalName)) {
    blockers.push(`render_yaml_missing:${criticalName}`);
  }
}

const ready = blockers.length === 0;
const report = {
  ok: ready,
  ready,
  result: ready ? 'render_cli_connection_ready' : 'render_cli_connection_degraded',
  checkedAt: new Date().toISOString(),
  mode: MODE,
  strict: STRICT,
  cli: {
    installed: versionCheck.ok,
    path: RENDER_COMMAND,
    version: versionCheck.stdout.split('\n').find((line) => /render v/i.test(line)) || '',
    command: summarizeCommand('render --version', versionCheck),
  },
  auth: {
    authenticated,
    workspaceIdConfigured: Boolean(WORKSPACE_ID),
    command: whoami ? summarizeCommand('render whoami --confirm -o json', whoami) : null,
    workspaceCurrent: workspaceCurrent
      ? summarizeCommand('render workspace current --confirm -o json', workspaceCurrent)
      : null,
  },
  blueprint: {
    path: RENDER_YAML,
    expectedNames: inventory.expectedNames,
    services: inventory.services,
    databases: inventory.databases,
    command: blueprintValidation
      ? summarizeCommand(`render ${blueprintArgs.join(' ')}`, blueprintValidation)
      : null,
  },
  renderWorkspace: {
    checked: Boolean(services),
    command: services ? summarizeCommand('render services --confirm -o json', services) : null,
    discoveredNames: [...renderNames].sort(),
    missingExpectedNames,
    serviceIdConfigured: Boolean(SERVICE_ID),
    deploys: deploys
      ? summarizeCommand(`render deploys list ${SERVICE_ID} --confirm -o json`, deploys)
      : null,
    errorLogs: errorLogs
      ? summarizeCommand(
          `render logs --resources ${SERVICE_ID} --level error --limit 50 --confirm -o json`,
          errorLogs
        )
      : null,
    errorLogCount: renderErrorLogRecords.length,
    errorLogSample: renderErrorLogRecords.slice(0, 3).map(summarizeRenderLogRecord),
  },
  subagentConnection: {
    strengthenedBy: [
      'Local Render CLI version check before deploy troubleshooting.',
      'Workspace-aware Blueprint validation once Render auth/workspace is configured.',
      'Resource-name correlation between render.yaml, Render services, databases, workers, and keyvalue stores.',
      'A shared doctor command subagents can run before debugging bridge, registry, or health failures.',
    ],
    hostedBridgeStillUses: ['PBK_RENDER_API_KEY', 'PBK_RENDER_SERVICE_ID'],
  },
  blockers,
  warnings,
  nextSteps,
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${report.result}: ${ready ? 'ready' : 'degraded'}`);
  for (const blocker of blockers) console.log(`blocker: ${blocker}`);
  for (const warning of warnings) console.log(`warning: ${warning}`);
  for (const step of nextSteps) console.log(`next: ${step}`);
}

if (STRICT && !ready) process.exit(1);
