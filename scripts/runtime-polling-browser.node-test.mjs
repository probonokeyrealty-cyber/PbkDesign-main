import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium, webkit, expect } from '@playwright/test';
import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const outDir = resolve('output/runtime-polling-build');
await build({
  configFile: false,
  envDir: outDir,
  plugins: [tailwindcss()],
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: { input: resolve('scripts/fixtures/runtime-polling.html') },
  },
});
const server = createServer(async (req, res) => {
  try {
    const file = resolve(outDir, '.' + new URL(req.url, 'http://127.0.0.1').pathname);
    if (req.method !== 'GET' || !file.startsWith(outDir + sep)) return res.writeHead(404).end();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
server.on('upgrade', (_req, socket) => socket.destroy());
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const hosted = 'https://pbk-polling-fixture.netlify.app';
const key = 'pbk:team-session:v1';
const session = {
  token: 'sample-polling-session',
  role: 'team',
  actor: 'Sample operator',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  permissions: {},
};
const sample = (value) => ({
  status: { lastUpdatedAt: value },
  approvals: [{ id: 'sample-approval', status: 'pending' }],
});
await mkdir('output/playwright', { recursive: true });

async function verify(engine, width) {
  const browser = await engine.launch();
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const errors = [],
    unexpected = [];
  let reads = 0,
    quotas = 0,
    tooling = 0,
    revision = 'sample-initial',
    live = true,
    socket;
  let hold = null;
  let failReads = false;
  let metadataRevision = 'metadata-initial';
  try {
    await context.routeWebSocket('**/*', (ws) => {
      if (!live) return ws.close();
      socket = ws;
      ws.onClose(() => {
        if (socket === ws) socket = null;
      });
    });
    await context.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== hosted) {
        unexpected.push(request.url());
        return route.abort();
      }
      if (url.pathname === '/api/state/stream/session' && request.method() === 'POST')
        return route.fulfill({
          json: { ok: true, session: { wsUrl: hosted.replace('https:', 'wss:') + '/ws/state' } },
        });
      if (request.method() !== 'GET') {
        unexpected.push(request.method() + ' ' + url.pathname);
        return route.abort();
      }
      if (url.pathname === '/state') {
        reads++;
        if (failReads)
          return route.fulfill({
            status: 503,
            json: { ok: false, error: 'sample runtime outage' },
          });
        const value = revision;
        if (hold) {
          const wait = hold;
          await wait.promise;
          if (wait.fail)
            return route.fulfill({ status: 400, json: { error: 'sample superseded read failed' } });
        }
        return route.fulfill({ json: sample(value) });
      }
      if (url.pathname === '/api/quotas') {
        quotas++;
        return route.fulfill({ json: { ok: true, quotas: { revision: metadataRevision } } });
      }
      if (url.pathname === '/api/tooling/status') {
        tooling++;
        return route.fulfill({ json: { ok: true, tooling: { revision: metadataRevision } } });
      }
      if (url.pathname.startsWith('/api/')) {
        unexpected.push(url.pathname);
        return route.abort();
      }
      return route.fulfill({
        response: await route.fetch({ url: origin + url.pathname + url.search }),
      });
    });
    await context.addInitScript(
      ({ key, session }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(session));
      },
      { key, session }
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.goto(hosted + '/scripts/fixtures/runtime-polling.html');
    for (const name of ['Workspace', 'Topbar', 'Layout'])
      await expect(page.getByLabel(`${name} state`, { exact: true })).toHaveText(revision);
    assert.equal(reads, 1, 'Three mounted consumers must share one full-state hydration');
    assert.equal(quotas, 1);
    assert.equal(tooling, 1);
    await expect(page.getByLabel('Workspace quotas', { exact: true })).toContainText(
      metadataRevision
    );
    const draft = page.getByRole('textbox', { name: 'Sample unsaved draft' });
    await draft.fill('Sample manual notes; saved comp preserved');
    await page.clock.runFor(14_000);
    assert.equal(reads, 1, 'No redundant 5/10-second full-state polls');
    revision = 'sample-fallback';
    await page.clock.runFor(2000);
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    assert.equal(reads, 2, 'Fallback consumers share a single 15-second read');

    revision = 'sample-approved';
    await page.evaluate(() => window.dispatchEvent(new Event('pbk:approval-decision')));
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    assert.equal(reads, 3, 'Approval events bypass the slower polling cadence');
    revision = 'sample-manual';
    await page.getByRole('button', { name: 'Refresh Workspace' }).click();
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    assert.equal(reads, 4, 'Manual refresh is not served from a stale cache');

    let finishSupersededRead;
    hold = {
      promise: new Promise((done) => {
        finishSupersededRead = done;
      }),
      fail: true,
    };
    const beforeSupersededRead = reads;
    await page.getByRole('button', { name: 'Refresh Workspace' }).click();
    await expect.poll(() => reads).toBe(beforeSupersededRead + 1);
    hold = null;
    revision = 'sample-newer-force';
    await page.getByRole('button', { name: 'Refresh Topbar' }).click();
    await expect(page.getByLabel('Topbar state', { exact: true })).toHaveText(revision);
    const oldFailure = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/state' && response.status() === 400
    );
    finishSupersededRead();
    await (await oldFailure).finished();
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    await expect(page.getByLabel('Workspace error', { exact: true })).toBeEmpty();

    live = true;
    await page.clock.runFor(30_000);
    await expect.poll(() => Boolean(socket)).toBeTruthy();
    await page.getByRole('button', { name: 'Mount late panel' }).click();
    await expect(page.getByLabel('Late state', { exact: true })).toHaveText(revision);
    const liveBaseline = reads;
    for (let i = 0; i < 5; i++) {
      socket.send(JSON.stringify({ type: 'state', snapshot: sample('sample-stream-' + i) }));
      await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(
        'sample-stream-' + i
      );
      await page.clock.runFor(10_000);
    }
    assert.ok(
      reads - liveBaseline <= 1,
      'Healthy state stream allows at most one safety read in 50 seconds'
    );
    metadataRevision = 'metadata-updated';
    for (let i = 0; i < 3; i++) {
      socket.send(
        JSON.stringify({ type: 'state', snapshot: sample('sample-stream-metadata-' + i) })
      );
      await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(
        'sample-stream-metadata-' + i
      );
      await page.clock.runFor(10_000);
    }
    for (const name of ['Workspace', 'Topbar', 'Layout', 'Late']) {
      await expect(page.getByLabel(`${name} quotas`, { exact: true })).toContainText(
        metadataRevision
      );
      await expect(page.getByLabel(`${name} tooling`, { exact: true })).toContainText(
        metadataRevision
      );
    }

    let finishSlowRead;
    hold = {
      promise: new Promise((done) => {
        finishSlowRead = done;
      }),
    };
    revision = 'delayed-http-state';
    const slowReadCount = reads;
    await page.getByRole('button', { name: 'Refresh Workspace' }).click();
    await expect.poll(() => reads).toBe(slowReadCount + 1);
    socket.send(JSON.stringify({ type: 'state', snapshot: sample('newer-stream-state') }));
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(
      'newer-stream-state'
    );
    const slowResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/state'
    );
    hold = null;
    finishSlowRead();
    await (await slowResponse).finished();
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(
      'newer-stream-state'
    );
    revision = 'sample-stalled-stream';
    socket.send(JSON.stringify({ type: 'ping' }));
    await page.clock.runFor(46_000);
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);

    socket.close();
    live = false;
    revision = 'sample-reconnected';
    await page.clock.runFor(16_000);
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    await expect(draft).toHaveValue('Sample manual notes; saved comp preserved');

    let release;
    hold = {
      promise: new Promise((done) => {
        release = done;
      }),
    };
    revision = 'old-session-state';
    const before = reads;
    await page.getByRole('button', { name: 'Refresh Workspace' }).click();
    await expect.poll(() => reads).toBe(before + 1);
    await page.evaluate(
      ({ key, session }) =>
        localStorage.setItem(
          key,
          JSON.stringify({ ...session, token: 'replacement-sample-session' })
        ),
      { key, session }
    );
    hold = null;
    release();
    await expect(page.getByLabel('Workspace error', { exact: true })).not.toBeEmpty();
    await expect(page.getByLabel('Workspace state', { exact: true })).not.toHaveText(
      'old-session-state'
    );
    revision = 'replacement-session-state';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);

    failReads = true;
    await page.clock.resume();
    await page.getByRole('button', { name: 'Refresh Workspace' }).click();
    await expect(page.getByLabel('Workspace error', { exact: true })).not.toBeEmpty();
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    failReads = false;
    revision = 'sample-outage-recovered';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    await expect(page.getByLabel('Workspace error', { exact: true })).toBeEmpty();

    await page.reload();
    await expect(draft).toHaveValue('Sample manual notes; saved comp preserved');
    await expect(page.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    const beforeTab = reads;
    const other = await context.newPage();
    await other.goto(hosted + '/scripts/fixtures/runtime-polling.html');
    await expect(other.getByLabel('Workspace state', { exact: true })).toHaveText(revision);
    assert.equal(
      reads,
      beforeTab + 1,
      'A separate tab hydrates independently, without a shared persistent state cache'
    );
    await expect(draft).toHaveValue('Sample manual notes; saved comp preserved');
    await other.close();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    );
    await page.screenshot({
      path: `output/playwright/runtime-polling-${engine.name()}-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log(
      JSON.stringify({ engine: engine.name(), width, reads, quotas, tooling, result: 'passed' })
    );
  } finally {
    await context.close();
    await browser.close();
  }
}
try {
  await verify(chromium, 1440);
  await verify(webkit, 390);
} finally {
  await new Promise((done) => server.close(done));
}
