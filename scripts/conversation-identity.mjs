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

function firstValue(record, fields) {
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) continue;
    const value = record[field];
    if (value !== null && value !== undefined && value !== '') return value;
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
  if (typeof value === 'number' && Number.isFinite(value)) {
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

const INSTANTLY_ACCOUNT_STATUS_LABELS = new Map([
  [1, 'active'],
  [2, 'paused'],
  [3, 'temporary_maintenance'],
  [-1, 'connection_error'],
  [-2, 'soft_bounce'],
  [-3, 'sending_error'],
]);
const INSTANTLY_WARMUP_STATUS_LABELS = new Map([
  [0, 'paused'],
  [1, 'active'],
  [-1, 'banned'],
  [-2, 'spam_folder_unknown'],
  [-3, 'permanent_suspension'],
]);

function instantlyStatusCode(value, labels) {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(number) && labels.has(number) ? number : null;
}

function instantlyLifecycleStatus(providerStatus, warmupStatus, setupPending) {
  if (
    /(?:^|_)(?:connection_error|soft_bounce|sending_error|error|failed|failure|disconnected|bounced|invalid|quarantined|deleted)(?:_|$)/.test(
      providerStatus
    ) ||
    /(?:^|_)(?:banned|spam_folder_unknown|permanent_suspension|error|failed|quarantined)(?:_|$)/.test(
      warmupStatus
    )
  ) {
    return 'quarantined';
  }
  if (
    /(?:^|_)(?:paused|temporary_maintenance|disabled|inactive|suspended)(?:_|$)/.test(
      providerStatus
    )
  ) {
    return 'paused';
  }
  if (setupPending) return 'warming';
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

  const rawProviderStatus = firstValue(record, ['status', 'healthStatus', 'health_status']);
  const rawWarmupStatus = firstValue(record, ['warmupStatus', 'warmup_status']);
  const providerStatusCode = instantlyStatusCode(
    rawProviderStatus,
    INSTANTLY_ACCOUNT_STATUS_LABELS
  );
  const warmupStatusCode = instantlyStatusCode(rawWarmupStatus, INSTANTLY_WARMUP_STATUS_LABELS);
  const providerStatus =
    providerStatusCode === null
      ? normalizedProviderStatus(rawProviderStatus)
      : INSTANTLY_ACCOUNT_STATUS_LABELS.get(providerStatusCode);
  const warmupStatus =
    warmupStatusCode === null
      ? normalizedProviderStatus(rawWarmupStatus)
      : INSTANTLY_WARMUP_STATUS_LABELS.get(warmupStatusCode);
  const rawSetupPending = firstValue(record, ['setupPending', 'setup_pending']);
  const setupPending =
    rawSetupPending === true ||
    rawSetupPending === 1 ||
    String(rawSetupPending).trim().toLowerCase() === 'true';
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
  if (providerStatusCode !== null) {
    assignSafeMetadata(metadata, 'providerStatusCode', providerStatusCode);
  }
  assignSafeMetadata(metadata, 'warmupStatus', warmupStatus);
  if (warmupStatusCode !== null) {
    assignSafeMetadata(metadata, 'warmupStatusCode', warmupStatusCode);
  }
  if (rawSetupPending !== '') assignSafeMetadata(metadata, 'setupPending', setupPending);
  assignSafeMetadata(metadata, 'providerName', providerName);
  const lifecycleStatus = instantlyLifecycleStatus(providerStatus, warmupStatus, setupPending);
  const quarantinedWarmupStatuses = new Set([
    'banned',
    'spam_folder_unknown',
    'permanent_suspension',
  ]);

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
      lifecycleStatus === 'quarantined' && quarantinedWarmupStatuses.has(warmupStatus)
        ? warmupStatus
        : lifecycleStatus === 'warming' && setupPending
          ? 'setup_pending'
          : lifecycleStatus === 'warming' && warmupStatus
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
  const leadRegion =
    typeof context?.leadRegion === 'string' ? context.leadRegion.trim().toLowerCase() : '';
  const unsafeHealthStatus =
    /(?:^|_)(?:blocked|quarantined|error|failed|failure|banned|suspended|disabled|disconnected|retired|released|release_pending|sending_error|connection_error|soft_bounce|permanent_suspension)(?:_|$)/;

  return identities
    .filter(
      (identity) => {
        if (
          !identity ||
          typeof identity !== 'object' ||
          Array.isArray(identity) ||
          typeof identity.id !== 'string' ||
          !identity.id.trim() ||
          String(identity.lifecycleStatus ?? '')
            .trim()
            .toLowerCase() !== 'active'
        ) {
          return false;
        }
        const healthStatus = String(identity.healthStatus ?? '')
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_');
        return !unsafeHealthStatus.test(healthStatus);
      }
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
      const regionMatches =
        Boolean(leadRegion) &&
        typeof identity.region === 'string' &&
        identity.region.trim().toLowerCase() === leadRegion;
      const reasonCodes = [];
      if (previousSenderIdentityId && identity.id === previousSenderIdentityId) {
        reasonCodes.push('previous_successful_sender');
      }
      if (regionMatches) reasonCodes.push('lead_region_match');
      if (identity.isWorkspaceDefault) reasonCodes.push('workspace_default');
      if (healthScore > 0 || /^(?:active|connected|healthy|ready|enabled)$/.test(
        String(identity.healthStatus ?? '').trim().toLowerCase()
      )) {
        reasonCodes.push('healthy');
      }
      const recommendationScore =
        (previousSenderIdentityId && identity.id === previousSenderIdentityId ? 1000 : 0) +
        (regionMatches ? 25 : 0) +
        healthScore +
        (identity.isWorkspaceDefault ? 10 : 0);

      return { ...identity, recommendationScore, reasonCodes };
    })
    .sort(
      (left, right) =>
        right.recommendationScore - left.recommendationScore ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    );
}
