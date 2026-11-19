import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { preview } from 'vite';
import { streamAvaChatResponse } from './ava-chat-events.mjs';
import { resolveAvaChatScope } from '../src/app/utils/avaChatScope.mjs';

const shellHtml = readFileSync(new URL('../dist/index.shell.html', import.meta.url), 'utf8');
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } });
const previewOrigin = `http://127.0.0.1:${server.httpServer.address().port}`;
const leadId = 'qa-ava-lead';
const leadScope = resolveAvaChatScope(`?leadId=${leadId}`);
const generalScope = resolveAvaChatScope('');
assert.ok(leadScope.valid && generalScope.valid);
const answer = `I found the latest seller note.\n\n${Array.from({ length: 42 }, (_, index) => `Step ${index + 1}: compare the seller's timeline, property condition, and confirmed deal facts before recommending the next action.`).join('\n\n')}\n\nFinal required detail: the complete explanation is preserved.`;
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
  const streams = new Map();
  const routedStreams = [];
  const observedResponses = new Set();
  const streamServer = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/assistant/chat') {
      const upstream = httpRequest(new URL(req.url, previewOrigin), { method: req.method, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(upstream);
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    let releaseCompletion;
    const completion = new Promise((resolve) => { releaseCompletion = resolve; });
    const entry = {
      res, payload, closed: false, partialWritten: false, finished: false, signal: null,
      finish: (body) => releaseCompletion({ statusCode: 200, body }),
    };
    streams.set(payload.message, entry);
    res.on('close', () => { entry.closed = true; });
    try {
      await streamAvaChatResponse(req, res, async () => {
        const { signal, onAnswer } = req.avaStream;
        entry.signal = signal;
        // Closing a held response must also release the callback and its heartbeat.
        const abort = () => releaseCompletion({ statusCode: 499, body: { ok: false } });
        signal.addEventListener('abort', abort, { once: true });
        try {
          if (signal.aborted) abort();
          await onAnswer(`Partial ${payload.message}`);
          entry.partialWritten = true;
          return await completion;
        } finally {
          signal.removeEventListener('abort', abort);
        }
      });
    } finally {
      entry.finished = true;
    }
  });
  await new Promise((resolve) => streamServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${streamServer.address().port}`;
  const chatUrl = `${origin}/ava-chat?leadId=${leadId}`;
  try {
    const page = await browser.newPage({ ...device, viewport });
    page.on('requestfailed', (request) => {
      if (!/abort|cancel/i.test(request.failure()?.errorText || '')) console.error('Browser request failed:', request.url(), request.failure()?.errorText);
    });
    page.on('console', (message) => { if (message.type() === 'error') console.error('Browser error:', message.text()); });
    page.on('response', (response) => {
      const request = response.request();
      if (request.method() === 'POST' && new URL(response.url()).pathname === '/api/assistant/chat') {
        observedResponses.add(request.postDataJSON().message);
      }
    });
    await page.addInitScript(() => {
      localStorage.setItem('pbk:local:openclaw-config', JSON.stringify({
        endpoint: location.origin,
        apiKey: 'fixture-only-browser-authority',
      }));
    });
    const chatRequests = [];
    const decisions = [];
    let pending = true;
    await page.route('**/*', (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (path === '/ava-chat') {
        return route.fulfill({ contentType: 'text/html', body: shellHtml });
      }
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
        if (req.postDataJSON().message.startsWith('Stream fixture:')) {
          routedStreams.push(req.postDataJSON().message);
          assert.equal(req.headers().accept, 'text/event-stream');
          assert.equal(req.postDataJSON().stream, true);
          return route.continue();
        }
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
      if (url.origin !== origin && req.resourceType() === 'stylesheet') {
        return route.fulfill({ contentType: 'text/css', body: '' });
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
    if (viewport.width <= 600) {
      const sendBounds = await page.getByRole('button', { name: 'Send to Ava', exact: true }).boundingBox();
      for (const name of ['Speak to Ava', 'Read replies aloud']) {
        const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
        assert.ok(bounds.x + bounds.width <= sendBounds.x, `${name} must not overlap Send on mobile`);
      }
    }
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
    assert.equal(await page.getByText(answer, { exact: true }).textContent(), answer);
    if (process.env.PBK_AVA_SCREENSHOTS === '1') {
      await page.getByText(answer, { exact: true }).evaluate((node) => node.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `.pbk-local/ava-chat-long-${engine.name()}-${viewport.width}.png` });
    }
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

    const persisted = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), leadScope.storageKeys.assistantExchanges);
    const streamAsk = 'Stream fixture: complete';
    await composer.fill(streamAsk);
    await page.getByRole('button', { name: 'Send to Ava' }).click();
    const streaming = page.getByRole('article').filter({ hasText: streamAsk });
    await expect(streaming).toHaveAttribute('data-status', 'pending');
    const exchangeId = await streaming.getAttribute('data-exchange-id');
    await expect(composer).toHaveValue('');
    await expect(streaming.getByText(`Partial ${streamAsk}`, { exact: true })).toBeVisible();
    assert.equal(streams.get(streamAsk).res.writableEnded, false, 'upstream tail is still held');
    const stop = page.getByRole('button', { name: 'Stop Ava response', exact: true });
    await expect(stop).toBeVisible();
    await expect(stop).toHaveAttribute('title', 'Stop Ava response');
    const stopBounds = await stop.boundingBox();
    await composer.fill('This must not double send');
    await composer.press('Enter');
    assert.equal(chatRequests.length, 3);
    assert.equal((await persisted()).some((item) => item.request === streamAsk), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    if (process.env.PBK_AVA_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/ava-chat-stream-pending-${engine.name()}-${viewport.width}.png` });
    }
    const completedAnswer = 'Final controller-approved answer replaces the provisional text.';
    streams.get(streamAsk).finish({
      ok: true, answer: completedAnswer, sessionId: 'qa-stream-session', activeLeadId: leadId,
      mission: { status: 'completed', steps: [{ id: 'stream-done', label: 'Stream metadata retained', status: 'completed' }] },
      trace: { intent: 'stream-proof' }, controlEnvelope: { status: 'safe' }, toolResult: { draftOnly: true },
    });
    await expect(streaming).toHaveAttribute('data-status', 'completed');
    assert.equal(await streaming.getAttribute('data-exchange-id'), exchangeId);
    await expect(streaming.getByText(completedAnswer, { exact: true })).toBeVisible();
    await expect(streaming.getByText(`Partial ${streamAsk}`, { exact: true })).toHaveCount(0);
    await expect(stop).toHaveCount(0);
    await expect(composer).toHaveValue('This must not double send');
    await expect.poll(async () => (await persisted()).find((item) => item.id === exchangeId)?.status)
      .toBe('completed');
    const saved = (await persisted()).find((item) => item.id === exchangeId);
    assert.deepEqual(saved.trace, { intent: 'stream-proof' });
    assert.deepEqual(saved.controlEnvelope, { status: 'safe' });
    assert.deepEqual(saved.toolResult, { draftOnly: true });
    await streaming.getByText('Mission timeline', { exact: true }).click();
    await expect(streaming.getByText('Stream metadata retained', { exact: true })).toBeVisible();

    for (const kind of ['cancel', 'interrupt', 'error']) {
      const ask = `Stream fixture: ${kind}`;
      await composer.fill(ask);
      await page.getByRole('button', { name: 'Send to Ava' }).click();
      const partial = page.getByRole('article').filter({ hasText: ask });
      await expect(partial.getByText(`Partial ${ask}`, { exact: true })).toBeVisible();
      await expect(stop).toBeVisible();
      const bounds = await stop.boundingBox();
      assert.ok(Math.abs(bounds.width - stopBounds.width) < 0.5);
      assert.ok(Math.abs(bounds.height - stopBounds.height) < 0.5);
      if (kind === 'cancel') await stop.click();
      else if (kind === 'error') streams.get(ask).res.end('event: error\ndata: {"message":"The response was interrupted.","code":"stream_failed"}\n\n');
      else streams.get(ask).res.end();
      await expect(partial).toHaveAttribute('data-status', kind === 'cancel' ? 'cancelled' : 'failed');
      await expect(partial.getByText(`Partial ${ask}`, { exact: true })).toBeVisible();
      await expect(partial.getByText(kind === 'cancel' ? 'Cancelled' : 'Interrupted', { exact: true })).toBeVisible();
      await expect(stop).toHaveCount(0);
      await expect.poll(() => streams.get(ask).closed).toBe(true);
      assert.equal((await persisted()).some((item) => item.request === ask), false);
      const sent = chatRequests.at(-1);
      assert.equal(sent.messages.some((item) => item.content.startsWith('Partial ')), false);
      assert.equal(sent.messages.some((item) => item.content === completedAnswer), true);
      assert.equal(sent.sessionId, 'qa-stream-session');
    }
    const unmountAsk = 'Stream fixture: unmount';
    await composer.fill(unmountAsk);
    await page.getByRole('button', { name: 'Send to Ava' }).click();
    await expect(page.getByText(`Partial ${unmountAsk}`, { exact: true })).toBeVisible();
    await page.evaluate(() => {
      history.pushState({}, '', '/leads');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect.poll(() => streams.get(unmountAsk).closed).toBe(true);
    assert.equal((await persisted()).every((item) => item.status === 'completed'), true);
    assert.equal((await persisted()).some((item) => item.request === unmountAsk), false);
    await page.goto(chatUrl);
    await expect(page.getByText(completedAnswer, { exact: true })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: completedAnswer }).getByRole('link', { name: 'Open lead used in this reply' })).toHaveAttribute('href', `/leads/${leadId}`);
    await expect(page.getByText(/^Partial Stream fixture:/)).toHaveCount(0);
    assert.equal(chatRequests.length, 7, 'no duplicate POST or automatic retry');
    for (const key of Object.values(generalScope.storageKeys)) {
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), null,
        'Linked chat must not create or overwrite general operator continuity');
    }
    await page.evaluate((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (target, value) {
        if (target === key) throw new DOMException('Fixture storage quota', 'QuotaExceededError');
        return original.call(this, target, value);
      };
    }, leadScope.storageKeys.operatorMemory);
    await composer.fill('Fixture draft kept in memory only');
    const storageNotice = page.getByRole('status').filter({ hasText: 'Some chat details could not be restored or saved in this browser.' });
    await expect(storageNotice).toContainText('Keep this chat open.');
    await expect(storageNotice).toBeInViewport({ ratio: 1 });
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Send to Ava', exact: true })).toBeInViewport({ ratio: 1 });
    assert.equal(chatRequests.length, 7, 'A browser storage failure must not submit a draft');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true
    );
    if (process.env.PBK_AVA_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/ava-chat-${engine.name()}-${viewport.width}.png` });
    }
    console.log(
      `Ava streaming, Stop, interruption, JSON fallback, history, mission and approval: ${engine.name()} ${viewport.width}px`
    );
  } catch (error) {
    console.error('Ava fixture transport failure:', JSON.stringify({
      engine: engine.name(), width: viewport.width, routedStreams,
      streams: [...streams].map(([message, entry]) => ({
        message, responseObserved: observedResponses.has(message), headersSent: entry.res.headersSent,
        partialWritten: entry.partialWritten, writableEnded: entry.res.writableEnded,
        closed: entry.closed, aborted: entry.signal?.aborted ?? null, finished: entry.finished,
      })),
    }));
    throw error;
  } finally {
    await browser.close();
    streamServer.closeAllConnections();
    await new Promise((resolve) => streamServer.close(resolve));
  }
}

try {
  await verify(chromium, { width: 1440, height: 900 });
  if (process.argv.includes('--chromium-only')) {
    await verify(chromium, { width: 390, height: 844 }, devices['iPhone 13']);
    await verify(chromium, { width: 320, height: 740 }, devices['iPhone 13']);
  } else {
    await verify(webkit, { width: 390, height: 844 }, devices['iPhone 13']);
    await verify(webkit, { width: 320, height: 844 }, devices['iPhone 13']);
  }
} finally {
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
