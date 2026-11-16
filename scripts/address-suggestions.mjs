// Separate Places credentials: never reuse Gemini or expose ATTOM's key to the browser.
export async function lookupAddressSuggestions(input, {
  enabled = process.env.PBK_ADDRESS_AUTOCOMPLETE_ENABLED === 'true',
  apiKey = process.env.PBK_GOOGLE_PLACES_API_KEY, request = fetch,
} = {}) {
  if (!enabled || !apiKey?.trim()) return { status: 'not_configured', suggestions: [] };
  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  const placeId = typeof input?.placeId === 'string' ? input.placeId : '';
  const sessionToken = typeof input?.sessionToken === 'string' ? input.sessionToken : '';
  if (!/^[a-f0-9-]{36}$/i.test(sessionToken) || (!placeId && (query.length < 4 || query.length > 200)) || (placeId && !/^[A-Za-z0-9_-]{1,256}$/.test(placeId))) return { status: 'invalid_query' };
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey.trim(),
      'X-Goog-FieldMask': placeId ? 'addressComponents' : 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text' };
    const url = placeId ? new URL(`https://places.googleapis.com/v1/places/${placeId}`) : new URL('https://places.googleapis.com/v1/places:autocomplete');
    if (placeId) url.searchParams.set('sessionToken', sessionToken);
    const response = await request(url, { method: placeId ? 'GET' : 'POST', headers,
      ...(placeId ? {} : { body: JSON.stringify({ input: query, sessionToken, includedRegionCodes: ['us'], languageCode: 'en' }) }),
      redirect: 'error', signal: AbortSignal.timeout(3500) });
    if ([401, 403].includes(response.status)) return { status: 'authorization_failed' };
    if (response.status === 429) return { status: 'rate_limited' };
    if (!response.ok) return { status: 'unavailable' };
    const payload = await response.json();
    if (!placeId) return { status: 'matched', suggestions: (payload.suggestions || []).slice(0, 5).flatMap(s => {
      const p = s.placePrediction;
      return typeof p?.placeId === 'string' && typeof p?.text?.text === 'string' ? [{ id: p.placeId, label: p.text.text }] : [];
    }) };
    if (!Array.isArray(payload.addressComponents)) return { status: 'unavailable' };
    const part = (type, short = false) => {
      const p = payload.addressComponents.find(c => c.types?.includes(type));
      return (short ? p?.shortText : p?.longText) || '';
    };
    const address = { street: [part('street_number'), part('route'), part('subpremise') ? `Unit ${part('subpremise')}` : ''].filter(Boolean).join(' '),
      city: part('locality') || part('postal_town') || part('sublocality'), state: part('administrative_area_level_1', true), zip: part('postal_code') };
    if (part('country', true) !== 'US' || !part('street_number') || !address.city || !/^[A-Z]{2}$/.test(address.state) || !/^\d{5}$/.test(address.zip)) return { status: 'incomplete_address' };
    return { status: 'matched', address };
  } catch (error) { return { status: error?.name === 'TimeoutError' ? 'timed_out' : 'unavailable' }; }
}
