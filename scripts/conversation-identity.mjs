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
