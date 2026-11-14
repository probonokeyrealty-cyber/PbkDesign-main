import { membership } from './domain.mjs';
import { PUBLIC_INVESTOR_ORIGIN, assertEntryMember } from './entryPolicy.mjs';
const staffOrigin = 'https://pbk-investor-staging--pbkcenter.netlify.app';
export function authRedirectUrl(origin) {
  if (origin === PUBLIC_INVESTOR_ORIGIN || origin === 'https://probono-key-realty.webflow.io')
    return PUBLIC_INVESTOR_ORIGIN + '/';
  if (origin === staffOrigin) return staffOrigin + '/property-log';
  if (['http://localhost:5179', 'http://127.0.0.1:5179'].includes(origin))
    return origin + '/investor-portal.html';
  throw Object.assign(Error('Use a recognized staging sign-in page.'), { status: 403 });
}
// Caller must verify the token against this project's Auth service first.
export function registerVerifiedSession(
  data,
  user,
  hash,
  providerExpiresAt,
  origin,
  now = Date.now()
) {
  if (
    !user?.id ||
    !user.email_confirmed_at ||
    !Number.isFinite(providerExpiresAt) ||
    providerExpiresAt <= now
  )
    throw Object.assign(Error('Your sign-in link expired. Request a fresh sign-in link.'), {
      status: 401,
    });
  if (data.endedSessions?.[hash] > now)
    throw Object.assign(Error('This session was signed out. Request a fresh sign-in link.'), {
      status: 401,
    });
  const email = String(user.email || '').toLowerCase();
  if (!data.members[user.id]) {
    const invite = data.invitations?.[email];
    if (!invite?.approved)
      throw Object.assign(Error('Your portal access is not approved.'), { status: 403 });
    data.members[user.id] = {
      email,
      role: 'investor',
      approved: true,
      highLevelContactId: invite.highLevelContactId || '',
    };
    data.audit.push({
      id: crypto.randomUUID(),
      actor: user.id,
      action: 'approved_investor_signed_in',
      entityId: user.id,
      at: new Date(now).toISOString(),
      detail: { approvedBy: invite.approvedBy },
    });
  }
  assertEntryMember(origin, membership(data, user.id));
  data.sessions ||= {};
  data.endedSessions ||= {};
  for (const [key, value] of Object.entries(data.sessions)) {
    if (value.expiresAt <= now) {
      data.endedSessions[key] = Math.max(
        value.providerExpiresAt || value.expiresAt,
        data.endedSessions[key] || 0
      );
      delete data.sessions[key];
    }
  }
  if (data.endedSessions[hash] > now)
    throw Object.assign(Error('Your portal session expired. Request a fresh sign-in link.'), {
      status: 401,
    });
  for (const [key, until] of Object.entries(data.endedSessions || {}))
    if (until <= now) delete data.endedSessions[key];
  const expiresAt = Math.min(
    now + 3600000,
    providerExpiresAt,
    data.sessions[hash]?.expiresAt ?? Infinity
  );
  data.sessions[hash] = { uid: user.id, expiresAt, providerExpiresAt };
  return Math.max(0, Math.floor((expiresAt - now) / 1000));
}
