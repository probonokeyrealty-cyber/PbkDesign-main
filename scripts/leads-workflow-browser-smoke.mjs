import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { chromium, webkit, expect } from '@playwright/test';
import { createOperatorWorkflowPreview, operatorLeadFixtures } from './fixtures/operator-workflow-fixture.mjs';

const { server, origin } = await createOperatorWorkflowPreview();
console.log('Synthetic preview listening:', origin);
const initial = structuredClone(operatorLeadFixtures);
const evidence = '.pbk-local/operator-workflow/after';
mkdirSync(evidence, { recursive: true });
const compose = JSON.stringify({ channel: 'sms', leadId: 'SYN-SENTINEL', message: 'Unsent synthetic draft' });
const analyzer = JSON.stringify({ leadId: 'SYN-SENTINEL', arv: 333333, manualValue: 222222, soldComps: [{ id: 'SYN-KEPT', reviewed: true }] });
const analyzerKey = 'pbk:local:analyzer:current-deal:session';
const visibleRows = page => page.locator('button[data-lead-queue-id]').filter({ visible: true });
const ids = page => visibleRows(page).evaluateAll(nodes => nodes.map(n => n.dataset.leadQueueId));
const selectedIds = page => visibleRows(page).evaluateAll(nodes => nodes.filter(n => n.getAttribute('aria-pressed') === 'true').map(n => n.dataset.leadQueueId));

