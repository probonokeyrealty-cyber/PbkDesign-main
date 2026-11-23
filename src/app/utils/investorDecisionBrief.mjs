import { compDate } from './leadComps.mjs';

export const maxDecisionScenarios = 30;
export const decisionInputLimits = {
  asIs: [0, 1e9],
  arv: [0.01, 1e9],
  rent: [0, 1e9],
  rehab: [0, 1e9],
  closing: [0, 1e9],
  monthlyCarry: [0, 1e9],
  months: [0, 600],
  sellingPercent: [0, 99.99],
  targetProfit: [0, 1e9],
  resaleDrop: [0, 100],
  extraRehab: [0, 1e9],
  extraMonths: [0, 600],
};
const baseKeys = [
  'arv',
  'rehab',
  'closing',
  'monthlyCarry',
  'months',
  'sellingPercent',
  'targetProfit',
];
const stressKeys = ['resaleDrop', 'extraRehab', 'extraMonths'];
const bounded = (value, [min, max] = [0, 1e9]) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : null;
};
const round = (value) => Math.round(value * 100) / 100;
const clean = (value, size) => (typeof value === 'string' ? value.trim().slice(0, size) : '');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function calculateFlipDecision(inputs, askingPrice) {
  const n = (key) => bounded(inputs[key], decisionInputLimits[key]);
  const missing = baseKeys.filter((key) => n(key) === null);
  const missingDownside = stressKeys.filter((key) => n(key) === null);
  if (missing.length) return { base: null, downside: null, missing, missingDownside };
  const asking = bounded(askingPrice, [0.01, 1e9]);
  const calculate = (resale, rehab, months) => {
    const netSale = resale * (1 - n('sellingPercent') / 100);
    const costs = rehab + n('closing') + n('monthlyCarry') * months;
    return {
      ceiling: round(netSale - costs - n('targetProfit')),
      profit: asking === null ? null : round(netSale - costs - asking),
      cash: asking === null ? null : round(asking + costs),
    };
  };
  const base = calculate(n('arv'), n('rehab'), n('months'));
  const downside = missingDownside.length
    ? null
    : calculate(
        n('arv') * (1 - n('resaleDrop') / 100),
        n('rehab') + n('extraRehab'),
        n('months') + n('extraMonths')
      );
  return { base, downside, missing, missingDownside };
}

export function decisionEvidenceVersion(records, sales, selectedSales) {
  const snapshot = JSON.stringify(
    [
      records ?? null,
      sales?.retrievedAt ?? null,
      [...selectedSales].sort((a, b) => a.id.localeCompare(b.id)),
    ],
    (_key, value) =>
      record(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]])
          )
        : value
  );
  // FNV-1a is a compact change marker. It provides no authorization.
  let version = 0xcbf29ce484222325n;
  for (let index = 0; index < snapshot.length; index++) {
    version = BigInt.asUintN(64, (version ^ BigInt(snapshot.charCodeAt(index))) * 0x100000001b3n);
  }
  return version.toString(16).padStart(16, '0');
}

function normalizeComp(comp) {
  if (!record(comp) || !['asIs', 'arv', 'rent'].includes(comp.basis)) return null;
  const label = clean(comp.label, 200);
  const source = clean(comp.source, 200);
  const amount = bounded(comp.amount, [0.01, 1e9]);
  const date = compDate(comp.date);
  const saleId = clean(comp.saleId, 160);
  if (!label || !source || amount === null || !date || (comp.basis === 'rent' && saleId))
    return null;
  return {
    basis: comp.basis,
    label,
    source,
    amount,
    date,
    saleId,
    condition: clean(comp.condition, 240),
    rationale: clean(comp.rationale, 400),
  };
}

function normalizeCheck(check) {
  if (!record(check)) return null;
  const title = clean(check.title, 120);
  const source = clean(check.source, 240);
  const owner = clean(check.owner, 100);
  const due = compDate(check.due);
  if (!title || (check.due && !due) || (check.verified === true && !source)) return null;
  return { title, source, owner, due, verified: check.verified === true };
}

export function normalizeDecisionScenario(value, savedAt = value?.savedAt) {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.id) ||
    typeof value.evidence !== 'string' ||
    !/^[a-f0-9]{16}$/.test(value.evidence) ||
    !Number.isFinite(Date.parse(savedAt)) ||
    !record(value.inputs)
  )
    return null;
  const name = clean(value.name, 80);
  if (
    !name ||
    !Array.isArray(value.comps) ||
    value.comps.length > 12 ||
    !Array.isArray(value.checks) ||
    value.checks.length > 12
  )
    return null;
  const entries = Object.entries(decisionInputLimits).map(([key, range]) => [
    key,
    bounded(value.inputs[key], range),
  ]);
  if (
    entries.some(
      ([key, number]) => number === null && value.inputs[key] != null && value.inputs[key] !== ''
    )
  )
    return null;
  const comps = value.comps.map(normalizeComp);
  const checks = value.checks.map(normalizeCheck);
  if (comps.includes(null) || checks.includes(null)) return null;
  return {
    id: value.id,
    name,
    savedAt,
    evidence: value.evidence,
    askingPrice: bounded(value.askingPrice, [0.01, 1e9]),
    inputs: Object.fromEntries(entries),
    comps,
    checks,
  };
}

export function readDecisionScenarios(value) {
  return Array.isArray(value)
    ? value
        .slice(0, maxDecisionScenarios)
        .map((scenario) => normalizeDecisionScenario(scenario))
        .filter(Boolean)
    : [];
}

export function addDecisionScenario(current, scenario) {
  if (current.some(({ id }) => id === scenario.id)) return current;
  if (current.length >= maxDecisionScenarios) return null;
  return [scenario, ...current];
}
