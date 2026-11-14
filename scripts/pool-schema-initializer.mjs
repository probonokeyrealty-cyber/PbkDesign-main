export function createPoolSchemaInitializer() {
  const initialized = new WeakMap();
  return function ensure(pool, initialize) {
    if (!pool) return Promise.resolve({ ok: false, reason: 'no_database' });
    if (initialized.has(pool)) return initialized.get(pool);
    const promise = Promise.resolve().then(initialize).then((result) => {
      if (result?.ok !== true) initialized.delete(pool);
      return result;
    }, (error) => {
      initialized.delete(pool);
      throw error;
    });
    initialized.set(pool, promise);
    return promise;
  };
}
