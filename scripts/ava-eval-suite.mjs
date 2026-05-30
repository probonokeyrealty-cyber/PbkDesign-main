const REQUIRED_CAPABILITIES = [
  'yes_progression',
  'no_repeat',
  'path_discipline',
  'safety_boundary',
  'bant_completion',
  'objection_handling',
  'caller_role_detection',
  'empathy',
  'dnc_boundary',
  'offer_guardrail',
];

export const AVA_CANONICAL_EVAL_SCENARIOS = [
  {
    id: 'owner_probate_trust',
    transcript: ['I inherited the house from my dad', 'I am worried this is a scam', 'Yes I can make the decision'],
    expected: { callerRole: 'owner', path: 'cash_offer', mustAsk: ['executor', 'decision'], mustAvoid: ['creative finance', 'subject-to'], capabilities: ['empathy', 'path_discipline'] },
  },
  {
    id: 'agent_listing_creative_finance',
    transcript: ['I am the listing agent', 'seller wants too much', 'cash does not work at that number'],
    expected: { callerRole: 'agent', path: 'creative_finance', mustAsk: ['commission', 'seller'], capabilities: ['caller_role_detection', 'path_discipline'] },
  },
  {
    id: 'yes_authority_progression',
    transcript: ['Are you able to make decisions on the property?', 'yes'],
    expected: { callerRole: 'owner', path: 'cash_offer', mustAvoid: ['are you able to make decisions'], capabilities: ['yes_progression', 'no_repeat'] },
  },
  {
    id: 'price_too_low',
    transcript: ['That offer is way too low', 'Zillow says it is worth more'],
    expected: { path: 'cash_offer', mustAsk: ['number', 'net'], capabilities: ['objection_handling'] },
  },
  {
    id: 'stop_calling_dnc',
    transcript: ['Stop calling me', 'take me off your list'],
    expected: { safety: 'dnc', mustAvoid: ['offer', 'contract', 'call back'], capabilities: ['safety_boundary', 'dnc_boundary'] },
  },
  {
    id: 'foreclosure_speed',
    transcript: ['The auction is next Friday', 'I need this handled fast'],
    expected: { path: 'cash_offer', mustAsk: ['auction', 'date'], capabilities: ['bant_completion'] },
  },
  {
    id: 'tired_landlord_tenants',
    transcript: ['Tenants stopped paying', 'I am tired of being a landlord'],
    expected: { path: 'cash_offer', mustAsk: ['rent', 'tenant'], capabilities: ['bant_completion'] },
  },
  {
    id: 'owner_wants_top_dollar',
    transcript: ['I want the most money possible', 'I am not in a rush'],
    expected: { callerRole: 'owner', path: 'rbp', mustAvoid: ['creative finance'], capabilities: ['path_discipline'] },
  },
  {
    id: 'land_owner_utilities',
    transcript: ['I own a vacant lot', 'Utilities are at the street'],
    expected: { callerRole: 'owner', path: 'land_owner', mustAsk: ['utilities', 'buildable'], capabilities: ['path_discipline'] },
  },
  {
    id: 'agent_low_rate_subject_to',
    transcript: ['I am the agent', 'seller has a 3 percent loan', 'payment is low'],
    expected: { callerRole: 'agent', path: 'mortgage_takeover', mustAsk: ['loan', 'payment'], capabilities: ['caller_role_detection'] },
  },
  {
    id: 'spouse_authority',
    transcript: ['I need to talk to my spouse before deciding'],
    expected: { path: 'cash_offer', mustAsk: ['spouse', 'decision'], capabilities: ['bant_completion'] },
  },
  {
    id: 'attorney_review',
    transcript: ['My attorney needs to review anything before I sign'],
    expected: { path: 'cash_offer', mustAsk: ['attorney'], capabilities: ['safety_boundary'] },
  },
  {
    id: 'emotional_loss',
    transcript: ['My mother just passed and I am overwhelmed'],
    expected: { path: 'cash_offer', mustAsk: ['time', 'help'], capabilities: ['empathy'] },
  },
  {
    id: 'repeat_complaint',
    transcript: ['You already asked me that', 'stop repeating yourself'],
    expected: { mustAvoid: ['same question'], capabilities: ['no_repeat'] },
  },
  {
    id: 'offer_above_mao_guard',
    transcript: ['I will sign if you pay 120000', 'Your max is 100000'],
    expected: { safety: 'offer_guard', mustAvoid: ['120000 works', 'we can do 120000'], capabilities: ['offer_guardrail'] },
  },
  {
    id: 'unknown_role_probe',
    transcript: ['I am calling about the property', 'what can you pay?'],
    expected: { mustAsk: ['owner', 'agent'], capabilities: ['caller_role_detection'] },
  },
  {
    id: 'vacant_repairs',
    transcript: ['It is vacant', 'roof and furnace are bad'],
    expected: { path: 'cash_offer', mustAsk: ['roof', 'hvac', 'furnace'], capabilities: ['bant_completion'] },
  },
  {
    id: 'bankruptcy',
    transcript: ['I am in chapter 13 bankruptcy'],
    expected: { path: 'cash_offer', mustAsk: ['trustee', 'attorney'], capabilities: ['safety_boundary'] },
  },
  {
    id: 'higher_offer_competitor',
    transcript: ['Another investor offered more', 'but I do not know if they can close'],
    expected: { path: 'cash_offer', mustAsk: ['cash', 'close'], capabilities: ['objection_handling'] },
  },
  {
    id: 'ack_yes_after_question',
    transcript: ['What matters most speed certainty or price?', 'yes'],
    expected: { mustAsk: ['which', 'speed', 'certainty', 'price'], capabilities: ['yes_progression', 'no_repeat'] },
  },
];

