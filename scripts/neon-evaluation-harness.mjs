#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const DEFAULT_COMMAND = 'npm run test:ava-eval-suite';
const DEFAULT_TTL_HOURS = 24;

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    dryRun: parseBoolean(env.PBK_NEON_EVAL_DRY_RUN),
    injectRuntimeDb: parseBoolean(env.PBK_NEON_EVAL_INJECT_RUNTIME_DB),
    ttlHours: Number(env.PBK_NEON_EVAL_TTL_HOURS || DEFAULT_TTL_HOURS),
    branchName: String(env.PBK_NEON_EVAL_BRANCH_NAME || '').trim(),
    parentBranchId: String(env.NEON_PARENT_BRANCH_ID || env.PBK_NEON_EVAL_PARENT_BRANCH_ID || '').trim(),
    command: String(env.PBK_NEON_EVAL_COMMAND || '').trim(),
    help: false,
  };

  const commandIndex = argv.indexOf('--');
  const optionArgs = commandIndex >= 0 ? argv.slice(0, commandIndex) : argv;
  const commandArgs = commandIndex >= 0 ? argv.slice(commandIndex + 1) : [];

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--inject-runtime-db') options.injectRuntimeDb = true;
    else if (arg === '--ttl-hours') {
      options.ttlHours = Number(optionArgs[index + 1] || '');
      index += 1;
    } else if (arg === '--branch-name') {
      options.branchName = String(optionArgs[index + 1] || '').trim();
      index += 1;
    } else if (arg === '--parent-branch-id') {
      options.parentBranchId = String(optionArgs[index + 1] || '').trim();
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (commandArgs.length > 0) options.command = commandArgs.join(' ');
  if (!options.command) options.command = DEFAULT_COMMAND;
  if (!Number.isFinite(options.ttlHours) || options.ttlHours <= 0 || options.ttlHours > 168) {
    throw new Error('TTL must be between 1 and 168 hours.');
  }
  return options;
}

function usage() {
  return `
Usage:
  npm run neon:evaluation -- [options] -- <command>

Examples:
  npm run neon:evaluation -- --dry-run -- npm run test:ava-eval-suite
  npm run neon:evaluation -- --ttl-hours 4 -- npm run test:approval-unison
  npm run neon:evaluation -- --inject-runtime-db -- npm run test:bridge

Environment:
  NEON_API_KEY                     Required unless --dry-run is set.
  NEON_PROJECT_ID                  Required unless --dry-run is set.
  NEON_PARENT_BRANCH_ID            Optional parent branch id.
  PBK_NEON_EVAL_TTL_HOURS          Optional branch TTL, default 24, max 168.

Safety:
  By default the child command receives PBK_TEST_DATABASE_URL and PBK_EVAL_DATABASE_URL only.
  PBK_DATABASE_URL, DATABASE_URL, SUPABASE_DB_URL, and PBK_MIGRATION_DATABASE_URL are scrubbed.
  Use --inject-runtime-db only when intentionally testing the runtime against the disposable branch.
`.trim();
}

function requireAnyEnv(names, env = process.env) {
  for (const name of names) {
    const value = String(env[name] || '').trim();
    if (value) return value;
  }
  throw new Error(`${names.join(' or ')} is required. Use --dry-run for local wiring validation.`);
}

function buildBranchName(options) {
  if (options.branchName) return options.branchName;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `pbk-eval-${stamp}-${randomUUID().slice(0, 8)}`;
}

function buildCreateBranchBody({ branchName, parentBranchId, expiresAt }) {
  return {
    endpoints: [
      {
        type: 'read_write',
      },
    ],
    branch: {
      name: branchName,
      expires_at: expiresAt,
      ...(parentBranchId ? { parent_id: parentBranchId } : {}),
    },
  };
}

async function neonApi(apiKey, path, options = {}) {
  const response = await fetch(`${NEON_API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.message || payload?.error || text || response.statusText;
    throw new Error(`Neon API ${response.status} ${options.method || 'GET'} ${path}: ${message}`);
  }
  return payload;
}

function getConnectionUri(payload) {
  const uri = payload?.connection_uris?.[0]?.connection_uri;
  if (!uri) throw new Error('Neon did not return a branch connection URI.');
  return uri;
}

function safeConnectionSummary(connectionUri) {
  try {
    const parsed = new URL(connectionUri);
    return `${parsed.protocol}//${parsed.username ? `${parsed.username}:***@` : ''}${parsed.host}${parsed.pathname}`;
  } catch {
    return 'postgresql://***';
  }
}

