import {
  normalizeConversationEmail,
  normalizeConversationPhone,
  rankEligibleSenderIdentities,
} from './conversation-identity.mjs';

describe('conversation identity normalization', () => {
  test.each([
    ['(614) 555-0199', '+16145550199'],
    ['6145550199', '+16145550199'],
    ['16145550199', '+16145550199'],
    ['+1 (614) 555-0199', '+16145550199'],
    ['+45 12 34 56 78', '+4512345678'],
    ['44 20 7946 0958', '+442079460958'],
    ['', ''],
    [null, ''],
    ['not a phone', ''],
    ['abc123', ''],
    ['6145550199 x22', ''],
    ['123', ''],
    ['1234567890123456', ''],
  ])('normalizes phone value %p', (value, expected) => {
    expect(normalizeConversationPhone(value)).toBe(expected);
  });

  test.each([
    ['  Seller@Example.COM  ', 'seller@example.com'],
    ['', ''],
    [null, ''],
  ])('normalizes email value %p', (value, expected) => {
    expect(normalizeConversationEmail(value)).toBe(expected);
  });
});

describe('sender identity ranking', () => {
  test('fails closed unless lifecycle status normalizes to active', () => {
    const blockedStatuses = [
      'warming',
      'paused',
      'quarantined',
      'retired',
      'release_pending',
      'released',
    ];
    const identities = [
      { id: 'active', lifecycleStatus: 'active' },
      { id: 'normalized-active', lifecycleStatus: ' Active ' },
      { id: 'missing-status' },
      { id: 'misspelled-status', lifecycleStatus: 'actve' },
      { id: 'future-status', lifecycleStatus: 'provisioned' },
      ...blockedStatuses.map((lifecycleStatus) => ({ id: lifecycleStatus, lifecycleStatus })),
    ];

    expect(rankEligibleSenderIdentities(identities).map(({ id }) => id)).toEqual([
      'active',
      'normalized-active',
    ]);
  });

  test('rejects identities without a nonempty string id', () => {
    const ranked = rankEligibleSenderIdentities([
      { id: 'usable', lifecycleStatus: 'active' },
      { id: '', lifecycleStatus: 'active' },
      { id: '   ', lifecycleStatus: 'active' },
      { lifecycleStatus: 'active' },
      { id: null, lifecycleStatus: 'active' },
      { id: 42, lifecycleStatus: 'active' },
    ]);

    expect(ranked.map(({ id }) => id)).toEqual(['usable']);
  });

  test('prefers the previous sender identity using camelCase frontend fields', () => {
    const ranked = rankEligibleSenderIdentities(
      [
        { id: 'healthy', lifecycleStatus: 'active', healthScore: 99, isWorkspaceDefault: true },
        { id: 'previous', lifecycleStatus: 'active', healthScore: 1, isWorkspaceDefault: false },
      ],
      { previousSenderIdentityId: 'previous' }
    );

    expect(ranked.map(({ id }) => id)).toEqual(['previous', 'healthy']);
    expect(ranked.map(({ recommendationScore }) => recommendationScore)).toEqual([1001, 109]);
  });

  test('does not grant prior-sender preference for an empty context id', () => {
    const ranked = rankEligibleSenderIdentities(
      [
        { id: 'healthy', lifecycleStatus: 'active', healthScore: 80 },
        { id: 'lower', lifecycleStatus: 'active', healthScore: 20 },
      ],
      { previousSenderIdentityId: '' }
    );

    expect(ranked.map(({ recommendationScore }) => recommendationScore)).toEqual([80, 20]);
  });

  test('ranks workspace defaults and numeric health scores in descending order', () => {
    const ranked = rankEligibleSenderIdentities([
      { id: 'default', lifecycleStatus: 'active', healthScore: '50', isWorkspaceDefault: true },
      { id: 'healthiest', lifecycleStatus: 'active', healthScore: 59, isWorkspaceDefault: false },
      { id: 'lower', lifecycleStatus: 'active', healthScore: 20, isWorkspaceDefault: false },
    ]);

    expect(ranked.map(({ id }) => id)).toEqual(['default', 'healthiest', 'lower']);
    expect(ranked.map(({ recommendationScore }) => recommendationScore)).toEqual([60, 59, 20]);
  });

  test('bounds health scores so prior-sender preference remains dominant', () => {
    const ranked = rankEligibleSenderIdentities(
      [
        { id: 'over-limit', lifecycleStatus: 'active', healthScore: 5000 },
        { id: 'previous', lifecycleStatus: 'active', healthScore: -20 },
        { id: 'not-a-number', lifecycleStatus: 'active', healthScore: Number.NaN },
      ],
      { previousSenderIdentityId: 'previous' }
    );

    expect(ranked.map(({ id }) => id)).toEqual(['previous', 'over-limit', 'not-a-number']);
    expect(ranked.map(({ recommendationScore }) => recommendationScore)).toEqual([1000, 100, 0]);
  });

  test('breaks equal-score ties by string id ascending', () => {
    const ranked = rankEligibleSenderIdentities([
      { id: 'zeta', lifecycleStatus: 'active', healthScore: 50 },
      { id: 'alpha', lifecycleStatus: 'active', healthScore: 50 },
      { id: 'middle', lifecycleStatus: 'active', healthScore: 50 },
    ]);

    expect(ranked.map(({ id }) => id)).toEqual(['alpha', 'middle', 'zeta']);
  });

  test('handles empty and malformed identity inputs', () => {
    expect(rankEligibleSenderIdentities()).toEqual([]);
    expect(rankEligibleSenderIdentities(null)).toEqual([]);
    expect(rankEligibleSenderIdentities({ id: 'not-an-array' })).toEqual([]);
    expect(rankEligibleSenderIdentities([null, 'invalid', 42])).toEqual([]);
  });

  test('does not mutate the input array or its identity objects', () => {
    const identities = Object.freeze([
      Object.freeze({ id: 'second', lifecycleStatus: 'active', healthScore: 20 }),
      Object.freeze({ id: 'first', lifecycleStatus: 'active', healthScore: 80 }),
    ]);

    const ranked = rankEligibleSenderIdentities(identities);

    expect(identities.map(({ id }) => id)).toEqual(['second', 'first']);
    expect(identities[0]).not.toHaveProperty('recommendationScore');
    expect(ranked.map(({ id }) => id)).toEqual(['first', 'second']);
    expect(ranked[0]).not.toBe(identities[1]);
  });
});
