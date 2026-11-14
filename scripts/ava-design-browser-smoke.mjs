import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const leadId = 'qa-ava-lead';
const answer = 'I found the latest seller note.';
const chatUrl = `${origin}/ava-chat?leadId=${leadId}`;
const approval = { id: 'qa-ava-review', type: 'local_command', status: 'pending' };
const command = {
  id: 'qa-ava-command',
  command: 'Draft a note for the seller',
  action: 'send_email',
  status: 'pending_approval',
  approvalId: approval.id,
  requiresApproval: true,
  createdAt: new Date().toISOString(),
};

async function verify(engine, viewport, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...device, viewport });
    const chatRequests = [];
    const decisions = [];
    let pending = true;
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (path === '/state') {
        return route.fulfill({ json: { approvals: pending ? [approval] : [] } });
      }
      if (path === '/api/desktop-sidecar/status') {
        return route.fulfill({ json: { ok: true, connected: true } });
      }
      if (path === '/api/local/commands' && req.method() === 'GET') {
        return route.fulfill({ json: { ok: true, commands: pending ? [command] : [] } });
      }
      if (path === '/api/assistant/chat' && req.method() === 'POST') {
        chatRequests.push(req.postDataJSON());
        return route.fulfill({
          json: {
            ok: true,
            answer: chatRequests.length === 1 ? answer : 'That was the latest note.',
            sessionId: 'qa-ava-session',
            activeLeadId: leadId,
            mission: {
              goal: 'Review the seller note',
              status: 'completed',
              steps: [{ id: 'qa-read', label: 'Read the seller note', status: 'completed' }],
            },
          },
        });
      }
      if (path === `/api/approvals/${approval.id}` && req.method() === 'PUT') {
        decisions.push(req.postDataJSON());
        pending = false;
        return route.fulfill({ json: { ok: true, approval: { ...approval, status: 'approved' } } });
      }
      if (url.origin !== origin || /^\/(api\/|health$|events$|invoke$)/.test(path)) {
        return route.fulfill({ json: { ok: true } });
      }
      return route.continue();
    });

    await page.goto(chatUrl);
    await expect(page.getByRole('heading', { name: 'Ava Chat', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open linked lead' })).toHaveAttribute(
      'href',
      `/leads/${leadId}`
    );
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    await expect(approve).toBeVisible();
    await expect(page.getByText('Review before Ava continues')).toBeVisible();
    await approve.click();
    await expect(approve).toHaveCount(0);
    assert.deepEqual(
      decisions.map(({ status }) => status),
      ['approved']
    );

    const composer = page.getByRole('textbox', { name: 'Ask Ava anything' });
    await composer.fill('What is the latest seller note?');
    await page.getByRole('button', { name: 'Send to Ava' }).click();
    const response = page.getByRole('article').filter({ hasText: answer });
    await expect(response.getByText(answer, { exact: true })).toBeVisible();
    await expect(
      response.getByRole('link', { name: 'Open lead used in this reply' })
    ).toHaveAttribute('href', `/leads/${leadId}`);
    const timeline = response.getByText('Mission timeline', { exact: true });
    await expect(timeline).toBeVisible();
    await expect(response.getByText('Read the seller note', { exact: true })).toBeHidden();
    await timeline.click();
    await expect(response.getByText('Read the seller note', { exact: true })).toBeVisible();
    assert.equal(chatRequests[0].leadId, leadId);

    await page.reload();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    const history = page.getByRole('searchbox', { name: 'Search past chats' });
    await history.fill('unmatched fixture');
    await expect(page.getByText('No matching chats')).toBeVisible();
    await history.fill('latest seller note');
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Clear history search' }).click();

    const openContext = page.getByRole('button', { name: 'Open Ava context' });
    await openContext.click();
    const context = page.getByRole('dialog', { name: 'Ava context' });
    await expect(context).toBeVisible();
    await expect(context.getByRole('heading', { name: 'Recent ask' })).toBeVisible();
    await context.getByRole('button', { name: 'Close Ava context' }).click();
    await expect(context).toBeHidden();
    await expect(openContext).toBeFocused();

    await composer.fill('Was that the latest note?');
    await page.getByRole('button', { name: 'Send to Ava' }).click();
    await expect(page.getByText('That was the latest note.', { exact: true })).toBeVisible();
    await expect(page.getByText('Ava answered', { exact: true })).toHaveCount(0);
    assert.equal(chatRequests.length, 2);
    assert.equal(chatRequests[1].sessionId, 'qa-ava-session');
    assert.equal(chatRequests[1].leadId, leadId);
    assert.equal(
      chatRequests[1].messages.find(({ role }) => role === 'assistant')?.content,
      answer
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    if (process.env.PBK_AVA_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/ava-chat-${engine.name()}-${viewport.width}.png` });
    }
    console.log(
      `Ava history, lead context, mission and approval: ${engine.name()} ${viewport.width}px`
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
