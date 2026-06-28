import { randomUUID } from 'node:crypto';

import { resolveProviderActionDispatchBackend } from './provider-action-dispatch-policy.mjs';
import { attachProviderProof } from './provider-proof-ledger.mjs';

let schemaReady = false;
const localDispatches = new Map();
const localLocks = new Map();

export async function ensureProviderActionDispatchSchema(pool) {
  if (!pool || schemaReady) return Boolean(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.provider_action_dispatches (
      approval_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      tool_name TEXT NOT NULL,
      binding_hash TEXT NOT NULL DEFAULT '',
      attempt_token UUID NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('dispatching', 'completed', 'reconciliation_required')
      ),
      result JSONB NOT NULL DEFAULT '{}'::JSONB,
      error TEXT NOT NULL DEFAULT '',
      dispatch_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      reconciliation_required_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS provider_action_dispatches_workspace_status_idx
      ON public.provider_action_dispatches (workspace_id, status, updated_at DESC);

    ALTER TABLE public.provider_action_dispatches ENABLE ROW LEVEL SECURITY;

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON public.provider_action_dispatches FROM anon;
      END IF;
    END $$;

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON public.provider_action_dispatches FROM authenticated;
      END IF;
    END $$;
  `);
  schemaReady = true;
  return true;
}

function mapRow(row = {}) {
  return {
    approvalId: row.approval_id || row.approvalId || '',
    workspaceId: row.workspace_id || row.workspaceId || 'pbk',
    toolName: row.tool_name || row.toolName || '',
    bindingHash: row.binding_hash || row.bindingHash || '',
    attemptToken: row.attempt_token || row.attemptToken || '',
    status: row.status || '',
    value: row.result && typeof row.result === 'object' ? row.result : {},
    error: row.error || '',
    dispatchStartedAt:
      row.dispatch_started_at || row.dispatchStartedAt || '',
    completedAt: row.completed_at || row.completedAt || '',
    reconciliationRequiredAt:
      row.reconciliation_required_at || row.reconciliationRequiredAt || '',
  };
}

async function withLocalLock(key, callback) {
  while (localLocks.has(key)) {
    await localLocks.get(key);
  }
  let releaseLock;
  const lock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  localLocks.set(key, lock);
  try {
    return await callback();
  } finally {
    localLocks.delete(key);
    releaseLock();
  }
}

function buildUnknownValue({
  attemptToken,
  error,
  dispatchStartedAt,
  approvalId = '',
  workspaceId = 'pbk',
  toolName = '',
  bindingHash = '',
}) {
  return attachProviderProof(
    {
      providerActionResult: {
        ok: false,
        result: 'provider_delivery_unknown',
        status: 'reconciliation_required',
        error:
          error?.message ||
          String(error || 'Provider dispatch completion could not be confirmed.'),
        reconciliationRequired: true,
        attemptToken,
        dispatchStartedAt,
        providerAttempted: true,
      },
      providerActionQa: null,
    },
    {
      approvalId,
      workspaceId,
      toolName,
      bindingHash,
      attemptToken,
      dispatchStartedAt,
    }
  );
}

function buildUnavailable({
  approvalId,
  workspaceId,
  toolName,
  bindingHash,
  error = '',
}) {
  return {
    executed: false,
    retryable: true,
    dispatch: {
      approvalId,
      workspaceId,
      toolName,
      bindingHash,
      status: 'lease_unavailable',
      error: error ? String(error) : '',
    },
    value: {
      providerActionResult: {
        ok: false,
        blocked: true,
        result: 'provider_dispatch_lease_unavailable',
        status: 'blocked',
        error: error
          ? `Shared Postgres dispatch coordination is unavailable: ${String(error)}`
          : 'Shared Postgres dispatch coordination is unavailable. Provider execution was not attempted.',
        providerAttempted: false,
        retryable: true,
      },
      providerActionQa: null,
    },
  };
}

export async function executeProviderActionWithSharedLease({
  pool = null,
  isHosted = false,
  approvalId,
  workspaceId = 'pbk',
  toolName,
  bindingHash = '',
  execute,
  now = () => new Date().toISOString(),
  createId = randomUUID,
  logger = console,
}) {
  const lockKey = `pbk-provider-action:${workspaceId}:${approvalId}`;
  const backend = resolveProviderActionDispatchBackend({
    isHosted,
    hasPostgresPool: Boolean(pool),
  });

  if (backend === 'unavailable') {
    return buildUnavailable({
      approvalId,
      workspaceId,
      toolName,
      bindingHash,
    });
  }

  if (backend === 'local') {
    return withLocalLock(lockKey, async () => {
      const existing = localDispatches.get(lockKey);
      if (existing) {
        return {
          executed: false,
          dispatch: existing,
          value: existing.value || {},
        };
      }
      const attemptToken = createId();
      const dispatchStartedAt = now();
      const dispatching = {
        approvalId,
        workspaceId,
        toolName,
        bindingHash,
        attemptToken,
        status: 'dispatching',
        dispatchStartedAt,
        value: {},
      };
      localDispatches.set(lockKey, dispatching);
      try {
        const value = attachProviderProof(
          await execute({ attemptToken, dispatchStartedAt }),
          {
            approvalId,
            workspaceId,
            toolName,
            bindingHash,
            attemptToken,
            dispatchStartedAt,
          }
        );
        const completed = {
          ...dispatching,
          status: 'completed',
          completedAt: now(),
          value,
        };
        localDispatches.set(lockKey, completed);
        return { executed: true, dispatch: completed, value };
      } catch (error) {
        const value = buildUnknownValue({
          attemptToken,
          error,
          dispatchStartedAt,
          approvalId,
          workspaceId,
          toolName,
          bindingHash,
        });
        const unresolved = {
          ...dispatching,
          status: 'reconciliation_required',
          reconciliationRequiredAt: now(),
          error: error?.message || String(error),
          value,
        };
        localDispatches.set(lockKey, unresolved);
        return { executed: true, dispatch: unresolved, value };
      }
    });
  }

  let client = null;
  try {
    await ensureProviderActionDispatchSchema(pool);
    client = await pool.connect();
  } catch (error) {
    return buildUnavailable({
      approvalId,
      workspaceId,
      toolName,
      bindingHash,
      error: error?.message || error,
    });
  }

  let locked = false;
  let attemptToken = '';
  let dispatchStartedAt = '';
  let providerDispatchStarted = false;
  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtextextended($1, 0))',
      [lockKey]
    );
    locked = true;
    const existingResult = await client.query(
      `SELECT *
       FROM public.provider_action_dispatches
       WHERE approval_id = $1
       LIMIT 1`,
      [approvalId]
    );
    if (existingResult.rows[0]) {
      const existing = mapRow(existingResult.rows[0]);
      if (existing.status === 'dispatching') {
        const reconciliationRequiredAt = now();
        const value = buildUnknownValue({
          attemptToken: existing.attemptToken,
          error:
            'A prior provider dispatch began without a durable completion result.',
          dispatchStartedAt: existing.dispatchStartedAt,
          approvalId,
          workspaceId,
          toolName,
          bindingHash,
        });
        await client.query(
          `UPDATE public.provider_action_dispatches
           SET status = 'reconciliation_required',
               result = $2::jsonb,
               error = $3,
               reconciliation_required_at = $4,
               updated_at = $4
           WHERE approval_id = $1
             AND status = 'dispatching'`,
          [
            approvalId,
            JSON.stringify(value),
            value.providerActionResult.error,
            reconciliationRequiredAt,
          ]
        );
        return {
          executed: false,
          dispatch: {
            ...existing,
            status: 'reconciliation_required',
            reconciliationRequiredAt,
            error: value.providerActionResult.error,
            value,
          },
          value,
        };
      }
      return {
        executed: false,
        dispatch: existing,
        value: existing.value || {},
      };
    }

    attemptToken = createId();
    dispatchStartedAt = now();
    await client.query(
      `INSERT INTO public.provider_action_dispatches (
         approval_id, workspace_id, tool_name, binding_hash, attempt_token,
         status, dispatch_started_at, created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5::uuid,'dispatching',$6,$6,$6)`,
      [
        approvalId,
        workspaceId,
        toolName,
        bindingHash,
        attemptToken,
        dispatchStartedAt,
      ]
    );
    providerDispatchStarted = true;

    try {
      const value = attachProviderProof(
        await execute({ attemptToken, dispatchStartedAt }),
        {
          approvalId,
          workspaceId,
          toolName,
          bindingHash,
          attemptToken,
          dispatchStartedAt,
        }
      );
      const completedAt = now();
      await client.query(
        `UPDATE public.provider_action_dispatches
         SET status = 'completed',
             result = $2::jsonb,
             completed_at = $3,
             updated_at = $3
         WHERE approval_id = $1`,
        [approvalId, JSON.stringify(value || {}), completedAt]
      );
      return {
        executed: true,
        dispatch: {
          approvalId,
          workspaceId,
          toolName,
          bindingHash,
          attemptToken,
          status: 'completed',
          dispatchStartedAt,
          completedAt,
          value,
        },
        value,
      };
    } catch (error) {
      const reconciliationRequiredAt = now();
      const value = buildUnknownValue({
        attemptToken,
        error,
        dispatchStartedAt,
        approvalId,
        workspaceId,
        toolName,
        bindingHash,
      });
      await client.query(
        `UPDATE public.provider_action_dispatches
         SET status = 'reconciliation_required',
             result = $2::jsonb,
             error = $3,
             reconciliation_required_at = $4,
             updated_at = $4
         WHERE approval_id = $1`,
        [
          approvalId,
          JSON.stringify(value),
          error?.message || String(error),
          reconciliationRequiredAt,
        ]
      );
      return {
        executed: true,
        dispatch: {
          approvalId,
          workspaceId,
          toolName,
          bindingHash,
          attemptToken,
          status: 'reconciliation_required',
          dispatchStartedAt,
          reconciliationRequiredAt,
          error: error?.message || String(error),
          value,
        },
        value,
      };
    }
  } catch (error) {
    if (!providerDispatchStarted) {
      return buildUnavailable({
        approvalId,
        workspaceId,
        toolName,
        bindingHash,
        error: error?.message || error,
      });
    }
    const reconciliationRequiredAt = now();
    const value = buildUnknownValue({
      attemptToken,
      error,
      dispatchStartedAt,
      approvalId,
      workspaceId,
      toolName,
      bindingHash,
    });
    return {
      executed: true,
      dispatch: {
        approvalId,
        workspaceId,
        toolName,
        bindingHash,
        attemptToken,
        status: 'reconciliation_required',
        dispatchStartedAt,
        reconciliationRequiredAt,
        error: error?.message || String(error),
        value,
      },
      value,
    };
  } finally {
    if (locked && client) {
      await client
        .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
        .catch((error) => {
          logger.warn(
            '[pbk-local-openclaw] provider dispatch advisory unlock failed:',
            error?.message || error
          );
        });
    }
    client?.release();
  }
}
