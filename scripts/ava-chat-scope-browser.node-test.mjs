import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { build } from 'esbuild';

let server, browser, origin;

before(async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter, useLocation, useNavigate } from 'react-router';
        import { AvaChat } from './src/app/routes/AvaChat';

        function Fixture() {
          const { pathname, search, state } = useLocation();
          const navigate = useNavigate();
          React.useLayoutEffect(() => {
            history.replaceState({}, '', pathname + search);
            window.navigateChat = (url) => {
              history.replaceState({}, '', url);
              navigate(url);
            };
          }, [pathname, search, navigate]);
          return <main className="h-dvh" data-fixture-route={pathname + search} data-fixture-lead-search={state?.avaLeadSearch}><AvaChat /></main>;
        }

        createRoot(document.getElementById('root')).render(
          <MemoryRouter initialEntries={[location.pathname + location.search]}><Fixture /></MemoryRouter>
        );
      `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    plugins: [{
      name: 'isolated-ava-runtime',
      setup(build) {
        build.onResolve({ filter: /(?:runtimeBridge|useRuntimeSnapshot)$/ }, ({ path }) => ({
          path: path.split('/').at(-1),
          namespace: 'ava-fixture',
        }));
        build.onLoad({ filter: /./, namespace: 'ava-fixture' }, ({ path }) => ({
          contents: path === 'useRuntimeSnapshot'
            ? `const refresh = async () => {};
               export const useRuntimeSnapshot = () => {
                 window.fixture.snapshotReads++;
                 return { snapshot: null, refresh };
               };`
            : `export class RuntimeBridgeError extends Error {
                 constructor(message, status, code) { super(message); this.status = status; this.code = code; }
               }
               export const fetchDesktopSidecarStatusRequest = async () => {
                 window.fixture.sidecarReads++;
                 return { ok: true, connected: true };
               };
               export const fetchLocalCommandsRequest = async () => {
                 window.fixture.queueReads++;
                 return { ok: true, commands: [] };
               };
               export const streamAvaAssistantChatRequest = (payload, { signal, onAnswer }) =>
                 new Promise((resolve, reject) => window.fixture.streams.push({
                   payload, signal, onAnswer, resolve,
                   rejectBootstrap: () => reject(new RuntimeBridgeError(
                     'Command Center is restoring saved data. Your request hasn’t started. Try again in a moment.',
                     503, 'state_bootstrap_unavailable'))
                 }));
               export const queueLocalCommandRequest = (...args) => window.fixture.blocked('queue', args);
               export const updateApprovalDecision = (...args) => window.fixture.blocked('approval', args);
               export const bridgeBlobRequest = (...args) => window.fixture.blocked('speech', args);`,
        }));
      },
    }],
  });
  const js = bundle.outputFiles[0].text;
  const stylesheet = await compile(`
    @import './src/styles/tailwind.css';
    @import './src/styles/theme.css';
    @import './src/styles/pbk-tokens.css';
    @import './src/styles/pbk-components.css';
  `, { base: process.cwd(), onDependency() {} });
  const scanner = new Scanner({});
  const componentSource = await readFile(new URL('../src/app/routes/AvaChat.tsx', import.meta.url), 'utf8');
  const buttonSource = await readFile(new URL('../src/components/pbk/index.tsx', import.meta.url), 'utf8');
  const utilities = scanner.scanFiles(
    [componentSource, buttonSource, '<main className="h-dvh">'].map((content) => ({ content, extension: 'tsx' }))
  );
  const css = stylesheet.build(utilities);
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(js);
    } else if (path === '/fixture.css') {
      res.setHeader('Content-Type', 'text/css');
      res.end(css);
    } else if (path === '/ava-chat') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

const general = 'pbk:ava-chat:';
const leadA = 'pbk:ava-chat:lead:sample-a:';
const leadB = 'pbk:ava-chat:lead:sample-b:';
const aUrl = '/ava-chat?leadId=sample-a';
const bUrl = '/ava-chat?leadId=sample-b';
const date = '2026-11-19T12:00:00.000Z';

function savedData(prefix, label) {
  return {
    [`${prefix}operator-memory`]: JSON.stringify({
      draft: `Draft for ${label}`,
      action: 'operator_command',
      updatedAt: date,
    }),
    [`${prefix}assistant-session`]: `session-${label}`,
    [`${prefix}assistant-exchanges`]: JSON.stringify([{
      id: `exchange-${label}`,
      request: `Previous ask for ${label}`,
      answer: `Previous reply for ${label}`,
      status: 'completed',
      suggestions: [],
      createdAt: date,
      updatedAt: date,
    }]),
  };
}

async function open(t, url, seed = {}, faults = {}, options = {}) {
  const page = await browser.newPage(options);
  t.after(() => page.close());
  page.setDefaultTimeout(2500);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => new URL(route.request().url()).origin === origin
    ? route.continue()
    : route.abort());
  await page.addInitScript(({ seed, faults }) => {
    const storage = window.localStorage;
    for (const [key, value] of Object.entries(seed)) storage.setItem(key, value);
    const rawGet = Storage.prototype.getItem;
    const rawSet = Storage.prototype.setItem;
    const rawRemove = Storage.prototype.removeItem;
    window.fixture = {
      streams: [],
      writes: [],
      snapshotReads: 0,
      sidecarReads: 0,
      queueReads: 0,
      localReads: [],
      localWrites: [],
      faults,
      stored: (keys) => Object.fromEntries(keys.map((key) => [key, rawGet.call(storage, key)])),
      blocked: (kind) => {
        window.fixture.writes.push(kind);
        throw new Error(`Unexpected ${kind} action`);
      },
    };
    Object.defineProperty(window, 'localStorage', {
      get() {
        if (faults.getter) throw new DOMException('Fixture getter denied', 'SecurityError');
        return storage;
      },
    });
    Storage.prototype.getItem = function (key) {
      window.fixture.localReads.push(key);
      if (faults.readOnce?.includes(key)) {
        faults.readOnce.splice(faults.readOnce.indexOf(key), 1);
        throw new DOMException('Fixture read denied', 'SecurityError');
      }
      return rawGet.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      window.fixture.localWrites.push({ key, value });
      if (faults.set) throw new DOMException('Fixture write denied', 'QuotaExceededError');
      rawSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (faults.remove) throw new DOMException('Fixture removal denied', 'SecurityError');
      rawRemove.call(this, key);
    };
    window.SpeechRecognition = class {
      constructor() {
        if (!faults.voice) window.fixture.blocked('microphone');
        window.fixture.recognition = this;
      }
      start() {}
      stop() {}
    };
  }, { seed, faults });
  await page.goto(origin + url);
  await expect(page.locator('main')).toHaveAttribute('data-fixture-route', url);
  return { page, errors };
}

async function navigate(page, url) {
  await page.evaluate((target) => window.navigateChat(target), url);
  await expect(page.locator('main')).toHaveAttribute('data-fixture-route', url);
}

const composer = (page) => page.getByRole('textbox', { name: 'Ask Ava anything' });
const linkedLead = (page) => page.getByRole('link', { name: 'Open linked lead' });

async function resumeDraft(page) {
  if (!(await page.getByRole('button', { name: /Resume last ask/ }).isVisible())) {
    await page.getByRole('button', { name: 'Open Ava context' }).click();
  }
  await page.getByRole('button', { name: /Resume last ask/ }).click();
}

async function submit(page) {
  await page.getByRole('button', { name: 'Send to Ava', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop Ava response' })).toBeVisible();
  return page.evaluate(() => window.fixture.streams.at(-1).payload);
}

async function assertNoActions(page, submits = 0) {
  assert.deepEqual(await page.evaluate(() => ({
    submits: window.fixture.streams.length,
    writes: window.fixture.writes,
  })), { submits, writes: [] });
}

function storageNotice(page) {
  return page.getByRole('status').filter({ hasText: /chat details could not be restored or saved/i });
}

async function speak(page, text) {
  await page.getByRole('button', { name: 'Speak to Ava' }).click();
  await page.evaluate(transcript => window.fixture.recognition.onresult({
    results: [Object.assign([{ transcript }], { isFinal: true })],
  }), text);
}

test('the saved-lead review starter sends only the selected lead on desktop and mobile', async t => {
  for (const width of [1440, 390, 320]) {
    const { page, errors } = await open(t, aUrl, {}, {}, {
      viewport: { width, height: 800 }, isMobile: width < 500, hasTouch: width < 500,
    });
    await page.getByRole('button', { name: /Review this lead/ }).click();
    await expect(composer(page)).toHaveValue('Review this lead');
    await assertNoActions(page);
    const payload = await submit(page);
    assert.equal(payload.message, 'Review this lead');
    assert.equal(payload.leadId, 'sample-a');
    await page.evaluate(() => window.fixture.streams.at(-1).resolve({
      ok: true, answer: 'Hold outreach. Review the saved contact restriction. No lead data changed and no outreach was sent.',
      usedIntent: 'saved_lead_review',
    }));
    await expect(page.getByText(/^Hold outreach\./)).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await assertNoActions(page, 1);
    assert.deepEqual(errors, []);
  }
});

test('a spoken browser command opens its linked lead without a model or automation request', async t => {
  const { page, errors } = await open(t, aUrl, {}, { voice: true });
  await speak(page, 'Hey Ava, open the current lead.');
  await expect(page.locator('main')).toHaveAttribute('data-fixture-route', '/leads/sample-a');
  await assertNoActions(page);
  assert.deepEqual(errors, []);
});

test('spoken lead lookup passes the literal term to Leads without putting it in the URL', async t => {
  const { page, errors } = await open(t, '/ava-chat', {}, { voice: true });
  await speak(page, 'Search leads for Avery O’Neil.');
  await expect(page.locator('main')).toHaveAttribute('data-fixture-route', '/leads');
  await expect(page.locator('main')).toHaveAttribute('data-fixture-lead-search', 'Avery O’Neil');
  await assertNoActions(page);
  assert.deepEqual(errors, []);
});

test('voice research stays in the composer until Send and typed navigation stays local at 320px', async t => {
  const { page, errors } = await open(t, aUrl, {}, { voice: true }, { viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true });
  await speak(page, 'Ask Rex to research Tampa, FL');
  await expect(composer(page)).toHaveValue('Ask Rex to research Tampa, FL');
  await expect(page.getByRole('status').filter({ hasText: 'Voice draft ready' })).toBeVisible();
  await assertNoActions(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (await page.getByRole('button', { name: 'Turn off spoken replies' }).isVisible()) {
    await page.getByRole('button', { name: 'Turn off spoken replies' }).click();
  }
  const submitted = await submit(page);
  assert.equal(submitted.leadId, 'sample-a');
  await page.evaluate(() => window.fixture.streams[0].resolve({ ok: true, answer: 'Research saved.' }));
  await expect(page.getByText('Research saved.', { exact: true })).toBeVisible();
  await composer(page).fill('Open Deal Analyzer');
  await page.getByRole('button', { name: 'Send to Ava', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-fixture-route', '/deals/analyzer');
  await assertNoActions(page, 1);
  assert.deepEqual(errors, []);
});

test('changing lead within Ava Chat replaces draft, history and the session sent on explicit submit', async (t) => {
  // The legacy data mirrors A so the original component loads A successfully before the switch.
  const { page } = await open(t, aUrl, {
    ...savedData(general, 'A'),
    ...savedData(leadA, 'A'),
    ...savedData(leadB, 'B'),
  });
  await expect(page.getByText('Previous reply for A', { exact: true })).toBeVisible();
  await resumeDraft(page);
  await expect(composer(page)).toHaveValue('Draft for A');
  await assertNoActions(page);

  await navigate(page, bUrl);
  await expect(linkedLead(page)).toHaveAttribute('href', '/leads/sample-b');
  const beforeResume = await composer(page).inputValue();
  await resumeDraft(page);
  const afterResume = await composer(page).inputValue();
  await assertNoActions(page);
  const payload = await submit(page);
  assert.deepEqual({
    beforeResume,
    afterResume,
    leadId: payload.leadId,
    sessionId: payload.sessionId,
    context: payload.context,
    messages: payload.messages,
  }, {
    beforeResume: '',
    afterResume: 'Draft for B',
    leadId: 'sample-b',
    sessionId: 'session-B',
    context: { path: '/ava-chat', search: '?leadId=sample-b' },
    messages: [
      { role: 'user', content: 'Previous ask for B' },
      { role: 'assistant', content: 'Previous reply for B' },
      { role: 'user', content: 'Draft for B' },
    ],
  });
  await expect(page.getByText('Previous reply for B', { exact: true })).toBeVisible();
  await expect(page.getByText('Previous reply for A', { exact: true })).toHaveCount(0);

  await navigate(page, aUrl);
  await expect(page.getByText('Previous reply for A', { exact: true })).toBeVisible();
  await expect(page.getByText('Previous reply for B', { exact: true })).toHaveCount(0);
  await expect(composer(page)).toHaveValue('');
  await resumeDraft(page);
  await expect(composer(page)).toHaveValue('Draft for A');
  await assertNoActions(page, 1);
});

test('lead activity leaves all legacy slots intact and general chat resumes them', async (t) => {
  const legacy = savedData(general, 'general chat');
  const { page } = await open(t, aUrl, { ...legacy, ...savedData(leadA, 'A') });
  await expect(page.getByText('Previous reply for A', { exact: true })).toBeVisible();
  await expect(page.getByText('Previous reply for general chat', { exact: true })).toHaveCount(0);
  await composer(page).fill('New ask for lead A');
  const leadPayload = await submit(page);
  assert.equal(leadPayload.sessionId, 'session-A');
  await page.evaluate(() => window.fixture.streams[0].resolve({
    ok: true, answer: 'New reply for lead A', sessionId: 'session-A-new',
  }));
  await expect(page.getByText('New reply for lead A', { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate((keys) => window.fixture.stored(keys), Object.keys(legacy)), legacy);
  const accesses = await page.evaluate(() => ({
    reads: window.fixture.localReads,
    writes: window.fixture.localWrites,
  }));
  assert.ok(accesses.reads.every((key) => key.startsWith(leadA)));
  assert.ok(accesses.writes.every(({ key }) => key.startsWith(leadA)));
  assert.ok(accesses.writes
    .filter(({ key }) => key === `${leadA}assistant-exchanges`)
    .every(({ value }) => JSON.parse(value).some(({ id }) => id === 'exchange-A')));

  await navigate(page, '/ava-chat?threadId=unrelated');
  await expect(linkedLead(page)).toHaveCount(0);
  await expect(page.getByText('Previous reply for general chat', { exact: true })).toBeVisible();
  await expect(page.getByText('New reply for lead A', { exact: true })).toHaveCount(0);
  await resumeDraft(page);
  await expect(composer(page)).toHaveValue('Draft for general chat');
  await assertNoActions(page, 1);
  const generalPayload = await submit(page);
  assert.equal(generalPayload.leadId, undefined);
  assert.equal(generalPayload.sessionId, 'session-general chat');
  assert.deepEqual(generalPayload.messages, [
    { role: 'user', content: 'Previous ask for general chat' },
    { role: 'assistant', content: 'Previous reply for general chat' },
    { role: 'user', content: 'Draft for general chat' },
  ]);
  await navigate(page, aUrl);
  await expect(page.getByText('New reply for lead A', { exact: true })).toBeVisible();
  await resumeDraft(page);
  await expect(composer(page)).toHaveValue('New ask for lead A');
  await assertNoActions(page, 2);
});

test('encoded alias and unrelated search changes preserve the live composer and current payload context', async (t) => {
  const { page } = await open(t, aUrl, savedData(leadA, 'A'));
  await expect(page.getByText('Previous reply for A', { exact: true })).toBeVisible();
  await composer(page).fill('Unsubmitted ask for A');
  const newUrl = '/ava-chat?%6Cead_id=sample-a&prompt=%ZZ';
  await navigate(page, newUrl);
  await expect(composer(page)).toHaveValue('Unsubmitted ask for A');
  await assertNoActions(page);
  const payload = await submit(page);
  assert.equal(payload.leadId, 'sample-a');
  assert.equal(payload.sessionId, 'session-A');
  assert.equal(payload.context.search, '?%6Cead_id=sample-a&prompt=%ZZ');
});

test('ambiguous lead context exposes a general-chat link without mounting any session runtime', async (t) => {
  const { page } = await open(t, '/ava-chat?leadId=sample-a&lead_id=sample-b', savedData(general, 'general chat'));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => {
    const { snapshotReads, sidecarReads, queueReads, localReads } = window.fixture;
    return { snapshotReads, sidecarReads, queueReads, localReads };
  }), { snapshotReads: 0, sidecarReads: 0, queueReads: 0, localReads: [] });
  await assertNoActions(page);
  const generalLink = page.getByRole('link', { name: /general Ava chat/i });
  await expect(generalLink).toHaveAttribute('href', '/ava-chat');
  await generalLink.click();
  await expect(page.getByText('Previous reply for general chat', { exact: true })).toBeVisible();
  await assertNoActions(page);
});

test('a startup rejection restores the message and leaves retry in the operator’s hands on mobile', async (t) => {
  const { page } = await open(t, aUrl, {}, {}, { viewport: { width: 390, height: 844 } });
  const message = 'Review the latest seller call';
  await composer(page).fill(message);
  await submit(page);
  await page.evaluate(() => window.fixture.streams[0].rejectBootstrap());
  await expect(page.getByRole('alert')).toContainText('Command Center is restoring saved data');
  await expect(composer(page)).toHaveValue(message);
  assert.equal(await page.evaluate(() => window.fixture.streams.length), 1);
  const retry = await submit(page);
  assert.equal(retry.message, message);
  assert.equal(retry.leadId, 'sample-a');
  await page.evaluate(() => window.fixture.streams[1].resolve({ ok: true, answer: 'Seller call reviewed.' }));
  await expect(page.getByText('Seller call reviewed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('switching leads aborts an active stream and ignores callbacks arriving after abort', async (t) => {
  const { page } = await open(t, aUrl, { ...savedData(leadA, 'A'), ...savedData(leadB, 'B') });
  await composer(page).fill('Ask with a pending reply');
  await submit(page);
  await page.evaluate(() => window.fixture.streams[0].onAnswer('Partial reply in A'));
  await expect(page.getByText('Partial reply in A', { exact: true })).toBeVisible();
  await navigate(page, bUrl);
  await expect.poll(() => page.evaluate(() => window.fixture.streams[0].signal.aborted)).toBe(true);
  await page.evaluate(async () => {
    const stream = window.fixture.streams[0];
    stream.onAnswer('Late partial in A');
    stream.resolve({ ok: true, answer: 'Late final in A', sessionId: 'late-session-A' });
    await new Promise(requestAnimationFrame);
  });
  for (const text of ['Partial reply in A', 'Late partial in A', 'Late final in A']) {
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText('Previous reply for B', { exact: true })).toBeVisible();
  const keys = [`${leadA}assistant-session`, `${leadA}assistant-exchanges`, `${leadB}assistant-session`, `${leadB}assistant-exchanges`];
  const persisted = await page.evaluate((keys) => window.fixture.stored(keys), keys);
  assert.equal(persisted[keys[0]], 'session-A');
  assert.deepEqual(JSON.parse(persisted[keys[1]]).map(({ answer }) => answer), ['Previous reply for A']);
  assert.equal(persisted[keys[2]], 'session-B');
  assert.deepEqual(JSON.parse(persisted[keys[3]]).map(({ answer }) => answer), ['Previous reply for B']);
  await assertNoActions(page, 1);
});

for (const [faultName, faults, corrupt] of [
  ['the storage getter throws', { getter: true }, false],
  ['storage sends write and removal errors', { set: true, remove: true }, true],
]) {
  test(`Ava stays usable in memory when ${faultName}`, async (t) => {
    const scoped = savedData(leadA, 'A');
    if (corrupt) {
      scoped[`${leadA}operator-memory`] = '{corrupt';
      scoped[`${leadA}assistant-exchanges`] = '{corrupt';
    }
    const legacy = savedData(general, 'general chat');
    const seed = { ...legacy, ...scoped };
    const { page, errors } = await open(t, aUrl, seed, faults);
    await composer(page).fill('Ask using only available storage');
    await expect(storageNotice(page)).toBeVisible();
    await assertNoActions(page);
    const payload = await submit(page);
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'Ask using only available storage' }]);
    assert.equal(payload.sessionId, corrupt ? 'session-A' : undefined);
    await page.evaluate(() => window.fixture.streams[0].resolve({
      ok: true, answer: 'In-memory reply in A', sessionId: 'in-memory-session-A',
    }));
    await expect(page.getByText('In-memory reply in A', { exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate((keys) => window.fixture.stored(keys), Object.keys(seed)), seed);
  });
}

test('one failed initial slot read protects unseen history while readable slots still persist', async (t) => {
  const seeded = savedData(leadA, 'A');
  const exchangeKey = `${leadA}assistant-exchanges`;
  const sessionKey = `${leadA}assistant-session`;
  const { page, errors } = await open(t, aUrl, seeded, { readOnce: [exchangeKey] });
  await expect(storageNotice(page)).toBeVisible();
  await expect(page.getByText('Previous reply for A', { exact: true })).toHaveCount(0);
  await resumeDraft(page);
  await expect(composer(page)).toHaveValue('Draft for A');
  await assertNoActions(page);
  const payload = await submit(page);
  assert.equal(payload.sessionId, 'session-A');
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'Draft for A' }]);
  await page.evaluate(() => window.fixture.streams[0].resolve({
    ok: true, answer: 'Fresh reply visible in memory', sessionId: 'session-A-new',
  }));
  await expect(page.getByText('Fresh reply visible in memory', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((keys) => window.fixture.stored(keys), [exchangeKey, sessionKey]))
    .toEqual({ [exchangeKey]: seeded[exchangeKey], [sessionKey]: 'session-A-new' });
  assert.deepEqual(errors, []);
  await navigate(page, bUrl);
  await navigate(page, aUrl);
  await expect(page.getByText('Previous reply for A', { exact: true })).toBeVisible();
  await expect(page.getByText('Fresh reply visible in memory', { exact: true })).toHaveCount(0);
  await assertNoActions(page, 1);
});

test('storage notice stays in view above a long restored thread at phone widths', async (t) => {
  const seeded = savedData(leadA, 'A');
  const [exchange] = JSON.parse(seeded[`${leadA}assistant-exchanges`]);
  seeded[`${leadA}assistant-exchanges`] = JSON.stringify(Array.from({ length: 30 }, (_, index) => ({
    ...exchange,
    id: `exchange-A-${index}`,
    request: `Saved ask ${index + 1}`,
    answer: `Saved reply ${index + 1}`,
  })));

  for (const width of [320, 390]) {
    const { page } = await open(t, aUrl, seeded, { readOnce: [`${leadA}operator-memory`] }, {
      viewport: { width, height: 740 },
      isMobile: true,
      hasTouch: true,
    });
    await expect(page.getByText('Saved reply 30', { exact: true })).toBeInViewport();
    const notice = storageNotice(page);
    await expect(notice).toBeInViewport({ ratio: 1 });
    await expect(notice).toContainText('Keep this chat open.');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await expect(composer(page)).toBeInViewport({ ratio: 1 });
    await composer(page).fill('New ask on a phone');
    await expect(page.getByRole('button', { name: 'Send to Ava' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Send to Ava' })).toBeEnabled();
    await navigate(page, '/ava-chat?leadId=sample-a&leadId=sample-b');
    const recoveryLink = page.getByRole('link', { name: /general Ava chat/i });
    await expect(recoveryLink).toBeInViewport({ ratio: 1 });
    assert.ok((await recoveryLink.boundingBox()).height >= 44);
    await assertNoActions(page);
  }
});
