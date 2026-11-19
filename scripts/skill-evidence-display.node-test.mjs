import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readRecordedCount,
  readSkillEvidenceDisplay,
  formatSkillMetric,
  getSkillStageDisplay,
} from '../src/app/utils/skillEvidenceDisplay.mjs';

const unknown = {
  usageCount: null,
  successPercent: null,
  confidencePercent: null,
  changePercent: null,
  lastTriggeredAt: null,
};
const timestamp = '2026-11-18T12:34:56Z';
const labels = Object.freeze({ candidate: 'Candidate', testing: 'Testing', active: 'Live' });
const steps = Object.freeze({ candidate: 0, testing: 1, active: 6 });

test('counts distinguish absent evidence from measured zero and accept numeric strings', () => {
  for (const [input, expected] of [
    [0, 0],
    ['0', 0],
    [' 42 ', 42],
    [42, 42],
    ['2e2', 200],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ]) {
    assert.equal(readRecordedCount(input), expected);
  }
  assert.equal(readSkillEvidenceDisplay({}).usageCount, null);
  assert.equal(readSkillEvidenceDisplay({ usageCount: 0 }).usageCount, 0);
});

test('counts reject missing, coercible, negative, fractional, unsafe and nonfinite values', () => {
  for (const value of [
    undefined,
    null,
    '',
    '  ',
    true,
    false,
    [],
    [1],
    {},
    new Number(2),
    1n,
    Symbol('count'),
    -1,
    '-1',
    0.5,
    '1.5',
    NaN,
    Infinity,
    -Infinity,
    'NaN',
    'Infinity',
    Number.MAX_SAFE_INTEGER + 1,
    '9007199254740992',
  ]) {
    assert.equal(readRecordedCount(value), null, String(value));
  }
});

test('nonrecord items provide no evidence', () => {
  for (const value of [undefined, null, false, 0, 'skill', [], [{ usageCount: 2 }]]) {
    assert.deepEqual(readSkillEvidenceDisplay(value), unknown);
  }
});

// Ordered fixtures mirror getSkillPerformance's public evidence aliases, not its defaults.
const aliasGroups = [
  [
    'usageCount',
    8,
    8,
    [
      'usageCount',
      'usage_count',
      'uses',
      'totalUses',
      'outcomes.usageCount',
      'outcomes.uses',
      'metrics.usageCount',
      'metrics.uses',
    ],
  ],
  [
    'successPercent',
    0.75,
    75,
    [
      'successRate',
      'success_rate',
      'outcomes.successRate',
      'outcomes.success_rate',
      'metrics.successRate',
    ],
  ],
  [
    'confidencePercent',
    0.8,
    80,
    [
      'confidence',
      'confidenceScore',
      'confidence_score',
      'outcomes.confidence',
      'metrics.confidence',
    ],
  ],
  [
    'changePercent',
    -0.2,
    -20,
    [
      'confidenceDelta',
      'confidence_delta',
      'weeklyDelta',
      'weekly_delta',
      'outcomes.confidenceDelta',
      'metrics.confidenceDelta',
    ],
  ],
  [
    'lastTriggeredAt',
    timestamp,
    timestamp,
    [
      'lastTriggeredAt',
      'last_triggered_at',
      'lastUsedAt',
      'last_used_at',
      'outcomes.lastTriggeredAt',
      'metrics.lastTriggeredAt',
    ],
  ],
];

function put(record, path, value) {
  const [container, key] = path.split('.');
  if (key) (record[container] ??= {})[key] = value;
  else record[container] = value;
}

for (const [field, value, expected, aliases] of aliasGroups) {
  test(`${field} accepts each route alias in its documented order`, () => {
    for (let index = 0; index < aliases.length; index++) {
      const item = {};
      for (let earlier = 0; earlier < index; earlier++) put(item, aliases[earlier], ' ');
      put(item, aliases[index], value);
      for (let later = index + 1; later < aliases.length; later++) {
        put(item, aliases[later], field === 'lastTriggeredAt' ? '2025-01-01T00:00:00Z' : 0);
      }
      assert.equal(readSkillEvidenceDisplay(item)[field], expected, aliases[index]);
    }
  });

  test(`${field} never replaces a malformed first-present alias`, () => {
    for (let index = 0; index < aliases.length; index++) {
      for (const malformed of ['invalid', false, [], {}, NaN, Infinity]) {
        const item = { usageCount: 10, wins: 8, losses: 2 };
        if (field === 'usageCount') delete item.usageCount;
        put(item, aliases[index], malformed);
        for (let later = index + 1; later < aliases.length; later++)
          put(item, aliases[later], value);
        assert.equal(readSkillEvidenceDisplay(item)[field], null, aliases[index]);
      }
    }
  });
}

