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
    ['44 20 7946 0958', '+442079460958'],
    ['', ''],
    [null, ''],
    ['not a phone', ''],
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
  test('excludes every blocked lifecycle status while keeping active and otherwise eligible identities', () => {
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
      { id: 'eligible-without-status' },
      ...blockedStatuses.map((lifecycleStatus) => ({ id: lifecycleStatus, lifecycleStatus })),
    ];

    expect(rankEligibleSenderIdentities(identities).map(({ id }) => id)).toEqual([
      'active',
      'eligible-without-status',
    ]);
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

  test('ranks workspace defaults and numeric health scores in descending order', () => {
    const ranked = rankEligibleSenderIdentities([
      { id: 'default', lifecycleStatus: 'active', healthScore: '50', isWorkspaceDefault: true },
      { id: 'healthiest', lifecycleStatus: 'active', healthScore: 59, isWorkspaceDefault: false },
      { id: 'lower', lifecycleStatus: 'active', healthScore: 20, isWorkspaceDefault: false },
    ]);

    expect(ranked.map(({ id }) => id)).toEqual(['default', 'healthiest', 'lower']);
    expect(ranked.map(({ recommendationScore }) => recommendationScore)).toEqual([60, 59, 20]);
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
