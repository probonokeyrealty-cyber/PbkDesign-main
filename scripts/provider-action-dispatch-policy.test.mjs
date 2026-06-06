import { describe, expect, test } from '@jest/globals';

import { resolveProviderActionDispatchBackend } from './provider-action-dispatch-policy.mjs';

describe('provider action dispatch backend policy', () => {
  test('uses Postgres whenever a shared pool is available', () => {
    expect(
      resolveProviderActionDispatchBackend({
        isHosted: true,
        hasPostgresPool: true,
      })
    ).toBe('postgres');
  });

  test('fails closed on hosted when Postgres is unavailable', () => {
    expect(
      resolveProviderActionDispatchBackend({
        isHosted: true,
        hasPostgresPool: false,
      })
    ).toBe('unavailable');
  });

  test('allows the process-local lease only for local development', () => {
    expect(
      resolveProviderActionDispatchBackend({
        isHosted: false,
        hasPostgresPool: false,
      })
    ).toBe('local');
  });
});
