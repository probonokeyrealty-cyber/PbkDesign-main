import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, expect } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const hosted = 'https://pbk-auth-qa.netlify.app';
const fixturePath = '/scripts/fixtures/team-access-recovery.html';
const sessionKey = 'pbk:team-session:v1';
const fallbackOrigin = 'https://pbk-openclaw-bridge.onrender.com';
const session = {
  token: 'fixture-signed-session', role: 'team', actor: 'Fixture operator',
  expiresAt: new Date(Date.now() + 3600000).toISOString(), permissions: { canViewLeads: true },
};

async function verify(browserType, width) {
  const browser = await browserType.launch();
  try {
    const scenarios = ['post-login rejection', 'stale rejection during sign-in', 'usage write fallback', 'protected rejection', 'expiry during verification', 'expiry during outage', 'stale rejection after sign-in', 'superseded sign-in', 'malformed expiry', 'revoked then offline status', 'temporary verification', 'private site', 'malformed verification', 'invalid session', 'expired session', 'cross tab', 'cross tab signout', 'private sign-in', 'wrong passcode', 'draft recovery', 'blob recovery', 'no mutation replay'];
    if (process.argv[2]) assert.ok(scenarios.includes(process.argv[2]), 'Unknown auth QA scenario');
    for (const scenario of scenarios.filter(value => !process.argv[2] || value === process.argv[2])) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      let verification = scenario === 'temporary verification' ? 'offline'
        : scenario === 'private site' ? 'private'
          : scenario === 'invalid session' ? 'invalid'
            : scenario === 'malformed verification' ? 'malformed' : 'valid';
      let privateRead = false;
      let statusOffline = false;
      let quotaExceeded = false;
      let rejectRead = scenario === 'post-login rejection';
      let heldVerification;
      let heldLogin;
      let heldRead;
      const directRequests = [];
      let mutations = 0;
      let signIns = 0;
      const errors = [];
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === fallbackOrigin) {
          directRequests.push(request.method());
          return route.fulfill({ json: { ok: true, fixture: true } });
        }
        if (url.origin !== hosted) return route.abort();
        if (url.pathname === '/api/auth/team/status') return statusOffline
          ? route.fulfill({ status: 503, json: { ok: false, error: 'Fixture status unavailable.' } })
          : route.fulfill({ json: { ok: true, configured: true, authRequired: true } });
        if (url.pathname === '/api/auth/team/verify') {
          if (verification === 'held') { heldVerification = route; return; }
          if (verification === 'offline') return route.fulfill({ status: 503, json: { ok: false, error: 'Fixture unavailable.' } });
          if (verification === 'private') return route.fulfill({ status: 401, contentType: 'text/html', body: '<html><body>Private Netlify site</body></html>' });
          if (verification === 'invalid') return route.fulfill({ status: 401, json: { ok: false, code: 'team_auth_required', error: 'team_auth_required' } });
          if (verification === 'malformed') return route.fulfill({ json: { service: 'wrong response' } });
          return route.fulfill({ json: { ok: true, ...session } });
        }
        if (url.pathname === '/api/auth/team') {
          signIns++;
          if (['superseded sign-in', 'stale rejection during sign-in'].includes(scenario) && signIns === 1) { heldLogin = route; return; }
          if (scenario === 'private sign-in') return route.fulfill({ status: 401, contentType: 'text/html', body: '<html><body>Private Netlify site</body></html>' });
          if (scenario === 'wrong passcode') return route.fulfill({ status: 401, json: { ok: false, error: 'Invalid team passcode.' } });
          return route.fulfill({ json: { ok: true, ...session, token: scenario === 'stale rejection after sign-in' ? 'new-fixture-session' : session.token } });
        }
        if (['/api/leads', '/api/leads/fixture', '/api/approvals/fixture', '/invoke'].includes(url.pathname)) {
          if (['stale rejection after sign-in', 'stale rejection during sign-in'].includes(scenario) && !heldRead) { heldRead = route; return; }
          if (request.method() !== 'GET') mutations++;
          if (quotaExceeded) return route.fulfill({ status: 503, json: { ok: false, error: 'usage_exceeded' } });
          if (rejectRead) return route.fulfill({ status: 401, json: { ok: false, error: 'team_auth_required', code: 'team_auth_required' } });
          return privateRead
            ? route.fulfill({ status: 401, contentType: 'text/html', body: '<html><body>Private Netlify site</body></html>' })
            : route.fulfill({ json: { ok: true, leads: [] } });
        }
        if (/^\/(?:api|state|invoke)(?:\/|$)/.test(url.pathname)) return route.abort();
        return route.fulfill({ response: await route.fetch({ url: origin + url.pathname + url.search }) });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      if (!['cross tab', 'private sign-in', 'wrong passcode', 'superseded sign-in', 'post-login rejection'].includes(scenario)) {
        await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
          key: sessionKey,
          value: scenario === 'expired session' ? { ...session, expiresAt: '2000-01-01T00:00:00Z' }
            : scenario === 'malformed expiry' ? { ...session, expiresAt: 'not-a-date' } : session,
        });
      }
      await page.goto(hosted + fixturePath + (scenario === 'post-login rejection' ? '?protected-refresh=1' : ''));
      if (scenario === 'post-login rejection') {
        await page.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-only-passcode');
        await page.getByRole('button', { name: 'Open command center', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('expired or was rejected');
        await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
      } else if (scenario === 'stale rejection during sign-in') {
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await page.getByRole('button', { name: 'Check fixture connection' }).click();
        await expect.poll(() => Boolean(heldRead)).toBe(true);
        const second = await context.newPage();
        await second.goto(hosted + fixturePath);
        await expect(second.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await second.evaluate(key => localStorage.removeItem(key), sessionKey);
        await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        await page.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-only-passcode');
        await page.getByRole('button', { name: 'Open command center', exact: true }).click();
        await expect.poll(() => Boolean(heldLogin)).toBe(true);
        await heldRead.fulfill({ status: 401, json: { ok: false, code: 'team_auth_required', error: 'team_auth_required' } });
        await expect(page.locator('[data-qa-connection-result]')).toHaveAttribute('data-qa-connection-result', 'failed');
        await heldLogin.fulfill({ json: { ok: true, ...session, token: 'replacement-fixture-session' } });
        await page.waitForLoadState('networkidle');
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key))?.token, sessionKey), 'replacement-fixture-session');
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
      } else if (scenario === 'usage write fallback') {
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        quotaExceeded = true;
        await page.evaluate(async () => {
          const { bridgeRequest, bridgeBlobRequest } = await import('/src/app/utils/runtimeBridge.ts');
          for (const send of [bridgeRequest, bridgeBlobRequest]) {
            for (const [method, path] of [['PUT', '/api/approvals/fixture'], ['PATCH', '/api/leads/fixture'], ['POST', '/invoke']]) {
              await send({ method, path, body: { fixture: true } }).catch(() => {});
            }
          }
        });
        assert.deepEqual(directRequests, [], 'Quota recovery must not automatically resend a write to another origin');
        assert.equal(mutations, 6);
        await page.evaluate(async () => {
          const { bridgeRequest } = await import('/src/app/utils/runtimeBridge.ts');
          await bridgeRequest({ path: '/api/leads' });
        });
        assert.deepEqual(directRequests, ['GET'], 'Read-only quota fallback must remain available');
      } else if (scenario === 'protected rejection') {
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        rejectRead = true;
        await page.getByRole('button', { name: 'Check fixture connection' }).click();
        await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
      } else if (scenario === 'expiry during verification' || scenario === 'expiry during outage') {
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        privateRead = true;
        await page.getByRole('button', { name: 'Check fixture connection' }).click();
        await expect(page.getByRole('button', { name: 'Verify access again' })).toBeVisible();
        verification = 'held';
        await page.getByRole('button', { name: 'Verify access again' }).click();
        await expect.poll(() => Boolean(heldVerification)).toBe(true);
        await page.evaluate(key => {
          const value = JSON.parse(localStorage.getItem(key));
          localStorage.setItem(key, JSON.stringify({ ...value, expiresAt: '2000-01-01T00:00:00Z' }));
        }, sessionKey);
        await heldVerification.fulfill(scenario === 'expiry during outage'
          ? { status: 503, json: { ok: false, error: 'Fixture unavailable.' } }
          : { status: 401, json: { ok: false, code: 'expired_team_session', error: 'expired_team_session' } });
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
      } else if (scenario === 'stale rejection after sign-in') {
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await page.getByRole('button', { name: 'Check fixture connection' }).click();
        await expect.poll(() => Boolean(heldRead)).toBe(true);
        const second = await context.newPage();
        await second.goto(hosted + fixturePath);
        await expect(second.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await second.evaluate(async () => {
          const { authenticateTeamSessionRequest } = await import('/src/app/utils/runtimeBridge.ts');
          await authenticateTeamSessionRequest({ passcode: 'fixture-only-passcode' });
        });
        await expect(page.getByLabel('Authenticated refreshes')).toHaveText('2');
        await heldRead.fulfill({ status: 401, json: { ok: false, code: 'team_auth_required', error: 'team_auth_required' } });
        await page.waitForLoadState('networkidle');
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key))?.token, sessionKey), 'new-fixture-session');
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
      } else if (scenario === 'superseded sign-in') {
        await page.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-only-passcode');
        await page.getByRole('button', { name: 'Open command center', exact: true }).click();
        await expect.poll(() => Boolean(heldLogin)).toBe(true);
        const second = await context.newPage();
        await second.goto(hosted + fixturePath);
        await second.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-only-passcode');
        await second.getByRole('button', { name: 'Open command center', exact: true }).click();
        await expect(second.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await second.evaluate(key => localStorage.removeItem(key), sessionKey);
        await second.reload();
        await expect(second.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        await heldLogin.fulfill({ json: { ok: true, ...session, token: 'superseded-fixture-session' } });
        await page.waitForLoadState('networkidle');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null, 'A delayed sign-in must not undo a sign-out');
        await expect(second.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
      } else if (['temporary verification', 'private site', 'malformed verification'].includes(scenario)) {
        await expect(page.getByRole('button', { name: 'Verify access again', exact: true })).toBeVisible();
        assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key))?.token, sessionKey), session.token,
          'A temporary failure must not erase a valid PBK session');
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
        if (scenario === 'private site') {
          await expect(page.getByRole('link', { name: 'Restore private-site access' })).toHaveAttribute('href', '/api/auth/team/status');
          await expect(page.getByRole('link', { name: 'Restore private-site access' })).toHaveAttribute('target', '_blank');
          mkdirSync('.pbk-local', { recursive: true });
          await page.screenshot({ path: `.pbk-local/auth-recovery-${browserType.name()}-${width}.png` });
        }
        verification = 'valid';
        await page.getByRole('button', { name: 'Verify access again', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await expect(page.getByLabel('Authenticated refreshes')).toHaveText('1');
        assert.equal(signIns, 0, 'Recovery must verify, not replay a passcode submission');
      } else if (['invalid session', 'expired session', 'malformed expiry'].includes(scenario)) {
        await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
      } else if (scenario === 'cross tab') {
        await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        const second = await context.newPage();
        await second.goto(hosted + fixturePath);
        await second.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-only-passcode');
        await second.getByRole('button', { name: 'Open command center', exact: true }).click();
        await expect(second.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await expect(page.getByLabel('Authenticated refreshes')).toHaveText('1');
        assert.equal(signIns, 1);
      } else if (scenario === 'cross tab signout') {
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        const second = await context.newPage();
        await second.goto(hosted + fixturePath);
        await expect(second.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await second.evaluate(key => localStorage.removeItem(key), sessionKey);
        await expect(page.getByRole('textbox', { name: 'Team passcode' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
      } else if (scenario === 'private sign-in' || scenario === 'wrong passcode') {
        await page.getByRole('textbox', { name: 'Team passcode' }).fill('fixture-only-passcode');
        await page.getByRole('button', { name: 'Open command center', exact: true }).click();
        if (scenario === 'private sign-in') {
          await expect(page.getByRole('link', { name: 'Restore private-site access' })).toBeVisible();
          await page.getByRole('button', { name: 'Verify access again' }).click();
          await expect(page.getByRole('textbox', { name: 'Team passcode' })).toHaveValue('fixture-only-passcode');
        } else {
          await expect(page.getByRole('alert')).toContainText('Invalid team passcode.');
          await expect(page.getByRole('link', { name: 'Restore private-site access' })).toHaveCount(0);
        }
        assert.equal(signIns, 1);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
      } else {
        await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toBeVisible();
        await page.getByRole('textbox', { name: 'Unsaved operator draft' }).fill('Keep this unsaved draft');
        privateRead = true;
        if (scenario === 'draft recovery' || scenario === 'revoked then offline status') {
          await page.getByRole('button', { name: 'Check fixture connection' }).click();
        } else if (scenario === 'blob recovery') {
          await page.evaluate(async () => {
            const { bridgeBlobRequest } = await import('/src/app/utils/runtimeBridge.ts');
            await bridgeBlobRequest({ path: '/api/leads' }).catch(() => {});
          });
        } else {
          await page.evaluate(async () => {
            const { bridgeRequest } = await import('/src/app/utils/runtimeBridge.ts');
            await bridgeRequest({ method: 'PUT', path: '/api/approvals/fixture', body: { status: 'approved' } }).catch(() => {});
          });
          assert.equal(mutations, 1, 'An uncertain mutation must never be automatically replayed');
        }
        await expect(page.getByRole('link', { name: 'Restore private-site access' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Unsaved operator draft' })).toHaveValue('Keep this unsaved draft');
        privateRead = false;
        if (scenario === 'revoked then offline status') {
          verification = 'invalid';
          statusOffline = true;
        }
        await page.getByRole('button', { name: 'Verify access again', exact: true }).click();
        if (scenario === 'revoked then offline status') {
          await expect(page.getByRole('heading', { name: 'Fixture workspace' })).toHaveCount(0);
          assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
        } else {
          await expect(page.getByRole('link', { name: 'Restore private-site access' })).toHaveCount(0);
          await expect(page.getByRole('textbox', { name: 'Unsaved operator draft' })).toHaveValue('Keep this unsaved draft');
        }
      }
      assert.equal(mutations, scenario === 'usage write fallback' ? 6 : scenario === 'no mutation replay' ? 1 : 0);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await context.close();
      console.log(`${browserType.name()} ${width}px: ${scenario} passed`);
    }
  } finally { await browser.close(); }
}

try {
  await verify(chromium, 1440);
  await verify(chromium, 390);
  await verify(webkit, 390);
} finally { await server.close(); }
