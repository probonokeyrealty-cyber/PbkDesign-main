#!/usr/bin/env node
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const host = process.env.PBK_MOBILE_PROOF_HOST || '127.0.0.1';
const requestedPort = Number(process.env.PBK_MOBILE_PROOF_PORT || 4174);

function getFreePort(preferredPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(0));
    server.listen(preferredPort, host, () => {
      server.close(() => resolve(preferredPort));
    });
  });
}

function runNodeScript(scriptPath, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(scriptPath)} exited with ${code ?? signal}`));
    });
  });
}

function startPreview(port) {
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(
    process.execPath,
    [viteBin, 'preview', '--host', host, '--port', String(port), '--strictPort'],
    {
      cwd: root,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

async function waitForPreview(baseUrl, child) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < 30_000) {
    if (child.exitCode != null) {
      throw new Error(`Vite preview exited before serving ${baseUrl}. ${lastError}`.trim());
    }
    try {
      const response = await fetch(baseUrl, { method: 'HEAD' });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite preview at ${baseUrl}. ${lastError}`.trim());
}

async function main() {
  const port = (await getFreePort(requestedPort)) || requestedPort + Math.floor(Math.random() * 1000) + 1;
  const baseUrl = `http://${host}:${port}`;
  const preview = startPreview(port);
  const output = [];

  preview.stdout.on('data', (chunk) => output.push(String(chunk)));
  preview.stderr.on('data', (chunk) => output.push(String(chunk)));

  try {
    await waitForPreview(baseUrl, preview);
    await runNodeScript(path.join(root, 'scripts', 'mobile-browser-proof.mjs'), {
      ...process.env,
      PBK_MOBILE_PROOF_BASE_URL: baseUrl,
    });
  } catch (error) {
    const previewLog = output.join('').trim();
    if (previewLog) console.error(previewLog);
    throw error;
  } finally {
    preview.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(`[mobile-browser-proof-preview] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
