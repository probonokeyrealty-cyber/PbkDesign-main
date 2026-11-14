import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const sender = {
  id: 'fixture-sender',
  channel: 'email',
  provider: 'instantly',
  address: 'qa@example.invalid',
  label: 'Fixture email',
  healthStatus: 'healthy',
  lifecycleStatus: 'active',
};

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...device, viewport, timezoneId: 'America/Los_Angeles' });
    const writes = [];
    const records = [
      { id: 'fixture-active', name: 'Running fixture', status: 'active', channel: 'email' },
      {
        id: 'fixture-approved-schedule',
        name: 'Approved fixture',
        status: 'pending',
        channel: 'email',
        approvalStatus: 'approved',
        pendingAction: 'start_campaign',
        schedule: { firstSendAt: '2099-06-15T16:30:00.000Z' },
      },
    ];
    let lostResponse = false;
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (req.method() === 'GET') {
        const fixtures = {
          '/api/campaigns': { campaigns: records, source: 'fixture' },
          '/api/campaigns/lead-sources': {
            sources: [{ id: 'all-imports', label: 'All imported leads', count: 2 }],
          },
          '/api/analytics/campaign-drilldown': { rows: [] },
          '/api/campaigns/templates/ranked': { templates: {} },
        };
        if (fixtures[path]) return route.fulfill({ json: { ok: true, ...fixtures[path] } });
        if (path === '/api/communication-identities')
          return route.fulfill({ json: { ok: true, items: [sender] } });
        if (url.origin !== origin || /^\/(api\/|health$|events$)/.test(path))
          return route.fulfill({ json: { ok: true } });
        return route.continue();
      }
      if (path === '/api/state/stream/session') return route.fulfill({ status: 503, json: {} });
      writes.push({ path, payload: req.postDataJSON() });
      if (path === '/api/campaigns') {
        const body = req.postDataJSON();
        let campaign = records.find(({ id }) => id === body.id);
        const replayed = Boolean(campaign);
        if (!campaign) {
          campaign = { ...body, id: body.id || 'fixture-created', status: 'draft' };
          records.push(campaign);
        }
        if (!lostResponse) {
          lostResponse = true;
          return route.abort();
        }
        return route.fulfill({ json: { ok: true, campaign, replayed } });
      }
      const approval = /^\/api\/campaigns\/([^/]+)\/approval$/.exec(path);
      if (approval) {
        const campaign = records.find(({ id }) => id === approval[1]);
        assert(campaign, 'Approval must reference the saved campaign');
        Object.assign(campaign, { status: 'pending', pendingAction: 'start_campaign' });
        return route.fulfill({
          status: 202,
          json: { ok: true, campaign, approval: { id: 'fixture-approval' } },
        });
      }
      return route.fulfill({ status: 400, json: { ok: false, error: 'Unexpected fixture write' } });
    });

    await page.goto(`${origin}/campaigns`);
    await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();
    await expect(page.getByText('Running fixture', { exact: true })).toBeVisible();
    const approved = page.locator('.pbk-camp-card').filter({ hasText: 'Approved fixture' });
    await expect(approved.getByText('Approved, waiting to start')).toBeVisible();
    await expect(
      approved.getByRole('button', { name: 'Request approval', exact: true })
    ).toBeDisabled();
    await expect(
      approved.getByRole('button', { name: 'Cancel campaign Approved fixture' })
    ).toBeEnabled();
    assert.equal(
      await page.locator('.pbk-camp-performance-disclosure').evaluate((el) => el.open),
      false
    );
    const open = page.getByRole('button', { name: 'New campaign', exact: true });
    await open.click();
    const wizard = page.getByRole('dialog', { name: 'New campaign' });
    await expect(wizard).toBeVisible();
    await expect(wizard.getByText('Fixture email', { exact: false }).first()).toBeAttached();
    const next = wizard.getByRole('button', { name: 'Next', exact: true });
    await next.click();
    await next.click();
    await wizard.getByRole('textbox', { name: /First touch copy/ }).fill('Fixture outreach only.');
    await next.click();
    await wizard.getByLabel('Campaign name').fill('Scheduled fixture');
    await wizard.getByLabel(/First send/).fill('2099-06-15T09:30');
    await wizard.getByLabel('Daily cap').fill('17');
    await next.click();
    await expect(wizard.getByText('Jun 15, 2099, 9:30 AM PDT', { exact: true })).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    if (process.env.PBK_CAMPAIGN_SCREENSHOTS === '1')
      await page.screenshot({
        path: `.pbk-local/campaigns-review-${engine.name()}-${viewport.width}.png`,
      });

    const submit = wizard.getByRole('button', { name: 'Request approval', exact: true });
    await submit.click();
    await expect(wizard.getByRole('alert')).toContainText('Campaign save not confirmed');
    await page.reload();
    await open.click();
    await expect(wizard.getByText('Fixture email', { exact: false }).first()).toBeAttached();
    const scheduleStep = wizard.getByRole('button', { name: /Schedule$/ });
    await scheduleStep.click();
    await wizard.getByLabel(/First send/).fill('2099-06-16T09:30');
    await next.click();
    await submit.click();
    await expect(wizard.getByRole('alert')).toContainText('The saved draft differs');
    assert.equal(writes.filter(({ path }) => path.endsWith('/approval')).length, 0);
    await scheduleStep.click();
    await wizard.getByLabel(/First send/).fill('2099-06-15T09:30');
    await next.click();
    await expect(submit).toBeEnabled();
    // Exercise two same-tick events, before React can commit the disabled state.
    await submit.evaluate((button) => {
      button.click();
      button.click();
    });
    await expect(wizard).toBeHidden();
    await expect(page.getByText('Campaign queued for approval', { exact: true })).toBeVisible();
    await expect(page.getByText('Scheduled fixture', { exact: true })).toBeVisible();
    assert.equal(records.filter(({ name }) => name === 'Scheduled fixture').length, 1);
    assert.equal(writes.length, 4, JSON.stringify(writes.map(({ path }) => path)));
    assert.match(writes[0].payload.id, /^campaign-draft-/);
    assert.equal(writes[0].payload.id, writes[1].payload.id);
    assert.equal(writes[0].payload.id, writes[2].payload.id);
    assert.equal(writes[2].payload.schedule.firstSendAt, '2099-06-15T16:30:00.000Z');
    assert.equal(writes[2].payload.schedule.dailyCap, 17);
    assert.equal(writes[3].path, `/api/campaigns/${writes[0].payload.id}/approval`);
    assert.equal(writes[3].payload.requestedAction, 'start_campaign');
    await page.getByRole('button', { name: 'Show campaign table' }).click();
    const pendingRow = page.getByRole('row').filter({ hasText: 'Scheduled fixture' });
    await expect(
      pendingRow.getByRole('button', { name: 'Request approval', exact: true })
    ).toBeDisabled();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    await page.getByRole('button', { name: 'Show campaign cards' }).click();
    if (process.env.PBK_CAMPAIGN_SCREENSHOTS === '1')
      await page.screenshot({
        path: `.pbk-local/campaigns-${engine.name()}-${viewport.width}.png`,
      });
    await open.click();
    await wizard.getByRole('button', { name: /Template$/ }).click();
    await wizard.getByRole('textbox', { name: /First touch copy/ }).fill('Save without approval.');
    await wizard.getByRole('button', { name: /Schedule$/ }).click();
    await wizard.getByLabel('Campaign name').fill('Draft only fixture');
    await wizard.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(wizard).toBeHidden();
    await expect(page.getByText('Draft only fixture', { exact: true })).toBeVisible();
    assert.equal(writes.length, 5);
    assert.equal(writes[4].path, '/api/campaigns');
    assert.notEqual(writes[4].payload.id, writes[0].payload.id);
    console.log(
      `Campaign creation, scheduled review and replay-safe approval: ${engine.name()} ${viewport.width}px`
    );
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, { width: 1440, height: 900 });
  await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
} finally {
  await server.close();
}
