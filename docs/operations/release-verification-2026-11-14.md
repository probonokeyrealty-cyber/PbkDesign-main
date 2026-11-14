# Release Verification: 2026-11-14

## Scope and Deployment

The runtime-hardening merge `621751fee42be4274acfce2a164521db3caea53d`
was pushed to `main` and verified live on both deployment targets:

- Render bridge: `dep-dbs5ghu417fc73f49chg`, live at 12:49:33 UTC.
- Netlify `pbkcenter`: `6af8584747b1c3bcb76e5291`, published at 12:47:30 UTC.
- `/api/release/status` independently returned commit `621751fee42b` and
  `stateBackend: postgres`.
- The current Command Center is <https://pbkcenter.netlify.app>.
  The old `pbkcommandcenter` name still appears in some release metadata and
  must not be used as proof of the current frontend deployment.

These are observations of this deployment, not an availability guarantee.
Subsequent commits must be checked by exact SHA again.

## Verified Behavior

- The hosted team-passcode login completed in Chrome and loaded the fleet.
- All 11 production registry entries passed the read-only deal-context preview
  verifier. Diagnostic lead IDs did not match a seller; provider writes stayed
  blocked. This does not exercise each agent's production action handler.
- The isolated verifier separately passed seven actual diagnostic handlers with
  work-order/context identity assertions. It did not deliver provider messages
  or use production seller records.
- The live `/api/leads` response returned 1,256 leads. A bounded conversation
  request returned five items with `result: postgres`.
- Local OpenClaw authenticated RPC and health checks succeeded. Its existing
  outbound heartbeat reached the hosted bridge. The local gateway has one
  default `main` agent; the 11 PBK specialists belong to the hosted bridge.

### PostgreSQL Write Proof

A diagnostic ran from the authenticated Render web shell using the existing
private database connection. It checked the primary was writable and inspected
`public.bridge_state` before acquiring a bounded lock and starting writes.

The transaction inserted one randomly named canary row, updated only that row,
verified the returned value, rolled back, and queried the canary ID again.

Observed output:

```text
PBK_POSTGRES_WRITE_PROOF: insert=PASS update=PASS rollback=PASS residue=NONE
```

No `singleton` state row, seller, provider action, approval, or schema was changed.
This proves database transaction capability, not a committed manual-lead or
external-provider workflow. External database access was not opened, and no SSH
key or provider credential was added.

## Remaining Evidence Gaps

- A six-sample connection check at 12:52-12:53 UTC included one HTTP 202 result:
  the fresh Postgres probe exceeded its 2,500 ms deadline. Other samples were
  1,794, 744, 30, 2, and 2 ms. The bridge recovered without intervention; do not
  omit the failed sample or call this continuous green health.
- Render metrics in that window did not establish CPU, RAM, or connection-pool
  saturation. The cause of the brief database delay remains unproven.
- `/api/agents/measurement` returned 503 and zero fully measured agents. Ten
  agents lacked latency samples; Ava had seven samples and p95 6,544 ms against
  a 2,500 ms budget. Successful-action and shared-context readiness evidence was
  missing. Do not upload synthetic preview timings to make this endpoint green.
- `/api/production/maturity` returned 202 with the stable-fleet-measurement gap.
  Seven provider circuits were closed, which is not a provider delivery test.
- One gateway heartbeat received HTML rather than JSON during the deployment
  transition. The next heartbeat succeeded. The cause was not established.

No customer calls, SMS, emails, contract sends, or campaign launches were used
as release tests.

## Regressions Found During Verification

The first exact-commit CI run passed Tooling Verify, PBK Agent Evals, and Hosted
Founder Smoke. Founder Verify failed the Redis serialization/healthy-socket
assertion. Linux reproduction showed that the fake TCP Redis server delayed
small pipelined replies before serialization ran. Disabling Nagle in that
fixture preserved the unchanged 40 ms command deadline and same-client
assertion. The old fixture failed three of three Linux runs; the repaired
fixture passed 20 of 20. Both Linux Node 22 and Windows Node 24 passed the
runtime-recovery suite. No runtime timeout was increased to hide this failure.

A separate browser inspection found the Fleet evidence drawer using legacy
success/failure/latency fields and treating heartbeats as successful actions.
The follow-up reads canonical measurement metrics, preserves explicit missing
values, and renders structured HTTP 503 readiness-gap evidence without
suppressing transport or authentication errors. Healthy heartbeats cannot
promote an agent to measured-ready. The regression pack includes 24 unit cases
and desktop Chromium/mobile WebKit behavior checks. Mixed responses select the
newest valid snapshot by its timestamp and retain the source. A failed
measurement request clears readiness evidence and shows a visible warning;
another successful health request cannot hide an authentication error.

Further release-gate execution exposed two stale fixtures and one isolation
issue: missing freshness timestamps were expected to pass, all recalled calls
were expected to have a winning label, and an inherited `PBK_OPENCLAW_PORT`
overrode a projection test's private port. The fixtures now check explicit
freshness and observed outcomes, including negative cases. The projection
child uses a sanitized environment and blocks outbound network access.

The revenue activation regression also exposed a canonical-registry mismatch:
changing the legacy runtime agent record did not change the status read from
the registry. The fix awaits target-only Postgres status persistence before
publishing canonical/runtime status. Tests exercise the actual helper against
PGlite, verify bootstrap reload, preserve paused siblings and operator-owned
fields, and reject a persistence failure without publishing active status.
The isolated HTTP activation then reads the same saved status. Activation
does not create health proof or perform external provider writes.

The follow-up still requires its own exact-commit deployment and CI check.
The original green liveness response is not evidence that these passed.

## Repeatable Checks

Use the existing secret environment, never paste credentials into commands or
commit them. Verify the current Git SHA using the deployment APIs and the bridge
release endpoint before interpreting these checks:

```sh
node scripts/agent-fleet-safe-verification.mjs --isolated
node scripts/agent-fleet-safe-verification.mjs --base-url https://pbk-openclaw-bridge.onrender.com --expected-revision 2026-06-02-agent-fleet-context-preview-v8
npm run test:founder
```

The verifier's `--expected-revision` is the bridge `BUILD_REVISION`, not a Git
SHA. Use `/api/release/status` to establish the deployed Git commit separately.
Hosted verification deliberately refuses `/api/agents/invoke`: a registry
preflight alone cannot atomically guarantee safe local-only execution.