async function assertManualEvidence(page) {
  await expect(page).toHaveURL(origin + '/leads/SYN-WORK-022');
  await expect(page.getByRole('heading', { name: 'Synthetic Seller 22', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Workspace lead context' }).locator('code')).toHaveText('SYN-WORK-022');
  const numbers = page.locator('#lead-numbers');
  await expect(numbers.getByText('$287,123', { exact: true })).toBeVisible();
  await expect(numbers.getByText('$151,234', { exact: true })).toBeVisible();
  await expect(numbers.getByText('$17,345', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit complete seller profile', exact: true });
  try {
    await expect(edit.getByLabel('Property address', { exact: true })).toHaveValue('22 Synthetic Avenue');
    for (const [name, value] of [['ARV', '287123'], ['MAO', '151234'], ['Estimated repairs', '17345'], ['Sq ft', '1644']]) {
      await expect(edit.getByLabel(name, { exact: true })).toHaveValue(value);
    }
  } finally { await edit.getByRole('button', { name: 'Cancel', exact: true }).click(); }
}

async function assertParcelEvidence(page) {
  const property = page.getByRole('region', { name: 'Property', exact: true });
  await property.getByRole('tab', { name: 'Overview', exact: true }).click();
  const overview = property.getByRole('tabpanel', { name: 'Overview', exact: true });
  await expect(overview.getByText('SYN-PARCEL-022', { exact: true })).toBeVisible();
  await expect(overview.getByText('6,222 sq ft', { exact: true })).toBeVisible();
  await property.getByRole('tab', { name: 'Property record', exact: true }).click();
  const record = property.getByRole('tabpanel', { name: 'Property record', exact: true });
  await expect(record.getByText('ATTOM | Saved snapshot', { exact: true })).toBeVisible();
  await expect(record.locator('.pbk-attom-rows').getByText('1,722 sq ft', { exact: true })).toBeVisible();
  await expect(record.locator('time[datetime="2026-11-17T12:22:00Z"]').first()).toBeVisible();
}

async function assertCompEvidence(page) {
  const property = page.getByRole('region', { name: 'Property', exact: true });
  await property.getByRole('tab', { name: 'Comps', exact: true }).click();
  const comps = property.getByRole('region', { name: 'Recent comparable sales', exact: true });
  const checked = comps.getByRole('checkbox', { name: 'Select comp 122 Synthetic Comp Lane, Example City, CA 90210', exact: true });
  await expect(checked).toBeChecked();
  await expect(comps.getByRole('checkbox', { name: 'Select comp 222 Synthetic Comp Lane, Example City, CA 90210', exact: true })).not.toBeChecked();
  const row = comps.getByRole('row').filter({ has: page.getByRole('checkbox', { name: 'Select comp 122 Synthetic Comp Lane, Example City, CA 90210', exact: true }) });
  await expect(row.locator('[data-label="Price"]')).toHaveText('$312,345');
  await expect(row.locator('[data-label="Sold"]')).toHaveText('2026-11-12');
  await expect(row.locator('[data-label="Sq ft"]')).toHaveText('1,655');
  const comparison = comps.getByRole('region', { name: 'Selected comp comparison', exact: true });
  await expect(comparison.getByRole('heading', { name: '122 Synthetic Comp Lane, Example City, CA 90210', exact: true })).toBeVisible();
  await expect(comparison.getByText('$312,345', { exact: true })).toBeVisible();
  await expect(comps.getByText('1/3 selected', { exact: false })).toBeVisible();
}

async function assertSelectedLeadEvidence(page) {
  await assertManualEvidence(page);
  await assertParcelEvidence(page);
  await assertCompEvidence(page);
  await page.getByRole('region', { name: 'Property', exact: true }).getByRole('tab', { name: 'Overview', exact: true }).click();
}

async function verifyEvidenceNegativeControls(page) {
  const canonical = initial.find(lead => lead.id === 'SYN-WORK-022');
  const endpoint = origin + '/api/leads/SYN-WORK-022/full';
  for (const [name, corrupt, check, failure] of [
    ['manual ARV', lead => { lead.property.arv = 987654; }, assertManualEvidence, '$287,123'],
    ['parcel snapshot', lead => { delete lead.deal.propertyRecordSnapshot; }, assertParcelEvidence, 'SYN-PARCEL-022'],
    ['reviewed comp selection', lead => { lead.analyzer.recordedSales.selectedIds = []; }, assertCompEvidence, 'toBeChecked'],
  ]) {
    const handler = route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const lead = structuredClone(canonical);
      corrupt(lead);
      return route.fulfill({ json: { ok: true, lead } });
    };
    await page.route(endpoint, handler);
    try {
      await page.goto(origin + '/leads/SYN-WORK-022');
      await assert.rejects(() => check(page), error => error.message.includes(failure), `${name} loss must fail browser evidence checks`);
      assert.deepEqual(operatorLeadFixtures, initial, 'Browser evidence fails even while the server array stays unchanged');
      console.log(`negative control: detected ${name} loss in browser; server array unchanged`);
    } finally { await page.unroute(endpoint, handler); }
  }
  await page.goto(origin + '/leads/SYN-WORK-022');
  await assertSelectedLeadEvidence(page);
}
async function checkTargets(page, root) {
  const undersized = await page.locator(`${root} button, ${root} a, ${root} input, ${root} select`).evaluateAll(nodes => nodes.filter(node => {
    const rect = node.getBoundingClientRect();
    return node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && (rect.height < 44 || rect.width < 44);
  }).map(node => [node.getAttribute('aria-label') || node.textContent?.trim() || node.tagName, Math.round(node.getBoundingClientRect().height)]));
  assert.deepEqual(undersized, [], 'Visible page controls keep 44px targets');
}

// Hand-specified wire expectations; never import a production payload builder.
function createExpectation() {
  const seller = { name: 'Synthetic New Seller', phone: '', email: '', preferredChannel: 'unknown', bestTimeToCall: '', relationshipToProperty: 'unknown', notes: '' };
  const property = { address: '99 Synthetic Avenue', city: '', state: '', zip: '', occupancy: 'unknown', condition: 'unknown', beds: null, baths: null, sqft: null, yearBuilt: null, estimatedRepairs: null, arv: 333333, mao: null, mortgageBalance: null, askingPrice: null, propertyType: 'house' };
  const motivation = { summary: '', timeline: 'Unknown', askingPrice: null };
  const compliance = { consentStatus: 'unknown', tcpaConsent: 'unknown', dncStatus: 'needs_review' };
  const assignment = { assignedAgent: 'Ava', campaign: 'manual-new-lead', stage: 'new' };
  const tags = ['manual-new-lead', 'cash-offer'];
  const analyzer = { selectedPath: 'cash', selected_path: 'cash', selectedPathLabel: 'Cash Offer', askingPrice: null, arv: 333333, mao: null, estimatedRepairs: null, mortgageBalance: null, leadScore: null, source: 'new-lead-portal' };
  const liveCallDetails = { preferredChannel: 'unknown', bestTimeToCall: '', relationship: 'unknown', selectedPath: 'cash', selectedPathLabel: 'Cash Offer', assignedAgent: 'Ava', tcpaConsent: 'unknown', dncStatus: 'needs_review', syncedFrom: 'path-and-deal-analyzer' };
  const contracts = { sellerName: 'Synthetic New Seller', sellerEmail: '', sellerPhone: '', propertyAddress: '99 Synthetic Avenue', askingPrice: null, arv: 333333, mao: null, estimatedRepairs: null, selectedPath: 'cash', readyForDraft: false };
  const approvals = { requiredForContract: true, requiredForFirstOutbound: true, compliance };
  const leadProfile = { seller, property, motivation, compliance, assignment, tags, notes: { seller: '', internal: '' }, score: null, source: 'manual-new-lead', stage: 'new' };
  const portalRecord = { portalVersion: 'pbk-lead-portal-v1', source: 'new-lead-portal', leadProfile, analyzer, contracts, approvals,
    ava: { assignedAgent: 'Ava', notes: '', nextAction: 'first_contact', callContext: liveCallDetails },
    rex: { score: null, stage: 'new', underwritingContext: '' }, liveCallDetails, createdBy: 'PBK Command Center' };
  return { source: 'manual-new-lead', leadSource: 'manual-new-lead', stage: 'new', status: 'new', score: null,
    seller, property, motivation, compliance, assignment, tags, notes: '', sellerNotes: '', internalNotes: '', selectedPath: 'cash', selected_path: 'cash',
    leadProfile, lead_profile: leadProfile, portalRecord, portal_record: portalRecord, contracts, approvals, analyzer,
    liveCallDetails, live_call_details: liveCallDetails,
    callContext: { selectedPath: 'cash', selected_path: 'cash', selectedPathLabel: 'Cash Offer', preferredChannel: 'unknown', bestTimeToCall: '', relationship: 'unknown', tcpaConsent: 'unknown', dncStatus: 'needs_review', assignedAgent: 'Ava', source: 'new-lead-portal', liveCallDetailsSynced: true, askingPrice: null, arv: 333333, mao: null, estimatedRepairs: null, mortgageBalance: null, leadScore: null },
    bant: { motivation: '', timeline: 'Unknown', authority: 'unknown', budget: null, score: null }, actor: 'New PBK lead portal' };
}
function editExpectation() {
  const bant = { budget: '', authority: '', need: '', timeline: '', urgency: '', objection: '', sentiment: null, nextStep: 'Confirm synthetic availability.' };
  return {
    name: 'Synthetic Edited Seller', phone: '+12025550101', email: 'seller0@example.invalid', preferredChannel: 'unknown', bestTimeToCall: '', relationship: 'unknown',
    address: '0 Synthetic Avenue', city: 'Example City', state: 'CA', zip: '90210', occupancy: 'unknown', condition: 'unknown', property_type: '',
    beds: null, baths: null, sqft: 1600, yearBuilt: null, motivation: '', timeline: '', askingPrice: null, arv: 245000, mao: 140000, estimatedRepairs: null, mortgageBalance: null,
    motivation_score: 90, stage: 'new', status: 'new', selectedPath: 'cash', selected_path: 'cash', assignedAgent: '', tags: [], tcpaConsent: 'unknown', dncStatus: 'needs_review',
    sellerNotes: '', internalNotes: '', notes: '', bant, call_metadata: { bant, sentiment: null, objection: '', nextStep: 'Confirm synthetic availability.' },
    seller: { name: 'Synthetic Edited Seller', phone: '+12025550101', email: 'seller0@example.invalid', preferredChannel: 'unknown', bestTimeToCall: '', relationshipToProperty: 'unknown', notes: '' },
    property: { address: '0 Synthetic Avenue', city: 'Example City', state: 'CA', zip: '90210', occupancy: 'unknown', condition: 'unknown', propertyType: '', beds: null, baths: null, sqft: 1600, yearBuilt: null, askingPrice: null, arv: 245000, mao: 140000, estimatedRepairs: null, mortgageBalance: null },
    compliance: { tcpaConsent: 'unknown', consentStatus: 'unknown', dncStatus: 'needs_review' }, assignment: { assignedAgent: '', stage: 'new' }, actor: 'Canonical Lead Portal',
  };
}
const target = { leadId: 'SYN-WORK-000', leadName: 'Synthetic Seller 00', phone: '+12025550101', email: 'seller0@example.invalid', address: '0 Synthetic Avenue' };

async function verifyRejections(page, writes) {
  let rejected = 0;
  async function rejectExact(method, path, expected, execute, errorText) {
    const seen = [];
    const matcher = url => url.origin === origin && url.pathname === path;
    const handler = async route => {
      if (route.request().method() !== method) return route.fallback();
      const body = route.request().postDataJSON();
      seen.push(body);
      if (!isDeepStrictEqual(body, expected)) return route.abort();
      return route.fulfill({ status: 403, json: { ok: false, error: 'Synthetic server rejection; no write performed' } });
    };
    await page.route(matcher, handler);
    try {
      await execute();
      await expect.poll(() => seen.length).toBe(1);
      assert.deepEqual(seen, [expected], `Exact ${method} ${path} body and target`);
      await expect(page.getByText(errorText, { exact: true }).first()).toBeVisible();
      rejected++;
    } finally { await page.unroute(matcher, handler); }
  }
  await page.goto(origin + '/leads');
  await expect(visibleRows(page)).toHaveCount(10);
  const add = page.getByRole('button', { name: 'Add seller', exact: true });
  await add.click();
  let create = page.getByRole('dialog', { name: 'Create lead', exact: true });
  await create.getByPlaceholder('Seller full name').fill('Synthetic New Seller');
  await create.getByPlaceholder('Property street address').fill('99 Synthetic Avenue');
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(writes, []);
  await add.click();
  await create.getByPlaceholder('Seller full name').fill('Synthetic New Seller');
  await create.getByPlaceholder('Property street address').fill('99 Synthetic Avenue');
  await rejectExact('POST', '/api/leads', createExpectation(), () => create.getByRole('button', { name: 'Create lead', exact: true }).click(), 'Lead create failed');
  await expect(create.getByPlaceholder('Seller full name')).toHaveValue('Synthetic New Seller');
  // Critical toasts and older custom dialogs overlap at narrow widths. Keep native
  // keyboard cancellation, then dismiss the existing persistent error notification.
  await create.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  const smsButton = page.getByRole('button', { name: 'Text Synthetic Seller 00', exact: true }).filter({ visible: true });
  const sms = page.getByRole('dialog', { name: 'Text Synthetic Seller 00', exact: true });
  await smsButton.click(); await sms.getByRole('textbox').fill('Synthetic unsent text');
  await sms.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.deepEqual(writes, []);
  await smsButton.click(); await sms.getByRole('textbox').fill('Synthetic unsent text');
  await rejectExact('POST', '/api/lead/send-message', { ...target, channel: 'sms', message: 'Synthetic unsent text', body: 'Synthetic unsent text', actor: 'PBK operator', requestedBy: 'PBK operator', source: 'leads_page_manual', manual: true, manualSend: true },
    () => sms.getByRole('button', { name: 'Send SMS', exact: true }).click(), 'SMS failed');
  await expect(sms.getByRole('textbox')).toHaveValue('Synthetic unsent text');
  await sms.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.goto(origin + '/leads/SYN-WORK-000');
  const title = page.getByRole('heading', { name: 'Synthetic Seller 00', level: 1, exact: true });
  await expect(title).toBeVisible();
  const edit = page.getByRole('dialog', { name: 'Edit complete seller profile', exact: true });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await edit.getByLabel('Seller name', { exact: true }).fill('Synthetic Edited Seller');
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(title).toBeVisible(); assert.deepEqual(writes, []);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await edit.getByLabel('Seller name', { exact: true }).fill('Synthetic Edited Seller');
  await rejectExact('PATCH', '/api/leads/SYN-WORK-000', editExpectation(), () => edit.getByRole('button', { name: 'Save seller profile', exact: true }).click(), 'Seller profile not saved');
  await expect(edit.getByLabel('Seller name', { exact: true })).toHaveValue('Synthetic Edited Seller');
  await edit.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  let confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.deepEqual(writes, []);
  await page.getByRole('button', { name: 'Call', exact: true }).click();
  await rejectExact('POST', '/invoke', { toolName: 'telnyx_call', params: { ...target, source: 'lead_portal_manual', manual: true, manualSend: true, forceApproval: false, requestApproval: false, requestedBy: 'PBK operator' } },
    () => confirm.getByRole('button', { name: 'Place call', exact: true }).click(), 'Call request failed');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Contract', exact: true }).click();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.deepEqual(writes, []);
  await page.getByRole('button', { name: 'Contract', exact: true }).click();
  const contractBody = { ...target, path: 'cash', selectedPath: 'cash', selectedPathLabel: 'Cash Offer', docusignTemplateName: 'PBK_Cash_Offer_v1', amount: 140000, source: 'canonical-lead-portal', signers: [
    { roleName: 'Signer1', recipientId: '1', routingOrder: '1', name: 'Probono Key Realty', email: 'info@probonokeyrealty.com' },
    { roleName: 'Signer2', recipientId: '2', routingOrder: '2', name: 'Probono Key Realty', email: 'info@probonokeyrealty.com' },
    { roleName: 'Signer3', recipientId: '3', routingOrder: '3', name: 'Synthetic Seller 00', email: 'seller0@example.invalid' },
  ] };
  await rejectExact('POST', '/api/contract/send', contractBody, () => confirm.getByRole('button', { name: 'Prepare contract', exact: true }).click(), 'Contract request failed');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(title).toBeVisible();
  assert.deepEqual(writes, []);
  return rejected;
}

async function verify(type, width) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const foreign = [], writes = [], errors = [], denied = [], detailReads = [], lookups = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', socket => {
      // Vite can attempt loopback port 0 with HMR disabled; no socket is connected.
      if (new URL(socket.url()).hostname !== '127.0.0.1') foreign.push(socket.url());
      socket.close();
    });
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { foreign.push(request.url()); return route.abort(); }
      if (url.pathname.startsWith('/api/property-data')) lookups.push(url.pathname);
      if (/\/api\/leads\/[^/]+\/full$/.test(url.pathname)) detailReads.push(url.pathname);
      if (request.method() !== 'GET' && url.pathname !== '/api/state/stream/session') {
        writes.push([request.method(), url.pathname]); return route.abort();
      }
      return route.continue();
    });
    page.on('response', response => { if (response.status() >= 400) denied.push([response.status(), new URL(response.url()).pathname]); });
    await page.addInitScript(({ compose, analyzer, analyzerKey }) => {
      if (!localStorage.getItem('pbk:compose:draft')) localStorage.setItem('pbk:compose:draft', compose);
      if (!sessionStorage.getItem(analyzerKey)) sessionStorage.setItem(analyzerKey, analyzer);
    }, { compose, analyzer, analyzerKey });
    console.log(`${type.name()} ${width}px: loading synthetic roster`);
    await page.goto(origin + '/leads?search=Initial&keep=sentinel', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('searchbox', { name: /Search leads/ }).fill('Synthetic');
    await expect(visibleRows(page)).toHaveCount(10);
    await expect(page.locator('button[data-lead-queue-id]')).toHaveCount(20);
    await checkTargets(page, '.pbk-leads-surface');
    // RED: syntax labels must keep their original predicates, not imply consent/readiness.
    await page.getByRole('button', { name: 'Phone format OK', exact: true }).click();
    await expect(page.getByText('32 matching leads', { exact: true })).toBeVisible();
    assert.deepEqual(await ids(page), ['000','002','004','006','008','010','012','014','016','018'].map(n => `SYN-WORK-${n}`));
    assert.equal(new URL(page.url()).search, '?search=Initial&keep=sentinel');
    await page.getByRole('button', { name: 'Email format OK', exact: true }).click();
    await expect(page.getByText('22 matching leads', { exact: true })).toBeVisible();
    assert.deepEqual(await ids(page), ['000','003','006','009','012','015','018','021','024','027'].map(n => `SYN-WORK-${n}`));
    await page.getByRole('button', { name: 'Phone format OK', exact: true }).click();
    await page.getByRole('button', { name: 'Next leads page', exact: true }).click();
    const rows = visibleRows(page), rowA = rows.nth(0), rowB = rows.nth(1);
    await expect(rowA).toHaveAttribute('data-lead-queue-id', 'SYN-WORK-020');
    await expect(page.locator('[data-pbk-worklist="leads"]')).toHaveCount(1);
    await rowA.focus();
    const selectedBefore = await selectedIds(page), readsBefore = detailReads.length;
    await rowA.press('ArrowDown'); await expect(rowB).toBeFocused();
    await expect(rowB).toHaveCSS('outline-style', 'solid');
    await rowB.press('End'); await expect(rows.last()).toBeFocused();
    await rows.last().press('ArrowDown'); await expect(rows.last()).toBeFocused();
    await rows.last().press('Home'); await expect(rowA).toBeFocused();
    await rowA.press('ArrowUp'); await expect(rowA).toBeFocused();
    await rowA.press('Shift+ArrowDown'); await expect(rowA).toBeFocused();
    assert.deepEqual(await selectedIds(page), selectedBefore); assert.equal(detailReads.length, readsBefore);
    assert.deepEqual(writes, []);
    await rowA.press('Enter'); await expect(rowA).toHaveAttribute('aria-pressed', 'true');
    await rowB.press('Space'); await expect(rowB).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => detailReads.at(-1)).toBe('/api/leads/SYN-WORK-022/full');
    const search = page.getByRole('searchbox', { name: 'Search leads' });
    await search.focus(); await search.press('ArrowDown'); await expect(search).toBeFocused();
    const quick = page.getByRole('button', { name: 'Text Synthetic Seller 22', exact: true }).filter({ visible: true });
    await quick.focus(); await quick.press('ArrowDown'); await expect(quick).toBeFocused();
    const pager = page.getByRole('button', { name: 'Previous leads page', exact: true });
    await pager.focus(); await pager.press('ArrowDown'); await expect(pager).toBeFocused();
    assert.deepEqual(await selectedIds(page), ['SYN-WORK-022']);
    await page.screenshot({ path: `${evidence}/roster-${type.name()}-${width}.png` });
    if (width < 721) await page.getByRole('link', { name: 'Open workspace for Synthetic Seller 22', exact: true }).click();
    else await page.getByRole('button', { name: 'Open lead', exact: true }).click();
    await expect(page).toHaveURL(origin + '/leads/SYN-WORK-022');
    await expect(page.getByRole('heading', { name: 'Synthetic Seller 22', exact: true, level: 1 })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Lead workspace sections' });
    await checkTargets(page, '.pbk-lead-portal');
    const historyBefore = await page.evaluate(() => history.length), workspaceReads = detailReads.length;
    for (const [name, id] of [['Next step','lead-next-step'],['Timeline','lead-timeline'],['Numbers','lead-numbers'],['Property','lead-property']]) {
      const link = nav.getByRole('link', { name, exact: true });
      await link.click();
      await expect(page.locator(`#${id} h2`).first()).toBeFocused();
      await expect(link).toHaveAttribute('aria-current', 'location');
    }
    await page.locator('#lead-next-step').evaluate(section => section.scrollIntoView({ block: 'start' }));
    await expect(nav.getByRole('link', { name: 'Next step', exact: true })).toHaveAttribute('aria-current', 'location');
    assert.equal(await page.evaluate(() => history.length), historyBefore, 'Section jumps must not add history');
    assert.equal(detailReads.length, workspaceReads, 'Section jumps must not fetch lead details');
    await assertSelectedLeadEvidence(page);
    await page.screenshot({ path: `${evidence}/workspace-${type.name()}-${width}.png` });
    await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
    await expect(search).toHaveValue('Synthetic');
    await expect(page.getByRole('button', { name: 'Phone format OK', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Page 2 of 4', { exact: false })).toBeVisible();
    await expect(rowB).toBeFocused();
    await expect(rowB).toHaveAttribute('aria-pressed', 'true');
    // Reopen the exact returned selection and check real hydration, not server memory.
    if (width < 721) await page.getByRole('link', { name: 'Open workspace for Synthetic Seller 22', exact: true }).click();
    else await page.getByRole('button', { name: 'Open lead', exact: true }).click();
    await assertSelectedLeadEvidence(page);
    await page.getByRole('button', { name: 'Back to leads', exact: true }).click();
    await expect(rowB).toBeFocused();
    // A disappearing owned row may recover focus, but filtering from search must not steal it.
    await search.fill('no-synthetic-match'); await expect(visibleRows(page)).toHaveCount(0);
    await expect(search).toBeFocused();
    await search.fill('Synthetic'); await expect(visibleRows(page)).toHaveCount(10);
    await rows.first().focus();
    await page.evaluate(() => {
      const input = document.querySelector('.pbk-leads-search input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'no-synthetic-match');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(visibleRows(page)).toHaveCount(0); await expect(search).toBeFocused();
    await search.fill('Synthetic Seller 63');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(visibleRows(page)).toHaveCount(1);
    await visibleRows(page).first().click();
    if (width < 721) await page.getByRole('link', { name: 'Open workspace for Synthetic Seller 63', exact: true }).click();
    else await page.getByRole('button', { name: 'Open lead', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Synthetic Seller 63', level: 1, exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${evidence}/long-id-${type.name()}-${width}.png` });
    assert.equal(await page.evaluate(() => localStorage.getItem('pbk:compose:draft')), compose);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), analyzerKey), analyzer);
    const rejections = await verifyRejections(page, writes);
    assert.equal(rejections, 5);
    assert.deepEqual(denied.splice(0), [[403, '/api/leads'], [403, '/api/lead/send-message'], [403, '/api/leads/SYN-WORK-000'], [403, '/invoke'], [403, '/api/contract/send']]);
    if (type === chromium && width === 1440) await verifyEvidenceNegativeControls(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('pbk:compose:draft')), compose);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), analyzerKey), analyzer);
    assert.deepEqual(operatorLeadFixtures, initial, 'Additional server-fixture immutability check only');
    assert.deepEqual({ foreign, writes, errors, denied, lookups }, { foreign: [], writes: [], errors: [], denied: [], lookups: [] });
    console.log(`${type.name()} ${width}px: membership, focus, selection, anchors, return, recovery, browser manual/comps/parcel evidence before+after return, raw drafts; 5 cancellations + 5 exact mocked rejections; zero unexpected/foreign/provider/write/page-error traffic`);
  } catch (error) { console.error(error.stack); throw new Error(error.message); }
  finally { await browser.close(); }
}
try {
  assert.equal((await fetch(origin + '/api/leads', { headers: { Origin: 'https://example.invalid' } })).status, 403, 'Foreign origins cannot read fixtures');
  for (const [method, path, status] of [['GET', '/api/not-allowlisted', 404], ['GET', '/api/leads/foreign/full', 404], ['POST', '/invoke', 403], ['POST', '/api/leads', 403], ['PATCH', '/api/leads/SYN-WORK-000', 403], ['POST', '/api/property-data/attom-preview', 403]]) {
    assert.equal((await fetch(origin + path, { method })).status, status, `Preview denies ${method} ${path}`);
  }
  for (const type of [chromium, webkit]) for (const width of [1440, 390, 320]) await verify(type, width);
} finally { server.httpServer?.closeAllConnections(); await server.close(); }
