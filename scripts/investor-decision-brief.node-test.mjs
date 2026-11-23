import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';
import {
  calculateFlipDecision,
  decisionEvidenceVersion,
  normalizeDecisionScenario,
  addDecisionScenario,
  readDecisionScenarios,
} from '../src/app/utils/investorDecisionBrief.mjs';

const inputs = {
  arv: 300000,
  rehab: 30000,
  closing: 5000,
  monthlyCarry: 1000,
  months: 6,
  sellingPercent: 6,
  targetProfit: 25000,
  resaleDrop: 10,
  extraRehab: 10000,
  extraMonths: 3,
};
const sale = { id: 'comp-a', address: '1 Example St', soldDate: '2026-09-01', price: 290000 };
const evidence = decisionEvidenceVersion(
  { retrievedAt: '2026-11-01', facts: { apn: 'sample' } },
  { retrievedAt: '2026-11-02' },
  [sale]
);
const draft = {
  id: '7b7d6c8b-7333-413f-8213-40cf530988bb',
  name: 'Base flip',
  inputs,
  evidence,
  askingPrice: 216000,
  comps: [],
  checks: [],
};
const normalize = (value) => normalizeDecisionScenario(value, '2026-11-22T01:00:00.000Z');

test('flip ceilings combine price, cost and time changes without hiding a loss', () => {
  const { base, downside } = calculateFlipDecision(inputs, 216000);
  assert.deepEqual(base, { ceiling: 216000, profit: 25000, cash: 257000 });
  assert.deepEqual(downside, { ceiling: 174800, profit: -16200, cash: 270000 });
  assert.equal(calculateFlipDecision(inputs, null).base.profit, null);
  assert.equal(calculateFlipDecision({ ...inputs, months: '' }, 216000).base, null);
  assert.equal(calculateFlipDecision({ ...inputs, extraMonths: '' }, 216000).downside, null);
  assert.equal(calculateFlipDecision({ ...inputs, targetProfit: 0 }, 216000).base.ceiling, 241000);
});

test('evidence versions change on a record or comp change, even at the same capture time', () => {
  const record = { retrievedAt: '2026-11-01', facts: { apn: 'sample' } };
  const sales = { retrievedAt: '2026-11-02' };
  assert.equal(evidence, decisionEvidenceVersion(record, sales, [sale]));
  assert.notEqual(evidence, decisionEvidenceVersion(record, sales, [{ ...sale, price: 285000 }]));
  assert.notEqual(
    evidence,
    decisionEvidenceVersion({ ...record, facts: { apn: 'other' } }, sales, [sale])
  );
});

test('scenario save is bounded, preserves prior versions, and is retry-safe', () => {
  const saved = normalize({
    ...draft,
    arv: 1,
    inputs: { ...inputs, rehab: '30000', unsupported: 1 },
  });
  assert.equal(saved.inputs.rehab, 30000);
  assert.equal(saved.inputs.unsupported, undefined);
  assert.equal(saved.arv, undefined);
  assert.equal(saved.savedAt, '2026-11-22T01:00:00.000Z');
  assert.equal(normalize({ ...draft, inputs: { ...inputs, sellingPercent: 100 } }), null);
  assert.equal(normalize({ ...draft, name: '   ' }), null);
  assert.equal(normalize({ ...draft, checks: [{ title: 'Roof', due: '2026-02-31' }] }), null);
  const later = normalize({
    ...draft,
    id: '7b7d6c8b-7333-413f-8213-40cf530988bc',
    name: 'After bid',
  });
  assert.deepEqual(addDecisionScenario([saved], later), [later, saved]);
  assert.deepEqual(addDecisionScenario([saved], { ...saved, savedAt: '2026-11-23' }), [saved]);
});

