import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PDFParse } from 'pdf-parse';

const repoRoot = process.cwd();
const port = String(18820 + Math.floor(Math.random() * 3000));
const apiKey = 'pdf-quality-smoke-key';

async function waitForBridge(baseUrl, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) return;
    } catch {
      // Keep polling until the bridge is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('OpenClaw bridge did not become ready for PDF quality smoke.');
}

async function readPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return String(result?.text || '');
  } finally {
    await Promise.resolve(parser.destroy?.()).catch(() => {});
  }
}

async function main() {
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/openclaw-local-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: port,
      HOST: '127.0.0.1',
      PBK_BRIDGE_API_KEY: apiKey,
      PBK_TEAM_PASSCODE: 'pbkway',
      PBK_STATE_BACKEND: 'file',
      PBK_SUPABASE_ENABLED: '0',
      PBK_DISABLE_POSTGRES: '1',
      PBK_ALLOW_UNAUTHENTICATED_HOSTED_BRIDGE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  try {
    await waitForBridge(baseUrl);
    const payload = {
      documentTitle: 'PBK Seller Package Quality Smoke',
      companyName: 'Probono Key Realty',
      propertyAddress: '101 Clean PDF Lane, Columbus OH',
      selectedPathLabel: 'Cash Offer',
      content:
        'This seller package should stay clean even when the live preview renderer is unavailable. ' +
        'The final PDF must not expose internal technical failures or renderer error text.',
      previewUrl: 'http://127.0.0.1:9/pbk-preview-intentionally-unavailable',
    };

    const response = await fetch(`${baseUrl}/api/documents/pdf`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'identity',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200, `PDF route returned ${response.status}.`);
    assert.match(response.headers.get('content-type') || '', /application\/pdf/);
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0, 4).toString('utf8'), '%PDF', 'PDF route did not return a PDF signature.');

    const text = await readPdfText(pdf);
    assert.match(text, /PBK Seller Package Quality Smoke/);
    assert.match(text, /101 Clean PDF Lane/i);
    assert.doesNotMatch(text, /Renderer fallback|ERR_CONNECTION|timeout|stack trace|Unhandled|Exception/i);

    console.log(
      JSON.stringify(
        {
          ok: true,
          result: 'pdf_output_quality_ready',
          bytes: pdf.length,
          textCharacters: text.length,
        },
        null,
        2
      )
    );
  } finally {
    if (!child.killed) child.kill();
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]).catch(() => {});
    if (child.exitCode && child.exitCode !== 0) {
      console.warn(stderr.join('').split('\n').slice(-8).join('\n'));
    }
  }
}

await main();
