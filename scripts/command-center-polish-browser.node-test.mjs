import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { createCommandCenterPreview } from './fixtures/command-center-polish-preview.mjs';

const { server, origin } = await createCommandCenterPreview();
after(async () => { await server.close(); });
const output = 'output/command-center-polish';
await mkdir(output, { recursive: true });

function expectWorkspaceLead(page, leadId, timeout = 10000) {
  return expect(page.getByRole('region', { name: 'Workspace lead context', exact: true }).locator('code'))
    .toHaveText(leadId, { timeout });
}

test('lead identity assertion rejects IDs sharing the requested prefix', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<section aria-label="Workspace lead context"><code>SYN-L-22910</code></section>');
    await assert.rejects(() => expectWorkspaceLead(page, 'SYN-L-2291', 250));
  } finally { await browser.close(); }
});

for (const [engine, width, theme, collapsed] of [
  [chromium, 1440, 'dark', false],
  [chromium, 1440, 'light', true],
  [chromium, 320, 'dark', false],
  [webkit, 390, 'dark', false],
]) {
  test(`shared shell polish: ${engine.name()} ${width} ${theme}`, { timeout: 300000 }, async () => {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const writes = [];
    const errors = [];
    const railPreferences = [];
    let expectedRailPreference = null;
    let activeRoute = '/settings';
    try {
      await context.addInitScript(({ theme, collapsed }) => {
        localStorage.setItem('pbk:prefs:v1', JSON.stringify({
          theme, railCollapsed: collapsed, lastPage: '/', tourCompleted: true,
        }));
      }, { theme, collapsed });
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        // Only the two explicit rail clicks may update fictional UI preferences.
        if (request.method() === 'PATCH' && url.pathname === '/api/settings' && expectedRailPreference !== null) {
          let body;
          try { body = request.postDataJSON(); } catch { body = null; }
          if (body?.actor === 'ParadiseLayout' && Object.keys(body).sort().join(',') === 'actor,ui' &&
            Object.keys(body.ui || {}).join(',') === 'railCollapsed' && body.ui.railCollapsed === expectedRailPreference) {
            railPreferences.push(body.ui.railCollapsed);
            return route.fulfill({ json: { ok: true } });
          }
        }
        if (request.method() !== 'GET' && url.pathname !== '/api/state/stream/session') {
          writes.push(`${request.method()} ${url.pathname}`);
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(90000);
      page.on('pageerror', error => errors.push({
        route: activeRoute, url: page.url(), message: error.message, stack: error.stack,
      }));
      // Settings first proves typography is available before loading Today or a lead route.
      await page.goto(`${origin}/settings`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.setItem('pbk:compose:draft', JSON.stringify({
        channel: 'sms', recipient: '', leadId: 'SYN-L-2291', message: 'Fictional unsent operator draft',
        sendLater: false, sendAt: '',
      })));
      const originalDraft = await page.evaluate(() => localStorage.getItem('pbk:compose:draft'));
      const skip = page.getByRole('link', { name: 'Skip to workspace', exact: true });
      await expect(skip).toHaveCount(1);
      for (const family of ['PBK Plus Jakarta Sans', 'Fraunces', 'PBK JetBrains Mono NF']) {
        assert.equal(await page.evaluate(async family => {
          const faces = await document.fonts.load(`14px "${family}"`);
          return faces.some(face => face.status === 'loaded');
        }, family), true, `${family} loads from bundled assets on every route`);
      }
      await skip.focus();
      await expect(skip).toBeInViewport();
      await skip.press('Enter');
      await expect(page.locator('#pbk-workspace-main')).toBeFocused();
      if (width > 767) {
        const nav = page.getByRole('navigation', { name: 'Workspace pages', exact: true });
        await expect(nav.getByRole('link', { name: 'Agent Fleet', exact: true })).toBeVisible();
        const toggle = page.getByRole('button', { name: collapsed ? 'Expand navigation rail' : 'Collapse navigation rail' });
        await expect(toggle.locator('svg')).toHaveCount(1);
        assert.ok((await toggle.boundingBox()).height >= 44);
        const rail = await page.locator('.pbk-shell-sidebar').boundingBox();
        const control = await toggle.boundingBox();
        assert.ok(control.x >= rail.x && control.x + control.width <= rail.x + rail.width, 'Rail control stays inside expanded and collapsed navigation');
        for (const [index, next] of [!collapsed, collapsed].entries()) {
          expectedRailPreference = next;
          await page.getByRole('button', { name: next ? 'Collapse navigation rail' : 'Expand navigation rail', exact: true }).click();
          await expect(page.locator('.pbk-shell-sidebar')).toHaveAttribute('data-collapsed', String(next));
          await expect.poll(() => railPreferences.length).toBe(index + 1);
          expectedRailPreference = null;
        }
      }
      for (const [route, key] of [
        ['/', 'today'], ['/leads', 'leads'], ['/leads/SYN-L-2291', 'workspace'],
        ['/fleet', 'fleet'], ['/inbox', 'inbox'], ['/analytics', 'analytics'],
        ['/ava-chat', 'ava'], ['/analyzer', 'analyzer'],
      ]) {
        // WebKit reports in-flight reads as access-control errors during document teardown.
        // Settle the previous page before this presentation test forces a full navigation.
        await page.waitForLoadState('networkidle', { timeout: 60000 });
        activeRoute = route;
        if (key === 'workspace' || key === 'analyzer') {
          await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
        } else if (width > 767) {
          await page.getByRole('navigation', { name: 'Workspace pages', exact: true }).locator(`a[href="${route}"]`).click();
        } else if (['/', '/leads', '/inbox', '/ava-chat'].includes(route)) {
          await page.getByRole('navigation', { name: 'Mobile shell navigation', exact: true }).locator(`a[href="${route}"]`).click();
        } else {
          await page.getByRole('button', { name: 'More - open all dashboard pages' }).click();
          const menu = page.getByRole('dialog', { name: 'All dashboard pages' });
          await menu.locator(`a[href="${route}"]`).click();
          await expect(menu).toHaveCount(0);
        }
        await expect(page).toHaveURL(origin + route);
        await expect(page.locator('.pbk-shell-frame')).toBeVisible();
        const loaded = route === '/analyzer'
          ? page.locator('.pbk-analyzer-main')
          : page.locator('.pbk-shell-content h1').first();
        await expect(loaded).toBeVisible({ timeout: 60000 });
        const headings = { today: 'Today.', leads: 'Seller leads.', fleet: 'Agent Fleet', inbox: 'Inbox.',
          analytics: 'Analytics', ava: 'Ava Chat' };
        if (headings[key]) await expect(page.locator('.pbk-shell-content h1').first()).toHaveText(headings[key]);
        if (key === 'workspace') await expectWorkspaceLead(page, 'SYN-L-2291');
        await expect(page.locator('.page-switch-skeleton')).toHaveCount(0);
        await expect(page.locator('.pbk-shell-content')).not.toContainText('Something went wrong');
        const font = await page.locator('.pbk-shell-frame').evaluate(node => getComputedStyle(node).getPropertyValue('--font-mono'));
        assert.ok(font.includes('PBK JetBrains Mono NF'));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${route}: no page overflow`);
        const heading = page.locator('.pbk-shell-content h1').first();
        if (await heading.count()) {
          const size = await heading.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
          assert.ok(size <= 32, `${route}: compact page heading, not a marketing hero`);
        }
        await page.screenshot({ path: `${output}/${key}-${engine.name()}-${width}-${theme}.png` });
        assert.equal(await page.evaluate(() => localStorage.getItem('pbk:compose:draft')), originalDraft,
          `${route}: shell navigation preserves the existing unsent draft`);
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('.pbk-analyzer-main')).toBeVisible({ timeout: 60000 });
      assert.equal(await page.evaluate(() => localStorage.getItem('pbk:compose:draft')), originalDraft,
        'Reload preserves the existing unsent draft');
      if (width < 768) {
        await page.getByRole('button', { name: 'More - open all dashboard pages' }).click();
        await expect(page.getByRole('dialog', { name: 'All dashboard pages' })).toBeVisible();
        await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'All dashboard pages' })).toHaveCount(0);
      }
      assert.deepEqual(writes, [], 'Presentation changes never write business data');
      assert.deepEqual(errors, [], 'Routes render without uncaught application errors');
    } catch (error) {
      console.error(`${engine.name()} ${width} ${theme} at ${activeRoute}: ${error.stack || error}`);
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
