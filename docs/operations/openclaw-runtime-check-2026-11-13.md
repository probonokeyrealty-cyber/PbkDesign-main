# OpenClaw and Fleet Runtime Check

Checked November 13, 2026 (America/Los_Angeles). This is a point-in-time check, not an availability guarantee.

## Observed Live

- Authenticated `openclaw health --json` returned `ok: true`. Chrome successfully connected to the local Control UI at `http://127.0.0.1:18789` using the existing gateway credential.
- The local OpenClaw gateway has one default `main` agent. PBK's eleven specialized agents are registered separately in the hosted bridge; they are not eleven local gateway instances.
- Render bridge health, gateway status, and agent registry returned HTTP 200. All eleven required registry entries were present.
- Three `/api/connection-health` requests returned healthy Postgres and Redis. Postgres query latency was 2 ms each; pool waiting count was zero. HTTP request times were 95-287 ms in these samples, not a load-test percentile.
- Render database `pbk-openclaw-db` was available, used internal DNS, and was on `basic_256mb` without high availability. No billing or infrastructure settings were changed.
- The heartbeat process was restarted with the bounded-request fix and its fresh outbound report was confirmed by Render.

## Not Yet Proven

- `/api/agents/measurement` returned HTTP 503 with measurement gaps. Ten agents had no action-latency samples; Ava's seven samples had p95 6544 ms against a 2500 ms budget. Registration and heartbeats do not establish successful actions.
- Shared intelligence readiness was incomplete/stale. A seller-less global packet is not evidence that eleven individual agents are failing, nor is it proof that they are ready for a seller-specific action.
- The optional desktop sidecar had zero connections.
- `pbkcenter.netlify.app` required Netlify team sign-in in Chrome. The legacy `pbkcommandcenter.netlify.app` returned 404. Access protection was not removed.
- Real SMS, email, phone-call delivery, and customer document sends were not exercised. No test messages or calls were sent to sellers.

## Local Fixes

- Bound heartbeat HTTP requests, including response-body reads; failed one-shot probes no longer exit successfully.
- Recover authoritative state and the agent registry after a transient startup database failure. Block placeholder-state persistence and state-dependent scheduled work while recovery is incomplete.
- Retry Postgres connection acquisition within one deadline; do not replay dispatched SQL after an ambiguous failure. Release late clients, discard timed-out clients, preserve callback semantics, and reject invalid retry settings safely.
- Bound established Redis commands, retire only the failing connection, and preserve fail-closed distributed leases. Never retry an uncertain write automatically.
- Require actual action, context, inventory, and latency evidence for fleet measurement. Keep health-check timestamps separate from action timestamps.
- Use successful Redis synchronization timestamps rather than result-code strings. Rebuilding a stale intelligence packet no longer renews its freshness; all eleven fleet members are required for coverage.
- Isolate runtime smoke tests from production credentials, network access, and operator state.
- Return a specific retryable 503 when the canonical contract PDF renderer is unavailable, instead of a generic 500 or a substitute contract. The isolated bridge smoke deliberately blocks Chromium and checks this failure path.

These hosted bridge changes are local working-tree changes, not a deployment claim. Existing unrelated edits were preserved.

## Verification

Final unit run: 19 suites passed, 389 tests passed, 8 skipped. Postgres failure-path regression: 21 passed. The isolated intelligence-context HTTP integration passed six source/refresh scenarios. Typecheck, lint, fleet smokes, gateway/Redis recovery, manual save/read, PDF content, delegation, offline bridge, and Docker import checks passed. The full `test:founder` release gate was not run.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:unit -- --runInBand
npm.cmd run test:connection-strength
npm.cmd run test:agent-fleet
npm.cmd run test:ava-agent-delegation-runtime
npm.cmd run test:pbk-intelligence-context
npm.cmd run test:manual-actions-routes
npm.cmd run test:pdf-output-quality
npm.cmd run test:bridge
node scripts/production-hardening-smoke.mjs
node scripts/postgres-no-fallback-smoke.mjs
```

The recovery tests use simulated Postgres clients and loopback Redis servers to reproduce failures without causing a production outage. The manual test verifies isolated lead save, roster read, seller name, detail read, and persistence. Its provider responses intentionally do not prove delivery. The PDF test inspects generated PDF text for the expected content and absence of internal renderer errors; it is not a visual review of every production template.

The general `test:bridge` script now strips production credentials, denies outbound network and subprocess access, and uses a disposable state directory. It reports `providerDeliveryVerified: false` and `canonicalContractPdfReady` explicitly. A passing offline run does not establish production contract rendering or provider delivery.
