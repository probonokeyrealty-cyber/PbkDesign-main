import {
  normalizeConversationEmail,
  normalizeConversationPhone,
  normalizeInstantlySenderIdentity,
  normalizeTelnyxSenderIdentity,
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

describe('provider sender identity normalization', () => {
  test.each([
    [
      {
        id: 'telnyx-snake',
        phone_number: '(614) 555-0199',
        customer_reference: 'Columbus acquisitions',
        region_code: 'US-OH',
        status: 'active',
        connection_id: 'connection-1',
        messaging_profile_id: 'profile-1',
        connectionMatchesBridge: true,
        api_key: 'must-not-leak',
      },
      '+16145550199',
      {
        providerIdentityId: 'telnyx-snake',
        label: 'Columbus acquisitions',
        region: 'US-OH',
        lifecycleStatus: 'active',
        healthStatus: 'active',
        isWorkspaceDefault: true,
      },
    ],
    [
      {
        phoneNumber: '+45 12 34 56 78',
        customerReference: 'Denmark',
        region: 'DK',
        status: 'connected',
        connectionId: 'connection-2',
        messagingProfileId: 'profile-2',
        token: 'must-not-leak',
      },
      '',
      {
        providerIdentityId: '+4512345678',
        label: 'Denmark',
        region: 'DK',
        lifecycleStatus: 'active',
        healthStatus: 'connected',
        isWorkspaceDefault: false,
      },
    ],
  ])('normalizes Telnyx snake/camel records safely', (record, defaultNumber, expected) => {
    const identity = normalizeTelnyxSenderIdentity(record, defaultNumber);

    expect(identity).toMatchObject({
      provider: 'telnyx',
      channel: 'sms',
      address: expected.providerIdentityId.startsWith('+')
        ? expected.providerIdentityId
        : '+16145550199',
      normalizedAddress: expected.providerIdentityId.startsWith('+')
        ? expected.providerIdentityId
        : '+16145550199',
      ...expected,
    });
    expect(identity.metadata).not.toHaveProperty('api_key');
    expect(identity.metadata).not.toHaveProperty('token');
  });

  test.each([
    ['deleted', 'retired'],
    ['disconnected', 'quarantined'],
    ['disabled', 'quarantined'],
    ['failed', 'quarantined'],
    ['mystery-state', 'quarantined'],
    ['', 'quarantined'],
  ])('fails Telnyx status %p closed', (status, lifecycleStatus) => {
    expect(
      normalizeTelnyxSenderIdentity({
        id: `telnyx-${status || 'missing'}`,
        phone_number: '+16145550199',
        status,
      })
    ).toMatchObject({ lifecycleStatus });
  });

  test.each([
    [
      {
        id: 'instantly-snake',
        email_address: ' Seller@Example.COM ',
        display_name: 'Seller inbox',
        provider_name: 'Google',
        status: 'active',
        warmup_status: 'warming',
        password: 'must-not-leak',
      },
      'seller@example.com',
      {
        providerIdentityId: 'instantly-snake',
        lifecycleStatus: 'warming',
        healthStatus: 'warming',
        isWorkspaceDefault: true,
      },
    ],
    [
      {
        uuid: 'instantly-camel',
        emailAddress: 'ready@example.com',
        displayName: 'Ready inbox',
        providerName: 'Microsoft',
        status: 'healthy',
        warmupStatus: 'complete',
        apiKey: 'must-not-leak',
      },
      '',
      {
        providerIdentityId: 'instantly-camel',
        lifecycleStatus: 'active',
        healthStatus: 'healthy',
        isWorkspaceDefault: false,
      },
    ],
  ])('normalizes Instantly snake/camel records safely', (record, defaultEmail, expected) => {
    const identity = normalizeInstantlySenderIdentity(record, defaultEmail);

    expect(identity).toMatchObject({
      provider: 'instantly',
      channel: 'email',
      address: String(record.email_address || record.emailAddress)
        .trim()
        .toLowerCase(),
      normalizedAddress: String(record.email_address || record.emailAddress)
        .trim()
        .toLowerCase(),
      ...expected,
    });
    expect(identity.metadata).not.toHaveProperty('password');
    expect(identity.metadata).not.toHaveProperty('apiKey');
  });

  test('keeps real Instantly adapter status and warmup signals independent', () => {
    expect(
      normalizeInstantlySenderIdentity({
        id: 'instantly-real-shape',
        email: 'seller@example.com',
        status: 'active',
        warmup_status: 'warming',
      })
    ).toMatchObject({
      lifecycleStatus: 'warming',
      healthStatus: 'warming',
      metadata: {
        providerStatus: 'active',
        warmupStatus: 'warming',
      },
    });
  });

  test.each(['warming', 'pending', 'running', 'in_progress', 'warmup_running'])(
    'treats warmup signal %p as warming despite active provider status',
    (warmupStatus) => {
      expect(
        normalizeInstantlySenderIdentity({
          id: `instantly-${warmupStatus}`,
          email: 'seller@example.com',
          status: 'active',
          warmupStatus,
        })
      ).toMatchObject({
        lifecycleStatus: 'warming',
        healthStatus: warmupStatus,
        metadata: {
          providerStatus: 'active',
          warmupStatus,
        },
      });
    }
  );

  test.each([
    ['warming', 'warming'],
    ['warmup', 'warming'],
    ['paused', 'paused'],
    ['disabled', 'paused'],
    ['error', 'quarantined'],
    ['failed', 'quarantined'],
    ['connected', 'active'],
    ['unknown-state', 'paused'],
    ['', 'paused'],
  ])('maps Instantly status %p fail-closed', (status, lifecycleStatus) => {
    expect(
      normalizeInstantlySenderIdentity({
        id: `instantly-${status || 'missing'}`,
        email: 'sender@example.com',
        status,
      })
    ).toMatchObject({ lifecycleStatus });
  });

  test.each([
    [normalizeTelnyxSenderIdentity, {}, ''],
    [normalizeTelnyxSenderIdentity, { phone_number: 'not-a-phone' }, '+16145550199'],
    [normalizeInstantlySenderIdentity, {}, ''],
    [normalizeInstantlySenderIdentity, { email: 'not-an-email' }, 'sender@example.com'],
  ])('returns null for invalid provider addresses', (normalize, record, fallback) => {
    expect(normalize(record, fallback)).toBeNull();
  });

  test('does not mutate provider records and emits only allowlisted metadata', () => {
    const telnyx = Object.freeze({
      id: 'telnyx-1',
      phoneNumber: '+16145550199',
      status: 'active',
      connectionId: 'connection-1',
      nested: Object.freeze({ secret: 'nope' }),
      raw: Object.freeze({ apiKey: 'nope' }),
    });
    const instantly = Object.freeze({
      id: 'instantly-1',
      email: 'sender@example.com',
      status: 'active',
      smtpPassword: 'nope',
      raw: Object.freeze({ token: 'nope' }),
    });

    expect(normalizeTelnyxSenderIdentity(telnyx).metadata).toEqual({
      providerStatus: 'active',
      connectionId: 'connection-1',
    });
    expect(normalizeInstantlySenderIdentity(instantly).metadata).toEqual({
      providerStatus: 'active',
    });
    expect(telnyx).toHaveProperty('raw');
    expect(instantly).toHaveProperty('raw');
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
