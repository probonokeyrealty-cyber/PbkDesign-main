# Skill Governance Operations

## Authority

Render Postgres is the only operational authority for skill definitions, versions, approvals, assignments, and activations. Supabase is an asynchronous analytics mirror and is never used for runtime failover.

## Startup

1. Ensure the governance schema.
2. Run the idempotent legacy migration.
3. Load approved active or canary versions from Render Postgres.
4. Save the validated last-known-good runtime snapshot to Redis and local disk.
5. If Render Postgres is temporarily unavailable, load only that checksum-validated snapshot.
6. If neither authority nor snapshot is available, fail closed for new skill selection.

Existing calls may continue with their already-pinned approved snapshot. Candidates and projection-only rows never execute.

## Candidate Review

`POST /api/skills/candidates` creates an immutable candidate version. A candidate cannot execute, create an active assignment, or become part of the runtime snapshot.

Use:

- `GET /api/skills/governance/repository` for exact versions.
- `GET /api/skills/governance/status` for lifecycle, snapshot, and projection health.
- `/skills` in Command Center for the operator workspace.

## Approval And Activation

Approval and activation are deliberately separate:

1. Approve with `POST /api/skills/versions/:versionId/approve`.
2. Supply the exact `expectedHash`; stale approval attempts return a conflict.
3. Activate with `POST /api/skills/versions/:versionId/activate`.
4. New versions default to a 10 percent canary unless the operator explicitly chooses full rollout.

Every authoritative mutation appends an audit event and a projection outbox event in the same transaction.

## Emergency Rollback

Call `POST /api/skills/activations/:activationId/rollback` with a reason. The bridge:

1. Ends the live activation.
2. Expires current assignments.
3. Marks the version rolled back.
4. Reloads the approved runtime set.
5. Appends audit and outbox events.

The rolled-back version is removed from new runtime selections immediately.

## Projection Queue

Projection workers claim rows with bounded leases and `FOR UPDATE SKIP LOCKED`. Transient failures use exponential backoff with jitter. A row is dead-lettered after eight attempts.

Supabase lag affects analytics only. It must not mark the bridge or runtime authority offline.

## Verification

Run:

```powershell
npm.cmd run test:skill-governance
npm.cmd run test:production-hardening
npm.cmd run test:script-rotator
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Do not deploy when a governance, production-hardening, type, lint, or build gate fails.
