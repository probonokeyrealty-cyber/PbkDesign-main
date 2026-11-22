import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';
import {
  calculateFlipDecision,
  decisionEvidenceVersion,
  normalizeDecisionScenario,
  addDecisionScenario,
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
    const save = (scenario, expectedPropertyAddress = address) =>
      request(path, 'PATCH', {
        expectedPropertyAddress,
        investorDecisionScenario: scenario,
      });
    assert.equal((await save(draft, { ...address, street: '27 PBK Test Lane' })).status, 409);
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
