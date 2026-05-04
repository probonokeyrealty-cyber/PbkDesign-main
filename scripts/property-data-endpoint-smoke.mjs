import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const PORT = Number(process.env.PBK_PROPERTY_DATA_SMOKE_PORT || 18893);
const API_KEY = String(process.env.PBK_PROPERTY_DATA_SMOKE_API_KEY || 'pbk-property-data-smoke-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForHealth(timeoutMs = 20000) {
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
    await delay(350);
  }
  throw lastError || new Error('Timed out waiting for bridge health.');
}

async function postJson(pathname, body) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || json.ok === false) {
    throw new Error(`${pathname} failed: ${response.status} ${JSON.stringify(json).slice(0, 1000)}`);
  }
  return json;
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
      await delay(200);
    }
  };

  try {
    await waitForHealth();
    const scrapling = await postJson('/api/property-data/scrape', {
      provider: 'scrapling',
      url: 'https://example.com',
      requestedBy: 'property-data-endpoint-smoke',
    });
    const homeharvest = await postJson('/api/property-data/scrape', {
      provider: 'homeharvest',
      location: '43215',
      listingType: 'for_sale',
      limit: 1,
      importLeads: true,
      cache: true,
      requestedBy: 'property-data-endpoint-smoke',
    });
    const summary = {
      ok: true,
      scrapling: {
        provider: scrapling.provider,
        status: scrapling.status,
        title: scrapling.title,
      },
      homeharvest: {
        provider: homeharvest.provider,
        count: homeharvest.count,
        cachedCount: homeharvest.cachedCount,
        importedCount: homeharvest.importResult?.importedCount || 0,
        updatedCount: homeharvest.importResult?.updatedCount || 0,
        firstAddress: homeharvest.leads?.[0]?.property?.address || '',
      },
    };
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (stderr) console.error(stderr.slice(-2000));
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
