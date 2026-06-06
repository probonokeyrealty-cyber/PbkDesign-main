export function normalizeConversationPhone(value = '') {
  if (typeof value !== 'string') return '';

  const phone = value.trim();
  if (!phone || !/^\+?[0-9\s().-]+$/.test(phone)) return '';

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  if (digits.length === 10 && !phone.startsWith('+')) return `+1${digits}`;
  return `+${digits}`;
}

export function normalizeConversationEmail(value = '') {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function providerRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstText(record, fields) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function normalizedProviderStatus(value = '') {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isValidConversationEmail(value = '') {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !value.includes('..');
}

function assignSafeMetadata(metadata, key, value) {
  if (typeof value === 'boolean') {
    metadata[key] = value;
    return;
  }
  if (typeof value === 'string' && value.trim()) metadata[key] = value.trim();
}

function telnyxLifecycleStatus(status) {
  if (/(?:^|_)(?:deleted|released|retired|decommissioned|canceled|cancelled)(?:_|$)/.test(status)) {
    return 'retired';
  }
  if (
    /(?:^|_)(?:disconnected|disabled|failed|failure|error|suspended|blocked|inactive)(?:_|$)/.test(
      status
    )
  ) {
    return 'quarantined';
  }
  if (
    new Set(['active', 'connected', 'healthy', 'enabled', 'in_use', 'live', 'ready']).has(status)
  ) {
    return 'active';
  }
  return 'quarantined';
}

function instantlyLifecycleStatus(providerStatus, warmupStatus) {
  const combined = [providerStatus, warmupStatus].filter(Boolean).join('_');
  if (
    /(?:^|_)(?:error|failed|failure|disconnected|bounced|invalid|quarantined|deleted)(?:_|$)/.test(
      combined
    )
  ) {
    return 'quarantined';
  }
  if (/(?:^|_)(?:paused|disabled|inactive|suspended)(?:_|$)/.test(combined)) {
    return 'paused';
  }
  if (
    /(?:^|_)(?:warming|pending|running|in_progress)(?:_|$)/.test(warmupStatus) ||
    /(?:^|_)warm(?:ing|up|ed)?(?:_|$)/.test(warmupStatus) ||
    /(?:^|_)warm(?:ing|up|ed)?(?:_|$)/.test(providerStatus)
  ) {
    return 'warming';
  }
  if (
    [providerStatus, warmupStatus].some((status) =>
      new Set(['active', 'connected', 'healthy', 'enabled', 'ready', 'complete', 'completed']).has(
        status
      )
    )
  ) {
    return 'active';
  }
  return 'paused';
}

export function normalizeTelnyxSenderIdentity(value, defaultNumber = '') {
  const record = providerRecord(value);
  const address = normalizeConversationPhone(
    firstText(record, ['phoneNumber', 'phone_number', 'number', 'address'])
  );
  if (!address) return null;

  const status = normalizedProviderStatus(
    firstText(record, ['status', 'healthStatus', 'health_status'])
  );
  const customerReference = firstText(record, ['customerReference', 'customer_reference']);
  const connectionId = firstText(record, ['connectionId', 'connection_id']);
  const messagingProfileId = firstText(record, ['messagingProfileId', 'messaging_profile_id']);
  const metadata = {};
  assignSafeMetadata(metadata, 'providerStatus', status || 'unknown');
  assignSafeMetadata(metadata, 'customerReference', customerReference);
  assignSafeMetadata(metadata, 'connectionId', connectionId);
  assignSafeMetadata(metadata, 'messagingProfileId', messagingProfileId);
  if (typeof record.connectionMatchesBridge === 'boolean') {
    assignSafeMetadata(metadata, 'connectionMatchesBridge', record.connectionMatchesBridge);
  }
  if (typeof record.messagingProfileMatchesBridge === 'boolean') {
    assignSafeMetadata(
      metadata,
      'messagingProfileMatchesBridge',
      record.messagingProfileMatchesBridge
    );
  }

  return {
    provider: 'telnyx',
    providerIdentityId:
      firstText(record, [
        'id',
        'uuid',
        'providerIdentityId',
        'provider_identity_id',
        'phoneNumberId',
        'phone_number_id',
      ]) || address,
    channel: 'sms',
    address,
    normalizedAddress: address,
    label: firstText(record, ['label', 'name']) || customerReference || 'Telnyx number',
    region: firstText(record, [
      'region',
      'regionCode',
      'region_code',
      'countryIsoAlpha2',
      'country_iso_alpha2',
    ]),
    lifecycleStatus: telnyxLifecycleStatus(status),
    healthStatus: status || 'unknown',
    isWorkspaceDefault:
      Boolean(normalizeConversationPhone(defaultNumber)) &&
      address === normalizeConversationPhone(defaultNumber),
    metadata,
  };
}

export function normalizeInstantlySenderIdentity(value, defaultEmail = '') {
  const record = providerRecord(value);
  const address = normalizeConversationEmail(
    firstText(record, [
      'email',
      'emailAddress',
      'email_address',
      'address',
      'username',
      'smtpUsername',
      'smtp_username',
    ])
  );
  if (!isValidConversationEmail(address)) return null;

  const providerStatus = normalizedProviderStatus(
    firstText(record, ['status', 'healthStatus', 'health_status'])
  );
  const warmupStatus = normalizedProviderStatus(
    firstText(record, ['warmupStatus', 'warmup_status'])
  );
  const providerName = firstText(record, [
    'providerName',
    'provider_name',
    'provider',
    'smtpProvider',
    'smtp_provider',
    'type',
  ]);
  const metadata = {};
  assignSafeMetadata(metadata, 'providerStatus', providerStatus || 'unknown');
  assignSafeMetadata(metadata, 'warmupStatus', warmupStatus);
  assignSafeMetadata(metadata, 'providerName', providerName);
  const lifecycleStatus = instantlyLifecycleStatus(providerStatus, warmupStatus);

  return {
    provider: 'instantly',
    providerIdentityId:
      firstText(record, [
        'id',
        'uuid',
        'providerIdentityId',
        'provider_identity_id',
        'accountId',
        'account_id',
        'senderId',
        'sender_id',
      ]) || address,
    channel: 'email',
    address,
    normalizedAddress: address,
    label: firstText(record, ['label', 'name', 'displayName', 'display_name']) || address,
    region: firstText(record, [
      'region',
      'regionCode',
      'region_code',
      'country',
      'countryCode',
      'country_code',
    ]),
    lifecycleStatus,
    healthStatus:
      lifecycleStatus === 'warming' && warmupStatus
        ? warmupStatus
        : providerStatus || warmupStatus || 'unknown',
    isWorkspaceDefault:
      Boolean(normalizeConversationEmail(defaultEmail)) &&
      address === normalizeConversationEmail(defaultEmail),
    metadata,
  };
}

export function rankEligibleSenderIdentities(identities = [], context = {}) {
  if (!Array.isArray(identities)) return [];

  const previousSenderIdentityId =
    typeof context?.previousSenderIdentityId === 'string' && context.previousSenderIdentityId.trim()
      ? context.previousSenderIdentityId
      : '';

  return identities
    .filter(
      (identity) =>
        identity &&
        typeof identity === 'object' &&
        !Array.isArray(identity) &&
        typeof identity.id === 'string' &&
        Boolean(identity.id.trim()) &&
        String(identity.lifecycleStatus ?? '')
          .trim()
          .toLowerCase() === 'active'
    )
    .map((identity) => {
      let numericHealthScore = 0;
      try {
        numericHealthScore = Number(identity.healthScore || 0);
      } catch {
        numericHealthScore = 0;
      }

      const healthScore = Number.isFinite(numericHealthScore)
        ? Math.min(100, Math.max(0, numericHealthScore))
        : 0;
      const recommendationScore =
        (previousSenderIdentityId && identity.id === previousSenderIdentityId ? 1000 : 0) +
        healthScore +
        (identity.isWorkspaceDefault ? 10 : 0);

      return { ...identity, recommendationScore };
    })
    .sort(
      (left, right) =>
        right.recommendationScore - left.recommendationScore ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    );
}
