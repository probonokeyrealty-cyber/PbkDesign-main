import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { request } from 'node:http';
import { chromium, webkit, expect } from '@playwright/test';
import { createOperatorWorkflowPreview, operatorSkillFixtures } from './fixtures/operator-workflow-fixture.mjs';

const evidence = '.pbk-local/operator-workflow';
await mkdir(evidence, { recursive: true });
const { server, origin } = await createOperatorWorkflowPreview();
const ids = items => items.map(item => item.versionId);
const rows = page => page.locator('[data-pbk-worklist="skills"] button[data-pbk-worklist-row]');
const rowIds = page => rows(page).evaluateAll(elements => elements.map(el => el.dataset.skillVersionId));
const selectedId = page => page.locator('.pbk-skill-version-id code').allTextContents();
const metric = (page, label) => page.locator('#skill-outcome-proof article').filter({ has: page.getByText(label, { exact: true }) }).locator('strong');
async function repository(page) {
  const back = page.getByRole('button', { name: 'Repository', exact: true });
  if (await back.isVisible()) await back.click();
}
async function selectVersion(page, index) {
  await repository(page);
  const search = page.getByRole('textbox', { name: 'Search skill repository' });
  await search.fill(operatorSkillFixtures[index].name);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator(':scope > strong')).toHaveText(operatorSkillFixtures[index].name);
  await repository(page);
  await expect(rows(page).first()).toHaveAttribute('data-skill-version-id', operatorSkillFixtures[index].versionId);
  await rows(page).first().click();
  await expect(page.locator('.pbk-skill-version-id code')).toHaveText(operatorSkillFixtures[index].versionId);
  // Deliberate selection hands focus to detail on the next animation frame.
  await expect(page.locator('.pbk-skill-version-head h2')).toBeFocused();
}
async function contained(page, scope = '.pbk-skill-studio') {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'No viewport overflow');
  const undersized = await page.locator(`${scope} :is(button,a,input,select,summary,textarea)`).evaluateAll(elements => elements.filter(el => {
    const r = el.getBoundingClientRect(); return r.width && r.height && (r.width < 43.5 || r.height < 43.5);
  }).map(el => [el.tagName, el.textContent, el.getBoundingClientRect().width, el.getBoundingClientRect().height]));
  assert.deepEqual(undersized, [], 'Visible controls have 44px targets');
}
async function filterLabelFit(page) {
  await page.evaluate(() => document.fonts.ready);
  const measurements = await page.locator('.pbk-skill-filter select').evaluateAll(selects => selects.map(select => {
    const style = getComputedStyle(select), rect = select.getBoundingClientRect();
    const icon = select.parentElement.querySelector('svg').getBoundingClientRect();
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    context.font = style.font;
    const label = select.selectedOptions[0].textContent.trim();
    const labelWidth = context.measureText(label).width;
    const longest = Math.max(...Array.from(select.options, option => context.measureText(option.textContent.trim()).width));
    // Reserve the native arrow area even when the browser reports zero default padding.
    const usable = select.clientWidth - parseFloat(style.paddingLeft) - Math.max(28, parseFloat(style.paddingRight));
    return { label, labelWidth, longest, usable, iconClear: rect.left >= icon.right + 4,
      fits: labelWidth <= usable && longest <= usable && rect.left >= icon.right + 4 };
  }));
  assert.deepEqual(measurements.filter(item => !item.fits), [], 'Rendered filter labels, including longest option, fit clear of icons/native chevrons');
  return measurements;
}
async function wizardPreservation(page, width) {
  await page.getByRole('button', { name: 'Teach Ava', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'Teach Ava a new skill' });
  const step = name => wizard.locator('.pbk-skill-wizard-steps').getByRole('button', { name });
  await wizard.getByLabel('Skill name', { exact: true }).fill('Synthetic owned draft');
  await wizard.getByLabel('Seller situation').selectOption('trust_concern');
  await wizard.getByLabel('Who should use it?').selectOption('rex');
  await wizard.getByText('Advanced safety details', { exact: true }).click();
  await wizard.getByLabel('Safety level').selectOption('high');
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await wizard.getByLabel('What should Ava say?').fill('Synthetic draft response.');
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await wizard.getByLabel('What should Ava ask next?').fill('Synthetic draft question?');
  await wizard.getByText('Boundaries and proof', { exact: true }).click();
  for (const label of ['Do not use when', 'Required facts', 'Approval trigger']) await wizard.getByLabel(label).fill(`Synthetic ${label}`);
  await wizard.getByText('Advanced source details', { exact: true }).click();
  await wizard.getByLabel('Where did this come from?', { exact: true }).fill('Synthetic owned source');
  await wizard.getByRole('button', { name: 'Preview skill', exact: true }).click();
  await expect(wizard.locator('pre')).toContainText('Synthetic draft response.');
  await contained(page);
  await page.screenshot({ path: `${evidence}/skill-wizard-${page.context().browser().browserType().name()}-${width}.png` });
  const node = await wizard.elementHandle();
  await page.setViewportSize({ width: width === 1440 ? 390 : 1440, height: 900 });
  assert.equal(await node.evaluate(el => el.isConnected), true, 'Resize must not remount wizard');
  await page.setViewportSize({ width, height: 900 });
  await step('Situation').click();
  await expect(wizard.getByLabel('Skill name', { exact: true })).toHaveValue('Synthetic owned draft');
  await expect(wizard.getByLabel('Seller situation')).toHaveValue('trust_concern');
  await expect(wizard.getByLabel('Who should use it?')).toHaveValue('rex');
  await wizard.getByText('Advanced safety details', { exact: true }).click();
  await expect(wizard.getByLabel('Safety level')).toHaveValue('high');
  await step('Ava reply').click();
  await expect(wizard.getByLabel('What should Ava say?')).toHaveValue('Synthetic draft response.');
  await step('Next question').click();
  await expect(wizard.getByLabel('What should Ava ask next?')).toHaveValue('Synthetic draft question?');
  await wizard.getByText('Boundaries and proof', { exact: true }).click();
  for (const label of ['Do not use when', 'Required facts', 'Approval trigger']) await expect(wizard.getByLabel(label)).toHaveValue(`Synthetic ${label}`);
  await wizard.getByText('Advanced source details', { exact: true }).click();
  await expect(wizard.getByLabel('Where did this come from?', { exact: true })).toHaveValue('Synthetic owned source');
  await wizard.getByRole('tab', { name: 'Video', exact: true }).click();
  await wizard.getByPlaceholder('https://www.youtube.com/watch?v=...').fill('https://www.youtube.com/watch?v=synthetic');
  await wizard.getByPlaceholder('https://.../training-call.mp3').fill('https://example.invalid/synthetic.mp3');
  await wizard.getByPlaceholder('Optional fallback', { exact: false }).fill('Synthetic transcript');
  await wizard.getByLabel('How many drafts?').selectOption('8');
  await wizard.getByRole('tab', { name: 'Article', exact: true }).click();
  await wizard.getByLabel('Article title', { exact: true }).fill('Synthetic article');
  await wizard.getByPlaceholder('https://example.com/article').fill('https://example.invalid/article');
  await wizard.getByPlaceholder('Paste the article body', { exact: false }).fill('Synthetic article text');
  await wizard.getByRole('tab', { name: 'Video', exact: true }).click();
  await expect(wizard.getByPlaceholder('https://www.youtube.com/watch?v=...')).toHaveValue('https://www.youtube.com/watch?v=synthetic');
  await expect(wizard.getByPlaceholder('https://.../training-call.mp3')).toHaveValue('https://example.invalid/synthetic.mp3');
  await expect(wizard.getByPlaceholder('Optional fallback', { exact: false })).toHaveValue('Synthetic transcript');
  await expect(wizard.getByLabel('How many drafts?')).toHaveValue('8');
  await wizard.getByRole('tab', { name: 'Article', exact: true }).click();
  await expect(wizard.getByLabel('Article title', { exact: true })).toHaveValue('Synthetic article');
  await expect(wizard.getByPlaceholder('https://example.com/article')).toHaveValue('https://example.invalid/article');
  await expect(wizard.getByPlaceholder('Paste the article body', { exact: false })).toHaveValue('Synthetic article text');
  await wizard.getByRole('tab', { name: 'Type it', exact: true }).click();
  await step('Preview').click();
  await expect(wizard.locator('pre')).toContainText('Synthetic draft response.');
  await contained(page);
  await wizard.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Closing and reopening keeps the existing component-owned draft.
  await page.getByRole('button', { name: 'Teach Ava', exact: true }).click();
  await expect(wizard.locator('pre')).toContainText('Synthetic draft response.');
  await wizard.getByRole('button', { name: 'Cancel', exact: true }).click();
}

