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
  { path: '/dashboard' },
  { path: '/inbox/conversations' },
  { path: '/leads/lead-inbound-16575001765' },
  { path: '/index.html', canonical: '/command-center', heading: '#today-heading' },
  {
    path: '/index.html#recordings',
    canonical: '/inbox/conversations?filter=call',
    heading: '.pbk-conversation-thread-rail h1',
    activeFilter: 'Calls',
  },
  { path: '/brain' },
];

const smokeThread = {
  id: 'smoke-calls',
  title: 'Recording smoke contact',
  channels: ['call'],
};
const smokeTranscript = 'Seller: Friday works for a follow-up.';

async function verifyRecordingFallback(page) {
  const thread = '::-p-text(Recording smoke contact)';
  await page.waitForSelector(thread, { visible: true, timeout: 8000 });
  await page.click(thread);
  const play = 'button[aria-label="Play recording"]';
  await page.waitForSelector(play, { visible: true, timeout: 8000 });
  await page.click(play);
  await page.waitForSelector('::-p-text(Recording unavailable)', { visible: true });
  assert.equal(await page.$('audio'), null, 'A call without audio must not create a player.');
  await page.click('::-p-text(Download transcript (.txt))');
  const download = await page.evaluate(() => window.__smokeTranscriptDownload);
  assert.deepEqual(download, { filename: 'call-smoke-call.txt', text: smokeTranscript });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'The recording fallback must fit in a 390px viewport.');
}

async function verifyAskRex(page, queries) {
  const question = 'What should I review before a follow-up?';
  await page.waitForSelector('textarea[aria-label="Ask Rex"]', { visible: true, timeout: 8000 });
  assert.equal(new URL(page.url()).pathname, '/brain');
  await page.type('textarea[aria-label="Ask Rex"]', question);
  await page.click('button[aria-label="Send to Rex"]');
  await page.waitForSelector('::-p-text(Review the latest notes before calling.)', { visible: true });
  await page.waitForSelector('::-p-text(PBK research fixture)', { visible: true });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].query, question);
  assert.equal(queries[0].readOnly, true);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'Ask Rex must fit in a 390px viewport.');
}

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
const origin = `http://127.0.0.1:${address.port}`;

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
  const featureFailures = [];
  for (const { path: route, canonical, heading, activeFilter } of routes) {
    const page = await browser.newPage();
    const pageErrors = [];
    const queries = [];
    const checkRecordings = route === '/index.html#recordings';
    const checkBrain = route === '/brain';
    if (checkRecordings || checkBrain) {
      await page.evaluateOnNewDocument((expectedOrigin) => {
        if (location.origin !== expectedOrigin) return;
        localStorage.setItem('pbk-openclaw-config', JSON.stringify({
          endpoint: location.origin, apiKey: 'fixture-only',
        }));
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (!this.download.endsWith('.txt') || !this.href.startsWith('blob:')) {
            return click.call(this);
          }
          const filename = this.download;
          window.__smokeTranscriptDownload = fetch(this.href)
            .then(response => response.text())
            .then(text => ({ filename, text }));
        };
      }, origin);
    }
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && (checkRecordings || checkBrain)) {
        const fixtures = {
          '/api/conversations': { result: 'postgres', items: [smokeThread] },
          '/api/conversations/smoke-calls': { result: 'postgres', thread: smokeThread },
          '/api/conversations/smoke-calls/timeline': {
            result: 'postgres',
            items: [{
              id: 'smoke-call', threadId: smokeThread.id, channel: 'call',
              eventType: 'call.transcript', body: smokeTranscript, occurredAt: '2026-11-01T12:00:00Z',
            }],
          },
        };
        if (request.method() === 'GET' && Object.hasOwn(fixtures, url.pathname)) {
          void request.respond({ contentType: 'application/json', body: JSON.stringify(fixtures[url.pathname]) });
          return;
        }
        if (checkBrain && url.pathname === '/api/brain/query' && request.method() === 'POST') {
          queries.push(JSON.parse(request.postData()));
          void request.respond({
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, answer: 'Review the latest notes before calling.', citations: ['PBK research fixture'] }),
          });
          return;
        }
        if (url.pathname.startsWith('/api/') || url.pathname === '/state' || request.method() !== 'GET') {
          void request.respond({ contentType: 'application/json', body: '{}' });
          return;
        }
      }
      if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') {
        void request.continue();
      } else {
        void request.abort();
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (url.startsWith(`http://127.0.0.1:${address.port}`)) {
        pageErrors.push(`${request.failure()?.errorText || 'request failed'} ${url}`);
      }
    });

    await page.setViewport({ width: canonical || checkBrain ? 390 : 320, height: 800, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${address.port}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => Boolean(document.querySelector('#root')?.textContent?.trim()),
      { timeout: 15_000 }
    );
    if (canonical) {
      await page.waitForFunction(
        (target) => location.pathname + location.search === target,
        { timeout: 15_000 },
        canonical
      );
      await page.waitForSelector(heading, { visible: true, timeout: 15_000 });
      if (activeFilter) {
        const label = await page.$eval('.pbk-conversation-thread-rail [aria-pressed="true"]', (button) => button.textContent.trim());
        assert.equal(label, activeFilter, `${route} must activate the Calls filter.`);
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `${canonical} must fit in a 390px viewport.`);
    }

    try {
      if (checkRecordings) {
        await verifyRecordingFallback(page);
        console.log('[shell-production-boot] No-audio Play and transcript export passed');
      }
      if (checkBrain) {
        await verifyAskRex(page, queries);
        console.log('[shell-production-boot] Ask Rex query and citation passed');
      }
    } catch (error) {
      featureFailures.push(new Error(`${route}: ${error.message}`));
    }
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
  if (featureFailures.length) throw new AggregateError(featureFailures, 'Shell workflow regressions');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
