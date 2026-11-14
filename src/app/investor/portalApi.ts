import { createSessionLifetime } from './sessionLifetime.mjs';
export const PORTAL_API =
  'https://asumndiooctluuecydhj.supabase.co/functions/v1/pbk-investor-staging';
let accessToken = '';
const lifetime = createSessionLifetime(() => {
  accessToken = '';
  window.dispatchEvent(new Event('pbk-portal-expired'));
});
export type PortalMember = { id: string; email: string; role: 'investor' | 'editor' | 'reviewer' };
export async function portalRequest(command: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(PORTAL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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
  if (command === 'authVerify') {
    accessToken = result.token;
    lifetime.arm(result.expiresIn);
  }
  if (command === 'logout') {
    accessToken = '';
    lifetime.clear();
  }
  return result;
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
