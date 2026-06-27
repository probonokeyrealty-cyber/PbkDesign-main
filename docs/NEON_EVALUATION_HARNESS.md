# Neon Evaluation Harness

PBK production state stays on Render Postgres through `PBK_DATABASE_URL`.
The Neon harness is a separate disposable lane for agent evals, risky query tests,
and Skill Studio/CRM learning checks before anything touches production.

## What It Does

`npm run neon:evaluation` creates a temporary Neon branch, runs one command
against that branch, and deletes the branch in a `finally` block.

The child command receives:

- `PBK_TEST_DATABASE_URL`
- `PBK_EVAL_DATABASE_URL`
- `PBK_NEON_EVAL_BRANCH_ID`
- `PBK_NEON_EVAL_BRANCH_NAME`
- `PBK_NEON_EVAL_BRANCH_EXPIRES_AT`

By default, the child command does **not** inherit:

- `PBK_DATABASE_URL`
- `DATABASE_URL`
- `SUPABASE_DB_URL`
- `PBK_MIGRATION_DATABASE_URL`

That keeps evals and migrations from accidentally reaching production.

## Dry Run

Use this after changing the harness or package scripts:

```powershell
npm run neon:evaluation:dry-run
```

This validates the branch payload, TTL, default eval command, and sanitized child
environment without calling the Neon API.

## Live Eval

Set a project-scoped Neon API key and project id locally:

```powershell
$env:NEON_API_KEY="..."
$env:NEON_PROJECT_ID="..."
npm run neon:evaluation -- -- npm run test:ava-eval-suite
```

Accepted aliases:

- `PBK_NEON_API_KEY`
- `PBK_NEON_PROJECT_ID`
- `PBK_NEON_EVAL_PROJECT_ID`

The Neon connector currently shows the PBK project as `PBK CC`
(`rough-star-13684517`). The project id is not a secret, but keep the API key
out of git and chat.

Use a shorter TTL for quick checks:

```powershell
npm run neon:evaluation -- --ttl-hours 4 -- npm run test:approval-unison
```

Use a specific parent branch if needed:

```powershell
npm run neon:evaluation -- --parent-branch-id br-example -- npm run test:ava-eval-suite
```

## Runtime Bridge Tests

Most tests should use only `PBK_TEST_DATABASE_URL` and `PBK_EVAL_DATABASE_URL`.
Use `--inject-runtime-db` only when intentionally testing the OpenClaw runtime
against the disposable branch:

```powershell
npm run neon:evaluation -- --inject-runtime-db -- npm run test:bridge
```

This aliases the branch into `PBK_DATABASE_URL` and `DATABASE_URL` for that child
process only.

## Guardrails

- API-created branches always get `expires_at`.
- The harness deletes the branch after the child command exits.
- `PBK_MIGRATION_DATABASE_URL` is scrubbed so migration commands still require
  their explicit migration target.
- The harness smoke is included in `npm run test:production-hardening`.

## Useful Checks

```powershell
npm run test:neon-evaluation-harness
npm run neon:evaluation:dry-run
npm run validate:scripts
```
