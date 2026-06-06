const BLOCKED_LIFECYCLE_STATUSES = new Set([
  'warming',
  'paused',
  'quarantined',
  'retired',
  'release_pending',
  'released',
]);

export function normalizeConversationPhone(value = '') {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export function normalizeConversationEmail(value = '') {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function rankEligibleSenderIdentities(identities = [], context = {}) {
  if (!Array.isArray(identities)) return [];

  const previousSenderIdentityId = context?.previousSenderIdentityId;

  return identities
    .filter(
      (identity) =>
        identity &&
        typeof identity === 'object' &&
        !Array.isArray(identity) &&
        !BLOCKED_LIFECYCLE_STATUSES.has(
          String(identity.lifecycleStatus ?? '')
            .trim()
            .toLowerCase()
        )
    )
    .map((identity) => {
      const healthScore = Number(identity.healthScore || 0);
      const recommendationScore =
        (identity.id === previousSenderIdentityId ? 1000 : 0) +
        (Number.isFinite(healthScore) ? healthScore : 0) +
        (identity.isWorkspaceDefault ? 10 : 0);

      return { ...identity, recommendationScore };
    })
    .sort((left, right) => right.recommendationScore - left.recommendationScore);
}