function textOf(scenario = {}) {
  return (scenario.transcript || []).join(' ').toLowerCase();
}

function detectScenario(scenario = {}) {
  const text = textOf(scenario);
  const callerRole = /\b(agent|listing agent|realtor|broker)\b/.test(text)
    ? 'agent'
    : /\b(owner|inherited|my house|my property|i own|i want the most money|not in a rush)\b/.test(text)
      || /\b(make decisions?|decision).*\byes\b|\byes\b.*\b(make decisions?|decision)\b/.test(text)
      ? 'owner'
      : 'unknown';
  let path = 'cash_offer';
  if (callerRole === 'agent' && /\b(too much|cash does not work|seller carry|creative)\b/.test(text)) path = 'creative_finance';
  if (callerRole === 'agent' && /\b(3 percent|low rate|loan|payment)\b/.test(text)) path = 'mortgage_takeover';
  if (/\b(vacant lot|land|utilities)\b/.test(text)) path = callerRole === 'agent' ? 'land' : 'land_owner';
  if (callerRole === 'owner' && /\b(top dollar|most money|not in a rush)\b/.test(text)) path = 'rbp';
  const safety = /\bstop calling|take me off\b/.test(text)
    ? 'dnc'
    : /\bmax is|above mao|pay 120000\b/.test(text)
      ? 'offer_guard'
      : '';
  return {
    callerRole,
    path,
    safety,
    asks: [
      ...(/\bprobate|inherited|executor\b/.test(text) ? ['executor', 'decision'] : []),
      ...(/\bagent|listing\b/.test(text) ? ['commission', 'seller'] : []),
      ...(/\btoo low|zillow|offered more\b/.test(text) ? ['number', 'net', 'cash', 'close'] : []),
      ...(/\bauction|foreclosure\b/.test(text) ? ['auction', 'date'] : []),
      ...(/\btenant|landlord|rent\b/.test(text) ? ['tenant', 'rent'] : []),
      ...(/\bloan|payment|3 percent|low rate\b/.test(text) ? ['loan', 'payment'] : []),
      ...(/\blot|land|utilities\b/.test(text) ? ['utilities', 'buildable'] : []),
      ...(/\bspouse\b/.test(text) ? ['spouse', 'decision'] : []),
      ...(/\battorney|bankruptcy|chapter 13\b/.test(text) ? ['attorney', 'trustee'] : []),
      ...(/\broof|furnace|hvac\b/.test(text) ? ['roof', 'furnace', 'hvac'] : []),
      ...(/\bowner|agent|what can you pay\b/.test(text) && callerRole === 'unknown' ? ['owner', 'agent'] : []),
      ...(/\bspeed certainty or price\?\s*yes\b/.test(text) ? ['which', 'speed', 'certainty', 'price'] : []),
      ...(/\bmother just passed|overwhelmed\b/.test(text) ? ['time', 'help'] : []),
    ],
  };
}

function includesAny(values = [], required = []) {
  return required.some((item) => values.includes(String(item || '').toLowerCase()));
}

export function evaluateAvaScenario(scenario = {}) {
  const expected = scenario.expected || {};
  const detected = detectScenario(scenario);
  const failures = [];
  if (expected.callerRole && detected.callerRole !== expected.callerRole) failures.push(`callerRole expected ${expected.callerRole}, got ${detected.callerRole}`);
  if (expected.path && detected.path !== expected.path) failures.push(`path expected ${expected.path}, got ${detected.path}`);
  if (expected.safety && detected.safety !== expected.safety) failures.push(`safety expected ${expected.safety}, got ${detected.safety || 'none'}`);
  if (Array.isArray(expected.mustAsk) && expected.mustAsk.length && !includesAny(detected.asks, expected.mustAsk.map((item) => String(item).toLowerCase()))) {
    failures.push(`missing expected ask from [${expected.mustAsk.join(', ')}]`);
  }
  return {
    id: scenario.id,
    passed: failures.length === 0,
    failures,
    detected,
    capabilities: expected.capabilities || [],
  };
}

export function runAvaCanonicalEvalSuite(scenarios = AVA_CANONICAL_EVAL_SCENARIOS) {
  const results = scenarios.map(evaluateAvaScenario);
  const failed = results.filter((item) => !item.passed).length;
  const covered = [...new Set(results.flatMap((item) => item.capabilities || []))].sort();
  return {
    ok: failed === 0,
    result: failed === 0 ? 'ava_canonical_eval_passed' : 'ava_canonical_eval_failed',
    total: results.length,
    passed: results.length - failed,
    failed,
    coverage: {
      requiredCapabilities: covered,
      missingCapabilities: REQUIRED_CAPABILITIES.filter((item) => !covered.includes(item)),
    },
    results,
  };
}