test('absent null and blank aliases allow later evidence, but zero takes precedence', () => {
  assert.equal(
    readSkillEvidenceDisplay({ usageCount: null, usage_count: '', uses: ' ', totalUses: '3' })
      .usageCount,
    3
  );
  assert.equal(
    readSkillEvidenceDisplay({ confidence: 0, confidenceScore: 80 }).confidencePercent,
    0
  );
  assert.equal(
    readSkillEvidenceDisplay({ successRate: 0, wins: 8, losses: 2, usageCount: 10 }).successPercent,
    0
  );
});

test('outcomes and metrics retain their independent truthy container precedence', () => {
  for (const container of ['outcomes', 'outcomeStats', 'performance']) {
    assert.equal(readSkillEvidenceDisplay({ [container]: { uses: 7 } }).usageCount, 7);
  }
  for (const container of ['metrics', 'analytics', 'skillMetrics']) {
    assert.equal(readSkillEvidenceDisplay({ [container]: { uses: 9 } }).usageCount, 9);
  }
  assert.equal(
    readSkillEvidenceDisplay({
      outcomes: { uses: 7 },
      outcomeStats: { uses: 8 },
      performance: { uses: 9 },
    }).usageCount,
    7
  );
  assert.equal(
    readSkillEvidenceDisplay({
      metrics: { uses: 7 },
      analytics: { uses: 8 },
      skillMetrics: { uses: 9 },
    }).usageCount,
    7
  );
  for (const selected of [{}, [], true, 'invalid']) {
    assert.equal(
      readSkillEvidenceDisplay({ outcomes: selected, outcomeStats: { uses: 8 } }).usageCount,
      null
    );
    assert.equal(
      readSkillEvidenceDisplay({ metrics: selected, analytics: { uses: 8 } }).usageCount,
      null
    );
  }
  assert.equal(
    readSkillEvidenceDisplay({ outcomes: null, outcomeStats: { uses: 8 } }).usageCount,
    8
  );
  assert.equal(readSkillEvidenceDisplay({ metrics: false, analytics: { uses: 9 } }).usageCount, 9);
  assert.equal(
    readSkillEvidenceDisplay({ outcomes: { uses: 7 }, metrics: { uses: 9 } }).usageCount,
    7
  );
});

for (const field of ['successRate', 'confidence']) {
  test(`${field} uses fraction/percent boundaries without clamping`, () => {
    const result = field === 'successRate' ? 'successPercent' : 'confidencePercent';
    for (const [value, expected] of [
      [0, 0],
      [0.8, 80],
      ['0.8', 80],
      [1, 100],
      [1.01, 1.01],
      [80, 80],
      ['100', 100],
      [-0.01, null],
      [100.01, null],
      [101, null],
      [NaN, null],
      [Infinity, null],
      [-Infinity, null],
      [true, null],
    ]) {
      assert.equal(readSkillEvidenceDisplay({ [field]: value })[result], expected);
    }
  });
}

test('signed changes use analogous fraction/percent boundaries without clamping', () => {
  for (const [value, expected] of [
    [-100, -100],
    [-1.01, -1.01],
    [-1, -100],
    ['-0.2', -20],
    [0, 0],
    [0.2, 20],
    [1, 100],
    [1.01, 1.01],
    [100, 100],
    [-100.01, null],
    [100.01, null],
    [NaN, null],
    [Infinity, null],
    [false, null],
  ]) {
    assert.equal(readSkillEvidenceDisplay({ confidenceDelta: value }).changePercent, expected);
  }
});

test('success derives only from positive known usage and two valid recorded counts', () => {
  assert.equal(readSkillEvidenceDisplay({ usageCount: 10, wins: 8, losses: 2 }).successPercent, 80);
  assert.equal(readSkillEvidenceDisplay({ usageCount: 10, wins: 0, losses: 2 }).successPercent, 0);
  assert.equal(
    readSkillEvidenceDisplay({ usageCount: '10', wins: '8', losses: '0' }).successPercent,
    100
  );
  assert.equal(
    readSkillEvidenceDisplay({
      usageCount: 10,
      successRate: ' ',
      success_rate: null,
      wins: 8,
      losses: 2,
    }).successPercent,
    80
  );
  for (const overrides of [
    { usageCount: 0 },
    { usageCount: null },
    { usageCount: -1 },
    { wins: null },
    { losses: null },
    { wins: -1 },
    { losses: 0.5 },
    { wins: 0, losses: 0 },
    { wins: Number.MAX_SAFE_INTEGER, losses: 2 },
    { successRate: 'bad' },
    { success_rate: 101 },
    { successRate: false },
  ]) {
    assert.equal(
      readSkillEvidenceDisplay({ usageCount: 10, wins: 8, losses: 2, ...overrides }).successPercent,
      null
    );
  }
});

