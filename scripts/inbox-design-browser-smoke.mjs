import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const lead = { id: 'qa-lead', name: 'Inbox QA Seller', phone: '+12025550142' };
const thread = {
  id: 'qa-thread', leadId: lead.id, title: lead.name, unreadCount: 0,
  channels: ['sms'], phone: lead.phone, lastMessageAt: '2026-11-09T12:00:00Z',
};
const approval = {
  id: 'qa-approval', type: 'SMS', status: 'pending', leadName: lead.name,
  message: 'Confirm the showing time?', createdAt: '2026-11-09T12:00:00Z',
};
const sender = {
  id: 'qa-sender', channel: 'sms', provider: 'telnyx', lifecycleStatus: 'active',
  status: 'active', address: '+12025550143', label: 'QA sender', eligibility: { eligible: true },
};

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    const sends = [];
    const decisions = [];
    let resolved = false;
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (path === '/state') return route.fulfill({ json: { approvals: resolved ? [] : [approval], leads: [lead] } });
      if (path === '/api/leads') return route.fulfill({ json: { ok: true, leads: [lead], items: [lead] } });
      if (path === '/api/leads/qa-lead/full') return route.fulfill({ json: { ok: true, lead } });
      if (path === '/api/conversations') return route.fulfill({ json: { ok: true, items: [thread] } });
      if (path === '/api/conversations/qa-thread') {
        return route.fulfill({ json: { ok: true, thread, recipientSummary: { phone: lead.phone } } });
      }
      if (path.endsWith('/timeline')) return route.fulfill({ json: { ok: true, items: [] } });
      if (path === '/api/communication-identities') {
        return route.fulfill({ json: { ok: true, items: [sender] } });
      }
      if (path.includes('recommend')) return route.fulfill({ json: { ok: true, recommended: sender } });
      if (path === '/api/approvals/qa-approval' && req.method() === 'PUT') {
        decisions.push(req.postDataJSON());
        resolved = true;
        return route.fulfill({ json: { ok: true, approval: { ...approval, status: 'approved' } } });
      }
      if (req.method() === 'POST' && [
        '/api/lead/send-message', '/api/messages', '/api/conversations/qa-thread/messages',
      ].includes(path)) {
        const body = req.postDataJSON();
        sends.push({ path, body });
        if (path === '/api/messages') return route.fulfill({ json: { ok: true, result: 'scheduled' } });
        if (body.body === 'Fixture confirmed draft') {
          return route.fulfill({ json: { ok: true, outbox: { status: 'sent', provider: 'Telnyx' } } });
        }
        return route.fulfill({ status: 502, json: { error: 'Fixture lost the response' } });
      }
      if (url.origin !== origin || /^\/(api\/|health$|events$|invoke$)/.test(path)) {
        return route.fulfill({ json: { ok: true, items: [] } });
      }
      return route.continue();
    });
    const doubleClick = (locator) => locator.evaluate((button) => {
      button.click();
      button.click();
    });
    const checkWidth = async () => assert.equal(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1), true);

    await page.goto(`${origin}/inbox`);
    await expect(page.getByRole('heading', { name: 'Inbox.', exact: true })).toBeVisible();
    await expect(page.getByText(approval.message)).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    const confirmation = page.getByRole('dialog');
    await expect(confirmation.getByText(approval.message)).toBeVisible();
    await doubleClick(confirmation.getByRole('button', { name: 'Approve', exact: true }));
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByText(approval.message)).toHaveCount(0);
    assert.equal(decisions.length, 1);

    await page.getByRole('button', { name: 'Compose', exact: true }).first().click();
    const compose = page.getByRole('dialog', { name: 'Compose message' });
    await compose.getByPlaceholder('Name or phone number').fill(lead.phone);
    await compose.getByPlaceholder('Write a seller-facing message...').fill('Fixture draft only');
    const send = compose.getByRole('button', { name: /^Send(?: SMS)?$/ });
    await expect(send).toBeEnabled();
    await doubleClick(send);
    await expect(compose.getByText(/could not confirm/i)).toBeVisible();
    await expect(send).toBeDisabled();
    assert.equal(sends.length, 1);
    await compose.getByRole('button', { name: 'Close compose' }).click();
    await page.getByRole('button', { name: 'Compose', exact: true }).first().click();
    await expect(compose.getByPlaceholder('Write a seller-facing message...')).toHaveValue('Fixture draft only');
    await expect(send).toBeDisabled();
    await compose.getByPlaceholder('Write a seller-facing message...').fill('Fixture scheduled draft');
    await compose.getByRole('button', { name: 'Send later', exact: true }).click();
    await compose.locator('input[type="datetime-local"]').fill('2099-01-01T12:00');
    const schedule = compose.getByRole('button', { name: 'Schedule', exact: true });
    await expect(schedule).toBeEnabled();
    await doubleClick(schedule);
    await expect(compose).toHaveCount(0);
    assert.equal(sends.filter(({ path }) => path === '/api/messages').length, 1);
    await checkWidth();
    if (process.env.PBK_INBOX_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/inbox-${engine.name()}-${viewport.width}.png` });
    }

    await page.getByRole('button', { name: 'Open conversations' }).click();
    await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review approvals' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(lead.name) }).first().click();
    const composer = page.getByRole('region', { name: 'Message composer' });
    await expect(composer).toBeVisible();
    await composer.locator('textarea').fill('Fixture conversation draft');
    const sendConversation = composer.getByRole('button', { name: 'Send message', exact: true });
    await expect(sendConversation).toBeEnabled();
    await doubleClick(sendConversation);
    await expect(composer.getByText('Send unconfirmed')).toBeVisible();
    await expect(sendConversation).toBeDisabled();
    assert.equal(sends.length, 3);
    await checkWidth();
    if (process.env.PBK_INBOX_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/conversations-${engine.name()}-${viewport.width}.png` });
    }
    await composer.locator('textarea').fill('Fixture confirmed draft');
    await expect(sendConversation).toBeEnabled();
    await doubleClick(sendConversation);
    await expect(composer.getByText('SMS accepted by provider')).toBeVisible();
    await expect(composer.getByText(/does not confirm delivery/i)).toBeVisible();
    await expect(composer.locator('textarea')).toHaveValue('');
    assert.equal(sends.length, 4);
    const profile = page.getByRole('button', { name: 'Open seller profile', exact: true }).first();
    if (await profile.isVisible()) await profile.click();
    await expect(page.getByRole('link', { name: /open lead|lead portal/i }).first()).toHaveAttribute('href', '/leads/qa-lead');
    await page.goto(`${origin}/command-center`);
    await expect(page.getByRole('region', { name: 'Review', exact: true }).getByText('No pending approvals right now.')).toBeVisible();
    console.log(`Inbox, Conversations, approval deduplication and send hold: ${engine.name()} ${viewport.width}px`);
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
