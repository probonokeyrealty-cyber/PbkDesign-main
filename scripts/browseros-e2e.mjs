import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const PORT = Number(process.env.PBK_BROWSEROS_E2E_PORT || 19790);
const API_KEY = String(process.env.PBK_BROWSEROS_E2E_API_KEY || process.env.PBK_BRIDGE_API_KEY || 'pbk-browseros-e2e-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
  };
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { response, parsed };
}

async function waitForHealth(timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const { response, parsed } = await requestJson('/health');
      if (response.ok) return parsed;
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }

  throw lastError || new Error('Timed out waiting for bridge health.');
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
    const health = await waitForHealth();
    assert(health?.ok === true, 'Bridge health did not report ok: true.');

    const tooling = await requestJson('/api/tooling/status', {
      headers: authHeaders(),
    });
    assert(tooling.response.ok && tooling.parsed?.ok === true, 'Tooling status failed.');
    const browserOs = tooling.parsed?.tooling?.browserOs || {};
    assert(browserOs.ready === true, 'BrowserOS is not registered in the MCP registry.');
    assert(String(browserOs.endpoint || '').includes('/mcp'), 'BrowserOS endpoint does not look like an MCP endpoint.');

    const directResearch = await requestJson('/api/browser-research/launch', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'Use BrowserOS to inspect https://pbkcommandcenter.netlify.app and report the current PBK page title.',
        requestedBy: 'browseros-e2e',
        source: 'browseros-e2e',
      }),
    });
    assert(directResearch.response.ok && directResearch.parsed?.ok === true, 'Direct BrowserOS research launch failed.');
    assert(directResearch.parsed?.job?.provider === 'browseros', 'Direct research job did not use BrowserOS.');
    assert(directResearch.parsed?.job?.status === 'queued', `Expected queued BrowserOS job, got ${directResearch.parsed?.job?.status || 'missing'}.`);

    const routedCommand = await requestJson('/invoke', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolName: 'runAgentCommand',
        params: {
          command: 'Rex, use BrowserOS to inspect 202 Cherry Ln on Zillow and summarize the property details.',
          actor: 'browseros-e2e',
        },
      }),
    });
    assert(routedCommand.response.ok && routedCommand.parsed?.ok === true, 'BrowserOS plain-language command failed.');
    assert(routedCommand.parsed?.result?.routedTo === 'launchBrowserResearch', `Expected runAgentCommand to route to launchBrowserResearch, got ${routedCommand.parsed?.result?.routedTo || 'missing'}.`);
    assert(routedCommand.parsed?.result?.response?.job?.provider === 'browseros', 'Plain-language BrowserOS route did not create a BrowserOS job.');

    const state = await requestJson('/state', {
      headers: authHeaders(),
    });
    assert(state.response.ok, 'Authenticated state lookup failed after BrowserOS E2E.');
    const browserJobs = Array.isArray(state.parsed?.activity)
      ? state.parsed.activity.filter((item) => String(item.category || '').toUpperCase() === 'RESEARCH')
      : [];
    assert(browserJobs.length >= 2, 'BrowserOS E2E did not record the expected research activity.');

    console.log(JSON.stringify({
      ok: true,
      revision: health.revision,
      browserOsReady: Boolean(browserOs.ready),
      endpoint: browserOs.endpoint,
      directJobStatus: directResearch.parsed.job.status,
      routedTo: routedCommand.parsed.result.routedTo,
      routedJobStatus: routedCommand.parsed.result.response.job.status,
      researchActivities: browserJobs.length,
      note: 'BrowserOS lane verified through Rex/OpenClaw. This intentionally does not use the Playwright test runner.',
    }, null, 2));
  } catch (error) {
    await cleanup();
    if (stderr.trim()) console.error(stderr.trim());
    console.error(error instanceof Error ? error.message : 'Unknown BrowserOS E2E failure');
    process.exitCode = 1;
    return;
  }

  await cleanup();
}

main();