for (const [field, aliases, counterpart] of [
  ['wins', ['wins', 'successes', 'outcomes.wins', 'outcomes.successes', 'metrics.wins'], 'losses'],
  [
    'losses',
    ['losses', 'failures', 'outcomes.losses', 'outcomes.failures', 'metrics.losses'],
    'wins',
  ],
]) {
  test(`derived success respects every ordered ${field} alias and malformed precedence`, () => {
    for (let index = 0; index < aliases.length; index++) {
      const item = { usageCount: 10, [counterpart]: 2 };
      for (let earlier = 0; earlier < index; earlier++) put(item, aliases[earlier], null);
      put(item, aliases[index], 8);
      for (let later = index + 1; later < aliases.length; later++) put(item, aliases[later], 2);
      assert.equal(readSkillEvidenceDisplay(item).successPercent, field === 'wins' ? 80 : 20);
      put(item, aliases[index], 'bad');
      assert.equal(readSkillEvidenceDisplay(item).successPercent, null);
    }
  });
}

test('timestamps must be parseable strings and preserve the recorded value after trimming', () => {
  assert.equal(
    readSkillEvidenceDisplay({ lastTriggeredAt: ` ${timestamp} ` }).lastTriggeredAt,
    timestamp
  );
  assert.equal(
    readSkillEvidenceDisplay({ lastTriggeredAt: null, lastUsedAt: timestamp }).lastTriggeredAt,
    timestamp
  );
  for (const value of [
    'not-a-date',
    '2026-13-99T99:00:00Z',
    0,
    true,
    [],
    {},
    new Date(timestamp),
  ]) {
    assert.equal(
      readSkillEvidenceDisplay({ lastTriggeredAt: value, lastUsedAt: timestamp }).lastTriggeredAt,
      null
    );
  }
});

test('formatting distinguishes unknown and zero, and never invents a period', () => {
  for (const kind of ['count', 'percent', 'change']) {
    assert.equal(formatSkillMetric(null, kind), 'Not recorded');
  }
  for (const [value, kind, expected] of [
    [0, 'count', '0'],
    [1234, 'count', '1234'],
    [0, 'percent', '0%'],
    [0.8, 'percent', '1%'],
    [80, 'percent', '80%'],
    [0, 'change', '0%'],
    [-0, 'change', '0%'],
    [20, 'change', '+20%'],
    [-20, 'change', '-20%'],
    [1.4, 'change', '+1%'],
  ]) {
    assert.equal(formatSkillMetric(value, kind), expected);
  }
});

test('lifecycle maps accept own keys and known integer indices including zero and six', () => {
  assert.deepEqual(getSkillStageDisplay('candidate', labels, steps), {
    label: 'Candidate',
    index: 0,
  });
  assert.deepEqual(getSkillStageDisplay('testing', labels, steps), { label: 'Testing', index: 1 });
  assert.deepEqual(getSkillStageDisplay('active', labels, steps), { label: 'Live', index: 6 });
  for (const index of [2, 3, 4, 5]) {
    assert.deepEqual(getSkillStageDisplay('testing', labels, { testing: index }), {
      label: 'Testing',
      index,
    });
  }
});

test('unknown lifecycle and prototype names cannot imply a completed or initial stage', () => {
  for (const state of [
    undefined,
    null,
    '',
    ' active ',
    'ACTIVE',
    'future',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    0,
    true,
    [],
    {},
    Symbol('active'),
  ]) {
    assert.deepEqual(getSkillStageDisplay(state, labels, steps), { label: 'Unknown', index: null });
  }
  assert.deepEqual(getSkillStageDisplay('active', Object.create(labels), steps), {
    label: 'Unknown',
    index: null,
  });
  assert.deepEqual(getSkillStageDisplay('active', labels, Object.create(steps)), {
    label: 'Unknown',
    index: null,
  });
  for (const index of [-1, 7, 0.5, NaN, Infinity, '6', null, undefined]) {
    assert.deepEqual(getSkillStageDisplay('active', labels, { active: index }), {
      label: 'Unknown',
      index: null,
    });
  }
});

test('deeply frozen input evidence and lifecycle maps are never mutated', () => {
  const item = Object.freeze({
    usageCount: '10',
    outcomes: Object.freeze({ wins: 8, losses: 2 }),
    metrics: Object.freeze({ confidence: 0.8, confidenceDelta: -0.2, lastTriggeredAt: timestamp }),
  });
  const before = structuredClone(item);
  assert.deepEqual(readSkillEvidenceDisplay(item), {
    usageCount: 10,
    successPercent: 80,
    confidencePercent: 80,
    changePercent: -20,
    lastTriggeredAt: timestamp,
  });
  assert.deepEqual(item, before);
  assert.deepEqual(getSkillStageDisplay('candidate', labels, steps), {
    label: 'Candidate',
    index: 0,
  });
  assert.deepEqual(labels, { candidate: 'Candidate', testing: 'Testing', active: 'Live' });
  assert.deepEqual(steps, { candidate: 0, testing: 1, active: 6 });
});