async function verifyReadOwnership(engine) {
  const browser = await engine.launch();
  const failures = [];
  let passed = 0;
  const a = structuredClone(operatorSkillFixtures[0]);
  const b = structuredClone(operatorSkillFixtures[1]);
  const active = { ...operatorSkillFixtures[8], activationId: 'SYN-ACTIVATION-8' };
  const pair = (items = [a,b,operatorSkillFixtures[3],active], count = 11) => ({
    repository: { ok: true, items }, status: { ok: true, candidates: count },
  });
  async function scenario(name, execute, initial = pair()) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(3000);
    const plans = [initial], counts = { repository: 0, status: 0 }, requests = [], posts = [], unexpected = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', socket => { if (new URL(socket.url()).hostname !== '127.0.0.1') unexpected.push(socket.url()); socket.close(); });
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { unexpected.push(req.url()); return route.abort(); }
      const part = url.pathname === '/api/skills/governance/repository' ? 'repository' : url.pathname === '/api/skills/governance/status' ? 'status' : null;
      if (part && req.method() === 'GET') {
        const index = counts[part]++;
        requests.push({ part, index, search: url.searchParams.get('search'), lifecycle: url.searchParams.get('lifecycleState'), limit: url.searchParams.get('limit') });
        const plan = plans[index];
        if (!plan) { unexpected.push(`Unplanned ${part} read ${index}`); return route.abort(); }
        if (plan.hold?.includes(part)) await new Promise(resolve => { (plan.release ||= {})[part] = resolve; });
        return route.fulfill({ status: plan.http?.[part] || 200, json: plan[part] });
      }
      if (req.method() !== 'GET' && url.pathname !== '/api/state/stream/session') { unexpected.push([req.method(), url.pathname]); return route.abort(); }
      return route.continue();
    });
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    const search = page.getByRole('textbox', { name: 'Search skill repository' });
    const id = page.locator('.pbk-skill-version-id code');
    const status = page.getByRole('region', { name: 'Skill governance status' }).locator('div').filter({ has: page.getByText('Review queue', { exact: true }) }).locator('strong');
    const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const waitRead = index => expect.poll(() => requests.filter(r => r.index === index).length).toBe(2);
    async function release(plan) {
      for (const resolve of Object.values(plan.release || {})) resolve();
      await flush();
    }
    async function loaded(expected = a.versionId, count = '11') {
      await expect(id).toHaveText(expected); await expect(status).toHaveText(count); await expect(refresh).toBeEnabled();
    }
    async function exactPost(path, body, result = { ok: false, error: 'Synthetic exact target rejected' }, delayed = false) {
      const control = {};
      await page.route(url => url.origin === origin && url.pathname === path, async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const captured = route.request().postDataJSON(); posts.push({ path, body: captured });
        assert.deepEqual(captured, body, name);
        if (delayed) await new Promise(resolve => { control.release = resolve; });
        return route.fulfill({ status: result.ok ? 200 : 403, json: result });
      });
      return control;
    }
    try {
      await page.goto(origin + '/skills');
      await execute({ page, plans, pair, refresh, search, id, status, flush, waitRead, release, loaded, exactPost, posts, requests });
      assert.deepEqual({ unexpected, errors }, { unexpected: [], errors: [] });
      passed++; console.log(`PASS ownership ${engine.name()}: ${name}`);
    } catch (error) { failures.push(name); console.error(`FAIL ownership ${engine.name()}: ${name}\n${error.message}`); }
    finally { await page.close(); }
  }
  try {
    for (const part of ['repository','status']) for (const outcome of ['success','error']) {
      await scenario(`late ${part} ${outcome} after newer success`, async h => {
        await h.loaded();
        const old = { ...pair([a], 91), hold: [part], ...(outcome === 'error' ? { http: { [part]: 503 }, [part]: { ok: false, error: 'Old read failure' } } : {}) };
        h.plans.push(old, pair([b], 22));
        await h.refresh.click(); await h.waitRead(1);
        await h.search.fill('new intent'); await h.waitRead(2); await h.loaded(b.versionId, '22');
        await h.page.getByLabel('Seller says').fill('Current version unsaved preview');
        await h.page.getByRole('button', { name: 'Review and approve this skill', exact: true }).click();
        await h.release(old); await h.flush();
        await h.loaded(b.versionId, '22'); await expect(h.page.getByRole('alert')).toHaveCount(0);
        await expect(h.page.getByLabel('Seller says')).toHaveValue('Current version unsaved preview');
        await expect(h.page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
        await h.exactPost(`/api/skills/versions/${b.versionId}/approve`, { expectedHash: b.contentHash, decision: 'approved', evidenceSnapshot: { reviewedIn: 'PBK Skill Studio', riskClass: b.riskClass, safetyScan: {} } });
        await h.page.getByRole('button', { name: 'Confirm', exact: true }).click();
        await expect(h.page.getByRole('alert')).toContainText('Synthetic exact target rejected'); assert.equal(h.posts.length, 1);
        assert.equal(h.requests.find(r => r.index === 2 && r.part === 'repository').search, 'new intent');
      });
    }
    await scenario('old finally cannot settle a pending newer read or clear its failure', async h => {
      await h.loaded();
      const old = { ...pair([a], 91), hold: ['repository'] }, next = { ...pair([b], 22), hold: ['repository'] };
      h.plans.push(old, next); await h.refresh.click(); await h.waitRead(1);
      await h.search.fill('pending intent'); await h.waitRead(2);
      await h.release(old); await h.flush(); await expect(h.refresh).toBeDisabled(); await expect(h.id).toHaveText(a.versionId);
      await expect(h.page.getByRole('button', { name: 'Review and approve this skill', exact: true })).toBeDisabled();
      next.repository = { ok: false, error: 'Latest read failed' };
      await h.release(next); await expect(h.page.getByRole('alert')).toContainText('Latest read failed');
      await expect(h.id).toHaveText(a.versionId); await expect(h.page.getByText(/Saved.*retained/i)).toBeVisible();
    });
    for (const outcome of ['success','error']) await scenario(`old ${outcome} cannot overwrite newer failed read and retained identity`, async h => {
      await h.loaded();
      const old = { ...pair([b],91), hold: ['repository'], ...(outcome === 'error' ? { http: { repository: 503 }, repository: { ok: false, error: 'Old failed read' } } : {}) };
      h.plans.push(old, { ...pair([b],22), repository: { ok: false, error: 'Current failure owns this view' } });
      await h.refresh.click(); await h.waitRead(1); await h.search.fill('failed new intent'); await h.waitRead(2);
      await expect(h.page.getByRole('alert')).toContainText('Current failure owns this view');
      await h.release(old); await h.loaded(); await expect(h.page.getByRole('alert')).toContainText('Current failure owns this view');
      await expect(h.page.getByText(/Saved.*retained/i)).toBeVisible();
      await expect(h.page.getByRole('button', { name: 'Review and approve this skill', exact: true })).toBeDisabled();
    });
    await scenario('invalidate during 180ms debounce before the next fetch', async h => {
      await h.loaded();
      await h.page.clock.install(); await h.page.clock.pauseAt(new Date());
      const old = { ...pair([b], 91), hold: ['repository'] };
      h.plans.push(old, pair([a], 22)); await h.refresh.click(); await h.waitRead(1);
      await h.search.fill('debounced intent');
      for (const resolve of Object.values(old.release)) resolve();
      await h.page.clock.runFor(32);
      await expect(h.id).toHaveText(a.versionId); await expect(h.status).toHaveText('11'); await expect(h.refresh).toBeDisabled();
      await h.page.clock.runFor(180); await h.waitRead(2); await h.loaded(a.versionId, '22');
    });
    await scenario('query change cancels confirmation inside debounce, before any new GET', async h => {
      await h.loaded(); await h.page.clock.install(); await h.page.clock.pauseAt(new Date());
      await h.page.getByRole('button', { name: 'Review and approve this skill', exact: true }).click();
      await h.search.fill('pending confirmation query'); await h.page.clock.runFor(32);
      await expect(h.page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
      await expect(h.page.getByRole('button', { name: 'Review and approve this skill', exact: true })).toBeDisabled();
      await expect(h.page.getByText(/Saved.*retained/i)).toBeVisible();
      assert.equal(h.requests.filter(r => r.part === 'repository').length, 1);
      assert.deepEqual(h.posts, []);
    });
    for (const [label, part, value] of [
      ['ok false repository','repository',{ ok: false, error: 'Repository rejected', items: [] }],
      ['missing items','repository',{ ok: true }], ['non-array items','repository',{ ok: true, items: {} }],
      ['null repository','repository',null], ['null item','repository',{ ok: true, items: [null] }],
      ['ok false status','status',{ ok: false, error: 'Status rejected', candidates: 99 }], ['malformed status','status',null],
    ]) await scenario(`${label} retains labeled exact last-good data`, async h => {
      await h.loaded();
      await h.page.getByLabel('Seller says').fill('Retained version owned preview');
      h.plans.push({ ...pair([b], 22), [part]: value }); await h.refresh.click();
      await expect(h.page.getByRole('alert')).toBeVisible(); await h.loaded();
      await expect(h.page.getByLabel('Seller says')).toHaveValue('Retained version owned preview');
      await expect(h.page.getByText(/Saved.*retained/i)).toBeVisible();
      await expect(h.page.getByRole('button', { name: 'Review and approve this skill', exact: true })).toBeDisabled();
      await expect(h.page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
      await expect(h.page.locator('.pbk-skill-studio')).not.toContainText(/last refreshed|refreshed at/i);
      if (label === 'ok false repository') for (const width of [1440,390,320]) {
        await h.page.setViewportSize({ width, height: 900 }); await contained(h.page);
        await expect(h.page.getByText(/Saved.*retained/i)).toBeVisible();
        await h.page.screenshot({ path: `${evidence}/task5-retained-${engine.name()}-${width}.png` });
      }
    });
    await scenario('initial malformed read is unavailable, not empty or ready', async h => {
      await expect(h.page.getByRole('alert')).toBeVisible();
      await expect(h.page.getByText('Repository unavailable', { exact: true })).toBeVisible();
      await expect(h.id).toHaveCount(0); await expect(h.status).toHaveText('Not recorded'); await expect(h.refresh).toBeEnabled();
    }, { ...pair(), repository: { ok: true } });
    await scenario('same version object refresh preserves typed preview; different version seeds', async h => {
      await h.loaded(); const input = h.page.getByLabel('Seller says'); await input.fill('Owned unsaved preview');
      h.plans.push(pair()); await h.refresh.click(); await h.waitRead(1); await h.loaded();
      await expect(input).toHaveValue('Owned unsaved preview');
      await rows(h.page).nth(1).click(); await expect(h.id).toHaveText(b.versionId); await expect(input).toHaveValue('Synthetic scenario 1.');
    });
    for (const [label, change] of [
      ['selection', async h => rows(h.page).nth(1).click()],
      ['search', async h => { h.plans.push(pair()); await h.search.fill('new query'); }],
      ['lifecycle filter', async h => { h.plans.push(pair()); await h.page.getByLabel('Filter by lifecycle state').selectOption('candidate'); }],
      ['agent filter', async h => h.page.getByLabel('Filter by agent').selectOption('rex')],
      ['risk filter', async h => h.page.getByLabel('Filter by risk').selectOption('medium')],
      ['sort', async h => h.page.getByLabel('Sort by performance').selectOption('top')],
    ]) await scenario(`confirmation cancels on ${label} ownership change`, async h => {
      await h.loaded(); await h.page.getByRole('button', { name: 'Review and approve this skill', exact: true }).click();
      await expect(h.page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible(); await change(h);
      await expect(h.page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0); assert.deepEqual(h.posts, []);
    });
    for (const [label, patch] of [['same ID changed hash',{ contentHash: 'synthetic-revised-hash' }],['same ID changed lifecycle',{ lifecycleState: 'approved_inactive' }]]) {
      await scenario(`confirmation cancels on ${label}`, async h => {
        await h.loaded(); await h.page.getByRole('button', { name: 'Review and approve this skill', exact: true }).click();
        h.plans.push(pair([{ ...a, ...patch }])); await h.refresh.click(); await h.waitRead(1); await h.loaded();
        await expect(h.page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
        if (patch.contentHash) {
          await h.exactPost(`/api/skills/versions/${a.versionId}/approve`, { expectedHash: patch.contentHash, decision: 'approved', evidenceSnapshot: { reviewedIn: 'PBK Skill Studio', riskClass: a.riskClass, safetyScan: {} } });
          await h.page.getByRole('button', { name: 'Review and approve this skill', exact: true }).click(); await h.page.getByRole('button', { name: 'Confirm', exact: true }).click();
          await expect(h.page.getByRole('alert')).toContainText('Synthetic exact target rejected'); assert.equal(h.posts.length, 1);
          await expect(h.page.getByRole('status')).toHaveCount(0);
        }
      });
    }
    await scenario('rollout/agent and activation confirmation retain exact captured bodies', async h => {
      await h.loaded(); await rows(h.page).nth(2).click();
      const start = h.page.getByRole('button', { name: 'Start a small test', exact: true });
      const confirm = h.page.getByRole('button', { name: 'Confirm', exact: true });
      await start.click(); await h.page.getByLabel('Rollout agent').selectOption('rex'); await expect(confirm).toHaveCount(0);
      await start.click(); await h.page.getByLabel('Rollout percentage').fill('25'); await expect(confirm).toHaveCount(0);
      await h.exactPost('/api/skills/versions/SYN-SKILL-003/activate', { agentId: 'rex', rolloutMode: 'canary', rolloutPercent: 25, scope: { type: 'global' }, rollbackThresholds: { complianceFailure: 1, sellerComplaint: 1, toolErrorRate: 0.1 } });
      await start.click(); await confirm.click(); await expect(h.page.getByRole('alert')).toContainText('Synthetic exact target rejected'); assert.equal(h.posts.length, 1);
      await rows(h.page).nth(3).click(); const off = h.page.getByRole('button', { name: 'Turn this skill off', exact: true }); await off.click();
      h.plans.push(pair([a,b,operatorSkillFixtures[3],{ ...active, activationId: 'SYN-ACTIVATION-CHANGED' }])); await h.refresh.click(); await h.waitRead(1); await h.loaded(active.versionId);
      await expect(confirm).toHaveCount(0);
      await h.exactPost('/api/skills/activations/SYN-ACTIVATION-CHANGED/rollback', { reason: 'Operator rollback from PBK Skill Studio.' });
      await off.click(); await confirm.click(); await expect(h.page.getByRole('alert')).toContainText('Synthetic exact target rejected'); assert.equal(h.posts.length, 2);
    });
    await scenario('missing hash cannot submit unverifiable approval', async h => {
      await h.loaded(); await expect(h.page.getByRole('button', { name: 'Review and approve this skill', exact: true })).toBeDisabled();
    }, pair([{ ...a, contentHash: '' }]));
    await scenario('delayed action reload uses current search/filter intent, not captured load', async h => {
      await h.loaded();
      const control = await h.exactPost(`/api/skills/versions/${a.versionId}/approve`, { expectedHash: a.contentHash, decision: 'approved', evidenceSnapshot: { reviewedIn: 'PBK Skill Studio', riskClass: a.riskClass, safetyScan: {} } }, { ok: true }, true);
      await h.page.getByRole('button', { name: 'Review and approve this skill', exact: true }).click(); await h.page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect.poll(() => h.posts.length).toBe(1);
      h.plans.push(pair([b], 22)); await h.search.fill('current action intent'); await h.page.getByLabel('Filter by lifecycle state').selectOption('needs_review'); await h.waitRead(1); await h.loaded(b.versionId, '22');
      h.plans.push(pair([b], 23)); control.release(); await h.waitRead(2); await h.loaded(b.versionId, '23');
      assert.deepEqual(h.requests.filter(r => r.part === 'repository').map(r => [r.search,r.lifecycle,r.limit]), [[null,null,'150'],['current action intent','needs_review','150'],['current action intent','needs_review','150']]);
      assert.equal(h.posts.length, 1);
    });
    await scenario('unmount invalidates old read without contaminating a new mount', async h => {
      await h.loaded(); const old = { ...pair([a], 91), hold: ['repository'] }; h.plans.push(old, pair([b],22));
      await h.refresh.click(); await h.waitRead(1);
      await h.page.getByRole('link', { name: 'Leads', exact: true }).filter({ visible: true }).first().click();
      await expect(h.page.locator('.pbk-skill-studio')).toHaveCount(0);
      await h.page.getByRole('link', { name: 'Skill Studio', exact: true }).filter({ visible: true }).first().click();
      await h.waitRead(2); await h.loaded(b.versionId,'22'); await h.release(old); await h.loaded(b.versionId,'22');
    });
    for (const transfer of ['owned','another control','outside page']) await scenario(`vanished row focus recovery: ${transfer}`, async h => {
      await h.loaded();
      const next = { ...pair([b],22), hold: ['repository'] }; h.plans.push(next); await h.refresh.click(); await h.waitRead(1); await rows(h.page).first().focus();
      const other = h.page.getByLabel('Filter by risk');
      if (transfer === 'another control') await other.focus();
      if (transfer === 'outside page') await h.page.locator('.pbk-skill-studio').evaluate(el => { const outside = document.createElement('button'); outside.textContent = 'Synthetic outside control'; el.before(outside); outside.focus(); });
      await h.release(next); await h.loaded(b.versionId,'22');
      if (transfer === 'owned') await expect(h.search).toBeFocused();
      if (transfer === 'another control') await expect(other).toBeFocused();
      if (transfer === 'outside page') await expect(h.page.getByRole('button', { name: 'Synthetic outside control' })).toBeFocused();
    });
  } finally { await browser.close(); }
  console.log(`Ownership scenarios ${engine.name()}: ${passed} passed, ${failures.length} failed`);
  assert.deepEqual(failures, [], 'All ownership scenarios pass');
}

async function verify(engine, width) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    console.log(`${engine.name()} ${width}: loading synthetic Skills`);
    const foreign = [], writes = [], errors = [], denied = [], reads = [];
    let status = { ok: true };
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', socket => { if (new URL(socket.url()).hostname !== '127.0.0.1') foreign.push(socket.url()); socket.close(); });
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { foreign.push(req.url()); return route.abort(); }
      if (req.method() !== 'GET' && url.pathname !== '/api/state/stream/session') { writes.push([req.method(), url.pathname]); return route.abort(); }
      if (url.pathname.startsWith('/api/skills/')) reads.push(url.pathname);
      if (url.pathname === '/api/skills/governance/status') return route.fulfill({ json: status });
      return route.continue();
    });
    page.on('response', response => { if (response.status() >= 400) denied.push([response.status(), new URL(response.url()).pathname]); });
    await page.addInitScript(() => {
      window.syntheticClipboard = [];
      window.syntheticClipboardDenied = false;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
        if (window.syntheticClipboardDenied) throw new Error('Synthetic permission denied');
        window.syntheticClipboard.push(text);
      } } });
      document.execCommand = () => false;
    });
    await page.goto(origin + '/skills');
    await expect(page.getByRole('heading', { name: 'Skill Studio', exact: true })).toBeVisible();
    await expect(page.locator('.pbk-skill-version-head h2')).toHaveText('Synthetic Skill 00');
    // RED must fail on real identity presentation, not fixture setup.
    await expect(page.locator('.pbk-skill-version-id code')).toHaveText('SYN-SKILL-000');
    const ribbon = page.getByRole('region', { name: 'Skill governance status' });
    for (const label of ['Review queue', 'Ready to test', 'Small test', 'Live now', 'Sync health']) await expect(ribbon.locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('strong')).toHaveText('Not recorded');
    await repository(page);
    await expect(rows(page)).toHaveCount(10);
    console.log(`Filter label fit ${engine.name()} ${width}: ${JSON.stringify(await filterLabelFit(page))}`);
    await page.getByRole('button', { name: 'Next skills page', exact: true }).click();
    await page.getByRole('button', { name: 'Next skills page', exact: true }).click();
    const first = rows(page).nth(0), second = rows(page).nth(1);
    await expect(first).toHaveAttribute('data-skill-version-id', 'SYN-SKILL-020');
    await first.focus();
    const beforeId = await selectedId(page), beforeReads = reads.length;
    const beforePressed = await rows(page).evaluateAll(elements => elements.map(el => el.getAttribute('aria-pressed')));
    await first.press('ArrowDown'); await expect(second).toBeFocused();
    await expect(second).toHaveCSS('outline-style', 'solid');
    await second.press('End'); await expect(rows(page).last()).toBeFocused();
    await rows(page).last().press('ArrowDown'); await expect(rows(page).last()).toBeFocused();
    await rows(page).last().press('Home'); await expect(first).toBeFocused();
    await first.press('ArrowUp'); await expect(first).toBeFocused();
    await first.press('Shift+ArrowDown'); await expect(first).toBeFocused();
    assert.deepEqual(await selectedId(page), beforeId); assert.equal(reads.length, beforeReads);
    assert.deepEqual(await rows(page).evaluateAll(elements => elements.map(el => el.getAttribute('aria-pressed'))), beforePressed);
    await page.screenshot({ path: `${evidence}/skill-repository-${engine.name()}-${width}.png` });
    await first.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.pbk-skill-version-id code')).toHaveText('SYN-SKILL-020');
    for (const label of ['Recorded uses', 'Success rate', 'Confidence', 'Change', 'Last triggered']) await expect(metric(page, label)).toHaveText('Not recorded');
    await expect(page.locator('.pbk-skill-outcome-proof')).toContainText('Recorded uses: Not recorded');
    const lifecycle = page.getByRole('list', { name: 'Skill lifecycle' });
    await expect(lifecycle.locator('li')).toHaveCount(7);
    await expect(lifecycle.locator('[aria-current]')).toHaveCount(0);
    await expect(page.locator('.pbk-skill-stage h3')).toHaveText('Unknown');
    await page.locator('.pbk-skill-saved-instructions summary').click();
    await expect(page.locator('.pbk-skill-saved-instructions p')).toContainText('Synthetic response 20.');
    if (width < 1281) await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.locator('#skill-record')).toContainText('Synthetic provenance 20');
    const sync = label => page.locator('#skill-record dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
    await expect(sync('Sync')).toHaveText('Not recorded');
    await expect(sync('Snapshot')).toHaveText('Not recorded');
    if (width < 1281) await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await repository(page);
    await expect(first.locator('.pbk-skill-card-metrics')).toContainText('Not recorded');
    await expect(first.locator('.pbk-skill-card-metrics > span').nth(0).locator('strong')).toHaveText('Not recorded');
    await second.focus(); await second.press('Space');
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(second.locator('.pbk-skill-card-metrics > span').nth(0).locator('strong')).toHaveText('0');
    await expect(second.locator('.pbk-skill-card-metrics > span').nth(1).locator('strong')).toHaveText('0%');
    await expect(second.locator('.pbk-skill-card-metrics > span').nth(2).locator('strong')).toHaveText('0%');
    await expect(page.locator('.pbk-skill-version-id code')).toHaveText('SYN-SKILL-021');
    for (const [label, value] of [['Recorded uses','0'],['Success rate','0%'],['Confidence','0%'],['Change','0%']]) await expect(metric(page, label)).toHaveText(value);
    await expect(lifecycle.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(lifecycle.locator('.complete,svg')).toHaveCount(0);
    if (!(await page.locator('.pbk-skill-saved-instructions p').isVisible())) await page.locator('.pbk-skill-saved-instructions summary').click();
    await expect(page.locator('.pbk-skill-saved-instructions p')).toContainText('Synthetic response 21.');
    if (width < 1281) await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.locator('#skill-record')).toContainText('Synthetic provenance 21');
    if (width < 1281) await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Copy ID', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Version ID copied');
    assert.deepEqual(await page.evaluate(() => window.syntheticClipboard), ['SYN-SKILL-021']);
    await page.evaluate(() => { window.syntheticClipboardDenied = true; });
    await page.getByRole('button', { name: 'Copy ID', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not copy version ID');
    await expect(page.getByText('Version ID copied', { exact: true })).toHaveCount(0);
    await selectVersion(page, 22);
    for (const label of ['Recorded uses', 'Success rate', 'Confidence', 'Change', 'Last triggered']) await expect(metric(page, label)).toHaveText('Not recorded');
    await repository(page);
    await expect(rows(page).first().locator('.pbk-skill-card-metrics > span strong')).toHaveText(['Not recorded','Not recorded','Not recorded']);
    await rows(page).first().click();
    for (const index of [23,24,25,26]) {
      await selectVersion(page, index);
      await expect(lifecycle.locator('[aria-current]')).toHaveCount(0);
      await expect(page.locator('.pbk-skill-version-kicker .pbk-skill-state')).toHaveText('Unknown');
      await expect(page.locator('.pbk-skill-stage h3')).toHaveText('Unknown');
    }
    await selectVersion(page, 63);
    console.log(`${engine.name()} ${width}: identity, metrics, lifecycle and clipboard checked`);
    await page.evaluate(() => { window.syntheticClipboardDenied = false; });
    await page.getByRole('button', { name: 'Copy ID', exact: true }).click();
    assert.equal(await page.evaluate(() => window.syntheticClipboard.at(-1)), operatorSkillFixtures[63].versionId);
    await contained(page);
    await page.locator('.pbk-skill-version-head').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/skill-identity-${engine.name()}-${width}.png` });
    const simulator = page.getByRole('region', { name: 'Skill simulator' });
    await expect(simulator.getByText('Simulation only', { exact: true })).toBeVisible();
    await expect(simulator.getByText('Synthetic response 63.', { exact: true })).toBeVisible();
    await expect(simulator.getByText('Synthetic question 63?', { exact: true })).toBeVisible();
    await simulator.getByLabel('Seller says').fill('Synthetic unsaved scenario.');
    const input = await simulator.getByLabel('Seller says').elementHandle();
    const nav = page.getByRole('navigation', { name: 'Skill evidence' });
    assert.deepEqual(await nav.getByRole('link').allTextContents(), ['Outcome evidence', 'Response preview', 'Decision']);
    for (const name of ['Outcome evidence','Response preview','Decision']) await nav.getByRole('link', { name, exact: true }).click();
    await expect(simulator.getByLabel('Seller says')).toHaveValue('Synthetic unsaved scenario.');
    await page.setViewportSize({ width: width === 1440 ? 390 : 1440, height: 900 });
    assert.equal(await input.evaluate(el => el.isConnected), true);
    await page.setViewportSize({ width, height: 900 });
    await expect(simulator.getByLabel('Seller says')).toHaveValue('Synthetic unsaved scenario.');
    await expect(page.locator('#skill-outcome-proof')).toHaveCount(1); await expect(page.locator('#skill-simulator')).toHaveCount(1);
    assert.equal(await page.locator('#skill-outcome-proof').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('#skill-decision')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    assert.equal(await page.locator('#skill-outcome-proof').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('#skill-simulator')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    await expect(page.locator('.pbk-skill-studio')).not.toContainText(/\b30d\b|\bwk\b|this week/);
    await page.screenshot({ path: `${evidence}/skill-studio-${engine.name()}-${width}.png`, fullPage: true });
    await selectVersion(page, 21);
    await expect(simulator.getByLabel('Seller says')).toHaveValue('Synthetic scenario 21.');
    // Current raw-number ranking semantics are intentionally not the display semantics.
    await repository(page);
    const search = page.getByRole('textbox', { name: 'Search skill repository' });
    await search.fill(''); await expect(page.getByText('10 shown', { exact: false }).first()).toContainText('64 matching skills');
    await repository(page);
    const sort = page.getByRole('combobox', { name: 'Sort by performance' });
    const rankValue = item => item.successRate ?? item.confidence;
    for (const mode of ['top','worst','needs_outcomes']) {
      await sort.selectOption(mode);
      await filterLabelFit(page);
      const expected = mode === 'needs_outcomes' ? operatorSkillFixtures.filter(item => (item.usageCount || 0) <= 0 || item.successRate === undefined) :
        [...operatorSkillFixtures].sort((a,b) => mode === 'top' ? (rankValue(b) ?? -1) - (rankValue(a) ?? -1) : (rankValue(a) ?? 101) - (rankValue(b) ?? 101));
      assert.deepEqual(await rowIds(page), ids(expected.slice(0,10)), mode);
    }
    await sort.selectOption('');
    const queue = page.getByRole('region', { name: "Today's Training Queue" });
    assert.deepEqual(await queue.locator('button > strong').allTextContents(), operatorSkillFixtures.slice(0,3).map(i => i.name));
    await expect(queue.locator('button > span')).toHaveText(['Review next','Review next','Review next']);
    await page.getByRole('combobox', { name: 'Filter by agent' }).selectOption('rex');
    assert.deepEqual(await rowIds(page), ids(operatorSkillFixtures.filter(i => i.agentId === 'rex').slice(0,10)));
    await page.getByRole('combobox', { name: 'Filter by risk' }).selectOption('high');
    assert.deepEqual(await rowIds(page), ids(operatorSkillFixtures.filter(i => i.agentId === 'rex' && i.riskClass === 'high').slice(0,10)));
    await page.getByRole('combobox', { name: 'Filter by agent' }).selectOption('');
    await page.getByRole('combobox', { name: 'Filter by risk' }).selectOption('');
    // Lifecycle/search membership remains server-owned, queue reason/action policy remains unchanged.
    for (const [state, name, action] of [['approved_inactive','Synthetic Skill 03','Start small'],['failed','Synthetic Skill 04','Practice first']]) {
      await page.getByRole('combobox', { name: 'Filter by lifecycle state' }).selectOption(state);
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first().locator(':scope > strong')).toHaveText(name);
      await expect(queue.locator('button > span')).toHaveText([action]);
      await repository(page);
    }
    await page.getByRole('combobox', { name: 'Filter by lifecycle state' }).selectOption('');
    await expect(page.getByText('10 shown', { exact: false }).first()).toContainText('64 matching skills');
    await repository(page);
    await search.fill('Synthetic Trend'); await expect(rows(page)).toHaveCount(3);
    await repository(page);
    await expect(queue).toContainText('Confidence is slipping. Check what changed.');
    await expect(queue).not.toContainText('this week');
    await search.fill('Synthetic Skill 20'); await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator(':scope > strong')).toHaveText('Synthetic Skill 20');
    await repository(page);
    await expect(queue).toContainText('Recorded uses: Not recorded');
    await search.fill('Synthetic Skill 21'); await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator(':scope > strong')).toHaveText('Synthetic Skill 21');
    await repository(page);
    await expect(queue).toContainText('Recorded uses: 0');
    await search.fill('Synthetic Skill 22'); await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator(':scope > strong')).toHaveText('Synthetic Skill 22');
    await repository(page);
    await expect(queue).toContainText('Recorded uses: Not recorded');
    // Status reads exercise absent, genuine zero, malformed and affirmative boolean cases in the real DOM.
    for (const [next, count, snapshot, health] of [
      [{ ok:true, candidates:0, approvedInactive:'0', canary:0, active:0, snapshot:{available:true}, outbox:{pending:0,deadLettered:0} }, '0','Validated','Healthy'],
      [{ ok:true, candidates:-1, approvedInactive:'bad', canary:false, active:1.5, snapshot:{available:'true'}, outbox:{pending:-1,deadLettered:'bad'} }, 'Not recorded','Not recorded','Not recorded'],
      [{ ok:true, snapshot:{available:false}, outbox:{deadLettered:2} }, 'Not recorded','Unavailable','Needs attention'],
    ]) {
      status = next;
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
      for (const label of ['Review queue','Ready to test','Small test','Live now','Sync health']) await expect(ribbon.locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('strong')).toHaveText(count);
      await repository(page);
      await rows(page).first().click();
      if (width < 1281) await page.getByRole('button', { name: 'Inspect', exact: true }).click();
      await expect(sync('Snapshot')).toHaveText(snapshot); await expect(sync('Sync')).toHaveText(health);
      if (width < 1281) await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await repository(page);
    }
    await selectVersion(page, 3);
    await expect(page.getByRole('slider', { name: 'Rollout percentage' })).toHaveValue('10');
    await expect(page.getByRole('combobox', { name: 'Rollout agent' })).toHaveValue('ava');
    await contained(page);
    await page.getByRole('button', { name: 'Start a small test', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await wizardPreservation(page, width);
    assert.equal(await page.context().pages().length, 1, 'No new tabs');
    assert.deepEqual({ foreign,writes,errors,denied }, { foreign:[],writes:[],errors:[],denied:[] });
    console.log(`PASS ${engine.name()} ${width}: identity/evidence/focus/clipboard/lifecycle/ranking/preview/wizard/status; zero unexpected writes, foreign/provider traffic, errors or tabs`);
  } finally { await browser.close(); }
}
try {
  for (const path of ['/api/skills/governance/repository','/api/skills/governance/status']) {
    assert.equal((await fetch(origin + path, { headers: { Origin: 'https://example.invalid' } })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
      const req = request(origin + path, { headers: { Host: 'example.invalid' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(hostStatus, 403);
  }
  for (const [method,path,status] of [['GET','/api/skills/unplanned',404],['POST','/api/skills/candidates',403],['POST','/invoke',403]]) {
    assert.equal((await fetch(origin + path, { method })).status, status);
  }
  for (const engine of [chromium,webkit]) {
    await verifyReadOwnership(engine);
    for (const width of [1440,390,320]) await verify(engine,width);
  }
} finally { server.httpServer?.closeAllConnections(); await server.close(); }
