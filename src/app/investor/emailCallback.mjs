// Consume once at app startup. Clear the fragment before any async work or requests.
export function consumeEmailCallback(location, history) {
  const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  if (!['access_token', 'refresh_token', 'error', 'error_code'].some((key) => params.has(key)))
    return null;
  history.replaceState(null, '', location.pathname + location.search);
  const token = params.get('access_token');
  if (params.has('error') || !token || token.length > 8192)
    return { error: 'This email link is invalid or expired. Request a fresh sign-in link below.' };
  return { token };
}
