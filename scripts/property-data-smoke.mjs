import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const VENV_DIR = path.join(ROOT_DIR, '.venv');
const PYTHON_BIN = process.platform === 'win32'
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python');
const SCRAPLING_BIN = process.platform === 'win32'
  ? path.join(VENV_DIR, 'Scripts', 'scrapling.exe')
  : path.join(VENV_DIR, 'bin', 'scrapling');
const STATUS_FILE = path.join(ROOT_DIR, 'ops', 'upgrade-integrations', 'local-property-data-status.json');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout: options.timeout || 60000,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
    },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
}

function parseLastJson(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning; Scrapling may log around the JSON line.
    }
  }
  return null;
}

const pythonProbe = String.raw`
import importlib.metadata as md
import inspect
import json

result = {
    "ok": False,
    "packages": {},
    "checks": {},
}

for name in ["homeharvest", "scrapling"]:
    result["packages"][name] = md.version(name)

import homeharvest
import scrapling
from homeharvest import scrape_property
from scrapling import Fetcher

result["checks"]["imports"] = True
result["checks"]["homeharvestScrapePropertySignature"] = str(inspect.signature(scrape_property))

page = Fetcher.get("https://example.com")
title = page.css("title::text").get(default="") if hasattr(page, "css") else ""
result["checks"]["scraplingExampleFetch"] = {
    "status": getattr(page, "status", None),
    "title": title,
    "url": getattr(page, "url", ""),
}
result["ok"] = result["checks"]["scraplingExampleFetch"]["status"] == 200 and title == "Example Domain"
print(json.dumps(result, sort_keys=True))
`;

async function main() {
  const startedAt = new Date().toISOString();
  const status = {
    ok: false,
    generatedAt: startedAt,
    mode: 'local-smoke',
    venv: {
      path: VENV_DIR,
      python: PYTHON_BIN,
      exists: existsSync(PYTHON_BIN),
    },
    scraplingCli: {
      path: SCRAPLING_BIN,
      exists: existsSync(SCRAPLING_BIN),
    },
    packages: {},
    checks: {},
    commands: {},
    remaining: [
      'Real property scraping is not run by this smoke test.',
      'Supabase lead/comps import wiring is still separate.',
      'Ava/Rex production tool invocation remains gated until source rules and envs are configured.',
    ],
  };

  if (!status.venv.exists) {
    status.error = `Missing local Python environment at ${PYTHON_BIN}`;
  } else {
    const probe = run(PYTHON_BIN, ['-c', pythonProbe], { timeout: 90000 });
    status.commands.pythonProbe = {
      ok: probe.ok,
      status: probe.status,
      stderr: probe.stderr,
    };
    const parsed = parseLastJson(probe.stdout);
    if (parsed) {
      status.packages = parsed.packages || {};
      status.checks = parsed.checks || {};
      status.ok = Boolean(parsed.ok);
    } else {
      status.error = 'Python probe did not return parseable JSON.';
      status.commands.pythonProbe.stdout = probe.stdout.slice(-1000);
    }
  }

  if (status.scraplingCli.exists) {
    const help = run(SCRAPLING_BIN, ['--help']);
    const mcpHelp = run(SCRAPLING_BIN, ['mcp', '--help']);
    status.commands.scraplingHelp = {
      ok: help.ok,
      status: help.status,
      firstLine: help.stdout.split(/\r?\n/)[0] || '',
      stderr: help.stderr,
    };
    status.commands.scraplingMcpHelp = {
      ok: mcpHelp.ok,
      status: mcpHelp.status,
      firstLine: mcpHelp.stdout.split(/\r?\n/)[0] || '',
      stderr: mcpHelp.stderr,
    };
    status.ok = Boolean(status.ok && help.ok && mcpHelp.ok);
  } else {
    status.ok = false;
  }

  await mkdir(path.dirname(STATUS_FILE), { recursive: true });
  await writeFile(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
