import { createSessionLifetime } from './sessionLifetime.mjs';
import { consumeEmailCallback } from './emailCallback.mjs';
import { PORTAL_PROFILE } from './portalEnvironment';
export const PORTAL_API = `https://asumndiooctluuecydhj.supabase.co/functions/v1/${PORTAL_PROFILE.functionName}`;
let accessToken = '';
// Read and scrub at module startup, before React renders or any network work begins.
const emailCallback = consumeEmailCallback(window.location, window.history);
let callbackAttempt: Promise<boolean> | undefined;
const lifetime = createSessionLifetime(() => {
  accessToken = '';
  window.dispatchEvent(new Event('pbk-portal-expired'));
});
export type PortalMember = { id: string; email: string; role: 'investor' | 'editor' | 'reviewer' };
export async function portalRequest(
  command: string,
  payload: Record<string, unknown> = {},
  callbackToken?: string
) {
  const response = await fetch(PORTAL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(callbackToken || accessToken
        ? { Authorization: `Bearer ${callbackToken || accessToken}` }
        : {}),
    },
    body: JSON.stringify({ command, payload }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) accessToken = '';
    throw new Error(result.error || 'Unable to complete this action.');
  }
  if (command === 'authVerify' || command === 'authCallback') {
    accessToken = command === 'authCallback' ? callbackToken! : result.token;
    lifetime.arm(result.expiresIn);
  }
  if (command === 'logout') {
    accessToken = '';
    lifetime.clear();
  }
  return result;
}
export function completeEmailCallback() {
  if (!callbackAttempt)
    callbackAttempt = (async () => {
      if (!emailCallback) return false;
      if (emailCallback.error) throw new Error(emailCallback.error);
      try {
        await portalRequest('authCallback', {}, emailCallback.token);
      } finally {
        delete emailCallback.token;
      }
      return true;
    })();
  return callbackAttempt;
}
export async function uploadPortalAsset(form: FormData) {
  const response = await fetch(PORTAL_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    cache: 'no-store',
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Upload failed.');
  return result;
}
