import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { parseBatchFile } from '../src/app/utils/batchReview.ts';
import { fixtureWorkspace, openBatchReviewFixtureStore } from './batch-review-local-fixture-store.mjs';
import { dispatchTelnyxWithBatchPhoneGuard, registerBatchPhonePlan } from './batch-phone-dispatch.mjs';

const serveFixtures = process.argv.includes('--serve-fixtures');
// Even an unhandled Vite proxy route must never target a production bridge.
process.env.PBK_DEV_BRIDGE_URL = 'http://127.0.0.1:1';
const batch = {
  name: 'test-batch.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(
    [
      'Lead ID,Property Address,Owner Name,Asking Price,Phone 1,Phone 1 DNC,Phone 2,Phone 2 DNC,Lot Size Square Feet',
      'lead-1,10 Fixture St,Incoming Owner,220000,2025550101,No,2025550102,Yes,',
      'lead-2,20 Fixture St,Other Owner,,2025550102,Yes,,,5000',
      ',30 Fixture St,New Owner,180000,2025550103,No,2025550104,Yes,',
      ',,Missing Address,170000,,,,,',
      ',40 Fixture St,New Owner,,+1 202-555-0103,No,,,',
      ...Array.from({ length: 11 }, (_, i) => `,${41 + i} Fixture St,New Owner,,,,,,`),
    ].join('\n')
  ),
};
const roster = [
  { id: 'lead-1', address: '10 Fixture St', seller: { name: 'Saved Owner' }, askingPrice: 200000 },
  { id: 'lead-2', address: '20 Fixture St', seller: { name: 'Other Owner' }, beds: 0,
    phones: [{ slot: 2, number: '2025550102', dnc: 'dnc', type: 'Mobile' }] },
];

function localFixtureMiddleware(store) {
  const sampleCsv = batch.buffer.toString('utf8');
  const sampleRows = parseBatchFile(batch.name, sampleCsv);

  return {
    name: 'pbk-batch-review-fixtures',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        response.setHeader('Content-Security-Policy', "connect-src 'self'");
        response.setHeader('Cache-Control', 'no-store');
        const path = new URL(request.url, 'http://localhost').pathname;
        if (request.method === 'GET' && path === '/batch-review-fixture.csv') {
          response.setHeader('Content-Type', 'text/csv; charset=utf-8');
          response.setHeader('Content-Disposition', 'attachment; filename="test-batch.csv"');
          return response.end(batch.buffer);
        }
        if (!/^\/(?:api(?:\/|$)|state$|status$|health$|events$|invoke$|metrics$)/.test(path))
          return next();
        response.setHeader('Content-Type', 'application/json');
        const send = (status, body) => {
          response.statusCode = status;
          return response.end(JSON.stringify(body));
        };
        if (path === '/api/leads/batch-review-sample-apply' && request.method === 'POST') {
          if (
            !/^127\.0\.0\.1:\d+$/.test(request.headers.host || '') ||
            request.headers.origin !== `http://${request.headers.host}` ||
            request.headers['content-type'] !== 'application/json'
          ) return send(403, { ok: false, error: 'Only this local sample preview can apply rows.' });
          let input;
          try {
            const chunks = [];
            let size = 0;
            for await (const chunk of request) {
              size += chunk.length;
              if (size > 4096) return send(413, { ok: false, error: 'Sample request is too large.' });
              chunks.push(chunk);
            }
            input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            return send(400, { ok: false, error: 'Invalid sample request.' });
          }
          if (
            input?.confirmed !== true || !Array.isArray(input.reviewedRows) ||
            input.reviewedRows.length === 0 || input.reviewedRows.length > sampleRows.length ||
            !input.reviewedRows.every((row) => Number.isInteger(row) && row > 0 && row <= sampleRows.length) ||
            Object.keys(input).some((key) => !['confirmed', 'reviewedRows', 'revision'].includes(key))
          ) return send(400, { ok: false, error: 'Confirm reviewed rows from the provided sample.' });
          try {
            const result = await store.apply(sampleRows, input.reviewedRows, input.revision);
            if (result.stale) {
              return send(409, { ok: false, error: 'The sample roster changed. Review the file again.' });
            }
            if (result.empty) return send(400, { ok: false, error: 'No eligible sample rows were confirmed.' });
            return send(200, { ok: true, ...result });
          } catch {
            return send(503, { ok: false, error: 'Could not register the sample phone plan. No rows were applied.' });
          }
        }
        if (request.method !== 'GET') {
          return send(405, { ok: false });
        }
        try {
          const { leads, revision } = await store.read();
          return send(200, {
            ok: true, complete: true, leads, leadImports: leads, approvals: [],
            ...(path === '/api/leads/batch-review-roster' ? { sampleApply: { sampleCsv, revision } } : {}),
          });
        } catch {
          return send(503, { ok: false, complete: false });
        }
      });
    },
  };
}

