export function displayFact(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim())
    ? 'Unknown'
    : value;
}
