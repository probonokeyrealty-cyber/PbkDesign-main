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
  for (const engine of [chromium,webkit]) for (const width of [1440,390,320]) await verify(engine,width);
} finally { server.httpServer?.closeAllConnections(); await server.close(); }
