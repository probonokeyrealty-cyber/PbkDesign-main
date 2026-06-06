export function resolveProviderActionDispatchBackend({
  isHosted = false,
  hasPostgresPool = false,
} = {}) {
  if (hasPostgresPool) return 'postgres';
  return isHosted ? 'unavailable' : 'local';
}