const devDirectory = '.pbk-local/batch-review-sample-postgres';
const devStore = serveFixtures
  ? await mkdir('.pbk-local', { recursive: true }).then(() => openBatchReviewFixtureStore(devDirectory, roster))
  : null;
const server = await createServer({
  plugins: devStore ? [localFixtureMiddleware(devStore)] : [],
  server: { host: '127.0.0.1', port: serveFixtures ? 5190 : 0, strictPort: true, hmr: false },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;

async function verify(engine, options, label) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...options, serviceWorkers: 'block' });
    let rosterAvailable = true;
    let rosterReads = 0;
    const writes = [];
    await page.routeWebSocket('**/*', (socket) => socket.close());
    await page.route('**/*', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (url.origin !== origin) return route.abort();
      if (path === '/api/state/stream/session') return route.fulfill({ status: 503, json: {} });
      if (request.method() !== 'GET') {
        writes.push(path);
        return route.fulfill({ status: 405, json: {} });
      }
      if (path === '/api/leads/batch-review-roster') {
        rosterReads++;
        return route.fulfill({
          json: {
            ok: true,
            complete: rosterAvailable,
            leads: rosterAvailable ? roster : [roster[0]],
          },
        });
      }
      if (path === '/api/leads') return route.fulfill({ json: { ok: true, leads: [roster[0]] } });
      if (/^\/(?:api\/|state$|health$|events$|invoke$)/.test(path)) {
        return route.fulfill({ json: { ok: true, leadImports: roster, approvals: [] } });
      }
      return route.continue();
    });

    await page.goto(`${origin}/leads`);
    await page.getByRole('link', { name: 'Batch review' }).click();
    await expect(page.getByRole('heading', { name: 'Batch review' })).toBeVisible();
    const file = page.getByLabel('Batch file');
    await file.setInputFiles(batch);
    const readBefore = rosterReads;
    await page.getByRole('button', { name: 'Review batch' }).click();
    const status = (name) => page.getByRole('button', { name });
    await expect(status('New 13')).toBeVisible();
    await expect(status('Matches 1')).toBeVisible();
    await expect(status('Conflicts 1')).toBeVisible();
    await expect(status('Invalid 1')).toBeVisible();
    await expect(page.getByText('2 saved leads compared')).toBeVisible();
    assert.equal(rosterReads - readBefore, 1);
    const shared = page.getByLabel('Shared phones (2, 1 DNC)');
    await shared.check();
    await expect(page.getByRole('region', { name: 'Batch rows' }).getByRole('listitem')).toHaveCount(4);
    await expect(page.getByText('DNC: blocked on all rows')).toBeVisible();
    await page.getByRole('button', { name: /40 Fixture St/ }).click();
    await expect(page.getByText('One contact slot: row 3')).toBeVisible();
    await shared.uncheck();
    await status('Conflicts 1').click();
    await expect(page.getByRole('columnheader', { name: 'Saved' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Incoming' })).toBeVisible();
    const owner = page.getByRole('row').filter({ hasText: 'Owner name' });
    await expect(page.getByRole('row', { name: /Phone 1/ })).toContainText(/2025550101\s+DNC: No/);
    await expect(page.getByRole('row', { name: /Phone 2/ })).toContainText(/2025550102\s+DNC: Yes/);
    await expect(owner).toContainText('Saved Owner');
    await expect(owner).toContainText('Incoming Owner');
    await expect(owner).toContainText('Keep saved');
    await page.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(page.getByText('1 of 16 reviewed')).toBeVisible();
    await page.getByLabel('Unreviewed only').check();
    await expect(page.getByText('No rows in this view.')).toBeVisible();
    await page.getByLabel('Unreviewed only').uncheck();
    await status('Invalid 1').click();
    await expect(page.getByText('A property address or PBK lead ID is required.')).toBeVisible();
    await status('New 13').click();
    await page.getByRole('button', { name: 'Next rows page' }).click();
    await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /49 Fixture St/ })).toBeVisible();
    if (process.env.PBK_BATCH_SCREENSHOTS === '1') {
      await status('Conflicts 1').click();
      if (label === 'mobile')
        await page
          .getByRole('table', { name: 'Saved and incoming values' })
          .scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.pbk-local/batch-review-${label}.png` });
    }
    const overflowing = await page
      .locator('.pbk-batch-review')
      .evaluate((element) => element.scrollWidth > element.clientWidth + 2);
    assert.equal(overflowing, false);
    await page.getByRole('button', { name: 'Clear batch' }).click();
    await expect(status('New 13')).toHaveCount(0);
    rosterAvailable = false;
    await file.setInputFiles(batch);
    await page.getByRole('button', { name: 'Review batch' }).click();
    await expect(page.getByRole('alert')).toContainText('saved lead roster');
    await expect(status('New 13')).toHaveCount(0);
    assert.deepEqual(writes, []);
    console.log(`Batch review: ${label} passed; no write requests`);
  } finally {
    await browser.close();
  }
}

async function verifySampleApply(engine, options, label) {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'pbk-batch-review-'));
  let store = await openBatchReviewFixtureStore(directory, roster);
  const fixtureServer = await createServer({
    plugins: [localFixtureMiddleware(store)],
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  let browser;
  let closed = false;
  const enrollment = async () => (await store.pool.query(
    `SELECT phone, lead_id, disposition, channel FROM public.pbk_batch_phone_contacts
     WHERE workspace_id = $1 AND batch_id IS NOT NULL ORDER BY phone`, [fixtureWorkspace]
  )).rows;
  try {
    await fixtureServer.listen();
    const local = `http://127.0.0.1:${fixtureServer.httpServer.address().port}`;
    browser = await engine.launch();
    const page = await browser.newPage({ ...options, serviceWorkers: 'block' });
    const applyPath = '/api/leads/batch-review-sample-apply';
    const rosterPath = '/api/leads/batch-review-roster';
    const writeRequests = [];
    await page.routeWebSocket('**/*', (socket) => socket.close());
    await page.route('**/*', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== local) return route.abort();
      if (url.pathname === '/api/state/stream/session') return route.fulfill({ status: 503, json: {} });
      if (request.method() === 'GET') return route.continue();
      writeRequests.push(url.pathname);
      return url.pathname === applyPath ? route.continue() : route.abort();
    });
    const snapshot = async () => (await page.request.get(local + rosterPath)).json();
    const before = await snapshot();
    assert.deepEqual(await enrollment(), []);
    const submit = (data) => page.request.post(local + applyPath, { data, headers: { Origin: local } });
    const withoutConfirmation = await submit({ revision: before.sampleApply.revision, reviewedRows: [2] });
    assert.equal(withoutConfirmation.status(), 400);
    const withPayload = await submit({ revision: before.sampleApply.revision, reviewedRows: [2], confirmed: true, csv: 'unsupported' });
    assert.equal(withPayload.status(), 400);

    await page.goto(local + '/leads/batch-review');
    const file = page.getByLabel('Batch file');
    const review = page.getByRole('button', { name: 'Review batch', exact: true });
    await file.setInputFiles({ ...batch, buffer: Buffer.from('Property Address\n99 Another Sample St') });
    await review.click();
    await expect(page.getByRole('button', { name: 'New 1', exact: true })).toBeVisible();
    const apply = page.getByRole('button', { name: 'Apply reviewed sample rows' });
    await expect(apply).toHaveCount(0);
    await file.setInputFiles(batch);
    await review.click();
    await expect(apply).toBeDisabled();
    for (const category of ['Matches 1', 'New 13', 'Conflicts 1', 'Invalid 1']) {
      await page.getByRole('button', { name: category, exact: true }).click();
      await page.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
    }
    await apply.click();
    const dialog = page.getByRole('dialog', { name: 'Confirm sample apply' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    assert.deepEqual((await snapshot()).leads, before.leads);
    assert.deepEqual(writeRequests, []);
    assert.deepEqual(await enrollment(), []);

    if (label === 'desktop') {
      await registerBatchPhonePlan(store.pool, {
        workspace: fixtureWorkspace, batchId: 'test-overlap',
        entries: [{ phone: '2025550104', status: 'dnc' }],
      });
      const conflictingPlan = await enrollment();
      await apply.click();
      await dialog.getByRole('button', { name: 'Confirm apply' }).click();
      await expect(page.getByRole('alert')).toContainText('No rows were applied.');
      assert.deepEqual(await enrollment(), conflictingPlan);
      assert.deepEqual(await snapshot(), before);
      await store.pool.query(
        'DELETE FROM public.pbk_batch_phone_contacts WHERE workspace_id = $1 AND batch_id = $2',
        [fixtureWorkspace, 'test-overlap']
      );
    }

    await apply.click();
    if (process.env.PBK_BATCH_SCREENSHOTS === '1') {
      await page.screenshot({ path: `.pbk-local/batch-apply-${label}.png` });
    }
    await dialog.getByRole('button', { name: 'Confirm apply' }).click();
    const receipt = page.getByRole('status', { name: 'Sample apply result' });
    await expect(receipt).toContainText('1 created · 1 updated · 0 unchanged');
    await expect(receipt).toContainText('3 phone numbers registered');
    await expect(receipt).toContainText('1 conflicts · 1 invalid · 12 unreviewed skipped');
    await expect(apply).toBeDisabled();
    assert.deepEqual(writeRequests, label === 'desktop' ? [applyPath, applyPath] : [applyPath]);
    const after = await snapshot();
    assert.equal(after.leads.length, 3);
    assert.deepEqual(after.leads[0], before.leads[0]);
    assert.deepEqual(after.leads[1], { ...before.leads[1], lotSqft: '5000' });
    assert.deepEqual(after.leads[2].phones.map(({ number, dnc }) => [number, dnc]), [
      ['2025550103', 'not-dnc'], ['2025550104', 'dnc'],
    ]);
    assert.deepEqual(await enrollment(), [
      { phone: '+12025550102', lead_id: null, disposition: 'dnc', channel: null },
      { phone: '+12025550103', lead_id: after.leads[2].id, disposition: 'candidate', channel: null },
      { phone: '+12025550104', lead_id: null, disposition: 'dnc', channel: null },
    ]);
    const replay = await submit({ revision: before.sampleApply.revision, reviewedRows: [2, 3], confirmed: true });
    assert.equal(replay.status(), 409);
    assert.deepEqual((await snapshot()).leads, after.leads);
    let providerAttempts = 0;
    const tryDispatch = async (endpoint, to, leadId = after.leads[2].id) => {
      const response = await dispatchTelnyxWithBatchPhoneGuard({
        pool: store.pool, workspace: fixtureWorkspace, method: 'POST', endpoint, payload: { to },
        leadId, isLocallyDnc: () => false,
        dispatch: () => { providerAttempts++; return Response.json({ stub: true }); },
      });
      return (await response.json()).batchPhoneGuard ?? 'stub-reached';
    };
    assert.equal(await tryDispatch('/messages', '+12025550104'), 'dnc');
    assert.equal(await tryDispatch('/calls', '+12025550103', 'sample-batch-5'), 'wrong-lead');
    assert.deepEqual((await Promise.all([
      tryDispatch('/calls', '+12025550103'), tryDispatch('/messages', '(202) 555-0103'),
    ])).sort(), ['already-reserved', 'stub-reached']);
    assert.equal(providerAttempts, 1);
    await browser.close();
    browser = null;
    await fixtureServer.close();
    closed = true;
    await store.close();
    store = await openBatchReviewFixtureStore(directory, roster);
    assert.deepEqual((await store.read()).leads, after.leads);
    assert.equal(await tryDispatch('/messages', '+12025550103'), 'already-reserved');
    assert.equal(providerAttempts, 1);
    console.log(`Sample apply: ${label} passed; durable registration, atomic apply, DNC and stub dispatch`);
  } finally {
    await browser?.close();
    if (!closed) await fixtureServer.close();
    await store.close();
    if (dirname(directory) === tempRoot && basename(directory).startsWith('pbk-batch-review-')) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

if (serveFixtures) {
  console.log(`Batch review (synthetic roster only): ${origin}/leads/batch-review`);
  console.log(`Sample CSV: ${origin}/batch-review-fixture.csv`);
} else {
  try {
    await verify(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop');
    await verify(webkit, devices['iPhone 13'], 'mobile');
    await verifySampleApply(chromium, { viewport: { width: 1440, height: 900 } }, 'desktop');
    await verifySampleApply(webkit, devices['iPhone 13'], 'mobile');
  } finally {
    await server.close();
  }
}
