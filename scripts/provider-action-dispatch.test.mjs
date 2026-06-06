import { randomUUID } from 'node:crypto';

import { describe, expect, jest, test } from '@jest/globals';
import pg from 'pg';

import {
  ensureProviderActionDispatchSchema,
  executeProviderActionWithSharedLease,
} from './provider-action-dispatch.mjs';

const { Pool } = pg;

function createTestPool(connectionString) {
  return new Pool({
    connectionString,
    max: 2,
    ssl: /(localhost|127\.0\.0\.1)/.test(connectionString)
      ? false
      : { rejectUnauthorized: false },
  });
}

describe('provider action dispatch lease', () => {
  test('hosted mode fails closed without Postgres', async () => {
    const execute = jest.fn(async () => ({ ok: true }));
    const result = await executeProviderActionWithSharedLease({
      isHosted: true,
      pool: null,
      approvalId: `approval-${randomUUID()}`,
      toolName: 'telnyx_sms',
      execute,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.dispatch.status).toBe('lease_unavailable');
    expect(result.value.providerActionResult.providerAttempted).toBe(false);
  });

  test('local concurrent attempts execute the provider once', async () => {
    const approvalId = `approval-${randomUUID()}`;
    const execute = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { providerActionResult: { ok: true, result: 'sent' } };
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        executeProviderActionWithSharedLease({
          isHosted: false,
          pool: null,
          approvalId,
          toolName: 'telnyx_sms',
          execute,
        })
      )
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(results.filter((item) => item.executed)).toHaveLength(1);
    expect(
      results.every(
        (item) => item.value.providerActionResult?.result === 'sent'
      )
    ).toBe(true);
  });

  test('a provider exception becomes reconciliation required and is not replayed', async () => {
    const approvalId = `approval-${randomUUID()}`;
    const execute = jest.fn(async () => {
      throw new Error('carrier timeout after dispatch');
    });

    const first = await executeProviderActionWithSharedLease({
      isHosted: false,
      pool: null,
      approvalId,
      toolName: 'telnyx_sms',
      execute,
    });
    const second = await executeProviderActionWithSharedLease({
      isHosted: false,
      pool: null,
      approvalId,
      toolName: 'telnyx_sms',
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(first.dispatch.status).toBe('reconciliation_required');
    expect(first.value.providerActionResult.result).toBe(
      'provider_delivery_unknown'
    );
    expect(second.executed).toBe(false);
    expect(second.dispatch.status).toBe('reconciliation_required');
  });
});

const databaseUrl = String(process.env.PBK_TEST_DATABASE_URL || '').trim();
const databaseTest = databaseUrl ? test : test.skip;

databaseTest(
  'Postgres advisory locks serialize provider execution across separate pools',
  async () => {
    const firstPool = createTestPool(databaseUrl);
    const secondPool = createTestPool(databaseUrl);
    const approvalId = `approval-${randomUUID()}`;
    const execute = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { providerActionResult: { ok: true, result: 'sent' } };
    });

    try {
      await ensureProviderActionDispatchSchema(firstPool);
      await firstPool.query(
        'DELETE FROM public.provider_action_dispatches WHERE approval_id = $1',
        [approvalId]
      );
      const results = await Promise.all([
        executeProviderActionWithSharedLease({
          pool: firstPool,
          isHosted: true,
          approvalId,
          toolName: 'telnyx_sms',
          execute,
        }),
        executeProviderActionWithSharedLease({
          pool: secondPool,
          isHosted: true,
          approvalId,
          toolName: 'telnyx_sms',
          execute,
        }),
      ]);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(results.filter((item) => item.executed)).toHaveLength(1);
      expect(results.every((item) => item.dispatch.status === 'completed')).toBe(
        true
      );
    } finally {
      await firstPool
        .query(
          'DELETE FROM public.provider_action_dispatches WHERE approval_id = $1',
          [approvalId]
        )
        .catch(() => null);
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  },
  30_000
);
