import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const shellEntry = path.join(distDir, 'index.shell.html');
const routes = [
  '/dashboard',
  '/inbox/conversations',
  '/leads/lead-inbound-16575001765',
];

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next common browser location.
    }
  }

  throw new Error('Chrome/Chromium was not found. Set CHROME_BIN to run the shell boot smoke.');
}

function safeDistPath(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, 'http://127.0.0.1').pathname);
  const requested = path.resolve(distDir, `.${pathname}`);
  return requested.startsWith(distDir) ? requested : shellEntry;
}

async function sendFile(response, filename) {
  const body = await readFile(filename);
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': mimeTypes.get(path.extname(filename)) || 'application/octet-stream',
  });
  response.end(body);
}

function sendNotFound(response) {
  response.writeHead(404, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end('not found');
}

await access(shellEntry);

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    const requested = safeDistPath(request.url || '/');
    const requestedStat = await stat(requested).catch(() => null);
    if (requestedStat?.isFile()) {
      await sendFile(response, requested);
      return;
    }
    if (pathname.startsWith('/assets/')) {
      sendNotFound(response);
      return;
    }
    await sendFile(response, shellEntry);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Unable to start production shell smoke server.');
}

const missingChunkResponse = await fetch(
  `http://127.0.0.1:${address.port}/assets/__stale_missing_chunk__.js`,
);
assert.equal(
  missingChunkResponse.status,
  404,
  'Production shell smoke must not serve the app shell for absent /assets/*.js chunks.',
);

const browser = await puppeteer.launch({
  executablePath: await findChrome(),
  headless: 'new',
  timeout: 90_000,
  args: [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-setuid-sandbox',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-sandbox',
  ],
});

try {
  for (const route of routes) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (url.startsWith(`http://127.0.0.1:${address.port}`)) {
        pageErrors.push(`${request.failure()?.errorText || 'request failed'} ${url}`);
      }
    });

    await page.setViewport({ width: 320, height: 800, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${address.port}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => Boolean(document.querySelector('#root')?.textContent?.trim()),
      { timeout: 15_000 }
    );

    const renderedText = await page.$eval('#root', (root) => root.textContent?.trim() || '');
    if (!renderedText) {
      throw new Error(`${route} mounted an empty React root.`);
    }
    if (pageErrors.length) {
      throw new Error(`${route} emitted runtime errors:\n${pageErrors.join('\n')}`);
    }

    console.log(`[shell-production-boot] ${route}: rendered`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
