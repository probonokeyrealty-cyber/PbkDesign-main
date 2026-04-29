import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const PORT = Number(process.env.PBK_TOOLING_PORT || 18791);
const API_KEY = String(process.env.PBK_TOOLING_API_KEY || 'pbk-tooling-test-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHealth(timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw lastError || new Error('Timed out waiting for bridge health.');
}

async function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(scriptPath)} failed with code ${code}`));
      }
    });
  });
}

async function main() {
  const child = spawn(process.execPath, [SERVER_ENTRY, '--reset'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PBK_OPENCLAW_PORT: String(PORT),
      PBK_BRIDGE_API_KEY: API_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  const cleanup = async () => {
    if (!child.killed) {
      child.kill();
      await delay(150);
    }
  };

  try {
    await waitForHealth();
    const metricsText = await fetch(`${BASE_URL}/metrics`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`/metrics returned ${response.status}`);
      return response.text();
    });

    assert(metricsText.includes('pbk_approvals_pending'), 'Metrics output is missing pbk_approvals_pending.');
    assert(metricsText.includes('pbk_provider_ready{provider="instantly"}'), 'Metrics output is missing provider readiness gauges.');

    await runNodeScript(path.join(ROOT_DIR, 'scripts', 'render-monitoring-config.mjs'));
    await runNodeScript(path.join(ROOT_DIR, 'scripts', 'export-meta-agent-scenario.mjs'));
    await runNodeScript(path.join(ROOT_DIR, 'scripts', 'seed-browser-research-jobs.mjs'));

    const requiredFiles = [
      path.join(ROOT_DIR, 'ops', 'monitoring', 'docker-compose.observability.yml'),
      path.join(ROOT_DIR, 'ops', 'monitoring', 'prometheus', 'generated.prometheus.yml'),
      path.join(ROOT_DIR, 'ops', 'monitoring', 'grafana', 'dashboards', 'pbk-runtime.json'),
      path.join(ROOT_DIR, 'ops', 'browser-research', 'generated-jobs.json'),
      path.join(ROOT_DIR, 'labs', 'meta-agent', 'generated', 'latest-scenario.json'),
      path.join(ROOT_DIR, 'n8n-lite', 'tooling-health-check.json'),
      path.join(ROOT_DIR, 'mcp-servers', 'registry.example.json'),
    ];

    requiredFiles.forEach((filePath) => {
      assert(existsSync(filePath), `Required tooling artifact is missing: ${filePath}`);
    });

    const dashboard = JSON.parse(await readFile(path.join(ROOT_DIR, 'ops', 'monitoring', 'grafana', 'dashboards', 'pbk-runtime.json'), 'utf8'));
    const researchJobs = JSON.parse(await readFile(path.join(ROOT_DIR, 'ops', 'browser-research', 'generated-jobs.json'), 'utf8'));
    const scenario = JSON.parse(await readFile(path.join(ROOT_DIR, 'labs', 'meta-agent', 'generated', 'latest-scenario.json'), 'utf8'));
    const registry = JSON.parse(await readFile(path.join(ROOT_DIR, 'mcp-servers', 'registry.example.json'), 'utf8'));

    assert(Array.isArray(dashboard?.panels) && dashboard.panels.length > 0, 'Grafana dashboard has no panels.');
    assert(Array.isArray(researchJobs?.jobs), 'Browser research job seed is missing jobs.');
    assert(Array.isArray(scenario?.leads), 'Meta-agent scenario is missing leads.');
    assert(registry?.mcpServers?.['pbk-openclaw'], 'MCP registry is missing pbk-openclaw.');
    assert(registry?.mcpServers?.browseros, 'MCP registry is missing browseros.');

    console.log(JSON.stringify({
      ok: true,
      metricsReady: true,
      dashboardPanels: dashboard.panels.length,
      researchJobs: researchJobs.jobs.length,
      scenarioLeads: scenario.leads.length,
      registryServers: Object.keys(registry.mcpServers || {}).length,
    }, null, 2));
  } catch (error) {
    await cleanup();
    if (stderr.trim()) console.error(stderr.trim());
    console.error(error instanceof Error ? error.message : 'Unknown tooling verification failure');
    process.exitCode = 1;
    return;
  }

  await cleanup();
}

main();