async function createNeonBranch({ apiKey, projectId, options }) {
  const branchName = buildBranchName(options);
  const expiresAt = new Date(Date.now() + options.ttlHours * 60 * 60 * 1000).toISOString();
  const body = buildCreateBranchBody({
    branchName,
    parentBranchId: options.parentBranchId,
    expiresAt,
  });
  const payload = await neonApi(apiKey, `/projects/${encodeURIComponent(projectId)}/branches`, {
    method: 'POST',
    body,
  });
  const branch = payload.branch || {};
  return {
    id: branch.id,
    name: branch.name || branchName,
    expiresAt: branch.expires_at || expiresAt,
    connectionUri: getConnectionUri(payload),
  };
}

async function deleteNeonBranch({ apiKey, projectId, branchId }) {
  if (!branchId) return;
  await neonApi(apiKey, `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`, {
    method: 'DELETE',
  });
}

function buildChildEnv({ env = process.env, branch, injectRuntimeDb = false }) {
  const connectionUri = branch.connectionUri;
  return {
    ...env,
    NEON_API_KEY: '',
    PBK_TEST_DATABASE_URL: connectionUri,
    PBK_EVAL_DATABASE_URL: connectionUri,
    PBK_NEON_EVAL_BRANCH_ID: branch.id || '',
    PBK_NEON_EVAL_BRANCH_NAME: branch.name || '',
    PBK_NEON_EVAL_BRANCH_EXPIRES_AT: branch.expiresAt || '',
    PBK_DATABASE_URL: '',
    DATABASE_URL: '',
    SUPABASE_DB_URL: '',
    PBK_MIGRATION_DATABASE_URL: '',
    ...(injectRuntimeDb
      ? {
          PBK_DATABASE_URL: connectionUri,
          DATABASE_URL: connectionUri,
        }
      : {}),
  };
}

function runCommand(command, env) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      env,
      shell: true,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('close', (code, signal) => {
      resolve({ code: code ?? 1, signal });
    });
  });
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.dryRun) {
    const branchName = buildBranchName(options);
    const expiresAt = new Date(Date.now() + options.ttlHours * 60 * 60 * 1000).toISOString();
    const body = buildCreateBranchBody({
      branchName,
      parentBranchId: options.parentBranchId,
      expiresAt,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          command: options.command,
          injectRuntimeDb: options.injectRuntimeDb,
          createBranchBody: body,
          childEnv: {
            PBK_TEST_DATABASE_URL: 'postgresql://***',
            PBK_EVAL_DATABASE_URL: 'postgresql://***',
            PBK_DATABASE_URL: options.injectRuntimeDb ? 'postgresql://***' : '',
            DATABASE_URL: options.injectRuntimeDb ? 'postgresql://***' : '',
            PBK_MIGRATION_DATABASE_URL: '',
          },
        },
        null,
        2
      )
    );
    return;
  }

  const apiKey = requireAnyEnv(['NEON_API_KEY', 'PBK_NEON_API_KEY']);
  const projectId = requireAnyEnv(['NEON_PROJECT_ID', 'PBK_NEON_PROJECT_ID', 'PBK_NEON_EVAL_PROJECT_ID']);
  let branch = null;
  try {
    branch = await createNeonBranch({ apiKey, projectId, options });
    console.log(
      `[pbk-neon-eval] created ${branch.name} (${branch.id}) expires=${branch.expiresAt} db=${safeConnectionSummary(
        branch.connectionUri
      )}`
    );
    const childEnv = buildChildEnv({ branch, injectRuntimeDb: options.injectRuntimeDb });
    const result = await runCommand(options.command, childEnv);
    if (result.code !== 0) {
      throw new Error(
        `Evaluation command failed with exit code ${result.code}${result.signal ? ` signal=${result.signal}` : ''}.`
      );
    }
    console.log(`[pbk-neon-eval] command passed: ${options.command}`);
  } finally {
    if (branch?.id) {
      await deleteNeonBranch({ apiKey, projectId, branchId: branch.id });
      console.log(`[pbk-neon-eval] deleted ${branch.name} (${branch.id})`);
    }
  }
}

main().catch((error) => {
  console.error(`[pbk-neon-eval] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
