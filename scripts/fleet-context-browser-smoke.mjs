import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium, webkit, expect } from '@playwright/test';
import { build } from 'vite';

process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const outDir = resolve('output/context-hub-build');
if (process.env.PBK_CONTEXT_SKIP_BUILD !== '1') {
  console.log('Building isolated static UI assets...');
  await build({ logLevel: 'warn', build: { outDir, emptyOutDir: false } });
}
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (/^\/(?:api(?:\/|$)|state$|health$|status$|events$|invoke$|metrics$)/.test(pathname)) {
      if (pathname === '/api/state/stream/session') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":false}');
      } else if (req.method !== 'GET') {
        res
          .writeHead(405, { 'content-type': 'application/json' })
          .end('{"error":"Read-only sample preview"}');
      } else {
        const fixture = apiFixture(pathname);
        res
          .writeHead(fixture.status, { 'content-type': 'application/json' })
          .end(JSON.stringify(fixture.json));
      }
      return;
    }
    const path = resolve(outDir, '.' + (extname(pathname) ? pathname : '/index.shell.html'));
    if (!path.startsWith(outDir + sep) || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    let body = await readFile(path);
    if (path.endsWith('index.shell.html'))
      body = Buffer.from(
        body
          .toString()
          .split('\n')
          .filter((line) => !line.includes('<link') || !line.includes('https://fonts.google'))
          .join('\n')
          .replace(
            '<head>',
            `<head><script>const fixtureConfig={endpoint:location.origin,apiKey:'fixture-only'};localStorage.setItem('pbk:local:openclaw-config',JSON.stringify(fixtureConfig));window.PBK={openclaw:{getConfig:()=>fixtureConfig}};</script>`
          )
      );
    res.writeHead(200, {
      'content-type': types[extname(path)] || 'application/octet-stream',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'",
      'X-DNS-Prefetch-Control': 'off',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
server.on('upgrade', (_request, socket) => socket.destroy());
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const leads = Array.from({ length: 65 }, (_, index) => ({
  id: `sample-${index}`,
  leadId: `sample-${index}`,
  score: 90,
  seller: { name: `Sample ${index}`, phone: '+12025550142' },
  property: { address: `${index} Fictional Way`, city: 'Example City', state: 'CA', zip: '90210' },
}));
leads[64] = { ...leads[47], id: 'sample-64', leadId: 'sample-64' };
const agents = [
  {
    id: 'ava',
    name: 'Ava',
    role: 'Seller conversations',
    status: 'active',
    capabilities: ['voice'],
  },
  { id: 'rex', name: 'Rex', role: 'Research', status: 'standby', capabilities: ['review'] },
];

function apiFixture(path, mode = 'normal') {
  if (path === '/api/leads' && mode === 'fallback')
    return { status: 503, json: { error: 'Fixture offline' } };
  const roster = mode === 'empty' ? [] : leads;
  const leadId = path.match(/^\/api\/leads\/([^/]+)/)?.[1];
  const fixture = {
    '/api/auth/team/status': { configured: false, authRequired: false },
    '/api/leads': { leads: roster },
    '/api/agents/registry': { source: 'fixture', registry: { agents } },
    '/api/agents/health': { agents: [] },
    '/api/agents/measurement': { measurement: { ready: false, agents: [] } },
    '/api/tooling/status': { agents: [] },
    '/api/agents/snn-status': { workers: [] },
    '/api/qa/audit/latest': { audits: [] },
    '/state': {
      calls: [],
      messages: [],
      approvals: [],
      leadImports: mode === 'fallback' ? leads.slice(0, 3) : roster,
    },
    '/api/conversations': {
      items: [{ id: 'wrong-thread', leadId: 'another-seller', title: 'Wrong seller' }],
    },
    '/api/property-data': {
      cache: { hit: true },
      propertyData: {
        source: 'apify-for-sale',
        data: {
          priceBasis: 'asking_price',
          askingPriceUsd: 1980000,
          listingFacts: { beds: 3, baths: 2, sqft: 2100 },
          sourceLinks: [],
          photoUrls: [],
        },
      },
    },
    '/api/founder/work-queue': {
      items: [
        {
          id: 'queue-item-not-lead-id',
          tag: 'Lead',
          body: 'Sample 47',
          score: 90,
          reason: 'Review sample',
          targetPath: '/leads?lead=sample-47',
        },
      ],
    },
  };
  return {
    status: 200,
    json: {
      ok: true,
      ...(leadId
        ? { lead: roster.find((lead) => lead.id === leadId) }
        : fixture[path] || { items: [], events: [] }),
    },
  };
}

async function verify(engine, width) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const writes = [],
      errors = [];
    const pendingPreviews = [];
    let delayedLead = '';
    let pendingLeadRead;
    let mode = 'normal';
    page.on('pageerror', (error) => errors.push({ message: error.message, stack: error.stack }));
    await page.routeWebSocket('**/*', (socket) => socket.close());
    await page.addInitScript(() => {
      window.PBK = {
        openclaw: { getConfig: () => ({ endpoint: location.origin, apiKey: 'fixture-only' }) },
      };
      localStorage.setItem(
        'pbk:local:openclaw-config',
        JSON.stringify({ endpoint: location.origin, apiKey: 'fixture-only' })
      );
    });
    await page.route('**/*', (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        path = url.pathname;
      if (url.origin !== origin) return route.abort();
      if (
        !/^\/(?:api(?:\/|$)|\.netlify\/functions\/|state$|health$|status$|events$|invoke$|metrics$)/.test(
          path
        )
      )
        return route.continue();
      if (path === '/api/state/stream/session') return route.fulfill({ json: { ok: false } });
      if (path === '/invoke' && request.postDataJSON()?.toolName === 'previewAgentDealContext') {
        pendingPreviews.push({ route, params: request.postDataJSON().params });
        return;
      }
      if (delayedLead && path.startsWith(`/api/leads/${delayedLead}/`)) {
        pendingLeadRead = route;
        return;
      }
      if (request.method() !== 'GET') {
        writes.push(path);
        return route.abort();
      }
      return route.fulfill(apiFixture(path, mode));
    });
    await page.goto(`${origin}/analyzer`);
    const address = page.getByRole('textbox', { name: 'Address', exact: true });
    const beds = page.getByRole('spinbutton', { name: 'Bedrooms' });
    const arv = page.locator('#deal-arv');
    const compA = page.getByRole('spinbutton', { name: 'Comp A sold price' });
    const compB = page.getByRole('spinbutton', { name: 'Comp B sold price' });
    await address.fill('47 Fictional Way, Example City, CA 90210');
    await beds.fill('7');
    await arv.fill('2100000');
    await compA.fill('2200000');
    await compB.fill('2800000');
    await expect(arv).toHaveValue('2500000');
    await page.getByRole('button', { name: 'Look up asking price', exact: true }).click();
    await page.getByRole('button', { name: 'Fill empty fields', exact: true }).click();
    await expect(beds).toHaveValue('7');
    await expect(page.getByRole('spinbutton', { name: 'Bathrooms' })).toHaveValue('2');
    await expect(arv).toHaveValue('2500000');
    await expect(compA).toHaveValue('2200000');
    await expect(compB).toHaveValue('2800000');
    await page.goto(`${origin}/fleet?leadId=sample-47&agent=rex`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const search = page.getByRole('searchbox', { name: 'Search fleet leads', exact: true });
    await expect(search).toBeVisible();
    const picker = page.getByRole('combobox', {
      name: 'Lead for deal context preview',
      exact: true,
    });
    await expect(picker).toHaveValue('sample-47');
    await search.fill('Sample 59');
    await picker.selectOption('sample-59');
    await expect(page).toHaveURL(/leadId=sample-59/);
    await search.fill('Sample 47');
    await picker.selectOption('sample-47');
    const openWorkspace = page.getByRole('link', { name: 'Open lead workspace', exact: true });
    await openWorkspace.scrollIntoViewIfNeeded();
    const fleetScroll = await openWorkspace.evaluate(
      (node) => node.closest('.pbk-shell-content')?.scrollTop ?? scrollY
    );
    assert.ok(fleetScroll > 0, 'Exercise nonzero Fleet scroll restoration');
    await openWorkspace.click();
    await expect(page).toHaveURL(`${origin}/leads/sample-47`);
    await expect(
      page.getByRole('heading', { name: 'Sample 47', level: 1, exact: true })
    ).toBeVisible();
    await expect(page.getByText('Wrong seller', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `output/context-hub-workspace-${engine.name()}-${width}.png` });
    await page.getByRole('button', { name: 'Back to fleet', exact: true }).click();
    await expect(picker).toHaveValue('sample-47');
    await expect(search).toHaveValue('Sample 47');
    await expect(openWorkspace).toBeFocused();
    await expect
      .poll(() =>
        openWorkspace.evaluate((node) => node.closest('.pbk-shell-content')?.scrollTop ?? scrollY)
      )
      .toBe(fleetScroll);
    await expect(page).toHaveURL(/agent=rex/);
    await page.screenshot({ path: `output/context-hub-fleet-${engine.name()}-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(picker).toHaveValue('sample-47');
    await expect(search).toHaveValue('Sample 47');
    await expect(page).toHaveURL(/agent=rex/);
    await search.fill('Fictional');
    await openWorkspace.click();
    await expect(page).toHaveURL(`${origin}/leads/sample-47`);
    await expect(
      page.getByRole('heading', { name: 'Sample 47', level: 1, exact: true })
    ).toBeVisible();
    await page.goBack();
    await expect(picker).toHaveValue('sample-47');
    await expect(search).toHaveValue('Fictional');
    await page.getByRole('button', { name: 'Preview Rex', exact: true }).click();
    await expect.poll(() => pendingPreviews.length).toBe(1);
    await page.getByRole('button', { name: 'Inspect Rex', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Preview Rex', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Inspect Ava', exact: true }).click();
    await page.getByRole('button', { name: 'Preview Ava', exact: true }).click();
    await expect.poll(() => pendingPreviews.length).toBe(2);
    await pendingPreviews[1].route.fulfill({
      json: { ok: true, result: { summary: 'Current preview' } },
    });
    await expect(page.getByText('Current preview', { exact: true })).toBeVisible();
    await pendingPreviews[0].route.fulfill({
      json: { ok: true, result: { summary: 'Stale preview' } },
    });
    await expect(page.getByText('Stale preview', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview Ava', exact: true }).click();
    await expect.poll(() => pendingPreviews.length).toBe(3);
    await search.fill('');
    await picker.selectOption('sample-64');
    await page.getByRole('button', { name: 'Preview Ava', exact: true }).click();
    await expect.poll(() => pendingPreviews.length).toBe(4);
    assert.equal(pendingPreviews[3].params.leadId, 'sample-64');
    await pendingPreviews[3].route.fulfill({
      json: { ok: true, result: { summary: 'Exact seller preview' } },
    });
    await expect(page.getByText('Exact seller preview', { exact: true })).toBeVisible();
    await pendingPreviews[2].route.fulfill({
      json: { ok: true, result: { summary: 'Other seller preview' } },
    });
    await expect(page.getByText('Other seller preview', { exact: true })).toHaveCount(0);
    await page.goto(`${origin}/leads/sample-47`);
    await expect(
      page.getByRole('heading', { name: 'Sample 47', level: 1, exact: true })
    ).toBeVisible();
    delayedLead = 'sample-48';
    await page.evaluate(() => {
      history.pushState({}, '', '/leads/sample-48');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect.poll(() => Boolean(pendingLeadRead)).toBe(true);
    await expect(page.getByRole('button', { name: 'Inspect agent', exact: true })).toBeDisabled();
    delayedLead = '';
    await pendingLeadRead.fulfill(apiFixture('/api/leads/sample-48'));
    await expect(
      page.getByRole('heading', { name: 'Sample 48', level: 1, exact: true })
    ).toBeVisible();
    await page.goto(`${origin}/leads/sample-47`);
    await expect(
      page.getByRole('heading', { name: 'Sample 47', level: 1, exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Inspect agent', exact: true }).click();
    await expect(picker).toHaveValue('sample-47');
    await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Back to leads', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inspect agent', exact: true })).toHaveJSProperty(
      'tabIndex',
      0
    );
    await page.goto(`${origin}/command-center`);
    const todayItem = page.locator('[data-today-queue-id="queue-item-not-lead-id"]');
    await todayItem.click();
    await expect(page.getByRole('heading', { name: 'Sample 47', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Inspect agent', exact: true }).click();
    await expect(picker).toHaveValue('sample-47');
    await openWorkspace.click();
    await page.getByRole('button', { name: 'Back to fleet', exact: true }).click();
    await page.getByRole('button', { name: 'Back to today', exact: true }).click();
    await expect(todayItem).toBeFocused();
    await page.goto(`${origin}/leads`);
    const rosterSearch = page.getByRole('searchbox', { name: /Search leads/ });
    await rosterSearch.fill('Sample');
    await page.getByRole('button', { name: 'Hot 80+', exact: true }).click();
    await page.getByRole('button', { name: 'Next leads page', exact: true }).click();
    const queueLead = page
      .getByRole('button', { name: /^Open lead Sample 12 at / })
      .filter({ visible: true });
    await queueLead.click();
    const queueUrl = page.url();
    await page.getByRole('button', { name: 'Open lead', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect agent', exact: true }).click();
    await expect(picker).toHaveValue('sample-12');
    await openWorkspace.click();
    await page.getByRole('button', { name: 'Back to fleet', exact: true }).click();
    await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
    await expect(page).toHaveURL(queueUrl);
    await expect(rosterSearch).toHaveValue('Sample');
    await expect(page.getByRole('button', { name: 'Hot 80+', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByText('Page 2 of 7', { exact: false })).toBeVisible();
    await expect(queueLead).toBeFocused();
    await expect(queueLead).toBeInViewport();
    await queueLead.click();
    await page.getByRole('button', { name: 'Open lead', exact: true }).click();
    await page.goBack();
    await expect(rosterSearch).toHaveValue('Sample');
    await page.goto(`${origin}/fleet`);
    await expect(picker).toHaveValue('sample-0');
    await search.fill('Fictional');
    await openWorkspace.click();
    await expect(page).toHaveURL(`${origin}/leads/sample-0`);
    await page.goBack();
    await expect(page).toHaveURL(/leadId=sample-0/);
    await expect(search).toHaveValue('Fictional');
    await page.goto(`${origin}/fleet?leadId=sample-64&agent=rex`);
    await expect(picker).toHaveValue('sample-64');
    await openWorkspace.click();
    await expect(page).toHaveURL(`${origin}/leads/sample-64`);
    await expect(
      page.getByRole('heading', { name: 'Sample 47', level: 1, exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Workspace lead context' }).getByText('sample-64')
    ).toBeVisible();
    await page.evaluate(() =>
      history.replaceState(
        {
          ...history.state,
          usr: {
            fleetReturn: {
              leadId: 'sample-47',
              agentId: 'rex',
              query: '',
              scrollY: 0,
              workspaceEntry: true,
              restoreFocus: true,
              leadReturn: null,
            },
          },
        },
        ''
      )
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Back to leads', exact: true })).toBeVisible();
    for (const id of ['missing-seller', '', 'sample-47&leadId=sample-48']) {
      await page.goto(`${origin}/fleet?leadId=${id}&agent=ava`);
      await expect(page.getByRole('button', { name: 'Preview Ava', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Request call', exact: true })).toBeDisabled();
      await expect(openWorkspace).toHaveCount(0);
    }
    await page.goto(`${origin}/fleet?leadId=sample-47&agent=not-real`);
    await expect(page.getByText('Agent unavailable', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request call', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Inspect Rex', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Preview Rex', exact: true })).toBeEnabled();
    mode = 'fallback';
    await page.goto(`${origin}/fleet?leadId=sample-47&agent=ava`);
    await expect(
      page.getByText('Snapshot fallback (incomplete)', { exact: false }).first()
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview Ava', exact: true })).toBeDisabled();
    mode = 'normal';
    await page.getByRole('button', { name: 'Retry lead roster', exact: true }).click();
    await expect(picker).toHaveValue('sample-47');
    await search.fill('Sample 47');
    mode = 'fallback';
    await page.getByRole('button', { name: 'Refresh lead roster', exact: true }).click();
    await expect(page.getByText('Saved full roster (refresh unavailable)', { exact: false }).first()).toBeVisible();
    await expect(picker).toHaveValue('sample-47');
    await expect(search).toHaveValue('Sample 47');
    await expect(page.getByRole('button', { name: 'Retry lead roster', exact: true })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Fleet lead context' })).toContainText('65 loaded');
    mode = 'empty';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(picker).toHaveValue('');
    mode = 'normal';
    await page.goto(`${origin}/analyzer`);
    await expect(address).toHaveValue('47 Fictional Way, Example City, CA 90210');
    await expect(beds).toHaveValue('7');
    await expect(arv).toHaveValue('2500000');
    await expect(compA).toHaveValue('2200000');
    await expect(compB).toHaveValue('2800000');
    assert.deepEqual(writes, [], 'Navigation must never write business data');
    assert.deepEqual(errors, []);
    console.log(
      `${engine.name()} ${width}px: full roster, exact context, returns/focus, unknown IDs and zero writes passed`
    );
  } finally {
    await browser.close();
  }
}
if (process.env.PBK_CONTEXT_PREVIEW === '1') {
  console.log(`Read-only synthetic preview: ${origin}/fleet?leadId=sample-47&agent=rex`);
} else {
  try {
    const response = await fetch(origin);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(response.headers.get('x-dns-prefetch-control'), 'off');
    for (const path of ['/api/leads', '/invoke', '/api/messages']) {
      const write = await fetch(origin + path, { method: 'POST', body: '{}' });
      assert.equal(write.status, 405, 'Sample server must reject all business writes');
    }
    await verify(chromium, 1440);
    await verify(webkit, 390);
    await verify(chromium, 320);
  } finally {
    await new Promise((done) => server.close(done));
  }
}
