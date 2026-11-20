// Consume once at app startup. Clear the fragment before any async work or requests.
export function consumeEmailCallback(location, history) {
  const query = new URLSearchParams(location.search || '');
  if (query.has('error') || query.has('error_code')) {
    for (const key of ['error', 'error_code', 'error_description']) query.delete(key);
    history.replaceState(null, '', location.pathname + (query.size ? '?' + query : ''));
    return {
      error:
        'This email link is invalid or expired. Choose Forgot password to request a new recovery code.',
    };
  }
  const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  if (!['access_token', 'refresh_token', 'error', 'error_code'].some((key) => params.has(key)))
    return null;
  history.replaceState(null, '', location.pathname + location.search);
  const token = params.get('access_token');
  if (params.has('error') || !token || token.length > 8192)
    return {
      error:
        'This email link is invalid or expired. Choose Forgot password to request a new recovery code.',
    };
  return params.get('type') === 'recovery' ? { token, recovery: true } : { token };
}
