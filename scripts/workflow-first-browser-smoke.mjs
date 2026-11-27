import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, expect as playwrightExpect } from '@playwright/test';
import { sampleApproval, sampleLeads } from './fixtures/faster-triage-fixture.mjs';
import { createCommandCenterPreview } from './fixtures/command-center-polish-preview.mjs';
import { sharedAnalyzerMatches } from './operator-session-browseros-live.mjs';

const serving = process.argv.includes('--serve');
const { server, origin } = await createCommandCenterPreview({ port: serving ? 5195 : 0 });
const expect = playwrightExpect.configure({ timeout: 30000 });
const output = 'output/workflow-first';
const initialLeads = structuredClone(sampleLeads);
const composeKey = 'pbk:compose:draft';
const analyzerKey = 'pbk:local:analyzer:current-deal';

async function verify(engine, width) {
  const mobile = width < 720;
  const name = `${engine.name()}-${width}`;
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 },
      isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('pbk:prefs:v1', JSON.stringify({ theme: 'dark', tourCompleted: true })));
    const writes = [], external = [], errors = [];
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      if (request.method() === 'POST' && url.pathname === '/api/state/stream/session') {
        return route.fulfill({ json: { ok: false } });
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        writes.push(request.method() + ' ' + url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const capture = surface => page.screenshot({ path: `${output}/${surface}-${name}.png`, animations: 'disabled' });
    const contained = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal page overflow');
    await page.goto(origin + '/command-center');
    await expect(page.getByRole('heading', { name: 'Today.', exact: true })).toBeVisible();
    const approval = page.locator(`[data-approval-id="${sampleApproval.id}"]`);
    await approval.getByRole('button', { name: 'Review approval', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Approve request', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await capture('approval');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(approval.getByRole('button', { name: 'Review approval', exact: true })).toBeFocused();
    await contained();
    await capture('today');

    const draft = JSON.stringify({ channel: 'sms', recipient: 'invalid-sample-recipient', leadId: '',
      message: 'Unsent sample draft stays intact.', sendLater: false, sendAt: '' });
    await page.evaluate(({ key, draft }) => localStorage.setItem(key, draft), { key: composeKey, draft });
    await page.locator('[data-today-queue-id="sample-queue-0"]').click();
    await expect(page).toHaveURL(/\/leads\/SYN-L-2291$/);
    const actions = page.locator('.pbk-lead-portal-actions');
    await expect(actions.getByRole('button', { name: 'Open conversation', exact: true })).toBeVisible();
    const edit = actions.getByRole('button', { name: 'Edit lead', exact: true });
    assert.ok(await edit.evaluate(button => button.getBoundingClientRect().height >= 44), 'Lead actions have 44px touch targets');
    await edit.click();
    const editor = page.getByRole('dialog', { name: 'Edit complete seller profile', exact: true });
    await editor.getByLabel('Next step', { exact: true }).fill('Unsaved local sample; never apply.');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#lead-next-step')).toContainText(sampleLeads[0].bant.nextStep);
    await contained();
    await capture('lead');

    await page.waitForLoadState('networkidle');
    await page.goto(origin + '/analyzer');
    await expect(page.getByRole('combobox', { name: 'Address', exact: true })).toBeVisible();
    await page.waitForFunction(() => Boolean(window.PBKAnalyzer?.getState));
    const summary = mobile ? page.getByRole('button', { name: 'Open deal summary', exact: true })
      : page.locator('.pbk-analyzer-command-actions').getByRole('button', { name: 'Deal summary', exact: true });
    await expect(summary).toBeVisible();
    if (mobile) await expect(page.getByRole('button', { name: 'Open call prep', exact: true })).toBeVisible();
    const targets = mobile ? page.locator('.pbk-analyzer-mobile-rail-actions button')
      : page.locator('.pbk-analyzer-command-actions button');
    const sizes = await targets.evaluateAll(buttons => buttons.map(button => ({ label: button.textContent.trim(), height: button.getBoundingClientRect().height,
      minHeight: getComputedStyle(button).minHeight, maxHeight: getComputedStyle(button).maxHeight })));
    assert.ok(sizes.every(button => button.height >= 44), 'Analyzer actions have 44px touch targets: ' + JSON.stringify(sizes));
    if (mobile) assert.ok(await targets.locator('span').evaluateAll(labels => labels.every(label => label.scrollWidth <= label.clientWidth + 1)), 'Mobile labels are not ellipsized');
    if (mobile) assert.ok(await targets.locator('span').evaluateAll(labels => labels.filter(label => /^(Summary|Analyze)$/.test(label.textContent.trim())).every(label => {
      const range = document.createRange();
      range.selectNodeContents(label);
      return range.getClientRects().length === 1;
    })), 'Single-word action labels must not split mid-word');
    await page.getByText('Lead details · New lead', { exact: true }).click();
    await expect(page.getByText('Contact details do not grant permission to call, text or email. Existing approval checks still apply.')).toBeVisible();
    const notes = `Manual ${name} sample notes.`;
    await page.evaluate(notes => window.PBKAnalyzer.setState({ deal: {
      address: '11 Workflow Sample Avenue', leadId: '', beds: 4, sqft: 1250, arv: 600000, notes,
      repairs: { condition: 'C3', low: 12000, mid: 15000, high: 18000 },
      comps: { A: { price: 600000 }, B: { price: 0 }, C: { price: 0 } },
    }, manualFields: ['notes', 'repairs', 'comps', 'arv'] }), notes);
    await expect.poll(async () => sharedAnalyzerMatches(await page.evaluate(key => localStorage.getItem(key), analyzerKey))).toBe(true);
    const saved = await page.evaluate(key => localStorage.getItem(key), analyzerKey);
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.PBKAnalyzer?.getState));
    await expect.poll(() => page.evaluate(() => window.PBKAnalyzer.getState().deal.notes)).toBe(notes);
    assert.deepEqual(await page.evaluate(() => {
      const deal = window.PBKAnalyzer.getState().deal;
      return { comp: deal.comps.A.price, repairs: deal.repairs.mid, arv: deal.arv };
    }), { comp: 600000, repairs: 15000, arv: 600000 });
    assert.equal(await page.evaluate(key => localStorage.getItem(key), analyzerKey), saved);
    await contained();
    await capture('analyzer');

    await page.waitForLoadState('networkidle');
    await page.goto(origin + '/inbox');
    await page.getByRole('button', { name: 'Compose', exact: true }).click();
    const compose = page.getByRole('dialog', { name: 'Compose message', exact: true });
    await expect(compose.getByPlaceholder('Write a seller-facing message...')).toHaveValue('Unsent sample draft stays intact.');
    await expect(compose.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), composeKey), draft);
    await contained();
    await capture('compose');
    assert.deepEqual(writes, []);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(sampleLeads, initialLeads);
    console.log(`${name}: copy, review/cancel, edit/cancel, drafts, notes/comps, containment and zero writes passed`);
  } finally { await browser.close(); }
}

if (serving) console.log(`Read-only sample preview: ${origin}`);
else {
  try {
    mkdirSync(output, { recursive: true });
    const cases = process.argv.includes('--narrow') ? [[chromium, 320]]
      : [[chromium, 1440], [chromium, 390], [webkit, 390], [chromium, 320]];
    for (const [engine, width] of cases) await verify(engine, width);
  } finally { await server.close(); }
}
