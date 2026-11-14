export async function observeUsagePersistence(operation) {
  try {
    const result = await operation();
    if (result?.ok === true) return { ok: true, result: 'persisted' };
  } catch {
    // Surface failure without exporting SQL, connection details, or credentials.
  }
  return { ok: false, result: 'failed', warning: 'token_usage_persistence_failed' };
}
