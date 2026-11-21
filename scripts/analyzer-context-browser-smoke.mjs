import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';

// Hosted runs exercise the deployed assets while keeping deal data and providers isolated.
const hostedRevision = process.env.PBK_ANALYZER_HOSTED_REVISION;
const hosted = Boolean(hostedRevision);
process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const server = hosted ? null : await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server?.listen();
const origin = hosted ? 'https://pbk-openclaw-bridge.onrender.com'
  : 'http://127.0.0.1:' + server.httpServer.address().port;
let teamSession;
if (hosted) {
  assert.match(hostedRevision, /^[0-9a-f]{40}$/);
  const passcode = process.env.PBK_MOBILE_PROOF_TEAM_PASSCODE || process.env.PBK_TEAM_PASSCODE;
  assert.ok(passcode, 'Hosted Analyzer proof requires the existing PBK team passcode.');
  const login = await fetch(origin + '/api/auth/team', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode, actor: 'PBK Analyzer read-only release proof' }),
  });
  assert.ok(login.ok, 'Hosted PBK team sign-in failed.');
  teamSession = await login.json();
  assert.ok(teamSession.ok && teamSession.token && teamSession.expiresAt, 'Hosted PBK session was not issued.');
  const status = await fetch(origin + '/api/release/status', {
    redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { 'X-PBK-Team-Token': teamSession.token },
  });
  assert.ok(status.ok, 'Hosted release status is unavailable.');
  const { release } = await status.json();
  assert.equal(release?.commit, hostedRevision.slice(0, 12), 'Hosted bridge is not yet on the requested release.');
}
const leadId = 'qa-analyzer-context';
const threadId = 'qa-context-thread';
const address = '42 Fixture Avenue, Example City, CA 90210';
const nextAddress = '43 Fixture Avenue, Example City, CA 90210';
const retrievedAt = '2026-11-09T12:00:00Z';
const storageHost = hosted ? 'pbk-openclaw-bridge-onrender-com' : 'local';
const storageKey = `pbk:${storageHost}:analyzer:current-deal:session`;
const event = {
  id: 'qa-event', threadId, leadId, eventType: 'message', channel: 'sms',
  direction: 'inbound', body: 'Please check back Friday.',
  occurredAt: '2026-11-09T12:00:00Z',
};
const photos = ['front', 'yard', 'living', 'kitchen', 'bedroom', 'garage']
  .map((name) => 'https://ap.rdcpix.com/qa-context-' + name + '.jpg');
const wide = { width: 1440, height: 960 };

