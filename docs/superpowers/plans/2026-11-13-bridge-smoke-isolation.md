# Bridge Smoke Isolation Implementation Plan

REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` with one focused implementation pass per task and review between tasks.

No deployment, push or real provider calls during implementation.

**Goal:** Make `npm run test:bridge` use disposable synthetic state and fail closed against working-state writes and provider access.

**Architecture:** Keep the existing bridge assertions, replace unsafe startup/cleanup with a test-only harness. The child receives an allowlisted environment, temporary home/state, a random credential and loopback port, and a preload guard before application imports. Node permissions restrict writes to that temporary directory and disallow subprocess/worker/native-addon escape paths. Outbound fetch, HTTP, TCP/TLS, HTTP2, DNS and UDP are denied. Health is checked only after this exact child announces its bound server over IPC.

**Tech Stack:** Node 22.15+ ESM/permissions/synchronous module hooks and built-in test runner (verified locally on Node 24.14.1); no new dependencies or production bridge changes.

**Spec:** User request and root-cause audit of `scripts/openclaw-smoke.mjs` startup (`...process.env`, fixed port, reset without sample state directory).

## Tasks
- [x] Add a failing isolation regression that cannot launch the old unsafe runner.
- [x] Implement temporary harness, preload guard, bounded readiness/requests, verified cleanup and interrupt handling.
- [x] Wire existing smoke assertions to the harness; run adversarial sample-only checks, then full smoke and verify working-state hash unchanged.
- [x] Independent review, syntax/related checks, record limitations and leave changes local.

## Safety Criteria
- Poisoned provider/database/state/Node-option environment cannot reach the child.
- Existing loopback bridge cannot be mistaken for a test child; bind collision fails without probing it.
- Guard self-check fails before startup when write/network restrictions are unavailable.
- Test canary receives zero requests through fetch, HTTP, raw sockets or worker/subprocess paths.
- Both normal and failed runs stop the child before deleting only the exact newly created temporary root.
- No real-provider fallback and no weakening an assertion merely to get green.

## Execution Ledger
- RED: isolation harness import missing; no unsafe runner launched for this regression.
- Added a temporary-state harness with environment allowlisting, authenticated IPC readiness and restricted Node child permissions; sentinel writes and provider transports were blocked with zero loopback canary traffic.
- Full smoke initially failed at real Chromium spawning, as intended by the guard. Ruling: use an explicitly labelled offline synthetic PDF renderer in the test-only module hook, preserving original route/header/PDF-signature assertions without opening a subprocess/network escape. This does not test Chromium rendering.
- Review found SQLite and DNS Resolver escape paths and fetch authority after port reuse. Disabled SQLite, blocked callback/promise Resolver prototypes and filesystem links, and invalidated/aborted requests on exit, expiry and stop. Added canary regressions.
- Handled-interrupt cleanup passed. Ruling: SIGKILL/machine shutdown cannot guarantee finalizers on Windows; abrupt-death test requires the child to stop, then cleans any verified owned temporary root. Never sweep or delete working state. Best-effort child orphan cleanup changes cwd before removing its root.
- Renamed safety suite to `bridge-smoke-isolation-smoke.mjs` to avoid Jest's `*.test.mjs` discovery. `npm run test:bridge` always runs the eight isolation checks before existing bridge assertions.
- Final verification: all eight isolation tests and full smoke passed; 15 Jest suites / 313 tests passed (8 skipped); lint and syntax checks passed. Independent reviewer reported no remaining P1/P2 findings in scope.
- Working `.pbk-local/openclaw-state.json` SHA-256 was identical before and after full smoke: `dd5e1c879313cad4a1106590113b73910f5ed0f34b6e8f240723802ff6c97268`.
- No send, deployment, push, production approval, saved lead or Netlify privacy changes. Anonymous production Ava route returned 401. See `docs/bridge-smoke-isolation.md` for runtime requirements and coverage limits.
