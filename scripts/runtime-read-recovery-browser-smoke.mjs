import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium, webkit, expect } from '@playwright/test';
import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const outDir = resolve('output/read-recovery-build');
await build({
  configFile: false,
  envDir: outDir,
  plugins: [tailwindcss()],
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: { input: resolve('scripts/fixtures/read-recovery.html') },
  },
});
const server = createServer(async (req, res) => {
  try {
    const file = resolve(outDir, '.' + new URL(req.url, 'http://127.0.0.1').pathname);
    if (!file.startsWith(outDir + sep) || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
server.on('upgrade', (_request, socket) => socket.destroy());
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const hosted = 'https://pbk-recovery-fixture.netlify.app';
const key = 'pbk:team-session:v1';
const session = {
  token: 'sample-session-only',
  role: 'team',
  actor: 'Sample operator',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  permissions: {},
};
mkdirSync('output/playwright', { recursive: true });

async function verify(browserType, width) {
  const browser = await browserType.launch();
  try {
    const scenarios = [
      'read recovers',
      'verification recovers',
      'outage stays bounded',
      'writes never replay',
      'rejection never retries',
      'session change stops retry',
      'blob abort stops retry',
      'incomplete roster rejected',
      'malformed roster alias rejected',
      'unlisted GET never fallback',
      'session change during quota body',
    ];
    for (const scenario of scenarios.filter(
      (value) => !process.argv[2] || value === process.argv[2]
    )) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let reads = 0,
        verifies = 0,
        writes = 0,
        failRead = false;
      let unlistedReads = 0,
        directRequests = 0;
      const errors = [];
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await context.routeWebSocket('**/*', (socket) => socket.close());
      await context.route('**/*', async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.origin !== hosted) {
          if (url.hostname === 'pbk-openclaw-bridge.onrender.com') directRequests++;
          return route.abort();
        }
        if (url.pathname === '/api/auth/team/status')
          return route.fulfill({ json: { ok: true, configured: true, authRequired: true } });
        if (url.pathname === '/api/auth/team/verify') {
          verifies++;
          if (scenario === 'verification recovers' && verifies === 1)
            return route.fulfill({
              status: 503,
              json: { ok: false, code: 'team_auth_verification_unavailable' },
            });
          return route.fulfill({ json: { ok: true, ...session } });
        }
        if (
          (url.pathname.startsWith('/api/') || url.pathname === '/invoke') &&
          request.method() !== 'GET'
        ) {
          writes++;
          return route.fulfill({
            status: 503,
            json: { ok: false, code: 'team_auth_verification_unavailable' },
          });
        }
        if (url.pathname === '/api/leads') {
          reads++;
          if (scenario === 'session change stops retry' && reads === 1) {
            await page.evaluate(
              ({ key, session }) =>
                localStorage.setItem(
                  key,
                  JSON.stringify({ ...session, token: 'replacement-sample-session' })
                ),
              { key, session }
            );
          }
          if (scenario === 'rejection never retries')
            return route.fulfill({
              status: 401,
              json: { ok: false, code: 'expired_team_session' },
            });
          if (scenario === 'incomplete roster rejected')
            return route.fulfill({
              json: { ok: true, complete: false, leads: [{ id: 'partial-seed' }] },
            });
          if (scenario === 'malformed roster alias rejected')
            return route.fulfill({
              json: { ok: true, complete: true, leads: {}, leadImports: [{ id: 'sample-lead' }] },
            });
          if (failRead && (reads === 1 || scenario !== 'read recovers'))
            return route.fulfill({
              status: 503,
              json: { ok: false, code: 'lead_roster_unavailable' },
            });
          return route.fulfill({
            json: { ok: true, complete: true, leads: [{ id: 'sample-lead' }] },
          });
        }
        if (url.pathname === '/api/unlisted') {
          unlistedReads++;
          return route.fulfill({ status: 503, json: { ok: false, error: 'usage_exceeded' } });
        }
        if (/^\/(?:api|state|invoke)(?:\/|$)/.test(url.pathname)) return route.abort();
        return route.fulfill({
          response: await route.fetch({ url: origin + url.pathname + url.search }),
        });
      });
      await page.addInitScript(
        ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
        { key, session }
      );
      await page.goto(hosted + '/scripts/fixtures/read-recovery.html');
      await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
      await page
        .getByRole('textbox', { name: 'Unsaved operator draft' })
        .fill('Keep this sample draft unchanged');
      failRead = true;
      if (scenario === 'session change during quota body') {
        const direct = await page.evaluate(
          async ({ key, session, hosted }) => {
            const original = window.fetch;
            let direct = 0;
            window.fetch = async (target, init) => {
              if (String(target).startsWith(hosted + '/api/leads'))
                return new Response(
                  new ReadableStream({
                    start(controller) {
                      setTimeout(() => {
                        localStorage.setItem(
                          key,
                          JSON.stringify({ ...session, token: 'replacement-sample-session' })
                        );
                        controller.enqueue(new TextEncoder().encode('usage_exceeded'));
                        controller.close();
                      }, 50);
                    },
                  }),
                  { status: 503 }
                );
              if (String(target).includes('pbk-openclaw-bridge.onrender.com')) {
                direct++;
                return Response.json({ ok: true });
              }
              return original(target, init);
            };
            try {
              await window.fixtureBridge.bridgeRequest({ path: '/api/leads' }).catch(() => {});
            } finally {
              window.fetch = original;
            }
            return direct;
          },
          { key, session, hosted }
        );
        assert.equal(direct, 0);
      } else if (scenario === 'verification recovers') {
        assert.equal(
          verifies,
          2,
          'A transient verifier failure must recover without another sign-in'
        );
      } else if (scenario === 'writes never replay') {
        await page.evaluate(async () => {
          const { bridgeRequest } = window.fixtureBridge;
          for (const path of [
            '/api/operator/call',
            '/api/lead/send-message',
            '/api/approvals/sample/approve',
            '/invoke',
            '/api/auth/team',
          ]) {
            await bridgeRequest({ method: 'POST', path, body: {} }).catch(() => {});
          }
        });
        assert.equal(writes, 5);
        assert.equal(reads, 0);
      } else if (scenario === 'blob abort stops retry') {
        const outcome = await page.evaluate(async () => {
          const { bridgeBlobRequest } = window.fixtureBridge;
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 100);
          try {
            await bridgeBlobRequest({ path: '/api/leads', signal: controller.signal });
          } catch (error) {
            return error.name;
          }
        });
        assert.equal(outcome, 'AbortError');
        assert.equal(reads, 1);
      } else {
        const result = await page.evaluate(async (scenario) => {
          const { bridgeRequest, fetchLeadsRequest } = window.fixtureBridge;
          try {
            if (scenario === 'unlisted GET never fallback')
              return { value: await bridgeRequest({ path: '/api/unlisted' }) };
            return {
              value: await (scenario === 'incomplete roster rejected' ||
              scenario === 'malformed roster alias rejected'
                ? fetchLeadsRequest()
                : bridgeRequest({ path: '/api/leads' })),
            };
          } catch (error) {
            return { status: error.status, message: error.message };
          }
        }, scenario);
        if (scenario === 'read recovers') {
          assert.equal(result.value?.leads?.[0]?.id, 'sample-lead');
          assert.equal(reads, 2);
        } else if (scenario === 'outage stays bounded') {
          assert.equal(result.status, 503);
          assert.equal(reads, 3);
        } else if (
          scenario === 'incomplete roster rejected' ||
          scenario === 'malformed roster alias rejected'
        ) {
          assert.equal(result.value, undefined);
          assert.match(result.message, /roster.*(?:incomplete|confirmed|unavailable)/i);
        } else if (scenario === 'unlisted GET never fallback') {
          assert.equal(unlistedReads, 1);
          assert.equal(directRequests, 0);
          assert.equal(result.value, undefined);
        } else {
          assert.equal(reads, 1);
          assert.equal(result.value, undefined);
        }
      }
      if (scenario === 'rejection never retries') {
        await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), null);
      } else {
        await expect(page.getByRole('textbox', { name: 'Unsaved operator draft' })).toHaveValue(
          'Keep this sample draft unchanged'
        );
        assert.equal(
          await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).token, key),
          ['session change stops retry', 'session change during quota body'].includes(scenario)
            ? 'replacement-sample-session'
            : session.token
        );
      }
      assert.equal(writes, scenario === 'writes never replay' ? 5 : 0);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (scenario === 'read recovers')
        await page.screenshot({
          path: `output/playwright/read-recovery-${browserType.name()}-${width}.png`,
        });
      await context.close();
      console.log(`${browserType.name()} ${width}px: ${scenario} passed`);
    }
  } finally {
    await browser.close();
  }
}
try {
  await verify(chromium, 1440);
  await verify(webkit, 390);
  await verify(chromium, 320);
} finally {
  await new Promise((done) => server.close(done));
}
