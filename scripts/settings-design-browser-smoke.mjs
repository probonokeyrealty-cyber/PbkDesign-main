import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const localOrigin = `http://127.0.0.1:${server.httpServer.address().port}`;
const hostedOrigin = 'https://pbk-settings-fixture.netlify.app';

async function verify(engine, options, label) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...options, serviceWorkers: 'block' });
    const saves = [];
    const decisions = [];
    let stateReads = 0;
    let verifies = 0;
    let operatingMode = 'approval';
    let taskStatus = 'pending';
    let emailReady = false;
    let offline = false;
    const task = {
      id: 'fixture-task',
      provider: 'Rex',
      action: 'Review connection',
      summary: 'Review the fixture connection request.',
    };
    const session = {
      token: 'fixture-team-session',
      role: 'team',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const answer = (json, status = 200) => route.fulfill({ status, json });
      if (url.origin !== hostedOrigin) return route.abort();
      if (path === '/api/auth/team/status') return answer({ ok: true, configured: true });
      if (path === '/api/auth/team' && method === 'POST') {
        return request.postDataJSON().passcode === 'fixture-only'
          ? answer({ ok: true, ...session })
          : answer({ ok: false, error: 'Passcode not accepted' }, 401);
      }
      if (path === '/api/auth/team/verify') {
        verifies += 1;
        return answer({ ok: request.headers()['x-pbk-team-token'] === session.token });
      }
      if (path === '/api/state/stream/session') return answer({ ok: false }, 503);
      if (path === '/state' || path.startsWith('/api/')) {
        if (request.headers()['x-pbk-team-token'] !== session.token) {
          return answer({ ok: false, error: 'Team session required' }, 401);
        }
        if (path === '/state') {
          stateReads += 1;
          if (offline) return answer({ ok: false, error: 'Fixture bridge offline' }, 503);
          return answer({
            ok: true,
            settings: { operatingMode },
            status: { stateBackend: 'postgres', pendingApprovals: 2 },
            adminTasks: [{ ...task, status: taskStatus }],
          });
        }
        if (path === '/api/settings' && method === 'PATCH') {
          const body = request.postDataJSON();
          saves.push(body);
          operatingMode = body.operatingMode;
          return answer({ ok: true, settings: { operatingMode } });
        }
        if (path === '/api/admin/tasks/fixture-task' && method === 'PUT') {
          taskStatus = request.postDataJSON().status;
          decisions.push(taskStatus);
          return answer({ ok: true });
        }
        if (method !== 'GET') return answer({ ok: false, error: 'Unmocked mutation' }, 405);
        return answer(
          {
            '/api/quotas': {
              ok: true,
              quotas: {
                telnyx: { ready: true },
                instantly: { ready: emailReady, note: 'Fixture email account' },
              },
            },
            '/api/tooling/status': { ok: true, tooling: { summary: { requiredCount: 1 } } },
            '/api/settings': { ok: true, settings: { operatingMode } },
            '/api/release/status': { ok: true, source: 'fixture' },
            '/api/vector/capacity': { ok: true, source: 'fixture' },
          }[path] || { ok: true }
        );
      }
      if (method !== 'GET') return answer({ ok: false }, 405);
      const response = await route.fetch({ url: `${localOrigin}${path}${url.search}` });
      return route.fulfill({ response });
    });

    await page.goto(`${hostedOrigin}/settings`);
    const title = page.getByRole('heading', { name: 'Settings', exact: true });
    const passcode = page.getByLabel('Team passcode');
    const signIn = page.getByRole('button', { name: 'Open command center' });
    await expect(passcode).toBeVisible();
    await expect(title).toHaveCount(0);
    assert.equal(stateReads, 0);
    await passcode.fill('invalid-fixture');
    await signIn.click();
    await expect(page.getByRole('alert')).toContainText('Passcode not accepted');
    await passcode.fill('fixture-only');
    await signIn.click();
    await expect(title).toBeVisible();

    const providers = page.getByRole('region', { name: 'Provider connections' });
    const provider = (name) => providers.locator('section').filter({ hasText: name });
    await expect(provider('Telnyx')).toContainText('Ready');
    await expect(provider('Instantly')).toContainText('Needs setup');
    await expect(provider('Document Sends')).toContainText('Status unavailable');
    const refresh = page.getByRole('button', { name: 'Refresh settings' });
    offline = true;
    await refresh.click();
    await expect(page.getByText('Showing last known settings. Refresh failed.')).toBeVisible();
    await expect(provider('Telnyx')).toContainText('Ready');
    offline = false;
    emailReady = true;
    await refresh.click();
    await expect(provider('Instantly')).toContainText('Ready');
    await expect(page.getByText('Showing last known settings. Refresh failed.')).toBeHidden();

    const autopilot = page.locator('.pbk-shell-autopilot');
    await expect(autopilot).toHaveAttribute('aria-pressed', 'false');
    await autopilot.click();
    await expect(autopilot).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => saves.length).toBe(1);
    assert.equal(saves[0].operatingMode, 'autopilot');
    assert.equal(saves[0].ui.operatingMode, 'autopilot');

    const queue = page.getByRole('region', { name: 'Admin approvals' });
    const approve = queue.getByRole('button', { name: 'Approve', exact: true });
    const decline = queue.getByRole('button', { name: 'Decline', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Confirm admin decision' });
    await decline.click();
    await expect(dialog).toContainText(task.summary);
    await expect(dialog.getByRole('button', { name: 'Decline admin task' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(decline).toBeFocused();
    assert.deepEqual(decisions, []);
    await approve.click();
    await dialog.getByRole('button', { name: 'Approve admin task' }).click();
    await expect(queue.getByText('Approved', { exact: true })).toBeVisible();
    await expect(queue.getByRole('heading')).toBeFocused();
    assert.deepEqual(decisions, ['approved']);
    await expect(approve).toHaveCount(0);

    const diagnostics = page.getByText('System diagnostics', { exact: true });
    await expect(page.getByRole('heading', { name: 'Agent tools' })).toBeHidden();
    await diagnostics.click();
    await expect(page.getByRole('heading', { name: 'Agent tools' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vector capacity' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Production deploy readiness' })).toBeVisible();
    assert(
      await page
        .locator('.pbk-settings-surface')
        .evaluate((surface) => surface.scrollWidth <= surface.clientWidth + 1)
    );

    await page.reload();
    await expect(title).toBeVisible();
    await expect(passcode).toBeHidden();
    await expect(autopilot).toHaveAttribute('aria-pressed', 'true');
    await expect(queue.getByText('Approved', { exact: true })).toBeVisible();
    assert.equal(verifies, 1);
    assert.equal(saves.length, 1);
    assert.deepEqual(decisions, ['approved']);
    if (process.env.PBK_SETTINGS_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/settings-${label}.png`, fullPage: true });
    }
    console.log(`settings-design-browser: ${label} passed`);
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop');
  await verify(webkit, devices['iPhone 13'], 'iphone');
} finally {
  await server.close();
}
