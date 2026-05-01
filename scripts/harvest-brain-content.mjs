import { execFileSync } from 'node:child_process';

function hydrateWindowsUserEnv(keys = []) {
  if (process.platform !== 'win32' || !Array.isArray(keys) || !keys.length) return;
  try {
    const quotedKeys = keys.map((key) => `'${String(key).replace(/'/g, "''")}'`).join(', ');
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$names = @(${quotedKeys}); $result = @{}; foreach ($name in $names) { $value = [Environment]::GetEnvironmentVariable($name, 'User'); if ($value) { $result[$name] = $value } }; $result | ConvertTo-Json -Compress`,
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    if (!output) return;
    const values = JSON.parse(output);
    for (const key of keys) {
      if (!process.env[key] && values?.[key]) process.env[key] = values[key];
    }
  } catch {
    // Local convenience only. The script still runs with the current env.
  }
}

hydrateWindowsUserEnv(['PBK_BRIDGE_API_KEY', 'PBK_OPENCLAW_ENDPOINT', 'PBK_BRIDGE_URL', 'PBK_BRAIN_BLOG_FEEDS']);

const baseUrl = String(process.env.PBK_OPENCLAW_ENDPOINT || process.env.PBK_BRIDGE_URL || 'http://127.0.0.1:8788')
  .trim()
  .replace(/\/+$/g, '');
const apiKey = String(process.env.PBK_BRIDGE_API_KEY || '').trim();

const response = await fetch(`${baseUrl}/api/brain/blog/harvest`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  },
  body: JSON.stringify({
    requestedBy: 'brain-harvester-script',
    source: 'npm:brain:harvest',
    limit: Number(process.env.PBK_BRAIN_BLOG_HARVEST_LIMIT || 8),
  }),
});

const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.ok) {
  console.error(JSON.stringify(payload || { ok: false, status: response.status }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  added: payload.added?.length || 0,
  skipped: payload.skipped || 0,
  errors: payload.errors || [],
  feeds: (payload.feeds || []).map((feed) => feed.name || feed.url),
}, null, 2));
