import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

let server, browser, origin;
const componentPath = 'src/app/components/agents/AgentResearchTools.tsx';
before(async () => {
  const componentImport = existsSync(componentPath)
    ? `import {AgentResearchTools} from './${componentPath}';`
    : 'const AgentResearchTools = () => null;';
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; ${componentImport}
      const root = createRoot(document.getElementById('root'));
      window.renderSubject = (agentId='ava', leadId='sample-a', keyed=true) => root.render(
        React.createElement(AgentResearchTools, {key:keyed ? JSON.stringify([agentId,leadId]) : 'stable', agentId,agentName:agentId,leadId}));
      window.unmountSubject = () => root.unmount(); window.renderSubject();`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outfile: 'fixture.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    plugins: [
      {
        name: 'fixture-runtime',
        setup(build) {
          build.onResolve({ filter: /runtimeBridge$/ }, () => ({
            path: 'runtime',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'export const invokeRuntimeTool = (...args) => window.fixtureInvoke(...args);',
          }));
        },
      },
    ],
  });
  const js =
    bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ||
    bundle.outputFiles[0].text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text || '';
  server = createServer((req, res) => {
    res.setHeader(
      'Content-Type',
      req.url === '/fixture.js'
        ? 'text/javascript'
        : req.url === '/fixture.css'
          ? 'text/css'
          : 'text/html'
    );
    res.end(
      req.url === '/fixture.js'
        ? js
        : req.url === '/fixture.css'
          ? css
          : '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function open(t, options = {}) {
  const page = await browser.newPage(options);
  t.after(() => page.close());
  page.setDefaultTimeout(1500);
  await page.addInitScript(() => {
    window.invokes = [];
    window.fixtureInvoke = (...args) => {
      window.invokes.push(args);
      return new Promise((resolve, reject) => {
        window.resolveDiscovery = resolve;
        window.rejectDiscovery = reject;
      });
    };
  });
  await page.goto(origin);
  return page;
}
const local = {
  matches: [{ toolName: 'launchBrowserResearch', risk: 'read', source: 'pbk-local-tool-universe' }],
};
const catalog = {
  source: 'composio',
  status: 'matched',
  discoveryOnly: true,
  checkedAt: '2026-11-19T12:00:00.000Z',
  tools: [
    {
      slug: 'COMPOSIO_SEARCH_WEB',
      name: 'Public web research',
      version: '20261119_00',
      inputFields: ['query'],
      scope: 'public_web',
      runnable: false,
    },
  ],
  note: 'Catalog metadata only.',
};
async function find(page) {
  await page.locator('summary').first().click();
  await page.getByRole('button', { name: 'Find research tools', exact: true }).click();
}

test('mount, disclosure, selection and navigation never inspect automatically', async (t) => {
  const page = await open(t);
  await expect(page.locator('summary').first()).toHaveText('Research tools');
  assert.equal(await page.locator('details').first().getAttribute('open'), null);
  await page.locator('summary').first().click();
  await expect(page.getByText('Never checked', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.renderSubject('max', 'sample-b');
    history.pushState({}, '', '/agents?leadId=sample-b');
  });
  await expect(page.locator('details').first()).not.toHaveAttribute('open');
  assert.deepEqual(await page.evaluate(() => window.invokes), []);
});

test('explicit discovery sends only the fixed request and deduplicates pending clicks', async (t) => {
  const page = await open(t);
  await find(page);
  await expect(page.getByRole('button', { name: 'Finding research tools…' })).toBeDisabled();
  await page.evaluate(() => document.querySelector('button').click());
  assert.deepEqual(await page.evaluate(() => window.invokes), [
    ['discoverExternalTool', { query: 'public web research', includeComposio: true }],
  ]);
  await page.evaluate((result) => window.resolveDiscovery(result), { ...local, composio: catalog });
  await expect(page.getByText('Catalog matched', { exact: true })).toBeVisible();
  await expect(page.getByText('launchBrowserResearch', { exact: true })).toBeVisible();
  await page.getByText('Preview public web research', { exact: true }).click();
  await expect(page.getByText('COMPOSIO_SEARCH_WEB', { exact: true })).toBeVisible();
  await expect(page.getByText('Public web', { exact: true })).toBeVisible();
  await expect(page.getByText('query', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Execution unavailable in this inspector', { exact: true })
  ).toBeVisible();
  assert.equal(await page.getByRole('button', { name: /^(Run|Send|Activate)/ }).count(), 0);
  assert.equal((await page.evaluate(() => window.invokes)).length, 1);
});

for (const [status, label] of [
  ['not_configured', 'Not configured'],
  ['disabled', 'Disabled'],
  ['authorization_failed', 'Authorization failed'],
  ['rate_limited', 'Rate limited'],
  ['timed_out', 'Timed out'],
  ['unavailable', 'Unavailable'],
  ['not_found', 'No catalog match'],
])
  test(`catalog ${status} remains honest and non-executable`, async (t) => {
    const page = await open(t);
    await find(page);
    await page.evaluate((result) => window.resolveDiscovery(result), {
      ...local,
      composio: { ...catalog, status, tools: [], checkedAt: undefined },
    });
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText('Never checked', { exact: true })).toBeVisible();
    assert.equal(await page.getByText('Preview public web research', { exact: true }).count(), 0);
  });

test('missing metadata and rejected requests never invent catalog checks or leak errors', async (t) => {
  const page = await open(t);
  await find(page);
  await page.evaluate((result) => window.resolveDiscovery(result), local);
  await expect(page.getByText('Catalog metadata unavailable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find research tools', exact: true }).click();
  await page.evaluate(() => window.rejectDiscovery(new Error('sensitive-provider-details')));
  await expect(
    page.getByText('Research tool inspection failed. Try again.', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Never checked', { exact: true })).toBeVisible();
  assert.equal(await page.getByText('sensitive-provider-details').count(), 0);
});

test('failed retry retains the same subject snapshot and labels the latest failure separately', async (t) => {
  const page = await open(t);
  await find(page);
  await page.evaluate((result) => window.resolveDiscovery(result), { ...local, composio: catalog });
  await expect(page.getByText('Catalog matched', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find research tools', exact: true }).click();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-19T12:00:00.000Z');
  await page.evaluate(() => window.rejectDiscovery(new Error('private failure')));
  await expect(
    page.getByText('Research tool inspection failed. Try again.', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Showing the previous inspection for this selection.', { exact: true })
  ).toBeVisible();
  await expect(page.getByText('launchBrowserResearch', { exact: true })).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-19T12:00:00.000Z');
  await expect(page.getByText('Never checked', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.renderSubject('max', 'sample-b'));
  await page.locator('summary').first().click();
  await expect(page.getByText('Never checked', { exact: true })).toBeVisible();
  await expect(page.getByText('launchBrowserResearch', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Research tool inspection failed. Try again.', { exact: true })
  ).toHaveCount(0);
});

for (const [name, value] of [
  ['tools object', { composio: { ...catalog, tools: {} }, matches: 'bad' }],
  [
    'null tool',
    { composio: { ...catalog, tools: [null] }, matches: [null, {}, { toolName: { bad: true } }] },
  ],
  ['unknown status', { composio: { ...catalog, status: 'invented', tools: [] }, matches: {} }],
  [
    'wrong safety metadata',
    { composio: { ...catalog, tools: [{ ...catalog.tools[0], runnable: true }] }, matches: [] },
  ],
  ['null root', null],
])
  test(`malformed ${name} cannot crash the inspector or become usable metadata`, async (t) => {
    const page = await open(t);
    await find(page);
    await page.evaluate((result) => window.resolveDiscovery(result), value);
    await expect(page.getByText('Catalog metadata unavailable', { exact: true })).toBeVisible();
    await expect(
      page.getByText('No local advisory matches returned.', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Find research tools', exact: true })
    ).toBeEnabled();
    await expect(page.getByText('Preview public web research', { exact: true })).toHaveCount(0);
  });

test('projection bounds local matches and ignores arbitrary catalog prose and unsafe fields', async (t) => {
  const page = await open(t);
  await find(page);
  await page.evaluate((result) => window.resolveDiscovery(result), {
    matches: Array.from({ length: 40 }, (_, i) => ({
      toolName: `localTool${i}`,
      risk: 'injected prose',
      source: 'untrusted source',
    })),
    composio: { ...catalog, note: 'untrusted provider prose' },
  });
  await expect(page.getByText('Catalog matched', { exact: true })).toBeVisible();
  assert.ok((await page.locator('li').count()) <= 5);
  await expect(page.getByText('untrusted provider prose', { exact: true })).toHaveCount(0);
  await expect(page.getByText('untrusted source', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Risk: injected prose', { exact: true })).toHaveCount(0);
});

for (const keyed of [true, false])
  for (const [agentId, leadId] of [
    ['ava', 'sample-b'],
    ['max', 'sample-a'],
  ])
    test(`late results cannot populate ${agentId}/${leadId} (keyed=${keyed})`, async (t) => {
      const page = await open(t);
      await page.evaluate((keyed) => window.renderSubject('ava', 'sample-a', keyed), keyed);
      await find(page);
      await page.evaluate(
        ({ keyed, agentId, leadId }) => window.renderSubject(agentId, leadId, keyed),
        { keyed, agentId, leadId }
      );
      await page.evaluate((result) => window.resolveDiscovery(result), {
        ...local,
        composio: catalog,
      });
      await expect(page.getByText('Catalog matched', { exact: true })).toHaveCount(0);
      await page.evaluate((keyed) => window.renderSubject('max', 'sample-b', keyed), keyed);
      assert.equal((await page.evaluate(() => window.invokes)).length, 1);
    });

for (const width of [320, 390])
  test(`research inspector contains metadata and touch controls at ${width}px`, async (t) => {
    const page = await open(t);
    await page.setViewportSize({ width, height: 844 });
    await find(page);
    await page.evaluate((result) => window.resolveDiscovery(result), {
      ...local,
      composio: catalog,
    });
    await page.getByText('Preview public web research', { exact: true }).click();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      targets: [...document.querySelectorAll('summary, button')].map(
        (element) => element.getBoundingClientRect().height
      ),
    }));
    assert.ok(dimensions.content <= dimensions.viewport, JSON.stringify(dimensions));
    assert.ok(
      dimensions.targets.every((height) => height >= 44),
      JSON.stringify(dimensions)
    );
  });

test('an unmounted inspector ignores completed discovery', async (t) => {
  const page = await open(t);
  await find(page);
  await page.evaluate(() => window.unmountSubject());
  await page.evaluate((result) => window.resolveDiscovery(result), { ...local, composio: catalog });
  await expect(page.locator('#root')).toBeEmpty();
});

test('inspection provides local time, timezone and exact original timestamp without a refresh', async (t) => {
  const page = await open(t, { locale: 'en-US', timezoneId: 'America/Los_Angeles' });
  await find(page);
  await expect(page.locator('.pbk-agent-research-body')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate((result) => window.resolveDiscovery(result), { ...local, composio: catalog });
  await expect(page.locator('.pbk-agent-research-body')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('time')).toHaveAttribute('datetime', catalog.checkedAt);
  await expect(page.locator('time')).toHaveAttribute('title', catalog.checkedAt);
  await expect(page.locator('time')).toContainText('Nov 19, 2026');
  await expect(page.locator('time')).toContainText('4:00 AM PST');
  await expect(page.locator('.pbk-agent-research-state')).toHaveAttribute('data-tone', 'matched');
  await expect(page.getByText('Open the preview to see what the tool can review. Start a research request in Brain.', { exact: true })).toBeVisible();
  assert.equal((await page.evaluate(() => window.invokes)).length, 1);
});

test('uninspected guidance and each blocked state explain the next step without creating new actions', async (t) => {
  const page = await open(t);
  await page.locator('summary').first().click();
  await expect(page.locator('.pbk-agent-research-state')).toHaveAttribute('data-tone', 'neutral');
  await expect(page.getByText('Choose Find research tools to inspect available options. Nothing runs automatically.', { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.invokes), []);
  const guidance = {
    not_configured: 'An administrator needs to configure research access. Local PBK options remain available below.',
    disabled: 'An administrator needs to enable catalog inspection. Local PBK options remain available below.',
    authorization_failed: 'An administrator needs to review research access before another inspection.',
    rate_limited: 'Wait a moment, then choose Find research tools to try again.',
    timed_out: 'The inspection took too long. Choose Find research tools to try again.',
    unavailable: 'Catalog inspection is temporarily unavailable. Choose Find research tools to try again.',
    not_found: 'The approved research tool version was not found. An administrator needs to review the catalog.',
  };
  let count = 0;
  for (const [status, text] of Object.entries(guidance)) {
    await page.getByRole('button', { name: 'Find research tools', exact: true }).click();
    await page.evaluate((result) => window.resolveDiscovery(result), { ...local, composio: { ...catalog, status, tools: [] } });
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.locator('.pbk-agent-research-state')).toHaveAttribute('data-tone', 'warning');
    assert.equal(await page.getByRole('button').count(), 1);
    assert.equal((await page.evaluate(() => window.invokes)).length, ++count);
  }
});