async function verify(engine, compact, device = {}) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...device, viewport: compact ? { width: 390, height: 844 } : wide });
    const reads = [];
    const writes = [];
    const refreshes = [];
    let exact = true;
    await page.addInitScript(({ allowedOrigin, key, payload, session }) => {
      if (location.origin !== allowedOrigin) return;
      if (session) localStorage.setItem('pbk:team-session:v1', JSON.stringify(session));
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, JSON.stringify(payload));
        if (!localStorage.getItem(key.replace(/:session$/, ''))) {
          localStorage.setItem(key.replace(/:session$/, ''), JSON.stringify(payload));
        }
      }
    }, { allowedOrigin: origin, key: storageKey, session: teamSession,
      payload: { leadId, address, type: 'house', arv: 2100000, price: 1900000, baths: 3, sqft: 2100, year: 1995, dom: 12 } });
    await page.routeWebSocket('**/*', (socket) => socket.close());
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.hostname === 'ap.rdcpix.com') {
        return route.fulfill({ contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#476a6f"/></svg>' });
      }
      if (url.origin !== origin) return route.abort();
      const api = /^\/(api\/|\.netlify\/functions\/|state$|health$|events$|invoke$)/.test(url.pathname);
      if (!api) return route.continue();
      if (hosted && url.pathname === '/api/auth/team/verify' && req.method() === 'POST') return route.continue();
      // The existing shell negotiates a read-only stream session on mount.
      if (url.pathname === '/api/state/stream/session') return route.fulfill({ json: { ok: false } });
      if (url.pathname === '/api/property-data/address-suggestions' && req.method() === 'POST') {
        return route.fulfill({ json: { status: 'unavailable', suggestions: [] } });
      }
      if (url.pathname === '/api/property-data/enrich' && req.method() === 'POST') {
        const body = req.postDataJSON();
        refreshes.push(body);
        const matches = body.address === address;
        const listingFacts = { beds: 3, baths: 2, sqft: 9138, year: 1989, dom: 38, lotSqft: 46129 };
        const listing = matches ? {
          cache: { hit: true },
          propertyData: { source: 'apify-for-sale', data: { askingPriceUsd: 1980000, priceBasis: 'asking_price', listingFacts, photoUrls: photos } },
        } : { cache: { hit: false } };
        const deal = matches ? { listingSnapshot: {
          source: 'apify-for-sale', address, retrievedAt, askingPrice: 1980000, photoUrls: photos, sourceLinks: [], facts: listingFacts,
        } } : {};
        return route.fulfill({ json: {
          ok: true, address: body.address, listing, records: { status: 'no_match' }, sales: { status: 'unavailable' },
          patch: { deal }, saved: matches, ...(matches ? { leadId } : {}),
        } });
      }
      if (req.method() !== 'GET') {
        writes.push([req.method(), url.pathname]);
        return route.abort();
      }
      if (url.pathname === '/api/property-data') {
        reads.push(url.pathname);
        return route.abort();
      }
      if (url.pathname === '/api/conversations') {
        reads.push(url.pathname + url.search);
        assert.equal(url.searchParams.get('leadId'), leadId);
        const wrong = { id: 'wrong-thread', leadId: 'wrong-lead', title: 'Other seller' };
        return route.fulfill({ json: { ok: true, items: exact ? [wrong, { id: threadId, leadId }] : [wrong] } });
      }
      if (url.pathname.includes('/timeline')) {
        reads.push(url.pathname);
        return route.fulfill({ json: { ok: true, items: [
          { ...event, id: 'wrong-event', leadId: 'wrong-lead', body: 'Wrong seller event' },
          { ...event, id: 'wrong-thread-event', threadId: 'wrong-thread', body: 'Wrong thread event' },
          event,
        ] } });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto(origin + '/analyzer');
    const workbench = page.getByRole('region', { name: 'Comparable Sales (Mean = ARV)' });
    const listPrice = page.getByRole('spinbutton', { name: 'List price in dollars' });
    const panel = page.getByRole('complementary', { name: 'Deal context' });
    const toggle = page.getByRole('button', { name: 'Context', exact: true });
    const form = page.getByRole('button', { name: 'Valuation', exact: true });
    const beds = page.getByRole('spinbutton', { name: 'Bedrooms' });
    const arv = page.locator('#deal-arv');
    const comp = page.getByRole('spinbutton', { name: 'Comp A sold price' });
    const addressInput = page.getByRole('combobox', { name: 'Address', exact: true });
    const refresh = page.getByRole('button', { name: 'Refresh property intelligence', exact: true });
    await expect(addressInput).toHaveValue(address, { timeout: 20_000 });
    await expect(arv).toHaveValue('2100000');
    await beds.fill('4');
    const facts = ['Bathrooms', 'Square footage', 'Year built', 'Days on market']
      .map(name => page.getByRole('spinbutton', { name, exact: true }));
    const factsBefore = await Promise.all(facts.map(field => field.inputValue()));
    const priceBefore = await listPrice.inputValue();
    assert.deepEqual(refreshes, [], 'Opening the saved deal must not refresh evidence');
    await refresh.click();
    await expect(page.getByText('Listing asking price', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fill empty fields' })).toBeDisabled();
    assert.deepEqual(refreshes, [{
      address, leadId, expectedPropertyAddress: { street: '42 Fixture Avenue', city: 'Example City', state: 'CA', zip: '90210' },
    }], 'One click refreshes the linked property exactly once');
    await expect(listPrice).toHaveValue(priceBefore);
    for (let i = 0; i < facts.length; i++) await expect(facts[i]).toHaveValue(factsBefore[i]);
    await expect(beds).toHaveValue('4');
    await expect(arv).toHaveValue('2100000');
    await expect(comp).toHaveValue('');
    await comp.fill('2200000');
    await expect(arv).toHaveValue('2200000');

    if (compact) {
      await expect(panel).toBeHidden();
      const scroll = page.locator('.pbk-deal-content');
      await toggle.focus();
      await scroll.evaluate(node => { node.scrollTop = Math.min(300, node.scrollHeight - node.clientHeight); });
      const oldTop = await scroll.evaluate((node) => node.scrollTop);
      assert.ok(oldTop > 0, 'Fixture should begin scrolled into valuation');
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      await expect(toggle).toBeFocused();
      await expect(workbench).toBeHidden();
      await expect(page.getByText(event.body)).toBeVisible();
      await form.click();
      await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(oldTop);
      await toggle.click();
    } else {
      await expect(workbench).toBeVisible();
      await expect(toggle).toBeHidden();
      await expect(panel).toBeVisible();
      assert.ok((await panel.boundingBox()).x > (await workbench.boundingBox()).x, 'Desktop context belongs beside valuation');
      const workflow = page.getByRole('button', { name: 'Workflow', exact: true });
      await workflow.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Close panel', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(workflow).toBeFocused();
      await expect(panel).toBeVisible();
    }

    await expect(page.getByText(event.body)).toBeVisible();
    await expect(page.getByText('Wrong seller event')).toHaveCount(0);
    await expect(page.getByText('Wrong thread event')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', '/inbox/conversations?lead=' + leadId);
    const photo = page.getByRole('img', { name: 'Listing photo 1', exact: true });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(panel.getByRole('button', { name: /^View photo / })).toHaveCount(6);
    for (let i = 2; i <= photos.length; i += 1) {
      await page.getByRole('button', { name: 'View photo ' + i, exact: true }).click();
      const image = page.getByRole('img', { name: 'Listing photo ' + i, exact: true });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
    }
    if (process.env.PBK_CONTEXT_SCREENSHOTS === '1') {
      if (compact) await page.locator('.pbk-deal-content').evaluate((node) => { node.scrollTop = 0; });
      await page.screenshot({ path: '.pbk-local/analyzer-context-' + (compact ? 'mobile' : 'desktop') + '.png' });
    }
    if (compact) await form.click();
    await expect(beds).toHaveValue('4');
    await expect(comp).toHaveValue('2200000');
    await expect(arv).toHaveValue('2200000');

    exact = false;
    const priorTimelines = reads.filter((url) => url.includes('/timeline')).length;
    const readDraftEnvelopes = () => page.evaluate((key) => {
      const decode = (raw) => JSON.parse(decodeURIComponent(escape(atob(raw))));
      return {
        persistent: decode(localStorage.getItem(key.replace(/:session$/, ''))),
        session: decode(sessionStorage.getItem(key)),
      };
    }, storageKey);
    const draftsBeforeReload = await readDraftEnvelopes();
    await page.reload();
    await expect(addressInput).toHaveValue(address, { timeout: 20_000 });
    await expect(beds).toHaveValue('4');
    await expect(comp).toHaveValue('2200000');
    const draftsAfterReload = await readDraftEnvelopes();
    for (const scope of ['persistent', 'session']) {
      assert.deepEqual(draftsAfterReload[scope].payload, draftsBeforeReload[scope].payload,
        `Reload must preserve the ${scope} Analyzer draft payload, independent of envelope timestamps`);
      assert.equal(draftsAfterReload[scope].savedAt, draftsBeforeReload[scope].savedAt,
        'Passive reload must not refresh or publish a restored draft');
    }
    console.log('Analyzer reload preserves draft payloads and envelope timestamps without writes');
    if (compact) await toggle.click();
    await expect(page.getByText('No conversation is linked to this lead.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open conversation' })).toHaveCount(0);
    assert.equal(reads.filter((url) => url.includes('/timeline')).length, priorTimelines);
    assert.equal(reads.some((url) => url.includes('wrong-thread')), false);

    if (compact) await form.click();
    await addressInput.fill('43 Fixture Avenue');
    await expect(refresh).toBeDisabled();
    await expect(page.getByText('Enter the street address, city, state, and ZIP to refresh property intelligence.')).toBeVisible();
    await expect(comp).toHaveValue('');
    assert.equal(refreshes.length, 1, 'Editing the address and reloading are passive');
    await addressInput.fill(nextAddress);
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.getByText(/No current listing asking price/)).toBeVisible();
    assert.deepEqual(refreshes.slice(1), [{ address: nextAddress }], 'A different address refreshes as an unlinked draft');
    if (compact) await toggle.click();
    await expect(panel.getByText('No saved Apify photos for this address.')).toBeVisible();
    await expect(panel.getByRole('img', { name: /^Listing photo / })).toHaveCount(0);
    assert.equal(reads.includes('/api/property-data'), false, 'Refresh uses the unified route only');
    assert.deepEqual(writes, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('Analyzer context: ' + (hosted ? 'hosted ' : 'local ') +
      (compact ? 'mobile WebKit' : 'desktop Chromium') + ' passed');
  } finally {
    await browser.close();
  }
}

try {
  await verify(chromium, false);
  await verify(webkit, true, devices['iPhone 13']);
} finally {
  await server?.close();
}
