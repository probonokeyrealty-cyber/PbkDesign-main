// Read-only composition: no imports, saves, research jobs, or underwriting claims.
export async function analyzerPropertyPreview(address, { listing, records }) {
  const text = typeof address === 'string' ? address.trim() : '';
  const match =
    text.length <= 500 && text.match(/^(\d[^,]+),\s*([^,]+),\s*([a-z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!match)
    return { cache: { hit: false }, propertyData: null, records: { status: 'invalid_address' } };
  const [cached, publicRecords] = await Promise.allSettled([
    listing({ address: text, queueBrowserResearch: false, source: 'analyzer-preview' }),
    records({
      street: match[1].trim(),
      city: match[2].trim(),
      state: match[3].toUpperCase(),
      zip: match[4],
    }),
  ]);
  return {
    ...(cached.status === 'fulfilled'
      ? cached.value
      : { cache: { hit: false }, propertyData: null }),
    records: publicRecords.status === 'fulfilled' ? publicRecords.value : { status: 'unavailable' },
  };
}