test('the bridge saves to the exact lead and preserves concurrent versions and offer figures', async () => {
  const bridge = await startIsolatedBridge({ startupMs: 30_000 });
  const request = (path, method = 'GET', body) =>
    bridge.fetch(bridge.origin + path, {
      method,
      headers: { Authorization: `Bearer ${bridge.apiKey}`, 'Content-Type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
    });
  const address = { street: '26 PBK Test Lane', city: 'Orlando', state: 'FL', zip: '32801' };
  const create = async (id, name) => {
    const response = await request('/api/leads', 'POST', {
      id,
      leadId: id,
      eventId: id,
      seller: { name },
      property: {
        address: address.street,
        city: address.city,
        state: address.state,
        zip: address.zip,
        arv: 310000,
        mao: 171000,
      },
    });
    assert.equal(response.status, 200);
    return (await response.json()).leadId;
  };
  try {
    const first = await create('brief-fixture-1', 'Decision Brief QA One');
    const second = await create('brief-fixture-2', 'Decision Brief QA Two');
    assert.notEqual(first, second);
    const path = `/api/leads/${first}`;
    assert.equal((await request('/api/leads', 'POST', { deal: { investorDecisionScenarios: [draft] } })).status, 400);
    const save = (scenario, expectedPropertyAddress = address) =>
      request(path, 'PATCH', {
        expectedPropertyAddress,
        investorDecisionScenario: scenario,
      });
    assert.equal((await save(draft, { ...address, street: '27 PBK Test Lane' })).status, 409);
    assert.equal((await request(path, 'PATCH', { deal: { investorDecisionScenarios: [draft] } })).status, 400);
    const alternate = {
      ...draft,
      id: '7b7d6c8b-7333-413f-8213-40cf530988bd',
      name: 'Quote revision',
    };
    const results = await Promise.all([save(draft), save(alternate), save(draft)]);
    assert.deepEqual(
      results.map((result) => result.status),
      [200, 200, 200]
    );
    const after = (await (await request(path + '/full')).json()).lead;
    assert.deepEqual(after.deal.investorDecisionScenarios.map((item) => item.name).sort(), [
      'Base flip',
      'Quote revision',
    ]);
    assert.equal(after.property.arv, 310000);
    assert.equal(after.property.mao, 171000);
    const other = (await (await request(`/api/leads/${second}/full`)).json()).lead;
    assert.equal(other.deal?.investorDecisionScenarios, undefined);
  } finally {
    await bridge.stop();
  }
});

test('the production save path can write to a cold profile without changing another lead or other profile fields', async () => {
  const source = ts.createSourceFile('bridge.mjs', readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Set(['loadExactLeadProfile', 'loadLeadForFullView', 'parcelLeadFromProfileRow', 'saveInvestorDecisionScenario']);
  const statements = source.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && functions.has(statement.name?.text) ||
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some((d) => d.name.getText(source) === 'investorScenarioSaves')
  );
  assert.equal(statements.length, 5);
  const address = { street: '26 PBK Test Lane', city: 'Orlando', state: 'FL', zip: '32801' };
  const db = new PGlite();
  const state = { leadImports: [] };
  const getRows = async () => (await db.query('SELECT id, phone, raw FROM lead_profiles ORDER BY id')).rows;
  let failWrite = false;
  let writes = 0;
  const context = vm.createContext({
    state, address, draft, DATABASE_URL: 'embedded-fixture', IS_HOSTED: true,
    normalizeDecisionScenario, addDecisionScenario, readDecisionScenarios,
    isoNow: () => '2026-11-22T01:00:00.000Z',
    plainRecord: (value) => value ?? {},
    sameAttomAddress: (a, b) => ['street', 'city', 'state', 'zip'].every((key) => a[key] === b[key]),
    queryPgRows: async (sql, params) => {
      if (sql.startsWith('UPDATE')) {
        writes += 1;
        if (failWrite) return { ok: false, rows: [] };
      }
      return { ok: true, ...(await db.query(sql, params)) };
    },
  });
  try {
    await db.exec(`CREATE TABLE lead_profiles(id text PRIMARY KEY, workspace_id text, source text,
      status text, stage text, phone text, address text, lead_name text, city text, state text,
      postal_code text, raw jsonb, updated_at timestamptz);
      INSERT INTO lead_profiles(id, workspace_id, phone, address, city, state, postal_code, raw) VALUES
        ('exact', 'pbk', '5550101', '26 PBK Test Lane', 'Orlando', 'FL', '32801', '{"deal":{"mao":171000},"other":true}'),
        ('other', 'pbk', '5550102', '26 PBK Test Lane', 'Orlando', 'FL', '32801', '{"deal":{"mao":172000}}');`);
    vm.runInContext(statements.map((statement) => statement.getText(source)).join('\n'), context);
    const save = () => vm.runInContext('saveInvestorDecisionScenario("exact", address, draft)', context);
    const review = () => vm.runInContext('loadLeadForFullView("exact", { reviewOnly: true })', context);
    const legacyReview = await review();
    assert.equal(legacyReview.lead.leadId, 'exact');
    assert.equal(legacyReview.contactRestricted, false);
    const before = await getRows();
    failWrite = true;
    assert.equal((await save()).status, 503);
    assert.deepEqual(await getRows(), before);
    assert.equal(state.leadImports.length, 0);
    failWrite = false;
    assert.equal((await save()).status, 200);
    assert.equal((await save()).status, 200);
    assert.equal(writes, 2, 'replaying a successful save does not write again');
    const after = await getRows();
    assert.deepEqual(after[1], before[1]);
    assert.equal(after[0].phone, before[0].phone);
    assert.deepEqual(after[0].raw, {
      ...before[0].raw, deal: { ...before[0].raw.deal, investorDecisionScenarios: [normalize(draft)] },
    });
    const reopen = () => vm.runInContext('loadLeadForFullView("exact")', context);
    assert.deepEqual(Array.from((await reopen()).lead.deal.investorDecisionScenarios), [normalize(draft)]);
    state.leadImports = [{ id: 'exact', deal: { mao: 173000 }, property: { address: address.street } }];
    const restored = (await reopen()).lead;
    assert.deepEqual(Array.from(restored.deal.investorDecisionScenarios), [normalize(draft)]);
    assert.equal(restored.deal.mao, 173000, 'only the scenario field comes from the durable profile');
    assert.equal(restored.property.address, address.street);
    await db.exec("ALTER TABLE lead_profiles ADD COLUMN dnc boolean; UPDATE lead_profiles SET dnc = true WHERE id = 'exact';");
    assert.equal((await review()).contactRestricted, true, 'the review honors a durable DNC flag');
    assert.equal(writes, 2, 'the review does not write the profile');
  } finally {
    await db.close();
  }
});
